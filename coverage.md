# coverage

what clawtel can do, what it is designed to do, and what it cannot do
yet. honest manifest, same rules as the family: verified means tested
live, designed means the shape exists and the path is known, not yet
possible means a real blocker stands in the way.

## spawnables

| capability | state | evidence |
| --- | --- | --- |
| tenki lane: create, exec, pause, resume | verified | live test oct 27 2026: marker file plus running xvfb/chrome survived pause/resume |
| tenki provider through the seam (src/spawnables/tenki.ts) | verified | live smoke oct 27 2026 via scripts/tenki-smoke.ts: isAvailable, whoAmI, create, exec, pause, resume, marker persistence, destroy convergence in 90s, closed rails throw honestly |
| spawnable screen capture via getdisplaymedia | verified | live test: headed chrome + xvfb, entire screen auto-select, 1920x1080 30fps, https context only |
| tenki sandbox nested virtualization | not possible | no /dev/kvm, no vmx/svm flags; the sandbox is the spawnable, not a host |
| opensandbox self-host lane | designed | docs-verified: firecracker 64ms p50, pause = rootfs+vmstate+memory checkpoint to store, resume any host, apache-2.0 |
| opensandbox windows guests | designed | dockur/windows under qemu, rdp + web console, persistent storage bind |
| cua / celesto / aio lanes | designed | alternates documented in docs/spawnables.md, none implemented |
| SpawnableProvider seam | verified | src/spawnables/types.ts, env-gated, unset = closed; tenki provider passes the live smoke |
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
