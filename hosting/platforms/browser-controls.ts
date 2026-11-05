// the host seat, wired to a real browser session.
//
// every act probes first. a seat that clicks blind is worse than a seat
// that says it cannot see: one of them admits the wrong person and the
// other tells you the client build moved.

import type { HostControls } from "../controls.ts";
import {
  ZOOM_HOST_SELECTORS,
  admitExpression,
  muteExpression,
  parseProbe,
  probeExpression,
  removeExpression,
  shareStartExpression,
  shareStopExpression,
  type HostActOutcome,
  type HostProbe,
  type ZoomHostSelectors,
} from "./zoom-host.ts";

/** the slice of a browser session the seat needs. */
export interface HostSession {
  evaluate<T = unknown>(expression: string): Promise<T>;
}

export class SelectorMismatch extends Error {}

export class BrowserHostControls implements HostControls {
  readonly platform: string;
  private pack: ZoomHostSelectors;

  constructor(
    private session: HostSession,
    opts: { platform?: string; pack?: ZoomHostSelectors } = {},
  ) {
    this.platform = opts.platform ?? "zoom";
    this.pack = opts.pack ?? ZOOM_HOST_SELECTORS;
  }

  async probe(): Promise<HostProbe> {
    const raw = await this.session.evaluate<unknown>(probeExpression(this.pack));
    return parseProbe(raw);
  }

  private async act(expression: string, what: string, skipProbe = false): Promise<HostActOutcome> {
    // sharing hides the panels the probe looks for, so a share is judged
    // by its own control rather than by panels that are legitimately gone
    if (!skipProbe) {
      const probed = await this.probe();
      if (!probed.ok) throw new SelectorMismatch(`${what}: ${probed.reason}`);
    }
    const raw = (await this.session.evaluate<HostActOutcome>(expression)) ?? { ok: false };
    const result: HostActOutcome = { ok: raw.clicked === true, ...raw };
    if (!result.ok) {
      throw new SelectorMismatch(`${what} did not land${result.reason ? `: ${result.reason}` : ""}`);
    }
    return result;
  }

  async admit(guestId: string): Promise<boolean> {
    const out = await this.act(admitExpression(this.pack, guestId), `admit ${guestId}`);
    return out.ok === true;
  }

  async mute(guestId: string): Promise<boolean> {
    const out = await this.act(muteExpression(this.pack, guestId), `mute ${guestId}`);
    return out.ok === true;
  }

  async remove(guestId: string): Promise<boolean> {
    const out = await this.act(removeExpression(this.pack, guestId), `remove ${guestId}`);
    return out.ok === true;
  }

  /**
   * screen share is allowed to run before a probe: while sharing, the
   * waiting room and participant panels are hidden, so probing those
   * first would refuse a perfectly good share. the share control itself
   * still has to be on the page.
   */
  async startShare(_url?: string): Promise<boolean> {
    const out = await this.act(shareStartExpression(this.pack), "start sharing", true);
    return out.ok === true;
  }

  async stopShare(): Promise<boolean> {
    const out = await this.act(shareStopExpression(this.pack), "stop sharing", true);
    return out.ok === true;
  }
}
