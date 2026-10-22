# OP-01 Kitchen Sink — Tactile Field Dispatcher

A native Kotlin + Jetpack Compose kitchen-sink app that is the **reference implementation**
of **BUS // OP-01**, the Agent Bus design system: a Braun / Teenage-Engineering-style
field console for operator↔agent dispatch. Warm limestone surfaces, carbon borders,
hard offset shadows, keycap press physics — and zero Material chrome.

> This project previously implemented an Astryx-inspired Material3 system. That direction
> was rejected ("still feels like Material") and fully replaced by OP-01.
> See `docs/adr/004-op01-pivot.md`. The old `design-tokens/tokens.json` remains in the
> tree as history only.

## The law

`docs/op01-DESIGN.md` is the governing spec — tokens, geometry, interaction physics.
If code and spec disagree, the spec wins.

## Design tokens

```
design-tokens/op01-tokens.json   W3C Design Tokens JSON — OP-01 source of truth
android/theme/                   Compose theme: Op01Colors / Op01Type / Op01Theme
                                 (hand-mapped 1:1 from the JSON; no codegen)
```

Key values: paper `#F4F1EA`, ink `#161615`, charcoal `#262523`; signals forest `#1E6F50`,
ochre `#D98200`, vermilion `#E03E1A` (blocked/urgent/destructive only). Agent identities:
nyx indigo, nosmile99 emerald, wren amber, luki stone. Type: Fraunces (display),
Plus Jakarta Sans (body, inputs ≥16sp), IBM Plex Mono (labels/telemetry) — bundled as
static TTFs in `android/theme/src/main/res/font/`.

## Anti-Material rules

- Custom composables only for visible UI — no Material3 components, no ripple,
  no FAB, no tonal containers, no Roboto.
- Every surface: 1.5–2dp solid carbon border + hard shadow (solid offset, 0 blur;
  cards `0 3dp 0`, buttons `0 2.5dp 0`).
- Button press = translateY(2dp) + shadow shrinks to 0.5dp.

## Screens (5 tabs)

| Tab    | What it shows |
|--------|---------------|
| Feed   | Agent message stream, resync banner, swipe-to-reply cards, expanding composer dock |
| Needs  | "Waiting on me" blocked tasks with Unblock actions; zero-state when clear |
| Board  | 4-column kanban as a snapping horizontal pager; task cards + full detail sheet |
| Agents | Transport switch (Live Socket / Polling), agent cards, quota meters, event inspector |
| System | The catalog: swatches, type specimens, button variants, inputs, meters, stripes |

State is in-memory mock data ported from the OP-01 web prototype — no backend.

## Build

Prerequisites: JDK 17+, Android SDK with `platforms;android-34` and `build-tools;34.0.0`.

```bash
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

CI (`.github/workflows/android-ci.yml`) builds on every push to `dev`.

## License

MIT — see [LICENSE](LICENSE).
