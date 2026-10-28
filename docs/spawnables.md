# spawnables

a spawnable is a computer the agent works from. the contract lives in spawnable/types.ts and every lane implements it: create, start, exec, pause, resume, destroy, plus screen and input handles. env-gated throughout, a lane without its key stays closed.

two forms:

- **workbench** (persistent): files, installed apps and running processes survive pause/resume. idle means paused: zero compute, nothing lost. the office-hours shape: provision once, meet weekly, pay storage between.
- **dock** (ephemeral): created for one job, destroyed after. the render-job shape.

## the lane ladder

the seam is one interface over a ladder of rungs. pick by ops appetite, the code does not change:

1. **tenki** (managed, first option). full ubuntu vms, billed per second, pause preserves files and memory. no kvm exposed, so nothing nests inside it, the spawnable IS the computer. verified live: the tenki provider (spawnable/tenki.ts) passes the full smoke.
2. **aio container tier** (any vps). one docker container per spawnable with browser, vnc desktop, shell and mcp inside. no kvm needed, runs on the cheapest host a buyer has. container isolation: honest about that, it fits the own-computer trust model, not untrusted code.
3. **self-hosted vm lane**. firecracker microvms on your own metal, the product-grade engine for the sold package. pause checkpoints rootfs, vm state and memory to an artifact store, zero compute while paused, resume on any host. needs k8s plus kvm nodes: aws bare metal (nested virt is metal-only there) or gcp/azure with nested virt enabled.
4. **macos workbenches** (special lane). for surfaces that only exist on apple hardware. mac mini plus a virtualization host is the honest path when that day comes.

## what a workbench gives the agent

a verified provisioning recipe exists: xvfb virtual display plus headed chrome, getdisplaymedia with auto-select returns a real monitor capture (1920x1080 at 30fps, frame bytes pulled from the stream), so a spawnable can screen-share into a meeting. the https-context requirement is real: media devices do not exist on insecure pages.

## honest gaps

- desktop provisioning (the xvfb + chrome recipe) is wired into create() and live-smoked via the browser lane
- screen grab/capture handles, browser actuation and x-level input throw not-wired errors, nothing fakes
- native-app demos need an x input seam, that is new code, not a config change
- windows guests run on the vm lane but feed the pixel pipeline differently (rdp capture, not x11grab), also new code
