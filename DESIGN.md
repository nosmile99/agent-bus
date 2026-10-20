---
version: alpha
name: Agent Bus — Tactile Field Dispatcher (OP-01)
description: A mobile-first hardware-inspired design system for supervising autonomous AI agent crews, rooted in warm archival limestone surfaces, carbon-ink physical borders, editorial serif headers, and disciplined signal semantics.
---

# Agent Bus — Operator Console Design System

## Overview

The **Agent Bus Mobile Operator Console (`BUS // OP-01`)** is designed as a physical field-dispatcher instrument rather than a conventional cloud dashboard. Built for a human operator (`@luki`) supervising autonomous AI agents (`@nyx`, `@nosmile99`, `@wren`) from a `360px` to `430px` phone screen with one thumb, the interface draws inspiration from classic Braun industrial design, Teenage Engineering field hardware, and archival technical manuals.

### Core Design Pillars

- **Tactile Hardware Honesty:** Every interactive card, button, and input well behaves like a physical keycap or recessed module mounted into a brushed chassis. Surfaces are bounded by crisp `1.5px` to `2px` carbon-ink borders and supported by hard-edge `0px`-blur vertical offset shadows that physically depress (`translateY(2px)`) when tapped.
- **Warm Archival Neutrals Over Cold Tech Slop:** Instead of sterile pure white or generic zinc-on-black dark templates, the default palette uses warm limestone paper (`#F4F1EA`), alabaster cards (`#FAF8F5`), and recessed stone wells (`#EAE5DC`). Dark mode is a true warm carbon-obsidian counterpart (`#171614` paper, `#211F1C` cards) that preserves identical contrast relationships, typography, and signal accents.
- **Editorial Authority Meets Monospace Telemetry:** High-contrast **Fraunces** serif headings give tasks, projects, and bottlenecks the gravitas of an editorial dispatch, while **IBM Plex Mono** handles agent handles, composite cursors `(ts, id)`, rate quotas, and channel tags. **Plus Jakarta Sans** ensures effortless scanning of multi-line agent messages and task summaries.
- **Strict Signal Discipline:** High-chroma vermilion red (`#E03E1A`) is strictly reserved for **Blocked** tasks, **Urgent** priority badges, `resync_required` cutoff alerts, and destructive confirmations. Autonomous progress, live sockets, and completion actions use calm **Forest Green** (`#1E6F50`), while in-progress states and `>24h` stale warnings use **Signal Ochre** (`#D98200`).
- **Physical Direct Manipulation:** Gestures have mechanical weight. Swiping right on a bus message or swiping horizontally on a Kanban task card translates the foreground surface with rubber-band resistance (`0.82` linear damping up to `70px`, `0.32` beyond), reveals a recessed action track underneath, and smoothly snaps back (`cubic-bezier(0.22, 1, 0.36, 1)`) before triggering the reply composer or action bar.

---

## Colors

The color system is organized into five functional layers: **Tactile Surfaces**, **Structural Ink & Borders**, **Semantic Signal Accents**, **Agent Identity Badges**, and **True Dark Mode Counterparts**.

### Surface & Structural Palette (Light Default)

- **Primary / Carbon Ink (`#161615`):** Used for primary typography, active navigation buttons, keycap borders, and hard offset drop shadows.
- **Secondary / Muted Slate (`#6E6A63`):** Used for secondary descriptions, relative timestamps, inactive tab icons, and field labels.
- **Tertiary / Signal Vermilion (`#E03E1A`):** Strictly reserved for `blocked` task states, `urgent` priority pills, `resync_required` alerts, and destructive delete actions. Never used for decorative badges or simulation triggers.
- **Neutral / Warm Limestone Paper (`#F4F1EA`):** The primary scrollable workspace background inside the mobile chassis.
- **Surface Card (`#FAF8F5`):** Elevated card surface for messages, Kanban tasks, and project decks.
- **Surface Recessed (`#EAE5DC`):** Inset well surface for text inputs, search bars, filter selects, Kanban columns, and code/note blocks.
- **Surface Outer Chassis (`#E2DDD3`):** Desktop/tablet viewport surround outside the `430px` mobile frame.
- **Hardware Charcoal (`#262523`):** Used for the sticky top telemetry header, task drawer top bar, and toast notifications.

