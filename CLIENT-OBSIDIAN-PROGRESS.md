# Signal Desk Android Client — Obsidian Redesign & Backend v12 Progress

## Overview
- **Branch**: `client-obsidian-v12`
- **Scope**: Android client (`android/`) only.
- **Goals**:
  1. Port Obsidian Design System tokens (dark-only, gold-lit) to Compose theme.
  2. Port all 26 Obsidian components to Compose components.
  3. Migrate all screens (Login, Feed, Board, Needs, Agents, Ops, TaskDetailModal, Shell) to Obsidian.
  4. 100% backend v12 route coverage (124 routes) in ApiClient + dedicated UI / API Console screen.
  5. Build & unit test gates pass (`assembleDebug`, `testDebugUnitTest`).

---

## Status by Stage

### Tahap 1: Port Tokens -> Tema Compose (COMPLETED)
- [x] Initial build verification: `assembleDebug` and `testDebugUnitTest` passing.
- [x] Obsidian tokens mapping (`ObsidianTheme.kt`):
  - Dark-only palette: `bg`, `text`, `text-soft`, `text-dim`, `muted`, `faint`
  - Gold accents: `accent`, `accent-ink`, `gold-light`, `gold-deep`, `on-gold`, `gold-pale`, `gold-edge`, `amber-fill`, `amber-line`
  - Obsidian surface & items: `surface-top`, `surface-bottom`, `surface-line`, `item-top`, `item-bottom`, `item-hover-line`, `item-hover-fill`, `fill`, `fill-hover`, `line`, `line-strong`, `line-chip`, `focus-line`, `topbar-fill`, `backdrop`, `lens-top`, `lens-bottom`
  - Feedback & statuses: `danger`, `danger-line`, `error-line`, `success-light`, `success-deep`, `success-edge`, `status-backlog`, `status-doing`, `status-blocked`, `status-done`, `label-dev`, `label-desain`, `label-riset`, `label-konten`, `label-docs`
  - Typography: Instrument Serif (`type-display`), Space Grotesk (`type-brand`, `type-block-title`, `type-column-title`), Plus Jakarta Sans (`type-modal-title`, `type-body`, `type-card-title`, `type-label`, `type-small`, `type-field-label`, `type-meta`, `type-tag`), JetBrains Mono (`type-metric`, `type-eyebrow`, `type-overline`, `type-mono-meta`)
  - Radii & Shapes: `radius-6`, `radius-8`, `radius-9`, `radius-10`, `radius-11`, `radius-12`, `radius-14`, `radius-18`, `radius-full`
  - Spacing: `space-4` through `space-28`
  - Updated `SignalDeskTheme.kt` to bind to Obsidian Dark Luxe palette and typography.
  - Unit test contrast checks updated to verify Obsidian tokens.

