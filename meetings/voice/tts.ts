// the speaking lane: turn the voice layer's `speak` line into audio.
//
// ladder, same discipline as the llm and embedder lanes: rungs tried in
// order, a failing rung walked past with its own receipt, never trusted
// because it exists. edge-tts needs no key and speaks neural voices;
// elevenlabs is the paid rung when a key is present.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TtsResult {
  ok: boolean;
  provider?: string;
  mime?: string;
  path?: string;
  bytes?: number;
  durationMs?: number;
  reason?: string;
}

export interface TtsDeps {
  runEdgeTts(text: string, voice: string, outPath: string): Promise<void>;
  runElevenLabs(text: string, voice: string, key: string, outPath: string): Promise<void>;
  probeDuration(path: string): Promise<number | undefined>;
  workDir(): Promise<string>;
}

const EDGE = "edge-tts";
const ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM";

function run(cmd: string, args: string[], stdoutTo?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", stdoutTo ? "pipe" : "ignore", "pipe"] });
    let err = "";
    child.stderr?.on("data", (d) => { err += String(d); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 200)}`))));
    if (stdoutTo && child.stdout) {
      // elevenlabs streams audio on stdout
      const chunks: Buffer[] = [];
      child.stdout.on("data", (c) => chunks.push(Buffer.from(c)));
      child.on("close", async (code) => {
        if (code !== 0) return;
        const { writeFile } = await import("node:fs/promises");
        await writeFile(stdoutTo, Buffer.concat(chunks));
      });
    }
  });
}

export const defaultDeps: TtsDeps = {
  runEdgeTts: async (text, voice, out) => {
    await run(EDGE, ["--voice", voice, "--text", text, "--write-media", out]);
  },
  runElevenLabs: async (text, voice, key, out) => {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    });
    if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const { writeFile } = await import("node:fs/promises");
    await writeFile(out, buf);
  },
  probeDuration: async (path) => {
    return new Promise((resolve) => {
      const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
      let out = "";
      child.stdout.on("data", (d) => { out += String(d); });
      child.on("error", () => resolve(undefined));
      child.on("close", () => {
        const secs = Number(out.trim());
        resolve(Number.isFinite(secs) ? Math.round(secs * 1000) : undefined);
      });
    });
  },
  workDir: async () => await mkdtemp(join(tmpdir(), "clawtel-voice-")),
};

export interface SpeakOptions {
  deps?: TtsDeps;
  voice?: string;
  elevenKey?: string;
}

/** synthesize a line. the ladder walks past a rung that fails. */
export async function synthesize(text: string, opts: SpeakOptions = {}): Promise<TtsResult> {
  const line = (text || "").trim();
  if (!line) return { ok: false, reason: "there is nothing to say" };
  const deps = opts.deps ?? defaultDeps;
  const voice = opts.voice ?? process.env.CLAWTEL_TTS_VOICE ?? "en-US-AriaNeural";
  const key = opts.elevenKey ?? process.env.ELEVENLABS_API_KEY;
  const dir = await deps.workDir();
  const errors: string[] = [];

  if (voice && !/^[\w-]+$/.test(voice)) return { ok: false, reason: "the voice name is not a plain identifier" };

  try {
    const out = join(dir, "line.mp3");
    await deps.runEdgeTts(line, voice, out);
    const info = await stat(out);
    if (info.size > 0) {
      return { ok: true, provider: `edge-tts:${voice}`, mime: "audio/mpeg", path: out,
        bytes: info.size, durationMs: await deps.probeDuration(out) };
    }
    errors.push("edge-tts produced an empty file");
  } catch (err) {
    errors.push(`edge-tts: ${(err as Error).message}`);
  }

  if (key) {
    try {
      const out = join(dir, "line-eleven.mp3");
      await deps.runElevenLabs(line, ELEVEN_VOICE, key, out);
      const info = await stat(out);
      if (info.size > 0) {
        return { ok: true, provider: "elevenlabs", mime: "audio/mpeg", path: out,
          bytes: info.size, durationMs: await deps.probeDuration(out) };
      }
      errors.push("elevenlabs produced an empty file");
    } catch (err) {
      errors.push(`elevenlabs: ${(err as Error).message}`);
    }
  }

  return { ok: false, reason: errors.join(" | ") || "no tts rung is available" };
}

export async function readAudio(result: TtsResult): Promise<Buffer | null> {
  if (!result.ok || !result.path) return null;
  try {
    return await readFile(result.path);
  } catch {
    return null;
  }
}