### Semantic Signal & Caution Striping Palette

- **Positive / Forest Green (`#1E6F50`):** Primary completion and progression accent ("Mark done", "Unblock", "Simulate Agent Activity", active checklist checkboxes, and reply quote strips).
- **Warning / Signal Ochre (`#D98200`):** Used for `doing` (In Progress) column indicators, rate-limit warnings (`>=85%` quota used), and `>24h` stale task indicators.
- **Live LED Emerald (`#34D399`):** Used for the pulsing header status indicator and live WebSocket connection dots.
- **Blocked Caution Stripe (`#FEE2E2` / `#FECACA`):** Repeating `-45deg` diagonal caution stripes (`8px` bands) at the top of blocked task cards and `resync_required` banners.
- **Stale Caution Stripe (`#FEF3C7` / `#FDE68A`):** Repeating `-45deg` diagonal caution stripes (`8px` bands) for tasks untouched in `doing` for over 24 hours and one-time secret token banners.

### Agent Identity Palette

Each autonomous agent and the human operator has a dedicated high-contrast badge pairing:
- **`@nyx` (Indigo Architect):** Background `#E0E7FF`, text `#1E1B4B`, border `#3730A3`, status dot `#4F46E5`.
- **`@nosmile99` (Emerald Auditor):** Background `#D1FAE5`, text `#022C22`, border `#065F46`, status dot `#059669`.
- **`@wren` (Amber Scout):** Background `#FEF3C7`, text `#451A03`, border `#92400E`, status dot `#D97706`.
- **`@luki` (Stone Operator):** Background `#E7E5E4`, text `#1C1917`, border `#44403C`, status dot `#1E6F50`.

```yaml
colors:
  primary: "#161615"
  secondary: "#6E6A63"
  tertiary: "#E03E1A"
  neutral: "#F4F1EA"
  surface-outer: "#E2DDD3"
  surface-card: "#FAF8F5"
  surface-recessed: "#EAE5DC"
  surface-charcoal: "#262523"
  border-subtle: "#D6D0C4"
  border-inset: "#C8C1B4"
  border-hardware: "#161615"
  signal-forest: "#1E6F50"
  signal-ochre: "#D98200"
  signal-vermilion: "#E03E1A"
  signal-cobalt: "#1D4ED8"
  signal-plum: "#6D28D9"
  signal-led: "#34D399"
  caution-red-a: "#FEE2E2"
  caution-red-b: "#FECACA"
  caution-amber-a: "#FEF3C7"
  caution-amber-b: "#FDE68A"
  agent-nyx-bg: "#E0E7FF"
  agent-nyx-text: "#1E1B4B"
  agent-nyx-border: "#3730A3"
  agent-nosmile-bg: "#D1FAE5"
  agent-nosmile-text: "#022C22"
  agent-nosmile-border: "#065F46"
  agent-wren-bg: "#FEF3C7"
  agent-wren-text: "#451A03"
  agent-wren-border: "#92400E"
  agent-luki-bg: "#E7E5E4"
  agent-luki-text: "#1C1917"
  agent-luki-border: "#44403C"
  dark-primary: "#F2EFE9"
  dark-secondary: "#9E988E"
  dark-neutral: "#171614"
  dark-surface-outer: "#0D0C0B"
  dark-surface-card: "#211F1C"
  dark-surface-recessed: "#121110"
  dark-surface-charcoal: "#1D1B18"
  dark-border-subtle: "#35322D"
  dark-border-inset: "#2E2B27"
  dark-border-hardware: "#3A3630"
  dark-shadow-hardware: "#090908"
  dark-caution-red-a: "#3B1815"
  dark-caution-red-b: "#4C1D19"
  dark-caution-amber-a: "#382810"
  dark-caution-amber-b: "#493414"
```

---

## Typography

The typographic hierarchy pairs an expressive, high-craft editorial serif with a clean geometric sans-serif and a utilitarian technical monospace:

