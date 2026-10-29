"""the llm lane: an openai-compatible chat client, env-gated, closed by
default. covers every provider that speaks /chat/completions: tensormux
(glm), featherless, openai, together, ollama, vllm. the lane reports closed
when no base url and key resolve, and the agent says so instead of
inventing an answer."""

import json
import os
import urllib.error
import urllib.request


def _env(name, default=None):
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def resolve_providers():
    """the ladder: custom, then every known key set. a dead rail is
    walked past at call time, not trusted because it exists."""
    out = []
    base = _env("RETELLDB_LLM_BASE_URL")
    key = _env("RETELLDB_LLM_API_KEY")
    model = _env("RETELLDB_LLM_MODEL")
    if base and key:
        out.append({"base_url": base.rstrip("/"), "key": key, "model": model or "glm-4-7-flash", "name": "custom"})
    if _env("TENSORMUX_TOKEN"):
        out.append({
            "base_url": "https://api.tensormux.com/v1",
            "key": _env("TENSORMUX_TOKEN"),
            "model": model or "glm-4-7-flash",
            "name": "tensormux",
        })
    # featherless: more than one key may exist and only some carry an
    # active subscription, so the lane holds every candidate key and
    # walks to the next one when a key is refused. the default model is
    # ungated: llama and friends are gated per organization until HF is
    # connected, qwen is not.
    featherless_keys = [k for k in (_env("FEATHERLESS_API_KEY_2"), _env("FEATHERLESS_API_KEY")) if k]
    if featherless_keys:
        out.append({
            "base_url": "https://api.featherless.ai/v1",
            "key": featherless_keys[0],
            "keys": featherless_keys,
            "model": model or "Qwen/Qwen2.5-72B-Instruct",
            "name": "featherless",
        })
    # backboard: a memory platform with its own thread/run protocol. the
    # transport differs (a thread message, then run-scoped tool outputs),
    # so the rung carries a style marker and the client dispatches on it.
    if _env("BACKBOARD_TOKEN"):
        out.append({
            "base_url": "https://app.backboard.io/api",
            "key": _env("BACKBOARD_TOKEN"),
            "model": model or "gpt-4o-mini",
            "name": "backboard",
            "style": "backboard",
        })
    if _env("OPENAI_API_KEY"):
        out.append({
            "base_url": _env("OPENAI_BASE_URL") or "https://api.openai.com/v1",
            "key": _env("OPENAI_API_KEY"),
            "model": model or "gpt-4.1-mini",
            "name": "openai",
        })
    pin = _env("RETELLDB_LLM_PROVIDER")
    if pin:
        pinned = [p for p in out if p["name"] == pin]
        # an unknown pin must not silently fall through to another rail
        return pinned
    return out


def resolve_provider():
    """the first rung, for status and for callers that want one."""
    ladder = resolve_providers()
    return ladder[0] if ladder else None


