"""tools: what the agent can DO mid-call, and the original file behind it.

the split the owner drew: the pre-call scan reads a brief (pointers),
but mid-call, when someone asks "what exactly does the contract say",
the tool returns the ORIGINAL material, verbatim, from the artifact
store. not a summary, not a chunk with a paraphrase. the file itself,
or the exact span asked for.

every tool answers {ok, result, provenance} or an honest error. an
unknown tool lists the registry; it never improvises.
"""

from __future__ import annotations

import re
from typing import Callable, Dict, List, Optional

from .scope import filter_nodes
from .store import Store

MAX_SPAN_CHARS = 20000


def _provenance(node_or_artifact, extra: Optional[dict] = None) -> dict:
    prov = {
        "id": getattr(node_or_artifact, "id", None),
        "source": getattr(node_or_artifact, "source_uri", None)
        or getattr(node_or_artifact, "artifact_id", None),
    }
    if extra:
        prov.update(extra)
    return prov


def tool_get_artifact(store: Store, scope: dict, args: dict) -> dict:
    """return the ORIGINAL file, or the exact span of it asked for."""
    aid = args.get("artifact_id")
    if not aid:
        return {"ok": False, "error": "get_artifact needs artifact_id"}
    art = store.get_artifact(aid)
    if not art:
        return {"ok": False, "error": f"no artifact {aid}"}

    # artifacts obey the same walls as nodes: an unanchored session
    # does not get a person's anchored file
    from .store import Artifact  # local import: dataclass type use only

    pseudo = type(
        "ScopedArtifact",
        (),
        {
            "persona_id": art.persona_id or "shared",
            "connection_id": art.connection_id,
            "platform": art.platform,
            "sensitivity": "normal",
        },
    )()
    ok, reason = _artifact_carry(pseudo, scope)
    if not ok:
        return {"ok": False, "error": f"artifact dropped by scope: {reason}"}

    start = args.get("start")
    end = args.get("end")
    line_from = args.get("line_from")
    line_to = args.get("line_to")

    if line_from is not None or line_to is not None:
        lines = art.content.splitlines()
        lo = max(1, int(line_from or 1))
        hi = min(len(lines), int(line_to or lo))
        span = "\n".join(lines[lo - 1 : hi])
        return {
            "ok": True,
            "result": {"name": art.name, "lines": f"L{lo}-L{hi}", "content": span},
            "provenance": _provenance(art, {"lines": f"L{lo}-L{hi}"}),
        }

    if start is not None or end is not None:
        lo = max(0, int(start or 0))
        hi = min(len(art.content), int(end or lo + MAX_SPAN_CHARS))
        if hi - lo > MAX_SPAN_CHARS:
            hi = lo + MAX_SPAN_CHARS
        return {
            "ok": True,
            "result": {"name": art.name, "span": f"{lo}-{hi}", "content": art.content[lo:hi]},
            "provenance": _provenance(art, {"span": f"{lo}-{hi}"}),
        }

    # the whole original, capped honestly
    content = art.content
    truncated = len(content) > MAX_SPAN_CHARS
    if truncated:
        content = content[:MAX_SPAN_CHARS]
    return {
        "ok": True,
        "result": {
            "name": art.name,
            "mime": art.mime,
            "content": content,
            "truncated": truncated,
            "detail": "ask for a line range or span for the rest" if truncated else "complete",
        },
        "provenance": _provenance(art, {"truncated": truncated}),
    }


def _artifact_carry(pseudo, scope: dict) -> tuple:
    from .scope import carry

    return carry(pseudo, scope)  # type: ignore[arg-type]


def citation_for(node) -> str:
    """the receipt for a node: the original's pointer when there is one."""
    if node.artifact_id and node.pointer:
        return f"{node.artifact_id}@{node.pointer}"
    if node.pointer:
        return str(node.pointer)
    return f"memory:{node.id}"


def tool_search_memory(store: Store, scope: dict, args: dict) -> dict:
    query = args.get("query")
    if not query:
        return {"ok": False, "error": "search_memory needs query"}
    limit = int(args.get("limit") or 8)
    candidates = store.list_nodes(persona_id=scope.get("persona_id"))
    kept, dropped = filter_nodes(candidates, scope)
    scored, mode = store.search_fused(query, kept, limit=limit)
    return {
        "ok": True,
        "result": [
            {
                "node_id": n.id,
                "type": n.type,
                "text": n.text,
                "citation": citation_for(n),
                "score": round(s, 4),
            }
            for n, s in scored
        ],
        "citations": [citation_for(n) for n, _ in scored],
        "retrieval": mode,
        "provenance": {"dropped": dropped},
    }


