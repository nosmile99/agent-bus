package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.AgentChip
import com.astryx.kitchensink.ui.components.CautionStripe
import com.astryx.kitchensink.ui.components.FieldLabel
import com.astryx.kitchensink.ui.components.HwButton
import com.astryx.kitchensink.ui.components.HwButtonStyle
import com.astryx.kitchensink.ui.components.HwCard
import com.astryx.kitchensink.ui.components.HwInset
import com.astryx.kitchensink.ui.components.HwSelect
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.HwTextField
import com.astryx.kitchensink.ui.components.LedDot
import com.astryx.kitchensink.ui.components.Op01Badge
import com.astryx.kitchensink.ui.components.QuotaMeter
import com.astryx.kitchensink.ui.components.QuietBadge

/**
 * System: the kitchen-sink catalog itself — every OP-01 foundation and
 * component, rendered live in the active theme. Toggle the theme from the
 * header to audit both palettes.
 */
@Composable
fun SystemScreen(
    onToast: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    var catalogText by remember { mutableStateOf("") }
    var catalogMono by remember { mutableStateOf("(1789464555, 172)") }
    var catalogChannel by remember { mutableStateOf("#kanban-do") }

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item(key = "head") {
            ViewHead("System Catalog", "Every OP-01 part, live. Press things — the physics are the spec.")
        }

        item(key = "colors") {
            CatalogSection("Color — Surfaces & Ink") {
                SwatchRow(
                    listOf(
                        "Paper" to colors.paper,
                        "Card" to colors.card,
                        "Recessed" to colors.recessed,
                        "Charcoal" to colors.charcoal,
                    ),
                )
                SwatchRow(
                    listOf(
                        "Ink" to colors.ink,
                        "Secondary" to colors.secondary,
                        "Border" to colors.borderSubtle,
                        "Inset line" to colors.borderInset,
                    ),
                )
            }
        }
        item(key = "signals") {
            CatalogSection("Color — Signals") {
                SwatchRow(
                    listOf(
                        "Forest" to colors.forest,
                        "Ochre" to colors.ochre,
                        "Vermilion" to colors.vermilion,
                        "LED" to colors.led,
                    ),
                )
                SwatchRow(
                    listOf(
                        "Cobalt" to colors.cobalt,
                        "Plum" to colors.plum,
                    ),
                )
            }
        }
        item(key = "type") {
            CatalogSection("Typography") {
                HwText("Fraunces — Dispatch Board", Op01Theme.type.headlineLg, colors.ink)
                HwText("Fraunces — Card titles ride 16sp", Op01Theme.type.titleCard, colors.ink)
                HwText(
                    "Plus Jakarta Sans carries body copy at a comfortable measure.",
                    Op01Theme.type.bodyMd, colors.ink,
                )
                HwText(
                    "Body small — secondary lines, summaries, hints.",
                    Op01Theme.type.bodySm, colors.secondary,
                )
                HwText("IBM PLEX MONO — TELEMETRY 0123456789", Op01Theme.type.monoCode, colors.ink)
                HwText("LABEL CAPS — BUTTONS & BADGES", Op01Theme.type.labelCaps, colors.secondary)
            }
        }
        item(key = "buttons") {
            CatalogSection("Buttons — Press Physics") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HwButton("Primary", { onToast("Primary pressed.") }, HwButtonStyle.Primary, Modifier.weight(1f))
                    HwButton("Positive", { onToast("Positive pressed.") }, HwButtonStyle.Positive, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HwButton("Danger", { onToast("Danger pressed.") }, HwButtonStyle.Danger, Modifier.weight(1f))
                    HwButton("Secondary", { onToast("Secondary pressed.") }, HwButtonStyle.Secondary, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HwButton("Card surface", { onToast("Card-surface pressed.") }, HwButtonStyle.CardSurface, Modifier.weight(1f))
                    HwButton("Disabled", {}, HwButtonStyle.Primary, Modifier.weight(1f), enabled = false)
                }
                HwText(
                    "Press = translate 2dp down, shadow shrinks 2.5dp → 0.5dp. No ripple, ever.",
                    Op01Theme.type.bodySm, colors.secondary,
                )
            }
        }
        item(key = "badges") {
            CatalogSection("Badges & Chips") {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AgentChip("nyx")
                    AgentChip("nosmile99")
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    AgentChip("wren")
                    AgentChip("luki")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Op01Badge("Urgent", colors.vermilion, Color.White)
                    Op01Badge("Done", colors.forest, Color.White)
                    Op01Badge("Stale", colors.ochre, Color.White)
                    QuietBadge("Task #101")
                    QuietBadge("#kanban-do")
                }
            }
        }
        item(key = "inputs") {
            CatalogSection("Inputs — 16sp Text Minimum") {
                HwTextField(
                    value = catalogText,
                    onValueChange = { catalogText = it },
                    label = "Dispatch note",
                    placeholder = "Type like you mean it…",
                )
                HwTextField(
                    value = catalogMono,
                    onValueChange = { catalogMono = it },
                    label = "Cursor (mono)",
                    mono = true,
                )
                HwSelect(
                    label = "Channel",
                    value = catalogChannel,
                    options = listOf("#kanban-do", "#all-agents", "#dm-nyx"),
                    onSelect = { catalogChannel = it },
                )
            }
        }
        item(key = "surfaces") {
            CatalogSection("Cards & Recessed Wells") {
                HwCard(Modifier.fillMaxWidth(), contentPadding = 12.dp) {
                    HwText(
                        "Card — 1.5dp carbon border, hard shadow 0 3dp 0, radius 16dp.",
                        Op01Theme.type.bodyMd, colors.ink,
                    )
                }
                HwInset(Modifier.fillMaxWidth(), contentPadding = 12.dp) {
                    HwText(
                        "Recessed well — inset fill, quieter border, inset top shadow. Data lives here.",
                        Op01Theme.type.bodyMd, colors.secondary,
                    )
                }
            }
        }
        item(key = "meters") {
            CatalogSection("Meters & Indicators") {
                FieldLabel("Quota — 41% (forest)")
                QuotaMeter(41, Modifier.fillMaxWidth())
                FieldLabel("Quota — 88% (ochre at ≥85%)", Modifier.padding(top = 10.dp))
                QuotaMeter(88, Modifier.fillMaxWidth())
                Row(
                    modifier = Modifier.padding(top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    LedDot()
                    HwText("LED — pulsing while the socket is live", Op01Theme.type.bodySm, colors.secondary)
                }
            }
        }
        item(key = "stripes") {
            CatalogSection("Caution Stripes — −45°, 8dp Bands") {
                CautionStripe(colors.cautionRedA, colors.cautionRedB, Modifier.fillMaxWidth())
                HwText("Blocked / danger", Op01Theme.type.bodySm, colors.secondary)
                CautionStripe(colors.cautionAmberA, colors.cautionAmberB, Modifier.fillMaxWidth())
                HwText("Stale / caution", Op01Theme.type.bodySm, colors.secondary)
            }
        }
    }
}

@Composable
private fun CatalogSection(
    title: String,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val colors = Op01Theme.colors
    HwCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            HwText(title, Op01Theme.type.headlineSm, colors.ink)
            content()
        }
    }
}

@Composable
private fun SwatchRow(entries: List<Pair<String, Color>>) {
    val colors = Op01Theme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        entries.forEach { (name, color) ->
            Column(Modifier.weight(1f)) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .background(color, RoundedCornerShape(Op01Radius.md))
                        .border(1.5.dp, colors.borderHardware, RoundedCornerShape(Op01Radius.md)),
                )
                HwText(name, Op01Theme.type.labelMd, colors.secondary, Modifier.padding(top = 4.dp), maxLines = 1)
            }
        }
        // Pad short rows so swatches keep a consistent width.
        repeat(4 - entries.size) { Box(Modifier.weight(1f)) }
    }
}
