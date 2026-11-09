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
import java.time.LocalDate
import java.time.ZoneId

@Composable
fun BoardScreen(controller: AdminAppController, screenWidthDp: Int) {
    val colors = SdTheme.colors
    val scope = rememberCoroutineScope()

    var statusFilter by remember { mutableStateOf<String?>(null) }
    var laneFilter by remember { mutableStateOf<String?>(null) }
    var labelFilter by remember { mutableStateOf<String?>(null) }
    var showCreateProjectModal by remember { mutableStateOf(false) }
    var showEditProjectModal by remember { mutableStateOf(false) }
    var showCreateTaskModal by remember { mutableStateOf(false) }
    var showSearchAndActivityModal by remember { mutableStateOf(false) }
    var blockTargetTask by remember { mutableStateOf<TaskRecord?>(null) }

    val selectedProject = remember(controller.projects, controller.selectedProjectId) {
        controller.projects.firstOrNull { it.id == controller.selectedProjectId }
    }

    val filteredTasks = remember(controller.projectTasks, statusFilter, laneFilter, labelFilter) {
        controller.projectTasks.filter { t ->
            (statusFilter == null || t.status == statusFilter) &&
                (laneFilter == null || t.lane == laneFilter) &&
                (labelFilter == null || true) // Project tasks list doesn't embed labels; search endpoint filters by label
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Project Selector & Summary Strip
        SdCard(padding = 10.dp) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdText(text = "PROJECTS:", style = SdTheme.typo.monoTag)
                controller.projects.forEach { proj ->
                    val archiveMark = if (proj.isArchived) " [ARCHIVED]" else ""
                    SdFilterChip(
                        label = "#${proj.id} ${proj.title} (${proj.taskCount})$archiveMark",
                        selected = controller.selectedProjectId == proj.id,
                        onClick = { controller.selectProject(proj.id) }
                    )
                }
                SdButton(
                    label = "+ Project",
                    onClick = { showCreateProjectModal = true },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
            }

            if (selectedProject != null) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        val subList = controller.projectSubscribers.joinToString(", ") { it.agent }
                            .ifEmpty { "all agents (open project)" }
                        SdText(
                            text = "Project #${selectedProject.id}: ${selectedProject.title}  |  Subscribers: $subList",
                            style = SdTheme.typo.bodySecondary
                        )
                        val sum = controller.projectSummary ?: controller.globalSummary
                        if (sum != null) {
                            SdText(
                                text = "STATUS [TODO:${sum.byStatus.todo} DOING:${sum.byStatus.doing} BLOCKED:${sum.byStatus.blocked} DONE:${sum.byStatus.done}]  |  LANE [BE:${sum.byLane.backend} AND:${sum.byLane.android} UN:${sum.byLane.unassigned}]  |  STALE:${sum.staleCount}  OVERDUE(WIB):${sum.overdueCount}  NEEDS-HUMAN:${sum.needsHumanCount}",
                                style = SdTheme.typo.monoCode,
                                color = colors.inkPrimary
                            )
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SdButton(
                            label = "Edit Project",
                            onClick = { showEditProjectModal = true },
                            variant = SdButtonVariant.SECONDARY,
                            compact = true
                        )
                        SdButton(
                            label = "Search & Activity",
                            onClick = { showSearchAndActivityModal = true },
                            variant = SdButtonVariant.SECONDARY,
                            compact = true
                        )
                        SdButton(
                            label = "+ Task",
                            onClick = { showCreateTaskModal = true },
                            variant = SdButtonVariant.PRIMARY,
                            compact = true
                        )
                    }
                }
            }
        }

        // Filter Bar for Board Tasks
        SdCard(padding = 10.dp) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdText(text = "STATUS:", style = SdTheme.typo.monoTag)
                SdFilterChip(
                    label = "ALL (${controller.projectTasks.size})",
                    selected = statusFilter == null,
                    onClick = { statusFilter = null }
                )
                TaskStatus.ALL.forEach { st ->
                    val c = controller.projectTasks.count { it.status == st }
                    SdFilterChip(
                        label = "${st.uppercase()} ($c)",
                        selected = statusFilter == st,
                        onClick = { statusFilter = if (statusFilter == st) null else st }
                    )
                }

                Spacer(modifier = Modifier.width(8.dp))
                SdText(text = "LANE:", style = SdTheme.typo.monoTag)
                SdFilterChip(
                    label = "ALL",
                    selected = laneFilter == null,
                    onClick = { laneFilter = null }
                )
                TaskLane.ALL.forEach { ln ->
                    SdFilterChip(
                        label = ln.uppercase(),
                        selected = laneFilter == ln,
                        onClick = { laneFilter = if (laneFilter == ln) null else ln }
                    )
                }

                if (controller.projectLabels.isNotEmpty()) {
                    Spacer(modifier = Modifier.width(8.dp))
                    SdText(text = "LABEL SEARCH:", style = SdTheme.typo.monoTag)
                    controller.projectLabels.forEach { lbl ->
                        SdFilterChip(
                            label = "#$lbl",
                            selected = labelFilter == lbl,
                            onClick = {
                                val next = if (labelFilter == lbl) null else lbl
                                labelFilter = next
                                val pid = controller.selectedProjectId
                                if (pid != null) {
                                    scope.launch {
                                        if (next != null) {
                                            val res = controller.apiClient.searchProjectTasks(
                                                pid,
                                                TaskSearchOpts(label = next, includeArchived = true)
                                            )
                                            // Display filtered tasks via search
                                            controller.postStatus("Filtered project #$pid by label '$next' (${res.tasks.size} tasks).")
                                        }
                                    }
                                }
                            }
                        )
                    }
                }
            }
        }

        // Board Content (Loading / Error / Empty / Responsive Columns)
        when {
            controller.boardLoading && controller.projectTasks.isEmpty() -> {
                SdLoadingState(message = "Loading Kanban projects and tasks...")
            }
            controller.boardError != null && controller.projects.isEmpty() -> {
                SdErrorState(
                    title = "Kanban Board Load Failed",
                    cause = controller.boardError ?: "Unknown error",
                    onRetry = { scope.launch { controller.refreshBoard() } }
                )
            }
            selectedProject == null -> {
                SdEmptyState(
                    title = "No Kanban Project Selected",
                    causeAndNextStep = "Create a project to organize tasks, assignees, lanes, and checklists.",
                    actionLabel = "Create First Project",
                    onAction = { showCreateProjectModal = true }
                )
            }
            filteredTasks.isEmpty() -> {
                SdEmptyState(
                    title = "No Tasks in Current View",
                    causeAndNextStep = "Project '${selectedProject.title}' has no tasks matching the active status or lane filter. Create a task (blank or from template) or clear filters.",
                    actionLabel = "Create Task",
                    onAction = { showCreateTaskModal = true }
                )
            }
            screenWidthDp >= 840 && statusFilter == null -> {
                // 4-Column Desktop/Tablet-Landscape Reflow (antislop-layoutmobile R-03)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    TaskStatus.ALL.forEach { st ->
                        val colTasks = filteredTasks.filter { it.status == st }
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight(),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            SdSectionHeader(
                                indexCode = st.uppercase(),
                                title = "${colTasks.size} Tasks"
                            )
                            LazyColumn(
                                modifier = Modifier.fillMaxSize(),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                                contentPadding = PaddingValues(bottom = 24.dp)
                            ) {
                                items(colTasks, key = { it.id }) { task ->
                                    KanbanTaskCard(
                                        task = task,
                                        controller = controller,
                                        onOpenDetail = { controller.openTaskDetail(task.id) },
                                        onRequestBlock = { blockTargetTask = task }
                                    )
                                }
                            }
                        }
                    }
                }
            }
            else -> {
                // Single-column phone or 2-column medium tablet stack
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) {
                    items(filteredTasks, key = { it.id }) { task ->
                        KanbanTaskCard(
                            task = task,
                            controller = controller,
                            onOpenDetail = { controller.openTaskDetail(task.id) },
                            onRequestBlock = { blockTargetTask = task }
                        )
                    }
                }
            }
        }
    }

    if (showCreateProjectModal) {
        CreateProjectModal(
            controller = controller,
            onDismiss = { showCreateProjectModal = false }
        )
    }

    if (showEditProjectModal && selectedProject != null) {
        EditProjectModal(
            controller = controller,
            project = selectedProject,
            currentSubscribers = controller.projectSubscribers.map { it.agent },
            onDismiss = { showEditProjectModal = false }
        )
    }

    if (showCreateTaskModal && selectedProject != null) {
        CreateTaskModal(
            controller = controller,
            project = selectedProject,
            onDismiss = { showCreateTaskModal = false }
        )
    }

    if (showSearchAndActivityModal) {
        GlobalSearchAndActivityModal(
            controller = controller,
            onDismiss = { showSearchAndActivityModal = false }
        )
    }

    val pendingBlock = blockTargetTask
    if (pendingBlock != null) {
        BlockTaskReasonDialog(
            task = pendingBlock,
            onConfirmBlock = { kind, reason ->
                val targetId = pendingBlock.id
                blockTargetTask = null
                controller.updateTask(
                    taskId = targetId,
                    status = TaskStatus.BLOCKED,
                    blockedKind = kind,
                    blockedReason = reason
                )
            },
            onCancel = {
                // Per SPEC section 6: cancellation sends NO patch!
                blockTargetTask = null
            }
        )
    }

    val detailTask = controller.activeTaskDetail
    if (detailTask != null) {
        TaskDetailModal(
            controller = controller,
            task = detailTask,
            comments = controller.activeTaskComments,
            onDismiss = { controller.closeTaskDetail() },
            onRequestBlock = { blockTargetTask = detailTask }
        )
    }
}

