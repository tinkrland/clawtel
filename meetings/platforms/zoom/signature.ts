// zoom join signature: the classic meeting-sdk signature. the hosted
// join page (running the web sdk) joins as a participant with a
// signature the backend computes: HMAC-SHA256 over
// base64(header).base64(payload), with the meeting number, role and a
// time box in the payload. credentials are env-gated like every lane:
// ZOOM_SDK_KEY + ZOOM_SDK_SECRET present = lane open, unset = closed.

import { createHmac, randomBytes } from "node:crypto";

export interface ZoomJoinSignature {
  sdkKey: string;
  meetingNumber: string;
  role: 0 | 1; // 0 = participant, 1 = host
  signature: string; // base64(hmac hex)
  joinToken: string; // the sdk's token: base64(signature "." payload "." random)
  iat: number; // seconds
  exp: number; // seconds
}

function base64UrlEncode(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

export function zoomLaneAvailable(): boolean {
  const key = process.env?.ZOOM_SDK_KEY;
  const secret = process.env?.ZOOM_SDK_SECRET;
  return typeof key === "string" && key.length > 0 &&
    typeof secret === "string" && secret.length > 0;
}

export function signZoomJoin(
  meetingNumber: string,
  opts: { role?: 0 | 1; validForSeconds?: number; now?: Date } = {},
): ZoomJoinSignature {
  const sdkKey = process.env?.ZOOM_SDK_KEY;
  const sdkSecret = process.env?.ZOOM_SDK_SECRET;
  if (!sdkKey || !sdkSecret) {
    throw new Error("zoom lane is closed: ZOOM_SDK_KEY / ZOOM_SDK_SECRET are unset");
  }

  const role = opts.role ?? 0;
  const now = opts.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000) - 30; // backdate slightly, clock drift tolerance
  const exp = iat + (opts.validForSeconds ?? 60 * 60 * 2); // a meeting box, generous

  const header = JSON.stringify({ alg: "HS256", typ: "JWT" });
  const payload = JSON.stringify({
    sdkKey,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp: exp,
  });
  const message = `${base64UrlEncode(header)}.${base64UrlEncode(payload)}`;
  const hmac = createHmac("sha256", sdkSecret).update(message).digest("hex");
  const signature = base64UrlEncode(hmac);
  const joinToken = base64UrlEncode(`${signature}.${message}.${randomBytes(10).toString("hex")}`);

  return { sdkKey, meetingNumber, role, signature, joinToken, iat, exp };
}

// verify: recompute the hmac over the message recovered from a token.
// the round trip is the test: what the page receives is what we signed.
export function verifyZoomJoinToken(token: string): boolean {
  const decoded = Buffer.from(token, "base64").toString("utf-8");
  // the token is signature "." header "." payload "." random: the
  // message itself carries a dot, so the ends are what split cleanly
  const parts = decoded.split(".");
  if (parts.length !== 4) return false;
  const signature = parts[0];
  const message = `${parts[1]}.${parts[2]}`;
  const sdkSecret = process.env?.ZOOM_SDK_SECRET;
  if (!sdkSecret) return false;
  const expected = base64UrlEncode(
    createHmac("sha256", sdkSecret).update(message).digest("hex"),
  );
  return expected === signature;
}
