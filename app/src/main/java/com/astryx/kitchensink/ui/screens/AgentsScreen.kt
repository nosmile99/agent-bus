package com.astryx.kitchensink.ui.screens

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.AgentChip
import com.astryx.kitchensink.ui.components.EnterItem
import com.astryx.kitchensink.ui.components.FieldLabel
import com.astryx.kitchensink.ui.components.HwCard
import com.astryx.kitchensink.ui.components.HwInset
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.Op01Badge
import com.astryx.kitchensink.ui.components.Op01Motion
import com.astryx.kitchensink.ui.components.animateOp01Color
import com.astryx.kitchensink.ui.components.QuotaMeter
import com.astryx.kitchensink.ui.components.hardShadow
import com.astryx.kitchensink.ui.state.AgentMeta
import com.astryx.kitchensink.ui.state.Agents
import com.astryx.kitchensink.ui.state.Op01State

private data class AgentCardData(
    val meta: AgentMeta,
    val blurb: String,
    val mode: String,
    val quotaPercent: Int?,
    val quotaLabel: String,
)

private val agentCards = listOf(
    AgentCardData(
        Agents.Nyx, "Panel and backend owner. Indigo on the wire.", "Live socket",
        62, "API quota — 62%",
    ),
    AgentCardData(
        Agents.Nosmile99, "Audits, scouts, and files the fixes. Emerald on the wire.", "Live socket",
        88, "API quota — 88%",
    ),
    AgentCardData(
        Agents.Wren, "Inputless scout on the SG VM. Amber on the wire.", "Polling",
        41, "API quota — 41%",
    ),
    AgentCardData(
        Agents.Luki, "The operator. Approves, unblocks, decides. Stone on the wire.", "Manual dispatch",
        null, "API quota — n/a",
    ),
)

private val eventLines = listOf(
    "(1789464428, 168) bus.message — agent_bus.improvement",
    "(1789464462, 169) kanban.task.updated — #103 assignee → nyx",
    "(1789464491, 170) kanban.task.blocked — #105 (Waiting on me)",
    "(1789464520, 171) kanban.comment.added — #103",
    "(1789464555, 172) bus.message — #all-agents",
)

/**
 * Agents: transport switch (writes the shared state that drives the header
 * live pill), agent identity cards with quota meters, and the event-stream
 * inspector with (ts, id) cursors.
 */
@Composable
fun AgentsScreen(
    state: Op01State,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item(key = "head") {
            ViewHead("Agents", "Who is on the bus, how they connect, and how much runway they have left.")
        }
        item(key = "transport") {
            HwCard(Modifier.fillMaxWidth()) {
                Column {
                    FieldLabel("Transport Mode")
                    Row(
                        modifier = Modifier.padding(top = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        TransportOption(
                            label = "Live Socket",
                            selected = state.transportLive,
                            onClick = { state.transportLive = true },
                            modifier = Modifier.weight(1f),
                        )
                        TransportOption(
                            label = "Polling",
                            selected = !state.transportLive,
                            onClick = { state.transportLive = false },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    HwText(
                        if (state.transportLive) {
                            "Live socket — events arrive as they happen. Recommended for dispatch work."
                        } else {
                            "Polling — the console polls the (ts, id) cursor every few seconds."
                        },
                        Op01Theme.type.bodySm, colors.secondary,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
        }
        items(agentCards.size, key = { agentCards[it].meta.key }) { index ->
            val card = agentCards[index]
            EnterItem(Modifier.fillMaxWidth(), delayMillis = (index * 40).coerceAtMost(120)) {
            HwCard(Modifier.fillMaxWidth()) {
                Column {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        AgentChip(card.meta.key)
                        Op01Badge(
                            card.mode, colors.recessed, colors.secondary,
                            borderColor = colors.borderInset,
                        )
                    }
                    HwText(
                        card.meta.role, Op01Theme.type.titleCard, colors.ink,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    HwText(card.blurb, Op01Theme.type.bodySm, colors.secondary)
                    if (card.quotaPercent != null) {
                        FieldLabel(card.quotaLabel, Modifier.padding(top = 12.dp))
                        QuotaMeter(card.quotaPercent, Modifier.fillMaxWidth().padding(top = 6.dp))
                    } else {
                        HwText(
                            card.quotaLabel, Op01Theme.type.labelMd, colors.secondary,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                }
            }
            }
        }
        item(key = "events") {
            HwCard(Modifier.fillMaxWidth()) {
                Column {
                    FieldLabel("Event Stream Inspector")
                    HwInset(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        contentPadding = 10.dp,
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            eventLines.forEach { line ->
                                HwText(line, Op01Theme.type.monoCode, colors.ink)
                            }
                        }
                    }
                    HwText(
                        "Cursor: (1789464555, 172) — keyset pagination, no offsets, no skipped rows.",
                        Op01Theme.type.bodySm, colors.secondary,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun TransportOption(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    val animBg by animateOp01Color(if (selected) colors.ink else colors.recessed, "transport-bg")
    val animFg by animateOp01Color(if (selected) colors.paper else colors.secondary, "transport-fg")
    val animBorder by animateOp01Color(if (selected) colors.borderHardware else colors.borderInset, "transport-border")
    val animShadow by animateDpAsState(
        if (selected) 2.dp else 0.dp, Op01Motion.fast(), label = "transport-shadow",
    )
    val shape = RoundedCornerShape(Op01Radius.md)
    Box(
        modifier = modifier
            .hardShadow(Op01Radius.md, animShadow, colors.shadow)
            .background(animBg, shape)
            .border(1.5.dp, animBorder, shape)
            .clickable { onClick() }
            .heightIn(min = 44.dp)
            .padding(vertical = 10.dp, horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        HwText(
            label, Op01Theme.type.labelLg,
            animFg,
            maxLines = 1,
        )
    }
}
