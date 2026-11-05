// the zoom host seat: the selectors and expressions a host needs.
//
// a host is not a participant with a different badge. a host admits from
// the waiting room, opens a participant's menu to mute or remove them,
// and starts a screen share. each of those is a DOM act in the web
// client, so the shape of that DOM lives here as data, not as strings
// scattered through the code.
//
// the pack is marked unverified on purpose. zoom changes client builds
// often and a selector written from memory is a guess. every act probes
// first and refuses with the reason when the DOM disagrees, so the
// failure is a sentence rather than a silent no-op in front of guests.

export interface ZoomHostSelectors {
  waitingRoom: {
    panel: string;
    row: string;
    nameIn: string;
    admitButton: string;
  };
  participants: {
    panel: string;
    row: string;
    nameIn: string;
    moreButton: string;
    menuItem: string;
    confirmRemove: string;
  };
  share: {
    button: string;
    stopButton: string;
  };
  unverified: boolean;
  note: string;
}

/** candidates for the zoom web client. the probe decides, not this comment. */
export const ZOOM_HOST_SELECTORS: ZoomHostSelectors = {
  waitingRoom: {
    panel: '[aria-label*="Waiting Room" i], .waiting-room-list, [class*="waiting-room-container" i]',
    row: 'li, [role="listitem"], [class*="participant-item" i], [class*="waiting-room-item" i]',
    nameIn: '[class*="name" i], .participant-name, span',
    admitButton: 'button[aria-label*="dmit" i], button[class*="admit" i], button',
  },
  participants: {
    panel: '[aria-label*="Participants" i], [class*="participants-container" i], [class*="participants-panel" i]',
    row: 'li, [role="listitem"], [class*="participant-item" i]',
    nameIn: '[class*="name" i], .participant-name, span',
    moreButton: 'button[aria-label*="more" i], button[class*="more" i], button[class*="ellipsis" i]',
    menuItem: '[role="menuitem"], [class*="menu-item" i]',
    confirmRemove: 'button[class*="confirm" i], button[class*="danger" i]',
  },
  share: {
    button: 'button[aria-label*="hare" i], button[class*="share-screen" i], button[class*="screen-share" i]',
    stopButton: 'button[aria-label*="top shar" i], button[class*="sharing" i]',
  },
  unverified: true,
  note: "candidate selectors for the zoom web client; the probe decides. run the probe in a real meeting before trusting an admit.",
};

export interface HostProbe {
  matched: {
    waitingRows: number;
    participantRows: number;
    shareButton: boolean;
    stopShareButton: boolean;
  };
  ok: boolean;
  reason?: string;
}

const HELPERS = `const q = (sel, root = document) => { try { return root.querySelector(sel); } catch (e) { return null; } };
    const all = (sel, root = document) => { try { return Array.from(root.querySelectorAll(sel)); } catch (e) { return []; } };
    const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
    const click = (el) => {
      if (!el) return false;
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    };
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim().toLowerCase();`;

function rowsExpression(panelSel: string, rowSel: string): string {
  // rows live inside their panel. scoping keeps a participants row from
  // being mistaken for a waiting room row on a page that has both
  return `const panel = q(${JSON.stringify(panelSel)});
    const rows = panel ? all(${JSON.stringify(rowSel)}, panel) : [];`;
}

/** everything the seat needs to know, in one round trip to the page. */
export function probeExpression(pack: ZoomHostSelectors): string {
  return `(() => {
    ${HELPERS}
    const countRows = (panelSel, rowSel) => {
      const panel = q(panelSel);
      return panel ? all(rowSel, panel).length : 0;
    };
    return {
      waitingRows: countRows(${JSON.stringify(pack.waitingRoom.panel)}, ${JSON.stringify(pack.waitingRoom.row)}),
      participantRows: countRows(${JSON.stringify(pack.participants.panel)}, ${JSON.stringify(pack.participants.row)}),
      shareButton: visible(q(${JSON.stringify(pack.share.button)})),
      stopShareButton: visible(q(${JSON.stringify(pack.share.stopButton)})),
    };
  })()`;
}

function matchRows(name: string): string {
  return `const wanted = norm(${JSON.stringify(name)});
    const matches = rows.filter((row) => {
      const el = q(SELECTORS.nameIn, row) || row;
      return norm(el.textContent).includes(wanted) || norm(row.getAttribute("aria-label")).includes(wanted);
    });
    if (!wanted) return { found: 0, clicked: false, reason: "a guest name is required" };
    if (matches.length === 0) return { found: 0, clicked: false, reason: "no row matched that name" };
    if (matches.length > 1) return { found: matches.length, clicked: false, reason: "more than one row matched that name" };
    const row = matches[0];`;
}

