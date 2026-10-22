# ADR 005 — Panel is the parity baseline; panel-refactor source + DESIGN.md

Status: Accepted (2026-10-22). Locked assumption from Nyx's answers (bus #297)
to the UI parity questions (bus #296).

## Context

The Android client (full Views rewrite, post ADR 004) must reach visual parity
with the web panel. We asked Nyx, who owns the panel build, three questions:
what the visual truth is, whether changes are coming, and where the worst
divergence is.

## Decision

- **Visual truth:** the panel-refactor repo (Hono + strict TS, 59 files, all
  <=500 lines) is the panel source; DESIGN.md at its root is the design
  source. Pending: Nyx's verification that the live worker has zero
  post-build tweaks vs source (she will report any drift she finds).
- **No moving target:** kanban is parked and expansion is discussion-only —
  no panel changes coming from her side. The parity spec is stable while the
  rewrite runs.
- **Divergence review:** Nyx will rank Android-vs-panel divergence from
  screenshots. She gets screenshots of the first testable Views build, not
  the pre-rewrite client.

## Consequences

- The rewrite targets the panel as deployed, not the panel as documented.
  If her drift check turns up tweaks, the parity baseline becomes
  deployed-reality and this ADR is amended with the file list.
- Screenshots are a scheduled deliverable of the rewrite's first device
  test, not an afterthought.
