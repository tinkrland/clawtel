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
    if _env("OPENAI_API_KEY"):
        out.append({
            "base_url": _env("OPENAI_BASE_URL") or "https://api.openai.com/v1",
            "key": _env("OPENAI_API_KEY"),
            "model": model or "gpt-4.1-mini",
            "name": "openai",
        })
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
        "provider": client.label,
        "last_error": LLM_HEALTH["last_error"],
        "reason": None if client.available else "no llm provider: set RETELLDB_LLM_BASE_URL and RETELLDB_LLM_API_KEY, or a known provider key",
    }