class LlmClient:
    """thin /chat/completions client with native tool support."""

    def __init__(self, provider="auto"):
        # "auto" resolves the ladder from the environment; an explicit
        # None (or a provider dict) is exactly what the caller asked
        # for. a closed lane must be possible to ask for on purpose.
        if provider == "auto":
            self.providers = resolve_providers()
            self.provider = self.providers[0] if self.providers else None
        elif isinstance(provider, list):
            self.providers = provider
            self.provider = provider[0] if provider else None
        else:
            self.providers = [provider] if provider else []
            self.provider = provider

    @property
    def available(self):
        return self.provider is not None

    @property
    def label(self):
        if not self.provider:
            return "closed"
        return self.provider["name"] + ":" + self.provider["model"]

    def chat(self, messages, tools=None, max_tokens=700, temperature=0.2):
        if self.provider and self.provider.get("style") == "backboard":
            return self._chat_backboard(messages, tools)
        if not self.provider:
            raise RuntimeError(
                "the llm lane is closed: no provider key resolved (RETELLDB_LLM_BASE_URL+API_KEY, "
                "TENSORMUX_TOKEN, FEATHERLESS_API_KEY or OPENAI_API_KEY)"
            )
        payload = {
            "model": self.provider["model"],
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        headers = {
            "content-type": "application/json",
            # several providers sit behind a cloudflare wall that 403s
            # tool-shaped default agents, so the lane identifies itself
            "user-agent": "Mozilla/5.0 (compatible; clawtel-retelldb/1.0)",
        }
        body = None
        last_err = None
        served_by = None
        for provider in (self.providers or [self.provider]):
            payload["model"] = provider["model"]
            for candidate in provider.get("keys") or [provider["key"]]:
                headers["authorization"] = "Bearer " + candidate
                req = urllib.request.Request(
                    provider["base_url"] + "/chat/completions",
                    data=json.dumps(payload).encode(),
                    headers=headers,
                )
                try:
                    with urllib.request.urlopen(req, timeout=90) as res:
                        body = json.loads(res.read().decode())
                    provider["key"] = candidate
                    served_by = provider
                    break
                except urllib.error.HTTPError as err:
                    # 401/402/403: this rung cannot serve (no
                    # subscription, spent credits, rejected key). walk
                    # to the next key, then the next provider.
                    if err.code in (401, 402, 403, 404):
                        last_err = err
                        continue
                    note_llm_call(False, f"{type(err).__name__}: {err}")
                    raise
            if body is not None:
                break
        if served_by is not None:
            self.provider = served_by
            # status names the rung that actually served, not the first
            # one that merely has keys
            LLM_HEALTH["served_by"] = served_by["name"] + ":" + served_by["model"]
        if body is None and self.provider is not None and last_err is None:
            pass
        if body is None:
            note_llm_call(False, f"{type(last_err).__name__ if last_err else 'RuntimeError'}: {last_err or 'no key could serve'}")
            raise last_err or RuntimeError("no provider key could serve")
        note_llm_call(True)
        choice = (body.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        return {
            "content": message.get("content") or "",
            "tool_calls": message.get("tool_calls") or [],
            "finish": choice.get("finish_reason"),
        }


    # --- backboard: threads, runs, and run-scoped tool outputs ---------
    #
    # backboard is not a bare completions url. a call is a message on a
    # thread; when the model wants a tool the message answers with
    # status REQUIRES_ACTION and a run_id, and the way to hand results
    # back is that run's submit endpoint. the system turn rides inside
    # the first message (the api takes content, not a role array), and
    # the thread is reused across a run so the model keeps its own
    # context between tool rounds.

    def _chat_backboard(self, messages, tools=None):
        provider = self.provider
        state = getattr(self, "_bb", None) or {}
        self._bb = state
        headers = {
            "content-type": "application/json",
            "x-api-key": provider["key"],
            # cloudflare in front of the api refuses bare clients
            "user-agent": "Mozilla/5.0 (compatible; clawtel-retelldb/1.0)",
        }

        def post(path, payload):
            req = urllib.request.Request(
                provider["base_url"] + path,
                data=json.dumps(payload).encode(),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.loads(res.read().decode())

        try:
            if state.get("thread_id") and state.get("run_id"):
                # a tool round: hand the run its outputs, nothing else
                outputs = _backboard_tool_outputs(messages)
                if not outputs:
                    raise RuntimeError("a backboard follow-up needs tool outputs; none in the transcript")
                body = post(
                    f"/threads/{state['thread_id']}/runs/{state['run_id']}/submit-tool-outputs",
                    {"tool_outputs": outputs},
                )
            else:
                system = "\n".join(m["content"] for m in messages if m.get("role") == "system" and m.get("content"))
                user = "\n".join(m["content"] for m in messages if m.get("role") == "user" and m.get("content"))
                content = (system + "\n\n" + user).strip() if system else user
                payload = {"content": content, "model_name": provider["model"]}
                if tools:
                    payload["tools"] = tools
                    payload["tool_choice"] = "auto"
                body = post("/threads/messages", payload)
        except Exception as err:
            note_llm_call(False, f"{type(err).__name__}: {err}")
            raise

        note_llm_call(True)
        LLM_HEALTH["served_by"] = provider["name"] + ":" + provider["model"]
        state["thread_id"] = body.get("thread_id") or state.get("thread_id")
        state["run_id"] = body.get("run_id")
        status = body.get("status")
        # backboard echoes the run's tool calls on the completed reply too.
        # a call is only actionable while the run is waiting on us, so a
        # completed turn reports none, or the agent would re-run the same
        # tool forever.
        calls = (body.get("tool_calls") or []) if status == "REQUIRES_ACTION" else []
        return {
            "content": body.get("content") or "",
            "tool_calls": calls,
            "finish": status,
        }


def _backboard_tool_outputs(messages):
    """the tool results the agent appended since the last assistant turn,
    in the shape the run submit endpoint takes."""
    calls = {}
    out = []
    for m in messages:
        if m.get("role") == "assistant" and m.get("tool_calls"):
            for tc in m["tool_calls"]:
                fn = (tc.get("function") or {})
                calls[tc.get("id")] = fn.get("name") or ""
        elif m.get("role") == "tool" and m.get("tool_call_id"):
            out.append({"tool_call_id": m["tool_call_id"], "output": m.get("content") or ""})
    return [o for o in out if o["tool_call_id"] in calls]


LLM_HEALTH = {"calls": 0, "ok_calls": 0, "last_error": None, "served_by": None}


def note_llm_call(ok: bool, error: str = "") -> None:
    """a configured provider is not a paid one. every call leaves a receipt."""
    LLM_HEALTH["calls"] += 1
    if ok:
        LLM_HEALTH["ok_calls"] += 1
        LLM_HEALTH["last_error"] = None
    else:
        LLM_HEALTH["last_error"] = error or "the llm call failed"


def llm_status():
    client = LlmClient()
    healthy = None if LLM_HEALTH["calls"] == 0 else LLM_HEALTH["last_error"] is None
    return {
        "available": client.available,
        "configured": client.available,
        "healthy": healthy,
        "calls": LLM_HEALTH["calls"],
        # the rung that actually served wins; the first rung is named
        # separately so a pinned or failed-over ladder reads honestly
        "provider": LLM_HEALTH["served_by"] or client.label,
        "first_rung": client.label,
        "last_error": LLM_HEALTH["last_error"],
        "reason": None if client.available else "no llm provider: set RETELLDB_LLM_BASE_URL and RETELLDB_LLM_API_KEY, or a known provider key",
    }
