// Kanban expansion: task detail, agent create, search, labels, comments, subscribers

  // ---------- Kanban expansion: task detail, agent create, search, labels, comments, subscribers ----------

  // GET /api/kanban/tasks/:id — task detail. Subscriber predicate + assignee carve-out.
export async function handleKbAgentTaskDetail(req, id) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const row = this.sql.exec(
      `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id = ? AND (${this.kbSubscriberPred("p.id")} OR t.assignee = ?)`,
      id, agent, agent
    ).toArray()[0];
    if (!row) return this.json(404, { error: "task not found" });
    return this.json(200, { task: this.kbTaskDetail(row) });
  }

  // GET /admin/api/kanban/tasks/:id — task detail (admin).
export async function handleKbAdminTaskDetail(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const row = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray()[0];
    if (!row) return this.json(404, { error: "task not found" });
    return this.json(200, { task: this.kbTaskDetail(row) });
  }

  // POST /api/kanban/projects/:id/tasks — agent proposes a task (unassigned todo).
export async function handleKbAgentTaskCreate(req, projectId) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const proj = this.sql.exec(
      `SELECT archived FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`, projectId, agent
    ).toArray()[0];
    if (!proj) return this.json(404, { error: "project not found" });
    if (proj.archived) return this.json(403, { error: "project archived" });
    if (!data || typeof data.title !== "string" || !data.title.trim())
      return this.json(400, { error: "title required" });
    const priority =
      typeof data.priority === "string" && ["low", "normal", "urgent"].includes(data.priority)
        ? data.priority : "normal";
    const now = this.kbNow();
    this.sql.exec(
      `INSERT INTO tasks (project_id, title, description, notes, status, priority, created_by, created_at, updated_at, status_changed_at, last_activity_at)
       VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
      projectId, data.title.trim(),
      typeof data.description === "string" ? data.description : null,
      typeof data.notes === "string" ? data.notes : null,
      priority, agent, now, now, now, now
    );
    const nid = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.kbSystemLog(nid, `${agent} proposed this task`);
    this.emitEvent("kanban.task.created", {
      actor: agent, project_id: projectId,
      payload: { id: nid, project_id: projectId, title: data.title.trim(), created_by: agent },
    });
    return this.json(200, { ok: true, id: nid });
  }

  // PUT /api/kanban/tasks/:id — assignee edits notes/title/description. Auth: Bearer.
  // (M7: kanban rev 4 "Editable by assignee or admin via PUT task endpoint".)
export async function handleKbAgentTaskUpdate(req, id) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const task = this.sql.exec(`SELECT assignee, project_id FROM tasks WHERE id = ?`, id).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (task.assignee !== agent) return this.json(403, { error: "not your task" });
    if (this.kbIsArchived(id)) return this.json(403, { error: "project archived" });
    const updates = [];
    const vals = [];
    const changes = [];
    if (typeof data.title === "string" && data.title.trim()) {
      updates.push("title = ?"); vals.push(data.title.trim()); changes.push("title");
    }
    if (data.description === null || typeof data.description === "string") {
      updates.push("description = ?"); vals.push(data.description); changes.push("description");
    }
    if (data.notes === null || typeof data.notes === "string") {
      updates.push("notes = ?"); vals.push(data.notes); changes.push("notes");
    }
    if (updates.length === 0) return this.json(400, { error: "nothing to update" });
    const now = this.kbNow();
    updates.push("updated_at = ?", "last_activity_at = ?");
    vals.push(now, now, id);
    this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    for (const change of changes) {
      this.emitEvent("kanban.task.updated", {
        actor: agent, project_id: task.project_id, payload: { id, change },
      });
    }
    this.kbSystemLog(id, `${agent} edited ${changes.join(", ")}`);
    return this.json(200, { ok: true, id });
  }

  // GET /api/kanban/tasks/available — unclaimed, non-archived, readable tasks.
export async function handleKbAgentTasksAvailable(req) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const tasks = this.sql.exec(
      `SELECT t.id, t.project_id, t.title, t.priority, t.created_at FROM tasks t
       WHERE t.assignee IS NULL AND t.admin_assigned IS NULL
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)
         AND ${this.kbSubscriberPred("t.project_id")}
       ORDER BY t.id ASC`,
      agent
    ).toArray();
    return this.json(200, { tasks });
  }

  // Shared task search. Admin: ?global=1 for cross-project ("Needs You").
  // Agents: per-project only (?global=1 -> 400).
export async function handleKbTaskSearch(url, { isAdmin, agent, projectId }) {
    const q = url.searchParams.get("q") || "";
    const status = url.searchParams.get("status") || "";
    const assignee = url.searchParams.get("assignee") || "";
    const label = url.searchParams.get("label") || "";
    const blockedKind = url.searchParams.get("blocked_kind") || "";
    const sort = url.searchParams.get("sort") || "";
    const global = url.searchParams.get("global") === "1";
    const includeArchived = url.searchParams.get("include_archived") === "1";
    if (global && !isAdmin) return this.json(400, { error: "global search is admin-only" });
    if (status && !["todo", "doing", "done", "blocked"].includes(status))
      return this.json(400, { error: "invalid status" });
    if (blockedKind && !["waiting-human", "waiting-task", "waiting-external"].includes(blockedKind))
      return this.json(400, { error: "invalid blocked_kind" });
    let projectIds = null;
    if (!global) {
      if (!projectId) return this.json(400, { error: "project required" });
      projectIds = [projectId];
    }
    const { where, params, order } = this.kbTaskSearchWhere({
      projectIds, q, status: status || null, assignee: assignee || null,
      label: label || null, blocked_kind: blockedKind || null,
      sort: sort || null, includeArchived: isAdmin && includeArchived,
      subscriberAgent: isAdmin ? null : agent,
    });
    const tasks = this.sql.exec(
      `SELECT tasks.* FROM tasks WHERE ${where} ORDER BY ${order} LIMIT 200`, ...params
    ).toArray().map((t) => this.kbTaskWithTodos(t));
    return this.json(200, { tasks });
  }

  // GET /admin/api/kanban/projects/:id/labels — distinct labels for filter chips.
export async function handleKbAdminProjectLabels(req, projectId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const labels = this.sql.exec(
      `SELECT DISTINCT tl.label FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
       WHERE t.project_id = ? ORDER BY tl.label`, projectId
    ).toArray().map((r) => r.label);
    return this.json(200, { labels });
  }

  // Shared label add/remove. Agent: assignee-only. Returns {task}.
export function kbLabelOp(taskId, label, op, actor) {
    const clean = typeof label === "string" ? label.trim().toLowerCase() : "";
    if (!clean || clean.length > 32) return { error: "invalid label", code: 400 };
    const task = this.sql.exec(`SELECT project_id FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return { error: "task not found", code: 404 };
    if (op === "add") {
      const res = this.sql.exec(`INSERT OR IGNORE INTO task_labels (task_id, label) VALUES (?, ?)`, taskId, clean);
      if (res.rowsWritten > 0) {
        this.kbTouchTask(taskId);
        this.emitEvent("kanban.label.added", {
          actor, project_id: task.project_id, payload: { task_id: taskId, label: clean },
        });
      }
    } else {
      const res = this.sql.exec(`DELETE FROM task_labels WHERE task_id = ? AND label = ?`, taskId, clean);
      if (res.rowsWritten > 0) {
        this.kbTouchTask(taskId);
        this.emitEvent("kanban.label.removed", {
          actor, project_id: task.project_id, payload: { task_id: taskId, label: clean },
        });
      }
    }
    return { ok: true };
  }

