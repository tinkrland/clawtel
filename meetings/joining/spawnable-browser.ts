// the spawnable browser lane: the clawtel-native answer to "where does
// the join tab live?". a browser inside a spawnable, driven over cdp
// through the tenki tunnel. the join tab must live where a screen
// exists to share, so this lane provisions a real x display with
// headed chrome, not a headless box that cannot share a screen.
//
// honest scope: the lane opens, navigates, evaluates, screenshots and
// closes. the per-platform join page seams (zoom web sdk and friends)
// are platform modules, wired separately; this lane never claims a
// join happened.

import { CdpClient, cdpNewTab, cdpVersion, rewriteDebuggerUrl } from "./cdp.ts";
import type { BrowserLane, BrowserSession } from "./engine.ts";
import { tenkiProvider } from "../../spawnable/manager.ts";

export interface SpawnableBrowserOpts {
  name?: string;
  /** share-out readiness: the auto-select flag that bypasses the human picker */
  autoSelectScreen?: boolean;
}

const DEBUG_PORT = 9222;
// the cdp shim port: preview urls only reach ports bound on all
// interfaces, and chrome binds its debugger to loopback and checks
// the host header. nginx on 9333 bridges both, websocket upgrades
// included. the documented pattern, not a workaround guess.
const SHIM_PORT = 9333;

function chromeLaunchCommand(autoSelectScreen: boolean): string {
  const flags = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--user-data-dir=/tmp/clawtel-profile",
    `--remote-debugging-port=${DEBUG_PORT}`,
    // without this chrome refuses websocket upgrades that carry an
    // origin it does not recognize
    "--remote-allow-origins=*",
    "--window-size=1920,1080",
  ];
  if (autoSelectScreen) {
    // the verified agent-drive path: getdisplaymedia without a picker
    flags.push('--auto-select-desktop-capture-source="Entire screen"');
  }
  return `nohup env DISPLAY=:0 google-chrome ${flags.join(" ")} about:blank >/tmp/chrome.log 2>&1 & sleep 1`;
}

export class SpawnableBrowserLane implements BrowserLane {
  readonly lane = "spawnable";
  private browserSpec = {
    name: "",
    form: "dock" as const,
    cpu: 2,
    memoryMib: 2048,
    diskGiB: 5,
    desktop: true,
  };

  isAvailable(): boolean {
    return tenkiProvider.isAvailable();
  }

  /** close by session id: the dock name is deterministic from the meeting. */
  async close(sessionId: string): Promise<void> {
    const meetingId = sessionId.replace(/^spawnable:/, "");
    await tenkiProvider.destroy(`clawtel-${meetingId}`);
  }

  async open(url: string, opts: { name?: string } & SpawnableBrowserOpts = {}): Promise<BrowserSession> {
    if (!this.isAvailable()) {
      throw new Error("spawnable lane is closed: TENKI_API_KEY is unset");
    }
    const name = opts.name ?? `dock-${Date.now()}`;
    // the browser dock: ephemeral, created for this session, destroyed on close
    await tenkiProvider.create({ ...this.browserSpec, name });

    // the cdp shim: nginx fronting chrome's loopback-bound debugger
    const shim = await tenkiProvider.exec(
      name,
      [
        "sudo apt-get install -y -qq nginx",
        "cat > /tmp/chrome-cdp.conf <<'NGINX'",
        nginxConf(),
        "NGINX",
        "sudo install -m 644 /tmp/chrome-cdp.conf /etc/nginx/sites-available/chrome-cdp",
        "sudo ln -sf /etc/nginx/sites-available/chrome-cdp /etc/nginx/sites-enabled/chrome-cdp",
        "sudo rm -f /etc/nginx/sites-enabled/default",
        "sudo systemctl restart nginx",
      ].join("\n"),
      120_000,
    );
    if (shim.exitCode !== 0) {
      throw new Error(`the cdp shim did not come up: ${shim.stderr.slice(0, 200)}`);
    }

    const launch = await tenkiProvider.exec(name, chromeLaunchCommand(opts.autoSelectScreen === true), 30_000);
    if (launch.exitCode !== 0) {
      throw new Error(`chrome did not launch: ${launch.stderr.slice(0, 200)}`);
    }

    // the tunnel: cdp rides the shim port from outside
    const exposed = await tenkiProvider.exposePort(name, SHIM_PORT);
    const origin = exposed.previewUrl.replace(/\/$/, "");
    await this.waitForDevtools(origin, 60_000);

    const tab = await cdpNewTab(origin, url);
    const client = await CdpClient.connect(rewriteDebuggerUrl(tab, origin));
    return this.wrap(name, client);
  }

  private async waitForDevtools(origin: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = "the devtools endpoint never answered";
    while (Date.now() < deadline) {
      try {
        await cdpVersion(origin);
        return;
      } catch (err) {
        lastError = (err as Error).message;
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
    throw new Error(`chrome did not come up inside the dock: ${lastError}`);
  }

  private wrap(name: string, client: CdpClient): BrowserSession {
    return {
      navigate: (url: string) => client.navigate(url),
      click: (selector: string) => client.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return Promise.reject(new Error("no element matches " + ${JSON.stringify(selector)}));
        el.click();
        return true;
      })()`),
      type: (selector: string, text: string) => client.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return Promise.reject(new Error("no element matches " + ${JSON.stringify(selector)}));
        el.focus();
        const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value")?.set;
        setter?.call(el, ${JSON.stringify(text)});
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`),
      screenshot: () => client.screenshot(),
      // evaluate is the seam call: every capability built here runs
      // through it with an expression this package wrote
      evaluate: <T>(expression: string) => client.evaluate<T>(expression),
      close: async () => {
        client.close();
        await tenkiProvider.destroy(name);
      },
    };
  }
}

function nginxConf(): string {
  return [
    "server {",
    `  listen ${SHIM_PORT};`,
    "",
    "  location / {",
    `    proxy_pass http://127.0.0.1:${DEBUG_PORT};`,
    "    proxy_http_version 1.1;",
    `    proxy_set_header Host 127.0.0.1:${DEBUG_PORT};`,
    "    proxy_set_header Upgrade $http_upgrade;",
    '    proxy_set_header Connection "upgrade";',
    "    proxy_read_timeout 8h;",
    "    proxy_send_timeout 8h;",
    "    proxy_buffering off;",
    "  }",
    "}",
  ].join("\n");
}
