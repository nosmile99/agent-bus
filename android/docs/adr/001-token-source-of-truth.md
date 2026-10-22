# ADR 001 — tokens.json is the single source of truth

Date: 2026-10-19
Status: Accepted

## Context

The design system needs one place where color, spacing, radius, elevation, and type
decisions live, so the Compose theme can never drift from the spec.

## Decision

`design-tokens/tokens.json` (W3C DTCG) is the source of truth. `generate.py`
resolves `{alias}` references and emits `GeneratedTokens.kt`, which is checked in.
The theme module consumes generated values only — no hardcoded hexes in Kotlin.

## Consequences

- Token edits require re-running the generator and committing the output.
- The JSON is tool-agnostic: a future web/iOS target can consume the same file.
