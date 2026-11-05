import assert from "node:assert/strict";
import test from "node:test";
import app from "../server.ts";
import { resetHostings } from "../hosting/store.ts";

const TOKEN = "hosting-token";
process.env.CLAWTEL_API_TOKEN = TOKEN;
delete process.env.CLAWTEL_BROWSER_LANE;

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const demo = { name: "the walkthrough", startUrl: "https://example.com", steps: [{ action: "click", label: "open pricing", selector: "#pricing" }] };
const agenda = {
  title: "office hours: refunds",
  segments: [
    { kind: "welcome", title: "hello", minutes: 3 },
    { kind: "demo", title: "the product", minutes: 10, demo },
    { kind: "qa", title: "questions", minutes: 15 },
    { kind: "close", title: "bye", minutes: 2 },
  ],
};

async function aMeeting(): Promise<string> {
  const res = await call("POST", "/api/meetings", { title: "office hours", platform: "zoom", join_url: "https://zoom.us/j/1" });
  const body = await res.json() as { meeting: { id: string } };
  return body.meeting.id;
}

test("a hosting night is built from an agenda on a meeting that exists", async () => {
  resetHostings();
  const meetingId = await aMeeting();
  const res = await call("POST", "/api/hostings", { meeting_id: meetingId, agenda });
  assert.equal(res.status, 200);
  const body = await res.json() as { hosting: { id: string; phase: string; agenda: { totalMinutes: number } } };
  assert.equal(body.hosting.phase, "lobby");
  assert.equal(body.hosting.agenda.totalMinutes, 30);

  const missing = await call("POST", "/api/hostings", { meeting_id: "nope", agenda });
  assert.equal(missing.status, 404);

  const badAgenda = await call("POST", "/api/hostings", { meeting_id: meetingId, agenda: { title: "x", segments: [] } });
  assert.equal(badAgenda.status, 400);
});

test("the night moves when the host says so, and the clock is theirs", async () => {
  resetHostings();
  const meetingId = await aMeeting();
  const created = await (await call("POST", "/api/hostings", { meeting_id: meetingId, agenda })).json() as { hosting: { id: string } };
  const id = created.hosting.id;

  const started = await (await call("POST", `/api/hostings/${id}/start`, { now: 1000 })).json() as { hosting: { phase: string; index: number } };
  assert.equal(started.hosting.phase, "live");
  assert.equal(started.hosting.index, 0);

  const advanced = await (await call("POST", `/api/hostings/${id}/advance`, { now: 2000 })).json() as { hosting: { index: number }; segment: { kind: string } };
  assert.equal(advanced.hosting.index, 1);
  assert.equal(advanced.segment.kind, "demo");

  const paused = await (await call("POST", `/api/hostings/${id}/pause`, { now: 3000 })).json() as { hosting: { phase: string } };
  assert.equal(paused.hosting.phase, "paused");
});

test("guests are held by default and admitted only when the policy says so", async () => {
  resetHostings();
  const meetingId = await aMeeting();
  const created = await (await call("POST", "/api/hostings", { meeting_id: meetingId, agenda })).json() as { hosting: { id: string } };
  const id = created.hosting.id;

  const held = await (await call("POST", `/api/hostings/${id}/guests`, { guest_id: "g1", name: "sam" })).json() as { decision: string };
  assert.equal(held.decision, "hold");

  const admitted = await (await call("POST", `/api/hostings/${id}/guests`, { guest_id: "g2", name: "sam", policy: "all" })).json() as { decision: string };
  assert.equal(admitted.decision, "admit");

  const status = await (await call("GET", `/api/hostings/${id}`)).json() as { hosting: { guests: { id: string }[] } };
  assert.deepEqual(status.hosting.guests.map((g) => g.id), ["g2"]);

  const blocked = await (await call("POST", `/api/hostings/${id}/guests`, { guest_id: "g3", policy: "all", blocked: true })).json() as { decision: string };
  assert.equal(blocked.decision, "refuse");
});

test("the listing renders and refuses to publish", async () => {
  resetHostings();
  const meetingId = await aMeeting();
  const created = await (await call("POST", "/api/hostings", { meeting_id: meetingId, agenda })).json() as { hosting: { id: string } };
  const res = await call("POST", `/api/hostings/${created.hosting.id}/listing`, { host_name: "clawtel", timezone: "Asia/Kolkata" });
  const body = await res.json() as { draft: { title: string }; publish: { ok: boolean; reason: string }; payload: { name: string } };
  assert.equal(body.draft.title, "office hours: refunds");
  assert.equal(body.publish.ok, false);
  assert.equal(body.payload.name, "office hours: refunds");
});

test("a demo refuses when the current segment is not a demo", async () => {
  resetHostings();
  const meetingId = await aMeeting();
  const created = await (await call("POST", "/api/hostings", { meeting_id: meetingId, agenda })).json() as { hosting: { id: string } };
  const res = await call("POST", `/api/hostings/${created.hosting.id}/demo`);
  assert.equal(res.status, 409);
  const body = await res.json() as { error: string };
  assert.match(body.error, /not a demo/);
});

test("a demo on a demo segment refuses when the browser lane is closed", async () => {
  resetHostings();
  const meetingId = await aMeeting();
  const created = await (await call("POST", "/api/hostings", { meeting_id: meetingId, agenda })).json() as { hosting: { id: string } };
  const id = created.hosting.id;
  await call("POST", `/api/hostings/${id}/start`, { now: 1000 });
  await call("POST", `/api/hostings/${id}/advance`, { now: 2000 });
  const res = await call("POST", `/api/hostings/${id}/demo`);
  assert.equal(res.status, 503);
  const body = await res.json() as { error: string };
  assert.match(body.error, /browser lane is closed/);
});

test("host controls refuse honestly: unknown action, wrong platform, closed lane", async () => {
  resetHostings();
  const meetingId = await aMeeting();
  const created = await (await call("POST", "/api/hostings", { meeting_id: meetingId, agenda })).json() as { hosting: { id: string } };
  const id = created.hosting.id;

  const unknown = await call("POST", `/api/hostings/${id}/controls/teleport`, { guest_id: "x" });
  assert.equal(unknown.status, 400);

  const noGuest = await call("POST", `/api/hostings/${id}/controls/admit`, {});
  assert.equal(noGuest.status, 400);

  const closed = await call("POST", `/api/hostings/${id}/controls/probe`);
  assert.equal(closed.status, 503);
  const body = await closed.json() as { error: string };
  assert.match(body.error, /browser lane is closed/);
});

test("host controls say which platform they are wired for", async () => {
  resetHostings();
  const res = await call("POST", "/api/meetings", { title: "meet night", platform: "meet", join_url: "https://meet.google.com/abc-defg-hij" });
  const meeting = (await res.json() as { meeting: { id: string } }).meeting;
  const created = await (await call("POST", "/api/hostings", { meeting_id: meeting.id, agenda })).json() as { hosting: { id: string } };
  const probe = await call("POST", `/api/hostings/${created.hosting.id}/controls/probe`);
  assert.equal(probe.status, 501);
  const body = await probe.json() as { error: string };
  assert.match(body.error, /wired for zoom only/);
});
