// screensharer awareness: who is presenting, read from inside the
// room. null = nobody is presenting, never a guess. the page seam owns
// the exact event (the platform's share-change callbacks); the dom
// fallbacks are the viewer indicators the platforms actually render,
// so the generic path works without page cooperation.

// the dom fallback patterns, pure and testable against real viewer
// indicator text
export function sharerFromViewerText(text: string): string | null {
  if (!text) return null;
  let m = text.match(/You are viewing ([^'\u2019]+)['\u2019]s screen/i);
  if (m) return m[1].trim();
  m = text.match(/([A-Za-z0-9 ._'\u2019-]+) is presenting/i);
  if (m) return m[1].trim();
  return null;
}

// the in-page expression: the seam first, the viewer indicators second
export function screensharerExpression(): string {
  return `
    (() => {
      if (typeof window.clawtelScreensharer === "function") {
        const name = window.clawtelScreensharer();
        if (name && typeof name === "string") return JSON.stringify({ name: name.trim() });
        return JSON.stringify({ name: null });
      }
      const text = document.body.innerText;
      let m = text.match(/You are viewing ([^'\\u2019]+)['\\u2019]s screen/i);
      if (m) return JSON.stringify({ name: m[1].trim() });
      m = text.match(/([A-Za-z0-9 ._'\\u2019-]+) is presenting/i);
      if (m) return JSON.stringify({ name: m[1].trim() });
      return JSON.stringify({ name: null });
    })()
  `;
}

export function screensharerFromExpression(value: unknown): string | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as { name?: string | null };
      return parsed?.name ?? null;
    } catch {
      return null;
    }
  }
  return null;
}
