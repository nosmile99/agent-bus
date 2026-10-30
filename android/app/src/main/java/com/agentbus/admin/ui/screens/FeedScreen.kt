package com.agentbus.admin.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.agentbus.admin.model.*
import com.agentbus.admin.state.AdminAppController
import com.agentbus.admin.ui.components.*
import com.agentbus.admin.ui.theme.SdTheme
import kotlinx.coroutines.launch

@Composable
fun FeedScreen(controller: AdminAppController) {
    val colors = SdTheme.colors
    val scope = rememberCoroutineScope()
    val persistence = controller.feedPersistence

    val listState = rememberLazyListState(
        initialFirstVisibleItemIndex = persistence.firstVisibleItemIndex,
        initialFirstVisibleItemScrollOffset = persistence.firstVisibleItemScrollOffset
    )

    // Save Feed anchor/cursor persistently whenever scroll settles or changes (SPEC section 4 & 15)
    LaunchedEffect(
        listState.firstVisibleItemIndex,
        listState.firstVisibleItemScrollOffset,
        controller.messages
    ) {
        val idx = listState.firstVisibleItemIndex
        val offset = listState.firstVisibleItemScrollOffset
        val anchorId = controller.messages.getOrNull(idx)?.id
        controller.updateFeedScrollPosition(idx, offset, anchorId)
    }

    var showComposeModal by remember { mutableStateOf(false) }
    var showChannelsModal by remember { mutableStateOf(false) }
    var searchInput by remember(persistence.searchQuery) { mutableStateOf(persistence.searchQuery) }
    var sinceIdInput by remember { mutableStateOf("") }
    var limitInput by remember { mutableStateOf("50") }

    // Open compose automatically if user clicked Reply on a message
    LaunchedEffect(controller.replyTargetMessage) {
        if (controller.replyTargetMessage != null) {
            showComposeModal = true
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Section 2: Overview Stats Strip + Actions
        SdCard(padding = 10.dp) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val st = controller.stats
                Column(modifier = Modifier.weight(1f)) {
                    SdText(
                        text = if (st != null) {
                            "TODAY (SINCE 00:00 UTC / 07:00 WIB): ${st.messagesToday}   |   TOTAL: ${st.totalMessages}   |   AGENTS: ${st.registeredAgents}   |   DO: ${st.doStatus.uppercase()}"
                        } else {
                            "Fetching live overview metrics from /admin/api/stats..."
                        },
                        style = SdTheme.typo.monoTag,
                        color = colors.inkPrimary
                    )
                    if (st != null && st.perChannel.isNotEmpty()) {
                        val topChannels = st.perChannel.joinToString("  ") { "${it.channel}:${it.count}" }
                        SdText(
                            text = "PER CHANNEL: $topChannels",
                            style = SdTheme.typo.monoCode,
                            color = colors.inkSecondary,
                            maxLines = 1
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    SdButton(
                        label = "Channels (${controller.channels.size})",
                        onClick = { showChannelsModal = true },
                        variant = SdButtonVariant.SECONDARY,
                        compact = true
                    )
                    SdButton(
                        label = "New Message",
                        onClick = {
                            controller.replyTargetMessage = null
                            showComposeModal = true
                        },
                        variant = SdButtonVariant.PRIMARY,
                        compact = true
                    )
                }
            }
        }

        // Section 4: Filter & Search Strip
        SdCard(padding = 10.dp) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdText(text = "CH:", style = SdTheme.typo.monoTag)
                SdFilterChip(
                    label = "ALL",
                    selected = persistence.channelFilter == null,
                    onClick = { controller.updateFeedFilters(channel = null) }
                )
                val channelNames = remember(controller.channels, controller.stats) {
                    (listOf("all-agent") +
                        controller.channels.map { it.name } +
                        (controller.stats?.perChannel?.map { it.channel } ?: emptyList()))
                        .distinct()
                }
                channelNames.forEach { ch ->
                    SdFilterChip(
                        label = ch,
                        selected = persistence.channelFilter == ch,
                        onClick = {
                            controller.updateFeedFilters(
                                channel = if (persistence.channelFilter == ch) null else ch
                            )
                        }
                    )
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                SdText(text = "PRI:", style = SdTheme.typo.monoTag)
                SdFilterChip(
                    label = "ANY",
                    selected = persistence.priorityFilter == null,
                    onClick = { controller.updateFeedFilters(priority = null) }
                )
                TaskPriority.ALL.forEach { pri ->
                    SdFilterChip(
                        label = pri.uppercase(),
                        selected = persistence.priorityFilter == pri,
                        onClick = {
                            controller.updateFeedFilters(
                                priority = if (persistence.priorityFilter == pri) null else pri
                            )
                        }
                    )
                }

                Spacer(modifier = Modifier.width(8.dp))
                SdText(text = "SENDER:", style = SdTheme.typo.monoTag)
                SdFilterChip(
                    label = "ANY",
                    selected = persistence.senderFilter == null,
                    onClick = { controller.updateFeedFilters(sender = null) }
                )
                controller.senders.forEach { snd ->
                    SdFilterChip(
                        label = snd,
                        selected = persistence.senderFilter == snd,
                        onClick = {
                            controller.updateFeedFilters(
                                sender = if (persistence.senderFilter == snd) null else snd
                            )
                        }
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = searchInput,
                    onValueChange = { searchInput = it },
                    label = "BODY SUBSTRING (q, %/_ stripped)",
                    placeholder = "Search message body...",
                    modifier = Modifier.weight(1.4f)
                )
                SdTextField(
                    value = sinceIdInput,
                    onValueChange = { sinceIdInput = it.filter { c -> c.isDigit() } },
                    label = "SINCE ID",
                    placeholder = "0",
                    modifier = Modifier.weight(0.6f)
                )
                SdTextField(
                    value = limitInput,
                    onValueChange = { limitInput = it.filter { c -> c.isDigit() } },
                    label = "LIMIT (1-200)",
                    placeholder = "50",
                    modifier = Modifier.weight(0.6f)
                )
                SdButton(
                    label = "Apply",
                    onClick = {
                        val parsedSince = sinceIdInput.toIntOrNull()
                        val parsedLimit = (limitInput.toIntOrNull() ?: 50).coerceIn(1, 200)
                        limitInput = parsedLimit.toString()
                        controller.updateFeedFilters(query = searchInput)
                        scope.launch {
                            controller.refreshFeed(
                                preserveAnchor = false,
                                sinceId = parsedSince,
                                limit = parsedLimit
                            )
                        }
                    },
                    variant = SdButtonVariant.COBALT,
                    compact = true
                )
            }
        }

        // Feed List States (Loading / Error / Empty / Data)
        when {
            controller.feedLoading && controller.messages.isEmpty() -> {
                SdLoadingState(message = "Loading bus messages from GET /admin/api/messages...")
            }
            controller.feedError != null && controller.messages.isEmpty() -> {
                SdErrorState(
                    title = "Could Not Load Feed",
                    cause = controller.feedError ?: "Unknown error",
                    onRetry = {
                        scope.launch { controller.refreshFeed(preserveAnchor = true) }
                    }
                )
            }
            controller.messages.isEmpty() -> {
                SdEmptyState(
                    title = "No Messages Match Current Filter",
                    causeAndNextStep = "No messages were returned for the selected channel, sender, priority, or search query. Clear active filters or dispatch a new admin message.",
                    actionLabel = "Reset Filters",
                    onAction = {
                        searchInput = ""
                        sinceIdInput = ""
                        controller.updateFeedFilters(channel = null, sender = null, priority = null, query = "")
                    }
                )
            }
            else -> {
                LazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 24.dp)
                ) {
                    items(
                        items = controller.messages,
                        key = { it.id }
                    ) { msg ->
                        MessageLedgerRow(
                            msg = msg,
                            onReply = {
                                controller.replyTargetMessage = msg
                                showComposeModal = true
                            },
                            onEdit = {
                                controller.editingMessage = msg
                            },
                            onDelete = {
                                controller.deleteAdminMessage(msg.id)
                            }
                        )
                    }
                }
            }
        }
    }

    if (showComposeModal) {
        ComposeMessageModal(
            controller = controller,
            replyTarget = controller.replyTargetMessage,
            onDismiss = {
                showComposeModal = false
                controller.replyTargetMessage = null
            }
        )
    }

    val editingMsg = controller.editingMessage
    if (editingMsg != null) {
        EditMessageModal(
            controller = controller,
            message = editingMsg,
            onDismiss = { controller.editingMessage = null }
        )
    }

    if (showChannelsModal) {
        ChannelsManagerModal(
            controller = controller,
            onDismiss = { showChannelsModal = false }
        )
    }
}

