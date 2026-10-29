"""scope: who a memory node may be served to. fail-closed, always.

the rule this file enforces, in one line: a query gets a node only if
every gate passes; the first gate that fails drops it with a reason,
and an undeclared surface never reads as "unanchored". a dropped node
is not an error: it is the honest answer.

ported shape, clawtel's own words: platform classes first, then
persona isolation, then anchor matching, then the meeting wall, then
sensitivity.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

from .store import Node

# the platform classes. a class decides which walls exist, not which
# nodes are interesting.
PRIVATE_PLATFORMS = {"email", "slack", "whatsapp", "imessage", "telegram", "phone", "discord"}
MEETING_PLATFORMS = {"zoom", "meet", "teams", "whatsapp_call"}
PUBLIC_SOCIAL_PLATFORMS = {"livestream", "twitch", "kick", "youtube"}
WEBSITE_PLATFORMS = {"link_share", "website"}


def platform_class(platform: Optional[str]) -> str:
    if not platform:
        return "unknown"
    if platform in PRIVATE_PLATFORMS:
        return "private"
    if platform in MEETING_PLATFORMS:
        return "meeting"
    if platform in PUBLIC_SOCIAL_PLATFORMS:
        return "public_social"
    if platform in WEBSITE_PLATFORMS:
        return "website"
    return "unknown"


def carry(node: Node, scope: dict) -> Tuple[bool, Optional[str]]:
    """one node against one scope. (kept, drop_reason)."""
    platform = scope.get("platform")
    persona_id = scope.get("persona_id")
    connection_id = scope.get("connection_id")

    klass = platform_class(platform)
    if klass == "unknown":
        # an undeclared surface must not read as unanchored: it reads as nothing
        return False, "unknown_surface"

    # persona isolation: another persona's node never leaks, shared does
    if node.persona_id != persona_id and node.persona_id != "shared":
        return False, "other_persona"

    # anchored memory in an unanchored session stays home
    if node.connection_id and not connection_id:
        return False, "anchored_node_in_unanchored_session"

    # a session anchored to someone else does not get this person's nodes
    if node.connection_id and connection_id and node.connection_id != connection_id:
        return False, "connection_mismatch"

    # the meeting wall: public social material does not ride into a
    # private call, and vice versa meetings do not read public feeds
    node_class = platform_class(node.platform)
    if klass == "meeting" and node_class == "public_social":
        return False, "public_social_into_meeting"
    if klass == "public_social" and node_class == "meeting":
        return False, "meeting_into_public_social"

    # sensitivity: private nodes only on private surfaces, same person
    if node.sensitivity == "private":
        if klass != "private":
            return False, "private_node_on_non_private_surface"
        if node.connection_id and node.connection_id != connection_id:
            return False, "private_node_other_person"

    return True, None


def filter_nodes(nodes: List[Node], scope: dict) -> Tuple[List[Node], List[dict]]:
    """kept nodes, dropped receipts. receipts carry the id and the why."""
    kept: List[Node] = []
    dropped: List[dict] = []
    for node in nodes:
        ok, reason = carry(node, scope)
        if ok:
            kept.append(node)
        else:
            dropped.append({"id": node.id, "reason": reason})
    return kept, dropped
