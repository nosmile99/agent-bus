// Kanban projects endpoints (admin & agent)

export function kbNow() {
    return Math.floor(Date.now() / 1000);
  }

export function kbBasicUser(req) {
    try {
      const h = req.headers.get("Authorization") || "";
      const m = /^Basic (\S+)$/.exec(h);
      if (!m) return "";
      const d = atob(m[1]);
      const i = d.indexOf(":");
      return i < 0 ? "" : d.slice(0, i);
    } catch {
      return "";
    }
  }

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
export async function handleKbAdminProjectsList(req) {
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
export async function handleKbAdminProjectCreate(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    if (!data || typeof data.title !== "string" || !data.title.trim())
      return this.json(400, { error: "title required" });
    const now = this.kbNow();
    const adminUser = this.kbBasicUser(req);
    this.sql.exec(
      "INSERT INTO projects (title, description, created_by, created_at, archived) VALUES (?, ?, ?, ?, 0)",
      data.title.trim(),
      typeof data.description === "string" ? data.description : null,
      adminUser,
      now
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    const subs = this.kbSetSubscribers(id, data.subscribers, adminUser);
    this.emitEvent("kanban.project.created", {
      actor: "admin", project_id: id,
      scope: subs.length ? undefined : "all",
      recipients: subs.length ? subs : null,
      payload: { id, title: data.title.trim(), subscribers: subs },
    });
    return this.json(200, { ok: true, id });
  }

  // PUT /admin/api/kanban/projects/:id — {title?, description?, archived?, subscribers?}.
export async function handleKbAdminProjectUpdate(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const exists = this.sql.exec("SELECT archived FROM projects WHERE id = ?", id).toArray()[0];
    if (!exists) return this.json(404, { error: "project not found" });
    const adminUser = this.kbBasicUser(req);
    const updates = [];
    const vals = [];
    const changed = [];
    if (typeof data.title === "string" && data.title.trim()) {
      updates.push("title = ?");
      vals.push(data.title.trim());
      changed.push("title");
    }
    if (data.description === null || typeof data.description === "string") {
      updates.push("description = ?");
      vals.push(data.description);
      changed.push("description");
    }
    if (data.archived === 0 || data.archived === 1 || data.archived === true || data.archived === false) {
      updates.push("archived = ?");
      vals.push(data.archived ? 1 : 0);
    }
    let subChanged = false;
    let oldSubs = [];
    let newSubs = [];
    if (data && "subscribers" in data) {
      oldSubs = this.kbProjectSubscribers(id);
      newSubs = this.kbSetSubscribers(id, data.subscribers, adminUser);
      subChanged = JSON.stringify([...oldSubs].sort()) !== JSON.stringify([...newSubs].sort());
    }
    if (updates.length === 0 && !subChanged)
      return this.json(400, { error: "nothing to update" });
    if (updates.length > 0) {
      vals.push(id);
      this.sql.exec(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    }
    if (changed.length > 0) {
      // One event per changed field; change is a singular string (M8).
      for (const change of changed) {
        this.emitEvent("kanban.project.updated", {
          actor: "admin", project_id: id, payload: { id, change },
        });
      }
    }
    if ("archived" in (data || {}) && (data.archived === 1 || data.archived === true) && !exists.archived) {
      this.emitEvent("kanban.project.archived", { actor: "admin", project_id: id, payload: { id } });
    }
    if (subChanged) {
      const union = [...new Set([...oldSubs, ...newSubs])];
      const added = newSubs.filter((s) => !oldSubs.includes(s));
      const removed = oldSubs.filter((s) => !newSubs.includes(s));
      this.emitEvent("kanban.project.subscribers_changed", {
        actor: "admin", project_id: id, recipients: union,
        payload: { id, added, removed, subscribers: newSubs },
      });
    }
    return this.json(200, { ok: true, id });
  }

  // DELETE /admin/api/kanban/projects/:id — cascade deletes tasks + todos via FK.
export async function handleKbAdminProjectDelete(req, id) {
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
      actor: "admin", project_id: id,
      recipients: recipients.length ? recipients : null,
      payload: { id },
    });
    return this.json(200, { ok: true, id });
  }

  // GET /admin/api/kanban/projects/:id/tasks — tasks with todos embedded.

export async function handleKbAgentProjectsList(req) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    const projects = this.sql
      .exec(
        `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
         FROM projects p WHERE p.archived = 0 AND ${this.kbSubscriberPred("p.id")} ORDER BY p.id DESC`,
        agent
      )
      .toArray()
      .map((p) => ({ ...p, subscribers: this.kbProjectSubscribers(p.id) }));
    return this.json(200, { projects });
  }

  // GET /api/kanban/projects/:id/tasks — tasks with todos. Auth: Bearer.
  // Subscriber predicate applies (kanban rev 4).
