// live smoke for the tenki lane through the spawnable seam.
// runs against the real api: creates a workbench, execs, pauses, resumes,
// verifies state survived, destroys, and waits for convergence.
// honest rails are asserted too: unwired capabilities must throw, not fake.

import { TenkiProvider } from "../spawnable/tenki.ts";
import type { SpawnableProvider } from "../spawnable/types.ts";

let passed = 0;
function pass(name: string, detail = "") {
  passed += 1;
  console.log(`PASS ${name}${detail ? " :: " + detail : ""}`);
}
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERT ${message}`);
}

const tenki = new TenkiProvider();
const provider: SpawnableProvider = tenki;
assert(provider.isAvailable(), "tenki lane must be available with a key present");
pass("isAvailable");

const identity = await tenki.client.whoAmI();
assert(Boolean(identity.ownerId), "whoAmI resolves an identity");
pass("whoAmI", `${identity.ownerType}/${identity.ownerId}`);

const name = `clawtel-smoke-${Date.now()}`;
const spawnable = await provider.create({
  name,
  form: "workbench",
  cpu: 2,
  memoryMib: 2048,
  diskGiB: 5,
  desktop: false,
});
assert(spawnable.name === name, "created spawnable carries its name");
pass("create", spawnable.status);

// unwired rails throw honestly, nothing fakes
let honestThrow = false;
try {
  await spawnable.screen.grab();
} catch {
  honestThrow = true;
}
assert(honestThrow, "screen.grab must throw not-wired, never fake a frame");
assert(spawnable.input.browser === null, "browser actuation is null until wired");
assert(spawnable.input.xInput === null, "x input is null until wired");
pass("honest closed rails");

// desktop provisioning is live-verified by scripts/browser-lane-smoke.ts
// (the full dock: xvfb + headed chrome + cdp through the tunnel). this
// smoke keeps its run cheap and skips it.

const marker = `/home/tenki/${name}.txt`;
await provider.exec(name, `echo "spawnable persistence proof" > ${marker}`);
const written = await provider.exec(name, `cat ${marker}`);
assert(written.stdout.includes("persistence proof"), "marker written and read back");
pass("exec write");

await provider.pause(name);
const pausedList = await tenki.client.list();
const paused = pausedList.find((s) => s.name === name);
assert(paused?.state === "PAUSED", "paused workbench reports PAUSED");
pass("pause", `state ${paused?.state}`);

await provider.resume(name);
const resumed = await provider.exec(name, `cat ${marker}`);
assert(resumed.stdout.includes("persistence proof"), "marker survived pause/resume");
pass("resume + persistence");

await provider.start(name); // no-op on a running workbench
pass("start no-op on running");

// destroy is permanent and says so; termination converges server-side
await provider.destroy(name);
const deadline = Date.now() + 90_000;
let gone = false;
while (Date.now() < deadline) {
  const afterDestroy = await tenki.client.list();
  if (!afterDestroy.some((s) => s.name === name)) {
    gone = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 3_000));
}
assert(gone, "destroyed workbench is gone from the list within 90s");
pass("destroy", "terminated and converged");

console.log(`SMOKE OK (${passed} passes)`);
