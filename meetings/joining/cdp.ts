// a minimal cdp client: enough of the chrome devtools protocol to
// drive the join tab (navigate, evaluate, screenshot, click, type).
// the expressions sent to the page are always built by this package
// (page seams), never scraped blindly. one websocket, sequential
// command ids, no inspection domains beyond runtime and page.

import WebSocket from "ws";

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export async function cdpVersion(origin: string): Promise<{ browser: string }> {
  const res = await fetch(`${origin}/json/version`);
  if (!res.ok) throw new Error(`devtools version endpoint said ${res.status}`);
  return (await res.json()) as { browser: string };
}

export async function cdpNewTab(origin: string, url = "about:blank"): Promise<CdpTarget> {
  // chrome wants PUT on /json/new since 111
  const res = await fetch(`${origin}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!res.ok) throw new Error(`devtools new-tab endpoint said ${res.status}`);
  return (await res.json()) as CdpTarget;
}

// the target's debugger url names the in-browser host; rewrite it to
// the exposed origin we can actually reach
export function rewriteDebuggerUrl(target: CdpTarget, origin: string): string {
  return target.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, origin.replace(/^http/, "ws").replace(/\/$/, ""));
}

export class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString()) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    });
  }

  static async connect(wsUrl: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.once("open", () => resolve(new CdpClient(ws)));
      ws.once("error", reject);
    });
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T = unknown>(expression: string, awaitPromise = true): Promise<T> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: { text: string } };
    if (result.exceptionDetails) {
      throw new Error(`the page refused the expression: ${result.exceptionDetails.text}`);
    }
    return result.result?.value as T;
  }

  async navigate(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
    // wait for the load event with a bounded poll, not a promise race
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const ready = await this.evaluate<boolean>("document.readyState === 'complete'", false);
      if (ready) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`the page did not settle within 30s: ${url}`);
  }

  async screenshot(): Promise<Uint8Array> {
    const result = (await this.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    return Uint8Array.from(Buffer.from(result.data, "base64"));
  }

  close(): void {
    this.ws.close();
  }
}
