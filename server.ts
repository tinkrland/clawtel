// the clawtel server: the meetings, capabilities and relay surfaces
// behind one api door. the door is env-gated: CLAWTEL_API_TOKEN
// present = bearer required, unset = closed. webhooks do not exist
// yet and the health route sits outside the door on purpose.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { TenkiProvider } from "./spawnable/tenki.ts";
import { planFromEvent, meetingFromResolved } from "./intake/planner.ts";
import { resolveJoinUrl } from "./meetings/joining/resolver.ts";
import { closeMeetingBrowser, joinMeeting, leaveMeeting } from "./meetings/joining/engine.ts";
import { getMeeting, listMeetings, transitionMeeting } from "./meetings/meeting.ts";
import { normalizeReaction, reactionExpression, reactionOutcome } from "./meetings/interactivity/reactions.ts";
import { decideHand, handExpression, handOutcome } from "./meetings/interactivity/hand.ts";
import { screensharerExpression, screensharerFromExpression, sharerFromViewerText } from "./meetings/interactivity/screensharer.ts";
import { signZoomJoin, verifyZoomJoinToken, zoomLaneAvailable } from "./meetings/platforms/zoom/signature.ts";
import { hearCapture, listCaptures, markRedeemed, recordCapture, captureSubject } from "./capabilities/promo-codes/capture.ts";
import { citationTime, findSegments, getTranscript, listTranscripts, storeTranscript, type TranscriptSegment } from "./capabilities/transcript/store.ts";
import { answerFromTranscriptId } from "./capabilities/questions/answers.ts";
import { runRecap, type FetchLane, type TranscribeLane } from "./capabilities/recap/pipeline.ts";
import { emailLaneAvailable, renderCaptureEmail, sendEmail, type OutgoingEmail } from "./relay/email.ts";
import { spawnableList, spawnableCreate, spawnableDestroy, spawnableStatus } from "./spawnable/manager.ts";
import { setBrowserLane } from "./meetings/joining/engine.ts";
import { memory } from "./retelldb/client.ts";
import { SpawnableBrowserLane } from "./meetings/joining/spawnable-browser.ts";

// the browser lane is an explicit opt-in, not a side effect of holding
// a spawnable key: CLAWTEL_BROWSER_LANE names the lane, and the lane
// still checks its own env gate. unset = closed, nothing spawns.
if (process.env.CLAWTEL_BROWSER_LANE === "spawnable") {
  const lane = new SpawnableBrowserLane();
  if (lane.isAvailable()) {
    setBrowserLane(lane);
  } else {
    console.log("clawtel: browser lane opt-in was set but the spawnable lane has no key, staying closed");
  }
}

// the memory lane: real data goes in on every write that matters. an
// ingest failure never fails the write (the meeting happened whether
// or not memory heard about it); it is logged and the write stands.
const PERSONA_ID = process.env.CLAWTEL_PERSONA_ID || "clawtel";

async function remember(
  kind: "meeting" | "capture" | "transcript",
  nodes: Parameters<typeof memory.ingest>[1],
  artifacts: Parameters<typeof memory.ingest>[2] = [],
  scope?: { platform: string; connection_id?: string },
): Promise<void> {
  if (!memory.isAvailable()) return;
  const result = await memory.ingest(PERSONA_ID, nodes, artifacts, scope);
  if (!result.ok) {
    console.warn(`clawtel: memory did not take the ${kind}: ${result.reason}`);
  }
}

const app = new Hono();

