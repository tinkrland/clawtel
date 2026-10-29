"""the llm lane: an openai-compatible chat client, env-gated, closed by
default. covers every provider that speaks /chat/completions: tensormux
(glm), featherless, openai, together, ollama, vllm. the lane reports closed
when no base url and key resolve, and the agent says so instead of
inventing an answer."""

import json
import os
import urllib.request


def _env(name, default=None):
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


def resolve_provider():
    """explicit config wins; then known keys; then closed."""
    base = _env("RETELLDB_LLM_BASE_URL")
    key = _env("RETELLDB_LLM_API_KEY")
    model = _env("RETELLDB_LLM_MODEL")
    if base and key:
        return {"base_url": base.rstrip("/"), "key": key, "model": model or "glm-4-7-flash", "name": "custom"}
    if _env("TENSORMUX_TOKEN"):
        return {
            "base_url": "https://api.tensormux.com/v1",
            "key": _env("TENSORMUX_TOKEN"),
            "model": model or "glm-4-7-flash",
            "name": "tensormux",
        }
    if _env("FEATHERLESS_API_KEY"):
        return {
            "base_url": "https://api.featherless.ai/v1",
            "key": _env("FEATHERLESS_API_KEY"),
            "model": model or "meta-llama/Llama-3.3-70B-Instruct",
            "name": "featherless",
        }
    if _env("OPENAI_API_KEY"):
        return {
            "base_url": _env("OPENAI_BASE_URL") or "https://api.openai.com/v1",
            "key": _env("OPENAI_API_KEY"),
            "model": model or "gpt-4.1-mini",
            "name": "openai",
        }
    return None


class LlmClient:
    """thin /chat/completions client with native tool support."""

    def __init__(self, provider="auto"):
        # "auto" resolves from the environment; an explicit None (or a
        # provider dict) is exactly what the caller asked for. a closed
        # lane must be possible to ask for on purpose.
        self.provider = resolve_provider() if provider == "auto" else provider

    @property
    def available(self):
        return self.provider is not None

    @property
    def label(self):
        if not self.provider:
            return "closed"
        return self.provider["name"] + ":" + self.provider["model"]

    def chat(self, messages, tools=None, max_tokens=700, temperature=0.2):
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
        req = urllib.request.Request(
            self.provider["base_url"] + "/chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                "content-type": "application/json",
                "authorization": "Bearer " + self.provider["key"],
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                body = json.loads(res.read().decode())
        except Exception as err:
            note_llm_call(False, f"{type(err).__name__}: {err}")
            raise
        note_llm_call(True)
        choice = (body.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        return {
            "content": message.get("content") or "",
            "tool_calls": message.get("tool_calls") or [],
            "finish": choice.get("finish_reason"),
        }


LLM_HEALTH = {"calls": 0, "ok_calls": 0, "last_error": None}


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
        "provider": client.label,
        "last_error": LLM_HEALTH["last_error"],
        "reason": None if client.available else "no llm provider: set RETELLDB_LLM_BASE_URL and RETELLDB_LLM_API_KEY, or a known provider key",
    }
