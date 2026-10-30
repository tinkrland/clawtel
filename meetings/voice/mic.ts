// the microphone seam: a rendered line becomes meeting input.
//
// pulseaudio gives us a null sink plus a remap source, so the container
// reports a real microphone. playing the line into the sink is the
// same as speaking into it. chrome picks it up with PULSE_SOURCE set,
// which is the only flag the browser lane needs.
//
// proven here (oct 29 2026): edge-tts mp3 -> wav -> clawtel_mic -> the
// monitor source captured non-zero audio, peak 13573.

import { spawn } from "node:child_process";

export const SINK = "clawtel_mic";
export const SOURCE = "clawtel_source";

/** where a remote box keeps its room mic. empty fields mean absent. */
export interface MicTarget {
  server: string;
  sink: string;
  source: string;
  dbus?: string;
}

export interface MicStatus {
  ok: boolean;
  sink: string | null;
  source: string | null;
  reason?: string;
}

export type Exec = (
  cmd: string,
  args: string[],
  env?: Record<string, string>,
) => Promise<{ code: number; out: string }>;

export const shellExec: Exec = (cmd, args, env) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let out = "";
    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { out += String(d); });
    child.on("error", () => resolve({ code: 127, out: "" }));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });

export async function micStatus(exec: Exec = shellExec): Promise<MicStatus> {
  const sinks = await exec("pactl", ["list", "short", "sinks"]);
  if (sinks.code !== 0) {
    return { ok: false, sink: null, source: null, reason: "no pulseaudio in this container: pactl is missing or the daemon is not running" };
  }
  const sources = await exec("pactl", ["list", "short", "sources"]);
  const hasSink = sinks.out.split("\n").some((l) => l.includes(SINK));
  const hasSource = sources.out.split("\n").some((l) => l.includes(SOURCE));
  if (!hasSink || !hasSource) {
    return { ok: false, sink: hasSink ? SINK : null, source: hasSource ? SOURCE : null,
      reason: hasSink ? "the remap source is missing" : "the null sink is missing" };
  }
  return { ok: true, sink: SINK, source: SOURCE };
}

/** idempotent: create the sink and source only when they are absent. */
export async function ensureMic(exec: Exec = shellExec): Promise<MicStatus> {
  const before = await micStatus(exec);
  if (before.ok) return before;
  if (before.reason?.startsWith("no pulseaudio")) return before;

  if (!before.sink) {
    await exec("pactl", ["load-module", "module-null-sink", `sink_name=${SINK}`,
      `sink_properties=device.description=${SINK}`]);
  }
  if (!before.source) {
    await exec("pactl", ["load-module", "module-remap-source", `master=${SINK}.monitor`,
      `source_name=${SOURCE}`, `source_properties=device.description=${SINK}`]);
  }
  return micStatus(exec);
}

/** the env a client needs to reach a given box's audio server. */
export function micEnv(target?: MicTarget | null): Record<string, string> {
  // the local container answers on the default socket with no env at all
  if (!target || !target.server) return {};
  const env: Record<string, string> = { PULSE_SERVER: target.server };
  if (target.dbus) env.DBUS_SESSION_BUS_ADDRESS = target.dbus;
  if (target.server.includes("/tmp/pwrun")) env.XDG_RUNTIME_DIR = "/tmp/pwrun";
  return env;
}

/** speak a rendered line into the sink. mp3 is converted first. */
export async function playIntoMic(
  audioPath: string,
  exec: Exec = shellExec,
  target?: MicTarget | null,
): Promise<{ ok: boolean; reason?: string }> {
  const env = micEnv(target);
  // a remote box owns its own sink: probing it locally would be a lie
  if (!target?.server) {
    const status = await ensureMic(exec);
    if (!status.ok) return { ok: false, reason: status.reason };
  }

  const wav = audioPath.replace(/\.(mp3|m4a|opus|webm)$/i, ".wav");
  const conv = await exec("ffmpeg", ["-v", "error", "-y", "-i", audioPath, "-ar", "48000", "-ac", "2", wav]);
  if (conv.code !== 0) return { ok: false, reason: "the line could not be converted to wav" };

  const played = await exec("paplay", ["--device", target?.sink ?? SINK, wav], env);
  return played.code === 0 ? { ok: true } : { ok: false, reason: "paplay could not speak the line" };
}

/** what the browser lane needs to hear the sink as a microphone. */
export function browserMicRecipe(): { env: Record<string, string>; flags: string[]; note: string } {
  return {
    env: { PULSE_SOURCE: SOURCE },
    flags: ["--use-fake-ui-for-media-stream"],
    note: "the browser lane launches chrome with PULSE_SOURCE pointing at the remap source; the fake-ui flag only skips the permission prompt, it does not substitute a device",
  };
}
