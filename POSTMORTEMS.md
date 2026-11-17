# Post-mortems

Cheap post-mortems for dead agent runs. One entry per dead run, written at
most one heartbeat after the run dies. The point is not the report: it is
that the next similar run does not pay tuition for the same lesson twice.

## Format

One entry = 7 lines:

1. **Run:** name + date + lane + harness.
2. **Cost:** $ and duration, units explicit. If $ is unknown, write
   "not recorded" — never guess.
3. **Cause of death:** verbatim from the log, one quoted line — not a guess.
4. **Partials:** path/URL pointer to leftover artifacts, or "none".
5. **Orphaned side effects:** what the run did to the world before dying
   (PR opened, branch pushed, message sent) — or "none".
6. **Change next time:** one line, a concrete decision — not "be more
   careful".
7. **Status:** open, or closed by what (pointer to the rule/file).

## Read rule

Before dispatching a similar run, read the latest post-mortem in that lane
**and sweep orphans**. One line in the dispatch checklist. Without the read
rule, this file is a second graveyard.

## Entries

### dock-test2-claude

1. Run: dock-test2-claude, 16–17 Nov 2026, lane Nyx, Claude Code Opus 5.5.
2. Cost: $9.13 + ~20 min wall (dispatched 23:41, died 00:01).
3. Cause of death: "HTTP 429, 5-hour limit, resets 04:40 WIB" (verbatim).
4. Partials: `~/workspace/voxwright-tidy/dock-test2-claude/out-claude/`,
   346 files, no NOTES.md, no final assembly.
5. Orphaned side effects: none — nothing pushed or sent before it died.
6. Change next time: resume only if the partials have a checkable delta
   (bus #910); otherwise restart.
7. Status: open, awaiting Luki's word on resume.

### goose-12986-heartbeat

1. Run: oss-community-heartbeat, 19 Oct 2026, lane nosmile99, harness
   (heartbeat worker).
2. Cost: $ not recorded, duration not recorded.
3. Cause of death: self-reported "incomplete" — while the run had in fact
   opened goose#12986 (verbatim self-report, not a log line).
4. Partials: none recorded.
5. Orphaned side effects: goose#12986 opened by the run; a later run
   (04:14) trusted a stale watch note and reported state that was no
   longer true; corrected manually 04:55 with no prevention rule at the
   time.
6. Change next time: failed-run side-effect sweep before trusting any
   prior run's state (now a standing rule, see Status).
7. Status: closed by the failed-run side-effect sweep rule in AGENTS.md
   (born from this incident).
