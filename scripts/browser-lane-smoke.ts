// the browser lane live smoke: a real browser inside a real spawnable,
// driven over cdp through the tenki tunnel. proves: dock creation with
// desktop provisioning, chrome coming up, the devtools tunnel, a new
// tab, navigation, evaluation, click + type on a page this script
// wrote, a screenshot with real bytes, and a clean destroy. no join is
// claimed: platform join seams are separate modules.

import { SpawnableBrowserLane } from "../meetings/joining/spawnable-browser.ts";

function pass(name: string, detail = "") {
  console.log(`PASS ${name}${detail ? " :: " + detail : ""}`);
}
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`ASSERT ${message}`);
}

const lane = new SpawnableBrowserLane();
assert(lane.isAvailable(), "the spawnable lane must be available with a key present");
pass("isAvailable");

const name = `clawtel-browser-smoke-${Date.now()}`;
const session = await lane.open("https://example.com", { name });
pass("open", "dock created, chrome up, tunnel reached, tab opened");

const title = await session.evaluate<string>("document.title");
assert(title === "Example Domain", `expected Example Domain, got ${title}`);
pass("navigate + evaluate", `title: ${title}`);

// click and type on a page this smoke writes, no external form needed
await session.evaluate(`(() => {
  document.body.innerHTML = '<input id="probe" /><button id="echo" onclick="window.probed = document.getElementById(\\'probe\\').value">echo</button>';
  return true;
})()`);
await session.type("#probe", "clawtel was here");
await session.click("#echo");
const echoed = await session.evaluate<string>("window.probed");
assert(echoed === "clawtel was here", `expected the typed value to ride the click, got ${echoed}`);
pass("type + click", `round trip: ${echoed}`);

const shot = await session.screenshot();
assert(shot.length > 1_000, `expected real png bytes, got ${shot.length}`);
assert(shot[0] === 0x89 && shot[1] === 0x50, "expected png magic bytes");
pass("screenshot", `${shot.length} bytes, png magic verified`);

await session.close();
pass("close", "dock destroyed with the browser");

console.log("BROWSER LANE SMOKE OK");
