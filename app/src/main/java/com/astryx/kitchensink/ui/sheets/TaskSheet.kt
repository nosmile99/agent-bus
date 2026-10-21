package com.astryx.kitchensink.ui.sheets

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.astryx.kitchensink.theme.Op01Radius
import com.astryx.kitchensink.theme.Op01Theme
import com.astryx.kitchensink.ui.components.AgentChip
import com.astryx.kitchensink.ui.components.CautionHeader
import com.astryx.kitchensink.ui.components.FieldLabel
import com.astryx.kitchensink.ui.components.HwButton
import com.astryx.kitchensink.ui.components.HwButtonStyle
import com.astryx.kitchensink.ui.components.HwInset
import com.astryx.kitchensink.ui.components.HwSelect
import com.astryx.kitchensink.ui.components.HwText
import com.astryx.kitchensink.ui.components.HwTextField
import com.astryx.kitchensink.ui.components.Op01Badge
import com.astryx.kitchensink.ui.components.Op01Motion
import com.astryx.kitchensink.ui.components.animateOp01Color
import com.astryx.kitchensink.ui.components.QuietBadge
import com.astryx.kitchensink.ui.components.StatusStrip
import com.astryx.kitchensink.ui.components.hardShadow
import com.astryx.kitchensink.ui.state.Agents
import com.astryx.kitchensink.ui.state.BusTask
import com.astryx.kitchensink.ui.state.ChecklistItem
import com.astryx.kitchensink.ui.state.Op01State
import com.astryx.kitchensink.ui.state.TaskComment
import com.astryx.kitchensink.ui.state.TaskStatus
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val dueOptions = listOf("No due date", "Today", "Tomorrow", "This week", "Next week")

/**
 * Task detail sheet: 24dp top radius, ~94% height, charcoal header.
 * Title / summary / notes are DRAFT fields — they persist on Save or Close.
 * Status, assignee, priority, due, and the checklist apply immediately,
 * mirroring the web prototype.
 */
