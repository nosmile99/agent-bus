package com.agentbus.admin.network

import com.agentbus.admin.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Base64

class AgentBusApiClient(
    baseUrl: String = DEFAULT_BASE_URL,
    private var username: String = "",
    private var password: String = "",
    private var adminToken: String = ""
) {
    companion object {
        const val DEFAULT_BASE_URL = "https://agent-bus-do.lukiznr.workers.dev"

        val json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
            isLenient = true
            explicitNulls = false
        }
    }

    @Volatile
    var currentBaseUrl: String = normalizeBaseUrl(baseUrl)
        private set

    fun updateConnection(
        baseUrl: String = currentBaseUrl,
        user: String = username,
        pass: String = password,
        token: String = adminToken
    ) {
        currentBaseUrl = normalizeBaseUrl(baseUrl)
        username = user
        password = pass
        adminToken = token
    }

    fun currentUsername(): String = username
    fun hasCredentials(): Boolean = username.isNotBlank() && password.isNotBlank()

    private fun normalizeBaseUrl(raw: String): String =
        raw.trim().removeSuffix("/").ifEmpty { DEFAULT_BASE_URL }

    private fun basicAuthHeader(user: String = username, pass: String = password): String {
        val raw = "$user:$pass"
        val encoded = Base64.getEncoder().encodeToString(raw.toByteArray(Charsets.UTF_8))
        return "Basic $encoded"
    }

    private fun encodePathSegment(segment: String): String =
        URLEncoder.encode(segment, "UTF-8").replace("+", "%20")

    private fun buildQuery(params: List<Pair<String, String?>>): String {
        val active = params.mapNotNull { (k, v) ->
            if (v.isNullOrEmpty()) null
            else "${URLEncoder.encode(k, "UTF-8")}=${URLEncoder.encode(v, "UTF-8")}"
        }
        return if (active.isEmpty()) "" else "?" + active.joinToString("&")
    }

    private suspend inline fun <reified T> request(
        method: String,
        path: String,
        bodyJson: String? = null,
        useAdminToken: Boolean = false,
        customAuthHeader: String? = null
    ): T = withContext(Dispatchers.IO) {
        val fullUrl = URL(currentBaseUrl + path)
        val conn = (fullUrl.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Accept", "application/json")
            if (customAuthHeader != null) {
                setRequestProperty("Authorization", customAuthHeader)
            } else if (useAdminToken) {
                setRequestProperty("X-Admin-Token", adminToken)
            } else if (username.isNotEmpty() || password.isNotEmpty()) {
                setRequestProperty("Authorization", basicAuthHeader())
            }
            if (bodyJson != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }

        try {
            if (bodyJson != null) {
                val bytes = bodyJson.toByteArray(Charsets.UTF_8)
                conn.outputStream.use { os ->
                    os.write(bytes)
                    os.flush()
                }
            }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val responseText = stream?.use {
                BufferedReader(InputStreamReader(it, Charsets.UTF_8)).readText()
            } ?: ""

            if (code !in 200..299) {
                val parsedErr = try {
                    json.decodeFromString<ErrorResponse>(responseText)
                } catch (_: Exception) {
                    null
                }
                val errMsg = parsedErr?.error?.takeIf { it.isNotBlank() }
                    ?: responseText.takeIf { it.isNotBlank() }
                    ?: "HTTP $code"
                throw ApiException(
                    statusCode = code,
                    error = errMsg,
                    laneConflict = parsedErr?.current,
                    rawBody = responseText
                )
            }

            json.decodeFromString<T>(responseText)
        } finally {
            conn.disconnect()
        }
    }

    // ------------------------------------------------------------------------
    // Section 1: Auth & Admin Account
    // ------------------------------------------------------------------------
    suspend fun verifyCredentials(baseUrl: String, user: String, pass: String): AdminStatsResponse {
        val prevUrl = currentBaseUrl
        return try {
            currentBaseUrl = normalizeBaseUrl(baseUrl)
            request<AdminStatsResponse>(
                method = "GET",
                path = "/admin/api/stats",
                customAuthHeader = basicAuthHeader(user, pass)
            )
        } catch (e: Exception) {
            currentBaseUrl = prevUrl
            throw e
        }
    }

    suspend fun changePassword(newUser: String?, newPassword: String): PasswordChangeResponse {
        if (!ValidationRules.isValidPassword(newPassword)) {
            throw ApiException(400, "newPassword required, min 12 chars")
        }
        val reqBody = buildMap<String, JsonElement> {
            val cleanUser = newUser?.trim()
            if (!cleanUser.isNullOrEmpty()) {
                put("newUser", JsonPrimitive(cleanUser))
            }
            put("newPassword", JsonPrimitive(newPassword))
        }
        return request(
            method = "POST",
            path = "/admin/api/password",
            bodyJson = json.encodeToString(JsonObject(reqBody))
        )
    }

    // ------------------------------------------------------------------------
    // Section 2: Overview Stats
    // ------------------------------------------------------------------------
    suspend fun getStats(): AdminStatsResponse =
        request("GET", "/admin/api/stats")

    // ------------------------------------------------------------------------
    // Section 3: Channels & Senders
    // ------------------------------------------------------------------------
    suspend fun getChannels(): ChannelsResponse =
        request("GET", "/admin/api/channels")

    suspend fun getSenders(): SendersResponse =
        request("GET", "/admin/api/senders")

    suspend fun createChannel(name: String): CreateChannelResponse {
        val clean = name.trim()
        if (clean.startsWith("dm:")) {
            throw ApiException(400, "dm channels are system-managed")
        }
        if (clean == "all-agent") {
            throw ApiException(400, "reserved channel name")
        }
        if (!ValidationRules.isValidCustomChannel(clean)) {
            throw ApiException(400, "invalid channel name")
        }
        return request(
            method = "POST",
            path = "/admin/api/channels",
            bodyJson = json.encodeToString(CreateChannelRequest(clean))
        )
    }

    suspend fun deleteChannel(channel: String): DeleteChannelResponse {
        if (ValidationRules.isSystemManagedChannel(channel)) {
            throw ApiException(400, "cannot delete all-agent or dm channels")
        }
        return request(
            method = "DELETE",
            path = "/admin/api/channels/${encodePathSegment(channel)}"
        )
    }

    suspend fun addChannelMember(channel: String, agent: String): ChannelMemberResponse {
        if (channel.startsWith("dm:")) {
            throw ApiException(400, "dm channels are system-managed")
        }
        if (channel == "all-agent") {
            throw ApiException(400, "all-agent membership is automatic")
        }
        return request(
            method = "POST",
            path = "/admin/api/channels/${encodePathSegment(channel)}/members",
            bodyJson = json.encodeToString(ChannelMemberRequest(agent.trim()))
        )
    }

    suspend fun removeChannelMember(channel: String, agent: String): ChannelMemberResponse {
        if (channel.startsWith("dm:")) {
            throw ApiException(400, "dm channels are system-managed")
        }
        if (channel == "all-agent") {
            throw ApiException(400, "cannot leave all-agent")
        }
        return request(
            method = "DELETE",
            path = "/admin/api/channels/${encodePathSegment(channel)}/members/${encodePathSegment(agent.trim())}"
        )
    }

    // ------------------------------------------------------------------------
    // Section 4: Feed Messages, Live Poll, Export/Import
    // ------------------------------------------------------------------------
    suspend fun getMessages(
        channel: String? = null,
        sender: String? = null,
        priority: String? = null,
        q: String? = null,
        since: Int? = null,
        limit: Int = 50
    ): MessagesResponse {
        val clampedLimit = limit.coerceIn(1, 200)
        val sanitizedQ = q?.replace("%", "")?.replace("_", "")?.takeIf { it.isNotBlank() }
        val query = buildQuery(
            listOf(
                "channel" to channel?.takeIf { it.isNotBlank() },
                "sender" to sender?.takeIf { it.isNotBlank() },
                "priority" to priority?.takeIf { it.isNotBlank() },
                "q" to sanitizedQ,
                "since" to since?.takeIf { it > 0 }?.toString(),
                "limit" to clampedLimit.toString()
            )
        )
        return request("GET", "/admin/api/messages$query")
    }

    suspend fun sendMessage(
        channel: String,
        body: String,
        priority: String = TaskPriority.NORMAL,
        audience: String = Audience.AGENTS,
        replyTo: Int? = null
    ): SendMessageResponse {
        val cleanChannel = channel.trim()
        if (cleanChannel.isEmpty() || body.isEmpty()) {
            throw ApiException(400, "channel and body required")
        }
        if (!ValidationRules.isWithinBodyCap(body)) {
            throw ApiException(413, "body too large (max 8192 bytes)")
        }
        if (!ValidationRules.isValidSendChannel(cleanChannel)) {
            throw ApiException(400, "invalid channel name")
        }
        val payload = buildMap<String, JsonElement> {
            put("channel", JsonPrimitive(cleanChannel))
            put("body", JsonPrimitive(body))
            put("priority", JsonPrimitive(priority))
            put("audience", JsonPrimitive(audience))
            if (replyTo != null) {
                put("reply_to", JsonPrimitive(replyTo))
            }
        }
        return request(
            method = "POST",
            path = "/admin/api/send",
            bodyJson = json.encodeToString(JsonObject(payload))
        )
    }

    suspend fun editMessage(
        id: Int,
        body: String? = null,
        priority: String? = null,
        channel: String? = null
    ): BasicOkIdResponse {
        if (body != null && !ValidationRules.isWithinBodyCap(body)) {
            throw ApiException(413, "body too large (max 8192 bytes)")
        }
        val payload = buildMap<String, JsonElement> {
            if (!body.isNullOrEmpty()) put("body", JsonPrimitive(body))
            if (!priority.isNullOrEmpty()) put("priority", JsonPrimitive(priority))
            if (!channel.isNullOrEmpty()) put("channel", JsonPrimitive(channel))
        }
        if (payload.isEmpty()) {
            throw ApiException(400, "nothing to update")
        }
        return request(
            method = "PUT",
            path = "/admin/api/messages/$id",
            bodyJson = json.encodeToString(JsonObject(payload))
        )
    }

    suspend fun deleteMessage(id: Int): BasicOkIdResponse =
        request("DELETE", "/admin/api/messages/$id")

    suspend fun poll(sinceTs: Long, sinceId: Int): PollResponse {
        val safeTs = sinceTs.coerceAtLeast(0L)
        val safeId = sinceId.coerceAtLeast(0)
        return request("GET", "/poll?since_ts=$safeTs&since_id=$safeId&admin=1")
    }

    suspend fun exportData(customAdminToken: String? = null): ExportPayload {
        if (!customAdminToken.isNullOrBlank()) {
            adminToken = customAdminToken.trim()
        }
        return request(
            method = "GET",
            path = "/admin/export",
            useAdminToken = true
        )
    }

    suspend fun importData(payload: ExportPayload, customAdminToken: String? = null): ImportResponse {
        if (!customAdminToken.isNullOrBlank()) {
            adminToken = customAdminToken.trim()
        }
        return request(
            method = "POST",
            path = "/admin/import",
            bodyJson = json.encodeToString(payload),
            useAdminToken = true
        )
    }

    // ------------------------------------------------------------------------
    // Section 5: Kanban Projects
    // ------------------------------------------------------------------------
    suspend fun getProjects(): ProjectsResponse =
        request("GET", "/admin/api/kanban/projects")

    suspend fun createProject(
        title: String,
        description: String? = null,
        subscribers: List<String>? = null
    ): BasicOkIdResponse {
        val cleanTitle = title.trim()
        if (cleanTitle.isEmpty()) {
            throw ApiException(400, "title required")
        }
        val payload = buildMap<String, JsonElement> {
            put("title", JsonPrimitive(cleanTitle))
            if (description != null) put("description", JsonPrimitive(description))
            if (subscribers != null) {
                put("subscribers", JsonArray(subscribers.map { JsonPrimitive(it) }))
            }
        }
        return request(
            method = "POST",
            path = "/admin/api/kanban/projects",
            bodyJson = json.encodeToString(JsonObject(payload))
        )
    }

    suspend fun updateProject(
        id: Int,
        title: String? = null,
        description: String? = null,
        includeDescription: Boolean = false,
        archived: Int? = null,
        subscribers: List<String>? = null
    ): BasicOkIdResponse {
        val payload = buildMap<String, JsonElement> {
            if (title != null && title.trim().isNotEmpty()) {
                put("title", JsonPrimitive(title.trim()))
            }
            if (includeDescription) {
                put("description", description?.let { JsonPrimitive(it) } ?: JsonNull)
            }
            if (archived != null) {
                put("archived", JsonPrimitive(if (archived != 0) 1 else 0))
            }
            if (subscribers != null) {
                put("subscribers", JsonArray(subscribers.map { JsonPrimitive(it) }))
            }
        }
        if (payload.isEmpty()) {
            throw ApiException(400, "nothing to update")
        }
        return request(
            method = "PUT",
            path = "/admin/api/kanban/projects/$id",
            bodyJson = json.encodeToString(JsonObject(payload))
        )
    }

    suspend fun deleteProject(id: Int): BasicOkIdResponse =
        request("DELETE", "/admin/api/kanban/projects/$id")

    suspend fun getProjectSubscribers(id: Int): ProjectSubscribersResponse =
        request("GET", "/admin/api/kanban/projects/$id/subscribers")

    suspend fun getProjectLabels(id: Int): ProjectLabelsResponse =
        request("GET", "/admin/api/kanban/projects/$id/labels")

    // ------------------------------------------------------------------------
    // Section 6: Kanban Tasks
    // ------------------------------------------------------------------------
    suspend fun getProjectTasks(projectId: Int): TasksResponse =
        request("GET", "/admin/api/kanban/projects/$projectId/tasks")

    suspend fun getTaskDetail(taskId: Int): TaskRecord =
        request<TaskDetailEnvelope>("GET", "/admin/api/kanban/tasks/$taskId").task

    suspend fun createTask(
        projectId: Int,
        title: String? = null,
        description: String? = null,
        notes: String? = null,
        priority: String? = null,
        assignee: String? = null,
        explicitNullAssignee: Boolean = false,
        lane: String? = null,
        dueDate: Long? = null,
        template: String? = null,
        templateVars: Map<String, String>? = null,
        labels: List<String>? = null
    ): CreateTaskResponse {
        if (lane != null && !ValidationRules.isValidLane(lane)) {
            throw ApiException(400, "invalid lane")
        }
        if (priority != null && !ValidationRules.isValidPriority(priority)) {
            throw ApiException(400, "invalid priority")
        }
        val normalizedLabels = if (labels != null) {
            ValidationRules.normalizeAndValidateLabels(labels).getOrElse {
                throw ApiException(400, "invalid label")
            }
        } else null

        val payload = buildMap<String, JsonElement> {
            if (!title.isNullOrBlank()) put("title", JsonPrimitive(title.trim()))
            if (description != null) put("description", JsonPrimitive(description))
            if (notes != null) put("notes", JsonPrimitive(notes))
            if (priority != null) put("priority", JsonPrimitive(priority))
            if (explicitNullAssignee) {
                put("assignee", JsonNull)
            } else if (!assignee.isNullOrBlank()) {
                put("assignee", JsonPrimitive(assignee.trim()))
            }
            if (lane != null) put("lane", JsonPrimitive(lane))
            if (dueDate != null) put("due_date", JsonPrimitive(dueDate))
            if (!template.isNullOrBlank()) put("template", JsonPrimitive(template.trim()))
            if (!templateVars.isNullOrEmpty()) {
                put("template_vars", JsonObject(templateVars.mapValues { JsonPrimitive(it.value) }))
            }
            if (normalizedLabels != null) {
                put("labels", JsonArray(normalizedLabels.map { JsonPrimitive(it) }))
            }
        }

        return request(
            method = "POST",
            path = "/admin/api/kanban/projects/$projectId/tasks",
            bodyJson = json.encodeToString(JsonObject(payload))
        )
    }

    suspend fun updateTask(
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
        unblock: Boolean? = null
    ): UpdateTaskResponse {
        if (status == TaskStatus.BLOCKED) {
            if (blockedKind != null && !ValidationRules.isValidBlockedKind(blockedKind)) {
                throw ApiException(400, "blocked_kind must be waiting-human|waiting-task|waiting-external")
            }
            if (blockedReason != null && !ValidationRules.isValidBlockedReason(blockedReason)) {
                throw ApiException(400, "blocked_reason required when status=blocked")
            }
        } else if (status != null && (blockedKind != null || !blockedReason.isNullOrBlank())) {
            throw ApiException(400, "blocked_kind only valid with status=blocked")
        }

        val payload = buildMap<String, JsonElement> {
            if (title != null) put("title", JsonPrimitive(title.trim()))
            if (includeDescription) put("description", description?.let { JsonPrimitive(it) } ?: JsonNull)
            if (includeNotes) put("notes", notes?.let { JsonPrimitive(it) } ?: JsonNull)
            if (status != null) put("status", JsonPrimitive(status))
            if (priority != null) put("priority", JsonPrimitive(priority))
            if (includeAssignee) {
                put("assignee", assignee?.takeIf { it.isNotBlank() }?.let { JsonPrimitive(it.trim()) } ?: JsonNull)
            }
            if (blockedKind != null) put("blocked_kind", JsonPrimitive(blockedKind))
            if (blockedReason != null) put("blocked_reason", JsonPrimitive(blockedReason.trim()))
            if (includeDueDate) put("due_date", dueDate?.let { JsonPrimitive(it) } ?: JsonNull)
            if (lane != null) put("lane", JsonPrimitive(lane))
            if (!comment.isNullOrBlank()) put("comment", JsonPrimitive(comment.trim()))
            if (unblock == true) put("unblock", JsonPrimitive(true))
        }

        if (payload.isEmpty()) {
            throw ApiException(400, "nothing to update")
        }

        return request(
            method = "PUT",
            path = "/admin/api/kanban/tasks/$taskId",
            bodyJson = json.encodeToString(JsonObject(payload))
        )
    }

    suspend fun deleteTask(taskId: Int): BasicOkIdResponse =
        request("DELETE", "/admin/api/kanban/tasks/$taskId")

    // ------------------------------------------------------------------------
    // Section 7: Task Todos
    // ------------------------------------------------------------------------
    suspend fun createTodo(taskId: Int, text: String, sortOrder: Int = 0): BasicOkIdResponse {
        val clean = text.trim()
        if (clean.isEmpty()) throw ApiException(400, "text required")
        return request(
            method = "POST",
            path = "/admin/api/kanban/tasks/$taskId/todos",
            bodyJson = json.encodeToString(CreateTodoRequest(text = clean, sortOrder = sortOrder))
        )
    }

    suspend fun updateTodo(
        todoId: Int,
        text: String? = null,
        done: Boolean? = null,
        sortOrder: Int? = null
    ): BasicOkIdResponse {
        val payload = buildMap<String, JsonElement> {
            if (!text.isNullOrBlank()) put("text", JsonPrimitive(text.trim()))
            if (done != null) put("done", JsonPrimitive(if (done) 1 else 0))
            if (sortOrder != null) put("sort_order", JsonPrimitive(sortOrder))
        }
        if (payload.isEmpty()) throw ApiException(400, "nothing to update")
        return request(
            method = "PUT",
            path = "/admin/api/kanban/todos/$todoId",
            bodyJson = json.encodeToString(JsonObject(payload))
        )
    }

    suspend fun deleteTodo(todoId: Int): BasicOkIdResponse =
        request("DELETE", "/admin/api/kanban/todos/$todoId")

    // ------------------------------------------------------------------------
    // Section 8: Task Comments
    // ------------------------------------------------------------------------
    suspend fun getTaskComments(taskId: Int): CommentsResponse =
        request("GET", "/admin/api/kanban/tasks/$taskId/comments")

    suspend fun addTaskComment(taskId: Int, body: String): BasicOkIdResponse {
        val clean = body.trim()
        if (clean.isEmpty()) throw ApiException(400, "body required")
        if (!ValidationRules.isWithinBodyCap(clean)) {
            throw ApiException(413, "body too large (max 8192 bytes)")
        }
        return request(
            method = "POST",
            path = "/admin/api/kanban/tasks/$taskId/comments",
            bodyJson = json.encodeToString(CreateCommentRequest(clean))
        )
    }

    // ------------------------------------------------------------------------
    // Section 9: Task Labels
    // ------------------------------------------------------------------------
    suspend fun addTaskLabel(taskId: Int, rawLabel: String): BasicOkResponse {
        val clean = ValidationRules.normalizeAndValidateLabel(rawLabel)
            ?: throw ApiException(400, "invalid label")
        return request(
            method = "POST",
            path = "/admin/api/kanban/tasks/$taskId/labels",
            bodyJson = json.encodeToString(AddLabelRequest(clean))
        )
    }

    suspend fun removeTaskLabel(taskId: Int, rawLabel: String): BasicOkResponse {
        val clean = ValidationRules.normalizeAndValidateLabel(rawLabel)
            ?: throw ApiException(400, "invalid label")
        return request(
            method = "DELETE",
            path = "/admin/api/kanban/tasks/$taskId/labels/${encodePathSegment(clean)}"
        )
    }

    // ------------------------------------------------------------------------
    // Section 10: Kanban Search, Activity, and Summary
    // ------------------------------------------------------------------------
    private fun searchQueryList(opts: TaskSearchOpts, isGlobal: Boolean): List<Pair<String, String?>> =
        listOf(
            "global" to if (isGlobal) "1" else null,
            "q" to opts.q?.takeIf { it.isNotBlank() },
            "status" to opts.status?.takeIf { it.isNotBlank() },
            "assignee" to opts.assignee?.takeIf { it.isNotBlank() },
            "label" to opts.label?.takeIf { it.isNotBlank() }?.lowercase(),
            "blocked_kind" to opts.blockedKind?.takeIf { it.isNotBlank() },
            "priority" to opts.priority?.takeIf { it.isNotBlank() },
            "lane" to opts.lane?.takeIf { it.isNotBlank() },
            "stale" to if (opts.stale) "1" else null,
            "due_date_from" to opts.dueDateFrom?.toString(),
            "due_date_to" to opts.dueDateTo?.toString(),
            "due_date" to opts.dueDateFilter?.takeIf { it.isNotBlank() },
            "sort" to opts.sort?.takeIf { it.isNotBlank() },
            "include_archived" to if (opts.includeArchived) "1" else null
        )

    suspend fun searchTasksGlobal(opts: TaskSearchOpts = TaskSearchOpts()): TasksResponse {
        val query = buildQuery(searchQueryList(opts, isGlobal = true))
        return request("GET", "/admin/api/kanban/tasks/search$query")
    }

    suspend fun searchProjectTasks(projectId: Int, opts: TaskSearchOpts = TaskSearchOpts()): TasksResponse {
        val query = buildQuery(searchQueryList(opts, isGlobal = false))
        return request("GET", "/admin/api/kanban/projects/$projectId/tasks/search$query")
    }

    suspend fun getActivity(
        limit: Int = 50,
        projectId: Int? = null,
        agent: String? = null,
        lane: String? = null,
        before: Int? = null
    ): ActivityResponse {
        if (limit < 1) throw ApiException(400, "invalid limit")
        val clamped = limit.coerceAtMost(200)
        val query = buildQuery(
            listOf(
                "limit" to clamped.toString(),
                "project_id" to projectId?.toString(),
                "agent" to agent?.takeIf { it.isNotBlank() },
                "lane" to lane?.takeIf { it.isNotBlank() },
                "before" to before?.toString()
            )
        )
        return request("GET", "/admin/api/kanban/activity$query")
    }

    suspend fun getSummary(projectId: Int? = null, includeArchived: Boolean = false): KanbanSummaryResponse {
        return if (projectId != null) {
            request("GET", "/admin/api/kanban/projects/$projectId/summary")
        } else {
            val query = buildQuery(
                listOf("include_archived" to if (includeArchived) "1" else null)
            )
            request("GET", "/admin/api/kanban/summary$query")
        }
    }

    // ------------------------------------------------------------------------
    // Section 11: Agents
    // ------------------------------------------------------------------------
    suspend fun getRegisteredAgents(): RegisteredAgentsResponse =
        request("GET", "/admin/api/registered")

    suspend fun getLiveAgents(): LiveAgentsResponse =
        request("GET", "/admin/api/agents")

    suspend fun registerAgent(agent: String): RegisterAgentResponse {
        val clean = agent.trim()
        if (!ValidationRules.isValidAgentName(clean)) {
            throw ApiException(400, "invalid agent name (lowercase alnum, _-, max 32)")
        }
        return request(
            method = "POST",
            path = "/admin/api/agents",
            bodyJson = json.encodeToString(RegisterAgentRequest(clean))
        )
    }

    suspend fun deleteAgent(agent: String): DeleteAgentResponse =
        request("DELETE", "/admin/api/agents/${encodePathSegment(agent.trim())}")

    suspend fun rotateAgentSecret(agent: String): RotateAgentResponse =
        request("POST", "/admin/api/agents/${encodePathSegment(agent.trim())}/rotate")

    // ------------------------------------------------------------------------
    // Section 12: WIP & Lane Mapping
    // ------------------------------------------------------------------------
    suspend fun getWipConfig(): WipConfigResponse =
        request("GET", "/admin/api/kanban/wip")

    suspend fun updateWipConfig(perAssigneeDoingLimit: Int?): WipConfigUpdateResponse {
        if (perAssigneeDoingLimit != null && perAssigneeDoingLimit < 1) {
            throw ApiException(400, "per_assignee_doing_limit must be a positive integer or null")
        }
        val payload = JsonObject(
            mapOf(
                "per_assignee_doing_limit" to (perAssigneeDoingLimit?.let { JsonPrimitive(it) } ?: JsonNull)
            )
        )
        return request(
            method = "PUT",
            path = "/admin/api/kanban/wip",
            bodyJson = json.encodeToString(payload)
        )
    }

    suspend fun getLaneMapping(): LaneMappingResponse =
        request("GET", "/admin/api/kanban/lane-mapping")

    suspend fun updateLaneMapping(agent: String, lane: String): LaneMappingUpdateResponse {
        val cleanAgent = agent.trim()
        if (cleanAgent.isEmpty()) throw ApiException(400, "agent required")
        if (!ValidationRules.isValidLane(lane)) throw ApiException(400, "invalid lane")
        return request(
            method = "PUT",
            path = "/admin/api/kanban/lane-mapping",
            bodyJson = json.encodeToString(LaneMappingUpdateRequest(cleanAgent, lane))
        )
    }

    // ------------------------------------------------------------------------
    // Section 13: Task Templates
    // ------------------------------------------------------------------------
    suspend fun getTemplates(): TemplatesResponse =
        request("GET", "/admin/api/kanban/templates")

    suspend fun createTemplate(
        name: String,
        title: String,
        description: String? = null,
        notes: String? = null,
        priority: String = TaskPriority.NORMAL,
        lane: String,
        labels: List<String> = emptyList()
    ): CreateTemplateResponse {
        val cleanName = name.trim()
        val cleanTitle = title.trim()
        if (cleanName.isEmpty()) throw ApiException(400, "name required")
        if (cleanTitle.isEmpty()) throw ApiException(400, "title required")
        if (!ValidationRules.isValidLane(lane)) throw ApiException(400, "invalid lane")
        if (!ValidationRules.isValidPriority(priority)) throw ApiException(400, "invalid priority")
        val validLabels = ValidationRules.normalizeAndValidateLabels(labels).getOrElse {
            throw ApiException(400, "invalid label")
        }
        return request(
            method = "POST",
            path = "/admin/api/kanban/templates",
            bodyJson = json.encodeToString(
                CreateTemplateRequest(
                    name = cleanName,
                    title = cleanTitle,
                    description = description ?: "",
                    notes = notes ?: "",
                    priority = priority,
                    lane = lane,
                    labels = validLabels
                )
            )
        )
    }
}