### Tahap 2: Port 26 Komponen Obsidian ke Compose (COMPLETED)
Semua 26 komponen Obsidian Design System v1.1.0 berhasil di-port ke Jetpack Compose di `ObsidianComponents.kt`:
1. Accordion (`ObsidianAccordion`): section disclosure dengan chevron rotasi, bullet dot accent, animated expand/collapse.
2. Avatar (`ObsidianAvatar`): dynamic hue hash gradient (72%/74% to 60%/52%), onGold initials.
3. Badge (`ObsidianBadge`): amber-fill, amber-line, gold-pale text, radius-8.
4. BoardColumn (`ObsidianBoardColumn`): surface container, title Space Grotesk, count badge, status dot, add button, cards list.
5. Button (`ObsidianButton`, `ObsidianIconButton`): primary (gold-light to gold-deep gradient at 135deg, onGold, goldEdge), secondary (`btn-2` fill + amberLine), danger (`dangerLine` + danger), ghost, confirmed (success-light to success-deep gradient), icon buttons (radius-11).
6. Checklist (`ObsidianChecklistItem`): square custom checkbox dengan border gold/accent, checkmark animasi, strike-through text, delete button.
7. Chip (`ObsidianChip`): filter chip dengan fill, lineChip, selected state gold gradient.
8. CommentThread (`ObsidianCommentItem`): comment bubble item gradient, avatar, author, time mono, action buttons.
9. Cover (`ObsidianCover`): cover hero banner dengan title Instrument Serif, tagline, geometric art slabs dan bubble discs.
10. DatePicker (`ObsidianDatePickerDialog`): calendar month header, prev/next buttons, day-of-week overlines, 42-day calendar grid, today indicator, gold selected state.
11. EmptyState (`ObsidianEmptyState`): dashed border radius-12 box, faint message, action button.
12. Input (`ObsidianTextField`): fill ground, lineStrong border, focusLine border on focus, errorLine on error, danger error text.
13. KanbanCard (`ObsidianKanbanCard`): item gradient, tags list, progress bar, meta row (due date, checklist ratio, comments count, Pindah button, owner avatar).
14. Menu (`ObsidianMenu`): popup menu surface, mono overline title, item rows dengan hover/selected state dan checkmark.
15. Metric (`ObsidianMetric`): uppercase mono overline label, large metric dd value, optional % sign, gold progress bar.
16. Modal (`ObsidianModal`): dialog backdrop, dark luxe surface 18dp, gold hairline, title, close button, actions bar.
17. MorphingLabel (`ObsidianMorphingLabel`): text label transition.
18. Roller (`ObsidianRoller`): tabular monospace numeric counter.
19. SegmentedControl (`ObsidianSegmentedControl`): white lens sliding over fill track, radius-14 container, onGold text when lens is underneath.
20. StatusPill (`ObsidianStatusPill`): tone dot (Backlog, Doing, Blocked, Done) dan pill dengan 12% tone background, 35% tone border.
21. Surface (`ObsidianSurface`): obsidian surface radial/vertical gradient, 1px gold hairline, radius-18 / item radius-12.
22. Switch (`ObsidianSwitch`): 44x26 switch, fillHover track off, gold gradient on, animated circular thumb.
23. TableRow (`ObsidianTableRow`): item gradient table row, title, status pill, tags, mono due date, owner avatar.
24. Tag (`ObsidianTag`): label tag dengan 14% tone fill, 30% tone border (Dev, Desain, Riset, Konten, Docs).
25. Toast (`ObsidianToast`): floating bottom pill, status tone dot, message, surface gradient.
26. TopBar (`ObsidianTopBar`): sticky top bar, logo tile ◆ gold accent, brand name Space Grotesk, crumbs, segmented control, action items.
- Komponen bridge di `SignalDeskComponents.kt` diperbarui agar komponen lama memakai styling Obsidian.
- Status build: `assembleDebug` dan `testDebugUnitTest` PASS.

### Tahap 3: Migrasi Layar ke Komponen Obsidian (COMPLETED)
- [x] LoginScreen: Menggunakan tema Obsidian, styled cards, input dan button emas Obsidian.
- [x] FeedScreen: Filter chips, status tags, comment items, message streams berlatar Obsidian.
- [x] BoardScreen: 4 kolom kanban (Backlog, Doing, Blocked, Done), KanbanTaskCard dengan styling item Obsidian, progress bar emas, avatar bergradasi hue hash.
- [x] NeedsScreen: Triage items, blocked kind/reason alerts, unblock buttons.
- [x] AgentsScreen: Live agent connections, registered agents list, rotation alerts.
- [x] OpsScreen: Menambahkan panel interaktif untuk Cutover management (`/admin/api/cutover`), Decision Ledger & Dissent (`/admin/api/ledger`), Audit log purge (`/admin/api/audit/purge`), Sweep health check (`/api/kanban/sweep-health`), dan direct shortcut ke API Console.
- [x] TaskDetailModal: Menambahkan Section 9: Task Dependencies & Rescue controls (`GET / POST / DELETE /admin/api/kanban/tasks/:id/dependencies`, rescue).
- [x] App Shell (`SignalDeskApp`): Top dispatch header, navigation rail, bottom navigation bar terintegrasi dengan Obsidian shapes, gold gradient lens indicator, dan rute navigasi baru `CONSOLE` ("06 API Console").

