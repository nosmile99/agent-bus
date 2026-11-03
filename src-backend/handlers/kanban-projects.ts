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
  // m-5 fix: the unarchive UPDATE and the re-evaluation it triggers
  // run in a single transaction (previously two: the UPDATE outside,
  // the re-evaluation inside its own transactionSync).
  const isUnarchive = exists.archived && payload && (payload.archived === 0 || payload.archived === false);
  let unarchiveFanout: {
    unblocked: { processed: number; capped: boolean; pending_sweep: boolean };
    reblocked: { processed: number; capped: boolean; pending_sweep: boolean };
    capped: boolean;
    pending_sweep: boolean;
    processed: number;
  } | null = null;
  if (updates.length > 0) {
    vals.push(id);
    if (isUnarchive) {
      this.state.storage.transactionSync(() => {
        this.sql.exec(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, ...vals);
        unarchiveFanout = this.depReevaluateProject(id, this.kbNow());
      });
    } else {
      this.sql.exec(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    }
  } else if (isUnarchive) {
    this.state.storage.transactionSync(() => {
      unarchiveFanout = this.depReevaluateProject(id, this.kbNow());
    });
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
  // Fix round 4, item 4: unarchive fan-out stats in the response
  // when the re-evaluation ran.
  return this.json(200, {
    ok: true,
    id,
    ...(unarchiveFanout ? { dependency_fanout: unarchiveFanout } : {}),
  });
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
  // Amendment batch item 24: full fan-out impact, snapshotted
  // BEFORE the cascade delete (same cap/truncation contract
  // as task delete). The cascade removes tasks, their links,
  // todos, labels, comments, and the subscriber rows.
  const projectFanout = {
    tasks: this.kbFanoutIds((this.sql.exec(`SELECT id FROM tasks WHERE project_id = ?`, id).toArray() as Array<{ id: number }>).map((r) => r.id)),
    links: this.kbFanoutPairs(this.sql.exec(
      `SELECT blocker_id, blocked_id FROM task_dependencies d WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = ? AND (t.id = d.blocker_id OR t.id = d.blocked_id))`,
      id
    ).toArray() as Array<{ blocker_id: number; blocked_id: number }>),
    todos: { count: (this.sql.exec(`SELECT COUNT(*) AS c FROM todos WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, id).one() as { c: number }).c },
    labels: { count: (this.sql.exec(`SELECT COUNT(*) AS c FROM task_labels WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, id).one() as { c: number }).c },
    comments: { count: (this.sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, id).one() as { c: number }).c },
    subscribers: subs,
  };
  // Revamp v12 §4.1 rule 7: dependency links cascade with one unlink
  // event per removed link, in the same transaction as the delete.
  // Fix round 5, M7: the cascade summary is surfaced, not dropped.
  let cascadeSummary: { links_removed: number; tasks_deleted: number } | null = null;
  this.state.storage.transactionSync(() => {
    cascadeSummary = this.depCascadeOnProjectDelete(id, this.kbNow());
  });
  this.emitEvent("kanban.project.deleted", {
    actor: "admin",
    project_id: id,
    recipients: recipients.length ? recipients : null,
    payload: { id },
  });
  return this.json(200, { ok: true, id, fanout: projectFanout, ...(cascadeSummary ? { dependency_cascade: cascadeSummary } : {}) });
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
