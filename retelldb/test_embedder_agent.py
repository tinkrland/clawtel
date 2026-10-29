"""tests for the two new lanes: the embedder (providers + fusion) and the
tool-calling agent loop.

the provider doubles below speak real http on a loopback port, so the
clients under test are exercised for real (request shape, auth header,
response parsing). they are doubles for the PROVIDER, not for our code:
what is verified is that our client, fusion and loop work, not that a
particular vendor is reachable.

run: python3 retelldb/test_embedder_agent.py
"""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from retelldb.agent import answer_question, _parse_json_turn, tool_declarations
from retelldb.embedder import OpenAICompatEmbedder, cosine
from retelldb.llm import LlmClient
from retelldb.store import Store

PASSES = []


def check(name, cond, detail=""):
    if not cond:
        print(f"FAIL {name} {detail}")
        raise SystemExit(1)
    PASSES.append(name)
    print(f"PASS {name}")


def free_server(handler_cls):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler_cls)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def make_embed_handler():
    class EmbedHandler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            inputs = body.get("input") or []
            data = [
                {"index": i, "embedding": [float(len(t)), float(sum(map(ord, t)) % 97), 1.0]}
                for i, t in enumerate(inputs)
            ]
            payload = json.dumps({"data": data}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return EmbedHandler


def make_chat_handler(script):
    """script: list of responses served in order; each request pops one."""
    calls = {"n": 0, "bodies": []}

    class ChatHandler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            calls["bodies"].append(body)
            idx = min(calls["n"], len(script) - 1)
            calls["n"] += 1
            payload = json.dumps({"choices": [{"message": script[idx], "finish_reason": "stop"}]}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return ChatHandler, calls


# --- the embedder lane through real http ---------------------------------


def test_embedder_over_http():
    httpd, port = free_server(make_embed_handler())
    emb = OpenAICompatEmbedder(f"http://127.0.0.1:{port}", "test-key")  # no "/v1": client appends /embeddings
    vectors = emb.embed(["refund window", "office cats"])
    check("the openai-shaped embedder returns one vector per text", len(vectors) == 2 and len(vectors[0]) == 3)
    check("the vectors differ by content", vectors[0] != vectors[1])
    httpd.shutdown()


def test_fusion_and_the_honest_label():
    class FakeEmb:
        available = True

        def embed(self, texts):
            # 'refund' -> axis 0, everything else -> axis 1
            return [[1.0, 0.0] if "refund" in t else [0.0, 1.0] for t in texts]

    store = Store()
    store.upsert_node("p", "fact", "k1", "the refund window is fourteen days", embed_fn=FakeEmb().embed)
    store.upsert_node("p", "fact", "k2", "the office has two cats", embed_fn=FakeEmb().embed)

    check("a store without an embedder says lexical", store.retrieval_mode() == "lexical")
    loan, mode = store.search_fused("refund policy", store.list_nodes("p"))
    check("lexical retrieval alone still finds the fact", loan and loan[0][0].key == "k1", f"got {mode}")

    store.embedder = FakeEmb()
    pairs, mode = store.search_fused("refund policy", store.list_nodes("p"))
    check("an open embedder fuses", mode == "fused", f"got {mode}")
    check("fusion keeps the right node on top", pairs[0][0].key == "k1")


def test_cosine_edges():
    check("cosine of a zero vector is 0", cosine([0.0, 0.0], [1.0, 1.0]) == 0.0)
    check("cosine of mismatched dims is 0", cosine([1.0], [1.0, 2.0]) == 0.0)
    check("cosine of identical vectors is 1", abs(cosine([2.0, 0.0], [5.0, 0.0]) - 1.0) < 1e-9)


def test_chunks_embed_into_pointered_windows():
    class FakeEmb:
        available = True

        def embed(self, texts):
            return [[float(len(t)), 1.0] for t in texts]

    store = Store()
    content = "\n".join(f"line {i}" for i in range(1, 101))
    art, _ = store.put_artifact("big.txt", content, embed_fn=FakeEmb().embed)
    check("a 100-line artifact chunks into pointered windows", len(art.chunks) == 3 and art.chunks[1]["start_line"] == 31)
    check("every chunk carries a vector when the lane is open", all(c.get("embedding") for c in art.chunks))
    hits = store.search_chunks([3.0, 1.0], limit=3)
    check("chunk search returns original-file pointers", hits and hits[0][1].get("start_line"))


# --- the agent loop, native protocol, through real http -------------------


def seeded_store():
    store = Store()
    art, _ = store.put_artifact(
        "transcript-1.txt",
        "0:01:05 host: the refund window is fourteen days from purchase\n0:02:00 host: codes ship every friday",
        persona_id="host",
        platform="zoom",
    )
    store.upsert_node(
        "host",
        "fact",
        "refund-window",
        "the refund window is fourteen days from purchase",
        platform="zoom",
        artifact_id=art.id,
        pointer="0:01:05",
    )
    return store, art


def test_agent_native_protocol_live_http():
    store, art = seeded_store()
    script = [
        {
            "content": "",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "search_memory", "arguments": json.dumps({"query": "refund window"})},
                }
            ],
        },
        {"content": "fourteen days from purchase (artifact@0:01:05).", "tool_calls": []},
    ]
    handler, calls = make_chat_handler(script)
    httpd, port = free_server(handler)

    client = LlmClient({"base_url": f"http://127.0.0.1:{port}", "key": "k", "model": "test-model", "name": "double"})
    result = answer_question("what is the refund window?", {"persona_id": "host", "platform": "zoom"}, store, llm=client)

    check("the agent answers through a real http round trip", result["ok"] and "fourteen days" in result["answer"])
    check("the tool actually ran against the store", result["tool_calls"] and result["tool_calls"][0]["tool"] == "search_memory")
    check("the tool result is fed back to the model", any(m.get("role") == "tool" for m in calls["bodies"][1]["messages"]))
    check(
        "citations ride along from the tool receipt",
        any("0:01:05" in c for c in result["citations"]),
        f"got {result['citations']}",
    )
    check("the provider is named in the result", result["provider"] == "double:test-model")
    check("declarations were sent as native tools", bool(calls["bodies"][0].get("tools")))
    httpd.shutdown()


