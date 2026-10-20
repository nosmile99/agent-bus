// Kanban projects endpoints (admin & agent)
import type { IBusDO, ProjectRecord } from '../types.js';

export function kbNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function kbBasicUser(req: Request): string {
  try {
    const h = req.headers.get("Authorization") || "";
    const m = /^Basic (\S+)$/.exec(h);
    if (!m || !m[1]) return "";
    const d = atob(m[1]);
    const i = d.indexOf(":");
    return i < 0 ? "" : d.slice(0, i);
  } catch {
    return "";
  }
}

// GET /admin/api/kanban/projects — list with task counts.
export async function handleKbAdminProjectsList(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const projects = this.sql
    .exec(
      `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
       FROM projects p ORDER BY p.archived ASC, p.id DESC`
    )
    .toArray();
  return this.json(200, { projects });
}

// POST /admin/api/kanban/projects — {title, description?, subscribers?}.
export async function handleKbAdminProjectCreate(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const title = payload?.title;
  if (!payload || typeof title !== "string" || !title.trim()) {
    return this.json(400, { error: "title required" });
  }
  const now = this.kbNow();
  const adminUser = this.kbBasicUser(req);
  this.sql.exec(
    "INSERT INTO projects (title, description, created_by, created_at, archived) VALUES (?, ?, ?, ?, 0)",
    title.trim(),
    typeof payload.description === "string" ? payload.description : null,
    adminUser,
    now
  );
  const row = this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number };
  const id = row.id;
  const subs = this.kbSetSubscribers(id, payload.subscribers, adminUser);
  this.emitEvent("kanban.project.created", {
    actor: "admin",
    project_id: id,
    scope: subs.length ? undefined : "all",
    recipients: subs.length ? subs : null,
    payload: { id, title: title.trim(), subscribers: subs },
  });
  return this.json(200, { ok: true, id });
}

// PUT /admin/api/kanban/projects/:id — {title?, description?, archived?, subscribers?}.
export async function handleKbAdminProjectUpdate(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const existsRows = this.sql.exec("SELECT archived FROM projects WHERE id = ?", id).toArray() as Array<{
    archived: number;
  }>;
  const exists = existsRows[0];
  if (!exists) return this.json(404, { error: "project not found" });
  const adminUser = this.kbBasicUser(req);
  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  const changed: string[] = [];
  if (typeof payload?.title === "string" && payload.title.trim()) {
    updates.push("title = ?");
    vals.push(payload.title.trim());
    changed.push("title");
  }
  if (payload && ("description" in payload)) {
    if (payload.description === null || typeof payload.description === "string") {
      updates.push("description = ?");
      vals.push(payload.description);
      changed.push("description");
    }
  }
  if (
    payload?.archived === 0 ||
    payload?.archived === 1 ||
    payload?.archived === true ||
    payload?.archived === false
  ) {
    updates.push("archived = ?");
    vals.push(payload.archived ? 1 : 0);
  }
  let subChanged = false;
  let oldSubs: string[] = [];
  let newSubs: string[] = [];
  if (payload && "subscribers" in payload) {
    oldSubs = this.kbProjectSubscribers(id);
    newSubs = this.kbSetSubscribers(id, payload.subscribers, adminUser);
    subChanged = JSON.stringify([...oldSubs].sort()) !== JSON.stringify([...newSubs].sort());
  }
  if (updates.length === 0 && !subChanged) {
    return this.json(400, { error: "nothing to update" });
  }
  if (updates.length > 0) {
    vals.push(id);
    this.sql.exec(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, ...vals);
  }
  if (changed.length > 0) {
    // One event per changed field; change is a singular string (M8).
    for (const change of changed) {
      this.emitEvent("kanban.project.updated", {
        actor: "admin",
        project_id: id,
        payload: { id, change },
      });
    }
  }
  if (
    payload &&
    "archived" in payload &&
    (payload.archived === 1 || payload.archived === true) &&
    !exists.archived
  ) {
    this.emitEvent("kanban.project.archived", { actor: "admin", project_id: id, payload: { id } });
  }
  if (subChanged) {
    const union = [...new Set([...oldSubs, ...newSubs])];
    const added = newSubs.filter((s) => !oldSubs.includes(s));
    const removed = oldSubs.filter((s) => !newSubs.includes(s));
    this.emitEvent("kanban.project.subscribers_changed", {
      actor: "admin",
      project_id: id,
      recipients: union,
      payload: { id, added, removed, subscribers: newSubs },
    });
  }
  return this.json(200, { ok: true, id });
}

// DELETE /admin/api/kanban/projects/:id — cascade deletes tasks + todos via FK.
export async function handleKbAdminProjectDelete(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  const exists = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", id).toArray();
  if (exists.length === 0) return this.json(404, { error: "project not found" });
  // Capture the subscriber union BEFORE the cascade delete (poll rev 3) —
  // after deletion the live predicate can't match anything. Open projects
  // (no subscribers) reach all registered agents.
  const subs = this.kbProjectSubscribers(id);
  const recipients = subs.length ? subs : this.allAgents().map((a) => a.agent);
  this.sql.exec("DELETE FROM projects WHERE id = ?", id);
  this.emitEvent("kanban.project.deleted", {
    actor: "admin",
    project_id: id,
    recipients: recipients.length ? recipients : null,
    payload: { id },
  });
  return this.json(200, { ok: true, id });
}

export async function handleKbAgentProjectsList(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const projects = (
    this.sql
      .exec(
        `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
         FROM projects p WHERE p.archived = 0 AND ${this.kbSubscriberPred("p.id")} ORDER BY p.id DESC`,
        agent
      )
      .toArray() as unknown as ProjectRecord[]
  ).map((p) => ({ ...p, subscribers: this.kbProjectSubscribers(p.id) }));
  return this.json(200, { projects });
}
