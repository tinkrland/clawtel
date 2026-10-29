"""the retelldb service: the memory layer as an http api, stdlib only.

endpoints:
  GET  /health
  POST /v1/ingest     {persona_id, nodes[], artifacts[], scope?}
  POST /v1/query      {query, scope, limit?}
  POST /v1/ground     {query, scope, limit?}   the pre-call brief
  POST /v1/tools      {name, args, scope}      the mid-call tools
  GET  /v1/tools                            the catalog
  GET  /v1/status     ?persona_id

fail-closed: RETELLDB_API_KEY set means the key is required on every
/v1 call. the clawtel server is the only caller, and it sends one.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional
from urllib.parse import urlparse, parse_qs

# allow both `python3 -m retelldb.app` from the repo root and
# `python3 app.py` from inside the folder
try:
    from .store import Store
    from .scope import filter_nodes
    from .grounding import build_brief, meet_brief_lines
    from .tools import call_tool, tool_catalog
except ImportError:  # pragma: no cover - script mode
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from retelldb.store import Store
    from retelldb.scope import filter_nodes
    from retelldb.grounding import build_brief, meet_brief_lines
    from retelldb.tools import call_tool, tool_catalog


STORE: Optional[Store] = None


def store() -> Store:
    global STORE
    if STORE is None:
        STORE = Store(os.environ.get("RETELLDB_DATA") or None)
    return STORE


def _handle_ingest(payload: dict) -> tuple[int, dict]:
    persona_id = payload.get("persona_id") or "shared"
    scope = payload.get("scope") or {}
    created_nodes = 0
    created_artifacts = 0
    node_ids = []
    artifact_ids = []

    for art in payload.get("artifacts") or []:
        if not art.get("name") or art.get("content") is None:
            return 400, {"error": "an artifact needs name and content. nothing is invented."}
        artifact, created = store().put_artifact(
            name=art["name"],
            content=art["content"],
            mime=art.get("mime", "text/plain"),
            persona_id=art.get("persona_id", persona_id),
            connection_id=art.get("connection_id", scope.get("connection_id")),
            platform=art.get("platform", scope.get("platform")),
            tags=art.get("tags", []),
            source_uri=art.get("source_uri"),
        )
        artifact_ids.append(artifact.id)
        created_artifacts += 1 if created else 0

    for node in payload.get("nodes") or []:
        if not node.get("text"):
            return 400, {"error": "a node needs text. nothing is invented."}
        # an artifact ingested in the same payload can be referenced by
        # index, so transcript segments and their original file land in
        # one call and the citation always has somewhere to point
        node_artifact_id = node.get("artifact_id")
        if node_artifact_id is None and node.get("artifact_index") is not None:
            idx = int(node["artifact_index"])
            if 0 <= idx < len(artifact_ids):
                node_artifact_id = artifact_ids[idx]
        created_node, created = store().upsert_node(
            persona_id=node.get("persona_id", persona_id),
            type=node.get("type", "fact"),
            key=node.get("key") or node["text"][:80],
            text=node["text"],
            tags=node.get("tags", []),
            platform=node.get("platform", scope.get("platform")),
            connection_id=node.get("connection_id", scope.get("connection_id")),
            sensitivity=node.get("sensitivity", "normal"),
            artifact_id=node_artifact_id,
            pointer=node.get("pointer"),
        )
        node_ids.append(created_node.id)
        created_nodes += 1 if created else 0

    return 200, {
        "ingested": {"nodes": len(node_ids), "artifacts": len(artifact_ids)},
        "created": {"nodes": created_nodes, "artifacts": created_artifacts},
        "node_ids": node_ids,
        "artifact_ids": artifact_ids,
    }


def _handle_query(payload: dict) -> tuple[int, dict]:
    query = payload.get("query")
    scope = payload.get("scope") or {}
    if not query:
        return 400, {"error": "a query needs a query"}
    if not scope.get("platform"):
        # an undeclared surface must not read as unanchored
        return 400, {"error": "a query needs a declared platform"}
    persona_id = scope.get("persona_id")
    candidates = store().list_nodes(persona_id=persona_id)
    kept, dropped = filter_nodes(candidates, scope)
    scored = store().search(query, kept, limit=int(payload.get("limit") or 8))
    return 200, {
        "enabled": True,
        "nodes": [
            {
                "node_id": n.id,
                "type": n.type,
                "text": n.text,
                "platform": n.platform,
                "connection_id": n.connection_id,
                "artifact_id": n.artifact_id,
                "pointer": n.pointer,
                "score": round(s, 4),
            }
            for n, s in scored
        ],
        "dropped": dropped,
        "retrieval": "lexical",
    }


def _handle_ground(payload: dict) -> tuple[int, dict]:
    scope = payload.get("scope") or {}
    if not scope.get("platform"):
        return 400, {"error": "a brief needs a declared platform"}
    brief = build_brief(store(), scope, payload.get("query") or "", int(payload.get("limit") or 8))
    brief["prompt_line"] = meet_brief_lines(brief)
    return 200, brief


def _handle_tools(payload: dict) -> tuple[int, dict]:
    result = call_tool(
        store(),
        payload.get("scope") or {},
        payload.get("name") or "",
        payload.get("args") or {},
    )
    return (200 if result.get("ok") else 400), result


class Handler(BaseHTTPRequestHandler):
    server_version = "clawtel-retelldb/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # quiet by default
        if os.environ.get("RETELLDB_VERBOSE"):
            super().log_message(fmt, *args)

    def _key_ok(self) -> bool:
        required = os.environ.get("RETELLDB_API_KEY")
        if not required:
            return True
        return self.headers.get("x-api-key") == required

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 (http.server naming)
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self._send(200, {"status": "ok", "service": "retelldb"})
        if not self._key_ok():
            return self._send(401, {"error": "api key required"})
        if parsed.path == "/v1/tools":
            return self._send(200, {"tools": tool_catalog()})
        if parsed.path == "/v1/status":
            persona_id = (parse_qs(parsed.query).get("persona_id") or [None])[0]
            return self._send(
                200,
                {
                    "nodes": len(store().list_nodes(persona_id=persona_id)),
                    "artifacts": len(store().list_artifacts(persona_id=persona_id)),
                    "persistence": "json file" if os.environ.get("RETELLDB_DATA") else "memory only",
                },
            )
        return self._send(404, {"error": f"no route {parsed.path}"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not self._key_ok():
            return self._send(401, {"error": "api key required"})
        length = int(self.headers.get("content-length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "the body was not json"})

        routes = {
            "/v1/ingest": _handle_ingest,
            "/v1/query": _handle_query,
            "/v1/ground": _handle_ground,
            "/v1/tools": _handle_tools,
        }
        handler = routes.get(parsed.path)
        if not handler:
            return self._send(404, {"error": f"no route {parsed.path}"})
        try:
            status, body = handler(payload)
        except ValueError as err:
            status, body = 400, {"error": str(err)}
        return self._send(status, body)


def serve(port: int = 8001) -> None:
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"retelldb listening on :{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    serve(int(os.environ.get("PORT") or 8001))