def test_agent_refuses_when_the_lane_is_closed():
    store, _ = seeded_store()
    closed = LlmClient(provider=None)
    result = answer_question("what is the refund window?", {"persona_id": "host", "platform": "zoom"}, store, llm=closed)
    check("a closed llm lane refuses, it never invents", result["ok"] is False and "closed" in result["error"])


def test_agent_step_budget_is_honest():
    store, _ = seeded_store()
    script = [
        {
            "content": "",
            "tool_calls": [
                {"id": "c", "type": "function", "function": {"name": "search_memory", "arguments": '{"query":"x"}'}}
            ],
        }
    ]
    handler, _ = make_chat_handler(script)
    httpd, port = free_server(handler)
    client = LlmClient({"base_url": f"http://127.0.0.1:{port}", "key": "k", "model": "m", "name": "double"})
    result = answer_question("q", {"persona_id": "host", "platform": "zoom"}, store, llm=client, max_steps=2)
    check("a spent step budget refuses with the tool log", result["ok"] is False and len(result["tool_calls"]) == 2)
    httpd.shutdown()


def test_agent_unknown_tool_is_refused_not_improvised():
    store, _ = seeded_store()
    script = [
        {
            "content": "",
            "tool_calls": [
                {"id": "c", "type": "function", "function": {"name": "delete_everything", "arguments": "{}"}}
            ],
        },
        {"content": "i could not check that.", "tool_calls": []},
    ]
    handler, calls = make_chat_handler(script)
    httpd, port = free_server(handler)
    client = LlmClient({"base_url": f"http://127.0.0.1:{port}", "key": "k", "model": "m", "name": "double"})
    result = answer_question("q", {"persona_id": "host", "platform": "zoom"}, store, llm=client)
    tool_body = [m for m in calls["bodies"][1]["messages"] if m.get("role") == "tool"][0]["content"]
    check("an unknown tool answers with the registry error", "unknown tool" in tool_body)
    check("the loop still ends with an answer", result["ok"])


def test_json_protocol_fallback():
    store, _ = seeded_store()
    script = [
        {"content": '{"tool": "search_memory", "args": {"query": "refund"}}', "tool_calls": []},
        {"content": '{"answer": "fourteen days (artifact@0:01:05).", "citations": ["artifact@0:01:05"]}', "tool_calls": []},
    ]
    handler, calls = make_chat_handler(script)
    httpd, port = free_server(handler)
    client = LlmClient({"base_url": f"http://127.0.0.1:{port}", "key": "k", "model": "m", "name": "double"})
    result = answer_question(
        "refund?", {"persona_id": "host", "platform": "zoom"}, store, llm=client, protocol="json"
    )
    check("the json protocol runs the tool and answers", result["ok"] and result["protocol"] == "json")
    check("the json protocol cites what it says", "artifact@0:01:05" in result["citations"])
    check("no native tools are sent in json mode", not calls["bodies"][0].get("tools"))
    httpd.shutdown()


def test_json_turn_parser_edges():
    check("a bare answer parses", _parse_json_turn('{"answer":"x","citations":[]}')["kind"] == "answer")
    check("prose around json still parses", _parse_json_turn('sure: {"tool":"search_memory","args":{}}')["kind"] == "tool")
    check("garbage is refused", _parse_json_turn("no json here") is None)
    check("an unknown shape is refused", _parse_json_turn('{"x": 1}') is None)


def test_declarations_match_the_registry():
    decls = tool_declarations()
    names = sorted(d["function"]["name"] for d in decls)
    check(
        "declarations cover every tool",
        names == ["find_in_artifact", "get_artifact", "list_artifacts", "search_memory"],
        f"got {names}",
    )
    check("every declaration carries parameters", all(d["function"].get("parameters") for d in decls))


if __name__ == "__main__":
    test_embedder_over_http()
    test_fusion_and_the_honest_label()
    test_cosine_edges()
    test_chunks_embed_into_pointered_windows()
    test_agent_native_protocol_live_http()
    test_agent_refuses_when_the_lane_is_closed()
    test_agent_step_budget_is_honest()
    test_agent_unknown_tool_is_refused_not_improvised()
    test_json_protocol_fallback()
    test_json_turn_parser_edges()
    test_declarations_match_the_registry()
    print(f"\nRETELLDB EMBEDDER + AGENT TESTS OK ({len(PASSES)} passes)")
