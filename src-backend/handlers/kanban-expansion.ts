// Kanban expansion: task detail, agent create, search, labels, comments, subscribers
import type { IBusDO, TaskRecord, TaskCommentRecord } from '../types.js';

// GET /api/kanban/tasks/:id — task detail. Subscriber predicate + assignee carve-out.
export async function handleKbAgentTaskDetail(this: IBusDO, req: Request, id: number): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const rows = this.sql
    .exec(
      `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id = ? AND (${this.kbSubscriberPred("p.id")} OR t.assignee = ?)`,
      id,
      agent,
      agent
    )
    .toArray() as TaskRecord[];
  const row = rows[0];
  if (!row) return this.json(404, { error: "task not found" });
  return this.json(200, { task: this.kbTaskDetail(row) });
}

// GET /admin/api/kanban/tasks/:id — task detail (admin).
export async function handleKbAdminTaskDetail(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const rows = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray() as TaskRecord[];
  const row = rows[0];
  if (!row) return this.json(404, { error: "task not found" });
  return this.json(200, { task: this.kbTaskDetail(row) });
}

// POST /api/kanban/projects/:id/tasks — agent proposes a task (unassigned todo).
export async function handleKbAgentTaskCreate(this: IBusDO, req: Request, projectId: number): Promise<Response> {
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
  const projRows = this.sql
    .exec(
      `SELECT archived FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
      projectId,
      agent
    )
    .toArray() as Array<{ archived: number }>;
  const proj = projRows[0];
  if (!proj) return this.json(404, { error: "project not found" });
  if (proj.archived) return this.json(403, { error: "project archived" });
  const title = payload?.title;
  if (!payload || typeof title !== "string" || !title.trim()) {
    return this.json(400, { error: "title required" });
  }
  const priority =
    typeof payload.priority === "string" && ["low", "normal", "urgent"].includes(payload.priority)
      ? payload.priority
      : "normal";
  const now = this.kbNow();
  this.sql.exec(
    `INSERT INTO tasks (project_id, title, description, notes, status, priority, created_by, created_at, updated_at, status_changed_at, last_activity_at)
     VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
    projectId,
    title.trim(),
    typeof payload.description === "string" ? payload.description : null,
    typeof payload.notes === "string" ? payload.notes : null,
    priority,
    agent,
    now,
    now,
    now,
    now
  );
  const nid = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
  this.kbSystemLog(nid, `${agent} proposed this task`);
  this.emitEvent("kanban.task.created", {
    actor: agent,
    project_id: projectId,
    payload: { id: nid, project_id: projectId, title: title.trim(), created_by: agent },
  });
  return this.json(200, { ok: true, id: nid });
}

// PUT /api/kanban/tasks/:id — assignee edits notes/title/description. Auth: Bearer.
export async function handleKbAgentTaskUpdate(this: IBusDO, req: Request, id: number): Promise<Response> {
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
  const taskRows = this.sql
    .exec(`SELECT assignee, project_id FROM tasks WHERE id = ?`, id)
    .toArray() as Array<{ assignee: string | null; project_id: number }>;
  const task = taskRows[0];
  if (!task) return this.json(404, { error: "task not found" });
  if (task.assignee !== agent) return this.json(403, { error: "not your task" });
  if (this.kbIsArchived(id)) return this.json(403, { error: "project archived" });
  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  const changes: string[] = [];
  if (typeof payload?.title === "string" && payload.title.trim()) {
    updates.push("title = ?");
    vals.push(payload.title.trim());
    changes.push("title");
  }
  if (payload && "description" in payload) {
    if (payload.description === null || typeof payload.description === "string") {
      updates.push("description = ?");
      vals.push(payload.description);
      changes.push("description");
    }
  }
  if (payload && "notes" in payload) {
    if (payload.notes === null || typeof payload.notes === "string") {
      updates.push("notes = ?");
      vals.push(payload.notes);
      changes.push("notes");
    }
  }
  if (updates.length === 0) return this.json(400, { error: "nothing to update" });
  const now = this.kbNow();
  updates.push("updated_at = ?", "last_activity_at = ?");
  vals.push(now, now, id);
  this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
  for (const change of changes) {
    this.emitEvent("kanban.task.updated", {
      actor: agent,
      project_id: task.project_id,
      payload: { id, change },
    });
  }
  this.kbSystemLog(id, `${agent} edited ${changes.join(", ")}`);
  return this.json(200, { ok: true, id });
}

