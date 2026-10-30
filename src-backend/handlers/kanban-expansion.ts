// Kanban expansion: task detail, agent create/update, search, labels, comments, subscribers, activity, summary, templates, wip, lane-mapping
import type {
  IBusDO,
  TaskRecord,
  TaskCommentRecord,
  TaskLane,
  TaskPriority,
  TaskTemplateRecord,
  LaneMappingRecord,
} from '../types.js';
import {
  TxAbort,
  VALID_LANES,
  VALID_PRIORITIES,
  VALID_STATUSES,
  VALID_BLOCKED_KINDS,
  LABEL_REGEX,
  kbValidateLabelsArray,
  kbResolveTaskCreateInput,
} from './kanban.js';

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
    .toArray() as unknown as TaskRecord[];
  const row = rows[0];
  if (!row) return this.json(404, { error: "task not found" });
  return this.json(200, { task: this.kbTaskDetail(row) });
}

// GET /admin/api/kanban/tasks/:id — task detail (admin).
export async function handleKbAdminTaskDetail(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const rows = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray() as unknown as TaskRecord[];
  const row = rows[0];
  if (!row) return this.json(404, { error: "task not found" });
  return this.json(200, { task: this.kbTaskDetail(row) });
}

// POST /api/kanban/projects/:id/tasks — agent creates/proposes a task (§2A.6, §2A.7, §2E.5, §2H).
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
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return this.json(400, { error: "invalid json" });
  }
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

  // Order, locked (§2A.7): template expansion FIRST, then dedup.
  const defaultLane = this.kbAgentLane(agent);
  const resolved = kbResolveTaskCreateInput(this, payload, defaultLane);
  if (!resolved.ok) {
    return this.json(resolved.code, { error: resolved.error });
  }
  const { title, description, notes, priority, lane, due_date, labels } = resolved;

  // Deduplication guard (§2A.7): check open tasks (status IN ('todo', 'doing', 'blocked')) in same project_id & lane.
  const dupRows = this.sql
    .exec(
      `SELECT id FROM tasks
       WHERE project_id = ? AND lane = ? AND status IN ('todo', 'doing', 'blocked')
         AND LOWER(TRIM(title)) = LOWER(TRIM(?))
       ORDER BY id ASC LIMIT 1`,
      projectId,
      lane,
      title
    )
    .toArray() as Array<{ id: number }>;
  if (dupRows[0]) {
    return this.json(200, { ok: true, id: dupRows[0].id, deduplicated: true });
  }

  // Auto-assign by lane on creation (§2A.6 / Amendment A1).
  const laneOwner = this.kbLaneOwner(lane);
  const isOwnLane = lane !== "unassigned" && laneOwner === agent;

  let status: "todo" | "doing" = "todo";
  if (payload.status !== undefined && payload.status !== null) {
    if (isOwnLane) {
      if (payload.status !== "todo" && payload.status !== "doing") {
        return this.json(400, { error: "invalid status (must be todo or doing)" });
      }
      status = payload.status;
    } else {
      if (payload.status !== "todo") {
        return this.json(400, { error: "cross-lane or unassigned task must be created as todo" });
      }
      status = "todo";
    }
  }

  const now = this.kbNow();
  const assignee = isOwnLane ? agent : null;
  const claimedAt = isOwnLane ? now : null;

  let nid = 0;
  this.state.storage.transactionSync(() => {
    this.sql.exec(
      `INSERT INTO tasks (project_id, title, description, notes, status, priority, assignee, created_by, claimed_at, created_at, updated_at, status_changed_at, last_activity_at, due_date, lane)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      title,
      description,
      notes,
      status,
      priority,
      assignee,
      agent,
      claimedAt,
      now,
      now,
      now,
      now,
      due_date,
      lane
    );
    nid = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
    this.kbSystemLog(
      nid,
      assignee ? `${agent} created task in ${lane} lane (${status})` : `${agent} proposed this task (${lane})`
    );
    this.emitEvent("kanban.task.created", {
      actor: agent,
      project_id: projectId,
      recipients: !assignee && laneOwner ? [laneOwner] : null,
      payload: {
        id: nid,
        task_id: nid,
        project_id: projectId,
        title,
        lane,
        assignee,
        created_by: agent,
      },
    });
    for (const lbl of labels) {
      this.kbLabelOp(nid, lbl, "add", agent);
    }
  });

  const wip = status === "doing" && assignee ? this.kbWipWarning(assignee) : undefined;
  return this.json(200, { ok: true, id: nid, ...(wip ? { wip_warning: wip } : {}) });
}

// PUT /api/kanban/tasks/:id (and convenience routes PUT .../notes, PUT .../due_date, PUT .../lane)
// Supports transactional auto-claim (§2A.2) and atomic cross-lane handoff (§2A.6).
export async function handleKbAgentTaskUpdate(
  this: IBusDO,
  req: Request,
  id: number,
  onlyField?: "notes" | "due_date" | "lane"
): Promise<Response> {
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
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return this.json(400, { error: "invalid json" });
  }

  // Validate fields according to endpoint mode.
  let hasTitle = false;
  let newTitle = "";
  let hasDesc = false;
  let newDesc: string | null = null;
  let hasNotes = false;
  let newNotes: string | null = null;
  let hasDueDate = false;
  let newDueDate: number | null = null;
  let hasLane = false;
  let newLane: TaskLane = "unassigned";

  if (onlyField === "notes") {
    if (!("notes" in payload) || (payload.notes !== null && typeof payload.notes !== "string")) {
      return this.json(400, { error: "notes must be string or null" });
    }
    hasNotes = true;
    newNotes = payload.notes as string | null;
  } else if (onlyField === "due_date") {
    if (
      !("due_date" in payload) ||
      (payload.due_date !== null &&
        (typeof payload.due_date !== "number" || !Number.isInteger(payload.due_date)))
    ) {
      return this.json(400, { error: "due_date must be integer or null" });
    }
    hasDueDate = true;
    newDueDate = payload.due_date as number | null;
  } else if (onlyField === "lane") {
    if (typeof payload.lane !== "string" || !VALID_LANES.includes(payload.lane as TaskLane)) {
      return this.json(400, { error: "invalid lane" });
    }
    hasLane = true;
    newLane = payload.lane as TaskLane;
  } else {
    if ("title" in payload) {
      if (typeof payload.title !== "string" || !payload.title.trim()) {
        return this.json(400, { error: "invalid title" });
      }
      hasTitle = true;
      newTitle = payload.title.trim();
    }
    if ("description" in payload) {
      if (payload.description !== null && typeof payload.description !== "string") {
        return this.json(400, { error: "invalid description" });
      }
      hasDesc = true;
      newDesc = payload.description as string | null;
    }
    if ("notes" in payload) {
      if (payload.notes !== null && typeof payload.notes !== "string") {
        return this.json(400, { error: "invalid notes" });
      }
      hasNotes = true;
      newNotes = payload.notes as string | null;
    }
    if ("due_date" in payload) {
      if (
        payload.due_date !== null &&
        (typeof payload.due_date !== "number" || !Number.isInteger(payload.due_date))
      ) {
        return this.json(400, { error: "invalid due_date" });
      }
      hasDueDate = true;
      newDueDate = payload.due_date as number | null;
    }
    if ("lane" in payload) {
      if (typeof payload.lane !== "string" || !VALID_LANES.includes(payload.lane as TaskLane)) {
        return this.json(400, { error: "invalid lane" });
      }
      hasLane = true;
      newLane = payload.lane as TaskLane;
    }
  }

  let autoClaimed = false;
  let handedOff = false;
  try {
    this.state.storage.transactionSync(() => {
      const claimRes = this.kbAutoClaimOrVerify(id, agent, {
        requestedLane: hasLane ? newLane : undefined,
      });
      if (!claimRes.ok) {
        throw new TxAbort(claimRes.code, claimRes.body);
      }
      autoClaimed = claimRes.autoClaimed;
      const task = claimRes.task;

      if (!hasTitle && !hasDesc && !hasNotes && !hasDueDate && !hasLane) {
        throw new TxAbort(400, { error: "nothing to update" });
      }

      const now = this.kbNow();
      const targetLaneOwner = hasLane ? this.kbLaneOwner(newLane) : null;

      // Cross-lane handoff (§2A.6): caller was already the assignee (!autoClaimed) and changes lane
      // (or explicitly calls PUT .../lane) to another agent's mapped lane or to 'unassigned' (where targetLaneOwner !== agent).
      const laneEffectivelyChanged = hasLane && (newLane !== task.lane || onlyField === "lane");
      if (!autoClaimed && laneEffectivelyChanged && targetLaneOwner !== agent) {
        if (task.status === "blocked") {
          throw new TxAbort(400, { error: "cannot_handoff_blocked_task" });
        }
        if (task.status !== "todo" && task.status !== "doing") {
          throw new TxAbort(400, { error: "cannot_handoff_task" });
        }
        handedOff = true;
        const updates: string[] = [];
        const vals: (string | number | null)[] = [];
        const extraChanges: string[] = [];

        if (hasTitle) {
          updates.push("title = ?");
          vals.push(newTitle);
          extraChanges.push("title");
        }
        if (hasDesc) {
          updates.push("description = ?");
          vals.push(newDesc);
          extraChanges.push("description");
        }
        if (hasNotes) {
          updates.push("notes = ?");
          vals.push(newNotes);
          extraChanges.push("notes");
        }
        if (hasDueDate) {
          updates.push("due_date = ?");
          vals.push(newDueDate);
          extraChanges.push("due_date");
        }

        const prevStatus = task.status;
        updates.push(
          "lane = ?",
          "status = 'todo'",
          "status_changed_at = ?",
          "assignee = ?",
          "admin_assigned = NULL",
          "claimed_at = ?",
          "updated_at = ?",
          "last_activity_at = ?"
        );
        vals.push(
          newLane,
          now,
          targetLaneOwner,
          targetLaneOwner ? now : null,
          now,
          now,
          id
        );

        this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
        this.kbSystemLog(
          id,
          `${agent} handed off task to ${newLane} lane (${targetLaneOwner || "unassigned"})`
        );

        for (const change of extraChanges) {
          this.emitEvent("kanban.task.updated", {
            actor: agent,
            project_id: task.project_id,
            payload: {
              id,
              task_id: id,
              lane: newLane,
              assignee: targetLaneOwner,
              change,
            },
          });
        }

        this.emitEvent("kanban.task.updated", {
          actor: agent,
          project_id: task.project_id,
          recipients: targetLaneOwner ? [targetLaneOwner] : null,
          payload: {
            id,
            task_id: id,
            lane: newLane,
            assignee: targetLaneOwner,
            change: "lane",
          },
        });

        // Per Amendment A2 & §2A.6: if handoff actually changes status ('doing' -> 'todo'), also emit change='status'.
        if (prevStatus !== "todo") {
          this.emitEvent("kanban.task.updated", {
            actor: agent,
            project_id: task.project_id,
            payload: {
              id,
              task_id: id,
              lane: newLane,
              assignee: targetLaneOwner,
              change: "status",
              status: "todo",
            },
          });
        }

        if (targetLaneOwner) {
          this.emitEvent("kanban.task.assigned", {
            actor: agent,
            project_id: task.project_id,
            recipients: [targetLaneOwner],
            payload: {
              id,
              task_id: id,
              project_id: task.project_id,
              lane: newLane,
              assignee: targetLaneOwner,
              assigned_by: agent,
            },
          });
        }
        return;
      }

      // Standard own-task update (including when autoClaimed is true).
      const updates: string[] = [];
      const vals: (string | number | null)[] = [];
      const changes: string[] = [];

      if (hasTitle) {
        updates.push("title = ?");
        vals.push(newTitle);
        changes.push("title");
      }
      if (hasDesc) {
        updates.push("description = ?");
        vals.push(newDesc);
        changes.push("description");
      }
      if (hasNotes) {
        updates.push("notes = ?");
        vals.push(newNotes);
        changes.push("notes");
      }
      if (hasDueDate) {
        updates.push("due_date = ?");
        vals.push(newDueDate);
        changes.push("due_date");
      }
      if (hasLane && (autoClaimed || newLane !== task.lane || onlyField === "lane")) {
        updates.push("lane = ?");
        vals.push(newLane);
        changes.push("lane");
      }

      const effectiveLane = hasLane ? newLane : task.lane;
      updates.push("updated_at = ?", "last_activity_at = ?");
      vals.push(now, now, id);
      this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);

      for (const change of changes) {
        this.emitEvent("kanban.task.updated", {
          actor: agent,
          project_id: task.project_id,
          payload: {
            id,
            task_id: id,
            lane: effectiveLane,
            assignee: agent,
            change,
          },
        });
      }
      if (changes.length > 0) {
        this.kbSystemLog(id, `${agent} edited ${changes.join(", ")}`);
      }
    });
  } catch (err) {
    if (err instanceof TxAbort) {
      return this.json(err.code, err.body);
    }
    throw err;
  }

  const wip = autoClaimed && !handedOff ? this.kbWipWarning(agent) : undefined;
  return this.json(200, { ok: true, id, ...(wip ? { wip_warning: wip } : {}) });
}

// GET /api/kanban/tasks/available — unclaimed todo tasks in non-archived subscribed projects matching caller's lane (§2H).
export async function handleKbAgentTasksAvailable(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const agentLane = this.kbAgentLane(agent);
  const tasks = this.sql
    .exec(
      `SELECT t.id, t.project_id, t.title, t.priority, t.lane, t.due_date, t.created_at, t.updated_at
       FROM tasks t
       WHERE t.assignee IS NULL
         AND (t.admin_assigned IS NULL OR t.admin_assigned = ?)
         AND t.status = 'todo'
         AND (t.lane = 'unassigned' OR t.lane = ?)
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)
         AND ${this.kbSubscriberPred("t.project_id")}
       ORDER BY ${this.kbDefaultOrder("t")}`,
      agent,
      agentLane,
      agent
    )
    .toArray();
  return this.json(200, { tasks });
}

// Shared task search (§2E.2–3, §2H).
// Admin: ?global=1 for cross-project ("Needs You"). Agents: per-project only (?global=1 -> 400).
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
  const priority = url.searchParams.get("priority") || "";
  const lane = url.searchParams.get("lane") || "";
  const staleRaw = url.searchParams.get("stale") || "";
  const dueDateFromRaw = url.searchParams.get("due_date_from") || "";
  const dueDateToRaw = url.searchParams.get("due_date_to") || "";
  const dueDateFilterRaw = url.searchParams.get("due_date") || "";
  const sort = url.searchParams.get("sort") || "";
  const global = url.searchParams.get("global") === "1";
  const includeArchived = url.searchParams.get("include_archived") === "1";

  if (global && !isAdmin) return this.json(400, { error: "global search is admin-only" });
  if (status && !VALID_STATUSES.includes(status as any)) {
    return this.json(400, { error: "invalid status" });
  }
  if (blockedKind && !VALID_BLOCKED_KINDS.includes(blockedKind as any)) {
    return this.json(400, { error: "invalid blocked_kind" });
  }
  if (priority && !VALID_PRIORITIES.includes(priority as TaskPriority)) {
    return this.json(400, { error: "invalid priority" });
  }
  if (lane && !VALID_LANES.includes(lane as TaskLane)) {
    return this.json(400, { error: "invalid lane" });
  }
  if (staleRaw && staleRaw !== "1" && staleRaw !== "0") {
    return this.json(400, { error: "invalid stale" });
  }
  let dueDateFrom: number | null = null;
  if (dueDateFromRaw) {
    if (!/^-?\d+$/.test(dueDateFromRaw.trim())) {
      return this.json(400, { error: "invalid due_date_from" });
    }
    dueDateFrom = parseInt(dueDateFromRaw.trim(), 10);
  }
  let dueDateTo: number | null = null;
  if (dueDateToRaw) {
    if (!/^-?\d+$/.test(dueDateToRaw.trim())) {
      return this.json(400, { error: "invalid due_date_to" });
    }
    dueDateTo = parseInt(dueDateToRaw.trim(), 10);
  }
  let dueDateFilter: "overdue" | "none" | null = null;
  if (dueDateFilterRaw) {
    if (dueDateFilterRaw !== "overdue" && dueDateFilterRaw !== "none") {
      return this.json(400, { error: "invalid due_date filter" });
    }
    dueDateFilter = dueDateFilterRaw;
  }
  if (sort && sort !== "default" && sort !== "blocked_since") {
    return this.json(400, { error: "invalid sort" });
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
    priority: (priority as TaskPriority) || null,
    lane: (lane as TaskLane) || null,
    stale: staleRaw === "1",
    dueDateFrom,
    dueDateTo,
    dueDateFilter,
    sort: sort || null,
    includeArchived: isAdmin && includeArchived,
    subscriberAgent: isAdmin ? null : agent,
  });
  const tasks = (
    this.sql
      .exec(`SELECT tasks.* FROM tasks WHERE ${where} ORDER BY ${order} LIMIT 200`, ...params)
      .toArray() as unknown as TaskRecord[]
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

// Shared label add/remove. Enforces Phase 0 SEC-01 regex and writes kbSystemLog (Amendment A4).
export function kbLabelOp(
  this: IBusDO,
  taskId: number,
  label: unknown,
  op: "add" | "remove",
  actor: string
): { ok?: true; error?: string; code: number } {
  const clean = typeof label === "string" ? label.trim().toLowerCase() : "";
  if (!LABEL_REGEX.test(clean)) return { error: "invalid label", code: 400 };
  const rows = this.sql
    .exec(`SELECT project_id, lane, assignee FROM tasks WHERE id = ?`, taskId)
    .toArray() as Array<{ project_id: number; lane: TaskLane; assignee: string | null }>;
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
      this.kbSystemLog(taskId, `${actor} added label ${clean}`);
      this.emitEvent("kanban.label.added", {
        actor,
        project_id: task.project_id,
        payload: {
          id: taskId,
          task_id: taskId,
          label: clean,
          lane: task.lane,
          assignee: task.assignee,
        },
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
      this.kbSystemLog(taskId, `${actor} removed label ${clean}`);
      this.emitEvent("kanban.label.removed", {
        actor,
        project_id: task.project_id,
        payload: {
          id: taskId,
          task_id: taskId,
          label: clean,
          lane: task.lane,
          assignee: task.assignee,
        },
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
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  let autoClaimed = false;
  try {
    this.state.storage.transactionSync(() => {
      const claimRes = this.kbAutoClaimOrVerify(taskId, agent);
      if (!claimRes.ok) {
        throw new TxAbort(claimRes.code, claimRes.body);
      }
      autoClaimed = claimRes.autoClaimed;
      const r = this.kbLabelOp(taskId, payload?.label, "add", agent);
      if (r.error) {
        throw new TxAbort(r.code, { error: r.error });
      }
    });
  } catch (err) {
    if (err instanceof TxAbort) {
      return this.json(err.code, err.body);
    }
    throw err;
  }
  const wip = autoClaimed ? this.kbWipWarning(agent) : undefined;
  return this.json(200, { ok: true, ...(wip ? { wip_warning: wip } : {}) });
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
  try {
    await req.text();
  } catch {}
  let autoClaimed = false;
  try {
    this.state.storage.transactionSync(() => {
      const claimRes = this.kbAutoClaimOrVerify(taskId, agent);
      if (!claimRes.ok) {
        throw new TxAbort(claimRes.code, claimRes.body);
      }
      autoClaimed = claimRes.autoClaimed;
      const r = this.kbLabelOp(taskId, label, "remove", agent);
      if (r.error) {
        throw new TxAbort(r.code, { error: r.error });
      }
    });
  } catch (err) {
    if (err instanceof TxAbort) {
      return this.json(err.code, err.body);
    }
    throw err;
  }
  const wip = autoClaimed ? this.kbWipWarning(agent) : undefined;
  return this.json(200, { ok: true, ...(wip ? { wip_warning: wip } : {}) });
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

// Comments: GET lists all (manual + system; client separates). POST appends (EXEMPT from auto-claim per §2A.4).
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
    .toArray() as unknown as TaskCommentRecord[];
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
    .exec(`SELECT project_id, assignee, lane FROM tasks WHERE id = ?`, taskId)
    .toArray() as Array<{ project_id: number; assignee: string | null; lane: TaskLane }>;
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
  // Manual comments emit; system auto-log is silent (kanban rev 4/5).
  this.emitEvent("kanban.comment.added", {
    actor,
    project_id: task.project_id,
    payload: {
      id: nid,
      task_id: taskId,
      author: actor,
      lane: task.lane,
      assignee: task.assignee,
    },
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

// GET /admin/api/kanban/activity & GET /api/kanban/projects/:id/activity — DB-backed activity feed (§2B.1).
export async function handleKbActivity(
  this: IBusDO,
  _req: Request,
  url: URL,
  { isAdmin, agent, projectId }: { isAdmin: boolean; agent: string | null; projectId: number | null }
): Promise<Response> {
  const conds: string[] = [];
  const params: (string | number)[] = [];

  if (!isAdmin) {
    if (!projectId) return this.json(400, { error: "project required" });
    const projRows = this.sql
      .exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        projectId,
        agent
      )
      .toArray();
    if (!projRows.length) return this.json(404, { error: "project not found" });
    conds.push(`t.project_id = ?`);
    params.push(projectId);
  } else {
    const projParam = url.searchParams.get("project_id") || "";
    if (projectId !== null) {
      conds.push(`t.project_id = ?`);
      params.push(projectId);
    } else if (projParam) {
      if (!/^\d+$/.test(projParam.trim())) {
        return this.json(400, { error: "invalid project_id" });
      }
      conds.push(`t.project_id = ?`);
      params.push(parseInt(projParam.trim(), 10));
    }
  }

  const agentFilter = (url.searchParams.get("agent") || "").trim();
  if (agentFilter) {
    // §2B.1 locked: matches agent=X if task assignee = X OR comment author = X.
    if (agentFilter === "unassigned") {
      conds.push(`(t.assignee IS NULL OR tc.author = 'unassigned')`);
    } else {
      conds.push(`(t.assignee = ? OR tc.author = ?)`);
      params.push(agentFilter, agentFilter);
    }
  }

  const laneFilter = (url.searchParams.get("lane") || "").trim();
  if (laneFilter) {
    if (!VALID_LANES.includes(laneFilter as TaskLane)) {
      return this.json(400, { error: "invalid lane" });
    }
    conds.push(`t.lane = ?`);
    params.push(laneFilter);
  }

  const beforeRaw = (url.searchParams.get("before") || "").trim();
  if (beforeRaw) {
    if (!/^\d+$/.test(beforeRaw)) {
      return this.json(400, { error: "invalid before" });
    }
    conds.push(`tc.id < ?`);
    params.push(parseInt(beforeRaw, 10));
  }

  let limit = 50;
  const limitRaw = (url.searchParams.get("limit") || "").trim();
  if (limitRaw) {
    if (!/^\d+$/.test(limitRaw)) {
      return this.json(400, { error: "invalid limit" });
    }
    const parsed = parseInt(limitRaw, 10);
    if (parsed < 1) return this.json(400, { error: "invalid limit" });
    limit = Math.min(parsed, 200);
  }

  const where = conds.length ? conds.join(" AND ") : "1=1";
  const rows = this.sql
    .exec(
      `SELECT tc.id, tc.task_id, t.project_id, t.title AS task_title, t.status AS task_status,
              t.lane AS task_lane, t.assignee AS task_assignee, tc.author, tc.body, tc.ts
       FROM task_comments tc
       JOIN tasks t ON t.id = tc.task_id
       WHERE ${where}
       ORDER BY tc.ts DESC, tc.id DESC
       LIMIT ?`,
      ...params,
      limit
    )
    .toArray() as Array<{
    id: number;
    task_id: number;
    project_id: number;
    task_title: string;
    task_status: string;
    task_lane: TaskLane;
    task_assignee: string | null;
    author: string;
    body: string;
    ts: number;
  }>;

  const activity = rows.map((r) => ({
    id: r.id,
    task_id: r.task_id,
    project_id: r.project_id,
    task_title: r.task_title,
    task_status: r.task_status,
    task_lane: r.task_lane,
    task_assignee: r.task_assignee,
    author: r.author,
    is_system: r.author === "system",
    body: r.body,
    ts: r.ts,
  }));

  return this.json(200, { activity });
}

// GET /admin/api/kanban/summary, GET /admin/api/kanban/projects/:id/summary, GET /api/kanban/projects/:id/summary (§2C.4).
export async function handleKbSummary(
  this: IBusDO,
  _req: Request,
  url: URL,
  { isAdmin, agent, projectId }: { isAdmin: boolean; agent: string | null; projectId: number | null }
): Promise<Response> {
  const conds: string[] = [];
  const params: (string | number)[] = [];

  if (!isAdmin) {
    if (!projectId) return this.json(400, { error: "project required" });
    const projRows = this.sql
      .exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        projectId,
        agent
      )
      .toArray();
    if (!projRows.length) return this.json(404, { error: "project not found" });
    conds.push(`tasks.project_id = ?`);
    params.push(projectId);
  } else {
    let targetProjectId = projectId;
    const projParam = (url.searchParams.get("project_id") || "").trim();
    if (targetProjectId === null && projParam) {
      if (!/^\d+$/.test(projParam)) {
        return this.json(400, { error: "invalid project_id" });
      }
      targetProjectId = parseInt(projParam, 10);
    }
    if (targetProjectId !== null) {
      const exists = this.sql.exec(`SELECT 1 FROM projects WHERE id = ?`, targetProjectId).toArray();
      if (!exists.length) return this.json(404, { error: "project not found" });
      conds.push(`tasks.project_id = ?`);
      params.push(targetProjectId);
    } else {
      const includeArchived = url.searchParams.get("include_archived") === "1";
      if (!includeArchived) {
        conds.push(`NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND p.archived = 1)`);
      }
    }
  }

  const where = conds.length ? conds.join(" AND ") : "1=1";
  const rows = this.sql
    .exec(
      `SELECT status, lane, assignee, last_activity_at, due_date, blocked_kind
       FROM tasks
       WHERE ${where}`,
      ...params
    )
    .toArray() as Array<{
    status: "todo" | "doing" | "blocked" | "done";
    lane: TaskLane;
    assignee: string | null;
    last_activity_at: number;
    due_date: number | null;
    blocked_kind: string | null;
  }>;

  const by_status = { todo: 0, doing: 0, blocked: 0, done: 0 };
  const by_lane = { backend: 0, android: 0, unassigned: 0 };
  const by_assignee: Record<string, { todo: number; doing: number; blocked: number; done: number }> = {};
  let stale_count = 0;
  let overdue_count = 0;
  let needs_human_count = 0;

  const staleCutoff = this.kbNow() - 86400;
  const startOfTodayJakarta = this.kbStartOfTodayJakarta();

  for (const r of rows) {
    if (r.status in by_status) {
      by_status[r.status]++;
    }
    const laneKey: TaskLane =
      r.lane === "backend" || r.lane === "android" ? r.lane : "unassigned";
    by_lane[laneKey]++;

    const assigneeKey = r.assignee || "unassigned";
    if (!by_assignee[assigneeKey]) {
      by_assignee[assigneeKey] = { todo: 0, doing: 0, blocked: 0, done: 0 };
    }
    if (r.status in by_assignee[assigneeKey]!) {
      by_assignee[assigneeKey]![r.status]++;
    }

    if (r.status === "doing" && r.last_activity_at < staleCutoff) {
      stale_count++;
    }
    if (r.due_date !== null && r.due_date < startOfTodayJakarta && r.status !== "done") {
      overdue_count++;
    }
    if (r.status === "blocked" && r.blocked_kind === "waiting-human") {
      needs_human_count++;
    }
  }

  return this.json(200, {
    by_status,
    by_lane,
    by_assignee,
    stale_count,
    overdue_count,
    needs_human_count,
  });
}

// GET /admin/api/kanban/templates & GET /api/kanban/templates (§2E.5, §2H).
export async function handleKbTemplatesList(
  this: IBusDO,
  req: Request,
  { isAdmin }: { isAdmin: boolean }
): Promise<Response> {
  if (isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  } else {
    const agent = this.authedAgent(req);
    if (!agent) return this.json(401, { error: "unauthorized" });
  }
  const rows = this.sql
    .exec(`SELECT * FROM task_templates ORDER BY id ASC`)
    .toArray() as unknown as TaskTemplateRecord[];
  const templates = rows.map((r) => {
    let labels: string[] = [];
    try {
      const parsed = JSON.parse(r.labels);
      if (Array.isArray(parsed)) labels = parsed;
    } catch {}
    return {
      id: r.id,
      name: r.name,
      title: r.title,
      description: r.description,
      notes: r.notes,
      priority: r.priority,
      lane: r.lane,
      labels,
    };
  });
  return this.json(200, { templates });
}

// POST /admin/api/kanban/templates {name, title, description?, notes?, priority?, lane, labels?} (§2H).
export async function handleKbAdminTemplateCreate(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return this.json(400, { error: "invalid json" });
  }
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) return this.json(400, { error: "name required" });

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (!title) return this.json(400, { error: "title required" });

  if (typeof payload.lane !== "string" || !VALID_LANES.includes(payload.lane as TaskLane)) {
    return this.json(400, { error: "invalid lane" });
  }
  const lane = payload.lane as TaskLane;

  let priority: TaskPriority = "normal";
  if (payload.priority !== undefined && payload.priority !== null) {
    if (
      typeof payload.priority !== "string" ||
      !VALID_PRIORITIES.includes(payload.priority as TaskPriority)
    ) {
      return this.json(400, { error: "invalid priority" });
    }
    priority = payload.priority as TaskPriority;
  }

  let description: string | null = "";
  if (payload.description !== undefined) {
    if (payload.description !== null && typeof payload.description !== "string") {
      return this.json(400, { error: "invalid description" });
    }
    description = payload.description as string | null;
  }

  let notes: string | null = "";
  if (payload.notes !== undefined) {
    if (payload.notes !== null && typeof payload.notes !== "string") {
      return this.json(400, { error: "invalid notes" });
    }
    notes = payload.notes as string | null;
  }

  let labels: string[] = [];
  if (payload.labels !== undefined && payload.labels !== null) {
    const validated = kbValidateLabelsArray(payload.labels);
    if (!validated.ok) {
      return this.json(400, { error: validated.error });
    }
    labels = validated.labels;
  }

  const existing = this.sql
    .exec(`SELECT 1 FROM task_templates WHERE name = ?`, name)
    .toArray();
  if (existing.length > 0) {
    return this.json(409, { error: "template already exists" });
  }

  this.sql.exec(
    `INSERT INTO task_templates (name, title, description, notes, priority, lane, labels)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    name,
    title,
    description,
    notes,
    priority,
    lane,
    JSON.stringify(labels)
  );
  const nid = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
  return this.json(200, {
    ok: true,
    id: nid,
    template: {
      id: nid,
      name,
      title,
      description,
      notes,
      priority,
      lane,
      labels,
    },
  });
}