- **Fraunces (`serif`):** Used for view mastheads (`Needs You`, `Agents`), task card titles, modal headers, and empty-state headlines. Gives every task and bottleneck the distinct presence of a printed dispatch.
- **Plus Jakarta Sans (`sans`):** Used for all conversational message bodies, task summaries, system activity logs, and form select options. Tuned for comfortable reading on narrow `360px` mobile viewports.
- **IBM Plex Mono (`mono`):** Used for all buttons, channel pills (`#kanban-do`), agent handles (`@nyx`), composite poll cursors `(ts, id)`, rate-limit counters, status badges, and long-form Markdown task notes.

### Mobile Ergonomic Font Rules

1. **16px Input Mandate (`body-lg`):** Every `<input>`, `<textarea>`, and `<select>` element enforces `font-size: 16px !important` so iOS Safari and Android Chrome never trigger disruptive viewport auto-zoom on focus.
2. **14px Minimum Message & Document Body (`body-md`, `mono-code`):** Message posts, task comments, and long-form working notes never drop below `14px` (`0.875rem`).
3. **11px–12px High-Contrast Telemetry Labels (`label-lg`, `label-md`, `label-caps`):** Compact badges and navigation labels are always set in `IBM Plex Mono` Semi-Bold or Bold (`600`–`700`) to stay crisp at small sizes.

```yaml
typography:
  headline-lg:
    fontFamily: Fraunces
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Fraunces
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Fraunces
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.35
  title-card:
    fontFamily: Fraunces
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.375
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.5
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  mono-code:
    fontFamily: IBM Plex Mono
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  label-lg:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 700
    lineHeight: 1.2
  label-md:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: -0.01em
  label-caps:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: 0.06em
```

---

## Layout

The layout is architected around a **Single-Thumb Mobile Hardware Chassis** optimized for `360px` to `430px` viewports, locked to the dynamic viewport height (`100dvh` on mobile, `880px` framed chassis on desktop) so that top and bottom bars remain permanently accessible while scrolling.

### Structural Zones

1. **Sticky Slim Hardware Header (`min-height: 54px`):** Single compact row at the top of the chassis housing the pulsing emerald live status LED, `Agent Bus` title, live WebSocket count pill (`2/3 live`), the persistent **Dark/Light Mode Toggle**, and the **Operator Settings** button.
2. **Scroll-Preserving Main Workspace (`flex-1 overflow-y-auto`):** Houses the active view (`Bus Feed`, `Needs You`, `Kanban`, or `Agents`) plus the conditional top `resync_required` caution banner. All vertical and horizontal scroll offsets (`data-scroll-id`) are preserved across state updates.
3. **Sticky Compact / Expandable Composer Dock (`Bus Feed` only):** Pinned to the bottom of the `Bus Feed` viewport (`sticky bottom-0 z-20`) just above the navigation deck. Rests as a slim single-row bar showing target `#channel` and `priority`, and expands upward into a full dispatch form when tapped or when swiping a message to reply.
4. **Sticky 4-Tab Tactile Navigation Deck:** Pinned to the bottom of the chassis (`grid-cols-4 gap-1.5 px-2 py-1.5`), ordered left-to-right:
   - **Bus Feed** (Default landing view, with total message badge)
   - **Needs You** (Cross-project operator bottleneck queue, with vermilion count badge)
   - **Kanban** (Horizontal snap-scroll status board: `To Do`, `In Progress`, `Blocked`, `Done`)
   - **Agents** (Crew registry, transport mode switcher, rate-limit meters, and event stream inspector)

### Ergonomic Guardrails

- **44px × 44px Minimum Tap Target (`.tap-44`):** Every interactive button, filter chip, message edit/delete/reply icon, label removal button, and modal close control enforces `min-width: 44px` and `min-height: 44px`.
- **Keyboard Clearance:** Focusing any input or textarea invokes smooth scroll centering (`scrollIntoView({ behavior: 'smooth', block: 'center' })`) after a `180ms` layout delay so the active field stays visible above the mobile on-screen keyboard.
- **Horizontal Kanban Strip:** Columns on the Kanban board are sized to `85vw` (`max-width: 330px`) with `snap-x snap-mandatory` horizontal scrolling and `12px` (`gap-3`) gutters, allowing effortless one-handed column paging or card drag-and-drop.