// GET /api/kanban/tasks/available — unclaimed, non-archived, readable tasks.
export async function handleKbAgentTasksAvailable(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const tasks = this.sql
    .exec(
      `SELECT t.id, t.project_id, t.title, t.priority, t.created_at FROM tasks t
       WHERE t.assignee IS NULL AND t.admin_assigned IS NULL
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)
         AND ${this.kbSubscriberPred("t.project_id")}
       ORDER BY t.id ASC`,
      agent
    )
    .toArray();
  return this.json(200, { tasks });
}

// Shared task search. Admin: ?global=1 for cross-project ("Needs You").
// Agents: per-project only (?global=1 -> 400).
export async function handleKbTaskSearch(
  this: IBusDO,
  url: URL,
  { isAdmin, agent, projectId }: { isAdmin: boolean; agent: string | null; projectId: number | null }
): Promise<Response> {
  const q = url.searchParams.get("q") || "";
  const status = url.searchParams.get("status") || "";
  const assignee = url.searchParams.get("assignee") || "";
  const label = url.searchParams.get("label") || "";
  const blockedKind = url.searchParams.get("blocked_kind") || "";
  const sort = url.searchParams.get("sort") || "";
  const global = url.searchParams.get("global") === "1";
  const includeArchived = url.searchParams.get("include_archived") === "1";
  if (global && !isAdmin) return this.json(400, { error: "global search is admin-only" });
  if (status && !["todo", "doing", "done", "blocked"].includes(status)) {
    return this.json(400, { error: "invalid status" });
  }
  if (blockedKind && !["waiting-human", "waiting-task", "waiting-external"].includes(blockedKind)) {
    return this.json(400, { error: "invalid blocked_kind" });
  }
  let projectIds: number[] | null = null;
  if (!global) {
    if (!projectId) return this.json(400, { error: "project required" });
    projectIds = [projectId];
  }
  const { where, params, order } = this.kbTaskSearchWhere({
    projectIds,
    q,
    status: status || null,
    assignee: assignee || null,
    label: label || null,
    blocked_kind: blockedKind || null,
    sort: sort || null,
    includeArchived: isAdmin && includeArchived,
    subscriberAgent: isAdmin ? null : agent,
  });
  const tasks = (
    this.sql.exec(`SELECT tasks.* FROM tasks WHERE ${where} ORDER BY ${order} LIMIT 200`, ...params).toArray() as TaskRecord[]
  ).map((t) => this.kbTaskWithTodos(t));
  return this.json(200, { tasks });
}

// GET /admin/api/kanban/projects/:id/labels — distinct labels for filter chips.
export async function handleKbAdminProjectLabels(this: IBusDO, req: Request, projectId: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const labels = (
    this.sql
      .exec(
        `SELECT DISTINCT tl.label FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
         WHERE t.project_id = ? ORDER BY tl.label`,
        projectId
      )
      .toArray() as Array<{ label: string }>
  ).map((r) => r.label);
  return this.json(200, { labels });
}

// Shared label add/remove. Agent: assignee-only.
export function kbLabelOp(
  this: IBusDO,
  taskId: number,
  label: unknown,
  op: "add" | "remove",
  actor: string
): { ok?: true; error?: string; code: number } {
  const clean = typeof label === "string" ? label.trim().toLowerCase() : "";
  if (!clean || clean.length > 32) return { error: "invalid label", code: 400 };
  const rows = this.sql
    .exec(`SELECT project_id FROM tasks WHERE id = ?`, taskId)
    .toArray() as Array<{ project_id: number }>;
  const task = rows[0];
  if (!task) return { error: "task not found", code: 404 };
  if (op === "add") {
    const res = this.sql.exec(
      `INSERT OR IGNORE INTO task_labels (task_id, label) VALUES (?, ?)`,
      taskId,
      clean
    ) as { rowsWritten?: number };
    if ((res.rowsWritten ?? 0) > 0) {
      this.kbTouchTask(taskId);
      this.emitEvent("kanban.label.added", {
        actor,
        project_id: task.project_id,
        payload: { task_id: taskId, label: clean },
      });
    }
  } else {
    const res = this.sql.exec(
      `DELETE FROM task_labels WHERE task_id = ? AND label = ?`,
      taskId,
      clean
    ) as { rowsWritten?: number };
    if ((res.rowsWritten ?? 0) > 0) {
      this.kbTouchTask(taskId);
      this.emitEvent("kanban.label.removed", {
        actor,
        project_id: task.project_id,
        payload: { task_id: taskId, label: clean },
      });
    }
  }
  return { ok: true, code: 200 };
}

