import { test } from "node:test";
import assert from "node:assert/strict";
import { joinDelayMinutes, resolveJoinUrl } from "../meetings/joining/resolver.ts";

test("zoom j-links resolve with meeting number and passcode", () => {
  const r = resolveJoinUrl("https://zoom.us/j/1234567890?pwd=abc123");
  assert.equal(r?.platform, "zoom");
  assert.equal(r?.meetingNumber, "1234567890");
  assert.equal(r?.passcode, "abc123");
});

test("zoom x-links (web sdk meeting links) resolve", () => {
  const r = resolveJoinUrl("https://zoom.us/x/98765432100");
  assert.equal(r?.platform, "zoom");
  assert.equal(r?.meetingNumber, "98765432100");
});

test("zoom vanity links resolve without a passcode", () => {
  const r = resolveJoinUrl("https://zoom.us/my/officehours");
  assert.equal(r?.platform, "zoom");
  assert.equal(r?.meetingNumber, "officehours");
  assert.equal(r?.passcode, undefined);
});

test("meet links resolve with the code", () => {
  const r = resolveJoinUrl("https://meet.google.com/abc-defg-hij");
  assert.equal(r?.platform, "meet");
  assert.equal(r?.code, "abc-defg-hij");
});

test("teams meetup-join links resolve", () => {
  const r = resolveJoinUrl("https://teams.microsoft.com/l/meetup-join/19:meeting_xyz@thread.v2/0?context={}");
  assert.equal(r?.platform, "teams");
});

test("whatsapp call links resolve as guest-call platforms", () => {
  assert.equal(resolveJoinUrl("https://wa.me/call")?.platform, "whatsapp_call");
  assert.equal(resolveJoinUrl("https://call.whatsapp.com/x/y")?.platform, "whatsapp_call");
});

test("twitch resolves as a livestream with the channel", () => {
  const r = resolveJoinUrl("https://www.twitch.tv/somechannel");
  assert.equal(r?.platform, "livestream");
  assert.equal(r?.surface, "twitch");
  assert.equal(r?.channel, "somechannel");
});

test("kick resolves as a livestream with the channel", () => {
  const r = resolveJoinUrl("https://kick.com/somechannel");
  assert.equal(r?.platform, "livestream");
  assert.equal(r?.surface, "kick");
});

test("youtube live and watch links resolve with the id", () => {
  assert.equal(resolveJoinUrl("https://youtube.com/live/dQw4w9WgXcQ")?.channel, "dQw4w9WgXcQ");
  assert.equal(resolveJoinUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.surface, "youtube");
});

test("any other deployed url is link_share, not a meeting", () => {
  const r = resolveJoinUrl("https://app.example.com/demo");
  assert.equal(r?.platform, "link_share");
});

test("garbage resolves to null, never a guess", () => {
  assert.equal(resolveJoinUrl("not a url"), null);
  assert.equal(resolveJoinUrl(""), null);
  assert.equal(resolveJoinUrl("ftp://example.com/x"), null);
});

test("join delay: default 2, clamped to [0, 10]", () => {
  assert.equal(joinDelayMinutes(), 2);
  assert.equal(joinDelayMinutes(undefined), 2);
  assert.equal(joinDelayMinutes(0), 0);
  assert.equal(joinDelayMinutes(5), 5);
  assert.equal(joinDelayMinutes(30), 10);
  assert.equal(joinDelayMinutes(-3), 0);
});
