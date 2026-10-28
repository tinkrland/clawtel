// tenki lane: managed cloud spawnables behind the seam.
//
// tenki session primitives verified live (see coverage.md): pause frees
// compute while files and running processes survive resume, and destroy
// converges server-side within 90s. one session primitive backs both
// forms: the form is a contract about persistence, not a different
// machine. a workbench is a session we intend to keep (pause/resume,
// state preserved); a dock is the same session treated as disposable.

import {
  TenkiSandbox,
  type Session,
  type SessionState,
} from "@tenkicloud/sandbox";
import type {
  Spawnable,
  SpawnableExec,
  SpawnableForm,
  SpawnableProvider,
  SpawnableSpec,
  SpawnableStatus,
} from "./types.ts";

const decoder = new TextDecoder();

function notWired(what: string): Error {
  return new Error(`${what} is not wired in the tenki lane yet. nothing fakes.`);
}

function mapStatus(state: SessionState): SpawnableStatus {
  switch (state) {
    case "RUNNING":
    case "RESUMING":
      return "running";
    case "PAUSED":
    case "PAUSING":
      return "paused";
    case "CREATING":
      return "created";
    default:
      return "stopped";
  }
}

export type TenkiProviderOptions = {
  /** defaults to the TENKI_API_KEY env var. unset = lane closed. */
  apiKey?: string;
  baseUrl?: string;
};

export class TenkiProvider implements SpawnableProvider {
  readonly lane = "tenki" as const;
  readonly client: TenkiSandbox;
  private readonly apiKey: string | undefined;

  constructor(options: TenkiProviderOptions = {}) {
    const envKey =
      typeof process !== "undefined" ? process.env?.TENKI_API_KEY : undefined;
    this.apiKey = options.apiKey ?? envKey;
    this.client = new TenkiSandbox({
      authToken: this.apiKey,
      baseUrl: options.baseUrl,
    });
  }

  isAvailable(): boolean {
    return typeof this.apiKey === "string" && this.apiKey.length > 0;
  }

  private async requireSession(name: string): Promise<Session> {
    const sessions = await this.client.list();
    const session = sessions.find((s) => s.name === name);
    if (!session) throw new Error(`no spawnable named ${name} on the tenki lane`);
    return session;
  }

  async create(spec: SpawnableSpec): Promise<Spawnable> {
    if (!this.isAvailable()) throw new Error("tenki lane is closed: TENKI_API_KEY is unset");
    const session = await this.client.createAndWait({
      name: spec.name,
      cpuCores: spec.cpu,
      memoryMb: spec.memoryMib,
      diskSizeGb: spec.diskGiB,
    });
    if (spec.desktop) {
      await this.provisionDesktop(spec.name);
    }
    return this.wrap(session, spec.form);
  }

  /**
   * desktop provisioning, the verified recipe: a real x display plus
   * headed chrome inside the spawnable, so the join tab lives where a
   * screen exists to share. apt chrome .deb plus xvfb, ~42s on a fresh
   * image. the display is :0 at 1920x1080x24.
   */
  private async provisionDesktop(name: string): Promise<void> {
    // the spawnable runs as a user with passwordless sudo, never as
    // root; every step is exit-code checked, failures are never
    // swallowed
    const apt = await this.exec(
      name,
      "sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb wget ca-certificates",
      180_000,
    );
    if (apt.exitCode !== 0) {
      throw new Error(`desktop provisioning failed at apt: ${apt.stderr.slice(0, 200)}`);
    }
    const chrome = await this.exec(
      name,
      "wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -O /tmp/chrome.deb && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/chrome.deb",
      180_000,
    );
    if (chrome.exitCode !== 0) {
      throw new Error(`desktop provisioning failed at chrome install: ${chrome.stderr.slice(0, 200)}`);
    }
    // the display daemon: backgrounded, disowned, logged where the
    // room can read it back
    await this.exec(
      name,
      "nohup Xvfb :0 -screen 0 1920x1080x24 >/tmp/xvfb.log 2>&1 & sleep 1",
      15_000,
    );
    // no xdpyinfo dependency: the x socket is the proof the display is up
    const check = await this.exec(name, "test -S /tmp/.X11-unix/X0 && echo up", 15_000);
    if (!check.stdout.includes("up")) {
      throw new Error("desktop provisioning failed: the x display did not come up. read /tmp/xvfb.log in the spawnable.");
    }
  }

  /** expose a port through the tenki tunnel; the preview url reaches it from outside. */
  async exposePort(name: string, port: number): Promise<{ port: number; previewUrl: string }> {
    const session = await this.requireSession(name);
    const exposed = await session.exposePort(port);
    return { port: exposed.port, previewUrl: exposed.previewUrl };
  }

  private wrap(session: Session, _form: SpawnableForm): Spawnable {
    return {
      name: session.name,
      get status(): SpawnableStatus {
        return mapStatus(session.state);
      },
      screen: {
        grab: () => Promise.reject(notWired("screen.grab")),
        startCapture: () => {
          throw notWired("screen.startCapture");
        },
        stopCapture: () => Promise.reject(notWired("screen.stopCapture")),
      },
      input: {
        browser: null,
        xInput: null,
      },
    };
  }

  async start(name: string): Promise<void> {
    const session = await this.requireSession(name);
    if (session.state === "PAUSED" || session.state === "PAUSING") {
      await session.resume();
      await session.waitResumed(120_000);
      return;
    }
    if (session.state === "RUNNING" || session.state === "RESUMING") return;
    throw new Error(
      `tenki has no cold start from ${session.state}. this lane preserves spawnables via pause/resume, not stop/boot.`,
    );
  }

  async exec(name: string, command: string, timeoutMs = 30_000): Promise<SpawnableExec> {
    const session = await this.requireSession(name);
    const result = await session.exec(["bash", "-lc", command], { timeoutMs });
    return {
      exitCode: result.exitCode,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    };
  }

  async pause(name: string): Promise<void> {
    const session = await this.requireSession(name);
    await session.pause();
    await session.waitPaused(120_000);
  }

  async resume(name: string): Promise<void> {
    const session = await this.requireSession(name);
    await session.resume();
    await session.waitResumed(120_000);
  }

  async destroy(name: string): Promise<void> {
    const session = await this.requireSession(name);
    await session.close();
  }
}