// GET /admin/api/kanban/wip (§2F.4, §2H).
export async function handleKbAdminWipGet(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const rows = this.sql
    .exec(`SELECT per_assignee_doing_limit FROM kanban_wip_config WHERE id = 1`)
    .toArray() as Array<{ per_assignee_doing_limit: number | null }>;
  return this.json(200, {
    per_assignee_doing_limit: rows[0]?.per_assignee_doing_limit ?? null,
  });
}

// PUT /admin/api/kanban/wip {per_assignee_doing_limit} (§2F.4, §2H).
export async function handleKbAdminWipPut(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object" || !("per_assignee_doing_limit" in payload)) {
    return this.json(400, { error: "per_assignee_doing_limit required" });
  }
  const lim = payload.per_assignee_doing_limit;
  if (lim !== null && (typeof lim !== "number" || !Number.isInteger(lim) || lim < 1)) {
    return this.json(400, { error: "per_assignee_doing_limit must be a positive integer or null" });
  }
  this.sql.exec(
    `INSERT INTO kanban_wip_config (id, per_assignee_doing_limit) VALUES (1, ?)
     ON CONFLICT(id) DO UPDATE SET per_assignee_doing_limit = excluded.per_assignee_doing_limit`,
    lim
  );
  return this.json(200, { ok: true, per_assignee_doing_limit: lim });
}

