package com.agentbus.admin.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RadialGradientShader
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Obsidian Design System (v1.1.0) tokens ported to Jetpack Compose.
 * Dark Luxe theme, gold-lit near-black workspace UI.
 */
@Immutable
data class ObsidianPalette(
    // Ground & Text
    val bg: Color = Color(0xFF08090C),
    val text: Color = Color(0xFFF4F4F6),
    val textSoft: Color = Color(0xFFD5D7DF),
    val textDim: Color = Color(0xFFC7C9D3),
    val muted: Color = Color(0xFF9A9DAB),
    val faint: Color = Color(0xFF8D909E),

    // Gold Accents
    val accent: Color = Color(0xFFE5C158),
    val accentInk: Color = Color(0xFF08090C),
    val goldLight: Color = Color(0xFFF0D27A),
    val goldDeep: Color = Color(0xFFC99E32),
    val onGold: Color = Color(0xFF0D0E12),
    val goldPale: Color = Color(0xFFFDE68A),
    val goldEdge: Color = Color(0x99FFF3C9),
    val amberFill: Color = Color(0x26FBBF24),
    val amberLine: Color = Color(0x4DFBBF24),

    // Surface & Items
    val surfaceTop: Color = Color(0xFF1E2028),
    val surfaceBottom: Color = Color(0xFF0E1015),
    val surfaceLine: Color = Color(0x40E5C158),
    val itemTop: Color = Color(0x0DFFFFFF),
    val itemBottom: Color = Color(0x05FFFFFF),
    val itemHoverLine: Color = Color(0x66E5C158),
    val itemHoverFill: Color = Color(0x0FE5C158),
    val fill: Color = Color(0x0AFFFFFF),
    val fillHover: Color = Color(0x1AFFFFFF),
    val line: Color = Color(0x14FFFFFF),
    val lineStrong: Color = Color(0x1AFFFFFF),
    val lineChip: Color = Color(0x1FFFFFFF),
    val focusLine: Color = Color(0x80E5C158),
    val topbarFill: Color = Color(0xE008090C),
    val backdrop: Color = Color(0xBD040508),
    val optionFill: Color = Color(0xFF14161C),
    val lensTop: Color = Color(0xFFFFFFFF),
    val lensBottom: Color = Color(0xFFE9EAEF),
    val glowGold: Color = Color(0x17E5C158),
    val glowBlue: Color = Color(0x0D6E82FF),

    // Feedback & Danger
    val danger: Color = Color(0xFFFCA5A5),
    val dangerLine: Color = Color(0x59F87171),
    val errorLine: Color = Color(0xB3F87171),
    val successLight: Color = Color(0xFF6EE7B7),
    val successDeep: Color = Color(0xFF10B981),
    val successEdge: Color = Color(0xFFA7F3D0),

    // Status tones
    val statusBacklog: Color = Color(0xFFA1A8BB),
    val statusDoing: Color = Color(0xFF72ABFF),
    val statusBlocked: Color = Color(0xFFFF8282),
    val statusDone: Color = Color(0xFF34D399),

    // Label tones
    val labelDev: Color = Color(0xFF7DB2FF),
    val labelDesain: Color = Color(0xFFB79BFF),
    val labelRiset: Color = Color(0xFFF1D36B),
    val labelKonten: Color = Color(0xFFFF9DB5),
    val labelDocs: Color = Color(0xFF6EE7B7)
) {
    val goldGradient: Brush
        get() = Brush.linearGradient(
            colors = listOf(goldLight, goldDeep),
            start = Offset(0f, 0f),
            end = Offset(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY)
        )

    val itemGradient: Brush
        get() = Brush.verticalGradient(
            colors = listOf(itemTop, itemBottom)
        )

    val surfaceGradient: Brush
        get() = Brush.verticalGradient(
            colors = listOf(surfaceTop, surfaceBottom)
        )

    val successGradient: Brush
        get() = Brush.linearGradient(
            colors = listOf(successLight, successDeep)
        )

    val lensGradient: Brush
        get() = Brush.verticalGradient(
            colors = listOf(lensTop, lensBottom)
        )
}

val DarkLuxePalette = ObsidianPalette()

