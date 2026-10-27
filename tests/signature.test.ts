import { test } from "node:test";
import assert from "node:assert/strict";
import { signZoomJoin, verifyZoomJoinToken, zoomLaneAvailable } from "../meetings/platforms/zoom/signature.ts";

// the zoom lane is closed without credentials and says so
test("the zoom lane reports closed honestly", () => {
  delete process.env.ZOOM_SDK_KEY;
  delete process.env.ZOOM_SDK_SECRET;
  assert.equal(zoomLaneAvailable(), false);
  assert.throws(() => signZoomJoin("123"), /zoom lane is closed/);
});

test("the signature round-trips: what the page receives is what we signed", () => {
  process.env.ZOOM_SDK_KEY = "test-sdk-key";
  process.env.ZOOM_SDK_SECRET = "test-sdk-secret";
  try {
    assert.equal(zoomLaneAvailable(), true);
    const now = new Date("2026-10-27T20:00:00.000Z");
    const sig = signZoomJoin("1234567890", { role: 0, now, validForSeconds: 7200 });
    assert.equal(sig.role, 0);
    assert.equal(sig.meetingNumber, "1234567890");

    // the token is signature "." header "." payload "." random (4 parts;
    // the message itself carries a dot)
    const decoded = Buffer.from(sig.joinToken, "base64").toString("utf-8");
    const parts = decoded.split(".");
    assert.equal(parts.length, 4);
    const header = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    const payload = JSON.parse(Buffer.from(parts[2], "base64").toString("utf-8"));
    assert.equal(header.alg, "HS256");
    assert.equal(payload.sdkKey, "test-sdk-key");
    assert.equal(payload.mn, "1234567890");
    assert.equal(payload.role, 0);
    assert.equal(payload.exp - payload.iat, 7200);

    // verification recomputes the hmac: round trip holds
    assert.equal(verifyZoomJoinToken(sig.joinToken), true);

    // a forged payload (meeting number swapped, not re-signed) fails
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...payload, mn: "9999999999" }),
    ).toString("base64");
    const forged = [parts[0], parts[1], forgedPayload, parts[3]].join(".");
    assert.equal(verifyZoomJoinToken(Buffer.from(forged, "utf-8").toString("base64")), false);
  } finally {
    delete process.env.ZOOM_SDK_KEY;
    delete process.env.ZOOM_SDK_SECRET;
  }
});

test("a token that is not ours fails verification, not a crash", () => {
  process.env.ZOOM_SDK_SECRET = "test-sdk-secret";
  try {
    assert.equal(verifyZoomJoinToken("not-a-token"), false);
  } finally {
    delete process.env.ZOOM_SDK_SECRET;
  }
});
