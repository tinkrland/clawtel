// verify the host seat's expressions against a real browser and a
// fixture that behaves like the client: menus open, the share control
// turns into a sharing bar, admits and removals change the DOM.
//
// this proves the expressions and the selection logic. it does not prove
// the selectors fit zoom's current build; only a real meeting can.

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { CdpClient, cdpNewTab } from "../meetings/joining/cdp.ts";
import { ZOOM_HOST_SELECTORS, admitExpression, muteExpression, parseProbe, probeExpression, removeExpression, shareStartExpression, shareStopExpression } from "../hosting/platforms/zoom-host.ts";
import { BrowserHostControls } from "../hosting/platforms/browser-controls.ts";

const PORT = 9223;
const FIXTURE = "/tmp/host-seat-fixture.html";
const PROFILE = "/tmp/host-seat-profile";

async function waitForDevtools(timeoutMs = 20_000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) {
        const body = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("devtools never came up");
}

async function main() {
  await writeFile(FIXTURE, readFileSync(new URL("./host-seat-fixture.html", import.meta.url)));
  const chrome = spawn("chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "about:blank",
  ], { stdio: "ignore" });

  try {
    const version = await waitForDevtools();
    const origin = `http://127.0.0.1:${PORT}`;
    const tab = await cdpNewTab(origin, `file://${FIXTURE}`);
    const client = await CdpClient.connect(tab.webSocketDebuggerUrl ?? version);
    await client.navigate(`file://${FIXTURE}`);
    await new Promise((r) => setTimeout(r, 400));

    const results: [string, boolean, string][] = [];
    const check = (name: string, ok: boolean, detail = "") => results.push([name, ok, detail]);

    const probeRaw = await client.evaluate(probeExpression(ZOOM_HOST_SELECTORS));
    const probe = parseProbe(probeRaw);
    check("probe finds both panels", probe.ok && probe.matched.waitingRows === 2 && probe.matched.participantRows === 1, JSON.stringify(probe.matched));
    check("probe sees the share control", probe.matched.shareButton === true);

    const controls = new BrowserHostControls(client);

    const admitted = await controls.admit("Ada Lovelace");
    const afterAdmit = await client.evaluate<string>(`document.querySelectorAll('[aria-label="Waiting Room"] li')[0].textContent`);
    check("admit lands on the right row", admitted && /admitted/.test(afterAdmit), afterAdmit ?? "");

    const muted = await controls.mute("Bob");
    check("mute opens the menu then mutes", muted);

    const removed = await controls.remove("Bob");
    const remaining = await client.evaluate<number>(`document.querySelectorAll('[aria-label="Participants"] li').length`);
    check("remove opens the menu, confirms, and the row goes", removed && remaining === 0, `rows left: ${remaining}`);

    const shared = await controls.startShare();
    const sharingBar = await client.evaluate<boolean>(`!!document.querySelector(".sharing-bar")`);
    check("share turns into a sharing bar", shared && sharingBar);

    const stopped = await controls.stopShare();
    const stoppedFlag = await client.evaluate<boolean>(`window.__stopped === true`);
    check("stop share lands", stopped && stoppedFlag);

    let refused = "";
    try {
      await controls.admit("Somebody Else");
    } catch (err) {
      refused = (err as Error).message;
    }
    check("an unknown name is refused by name", /no row matched that name/.test(refused), refused);

    let mismatch = "";
    const blind = new BrowserHostControls(client, {
      pack: { ...ZOOM_HOST_SELECTORS, waitingRoom: { ...ZOOM_HOST_SELECTORS.waitingRoom, panel: "#nothing-here" }, participants: { ...ZOOM_HOST_SELECTORS.participants, panel: "#nothing-here" }, share: { button: "#none", stopButton: "#none" } },
    });
    try {
      await blind.admit("Ada Lovelace");
    } catch (err) {
      mismatch = (err as Error).message;
    }
    check("a pack that does not fit refuses instead of clicking blind", /does not fit this client build/.test(mismatch), mismatch);

    client.close();
    let failed = 0;
    for (const [name, ok, detail] of results) {
      console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` :: ${detail}`}`);
      if (!ok) failed += 1;
    }
    console.log(failed === 0 ? `HOST SEAT CHECK OK (${results.length} checks)` : `HOST SEAT CHECK FAILED (${failed}/${results.length})`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    chrome.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error("host seat check crashed:", (err as Error).message);
  process.exitCode = 1;
});