@Composable
fun KanbanTaskCard(
    task: TaskRecord,
    controller: AdminAppController,
    onOpenDetail: () -> Unit,
    onRequestBlock: () -> Unit
) {
    val colors = SdTheme.colors
    val accent = when (task.status) {
        TaskStatus.BLOCKED -> colors.dangerCrimson
        TaskStatus.DOING -> colors.cobaltInk
        TaskStatus.DONE -> colors.forestOk
        else -> null
    }

    SdCard(
        accentTopColor = accent,
        padding = 12.dp,
        onClick = onOpenDetail
    ) {
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
                SdTag(text = "#${task.id}")
                SdStatusTag(status = task.status)
                SdLaneTag(lane = task.lane)
                SdPriorityTag(priority = task.priority)
            }
            SdTag(
                text = "ASSIGNEE:${task.assignee ?: "unassigned"}",
                bgColor = if (task.assignee != null) colors.bgSubtle else colors.bgCanvas,
                textColor = colors.inkPrimary
            )
        }

        SdText(
            text = task.title,
            style = SdTheme.typo.cardTitle,
            color = colors.inkPrimary
        )

        if (!task.description.isNullOrBlank()) {
            SdText(
                text = task.description,
                style = SdTheme.typo.bodySecondary,
                maxLines = 2
            )
        }

        if (task.status == TaskStatus.BLOCKED) {
            SdCard(
                accentTopColor = colors.dangerCrimson,
                padding = 8.dp
            ) {
                SdText(
                    text = "BLOCKED [${task.blockedKind ?: BlockedKind.WAITING_HUMAN}]: ${task.blockedReason ?: "No reason"}",
                    style = SdTheme.typo.monoCode,
                    color = colors.dangerCrimson
                )
            }
        }

        if (task.dueDate != null) {
            SdText(
                text = "Due: ${SdTimeFormatter.formatEpochSecWib(task.dueDate)}",
                style = SdTheme.typo.monoCode,
                color = colors.amberWarn
            )
        }

        // Embedded Todos Summary
        if (task.todos.isNotEmpty()) {
            val doneCount = task.todos.count { it.isDone }
            SdText(
                text = "Checklist: $doneCount / ${task.todos.size} completed",
                style = SdTheme.typo.monoCode,
                color = colors.inkSecondary
            )
        }

        // Quick Status Transition Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            SdButton(
                label = "Inspect",
                onClick = onOpenDetail,
                variant = SdButtonVariant.COBALT,
                compact = true
            )
            if (task.status != TaskStatus.TODO) {
                SdButton(
                    label = "-> Todo",
                    onClick = { controller.updateTask(taskId = task.id, status = TaskStatus.TODO) },
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }
            if (task.status != TaskStatus.DOING) {
                SdButton(
                    label = "-> Doing",
                    onClick = { controller.updateTask(taskId = task.id, status = TaskStatus.DOING) },
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }
            if (task.status != TaskStatus.DONE) {
                SdButton(
                    label = "-> Done",
                    onClick = { controller.updateTask(taskId = task.id, status = TaskStatus.DONE) },
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }
            SdButton(
                label = if (task.status == TaskStatus.BLOCKED) "Edit Block" else "Block...",
                onClick = onRequestBlock,
                variant = SdButtonVariant.DANGER,
                compact = true
            )
        }
    }
}

