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

  /**
   * the speaking seam: pulseaudio inside the spawnable, a null sink and
   * a remap source, so a rendered line played into the sink is what the
   * join tab hears as its microphone. idempotent, and honest when the
   * container has no pulseaudio: the desktop still works, speaking does
   * not.
   */
  async provisionMic(name: string): Promise<{ ok: boolean; server?: string; rung?: string; reason?: string }> {
    const script = [
      "set -u",
      "command -v pulseaudio >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq pulseaudio pulseaudio-utils >/tmp/mic-apt.log 2>&1 || { echo rung=apt-failed; exit 0; }",
      "sudo pkill -x pulseaudio 2>/dev/null || true",
      "sleep 1",
      "export XDG_RUNTIME_DIR=/tmp/pulse",
      "mkdir -p /tmp/pulse && chmod 700 /tmp/pulse",
      "setsid pulseaudio -n --exit-idle-time=-1 --load=module-native-protocol-unix --load='module-null-sink sink_name=clawtel_mic sink_properties=device.description=clawtel_mic' --load='module-remap-source master=clawtel_mic.monitor source_name=clawtel_source source_properties=device.description=clawtel_mic' </dev/null >/tmp/pulse-user.log 2>&1 &",
      "sleep 4",
      "if PULSE_SERVER=unix:/tmp/pulse/pulse/native timeout 6 pactl info >/tmp/probe-user.txt 2>&1; then echo rung=user; echo server=unix:/tmp/pulse/pulse/native; echo sources=$(PULSE_SERVER=unix:/tmp/pulse/pulse/native pactl list short sources | grep -c clawtel_source); exit 0; fi",
      "sudo pkill -x pulseaudio 2>/dev/null || true",
      "sleep 1",
      "sudo nohup pulseaudio --system -n --disallow-exit --exit-idle-time=-1 --load='module-native-protocol-unix auth-anonymous=1 socket=/tmp/pulse-system' --load='module-null-sink sink_name=clawtel_mic' --load='module-remap-source master=clawtel_mic.monitor source_name=clawtel_source' --log-target=file:/tmp/pulse-sys.log </dev/null >/dev/null 2>&1 &",
      "sleep 4",
      "if PULSE_SERVER=unix:/tmp/pulse-system timeout 6 pactl info >/tmp/probe-sys.txt 2>&1; then echo rung=system; echo server=unix:/tmp/pulse-system; echo sources=$(PULSE_SERVER=unix:/tmp/pulse-system pactl list short sources | grep -c clawtel_source); exit 0; fi",
      "echo rung=none",
      "echo user_err=$(tail -1 /tmp/probe-user.txt 2>/dev/null | tr ' ' '_')",
      "echo sys_err=$(tail -1 /tmp/probe-sys.txt 2>/dev/null | tr ' ' '_')",
    ].join("\n");
    const res = await this.exec(name, script, 180_000);
    const field = (k: string) =>
      res.stdout.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
    const rung = field("rung");
    if ((rung === "user" || rung === "system") && field("sources") !== "0") {
      return { ok: true, server: field("server"), rung };
    }
    const why = rung === "apt-failed"
      ? "apt could not install pulseaudio"
      : `the daemon never served a client (${field("user_err") || "user rung"} / ${field("sys_err") || "system rung"})`;
    return { ok: false, rung: rung || "none", reason: why };
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
