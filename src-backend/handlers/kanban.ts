// Kanban endpoints (projects, tasks, claim, status)
export * from './kanban-projects.js';
export * from './kanban-todos.js';
export * from './kanban-expansion.js';

import type { IBusDO, TaskRecord, TodoRecord, TaskWithTodos, BlockedKind } from '../types.js';

export function kbTodosFor(this: IBusDO, taskId: number): TodoRecord[] {
  return this.sql
    .exec(
      "SELECT id, task_id, text, done, sort_order FROM todos WHERE task_id = ? ORDER BY sort_order ASC, id ASC",
      taskId
    )
    .toArray() as TodoRecord[];
}

export function kbTaskWithTodos(this: IBusDO, row: TaskRecord): TaskWithTodos {
  return { ...row, todos: this.kbTodosFor(row.id) };
}

// GET /admin/api/kanban/projects/:id/tasks — tasks with todos embedded.
export async function handleKbAdminTasksList(this: IBusDO, req: Request, projectId: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const proj = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", projectId).toArray();
  if (proj.length === 0) return this.json(404, { error: "project not found" });
  const tasks = (
    this.sql
      .exec("SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC", projectId)
      .toArray() as TaskRecord[]
  ).map((t) => this.kbTaskWithTodos(t));
  return this.json(200, { tasks });
}

// POST /admin/api/kanban/projects/:id/tasks — {title, description?, priority?, notes?}.
export async function handleKbAdminTaskCreate(this: IBusDO, req: Request, projectId: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const proj = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", projectId).toArray();
  if (proj.length === 0) return this.json(404, { error: "project not found" });
  const title = payload?.title;
  if (!payload || typeof title !== "string" || !title.trim()) {
    return this.json(400, { error: "title required" });
  }
  const priority =
    typeof payload.priority === "string" && ["low", "normal", "urgent"].includes(payload.priority)
      ? payload.priority
      : "normal";
  const now = this.kbNow();
  const notes = typeof payload.notes === "string" ? payload.notes : null;
  this.sql.exec(
    "INSERT INTO tasks (project_id, title, description, notes, status, priority, created_by, created_at, updated_at, status_changed_at, last_activity_at) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)",
    projectId,
    title.trim(),
    typeof payload.description === "string" ? payload.description : null,
    notes,
    priority,
    this.kbBasicUser(req),
    now,
    now,
    now,
    now,
    now
  );
  const id = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
  this.emitEvent("kanban.task.created", {
    actor: "admin",
    project_id: projectId,
    payload: { id, project_id: projectId, title: title.trim() },
  });
  return this.json(200, { ok: true, id });
}

