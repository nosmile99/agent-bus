package com.astryx.kitchensink.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import com.astryx.kitchensink.theme.Op01Colors
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Space
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.HwSegmentedRow
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.Op01Motion
import com.astryx.kitchensink.ui.components.animateOp01Color
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
                resync = state.resync,
                liveCount = state.liveSocketCount(),
                darkTheme = darkTheme,
                onToggleTheme = onToggleTheme,
            )
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(colors.paper),
            ) {
                AnimatedContent(
                    targetState = tab,
                    transitionSpec = {
                        val direction =
                            if (targetState.ordinal > initialState.ordinal) 1 else -1
                        (fadeIn(Op01Motion.color()) +
                            slideInHorizontally(Op01Motion.medium()) { width -> direction * width / 6 })
                            .togetherWith(
                                fadeOut(Op01Motion.fast()) +
                                    slideOutHorizontally(Op01Motion.fast()) { width -> -direction * width / 6 },
                            )
                    },
                    label = "tab-content",
                    modifier = Modifier.fillMaxSize(),
                ) { currentTab ->
                    when (currentTab) {
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
            }
            BottomNav(
                current = tab,
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

        AnimatedVisibility(
            visible = toast != null,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = fadeIn(Op01Motion.fast()) +
                slideInVertically(Op01Motion.snap()) { it / 2 },
            exit = fadeOut(Op01Motion.fast()) +
                slideOutVertically(Op01Motion.snap()) { it / 2 },
        ) {
            Box(
                modifier = Modifier
                    .navigationBarsPadding()
                    .padding(start = 16.dp, end = 16.dp, bottom = 92.dp)
                    .hardShadow(Op01Radius.lg, 3.dp, colors.shadow)
                    .background(colors.charcoal, RoundedCornerShape(Op01Radius.lg))
                    .border(1.5.dp, colors.borderHardware, RoundedCornerShape(Op01Radius.lg))
                    .padding(horizontal = 14.dp, vertical = 12.dp),
            ) {
                HwText(toast ?: "", Op01Theme.type.bodyMd, colors.charcoalText)
            }
        }
    }
}

@Composable
private fun AppHeader(
    resync: Boolean,
    liveCount: Int,
    darkTheme: Boolean,
    onToggleTheme: () -> Unit,
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
        Column(Modifier.weight(1f)) {
            HwText("Agent Bus", Op01Theme.type.headlineSm, colors.charcoalText, maxLines = 1)
            HwText("BUS // OP-01", Op01Theme.type.labelCaps, colors.charcoalText.copy(alpha = 0.7f), maxLines = 1)
        }
        // Status pill: the single status cluster. A pending resync outranks
        // the transport state; otherwise it reports live-socket agents.
        val (pillDot, pillLabel) = when {
            resync -> colors.vermilion to "RESYNC"
            liveCount > 0 -> colors.led to "$liveCount/3 LIVE"
            else -> colors.ochre to "POLLING"
        }
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
                    .background(pillDot, CircleShape),
            )
            HwText(
                pillLabel,
                Op01Theme.type.labelMd, colors.charcoalText,
                maxLines = 1,
            )
        }
        HeaderKey(if (darkTheme) "☀" else "◐", onToggleTheme)
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
        HwSegmentedRow(
            options = Op01Tab.entries,
            selected = current,
            onSelect = onSelect,
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 10.dp, vertical = 8.dp),
            spacing = 6.dp,
            radius = Op01Radius.lg,
            minHeight = 52.dp,
            selectedShadow = 2.5.dp,
            contentPadding = PaddingValues(horizontal = 2.dp, vertical = 6.dp),
        ) { entry, fg ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(contentAlignment = Alignment.TopEnd) {
                    HwText(
                        entry.glyph, Op01Theme.type.bodyLg,
                        fg,
                        maxLines = 1,
                    )
                    // Only Needs carries a badge: it counts tasks blocked
                    // on the operator. (A Feed badge counted total
                    // messages — a number with no action attached.)
                    if (entry == Op01Tab.Needs && needsCount > 0) {
                        Box(
                            modifier = Modifier
                                .size(16.dp)
                                .background(colors.vermilion, CircleShape)
                                .border(1.dp, colors.vermilion, CircleShape),
                            contentAlignment = Alignment.Center,
                        ) {
                            HwText(
                                needsCount.toString(), Op01Theme.type.labelMd,
                                Color.White,
                                maxLines = 1,
                            )
                        }
                    }
                }
                HwText(
                    entry.label, Op01Theme.type.labelMd,
                    fg,
                    maxLines = 1,
                )
            }
        }
    }
}

/**
 * Interpolates every OP-01 color token toward [target] so the light/dark
 * toggle glides instead of hard-cutting. The host provides the result through
 * [com.astryx.kitchensink.theme.LocalOp01Colors] inside the theme.
 */
@Composable
fun AnimatedOp01Colors(target: Op01Colors): Op01Colors {
    @Composable
    fun token(read: Op01Colors.() -> Color, label: String) =
        animateOp01Color(target.read(), label, Op01Motion.theme())
    val paper by token({ paper }, "theme-paper")
    val outer by token({ outer }, "theme-outer")
    val card by token({ card }, "theme-card")
    val recessed by token({ recessed }, "theme-recessed")
    val charcoal by token({ charcoal }, "theme-charcoal")
    val charcoalText by token({ charcoalText }, "theme-charcoalText")
    val ink by token({ ink }, "theme-ink")
    val secondary by token({ secondary }, "theme-secondary")
    val borderSubtle by token({ borderSubtle }, "theme-borderSubtle")
    val borderInset by token({ borderInset }, "theme-borderInset")
    val borderHardware by token({ borderHardware }, "theme-borderHardware")
    val shadow by token({ shadow }, "theme-shadow")
    val forest by token({ forest }, "theme-forest")
    val ochre by token({ ochre }, "theme-ochre")
    val vermilion by token({ vermilion }, "theme-vermilion")
    val cobalt by token({ cobalt }, "theme-cobalt")
    val plum by token({ plum }, "theme-plum")
    val led by token({ led }, "theme-led")
    val cautionRedA by token({ cautionRedA }, "theme-cautionRedA")
    val cautionRedB by token({ cautionRedB }, "theme-cautionRedB")
    val cautionAmberA by token({ cautionAmberA }, "theme-cautionAmberA")
    val cautionAmberB by token({ cautionAmberB }, "theme-cautionAmberB")
    return Op01Colors(
        paper = paper,
        outer = outer,
        card = card,
        recessed = recessed,
        charcoal = charcoal,
        charcoalText = charcoalText,
        ink = ink,
        secondary = secondary,
        borderSubtle = borderSubtle,
        borderInset = borderInset,
        borderHardware = borderHardware,
        shadow = shadow,
        forest = forest,
        ochre = ochre,
        vermilion = vermilion,
        cobalt = cobalt,
        plum = plum,
        led = led,
        cautionRedA = cautionRedA,
        cautionRedB = cautionRedB,
        cautionAmberA = cautionAmberA,
        cautionAmberB = cautionAmberB,
        isDark = target.isDark,
    )
}
