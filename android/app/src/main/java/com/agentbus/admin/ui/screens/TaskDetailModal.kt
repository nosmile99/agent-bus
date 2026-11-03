package com.agentbus.admin.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
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
fun TaskDetailModal(
    controller: AdminAppController,
    task: TaskRecord,
    comments: List<TaskCommentRecord>,
    onDismiss: () -> Unit,
    onRequestBlock: () -> Unit
) {
    val colors = SdTheme.colors

    var title by remember(task.id, task.updatedAt) { mutableStateOf(task.title) }
    var description by remember(task.id, task.updatedAt) { mutableStateOf(task.description ?: "") }
    var notes by remember(task.id, task.updatedAt) { mutableStateOf(task.notes ?: "") }
    var priority by remember(task.id, task.updatedAt) { mutableStateOf(task.priority) }
    var lane by remember(task.id, task.updatedAt) { mutableStateOf(task.lane) }
    var assigneeInput by remember(task.id, task.updatedAt) { mutableStateOf(task.assignee ?: "") }
    var dueDateInput by remember(task.id, task.updatedAt) {
        mutableStateOf(task.dueDate?.toString() ?: "")
    }

    var newTodoText by remember { mutableStateOf("") }
    var newTodoSortOrder by remember { mutableStateOf("0") }
    var newLabelText by remember { mutableStateOf("") }
    var newCommentText by remember { mutableStateOf("") }
    var showSystemLogs by remember { mutableStateOf(true) }

    val labelError = remember(newLabelText) {
        if (newLabelText.isEmpty()) null
        else if (ValidationRules.normalizeAndValidateLabel(newLabelText) == null) {
            "Invalid label: must match ^[a-z0-9_-]{1,32}$ after lowercase"
        } else null
    }

    SdModalDialog(
        title = "Task #${task.id} Detail (Project #${task.projectId})",
        onDismiss = onDismiss
    ) {
        // Metadata Badges
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            SdStatusTag(status = task.status)
            SdLaneTag(lane = task.lane)
            SdPriorityTag(priority = task.priority)
            SdTag(text = "ASSIGNEE:${task.assignee ?: "unassigned"}")
            if (task.adminAssigned != null) {
                SdTag(text = "ADMIN_ASSIGNED:${task.adminAssigned}")
            }
            SdTag(text = "COMMENTS:${task.commentCount} / LOGS:${task.activityCount}")
        }

        // Status Actions (Admin can update anyone's task without claim per SPEC section 6)
        SdCard(padding = 10.dp) {
            SdText(text = "STATUS & BLOCKED REV5 CONTROLS", style = SdTheme.typo.monoTag)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                listOf(TaskStatus.TODO, TaskStatus.DOING, TaskStatus.DONE).forEach { st ->
                    SdFilterChip(
                        label = "SET ${st.uppercase()}",
                        selected = task.status == st,
                        onClick = {
                            if (task.status != st) {
                                controller.updateTask(taskId = task.id, status = st)
                            }
                        }
                    )
                }
                SdButton(
                    label = if (task.status == TaskStatus.BLOCKED) "Update Block Kind/Reason" else "Block Task...",
                    onClick = onRequestBlock,
                    variant = SdButtonVariant.DANGER,
                    compact = true
                )
                if (task.status == TaskStatus.BLOCKED) {
                    SdButton(
                        label = "Unblock Now",
                        onClick = {
                            controller.updateTask(taskId = task.id, unblock = true)
                        },
                        variant = SdButtonVariant.COBALT,
                        compact = true
                    )
                }
            }
            if (task.status == TaskStatus.BLOCKED) {
                SdText(
                    text = "Currently Blocked [${task.blockedKind ?: BlockedKind.WAITING_HUMAN}]: ${task.blockedReason ?: ""}",
                    style = SdTheme.typo.monoCode,
                    color = colors.dangerCrimson
                )
            }
        }

        // Core Task Fields Editor
        SdCard(padding = 10.dp) {
            SdText(text = "EDIT TASK FIELDS (PUT /admin/api/kanban/tasks/${task.id})", style = SdTheme.typo.monoTag)
            SdTextField(
                value = title,
                onValueChange = { title = it },
                label = "TITLE"
            )
            SdTextField(
                value = description,
                onValueChange = { description = it },
                label = "DESCRIPTION",
                singleLine = false,
                minLines = 2
            )
            SdTextField(
                value = notes,
                onValueChange = { notes = it },
                label = "NOTES",
                singleLine = false,
                minLines = 2
            )

            SdText(text = "LANE", style = SdTheme.typo.monoTag)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TaskLane.ALL.forEach { ln ->
                    SdFilterChip(
                        label = ln.uppercase(),
                        selected = lane == ln,
                        onClick = { lane = ln }
                    )
                }
            }

            SdText(text = "PRIORITY", style = SdTheme.typo.monoTag)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TaskPriority.ALL.forEach { pri ->
                    SdFilterChip(
                        label = pri.uppercase(),
                        selected = priority == pri,
                        onClick = { priority = pri }
                    )
                }
            }

            SdTextField(
                value = assigneeInput,
                onValueChange = { assigneeInput = it },
                label = "ASSIGNEE (LEAVE EMPTY TO UNASSIGN / CLEAR ADMIN_ASSIGNED)",
                placeholder = "unassigned"
            )

            SdTextField(
                value = dueDateInput,
                onValueChange = { dueDateInput = it },
                label = "DUE DATE (EPOCH SECONDS OR YYYY-MM-DD, EMPTY = NULL)",
                placeholder = "e.g. 1793811600 or 2026-11-05"
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                SdButton(
                    label = "Delete Task...",
                    onClick = { controller.confirmDeleteTask(task) },
                    variant = SdButtonVariant.DANGER,
                    compact = true
                )
                SdButton(
                    label = "Save Task Fields",
                    enabled = title.trim().isNotEmpty(),
                    onClick = {
                        val parsedDue = parseDueDateInput(dueDateInput)
                        val assigneeChanged = (assigneeInput.trim().ifEmpty { null }) != task.assignee
                        val laneChanged = lane != task.lane
                        controller.updateTask(
                            taskId = task.id,
                            title = title.trim().takeIf { it != task.title },
                            description = description.ifEmpty { null },
                            includeDescription = description != (task.description ?: ""),
                            notes = notes.ifEmpty { null },
                            includeNotes = notes != (task.notes ?: ""),
                            priority = priority.takeIf { it != task.priority },
                            lane = lane.takeIf { laneChanged },
                            assignee = assigneeInput.trim().ifEmpty { null },
                            includeAssignee = assigneeChanged,
                            dueDate = parsedDue,
                            includeDueDate = parsedDue != task.dueDate
                        )
                    },
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }
        }

        // Section 9: Labels Manager
        SdCard(padding = 10.dp) {
            SdText(text = "LABELS (REGEX ^[a-z0-9_-]{1,32}$)", style = SdTheme.typo.monoTag)
            if (task.labels.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    task.labels.forEach { lbl ->
                        SdButton(
                            label = "#$lbl [x]",
                            onClick = { controller.removeLabel(task.id, lbl) },
                            variant = SdButtonVariant.SECONDARY,
                            compact = true
                        )
                    }
                }
            } else {
                SdText(text = "No labels attached.", style = SdTheme.typo.bodySecondary)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = newLabelText,
                    onValueChange = { newLabelText = it },
                    label = "ADD LABEL",
                    placeholder = "e.g. rev5-ready",
                    errorText = labelError,
                    modifier = Modifier.weight(1f)
                )
                SdButton(
                    label = "Add Label",
                    enabled = newLabelText.isNotBlank() && labelError == null,
                    onClick = {
                        controller.addLabel(task.id, newLabelText) {
                            newLabelText = ""
                        }
                    },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
            }
        }

        // Section 7: Todos Manager
        SdCard(padding = 10.dp) {
            SdText(text = "TODOS (${task.todos.count { it.isDone }}/${task.todos.size})", style = SdTheme.typo.monoTag)
            if (task.todos.isEmpty()) {
                SdText(text = "No todos on this task yet.", style = SdTheme.typo.bodySecondary)
            } else {
                task.todos.forEach { todo ->
                    var editingTodoText by remember(todo.id, todo.text) { mutableStateOf(todo.text) }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        SdCheckboxRow(
                            checked = todo.isDone,
                            label = "#${todo.id}",
                            onCheckedChange = { checked ->
                                controller.updateTodo(task.id, todo.id, done = checked)
                            }
                        )
                        SdTextField(
                            value = editingTodoText,
                            onValueChange = { editingTodoText = it },
                            label = "",
                            modifier = Modifier.weight(1f)
                        )
                        if (editingTodoText.trim() != todo.text && editingTodoText.trim().isNotEmpty()) {
                            SdButton(
                                label = "Save",
                                onClick = {
                                    controller.updateTodo(task.id, todo.id, text = editingTodoText.trim())
                                },
                                variant = SdButtonVariant.COBALT,
                                compact = true
                            )
                        }
                        SdButton(
                            label = "Del",
                            onClick = { controller.deleteTodo(task.id, todo.id) },
                            variant = SdButtonVariant.DANGER,
                            compact = true
                        )
                    }
                }
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = newTodoText,
                    onValueChange = { newTodoText = it },
                    label = "NEW TODO TEXT",
                    placeholder = "Add checklist item...",
                    modifier = Modifier.weight(1f)
                )
                SdTextField(
                    value = newTodoSortOrder,
                    onValueChange = { newTodoSortOrder = it.filter { c -> c.isDigit() || c == '-' } },
                    label = "ORDER",
                    modifier = Modifier.width(76.dp)
                )
                SdButton(
                    label = "Add Todo",
                    enabled = newTodoText.trim().isNotEmpty(),
                    onClick = {
                        controller.addTodo(
                            taskId = task.id,
                            text = newTodoText.trim(),
                            sortOrder = newTodoSortOrder.toIntOrNull() ?: 0
                        )
                        newTodoText = ""
                    },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
            }
        }

        // Section 8: Append-Only Comments & Activity Log
        SdCard(padding = 10.dp) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdText(
                    text = "COMMENTS & ACTIVITY (APPEND-ONLY, AUTHOR: admin)",
                    style = SdTheme.typo.monoTag
                )
                SdFilterChip(
                    label = if (showSystemLogs) "SHOWING ALL (${comments.size})" else "MANUAL ONLY",
                    selected = showSystemLogs,
                    onClick = { showSystemLogs = !showSystemLogs }
                )
            }

            val visibleComments = remember(comments, showSystemLogs) {
                if (showSystemLogs) comments else comments.filterNot { it.isSystemLog }
            }

            if (visibleComments.isEmpty()) {
                SdText(text = "No comments recorded yet.", style = SdTheme.typo.bodySecondary)
            } else {
                visibleComments.forEach { c ->
                    SdCard(padding = 8.dp) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            SdTag(
                                text = if (c.isSystemLog) "SYSTEM LOG #${c.id}" else "${c.author} #${c.id}",
                                bgColor = if (c.isSystemLog) colors.bgSubtle else colors.cobaltInk,
                                textColor = if (c.isSystemLog) colors.inkSecondary else colors.onCobaltInk
                            )
                            SdText(
                                text = SdTimeFormatter.formatEpochSecWib(c.ts),
                                style = SdTheme.typo.monoCode,
                                color = colors.inkMuted
                            )
                        }
                        SdText(text = c.body, style = SdTheme.typo.bodyPrimary)
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = newCommentText,
                    onValueChange = { newCommentText = it },
                    label = "APPEND COMMENT AS 'admin'",
                    placeholder = "Write comment...",
                    modifier = Modifier.weight(1f)
                )
                SdButton(
                    label = "Post Comment",
                    enabled = newCommentText.trim().isNotEmpty() && ValidationRules.isWithinBodyCap(newCommentText),
                    onClick = {
                        controller.addComment(task.id, newCommentText.trim()) {
                            newCommentText = ""
                        }
                    },
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }
        }

        // Section 9: Task Dependencies & Unblock Rescue (v12)
        var blockerInput by remember { mutableStateOf("") }
        var dependencyMsg by remember { mutableStateOf<String?>(null) }
        var dependenciesList by remember { mutableStateOf<List<TaskDependencyRecord>>(emptyList()) }
        val scope = rememberCoroutineScope()

        SdCard(padding = 10.dp) {
            SdText(
                text = "TASK DEPENDENCIES & RESCUE (/admin/api/kanban/tasks/${task.id}/dependencies)",
                style = SdTheme.typo.monoTag
            )
            if (dependencyMsg != null) {
                SdText(
                    text = dependencyMsg ?: "",
                    style = SdTheme.typo.bodySecondary,
                    color = colors.signalVermilion
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SdButton(
                    label = "Load Dependencies",
                    onClick = {
                        scope.launch {
                            try {
                                val res = controller.apiClient.getTaskDependencies(task.id)
                                dependenciesList = res.dependencies
                                dependencyMsg = "Loaded ${res.dependencies.size} blockers."
                            } catch (e: Exception) {
                                dependencyMsg = "Error: ${e.message}"
                            }
                        }
                    },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
                SdButton(
                    label = "Rescue Task (Clear Blockers)",
                    onClick = {
                        scope.launch {
                            try {
                                val res = controller.apiClient.rescueTask(task.id)
                                dependencyMsg = "Task rescued: ok=${res.ok}"
                            } catch (e: Exception) {
                                dependencyMsg = "Error: ${e.message}"
                            }
                        }
                    },
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }

            if (dependenciesList.isNotEmpty()) {
                dependenciesList.forEach { dep ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        SdText(
                            text = "Blocked by Task #${dep.blockerId}: ${dep.reason}",
                            style = SdTheme.typo.bodySecondary
                        )
                        SdButton(
                            label = "Remove",
                            onClick = {
                                scope.launch {
                                    try {
                                        controller.apiClient.removeTaskDependency(task.id, dep.blockerId)
                                        dependenciesList = dependenciesList.filterNot { it.blockerId == dep.blockerId }
                                        dependencyMsg = "Removed blocker #${dep.blockerId}."
                                    } catch (e: Exception) {
                                        dependencyMsg = "Error: ${e.message}"
                                    }
                                }
                            },
                            variant = SdButtonVariant.DANGER,
                            compact = true
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = blockerInput,
                    onValueChange = { blockerInput = it.filter { c -> c.isDigit() } },
                    label = "ADD BLOCKER TASK ID",
                    placeholder = "Task ID",
                    modifier = Modifier.weight(1f)
                )
                SdButton(
                    label = "Add Blocker",
                    enabled = blockerInput.isNotBlank(),
                    onClick = {
                        val blockerId = blockerInput.toIntOrNull()
                        if (blockerId != null) {
                            scope.launch {
                                try {
                                    controller.apiClient.addTaskDependency(task.id, blockerId, "Added from UI")
                                    blockerInput = ""
                                    val res = controller.apiClient.getTaskDependencies(task.id)
                                    dependenciesList = res.dependencies
                                    dependencyMsg = "Blocker #$blockerId added."
                                } catch (e: Exception) {
                                    dependencyMsg = "Error: ${e.message}"
                                }
                            }
                        }
                    },
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }
        }
    }
}

@Composable
fun GlobalSearchAndActivityModal(
    controller: AdminAppController,
    onDismiss: () -> Unit
) {
    var q by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    var lane by remember { mutableStateOf<String?>(null) }
    var priority by remember { mutableStateOf<String?>(null) }
    var assignee by remember { mutableStateOf("") }
    var label by remember { mutableStateOf("") }
    var blockedKind by remember { mutableStateOf<String?>(null) }
    var staleOnly by remember { mutableStateOf(false) }
    var dueDateFilter by remember { mutableStateOf<String?>(null) } // "overdue" | "none" | null
    var includeArchived by remember { mutableStateOf(false) }
    var activityLimit by remember { mutableStateOf("50") }

    SdModalDialog(
        title = "Global Kanban Search, Summary & Activity",
        onDismiss = onDismiss
    ) {
        // Summary by Assignee breakdown (SPEC section 10)
        val sum = controller.globalSummary
        if (sum != null) {
            SdCard(padding = 10.dp) {
                SdText(text = "GLOBAL SUMMARY (GET /admin/api/kanban/summary)", style = SdTheme.typo.monoTag)
                SdText(
                    text = "Todo: ${sum.byStatus.todo}  |  Doing: ${sum.byStatus.doing}  |  Blocked: ${sum.byStatus.blocked}  |  Done: ${sum.byStatus.done}",
                    style = SdTheme.typo.monoCode
                )
                SdText(
                    text = "Stale (>24h): ${sum.staleCount}  |  Overdue (Jakarta start-of-day): ${sum.overdueCount}  |  Needs Human: ${sum.needsHumanCount}",
                    style = SdTheme.typo.monoCode
                )
                if (sum.byAssignee.isNotEmpty()) {
                    val breakdown = sum.byAssignee.entries.joinToString("   ") { (ag, sc) ->
                        "$ag[T:${sc.todo}/D:${sc.doing}/B:${sc.blocked}/OK:${sc.done}]"
                    }
                    SdText(text = "By Assignee: $breakdown", style = SdTheme.typo.bodySecondary)
                }
            }
        }

        // Global Search Controls
        SdCard(padding = 10.dp) {
            SdText(text = "GLOBAL SEARCH (GET /admin/api/kanban/tasks/search?global=1)", style = SdTheme.typo.monoTag)
            SdTextField(
                value = q,
                onValueChange = { q = it },
                label = "QUERY (TITLE / DESCRIPTION / NOTES)",
                placeholder = "Search tasks..."
            )
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                SdFilterChip(label = "ANY STATUS", selected = status == null, onClick = { status = null })
                TaskStatus.ALL.forEach { st ->
                    SdFilterChip(
                        label = st.uppercase(),
                        selected = status == st,
                        onClick = { status = if (status == st) null else st }
                    )
                }
            }
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                SdFilterChip(label = "ANY LANE", selected = lane == null, onClick = { lane = null })
                TaskLane.ALL.forEach { ln ->
                    SdFilterChip(
                        label = ln.uppercase(),
                        selected = lane == ln,
                        onClick = { lane = if (lane == ln) null else ln }
                    )
                }
                SdFilterChip(
                    label = "OVERDUE (WIB)",
                    selected = dueDateFilter == "overdue",
                    onClick = { dueDateFilter = if (dueDateFilter == "overdue") null else "overdue" }
                )
                SdFilterChip(
                    label = "NO DUE DATE",
                    selected = dueDateFilter == "none",
                    onClick = { dueDateFilter = if (dueDateFilter == "none") null else "none" }
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SdTextField(
                    value = assignee,
                    onValueChange = { assignee = it },
                    label = "ASSIGNEE",
                    placeholder = "agent or unassigned",
                    modifier = Modifier.weight(1f)
                )
                SdTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = "LABEL",
                    placeholder = "label",
                    modifier = Modifier.weight(1f)
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                SdCheckboxRow(
                    checked = staleOnly,
                    label = "Stale Doing (>24h)",
                    onCheckedChange = { staleOnly = it }
                )
                SdCheckboxRow(
                    checked = includeArchived,
                    label = "Include Archived",
                    onCheckedChange = { includeArchived = it }
                )
            }
            SdButton(
                label = "Run Global Search",
                onClick = {
                    controller.executeGlobalSearch(
                        TaskSearchOpts(
                            q = q.takeIf { it.isNotBlank() },
                            status = status,
                            assignee = assignee.trim().takeIf { it.isNotEmpty() },
                            label = label.trim().takeIf { it.isNotEmpty() },
                            blockedKind = blockedKind,
                            priority = priority,
                            lane = lane,
                            stale = staleOnly,
                            dueDateFilter = dueDateFilter,
                            includeArchived = includeArchived
                        )
                    )
                },
                variant = SdButtonVariant.COBALT,
                compact = true
            )

            if (controller.globalSearchTasks.isNotEmpty()) {
                SdText(
                    text = "Search Results (${controller.globalSearchTasks.size}):",
                    style = SdTheme.typo.monoTag
                )
                controller.globalSearchTasks.forEach { t ->
                    SdCard(
                        padding = 8.dp,
                        onClick = {
                            onDismiss()
                            controller.openTaskDetail(t.id)
                        }
                    ) {
                        SdText(
                            text = "#${t.id} [P#${t.projectId}] ${t.title} (${t.status.uppercase()} / ${t.lane} / ${t.assignee ?: "unassigned"})",
                            style = SdTheme.typo.bodyPrimary
                        )
                    }
                }
            }
        }

        // Global Activity Feed (GET /admin/api/kanban/activity)
        SdCard(padding = 10.dp) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdText(
                    text = "KANBAN ACTIVITY (GET /admin/api/kanban/activity, MAX 200)",
                    style = SdTheme.typo.monoTag
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    SdTextField(
                        value = activityLimit,
                        onValueChange = { activityLimit = it.filter { c -> c.isDigit() } },
                        label = "",
                        modifier = Modifier.width(72.dp)
                    )
                    SdButton(
                        label = "Reload",
                        onClick = {
                            val lim = (activityLimit.toIntOrNull() ?: 50).coerceIn(1, 200)
                            activityLimit = lim.toString()
                            controller.loadGlobalActivity(limit = lim)
                        },
                        variant = SdButtonVariant.SECONDARY,
                        compact = true
                    )
                }
            }
            if (controller.activityItems.isEmpty()) {
                SdText(text = "No activity items recorded.", style = SdTheme.typo.bodySecondary)
            } else {
                controller.activityItems.take(30).forEach { act ->
                    SdCard(
                        padding = 8.dp,
                        onClick = {
                            onDismiss()
                            controller.openTaskDetail(act.taskId)
                        }
                    ) {
                        SdText(
                            text = "#${act.id} Task #${act.taskId} (${act.taskTitle}) [${act.taskStatus.uppercase()}] by ${act.author} @ ${SdTimeFormatter.formatEpochSecWib(act.ts)}",
                            style = SdTheme.typo.monoCode
                        )
                        SdText(text = act.body, style = SdTheme.typo.bodySecondary)
                    }
                }
            }
        }
    }
}
