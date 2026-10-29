"""the memory store: nodes, artifacts, and the rules that keep them.

two things live here, and the difference matters:

- node: a typed memory (fact, preference, relationship, event, skill,
  entity) with provenance. nodes are what grounding reads.
- artifact: the ORIGINAL material, verbatim: a doc, a transcript, a
  capture log. artifacts are what mid-call tools return when someone
  needs the file itself, not the brief's paraphrase.

deterministic ids mean re-ingesting the same material is idempotent
and an edited section upserts in place. stdlib only: json, hashlib.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional

NODE_TYPES = ("fact", "preference", "relationship", "event", "skill", "entity")


def stable_id(*parts: str) -> str:
    joined = "\x1f".join(parts)
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()[:16]


@dataclass
class Node:
    id: str
    persona_id: str
    type: str
    key: str
    text: str
    tags: List[str] = field(default_factory=list)
    # provenance: where this came from, so every answer can show its work
    platform: Optional[str] = None
    connection_id: Optional[str] = None
    sensitivity: str = "normal"  # normal | private
    artifact_id: Optional[str] = None
    pointer: Optional[str] = None  # e.g. "0:01:05" transcript time, "L12" line
    created_at: str = ""


@dataclass
class Artifact:
    id: str
    name: str
    content: str
    mime: str = "text/plain"
    persona_id: Optional[str] = None
    connection_id: Optional[str] = None
    platform: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    source_uri: Optional[str] = None
    ingested_at: str = ""


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def tokens(text: str) -> List[str]:
    return [t for t in re.split(r"[^a-z0-9']+", (text or "").lower()) if len(t) > 1]


class Store:
    """an in-memory store with optional json persistence."""

    def __init__(self, path: Optional[str] = None):
        self.path = path
        self.nodes: Dict[str, Node] = {}
        self.artifacts: Dict[str, Artifact] = {}
        if path and os.path.exists(path):
            self._load()

    # --- nodes ---

    def upsert_node(
        self,
        persona_id: str,
        type: str,
        key: str,
        text: str,
        **kwargs: Any,
    ) -> tuple[Node, bool]:
        """returns (node, created). deterministic id = idempotent re-ingest."""
        if type not in NODE_TYPES:
            raise ValueError(f"unknown node type {type}. one of {NODE_TYPES} or nothing.")
        nid = stable_id(persona_id, type, key)
        created = nid not in self.nodes
        existing = self.nodes.get(nid)
        node = Node(
            id=nid,
            persona_id=persona_id,
            type=type,
            key=key,
            text=text,
            tags=kwargs.get("tags", existing.tags if existing else []),
            platform=kwargs.get("platform", existing.platform if existing else None),
            connection_id=kwargs.get(
                "connection_id", existing.connection_id if existing else None
            ),
            sensitivity=kwargs.get(
                "sensitivity", existing.sensitivity if existing else "normal"
            ),
            artifact_id=kwargs.get(
                "artifact_id", existing.artifact_id if existing else None
            ),
            pointer=kwargs.get("pointer", existing.pointer if existing else None),
            created_at=existing.created_at if existing else _now(),
        )
        self.nodes[nid] = node
        self._persist()
        return node, created

    def get_node(self, node_id: str) -> Optional[Node]:
        return self.nodes.get(node_id)

    def list_nodes(self, persona_id: Optional[str] = None) -> List[Node]:
        vals = list(self.nodes.values())
        if persona_id:
            vals = [n for n in vals if n.persona_id == persona_id or n.persona_id == "shared"]
        return sorted(vals, key=lambda n: n.created_at)

    # --- artifacts: the ORIGINAL files, verbatim ---

    def put_artifact(
        self,
        name: str,
        content: str,
        **kwargs: Any,
    ) -> tuple[Artifact, bool]:
        aid = stable_id("artifact", name, content[:200])
        created = aid not in self.artifacts
        self.artifacts[aid] = Artifact(
            id=aid,
            name=name,
            content=content,
            mime=kwargs.get("mime", "text/plain"),
            persona_id=kwargs.get("persona_id"),
            connection_id=kwargs.get("connection_id"),
            platform=kwargs.get("platform"),
            tags=kwargs.get("tags", []),
            source_uri=kwargs.get("source_uri"),
            ingested_at=_now(),
        )
        self._persist()
        return self.artifacts[aid], created

    def get_artifact(self, artifact_id: str) -> Optional[Artifact]:
        return self.artifacts.get(artifact_id)

    def list_artifacts(self, persona_id: Optional[str] = None) -> List[Artifact]:
        vals = list(self.artifacts.values())
        if persona_id:
            vals = [
                a
                for a in vals
                if a.persona_id == persona_id or a.persona_id is None
            ]
        return sorted(vals, key=lambda a: a.ingested_at)

    # --- lexical retrieval: the lane that works with zero services ---

    def search(self, query: str, candidates: List[Node], limit: int = 8) -> List[tuple[Node, float]]:
        q = tokens(query)
        if not q:
            return []
        scored: List[tuple[Node, float]] = []
        for node in candidates:
            hay = tokens(node.text + " " + " ".join(node.tags) + " " + node.key)
            if not hay:
                continue
            hit = sum(1 for t in q if t in hay)
            if hit == 0:
                continue
            # coverage of the query plus a small bonus for tag matches:
            # deterministic, no services, no invented rank
            score = hit / len(q) + 0.1 * sum(1 for t in q if t in node.tags)
            scored.append((node, score))
        scored.sort(key=lambda pair: (-pair[1], pair[0].id))
        return scored[:limit]

    # --- persistence ---

    def _persist(self) -> None:
        if not self.path:
            return
        blob = {
            "nodes": [asdict(n) for n in self.nodes.values()],
            "artifacts": [asdict(a) for a in self.artifacts.values()],
        }
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(blob, fh, ensure_ascii=False)
        os.replace(tmp, self.path)

    def _load(self) -> None:
        with open(self.path, encoding="utf-8") as fh:
            blob = json.load(fh)
        for raw in blob.get("nodes", []):
            node = Node(**raw)
            self.nodes[node.id] = node
        for raw in blob.get("artifacts", []):
            art = Artifact(**raw)
            self.artifacts[art.id] = art
