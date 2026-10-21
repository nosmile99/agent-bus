package com.astryx.kitchensink.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.AgentBadges
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Space
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.state.Agents
import com.astryx.kitchensink.ui.state.BusMessage
import com.astryx.kitchensink.ui.state.BusTask
import com.astryx.kitchensink.ui.state.Quote
import com.astryx.kitchensink.ui.state.TaskStatus
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/** Agent identity chip: identity-tinted fill, agent-color border, status dot, mono handle. */
@Composable
fun AgentChip(agentKey: String, modifier: Modifier = Modifier) {
    val badge = AgentBadges.forKey(agentKey)
    val meta = Agents.byKey(agentKey)
    val shape = RoundedCornerShape(Op01Radius.md)
    Row(
        modifier = modifier
            .background(badge.bg, shape)
            .border(1.5.dp, badge.border, shape)
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.size(8.dp).background(badge.dot, CircleShape))
        HwText(meta.handle, Op01Theme.type.labelLg, badge.text, maxLines = 1)
    }
}

/** Quiet metadata badge (task numbers, counters, channels on stone). */
@Composable
fun QuietBadge(text: String, modifier: Modifier = Modifier) {
    Op01Badge(
        text = text,
        bg = Op01Theme.colors.recessed,
        textColor = Op01Theme.colors.secondary,
        modifier = modifier,
        borderColor = Op01Theme.colors.borderInset,
    )
}

/** Card whose children render flush to the edges (caution stripes, side bars). */
@Composable
fun FlushCard(
    modifier: Modifier = Modifier,
    radius: Dp = Op01Radius.xl,
    content: @Composable () -> Unit,
) {
    val colors = Op01Theme.colors
    val shape = RoundedCornerShape(radius)
    Box(
        modifier = modifier
            .hardShadow(radius, 3.dp, colors.shadow)
            .background(colors.card, shape)
            .border(1.5.dp, colors.borderHardware, shape)
            .clip(shape),
    ) { content() }
}

private fun dampDrag(raw: Float, elbow: Float): Float {
    val a = abs(raw)
    val visual = if (a <= elbow) a * 0.82f else elbow * 0.82f + (a - elbow) * 0.32f
    return if (raw < 0) -visual else visual
}

/**
 * Swipe shell with the spec's rubber-band physics: 0.82 damping up to the
 * 70dp elbow, 0.32 beyond; the recessed track underneath turns forest once
 * past the threshold, and release snaps back (cubic-bezier(0.22,1,0.36,1))
 * BEFORE the action fires. Right swipes only — this is the reply gesture.
 */
@Composable
fun SwipeToReply(
    onReply: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val colors = Op01Theme.colors
    val scope = rememberCoroutineScope()
    val offsetAnim = remember { Animatable(0f) }
    var rawDrag by remember { mutableFloatStateOf(0f) }
    var armed by remember { mutableStateOf(false) }
    val elbowPx = with(LocalDensity.current) { Op01Space.swipeThreshold.toPx() }
    val shape = RoundedCornerShape(Op01Radius.xl)
    val snapSpec = tween<Float>(280, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f))

    Box(modifier = modifier.clip(shape)) {
        Box(
            modifier = Modifier
                .matchParentSize()
                .background(if (armed) colors.forest else colors.charcoal, shape),
            contentAlignment = Alignment.CenterStart,
        ) {
            HwText("↩ REPLY", Op01Theme.type.labelLg, colors.charcoalText, Modifier.padding(start = 18.dp))
        }
        Box(
            modifier = Modifier
                .offset { IntOffset(offsetAnim.value.roundToInt(), 0) }
                .pointerInput(Unit) {
                    detectHorizontalDragGestures(
                        onDragStart = {
                            rawDrag = 0f
                            armed = false
                        },
                        onHorizontalDrag = { change, dragAmount ->
                            rawDrag += dragAmount
                            armed = rawDrag > elbowPx
                            scope.launch { offsetAnim.snapTo(dampDrag(rawDrag, elbowPx)) }
                            change.consume()
                        },
                        onDragEnd = {
                            val fire = rawDrag > elbowPx
                            scope.launch {
                                offsetAnim.animateTo(0f, snapSpec)
                                armed = false
                                if (fire) onReply()
                            }
                        },
                        onDragCancel = {
                            scope.launch {
                                offsetAnim.animateTo(0f, snapSpec)
                                armed = false
                            }
                        },
                    )
                },
        ) { content() }
    }
}

