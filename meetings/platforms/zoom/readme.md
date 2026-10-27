# zoom

the first platform module. joining zoom happens through the zoom web sdk running in a browser inside a spawnable: the agent joins like a participant, with its own audio and video rails, in a meeting tab that lives in the spawnable's display.

## features (contract for this module)

- join: meeting url plus name, join delay honored, waiting room tolerated
- voice: the agent speaks and hears, turn pacing from the transcript engine
- reactions: send a reaction by its own name (thumbs up, heart, clapping, joy, surprised, thinking, cry, disappointed, party popper), unknown refused
- raise hand: toggle, with the rule that lowering never happens by accident
- chat: read the meeting chat, messages become context
- screenshare in: know who is sharing, name and status, never a guess
- screenshare out: share the spawnable's entire screen (see interactivity/screenshare), the auto-select path
- present: share a tab navigating a deployed url, drive it with click paths

## backend (contract for this module)

- sdk session: load the web sdk in the join tab, own audio/video rails up per meeting
- page seams: every capability above is a seam the sdk page implements, the engine never scrapes blindly
- share change events: the sdk reports who shares, dom fallbacks read the viewer indicator
- audio: voice stays on the meeting rail always, presenting never touches it

## honest status

nothing in this module is wired in this repo yet. this readme is the port contract: features land here one seam at a time, each with its own coverage row, and unverified rows say unverified.
