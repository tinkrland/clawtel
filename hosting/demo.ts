// the demo lane: the host actually drives a browser, in front of people.
//
// steps run through the same BrowserSession the join lane hands out, so
// a demo and a join share one browser seam. every step leaves a receipt
// with its own timing, and a step that lies (a screenshot that came back
// blank, a check that evaluated falsy) is a failure, not a tick.

export type DemoAction = "navigate" | "click" | "type" | "press" | "wait" | "check" | "shot";

export const DEMO_ACTIONS: DemoAction[] = ["navigate", "click", "type", "press", "wait", "check", "shot"];

export interface DemoStep {
  action: DemoAction;
  label: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  ms?: number;
  expression?: string;
  // a lane that is cosmetic (a banner, a tour bubble) may be optional;
  // the step still reports when it fails
  optional?: boolean;
}

export interface DemoScript {
  name: string;
  startUrl?: string;
  steps: DemoStep[];
}

export type ParsedDemo = { ok: true; script: DemoScript } | { ok: false; reason: string };

const HTTP = /^https?:\/\//i;

/** validate a script before it is ever run: a bad step fails here, not on stage. */
export function parseDemo(input: unknown): ParsedDemo {
  if (!input || typeof input !== "object") return { ok: false, reason: "a demo needs an object with a name and steps" };
  const raw = input as Partial<DemoScript>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, reason: "a demo needs a name" };
  if (raw.startUrl !== undefined && (typeof raw.startUrl !== "string" || !HTTP.test(raw.startUrl))) {
    return { ok: false, reason: "startUrl must be an http or https url" };
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    return { ok: false, reason: "a demo needs at least one step" };
  }
  if (raw.steps.length > 60) return { ok: false, reason: "a demo is capped at 60 steps; longer is a scripted video, not a demo" };

  const steps: DemoStep[] = [];
  for (const [i, step] of raw.steps.entries()) {
    const at = `step ${i + 1}`;
    if (!step || typeof step !== "object") return { ok: false, reason: `${at} is not an object` };
    const action = step.action;
    if (!DEMO_ACTIONS.includes(action)) {
      return { ok: false, reason: `${at} has an unknown action "${String(action)}" (expected ${DEMO_ACTIONS.join(", ")})` };
    }
    const label = typeof step.label === "string" && step.label.trim() ? step.label.trim() : `step ${i + 1}`;
    const out: DemoStep = { action, label, optional: step.optional === true };

    if (action === "navigate") {
      if (typeof step.url !== "string" || !HTTP.test(step.url)) {
        return { ok: false, reason: `${at} (navigate) needs an http or https url` };
      }
      out.url = step.url;
    }
    if (action === "click") {
      if (typeof step.selector !== "string" || !step.selector.trim()) {
        return { ok: false, reason: `${at} (click) needs a css selector` };
      }
      out.selector = step.selector;
    }
    if (action === "type") {
      if (typeof step.selector !== "string" || !step.selector.trim()) {
        return { ok: false, reason: `${at} (type) needs a css selector` };
      }
      if (typeof step.text !== "string") return { ok: false, reason: `${at} (type) needs text` };
      out.selector = step.selector;
      out.text = step.text;
    }
    if (action === "press") {
      if (typeof step.key !== "string" || !step.key.trim()) {
        return { ok: false, reason: `${at} (press) needs a key` };
      }
      out.key = step.key;
      if (typeof step.selector === "string" && step.selector.trim()) out.selector = step.selector;
    }
    if (action === "wait") {
      const ms = Number(step.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 60_000) {
        return { ok: false, reason: `${at} (wait) needs ms between 0 and 60000` };
      }
      out.ms = Math.round(ms);
    }
    if (action === "check") {
      if (typeof step.expression !== "string" || !step.expression.trim()) {
        return { ok: false, reason: `${at} (check) needs an expression to evaluate` };
      }
      out.expression = step.expression;
    }
    steps.push(out);
  }
  return { ok: true, script: { name, startUrl: raw.startUrl, steps } };
}

