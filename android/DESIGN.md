# DESIGN: Signal Desk - Agent Bus Admin Client

## Identity & Character

- **Product**: Agent Bus Admin (`com.agentbus.admin`)
- **Audience**: System administrator (`luki`) operating a live multi-agent message bus and Kanban workflow hub.
- **Visual Language**: **Signal Desk (Field Dispatch Ledger)**. Inspired by railway dispatch boards, telegraph control ledgers, and split-flap station signage. Prioritizes rapid visual scanning of message channels, lane assignments (`backend`, `android`, `unassigned`), blocked tasks requiring human intervention, and live event stream cursors.
- **Dials**: `Dial: ENERGY 2 / RHYTHM 2 / MOTION 1`
  - **ENERGY 2 (Balanced)**: Strong typographic hierarchy pairing tabular monospace identifiers (`#ID`, lane codes, epoch/UTC timestamps, composite cursors) with crisp sans-serif body copy and 1dp–2dp structural rules.
  - **RHYTHM 2 (Consistent with deliberate breaks)**: Asymmetric index-tab section headers (`[01 FEED]`, `[02 BOARD]`, `[03 NEEDS]`, `[04 AGENTS]`, `[05 OPS]`) paired with high-density ledger rows in Feed, status-grouped Kanban cards with embedded checklists in Board, and focused triage cards in Needs.
  - **MOTION 1 (State transitions only)**: Immediate mechanical press and focus-ring state changes; zero endless pulsing dots or decorative animations (R-19).

## Color System (R-25, R-29, R-34)

Active palette is capped at 3 core semantic families + 1 primary signal accent + structural neutrals. Both **Paper Ledger (Light)** and **Night Watch (Dark)** themes are first-class and toggleable from the top dispatch bar, with every text/surface pair verified at >= 4.5:1 (normal text) and every component border/indicator at >= 3.0:1 (non-text contrast).

### Paper Ledger (Light Theme)
- `bgCanvas`: `#F6F4EE` (Archival ledger paper)
- `bgSurface`: `#FFFFFF` (Elevated card & sheet surface)
- `bgSubtle`: `#EAE6DC` (Recessed filter bar & input well)
- `inkPrimary`: `#141619` (Carbon ink; 16.51:1 on `#F6F4EE`, 18.13:1 on `#FFFFFF`)
- `inkSecondary`: `#434952` (Graphite; 7.91:1 on `#F6F4EE`, 7.03:1 on `#EAE6DC`)
- `inkMuted`: `#575F6B` (Stamp slate; 5.51:1 on `#F6F4EE`, 4.90:1 on `#EAE6DC`)
- `borderStrong`: `#646C78` (4.20:1 on `#F6F4EE`, 4.61:1 on `#FFFFFF`)
- `borderSubtle`: `#757E8A` (3.26:1 on `#F6F4EE`, 3.58:1 on `#FFFFFF`)
- **Primary Accent (`signalVermilion`)**: `#B83214` (5.95:1 with `#FFFFFF` text; 5.38:1 on `#F6F4EE`)
- **Core Operational (`cobaltInk`)**: `#164E87` (8.29:1 with `#FFFFFF` text; 7.50:1 on `#F6F4EE`)
- **Core Status (`forestOk` / `amberWarn` / `dangerCrimson`)**:
  - `forestOk`: `#1B6535` (6.95:1 with `#FFFFFF`; 6.29:1 on `#F6F4EE`)
  - `amberWarn`: `#8A4B08` (6.26:1 with `#FFFFFF`; 5.67:1 on `#F6F4EE`)
  - `dangerCrimson`: `#A31D24` (7.13:1 with `#FFFFFF`; 6.45:1 on `#F6F4EE`)

### Night Watch (Dark Theme)
- `bgCanvas`: `#101317` (Bunker slate)
- `bgSurface`: `#181C22` (Panel slate)
- `bgSubtle`: `#212730` (Recessed well)
- `inkPrimary`: `#F0EDE6` (Bone white; 15.80:1 on `#101317`, 14.32:1 on `#181C22`)
- `inkSecondary`: `#C2C7D0` (Silver; 10.12:1 on `#181C22`)
- `inkMuted`: `#98A1AE` (Steel; 6.02:1 on `#181C22`, 5.09:1 on `#212730`)
- `borderStrong`: `#7A8494` (4.21:1 on `#181C22`)
- `borderSubtle`: `#687282` (3.24:1 on `#181C22`)
- **Primary Accent (`signalVermilion`)**: `#FF7A59` (7.41:1 with `#101317` dark ink; 6.62:1 on `#181C22`)
- **Core Operational (`cobaltInk`)**: `#68B2F8` (8.72:1 with `#101317` dark ink; 7.80:1 on `#181C22`)
- **Core Status (`forestOk` / `amberWarn` / `dangerCrimson`)**:
  - `forestOk`: `#5AD484` (8.91:1 on `#181C22`)
  - `amberWarn`: `#F5B14C` (8.60:1 on `#181C22`)
  - `dangerCrimson`: `#FF7077` (6.31:1 on `#181C22`)

## One-Line Reasons for Visual Decisions (R-31)

- **Why this color palette**: Archival paper (`#F6F4EE`) and bunker slate (`#101317`) paired with signal vermilion (`#B83214` / `#FF7A59`) evoke physical dispatch ledgers while guaranteeing >4.5:1 text contrast and >3:1 border contrast in both daylight and night-watch operations.
- **Why this layout**: Five task-specific workspaces (`Feed`, `Board`, `Needs`, `Agents`, `Ops`) with adaptive 1/2/4-column reflow keep the administrator's primary decision on each screen immediately reachable without template filler.
- **Why this typography**: Sans-serif prose keeps long message bodies and task descriptions readable, while tabular monospace is reserved strictly for message IDs, channel/lane tags, UTC/WIB timestamps, and composite poll cursors.
- **Why this spacing & radius scale**: Sharp `2dp` corners on technical tags, `4dp` on interactive controls, and `6dp` on panels visually distinguish read-only badges from clickable controls (`>= 48dp` touch targets with `>= 6dp` gaps).
- **Why use cards**: Framed ledger cards group multi-action entities (Kanban tasks with inline todos, blocked human-triage items, and agent credential rows) where distinct boundaries prevent accidental cross-row taps.
- **Why custom geometric canvas glyphs**: Purpose-drawn vector strokes on Compose `Canvas` (status squares, directional chevrons, lock/key marks) communicate state alongside text labels without relying on generic icon libraries.
