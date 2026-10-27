# clawtel

a turnkey package for agents that attend, host, demo and stream. born from
the agent engine: same seams, same honesty rules, new persona per buyer.

or simply put: you press a button, your agent runs your product demo,
hosts your office hours, and hands you the clips. it renders, it never
publishes.

## the thesis

one artifact, the demo pack, drives three delivery modes:

- **office hours**: 1:1 sessions. the agent joins a meeting, shares the
  deployed product, walks the click path, answers in chat, recaps after.
- **livestream demo**: the same click path, streamed to twitch, kick or
  youtube as the venue, chat as the q&a.
- **async clips**: the capture goes to the render pipeline, gets clipped
  to 16:9 and 9:16 with safe bands, and is handed back. posting is a
  human act.

## what is a spawnable

an agent needs a place to be. a spawnable is a persistent, non-disposable
computer the agent owns: installed apps, logins and demo state survive
between sessions. spawnables stop burning compute when idle and come back
with everything intact.

spawnables arrive through lanes, one seam, env-gated, unset = closed:

1. **tenki** (managed, first option): disposable linux vms with pause
   and resume that preserves memory. no kvm needed from the buyer.
2. **self-hosted**: opensandbox as the product-grade engine
   (kubernetes, firecracker, checkpoints to the artifact store, resume
   on any host). cua and celesto are documented alternates for the
   single-host case.

see [docs/spawnables.md](docs/spawnables.md) for the lane contract and
[coverage.md](coverage.md) for what is verified, designed, or not yet
possible.

## boundaries that never move

- the plate stays real. deterministic proskena renders only, no
  generated backgrounds, ever. consistency by construction, not prompt
  discipline.
- renders, never publishes. the pipeline hands files to a human.
- env-gated lanes. a capability without its key is closed and says so.
- the engine never guesses. it shares what it sees or says it cannot.

the agent remains the reference deployment and the first persona.