@Composable
fun TaskSheet(
    task: BusTask,
    state: Op01State,
    onClose: () -> Unit,
    onToast: (String) -> Unit,
) {
    val colors = Op01Theme.colors
    var draftTitle by remember(task.id) { mutableStateOf(task.title) }
    var draftSummary by remember(task.id) { mutableStateOf(task.summary) }
    var draftNotes by remember(task.id) { mutableStateOf(task.notes) }
    var commentDraft by remember(task.id) { mutableStateOf("") }
    var confirmDelete by remember(task.id) { mutableStateOf(false) }

    // The sheet owns its visibility so the exit slide plays before the host
    // uncomposes it: dismiss() flips the flag, then closes after the travel.
    val scope = rememberCoroutineScope()
    var sheetVisible by remember(task.id) { mutableStateOf(false) }
    LaunchedEffect(task.id) { sheetVisible = true }

    fun persistDrafts() {
        state.updateTask(task.id) {
            it.copy(
                title = draftTitle.trim().ifEmpty { it.title },
                summary = draftSummary,
                notes = draftNotes,
            )
        }
    }

    fun dismiss(after: () -> Unit = {}) {
        if (!sheetVisible) return
        sheetVisible = false
        scope.launch {
            delay(300)
            after()
            onClose()
        }
    }

    Box(Modifier.fillMaxSize()) {
        // Scrim
        AnimatedVisibility(
            visible = sheetVisible,
            enter = fadeIn(Op01Motion.medium()),
            exit = fadeOut(Op01Motion.medium()),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color(0xFF161615).copy(alpha = 0.55f))
                    .clickable {
                        persistDrafts()
                        dismiss()
                    },
            )
        }
        // Panel
        AnimatedVisibility(
            visible = sheetVisible,
            modifier = Modifier.align(Alignment.BottomCenter),
            enter = slideInVertically(Op01Motion.snap()) { it } + fadeIn(Op01Motion.fast()),
            exit = slideOutVertically(Op01Motion.snap()) { it } + fadeOut(Op01Motion.fast()),
        ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxSize(0.94f)
                .background(
                    colors.card,
                    RoundedCornerShape(topStart = Op01Radius.xxl, topEnd = Op01Radius.xxl),
                )
                .border(
                    2.dp, colors.borderHardware,
                    RoundedCornerShape(topStart = Op01Radius.xxl, topEnd = Op01Radius.xxl),
                ),
        ) {
            // Charcoal header
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        colors.charcoal,
                        RoundedCornerShape(topStart = Op01Radius.xxl, topEnd = Op01Radius.xxl),
                    )
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Op01Badge("Task #${task.num}", colors.charcoalText.copy(alpha = 0.16f), colors.charcoalText)
                Column(Modifier.weight(1f)) {
                    HwText(task.project, Op01Theme.type.labelLg, colors.charcoalText, maxLines = 1)
                    HwText(
                        "Status: ${task.status.label}", Op01Theme.type.bodySm,
                        colors.charcoalText.copy(alpha = 0.75f), maxLines = 1,
                    )
                }
                if (task.status != TaskStatus.Done) {
                    HwButton(
                        "Mark done",
                        onClick = {
                            state.setStatus(task, TaskStatus.Done)
                            onToast("Marked done — Task #${task.num}.")
                        },
                        style = HwButtonStyle.Positive,
                    )
                }
                HwButton(
                    "Delete",
                    onClick = { confirmDelete = true },
                    style = HwButtonStyle.Danger,
                )
                HwButton(
                    "✕",
                    onClick = {
                        persistDrafts()
                        dismiss()
                    },
                    style = HwButtonStyle.Secondary,
                )
            }
            CautionHeader(task, Modifier.fillMaxWidth())

            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // Basics
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    HwTextField(
                        value = draftTitle,
                        onValueChange = { draftTitle = it },
                        label = "Title",
                        singleLine = false,
                    )
                    HwTextField(
                        value = draftSummary,
                        onValueChange = { draftSummary = it },
                        label = "Summary",
                        placeholder = "What is this task, in one breath?",
                        singleLine = false,
                        minLines = 2,
                    )
                    FieldLabel("Status")
                    StatusStrip(
                        current = task.status,
                        onSelect = { next ->
                            state.setStatus(task, next)
                            if (next != task.status) {
                                onToast("Task #${task.num} → ${next.label}.")
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                // Assignment
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    HwSelect(
                        label = "Assignee",
                        value = Agents.byKey(task.assignee).handle,
                        options = Agents.all.map { it.handle },
                        onSelect = { handle ->
                            val key = Agents.all.first { it.handle == handle }.key
                            state.updateTask(task.id) { it.copy(assignee = key) }
                            onToast("Reassigned — Task #${task.num} → $handle.")
                        },
                    )
                    HwSelect(
                        label = "Priority",
                        value = task.priority,
                        options = listOf("Low", "Normal", "High", "Urgent"),
                        onSelect = { priority ->
                            state.updateTask(task.id) { it.copy(priority = priority) }
                        },
                    )
                    FieldLabel("Due")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        dueOptions.forEach { option ->
                            val selected = task.due == option
                            val animBg by animateOp01Color(if (selected) colors.ink else colors.recessed, "due-bg")
                            val animFg by animateOp01Color(if (selected) colors.paper else colors.secondary, "due-fg")
                            val animBorder by animateOp01Color(if (selected) colors.borderHardware else colors.borderInset, "due-border")
                            val animShadow by animateDpAsState(
                                if (selected) 2.dp else 0.dp,
                                Op01Motion.fast(), label = "due-shadow",
                            )
                            val shape = RoundedCornerShape(Op01Radius.md)
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .hardShadow(Op01Radius.md, animShadow, colors.shadow)
                                    .background(animBg, shape)
                                    .border(1.5.dp, animBorder, shape)
                                    .clickable {
                                        state.updateTask(task.id) { it.copy(due = option) }
                                    }
                                    .heightIn(min = 44.dp)
                                    .padding(horizontal = 8.dp, vertical = 8.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                HwText(
                                    option, Op01Theme.type.labelMd,
                                    animFg,
                                    maxLines = 1,
                                )
                            }
                        }
                    }
                    if (task.labels.isNotEmpty()) {
                        FieldLabel("Labels")
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            task.labels.forEach { label -> QuietBadge(label) }
                        }
                    }
                }
                // Checklist
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FieldLabel("Checklist — ${task.todosDone}/${task.todosTotal}")
                    task.checklist.forEachIndexed { index, item ->
                        ChecklistRow(
                            item = item,
                            onToggle = {
                                state.updateTask(task.id) { current ->
                                    current.copy(
                                        checklist = current.checklist.mapIndexed { i, entry ->
                                            if (i == index) entry.copy(done = !entry.done) else entry
                                        },
                                    )
                                }
                            },
                        )
                    }
                }
                // Notes
                HwTextField(
                    value = draftNotes,
                    onValueChange = { draftNotes = it },
                    label = "Notes (mono)",
                    mono = true,
                    singleLine = false,
                    minLines = 3,
                )
                // Discussion
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FieldLabel("Discussion")
                    task.comments.forEach { comment ->
                        Column {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                AgentChip(comment.agent)
                                HwText(comment.time, Op01Theme.type.labelMd, colors.secondary)
                            }
                            HwText(
                                comment.text, Op01Theme.type.bodyMd, colors.ink,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                    HwTextField(
                        value = commentDraft,
                        onValueChange = { commentDraft = it },
                        placeholder = "Add a comment as @luki…",
                        singleLine = false,
                        minLines = 2,
                    )
                    HwButton(
                        "Comment",
                        onClick = {
                            val text = commentDraft.trim()
                            if (text.isEmpty()) {
                                onToast("Write the comment first.")
                            } else {
                                state.updateTask(task.id) {
                                    it.copy(
                                        comments = it.comments + TaskComment("luki", "now", text),
                                    )
                                }
                                commentDraft = ""
                                onToast("Comment added.")
                            }
                        },
                        style = HwButtonStyle.Primary,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                // Activity
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FieldLabel("Activity")
                    HwInset(Modifier.fillMaxWidth(), contentPadding = 10.dp) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            task.activity.forEach { line ->
                                HwText(line, Op01Theme.type.monoCode, colors.secondary)
                            }
                        }
                    }
                }
                // Save bar
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HwButton(
                        "Close",
                        onClick = {
                            persistDrafts()
                            dismiss()
                        },
                        style = HwButtonStyle.Secondary,
                        modifier = Modifier.weight(1f),
                    )
                    HwButton(
                        "Save changes",
                        onClick = {
                            persistDrafts()
                            onToast("Saved — Task #${task.num}.")
                            dismiss()
                        },
                        style = HwButtonStyle.Primary,
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
        }

        DeleteConfirm(
            visible = confirmDelete,
            taskNum = task.num,
            onCancel = { confirmDelete = false },
            onConfirm = {
                confirmDelete = false
                onToast("Deleted — Task #${task.num} is gone.")
                dismiss { state.removeTask(task.id) }
            },
        )
    }
}