@Composable
private fun MessageLedgerRow(
    msg: MessageRecord,
    onReply: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val colors = SdTheme.colors
    val accent = when (msg.priority) {
        TaskPriority.URGENT -> colors.dangerCrimson
        TaskPriority.LOW -> colors.borderSubtle
        else -> null
    }
    SdCard(accentTopColor = accent, padding = 12.dp) {
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
                SdTag(
                    text = "#${msg.id}",
                    bgColor = colors.bgSubtle,
                    textColor = colors.inkPrimary
                )
                SdTag(
                    text = "CH:${msg.channel}",
                    bgColor = colors.cobaltInk,
                    textColor = colors.onCobaltInk,
                    borderColor = colors.cobaltInk
                )
                SdTag(
                    text = "FROM:${msg.sender}",
                    bgColor = colors.bgSubtle,
                    textColor = colors.inkPrimary
                )
                SdPriorityTag(priority = msg.priority)
                SdTag(text = "AUD:${msg.audience}")
                if (msg.replyTo != null) {
                    SdTag(
                        text = "REPLY->#${msg.replyTo}",
                        bgColor = colors.amberWarn,
                        textColor = colors.onAmberWarn,
                        borderColor = colors.amberWarn
                    )
                }
                if (msg.observedEditedLive) {
                    SdTag(
                        text = "EDITED (LIVE)",
                        bgColor = colors.amberWarn,
                        textColor = colors.onAmberWarn,
                        borderColor = colors.amberWarn
                    )
                }
            }
            SdText(
                text = SdTimeFormatter.formatIsoWithWibAndUtc(msg.ts),
                style = SdTheme.typo.monoCode,
                color = colors.inkMuted
            )
        }

        SdText(
            text = msg.body,
            style = SdTheme.typo.bodyPrimary,
            color = colors.inkPrimary
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SdButton(
                    label = "Reply",
                    onClick = onReply,
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
                SdButton(
                    label = "Edit",
                    onClick = onEdit,
                    variant = SdButtonVariant.SECONDARY,
                    compact = true
                )
                SdButton(
                    label = "Delete",
                    onClick = onDelete,
                    variant = SdButtonVariant.DANGER,
                    compact = true
                )
            }
        }
    }
}

