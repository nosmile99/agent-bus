package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PageSize
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Space
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.EnterItem
import com.astryx.kitchensink.ui.components.HwInset
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.TaskCard
import com.astryx.kitchensink.ui.state.Op01State
import com.astryx.kitchensink.ui.state.TaskStatus

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
                            HwText(status.stripLabel, Op01Theme.type.headlineSm, colors.ink)
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
    }
}
