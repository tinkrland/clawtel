import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

// the integration test: a real python retelldb service on a free port,
// and the clawtel api driving it. real data in (meeting, capture,
// transcript), real grounding out, and a tool call that returns the
// ORIGINAL transcript text, verbatim. no mocks on either side.

const PORT = 8391;
const TOKEN = "retelldb-test-token";
let service: ChildProcess | null = null;
let app: { fetch: (req: Request) => Response | Promise<Response> };

async function waitHealthy(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("the retelldb service never came up");
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

before(async () => {
  process.env.CLAWTEL_API_TOKEN = TOKEN;
  process.env.RETELLDB_URL = `http://127.0.0.1:${PORT}`;
  process.env.CLAWTEL_PERSONA_ID = "test-persona";
  service = spawn("python3", ["retelldb/app.py"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitHealthy(`http://127.0.0.1:${PORT}`);
  // import AFTER the env is set: the client reads it at construction
  const mod = await import("../server.ts");
  app = mod.default as unknown as typeof app;
});

after(() => {
  service?.kill("SIGTERM");
});

test("the memory lane reports live", async () => {
  const res = await call("GET", "/api/memory/status");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, true);
});

test("a real write lands in memory: meeting, capture, transcript", async () => {
  const plan = await (await call("POST", "/api/meetings", {
    title: "office hours",
    join_url: "https://zoom.us/j/1234567890",
  })).json();

  await call("POST", "/api/captures", {
    quote: "the code FLASH-50 expires in 10 minutes",
    meeting_id: plan.meeting.id,
  });

  const tr = await (await call("POST", "/api/transcripts", {
    meeting_id: plan.meeting.id,
    segments: [
      { startMs: 0, speaker: "host", text: "welcome to office hours" },
      { startMs: 65000, speaker: "host", text: "the refund window is fourteen days" },
    ],
  })).json();

  const status = await (await call("GET", "/api/memory/status")).json();
  assert.equal(status.enabled, true);
  assert.ok(status.nodes >= 4, `expected at least 4 nodes, got ${status.nodes}`);
  assert.ok(status.artifacts >= 1, "the transcript artifact landed");

  // grounding reads what was written, with citations
  const brief = await (await call("POST", "/api/memory/ground", {
    query: "what is the refund window",
    platform: "zoom",
  })).json();
  assert.equal(brief.enabled, true);
  assert.equal(brief.retrieval, "lexical");
  assert.ok(brief.brief.length >= 1, "the brief has lines");
  const hit = brief.brief.find((l: { line: string }) => l.line.includes("fourteen days"));
  assert.ok(hit, "the transcript line grounds the question");
  assert.equal(hit.citation.split("@")[1], "0:01:05", "the citation is the transcript time");

  // the tool returns the ORIGINAL transcript, verbatim
  const artifactId = brief.artifacts[0].id;
  const original = await (await call("POST", "/api/memory/tool", {
    name: "get_artifact",
    args: { artifact_id: artifactId },
    platform: "zoom",
  })).json();
  assert.equal(original.ok, true);
  assert.match(original.result.content, /0:01:05 host: the refund window is fourteen days/);

  // and a line span is exact
  const span = await (await call("POST", "/api/memory/tool", {
    name: "get_artifact",
    args: { artifact_id: artifactId, line_from: 2, line_to: 2 },
    platform: "zoom",
  })).json();
  assert.equal(span.ok, true);
  assert.equal(span.result.content, "0:01:05 host: the refund window is fourteen days");

  // unknown tools are refused with the registry
  const unknown = await (await call("POST", "/api/memory/tool", {
    name: "rm_rf",
    args: {},
    platform: "zoom",
  })).json();
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /registry/);

  // the transcript record itself is still the honest source
  assert.ok(tr.transcript.id);
});

test("scope walls hold through the api: unanchored session, public surface", async () => {
  // a capture heard on a livestream does not ride into a zoom meeting
  await call("POST", "/api/captures", { quote: "use the twitch code STREAM-10" });
  // a platform the scope rules do not know is not a wildcard: every
  // node drops with a reason, and the answer stays honest
  const probe = await (await call("POST", "/api/memory/query", {
    query: "twitch code",
    platform: "meeting_unknown_platform_probe",
  })).json();
  assert.equal(probe.enabled, true);
  assert.equal(probe.nodes.length, 0);
  assert.ok(probe.dropped.length > 0);
  assert.equal(probe.dropped[0].reason, "unknown_surface");

  // a declared surface answers
  const zoom = await (await call("POST", "/api/memory/query", {
    query: "refund",
    platform: "zoom",
  })).json();
  assert.equal(zoom.enabled, true);
  assert.ok(Array.isArray(zoom.dropped));
});

test("memory routes refuse an undeclared platform", async () => {
  const res = await call("POST", "/api/memory/ground", { query: "anything" });
  assert.equal(res.status, 400);
});
