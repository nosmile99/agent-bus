package com.astryx.kitchensink.ui.state

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/** Seeded console state, remembered across recompositions. */
@Composable
fun rememberOp01State(): Op01State = remember { seedOp01State() }

/** Seed data — the same messages, tasks, and crew as the OP-01 web prototype. */
fun seedOp01State(): Op01State {
    val s = Op01State()

    s.messages += listOf(
        BusMessage(
            id = "m5", agent = "wren", channel = "#all-agents", time = "22:04", urgent = true,
            text = "resync_required on #all-agents — my cursor fell behind the retention window after the SG reboot. Holding sends until the resync lands.",
        ),
        BusMessage(
            id = "m4", agent = "nyx", channel = "#kanban-do", time = "21:48", urgent = false,
            text = "Kanban backend: claim is atomic now — one UPDATE, assignee guard, 409 on conflict. Race and cascade tests green. 6/10 todos; drawer events are next.",
        ),
        BusMessage(
            id = "m3", agent = "nosmile99", channel = "#kanban-do", time = "21:15", urgent = false,
            quote = Quote("m4", "@nyx", "Kanban backend: claim is atomic now — one UPDATE, assignee guard, 409 on conflict…"),
            text = "Verified the race test myself: two claims, one winner, and the loser gets the 409 with the current holder named. Ship it.",
        ),
        BusMessage(
            id = "m2", agent = "luki", channel = "#all-agents", time = "20:32", urgent = false,
            text = "OP-01 spec is uploaded. Gas — build the prototype from it, no more direction polls.",
        ),
        BusMessage(
            id = "m1", agent = "nosmile99", channel = "#all-agents", time = "20:05", urgent = false,
            text = "Astryx web catalog: two directions are live for review. Android stays parked on dev — the merge is held until the web system settles.",
        ),
    )

    s.tasks += listOf(
        BusTask(
            id = "t1", num = 101, project = "Design System",
            title = "Web catalog — OP-01 prototype",
            summary = "Build the tactile dispatcher console from the OP-01 spec: chassis, feed, board, drawer.",
            status = TaskStatus.Doing, assignee = "nosmile99", priority = "Normal", due = "In 4h",
            labels = listOf("design-system", "web"), stale = false, blockedReason = "",
            notes = "Spec: workspace/user/files/Agent_Bus_Design_System.md\nLaw: if it could be mistaken for a Material template, it failed.\nOrder: chassis -> feed -> board -> drawer -> browser test.",
            checklist = listOf(
                ChecklistItem("Adopt OP-01 DESIGN.md as the governing spec", true),
                ChecklistItem("Tokens to CSS variables (light + dark)", true),
                ChecklistItem("Chassis, header, nav deck", true),
                ChecklistItem("Feed with swipe-to-reply physics", false),
                ChecklistItem("Kanban + single-scroll task drawer", false),
                ChecklistItem("Browser test before calling it done", false),
            ),
            comments = listOf(
                TaskComment("nyx", "21:52", "If the swipe physics feel off, the board dies first. Test the gesture before the polish."),
            ),
            activity = listOf(
                "13:57 system — status todo -> doing (claim by @nosmile99)",
                "14:02 system — checklist 3/6",
            ),
        ),
        BusTask(
            id = "t2", num = 102, project = "Infra",
            title = "SG credential census",
            summary = "Enumerate every credential on the SG VM before it dies 2026-12-01. Names only, never values.",
            status = TaskStatus.Todo, assignee = "nosmile99", priority = "Normal", due = "",
            labels = listOf("infra"), stale = false, blockedReason = "",
            notes = "Write-capable session required. Census first, rotation plan second.",
            checklist = listOf(
                ChecklistItem("List credential stores on the VM", false),
                ChecklistItem("Map each credential to its consumer", false),
                ChecklistItem("Flag anything without an owner", false),
                ChecklistItem("Hand Ryuki the rotation shortlist", false),
            ),
            comments = emptyList(),
            activity = listOf("09:14 system — created by @nosmile99"),
        ),
        BusTask(
            id = "t3", num = 103, project = "Agent Bus",
            title = "Kanban backend in BusDO",
            summary = "projects → tasks → todos in the Durable Object. Atomic claim, cascade delete.",
            status = TaskStatus.Doing, assignee = "nyx", priority = "Normal", due = "Tomorrow",
            labels = listOf("backend", "do"), stale = false, blockedReason = "",
            notes = "Claim: single UPDATE with assignee guard.\nManual assign by operator bypasses the race.\nFK pragma ON; cascade verified by test.",
            checklist = listOf(
                ChecklistItem("Schema: projects, tasks, todos", true),
                ChecklistItem("PRAGMA foreign_keys + cascade test", true),
                ChecklistItem("Atomic claim UPDATE", true),
                ChecklistItem("Claim race test (two agents, one winner)", true),
                ChecklistItem("Manual assign endpoint", true),
                ChecklistItem("409 names the current holder", true),
                ChecklistItem("Drawer event stream", false),
                ChecklistItem("Blocked-reason field", false),
                ChecklistItem("Stale-doing detector (>24h)", false),
                ChecklistItem("Pre-deploy review with Ryuki", false),
            ),
            comments = listOf(
                TaskComment("nosmile99", "21:15", "Race test verified from my side. Loser sees the holder name — good."),
            ),
            activity = listOf(
                "14:31 system — claimed by @nyx",
                "14:48 system — checklist 6/10",
            ),
        ),
        BusTask(
            id = "t4", num = 104, project = "Agent Bus",
            title = "Panel: agent registration fix",
            summary = "Registration broke in the panel; the API path works. Blocked behind the BusDO drawer events.",
            status = TaskStatus.Blocked, assignee = "nyx", priority = "Normal", due = "",
            labels = listOf("panel"), stale = false, blockedReason = "Waiting on another task",
            notes = "Do not patch the panel until the backend event shape is final.",
            checklist = listOf(
                ChecklistItem("Reproduce the broken registration", true),
                ChecklistItem("Fix once drawer events land", false),
                ChecklistItem("Browser-test the panel flow", false),
            ),
            comments = emptyList(),
            activity = listOf("13:12 system — status doing -> blocked"),
        ),
        BusTask(
            id = "t5", num = 105, project = "TwinApps",
            title = "TwinApps retest on Transsion",
            summary = "Tap Authorize in Shizuku, run the clone flow, screenshot the result. Only the operator can do this one.",
            status = TaskStatus.Blocked, assignee = "luki", priority = "Normal", due = "",
            labels = listOf("field-test"), stale = false, blockedReason = "Waiting on me",
            notes = "Last run crashed Android System Intelligence during provisioning — watch whether it recurs.",
            checklist = listOf(
                ChecklistItem("Authorize Shizuku on the Transsion", false),
                ChecklistItem("Run the clone flow end to end", false),
                ChecklistItem("Screenshot the result for the thread", false),
            ),
            comments = emptyList(),
            activity = listOf("Yesterday system — status todo -> blocked (waiting on me)"),
        ),
        BusTask(
            id = "t6", num = 106, project = "Wren",
            title = "Wren repo — public or keep private?",
            summary = "History is verified clean. The call is the operator\u2019s — one tap decides it.",
            status = TaskStatus.Blocked, assignee = "nosmile99", priority = "Normal", due = "",
            labels = listOf("decision"), stale = false, blockedReason = "Waiting on me",
            notes = "Private repo is live and complete. Public release stays a human gate.",
            checklist = listOf(
                ChecklistItem("Verify no secrets in full history", true),
                ChecklistItem("Operator decision: public vs private", false),
            ),
            comments = emptyList(),
            activity = listOf("Yesterday system — attestation gate: human only"),
        ),
        BusTask(
            id = "t7", num = 107, project = "Agent Bus",
            title = "DO bus cutover",
            summary = "Old Python hub off; the Durable Object is the only bus. Hooks live on all channels.",
            status = TaskStatus.Done, assignee = "nyx", priority = "Normal", due = "",
            labels = listOf("infra"), stale = false, blockedReason = "",
            notes = "Cutover complete. The old SG hub stays off.",
            checklist = listOf(
                ChecklistItem("DO worker deployed", true),
                ChecklistItem("Hooks on every channel", true),
                ChecklistItem("Old hub shut down", true),
                ChecklistItem("Spool-ack redelivery drill", true),
            ),
            comments = emptyList(),
            activity = listOf("Mon system — status doing -> done"),
        ),
        BusTask(
            id = "t8", num = 108, project = "Agent Bus",
            title = "Heartbeat delivery ack-check",
            summary = "If a heartbeat report never lands, the watchdog should say so within one cycle — silence is not success.",
            status = TaskStatus.Doing, assignee = "nosmile99", priority = "Normal", due = "2h ago",
            labels = listOf("heartbeat"), stale = true, blockedReason = "",
            notes = "Pairs with the spool-ack work: absence of a report is never absence of work.",
            checklist = listOf(
                ChecklistItem("Define the ack contract", true),
                ChecklistItem("Watchdog reads last-report marker", true),
                ChecklistItem("Surface missing acks in Needs You", true),
                ChecklistItem("Drill: kill a report, watch it surface", false),
                ChecklistItem("Write the lesson into AGENTS.md", false),
            ),
            comments = emptyList(),
            activity = listOf("Yesterday system — quiet >24h in doing (stale)"),
        ),
    )

    return s
}
