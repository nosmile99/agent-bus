package com.agentbus.admin.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

object TaskStatus {
    const val TODO = "todo"
    const val DOING = "doing"
    const val DONE = "done"
    const val BLOCKED = "blocked"
    val ALL = listOf(TODO, DOING, BLOCKED, DONE)
}

object TaskPriority {
    const val LOW = "low"
    const val NORMAL = "normal"
    const val URGENT = "urgent"
    val ALL = listOf(LOW, NORMAL, URGENT)
}

object BlockedKind {
    const val WAITING_HUMAN = "waiting-human"
    const val WAITING_TASK = "waiting-task"
    const val WAITING_EXTERNAL = "waiting-external"
    val ALL = listOf(WAITING_HUMAN, WAITING_TASK, WAITING_EXTERNAL)
}

object TaskLane {
    const val BACKEND = "backend"
    const val ANDROID = "android"
    const val UNASSIGNED = "unassigned"
    val ALL = listOf(BACKEND, ANDROID, UNASSIGNED)
}

object Audience {
    const val AGENTS = "agents"
    const val LUKI = "luki"
    val ALL = listOf(AGENTS, LUKI)
}

object ValidationRules {
    const val MAX_BODY_BYTES = 8192
    private val CHANNEL_REGEX = Regex("^[a-z0-9][a-z0-9_-]{0,31}$")
    private val DM_REGEX = Regex("^dm:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$")
    private val AGENT_REGEX = Regex("^[a-z0-9][a-z0-9_-]{0,31}$")
    private val LABEL_REGEX = Regex("^[a-z0-9_-]{1,32}$")
    private val PLACEHOLDER_REGEX = Regex("\\{([a-zA-Z0-9_]+)\\}")

    fun isValidPassword(password: String): Boolean = password.length >= 12

    fun isValidCustomChannel(name: String): Boolean {
        if (name == "all-agent" || name.startsWith("dm:")) return false
        return CHANNEL_REGEX.matches(name)
    }

    fun isValidSendChannel(name: String): Boolean {
        if (name == "all-agent") return true
        if (name.startsWith("dm:")) return DM_REGEX.matches(name)
        return CHANNEL_REGEX.matches(name)
    }

    fun formatDmChannel(partyA: String, partyB: String): String {
        val a = partyA.trim()
        val b = partyB.trim()
        return if (a <= b) "dm:$a:$b" else "dm:$b:$a"
    }

    fun isSystemManagedChannel(name: String): Boolean =
        name == "all-agent" || name.startsWith("dm:")

    fun isValidAgentName(name: String): Boolean = AGENT_REGEX.matches(name.trim())

    fun normalizeAndValidateLabel(raw: String): String? {
        val clean = raw.trim().lowercase()
        return if (LABEL_REGEX.matches(clean)) clean else null
    }

    fun normalizeAndValidateLabels(rawList: List<String>): Result<List<String>> {
        val seen = linkedSetOf<String>()
        for (item in rawList) {
            val clean = normalizeAndValidateLabel(item)
                ?: return Result.failure(IllegalArgumentException("invalid label: $item"))
            seen.add(clean)
        }
        return Result.success(seen.toList())
    }

    fun isValidBlockedReason(reason: String?): Boolean {
        if (reason == null) return false
        val trimmed = reason.trim()
        return trimmed.length in 1..280
    }

    fun isValidBlockedKind(kind: String?): Boolean =
        kind != null && kind in BlockedKind.ALL

    fun isValidLane(lane: String?): Boolean =
        lane != null && lane in TaskLane.ALL

    fun isValidPriority(priority: String?): Boolean =
        priority != null && priority in TaskPriority.ALL

    fun isValidStatus(status: String?): Boolean =
        status != null && status in TaskStatus.ALL

    fun utf8ByteLength(text: String): Int = text.toByteArray(Charsets.UTF_8).size

    fun isWithinBodyCap(text: String): Boolean = utf8ByteLength(text) <= MAX_BODY_BYTES

    fun extractTemplatePlaceholders(template: TaskTemplateRecord): List<String> {
        val keys = linkedSetOf<String>()
        listOfNotNull(template.title, template.description, template.notes).forEach { field ->
            PLACEHOLDER_REGEX.findAll(field).forEach { match ->
                keys.add(match.groupValues[1])
            }
        }
        return keys.toList()
    }
}