// PUT /admin/api/kanban/tasks/:id — {title?, description?, notes?, status?, priority?, assignee?, blocked_kind?}.
export async function handleKbAdminTaskUpdate(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const taskRows = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray() as TaskRecord[];
  const task = taskRows[0];
  if (!task) return this.json(404, { error: "task not found" });
  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  const now = this.kbNow();
  const fieldEvents: string[] = []; // kanban.task.updated changes
  if (typeof payload?.title === "string" && payload.title.trim()) {
    updates.push("title = ?");
    vals.push(payload.title.trim());
    fieldEvents.push("title");
  }
  if (payload && "description" in payload) {
    if (payload.description === null || typeof payload.description === "string") {
      updates.push("description = ?");
      vals.push(payload.description);
      fieldEvents.push("description");
    }
  }
  if (payload && "notes" in payload) {
    if (payload.notes === null || typeof payload.notes === "string") {
      updates.push("notes = ?");
      vals.push(payload.notes);
      fieldEvents.push("notes");
    }
  }
  let statusEvent: { type: string; payload: Record<string, unknown> } | null = null;
  let blockedKindVal: string | null = null;
  if (typeof payload?.status === "string" && ["todo", "doing", "done", "blocked"].includes(payload.status)) {
    updates.push("status = ?", "status_changed_at = ?");
    vals.push(payload.status, now);
    const wasBlocked = task.status === "blocked";
    const willBlock = payload.status === "blocked";
    if (willBlock) {
      const kindProvided = !(
        payload.blocked_kind === undefined ||
        payload.blocked_kind === null ||
        payload.blocked_kind === ""
      );
      const kind = !kindProvided
        ? (wasBlocked ? task.blocked_kind || "waiting-human" : "waiting-human")
        : payload.blocked_kind;
      if (typeof kind !== "string" || !["waiting-human", "waiting-task", "waiting-external"].includes(kind)) {
        return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
      }
      if (kindProvided || !wasBlocked) {
        updates.push("blocked_kind = ?");
        vals.push(kind);
      }
      blockedKindVal = kind;
    } else {
      if (payload.blocked_kind !== undefined && payload.blocked_kind !== null && payload.blocked_kind !== "") {
        return this.json(400, { error: "blocked_kind only valid with status=blocked" });
      }
      updates.push("blocked_kind = NULL");
    }
    if (willBlock && !wasBlocked) {
      statusEvent = { type: "kanban.task.blocked", payload: { id, blocked_kind: blockedKindVal } };
    } else if (!willBlock && wasBlocked) {
      statusEvent = { type: "kanban.task.unblocked", payload: { id, previous_blocked_kind: task.blocked_kind } };
    } else {
      statusEvent = { type: "kanban.task.updated", payload: { id, change: "status", status: payload.status } };
    }
  } else if (
    payload?.blocked_kind !== undefined &&
    payload?.blocked_kind !== null &&
    payload?.blocked_kind !== ""
  ) {
    if (task.status !== "blocked") {
      return this.json(400, { error: "blocked_kind only valid with status=blocked" });
    }
    if (
      typeof payload.blocked_kind !== "string" ||
      !["waiting-human", "waiting-task", "waiting-external"].includes(payload.blocked_kind)
    ) {
      return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
    }
    updates.push("blocked_kind = ?");
    vals.push(payload.blocked_kind);
    fieldEvents.push("blocked_kind");
  }
  if (typeof payload?.priority === "string" && ["low", "normal", "urgent"].includes(payload.priority)) {
    updates.push("priority = ?");
    vals.push(payload.priority);
    fieldEvents.push("priority");
  }
  if (payload && "assignee" in payload) {
    if (payload.assignee === null) {
      updates.push("assignee = NULL", "admin_assigned = NULL");
      fieldEvents.push("assignee");
    } else if (typeof payload.assignee === "string" && payload.assignee) {
      updates.push("assignee = ?", "admin_assigned = ?", "claimed_at = ?");
      vals.push(payload.assignee, payload.assignee, now);
      fieldEvents.push("assignee");
    } else {
      return this.json(400, { error: "assignee must be a string or null" });
    }
  }
  if (updates.length === 0) return this.json(400, { error: "nothing to update" });
  updates.push("updated_at = ?", "last_activity_at = ?");
  vals.push(now, now, id);
  this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
  for (const change of fieldEvents) {
    this.emitEvent("kanban.task.updated", {
      actor: "admin",
      project_id: task.project_id,
      payload: { id, change },
    });
  }
  if (statusEvent) {
    this.emitEvent(statusEvent.type, {
      actor: "admin",
      project_id: task.project_id,
      payload: statusEvent.payload,
    });
  }
  if (statusEvent || fieldEvents.length) {
    this.kbSystemLog(
      id,
      `admin updated: ${[...fieldEvents, statusEvent ? statusEvent.type.split(".").pop() : null].filter(Boolean).join(", ")}`
    );
  }
  return this.json(200, { ok: true, id });
}

// DELETE /admin/api/kanban/tasks/:id — cascade deletes todos via FK.
export async function handleKbAdminTaskDelete(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  const rows = this.sql.exec(`SELECT project_id FROM tasks WHERE id = ?`, id).toArray() as Array<{
    project_id: number;
  }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  this.sql.exec("DELETE FROM tasks WHERE id = ?", id);
  this.emitEvent("kanban.task.deleted", {
    actor: "admin",
    project_id: task.project_id,
    payload: { id },
  });
  return this.json(200, { ok: true, id });
}

export async function handleKbAgentTasksList(this: IBusDO, req: Request, projectId: number): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const proj = this.sql
    .exec(
      `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
      projectId,
      agent
    )
    .toArray();
  if (proj.length === 0) return this.json(404, { error: "project not found" });
  const tasks = (
    this.sql
      .exec("SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC", projectId)
      .toArray() as TaskRecord[]
  ).map((t) => this.kbTaskWithTodos(t));
  return this.json(200, { tasks });
}

// POST /api/kanban/tasks/:id/claim — atomic first-win claim. Auth: Bearer.
export async function handleKbAgentTaskClaim(this: IBusDO, req: Request, id: number): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  try {
    await req.text(); // drain body (claim takes no body)
  } catch {}
  const now = this.kbNow();
  const res = this.sql.exec(
    `UPDATE tasks SET assignee = ?, claimed_at = ?, updated_at = ?, last_activity_at = ?
     WHERE id = ? AND assignee IS NULL
       AND (admin_assigned IS NULL OR admin_assigned = ?)
       AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND p.archived = 1)
       AND ${this.kbSubscriberPred("tasks.project_id")}`,
    agent,
    now,
    now,
    now,
    id,
    agent,
    agent
  ) as { rowsWritten?: number };
  if ((res.rowsWritten ?? 0) > 0) {
    const projRows = this.sql.exec(`SELECT project_id FROM tasks WHERE id = ?`, id).toArray() as Array<{
      project_id: number;
    }>;
    const projId = projRows[0]?.project_id;
    this.kbSystemLog(id, `${agent} claimed the task`);
    this.emitEvent("kanban.task.claimed", {
      actor: agent,
      project_id: projId,
      payload: { id, claimant: agent },
    });
    return this.json(200, { ok: true, id, assignee: agent });
  }
  const rows = this.sql
    .exec(
      `SELECT t.assignee, t.admin_assigned, p.archived
       FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
      id
    )
    .toArray() as Array<{ assignee: string | null; admin_assigned: string | null; archived: number }>;
  const row = rows[0];
  if (!row) return this.json(404, { error: "task not found" });
  if (row.archived) return this.json(403, { error: "project archived" });
  if (row.assignee === agent) return this.json(200, { ok: true, id, assignee: agent, already: true });
  if (row.assignee) return this.json(409, { error: "already claimed by " + row.assignee });
  if (row.admin_assigned) return this.json(403, { error: "admin-locked for " + row.admin_assigned });
  return this.json(403, { error: "project not readable by " + agent });
}

