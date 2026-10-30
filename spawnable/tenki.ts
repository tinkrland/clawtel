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
import type { MicTarget } from "../meetings/voice/mic.ts";

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
  /**
   * the room mic, the recipe that actually works in this image.
   *
   * two sessions of guessing said pulseaudio: it starts, binds its
   * socket and then never serves a client, because it wants a session
   * bus that a spawnable does not have. pipewire can serve pulse
   * clients, but only with wireplumber on a real session bus. so: a
   * long lived dbus at a fixed path, pipewire, wireplumber,
   * pipewire-pulse, a null sink, and then a tone round trip that proves
   * audio physically moves before this reports ok.
   */
  async provisionMic(name: string): Promise<MicTarget & { ok: boolean; rung?: string; reason?: string }> {
    const script = [
      "set -u",
      "command -v pipewire >/dev/null && command -v pactl >/dev/null && command -v paplay >/dev/null && command -v parec >/dev/null && command -v ffmpeg >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq pipewire pipewire-pulse wireplumber dbus dbus-x11 pulseaudio-utils ffmpeg >/tmp/mic-apt.log 2>&1 || { echo rung=apt-failed; exit 0; }",
      "export XDG_RUNTIME_DIR=/tmp/pwrun; export PULSE_SERVER=unix:/tmp/pwrun/pulse/native; mkdir -p $XDG_RUNTIME_DIR; chmod 700 $XDG_RUNTIME_DIR",
      "[ -S /tmp/clawtel-dbus ] || dbus-daemon --session --fork --address=unix:path=/tmp/clawtel-dbus >/dev/null 2>&1 || true",
      "export DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/clawtel-dbus",
      "pactl info >/dev/null 2>&1 || {",
      "  pgrep -x pipewire >/dev/null || setsid pipewire </dev/null >/tmp/pw.log 2>&1 &",
      "  sleep 1",
      "  pgrep -x wireplumber >/dev/null || setsid wireplumber </dev/null >/tmp/wp.log 2>&1 &",
      "  sleep 2",
      "  pgrep -x pipewire-pulse >/dev/null || setsid pipewire-pulse </dev/null >/tmp/pwp.log 2>&1 &",
      "  sleep 3",
      "}",
      "pactl info >/dev/null 2>&1 && echo pactl=ok || { echo pactl=fail; exit 0; }",
      "pactl list short sinks | grep -q clawtel_mic || pactl load-module module-null-sink sink_name=clawtel_mic sink_properties=device.description=clawtel_mic >/dev/null 2>&1",
      "pactl list short sources | grep -q clawtel_mic.monitor && echo source=clawtel_mic.monitor || echo source=none",
      "python3 - <<'PY'",
      "import math, struct, wave",
      "w = wave.open('/tmp/probe-tone.wav','w'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000)",
      "w.writeframes(b''.join(struct.pack('<hh', int(12000*math.sin(2*math.pi*440*i/48000)), int(12000*math.sin(2*math.pi*440*i/48000))) for i in range(96000)))",
      "w.close()",
      "PY",
      "(timeout 6 parec --device=clawtel_mic.monitor --format=s16le --rate=48000 --channels=2 >/tmp/probe-cap.raw 2>/dev/null &)",
      "sleep 1",
      "paplay --device=clawtel_mic /tmp/probe-tone.wav >/tmp/probe-play.log 2>&1 || true",
      "sleep 2",
      "sleep 1; echo tone_peak=$(python3 -c \"import struct;d=open('/tmp/probe-cap.raw','rb').read();n=len(d)//2;s=struct.unpack('<%dh'%n,d) if n else (0,);print(max(abs(x) for x in s))\")",
      "echo dbus=$([ -S /tmp/clawtel-dbus ] && echo unix:path=/tmp/clawtel-dbus || echo none)",
    ].join("\n");

    const res = await this.exec(name, script, 240_000);
    const field = (k: string) =>
      res.stdout.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
    const target: MicTarget = {
      server: "unix:/tmp/pwrun/pulse/native",
      sink: "clawtel_mic",
      source: field("source") === "none" ? "" : "clawtel_mic.monitor",
      dbus: field("dbus") === "none" ? "" : field("dbus"),
    };
    const peak = Number(field("tone_peak") || 0);

    if (field("pactl") === "ok" && target.source && peak > 1000) {
      return { ok: true, rung: "pipewire", ...target };
    }
    const why = field("rung") === "apt-failed"
      ? "apt could not install pipewire"
      : field("pactl") !== "ok"
        ? "pipewire-pulse never answered pactl"
        : !target.source
          ? "the null sink monitor never appeared as a source"
          : `a tone round trip captured peak ${peak}, which is silence`;
    return { ok: false, rung: "none", reason: why, ...target };
  }

  /**
   * speak a rendered line inside the box, where the meeting hears it.
   *
   * the audio is written into the box (the file has to travel: paplay
   * there cannot read our filesystem), converted if needed, and played
   * into the sink the join tab reads. the monitor capture is the
   * receipt: a peak above silence proves the room actually got audio,
   * not that a command exited zero.
   */
  async speakInBox(
    name: string,
    target: MicTarget,
    audioPath: string,
    verify = true,
  ): Promise<{ ok: boolean; peak?: number; reason?: string }> {
    const session = await this.requireSession(name);
    const { readFile } = await import("node:fs/promises");
    const bytes = await readFile(audioPath);
    // the sdk refuses writes outside the box workdir, so the line lands
    // next to the user's home rather than in /tmp
    const remote = "/home/tenki/clawtel-line" + (audioPath.match(/\.[a-z0-9]+$/i)?.[0] ?? ".mp3");
    await session.writeFile(remote, new Uint8Array(bytes));

    const env = [
      `PULSE_SERVER=${target.server}`,
      target.dbus ? `DBUS_SESSION_BUS_ADDRESS=${target.dbus}` : "",
      "XDG_RUNTIME_DIR=/tmp/pwrun",
    ].filter(Boolean).join(" ");
    const wav = "/home/tenki/clawtel-line.wav";
    const play = `ffmpeg -v error -y -i ${remote} -ar 48000 -ac 2 ${wav} && ${env} paplay --device ${target.sink} ${wav}`;

    const script = verify
      ? `set -u; (${env} timeout 8 parec --device=${target.source} --format=s16le --rate=48000 --channels=2 >/tmp/clawtel-cap.raw 2>/dev/null &); sleep 1; ${play} >/tmp/clawtel-play.log 2>&1; echo play=$?; sleep 1; echo peak=$(python3 -c "import struct;d=open('/tmp/clawtel-cap.raw','rb').read();n=len(d)//2;s=struct.unpack('<%dh'%n,d) if n else (0,);print(max(abs(x) for x in s))" 2>/dev/null || echo 0)`
      : `set -u; ${play} >/tmp/clawtel-play.log 2>&1; echo play=$?`;

    const res = await this.exec(name, script, 120_000);
    const field = (k: string) =>
      res.stdout.split("\n").find((l) => l.startsWith(`${k}=`))?.slice(k.length + 1).trim() ?? "";
    const playCode = field("play");
    const peak = Number(field("peak") || 0);
    if (playCode !== "0") {
      return { ok: false, reason: `paplay exited ${playCode || "unknown"} in the box` };
    }
    if (verify && peak <= 1000) {
      return { ok: false, peak, reason: "the line played but the monitor captured silence" };
    }
    return { ok: true, peak };
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