export async function handleKbAgentLabelAdd(this: IBusDO, req: Request, taskId: number): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const rows = this.sql.exec(`SELECT assignee FROM tasks WHERE id = ?`, taskId).toArray() as Array<{
    assignee: string | null;
  }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  if (task.assignee !== agent) return this.json(403, { error: "only the assignee can edit labels" });
  if (this.kbIsArchived(taskId)) return this.json(403, { error: "project archived" });
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const r = this.kbLabelOp(taskId, payload?.label, "add", agent);
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true });
}

export async function handleKbAgentLabelRemove(
  this: IBusDO,
  req: Request,
  taskId: number,
  label: string
): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const rows = this.sql.exec(`SELECT assignee FROM tasks WHERE id = ?`, taskId).toArray() as Array<{
    assignee: string | null;
  }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  if (task.assignee !== agent) return this.json(403, { error: "only the assignee can edit labels" });
  if (this.kbIsArchived(taskId)) return this.json(403, { error: "project archived" });
  const r = this.kbLabelOp(taskId, label, "remove", agent);
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true });
}

export async function handleKbAdminLabelAdd(this: IBusDO, req: Request, taskId: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const r = this.kbLabelOp(taskId, payload?.label, "add", "admin");
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true });
}

export async function handleKbAdminLabelRemove(
  this: IBusDO,
  req: Request,
  taskId: number,
  label: string
): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  const r = this.kbLabelOp(taskId, label, "remove", "admin");
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true });
}

// Comments: GET lists all (manual + system; client separates). POST appends.
export async function handleKbCommentList(
  this: IBusDO,
  req: Request,
  _url: URL,
  taskId: number,
  { isAdmin, agent }: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  const rows = this.sql
    .exec(`SELECT project_id, assignee FROM tasks WHERE id = ?`, taskId)
    .toArray() as Array<{ project_id: number; assignee: string | null }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  if (!isAdmin) {
    const sub = this.sql
      .exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        task.project_id,
        agent
      )
      .toArray();
    if (!sub.length && task.assignee !== agent) return this.json(404, { error: "task not found" });
  }
  const comments = this.sql
    .exec(`SELECT id, author, body, ts FROM task_comments WHERE task_id = ? ORDER BY ts ASC, id ASC`, taskId)
    .toArray() as TaskCommentRecord[];
  return this.json(200, { comments });
}

export async function handleKbCommentAdd(
  this: IBusDO,
  req: Request,
  taskId: number,
  { isAdmin, agent }: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  const actor = isAdmin ? "admin" : agent || "";
  const rows = this.sql
    .exec(`SELECT project_id, assignee FROM tasks WHERE id = ?`, taskId)
    .toArray() as Array<{ project_id: number; assignee: string | null }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  if (!isAdmin) {
    const sub = this.sql
      .exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        task.project_id,
        agent
      )
      .toArray();
    // Archived projects: comments allowed (the one write exception).
    if (!sub.length && task.assignee !== agent) return this.json(404, { error: "task not found" });
  }
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const body = payload?.body;
  if (!payload || typeof body !== "string" || !body.trim()) {
    return this.json(400, { error: "body required" });
  }
  if (new TextEncoder().encode(body).length > 8192) {
    return this.json(413, { error: "body too large (max 8192 bytes)" });
  }
  const now = this.kbNow();
  this.sql.exec(
    `INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, ?, ?, ?)`,
    taskId,
    actor,
    body.trim(),
    now
  );
  const nid = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
  this.kbTouchTask(taskId);
  // Manual comments emit; system auto-log is silent (kanban rev 4).
  this.emitEvent("kanban.comment.added", {
    actor,
    project_id: task.project_id,
    payload: { id: nid, task_id: taskId, author: actor },
  });
  return this.json(200, { ok: true, id: nid });
}

// GET /admin/api/kanban/projects/:id/subscribers
export async function handleKbAdminProjectSubscribers(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const exists = this.sql.exec(`SELECT 1 FROM projects WHERE id = ?`, id).toArray();
  if (!exists.length) return this.json(404, { error: "project not found" });
  return this.json(200, { subscribers: this.kbProjectSubscribers(id) });
}