class ApiException(
    val statusCode: Int,
    val error: String,
    val laneConflict: LaneChangeConflictCurrent? = null,
    val rawBody: String = ""
) : Exception("HTTP $statusCode: $error")

@Serializable
data class ErrorResponse(
    val error: String = "unknown error",
    val reason: String? = null,
    val current: LaneChangeConflictCurrent? = null
)

@Serializable
data class LaneChangeConflictCurrent(
    val assignee: String? = null,
    val status: String? = null,
    val lane: String? = null
)

// Section 1: Auth & Password
@Serializable
data class PasswordChangeRequest(
    val newUser: String? = null,
    val newPassword: String
)

@Serializable
data class PasswordChangeResponse(
    val ok: Boolean = false,
    val user: String = ""
)

// Section 2: Stats
@Serializable
data class ChannelCountItem(
    val channel: String,
    val count: Int
)

@Serializable
data class AdminStatsResponse(
    val messagesToday: Int = 0,
    val totalMessages: Int = 0,
    val perChannel: List<ChannelCountItem> = emptyList(),
    val registeredAgents: Int = 0,
    val doStatus: String = "ok",
    val ts: String = ""
)

// Section 3: Channels & Senders
@Serializable
data class ChannelInfo(
    val name: String,
    val members: List<String> = emptyList()
)

@Serializable
data class ChannelsResponse(
    val channels: List<ChannelInfo> = emptyList()
)

@Serializable
data class SendersResponse(
    val senders: List<String> = emptyList()
)

@Serializable
data class CreateChannelRequest(
    val name: String
)

@Serializable
data class CreateChannelResponse(
    val ok: Boolean = false,
    val name: String = ""
)

@Serializable
data class DeleteChannelResponse(
    val ok: Boolean = false,
    val channel: String = "",
    val deleted: Int = 0
)

@Serializable
data class ChannelMemberRequest(
    val agent: String
)

@Serializable
data class ChannelMemberResponse(
    val ok: Boolean = false,
    val channel: String = "",
    val agent: String = ""
)

// Section 4: Messages, Poll & Export/Import
@Serializable
data class MessageRecord(
    val id: Int,
    val sender: String,
    val channel: String,
    val priority: String = TaskPriority.NORMAL,
    val audience: String = Audience.AGENTS,
    val ts: String,
    val body: String,
    @SerialName("reply_to") val replyTo: Int? = null,
    @SerialName("edit_version") val editVersion: Int? = null,
    @SerialName("edited_at") val editedAt: Long? = null,
    @SerialName("deleted_at") val deletedAt: Long? = null,
    val observedEditedLive: Boolean = false
)

@Serializable
data class MessagesResponse(
    val messages: List<MessageRecord> = emptyList()
)

@Serializable
data class SendMessageRequest(
    val channel: String,
    val body: String,
    val priority: String = TaskPriority.NORMAL,
    val audience: String = Audience.AGENTS,
    @SerialName("reply_to") val replyTo: Int? = null
)

@Serializable
data class SendMessageResponse(
    val ok: Boolean = false,
    val id: Int = 0
)

@Serializable
data class EditMessageRequest(
    val body: String? = null,
    val priority: String? = null,
    val channel: String? = null
)

@Serializable
data class BasicOkIdResponse(
    val ok: Boolean = false,
    val id: Int = 0
)

@Serializable
data class PollEvent(
    val id: Int,
    val type: String,
    val ts: Long,
    val actor: String? = null,
    @SerialName("project_id") val projectId: Int? = null,
    val scope: String = "all",
    val recipients: List<String>? = null,
    val payload: JsonElement? = null
)

@Serializable
data class PollResponse(
    val events: List<PollEvent> = emptyList(),
    @SerialName("resync_required") val resyncRequired: Boolean = false
)

@Serializable
data class ExportAgentItem(
    val agent: String,
    val created: String
)

@Serializable
data class ExportPayload(
    val messages: List<MessageRecord> = emptyList(),
    val agents: List<ExportAgentItem> = emptyList()
)

@Serializable
data class ImportResponse(
    val ok: Boolean = false,
    val imported: Int = 0
)

// Section 5: Kanban Projects
@Serializable
data class ProjectRecord(
    val id: Int,
    val title: String,
    val description: String? = null,
    @SerialName("created_by") val createdBy: String? = null,
    @SerialName("created_at") val createdAt: Long = 0L,
    val archived: Int = 0,
    @SerialName("task_count") val taskCount: Int = 0
) {
    val isArchived: Boolean get() = archived != 0
}