export interface DemoDriver {
  navigate(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  evaluate<T = unknown>(expression: string): Promise<T>;
  sleep(ms: number): Promise<void>;
}

export interface StepReceipt {
  index: number;
  label: string;
  action: DemoAction;
  ok: boolean;
  optional: boolean;
  ms: number;
  detail?: string;
  error?: string;
}

export interface DemoResult {
  ok: boolean;
  script: string;
  ran: number;
  receipts: StepReceipt[];
  failedAt?: number;
  reason?: string;
}

export class DemoStepTimeout extends Error {}

function pressExpression(key: string, selector?: string): string {
  const pick = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : "document.activeElement";
  return `(() => {
    const el = ${pick};
    if (!el) return false;
    const opts = { key: ${JSON.stringify(key)}, bubbles: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
    return true;
  })()`;
}

/** run a script. hard failures stop it; optional steps are recorded and walked past. */
export async function runDemo(
  script: DemoScript,
  driver: DemoDriver,
  opts: { stepTimeoutMs?: number } = {},
): Promise<DemoResult> {
  const timeoutMs = opts.stepTimeoutMs ?? 30_000;
  const receipts: StepReceipt[] = [];
  const base = { script: script.name, ran: 0, receipts };

  if (script.startUrl) {
    const t0 = Date.now();
    try {
      await driver.navigate(script.startUrl);
      receipts.push({ index: 0, label: "open the demo", action: "navigate", ok: true, optional: false, ms: Date.now() - t0, detail: script.startUrl });
    } catch (err) {
      receipts.push({ index: 0, label: "open the demo", action: "navigate", ok: false, optional: false, ms: Date.now() - t0, error: (err as Error).message });
      return { ...base, ok: false, failedAt: 0, reason: `the demo could not open ${script.startUrl}: ${(err as Error).message}` };
    }
  }

  for (const [i, step] of script.steps.entries()) {
    const t0 = Date.now();
    const receipt: StepReceipt = { index: i, label: step.label, action: step.action, ok: false, optional: step.optional === true, ms: 0 };
    try {
      const work = (async () => {
        switch (step.action) {
          case "navigate":
            await driver.navigate(step.url as string);
            return step.url as string;
          case "click":
            await driver.click(step.selector as string);
            return step.selector as string;
          case "type":
            await driver.type(step.selector as string, step.text as string);
            return `typed ${String(step.text).length} chars into ${step.selector}`;
          case "press": {
            const pressed = await driver.evaluate<boolean>(pressExpression(step.key as string, step.selector));
            if (pressed === false) throw new Error("there was no element to press into");
            return String(step.key);
          }
          case "wait":
            await driver.sleep(step.ms as number);
            return `${step.ms}ms`;
          case "check": {
            const value = await driver.evaluate<unknown>(step.expression as string);
            if (!value) throw new Error(`the check evaluated falsy: ${JSON.stringify(value ?? null)}`);
            return `true (${typeof value})`;
          }
          case "shot": {
            const png = await driver.screenshot();
            // a blank page still screenshots; a few hundred bytes is the
            // honest floor for a real frame
            if (!png || png.byteLength < 1000) throw new Error(`the screenshot came back blank (${png?.byteLength ?? 0} bytes)`);
            return `${png.byteLength} bytes`;
          }
          default:
            throw new Error(`unknown action ${String(step.action)}`);
        }
      })();

      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DemoStepTimeout(`step timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      try {
        receipt.detail = await Promise.race([work, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      receipt.ok = true;
    } catch (err) {
      receipt.error = (err as Error).message;
    }
    receipt.ms = Date.now() - t0;
    receipts.push(receipt);

    if (!receipt.ok && !receipt.optional) {
      return {
        ...base,
        ok: false,
        ran: receipts.length,
        failedAt: i,
        reason: `${step.label} failed: ${receipt.error}`,
      };
    }
  }

  return { ...base, ok: true, ran: receipts.length };
}
