# ADR 004 — Pivot from Astryx to OP-01 "Tactile Field Dispatcher"

Status: Accepted (2026-10-21). Supersedes ADR 002 (Material3 mapping) and the brand
mapping in ADR 003 for all visible UI.

## Context

The Astryx-inspired kitchen sink (ADR 001–003) shipped green on CI, but was rejected on
review: rendered through Material3 components and the Material type/shape system, it still
read as a Material template wearing tokens. The failure was structural, not chromatic —
M3 tonal containers, soft elevation, ripple states, and Roboto-adjacent typography carry
the Material look regardless of which hex values are poured into the scheme.

In parallel, the Agent Bus operator console acquired its own governing design system:
**OP-01 "Tactile Field Dispatcher"** (see `docs/op01-DESIGN.md`), a hardware-inspired
language derived from Braun / Teenage Engineering field instruments — warm limestone
surfaces, carbon-ink borders, hard 0-blur offset shadows, Fraunces editorial serif plus
IBM Plex Mono telemetry, and strict signal discipline (vermilion is blocked/urgent/
destructive only). A web prototype of OP-01 was built and verified first; this app now
ports that prototype to native Compose so both platforms share one design law.

## Decision

1. **OP-01 is the design system of record.** `docs/op01-DESIGN.md` is the governing spec;
   `design-tokens/op01-tokens.json` is the W3C token source for it. The Astryx artifacts
   (`design-tokens/tokens.json`, ADR 001–003, the Material3 theme mapping) are kept for
   history but no longer drive any visible UI.
2. **Material3 is removed from the app entirely** — not restyled, removed. All visible
   components are custom composables built on Compose Foundation primitives: 1.5–2dp
   carbon borders, hard offset shadow layers with zero blur, and keycap press physics
   (translateY 2dp, shadow collapses to 0.5dp). No tonal containers, no ripple-gray
   states, no FAB, no Roboto.
3. **Brand identity changes with the system.** The old trio (Nyx violet / Ryuki sky /
   nosmile99 amber in Astryx roles) is replaced by OP-01 agent badge pairings:
   Nyx indigo, nosmile99 emerald, Wren amber, Luki stone. Color now encodes *who*,
   while forest / ochre / vermilion encode *state* — and vermilion is rationed.
4. **The app is a working console port, not a specimen grid.** Its five tabs (Feed,
   Needs, Board, Agents, System) port the web prototype's screens, mock data, and
   interactions; the System tab carries the foundations/components catalog role the old
   kitchen-sink screens served.
5. **Typography is bundled, never downloaded at runtime.** Static TTF instances of
   Fraunces (700), Plus Jakarta Sans (400/500/600/700), and IBM Plex Mono (400/600/700)
   ship in the theme module's `res/font`.

## Consequences

- The theme module exposes `Op01Theme` + `Op01Colors` via CompositionLocal instead of a
  Material `ColorScheme`; components read tokens from `Op01Theme.colors`.
- Anything that still needs a Material component must be justified against
  `docs/op01-DESIGN.md` first — the default answer is to build the hardware primitive.
- The old Astryx screens and theme files are deleted, not deprecated in place, so no
  future change can quietly resurrect the Material look.
