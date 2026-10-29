import assert from "node:assert/strict";
import test from "node:test";
import { synthesize } from "../meetings/voice/tts.ts";
import { ensureMic, micStatus } from "../meetings/voice/mic.ts";
import type { Exec } from "../meetings/voice/mic.ts";
import type { TtsDeps } from "../meetings/voice/tts.ts";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = async () => await mkdtemp(join(tmpdir(), "tts-test-"));

const deps = (over: Partial<TtsDeps> = {}): TtsDeps => ({
  workDir: dir,
  runEdgeTts: async (_t, _v, out) => { await writeFile(out, Buffer.alloc(64, 1)); },
  runElevenLabs: async (_t, _v, _k, out) => { await writeFile(out, Buffer.alloc(128, 2)); },
  probeDuration: async () => 1234,
  ...over,
});

test("the ladder speaks with edge first and reports it", async () => {
  const r = await synthesize("digital goods are seven days", { deps: deps() });
  assert.equal(r.ok, true);
  assert.match(r.provider ?? "", /^edge-tts/);
  assert.equal(r.bytes, 64);
});

test("a dead rung is walked past, and the receipt names it", async () => {
  const r = await synthesize("a line", {
    deps: deps({ runEdgeTts: async () => { throw new Error("edge is down"); }, }),
    elevenKey: "k",
  });
  assert.equal(r.ok, true);
  assert.equal(r.provider, "elevenlabs");
});

