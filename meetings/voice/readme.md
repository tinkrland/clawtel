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

what is verified:

- **this container**: the whole trip, live. a zoom meeting with a stored
  transcript answered "how long for a digital course", spoke the line
  through edge-tts (49,104 bytes, 8.2s), played it into the sink, and
  the monitor captured it: peak 16457, 340k loud samples.
- **inside a spawnable**: verified after a full day of dead ends.
  pulseaudio never serves a client there because the box has no session
  bus, and pipewire needs one too. the recipe that works is: a session
  dbus at a fixed path (/tmp/clawtel-dbus), pipewire, wireplumber,
  pipewire-pulse, a null sink, and the client tools from
  pulseaudio-utils plus ffmpeg. only with all of those does the monitor
  carry audio. provisionMic proves it with a tone round trip before
  reporting ok, and speakInBox writes the rendered line into the box,
  plays it, and captures the monitor as its receipt (peak 13785 on the
  verification run).

the two lessons worth keeping: a container without a session bus makes
audio daemons fail in ways that look like socket or permission bugs
(pulseaudio hangs silently, pipewire routes nothing), and a probe that
runs after the tone has finished reports silence. capture first, then
play.

the route plays where the meeting lives: a meeting joined in a
spawnable gets its line written into that box and spoken there, and if
the box has no microphone the answer is a refusal, not a local beep.
