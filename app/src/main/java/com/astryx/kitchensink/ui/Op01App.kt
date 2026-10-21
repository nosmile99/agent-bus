package com.astryx.kitchensink.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Space
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.LedDot
import com.astryx.kitchensink.ui.components.hardShadow
import com.astryx.kitchensink.ui.screens.AgentsScreen
import com.astryx.kitchensink.ui.screens.BoardScreen
import com.astryx.kitchensink.ui.screens.FeedScreen
import com.astryx.kitchensink.ui.screens.NeedsScreen
import com.astryx.kitchensink.ui.screens.SystemScreen
import com.astryx.kitchensink.ui.sheets.TaskSheet
import com.astryx.kitchensink.ui.state.Op01State
import com.astryx.kitchensink.ui.state.rememberOp01State
import kotlinx.coroutines.delay

enum class Op01Tab(val label: String, val glyph: String) {
    Feed("Feed", "≋"),
    Needs("Needs", "!"),
    Board("Board", "▦"),
    Agents("Agents", "◉"),
    System("System", "⚙"),
}

/**
 * OP-01 app shell: charcoal hardware header, the active view, and a custom
 * 5-key tactile bottom nav (active key = ink fill + hard shadow). Owns the
 * shared state, the open task sheet, and the charcoal toast.
 */
@Composable
fun Op01App(
    darkTheme: Boolean,
    onToggleTheme: () -> Unit,
) {
    val colors = Op01Theme.colors
    val state: Op01State = rememberOp01State()
    var tab by remember { mutableStateOf(Op01Tab.Feed) }
    var openTaskId by remember { mutableStateOf<String?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(toast) {
        if (toast != null) {
            delay(2800)
            toast = null
        }
    }

    val openTask = openTaskId?.let { id -> state.tasks.firstOrNull { it.id == id } }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.outer),
    ) {
        Column(Modifier.fillMaxSize()) {
            AppHeader(
                transportLive = state.transportLive,
                darkTheme = darkTheme,
                onToggleTheme = onToggleTheme,
                onSettings = { toast = "Settings live on the panel — this console is dispatch-only." },
            )
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(colors.paper),
            ) {
                when (tab) {
                    Op01Tab.Feed -> FeedScreen(
                        state = state,
                        onToast = { toast = it },
                        modifier = Modifier.fillMaxSize(),
                    )
                    Op01Tab.Needs -> NeedsScreen(
                        state = state,
                        onOpenTask = { openTaskId = it },
                        onToast = { toast = it },
                        modifier = Modifier.fillMaxSize(),
                    )
                    Op01Tab.Board -> BoardScreen(
                        state = state,
                        onOpenTask = { openTaskId = it },
                        onToast = { toast = it },
                        modifier = Modifier.fillMaxSize(),
                    )
                    Op01Tab.Agents -> AgentsScreen(
                        state = state,
                        modifier = Modifier.fillMaxSize(),
                    )
                    Op01Tab.System -> SystemScreen(
                        onToast = { toast = it },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            BottomNav(
                current = tab,
                feedCount = state.messages.size,
                needsCount = state.needsTasks().size,
                onSelect = { tab = it },
            )
        }

        if (openTask != null) {
            TaskSheet(
                task = openTask,
                state = state,
                onClose = { openTaskId = null },
                onToast = { toast = it },
            )
        }

        if (toast != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(start = 16.dp, end = 16.dp, bottom = 92.dp)
                    .hardShadow(Op01Radius.lg, 3.dp, colors.shadow)
                    .background(colors.charcoal, RoundedCornerShape(Op01Radius.lg))
                    .border(1.5.dp, colors.borderHardware, RoundedCornerShape(Op01Radius.lg))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                HwText(toast!!, Op01Theme.type.bodyMd, colors.charcoalText)
            }
        }
    }
}

