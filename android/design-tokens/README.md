# Design tokens

`tokens.json` is the **single source of truth**, in W3C Design Tokens (DTCG) format.

- `color.*` — primitive ramps (violet, sky, amber, neutral, red, green) + `brand.*`
  (the three locked agent identities) + `semantic.light.*` / `semantic.dark.*` aliases.
- `dimension.spacing` / `dimension.radius` / `dimension.elevation` — 4dp-base scales.
- `typography.*` — 15 styles mapped 1:1 to Material3 type slots.

Aliases use `{dotted.path}` references and are resolved by `generate.py`:

```bash
python3 design-tokens/generate.py
```

This emits `android/theme/.../GeneratedTokens.kt` (checked in). Re-run and commit
the result after any token edit. The theme module (`AstryxTheme.kt`, `Type.kt`,
`Shape.kt`, `Brand.kt`) consumes only generated values — never hardcoded hexes.
