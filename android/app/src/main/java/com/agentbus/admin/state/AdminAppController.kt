package com.agentbus.admin.state

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.agentbus.admin.model.*
import com.agentbus.admin.network.AgentBusApiClient
import com.agentbus.admin.storage.AdminPersistentStore
import com.agentbus.admin.storage.StoredCredentials
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

enum class AdminDestination(val code: String, val label: String) {
    FEED("01", "Feed"),
    BOARD("02", "Board"),
    NEEDS("03", "Needs"),
    AGENTS("04", "Agents"),
    OPS("05", "Ops")
}

data class OneTimeSecretNotice(
    val agent: String,
    val secret: String,
    val isRotation: Boolean
)

data class LaneConflictPrompt(
    val taskId: Int,
    val requestedLane: String,
    val current: LaneChangeConflictCurrent
)

data class DestructiveConfirmRequest(
    val title: String,
    val detail: String,
    val confirmButtonLabel: String,
    val onConfirm: suspend () -> Unit
)

class AdminAppController(
    val store: AdminPersistentStore,
    val scope: CoroutineScope,
    val apiClient: AgentBusApiClient = AgentBusApiClient()
) {
    // Theme & Navigation
    var isDarkTheme by mutableStateOf(false)
        private set
    var currentDestination by mutableStateOf(AdminDestination.FEED)
        private set

    // Auth & Connection State
    var baseUrl by mutableStateOf(AgentBusApiClient.DEFAULT_BASE_URL)
    var loginUsername by mutableStateOf("")
    var loginPassword by mutableStateOf("")
    var adminToken by mutableStateOf("")
    var isAuthenticated by mutableStateOf(false)
        private set
    var authLoading by mutableStateOf(false)
        private set
    var authError by mutableStateOf<String?>(null)
        private set
    var statusBanner by mutableStateOf<String?>(null)
        private set
    var errorBanner by mutableStateOf<String?>(null)
        private set

    // Overview Stats
    var stats by mutableStateOf<AdminStatsResponse?>(null)
        private set
    var statsLoading by mutableStateOf(false)
        private set
    var statsError by mutableStateOf<String?>(null)
        private set

    // Channels & Senders
    var channels by mutableStateOf<List<ChannelInfo>>(emptyList())
        private set
    var senders by mutableStateOf<List<String>>(emptyList())
        private set

    // Feed State & Persistent Anchor
    var messages by mutableStateOf<List<MessageRecord>>(emptyList())
        private set
    var feedLoading by mutableStateOf(false)
        private set
    var feedError by mutableStateOf<String?>(null)
        private set
    var feedPersistence by mutableStateOf(FeedViewPersistence())
        private set
    var replyTargetMessage by mutableStateOf<MessageRecord?>(null)
    var editingMessage by mutableStateOf<MessageRecord?>(null)

    // Poll Cursor & Live Events
    var pollCursor by mutableStateOf(PollCursor(0L, 0))
        private set
    var lastPollResyncRequired by mutableStateOf(false)
        private set
    var liveEventsCount by mutableStateOf(0)
        private set
    private var pollJob: Job? = null

    // Kanban Projects & Board State
    var projects by mutableStateOf<List<ProjectRecord>>(emptyList())
        private set
    var selectedProjectId by mutableStateOf<Int?>(null)
        private set
    var projectTasks by mutableStateOf<List<TaskRecord>>(emptyList())
        private set
    var projectSubscribers by mutableStateOf<List<ProjectSubscriberRecord>>(emptyList())
        private set
    var projectLabels by mutableStateOf<List<String>>(emptyList())
        private set
    var boardLoading by mutableStateOf(false)
        private set
    var boardError by mutableStateOf<String?>(null)
        private set
    var globalSummary by mutableStateOf<KanbanSummaryResponse?>(null)
        private set
    var projectSummary by mutableStateOf<KanbanSummaryResponse?>(null)
        private set

    // Selected Task Detail Modal/Sheet
    var activeTaskDetail by mutableStateOf<TaskRecord?>(null)
        private set
    var activeTaskComments by mutableStateOf<List<TaskCommentRecord>>(emptyList())
        private set
    var taskDetailLoading by mutableStateOf(false)
        private set

    // Global Search, Needs & Activity
    var globalSearchTasks by mutableStateOf<List<TaskRecord>>(emptyList())
        private set
    var needsTasks by mutableStateOf<List<TaskRecord>>(emptyList())
        private set
    var needsLoading by mutableStateOf(false)
        private set
    var needsError by mutableStateOf<String?>(null)
        private set
    var activityItems by mutableStateOf<List<ActivityRecord>>(emptyList())
        private set
    var activityLoading by mutableStateOf(false)
        private set

    // Agents State
    var registeredAgents by mutableStateOf<List<RegisteredAgentRecord>>(emptyList())
        private set
    var liveAgents by mutableStateOf<List<LiveAgentConnection>>(emptyList())
        private set
    var agentsLoading by mutableStateOf(false)
        private set
    var agentsError by mutableStateOf<String?>(null)
        private set

    // WIP, Lane Mapping, Templates, Export/Import
    var wipLimit by mutableStateOf<Int?>(null)
        private set
    var laneMappings by mutableStateOf<List<LaneMappingRecord>>(emptyList())
        private set
    var templates by mutableStateOf<List<TaskTemplateRecord>>(emptyList())
        private set
    var exportedJson by mutableStateOf("")

    // Alerts & Modals (WIP Warning, Lane Conflict, One-Time Secret, Destructive Confirmation, Blocked Reason Dialog)
    var activeWipWarning by mutableStateOf<WipWarning?>(null)
    var activeLaneConflict by mutableStateOf<LaneConflictPrompt?>(null)
    var oneTimeSecretNotice by mutableStateOf<OneTimeSecretNotice?>(null)
    var pendingDestructiveConfirm by mutableStateOf<DestructiveConfirmRequest?>(null)

    init {
        val savedCreds = store.loadCredentials()
        baseUrl = savedCreds.baseUrl.ifBlank { AgentBusApiClient.DEFAULT_BASE_URL }
        loginUsername = savedCreds.username
        loginPassword = savedCreds.password
        adminToken = savedCreds.adminToken
        isDarkTheme = savedCreds.isDarkTheme
        pollCursor = store.loadPollCursor()
        feedPersistence = store.loadFeedPersistence()

        apiClient.updateConnection(
            baseUrl = baseUrl,
            user = loginUsername,
            pass = loginPassword,
            token = adminToken
        )

        if (savedCreds.username.isNotBlank() && savedCreds.password.isNotBlank()) {
            scope.launch {
                attemptAutoSessionRestore()
            }
        }
    }

    private suspend fun attemptAutoSessionRestore() {
        authLoading = true
        authError = null
        try {
            val loadedStats = apiClient.getStats()
            stats = loadedStats
            isAuthenticated = true
            fullReload(preserveFeedScroll = true)
            startLivePolling()
        } catch (e: ApiException) {
            if (e.statusCode == 401) {
                isAuthenticated = false
                authError = "Session credentials rejected (401). Please sign in."
            } else {
                authError = e.error
            }
        } catch (e: Exception) {
            authError = e.message ?: "Unable to reach server"
        } finally {
            authLoading = false
        }
    }

    fun toggleTheme() {
        isDarkTheme = !isDarkTheme
        val current = store.loadCredentials()
        store.saveCredentials(current.copy(isDarkTheme = isDarkTheme))
    }

    fun navigateTo(destination: AdminDestination) {
        currentDestination = destination
    }

    fun dismissBanners() {
        statusBanner = null
        errorBanner = null
    }

    fun postStatus(msg: String) {
        statusBanner = msg
        errorBanner = null
    }

    fun postError(msg: String) {
        errorBanner = msg
    }

    fun requestDestructiveConfirm(
        title: String,
        detail: String,
        confirmButtonLabel: String,
        onConfirm: suspend () -> Unit
    ) {
        pendingDestructiveConfirm = DestructiveConfirmRequest(
            title = title,
            detail = detail,
            confirmButtonLabel = confirmButtonLabel,
            onConfirm = onConfirm
        )
    }

    fun executeDestructiveConfirm() {
        val req = pendingDestructiveConfirm ?: return
        pendingDestructiveConfirm = null
        scope.launch {
            try {
                req.onConfirm()
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } catch (e: Exception) {
                postError(e.message ?: "Operation failed")
            }
        }
    }

    fun login(urlInput: String, userInput: String, passInput: String, tokenInput: String = adminToken) {
        val cleanUrl = urlInput.trim().removeSuffix("/").ifEmpty { AgentBusApiClient.DEFAULT_BASE_URL }
        val cleanUser = userInput.trim()
        if (cleanUser.isEmpty() || passInput.isEmpty()) {
            authError = "Username and password are required."
            return
        }
        scope.launch {
            authLoading = true
            authError = null
            try {
                val verifiedStats = apiClient.verifyCredentials(cleanUrl, cleanUser, passInput)
                baseUrl = cleanUrl
                loginUsername = cleanUser
                loginPassword = passInput
                adminToken = tokenInput.trim()
                apiClient.updateConnection(baseUrl, loginUsername, loginPassword, adminToken)
                store.saveCredentials(
                    StoredCredentials(
                        baseUrl = baseUrl,
                        username = loginUsername,
                        password = loginPassword,
                        adminToken = adminToken,
                        isDarkTheme = isDarkTheme
                    )
                )
                stats = verifiedStats
                isAuthenticated = true
                // Re-login or URL change preserves Feed anchor/cursor per SPEC section 4 & 15!
                fullReload(preserveFeedScroll = true)
                startLivePolling()
            } catch (e: ApiException) {
                authError = "HTTP ${e.statusCode}: ${e.error}"
            } catch (e: Exception) {
                authError = e.message ?: "Connection failed"
            } finally {
                authLoading = false
            }
        }
    }

    fun changeEndpointUrl(newUrl: String) {
        val cleanUrl = newUrl.trim().removeSuffix("/").ifEmpty { AgentBusApiClient.DEFAULT_BASE_URL }
        baseUrl = cleanUrl
        apiClient.updateConnection(baseUrl = cleanUrl)
        val creds = store.loadCredentials()
        store.saveCredentials(creds.copy(baseUrl = cleanUrl))
        // Preserve Feed anchor across URL change!
        scope.launch {
            if (isAuthenticated) {
                fullReload(preserveFeedScroll = true)
            }
        }
    }

    fun logout() {
        pollJob?.cancel()
        pollJob = null
        store.clearAuthCredentialsOnly()
        loginPassword = ""
        isAuthenticated = false
        oneTimeSecretNotice = null
        // Note: feedPersistence and pollCursor remain stored on disk so re-login restores Feed position!
    }

    fun changeAdminPassword(newUser: String?, newPassword: String, onSuccess: (String) -> Unit = {}) {
        if (!ValidationRules.isValidPassword(newPassword)) {
            postError("New password must be at least 12 characters.")
            return
        }
        scope.launch {
            try {
                val res = apiClient.changePassword(newUser?.takeIf { it.isNotBlank() }, newPassword)
                val updatedUser = res.user.ifBlank { newUser?.trim()?.takeIf { it.isNotEmpty() } ?: loginUsername }
                // Old credentials are now invalid per SPEC section 1: require re-login while keeping Feed anchor
                pollJob?.cancel()
                pollJob = null
                store.clearAuthCredentialsOnly()
                loginUsername = updatedUser
                loginPassword = ""
                isAuthenticated = false
                authError = "Password updated for '$updatedUser'. Please sign in with your new password."
                onSuccess(updatedUser)
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } catch (e: Exception) {
                postError(e.message ?: "Password change failed")
            }
        }
    }

    suspend fun fullReload(preserveFeedScroll: Boolean = true) {
        if (!preserveFeedScroll) {
            updateFeedScrollPosition(0, 0, null)
        }
        try {
            statsLoading = true
            statsError = null
            stats = apiClient.getStats()
        } catch (e: Exception) {
            statsError = e.message
        } finally {
            statsLoading = false
        }

        try {
            val chRes = apiClient.getChannels()
            val sndRes = apiClient.getSenders()
            channels = chRes.channels
            senders = sndRes.senders
        } catch (_: Exception) {
        }

        refreshFeed(preserveAnchor = preserveFeedScroll)
        refreshBoard()
        refreshNeeds()
        refreshAgents()
        refreshOpsConfig()
    }

    // ------------------------------------------------------------------------
    // Feed & Channel Operations
    // ------------------------------------------------------------------------
    fun updateFeedFilters(
        channel: String? = feedPersistence.channelFilter,
        sender: String? = feedPersistence.senderFilter,
        priority: String? = feedPersistence.priorityFilter,
        query: String = feedPersistence.searchQuery
    ) {
        feedPersistence = feedPersistence.copy(
            channelFilter = channel,
            senderFilter = sender,
            priorityFilter = priority,
            searchQuery = query
        )
        store.saveFeedPersistence(feedPersistence)
        scope.launch {
            refreshFeed(preserveAnchor = false)
        }
    }

    fun updateFeedScrollPosition(index: Int, offset: Int, anchorId: Int?) {
        val currentAnchor = anchorId ?: messages.getOrNull(index)?.id ?: feedPersistence.anchorMessageId
        if (
            feedPersistence.firstVisibleItemIndex == index &&
            feedPersistence.firstVisibleItemScrollOffset == offset &&
            feedPersistence.anchorMessageId == currentAnchor
        ) {
            return
        }
        feedPersistence = feedPersistence.copy(
            anchorMessageId = currentAnchor,
            firstVisibleItemIndex = index,
            firstVisibleItemScrollOffset = offset
        )
        store.saveFeedPersistence(feedPersistence)
    }

    suspend fun refreshFeed(preserveAnchor: Boolean = true, sinceId: Int? = null, limit: Int = 50) {
        feedLoading = true
        feedError = null
        try {
            val res = apiClient.getMessages(
                channel = feedPersistence.channelFilter,
                sender = feedPersistence.senderFilter,
                priority = feedPersistence.priorityFilter,
                q = feedPersistence.searchQuery.takeIf { it.isNotBlank() },
                since = sinceId,
                limit = limit
            )
            val replyMap = feedPersistence.observedReplyTo
            val editedSet = feedPersistence.observedEditedIds
            val enriched = res.messages.map { m ->
                m.copy(
                    replyTo = m.replyTo ?: replyMap[m.id],
                    observedEditedLive = m.observedEditedLive || (m.id in editedSet)
                )
            }
            messages = enriched
            if (preserveAnchor && feedPersistence.anchorMessageId != null) {
                val idx = enriched.indexOfFirst { it.id == feedPersistence.anchorMessageId }
                if (idx >= 0 && idx != feedPersistence.firstVisibleItemIndex) {
                    feedPersistence = feedPersistence.copy(firstVisibleItemIndex = idx)
                    store.saveFeedPersistence(feedPersistence)
                }
            }
        } catch (e: ApiException) {
            feedError = "HTTP ${e.statusCode}: ${e.error}"
        } catch (e: Exception) {
            feedError = e.message ?: "Failed to load messages"
        } finally {
            feedLoading = false
        }
    }

    fun sendAdminMessage(
        channel: String,
        body: String,
        priority: String,
        audience: String,
        replyTo: Int?,
        onSent: () -> Unit = {}
    ) {
        scope.launch {
            try {
                val res = apiClient.sendMessage(
                    channel = channel,
                    body = body,
                    priority = priority,
                    audience = audience,
                    replyTo = replyTo
                )
                if (replyTo != null && res.id > 0) {
                    val updatedReplyMap = feedPersistence.observedReplyTo + (res.id to replyTo)
                    feedPersistence = feedPersistence.copy(observedReplyTo = updatedReplyMap)
                    store.saveFeedPersistence(feedPersistence)
                }
                replyTargetMessage = null
                onSent()
                pollOnce()
                refreshFeed(preserveAnchor = true)
                stats = runCatching { apiClient.getStats() }.getOrNull() ?: stats
                channels = runCatching { apiClient.getChannels().channels }.getOrNull() ?: channels
                senders = runCatching { apiClient.getSenders().senders }.getOrNull() ?: senders
                postStatus("Message #${res.id} dispatched to $channel.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } catch (e: Exception) {
                postError(e.message ?: "Failed to send message")
            }
        }
    }

    fun editAdminMessage(
        id: Int,
        newBody: String?,
        newPriority: String?,
        newChannel: String?,
        onEdited: () -> Unit = {}
    ) {
        scope.launch {
            try {
                apiClient.editMessage(id = id, body = newBody, priority = newPriority, channel = newChannel)
                val updatedEditedSet = feedPersistence.observedEditedIds + id
                feedPersistence = feedPersistence.copy(observedEditedIds = updatedEditedSet)
                store.saveFeedPersistence(feedPersistence)
                editingMessage = null
                onEdited()
                pollOnce()
                refreshFeed(preserveAnchor = true)
                postStatus("Message #$id updated.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } catch (e: Exception) {
                postError(e.message ?: "Failed to edit message")
            }
        }
    }

    fun deleteAdminMessage(id: Int) {
        requestDestructiveConfirm(
            title = "Delete Message #$id",
            detail = "Message #$id will be permanently deleted from the bus database (hard delete).",
            confirmButtonLabel = "Delete Message #$id"
        ) {
            apiClient.deleteMessage(id)
            pollOnce()
            refreshFeed(preserveAnchor = true)
            stats = runCatching { apiClient.getStats() }.getOrNull() ?: stats
            postStatus("Message #$id deleted.")
        }
    }

    fun createChannel(name: String, onCreated: () -> Unit = {}) {
        scope.launch {
            try {
                val res = apiClient.createChannel(name)
                if (channels.none { it.name == res.name }) {
                    channels = (channels + ChannelInfo(name = res.name, members = listOf("admin")))
                        .sortedBy { it.name }
                }
                pollOnce()
                onCreated()
                postStatus("Channel '${res.name}' created.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } catch (e: Exception) {
                postError(e.message ?: "Failed to create channel")
            }
        }
    }

    fun confirmDeleteChannel(channel: String) {
        requestDestructiveConfirm(
            title = "Delete Channel '$channel'",
            detail = "Deleting channel '$channel' permanently deletes the channel, its membership list, and all messages posted in '$channel'.",
            confirmButtonLabel = "Delete '$channel' & Messages"
        ) {
            val res = apiClient.deleteChannel(channel)
            channels = channels.filterNot { it.name == channel }
            if (feedPersistence.channelFilter == channel) {
                updateFeedFilters(channel = null)
            } else {
                refreshFeed(preserveAnchor = true)
            }
            stats = runCatching { apiClient.getStats() }.getOrNull() ?: stats
            postStatus("Deleted channel '${res.channel}' (${res.deleted} messages removed).")
        }
    }

    fun addMemberToChannel(channel: String, agent: String) {
        scope.launch {
            try {
                apiClient.addChannelMember(channel, agent)
                channels = channels.map { ch ->
                    if (ch.name == channel && agent !in ch.members) {
                        ch.copy(members = (ch.members + agent).sorted())
                    } else ch
                }
                postStatus("Added '$agent' to '$channel'.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } catch (e: Exception) {
                postError(e.message ?: "Failed to add channel member")
            }
        }
    }

    fun removeMemberFromChannel(channel: String, agent: String) {
        scope.launch {
            try {
                apiClient.removeChannelMember(channel, agent)
                channels = channels.map { ch ->
                    if (ch.name == channel) ch.copy(members = ch.members - agent) else ch
                }
                postStatus("Removed '$agent' from '$channel'.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } catch (e: Exception) {
                postError(e.message ?: "Failed to remove channel member")
            }
        }
    }

    // ------------------------------------------------------------------------
    // Kanban Projects, Tasks, Todos, Comments, Labels, Search, Summary
    // ------------------------------------------------------------------------
    suspend fun refreshBoard() {
        boardLoading = true
        boardError = null
        try {
            val projRes = apiClient.getProjects()
            projects = projRes.projects
            globalSummary = runCatching { apiClient.getSummary(projectId = null, includeArchived = false) }.getOrNull()
            templates = runCatching { apiClient.getTemplates().templates }.getOrDefault(templates)
            val activeProjId = selectedProjectId?.takeIf { id -> projects.any { it.id == id } }
                ?: projects.firstOrNull { !it.isArchived }?.id
                ?: projects.firstOrNull()?.id
            selectedProjectId = activeProjId
            if (activeProjId != null) {
                loadSelectedProjectData(activeProjId)
            } else {
                projectTasks = emptyList()
                projectSubscribers = emptyList()
                projectLabels = emptyList()
                projectSummary = null
            }
            activityItems = runCatching {
                apiClient.getActivity(limit = 50, projectId = activeProjId).activity
            }.getOrDefault(emptyList())
        } catch (e: ApiException) {
            boardError = "HTTP ${e.statusCode}: ${e.error}"
        } catch (e: Exception) {
            boardError = e.message ?: "Failed to load Kanban board"
        } finally {
            boardLoading = false
        }
    }

    private suspend fun loadSelectedProjectData(projectId: Int) {
        projectTasks = apiClient.getProjectTasks(projectId).tasks
        projectSubscribers = runCatching { apiClient.getProjectSubscribers(projectId).subscribers }.getOrDefault(emptyList())
        projectLabels = runCatching { apiClient.getProjectLabels(projectId).labels }.getOrDefault(emptyList())
        projectSummary = runCatching { apiClient.getSummary(projectId = projectId) }.getOrNull()
    }

    fun selectProject(projectId: Int) {
        selectedProjectId = projectId
        scope.launch {
            boardLoading = true
            try {
                loadSelectedProjectData(projectId)
                activityItems = runCatching {
                    apiClient.getActivity(limit = 50, projectId = projectId).activity
                }.getOrDefault(activityItems)
            } catch (e: ApiException) {
                boardError = "HTTP ${e.statusCode}: ${e.error}"
            } finally {
                boardLoading = false
            }
        }
    }

    fun createProject(title: String, description: String?, subscribers: List<String>?, onDone: () -> Unit = {}) {
        scope.launch {
            try {
                val res = apiClient.createProject(title, description, subscribers)
                selectedProjectId = res.id
                refreshBoard()
                onDone()
                postStatus("Project #${res.id} created.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun updateProject(
        projectId: Int,
        title: String? = null,
        description: String? = null,
        includeDescription: Boolean = false,
        archived: Int? = null,
        subscribers: List<String>? = null
    ) {
        scope.launch {
            try {
                apiClient.updateProject(
                    id = projectId,
                    title = title,
                    description = description,
                    includeDescription = includeDescription,
                    archived = archived,
                    subscribers = subscribers
                )
                refreshBoard()
                postStatus("Project #$projectId updated.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun confirmDeleteProject(project: ProjectRecord) {
        requestDestructiveConfirm(
            title = "Delete Project '${project.title}' (#${project.id})",
            detail = "Deleting project #${project.id} cascades and permanently deletes all ${project.taskCount} tasks, todos, labels, and comments inside it.",
            confirmButtonLabel = "Delete Project #${project.id}"
        ) {
            apiClient.deleteProject(project.id)
            if (selectedProjectId == project.id) {
                selectedProjectId = null
            }
            refreshBoard()
            refreshNeeds()
            postStatus("Project #${project.id} deleted.")
        }
    }

    fun openTaskDetail(taskId: Int) {
        scope.launch {
            taskDetailLoading = true
            try {
                activeTaskDetail = apiClient.getTaskDetail(taskId)
                activeTaskComments = apiClient.getTaskComments(taskId).comments
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } finally {
                taskDetailLoading = false
            }
        }
    }

    fun closeTaskDetail() {
        activeTaskDetail = null
        activeTaskComments = emptyList()
    }

    fun createTask(
        projectId: Int,
        title: String?,
        description: String?,
        notes: String?,
        priority: String?,
        assignee: String?,
        explicitNullAssignee: Boolean,
        lane: String?,
        dueDate: Long?,
        template: String?,
        templateVars: Map<String, String>?,
        labels: List<String>?,
        onCreated: (CreateTaskResponse) -> Unit = {}
    ) {
        scope.launch {
            try {
                val res = apiClient.createTask(
                    projectId = projectId,
                    title = title,
                    description = description,
                    notes = notes,
                    priority = priority,
                    assignee = assignee,
                    explicitNullAssignee = explicitNullAssignee,
                    lane = lane,
                    dueDate = dueDate,
                    template = template,
                    templateVars = templateVars,
                    labels = labels
                )
                refreshBoard()
                onCreated(res)
                postStatus("Task #${res.id} created (lane=${res.lane}, assignee=${res.assignee ?: "unassigned"}).")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun updateTask(
        taskId: Int,
        title: String? = null,
        description: String? = null,
        includeDescription: Boolean = false,
        notes: String? = null,
        includeNotes: Boolean = false,
        status: String? = null,
        priority: String? = null,
        assignee: String? = null,
        includeAssignee: Boolean = false,
        blockedKind: String? = null,
        blockedReason: String? = null,
        dueDate: Long? = null,
        includeDueDate: Boolean = false,
        lane: String? = null,
        comment: String? = null,
        unblock: Boolean? = null,
        onUpdated: () -> Unit = {}
    ) {
        scope.launch {
            try {
                val res = apiClient.updateTask(
                    taskId = taskId,
                    title = title,
                    description = description,
                    includeDescription = includeDescription,
                    notes = notes,
                    includeNotes = includeNotes,
                    status = status,
                    priority = priority,
                    assignee = assignee,
                    includeAssignee = includeAssignee,
                    blockedKind = blockedKind,
                    blockedReason = blockedReason,
                    dueDate = dueDate,
                    includeDueDate = includeDueDate,
                    lane = lane,
                    comment = comment,
                    unblock = unblock
                )
                if (res.wipWarning != null) {
                    activeWipWarning = res.wipWarning
                }
                if (activeTaskDetail?.id == taskId) {
                    activeTaskDetail = runCatching { apiClient.getTaskDetail(taskId) }.getOrNull()
                    activeTaskComments = runCatching { apiClient.getTaskComments(taskId).comments }.getOrDefault(activeTaskComments)
                }
                refreshBoard()
                refreshNeeds()
                onUpdated()
                postStatus("Task #$taskId updated.")
            } catch (e: ApiException) {
                if (e.statusCode == 409 && e.error == "lane_change_conflict" && lane != null) {
                    activeLaneConflict = LaneConflictPrompt(
                        taskId = taskId,
                        requestedLane = lane,
                        current = e.laneConflict ?: LaneChangeConflictCurrent()
                    )
                } else {
                    postError("HTTP ${e.statusCode}: ${e.error}")
                }
            }
        }
    }

    fun confirmDeleteTask(task: TaskRecord) {
        requestDestructiveConfirm(
            title = "Delete Task #${task.id}",
            detail = "Task '${task.title}' (#${task.id}) and its ${task.todos.size} todos will be permanently deleted.",
            confirmButtonLabel = "Delete Task #${task.id}"
        ) {
            apiClient.deleteTask(task.id)
            if (activeTaskDetail?.id == task.id) {
                closeTaskDetail()
            }
            refreshBoard()
            refreshNeeds()
            postStatus("Task #${task.id} deleted.")
        }
    }

    // Todos
    fun addTodo(taskId: Int, text: String, sortOrder: Int = 0) {
        scope.launch {
            try {
                apiClient.createTodo(taskId, text, sortOrder)
                if (activeTaskDetail?.id == taskId) {
                    openTaskDetail(taskId)
                }
                refreshBoard()
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun updateTodo(taskId: Int, todoId: Int, text: String? = null, done: Boolean? = null, sortOrder: Int? = null) {
        scope.launch {
            try {
                apiClient.updateTodo(todoId = todoId, text = text, done = done, sortOrder = sortOrder)
                if (activeTaskDetail?.id == taskId) {
                    openTaskDetail(taskId)
                }
                refreshBoard()
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun deleteTodo(taskId: Int, todoId: Int) {
        scope.launch {
            try {
                apiClient.deleteTodo(todoId)
                if (activeTaskDetail?.id == taskId) {
                    openTaskDetail(taskId)
                }
                refreshBoard()
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    // Comments & Labels
    fun addComment(taskId: Int, body: String, onAdded: () -> Unit = {}) {
        scope.launch {
            try {
                apiClient.addTaskComment(taskId, body)
                onAdded()
                openTaskDetail(taskId)
                refreshBoard()
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun addLabel(taskId: Int, label: String, onAdded: () -> Unit = {}) {
        scope.launch {
            try {
                apiClient.addTaskLabel(taskId, label)
                onAdded()
                openTaskDetail(taskId)
                refreshBoard()
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun removeLabel(taskId: Int, label: String) {
        scope.launch {
            try {
                apiClient.removeTaskLabel(taskId, label)
                openTaskDetail(taskId)
                refreshBoard()
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    // Global Search, Activity & Needs
    fun executeGlobalSearch(opts: TaskSearchOpts) {
        scope.launch {
            boardLoading = true
            try {
                globalSearchTasks = apiClient.searchTasksGlobal(opts).tasks
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } finally {
                boardLoading = false
            }
        }
    }

    suspend fun refreshNeeds() {
        needsLoading = true
        needsError = null
        try {
            val res = apiClient.searchTasksGlobal(
                TaskSearchOpts(
                    status = TaskStatus.BLOCKED,
                    blockedKind = BlockedKind.WAITING_HUMAN,
                    sort = "blocked_since",
                    includeArchived = false
                )
            )
            needsTasks = res.tasks
            globalSummary = runCatching { apiClient.getSummary(projectId = null, includeArchived = false) }.getOrNull() ?: globalSummary
        } catch (e: ApiException) {
            needsError = "HTTP ${e.statusCode}: ${e.error}"
        } catch (e: Exception) {
            needsError = e.message ?: "Failed to load Needs tasks"
        } finally {
            needsLoading = false
        }
    }

    fun loadGlobalActivity(limit: Int = 50, projectId: Int? = null, agent: String? = null, lane: String? = null) {
        scope.launch {
            activityLoading = true
            try {
                activityItems = apiClient.getActivity(
                    limit = limit,
                    projectId = projectId,
                    agent = agent,
                    lane = lane
                ).activity
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            } finally {
                activityLoading = false
            }
        }
    }

    // ------------------------------------------------------------------------
    // Agents (Section 11)
    // ------------------------------------------------------------------------
    suspend fun refreshAgents() {
        agentsLoading = true
        agentsError = null
        try {
            registeredAgents = apiClient.getRegisteredAgents().agents
            liveAgents = apiClient.getLiveAgents().agents
        } catch (e: ApiException) {
            agentsError = "HTTP ${e.statusCode}: ${e.error}"
        } catch (e: Exception) {
            agentsError = e.message ?: "Failed to load agents"
        } finally {
            agentsLoading = false
        }
    }

    fun registerNewAgent(name: String, onDone: () -> Unit = {}) {
        scope.launch {
            try {
                val res = apiClient.registerAgent(name)
                // Secret is shown ONCE in modal and never saved to persistent storage!
                oneTimeSecretNotice = OneTimeSecretNotice(
                    agent = res.agent,
                    secret = res.secret,
                    isRotation = false
                )
                onDone()
                refreshAgents()
                channels = runCatching { apiClient.getChannels().channels }.getOrDefault(channels)
                stats = runCatching { apiClient.getStats() }.getOrNull() ?: stats
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun rotateAgentSecret(agent: String) {
        requestDestructiveConfirm(
            title = "Rotate Secret for '$agent'",
            detail = "Issuing a new secret for '$agent' immediately invalidates its current token. The new secret will be displayed once.",
            confirmButtonLabel = "Rotate Secret"
        ) {
            val res = apiClient.rotateAgentSecret(agent)
            oneTimeSecretNotice = OneTimeSecretNotice(
                agent = res.agent,
                secret = res.secret,
                isRotation = true
            )
            refreshAgents()
        }
    }

    fun confirmDeleteAgent(agent: String) {
        requestDestructiveConfirm(
            title = "Delete Agent '$agent'",
            detail = "Deleting '$agent' revokes its credentials, closes active WebSockets, and removes '$agent' from all channel memberships.",
            confirmButtonLabel = "Delete Agent '$agent'"
        ) {
            apiClient.deleteAgent(agent)
            refreshAgents()
            channels = runCatching { apiClient.getChannels().channels }.getOrDefault(channels)
            stats = runCatching { apiClient.getStats() }.getOrNull() ?: stats
            postStatus("Agent '$agent' deleted.")
        }
    }

    // ------------------------------------------------------------------------
    // WIP, Lane Mapping, Templates, Export/Import (Sections 12, 13, 4)
    // ------------------------------------------------------------------------
    suspend fun refreshOpsConfig() {
        try {
            wipLimit = apiClient.getWipConfig().perAssigneeDoingLimit
            laneMappings = apiClient.getLaneMapping().laneMapping
            templates = apiClient.getTemplates().templates
        } catch (_: Exception) {
        }
    }

    fun saveWipLimit(newLimit: Int?) {
        scope.launch {
            try {
                val res = apiClient.updateWipConfig(newLimit)
                wipLimit = res.perAssigneeDoingLimit
                postStatus("WIP doing limit updated to ${wipLimit ?: "unlimited"}.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun saveLaneMapping(agent: String, lane: String) {
        scope.launch {
            try {
                apiClient.updateLaneMapping(agent, lane)
                laneMappings = apiClient.getLaneMapping().laneMapping
                postStatus("Lane mapping set: $agent -> $lane.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun createTaskTemplate(
        name: String,
        title: String,
        description: String?,
        notes: String?,
        priority: String,
        lane: String,
        labels: List<String>,
        onCreated: () -> Unit = {}
    ) {
        scope.launch {
            try {
                apiClient.createTemplate(
                    name = name,
                    title = title,
                    description = description,
                    notes = notes,
                    priority = priority,
                    lane = lane,
                    labels = labels
                )
                templates = apiClient.getTemplates().templates
                onCreated()
                postStatus("Template '$name' created.")
            } catch (e: ApiException) {
                postError("HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun runExport(tokenInput: String) {
        scope.launch {
            try {
                adminToken = tokenInput.trim()
                val creds = store.loadCredentials()
                store.saveCredentials(creds.copy(adminToken = adminToken))
                val payload = apiClient.exportData(adminToken)
                exportedJson = AgentBusApiClient.json.encodeToString(ExportPayload.serializer(), payload)
                postStatus("Exported ${payload.messages.size} messages and ${payload.agents.size} agents.")
            } catch (e: ApiException) {
                postError("Export HTTP ${e.statusCode}: ${e.error}")
            }
        }
    }

    fun runImport(rawJson: String, tokenInput: String, registerMissingSendersFirst: Boolean) {
        scope.launch {
            try {
                adminToken = tokenInput.trim()
                val creds = store.loadCredentials()
                store.saveCredentials(creds.copy(adminToken = adminToken))
                val parsed = AgentBusApiClient.json.decodeFromString<ExportPayload>(rawJson)
                if (registerMissingSendersFirst) {
                    val knownSet = registeredAgents.map { it.agent }.toSet()
                    val requiredSenders = parsed.messages.map { it.sender }.distinct()
                    for (sender in requiredSenders) {
                        if (sender !in knownSet && ValidationRules.isValidAgentName(sender)) {
                            runCatching { apiClient.registerAgent(sender) }
                        }
                    }
                    refreshAgents()
                }
                val res = apiClient.importData(parsed, adminToken)
                refreshFeed(preserveAnchor = true)
                stats = runCatching { apiClient.getStats() }.getOrNull() ?: stats
                postStatus("Imported ${res.imported} messages.")
            } catch (e: ApiException) {
                postError("Import HTTP ${e.statusCode}: ${e.error}")
            } catch (e: Exception) {
                postError("Import error: ${e.message}")
            }
        }
    }

    // ------------------------------------------------------------------------
    // Live Poll Stream (GET /poll?since_ts=&since_id=&admin=1)
    // ------------------------------------------------------------------------
    fun startLivePolling() {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive && isAuthenticated) {
                pollOnce()
                delay(4_000L)
            }
        }
    }

    suspend fun pollOnce() {
        if (!isAuthenticated) return
        try {
            val res = apiClient.poll(pollCursor.sinceTs, pollCursor.sinceId)
            lastPollResyncRequired = res.resyncRequired
            if (res.resyncRequired && (pollCursor.sinceTs > 0L || pollCursor.sinceId > 0)) {
                // Cursor expired / invalid per SPEC section 4 & 15 -> full reload, then advance cursor to latest event!
                fullReload(preserveFeedScroll = true)
            }
            if (res.events.isNotEmpty()) {
                var needsBoardRefresh = false
                var needsChannelsRefresh = false
                var needsAgentsRefresh = false
                var replyMap = feedPersistence.observedReplyTo
                var editedSet = feedPersistence.observedEditedIds
                var currentMsgs = messages

                for (ev in res.events) {
                    liveEventsCount++
                    when {
                        ev.type == "bus.message" -> {
                            val obj = ev.payload?.jsonObject
                            if (obj != null) {
                                val msg = runCatching {
                                    AgentBusApiClient.json.decodeFromJsonElement(MessageRecord.serializer(), obj)
                                }.getOrNull()
                                if (msg != null) {
                                    if (msg.replyTo != null) {
                                        replyMap = replyMap + (msg.id to msg.replyTo)
                                    }
                                    val matchesChannel = feedPersistence.channelFilter.isNullOrBlank() ||
                                        feedPersistence.channelFilter == msg.channel
                                    val matchesSender = feedPersistence.senderFilter.isNullOrBlank() ||
                                        feedPersistence.senderFilter == msg.sender
                                    val matchesPriority = feedPersistence.priorityFilter.isNullOrBlank() ||
                                        feedPersistence.priorityFilter == msg.priority
                                    val matchesQ = feedPersistence.searchQuery.isBlank() ||
                                        msg.body.contains(feedPersistence.searchQuery, ignoreCase = true)
                                    if (matchesChannel && matchesSender && matchesPriority && matchesQ) {
                                        if (currentMsgs.none { it.id == msg.id }) {
                                            currentMsgs = (listOf(msg) + currentMsgs).sortedByDescending { it.id }
                                        }
                                    }
                                }
                            }
                        }
                        ev.type == "bus.message.edited" -> {
                            val obj = ev.payload?.jsonObject
                            val editedId = obj?.get("id")?.jsonPrimitive?.intOrNull
                            val newBody = obj?.get("body")?.jsonPrimitive?.content
                            if (editedId != null) {
                                editedSet = editedSet + editedId
                                currentMsgs = currentMsgs.map { m ->
                                    if (m.id == editedId) {
                                        m.copy(
                                            body = newBody ?: m.body,
                                            observedEditedLive = true
                                        )
                                    } else m
                                }
                            }
                        }
                        ev.type == "bus.message.deleted" -> {
                            val obj = ev.payload?.jsonObject
                            val deletedId = obj?.get("id")?.jsonPrimitive?.intOrNull
                            if (deletedId != null) {
                                currentMsgs = currentMsgs.filterNot { it.id == deletedId }
                            }
                        }
                        ev.type.startsWith("kanban.") -> {
                            needsBoardRefresh = true
                        }
                        ev.type.startsWith("channel.") -> {
                            needsChannelsRefresh = true
                        }
                        ev.type.startsWith("agent.") -> {
                            needsAgentsRefresh = true
                        }
                    }
                }

                messages = currentMsgs
                if (replyMap != feedPersistence.observedReplyTo || editedSet != feedPersistence.observedEditedIds) {
                    feedPersistence = feedPersistence.copy(
                        observedReplyTo = replyMap,
                        observedEditedIds = editedSet
                    )
                    store.saveFeedPersistence(feedPersistence)
                }

                val last = res.events.last()
                val nextCursor = PollCursor(sinceTs = last.ts, sinceId = last.id)
                pollCursor = nextCursor
                store.savePollCursor(nextCursor)

                if (needsBoardRefresh) {
                    refreshBoard()
                    refreshNeeds()
                }
                if (needsChannelsRefresh) {
                    channels = runCatching { apiClient.getChannels().channels }.getOrDefault(channels)
                }
                if (needsAgentsRefresh) {
                    refreshAgents()
                }
            }
        } catch (_: Exception) {
        }
    }
}
