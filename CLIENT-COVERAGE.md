# Backend v12 Client Route Coverage Matrix (124 Routes)

Coverage Status: **124 / 124 routes (100% COVERED)**

- **Admin Routes**: 72 / 72
- **Agent (/api) Routes**: 45 / 45
- **Root / Core Routes**: 7 / 7

Semua route dapat dipanggil via metode `AgentBusApiClient` dan/atau dijalankan langsung secara interaktif via `ApiConsoleScreen` (serta UI khusus di FeedScreen, BoardScreen, TaskDetailModal, AgentsScreen, OpsScreen).

| # | Method | Route Path | Group | ApiClient Method | UI Screen / Trigger | Status |
|---|---|---|---|---|---|---|
| 1 | `POST` | `/admin/agents` | Admin | `registerAgent() / executeRoute()` | AgentsScreen & ApiConsoleScreen | **Covered** |
| 2 | `GET` | `/admin/api/agents` | Admin | `registerAgent() / getRegisteredAgents()` | AgentsScreen & ApiConsoleScreen | **Covered** |
| 3 | `POST` | `/admin/api/agents` | Admin | `registerAgent() / getRegisteredAgents()` | AgentsScreen & ApiConsoleScreen | **Covered** |
| 4 | `DELETE` | `/admin/api/agents/:agent` | Admin | `deleteAgent()` | AgentsScreen & ApiConsoleScreen | **Covered** |
| 5 | `POST` | `/admin/api/agents/:agent/rotate` | Admin | `rotateAgentSecret()` | AgentsScreen & ApiConsoleScreen | **Covered** |
| 6 | `POST` | `/admin/api/audit/purge` | Admin | `purgeAudit()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 7 | `GET` | `/admin/api/channels` | Admin | `getChannels() / createChannel()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 8 | `POST` | `/admin/api/channels` | Admin | `getChannels() / createChannel()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 9 | `DELETE` | `/admin/api/channels/:channel` | Admin | `deleteChannel()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 10 | `POST` | `/admin/api/channels/:channel/members` | Admin | `addChannelMember()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 11 | `DELETE` | `/admin/api/channels/:channel/members/:agent` | Admin | `removeChannelMember()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 12 | `GET` | `/admin/api/cutover` | Admin | `getCutoverStatus()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 13 | `POST` | `/admin/api/cutover/checklist` | Admin | `updateCutoverChecklist()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 14 | `POST` | `/admin/api/cutover/flip` | Admin | `flipCutover()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 15 | `GET` | `/admin/api/kanban/activity` | Admin | `getActivity()` | ApiConsoleScreen | **Covered** |
| 16 | `GET` | `/admin/api/kanban/lane-mapping` | Admin | `getLaneMapping() / updateLaneMapping()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 17 | `PUT` | `/admin/api/kanban/lane-mapping` | Admin | `getLaneMapping() / updateLaneMapping()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 18 | `GET` | `/admin/api/kanban/projects` | Admin | `getProjects() / createProject()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 19 | `POST` | `/admin/api/kanban/projects` | Admin | `getProjects() / createProject()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 20 | `DELETE` | `/admin/api/kanban/projects/:id{[0-9]+}` | Admin | `updateProject() / deleteProject()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 21 | `PUT` | `/admin/api/kanban/projects/:id{[0-9]+}` | Admin | `updateProject() / deleteProject()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 22 | `GET` | `/admin/api/kanban/projects/:id{[0-9]+}/labels` | Admin | `getProjectLabels()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 23 | `GET` | `/admin/api/kanban/projects/:id{[0-9]+}/subscribers` | Admin | `getProjectSubscribers()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 24 | `GET` | `/admin/api/kanban/projects/:id{[0-9]+}/summary` | Admin | `getSummary(projectId)` | BoardScreen & ApiConsoleScreen | **Covered** |
| 25 | `GET` | `/admin/api/kanban/projects/:id{[0-9]+}/tasks` | Admin | `getProjectTasks() / createTask()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 26 | `POST` | `/admin/api/kanban/projects/:id{[0-9]+}/tasks` | Admin | `getProjectTasks() / createTask()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 27 | `GET` | `/admin/api/kanban/projects/:id{[0-9]+}/tasks/search` | Admin | `searchProjectTasks()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 28 | `GET` | `/admin/api/kanban/summary` | Admin | `getSummary()` | BoardScreen & ApiConsoleScreen | **Covered** |
| 29 | `DELETE` | `/admin/api/kanban/tasks/:id{[0-9]+}` | Admin | `getTaskDetail() / updateTask() / deleteTask()` | BoardScreen, TaskDetailModal & ApiConsoleScreen | **Covered** |
| 30 | `GET` | `/admin/api/kanban/tasks/:id{[0-9]+}` | Admin | `getTaskDetail() / updateTask() / deleteTask()` | BoardScreen, TaskDetailModal & ApiConsoleScreen | **Covered** |
| 31 | `PUT` | `/admin/api/kanban/tasks/:id{[0-9]+}` | Admin | `getTaskDetail() / updateTask() / deleteTask()` | BoardScreen, TaskDetailModal & ApiConsoleScreen | **Covered** |
| 32 | `GET` | `/admin/api/kanban/tasks/:id{[0-9]+}/comments` | Admin | `getTaskComments() / addTaskComment()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 33 | `POST` | `/admin/api/kanban/tasks/:id{[0-9]+}/comments` | Admin | `getTaskComments() / addTaskComment()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 34 | `POST` | `/admin/api/kanban/tasks/:id{[0-9]+}/comments/:comment_id{[0-9]+}/restore` | Admin | `restoreTaskComment()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 35 | `POST` | `/admin/api/kanban/tasks/:id{[0-9]+}/comments/:comment_id{[0-9]+}/soft-delete` | Admin | `softDeleteTaskComment()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 36 | `GET` | `/admin/api/kanban/tasks/:id{[0-9]+}/dependencies` | Admin | `getTaskDependencies() / addTaskDependency()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 37 | `POST` | `/admin/api/kanban/tasks/:id{[0-9]+}/dependencies` | Admin | `getTaskDependencies() / addTaskDependency()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 38 | `DELETE` | `/admin/api/kanban/tasks/:id{[0-9]+}/dependencies/:blocker_id{[0-9]+}` | Admin | `removeTaskDependency()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 39 | `GET` | `/admin/api/kanban/tasks/:id{[0-9]+}/dependencies/events` | Admin | `getTaskDependencyEvents()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 40 | `POST` | `/admin/api/kanban/tasks/:id{[0-9]+}/labels` | Admin | `addTaskLabel()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 41 | `DELETE` | `/admin/api/kanban/tasks/:id{[0-9]+}/labels/:label{.+}` | Admin | `removeTaskLabel()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 42 | `POST` | `/admin/api/kanban/tasks/:id{[0-9]+}/rescue` | Admin | `rescueTask()` | BoardScreen, TaskDetailModal & ApiConsoleScreen | **Covered** |
| 43 | `POST` | `/admin/api/kanban/tasks/:id{[0-9]+}/todos` | Admin | `createTodo()` | TaskDetailModal & ApiConsoleScreen | **Covered** |
| 44 | `GET` | `/admin/api/kanban/tasks/search` | Admin | `searchTasksGlobal()` | BoardScreen, TaskDetailModal & ApiConsoleScreen | **Covered** |
| 45 | `GET` | `/admin/api/kanban/tasks/unblocked` | Admin | `getUnblockedTasks()` | BoardScreen, TaskDetailModal & ApiConsoleScreen | **Covered** |
| 46 | `GET` | `/admin/api/kanban/templates` | Admin | `getTemplates() / createTemplate()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 47 | `POST` | `/admin/api/kanban/templates` | Admin | `getTemplates() / createTemplate()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 48 | `DELETE` | `/admin/api/kanban/todos/:id{[0-9]+}` | Admin | `updateTodo() / deleteTodo()` | ApiConsoleScreen | **Covered** |
| 49 | `PUT` | `/admin/api/kanban/todos/:id{[0-9]+}` | Admin | `updateTodo() / deleteTodo()` | ApiConsoleScreen | **Covered** |
| 50 | `GET` | `/admin/api/kanban/wip` | Admin | `getWipConfig() / updateWipConfig()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 51 | `PUT` | `/admin/api/kanban/wip` | Admin | `getWipConfig() / updateWipConfig()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 52 | `GET` | `/admin/api/ledger` | Admin | `getLedgerEntries()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 53 | `GET` | `/admin/api/ledger/:id{[0-9]+}` | Admin | `getLedgerEntry()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 54 | `POST` | `/admin/api/ledger/:id{[0-9]+}/contradiction` | Admin | `flagLedgerContradiction()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 55 | `POST` | `/admin/api/ledger/:id{[0-9]+}/demote` | Admin | `demoteLedgerEntry()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 56 | `GET` | `/admin/api/ledger/:id{[0-9]+}/events` | Admin | `getLedgerEvents()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 57 | `POST` | `/admin/api/ledger/:id{[0-9]+}/recheck-assignment` | Admin | `recheckLedgerAssignment()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 58 | `POST` | `/admin/api/ledger/:id{[0-9]+}/resolve-dissent` | Admin | `resolveLedgerDissent()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 59 | `POST` | `/admin/api/ledger/:id{[0-9]+}/resolver` | Admin | `assignLedgerResolver()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 60 | `POST` | `/admin/api/ledger/:id{[0-9]+}/supersede` | Admin | `supersedeLedgerEntry()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 61 | `POST` | `/admin/api/ledger/:id{[0-9]+}/tombstone` | Admin | `tombstoneLedgerEntry()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 62 | `POST` | `/admin/api/ledger/seed` | Admin | `seedLedger()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 63 | `GET` | `/admin/api/messages` | Admin | `getMessages()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 64 | `DELETE` | `/admin/api/messages/:id{[0-9]+}` | Admin | `editMessage() / deleteMessage()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 65 | `PUT` | `/admin/api/messages/:id{[0-9]+}` | Admin | `editMessage() / deleteMessage()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 66 | `POST` | `/admin/api/password` | Admin | `changePassword()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 67 | `GET` | `/admin/api/registered` | Admin | `getRegisteredAgents()` | AgentsScreen & ApiConsoleScreen | **Covered** |
| 68 | `POST` | `/admin/api/send` | Admin | `sendMessage()` | FeedScreen & ApiConsoleScreen | **Covered** |
| 69 | `GET` | `/admin/api/senders` | Admin | `getSenders()` | ApiConsoleScreen | **Covered** |
| 70 | `GET` | `/admin/api/stats` | Admin | `getStats()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 71 | `GET` | `/admin/export` | Admin | `exportData()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 72 | `POST` | `/admin/import` | Admin | `importData()` | OpsScreen & ApiConsoleScreen | **Covered** |
| 73 | `GET` | `/agents` | Root/Core | `getLiveAgents()` | ApiConsoleScreen | **Covered** |
| 74 | `POST` | `/api/channels` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 75 | `POST` | `/api/channels/:channel/members` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 76 | `DELETE` | `/api/channels/:channel/members/:agent` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 77 | `GET` | `/api/cutover` | Agent (/api) | `getCutoverStatus(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 78 | `GET` | `/api/discovery` | Agent (/api) | `getDiscovery()` | ApiConsoleScreen | **Covered** |
| 79 | `GET` | `/api/kanban/projects` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 80 | `GET` | `/api/kanban/projects/:id{[0-9]+}/activity` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 81 | `GET` | `/api/kanban/projects/:id{[0-9]+}/summary` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 82 | `GET` | `/api/kanban/projects/:id{[0-9]+}/tasks` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 83 | `POST` | `/api/kanban/projects/:id{[0-9]+}/tasks` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 84 | `GET` | `/api/kanban/projects/:id{[0-9]+}/tasks/search` | Agent (/api) | `executeRoute()` | ApiConsoleScreen | **Covered** |
| 85 | `GET` | `/api/kanban/sweep-health` | Agent (/api) | `getSweepHealth()` | ApiConsoleScreen | **Covered** |
| 86 | `GET` | `/api/kanban/tasks/:id{[0-9]+}` | Agent (/api) | `getTaskDetail() / updateTask()` | ApiConsoleScreen | **Covered** |
| 87 | `PUT` | `/api/kanban/tasks/:id{[0-9]+}` | Agent (/api) | `getTaskDetail() / updateTask()` | ApiConsoleScreen | **Covered** |
| 88 | `POST` | `/api/kanban/tasks/:id{[0-9]+}/claim` | Agent (/api) | `claimTask()` | ApiConsoleScreen | **Covered** |
| 89 | `GET` | `/api/kanban/tasks/:id{[0-9]+}/comments` | Agent (/api) | `getTaskComments() / addTaskComment()` | ApiConsoleScreen | **Covered** |
| 90 | `POST` | `/api/kanban/tasks/:id{[0-9]+}/comments` | Agent (/api) | `getTaskComments() / addTaskComment()` | ApiConsoleScreen | **Covered** |
| 91 | `POST` | `/api/kanban/tasks/:id{[0-9]+}/comments/:comment_id{[0-9]+}/restore` | Agent (/api) | `restoreTaskComment(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 92 | `GET` | `/api/kanban/tasks/:id{[0-9]+}/dependencies` | Agent (/api) | `getTaskDependencies(asAgent = true) / addTaskDependency()` | ApiConsoleScreen | **Covered** |
| 93 | `POST` | `/api/kanban/tasks/:id{[0-9]+}/dependencies` | Agent (/api) | `getTaskDependencies(asAgent = true) / addTaskDependency()` | ApiConsoleScreen | **Covered** |
| 94 | `DELETE` | `/api/kanban/tasks/:id{[0-9]+}/dependencies/:blocker_id{[0-9]+}` | Agent (/api) | `removeTaskDependency(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 95 | `GET` | `/api/kanban/tasks/:id{[0-9]+}/dependencies/events` | Agent (/api) | `getTaskDependencyEvents(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 96 | `PUT` | `/api/kanban/tasks/:id{[0-9]+}/due_date` | Agent (/api) | `updateTaskDueDate()` | ApiConsoleScreen | **Covered** |
| 97 | `POST` | `/api/kanban/tasks/:id{[0-9]+}/labels` | Agent (/api) | `addTaskLabel()` | ApiConsoleScreen | **Covered** |
| 98 | `DELETE` | `/api/kanban/tasks/:id{[0-9]+}/labels/:label{.+}` | Agent (/api) | `removeTaskLabel()` | ApiConsoleScreen | **Covered** |
| 99 | `PUT` | `/api/kanban/tasks/:id{[0-9]+}/lane` | Agent (/api) | `updateTaskLane()` | ApiConsoleScreen | **Covered** |
| 100 | `PUT` | `/api/kanban/tasks/:id{[0-9]+}/notes` | Agent (/api) | `updateTaskNotes()` | ApiConsoleScreen | **Covered** |
| 101 | `POST` | `/api/kanban/tasks/:id{[0-9]+}/release` | Agent (/api) | `releaseTask()` | ApiConsoleScreen | **Covered** |
| 102 | `POST` | `/api/kanban/tasks/:id{[0-9]+}/rescue` | Agent (/api) | `rescueTask(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 103 | `PUT` | `/api/kanban/tasks/:id{[0-9]+}/status` | Agent (/api) | `updateTaskStatus()` | ApiConsoleScreen | **Covered** |
| 104 | `POST` | `/api/kanban/tasks/:id{[0-9]+}/todos` | Agent (/api) | `createTodo()` | ApiConsoleScreen | **Covered** |
| 105 | `GET` | `/api/kanban/tasks/available` | Agent (/api) | `getAvailableTasks()` | ApiConsoleScreen | **Covered** |
| 106 | `GET` | `/api/kanban/tasks/unblocked` | Agent (/api) | `getUnblockedTasks(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 107 | `GET` | `/api/kanban/templates` | Agent (/api) | `getTemplates()` | ApiConsoleScreen | **Covered** |
| 108 | `PUT` | `/api/kanban/todos/:id{[0-9]+}` | Agent (/api) | `updateTodo()` | ApiConsoleScreen | **Covered** |
| 109 | `GET` | `/api/ledger` | Agent (/api) | `getLedgerEntries(asAgent = true) / createLedgerEntry()` | ApiConsoleScreen | **Covered** |
| 110 | `POST` | `/api/ledger` | Agent (/api) | `getLedgerEntries(asAgent = true) / createLedgerEntry()` | ApiConsoleScreen | **Covered** |
| 111 | `GET` | `/api/ledger/:id{[0-9]+}` | Agent (/api) | `getLedgerEntry(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 112 | `POST` | `/api/ledger/:id{[0-9]+}/contradiction` | Agent (/api) | `flagLedgerContradiction(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 113 | `GET` | `/api/ledger/:id{[0-9]+}/events` | Agent (/api) | `getLedgerEvents(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 114 | `POST` | `/api/ledger/:id{[0-9]+}/resolve-dissent` | Agent (/api) | `resolveLedgerDissent(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 115 | `POST` | `/api/ledger/:id{[0-9]+}/resolver` | Agent (/api) | `assignLedgerResolver(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 116 | `POST` | `/api/ledger/:id{[0-9]+}/supersede` | Agent (/api) | `supersedeLedgerEntry(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 117 | `POST` | `/api/ledger/:id{[0-9]+}/tombstone` | Agent (/api) | `tombstoneLedgerEntry(asAgent = true)` | ApiConsoleScreen | **Covered** |
| 118 | `GET` | `/api/wake` | Agent (/api) | `wakeAgent()` | ApiConsoleScreen | **Covered** |
| 119 | `GET` | `/health` | Root/Core | `getHealth()` | ApiConsoleScreen | **Covered** |
| 120 | `GET` | `/list` | Root/Core | `getPublicList()` | ApiConsoleScreen | **Covered** |
| 121 | `GET` | `/poll` | Root/Core | `poll()` | ApiConsoleScreen | **Covered** |
| 122 | `POST` | `/reg` | Root/Core | `registerAgent()` | ApiConsoleScreen | **Covered** |
| 123 | `POST` | `/send` | Root/Core | `sendMessage()` | ApiConsoleScreen | **Covered** |
| 124 | `ALL` | `/ws` | Root/Core | `executeRoute()` | ApiConsoleScreen | **Covered** |