test("with no working rung the answer is a refusal, not silence", async () => {
  const r = await synthesize("a line", {
    deps: deps({ runEdgeTts: async () => { throw new Error("edge is down"); } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /edge-tts: edge is down/);
});

test("an empty line is refused before any rung runs", async () => {
  let ran = false;
  const r = await synthesize("  ", { deps: deps({ runEdgeTts: async () => { ran = true; } }) });
  assert.equal(r.ok, false);
  assert.equal(ran, false);
});

const fakeExec = (opts: { sinks?: string; sources?: string; pactlMissing?: boolean; playCode?: number }): Exec =>
  async (cmd, args) => {
    if (cmd !== "pactl") return { code: 0, out: "" };
    if (opts.pactlMissing) return { code: 127, out: "" };
    const key = args.includes("sinks") ? "sinks" : "sources";
    const out = key === "sinks" ? opts.sinks ?? "" : opts.sources ?? "";
    return { code: 0, out };
  };

test("a container with no pulseaudio says so plainly", async () => {
  const s = await micStatus(fakeExec({ pactlMissing: true }));
  assert.equal(s.ok, false);
  assert.match(s.reason ?? "", /no pulseaudio/);
});

test("a missing sink is created, and an existing one is left alone", async () => {
  const created: string[] = [];
  const state = { sink: false, source: false };
  const exec: Exec = async (cmd, args) => {
    if (args.includes("load-module")) {
      created.push(args[1] ?? "");
      if (args[1]?.includes("null-sink")) state.sink = true;
      if (args[1]?.includes("remap-source")) state.source = true;
      return { code: 0, out: "9" };
    }
    if (args.includes("sinks")) return { code: 0, out: state.sink ? "0 clawtel_mic" : "" };
    return { code: 0, out: state.source ? "1 clawtel_source" : "" };
  };
  const first = await ensureMic(exec);
  assert.equal(first.ok, true);
  created.length = 0;
  const second = await ensureMic(exec);
  assert.equal(second.ok, true);
  assert.deepEqual(created, []);
});

test("the browser recipe points chrome at the remap source", async () => {
  const { browserMicRecipe } = await import("../meetings/voice/mic.ts");
  const recipe = browserMicRecipe();
  assert.equal(recipe.env.PULSE_SOURCE, "clawtel_source");
  assert.ok(recipe.flags.includes("--use-fake-ui-for-media-stream"));
});

test("say answers, renders and plays, keeping each receipt apart", async () => {
  const { say } = await import("../meetings/voice/say.ts");
  const meeting = { id: "m1", title: "office hours", platform: "zoom", joinUrl: "https://zoom.us/j/1",
    joinDelayMinutes: 0, status: "in_meeting", createdAt: new Date().toISOString() } as never;
  const memory = {
    isAvailable: () => true,
    answer: async () => ({ ok: true, data: { ok: true, answer: "Digital goods are seven days (abc123def4567890@0:02:44).",
      citations: ["abc123def4567890@0:02:44"], tool_calls: [{ tool: "search_memory" }], provider: "featherless:qwen" } }),
  };
  const out = await say(meeting, {
    personaId: "clawtel", memory, question: "how long for digital?",
    tts: { deps: deps() }, exec: fakeExec({ sinks: "0 clawtel_mic", sources: "1 clawtel_source" }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.speak.includes("abc123def4567890"), false);
  assert.deepEqual(out.sources, ["abc123def4567890@0:02:44"]);
  assert.equal(out.audio?.provider.startsWith("edge-tts"), true);
  assert.equal(out.played?.ok, true);
});

test("a rendered line that cannot be played says so, and still counts as rendered", async () => {
  const { say } = await import("../meetings/voice/say.ts");
  const meeting = { id: "m1", title: "x", platform: "zoom", joinUrl: "u", joinDelayMinutes: 0,
    status: "in_meeting", createdAt: new Date().toISOString() } as never;
  const out = await say(meeting, {
    personaId: "clawtel", memory: { isAvailable: () => true, answer: async () => ({ ok: true }) },
    text: "a short line", tts: { deps: deps() }, exec: fakeExec({ pactlMissing: true }),
  });
  assert.equal(out.ok, true);
  assert.ok(out.audio);
  assert.equal(out.played?.ok, false);
  assert.match(out.played?.reason ?? "", /no pulseaudio/);
});

test("the join tab launches pointed at the room mic", async () => {
  const { chromeLaunchCommand } = await import("../meetings/joining/spawnable-browser.ts");
  const cmd = chromeLaunchCommand(false);
  assert.match(cmd, /PULSE_SOURCE=clawtel_source/);
  assert.match(cmd, /DISPLAY=:0/);
  assert.equal(cmd.includes("auto-select-desktop-capture-source"), false);
  assert.match(chromeLaunchCommand(true), /auto-select-desktop-capture-source/);
  assert.match(chromeLaunchCommand(false, "unix:/tmp/pulse-system"), /PULSE_SERVER=unix:\/tmp\/pulse-system/);
  assert.equal(chromeLaunchCommand(false).includes("PULSE_SERVER"), false);
});

test("provisionMic claims a mic only when the daemon served a client", async () => {
  const { TenkiProvider } = await import("../spawnable/tenki.ts");
  const provider = new TenkiProvider();
  const stub = (stdout: string) => {
    (provider as unknown as { exec: unknown }).exec = async () => ({ exitCode: 0, stdout, stderr: "" });
    return provider;
  };
  const served = await stub("rung=user\nserver=unix:/tmp/pulse/pulse/native\nsources=1\n").provisionMic("box");
  assert.equal(served.ok, true);
  assert.equal(served.server, "unix:/tmp/pulse/pulse/native");

  const silent = await stub("rung=none\nuser_err=Connection_refused\nsys_err=Timeout\n").provisionMic("box");
  assert.equal(silent.ok, false);
  assert.equal(silent.rung, "none");
  assert.match(silent.reason ?? "", /never served a client/);
  assert.match(silent.reason ?? "", /Connection_refused/);
});

test("a socket without the remap source is not a microphone", async () => {
  const { TenkiProvider } = await import("../spawnable/tenki.ts");
  const provider = new TenkiProvider();
  (provider as unknown as { exec: unknown }).exec = async () => ({
    exitCode: 0, stdout: "rung=system\nserver=unix:/tmp/pulse-system\nsources=0\n", stderr: "",
  });
  const out = await provider.provisionMic("box");
  assert.equal(out.ok, false);
});
