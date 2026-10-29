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

speaking the line into a call is the tts lane's job, not this module's:
this decides what to say, not how to say it.