/** admit the one person whose row matches. ambiguity is reported, never guessed. */
export function admitExpression(pack: ZoomHostSelectors, name: string): string {
  return `(() => {
    ${HELPERS}
    const SELECTORS = ${JSON.stringify(pack.waitingRoom)};
    ${rowsExpression(pack.waitingRoom.panel, pack.waitingRoom.row)}
    ${matchRows(name)}
    const button = all(SELECTORS.admitButton, row).find((b) => visible(b) && /dmit/i.test(b.textContent + " " + (b.getAttribute("aria-label") || "")));
    if (!button) return { found: 1, clicked: false, reason: "that row has no admit button" };
    return { found: 1, clicked: click(button) };
  })()`;
}

/** open a participant's menu and mute them. */
export function muteExpression(pack: ZoomHostSelectors, name: string): string {
  return `(() => {
    ${HELPERS}
    const SELECTORS = ${JSON.stringify(pack.participants)};
    ${rowsExpression(pack.participants.panel, pack.participants.row)}
    ${matchRows(name)}
    const more = all(SELECTORS.moreButton, row).find(visible);
    if (!more) return { found: 1, clicked: false, reason: "that row has no menu button" };
    click(more);
    const items = all(SELECTORS.menuItem).filter((el) => visible(el) && /mute/i.test(el.textContent || ""));
    const target = items.find((el) => !/unmute/i.test(el.textContent || ""));
    if (!target) return { found: 1, clicked: false, reason: "the menu had no mute item" };
    return { found: 1, clicked: click(target) };
  })()`;
}

/** open a participant's menu, remove them, and answer the confirmation. */
export function removeExpression(pack: ZoomHostSelectors, name: string): string {
  return `(() => {
    ${HELPERS}
    const SELECTORS = ${JSON.stringify(pack.participants)};
    ${rowsExpression(pack.participants.panel, pack.participants.row)}
    ${matchRows(name)}
    const more = all(SELECTORS.moreButton, row).find(visible);
    if (!more) return { found: 1, clicked: false, reason: "that row has no menu button" };
    click(more);
    const items = all(SELECTORS.menuItem).filter((el) => visible(el) && /remove/i.test(el.textContent || ""));
    if (!items.length) return { found: 1, clicked: false, reason: "the menu had no remove item" };
    const opened = click(items[0]);
    const confirm = all(SELECTORS.confirmRemove).find((b) => visible(b) && /remove/i.test(b.textContent || ""));
    return { found: 1, clicked: opened, confirmed: confirm ? click(confirm) : null };
  })()`;
}

/** start sharing. the picker itself is answered by the launch flag. */
export function shareStartExpression(pack: ZoomHostSelectors): string {
  return `(() => {
    ${HELPERS}
    const button = all(${JSON.stringify(pack.share.button)}).find(visible);
    if (!button) return { clicked: false, reason: "no share control on this screen" };
    return { clicked: click(button) };
  })()`;
}

export function shareStopExpression(pack: ZoomHostSelectors): string {
  return `(() => {
    ${HELPERS}
    const button = all(${JSON.stringify(pack.share.stopButton)}).find(visible);
    if (!button) return { clicked: false, reason: "no stop sharing control on this screen" };
    return { clicked: click(button) };
  })()`;
}

export function parseProbe(value: unknown): HostProbe {
  const raw = (value ?? {}) as Partial<HostProbe["matched"]>;
  const matched = {
    waitingRows: Number(raw.waitingRows) || 0,
    participantRows: Number(raw.participantRows) || 0,
    shareButton: raw.shareButton === true,
    stopShareButton: raw.stopShareButton === true,
  };
  const anyEvidence = matched.waitingRows + matched.participantRows > 0 || matched.shareButton || matched.stopShareButton;
  return {
    matched,
    ok: anyEvidence,
    reason: anyEvidence
      ? undefined
      : "no host control matched this page: the selector pack does not fit this client build, or this tab is not the meeting",
  };
}

export interface HostActOutcome {
  ok?: boolean;
  found?: number;
  clicked?: boolean;
  confirmed?: boolean | null;
  reason?: string;
}