@Composable
private fun ChecklistRow(item: ChecklistItem, onToggle: () -> Unit) {
    val colors = Op01Theme.colors
    val boxBg by animateOp01Color(if (item.done) colors.forest else colors.card, "check-bg")
    val textColor by animateOp01Color(if (item.done) colors.secondary else colors.ink, "check-text")
    val checkScale by animateFloatAsState(
        targetValue = if (item.done) 1f else 0.4f,
        animationSpec = Op01Motion.snap(),
        label = "check-scale",
    )
    val checkAlpha by animateFloatAsState(
        targetValue = if (item.done) 1f else 0f,
        animationSpec = Op01Motion.fast(),
        label = "check-alpha",
    )
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onToggle() }
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(26.dp)
                .background(boxBg, RoundedCornerShape(Op01Radius.sm))
                .border(1.5.dp, colors.borderHardware, RoundedCornerShape(Op01Radius.sm)),
            contentAlignment = Alignment.Center,
        ) {
            HwText(
                "✓", Op01Theme.type.labelLg, Color.White,
                modifier = Modifier.graphicsLayer {
                    scaleX = checkScale
                    scaleY = checkScale
                    alpha = checkAlpha
                },
            )
        }
        HwText(
            item.text, Op01Theme.type.bodyMd,
            textColor,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun DeleteConfirm(
    visible: Boolean,
    taskNum: Int,
    onCancel: () -> Unit,
    onConfirm: () -> Unit,
) {
    val colors = Op01Theme.colors
    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(Op01Motion.fast()) +
            slideInVertically(Op01Motion.snap()) { it / 3 },
        exit = fadeOut(Op01Motion.fast()) +
            slideOutVertically(Op01Motion.snap()) { it / 3 },
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF161615).copy(alpha = 0.55f))
                .clickable { onCancel() },
            contentAlignment = Alignment.BottomCenter,
        ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp)
                .background(
                    colors.card,
                    RoundedCornerShape(topStart = Op01Radius.xxl, topEnd = Op01Radius.xxl, bottomStart = Op01Radius.xxl, bottomEnd = Op01Radius.xxl),
                )
                .border(
                    2.dp, colors.borderHardware,
                    RoundedCornerShape(Op01Radius.xxl),
                )
                .padding(16.dp),
        ) {
            HwText("Delete Task #$taskNum?", Op01Theme.type.headlineMd, colors.ink)
            HwText(
                "This removes the task from the board for everyone. There is no undo — if it matters, mark it done instead.",
                Op01Theme.type.bodyMd, colors.secondary,
                modifier = Modifier.padding(top = 6.dp),
            )
            Row(
                modifier = Modifier.padding(top = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                HwButton("Keep task", onCancel, HwButtonStyle.Secondary, Modifier.weight(1f))
                HwButton("Delete it", onConfirm, HwButtonStyle.Danger, Modifier.weight(1f))
            }
        }
        }
    }
}
