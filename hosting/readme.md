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

## what is not built

- joining a meeting as host with host powers (admit, mute, remove,
  screen share) needs a platform module; the seam exists and is closed.
- publishing to lu.ma, or anywhere, stays with the human on purpose.
- a live hosted night has not been run yet. the demo lane has run
  against a browser session in tests with a fake driver, and the real
  driver is the same shape the join lane already uses.
