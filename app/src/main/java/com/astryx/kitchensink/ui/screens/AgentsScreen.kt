package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.AgentChip
import com.astryx.kitchensink.ui.components.EnterItem
import com.astryx.kitchensink.ui.components.FieldLabel
import com.astryx.kitchensink.ui.components.HwCard
import com.astryx.kitchensink.ui.components.HwInset
import com.astryx.kitchensink.ui.components.HwSegmentedRow
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.Op01Badge
import com.astryx.kitchensink.ui.components.QuotaMeter
import com.astryx.kitchensink.ui.state.AgentMeta
import com.astryx.kitchensink.ui.state.Agents
import com.astryx.kitchensink.ui.state.Op01State

private data class AgentCardData(
    val meta: AgentMeta,
    val blurb: String,
    val quotaPercent: Int?,
)

private val agentCards = listOf(
    AgentCardData(Agents.Nyx, "Panel and backend owner.", 62),
    AgentCardData(Agents.Nosmile99, "Audits, scouts, and files the fixes.", 88),
    AgentCardData(Agents.Wren, "Inputless scout on the SG VM.", 41),
    AgentCardData(Agents.Luki, "The operator. Approves, unblocks, decides.", null),
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
                    HwSegmentedRow(
                        options = listOf("Live Socket", "Polling"),
                        selected = if (state.transportLive) "Live Socket" else "Polling",
                        onSelect = { state.transportLive = it == "Live Socket" },
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        spacing = 6.dp,
                        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 10.dp),
                    ) { label, fg ->
                        HwText(label, Op01Theme.type.labelLg, fg, maxLines = 1)
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
                            state.agentMode(card.meta.key), colors.recessed, colors.secondary,
                            borderColor = colors.borderInset,
                        )
                    }
                    HwText(
                        card.meta.role, Op01Theme.type.titleCard, colors.ink,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    HwText(card.blurb, Op01Theme.type.bodySm, colors.secondary)
                    if (card.quotaPercent != null) {
                        FieldLabel("API quota", Modifier.padding(top = 12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            QuotaMeter(card.quotaPercent, Modifier.weight(1f))
                            HwText(
                                "${card.quotaPercent}%",
                                Op01Theme.type.monoCode, colors.ink,
                                modifier = Modifier.padding(start = 10.dp),
                                maxLines = 1,
                            )
                        }
                    } else {
                        FieldLabel("API quota", Modifier.padding(top = 12.dp))
                        HwText(
                            "n/a", Op01Theme.type.labelMd, colors.secondary,
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
                        "Keyset pagination on the (ts, id) cursor — no offsets, no skipped rows.",
                        Op01Theme.type.bodySm, colors.secondary,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
            }
        }
    }
}
