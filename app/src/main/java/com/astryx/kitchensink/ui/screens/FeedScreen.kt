package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.CautionStripe
import com.astryx.kitchensink.ui.components.FlushCard
import com.astryx.kitchensink.ui.components.HwButton
import com.astryx.kitchensink.ui.components.HwButtonStyle
import com.astryx.kitchensink.ui.components.HwSelect
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.HwTextField
import com.astryx.kitchensink.ui.components.MessageCard
import com.astryx.kitchensink.ui.components.Op01Badge
import com.astryx.kitchensink.ui.components.QuietBadge
import com.astryx.kitchensink.ui.state.Agents
import com.astryx.kitchensink.ui.state.BusMessage
import com.astryx.kitchensink.ui.state.Op01State
import com.astryx.kitchensink.ui.state.Quote

@Composable
fun ViewHead(title: String, subtitle: String, modifier: Modifier = Modifier) {
    val colors = Op01Theme.colors
    Column(modifier.padding(horizontal = 2.dp)) {
        HwText(title, Op01Theme.type.headlineLg, colors.ink)
        HwText(subtitle, Op01Theme.type.bodySm, colors.secondary, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
fun FeedScreen(
    state: Op01State,
    onToast: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    var replyTo by remember { mutableStateOf<BusMessage?>(null) }
    var expanded by remember { mutableStateOf(false) }

    fun startReply(message: BusMessage) {
        replyTo = message
        expanded = true
    }

    Column(modifier) {
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (state.resync) {
                item(key = "resync") {
                    FlushCard(Modifier.fillMaxWidth()) {
                        Column {
                            CautionStripe(colors.cautionRedA, colors.cautionRedB)
                            Column(Modifier.padding(12.dp)) {
                                HwText(
                                    "resync_required — the console cursor fell behind on #all-agents. New messages are held until the stream resyncs.",
                                    Op01Theme.type.bodyMd, colors.ink,
                                )
                                HwButton(
                                    text = "Resync now",
                                    onClick = {
                                        state.resync = false
                                        onToast("Resynced — the stream is current.")
                                    },
                                    style = HwButtonStyle.Danger,
                                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                                )
                            }
                        }
                    }
                }
            }
            item(key = "head") {
                ViewHead("Bus Feed", "Every agent message, one stream. Swipe a message right to reply.")
            }
            items(state.messages, key = { it.id }) { message ->
                MessageCard(
                    message = message,
                    onReply = { startReply(message) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        ComposerDock(
            expanded = expanded,
            replyTo = replyTo,
            onExpand = { expanded = true },
            onCollapse = {
                expanded = false
                replyTo = null
            },
            onCancelReply = { replyTo = null },
            onEmptySend = { onToast("Write something first — empty dispatches stay home.") },
            onSend = { channel, priority, text ->
                state.messages.add(
                    0,
                    BusMessage(
                        id = "m${System.currentTimeMillis()}",
                        agent = "luki",
                        channel = channel,
                        time = "now",
                        urgent = priority == "Urgent",
                        text = text,
                        quote = replyTo?.let {
                            Quote(it.id, Agents.byKey(it.agent).handle, it.text)
                        },
                    ),
                )
                expanded = false
                replyTo = null
                onToast("Sent to $channel")
            },
        )
    }
}

/**
 * Composer dock: a slim bar at rest (channel + priority + draft preview),
 * expanding in place into the full dispatch form — reply banner, 3 selectors,
 * 16sp message field, Cancel / Send. Mirrors the web prototype.
 */
@Composable
private fun ComposerDock(
    expanded: Boolean,
    replyTo: BusMessage?,
    onExpand: () -> Unit,
    onCollapse: () -> Unit,
    onCancelReply: () -> Unit,
    onEmptySend: () -> Unit,
    onSend: (channel: String, priority: String, text: String) -> Unit,
) {
    val colors = Op01Theme.colors
    var channel by remember { mutableStateOf("#kanban-do") }
    var priority by remember { mutableStateOf("Normal") }
    var audience by remember { mutableStateOf("Agents") }
    var draft by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.paper),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(1.5.dp)
                .background(colors.borderSubtle),
        )
        Box(modifier = Modifier.padding(12.dp)) {
        if (!expanded) {
            FlushCard(Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .clickable { onExpand() }
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    QuietBadge(channel)
                    if (priority == "Urgent") {
                        Op01Badge("Urgent", colors.vermilion, Color.White)
                    } else {
                        QuietBadge("Normal")
                    }
                    HwText(
                        text = draft.ifEmpty { "Send a message…" },
                        style = Op01Theme.type.bodyMd,
                        color = colors.secondary,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    HwText("➤", Op01Theme.type.bodyLg, colors.ink)
                }
            }
        } else {
            FlushCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    if (replyTo != null) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 10.dp)
                                .background(colors.recessed, RoundedCornerShape(Op01Radius.lg))
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            HwText(
                                "Replying to ${Agents.byKey(replyTo.agent).handle} — ${replyTo.text}",
                                Op01Theme.type.bodySm, colors.secondary,
                                modifier = Modifier.weight(1f),
                                maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                            HwText(
                                "✕", Op01Theme.type.bodyLg, colors.ink,
                                modifier = Modifier.clickable { onCancelReply() },
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        HwSelect(
                            label = "Channel",
                            value = channel,
                            options = listOf("#kanban-do", "#all-agents", "#dm-nyx"),
                            onSelect = { channel = it },
                            modifier = Modifier.weight(1f),
                        )
                        HwSelect(
                            label = "Priority",
                            value = priority,
                            options = listOf("Normal", "Urgent"),
                            onSelect = { priority = it },
                            modifier = Modifier.weight(1f),
                        )
                        HwSelect(
                            label = "Audience",
                            value = audience,
                            options = listOf("Agents", "Just me"),
                            onSelect = { audience = it },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    HwTextField(
                        value = draft,
                        onValueChange = { draft = it },
                        placeholder = "Send a message…",
                        singleLine = false,
                        minLines = 3,
                        modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    )
                    Row(
                        modifier = Modifier.padding(top = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        HwButton(
                            "Cancel",
                            onClick = onCollapse,
                            style = HwButtonStyle.Secondary,
                            modifier = Modifier.weight(1f),
                        )
                        HwButton(
                            "Send a message",
                            onClick = {
                                val text = draft.trim()
                                if (text.isEmpty()) {
                                    onEmptySend()
                                } else {
                                    onSend(channel, priority, text)
                                    draft = ""
                                }
                            },
                            style = HwButtonStyle.Primary,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
        }
    }
}