// the /api door
app.use("/api/*", async (c, next) => {
  const token = process.env.CLAWTEL_API_TOKEN;
  if (!token) {
    return c.json({ error: "the api door is closed: CLAWTEL_API_TOKEN is unset" }, 503);
  }
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${token}`) {
    return c.json({ error: "bearer required" }, 401);
  }
  await next();
});

app.get("/", (c) =>
  c.json({
    name: "clawtel",
    status: "ok",
    message: "clawtel is online and standing by for meetings",
    routes: [
      "/api/meetings", "/api/spawnables", "/api/captures",
      "/api/transcripts", "/api/questions", "/api/recap", "/api/relay/email",
    ],
  }),
);

// --- meetings ---

app.get("/api/meetings", (c) => c.json({ meetings: listMeetings() }));

app.get("/api/meetings/:id", (c) => {
  const meeting = getMeeting(c.req.param("id"));
  if (!meeting) return c.json({ error: "no such meeting" }, 404);
  return c.json({ meeting });
});

// a meeting plan from a calendar-shaped event (the intake path) or a
// bare join url
app.post("/api/meetings", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "a body is required" }, 400);
  if (body.event) {
    const meeting = planFromEvent(body.event);
    if (!meeting) {
      return c.json({ error: "the event had no joinable url. nothing is invented." }, 422);
    }
    return c.json({ meeting }, 201);
  }
  const resolved = body.join_url ? resolveJoinUrl(body.join_url) : null;
  if (!resolved) {
    return c.json({ error: "the url resolved to no platform we know" }, 422);
  }
  const meeting = meetingFromResolved(
    body.title || "untitled meeting",
    resolved,
    body.start_time,
    body.join_delay_minutes,
  );
  await remember(
    "meeting",
    [{
      type: "event",
      key: `meeting:${meeting.id}`,
      text: `planned meeting: ${meeting.title} on ${meeting.platform}${meeting.startTime ? `, starts ${meeting.startTime}` : ""}`,
      platform: meeting.platform,
    }],
    [],
    { platform: meeting.platform },
  );
  return c.json({ meeting }, 201);
});

app.post("/api/meetings/:id/join", async (c) => {
  try {
    const attempt = await joinMeeting(c.req.param("id"));
    // joined: false is an honest answer, not an error
    return c.json({ attempt });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});

app.post("/api/meetings/:id/browser/close", async (c) => {
  try {
    await closeMeetingBrowser(c.req.param("id"));
    return c.json({ closed: true, meetingId: c.req.param("id") });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});

app.post("/api/meetings/:id/leave", async (c) => {
  try {
    await leaveMeeting(c.req.param("id"));
    return c.json({ meeting: getMeeting(c.req.param("id")) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});

app.post("/api/meetings/:id/take-home", (c) => {
  try {
    const meeting = transitionMeeting(c.req.param("id"), "done");
    return c.json({ meeting });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});

// --- interactivity (validated even when no lane is open: the names
// and rules are checkable without a room) ---

app.post("/api/meetings/:id/react", async (c) => {
  const meeting = getMeeting(c.req.param("id"));
  if (!meeting) return c.json({ error: "no such meeting" }, 404);
  const body = await c.req.json().catch(() => null);
  const reaction = normalizeReaction(meeting.platform, body?.name);
  if (!reaction) {
    return c.json({
      error: `unknown reaction. ${meeting.platform} gives its reactions their own names; anything else is refused, not approximated.`,
    }, 400);
  }
  if (meeting.status !== "in_meeting") {
    return c.json({ error: `reactions happen in a meeting. this one is ${meeting.status}.` }, 409);
  }
  if (!meeting.sessionId) {
    return c.json({ error: "no session: the browser lane never opened. nothing fakes a reaction." }, 409);
  }
  // with a live session the engine evaluates reactionExpression(...)
  // against it; the contract is exported for the lane that carries it.
  return c.json({
    reaction,
    expression: reactionExpression(meeting.platform, reaction),
    outcomeRule: "seam | reacted = sent, anything else = honest no",
  });
});

app.post("/api/meetings/:id/hand", async (c) => {
  const meeting = getMeeting(c.req.param("id"));
  if (!meeting) return c.json({ error: "no such meeting" }, 404);
  const body = await c.req.json().catch(() => null);
  const action = body?.action === "lower" ? "lower" : body?.action === "raise" ? "raise" : null;
  if (!action) return c.json({ error: "action must be raise or lower" }, 400);
  if (meeting.status !== "in_meeting") {
    return c.json({ error: `hands happen in a meeting. this one is ${meeting.status}.` }, 409);
  }
  if (!meeting.sessionId) {
    return c.json({ error: "no session: the browser lane never opened. nothing fakes a hand." }, 409);
  }
  return c.json({ action, expression: handExpression(action), outcomeRule: "the lower button is never clicked by a raise" });
});

app.get("/api/meetings/:id/screensharer", (c) => {
  const meeting = getMeeting(c.req.param("id"));
  if (!meeting) return c.json({ error: "no such meeting" }, 404);
  if (!meeting.sessionId) {
    return c.json({ sharer: null, honest: "no session; null means nobody, never a guess" });
  }
  return c.json({ expression: screensharerExpression(), parse: screensharerFromExpression, domFallback: sharerFromViewerText });
});

// --- platforms: zoom join signature ---

app.get("/api/platforms/zoom/status", (c) => c.json({ lane: "zoom", available: zoomLaneAvailable() }));

app.post("/api/platforms/zoom/signature", async (c) => {
  const body = await c.req.json().catch(() => null);
  const meetingNumber = body?.meeting_number ?? (body?.meeting_id ? getMeeting(body.meeting_id)?.meetingNumber : undefined);
  if (!meetingNumber) return c.json({ error: "a zoom signature needs a meeting_number (or a meeting_id with one)" }, 422);
  try {
    const sig = signZoomJoin(meetingNumber);
    return c.json({ signature: sig, verified: verifyZoomJoinToken(sig.joinToken) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

// --- capabilities: promo codes ---

app.post("/api/captures", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.quote) return c.json({ error: "a capture needs the quote, verbatim" }, 400);
  const meeting = body.meeting_id ? getMeeting(body.meeting_id) : undefined;
  try {
    const capture = hearCapture(body.quote, {
      meetingId: body.meeting_id,
      meetingEndsAt: meeting?.startTime ?? null,
    });
    recordCapture(capture);
    const platform = meeting?.platform ?? "zoom";
    await remember(
      "capture",
      [{
        type: "fact",
        key: `capture:${capture.id}`,
        text: `heard in a meeting: ${capture.quote}${capture.code ? ` (code ${capture.code})` : ""}`,
        tags: ["capture", ...(capture.code ? ["code"] : []), ...(capture.scarcity.matched ?? [])],
        platform,
      }],
      [],
      { platform },
    );
    return c.json({ capture, subject: captureSubject(capture) }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/captures", (c) => c.json({ captures: listCaptures() }));

app.post("/api/captures/:id/redeem", (c) => {
  try {
    return c.json({ capture: markRedeemed(c.req.param("id")) });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 409);
  }
});

// --- capabilities: transcript + questions + recap ---

app.post("/api/transcripts", async (c) => {
  const body = await c.req.json().catch(() => null);
  const segments: TranscriptSegment[] = Array.isArray(body?.segments) ? body.segments : [];
  if (!segments.length) return c.json({ error: "a transcript needs segments" }, 400);
  const transcript = storeTranscript(segments, { meetingId: body.meeting_id, sourceUrl: body.source_url });
  const meeting = body.meeting_id ? getMeeting(body.meeting_id) : undefined;
  const platform = meeting?.platform ?? "zoom";
  const lines = transcript.segments
    .map((seg) => `${citationTime(seg.startMs)} ${seg.speaker}: ${seg.text}`)
    .join("\n");
  await remember(
    "transcript",
    transcript.segments.map((seg, i) => ({
      type: "event",
      key: `transcript:${transcript.id}:${i}`,
      text: `${seg.speaker}: ${seg.text}`,
      platform,
      pointer: citationTime(seg.startMs),
      tags: ["transcript"],
      artifact_index: 0,
    })),
    [{
      name: `transcript-${transcript.id}.txt`,
      content: lines,
      mime: "text/plain",
      platform,
      tags: ["transcript"],
      source_uri: transcript.sourceUrl,
    }],
    { platform },
  );
  return c.json({ transcript }, 201);
});

app.get("/api/transcripts", (c) => c.json({ transcripts: listTranscripts() }));

app.get("/api/transcripts/:id", (c) => {
  const transcript = getTranscript(c.req.param("id"));
  if (!transcript) return c.json({ error: "no such transcript" }, 404);
  return c.json({ transcript });
});

app.get("/api/transcripts/:id/find", (c) => {
  const transcript = getTranscript(c.req.param("id"));
  if (!transcript) return c.json({ error: "no such transcript" }, 404);
  const q = c.req.query("q");
  if (!q) return c.json({ error: "a find needs a q" }, 400);
  return c.json({ hits: findSegments(transcript, q).slice(0, 10) });
});

app.post("/api/questions", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.question || !body?.transcript_id) {
    return c.json({ error: "a question needs a question and a transcript_id" }, 400);
  }
  return c.json({ answer: answerFromTranscriptId(body.question, body.transcript_id) });
});

app.post("/api/recap", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.source_url) return c.json({ error: "a recap needs a source_url" }, 400);
  // the lanes are closed until wired: the pipeline reports the stage
  // it stopped at, honestly
  const closedLanes: FetchLane & TranscribeLane = {
    fetch: async () => ({ ok: false, detail: "fetch lane is closed in this deployment" }),
    transcribe: async () => {
      throw new Error("transcribe lane is closed in this deployment");
    },
  };
  try {
    const result = await runRecap(body.source_url, closedLanes, { meetingId: body.meeting_id });
    return c.json({ recap: result });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

// --- relay ---

app.get("/api/relay/status", (c) => c.json({ lane: "email", available: emailLaneAvailable() }));

app.post("/api/relay/email", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.to || !body?.subject || !body?.body) {
    return c.json({ error: "an email needs to, subject and body" }, 400);
  }
  const email: OutgoingEmail = { to: body.to, subject: body.subject, body: body.body };
  try {
    await sendEmail(email);
    return c.json({ sent: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

app.post("/api/relay/capture-email", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.capture_id) return c.json({ error: "a capture email needs capture_id" }, 400);
  const capture = listCaptures().find((x) => x.id === body.capture_id);
  if (!capture) return c.json({ error: "no such capture" }, 404);
  if (!body?.to) return c.json({ error: "an email needs a recipient" }, 400);
  const rendered = renderCaptureEmail({
    quote: capture.quote,
    code: capture.code,
    subject: captureSubject(capture),
    expiry: capture.expiry ? { kind: capture.expiry.kind, quote: capture.expiry.quote } : undefined,
    scarcityKind: capture.scarcityKind,
  });
  try {
    await sendEmail({ ...rendered, to: body.to });
    return c.json({ sent: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

// --- memory (the retelldb layer) ---

app.get("/api/memory/status", async (c) => {
  const result = await memory.status();
  if (!result.ok) return c.json({ enabled: false, reason: result.reason }, 200);
  return c.json({ enabled: true, ...result.data });
});

app.post("/api/memory/query", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.query || !body?.platform) {
    return c.json({ error: "a query needs query and platform. an undeclared surface reads as nothing." }, 400);
  }
  const result = await memory.query(body.query, {
    persona_id: body.persona_id ?? PERSONA_ID,
    platform: body.platform,
    connection_id: body.connection_id,
  }, body.limit);
  if (!result.ok) return c.json({ enabled: false, reason: result.reason }, 200);
  return c.json({ enabled: true, ...result.data });
});

app.post("/api/memory/ground", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.platform) {
    return c.json({ error: "a brief needs a platform. an undeclared surface reads as nothing." }, 400);
  }
  const result = await memory.ground(body.query ?? "", {
    persona_id: body.persona_id ?? PERSONA_ID,
    platform: body.platform,
    connection_id: body.connection_id,
  }, body.limit);
  if (!result.ok) return c.json({ enabled: false, reason: result.reason }, 200);
  return c.json(result.data);
});

app.post("/api/memory/tool", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name || !body?.platform) {
    return c.json({ error: "a tool call needs name and platform" }, 400);
  }
  const result = await memory.tool(body.name, body.args ?? {}, {
    persona_id: body.persona_id ?? PERSONA_ID,
    platform: body.platform,
    connection_id: body.connection_id,
  });
  if (!result.ok) return c.json({ enabled: false, reason: result.reason }, 200);
  return c.json(result.data);
});

// --- spawnables ---

app.get("/api/spawnables", (c) => c.json({ lanes: spawnableStatus() }));
app.get("/api/spawnables/list", async (c) => {
  try {
    return c.json({ spawnables: await spawnableList() });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});
app.post("/api/spawnables", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name) return c.json({ error: "a spawnable needs a name" }, 400);
  try {
    return c.json({
      spawnable: await spawnableCreate({
        name: String(body.name),
        form: body.form === "dock" ? "dock" : "workbench",
        cpu: Number(body.cpu) || 2,
        memoryMib: Number(body.memory_mib) || 2048,
        diskGiB: Number(body.disk_gib) || 5,
        desktop: body.desktop === true,
      }),
    }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});
app.delete("/api/spawnables/:name", async (c) => {
  try {
    await spawnableDestroy(c.req.param("name"));
    return c.json({ destroyed: c.req.param("name") });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 503);
  }
});

export default app;

// run directly (not under a test loader): serve on the port or 8000
const isMain = process.argv[1]?.endsWith("server.ts");
if (isMain) {
  const port = Number(process.env.PORT) || 8000;
  serve({ fetch: app.fetch, port }, () => {
    console.log(`clawtel server running on port ${port}`);
  });
}
