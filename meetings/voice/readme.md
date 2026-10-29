# voice

what the agent says out loud, mid-call.

the memory layer answers with citations. a citation id spoken aloud is
noise in a meeting, so the spoken line keeps the sentences and moves
the receipts into `sources`. nothing leaves the record: `full` carries
the answer exactly as memory gave it.

## the split

- **speak**: one to three sentences, no ids, no pointers, capped for a
  live turn. cut on a sentence boundary, never mid-word.
- **sources**: every receipt the agent used, still pointing at the
  artifact and its time (artifact@0:01:05).
- **full**: the answer as memory returned it.
- **tools**: what the agent actually called to get there.
- **truncated**: true when the spoken line is shorter than the answer.
  say so rather than pretending it is the whole thing.

## scope

the meeting decides the scope: a zoom answer is walled like a zoom
answer, a livestream answer like a livestream one. an undeclared
platform is refused before any call, because a memory read with no
surface cannot be trusted to fail closed.

## honesty rules that came from live runs

- a refusal speaks nothing. `speak` is empty and `reason` says why.
- a closed memory lane is refused, never guessed at.
- a transcript segment with no numeric start is refused at the door:
  a citation that cannot point at a time is worse than no citation.
- when a general rule and a specific exception both appear, the
  exception governs the case. the prompt says so because a model will
  otherwise hedge between both and contradict its own citation.

## speaking it

`tts.ts` renders the line, `mic.ts` gets it into the room, `say.ts`
runs the trip and keeps three receipts apart: answered, rendered,
played.

the tts ladder: edge-tts first (no key, neural voice), elevenlabs
second when a key exists, a refusal when neither works. a dead rung is
walked past and named.

the mic is a pulseaudio null sink plus a remap source, so the container
reports a real microphone and playing into the sink is speaking into
it. chrome joins with PULSE_SERVER and PULSE_SOURCE pointing at it.

what is verified, and what is not:

- **this container**: the whole trip, live. a zoom meeting with a
  stored transcript answered "how long for a digital course", spoke the
  line through edge-tts (49,104 bytes, 8.2s), played it into the sink,
  and the monitor source captured it: peak 16457, 340k loud samples.
  the audio route served the file back with a 200.
- **inside a spawnable**: the desktop joins and shares, but the
  daemon never serves a client. user mode binds
  /tmp/pulse/pulse/native and refuses connections; system mode binds
  /tmp/pulse-system, leaves a queued client unaccepted, and logs only
  a missing cookie. provisionMic probes with pactl before claiming,
  so a join on such a box reports no microphone instead of pretending
  to be heard.

that last point is the open seam. the fix is infrastructure, not
wording: get a pulseaudio (or pipewire) that serves inside the
spawnable image. until then the lane is honest: answered and rendered
are real, played is not claimed.
