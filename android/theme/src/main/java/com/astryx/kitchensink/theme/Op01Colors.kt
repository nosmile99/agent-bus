package com.astryx.kitchensink.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * OP-01 color tokens. Values are law — they mirror design-tokens/op01-tokens.json
 * and docs/op01-DESIGN.md exactly. Warm neutrals only; no cold slate, no pure black.
 */
@Immutable
data class Op01Colors(
    val paper: Color,
    val outer: Color,
    val card: Color,
    val recessed: Color,
    val charcoal: Color,
    val charcoalText: Color,
    val ink: Color,
    val secondary: Color,
    val borderSubtle: Color,
    val borderInset: Color,
    val borderHardware: Color,
    val shadow: Color,
    val forest: Color,
    val ochre: Color,
    val vermilion: Color,
    val cobalt: Color,
    val plum: Color,
    val led: Color,
    val cautionRedA: Color,
    val cautionRedB: Color,
    val cautionAmberA: Color,
    val cautionAmberB: Color,
    val isDark: Boolean,
)

val Op01LightColors = Op01Colors(
    paper = Color(0xFFF4F1EA),
    outer = Color(0xFFE2DDD3),
    card = Color(0xFFFAF8F5),
    recessed = Color(0xFFEAE5DC),
    charcoal = Color(0xFF262523),
    charcoalText = Color(0xFFF4F1EA),
    ink = Color(0xFF161615),
    secondary = Color(0xFF6E6A63),
    borderSubtle = Color(0xFFD6D0C4),
    borderInset = Color(0xFFC8C1B4),
    borderHardware = Color(0xFF161615),
    shadow = Color(0xFF161615),
    forest = Color(0xFF1E6F50),
    ochre = Color(0xFFD98200),
    vermilion = Color(0xFFE03E1A),
    cobalt = Color(0xFF1D4ED8),
    plum = Color(0xFF6D28D9),
    led = Color(0xFF34D399),
    cautionRedA = Color(0xFFFEE2E2),
    cautionRedB = Color(0xFFFECACA),
    cautionAmberA = Color(0xFFFEF3C7),
    cautionAmberB = Color(0xFFFDE68A),
    isDark = false,
)

val Op01DarkColors = Op01Colors(
    paper = Color(0xFF171614),
    outer = Color(0xFF0D0C0B),
    card = Color(0xFF211F1C),
    recessed = Color(0xFF121110),
    charcoal = Color(0xFF1D1B18),
    charcoalText = Color(0xFFF2EFE9),
    ink = Color(0xFFF2EFE9),
    secondary = Color(0xFF9E988E),
    borderSubtle = Color(0xFF35322D),
    borderInset = Color(0xFF2E2B27),
    borderHardware = Color(0xFF3A3630),
    shadow = Color(0xFF090908),
    forest = Color(0xFF1E6F50),
    ochre = Color(0xFFD98200),
    vermilion = Color(0xFFE03E1A),
    cobalt = Color(0xFF1D4ED8),
    plum = Color(0xFF6D28D9),
    led = Color(0xFF34D399),
    cautionRedA = Color(0xFF3B1815),
    cautionRedB = Color(0xFF4C1D19),
    cautionAmberA = Color(0xFF382810),
    cautionAmberB = Color(0xFF493414),
    isDark = true,
)

/** Agent identity badge pairings — color encodes who, never state. */
@Immutable
data class AgentBadgeColors(
    val bg: Color,
    val text: Color,
    val border: Color,
    val dot: Color,
)

object AgentBadges {
    val Nyx = AgentBadgeColors(
        bg = Color(0xFFE0E7FF), text = Color(0xFF1E1B4B),
        border = Color(0xFF3730A3), dot = Color(0xFF4F46E5),
    )
    val Nosmile99 = AgentBadgeColors(
        bg = Color(0xFFD1FAE5), text = Color(0xFF022C22),
        border = Color(0xFF065F46), dot = Color(0xFF059669),
    )
    val Wren = AgentBadgeColors(
        bg = Color(0xFFFEF3C7), text = Color(0xFF451A03),
        border = Color(0xFF92400E), dot = Color(0xFFD97706),
    )
    val Luki = AgentBadgeColors(
        bg = Color(0xFFE7E5E4), text = Color(0xFF1C1917),
        border = Color(0xFF44403C), dot = Color(0xFF1E6F50),
    )

    fun forKey(key: String): AgentBadgeColors = when (key) {
        "nyx" -> Nyx
        "nosmile99" -> Nosmile99
        "wren" -> Wren
        else -> Luki
    }
}