@Composable
private fun ComposeMessageModal(
    controller: AdminAppController,
    replyTarget: MessageRecord?,
    onDismiss: () -> Unit
) {
    val colors = SdTheme.colors
    var channel by remember(replyTarget) {
        mutableStateOf(
            replyTarget?.channel
                ?: controller.feedPersistence.channelFilter
                ?: "all-agent"
        )
    }
    var body by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf(TaskPriority.NORMAL) }
    var audience by remember { mutableStateOf(Audience.AGENTS) }
    var dmPartyA by remember { mutableStateOf("luki") }
    var dmPartyB by remember { mutableStateOf(controller.registeredAgents.firstOrNull()?.agent ?: "") }

    val byteCount = remember(body) { ValidationRules.utf8ByteLength(body) }
    val channelValid = remember(channel) { ValidationRules.isValidSendChannel(channel.trim()) }
    val replyChannelMismatch = replyTarget != null && replyTarget.channel != channel.trim()

    SdModalDialog(
        title = if (replyTarget != null) "Reply to Message #${replyTarget.id}" else "Dispatch Admin Message (Sender: luki)",
        onDismiss = onDismiss
    ) {
        if (replyTarget != null) {
            SdCard(padding = 10.dp) {
                SdText(
                    text = "Replying to #${replyTarget.id} in channel '${replyTarget.channel}' by ${replyTarget.sender}",
                    style = SdTheme.typo.monoCode,
                    color = colors.cobaltInk
                )
                SdText(
                    text = replyTarget.body,
                    style = SdTheme.typo.bodySecondary,
                    maxLines = 3
                )
            }
        }

        SdTextField(
            value = channel,
            onValueChange = { if (replyTarget == null) channel = it },
            label = "CHANNEL (all-agent, custom ^[a-z0-9][a-z0-9_-]{0,31}$, or dm:<a>:<b>)",
            placeholder = "all-agent",
            errorText = when {
                replyChannelMismatch -> "reply_to requires matching channel '${replyTarget?.channel}'"
                !channelValid -> "Invalid channel format"
                else -> null
            },
            helperText = if (replyTarget != null) {
                "Channel locked to '${replyTarget.channel}' because reply_to must match target channel."
            } else null
        )

        if (replyTarget == null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                val quickChannels = (listOf("all-agent") + controller.channels.map { it.name }).distinct()
                quickChannels.forEach { ch ->
                    SdFilterChip(
                        label = ch,
                        selected = channel == ch,
                        onClick = { channel = ch }
                    )
                }
            }

            // DM Channel Helper (sorted alphabetically per SPEC section 3)
            SdCard(padding = 10.dp) {
                SdText(
                    text = "DM CHANNEL FORMATTER (SORTED ALPHABETICALLY)",
                    style = SdTheme.typo.monoTag
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.Bottom
                ) {
                    SdTextField(
                        value = dmPartyA,
                        onValueChange = { dmPartyA = it },
                        label = "PARTY A",
                        modifier = Modifier.weight(1f)
                    )
                    SdTextField(
                        value = dmPartyB,
                        onValueChange = { dmPartyB = it },
                        label = "PARTY B",
                        modifier = Modifier.weight(1f)
                    )
                    SdButton(
                        label = "Use DM",
                        enabled = dmPartyA.isNotBlank() && dmPartyB.isNotBlank(),
                        onClick = {
                            channel = ValidationRules.formatDmChannel(dmPartyA, dmPartyB)
                        },
                        variant = SdButtonVariant.SECONDARY,
                        compact = true
                    )
                }
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

        SdText(text = "AUDIENCE", style = SdTheme.typo.monoTag)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Audience.ALL.forEach { aud ->
                SdFilterChip(
                    label = aud.uppercase(),
                    selected = audience == aud,
                    onClick = { audience = aud }
                )
            }
        }

        SdTextField(
            value = body,
            onValueChange = { body = it },
            label = "MESSAGE BODY ($byteCount / 8192 UTF-8 BYTES)",
            placeholder = "Type message content...",
            singleLine = false,
            minLines = 4,
            errorText = if (byteCount > ValidationRules.MAX_BODY_BYTES) {
                "Body exceeds 8192 UTF-8 bytes ($byteCount bytes)"
            } else null
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            SdButton(
                label = "Send Message as luki",
                enabled = body.isNotEmpty() &&
                    byteCount <= ValidationRules.MAX_BODY_BYTES &&
                    channelValid &&
                    !replyChannelMismatch,
                onClick = {
                    controller.sendAdminMessage(
                        channel = channel.trim(),
                        body = body,
                        priority = priority,
                        audience = audience,
                        replyTo = replyTarget?.id,
                        onSent = onDismiss
                    )
                }
            )
        }
    }
}

