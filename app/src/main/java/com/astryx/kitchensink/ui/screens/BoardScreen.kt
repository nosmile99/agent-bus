package com.astryx.kitchensink.ui.screens

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Space
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.EnterItem
import com.astryx.kitchensink.ui.components.HwInset
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.Op01Motion
import com.astryx.kitchensink.ui.components.animateOp01Color
import com.astryx.kitchensink.ui.components.TaskCard
import com.astryx.kitchensink.ui.components.hardShadow
import com.astryx.kitchensink.ui.state.Op01State
import com.astryx.kitchensink.ui.state.TaskStatus
import kotlinx.coroutines.launch

/**
 * Kanban board: the four status columns as a snapping horizontal pager
 * (85% of width, capped at 330dp). Each lane is a recessed well with its own
 * vertical scroll.
 */
@Composable
fun BoardScreen(
    state: Op01State,
    onOpenTask: (String) -> Unit,
    onToast: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    val statuses = TaskStatus.entries
    val pagerState = rememberPagerState(pageCount = { statuses.size })
    val scope = rememberCoroutineScope()

    Column(modifier.fillMaxSize()) {
        BoxWithConstraints(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(top = 12.dp),
        ) {
            val pageWidth = minOf(maxWidth * 0.85f, Op01Space.columnMaxWidth)
            HorizontalPager(
                state = pagerState,
                pageSize = PageSize.Fixed(pageWidth),
                pageSpacing = 10.dp,
                contentPadding = PaddingValues(horizontal = 12.dp),
                modifier = Modifier.fillMaxSize(),
            ) { page ->
                val status = statuses[page]
                val columnTasks = state.tasks.filter { it.status == status }
                // Off-centre pages recede slightly — depth without bounce.
                val pageOffset = kotlin.math.abs(
                    (pagerState.currentPage - page) + pagerState.currentPageOffsetFraction,
                ).coerceIn(0f, 1f)
                HwInset(
                    modifier = Modifier
                        .width(pageWidth)
                        .fillMaxHeight()
                        .graphicsLayer {
                            alpha = 1f - 0.18f * pageOffset
                            val scale = 1f - 0.03f * pageOffset
                            scaleX = scale
                            scaleY = scale
                        },
                    radius = Op01Radius.xl,
                    contentPadding = 0.dp,
                ) {
                    Column(Modifier.fillMaxSize()) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                        ) {
                            HwText(status.label, Op01Theme.type.headlineSm, colors.ink)
                            HwText(
                                "${columnTasks.size} tasks", Op01Theme.type.labelMd, colors.secondary,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                        LazyColumn(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxWidth(),
                            contentPadding = PaddingValues(start = 10.dp, end = 10.dp, bottom = 10.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            items(columnTasks, key = { it.id }) { task ->
                                EnterItem(Modifier.fillMaxWidth()) {
                                    TaskCard(
                                        task = task,
                                        onOpen = { onOpenTask(task.id) },
                                        onDone = {
                                            state.setStatus(task, TaskStatus.Done)
                                            onToast("Marked done — Task #${task.num}.")
                                        },
                                        onStatus = { next ->
                                            state.setStatus(task, next)
                                            if (next != task.status) {
                                                onToast("Task #${task.num} → ${next.label}.")
                                            }
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        // Lane indicators: tapping a segment jumps the pager to that column.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            statuses.forEachIndexed { index, status ->
                val active = pagerState.currentPage == index
                val animBg by animateOp01Color(if (active) colors.ink else colors.recessed, "lane-bg")
                val animFg by animateOp01Color(if (active) colors.paper else colors.secondary, "lane-fg")
                val animBorder by animateOp01Color(if (active) colors.borderHardware else colors.borderInset, "lane-border")
                val animShadow by animateDpAsState(
                    if (active) 2.dp else 0.dp, Op01Motion.fast(), label = "lane-shadow",
                )
                val shape = RoundedCornerShape(Op01Radius.md)
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .hardShadow(Op01Radius.md, animShadow, colors.shadow)
                        .background(animBg, shape)
                        .border(1.5.dp, animBorder, shape)
                        .clickable { scope.launch { pagerState.animateScrollToPage(index) } }
                        .heightIn(min = 44.dp)
                        .padding(vertical = 8.dp, horizontal = 2.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    HwText(
                        status.stripLabel, Op01Theme.type.labelMd,
                        animFg,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}
