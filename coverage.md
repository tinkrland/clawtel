# coverage

what clawtel can do, what it is designed to do, and what it cannot do
yet. honest manifest, same rules as the family: verified means tested
live, designed means the shape exists and the path is known, not yet
possible means a real blocker stands in the way.

## spawnables

| capability | state | evidence |
| --- | --- | --- |
| tenki lane: create, exec, pause, resume | verified | live test oct 27 2026: marker file plus running xvfb/chrome survived pause/resume |
| tenki provider through the seam (spawnable/tenki.ts) | verified | live smoke oct 27 2026 via scripts/tenki-smoke.ts: isAvailable, whoAmI, create, exec, pause, resume, marker persistence, destroy convergence in 90s, closed rails throw honestly |
| spawnable screen capture via getdisplaymedia | verified | live test: headed chrome + xvfb, entire screen auto-select, 1920x1080 30fps, https context only |
| tenki sandbox nested virtualization | not possible | no /dev/kvm, no vmx/svm flags; the sandbox is the spawnable, not a host |
| opensandbox self-host lane | designed | docs-verified: firecracker 64ms p50, pause = rootfs+vmstate+memory checkpoint to store, resume any host, apache-2.0 |
| opensandbox windows guests | designed | dockur/windows under qemu, rdp + web console, persistent storage bind |
| cua / celesto / aio lanes | designed | alternates documented in docs/spawnables.md, none implemented |
| SpawnableProvider seam | verified | spawnable/types.ts, env-gated, unset = closed; tenki provider passes the live smoke |
| x input actuation for native apps | designed | provider input primitives or xdotool class; no implementation |
| windows spawnable capture into composite | designed | rdp stream or obs inside windows, not x11grab; new capture code |

## demo modes

| capability | state | evidence |
| --- | --- | --- |
| web demo pack format | designed | navigate/click primitives exist in the family rails; pack format not written |
| office hours (1:1 join, share, recap) | designed | join and recap contracts live under meetings/; share-out from a spawnable browser is a variant seam |
| livestream demo | designed | obs bridge + per-platform stream keys exist in the family; spawnable has never streamed |
| async clips (render, never publish) | designed | socmed clipping rails exist in the family |
| zoom share from inside a spawnable | pending live run | primitive verified (getdisplaymedia); one real zoom meeting needed |
| desktop app demos (figma, kicad class) | designed | linux spawnables cover these natively; x input seam not built |

## engine boundaries

- plate stays real forever. no generated backgrounds at any layer.
- renders, never publishes.
- env-gated lanes, unset = closed, never faked.
- engine never guesses: shares what it sees or says it cannot.

## backend (the meetings server)

the backend exists: server.ts wires meetings, interactivity, captures,
transcripts, questions, recap and relay behind one env-gated api door
(CLAWTEL_API_TOKEN present = bearer required, unset = the door is
closed). 71 tests + typecheck green, live smoke oct 27 2026.