@Composable
private fun EditMessageModal(
    controller: AdminAppController,
    message: MessageRecord,
    onDismiss: () -> Unit
) {
    var body by remember(message) { mutableStateOf(message.body) }
    var priority by remember(message) { mutableStateOf(message.priority) }
    var channel by remember(message) { mutableStateOf(message.channel) }

    val byteCount = remember(body) { ValidationRules.utf8ByteLength(body) }
    val hasChanges = body != message.body || priority != message.priority || channel.trim() != message.channel

    SdModalDialog(
        title = "Edit Message #${message.id}",
        onDismiss = onDismiss
    ) {
        SdText(
            text = "Backend note (SPEC section 4): PUT /admin/api/messages/:id overwrites body in database without setting edit_version/edited_at. Live clients mark this message edited via bus.message.edited.",
            style = SdTheme.typo.bodySecondary
        )

        SdTextField(
            value = channel,
            onValueChange = { channel = it },
            label = "CHANNEL"
        )

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
            value = body,
            onValueChange = { body = it },
            label = "BODY ($byteCount / 8192 BYTES)",
            singleLine = false,
            minLines = 4,
            errorText = if (byteCount > ValidationRules.MAX_BODY_BYTES) "Body too large (max 8192 bytes)" else null
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            SdButton(
                label = "Save Changes",
                enabled = hasChanges && body.isNotEmpty() && byteCount <= ValidationRules.MAX_BODY_BYTES,
                onClick = {
                    controller.editAdminMessage(
                        id = message.id,
                        newBody = body.takeIf { it != message.body },
                        newPriority = priority.takeIf { it != message.priority },
                        newChannel = channel.trim().takeIf { it != message.channel },
                        onEdited = onDismiss
                    )
                }
            )
        }
    }
}