@Composable
fun BlockTaskReasonDialog(
    task: TaskRecord,
    onConfirmBlock: (blockedKind: String, blockedReason: String) -> Unit,
    onCancel: () -> Unit
) {
    var selectedKind by remember(task) {
        mutableStateOf(task.blockedKind ?: BlockedKind.WAITING_HUMAN)
    }
    var reason by remember(task) {
        mutableStateOf(task.blockedReason ?: "")
    }
    val trimmedLen = reason.trim().length
    val isReasonValid = ValidationRules.isValidBlockedReason(reason)

    SdModalDialog(
        title = if (task.status == TaskStatus.BLOCKED) {
            "Update Block Kind / Reason for Task #${task.id}"
        } else {
            "Block Task #${task.id}: Reason Required (Rev5)"
        },
        onDismiss = onCancel
    ) {
        SdText(
            text = "SPEC Section 6 (Blocked rev5): Moving to blocked requires a non-empty blocked_reason between 1 and 280 characters after trimming. Cancelling sends no request.",
            style = SdTheme.typo.bodySecondary
        )

        SdText(text = "BLOCKED KIND", style = SdTheme.typo.monoTag)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            BlockedKind.ALL.forEach { kind ->
                SdFilterChip(
                    label = kind,
                    selected = selectedKind == kind,
                    onClick = { selectedKind = kind }
                )
            }
        }

        SdTextField(
            value = reason,
            onValueChange = { reason = it },
            label = "BLOCKED REASON ($trimmedLen / 280 CHARS)",
            placeholder = "Describe specifically what is blocking this task...",
            singleLine = false,
            minLines = 3,
            errorText = when {
                trimmedLen == 0 -> "Reason is required before blocking (1..280 chars)"
                trimmedLen > 280 -> "Reason exceeds 280 characters ($trimmedLen)"
                else -> null
            }
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)
        ) {
            SdButton(
                label = "Cancel",
                onClick = onCancel,
                variant = SdButtonVariant.SECONDARY
            )
            SdButton(
                label = "Confirm Block",
                enabled = isReasonValid && ValidationRules.isValidBlockedKind(selectedKind),
                onClick = { onConfirmBlock(selectedKind, reason.trim()) },
                variant = SdButtonVariant.DANGER
            )
        }
    }
}