export async function handleKbAgentLabelAdd(req, taskId) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const task = this.sql.exec(`SELECT assignee FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (task.assignee !== agent) return this.json(403, { error: "only the assignee can edit labels" });
    if (this.kbIsArchived(taskId)) return this.json(403, { error: "project archived" });
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const r = this.kbLabelOp(taskId, data && data.label, "add", agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

export async function handleKbAgentLabelRemove(req, taskId, label) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const task = this.sql.exec(`SELECT assignee FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (task.assignee !== agent) return this.json(403, { error: "only the assignee can edit labels" });
    if (this.kbIsArchived(taskId)) return this.json(403, { error: "project archived" });
    const r = this.kbLabelOp(taskId, label, "remove", agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

export async function handleKbAdminLabelAdd(req, taskId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const r = this.kbLabelOp(taskId, data && data.label, "add", "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

export async function handleKbAdminLabelRemove(req, taskId, label) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try { await req.text(); } catch {}
    const r = this.kbLabelOp(taskId, label, "remove", "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // Comments: GET lists all (manual + system; client separates). POST appends.
  // Agent: task.assignee = agent OR subscribed to the project. Archived projects:
  // comments still allowed (the one write exception).
export async function handleKbCommentList(req, url, taskId, { isAdmin, agent }) {
    const task = this.sql.exec(`SELECT project_id, assignee FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (!isAdmin) {
      // Subscriber predicate, with the assignee carve-out (assignee-but-unsubscribed can read own task).
      const sub = this.sql.exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        task.project_id, agent
      ).toArray();
      if (!sub.length && task.assignee !== agent) return this.json(404, { error: "task not found" });
    }
    const comments = this.sql.exec(
      `SELECT id, author, body, ts FROM task_comments WHERE task_id = ? ORDER BY ts ASC, id ASC`, taskId
    ).toArray();
    return this.json(200, { comments });
  }

export async function handleKbCommentAdd(req, taskId, { isAdmin, agent }) {
    const actor = isAdmin ? "admin" : agent;
    const task = this.sql.exec(`SELECT project_id, assignee FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (!isAdmin) {
      const sub = this.sql.exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        task.project_id, agent
      ).toArray();
      // Archived projects: comments allowed (the one write exception).
      if (!sub.length && task.assignee !== agent) return this.json(404, { error: "task not found" });
    }
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    if (!data || typeof data.body !== "string" || !data.body.trim())
      return this.json(400, { error: "body required" });
    if (new TextEncoder().encode(data.body).length > 8192)
      return this.json(413, { error: "body too large (max 8192 bytes)" });
    const now = this.kbNow();
    this.sql.exec(
      `INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, ?, ?, ?)`,
      taskId, actor, data.body.trim(), now
    );
    const nid = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.kbTouchTask(taskId);
    // Manual comments emit; system auto-log is silent (kanban rev 4).
    this.emitEvent("kanban.comment.added", {
      actor, project_id: task.project_id, payload: { id: nid, task_id: taskId, author: actor },
    });
    return this.json(200, { ok: true, id: nid });
  }

  // GET /admin/api/kanban/projects/:id/subscribers
export async function handleKbAdminProjectSubscribers(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const exists = this.sql.exec(`SELECT 1 FROM projects WHERE id = ?`, id).toArray();
    if (!exists.length) return this.json(404, { error: "project not found" });
    return this.json(200, { subscribers: this.kbProjectSubscribers(id) });
  }

  // POST /admin/api/password — change admin credentials (Ryuki #286).
  // Requires valid Basic auth (current password). Body: { newUser?, newPassword }.
  // newPassword min length 12. Updates the admins table; old password stops working immediately.
