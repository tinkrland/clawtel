// relay: the agent sends back out, on fewer platforms, deliberately.
// it renders, never publishes: everything it produces is handed over
// as a finished artifact, and pressing the publish button is always a
// human act. the email lane is env-gated like every lane: SMTP
// credentials present = lane open, unset = closed, honestly.

export function emailLaneAvailable(): boolean {
  return typeof process.env?.SMTP_URL === "string" && process.env.SMTP_URL.length > 0;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

export function renderCaptureEmail(capture: {
  quote: string;
  code?: string;
  subject: string;
  expiry?: { kind: string; quote: string };
  scarcityKind: string;
}): OutgoingEmail {
  const lines: string[] = [];
  lines.push(`the words, verbatim: "${capture.quote}"`);
  if (capture.code) lines.push(`code: ${capture.code}`);
  if (capture.expiry) {
    lines.push(`expiry (${capture.expiry.kind}), from the words: "${capture.expiry.quote}"`);
  }
  if (capture.scarcityKind !== "none") {
    lines.push(`scarcity: ${capture.scarcityKind}`);
  }
  lines.push("");
  lines.push("a code heard is a pending capture. confirm before it is a receipt.");
  return {
    to: "",
    subject: capture.subject,
    body: lines.join("\n"),
  };
}

export async function sendEmail(
  email: OutgoingEmail,
): Promise<{ sent: true }> {
  if (!emailLaneAvailable()) {
    throw new Error("email lane is closed: SMTP_URL is unset. bring credentials; nothing fakes a send.");
  }
  if (!email.to || !email.to.includes("@")) {
    throw new Error("an email needs a recipient. nothing is guessed.");
  }
  // the smtp send itself is not wired in this deployment: when the
  // credentials arrive, the transport lands here and nowhere else.
  throw new Error("email lane has credentials but no transport wired yet. the send is pending, honestly.");
}