| capability | state | evidence |
| --- | --- | --- |
| api door (bearer gate, health outside) | verified | live smoke: no token = 401/503, health open, routes answer |
| join url resolution (zoom j/x/my, meet, teams, whatsapp calls, twitch/kick/youtube, link share) | verified | tests/resolver.test.ts, 12 cases incl. passcode + guest-call hosts |
| meeting state machine (planned, joining, in_meeting, take_home, done; skips refused) | verified | meetings/meeting.ts + join-unwind on failure, tests in server suite |
| join engine + browser lane seam | verified | engine tested with stub lanes (a browser opening a url is not a join: honest joined:false, meeting stays planned); platform module seam completes the join when wired |
| spawnable browser lane (browser inside a dock, cdp through the tunnel) | verified | live smoke oct 28 2026 via scripts/browser-lane-smoke.ts: dock with desktop provisioning (sudo recipe, exit-code checked), headed chrome on xvfb, nginx cdp shim on 9333 (preview urls reach all-interface ports only, chrome binds loopback and checks host), tunnel, cdp tab, navigate, evaluate, click+type round trip, real png screenshot, clean destroy |
| browser lane api wiring | verified | live oct 28 2026: CLAWTEL_BROWSER_LANE=spawnable opt-in (unset = closed, no test spawns), join route returns the honest attempt (joined:false + why), browser/close route destroys the dock, no sessions leaked |
| zoom join signature (hmac-sha256, round trip verified) | verified | meetings/platforms/zoom/signature.ts + signature tests: decode, recompute, forged payload fails |
| meet reactions (the tray's documented names, unknown refused) | verified | MEET_REACTIONS list + normalize + dom expression; live click needs a lane |
| raise hand rules (already-raised = success, lower never clicked by a raise) | verified | decideHand pure machine + hand expression, tests green |
| screensharer awareness (seam first, viewer indicators, null = nobody) | verified | sharerFromViewerText tested against real indicator text; in-page read needs a session |
| expiry windows from the words (length > clock > meeting-end > today > hurry) | verified | capabilities/promo-codes/expiry_window.ts, 10 tests incl. zoneless clock quoted not invented |
| scarcity (counted + supply families, no-number supply) | verified | capabilities/promo-codes/scarcity.ts, tests green |
| captures (quote verbatim, code token, expiry + scarcity, redeem receipt) | verified | capabilities/promo-codes/capture.ts + api route live smoke |
| transcript store + h:mm:ss citations + content-word find | verified | capabilities/transcript/store.ts tests |
| questions (answer with citation or honest unknown, never a guess) | verified | capabilities/questions/answers.ts tests |
| colloquial time prose parsing (zones, relative, date phrases) | verified | capabilities/promo-codes/colloquial_time.ts tests incl. 10/25-at-10am-ist |
| recap pipeline (fetch > transcribe > ingest > answer, stage-honest) | designed | pipeline shape + closed-lane stage errors tested; fetch + transcribe lanes not wired |
| email relay (renders, never publishes; smtp lane) | designed | render + closed-lane refusal tested; no smtp transport wired |
| calendar intake lanes (google, microsoft, apple, notion, cal.com, zcal) | designed | closed-lane contracts in intake/planner.ts; bring credentials |
| spawnable routes through the api | verified | GET /api/spawnables reports lane truth; tenki lane live-smoked oct 27 |

## memory (the retelldb layer)

the memory data plane is python (stdlib only, http), the control plane
stays typescript. 29 python tests + 4 integration tests over real http,
plus every ts test green.

| capability | state | evidence |
| --- | --- | --- |
| store: typed nodes + verbatim artifacts, deterministic ids | verified | retelldb/test_service.py: idempotent re-ingest upserts in place, artifact ids content stable, json persistence survives reload |
| scope gates (fail-closed: unknown surface, persona isolation, anchor match, meeting wall, sensitivity) | verified | retelldb/scope.py + tests: anchored node stays home in an unanchored session, private email note does not ride into a meeting, public social material does not ride into a meeting, another persona never leaks |
| real data hooks (meeting planned, capture heard, transcript stored) | verified | server.ts hooks + integration test: a real meeting, capture and transcript land in memory, status reflects them |
| grounding brief (pre-call scan, citation on every line, prompt line for a live agent) | verified | /v1/ground + /api/memory/ground: the refund question grounds to its transcript line at 0:01:05 |
| tools (mid-call): get_artifact original + exact line/char spans, find_in_artifact, search_memory, list_artifacts | verified | /v1/tools + integration test: the ORIGINAL transcript text comes back verbatim, an exact line span is exact, an unknown tool is refused with the registry |
| client (env-gated, fail-closed, refusal passthrough) | verified | retelldb/client.ts: unset url = closed with a reason, a failure is null memory never a guess, a tool refusal reaches the caller intact |
| lexical retrieval lane | verified | deterministic token match; the brief says "lexical", never claims semantic |
| embedder lane | verified | live oct 29 2026: featherless serves embeddings (Qwen3-Embedding-0.6B/4B/8B at /v1/embeddings, 1024/2560/4096 dims, key 2 + browser ua). the embedder is a ladder too: it walks past the dead gemini key and serves from featherless. fused retrieval proven on a paraphrase with no shared keywords ("how long do buyers have to ask for their money back" returns the refund facts). backboard exposes no embeddings endpoint. cosine across mismatched dims reads 0, so switching models degrades honestly instead of ranking nonsense |
| llm tool-calling (a model choosing tools mid-call) | verified | live oct 29 2026: featherless Qwen2.5-72B picked search_memory natively, answered the digital-goods refund case correctly, cited both transcript pointers (artifact@0:02:44 and @0:01:05). provider ladder walks past dead rungs (tensormux credits expired, featherless key 1 unsubscribed) to the one that serves, and status names the serving rung |
| backboard rung (threads, runs, run-scoped tool outputs) | verified | live oct 29 2026: BACKBOARD_TOKEN works (X-API-Key, gpt-4o-mini default, OpenAI-style tools). a message answers REQUIRES_ACTION with run_id; outputs go to /threads/{id}/runs/{run}/submit-tool-outputs. pitfall found live: the completed reply echoes its tool_calls, so only a REQUIRES_ACTION turn is actionable (ungated, the agent re-ran the same tool to the step budget). pinned with RETELLDB_LLM_PROVIDER=backboard; agent answered the digital-refund case in 2 steps with both citations |
| retrieval fusion | verified | fused means vectors actually exist, never that a key does; a configured-but-failing embedder reads lexical (live-verified oct 29 2026: configured true, healthy false, HTTP 400, brief still answers) |
| lane health receipts | verified | embedder/llm status carries configured, healthy, calls, last_error: a configured key is not a working one, and a failed call is visible instead of implied (live-verified: the 402 and the HTTP 400 both surface with the provider named) |
| langflow as a visual layer | decided against as a dependency | flows live in its db as json, its own server + ui would ship twice, behavior that matters stays in code with tests; mcp-shaped tool surface lets it plug in locally if wanted |

## honest gaps

- the memory service has no auth beyond an optional api key and no
  transport encryption of its own: it sits behind the clawtel api door
  on the same host, and a remote deployment needs tls in front.



- the browser lane is live (a browser inside a dock, cdp through the
  tunnel) but the platform join page seams are not: zoom needs its web
  sdk hosted page + sdk credentials, meet needs its auth + camera flow.
  a join attempt opens the browser and reports joined:false honestly
  until a platform module is wired.
- interactivity expressions are built and rule-tested but never
  evaluated against a live meeting page. one real meeting verifies the
  family.
- stores are in memory (meetings, captures, transcripts). a database
  lane is a buyer decision.
- recap fetch + transcribe lanes and the smtp transport are contracts,
  not implementations.
