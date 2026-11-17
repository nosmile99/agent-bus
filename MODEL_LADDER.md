# Model ladder

A small shared map: job -> model, plus the date it was last verified. It
exists for two failures that already happened this week, not for
anticipation: a run dying mid-flight because its model no longer exists
(Hydrogen 404, killed the agy retest), and a flagship run dying on a limit
while burning money (Opus 5.5, $9.13 for one run dead on the 5-hour limit).

This is a denylist + cheap default, not a catalog. It replaces stale
memory with dated facts; it does not replace fresh judgment per task.

## Rules

- **Write-at-use, not a weekly checker.** Whoever just ran a model and got
  a verdict (works / 404 / limit / expensive) writes one line + date in the
  same heartbeat they report the run. The file stays fresh because it is
  used, not because it is audited.
- **Row owner = whoever last verified.** Their name sits on the row.
- **Record why it died.** "404, model gone" and "alive but 5-hour limit,
  $9.13/run" are two different facts asking for two different responses.
  A ladder that only says "Opus: don't" loses the nuance.
- **A row untouched for a month is stale on its face.** The date itself
  says "verify before using" — no calendar check pretends otherwise.
- **Re-check triggers (event-based):**
  - A Luki subscription date passes (Pro expiry, Claude reset 04:40).
    Trigger is "verify once the date passes", not "assume dead at the
    date" — Fable 5.2 taught the date is soft: Pro window to 16 Nov, still
    usable after, per Luki.
  - A run fails on a model = update the ladder in the same heartbeat. The
    failure itself is the receipt. Waiting for two consecutive failures
    means paying twice for the same lesson.

## Ladder

| Job class | Model | Last verified | Status | Notes | Verified by |
|---|---|---|---|---|---|
| agy retest (voxmc) | Hydrogen | 16 Nov 2026 | dead | 404, model gone when Pro expired (bus #912) | Nyx |
| voxmc builds | Fable 5.2 | 16 Nov 2026 | alive | Pro window to 16 Nov, still usable after, per Luki (bus #912) | Luki |
| long agent run | Claude Code Opus 5.5 | 16–17 Nov 2026 | alive, limited | $9.13/run, 5-hour limit, resets 04:40 WIB (bus #916, POSTMORTEMS.md) | Nyx |
| small-model smoke test | Qwen 3.8 27B via fx | — | unverified | Smoke test still queued; verdict lands here when run (bus #912–#913) | — |

## Companion files

- `GRAVEYARD.md` — dead offers ("tidak" from Luki), same drift rule: one
  shared copy, not one per lane.
- `POSTMORTEMS.md` — dead runs; a run that dies on a model updates this
  ladder in the same heartbeat.
