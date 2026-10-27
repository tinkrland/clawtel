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
| join engine + browser lane seam | designed | the lane interface + closed-lane refusal are real and tested; no cloud browser lane wired yet, nothing fakes a join |
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

## honest gaps

- the browser lane: no cloud browser provider is wired, so joining is a
  closed lane. the clawtel-native answer (the join tab lives in a
  spawnable browser) is the designed path, not yet wired.
- interactivity expressions are built and rule-tested but never
  evaluated against a live meeting page. one real meeting verifies the
  family.
- stores are in memory (meetings, captures, transcripts). a database
  lane is a buyer decision.
- recap fetch + transcribe lanes and the smtp transport are contracts,
  not implementations.