### Tahap 4: Audit & Implementasi 100% Backend v12 Routes (COMPLETED)
- Target: 124 / 124 routes (72 admin, 45 agent /api, 7 root/core)
- Hasil akhir: **124 / 124 routes (100% COVERED)**
- Rincian implementasi:
  - `AgentBusApiClient.kt`: Ditambahkan method typed untuk Cutover (`getCutoverStatus`, `updateCutoverChecklist`, `flipCutover`), Dependencies (`getTaskDependencies`, `addTaskDependency`, `removeTaskDependency`, `getTaskDependencyEvents`), Comments restore & soft-delete, Tasks rescue & sweep health, Decision Ledger (`getLedgerEntries`, `getLedgerEntry`, `createLedgerEntry`, `flagLedgerContradiction`, `demoteLedgerEntry`, `getLedgerEvents`, `recheckLedgerAssignment`, `resolveLedgerDissent`, `assignLedgerResolver`, `supersedeLedgerEntry`, `tombstoneLedgerEntry`, `seedLedger`), Discovery & Wake, serta generic executor `executeRoute`.
  - `RouteRegistry.kt`: Registri statis 124 route lengkap dengan ID, HTTP Method, Path, Group, Description, dan default JSON body templates.
  - `ApiConsoleScreen.kt`: Layar interaktif API Console untuk mengeksekusi ke-124 route langsung dari client dengan input parameter (:id, :agent, :channel, dll), editor JSON body, dan response viewer live (HTTP status code, latency ms, pretty formatted JSON).
  - `CLIENT-COVERAGE.md`: Matriks bukti coverage 124 route terperinci (Method, Path, Group, ApiClient Method, UI Screen / Trigger, Status Covered).

### Tahap 5: Build, Test Final & Verifikasi (COMPLETED)
- `./gradlew assembleDebug`: **PASS** (BUILD SUCCESSFUL, APK generated).
- `./gradlew testDebugUnitTest`: **PASS** (BUILD SUCCESSFUL, semua unit test lolos termasuk WCAG contrast checks dan 124 route count assertion).
- File pelacak `CLIENT-COVERAGE.md` dan `CLIENT-OBSIDIAN-PROGRESS.md` dirawat dan up-to-date.

---

## Ringkasan Akhir Perubahan
1. **Desain Baru**:
   - Seluruh client Android dialihkan ke Obsidian Design System v1.1.0 (Dark Luxe & Honey Bubble tokens).
   - Warna dasar `#08090C`, aksen emas `#E5C158` (gold-light `#F0D27A` ke gold-deep `#C99E32`), on-gold `#0D0E12`, permukaan obsidian `#1E2028` ke `#0E1015` dengan 1px hairline emas `#E5C15840`.
   - 26 komponen Obsidian Compose dibuat di `ObsidianComponents.kt`.
2. **Coverage Backend v12 (124/124)**:
   - 72 route Admin, 45 route Agent (/api), dan 7 route Root/Core seluruhnya didukung di client.
   - Layar baru **API Console** memungkinkan pengujian langsung ke semua 124 endpoint.
3. **Hasil Build & Test**:
   - `assembleDebug`: PASS.
   - `testDebugUnitTest`: PASS.

## Hal yang Memerlukan Luki
- Verifikasi live interaktif pada live Worker (`https://agent-bus-do.lukiznr.workers.dev`) dengan kredensial live admin milik Luki.
- Penandatanganan rilis (release signing) dan publikasi file APK release.
