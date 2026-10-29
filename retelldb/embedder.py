"""the embedder lane: semantic vectors for retrieval, env-gated, closed by
default. two real providers are wired (gemini embedContent, openai-shaped
/v1/embeddings which also covers ollama, together, jina, deepinfra); a lane
without a working provider reports closed and retrieval stays lexical.
nothing pretends a vector exists if it does not."""

import json
import os
import urllib.request

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:batchEmbedContents?key={key}"
DEFAULT_GEMINI_MODEL = "text-embedding-004"
DEFAULT_OPENAI_MODEL = "text-embedding-3-small"


# cloudflare fronts the openai-shaped providers and refuses plain
# urllib agents, so every request carries a browser user-agent
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)


def _env(name, default=None):
    v = os.environ.get(name)
    return v.strip() if isinstance(v, str) and v.strip() else default


class Embedder:
    available = False
    label = "closed"

    def embed(self, texts):
        try:
            vecs = self._embed(texts)
        except Exception as err:
            note_embed_call(False, f"{type(err).__name__}: {err}")
            raise
        note_embed_call(True)
        return vecs

    def _embed(self, texts):
        raise RuntimeError("the embedder lane is closed: set RETELLDB_EMBEDDER or a provider key")


class GeminiEmbedder(Embedder):
    available = True

    def __init__(self, key, model=None):
        self.key = key
        self.model = model or DEFAULT_GEMINI_MODEL
        self.label = "gemini:" + self.model

    def _embed(self, texts):
        out = []
        for i in range(0, len(texts), 100):
            batch = texts[i : i + 100]
            payload = {
                "requests": [{"model": "models/" + self.model, "content": {"parts": [{"text": t}]}} for t in batch]
            }
            req = urllib.request.Request(
                GEMINI_URL.format(model=self.model, key=self.key),
                data=json.dumps(payload).encode(),
                headers={"content-type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                body = json.loads(res.read().decode())
            out.extend([e["values"] for e in body.get("embeddings", [])])
        return out


class OpenAICompatEmbedder(Embedder):
    available = True

    def __init__(self, base_url, key, model=None):
        self.base_url = base_url.rstrip("/")
        self.key = key
        self.model = model or DEFAULT_OPENAI_MODEL
        self.label = "openai:" + self.model

    def _embed(self, texts):
        out = []
        for i in range(0, len(texts), 32):
            batch = texts[i : i + 32]
            req = urllib.request.Request(
                self.base_url + "/embeddings",
                data=json.dumps({"model": self.model, "input": batch}).encode(),
                headers={
                    "content-type": "application/json",
                    "authorization": "Bearer " + self.key,
                    # cloudflare fronts these apis and refuses plain
                    # urllib agents
                    "user-agent": _UA,
                },
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                body = json.loads(res.read().decode())
            rows = sorted(body.get("data", []), key=lambda d: d.get("index", 0))
            out.extend([r["embedding"] for r in rows])
        return out


class LadderEmbedder(Embedder):
    """several rungs, tried in order, each with its own receipts. a
    configured key is not a working one, so a dead rung is walked past
    at call time instead of trusted because it exists."""

    def __init__(self, rungs):
        self.rungs = [r for r in rungs if r is not None and r.available]
        self.served = None

    @property
    def available(self):
        return bool(self.rungs)

    @property
    def label(self):
        if self.served is not None:
            return self.served
        return self.rungs[0].label if self.rungs else "closed"

    def first_label(self):
        return self.rungs[0].label if self.rungs else "closed"

    def _embed(self, texts):
        last = None
        for rung in self.rungs:
            try:
                vecs = rung._embed(texts)
            except Exception as err:  # noqa: BLE001 - walk past any dead rung
                last = err
                note_embed_call(False, f"{rung.label}: {type(err).__name__}: {err}")
                continue
            note_embed_call(True)
            self.served = rung.label
            return vecs
        raise last if last is not None else RuntimeError("no embedder rung answered")


def get_embedder():
    """explicit lane wins; auto picks the provider whose env is present."""
    lane = _env("RETELLDB_EMBEDDER")
    gemini_key = _env("GEMINIAPIKEY") or _env("GEMINI_API_KEY")
    base = _env("RETELLDB_EMBED_BASE_URL") or _env("EMBEDDINGS_BASE_URL")
    key = _env("RETELLDB_EMBED_API_KEY") or _env("EMBEDDINGS_API_KEY")

    featherless_keys = [k for k in (_env("FEATHERLESS_API_KEY_2"), _env("FEATHERLESS_API_KEY")) if k]

    custom = OpenAICompatEmbedder(base, key, _env("RETELLDB_EMBED_MODEL")) if base and key else None
    gemini = GeminiEmbedder(gemini_key, _env("RETELLDB_EMBED_MODEL")) if gemini_key else None
    featherless = (
        OpenAICompatEmbedder(
            "https://api.featherless.ai/v1",
            featherless_keys[0],
            _env("RETELLDB_EMBED_MODEL") or "Qwen/Qwen3-Embedding-0.6B",
        )
        if featherless_keys
        else None
    )
    if featherless is not None:
        featherless.label = "featherless:" + featherless.model

    if lane in (None, "auto"):
        # explicit config first, then the rungs that exist. gemini's key
        # has been observed invalid, so it sits after featherless; the
        # ladder walks past it if it fails again.
        return LadderEmbedder([custom, featherless, gemini])

    if lane == "gemini" and gemini_key:
        return LadderEmbedder([gemini])
    if lane == "featherless" and featherless:
        return LadderEmbedder([featherless])
    if lane == "openai" and custom:
        return LadderEmbedder([custom])
    return Embedder()


EMBED_HEALTH = {"calls": 0, "ok_calls": 0, "last_error": None}


def note_embed_call(ok: bool, error: str = "") -> None:
    """every embed call leaves a receipt: a configured key is not a working one."""
    EMBED_HEALTH["calls"] += 1
    if ok:
        EMBED_HEALTH["ok_calls"] += 1
        EMBED_HEALTH["last_error"] = None
    else:
        EMBED_HEALTH["last_error"] = error or "the embedder call failed"


def embedder_status():
    e = get_embedder()
    healthy = None if EMBED_HEALTH["calls"] == 0 else EMBED_HEALTH["last_error"] is None
    return {
        # configured means a provider will be tried. healthy means one
        # actually answered. an invalid key reads configured and unhealthy.
        "available": e.available,
        "configured": e.available,
        "healthy": healthy,
        "calls": EMBED_HEALTH["calls"],
        "provider": e.label,
        "last_error": EMBED_HEALTH["last_error"],
        "reason": None if e.available else "no embedder provider: set RETELLDB_EMBEDDER and its keys, retrieval stays lexical",
    }


def cosine(a, b):
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)
