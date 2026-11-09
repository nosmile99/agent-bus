package com.agentbus.admin.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.agentbus.admin.model.TaskLane
import com.agentbus.admin.model.TaskPriority
import com.agentbus.admin.model.ValidationRules
import com.agentbus.admin.state.AdminAppController
import com.agentbus.admin.ui.components.*
import com.agentbus.admin.ui.theme.SdTheme
import kotlinx.coroutines.launch

@Composable
fun OpsScreen(controller: AdminAppController) {
    val colors = SdTheme.colors
    val scope = rememberCoroutineScope()

    var wipInput by remember(controller.wipLimit) {
        mutableStateOf(controller.wipLimit?.toString() ?: "")
    }
    var mapAgentInput by remember { mutableStateOf("") }
    var mapLaneInput by remember { mutableStateOf(TaskLane.BACKEND) }

    // Template creation state
    var tplName by remember { mutableStateOf("") }
    var tplTitle by remember { mutableStateOf("") }
    var tplDesc by remember { mutableStateOf("") }
    var tplNotes by remember { mutableStateOf("") }
    var tplPriority by remember { mutableStateOf(TaskPriority.NORMAL) }
    var tplLane by remember { mutableStateOf(TaskLane.BACKEND) }
    var tplLabelsCsv by remember { mutableStateOf("") }

    // Password change state
    var newAdminUser by remember(controller.loginUsername) { mutableStateOf(controller.loginUsername) }
    var newAdminPass by remember { mutableStateOf("") }

    // Endpoint & Export/Import state
    var endpointUrl by remember(controller.baseUrl) { mutableStateOf(controller.baseUrl) }
    var adminTokenInput by remember(controller.adminToken) { mutableStateOf(controller.adminToken) }
    var importJsonInput by remember(controller.exportedJson) { mutableStateOf(controller.exportedJson) }
    var autoRegMissingSenders by remember { mutableStateOf(true) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Section 12: WIP Configuration & Lane Mapping
        SdSectionHeader(
            indexCode = "SEC-12",
            title = "WIP Limit & Lane Mapping",
            subtitle = "Configure per-assignee doing WIP warning threshold and auto-assignment lane owners."
        )

        SdCard(padding = 12.dp) {
            SdText(
                text = "WIP DOING LIMIT (GET / PUT /admin/api/kanban/wip)",
                style = SdTheme.typo.monoTag
            )
            SdText(
                text = "Current per_assignee_doing_limit: ${controller.wipLimit ?: "null (disabled)"}. When a task moves to 'doing' and the assignee's active doing count reaches or exceeds this limit, the backend returns wip_warning and the app displays an alert without blocking.",
                style = SdTheme.typo.bodySecondary
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = wipInput,
                    onValueChange = { wipInput = it.filter { c -> c.isDigit() } },
                    label = "DOING LIMIT (POSITIVE INTEGER, OR EMPTY FOR NULL)",
                    placeholder = "e.g. 2",
                    modifier = Modifier.weight(1f)
                )
                SdButton(
                    label = "Save WIP Limit",
                    onClick = {
                        val parsed = wipInput.trim().takeIf { it.isNotEmpty() }?.toIntOrNull()
                        controller.saveWipLimit(parsed)
                    },
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }
        }

        SdCard(padding = 12.dp) {
            SdText(
                text = "LANE MAPPING (GET / PUT /admin/api/kanban/lane-mapping)",
                style = SdTheme.typo.monoTag
            )
            if (controller.laneMappings.isEmpty()) {
                SdText(text = "No lane mappings loaded.", style = SdTheme.typo.bodySecondary)
            } else {
                controller.laneMappings.forEach { lm ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            SdText(text = lm.agent, style = SdTheme.typo.cardTitle)
                            SdLaneTag(lane = lm.lane)
                            SdText(
                                text = "by ${lm.setBy} @ ${SdTimeFormatter.formatEpochSecWib(lm.setAt)}",
                                style = SdTheme.typo.monoCode,
                                color = colors.inkMuted
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TaskLane.ALL.forEach { targetLane ->
                                if (targetLane != lm.lane) {
                                    SdButton(
                                        label = "-> $targetLane",
                                        onClick = { controller.saveLaneMapping(lm.agent, targetLane) },
                                        variant = SdButtonVariant.SECONDARY,
                                        compact = true
                                    )
                                }
                            }
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = mapAgentInput,
                    onValueChange = { mapAgentInput = it },
                    label = "AGENT (REGISTERED OR 'luki')",
                    placeholder = "e.g. nosmile99, nyx, luki",
                    modifier = Modifier.weight(1f)
                )
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SdText(text = "LANE", style = SdTheme.typo.monoTag)
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        TaskLane.ALL.forEach { ln ->
                            SdFilterChip(
                                label = ln.uppercase(),
                                selected = mapLaneInput == ln,
                                onClick = { mapLaneInput = ln }
                            )
                        }
                    }
                }
                SdButton(
                    label = "Update Mapping",
                    enabled = mapAgentInput.trim().isNotEmpty(),
                    onClick = {
                        controller.saveLaneMapping(mapAgentInput.trim(), mapLaneInput)
                        mapAgentInput = ""
                    },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
            }
        }

        // Section 13: Task Templates
        SdSectionHeader(
            indexCode = "SEC-13",
            title = "Task Templates",
            subtitle = "GET / POST /admin/api/kanban/templates (templates have no edit or delete endpoint in v1 API)."
        )

        SdCard(padding = 12.dp) {
            if (controller.templates.isNotEmpty()) {
                controller.templates.forEach { tpl ->
                    SdCard(padding = 8.dp) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            SdText(text = "#${tpl.id} ${tpl.name}", style = SdTheme.typo.cardTitle)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                SdLaneTag(lane = tpl.lane)
                                SdPriorityTag(priority = tpl.priority)
                            }
                        }
                        SdText(
                            text = "Title pattern: ${tpl.title}  |  Labels: ${tpl.labels.joinToString(", ").ifEmpty { "none" }}",
                            style = SdTheme.typo.monoCode
                        )
                    }
                }
            }

            SdText(text = "CREATE NEW TEMPLATE", style = SdTheme.typo.monoTag)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SdTextField(
                    value = tplName,
                    onValueChange = { tplName = it },
                    label = "TEMPLATE NAME",
                    placeholder = "e.g. android-hotfix",
                    modifier = Modifier.weight(1f)
                )
                SdTextField(
                    value = tplTitle,
                    onValueChange = { tplTitle = it },
                    label = "TITLE PATTERN (SUPPORTS {placeholder})",
                    placeholder = "e.g. [hotfix] {issue}",
                    modifier = Modifier.weight(1f)
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SdTextField(
                    value = tplDesc,
                    onValueChange = { tplDesc = it },
                    label = "DESCRIPTION PATTERN",
                    placeholder = "Optional...",
                    modifier = Modifier.weight(1f)
                )
                SdTextField(
                    value = tplNotes,
                    onValueChange = { tplNotes = it },
                    label = "NOTES PATTERN",
                    placeholder = "Optional...",
                    modifier = Modifier.weight(1f)
                )
            }
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdText(text = "LANE:", style = SdTheme.typo.monoTag)
                TaskLane.ALL.forEach { ln ->
                    SdFilterChip(
                        label = ln.uppercase(),
                        selected = tplLane == ln,
                        onClick = { tplLane = ln }
                    )
                }
                Spacer(modifier = Modifier.width(8.dp))
                SdText(text = "PRIORITY:", style = SdTheme.typo.monoTag)
                TaskPriority.ALL.forEach { pri ->
                    SdFilterChip(
                        label = pri.uppercase(),
                        selected = tplPriority == pri,
                        onClick = { tplPriority = pri }
                    )
                }
            }
            val tplLabelsResult = remember(tplLabelsCsv) {
                val list = tplLabelsCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                ValidationRules.normalizeAndValidateLabels(list)
            }
            SdTextField(
                value = tplLabelsCsv,
                onValueChange = { tplLabelsCsv = it },
                label = "DEFAULT LABELS (COMMA-SEPARATED, REGEX ^[a-z0-9_-]{1,32}$)",
                placeholder = "e.g. android, hotfix",
                errorText = tplLabelsResult.exceptionOrNull()?.message
            )
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                SdButton(
                    label = "Create Template",
                    enabled = tplName.trim().isNotEmpty() && tplTitle.trim().isNotEmpty() && tplLabelsResult.isSuccess,
                    onClick = {
                        controller.createTaskTemplate(
                            name = tplName.trim(),
                            title = tplTitle.trim(),
                            description = tplDesc,
                            notes = tplNotes,
                            priority = tplPriority,
                            lane = tplLane,
                            labels = tplLabelsResult.getOrDefault(emptyList())
                        ) {
                            tplName = ""
                            tplTitle = ""
                            tplDesc = ""
                            tplNotes = ""
                            tplLabelsCsv = ""
                        }
                    },
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }
        }

        // Section 1: Admin Password & Session Controls
        SdSectionHeader(
            indexCode = "SEC-01",
            title = "Admin Credentials & Server Endpoint",
            subtitle = "POST /admin/api/password (min 12 chars). Changing password invalidates old credentials and requires re-login."
        )

        SdCard(padding = 12.dp) {
            SdTextField(
                value = newAdminUser,
                onValueChange = { newAdminUser = it },
                label = "TARGET ADMIN USERNAME (LEAVE CURRENT TO KEEP '${controller.loginUsername}')",
                placeholder = controller.loginUsername
            )
            val passLen = newAdminPass.length
            SdTextField(
                value = newAdminPass,
                onValueChange = { newAdminPass = it },
                label = "NEW PASSWORD ($passLen CHARS, MIN 12 REQUIRED)",
                placeholder = "At least 12 characters...",
                isPassword = true,
                errorText = if (newAdminPass.isNotEmpty() && passLen < 12) {
                    "Password must be at least 12 characters (currently $passLen)"
                } else null
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                SdButton(
                    label = "Sign Out (Clear Saved Credentials)",
                    onClick = { controller.logout() },
                    variant = SdButtonVariant.DANGER,
                    compact = true
                )
                SdButton(
                    label = "Update Admin Password",
                    enabled = ValidationRules.isValidPassword(newAdminPass),
                    onClick = {
                        controller.changeAdminPassword(newAdminUser, newAdminPass) {
                            newAdminPass = ""
                        }
                    },
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }
        }

        // Live Poll Cursor & Server URL Switcher
        SdCard(padding = 12.dp) {
            SdText(
                text = "DURABLE POLL CURSOR & ENDPOINT URL",
                style = SdTheme.typo.monoTag
            )
            SdText(
                text = "Composite Poll Cursor: since_ts=${controller.pollCursor.sinceTs}, since_id=${controller.pollCursor.sinceId}  |  resync_required=${controller.lastPollResyncRequired}  |  Live events processed: ${controller.liveEventsCount}  |  Feed Anchor Message ID: #${controller.feedPersistence.anchorMessageId ?: "top"}",
                style = SdTheme.typo.monoCode
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = endpointUrl,
                    onValueChange = { endpointUrl = it },
                    label = "SERVER BASE URL (FEED ANCHOR PERSISTS ACROSS URL CHANGES)",
                    modifier = Modifier.weight(1f)
                )
                SdButton(
                    label = "Switch URL",
                    onClick = { controller.changeEndpointUrl(endpointUrl) },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
                SdButton(
                    label = "Poll Now",
                    onClick = { scope.launch { controller.pollOnce() } },
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
            }
        }

        // Section 4: Export & Import Bus Data
        SdSectionHeader(
            indexCode = "SEC-04",
            title = "Bus Export & Import (/admin/export & /admin/import)",
            subtitle = "Note: Backend POST /admin/import ignores payload.agents and rejects messages from unregistered senders (400 unknown sender)."
        )

        SdCard(padding = 12.dp) {
            SdTextField(
                value = adminTokenInput,
                onValueChange = { adminTokenInput = it },
                label = "X-ADMIN-TOKEN HEADER (BUS_ADMIN_TOKEN)",
                placeholder = "Required by backend checkAdmin() on /admin/export and /admin/import",
                isPassword = true
            )
            SdCheckboxRow(
                checked = autoRegMissingSenders,
                label = "Pre-register any missing message senders (e.g. 'luki') before POST /admin/import so round-trip import does not fail with 400 unknown sender",
                onCheckedChange = { autoRegMissingSenders = it }
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SdButton(
                    label = "Export Bus Data",
                    onClick = { controller.runExport(adminTokenInput) },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
                SdButton(
                    label = "Import Bus Data",
                    enabled = importJsonInput.trim().isNotEmpty(),
                    onClick = {
                        controller.runImport(
                            rawJson = importJsonInput.trim(),
                            tokenInput = adminTokenInput,
                            registerMissingSendersFirst = autoRegMissingSenders
                        )
                    },
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }
            SdTextField(
                value = importJsonInput,
                onValueChange = { importJsonInput = it },
                label = "EXPORT / IMPORT JSON PAYLOAD ({messages, agents})",
                placeholder = "{\"messages\":[],\"agents\":[]}",
                singleLine = false,
                minLines = 4
            )
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}
