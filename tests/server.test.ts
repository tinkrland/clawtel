import { test } from "node:test";
import assert from "node:assert/strict";
import app from "../server.ts";

const TOKEN = "test-token";
process.env.CLAWTEL_API_TOKEN = TOKEN;

async function call(
  method: string,
  path: string,
  body?: unknown,
  auth: boolean | string = true,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (auth === true) headers.authorization = `Bearer ${TOKEN}`;
  else if (typeof auth === "string") headers.authorization = auth;
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

test("the api door is closed when the token is unset", async () => {
  const saved = process.env.CLAWTEL_API_TOKEN;
  delete process.env.CLAWTEL_API_TOKEN;
  try {
    const res = await call("GET", "/api/meetings", undefined, false);
    assert.equal(res.status, 503);
  } finally {
    process.env.CLAWTEL_API_TOKEN = saved;
  }
});

test("a wrong bearer is refused", async () => {
  const res = await call("GET", "/api/meetings", undefined, "Bearer wrong");
  assert.equal(res.status, 401);
});

test("health sits outside the door", async () => {
  const res = await call("GET", "/", undefined, false);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.name, "clawtel");
});

test("a join url becomes a meeting plan", async () => {
  const res = await call("POST", "/api/meetings", {
    title: "office hours",
    join_url: "https://zoom.us/j/1234567890?pwd=abc",
    join_delay_minutes: 3,
  });
  assert.equal(res.status, 201);
  const { meeting } = await res.json();
  assert.equal(meeting.platform, "zoom");
  assert.equal(meeting.meetingNumber, "1234567890");
  assert.equal(meeting.passcode, "abc");
  assert.equal(meeting.joinDelayMinutes, 3);
  assert.equal(meeting.status, "planned");
});

test("a calendar event without a url is refused, nothing invented", async () => {
  const res = await call("POST", "/api/meetings", { event: { title: "no url event" } });
  assert.equal(res.status, 422);
});

test("join without a browser lane is an honest closed-lane error", async () => {
  const plan = await (await call("POST", "/api/meetings", {
    title: "t",
    join_url: "https://meet.google.com/abc-defg-hij",
  })).json();
  const res = await call("POST", `/api/meetings/${plan.meeting.id}/join`);
  assert.equal(res.status, 409);
  const { error } = await res.json();
  assert.match(error, /lane is closed/);
});

test("reactions: unknown names refused, known names pass the rules", async () => {
  const plan = await (await call("POST", "/api/meetings", {
    title: "t",
    join_url: "https://meet.google.com/abc-defg-hij",
  })).json();
  const id = plan.meeting.id;
  // not in_meeting yet: honest 409 even before the name check matters
  const unknown = await call("POST", `/api/meetings/${id}/react`, { name: "fire" });
  assert.equal(unknown.status, 400);
  const known = await call("POST", `/api/meetings/${id}/react`, { name: "party popper" });
  assert.equal(known.status, 409); // in_meeting required
  const { error } = await known.json();
  assert.match(error, /in a meeting/);
});

test("a capture carries quote, code, expiry and scarcity", async () => {
  const res = await call("POST", "/api/captures", {
    quote: "the code FLASH-50 expires in 10 minutes",
  });
  assert.equal(res.status, 201);
  const { capture, subject } = await res.json();
  assert.equal(capture.code, "FLASH-50");
  assert.equal(capture.expiry.minutes, 10);
  assert.match(subject, /FLASH-50/);
  assert.match(subject, /~10 min/);
});

test("a capture without a quote is refused", async () => {
  const res = await call("POST", "/api/captures", { code: "X" });
  assert.equal(res.status, 400);
});

test("a transcript is stored and questions cite it or say unknown", async () => {
  const stored = await (await call("POST", "/api/transcripts", {
    segments: [
      { startMs: 65000, speaker: "host", text: "the promo code expires in 10 minutes" },
    ],
  })).json();
  const tid = stored.transcript.id;

  const known = await (await call("POST", "/api/questions", {
    question: "when does the promo code expire",
    transcript_id: tid,
  })).json();
  assert.equal(known.answer.known, true);
  assert.equal(known.answer.citation, "0:01:05");

  const unknown = await (await call("POST", "/api/questions", {
    question: "what is the capital of france",
    transcript_id: tid,
  })).json();
  assert.equal(unknown.answer.known, false);
});

test("recap reports the stage it stopped at, honestly", async () => {
  const res = await call("POST", "/api/recap", { source_url: "https://example.com/rec" });
  assert.equal(res.status, 503);
  const { error } = await res.json();
  assert.match(error, /recap stopped at fetch/);
});

test("email without a lane is closed, never a fake send", async () => {
  delete process.env.SMTP_URL;
  const res = await call("POST", "/api/relay/email", {
    to: "someone@example.com",
    subject: "s",
    body: "b",
  });
  assert.equal(res.status, 503);
  const { error } = await res.json();
  assert.match(error, /email lane is closed/);
});

test("spawnable lanes report their status", async () => {
  const res = await call("GET", "/api/spawnables");
  assert.equal(res.status, 200);
  const { lanes } = await res.json();
  assert.ok(Array.isArray(lanes));
  assert.ok(lanes.some((l: { lane: string }) => l.lane === "tenki"));
});
