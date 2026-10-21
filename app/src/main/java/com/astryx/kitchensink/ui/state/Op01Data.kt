package com.astryx.kitchensink.ui.state

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** Agent identity metadata. Badge colors live in the theme (AgentBadges). */
data class AgentMeta(
    val key: String,
    val handle: String,
    val name: String,
    val role: String,
)

object Agents {
    val Nyx = AgentMeta("nyx", "@nyx", "Nyx", "Indigo Architect")
    val Nosmile99 = AgentMeta("nosmile99", "@nosmile99", "nosmile99", "Emerald Auditor")
    val Wren = AgentMeta("wren", "@wren", "Wren", "Amber Scout")
    val Luki = AgentMeta("luki", "@luki", "Luki", "Stone Operator")

    val all = listOf(Nyx, Nosmile99, Wren, Luki)

    fun byKey(key: String): AgentMeta = all.firstOrNull { it.key == key } ?: Luki
}

enum class TaskStatus(val label: String, val stripLabel: String) {
    Todo("To Do", "To Do"),
    Doing("In Progress", "Doing"),
    Blocked("Blocked", "Blocked"),
    Done("Done", "Done"),
}

data class Quote(
    val msgId: String,
    val agentHandle: String,
    val text: String,
)

data class BusMessage(
    val id: String,
    val agent: String,
    val channel: String,
    val time: String,
    val urgent: Boolean,
    val text: String,
    val quote: Quote? = null,
)

data class ChecklistItem(
    val text: String,
    val done: Boolean,
)

data class TaskComment(
    val agent: String,
    val time: String,
    val text: String,
)

data class BusTask(
    val id: String,
    val num: Int,
    val project: String,
    val title: String,
    val summary: String,
    val status: TaskStatus,
    val assignee: String,
    val priority: String,
    val due: String,
    val labels: List<String>,
    val stale: Boolean,
    val blockedReason: String,
    val notes: String,
    val checklist: List<ChecklistItem>,
    val comments: List<TaskComment>,
    val activity: List<String>,
) {
    val todosDone: Int get() = checklist.count { it.done }
    val todosTotal: Int get() = checklist.size
}

/**
 * In-memory console state, ported 1:1 from the OP-01 web prototype.
 * Mutations replace list items with copies so Compose recomposes cleanly.
 * Nothing persists — a process restart reseeds, exactly like the prototype.
 */
class Op01State {
    val messages = mutableStateListOf<BusMessage>()
    val tasks = mutableStateListOf<BusTask>()

    var resync by mutableStateOf(true)
    var transportLive by mutableStateOf(true)

    fun taskById(id: String): BusTask? = tasks.firstOrNull { it.id == id }

    fun updateTask(id: String, transform: (BusTask) -> BusTask) {
        val idx = tasks.indexOfFirst { it.id == id }
        if (idx >= 0) tasks[idx] = transform(tasks[idx])
    }

    fun removeTask(id: String) {
        tasks.removeAll { it.id == id }
    }

    /** Operator bottleneck queue: blocked tasks whose reason is "Waiting on me". */
    fun needsTasks(): List<BusTask> =
        tasks.filter { it.status == TaskStatus.Blocked && it.blockedReason == "Waiting on me" }

    /**
     * Status change with the spec's guardrail: tapping the already-active
     * status is a strict no-op — no timestamp rewrite, no activity entry.
     */
    fun setStatus(task: BusTask, status: TaskStatus) {
        if (task.status == status) return
        updateTask(task.id) { t ->
            t.copy(
                status = status,
                blockedReason = when {
                    status != TaskStatus.Blocked -> ""
                    t.blockedReason.isNotEmpty() -> t.blockedReason
                    else -> "Waiting on another task"
                },
                stale = false,
                activity = listOf("now system — status ${t.status.name.lowercase()} -> ${status.name.lowercase()}") + t.activity,
            )
        }
    }
}