@Composable
private fun AppHeader(
    transportLive: Boolean,
    darkTheme: Boolean,
    onToggleTheme: () -> Unit,
    onSettings: () -> Unit,
) {
    val colors = Op01Theme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.charcoal)
            .statusBarsPadding()
            .heightIn(min = Op01Space.headerHeight)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LedDot()
        Column(Modifier.weight(1f)) {
            HwText("Agent Bus", Op01Theme.type.headlineSm, colors.charcoalText, maxLines = 1)
            HwText("BUS // OP-01", Op01Theme.type.labelCaps, colors.charcoalText.copy(alpha = 0.7f), maxLines = 1)
        }
        // Live pill: recessed charcoal inset with LED + mono label.
        Row(
            modifier = Modifier
                .background(colors.paper.copy(alpha = 0.08f), RoundedCornerShape(Op01Radius.full))
                .border(1.5.dp, colors.charcoalText.copy(alpha = 0.35f), RoundedCornerShape(Op01Radius.full))
                .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                Modifier
                    .size(7.dp)
                    .background(if (transportLive) colors.led else colors.ochre, CircleShape),
            )
            HwText(
                if (transportLive) "2/3 LIVE" else "POLLING",
                Op01Theme.type.labelMd, colors.charcoalText,
                maxLines = 1,
            )
        }
        HeaderKey(if (darkTheme) "☀" else "◐", onToggleTheme)
        HeaderKey("⚙", onSettings)
    }
}

@Composable
private fun HeaderKey(glyph: String, onClick: () -> Unit) {
    val colors = Op01Theme.colors
    Box(
        modifier = Modifier
            .size(40.dp)
            .background(colors.paper.copy(alpha = 0.10f), RoundedCornerShape(Op01Radius.lg))
            .border(1.5.dp, colors.charcoalText.copy(alpha = 0.35f), RoundedCornerShape(Op01Radius.lg))
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        HwText(glyph, Op01Theme.type.bodyLg, colors.charcoalText)
    }
}

@Composable
private fun BottomNav(
    current: Op01Tab,
    feedCount: Int,
    needsCount: Int,
    onSelect: (Op01Tab) -> Unit,
) {
    val colors = Op01Theme.colors
    Column(Modifier.fillMaxWidth().background(colors.paper)) {
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 1.5.dp, max = 1.5.dp)
                .background(colors.borderSubtle),
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
        Op01Tab.entries.forEach { entry ->
            val active = entry == current
            val shape = RoundedCornerShape(Op01Radius.lg)
            Box(
                modifier = Modifier
                    .weight(1f)
                    .then(if (active) Modifier.hardShadow(Op01Radius.lg, 2.5.dp, colors.shadow) else Modifier)
                    .background(if (active) colors.ink else colors.recessed, shape)
                    .border(1.5.dp, if (active) colors.borderHardware else colors.borderInset, shape)
                    .clickable { onSelect(entry) }
                    .heightIn(min = 52.dp)
                    .padding(vertical = 6.dp, horizontal = 2.dp),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(contentAlignment = Alignment.TopEnd) {
                        HwText(
                            entry.glyph, Op01Theme.type.bodyLg,
                            if (active) colors.paper else colors.secondary,
                            maxLines = 1,
                        )
                        val count = when (entry) {
                            Op01Tab.Feed -> feedCount
                            Op01Tab.Needs -> needsCount
                            else -> 0
                        }
                        if (count > 0) {
                            val alert = entry == Op01Tab.Needs
                            Box(
                                modifier = Modifier
                                    .size(16.dp)
                                    .background(
                                        if (alert) colors.vermilion else colors.card,
                                        CircleShape,
                                    )
                                    .border(
                                        1.dp,
                                        if (alert) colors.vermilion else colors.borderInset,
                                        CircleShape,
                                    ),
                                contentAlignment = Alignment.Center,
                            ) {
                                HwText(
                                    count.toString(), Op01Theme.type.labelMd,
                                    if (alert) Color.White else colors.secondary,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                    HwText(
                        entry.label, Op01Theme.type.labelMd,
                        if (active) colors.paper else colors.secondary,
                        maxLines = 1,
                    )
                }
            }
        }
        }
    }
}
