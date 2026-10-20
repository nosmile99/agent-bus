// Kanban endpoints (projects, tasks, claim, status)
export * from './kanban-projects.js';
export * from './kanban-todos.js';
export * from './kanban-expansion.js';

export function kbTodosFor(taskId) {
    return this.sql
      .exec(
        "SELECT id, task_id, text, done, sort_order FROM todos WHERE task_id = ? ORDER BY sort_order ASC, id ASC",
        taskId
      )
      .toArray();
  }

export function kbTaskWithTodos(row) {
    return { ...row, todos: this.kbTodosFor(row.id) };
  }

  // GET /admin/api/kanban/projects — list with task counts.

export async function handleKbAdminTasksList(req, projectId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const proj = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", projectId).toArray();
    if (proj.length === 0) return this.json(404, { error: "project not found" });
    const tasks = this.sql
      .exec("SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC", projectId)
      .toArray()
      .map((t) => this.kbTaskWithTodos(t));
    return this.json(200, { tasks });
  }

  // POST /admin/api/kanban/projects/:id/tasks — {title, description?, priority?, notes?}.
export async function handleKbAdminTaskCreate(req, projectId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const proj = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", projectId).toArray();
    if (proj.length === 0) return this.json(404, { error: "project not found" });
    if (!data || typeof data.title !== "string" || !data.title.trim())
      return this.json(400, { error: "title required" });
    const priority =
      typeof data.priority === "string" && ["low", "normal", "urgent"].includes(data.priority)
        ? data.priority
        : "normal";
    const now = this.kbNow();
    const notes = typeof data.notes === "string" ? data.notes : null;
    this.sql.exec(
      "INSERT INTO tasks (project_id, title, description, notes, status, priority, created_by, created_at, updated_at, status_changed_at, last_activity_at) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)",
      projectId,
      data.title.trim(),
      typeof data.description === "string" ? data.description : null,
      notes,
      priority,
      this.kbBasicUser(req),
      now,
      now,
      now,
      now
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.emitEvent("kanban.task.created", {
      actor: "admin", project_id: projectId,
      payload: { id, project_id: projectId, title: data.title.trim() },
    });
    return this.json(200, { ok: true, id });
  }

  // PUT /admin/api/kanban/tasks/:id — {title?, description?, status?, priority?, assignee?}.
  // Sync rule: setting assignee also sets admin_assigned (same value) + claimed_at.
  // Explicit null assignee clears both (release back to pool).
  // PUT /admin/api/kanban/tasks/:id — {title?, description?, notes?, status?, priority?, assignee?, blocked_kind?}.
  // Sync rule: setting assignee also sets admin_assigned (same value) + claimed_at.
  // Explicit null assignee clears both (release back to pool).
  // blocked_kind sync rule: status != 'blocked' forces blocked_kind = NULL.
export async function handleKbAdminTaskUpdate(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const task = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    const updates = [];
    const vals = [];
    const now = this.kbNow();
    const fieldEvents = []; // kanban.task.updated changes
    if (typeof data.title === "string" && data.title.trim()) {
      updates.push("title = ?");
      vals.push(data.title.trim());
      fieldEvents.push("title");
    }
    if (data.description === null || typeof data.description === "string") {
      updates.push("description = ?");
      vals.push(data.description);
      fieldEvents.push("description");
    }
    if (data.notes === null || typeof data.notes === "string") {
      updates.push("notes = ?");
      vals.push(data.notes);
      fieldEvents.push("notes");
    }
    let statusEvent = null;
    let blockedKindVal = null;
    if (typeof data.status === "string" && ["todo", "doing", "done", "blocked"].includes(data.status)) {
      updates.push("status = ?", "status_changed_at = ?");
      vals.push(data.status, now);
      const wasBlocked = task.status === "blocked";
      const willBlock = data.status === "blocked";
      // blocked_kind sync rule (kanban rev 4, normative).
      if (willBlock) {
        const kindProvided = !(data.blocked_kind === undefined || data.blocked_kind === null || data.blocked_kind === "");
        // M3: re-asserting blocked without a kind preserves the existing kind.
        const kind = !kindProvided
          ? (wasBlocked ? task.blocked_kind || "waiting-human" : "waiting-human")
          : data.blocked_kind;
        if (!["waiting-human", "waiting-task", "waiting-external"].includes(kind))
          return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
        if (kindProvided || !wasBlocked) {
          updates.push("blocked_kind = ?");
          vals.push(kind);
        }
        blockedKindVal = kind;
      } else {
        if (data.blocked_kind !== undefined && data.blocked_kind !== null && data.blocked_kind !== "")
          return this.json(400, { error: "blocked_kind only valid with status=blocked" });
        updates.push("blocked_kind = NULL");
      }
      if (willBlock && !wasBlocked) {
        statusEvent = { type: "kanban.task.blocked", payload: { id, blocked_kind: blockedKindVal } };
      } else if (!willBlock && wasBlocked) {
        statusEvent = { type: "kanban.task.unblocked", payload: { id, previous_blocked_kind: task.blocked_kind } };
      } else {
        statusEvent = { type: "kanban.task.updated", payload: { id, change: "status", status: data.status } };
      }
    } else if (data.blocked_kind !== undefined && data.blocked_kind !== null && data.blocked_kind !== "") {
      // Minor#1: kind-only update allowed when the task is already blocked.
      if (task.status !== "blocked")
        return this.json(400, { error: "blocked_kind only valid with status=blocked" });
      if (!["waiting-human", "waiting-task", "waiting-external"].includes(data.blocked_kind))
        return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
      updates.push("blocked_kind = ?");
      vals.push(data.blocked_kind);
      fieldEvents.push("blocked_kind");
    }
    if (typeof data.priority === "string" && ["low", "normal", "urgent"].includes(data.priority)) {
      updates.push("priority = ?");
      vals.push(data.priority);
      fieldEvents.push("priority");
    }
    if (data && "assignee" in data) {
      if (data.assignee === null) {
        updates.push("assignee = NULL", "admin_assigned = NULL");
        fieldEvents.push("assignee");
      } else if (typeof data.assignee === "string" && data.assignee) {
        updates.push("assignee = ?", "admin_assigned = ?", "claimed_at = ?");
        vals.push(data.assignee, data.assignee, now);
        fieldEvents.push("assignee");
      } else {
        return this.json(400, { error: "assignee must be a string or null" });
      }
    }
    if (updates.length === 0) return this.json(400, { error: "nothing to update" });
    updates.push("updated_at = ?", "last_activity_at = ?");
    vals.push(now, now, id);
    this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    // Events (poll rev 3 write->event mapping, one event per write).
    for (const change of fieldEvents) {
      this.emitEvent("kanban.task.updated", {
        actor: "admin", project_id: task.project_id, payload: { id, change },
      });
    }
    if (statusEvent) {
      this.emitEvent(statusEvent.type, {
        actor: "admin", project_id: task.project_id, payload: statusEvent.payload,
      });
    }
    if (statusEvent || fieldEvents.length) {
      this.kbSystemLog(id, `admin updated: ${[...fieldEvents, statusEvent ? statusEvent.type.split(".").pop() : null].filter(Boolean).join(", ")}`);
    }
    return this.json(200, { ok: true, id });
  }

  // DELETE /admin/api/kanban/tasks/:id — cascade deletes todos via FK.
export async function handleKbAdminTaskDelete(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    const task = this.sql.exec(`SELECT project_id FROM tasks WHERE id = ?`, id).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    this.sql.exec("DELETE FROM tasks WHERE id = ?", id);
    this.emitEvent("kanban.task.deleted", {
      actor: "admin", project_id: task.project_id, payload: { id },
    });
    return this.json(200, { ok: true, id });
  }

  // POST /admin/api/kanban/tasks/:id/todos — {text, sort_order?}.

export async function handleKbAgentTasksList(req, projectId) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    const proj = this.sql.exec(
      `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`, projectId, agent
    ).toArray();
    if (proj.length === 0) return this.json(404, { error: "project not found" });
    const tasks = this.sql
      .exec("SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC", projectId)
      .toArray()
      .map((t) => this.kbTaskWithTodos(t));
    return this.json(200, { tasks });
  }

  // POST /api/kanban/tasks/:id/claim — atomic first-win claim. Auth: Bearer.
  // Single conditional UPDATE (no SELECT-then-UPDATE race). Admin lock + archived
  // checks + subscriber predicate live in the WHERE clause.
  // 0 rows -> SELECT classifies the error.
