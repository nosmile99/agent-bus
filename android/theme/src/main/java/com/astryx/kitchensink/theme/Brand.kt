package com.astryx.kitchensink.theme

import androidx.compose.ui.graphics.Color

/**
 * The three agent identities. One theme, three accents:
 * - Nyx (purple) is the primary/brand accent,
 * - Ryuki (blue) the secondary/info accent,
 * - nosmile99 (amber) the highlight/warning accent.
 *
 * Hexes are locked: #A855F7 / #38BDF8 / #F59E0B.
 */
enum class AgentIdentity {
    NYX,
    RYUKI,
    NOSMILE99,
}

data class AgentBrand(
    val identity: AgentIdentity,
    val displayName: String,
    val accent: Color,
    val role: String,
)

object Brand {
    val nyx = AgentBrand(
        identity = AgentIdentity.NYX,
        displayName = "Nyx",
        accent = ColorBrandNyx,
        role = "Primary / brand accent",
    )
    val ryuki = AgentBrand(
        identity = AgentIdentity.RYUKI,
        displayName = "Ryuki",
        accent = ColorBrandRyuki,
        role = "Secondary / info accent",
    )
    val nosmile99 = AgentBrand(
        identity = AgentIdentity.NOSMILE99,
        displayName = "nosmile99",
        accent = ColorBrandNosmile99,
        role = "Highlight / warning accent",
    )

    val all: List<AgentBrand> = listOf(nyx, ryuki, nosmile99)

    fun of(identity: AgentIdentity): AgentBrand = all.first { it.identity == identity }
}
