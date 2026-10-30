package com.agentbus.admin.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.agentbus.admin.state.AdminAppController
import com.agentbus.admin.state.AdminDestination
import com.agentbus.admin.ui.components.SdButton
import com.agentbus.admin.ui.components.SdButtonVariant
import com.agentbus.admin.ui.components.SdCard
import com.agentbus.admin.ui.components.SdFilterChip
import com.agentbus.admin.ui.components.SdModalDialog
import com.agentbus.admin.ui.components.SdTag
import com.agentbus.admin.ui.components.SdText
import com.agentbus.admin.ui.components.SdTextField
import com.agentbus.admin.ui.screens.AgentsScreen
import com.agentbus.admin.ui.screens.BoardScreen
import com.agentbus.admin.ui.screens.FeedScreen
import com.agentbus.admin.ui.screens.LoginScreen
import com.agentbus.admin.ui.screens.NeedsScreen
import com.agentbus.admin.ui.screens.OpsScreen
import com.agentbus.admin.ui.theme.SdTheme
import com.agentbus.admin.ui.theme.SignalDeskTheme
import kotlinx.coroutines.launch

@Composable
fun SignalDeskApp(controller: AdminAppController) {
    SignalDeskTheme(isDarkTheme = controller.isDarkTheme) {
        val colors = SdTheme.colors

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.bgCanvas)
        ) {
            if (!controller.isAuthenticated) {
                LoginScreen(controller = controller)
            } else {
                AuthenticatedDispatchShell(controller = controller)
            }

            // Global Overlays & Modals
            val wipWarn = controller.activeWipWarning
            if (wipWarn != null) {
                SdModalDialog(
                    title = "WIP Limit Warning",
                    onDismiss = { controller.activeWipWarning = null }
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SdText(
                            text = "Assignee '${wipWarn.assignee}' now has ${wipWarn.doingCount} tasks in 'doing', reaching or exceeding the configured WIP limit of ${wipWarn.limit}.",
                            style = SdTheme.typo.bodyPrimary,
                            color = colors.inkPrimary
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            SdTag(
                                text = "assignee: ${wipWarn.assignee}",
                                bgColor = colors.amberWarn,
                                textColor = colors.onAmberWarn,
                                borderColor = colors.amberWarn
                            )
                            SdTag(
                                text = "doing: ${wipWarn.doingCount} / limit: ${wipWarn.limit}",
                                bgColor = colors.amberWarn,
                                textColor = colors.onAmberWarn,
                                borderColor = colors.amberWarn
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End
                        ) {
                            SdButton(
                                label = "Acknowledge",
                                onClick = { controller.activeWipWarning = null },
                                variant = SdButtonVariant.PRIMARY
                            )
                        }
                    }
                }
            }

            val conflict = controller.activeLaneConflict
            if (conflict != null) {
                LaneConflictDialog(
                    controller = controller,
                    taskId = conflict.taskId,
                    requestedLane = conflict.requestedLane,
                    currentAssignee = conflict.current.assignee,
                    currentStatus = conflict.current.status,
                    currentLane = conflict.current.lane
                )
            }

            val secretNotice = controller.oneTimeSecretNotice
            if (secretNotice != null) {
                SdModalDialog(
                    title = if (secretNotice.isRotation) {
                        "Rotated Secret for '${secretNotice.agent}'"
                    } else {
                        "One-Time Secret for '${secretNotice.agent}'"
                    },
                    onDismiss = { controller.oneTimeSecretNotice = null }
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        SdText(
                            text = "Copy this agent secret now. It is returned once by the server and is never written to persistent storage.",
                            style = SdTheme.typo.bodyPrimary,
                            color = colors.amberWarn
                        )
                        SdCard(accentTopColor = colors.signalVermilion) {
                            SdText(
                                text = "Agent: ${secretNotice.agent}",
                                style = SdTheme.typo.monoTag,
                                color = colors.inkSecondary
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            SdText(
                                text = secretNotice.secret,
                                style = SdTheme.typo.monoCode,
                                fontWeight = FontWeight.Bold,
                                color = colors.signalVermilion
                            )
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End
                        ) {
                            SdButton(
                                label = "I Have Saved This Secret",
                                onClick = { controller.oneTimeSecretNotice = null },
                                variant = SdButtonVariant.PRIMARY
                            )
                        }
                    }
                }
            }

            val confirmReq = controller.pendingDestructiveConfirm
            if (confirmReq != null) {
                SdModalDialog(
                    title = confirmReq.title,
                    onDismiss = { controller.pendingDestructiveConfirm = null }
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        SdText(
                            text = confirmReq.detail,
                            style = SdTheme.typo.bodyPrimary,
                            color = colors.inkPrimary
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End
                        ) {
                            SdButton(
                                label = "Cancel",
                                onClick = { controller.pendingDestructiveConfirm = null },
                                variant = SdButtonVariant.GHOST
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            SdButton(
                                label = confirmReq.confirmButtonLabel,
                                onClick = { controller.executeDestructiveConfirm() },
                                variant = SdButtonVariant.DANGER
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SdHorizontalRule() {
    val colors = SdTheme.colors
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(colors.borderSubtle)
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LaneConflictDialog(
    controller: AdminAppController,
    taskId: Int,
    requestedLane: String,
    currentAssignee: String?,
    currentStatus: String?,
    currentLane: String?
) {
    val colors = SdTheme.colors
    val mappedOwner = controller.laneMappings.firstOrNull { it.lane == requestedLane }?.agent
    var selectedAssignee by remember(taskId, requestedLane) {
        mutableStateOf(mappedOwner ?: currentAssignee.orEmpty())
    }
    var unassignExplicitly by remember { mutableStateOf(false) }

    SdModalDialog(
        title = "409 Lane Change Conflict (Task #$taskId)",
        onDismiss = { controller.activeLaneConflict = null }
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SdText(
                text = "Moving an in-progress task to lane '$requestedLane' conflicts with its current assignee. Choose an explicit assignee to complete the lane change.",
                style = SdTheme.typo.bodyPrimary,
                color = colors.inkPrimary
            )
            SdCard(accentTopColor = colors.amberWarn) {
                SdText(
                    text = "Current state: status=${currentStatus ?: "doing"} | lane=${currentLane ?: "general"} | assignee=${currentAssignee ?: "none"}",
                    style = SdTheme.typo.monoTag,
                    color = colors.amberWarn
                )
            }
            SdTextField(
                value = if (unassignExplicitly) "" else selectedAssignee,
                onValueChange = {
                    unassignExplicitly = false
                    selectedAssignee = it
                },
                label = "Explicit Assignee for Lane '$requestedLane'",
                placeholder = mappedOwner ?: "agent-name"
            )
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (!mappedOwner.isNullOrBlank()) {
                    SdFilterChip(
                        label = "Lane Owner: $mappedOwner",
                        selected = !unassignExplicitly && selectedAssignee == mappedOwner,
                        onClick = {
                            unassignExplicitly = false
                            selectedAssignee = mappedOwner
                        }
                    )
                }
                if (!currentAssignee.isNullOrBlank()) {
                    SdFilterChip(
                        label = "Keep: $currentAssignee",
                        selected = !unassignExplicitly && selectedAssignee == currentAssignee,
                        onClick = {
                            unassignExplicitly = false
                            selectedAssignee = currentAssignee
                        }
                    )
                }
                controller.registeredAgents.forEach { agent ->
                    SdFilterChip(
                        label = agent.agent,
                        selected = !unassignExplicitly && selectedAssignee == agent.agent,
                        onClick = {
                            unassignExplicitly = false
                            selectedAssignee = agent.agent
                        }
                    )
                }
                SdFilterChip(
                    label = "Unassigned (null)",
                    selected = unassignExplicitly,
                    onClick = {
                        unassignExplicitly = true
                        selectedAssignee = ""
                    }
                )
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                SdButton(
                    label = "Cancel",
                    onClick = { controller.activeLaneConflict = null },
                    variant = SdButtonVariant.GHOST
                )
                Spacer(modifier = Modifier.width(8.dp))
                SdButton(
                    label = "Confirm Lane & Assignee",
                    onClick = {
                        val finalAssignee = if (unassignExplicitly) null else selectedAssignee.trim().ifEmpty { null }
                        controller.activeLaneConflict = null
                        controller.updateTask(
                            taskId = taskId,
                            lane = requestedLane,
                            assignee = finalAssignee,
                            includeAssignee = true
                        )
                    },
                    variant = SdButtonVariant.PRIMARY
                )
            }
        }
    }
}

@Composable
private fun AuthenticatedDispatchShell(controller: AdminAppController) {
    val colors = SdTheme.colors

    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        val screenWidthDp = maxWidth.value.toInt()
        val isWideLayout = maxWidth >= 600.dp

        Column(modifier = Modifier.fillMaxSize()) {
            // Top Dispatch Ledger Header
            TopDispatchHeader(controller = controller)
            SdHorizontalRule()

            // Optional Status / Error Banners
            val errBanner = controller.errorBanner
            if (errBanner != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.bgSubtle)
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    SdText(
                        text = errBanner,
                        style = SdTheme.typo.bodyPrimary,
                        fontWeight = FontWeight.Bold,
                        color = colors.dangerCrimson,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    SdButton(
                        label = "Dismiss",
                        onClick = { controller.dismissBanners() },
                        variant = SdButtonVariant.DANGER,
                        compact = true
                    )
                }
                SdHorizontalRule()
            }

            val statBanner = controller.statusBanner
            if (statBanner != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(colors.bgSubtle)
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    SdText(
                        text = statBanner,
                        style = SdTheme.typo.bodyPrimary,
                        fontWeight = FontWeight.SemiBold,
                        color = colors.cobaltInk,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    SdButton(
                        label = "Dismiss",
                        onClick = { controller.dismissBanners() },
                        variant = SdButtonVariant.SECONDARY,
                        compact = true
                    )
                }
                SdHorizontalRule()
            }

            if (isWideLayout) {
                Row(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                ) {
                    LeftNavigationRail(
                        current = controller.currentDestination,
                        needsCount = controller.needsTasks.size,
                        onSelect = { controller.navigateTo(it) }
                    )
                    Box(
                        modifier = Modifier
                            .width(1.dp)
                            .fillMaxHeight()
                            .background(colors.borderSubtle)
                    )
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                    ) {
                        DestinationViewport(
                            controller = controller,
                            screenWidthDp = screenWidthDp
                        )
                    }
                }
            } else {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                ) {
                    DestinationViewport(
                        controller = controller,
                        screenWidthDp = screenWidthDp
                    )
                }
                SdHorizontalRule()
                BottomNavigationBar(
                    current = controller.currentDestination,
                    needsCount = controller.needsTasks.size,
                    onSelect = { controller.navigateTo(it) }
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TopDispatchHeader(controller: AdminAppController) {
    val colors = SdTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.bgSurface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdTag(
                    text = "SIGNAL DESK",
                    bgColor = colors.signalVermilion,
                    textColor = colors.onSignalVermilion,
                    borderColor = colors.signalVermilion
                )
                SdText(
                    text = "${controller.loginUsername}@${controller.baseUrl.removePrefix("https://").removePrefix("http://")}",
                    style = SdTheme.typo.monoTag,
                    color = colors.inkPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(modifier = Modifier.height(2.dp))
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                SdText(
                    text = "poll ${controller.pollCursor.sinceTs}:${controller.pollCursor.sinceId}",
                    style = SdTheme.typo.monoTag,
                    color = colors.inkSecondary
                )
                val st = controller.stats
                if (st != null) {
                    SdText(
                        text = "today:${st.messagesToday} | total:${st.totalMessages} | agents:${st.registeredAgents}",
                        style = SdTheme.typo.monoTag,
                        color = colors.inkSecondary
                    )
                }
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            SdButton(
                label = if (controller.isDarkTheme) "Light" else "Dark",
                onClick = { controller.toggleTheme() },
                variant = SdButtonVariant.SECONDARY,
                compact = true
            )
            SdButton(
                label = "Sync",
                onClick = {
                    controller.scope.launch {
                        controller.fullReload(preserveFeedScroll = true)
                    }
                },
                variant = SdButtonVariant.SECONDARY,
                compact = true
            )
        }
    }
}

@Composable
private fun DestinationViewport(controller: AdminAppController, screenWidthDp: Int) {
    when (controller.currentDestination) {
        AdminDestination.FEED -> FeedScreen(controller = controller)
        AdminDestination.BOARD -> BoardScreen(controller = controller, screenWidthDp = screenWidthDp)
        AdminDestination.NEEDS -> NeedsScreen(controller = controller)
        AdminDestination.AGENTS -> AgentsScreen(controller = controller)
        AdminDestination.OPS -> OpsScreen(controller = controller)
    }
}

@Composable
private fun LeftNavigationRail(
    current: AdminDestination,
    needsCount: Int,
    onSelect: (AdminDestination) -> Unit
) {
    val colors = SdTheme.colors
    Column(
        modifier = Modifier
            .width(124.dp)
            .fillMaxHeight()
            .background(colors.bgSurface)
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        AdminDestination.entries.forEach { dest ->
            val labelText = if (dest == AdminDestination.NEEDS && needsCount > 0) {
                "${dest.code} ${dest.label} ($needsCount)"
            } else {
                "${dest.code} ${dest.label}"
            }
            NavDestinationItem(
                label = labelText,
                selected = current == dest,
                onClick = { onSelect(dest) },
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun BottomNavigationBar(
    current: AdminDestination,
    needsCount: Int,
    onSelect: (AdminDestination) -> Unit
) {
    val colors = SdTheme.colors
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(colors.bgSurface)
            .padding(horizontal = 6.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        AdminDestination.entries.forEach { dest ->
            val badgeSuffix = if (dest == AdminDestination.NEEDS && needsCount > 0) " ($needsCount)" else ""
            NavDestinationItem(
                label = "${dest.code} ${dest.label}$badgeSuffix",
                selected = current == dest,
                onClick = { onSelect(dest) },
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@Composable
private fun NavDestinationItem(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val colors = SdTheme.colors
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()
    val shape = RoundedCornerShape(4.dp)

    val bg = if (selected) colors.signalVermilion else colors.bgSubtle
    val fg = if (selected) colors.onSignalVermilion else colors.inkPrimary
    val border = when {
        isFocused -> colors.cobaltInk
        selected -> colors.signalVermilion
        else -> colors.borderStrong
    }

    Box(
        modifier = modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .background(bg, shape)
            .border(if (isFocused) 2.dp else 1.dp, border, shape)
            .focusable(interactionSource = interactionSource)
            .onKeyEvent { event ->
                if (event.type == KeyEventType.KeyDown &&
                    (event.key == Key.Enter || event.key == Key.Spacebar)
                ) {
                    onClick()
                    true
                } else {
                    false
                }
            }
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                role = Role.Tab,
                onClick = onClick
            )
            .padding(horizontal = 6.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        SdText(
            text = label,
            style = SdTheme.typo.monoTag,
            fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
            color = fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}
