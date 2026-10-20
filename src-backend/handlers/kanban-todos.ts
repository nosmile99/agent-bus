// Kanban todos endpoints (admin & agent)
import type { IBusDO } from '../types.js';

export async function handleKbAdminTodoCreate(this: IBusDO, req: Request, taskId: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const rows = this.sql
    .exec("SELECT project_id FROM tasks WHERE id = ?", taskId)
    .toArray() as Array<{ project_id: number }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  const text = payload?.text;
  if (!payload || typeof text !== "string" || !text.trim()) {
    return this.json(400, { error: "text required" });
  }
  const sortOrder = typeof payload.sort_order === "number" && Number.isInteger(payload.sort_order) ? payload.sort_order : 0;
  this.sql.exec(
    "INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, ?, 0, ?)",
    taskId,
    text.trim(),
    sortOrder
  );
  const nid = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
  this.kbTouchTask(taskId);
  this.emitEvent("kanban.todo.added", {
    actor: "admin",
    project_id: task.project_id,
    payload: { id: nid, task_id: taskId },
  });
  return this.json(200, { ok: true, id: nid });
}

// PUT /admin/api/kanban/todos/:id — {text?, done?, sort_order?}.
export async function handleKbAdminTodoUpdate(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const rows = this.sql
    .exec(
      `SELECT td.task_id, t.project_id FROM todos td JOIN tasks t ON t.id = td.task_id WHERE td.id = ?`,
      id
    )
    .toArray() as Array<{ task_id: number; project_id: number }>;
  const todo = rows[0];
  if (!todo) return this.json(404, { error: "todo not found" });
  const updates: string[] = [];
  const vals: (string | number)[] = [];
  const changes: string[] = [];
  if (typeof payload?.text === "string" && payload.text.trim()) {
    updates.push("text = ?");
    vals.push(payload.text.trim());
    changes.push("text");
  }
  if (
    payload?.done === 0 ||
    payload?.done === 1 ||
    payload?.done === true ||
    payload?.done === false
  ) {
    updates.push("done = ?");
    vals.push(payload.done ? 1 : 0);
    changes.push("done");
  }
  if (typeof payload?.sort_order === "number" && Number.isInteger(payload.sort_order)) {
    updates.push("sort_order = ?");
    vals.push(payload.sort_order);
  }
  if (updates.length === 0) return this.json(400, { error: "nothing to update" });
  vals.push(id);
  this.sql.exec(`UPDATE todos SET ${updates.join(", ")} WHERE id = ?`, ...vals);
  this.kbTouchTask(todo.task_id);
  for (const change of changes) {
    this.emitEvent("kanban.todo.updated", {
      actor: "admin",
      project_id: todo.project_id,
      payload: { id, task_id: todo.task_id, change },
    });
  }
  return this.json(200, { ok: true, id });
}

// DELETE /admin/api/kanban/todos/:id.
export async function handleKbAdminTodoDelete(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  const rows = this.sql
    .exec(
      `SELECT td.task_id, t.project_id FROM todos td JOIN tasks t ON t.id = td.task_id WHERE td.id = ?`,
      id
    )
    .toArray() as Array<{ task_id: number; project_id: number }>;
  const todo = rows[0];
  if (!todo) return this.json(404, { error: "todo not found" });
  this.sql.exec("DELETE FROM todos WHERE id = ?", id);
  this.kbTouchTask(todo.task_id);
  this.emitEvent("kanban.todo.removed", {
    actor: "admin",
    project_id: todo.project_id,
    payload: { id, task_id: todo.task_id },
  });
  return this.json(200, { ok: true, id });
}

export async function handleKbAgentTodoCreate(this: IBusDO, req: Request, taskId: number): Promise<Response> {
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
  const rows = this.sql
    .exec("SELECT assignee, project_id FROM tasks WHERE id = ?", taskId)
    .toArray() as Array<{ assignee: string | null; project_id: number }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  if (task.assignee !== agent) return this.json(403, { error: "not your task" });
  if (this.kbIsArchived(taskId)) return this.json(403, { error: "project archived" });
  const text = payload?.text;
  if (!payload || typeof text !== "string" || !text.trim()) {
    return this.json(400, { error: "text required" });
  }
  this.sql.exec("INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, ?, 0, 0)", taskId, text.trim());
  const nid = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
  this.kbTouchTask(taskId);
  this.emitEvent("kanban.todo.added", {
    actor: agent,
    project_id: task.project_id,
    payload: { id: nid, task_id: taskId },
  });
  return this.json(200, { ok: true, id: nid });
}

// PUT /api/kanban/todos/:id — {text?, done?}. Only the parent task's assignee. Auth: Bearer.
export async function handleKbAgentTodoUpdate(this: IBusDO, req: Request, id: number): Promise<Response> {
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
  const rows = this.sql
    .exec(
      "SELECT td.id, td.task_id, t.assignee, t.project_id FROM todos td JOIN tasks t ON t.id = td.task_id WHERE td.id = ?",
      id
    )
    .toArray() as Array<{ id: number; task_id: number; assignee: string | null; project_id: number }>;
  const row = rows[0];
  if (!row) return this.json(404, { error: "todo not found" });
  if (row.assignee !== agent) return this.json(403, { error: "not your task" });
  if (this.kbIsArchived(row.task_id)) return this.json(403, { error: "project archived" });
  const updates: string[] = [];
  const vals: (string | number)[] = [];
  const changes: string[] = [];
  if (typeof payload?.text === "string" && payload.text.trim()) {
    updates.push("text = ?");
    vals.push(payload.text.trim());
    changes.push("text");
  }
  if (
    payload?.done === 0 ||
    payload?.done === 1 ||
    payload?.done === true ||
    payload?.done === false
  ) {
    updates.push("done = ?");
    vals.push(payload.done ? 1 : 0);
    changes.push("done");
  }
  if (updates.length === 0) return this.json(400, { error: "nothing to update" });
  vals.push(id);
  this.sql.exec(`UPDATE todos SET ${updates.join(", ")} WHERE id = ?`, ...vals);
  this.kbTouchTask(row.task_id);
  for (const change of changes) {
    this.emitEvent("kanban.todo.updated", {
      actor: agent,
      project_id: row.project_id,
      payload: { id, task_id: row.task_id, change },
    });
  }
  return this.json(200, { ok: true, id });
}
