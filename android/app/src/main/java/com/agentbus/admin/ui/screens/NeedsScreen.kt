package com.agentbus.admin.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentbus.admin.model.*
import com.agentbus.admin.state.AdminAppController
import com.agentbus.admin.ui.components.*
import com.agentbus.admin.ui.theme.SdTheme
import kotlinx.coroutines.launch

@Composable
fun NeedsScreen(controller: AdminAppController) {
    val colors = SdTheme.colors
    val scope = rememberCoroutineScope()
    var scopedProjectId by remember { mutableStateOf<Int?>(null) }
    var blockEditTarget by remember { mutableStateOf<TaskRecord?>(null) }

    val displayedTasks = remember(controller.needsTasks, scopedProjectId) {
        if (scopedProjectId == null) controller.needsTasks
        else controller.needsTasks.filter { it.projectId == scopedProjectId }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        SdCard(padding = 12.dp, accentTopColor = colors.signalVermilion) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    SdText(
                        text = "HUMAN TRIAGE QUEUE (status=blocked & blocked_kind=waiting-human)",
                        style = SdTheme.typo.monoTag,
                        color = colors.signalVermilion
                    )
                    SdText(
                        text = "Derived from GET /admin/api/kanban/tasks/search?global=1&status=blocked&blocked_kind=waiting-human&sort=blocked_since. Admin can unblock or update any task regardless of assignee.",
                        style = SdTheme.typo.bodySecondary
                    )
                }
                SdButton(
                    label = "Refresh Queue",
                    onClick = { scope.launch { controller.refreshNeeds() } },
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdText(text = "SCOPE:", style = SdTheme.typo.monoTag)
                SdFilterChip(
                    label = "ALL PROJECTS (${controller.needsTasks.size})",
                    selected = scopedProjectId == null,
                    onClick = { scopedProjectId = null }
                )
                controller.projects.forEach { proj ->
                    val count = controller.needsTasks.count { it.projectId == proj.id }
                    SdFilterChip(
                        label = "#${proj.id} ${proj.title} ($count)",
                        selected = scopedProjectId == proj.id,
                        onClick = {
                            scopedProjectId = if (scopedProjectId == proj.id) null else proj.id
                        }
                    )
                }
            }
        }

        when {
            controller.needsLoading && controller.needsTasks.isEmpty() -> {
                SdLoadingState(message = "Querying tasks blocked on waiting-human...")
            }
            controller.needsError != null && controller.needsTasks.isEmpty() -> {
                SdErrorState(
                    title = "Needs Triage Load Failed",
                    cause = controller.needsError ?: "Unknown error",
                    onRetry = { scope.launch { controller.refreshNeeds() } }
                )
            }
            displayedTasks.isEmpty() -> {
                SdEmptyState(
                    title = "Zero Tasks Waiting on Human",
                    causeAndNextStep = "No tasks currently have status=blocked and blocked_kind=waiting-human in the selected scope. Check the Board tab to inspect other statuses or lanes.",
                    actionLabel = "Refresh Queue",
                    onAction = { scope.launch { controller.refreshNeeds() } }
                )
            }
            else -> {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) {
                    items(displayedTasks, key = { it.id }) { task ->
                        NeedsTaskCard(
                            task = task,
                            controller = controller,
                            onEditBlock = { blockEditTarget = task }
                        )
                    }
                }
            }
        }
    }

    val pendingBlock = blockEditTarget
    if (pendingBlock != null) {
        BlockTaskReasonDialog(
            task = pendingBlock,
            onConfirmBlock = { kind, reason ->
                val id = pendingBlock.id
                blockEditTarget = null
                controller.updateTask(
                    taskId = id,
                    status = TaskStatus.BLOCKED,
                    blockedKind = kind,
                    blockedReason = reason
                )
            },
            onCancel = { blockEditTarget = null }
        )
    }

    val detailTask = controller.activeTaskDetail
    if (detailTask != null) {
        TaskDetailModal(
            controller = controller,
            task = detailTask,
            comments = controller.activeTaskComments,
            onDismiss = { controller.closeTaskDetail() },
            onRequestBlock = { blockEditTarget = detailTask }
        )
    }
}

@Composable
private fun NeedsTaskCard(
    task: TaskRecord,
    controller: AdminAppController,
    onEditBlock: () -> Unit
) {
    val colors = SdTheme.colors
    var decisionComment by remember(task.id) { mutableStateOf("") }

    SdCard(accentTopColor = colors.dangerCrimson, padding = 12.dp) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                SdTag(text = "#${task.id} [P#${task.projectId}]")
                SdStatusTag(status = task.status)
                SdLaneTag(lane = task.lane)
                SdPriorityTag(priority = task.priority)
                SdTag(text = "ASSIGNEE:${task.assignee ?: "unassigned"}")
            }
            SdText(
                text = "Blocked since ${SdTimeFormatter.formatEpochSecWib(task.statusChangedAt)}",
                style = SdTheme.typo.monoCode,
                color = colors.inkMuted
            )
        }

        SdText(
            text = task.title,
            style = SdTheme.typo.cardTitle
        )

        SdCard(padding = 10.dp) {
            SdText(
                text = "BLOCKED REASON (${task.blockedKind ?: BlockedKind.WAITING_HUMAN}):",
                style = SdTheme.typo.monoTag,
                color = colors.dangerCrimson
            )
            SdText(
                text = task.blockedReason ?: "No reason recorded",
                style = SdTheme.typo.bodyPrimary,
                color = colors.inkPrimary
            )
        }

        SdTextField(
            value = decisionComment,
            onValueChange = { decisionComment = it },
            label = "OPTIONAL RESOLUTION COMMENT (SENT ATOMICALLY WITH UNBLOCK)",
            placeholder = "Provide decision or guidance for ${task.assignee ?: "the lane owner"}..."
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            SdButton(
                label = if (task.assignee != null) "Unblock -> Doing" else "Unblock -> Todo",
                onClick = {
                    controller.updateTask(
                        taskId = task.id,
                        unblock = true,
                        comment = decisionComment.trim().takeIf { it.isNotEmpty() }
                    ) {
                        decisionComment = ""
                    }
                },
                variant = SdButtonVariant.PRIMARY,
                compact = true
            )
            SdButton(
                label = "Set Todo",
                onClick = {
                    controller.updateTask(
                        taskId = task.id,
                        status = TaskStatus.TODO,
                        comment = decisionComment.trim().takeIf { it.isNotEmpty() }
                    )
                },
                variant = SdButtonVariant.SECONDARY,
                compact = true
            )
            SdButton(
                label = "Set Doing",
                onClick = {
                    controller.updateTask(
                        taskId = task.id,
                        status = TaskStatus.DOING,
                        comment = decisionComment.trim().takeIf { it.isNotEmpty() }
                    )
                },
                variant = SdButtonVariant.SECONDARY,
                compact = true
            )
            SdButton(
                label = "Set Done",
                onClick = {
                    controller.updateTask(
                        taskId = task.id,
                        status = TaskStatus.DONE,
                        comment = decisionComment.trim().takeIf { it.isNotEmpty() }
                    )
                },
                variant = SdButtonVariant.SECONDARY,
                compact = true
            )
            SdButton(
                label = "Edit Block",
                onClick = onEditBlock,
                variant = SdButtonVariant.SECONDARY,
                compact = true
            )
            SdButton(
                label = "Inspect #${task.id}",
                onClick = { controller.openTaskDetail(task.id) },
                variant = SdButtonVariant.COBALT,
                compact = true
            )
        }
    }
}