export async function handleKbAgentTaskClaim(req, id) {
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
    );
    if (res.rowsWritten > 0) {
      const projId = this.sql.exec(`SELECT project_id FROM tasks WHERE id = ?`, id).toArray()[0].project_id;
      this.kbSystemLog(id, `${agent} claimed the task`);
      this.emitEvent("kanban.task.claimed", {
        actor: agent, project_id: projId, payload: { id, claimant: agent },
      });
      return this.json(200, { ok: true, id, assignee: agent });
    }
    // 0 rows: classify for error reporting ONLY (the claim decision already happened).
    const row = this.sql
      .exec(
        `SELECT t.assignee, t.admin_assigned, p.archived
         FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
        id
      )
      .toArray()[0];
    if (!row) return this.json(404, { error: "task not found" });
    if (row.archived) return this.json(403, { error: "project archived" });
    if (row.assignee === agent) return this.json(200, { ok: true, id, assignee: agent, already: true });
    if (row.assignee) return this.json(409, { error: "already claimed by " + row.assignee });
    if (row.admin_assigned) return this.json(403, { error: "admin-locked for " + row.admin_assigned });
    // Unclaimed + unlocked but the atomic UPDATE matched 0 rows: subscriber gate.
    return this.json(403, { error: "project not readable by " + agent });
  }

  // PUT /api/kanban/tasks/:id/status — {status, blocked_kind?}. Only the assignee. Auth: Bearer.
export async function handleKbAgentTaskStatus(req, id) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    if (!data || !["todo", "doing", "done", "blocked"].includes(data.status))
      return this.json(400, { error: "status must be one of todo/doing/done/blocked" });
    const task = this.sql.exec(`SELECT status, blocked_kind, project_id FROM tasks WHERE id = ? AND assignee = ?`, id, agent).toArray()[0];
    if (!task) {
      const exists = this.sql.exec("SELECT 1 FROM tasks WHERE id = ?", id).toArray();
      if (exists.length === 0) return this.json(404, { error: "task not found" });
      return this.json(403, { error: "not your task" });
    }
    if (this.kbIsArchived(id)) return this.json(403, { error: "project archived" });
    const wasBlocked = task.status === "blocked";
    const willBlock = data.status === "blocked";
    let blockedKindVal = null;
    let blockedKindProvided = false;
    if (willBlock) {
      blockedKindProvided = !(data.blocked_kind === undefined || data.blocked_kind === null || data.blocked_kind === "");
      const kind = !blockedKindProvided
        ? (wasBlocked ? task.blocked_kind || "waiting-human" : "waiting-human")  // M3: re-assert preserves kind
        : data.blocked_kind;
      if (!["waiting-human", "waiting-task", "waiting-external"].includes(kind))
        return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
      blockedKindVal = kind;
    } else if (data.blocked_kind !== undefined && data.blocked_kind !== null && data.blocked_kind !== "") {
      return this.json(400, { error: "blocked_kind only valid with status=blocked" });
    }
    const now = this.kbNow();
    const setClauses = [`status = ?`, `status_changed_at = ?`, `updated_at = ?`, `last_activity_at = ?`];
    const setVals = [data.status, now, now, now];
    if (willBlock && blockedKindProvided) {
      setClauses.push(`blocked_kind = ?`);
      setVals.push(blockedKindVal);
    } else if (!willBlock) {
      setClauses.push(`blocked_kind = NULL`);
    }
    // (willBlock && !blockedKindProvided && wasBlocked): leave blocked_kind untouched (M3).
    const res = this.sql.exec(
      `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ? AND assignee = ?`,
      ...setVals, id, agent
    );
    if (res.rowsWritten === 0) return this.json(403, { error: "not your task" });
    // Events (poll rev 3 write->event mapping).
    if (willBlock && !wasBlocked) {
      this.emitEvent("kanban.task.blocked", {
        actor: agent, project_id: task.project_id, payload: { id, blocked_kind: blockedKindVal },
      });
      this.kbSystemLog(id, `${agent} blocked the task (${blockedKindVal})`);
    } else if (!willBlock && wasBlocked) {
      this.emitEvent("kanban.task.unblocked", {
        actor: agent, project_id: task.project_id, payload: { id, previous_blocked_kind: task.blocked_kind },
      });
      this.kbSystemLog(id, `${agent} unblocked the task (was ${task.blocked_kind})`);
    } else {
      this.emitEvent("kanban.task.updated", {
        actor: agent, project_id: task.project_id, payload: { id, change: "status", status: data.status },
      });
      this.kbSystemLog(id, `${agent} set status to ${data.status}`);
    }
    return this.json(200, { ok: true, id, status: data.status });
  }

  // POST /api/kanban/tasks/:id/todos — {text}. Only the assignee. Auth: Bearer.
