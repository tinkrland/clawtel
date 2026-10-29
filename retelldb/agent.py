"""the tool-calling agent: the mid-call brain. it reads a question, decides
which memory tools to call, executes them for real, and answers only from
what came back, with receipts.

honesty rules, enforced in the prompt and in the shape of the result:
- every factual claim carries the citation of the tool result it came from;
- no tool result, no claim: the answer says nothing in memory says so;
- the tool log ships with the answer, so the owner can audit every step;
- a closed llm lane or a step budget spent returns an honest refusal,
  never a fallback answer invented locally.
"""

import json

from .grounding import build_brief
from .llm import LlmClient
from .store import Store
from .tools import TOOL_SPECS, call_tool

SYSTEM_PROMPT = """you are the memory voice of a live meeting agent. answer only from memory tool results.

rules:
- before any factual claim about the speaker, their people, plans or numbers, call a tool.
- cite every claim: use the citation the tool returned (for example artifact@0:01:05 or L14). a claim without a citation is not allowed.
- if the tools return nothing relevant, say plainly that nothing in memory says that, and do not guess.
- keep it short and spoken-friendly: one to three sentences.
- when a general rule and a specific exception both appear, the exception
  governs the specific case: say which applies instead of hedging between
  both, and cite the deciding fact.
- do not print ids, hashes or pointers in the prose (no L14, no
  artifact@...): the citations list carries them, and the spoken line
  should not. the tool returns them; you do not speak them.
- never invent names, numbers, prices, dates or promises."""

JSON_PROTOCOL_NOTE = """

this provider may not support native tool calls. respond with ONE json object per turn, no prose:
- to call a tool: {"tool": "<name>", "args": {...}}
- to answer: {"answer": "<text>", "citations": ["<citation>", ...]}"""


def tool_declarations():
    """native tool declarations, built from the registry itself."""
    decls = []
    for name, spec in TOOL_SPECS.items():
        decls.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": spec.get("description", ""),
                    "parameters": spec.get(
                        "parameters", {"type": "object", "properties": {}}
                    ),
                },
            }
        )
    return decls


def _receipts(result):
    out = []
    if isinstance(result, dict):
        for line in result.get("citations") or []:
            if line and line not in out:
                out.append(line)
        for hit in result.get("nodes") or []:
            c = hit.get("citation") if isinstance(hit, dict) else None
            if c and c not in out:
                out.append(c)
        for hit in result.get("hits") or []:
            c = hit.get("citation") if isinstance(hit, dict) else None
            if c and c not in out:
                out.append(c)
    return out


def _parse_json_turn(text):
    """the fallback protocol: one json object, tool call or answer."""
    text = (text or "").strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        obj = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    if obj.get("tool"):
        return {"kind": "tool", "name": obj["tool"], "args": obj.get("args") or {}}
    if "answer" in obj:
        return {
            "kind": "answer",
            "text": str(obj.get("answer") or ""),
            "citations": [c for c in (obj.get("citations") or []) if isinstance(c, str)],
        }
    return None


def answer_question(
    question,
    scope,
    store: Store,
    *,
    llm=None,
    embedder=None,
    max_steps=4,
    protocol="auto",
):
    """run the tool loop. returns the answer plus the full audit trail."""
    if not (question or "").strip():
        return {"ok": False, "error": "a question is required"}
    client = llm or LlmClient()
    if not client.available:
        return {
            "ok": False,
            "error": "the llm lane is closed: no provider key resolved, nothing is answered",
            "provider": "closed",
        }

    use_json = protocol == "json"
    system = SYSTEM_PROMPT + (JSON_PROTOCOL_NOTE if use_json else "")
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ]
    tool_log = []
    citations = []
    steps = 0

    for step in range(max_steps):
        steps = step + 1
        tools = None if use_json else tool_declarations()
        try:
            turn = client.chat(messages, tools=tools)
        except Exception as err:
            return {
                "ok": False,
                "error": "the llm provider failed: " + str(err),
                "tool_calls": tool_log,
                "provider": client.label,
            }

        content = turn.get("content") or ""
        native_calls = turn.get("tool_calls") or []

        if native_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": native_calls,
                }
            )
            for call in native_calls:
                fn = (call.get("function") or {})
                name = fn.get("name") or ""
                raw_args = fn.get("arguments") or "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else (raw_args or {})
                except json.JSONDecodeError:
                    args = None
                if args is None:
                    result = {"ok": False, "error": "the model sent unparseable arguments"}
                else:
                    result = call_tool(store, scope, name, args)
                tool_log.append({"tool": name, "args": args, "ok": bool(result.get("ok"))})
                citations.extend(_receipts(result))
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id") or name,
                        "content": json.dumps(result)[:6000],
                    }
                )
            continue

        parsed = _parse_json_turn(content) if use_json else None
        if use_json and parsed and parsed["kind"] == "tool":
            name, args = parsed["name"], parsed["args"]
            result = call_tool(store, scope, name, args)
            tool_log.append({"tool": name, "args": args, "ok": bool(result.get("ok"))})
            citations.extend(_receipts(result))
            messages.append({"role": "assistant", "content": content})
            messages.append(
                {
                    "role": "user",
                    "content": "tool result: " + json.dumps(result)[:6000] + "\nnow answer or call another tool.",
                }
            )
            continue

        if use_json and parsed and parsed["kind"] == "answer":
            for c in parsed["citations"]:
                if c not in citations:
                    citations.append(c)
            return {
                "ok": True,
                "answer": parsed["text"],
                "citations": citations,
                "tool_calls": tool_log,
                "steps": steps,
                "provider": client.label,
                "protocol": "json",
            }

        # a plain answer turn, native protocol
        return {
            "ok": True,
            "answer": content.strip(),
            "citations": citations,
            "tool_calls": tool_log,
            "steps": steps,
            "provider": client.label,
            "protocol": "native" if not use_json else "json",
        }

    return {
        "ok": False,
        "error": "the step budget ran out before an answer. the tool log shows what was tried.",
        "tool_calls": tool_log,
        "provider": client.label,
    }
