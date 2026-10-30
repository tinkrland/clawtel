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
  // no mic passed: no audio env at all, the tab joins deaf
  assert.equal(cmd.includes("PULSE_SOURCE"), false);
  assert.match(cmd, /DISPLAY=:0/);
  assert.equal(cmd.includes("auto-select-desktop-capture-source"), false);
  assert.match(chromeLaunchCommand(true), /auto-select-desktop-capture-source/);
  const withMic = chromeLaunchCommand(false, {
    server: "unix:/tmp/pwrun/pulse/native",
    source: "clawtel_mic.monitor",
    dbus: "unix:path=/tmp/clawtel-dbus",
  });
  assert.match(withMic, /PULSE_SERVER=unix:\/tmp\/pwrun\/pulse\/native/);
  assert.match(withMic, /PULSE_SOURCE=clawtel_mic\.monitor/);
  assert.match(withMic, /DBUS_SESSION_BUS_ADDRESS=unix:path=\/tmp\/clawtel-dbus/);
  assert.equal(chromeLaunchCommand(false).includes("PULSE_SERVER"), false);
});

test("provisionMic claims a mic only after a tone round trip carries audio", async () => {
  const { TenkiProvider } = await import("../spawnable/tenki.ts");
  const provider = new TenkiProvider();
  const stub = (stdout: string) => {
    (provider as unknown as { exec: unknown }).exec = async () => ({ exitCode: 0, stdout, stderr: "" });
    return provider;
  };
  const served = await stub(
    "pactl=ok\nsource=clawtel_mic.monitor\ntone_peak=12000\ndbus=unix:path=/tmp/clawtel-dbus\n",
  ).provisionMic("box");
  assert.equal(served.ok, true);
  assert.equal(served.rung, "pipewire");
  assert.equal(served.source, "clawtel_mic.monitor");
  assert.equal(served.dbus, "unix:path=/tmp/clawtel-dbus");

  const silent = await stub("pactl=ok\nsource=clawtel_mic.monitor\ntone_peak=0\ndbus=none\n").provisionMic("box");
  assert.equal(silent.ok, false);
  assert.match(silent.reason ?? "", /silence/);

  const noServer = await stub("pactl=fail\n").provisionMic("box");
  assert.equal(noServer.ok, false);
  assert.match(noServer.reason ?? "", /never answered pactl/);

  const noMonitor = await stub("pactl=ok\nsource=none\ntone_peak=12000\ndbus=none\n").provisionMic("box");
  assert.equal(noMonitor.ok, false);
  assert.match(noMonitor.reason ?? "", /monitor/);
});

test("speakInBox writes the line into the box and proves it was heard", async () => {
  const { TenkiProvider } = await import("../spawnable/tenki.ts");
  const { writeFile } = await import("node:fs/promises");
  const linePath = "/tmp/clawtel-test-line.mp3";
  await writeFile(linePath, Buffer.alloc(32, 1));

  const provider = new TenkiProvider();
  let wrote = "";
  (provider as unknown as { requireSession: unknown }).requireSession = async () => ({
    writeFile: async (path: string) => { wrote = path; },
  });

  const mic = { server: "unix:/tmp/pwrun/pulse/native", sink: "clawtel_mic", source: "clawtel_mic.monitor", dbus: "unix:path=/tmp/clawtel-dbus" };
  (provider as unknown as { exec: unknown }).exec = async () => ({ exitCode: 0, stdout: "play=0\npeak=13785\n", stderr: "" });
  const heard = await provider.speakInBox("box", mic, linePath);
  assert.equal(heard.ok, true);
  assert.equal(heard.peak, 13785);
  assert.match(wrote, /^\/home\/tenki\/clawtel-line/);

  (provider as unknown as { exec: unknown }).exec = async () => ({ exitCode: 0, stdout: "play=0\npeak=0\n", stderr: "" });
  const silent = await provider.speakInBox("box", mic, linePath);
  assert.equal(silent.ok, false);
  assert.match(silent.reason ?? "", /silence/);

  (provider as unknown as { exec: unknown }).exec = async () => ({ exitCode: 0, stdout: "play=2\npeak=0\n", stderr: "" });
  const failed = await provider.speakInBox("box", mic, linePath);
  assert.equal(failed.ok, false);
  assert.match(failed.reason ?? "", /exited 2/);
});