@Serializable
data class ProjectsResponse(
    val projects: List<ProjectRecord> = emptyList()
)

@Serializable
data class CreateProjectRequest(
    val title: String,
    val description: String? = null,
    val subscribers: List<String>? = null
)

@Serializable
data class UpdateProjectRequest(
    val title: String? = null,
    val description: String? = null,
    val archived: Int? = null,
    val subscribers: List<String>? = null
)

@Serializable
data class ProjectSubscriberRecord(
    @SerialName("project_id") val projectId: Int = 0,
    val agent: String,
    @SerialName("added_by") val addedBy: String = "admin",
    @SerialName("added_at") val addedAt: Long = 0L
)

object FlexibleSubscribersSerializer : KSerializer<List<ProjectSubscriberRecord>> {
    private val delegate = ListSerializer(ProjectSubscriberRecord.serializer())
    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun deserialize(decoder: Decoder): List<ProjectSubscriberRecord> {
        val jsonDecoder = decoder as? JsonDecoder ?: return delegate.deserialize(decoder)
        val element = jsonDecoder.decodeJsonElement()
        if (element !is JsonArray) return emptyList()
        return element.mapNotNull { item ->
            when (item) {
                is JsonPrimitive -> item.contentOrNull?.let { ProjectSubscriberRecord(agent = it) }
                is JsonObject -> {
                    val agent = item["agent"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                    ProjectSubscriberRecord(
                        projectId = item["project_id"]?.jsonPrimitive?.intOrNull ?: 0,
                        agent = agent,
                        addedBy = item["added_by"]?.jsonPrimitive?.contentOrNull ?: "admin",
                        addedAt = item["added_at"]?.jsonPrimitive?.longOrNull ?: 0L
                    )
                }
                else -> null
            }
        }
    }

    override fun serialize(encoder: Encoder, value: List<ProjectSubscriberRecord>) {
        delegate.serialize(encoder, value)
    }
}

@Serializable
data class ProjectSubscribersResponse(
    @Serializable(with = FlexibleSubscribersSerializer::class)
    val subscribers: List<ProjectSubscriberRecord> = emptyList()
)

@Serializable
data class ProjectLabelsResponse(
    val labels: List<String> = emptyList()
)

// Section 6 & 7: Tasks & Todos
@Serializable
data class TodoRecord(
    val id: Int,
    @SerialName("task_id") val taskId: Int,
    val text: String,
    val done: Int = 0,
    @SerialName("sort_order") val sortOrder: Int = 0
) {
    val isDone: Boolean get() = done != 0
}

@Serializable
data class TaskRecord(
    val id: Int,
    @SerialName("project_id") val projectId: Int,
    val title: String,
    val description: String? = null,
    val status: String = TaskStatus.TODO,
    val assignee: String? = null,
    @SerialName("admin_assigned") val adminAssigned: String? = null,
    val priority: String = TaskPriority.NORMAL,
    @SerialName("created_at") val createdAt: Long = 0L,
    @SerialName("updated_at") val updatedAt: Long = 0L,
    @SerialName("claimed_at") val claimedAt: Long? = null,
    @SerialName("blocked_kind") val blockedKind: String? = null,
    @SerialName("blocked_reason") val blockedReason: String? = null,
    @SerialName("status_changed_at") val statusChangedAt: Long? = null,
    @SerialName("last_activity_at") val lastActivityAt: Long? = null,
    @SerialName("stale_notified_at") val staleNotifiedAt: Long? = null,
    val notes: String? = null,
    @SerialName("created_by") val createdBy: String? = null,
    @SerialName("due_date") val dueDate: Long? = null,
    val lane: String = TaskLane.UNASSIGNED,
    val todos: List<TodoRecord> = emptyList(),
    val labels: List<String> = emptyList(),
    @SerialName("comment_count") val commentCount: Int = 0,
    @SerialName("activity_count") val activityCount: Int = 0
) {
    fun isStale(nowEpochSec: Long): Boolean =
        status == TaskStatus.DOING && (lastActivityAt ?: updatedAt) < (nowEpochSec - 86400L)
}

@Serializable
data class TasksResponse(
    val tasks: List<TaskRecord> = emptyList()
)

@Serializable
data class TaskDetailEnvelope(
    val task: TaskRecord
)

@Serializable
data class CreateTaskResponse(
    val ok: Boolean = false,
    val id: Int = 0,
    val lane: String = TaskLane.UNASSIGNED,
    val assignee: String? = null
)

@Serializable
data class WipWarning(
    val assignee: String,
    @SerialName("doing_count") val doingCount: Int,
    val limit: Int
)

@Serializable
data class UpdateTaskResponse(
    val ok: Boolean = false,
    val id: Int = 0,
    @SerialName("wip_warning") val wipWarning: WipWarning? = null
)

@Serializable
data class CreateTodoRequest(
    val text: String,
    @SerialName("sort_order") val sortOrder: Int = 0
)

// Section 8: Comments
@Serializable
data class TaskCommentRecord(
    val id: Int,
    @SerialName("task_id") val taskId: Int = 0,
    val author: String,
    val body: String,
    val ts: Long
) {
    val isSystemLog: Boolean get() = author == "system"
}

@Serializable
data class CommentsResponse(
    val comments: List<TaskCommentRecord> = emptyList()
)

@Serializable
data class CreateCommentRequest(
    val body: String
)

// Section 9: Labels
@Serializable
data class AddLabelRequest(
    val label: String
)

@Serializable
data class BasicOkResponse(
    val ok: Boolean = false
)

// Section 10: Search, Activity & Summary
data class TaskSearchOpts(
    val q: String? = null,
    val status: String? = null,
    val assignee: String? = null,
    val label: String? = null,
    val blockedKind: String? = null,
    val priority: String? = null,
    val lane: String? = null,
    val stale: Boolean = false,
    val dueDateFrom: Long? = null,
    val dueDateTo: Long? = null,
    val dueDateFilter: String? = null, // "overdue" | "none" | null
    val sort: String? = null,          // "default" | "blocked_since" | null
    val includeArchived: Boolean = false,
    val subscriberAgent: String? = null,
    val projectIds: List<Int>? = null
)

@Serializable
data class ActivityRecord(
    val id: Int,
    @SerialName("task_id") val taskId: Int,
    @SerialName("project_id") val projectId: Int,
    @SerialName("task_title") val taskTitle: String,
    @SerialName("task_status") val taskStatus: String,
    @SerialName("task_lane") val taskLane: String = TaskLane.UNASSIGNED,
    @SerialName("task_assignee") val taskAssignee: String? = null,
    val author: String,
    @SerialName("is_system") val isSystem: Boolean = false,
    val body: String,
    val ts: Long
)

@Serializable
data class ActivityResponse(
    val activity: List<ActivityRecord> = emptyList()
)

@Serializable
data class StatusCounts(
    val todo: Int = 0,
    val doing: Int = 0,
    val blocked: Int = 0,
    val done: Int = 0
) {
    val total: Int get() = todo + doing + blocked + done
}

@Serializable
data class LaneCounts(
    val backend: Int = 0,
    val android: Int = 0,
    val unassigned: Int = 0
)

@Serializable
data class KanbanSummaryResponse(
    @SerialName("by_status") val byStatus: StatusCounts = StatusCounts(),
    @SerialName("by_lane") val byLane: LaneCounts = LaneCounts(),
    @SerialName("by_assignee") val byAssignee: Map<String, StatusCounts> = emptyMap(),
    @SerialName("stale_count") val staleCount: Int = 0,
    @SerialName("overdue_count") val overdueCount: Int = 0,
    @SerialName("needs_human_count") val needsHumanCount: Int = 0
)

// Section 11: Agents
@Serializable
data class AgentRateUsage(
    val used: Int = 0,
    val limit: Int = 0,
    val windowSec: Int = 60
)

@Serializable
data class RegisteredAgentRecord(
    val agent: String,
    val created: String,
    @SerialName("last_seen") val lastSeen: String? = null,
    val rate: AgentRateUsage? = null,
    val transport: String? = "poll"
)

@Serializable
data class RegisteredAgentsResponse(
    val agents: List<RegisteredAgentRecord> = emptyList()
)

@Serializable
data class LiveAgentConnection(
    val agent: String,
    val channels: List<String> = emptyList(),
    val connectedSince: String? = null,
    val connections: Int = 0
)

@Serializable
data class LiveAgentsResponse(
    val agents: List<LiveAgentConnection> = emptyList()
)

@Serializable
data class RegisterAgentRequest(
    val agent: String
)

@Serializable
data class RegisterAgentResponse(
    val ok: Boolean = false,
    val agent: String = "",
    val secret: String = "",
    val created: String = ""
)

@Serializable
data class RotateAgentResponse(
    val ok: Boolean = false,
    val agent: String = "",
    val secret: String = ""
)

@Serializable
data class DeleteAgentResponse(
    val ok: Boolean = false,
    val agent: String = ""
)

// Section 12: WIP & Lane Mapping
@Serializable
data class WipConfigResponse(
    @SerialName("per_assignee_doing_limit") val perAssigneeDoingLimit: Int? = null
)

@Serializable
data class WipConfigUpdateResponse(
    val ok: Boolean = false,
    @SerialName("per_assignee_doing_limit") val perAssigneeDoingLimit: Int? = null
)

@Serializable
data class LaneMappingRecord(
    val agent: String,
    val lane: String,
    @SerialName("set_by") val setBy: String = "system",
    @SerialName("set_at") val setAt: Long = 0L
)

@Serializable
data class LaneMappingResponse(
    @SerialName("lane_mapping") val laneMapping: List<LaneMappingRecord> = emptyList()
)

@Serializable
data class LaneMappingUpdateRequest(
    val agent: String,
    val lane: String
)

@Serializable
data class LaneMappingUpdateResponse(
    val ok: Boolean = false,
    val agent: String = "",
    val lane: String = TaskLane.UNASSIGNED,
    @SerialName("set_by") val setBy: String = "",
    @SerialName("set_at") val setAt: Long = 0L
)

// Section 13: Templates
object FlexibleLabelsSerializer : KSerializer<List<String>> {
    private val listDelegate = ListSerializer(String.serializer())
    override val descriptor: SerialDescriptor = listDelegate.descriptor

