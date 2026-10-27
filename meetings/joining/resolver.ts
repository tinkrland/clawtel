// joining: resolve a join url into a platform and its identifiers.
// the resolver never guesses: an unknown shape is link_share when it is
// a deployed url, and unknown when it is nothing we know. pure.

export type MeetingPlatform =
  | "zoom"
  | "meet"
  | "teams"
  | "whatsapp_call"
  | "livestream"
  | "link_share";

export interface ResolvedMeeting {
  platform: MeetingPlatform;
  joinUrl: string;
  // platform identifiers read from the url: zoom meeting number,
  // meet code, channel, stream id. absent when the shape has none.
  meetingNumber?: string;
  passcode?: string;
  code?: string;
  channel?: string;
  // the livestream surface when platform is livestream (twitch, youtube, kick)
  surface?: string;
}

export function resolveJoinUrl(rawUrl: string): ResolvedMeeting | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  // zoom: zoom.us/j/<number>?pwd=<passcode> (the web client join shape),
  // zoom.us/x/<slug> (the new web-sdk meeting link), zoom.us/my/<vanity>
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    let m = url.pathname.match(/^\/j\/(\d+)/);
    if (m) {
      return {
        platform: "zoom",
        joinUrl: rawUrl,
        meetingNumber: m[1],
        passcode: url.searchParams.get("pwd") ?? undefined,
      };
    }
    m = url.pathname.match(/^\/x\/([a-z0-9-]+)/i);
    if (m) {
      return {
        platform: "zoom",
        joinUrl: rawUrl,
        meetingNumber: m[1],
        passcode: url.searchParams.get("pwd") ?? undefined,
      };
    }
    m = url.pathname.match(/^\/my\/([a-z0-9._-]+)/i);
    if (m) {
      return { platform: "zoom", joinUrl: rawUrl, meetingNumber: m[1] };
    }
    return null;
  }

  // google meet: meet.google.com/<code>
  if (host === "meet.google.com") {
    const m = url.pathname.match(/^\/([a-z]{4}-[a-z]{4}-[a-z]{4}|[a-z0-9-]+)/i);
    if (m) return { platform: "meet", joinUrl: rawUrl, code: m[1] };
    return null;
  }

  // microsoft teams: teams.microsoft.com/l/meetup-join/...
  if (host === "teams.microsoft.com" || host.endsWith(".teams.microsoft.com")) {
    if (/^\/l\/meetup-join\//.test(url.pathname)) {
      return { platform: "teams", joinUrl: rawUrl };
    }
    return null;
  }

  // whatsapp guest calls: call links join from a browser as a guest,
  // e2e, no account needed. a call.whatsapp.com host IS a call link;
  if (host === "call.whatsapp.com") {
    return { platform: "whatsapp_call", joinUrl: rawUrl };
  }
  if (host === "wa.me" || host === "chat.whatsapp.com") {
    if (/^\/(call|l\/)/i.test(url.pathname) || url.searchParams.has("call")) {
      return { platform: "whatsapp_call", joinUrl: rawUrl };
    }
    return null;
  }

  // livestreams: the agent attends as a viewer-commenter
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) {
    const m = url.pathname.match(/^\/([a-z0-9_]{3,})\/?$/i);
    if (m) return { platform: "livestream", joinUrl: rawUrl, surface: "twitch", channel: m[1] };
    return null;
  }
  if (host === "kick.com" || host.endsWith(".kick.com")) {
    const m = url.pathname.match(/^\/([a-z0-9_-]{2,})\/?$/i);
    if (m) return { platform: "livestream", joinUrl: rawUrl, surface: "kick", channel: m[1] };
    return null;
  }
  if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com")) {
    const id =
      url.searchParams.get("v") ??
      url.pathname.match(/^\/live\/([a-z0-9_-]{11})/i)?.[1] ??
      (host === "youtu.be" ? url.pathname.slice(1).split("/")[0] : undefined);
    if (id) return { platform: "livestream", joinUrl: rawUrl, surface: "youtube", channel: id };
    return null;
  }

  // any other deployed url: a demo surface (link share), not a meeting.
  // the platform stays honest: presenting a link is not joining a call.
  if (url.protocol === "http:" || url.protocol === "https:") {
    return { platform: "link_share", joinUrl: rawUrl };
  }

  return null;
}

// the join delay: the agent enters a bounded moment before start,
// never early, never late. default 2 minutes, clamped to [0, 10].
export function joinDelayMinutes(configured?: number): number {
  if (configured === undefined || configured === null || isNaN(configured)) return 2;
  return Math.max(0, Math.min(10, Math.round(configured)));
}
