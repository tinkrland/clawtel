# retelldb pin: what clawtel still owns

clawtel's `retelldb/` is a fork, not a copy. it shares the name with
github.com/arsoninstigator/retelldb but not the schema: its nodes are memory facts with
persona namespaces, its store is a stdlib JSON store with chunking and fused search, and it
serves four routes the upstream package does not have.

## the pin

`requirements.txt` pins `retelldb @ v0.2.8`, which now carries the persona memory layer
(memory node types, `SHARED_NAMESPACE`, `graph_for`, persona profiles, platform carry
rules). anything clawtel needs from that layer should be imported, not copied.

## what upstream already answers

| clawtel module | upstream equivalent |
| --- | --- |
| `store.py` (node upsert, get, list) | `retelldb.storage.memory_store` / `RetellDB(use_memory=True)` |
| `embedder.py` | `retelldb.storage.embedder.ContextualEmbedder` |
| `scope.py` | `retelldb.routing.scope` (platform/connection carry, fail closed) |

these three can be dropped as soon as the service is rewritten against the package API.

## what has no upstream equivalent yet

- `POST /v1/ground`, the pre-call brief (`grounding.py`)
- `POST /v1/tools` + `GET /v1/tools`, the mid-call tool surface (`tools.py`)
- `POST /v1/answer`, the tool-calling agent (`agent.py`, `llm.py`)
- `POST /v1/ingest` with `{persona_id, nodes[], artifacts[]}`: artifact storage and the
  chunk index do not exist upstream, whose ingest takes a document and normalizes it

those are clawtel's product surface, not retelldb's, so the port either keeps them here on
top of the package store, or moves them upstream deliberately. until that call is made the
service keeps running the fork, and this pin is the first half of the switch.