    override fun deserialize(decoder: Decoder): List<String> {
        val jsonDecoder = decoder as? JsonDecoder ?: return listDelegate.deserialize(decoder)
        val element = jsonDecoder.decodeJsonElement()
        return when (element) {
            is JsonArray -> element.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
            is JsonPrimitive -> {
                val raw = element.contentOrNull ?: return emptyList()
                try {
                    val parsed = jsonDecoder.json.parseToJsonElement(raw)
                    if (parsed is JsonArray) {
                        parsed.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                    } else emptyList()
                } catch (_: Exception) {
                    emptyList()
                }
            }
            else -> emptyList()
        }
    }

    override fun serialize(encoder: Encoder, value: List<String>) {
        listDelegate.serialize(encoder, value)
    }
}

@Serializable
data class TaskTemplateRecord(
    val id: Int = 0,
    val name: String,
    val title: String,
    val description: String? = null,
    val notes: String? = null,
    val priority: String = TaskPriority.NORMAL,
    val lane: String = TaskLane.UNASSIGNED,
    @Serializable(with = FlexibleLabelsSerializer::class)
    val labels: List<String> = emptyList()
)

@Serializable
data class TemplatesResponse(
    val templates: List<TaskTemplateRecord> = emptyList()
)

@Serializable
data class CreateTemplateRequest(
    val name: String,
    val title: String,
    val description: String? = null,
    val notes: String? = null,
    val priority: String = TaskPriority.NORMAL,
    val lane: String,
    val labels: List<String> = emptyList()
)

@Serializable
data class CreateTemplateResponse(
    val ok: Boolean = false,
    val id: Int = 0,
    val template: TaskTemplateRecord? = null
)

// Cutover Models
@Serializable
data class CutoverChecklistRequest(
    val item: String,
    val done: Boolean = true
)

@Serializable
data class CutoverFlipRequest(
    val direction: String = "v12",
    val force: Boolean = false
)

@Serializable
data class CutoverStatusResponse(
    val ok: Boolean = true,
    val status: String = "operational",
    val target: String = "v12",
    val checklist: Map<String, Boolean> = emptyMap(),
    val flipped: Boolean = false,
    val details: JsonElement? = null
)

// Ledger Models
@Serializable
data class LedgerEntryRecord(
    val id: Int = 0,
    val title: String = "",
    val statement: String = "",
    val dissent: Boolean = false,
    val status: String = "active",
    val author: String = "",
    @SerialName("created_at") val createdAt: String? = null,
    val contradiction: Boolean = false,
    val resolver: String? = null,
    @SerialName("superseded_by") val supersededBy: Int? = null
)

@Serializable
data class LedgerResponse(
    val ok: Boolean = true,
    val count: Int = 0,
    val entries: List<LedgerEntryRecord> = emptyList()
)

@Serializable
data class LedgerEntryDetailResponse(
    val ok: Boolean = true,
    val entry: LedgerEntryRecord? = null
)

@Serializable
data class LedgerEventRecord(
    val id: Int = 0,
    @SerialName("ledger_id") val ledgerId: Int = 0,
    val event: String = "",
    val ts: Long = 0L,
    val actor: String = "",
    val details: JsonElement? = null
)

@Serializable
data class LedgerEventsResponse(
    val ok: Boolean = true,
    val events: List<LedgerEventRecord> = emptyList()
)

@Serializable
data class LedgerActionRequest(
    val reason: String = "",
    val details: String? = null,
    val target: String? = null
)

@Serializable
data class LedgerSeedRequest(
    val count: Int = 5,
    val reset: Boolean = false
)

// Task Dependencies Models
@Serializable
data class TaskDependencyRecord(
    val id: Int = 0,
    @SerialName("task_id") val taskId: Int = 0,
    @SerialName("blocker_id") val blockerId: Int = 0,
    val reason: String = "",
    @SerialName("created_at") val createdAt: String? = null
)

@Serializable
data class TaskDependenciesResponse(
    val ok: Boolean = true,
    val dependencies: List<TaskDependencyRecord> = emptyList()
)

@Serializable
data class AddDependencyRequest(
    @SerialName("blocker_id") val blockerId: Int,
    val reason: String = ""
)

@Serializable
data class DependencyEventRecord(
    val id: Int = 0,
    @SerialName("task_id") val taskId: Int = 0,
    val event: String = "",
    val ts: Long = 0L,
    val details: JsonElement? = null
)

@Serializable
data class DependencyEventsResponse(
    val ok: Boolean = true,
    val events: List<DependencyEventRecord> = emptyList()
)

// Sweep Health & Discovery & Wake Models
@Serializable
data class SweepHealthResponse(
    val ok: Boolean = true,
    val status: String = "healthy",
    @SerialName("sweep_count") val sweepCount: Int = 0,
    @SerialName("last_sweep") val lastSweep: String? = null
)

@Serializable
data class DiscoveryResponse(
    val ok: Boolean = true,
    val version: String = "v12",
    val spec: String = "",
    val capabilities: List<String> = emptyList()
)

@Serializable
data class WakeResponse(
    val ok: Boolean = true,
    val message: String = "agent awakened",
    val agents: List<String> = emptyList()
)

// Audit Purge Models
@Serializable
data class AuditPurgeRequest(
    @SerialName("older_than_sec") val olderThanSec: Long = 86400L,
    @SerialName("dry_run") val dryRun: Boolean = false
)

@Serializable
data class AuditPurgeResponse(
    val ok: Boolean = true,
    @SerialName("purged_count") val purgedCount: Int = 0
)

// Generic Raw Route Execution Models
enum class RouteGroup(val title: String) {
    ADMIN("Admin"),
    AGENT("Agent (/api)"),
    CORE("Root / Core")
}

data class RouteDescriptor(
    val id: Int,
    val method: String,
    val path: String,
    val group: RouteGroup,
    val description: String,
    val sampleBody: String? = null,
    val defaultParams: Map<String, String> = emptyMap()
)

data class RouteExecutionResult(
    val routeId: Int,
    val method: String,
    val path: String,
    val statusCode: Int,
    val latencyMs: Long,
    val responseBody: String,
    val isSuccess: Boolean
)

// Persistent State Models (Feed Anchor & Poll Cursor)
@Serializable
data class PollCursor(
    val sinceTs: Long = 0L,
    val sinceId: Int = 0
)

@Serializable
data class FeedViewPersistence(
    val anchorMessageId: Int? = null,
    val firstVisibleItemIndex: Int = 0,
    val firstVisibleItemScrollOffset: Int = 0,
    val channelFilter: String? = null,
    val senderFilter: String? = null,
    val priorityFilter: String? = null,
    val searchQuery: String = "",
    val observedReplyTo: Map<Int, Int> = emptyMap(),
    val observedEditedIds: Set<Int> = emptySet()
)