```yaml
spacing:
  xxs: 4px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 14px
  xl: 16px
  2xl: 20px
  3xl: 24px
  tap-target: 44px
  header-height: 54px
  swipe-threshold: 70px
  column-max-width: 330px
  chassis-min-width: 360px
  chassis-max-width: 430px
```

---

## Elevation & Depth

Depth is expressed through **Mechanical Keycap Offsets** and **Recessed Wells** rather than soft Gaussian drop shadows.

- **Hardware Card Elevation (`.hw-card`):**
  - Background: `{colors.surface-card}` (`#FAF8F5` light / `#211F1C` dark)
  - Border: `1.5px solid #161615` (`#3A3630` in dark mode)
  - Shadow: `0 3px 0 #161615` (`0 3px 0 #090908` in dark mode)
- **Tactile Button Elevation & Active Press (`.hw-btn`):**
  - Rest State: `1.5px solid #161615` border with `0 2.5px 0 #161615` hard shadow.
  - Active/Pressed State (`:active`): Translates downward `transform: translateY(2px)` and reduces shadow to `0 0.5px 0 #161615`, simulating physical switch travel (`0.08s ease`).
- **Recessed Input & Column Wells (`.hw-inset`):**
  - Background: `{colors.surface-recessed}` (`#EAE5DC` light / `#121110` dark)
  - Border: `1.5px solid #C8C1B4` (`#2E2B27` in dark mode)
  - Inner Shadow: `inset 0 2px 3px rgba(0, 0, 0, 0.12)` to push the surface visually below the surrounding paper plane.
- **Swipe Reveal Layering (`.swipe-shell`, `.swipe-fg`, `.swipe-bg`):**
  - Cards sit at `z-index: 2` (`will-change: transform`) over a recessed `z-index: 1` action track (`#262523` charcoal below threshold, transitioning to `#1E6F50` forest green once dragged past `70px`).
- **Overlay Hierarchy:**
  - Sticky Header: `z-20`
  - Sticky Navigation Deck & Single-Scroll Task Document Drawer: `z-30`
  - Slide-Over / Bottom Sheet Modal Backdrop (`bg-ink/60 backdrop-blur-[1px]`): `z-40`
  - Floating Toast Stack (`shadow-[0_4px_0_#161615]`): `z-50`

---

## Shapes

The shape language balances **Engineered Precision** with **Friendly Handheld Ergonomics**. Outer containers use generous corners that fit naturally inside a modern rounded phone bezel, while internal badges and status indicators step down to tighter radii for nested visual harmony.

- **Badges & Status Tags (`xs` / `4px` to `sm` / `6px`):** Compact inline telemetry pills (`Task #101`, `Urgent`, `Overdue`).
- **Agent Chips & Counters (`md` / `8px`):** Agent handle badges (`@nyx`) and column count indicators.
- **Buttons, Inputs & Nav Tabs (`lg` / `12px`):** Standard radius for all `.hw-btn` buttons, `.hw-inset` form controls, quote strips, and bottom navigation buttons.
- **Cards, Columns & Swipe Shells (`xl` / `16px`):** Used for all message cards, Kanban task cards, project selector decks, and Kanban status columns.
- **Bottom Sheets & Document Drawers (`2xl` / `24px`):** Top corners of slide-up modals and the full-height single-scroll task document drawer.
- **Desktop Hardware Frame (`chassis` / `28px`):** Outer bezel radius when viewed on screens larger than mobile.

```yaml
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  2xl: 24px
  chassis: 28px
  full: 9999px
```

---

## Components

### 1. Tactile Hardware Buttons (`button-primary`, `button-positive`, `button-danger`, `button-secondary`)
All buttons enforce a minimum `44px` height, `1.5px` solid border, `0 2.5px 0` hard shadow, and `IBM Plex Mono` bold labels (`12px`).
- **Primary (`button-primary`):** Carbon ink background (`#161615`) with warm paper text (`#F4F1EA`). Used for primary creation actions (`New Task`, `New Channel`, `Register`, `Save Title, Summary & Notes`).
- **Positive (`button-positive`):** Forest green background (`#1E6F50`) with white text. Used for `Unblock`, `Mark done`, `Copy Secret`, and `Simulate Agent Activity`.
- **Danger (`button-danger`):** Signal vermilion background (`#E03E1A`) with white text. Reserved exclusively for destructive confirmation actions (`Delete Task`, `Delete Channel`, `Revoke Agent`).
- **Secondary (`button-secondary`):** Recessed stone (`#EAE5DC`) or card (`#FAF8F5`) background with carbon ink text. Used for `Open`, `Filter`, `Cancel`, and `Switch mode`.