@Composable
private fun ChannelsManagerModal(
    controller: AdminAppController,
    onDismiss: () -> Unit
) {
    val colors = SdTheme.colors
    var newChannelName by remember { mutableStateOf("") }
    var memberInputs by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    val countByChannel = remember(controller.stats) {
        controller.stats?.perChannel?.associate { it.channel to it.count } ?: emptyMap()
    }

    val isNewChannelValid = remember(newChannelName) {
        ValidationRules.isValidCustomChannel(newChannelName.trim())
    }
    val newChannelError = remember(newChannelName) {
        val clean = newChannelName.trim()
        when {
            clean.isEmpty() -> null
            clean.startsWith("dm:") -> "dm: channels are system-managed (400)"
            clean == "all-agent" -> "all-agent is reserved"
            !ValidationRules.isValidCustomChannel(clean) -> "Must match ^[a-z0-9][a-z0-9_-]{0,31}$"
            else -> null
        }
    }

    SdModalDialog(
        title = "Channels & Membership Registry",
        onDismiss = onDismiss
    ) {
        SdCard(padding = 10.dp) {
            SdText(text = "CREATE CUSTOM CHANNEL (POST /admin/api/channels)", style = SdTheme.typo.monoTag)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                SdTextField(
                    value = newChannelName,
                    onValueChange = { newChannelName = it },
                    label = "CHANNEL NAME",
                    placeholder = "e.g. ops-alerts",
                    errorText = newChannelError,
                    modifier = Modifier.weight(1f)
                )
                SdButton(
                    label = "Create",
                    enabled = isNewChannelValid,
                    onClick = {
                        controller.createChannel(newChannelName.trim()) {
                            newChannelName = ""
                        }
                    },
                    variant = SdButtonVariant.PRIMARY,
                    compact = true
                )
            }
        }

        if (controller.channels.isEmpty()) {
            SdEmptyState(
                title = "No Channels Listed",
                causeAndNextStep = "GET /admin/api/channels returned no channels with messages yet. Create a custom channel above or send a message."
            )
        } else {
            controller.channels.forEach { ch ->
                val msgCount = countByChannel[ch.name] ?: 0
                val isSystem = ValidationRules.isSystemManagedChannel(ch.name)
                SdCard(padding = 10.dp) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                SdText(text = ch.name, style = SdTheme.typo.cardTitle)
                                SdTag(text = "$msgCount msgs (from stats)")
                                if (isSystem) {
                                    SdTag(
                                        text = "SYSTEM-MANAGED",
                                        bgColor = colors.bgSubtle,
                                        textColor = colors.inkSecondary
                                    )
                                }
                            }
                            SdText(
                                text = "Members: ${if (ch.members.isEmpty()) "none" else ch.members.joinToString(", ")}",
                                style = SdTheme.typo.bodySecondary
                            )
                        }
                        if (!isSystem) {
                            SdButton(
                                label = "Delete",
                                onClick = { controller.confirmDeleteChannel(ch.name) },
                                variant = SdButtonVariant.DANGER,
                                compact = true
                            )
                        }
                    }

                    if (!isSystem) {
                        // Removable member chips
                        if (ch.members.isNotEmpty()) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                ch.members.forEach { member ->
                                    SdButton(
                                        label = "$member [x]",
                                        onClick = { controller.removeMemberFromChannel(ch.name, member) },
                                        variant = SdButtonVariant.SECONDARY,
                                        compact = true
                                    )
                                }
                            }
                        }

                        // Add member input
                        val currentInput = memberInputs[ch.name] ?: ""
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.Bottom
                        ) {
                            SdTextField(
                                value = currentInput,
                                onValueChange = { memberInputs = memberInputs + (ch.name to it) },
                                label = "ADD REGISTERED AGENT TO '${ch.name}'",
                                placeholder = "agent name (e.g. nyx, nosmile99)",
                                modifier = Modifier.weight(1f)
                            )
                            SdButton(
                                label = "Add Member",
                                enabled = currentInput.isNotBlank(),
                                onClick = {
                                    controller.addMemberToChannel(ch.name, currentInput.trim())
                                    memberInputs = memberInputs + (ch.name to "")
                                },
                                variant = SdButtonVariant.COBALT,
                                compact = true
                            )
                        }
                    }
                }
            }
        }
    }
}
