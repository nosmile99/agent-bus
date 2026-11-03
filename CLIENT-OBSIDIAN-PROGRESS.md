# Signal Desk Android Client — Obsidian Redesign & Backend v12 Progress

## Overview
- **Branch**: `client-obsidian-v12`
- **Scope**: Android client (`android/`) only.
- **Goals**:
  1. Port Obsidian Design System tokens (dark-only, gold-lit) to Compose theme.
  2. Port all 26 Obsidian components to Compose components.
  3. Migrate all screens (Login, Feed, Board, Needs, Agents, Ops, TaskDetailModal) to Obsidian.
  4. 100% backend v12 route coverage (124 routes) in ApiClient + dedicated UI / API Console screen.
  5. Build & unit test gates pass (`assembleDebug`, `testDebugUnitTest`).

---

## Status by Stage

### Tahap 1: Port Tokens -> Tema Compose (IN PROGRESS)
- [x] Initial build verification: `assembleDebug` and `testDebugUnitTest` passing.
- [ ] Obsidian tokens mapping (`ObsidianTheme.kt`):
  - Dark-only palette: `bg`, `text`, `text-soft`, `text-dim`, `muted`, `faint`
  - Gold accents: `accent`, `accent-ink`, `gold-light`, `gold-deep`, `on-gold`, `gold-pale`, `gold-edge`, `amber-fill`, `amber-line`
  - Obsidian surface & items: `surface-top`, `surface-bottom`, `surface-line`, `item-top`, `item-bottom`, `item-hover-line`, `item-hover-fill`, `fill`, `fill-hover`, `line`, `line-strong`, `line-chip`, `focus-line`, `topbar-fill`, `backdrop`, `lens-top`, `lens-bottom`
  - Feedback & statuses: `danger`, `danger-line`, `error-line`, `success-light`, `success-deep`, `success-edge`, `status-backlog`, `status-doing`, `status-blocked`, `status-done`, `label-dev`, `label-desain`, `label-riset`, `label-konten`, `label-docs`
  - Typography: Instrument Serif (`type-display`), Space Grotesk (`type-brand`, `type-block-title`, `type-column-title`), Plus Jakarta Sans (`type-modal-title`, `type-body`, `type-card-title`, `type-label`, `type-small`, `type-field-label`, `type-meta`, `type-tag`), JetBrains Mono (`type-metric`, `type-eyebrow`, `type-overline`, `type-mono-meta`)
  - Radii & Shadows: `radius-6`, `radius-8`, `radius-9`, `radius-10`, `radius-11`, `radius-12`, `radius-14`, `radius-18`, `radius-full`, `shadow-surface`, `shadow-modal`, `shadow-gold`, etc.

### Tahap 2: Port 26 Komponen Obsidian ke Compose (PENDING)
Komponen yang akan di-port:
1. Accordion
2. Avatar
3. Badge
4. BoardColumn
5. Button
6. Checklist
7. Chip
8. CommentThread
9. Cover
10. DatePicker
11. EmptyState
12. Input
13. KanbanCard
14. Menu
15. Metric
16. Modal
17. MorphingLabel
18. Roller
19. SegmentedControl
20. StatusPill
21. Surface
22. Switch
23. TableRow
24. Tag
25. Toast
26. TopBar

### Tahap 3: Migrasi Layar ke Komponen Obsidian (PENDING)
- [ ] LoginScreen
- [ ] FeedScreen
- [ ] BoardScreen
- [ ] NeedsScreen
- [ ] AgentsScreen
- [ ] OpsScreen
- [ ] TaskDetailModal
- [ ] App Shell (`SignalDeskApp`)

### Tahap 4: Audit & Implementasi 100% Backend v12 Routes (PENDING)
- Target: 124 / 124 routes (72 admin, 45 agent /api, 7 root/other)
- Status saat ini: 40/124
- Target implementasi: ApiClient methods + UI khusus / API Console

### Tahap 5: Build, Test Final & Verifikasi (PENDING)
- `./gradlew assembleDebug`: PENDING
- `./gradlew testDebugUnitTest`: PENDING
- Unit test coverage & contrast assertions update

---

## Catatan Kredensial & Hal yang Memerlukan Luki
- Verifikasi live end-to-end membutuhkan kredensial live admin & Worker live. Sesuai batasan keras, agent tidak memegang kredensial live admin dan tidak membuat kredensial rahasia fiktif.
- Unit test lokal dan build APK dijalankan secara mandiri di mesin dev. Verifikasi live di Worker publik dan rilis APK adalah langkah Luki.