// GET /admin/api/kanban/lane-mapping (§2H).
export async function handleKbAdminLaneMappingGet(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const rows = this.sql
    .exec(`SELECT agent, lane, set_by, set_at FROM lane_mapping ORDER BY agent ASC`)
    .toArray() as unknown as LaneMappingRecord[];
  return this.json(200, { lane_mapping: rows });
}

// PUT /admin/api/kanban/lane-mapping {agent, lane} (§2H).
export async function handleKbAdminLaneMappingPut(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return this.json(400, { error: "invalid json" });
  }
  const agentName = typeof payload.agent === "string" ? payload.agent.trim() : "";
  if (!agentName) {
    return this.json(400, { error: "agent required" });
  }
  if (typeof payload.lane !== "string" || !VALID_LANES.includes(payload.lane as TaskLane)) {
    return this.json(400, { error: "invalid lane" });
  }
  const lane = payload.lane as TaskLane;

  // §2H: agent must exist in agents table (or be 'luki').
  if (agentName !== "luki") {
    const exists = this.sql.exec(`SELECT 1 FROM agents WHERE agent = ?`, agentName).toArray();
    if (!exists.length) {
      return this.json(400, { error: "unknown agent" });
    }
  }

  const now = this.kbNow();
  const setBy = this.kbBasicUser(req) || "admin";
  this.sql.exec(
    `INSERT INTO lane_mapping (agent, lane, set_by, set_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(agent) DO UPDATE SET lane = excluded.lane, set_by = excluded.set_by, set_at = excluded.set_at`,
    agentName,
    lane,
    setBy,
    now
  );
  return this.json(200, { ok: true, agent: agentName, lane, set_by: setBy, set_at: now });
}