@Composable
private fun CreateProjectModal(
    controller: AdminAppController,
    onDismiss: () -> Unit
) {
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var subscribersCsv by remember { mutableStateOf("") }

    SdModalDialog(
        title = "Create Kanban Project (POST /admin/api/kanban/projects)",
        onDismiss = onDismiss
    ) {
        SdTextField(
            value = title,
            onValueChange = { title = it },
            label = "PROJECT TITLE (REQUIRED)",
            placeholder = "e.g. Android Admin Client v1",
            errorText = if (title.isNotEmpty() && title.trim().isEmpty()) "Title cannot be blank" else null
        )

        SdTextField(
            value = description,
            onValueChange = { description = it },
            label = "DESCRIPTION (OPTIONAL)",
            placeholder = "Project scope and goals...",
            singleLine = false,
            minLines = 3
        )

        SdTextField(
            value = subscribersCsv,
            onValueChange = { subscribersCsv = it },
            label = "SUBSCRIBER AGENTS (COMMA-SEPARATED, EMPTY = OPEN TO ALL)",
            placeholder = "e.g. nyx, nosmile99"
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            SdButton(
                label = "Create Project",
                enabled = title.trim().isNotEmpty(),
                onClick = {
                    val subs = subscribersCsv.split(",")
                        .map { it.trim() }
                        .filter { it.isNotEmpty() }
                        .takeIf { it.isNotEmpty() }
                    controller.createProject(
                        title = title.trim(),
                        description = description.takeIf { it.isNotBlank() },
                        subscribers = subs,
                        onDone = onDismiss
                    )
                }
            )
        }
    }
}