// PUT /api/kanban/tasks/:id/status — {status, blocked_kind?}. Only the assignee. Auth: Bearer.
export async function handleKbAgentTaskStatus(this: IBusDO, req: Request, id: number): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const status = payload?.status;
  if (typeof status !== "string" || !["todo", "doing", "done", "blocked"].includes(status)) {
    return this.json(400, { error: "status must be one of todo/doing/done/blocked" });
  }
  const taskRows = this.sql
    .exec(`SELECT status, blocked_kind, project_id FROM tasks WHERE id = ? AND assignee = ?`, id, agent)
    .toArray() as Array<{ status: string; blocked_kind: BlockedKind | null; project_id: number }>;
  const task = taskRows[0];
  if (!task) {
    const exists = this.sql.exec("SELECT 1 FROM tasks WHERE id = ?", id).toArray();
    if (exists.length === 0) return this.json(404, { error: "task not found" });
    return this.json(403, { error: "not your task" });
  }
  if (this.kbIsArchived(id)) return this.json(403, { error: "project archived" });
  const wasBlocked = task.status === "blocked";
  const willBlock = status === "blocked";
  let blockedKindVal: string | null = null;
  let blockedKindProvided = false;
  if (willBlock) {
    blockedKindProvided = !(
      payload.blocked_kind === undefined ||
      payload.blocked_kind === null ||
      payload.blocked_kind === ""
    );
    const kind = !blockedKindProvided
      ? (wasBlocked ? task.blocked_kind || "waiting-human" : "waiting-human")
      : payload.blocked_kind;
    if (typeof kind !== "string" || !["waiting-human", "waiting-task", "waiting-external"].includes(kind)) {
      return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
    }
    blockedKindVal = kind;
  } else if (
    payload.blocked_kind !== undefined &&
    payload.blocked_kind !== null &&
    payload.blocked_kind !== ""
  ) {
    return this.json(400, { error: "blocked_kind only valid with status=blocked" });
  }
  const now = this.kbNow();
  const setClauses = [`status = ?`, `status_changed_at = ?`, `updated_at = ?`, `last_activity_at = ?`];
  const setVals: (string | number | null)[] = [status, now, now, now];
  if (willBlock && blockedKindProvided) {
    setClauses.push(`blocked_kind = ?`);
    setVals.push(blockedKindVal);
  } else if (!willBlock) {
    setClauses.push(`blocked_kind = NULL`);
  }
  const res = this.sql.exec(
    `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ? AND assignee = ?`,
    ...setVals,
    id,
    agent
  ) as { rowsWritten?: number };
  if ((res.rowsWritten ?? 0) === 0) return this.json(403, { error: "not your task" });
  if (willBlock && !wasBlocked) {
    this.emitEvent("kanban.task.blocked", {
      actor: agent,
      project_id: task.project_id,
      payload: { id, blocked_kind: blockedKindVal },
    });
    this.kbSystemLog(id, `${agent} blocked the task (${blockedKindVal})`);
  } else if (!willBlock && wasBlocked) {
    this.emitEvent("kanban.task.unblocked", {
      actor: agent,
      project_id: task.project_id,
      payload: { id, previous_blocked_kind: task.blocked_kind },
    });
    this.kbSystemLog(id, `${agent} unblocked the task (was ${task.blocked_kind})`);
  } else {
    this.emitEvent("kanban.task.updated", {
      actor: agent,
      project_id: task.project_id,
      payload: { id, change: "status", status },
    });
    this.kbSystemLog(id, `${agent} set status to ${status}`);
  }
  return this.json(200, { ok: true, id, status });
}