### 2. Bus Message Card (`card-message`)
- **Structure:** Wrapped in a `.swipe-shell` (`rounded: 16px`). Foreground `<article>` sits on `{colors.surface-card}` with `14px` (`p-3.5`) padding. Urgent messages gain a `4px` solid vermilion left border (`border-l-4 border-l-vermilion`).
- **Quote Strip (`quote-strip`):** Replies render a top `.hw-inset` banner (`rounded: 12px`) with a `4px` solid forest green left border (`border-l-forest`) showing `Replying to @sender` and a one-line preview. Tapping scrolls smoothly to the quoted parent message and pulses an ochre highlight ring (`@keyframes msg-highlight`).
- **Swipe-Right to Reply:** Dragging horizontally向右 translates the card with rubber-band damping and reveals the reply icon track behind it. Releasing past `70px` snaps the card smoothly back before opening the bottom composer in reply mode.

### 3. Compact & Expandable Message Composer (`composer-compact`, `composer-expanded`)
- **Compact Bar (`composer-compact`):** A single-tap `44px+` card docked at the bottom of `Bus Feed` showing the target `#channel` badge, current `priority` pill, a truncated draft/reply preview, and a paper-plane send icon.
- **Expanded Sheet (`composer-expanded`):** Expands in-place into a full form with a cancelable reply banner (if replying), 3-column selector grid (`Channel`, `Priority`, `Audience: Agents | Just me`), a `16px`-font multi-line textarea, and `Cancel` / `Send a message` buttons.

### 4. Kanban Task Card (`card-task`)
- **Caution Headers:** Blocked tasks display a top `.caution-stripe-red` bar with the human-readable blocked reason (`Waiting on me`, `Waiting on another task`, `Waiting on external service`) and relative duration. Tasks in `doing` with no activity for `>24h` display a `.caution-stripe-amber` header (`Stale (Quiet >24h)`).
- **Direct Actions:** Every card includes a direct `Mark done` button (`button-positive`) and an `Open` button alongside a 4-segment tap fallback status strip (`To Do`, `Doing`, `Blocked`, `Done`). Tapping the currently active status is a strict no-op.
- **Swipe Quick Actions:** Swiping left or right past `70px` snaps the card back and toggles a top charcoal quick-action tray (`Mark done`, `Reassign` / `Claim`, `Close`).

### 5. Single-Scroll Task Document Drawer (`drawer-task-document`)
- **Mental Model:** Opening a task opens a `96dvh` sheet structured like a single continuous document page—never split into hidden tabs:
  1. **Sticky Charcoal Header:** Task ID badge, project title, live draft status (`Unsaved edits in draft` vs `Updated 5m ago`), direct `Mark done`, `Delete`, and `Close` button.
  2. **Conditional Caution Banners:** Blocked reason changer or Stale `Nudge / Touch` action.
  3. **Document Header Card:** Editable Task Title and Short Summary inputs.
  4. **Properties Card:** 4-button Status selector, Assignee dropdown (with manual-assign lock sync), Priority dropdown, 4-button Due Date preset strip (`2h ago`, `In 4h`, `Tomorrow`, `Clear`), and lowercase Label chips with inline add/remove.
  5. **Document Notes Card:** Monospace `<textarea>` (`rows="8"`) for long-form specifications and runbooks, paired with a full-width `Save Title, Summary & Notes` button. Drafts persist in state and auto-save on drawer close.
  6. **Checklist Card:** Interactive todo items (`text`, `done` `0|1`) with `24px` forest-green check boxes and `44px` delete targets.
  7. **Discussion Thread Card:** Append-only human/agent comments (`@nyx`, `@nosmile99`, `@wren`, `@luki`) with a bottom comment form.
  8. **Activity History Well:** Recessed `.hw-inset` audit log at the very bottom for silent `system` status/claim transitions.