def tool_list_artifacts(store: Store, scope: dict, args: dict) -> dict:
    arts = store.list_artifacts(persona_id=scope.get("persona_id"))
    out = []
    for art in arts:
        ok, _reason = _artifact_carry(
            type(
                "ScopedArtifact",
                (),
                {
                    "persona_id": art.persona_id or "shared",
                    "connection_id": art.connection_id,
                    "platform": art.platform,
                    "sensitivity": "normal",
                },
            )(),
            scope,
        )
        if ok:
            out.append({"id": art.id, "name": art.name, "mime": art.mime, "tags": art.tags})
    return {"ok": True, "result": out, "provenance": {"count": len(out)}}


def tool_find_in_artifact(store: Store, scope: dict, args: dict) -> dict:
    """search inside one original file, return exact line hits, verbatim."""
    aid = args.get("artifact_id")
    needle = args.get("query")
    if not aid or not needle:
        return {"ok": False, "error": "find_in_artifact needs artifact_id and query"}
    art = store.get_artifact(aid)
    if not art:
        return {"ok": False, "error": f"no artifact {aid}"}
    pattern = re.compile(re.escape(needle), re.IGNORECASE)
    hits = []
    for idx, line in enumerate(art.content.splitlines(), start=1):
        if pattern.search(line):
            hits.append({"line": f"L{idx}", "text": line.strip()})
            if len(hits) >= 20:
                break
    return {
        "ok": True,
        "result": hits,
        "provenance": _provenance(art, {"hits": len(hits)}),
    }


TOOL_SPECS: Dict[str, dict] = {
    "search_memory": {
        "description": "search the speaker's memory for facts, preferences, events. returns cited nodes.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "what to look for"},
                "limit": {"type": "integer", "description": "max hits, default 8"},
            },
            "required": ["query"],
        },
    },
    "get_artifact": {
        "description": "return the ORIGINAL file verbatim, whole or an exact line or character span.",
        "parameters": {
            "type": "object",
            "properties": {
                "artifact_id": {"type": "string"},
                "line_from": {"type": "integer"},
                "line_to": {"type": "integer"},
                "start": {"type": "integer"},
                "end": {"type": "integer"},
            },
            "required": ["artifact_id"],
        },
    },
    "find_in_artifact": {
        "description": "find an exact phrase inside one original file. returns lines with citations.",
        "parameters": {
            "type": "object",
            "properties": {
                "artifact_id": {"type": "string"},
                "phrase": {"type": "string"},
            },
            "required": ["artifact_id", "phrase"],
        },
    },
    "list_artifacts": {
        "description": "list the original files this scope can open.",
        "parameters": {"type": "object", "properties": {}},
    },
}

TOOLS: Dict[str, Callable[[Store, dict, dict], dict]] = {
    "get_artifact": tool_get_artifact,
    "search_memory": tool_search_memory,
    "list_artifacts": tool_list_artifacts,
    "find_in_artifact": tool_find_in_artifact,
}


def call_tool(store: Store, scope: dict, name: str, args: Optional[dict] = None) -> dict:
    fn = TOOLS.get(name)
    if not fn:
        return {
            "ok": False,
            "error": f"unknown tool {name!r}. the registry is {sorted(TOOLS)}. nothing is improvised.",
        }
    return fn(store, scope, args or {})


def tool_catalog() -> List[dict]:
    return [
        {
            "name": "get_artifact",
            "what": "the ORIGINAL file verbatim, whole or an exact span (line range or char range).",
            "args": ["artifact_id", "line_from?", "line_to?", "start?", "end?"],
        },
        {
            "name": "search_memory",
            "what": "typed nodes scoped to this session, with scores.",
            "args": ["query", "limit?"],
        },
        {
            "name": "list_artifacts",
            "what": "original files this session may read.",
            "args": [],
        },
        {
            "name": "find_in_artifact",
            "what": "exact line hits inside one original file.",
            "args": ["artifact_id", "query"],
        },
    ]
