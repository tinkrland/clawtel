# spawnables

a spawnable is where the agent works: a persistent computer with an x
display, a browser, and state that survives between sessions. spawnables are
provisioned through one seam, the spawnable provider, and two lanes sit
behind it.

## the seam

```
SpawnableProvider
  create(name, spec)      -> Spawnable
  start(name)             -> void      // cold start, state intact
  exec(name, command)     -> output
  pause(name)             -> void      // compute freed, memory kept
  resume(name)            -> void
  destroy(name)           -> void      // permanent

Spawnable
  screen                  -> capture handle   // x11grab class
  input                   -> actuation handle  // browser first, x second
  status                  -> created | running | paused | stopped
```

the seam is injectable like every other rail in the family. lanes are
env-gated: the tenki lane exists when tenki credentials exist, the
self-hosted lane exists when its endpoint exists. unset = closed.

## lane 1: tenki (managed, first option)

disposable full linux vms, billed per second, with pause and resume
that preserves files and memory. verified live: marker files and
running processes (xvfb, chrome) survive pause and resume; headed
chrome plus a virtual display captures getdisplaymedia ("entire
screen", auto-select flag, https context) at 1920x1080 30fps. the
buyer needs no kvm and no cluster.

no nested virtualization: a tenki sandbox is the spawnable itself, not a
host for other vms.

## lane 2: self-hosted

**opensandbox** is the product-grade engine: kubernetes-native
firecracker sandboxes (64ms p50 create), pause checkpoints rootfs plus
vm state plus guest memory to the artifact store, zero compute
footprint while paused, resume on any host. windows guests via the
dockur path under qemu, rdp and web console, persistent storage bind.
apache-2.0, foundation-governed (aaif), the reason it is the embedded
engine for the sold package.

**cua** is the strongest single-host alternate: containers, qemu vms
(kvm, with a tcg fallback), firecracker microvms, macos vms via lume,
and cloud account connect (aws, gcp, hetzner, modal). spawnables are
persistent by default with checkpoints and warm pools. its fsl-1.1-mit
license on the spaces parts (spacesd, keyvault, teleport, volume,
streaming client) is fine for internal self-host use and needs a legal
read before embedding in a product.

**celesto** is the simplest: pip install on one linux host with kvm,
named machines that stop to disk and start with state intact. windows
11 and macos guests. apache-2.0. dominated by cua on features, kept
for simplicity.

**aio sandbox** (agent-infra) is the cheap rung: one docker container
per spawnable with browser, vnc desktop, shell, mcp. no kvm, runs on any
vps, docker stop keeps the filesystem. container isolation only: good
for an own-computer trust model, not for untrusted code.

## infra notes

- kvm is a hard requirement for firecracker and for qemu-with-kvm on
  linux hosts. nested virtualization on gcp (per-instance flag) and
  azure (dv3/ev3), bare metal (*.metal) on aws.
- the browser-shaped rails the agent built (zoom web sdk share tab, wop
  iframes, link share, dom actuation) drive web demos unchanged.
- desktop-demo mode needs three new pieces: the join tab lives in the
  spawnable's browser with getdisplaymedia entire-screen instead of tab
  capture (primitive verified), native apps need an x input seam
  (provider input primitives or xdotool class), and ingest of the
  spawnable's x display into the composite reuses the existing x11grab to
  rgba path. windows spawnables capture through rdp or obs, not x11grab.

## sources

- [tenki docs](https://tenki.cloud/docs/sandbox/concepts.md)
- [opensandbox](https://github.com/opensandbox-group/OpenSandbox)
- [cua](https://github.com/trycua/cua)
- [celesto](https://github.com/CelestoAI/celesto)
- [aio sandbox](https://github.com/agent-infra/sandbox)
