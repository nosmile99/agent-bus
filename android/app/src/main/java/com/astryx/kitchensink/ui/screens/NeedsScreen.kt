package com.astryx.kitchensink.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.AgentChip
import com.astryx.kitchensink.ui.components.CautionHeader
import com.astryx.kitchensink.ui.components.EnterItem
import com.astryx.kitchensink.ui.components.FlushCard
import com.astryx.kitchensink.ui.components.HwButton
import com.astryx.kitchensink.ui.components.HwButtonStyle
import com.astryx.kitchensink.ui.components.HwCard
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.Op01Badge
import com.astryx.kitchensink.ui.components.QuietBadge
import com.astryx.kitchensink.ui.state.Op01State
import com.astryx.kitchensink.ui.state.TaskStatus

/**
 * Needs You: the operator bottleneck queue — blocked tasks whose reason is
 * "Waiting on me". Unblock moves them back to Doing, in memory.
 */
@Composable
fun NeedsScreen(
    state: Op01State,
    onOpenTask: (String) -> Unit,
    onToast: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Op01Theme.colors
    val tasks = state.needsTasks()

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item(key = "head") {
            ViewHead("Needs You", "Tasks blocked on the operator — nobody else can move these.")
        }
        if (tasks.isEmpty()) {
            item(key = "zero") {
                HwCard(Modifier.fillMaxWidth(), contentPadding = 18.dp) {
                    Column {
                        HwText("Zero Human Bottlenecks", Op01Theme.type.headlineMd, colors.ink)
                        HwText(
                            "Nothing is waiting on you. The crew is unblocked.",
                            Op01Theme.type.bodyMd, colors.secondary,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                }
            }
        }
        items(tasks, key = { it.id }) { task ->
            EnterItem(Modifier.fillMaxWidth()) {
            FlushCard(Modifier.fillMaxWidth()) {
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
                            QuietBadge(task.project)
                            if (task.priority == "Urgent") {
                                Op01Badge("Urgent", colors.vermilion, Color.White)
                            }
                        }
                        Row(
                            modifier = Modifier.padding(top = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            HwButton(
                                "Unblock → Doing",
                                onClick = {
                                    state.setStatus(task, TaskStatus.Doing)
                                    onToast("Unblocked — Task #${task.num} is moving again.")
                                },
                                style = HwButtonStyle.Positive,
                                modifier = Modifier.weight(1f),
                            )
                            HwButton(
                                "Open",
                                onClick = { onOpenTask(task.id) },
                                style = HwButtonStyle.Secondary,
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
            }
        }
    }
}
