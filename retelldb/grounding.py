"""grounding: what the agent knows before it opens its mouth.

the pre-call scan: given a scope and a question (or a meeting title and
its docs), return a short brief with a citation on every line. the
brief is pointers, not the file: a citation names the transcript time
or the artifact and line so the agent can say "at 0:01:05 they said"
and the mid-call tool can fetch the original when someone asks for the
file itself.

honest lanes: the lexical lane works with zero services. the vector
lane is a closed contract until an embedder key exists; when it is
closed the brief says "lexical", never "semantic".
"""

from __future__ import annotations

from typing import List, Optional

from .scope import filter_nodes
from .store import Node, Store, tokens


def citation_for(node: Node) -> str:
    """a pointer a human can follow: transcript time, doc line, or node id."""
    if node.artifact_id and node.pointer:
        return f"{node.artifact_id}@{node.pointer}"
    if node.pointer:
        return node.pointer
    return node.id


def _line(node: Node) -> str:
    head = f"[{node.type}] {node.text.strip()}"
    if len(head) > 240:
        head = head[:237] + "..."
    return head


def build_brief(
    store: Store,
    scope: dict,
    query: str,
    limit: int = 8,
) -> dict:
    """the brief: kept lines with citations, the artifacts they point at, dropped receipts."""
    if not query or not query.strip():
        return {
            "enabled": True,
            "retrieval": "none",
            "brief": [],
            "artifacts": [],
            "dropped": [],
            "detail": "no query: nothing to ground. a meeting with no question gets no brief.",
        }

    persona_id = scope.get("persona_id")
    candidates = store.list_nodes(persona_id=persona_id)
    kept, dropped = filter_nodes(candidates, scope)
    scored = store.search(query, kept, limit=limit)

    lines = []
    artifact_ids = []
    for node, score in scored:
        lines.append(
            {
                "line": _line(node),
                "citation": citation_for(node),
                "score": round(score, 4),
                "node_id": node.id,
            }
        )
        if node.artifact_id and node.artifact_id not in artifact_ids:
            artifact_ids.append(node.artifact_id)

    artifacts = []
    for aid in artifact_ids:
        art = store.get_artifact(aid)
        if art:
            artifacts.append(
                {
                    "id": art.id,
                    "name": art.name,
                    "mime": art.mime,
                    "tool": f'get_artifact artifact_id="{art.id}"',
                }
            )

    return {
        "enabled": True,
        "retrieval": "lexical",
        "brief": lines,
        "artifacts": artifacts,
        "dropped": dropped,
        "detail": (
            "lexical lane: deterministic token match. the embedder lane is closed "
            "in this deployment, so this is not claimed as semantic."
        ),
    }


def meet_brief_lines(brief: dict, max_chars: int = 1200) -> Optional[str]:
    """the compact prompt line a live agent can carry into a call."""
    lines = brief.get("brief") or []
    if not lines:
        return None
    out: List[str] = []
    used = 0
    for item in lines:
        piece = f"- {item['line']} ({item['citation']})"
        if used + len(piece) > max_chars:
            break
        out.append(piece)
        used += len(piece)
    return "\n".join(out) if out else None