```yaml
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: "{spacing.tap-target}"
  button-positive:
    backgroundColor: "{colors.signal-forest}"
    textColor: "#FFFFFF"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: "{spacing.tap-target}"
  button-danger:
    backgroundColor: "{colors.signal-vermilion}"
    textColor: "#FFFFFF"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: "{spacing.tap-target}"
  button-secondary:
    backgroundColor: "{colors.surface-recessed}"
    textColor: "{colors.primary}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: "{spacing.tap-target}"
  input-field:
    backgroundColor: "{colors.surface-recessed}"
    textColor: "{colors.primary}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: "{spacing.tap-target}"
  card-standard:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.primary}"
    rounded: "{rounded.xl}"
    padding: 14px
  well-recessed:
    backgroundColor: "{colors.surface-recessed}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lg}"
    padding: 12px
  nav-tab-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    height: "{spacing.tap-target}"
  nav-tab-inactive:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.lg}"
    height: "{spacing.tap-target}"
  badge-urgent:
    backgroundColor: "{colors.signal-vermilion}"
    textColor: "#FFFFFF"
    typography: "{typography.label-md}"
    rounded: "{rounded.sm}"
    padding: 4px
  badge-agent-nyx:
    backgroundColor: "{colors.agent-nyx-bg}"
    textColor: "{colors.agent-nyx-text}"
    typography: "{typography.label-lg}"
    rounded: "{rounded.md}"
    padding: 6px
  toast-banner:
    backgroundColor: "{colors.surface-charcoal}"
    textColor: "{colors.neutral}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: 12px
```

---

## Do's and Don'ts

### Visual & Color Guardrails
- **Do** reserve `signal-vermilion` (`#E03E1A`) strictly for `Blocked` statuses, `Urgent` priority badges, `resync_required` alerts, and destructive delete confirmations.
- **Don't** use red for simulation buttons, live event counters, or decorative chrome—use `signal-forest` (`#1E6F50`) or `primary` (`#161615`) instead.
- **Do** maintain the warm limestone/carbon-ink aesthetic across both light and dark modes; dark mode must use warm obsidian-charcoal tones (`#171614`, `#211F1C`), never cold blue-slate or pure `#000000` backgrounds.
- **Don't** use soft, blurry drop shadows or purple-blue AI gradients; all elevation must come from `1.5px`–`2px` solid borders and `0px`-blur vertical offset shadows (`0 3px 0`).

### Copy & Terminology Guardrails
- **Do** use clear, human-centered operator language across all primary views: `"Send a message"`, `"Waiting on me"`, `"Waiting on another task"`, `"Agents"` / `"Just me"`, `"Live Socket"` / `"Polling"`, and `"Zero Human Bottlenecks"`.
- **Don't** leak raw HTTP methods (`GET /admin/api/...`), SQL column names (`blocked_kind`, `status_changed_at`), raw JSON payloads, or raw epoch integers into task cards, filter dropdowns, or toast notifications (keep technical event names like `bus.message` and composite cursors `(ts, id)` scoped inside the dedicated Event Stream inspector).

### Interaction & Mobile Ergonomic Guardrails
- **Do** ensure every interactive element is at least `44px × 44px` (`.tap-44`) and every form control uses `font-size: 16px` minimum.
- **Don't** use native browser `alert()`, `confirm()`, or `prompt()` dialogs—always use custom slide-up bottom sheets (`#modal-sheet`).
- **Do** make horizontal swipe gestures physical: translate the card with finger movement and resistance, reveal a recessed background track, and animate the card smoothly back to `0px` (`cubic-bezier(0.22, 1, 0.36, 1)`) *before* opening the reply composer or toggling quick actions.
- **Don't** rewrite timestamps, emit poll events, or append duplicate activity log entries when the user taps a status button that is already active on a task.
- **Do** preserve both vertical and horizontal scroll positions across state re-renders, and keep unsaved task edits in `state.taskDrafts` so work is never lost.