# Astryx Kitchen Sink

A native Kotlin + Jetpack Compose kitchen-sink demo app that is the **reference implementation**
of an Astryx-inspired design system: one theme, three agent identities, light + dark
(OLED-friendly) variants.

## Attribution

The token *taxonomy* (color roles, type scale, spacing, radii, elevation) is inspired by
**Astryx**, Meta's open-source design system — https://astryx.atmeta.com.
**No Astryx/Meta raw tokens are used in this repo.** Every token name and value was re-derived;
see `design-tokens/tokens.json` and `docs/adr/001-token-source-of-truth.md`.

## Brand mapping (locked)

| Identity   | Hex       | Role                      |
|------------|-----------|---------------------------|
| Nyx        | `#A855F7` | Primary / brand accent    |
| Ryuki      | `#38BDF8` | Secondary / info accent   |
| nosmile99  | `#F59E0B` | Highlight / warning accent|

## Layout

```
design-tokens/   W3C Design Tokens JSON — the single source of truth
                 tokens.json (+ generate.py -> GeneratedTokens.kt)
android/theme/   Compose theme module: Material3 ColorScheme/Typography/Shapes
                 mapped 1:1 from the generated tokens
app/             Kitchen-sink sample app; its screens ARE the showcase
docs/            ADRs + review log
```

## Tokens -> code

```
design-tokens/tokens.json
        |  python3 design-tokens/generate.py
        v
android/theme/.../GeneratedTokens.kt   (checked in; regenerate after token edits)
        |
        v
AstryxTheme.kt (ColorScheme) · Type.kt (Typography) · Shape.kt (Shapes) · Brand.kt
```

## Build

Prerequisites: JDK 17+, Android SDK with `platforms;android-34` and `build-tools;34.0.0`.

```bash
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Regenerate tokens after editing `design-tokens/tokens.json`:

```bash
python3 design-tokens/generate.py
```

## Screens

Home · Foundations (color ramps, type, spacing, radii, elevation) · Components
(buttons, cards, inputs, selection, feedback, lists, navigation) · Brand
(three agent identities). Toggle light/dark from the top bar.

## License

MIT — see [LICENSE](LICENSE).
