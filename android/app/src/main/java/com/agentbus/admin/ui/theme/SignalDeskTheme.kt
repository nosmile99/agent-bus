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

// Paper Ledger (Light Theme) - all text pairs >= 4.9:1, all borders >= 3.2:1
val PaperLedgerPalette = SignalDeskPalette(
    isDark = false,
    bgCanvas = Color(0xFFF6F4EE),
    bgSurface = Color(0xFFFFFFFF),
    bgSubtle = Color(0xFFEAE6DC),
    inkPrimary = Color(0xFF141619),
    inkSecondary = Color(0xFF434952),
    inkMuted = Color(0xFF575F6B),
    borderStrong = Color(0xFF646C78),
    borderSubtle = Color(0xFF757E8A),
    signalVermilion = Color(0xFFB83214),
    onSignalVermilion = Color(0xFFFFFFFF),
    cobaltInk = Color(0xFF164E87),
    onCobaltInk = Color(0xFFFFFFFF),
    forestOk = Color(0xFF1B6535),
    onForestOk = Color(0xFFFFFFFF),
    amberWarn = Color(0xFF8A4B08),
    onAmberWarn = Color(0xFFFFFFFF),
    dangerCrimson = Color(0xFFA31D24),
    onDangerCrimson = Color(0xFFFFFFFF)
)

// Night Watch (Dark Theme) - all text pairs >= 5.0:1, all borders >= 3.2:1
val NightWatchPalette = SignalDeskPalette(
    isDark = true,
    bgCanvas = Color(0xFF101317),
    bgSurface = Color(0xFF181C22),
    bgSubtle = Color(0xFF212730),
    inkPrimary = Color(0xFFF0EDE6),
    inkSecondary = Color(0xFFC2C7D0),
    inkMuted = Color(0xFF98A1AE),
    borderStrong = Color(0xFF7A8494),
    borderSubtle = Color(0xFF687282),
    signalVermilion = Color(0xFFFF7A59),
    onSignalVermilion = Color(0xFF101317),
    cobaltInk = Color(0xFF68B2F8),
    onCobaltInk = Color(0xFF101317),
    forestOk = Color(0xFF5AD484),
    onForestOk = Color(0xFF101317),
    amberWarn = Color(0xFFF5B14C),
    onAmberWarn = Color(0xFF101317),
    dangerCrimson = Color(0xFFFF7077),
    onDangerCrimson = Color(0xFF101317)
)

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

fun createSignalDeskTypography(palette: SignalDeskPalette): SignalDeskTypography =
    SignalDeskTypography(
        displayTitle = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Bold,
            fontSize = 20.sp,
            lineHeight = 26.sp,
            color = palette.inkPrimary
        ),
        sectionHeader = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp,
            lineHeight = 22.sp,
            color = palette.inkPrimary
        ),
        cardTitle = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 15.sp,
            lineHeight = 21.sp,
            color = palette.inkPrimary
        ),
        bodyPrimary = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            color = palette.inkPrimary
        ),
        bodySecondary = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Normal,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            color = palette.inkSecondary
        ),
        monoCode = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            lineHeight = 17.sp,
            color = palette.inkPrimary
        ),
        monoTag = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp,
            lineHeight = 15.sp,
            color = palette.inkSecondary
        ),
        buttonLabel = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            lineHeight = 18.sp,
            color = palette.inkPrimary
        )
    )

val LocalSignalDeskPalette = staticCompositionLocalOf { PaperLedgerPalette }
val LocalSignalDeskTypography = staticCompositionLocalOf { createSignalDeskTypography(PaperLedgerPalette) }

object SdTheme {
    val colors: SignalDeskPalette
        @Composable get() = LocalSignalDeskPalette.current

    val typo: SignalDeskTypography
        @Composable get() = LocalSignalDeskTypography.current
}

@Composable
fun SignalDeskTheme(
    isDarkTheme: Boolean,
    content: @Composable () -> Unit
) {
    val palette = if (isDarkTheme) NightWatchPalette else PaperLedgerPalette
    val typography = createSignalDeskTypography(palette)
    CompositionLocalProvider(
        LocalSignalDeskPalette provides palette,
        LocalSignalDeskTypography provides typography,
        content = content
    )
}
