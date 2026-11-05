# hosting

the agent runs the night, instead of attending it.

attending answers questions about someone else's meeting. hosting is the
other side: the agenda, the clock, the demo that runs in a real browser,
the listing copy, and the guest door. it is deliberately discretionary:
nothing here decides for the host when to move on, what to show, or who
to let in. it gives the host a hand and keeps receipts.

## the pieces

- **agenda.ts**: the plan, validated at the desk. a night opens with a
  welcome and ends with a close, a demo segment must carry a runnable
  script, and a demo gets at least two minutes because a browser
  walkthrough is not a sixty second slot.
- **demo.ts**: the demo lane. steps run through the same browser session
  the join lane hands out (navigate, click, type, press, wait, check,
  shot), each with a timed receipt. a check that evaluates falsy and a
  screenshot that comes back blank are failures, not ticks: a host who
  says "as you can see" over a blank frame is the worst outcome here.
- **session.ts**: the night as a state machine. lobby, live, paused,
  closed. the clock moves a segment only when its minutes are gone, and
  pausing holds the segment's remaining time rather than eating it.
  advancing early is the host's own act, and it is logged.
- **controls.ts**: the guest door and the host's hand. policy defaults to
  "ask", a blocked guest is refused whatever the policy says, and an
  unwired platform reports closed rather than pretending a guest was
  admitted. sharing defaults to on for talk and demo segments, off for
  qa and welcome.
- **listing.ts**: the event copy, rendered from the agenda that will
  actually run, so the page and the night cannot drift. it never
  publishes. no public event-creation api is documented for lu.ma, so
  the payload is copy for the host to paste, not a publish path.
- **store.ts**: sessions in memory, like every other store here.

## routes

- `POST /api/hostings` build a night from `{ meeting_id, agenda }`
- `GET /api/hostings/:id` the night, its current segment and what is left
- `POST /api/hostings/:id/{start,tick,advance,back,pause,resume,close}`
- `POST /api/hostings/:id/guests` the door, per policy
- `POST /api/hostings/:id/listing` copy plus a publish refusal
- `POST /api/hostings/:id/demo` run the current demo script in a browser

## honesty

the demo route needs a real browser: with the lane closed it answers 503
and says so. a night with no demo in the current segment answers 409.
guest admission reports hold, not an error, because a waiting room is a
normal state and the human decides next.

## the host seat

`platforms/zoom-host.ts` holds the selectors and expressions; the seat
is a host's hand in the web client: admit one person from the waiting
room, mute or remove one participant, start and stop sharing.

the pack is marked unverified, and that is not modesty: zoom changes
client builds and a selector written from memory is a guess. so every
act probes the page first, and when the DOM disagrees the answer is a
sentence naming what was missing, not a click on whatever sat next to
the old selector. an ambiguous name is refused rather than guessed at,
because admitting the wrong person cannot be undone by an apology.

sharing skips the probe on purpose: sharing hides the panels the probe
looks for, so a share is judged by its own control instead.

`scripts/host-seat-check.ts` runs all of this against real chromium and
a fixture that behaves like the client: menus open on click, the share
control becomes a sharing bar, admits and removals change the DOM. nine
checks, all green. what that proves is the expressions and the selection
logic. what it does not prove is that the selectors fit zoom's current
build: only a real meeting settles that, and the probe route exists so
the first live run starts with an answer instead of a guess.

## what is not built

- selectors verified against a live zoom client. the probe reports which
  controls matched, so this is one meeting away.
- meet and teams host powers: the route answers 501 naming the platform
  rather than pretending.
- publishing to lu.ma, or anywhere, stays with the human on purpose.
- a live hosted night has not been run yet. the demo lane runs against a
  fake driver in tests and the browser-session driver in code; the host
  seat runs against a fixture in real chromium.