@Composable
private fun EditProjectModal(
    controller: AdminAppController,
    project: ProjectRecord,
    currentSubscribers: List<String>,
    onDismiss: () -> Unit
) {
    var title by remember(project) { mutableStateOf(project.title) }
    var description by remember(project) { mutableStateOf(project.description ?: "") }
    var archived by remember(project) { mutableStateOf(project.isArchived) }
    var subscribersCsv by remember(currentSubscribers) {
        mutableStateOf(currentSubscribers.joinToString(", "))
    }

    SdModalDialog(
        title = "Edit Project #${project.id}",
        onDismiss = onDismiss
    ) {
        SdTextField(
            value = title,
            onValueChange = { title = it },
            label = "PROJECT TITLE"
        )

        SdTextField(
            value = description,
            onValueChange = { description = it },
            label = "DESCRIPTION",
            singleLine = false,
            minLines = 2
        )

        SdTextField(
            value = subscribersCsv,
            onValueChange = { subscribersCsv = it },
            label = "SUBSCRIBERS (COMMA-SEPARATED)"
        )

        SdCheckboxRow(
            checked = archived,
            label = "Archived (archived = ${if (archived) 1 else 0}; transition 0->1 emits kanban.project.archived)",
            onCheckedChange = { archived = it }
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            SdButton(
                label = "Delete Project...",
                onClick = {
                    onDismiss()
                    controller.confirmDeleteProject(project)
                },
                variant = SdButtonVariant.DANGER
            )
            SdButton(
                label = "Save Project",
                enabled = title.trim().isNotEmpty(),
                onClick = {
                    val subs = subscribersCsv.split(",")
                        .map { it.trim() }
                        .filter { it.isNotEmpty() }
                    controller.updateProject(
                        projectId = project.id,
                        title = title.trim(),
                        description = description,
                        includeDescription = true,
                        archived = if (archived) 1 else 0,
                        subscribers = subs
                    )
                    onDismiss()
                }
            )
        }
    }
}

