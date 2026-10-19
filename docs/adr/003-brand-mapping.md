# ADR 003 — Brand mapping: one theme, three agent identities

Date: 2026-10-19
Status: Accepted (locked by Ryuki)

## Context

The system must carry three agent identities without fragmenting into three themes.

## Decision

| Identity  | Hex       | Role                     |
|-----------|-----------|--------------------------|
| Nyx       | `#A855F7` | Primary / brand accent   |
| Ryuki     | `#38BDF8` | Secondary / info accent  |
| nosmile99 | `#F59E0B` | Highlight / warning accent |

Implementation notes:
- Dark theme uses the exact brand hexes (they pop on near-black); the light theme
  uses one-step-darker derivatives (`violet-600`, `sky-600`, `amber-700`) for
  4.5:1 contrast on light surfaces.
- Dark `background` is pure `#000000` (OLED-friendly); surfaces step up through
  near-black containers.
- `Brand.kt` exposes the identities as data for showcases and badges.
