package com.agentbus.admin.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Signal Desk Theme adaptation backed 100% by the Obsidian Design System (Dark Luxe).
 * Dark-only, gold-lit near-black workspace UI.
 */
@Immutable
data class SignalDeskPalette(
    val isDark: Boolean,
    val bgCanvas: Color,
    val bgSurface: Color,
    val bgSubtle: Color,
    val inkPrimary: Color,
    val inkSecondary: Color,
    val inkMuted: Color,
    val borderStrong: Color,
    val borderSubtle: Color,
    val signalVermilion: Color,
    val onSignalVermilion: Color,
    val cobaltInk: Color,
    val onCobaltInk: Color,
    val forestOk: Color,
    val onForestOk: Color,
    val amberWarn: Color,
    val onAmberWarn: Color,
    val dangerCrimson: Color,
    val onDangerCrimson: Color
)

// Obsidian Dark Luxe mapped palette
val ObsidianDarkLuxeSignalPalette = SignalDeskPalette(
    isDark = true,
    bgCanvas = DarkLuxePalette.bg,
    bgSurface = DarkLuxePalette.surfaceTop,
    bgSubtle = DarkLuxePalette.fill,
    inkPrimary = DarkLuxePalette.text,
    inkSecondary = DarkLuxePalette.textSoft,
    inkMuted = DarkLuxePalette.muted,
    borderStrong = DarkLuxePalette.surfaceLine,
    borderSubtle = DarkLuxePalette.line,
    signalVermilion = DarkLuxePalette.accent,
    onSignalVermilion = DarkLuxePalette.onGold,
    cobaltInk = DarkLuxePalette.statusDoing,
    onCobaltInk = DarkLuxePalette.onGold,
    forestOk = DarkLuxePalette.statusDone,
    onForestOk = DarkLuxePalette.onGold,
    amberWarn = DarkLuxePalette.accent,
    onAmberWarn = DarkLuxePalette.onGold,
    dangerCrimson = DarkLuxePalette.danger,
    onDangerCrimson = DarkLuxePalette.accentInk
)

// Compatibility aliases pointing to Obsidian Dark Luxe
val PaperLedgerPalette = ObsidianDarkLuxeSignalPalette
val NightWatchPalette = ObsidianDarkLuxeSignalPalette

@Immutable
data class SignalDeskTypography(
    val displayTitle: TextStyle,
    val sectionHeader: TextStyle,
    val cardTitle: TextStyle,
    val bodyPrimary: TextStyle,
    val bodySecondary: TextStyle,
    val monoCode: TextStyle,
    val monoTag: TextStyle,
    val buttonLabel: TextStyle
)

fun createSignalDeskTypography(palette: SignalDeskPalette = ObsidianDarkLuxeSignalPalette): SignalDeskTypography {
    val obsTypo = createObsidianTypography(DarkLuxePalette)
    return SignalDeskTypography(
        displayTitle = obsTypo.display.copy(fontSize = 24.sp, lineHeight = 30.sp, fontWeight = FontWeight.Bold),
        sectionHeader = obsTypo.blockTitle,
        cardTitle = obsTypo.cardTitle,
        bodyPrimary = obsTypo.body,
        bodySecondary = obsTypo.meta.copy(color = palette.inkSecondary),
        monoCode = obsTypo.monoMeta.copy(fontSize = 12.sp),
        monoTag = obsTypo.tag,
        buttonLabel = obsTypo.label
    )
}

val LocalSignalDeskPalette = staticCompositionLocalOf { ObsidianDarkLuxeSignalPalette }
val LocalSignalDeskTypography = staticCompositionLocalOf { createSignalDeskTypography(ObsidianDarkLuxeSignalPalette) }

object SdTheme {
    val colors: SignalDeskPalette
        @Composable get() = LocalSignalDeskPalette.current

    val typo: SignalDeskTypography
        @Composable get() = LocalSignalDeskTypography.current
}

@Composable
fun SignalDeskTheme(
    isDarkTheme: Boolean = true,
    content: @Composable () -> Unit
) {
    val palette = ObsidianDarkLuxeSignalPalette
    val typography = createSignalDeskTypography(palette)
    CompositionLocalProvider(
        LocalSignalDeskPalette provides palette,
        LocalSignalDeskTypography provides typography,
        LocalObsidianPalette provides DarkLuxePalette,
        LocalObsidianTypography provides createObsidianTypography(DarkLuxePalette)
    ) {
        content()
    }
}