@Composable
private fun CreateTaskModal(
    controller: AdminAppController,
    project: ProjectRecord,
    onDismiss: () -> Unit
) {
    var selectedTemplateName by remember { mutableStateOf<String?>(null) }
    val selectedTemplate = remember(selectedTemplateName, controller.templates) {
        controller.templates.firstOrNull { it.name == selectedTemplateName }
    }
    val requiredPlaceholders = remember(selectedTemplate) {
        selectedTemplate?.let { ValidationRules.extractTemplatePlaceholders(it) } ?: emptyList()
    }
    var templateVars by remember(selectedTemplate) {
        mutableStateOf(requiredPlaceholders.associateWith { "" })
    }

    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var priority by remember(selectedTemplate) {
        mutableStateOf(selectedTemplate?.priority ?: TaskPriority.NORMAL)
    }
    var lane by remember(selectedTemplate) {
        mutableStateOf(selectedTemplate?.lane ?: TaskLane.UNASSIGNED)
    }
    var assigneeMode by remember { mutableStateOf("auto") } // "auto" | "explicit" | "null"
    var explicitAssignee by remember { mutableStateOf("") }
    var dueDateInput by remember { mutableStateOf("") } // YYYY-MM-DD or epoch seconds
    var labelsCsv by remember(selectedTemplate) {
        mutableStateOf(selectedTemplate?.labels?.joinToString(", ") ?: "")
    }

    val parsedLabelsResult = remember(labelsCsv) {
        val raw = labelsCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        ValidationRules.normalizeAndValidateLabels(raw)
    }

    val missingPlaceholder = remember(requiredPlaceholders, templateVars, title) {
        if (selectedTemplate != null) {
            requiredPlaceholders.firstOrNull { key -> templateVars[key].isNullOrBlank() }
        } else null
    }

    val mappedLaneOwner = remember(lane, controller.laneMappings) {
        if (lane == TaskLane.UNASSIGNED) null
        else controller.laneMappings
            .filter { it.lane == lane }
            .minByOrNull { it.agent }
            ?.agent
    }

    SdModalDialog(
        title = "Create Task in '${project.title}' (#${project.id})",
        onDismiss = onDismiss
    ) {
        // Template Picker (SPEC section 6 & 13)
        SdText(text = "OPTIONAL TEMPLATE (GET /admin/api/kanban/templates)", style = SdTheme.typo.monoTag)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            SdFilterChip(
                label = "NO TEMPLATE",
                selected = selectedTemplateName == null,
                onClick = { selectedTemplateName = null }
            )
            controller.templates.forEach { tpl ->
                SdFilterChip(
                    label = "${tpl.name} (${tpl.lane})",
                    selected = selectedTemplateName == tpl.name,
                    onClick = { selectedTemplateName = tpl.name }
                )
            }
        }

        if (selectedTemplate != null) {
            SdCard(padding = 10.dp) {
                SdText(
                    text = "Template '${selectedTemplate.name}': title=\"${selectedTemplate.title}\", lane=${selectedTemplate.lane}, labels=${selectedTemplate.labels}",
                    style = SdTheme.typo.monoCode
                )
                if (requiredPlaceholders.isNotEmpty()) {
                    SdText(
                        text = "REQUIRED TEMPLATE_VARS PLACEHOLDERS",
                        style = SdTheme.typo.monoTag,
                        color = SdTheme.colors.signalVermilion
                    )
                    requiredPlaceholders.forEach { key ->
                        SdTextField(
                            value = templateVars[key] ?: "",
                            onValueChange = { v -> templateVars = templateVars + (key to v) },
                            label = "VAR: {$key}",
                            placeholder = "Value for {$key}...",
                            errorText = if (templateVars[key].isNullOrBlank()) "Required by template" else null
                        )
                    }
                }
            }
        }

        SdTextField(
            value = title,
            onValueChange = { title = it },
            label = if (selectedTemplate != null) "TITLE OVERRIDE (LEAVE BLANK TO USE TEMPLATE TITLE)" else "TASK TITLE (REQUIRED)",
            placeholder = selectedTemplate?.title ?: "Task summary..."
        )

        SdTextField(
            value = description,
            onValueChange = { description = it },
            label = "DESCRIPTION",
            placeholder = selectedTemplate?.description ?: "Detailed instructions...",
            singleLine = false,
            minLines = 2
        )

        SdTextField(
            value = notes,
            onValueChange = { notes = it },
            label = "NOTES",
            placeholder = selectedTemplate?.notes ?: "Implementation notes..."
        )

        SdText(text = "LANE (AUTO-ASSIGNS MAPPED OWNER WHEN ASSIGNEE IS OMITTED)", style = SdTheme.typo.monoTag)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TaskLane.ALL.forEach { ln ->
                SdFilterChip(
                    label = ln.uppercase(),
                    selected = lane == ln,
                    onClick = { lane = ln }
                )
            }
        }

        SdText(
            text = "ASSIGNEE MODE (Mapped owner for '$lane': ${mappedLaneOwner ?: "none"})",
            style = SdTheme.typo.monoTag
        )
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            SdFilterChip(
                label = "OMIT (AUTO: ${mappedLaneOwner ?: "null"})",
                selected = assigneeMode == "auto",
                onClick = { assigneeMode = "auto" }
            )
            SdFilterChip(
                label = "EXPLICIT NULL (UNASSIGNED)",
                selected = assigneeMode == "null",
                onClick = { assigneeMode = "null" }
            )
            SdFilterChip(
                label = "EXPLICIT AGENT",
                selected = assigneeMode == "explicit",
                onClick = { assigneeMode = "explicit" }
            )
        }

        if (assigneeMode == "explicit") {
            SdTextField(
                value = explicitAssignee,
                onValueChange = { explicitAssignee = it },
                label = "ASSIGNEE AGENT NAME",
                placeholder = "e.g. nosmile99, nyx, luki"
            )
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
            value = labelsCsv,
            onValueChange = { labelsCsv = it },
            label = "LABELS (COMMA-SEPARATED, REGEX ^[a-z0-9_-]{1,32}$, REPLACES TEMPLATE LABELS)",
            placeholder = "e.g. android, rev5, bugfix",
            errorText = parsedLabelsResult.exceptionOrNull()?.message
        )

        SdTextField(
            value = dueDateInput,
            onValueChange = { dueDateInput = it },
            label = "DUE DATE (YYYY-MM-DD IN ASIA/JAKARTA OR EPOCH SECONDS, OPTIONAL)",
            placeholder = "e.g. 2026-11-05 or 1793811600"
        )

        val canSubmit = parsedLabelsResult.isSuccess &&
            missingPlaceholder == null &&
            (selectedTemplate != null || title.trim().isNotEmpty()) &&
            (assigneeMode != "explicit" || explicitAssignee.trim().isNotEmpty())

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            SdButton(
                label = "Create Task",
                enabled = canSubmit,
                onClick = {
                    val parsedDue = parseDueDateInput(dueDateInput)
                    val explicitLabels = if (labelsCsv.isBlank() && selectedTemplate != null) {
                        null
                    } else {
                        parsedLabelsResult.getOrNull()
                    }
                    controller.createTask(
                        projectId = project.id,
                        title = title.trim().takeIf { it.isNotEmpty() },
                        description = description.takeIf { it.isNotEmpty() },
                        notes = notes.takeIf { it.isNotEmpty() },
                        priority = priority,
                        assignee = if (assigneeMode == "explicit") explicitAssignee.trim() else null,
                        explicitNullAssignee = assigneeMode == "null",
                        lane = lane,
                        dueDate = parsedDue,
                        template = selectedTemplate?.name,
                        templateVars = if (selectedTemplate != null) templateVars else null,
                        labels = explicitLabels,
                        onCreated = { onDismiss() }
                    )
                }
            )
        }
    }
}

fun parseDueDateInput(raw: String): Long? {
    val clean = raw.trim()
    if (clean.isEmpty()) return null
    clean.toLongOrNull()?.let { return it }
    return try {
        val ld = LocalDate.parse(clean)
        ld.atStartOfDay(ZoneId.of("Asia/Jakarta")).toEpochSecond()
    } catch (_: Exception) {
        null
    }
}