/** Reply quote strip: recessed well with a 4dp forest left bar. */
@Composable
fun QuoteStrip(quote: Quote, modifier: Modifier = Modifier) {
    val colors = Op01Theme.colors
    HwInset(modifier = modifier, contentPadding = 0.dp) {
        Row(modifier = Modifier.height(IntrinsicSize.Min)) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .width(4.dp)
                    .background(colors.forest),
            )
            Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                HwText("Replying to ${quote.agentHandle}", Op01Theme.type.labelLg, colors.ink, maxLines = 1)
                HwText(
                    quote.text, Op01Theme.type.bodySm, colors.secondary,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
fun MessageCard(
    message: BusMessage,
    onReply: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    SwipeToReply(onReply = onReply, modifier = modifier) {
        FlushCard {
            Row(modifier = Modifier.height(IntrinsicSize.Min)) {
                if (message.urgent) {
                    Box(
                        Modifier
                            .fillMaxHeight()
                            .width(4.dp)
                            .background(colors.vermilion),
                    )
                }
                Column(Modifier.padding(14.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        AgentChip(message.agent)
                        QuietBadge(message.channel)
                        if (message.urgent) {
                            Op01Badge("Urgent", colors.vermilion, Color.White)
                        }
                        Box(Modifier.weight(1f))
                        HwText(message.time, Op01Theme.type.labelMd, colors.secondary, maxLines = 1)
                    }
                    if (message.quote != null) {
                        QuoteStrip(message.quote, Modifier.padding(top = 10.dp).fillMaxWidth())
                    }
                    HwText(
                        message.text, Op01Theme.type.bodyMd, colors.ink,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                    Row(Modifier.padding(top = 12.dp).fillMaxWidth()) {
                        HwButton(
                            text = "↩ Reply",
                            onClick = onReply,
                            style = HwButtonStyle.CardSurface,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

/** 4-segment status strip. Tapping the current status is a strict no-op (state layer enforces it too). */
@Composable
fun StatusStrip(
    current: TaskStatus,
    onSelect: (TaskStatus) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        TaskStatus.entries.forEach { status ->
            val isCurrent = status == current
            val (bg, fg) = when {
                !isCurrent -> colors.recessed to colors.secondary
                status == TaskStatus.Doing -> colors.ochre to Color.White
                status == TaskStatus.Blocked -> colors.vermilion to Color.White
                status == TaskStatus.Done -> colors.forest to Color.White
                else -> colors.ink to colors.paper
            }
            // Selection travels: fill, label, and border cross-fade while the
            // hard shadow grows in — mechanical, no bounce.
            val animBg by animateOp01Color(bg, "seg-bg")
            val animFg by animateOp01Color(fg, "seg-fg")
            val animBorder by animateOp01Color(if (isCurrent) colors.borderHardware else colors.borderInset, "seg-border")
            val animShadow by animateDpAsState(
                if (isCurrent) 2.dp else 0.dp, Op01Motion.fast(), label = "seg-shadow",
            )
            val shape = RoundedCornerShape(Op01Radius.md)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .hardShadow(Op01Radius.md, animShadow, colors.shadow)
                    .background(animBg, shape)
                    .border(1.5.dp, animBorder, shape)
                    .clickable { onSelect(status) }
                    .heightIn(min = 44.dp)
                    .padding(vertical = 8.dp, horizontal = 2.dp),
                contentAlignment = Alignment.Center,
            ) {
                HwText(status.stripLabel, Op01Theme.type.labelMd, animFg, maxLines = 1)
            }
        }
    }
}

/** Caution header for blocked (red) and stale-doing (amber) cards. */
@Composable
fun CautionHeader(task: BusTask, modifier: Modifier = Modifier) {
    val colors = Op01Theme.colors
    when {
        task.status == TaskStatus.Blocked -> Column(modifier) {
            CautionStripe(colors.cautionRedA, colors.cautionRedB)
            HwText(
                "⛔ Blocked — ${task.blockedReason.ifEmpty { "Waiting" }}",
                Op01Theme.type.labelLg, colors.vermilion,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
        task.status == TaskStatus.Doing && task.stale -> Column(modifier) {
            CautionStripe(colors.cautionAmberA, colors.cautionAmberB)
            HwText(
                "◷ Stale (Quiet >24h)",
                Op01Theme.type.labelLg, colors.ochre,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
    }
}

/** Kanban task card: caution header, content, actions, status strip. */
@Composable
fun TaskCard(
    task: BusTask,
    onOpen: () -> Unit,
    onDone: () -> Unit,
    onStatus: (TaskStatus) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    FlushCard(modifier = modifier) {
        Column {
            CautionHeader(task, Modifier.fillMaxWidth())
            Column(Modifier.padding(12.dp)) {
                HwText(task.title, Op01Theme.type.titleCard, colors.ink)
                HwText(
                    task.summary, Op01Theme.type.bodySm, colors.secondary,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Row(
                    modifier = Modifier.padding(top = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    QuietBadge("Task #${task.num}")
                    AgentChip(task.assignee)
                    QuietBadge("${task.todosDone}/${task.todosTotal} todos")
                    if (task.priority == "Urgent") {
                        Op01Badge("Urgent", colors.vermilion, Color.White)
                    }
                }
                Row(
                    modifier = Modifier.padding(top = 12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    HwButton(
                        "Mark done",
                        onClick = onDone,
                        style = HwButtonStyle.Positive,
                        modifier = Modifier.weight(1f),
                    )
                    HwButton(
                        "Open",
                        onClick = onOpen,
                        style = HwButtonStyle.Secondary,
                        modifier = Modifier.weight(1f),
                    )
                }
                StatusStrip(
                    current = task.status,
                    onSelect = onStatus,
                    modifier = Modifier.padding(top = 10.dp).fillMaxWidth(),
                )
            }
        }
    }
}