@Immutable
data class ObsidianTypography(
    // Editorial Serif
    val display: TextStyle,

    // Display Grotesk
    val brand: TextStyle,
    val blockTitle: TextStyle,
    val columnTitle: TextStyle,

    // Body (Plus Jakarta Sans)
    val modalTitle: TextStyle,
    val body: TextStyle,
    val cardTitle: TextStyle,
    val label: TextStyle,
    val small: TextStyle,
    val fieldLabel: TextStyle,
    val meta: TextStyle,
    val tag: TextStyle,

    // Mono (JetBrains Mono)
    val metric: TextStyle,
    val eyebrow: TextStyle,
    val overline: TextStyle,
    val monoMeta: TextStyle
)

fun createObsidianTypography(p: ObsidianPalette = DarkLuxePalette): ObsidianTypography =
    ObsidianTypography(
        display = TextStyle(
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Normal,
            fontSize = 42.sp,
            lineHeight = 44.sp,
            color = p.text,
            letterSpacing = (-0.01).sp
        ),
        brand = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Bold,
            fontSize = 16.sp,
            lineHeight = 23.sp,
            letterSpacing = 0.01.sp,
            color = p.text
        ),
        blockTitle = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            lineHeight = 23.sp,
            color = p.text
        ),
        columnTitle = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            letterSpacing = 0.01.sp,
            color = p.text
        ),
        modalTitle = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Bold,
            fontSize = 24.sp,
            lineHeight = 30.sp,
            letterSpacing = (-0.005).sp,
            color = p.text
        ),
        body = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            color = p.text
        ),
        cardTitle = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 14.sp,
            lineHeight = 19.sp,
            color = p.text
        ),
        label = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            lineHeight = 16.sp,
            color = p.text
        ),
        small = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 12.5.sp,
            lineHeight = 18.sp,
            color = p.text
        ),
        fieldLabel = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Bold,
            fontSize = 12.sp,
            lineHeight = 17.sp,
            letterSpacing = 0.02.sp,
            color = p.muted
        ),
        meta = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Normal,
            fontSize = 11.5.sp,
            lineHeight = 17.sp,
            color = p.muted
        ),
        tag = TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp,
            lineHeight = 18.sp,
            letterSpacing = 0.01.sp,
            color = p.text
        ),
        metric = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
            fontSize = 30.sp,
            lineHeight = 36.sp,
            color = p.text
        ),
        eyebrow = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Normal,
            fontSize = 11.sp,
            lineHeight = 16.sp,
            letterSpacing = 0.16.sp,
            color = p.accent
        ),
        overline = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Normal,
            fontSize = 10.5.sp,
            lineHeight = 15.sp,
            letterSpacing = 0.14.sp,
            color = p.faint
        ),
        monoMeta = TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Normal,
            fontSize = 11.5.sp,
            lineHeight = 17.sp,
            color = p.faint
        )
    )

object ObsidianShapes {
    val radius6 = RoundedCornerShape(6.dp)
    val radius8 = RoundedCornerShape(8.dp)
    val radius9 = RoundedCornerShape(9.dp)
    val radius10 = RoundedCornerShape(10.dp)
    val radius11 = RoundedCornerShape(11.dp)
    val radius12 = RoundedCornerShape(12.dp)
    val radius14 = RoundedCornerShape(14.dp)
    val radius18 = RoundedCornerShape(18.dp)
    val radiusFull = RoundedCornerShape(999.dp)
}

object ObsidianSpacing {
    val space4: Dp = 4.dp
    val space6: Dp = 6.dp
    val space8: Dp = 8.dp
    val space10: Dp = 10.dp
    val space12: Dp = 12.dp
    val space14: Dp = 14.dp
    val space16: Dp = 16.dp
    val space18: Dp = 18.dp
    val space20: Dp = 20.dp
    val space22: Dp = 22.dp
    val space24: Dp = 24.dp
    val space28: Dp = 28.dp
}

val LocalObsidianPalette = staticCompositionLocalOf { DarkLuxePalette }
val LocalObsidianTypography = staticCompositionLocalOf { createObsidianTypography(DarkLuxePalette) }

object ObsidianTheme {
    val colors: ObsidianPalette
        @Composable get() = LocalObsidianPalette.current

    val typography: ObsidianTypography
        @Composable get() = LocalObsidianTypography.current

    val shapes: ObsidianShapes
        get() = ObsidianShapes

    val spacing: ObsidianSpacing
        get() = ObsidianSpacing
}

@Composable
fun ObsidianTheme(
    palette: ObsidianPalette = DarkLuxePalette,
    typography: ObsidianTypography = createObsidianTypography(palette),
    content: @Composable () -> Unit
) {
    CompositionLocalProvider(
        LocalObsidianPalette provides palette,
        LocalObsidianTypography provides typography,
        content = content
    )
}
