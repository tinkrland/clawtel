/**
 * smoke test for the tenki provider. runs the full seam against the
 * real api: create, exec, pause, resume, persistence, destroy.
 * costs a few minutes of a 2-core session, then terminates it.
 */

import { TenkiProvider } from "../spawnable/tenki.ts";
import type { SpawnableSpec } from "../spawnable/types.ts";

const name = "clawtel-smoke";
const spec: SpawnableSpec = {
  name,
  cpu: 2,
  memoryMib: 2048,
  diskGiB: 5,
  desktop: false,
};

function pass(step: string, detail = "") {
  console.log(`PASS ${step}${detail ? " :: " + detail : ""}`);
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`ASSERT ${message}`);
}

const provider = new TenkiProvider();

// lane availability is env-gated, never faked
assert(provider.isAvailable(), "lane must be available when TENKI_API_KEY is set");
assert(provider.lane === "tenki", "lane name");
pass("isAvailable");

// identity proves the key is live before spending compute
const me = await provider.client.whoAmI();
assert(me.ownerId?.length > 0, "whoAmI returns an owner");
pass("whoAmI", `${me.ownerType}/${me.ownerId}`);

// destroy any leftover from a failed earlier run
const existing = await provider.client.list();
const stale = existing.find((s) => s.name === name);
if (stale) {
  await provider.destroy(name);
  pass("cleanup leftover");
}

// create through the seam
const spawnable = await provider.create(spec);
assert(spawnable.status === "running", `create returns running, got ${spawnable.status}`);
assert(spawnable.screen.grab !== undefined, "screen handle present");
pass("create", spawnable.status);

// honest rails: unwired surfaces throw, they never fake
let threw = false;
try {
  spawnable.screen.grab(1920, 1080, 30);
} catch (e) {
  threw = e instanceof Error && e.message.includes("not wired");
}
assert(threw, "screen.grab must throw the honest not-wired error");
assert(spawnable.input.xInput === null, "xInput null in the thin provider");
pass("honest closed rails");

// exec through the seam
const marker = `clawtel-${Date.now()}`;
const write = await provider.exec(name, `echo '${marker}' > /home/tenki/clawtel-proof.txt && echo written`);
assert(write.exitCode === 0, `write exec exit 0, got ${write.exitCode}: ${write.stderr}`);
assert(write.stdout.trim() === "written", "write exec stdout");
pass("exec write");

// pause frees compute, resume restores, memory and files survive
await provider.pause(name);
const afterPause = await provider.client.list();
const pausedSession = afterPause.find((s) => s.name === name);
assert(pausedSession?.state === "PAUSED", `session paused, got ${pausedSession?.state}`);
pass("pause", "state PAUSED");

const resumed = await provider.resume(name);
assert(resumed.status === "running", `resume returns running, got ${resumed.status}`);
pass("resume", resumed.status);

const read = await provider.exec(name, "cat /home/tenki/clawtel-proof.txt");
assert(read.exitCode === 0, "read exec exit 0");
assert(read.stdout.trim() === marker, `marker survived pause/resume, got '${read.stdout.trim()}'`);
pass("persistence", `marker intact across pause/resume`);

// start is a no-op on a running spawnable, honest on others
const started = await provider.start(name);
assert(started.status === "running", "start no-op on running");
pass("start no-op");

// destroy is permanent and says so; termination converges server-side
await provider.destroy(name);
const deadline = Date.now() + 90_000;
let gone = false;
while (Date.now() < deadline) {
  const afterDestroy = await provider.client.list();
  if (!afterDestroy.some((s) => s.name === name)) {
    gone = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 3_000));
}
assert(gone, "destroyed spawnable is gone from the list within 90s");
pass("destroy", "session terminated and converged");

console.log("SMOKE OK");
process.exit(0);
