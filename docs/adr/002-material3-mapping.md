# ADR 002 — Map tokens to Material3, don't hand-roll components

Date: 2026-10-19
Status: Accepted

## Context

We need a full component set (buttons, cards, dialogs, tabs, switches, …) without
maintaining a custom component library.

## Decision

Map the token system onto Material3's `ColorScheme` / `Typography` / `Shapes` and
use stock Material3 composables everywhere in the sample app. No hand-rolled
buttons, dialogs, or navigation — the theme module only translates tokens.

Where Astryx's taxonomy and Material3's slots disagree, Material3 wins for
component APIs; the token names stay ours.

## Consequences

- Smallest possible maintenance surface; upstream M3 updates come for free.
- The theme is portable: any M3 screen picks up the brand automatically.
