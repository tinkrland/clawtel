"""retelldb tests. run: python3 retelldb/test_service.py

stdlib only, no services, no network. every test states the honest
behavior it locks in: idempotent ingestion, fail-closed scope, briefs
with citations, and tools that return the ORIGINAL file.
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from retelldb.store import Store, stable_id
from retelldb.scope import carry, filter_nodes, platform_class
from retelldb.grounding import build_brief, meet_brief_lines
from retelldb.tools import call_tool, tool_catalog

PASSED = 0


def ok(condition, message):
    global PASSED
    if not condition:
        raise AssertionError(message)
    PASSED += 1
    print(f"PASS {message}")


def make_store() -> Store:
    return Store(None)


def main() -> None:
    # --- store: deterministic ids + idempotent upsert ---
    s = make_store()
    node, created = s.upsert_node("host", "fact", "pricing", "tiers start at nine dollars")
    ok(created, "first ingest creates a node")
    same, created2 = s.upsert_node("host", "fact", "pricing", "tiers start at nine dollars a month")
    ok(not created2 and same.id == node.id, "re-ingesting the same key upserts in place")
    ok("nine dollars a month" in s.get_node(node.id).text, "the edit wins")

    # --- artifacts: the original material, verbatim ---
    doc = "\n".join(
        [
            "# office hours charter",
            "week one: pricing review",
            "week two: onboarding walkthrough",
            "the refund window is fourteen days",
        ]
    )
    art, art_created = s.put_artifact("charter.md", doc, persona_id="host", platform="zoom")
    ok(art_created, "artifact stored")
    art2, art_created2 = s.put_artifact("charter.md", doc, persona_id="host", platform="zoom")
    ok(not art_created2 and art2.id == art.id, "artifact ids are content stable")

    # --- scope: fail-closed gates ---
    ok(platform_class("zoom") == "meeting", "zoom is a meeting surface")
    ok(platform_class("twitch") == "public_social", "twitch is public social")
    ok(platform_class("nonsense") == "unknown", "unknown platforms stay unknown")

    anchored = s.upsert_node(
        "host", "relationship", "dana", "dana owns the contract", connection_id="dana"
    )[0]
    shared_fact = s.upsert_node("shared", "fact", "hours", "office hours are tuesdays")[0]
    private_note = s.upsert_node(
        "host", "preference", "rate", "dana prefers no per-minute billing",
        connection_id="dana", sensitivity="private", platform="email",
    )[0]
    stream_note = s.upsert_node(
        "host", "event", "stream", "the livestream is on twitch", platform="livestream"
    )[0]

    kept, dropped = filter_nodes(
        [anchored, shared_fact, private_note, stream_note],
        {"persona_id": "host", "platform": "zoom", "connection_id": "dana"},
    )
    ids = {n.id for n in kept}
    ok(anchored.id in ids, "anchored node rides into the matching anchored meeting")
    ok(shared_fact.id in ids, "shared facts always ride")
    ok(private_note.id not in ids, "a private email note does not ride into a meeting")
    ok(stream_note.id not in ids, "public social material does not ride into a meeting")

    kept2, dropped2 = filter_nodes(
        [anchored], {"persona_id": "host", "platform": "zoom", "connection_id": None}
    )
    ok(not kept2 and dropped2[0]["reason"] == "anchored_node_in_unanchored_session",
       "anchored nodes stay home in unanchored sessions")

    kept3, dropped3 = filter_nodes([shared_fact], {"persona_id": "host", "platform": None})
    ok(not kept3 and dropped3[0]["reason"] == "unknown_surface",
       "an undeclared surface reads as nothing")

    other = s.upsert_node("guest", "fact", "secret", "guest's private numbers")[0]
    kept4, _ = filter_nodes([other], {"persona_id": "host", "platform": "zoom"})
    ok(not kept4, "another persona's node never leaks")

    # --- grounding: the pre-call brief with citations ---
    s.upsert_node(
        "host", "fact", "refunds", "the refund window is fourteen days",
        artifact_id=art.id, pointer="L4", platform="zoom",
    )
    brief = build_brief(
        s, {"persona_id": "host", "platform": "zoom", "connection_id": "dana"},
        "what is the refund window",
    )
    ok(brief["enabled"] and brief["retrieval"] == "lexical", "the lexical lane is named honestly")
    ok(len(brief["brief"]) >= 1, "the brief has lines")
    top = brief["brief"][0]
    ok("fourteen days" in top["line"], "the right fact grounds the question")
    ok(top["citation"].endswith("@L4"), "the citation points at the original file line")
    ok(any(a["id"] == art.id for a in brief["artifacts"]), "the artifact is offered as a tool pointer")
    prompt = meet_brief_lines(brief)
    ok(prompt and "fourteen days" in prompt, "a compact prompt line exists for a live agent")

    empty = build_brief(s, {"persona_id": "host", "platform": "zoom"}, "")
    ok(empty["brief"] == [] and empty["retrieval"] == "none", "an empty question gets no brief")

    # --- tools: the ORIGINAL file, verbatim ---
    whole = call_tool(s, {"persona_id": "host", "platform": "zoom"}, "get_artifact",
                      {"artifact_id": art.id})
    ok(whole["ok"] and "the refund window is fourteen days" in whole["result"]["content"],
       "get_artifact returns the original, verbatim")
    span = call_tool(s, {"persona_id": "host", "platform": "zoom"}, "get_artifact",
                     {"artifact_id": art.id, "line_from": 3, "line_to": 4})
    ok(span["ok"] and span["result"]["content"].splitlines()[0].startswith("week two"),
       "a line span returns exactly those original lines")

    hits = call_tool(s, {"persona_id": "host", "platform": "zoom"}, "find_in_artifact",
                     {"artifact_id": art.id, "query": "refund"})
    ok(hits["ok"] and hits["result"][0]["line"] == "L4", "find_in_artifact returns the exact line")

    unknown = call_tool(s, {"persona_id": "host", "platform": "zoom"}, "delete_everything", {})
    ok(not unknown["ok"] and "registry" in unknown["error"],
       "an unknown tool is refused and lists the registry")

    catalog = tool_catalog()
    ok({"get_artifact", "search_memory", "list_artifacts", "find_in_artifact"} ==
       {t["name"] for t in catalog}, "the catalog is the registry")

    # a private note stays out of a public stream session's tools too
    s.put_artifact("rates.md", "dana pays 4000 a month", persona_id="host",
                   connection_id="dana", platform="email")
    priv_art = [a for a in s.list_artifacts("host") if a.name == "rates.md"][0]
    got = call_tool(s, {"persona_id": "host", "platform": "livestream"}, "get_artifact",
                    {"artifact_id": priv_art.id})
    ok(not got["ok"], "an anchored artifact does not open in an unanchored stream session")

    # --- persistence: a json file round trip ---
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "mem.json")
        s2 = Store(path)
        s2.upsert_node("host", "fact", "persisted", "this survives a restart")
        s3 = Store(path)
        ok(any("survives a restart" in n.text for n in s3.list_nodes("host")),
           "the json store survives a reload")

    print(f"\nRETELLDB TESTS OK ({PASSED} passes)")


if __name__ == "__main__":
    main()
