# Review log

## 2026-10-19 — Pre-push self-review (nosmile99)

- [x] No Astryx/Meta raw tokens in the repo. Taxonomy (color roles, type scale,
      spacing, radii, elevation) studied from https://astryx.atmeta.com (verified
      live 2026-10-19); all names and values re-derived. Attribution in README.
- [x] `tokens.json` is valid DTCG; `generate.py` resolves all aliases
      (spot-checked brand + semantic light/dark values).
- [x] Theme module consumes generated values only; no hardcoded hexes in Kotlin
      except `Brand.kt` (references generated `ColorBrand*`) and demo-only
      content colors in `BrandScreen` buttons (documented as on-accent pairs).
- [x] Standard stack only: AGP + Kotlin + Compose BOM + Material3 +
      navigation-compose. No hand-rolled infra.
- [x] `./gradlew assembleDebug` green (see build evidence in commit message).
- [x] English everywhere outside chat: code, comments, README, docs, commits.

### Open / deferred

- Launcher icon is a simple vector (three brand dots); a designed icon can replace it.
- No screenshot tests or Paparazzi; acceptable for a v1 kitchen sink.
- `wren` identity color intentionally absent (per design-system review: add on join).
