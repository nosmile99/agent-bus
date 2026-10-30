// Unified-poll event emission & kanban event helpers
import type {
  IBusDO,
  TaskRecord,
  TaskDetailResponse,
  TaskSearchOpts,
  TaskLane,
  WipWarning,
  AutoClaimResult,
} from '../types.js';

export function emitEvent(
  this: IBusDO,
  type: string,
  opts?: {
    actor?: string | null;
    project_id?: number | null;
    scope?: string;
    recipients?: string[] | null;
    payload?: unknown;
  }
): void {
  try {
    const o = opts || {};
    this.sql.exec(
      `INSERT INTO events (type, actor, project_id, scope, recipients, ts, payload)
       VALUES (?, ?, ?, ?, ?, strftime('%s','now'), ?)`,
      type,
      o.actor || null,
      o.project_id === undefined || o.project_id === null ? null : o.project_id,
      o.scope || "all",
      o.recipients ? JSON.stringify(o.recipients) : null,
      JSON.stringify(o.payload || {})
    );
  } catch (_e) {
    /* swallow: primary write already succeeded */
  }
}

// Canonical subscriber predicate (byte-identical to kanban rev 4). ? = agent name.
// projExpr = SQL expression for the project id in the outer query scope.
export function kbSubscriberPred(projExpr = "project_id"): string {
  return `${projExpr} IN (
    SELECT id FROM projects
    WHERE NOT EXISTS (SELECT 1 FROM project_subscribers ps WHERE ps.project_id = projects.id)
       OR EXISTS (SELECT 1 FROM project_subscribers ps WHERE ps.project_id = projects.id AND ps.agent = ?)
  )`;
}

// True if the task's project is archived (agent writes 403, except comments).
export function kbIsArchived(this: IBusDO, taskId: number): boolean {
  try {
    const rows = this.sql.exec(
      `SELECT p.archived FROM projects p JOIN tasks t ON t.project_id = p.id WHERE t.id = ?`,
      taskId
    ).toArray() as Array<{ archived: number }>;
    const r = rows[0];
    return !!(r && r.archived);
  } catch {
    return false;
  }
}

// Touch a task's activity timestamps (called on every task mutation).
export function kbTouchTask(this: IBusDO, id: number): void {
  try {
    const now = this.kbNow();
    this.sql.exec(`UPDATE tasks SET updated_at = ?, last_activity_at = ? WHERE id = ?`, now, now, id);
  } catch {}
}

// Silent system activity log (author='system'). Emits NO poll event by design.
export function kbSystemLog(this: IBusDO, taskId: number, body: string): void {
  try {
    this.sql.exec(
      `INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, 'system', ?, ?)`,
      taskId,
      body,
      this.kbNow()
    );
  } catch {}
}

// Project subscribers (join table, NOT JSON).
export function kbProjectSubscribers(this: IBusDO, projectId: number): string[] {
  try {
    return (
      this.sql
        .exec(`SELECT agent FROM project_subscribers WHERE project_id = ? ORDER BY agent`, projectId)
        .toArray() as Array<{ agent: string }>
    ).map((r) => r.agent);
  } catch {
    return [];
  }
}

// Replace the subscriber set. Empty/absent array = open to all (no rows).
export function kbSetSubscribers(this: IBusDO, projectId: number, subscribers: unknown, addedBy?: string): string[] {
  this.sql.exec(`DELETE FROM project_subscribers WHERE project_id = ?`, projectId);
  if (!Array.isArray(subscribers) || subscribers.length === 0) return [];
  const now = this.kbNow();
  const clean = [
    ...new Set(
      subscribers
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
    ),
  ];
  for (const a of clean) {
    this.sql.exec(
      `INSERT OR IGNORE INTO project_subscribers (project_id, agent, added_by, added_at) VALUES (?, ?, ?, ?)`,
      projectId,
      a,
      addedBy || "admin",
      now
    );
  }
  return clean;
}

// Task detail payload (kanban rev 4/5): labels, comment/activity counts, todos.
export function kbTaskDetail(this: IBusDO, row: TaskRecord): TaskDetailResponse {
  let labels: string[] = [];
  let comment_count = 0;
  let activity_count = 0;
  try {
    labels = (
      this.sql.exec(`SELECT label FROM task_labels WHERE task_id = ? ORDER BY label`, row.id).toArray() as Array<{
        label: string;
      }>
    ).map((r) => r.label);
    const commentCountRow = this.sql
      .exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author != 'system'`, row.id)
      .one() as { c: number };
    comment_count = commentCountRow.c;
    const actCountRow = this.sql
      .exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ?`, row.id)
      .one() as { c: number };
    activity_count = actCountRow.c;
  } catch {}
  return { ...this.kbTaskWithTodos(row), labels, comment_count, activity_count };
}

// Locked default sort (§2E.3): due_date ASC NULLS LAST, priority DESC (urgent > normal > low), created_at ASC, id ASC.
export function kbDefaultOrder(tableAlias = "tasks"): string {
  const t = tableAlias;
  return `CASE WHEN ${t}.due_date IS NULL THEN 1 ELSE 0 END ASC, ${t}.due_date ASC, CASE ${t}.priority WHEN 'urgent' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, ${t}.created_at ASC, ${t}.id ASC`;
}

// Start of current day (00:00:00) in Asia/Jakarta (UTC+07:00, fixed offset +25200s) as UTC epoch seconds (§2C.1).
export function kbStartOfTodayJakarta(this: IBusDO, nowSec?: number): number {
  const now = nowSec !== undefined ? nowSec : this.kbNow();
  const JAKARTA_OFFSET = 7 * 3600;
  return Math.floor((now + JAKARTA_OFFSET) / 86400) * 86400 - JAKARTA_OFFSET;
}

// Look up the mapped lane for an agent from lane_mapping (§Lane split / §2G). Defaults to 'unassigned'.
export function kbAgentLane(this: IBusDO, agent: string): TaskLane {
  try {
    const rows = this.sql
      .exec(`SELECT lane FROM lane_mapping WHERE agent = ?`, agent)
      .toArray() as Array<{ lane: TaskLane }>;
    const lane = rows[0]?.lane;
    if (lane === "backend" || lane === "android" || lane === "unassigned") return lane;
  } catch {}
  return "unassigned";
}

// Look up the agent mapped as owner of a given lane ('backend' or 'android'). Returns null for 'unassigned' or if unmapped.
export function kbLaneOwner(this: IBusDO, lane: TaskLane): string | null {
  if (lane === "unassigned") return null;
  try {
    const rows = this.sql
      .exec(`SELECT agent FROM lane_mapping WHERE lane = ? ORDER BY agent ASC LIMIT 1`, lane)
      .toArray() as Array<{ agent: string }>;
    return rows[0]?.agent ?? null;
  } catch {
    return null;
  }
}

// Per-assignee doing WIP warning (§2F.4). Returns undefined if no limit configured or doing_count < limit.
export function kbWipWarning(this: IBusDO, assignee: string | null): WipWarning | undefined {
  if (!assignee) return undefined;
  try {
    const cfgRows = this.sql
      .exec(`SELECT per_assignee_doing_limit FROM kanban_wip_config WHERE id = 1`)
      .toArray() as Array<{ per_assignee_doing_limit: number | null }>;
    const limit = cfgRows[0]?.per_assignee_doing_limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) return undefined;
    const countRow = this.sql
      .exec(
        `SELECT COUNT(*) AS c FROM tasks t
         WHERE t.assignee = ? AND t.status = 'doing'
           AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)`,
        assignee
      )
      .one() as { c: number };
    const doingCount = countRow?.c ?? 0;
    if (doingCount >= limit) {
      return { assignee, doing_count: doingCount, limit };
    }
  } catch {}
  return undefined;
}

// Shared auto-claim / ownership verification step (§2A.1–2).
// Must be invoked inside bus.state.storage.transactionSync(...) when mutating.
export function kbAutoClaimOrVerify(
  this: IBusDO,
  taskId: number,
  agent: string,
  opts?: { isStatusEndpoint?: boolean; requestedStatus?: string; requestedLane?: string }
): AutoClaimResult {
  const rows = this.sql
    .exec(
      `SELECT t.*, p.archived AS project_archived
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?`,
      taskId
    )
    .toArray() as unknown as Array<TaskRecord & { project_archived: number }>;
  const row = rows[0];
  if (!row) {
    return { ok: false, code: 404, body: { error: "task not found" } };
  }

  // Already owned by calling agent: verify project is not archived.
  if (row.assignee === agent) {
    if (row.project_archived) {
      return { ok: false, code: 403, body: { error: "project archived" } };
    }
    return { ok: true, autoClaimed: false, task: row };
  }

  // Check subscriber predicate and archived gate BEFORE any task-state-dependent 400/409
  // so restricted projects never leak task state (§2A.2 & Amendment A3).
  const subCheck = this.sql
    .exec(
      `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
      row.project_id,
      agent
    )
    .toArray();
  if (subCheck.length === 0) {
    return { ok: false, code: 403, body: { error: "auto_claim_failed", reason: "project_not_readable" } };
  }
  if (row.project_archived) {
    return { ok: false, code: 403, body: { error: "auto_claim_failed", reason: "project_archived" } };
  }

  // Special rule for PUT .../status: cannot auto-claim an unassigned task into 'todo' (§2A.2).
  if (row.assignee === null && opts?.isStatusEndpoint && opts.requestedStatus === "todo") {
    return { ok: false, code: 400, body: { error: "cannot_auto_claim_to_todo" } };
  }

  const agentLane = this.kbAgentLane(agent);
  const tryingOtherLane =
    row.assignee === null &&
    opts?.requestedLane !== undefined &&
    opts.requestedLane !== agentLane;

  if (row.assignee === null && !tryingOtherLane) {
    const now = this.kbNow();
    const res = this.sql.exec(
      `UPDATE tasks
       SET assignee = ?, status = 'doing', claimed_at = ?, status_changed_at = ?, updated_at = ?, last_activity_at = ?,
           lane = CASE WHEN lane = 'unassigned' THEN ? ELSE lane END
       WHERE id = ?
         AND assignee IS NULL
         AND (admin_assigned IS NULL OR admin_assigned = ?)
         AND status = 'todo'
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND p.archived = 1)
         AND ${this.kbSubscriberPred("tasks.project_id")}
         AND (lane = 'unassigned' OR lane = ?)`,
      agent,
      now,
      now,
      now,
      now,
      agentLane,
      taskId,
      agent,
      agent,
      agentLane
    ) as { rowsWritten?: number };

    if ((res.rowsWritten ?? 0) === 1) {
      const updated = (
        this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, taskId).toArray() as unknown as TaskRecord[]
      )[0]!;
      this.kbSystemLog(taskId, `${agent} auto-claimed the task`);
      this.emitEvent("kanban.task.claimed", {
        actor: agent,
        project_id: updated.project_id,
        payload: {
          id: taskId,
          task_id: taskId,
          claimant: agent,
          assignee: agent,
          auto: true,
          lane: updated.lane,
        },
      });
      return { ok: true, autoClaimed: true, task: updated };
    }
  }

  // Auto-claim did not match (or task already owned by another agent).
  // Subscriber predicate and archived gate were already verified above.
  let reason: "already_claimed" | "admin_locked" | "invalid_status" | "wrong_lane";
  if (row.assignee !== null && row.assignee !== agent) {
    reason = "already_claimed";
  } else if (row.admin_assigned !== null && row.admin_assigned !== agent) {
    reason = "admin_locked";
  } else if (row.status !== "todo") {
    reason = "invalid_status";
  } else {
    reason = "wrong_lane";
  }

  return {
    ok: false,
    code: 409,
    body: {
      error: "auto_claim_failed",
      reason,
      current: {
        assignee: row.assignee,
        admin_assigned: row.admin_assigned,
        status: row.status,
        lane: row.lane,
      },
    },
  };
}

// Shared task search builder (§2E.2–3).
// Returns {where, params, order} for "... FROM tasks WHERE <where> ORDER BY <order>".
export function kbTaskSearchWhere(
  this: IBusDO,
  opts: TaskSearchOpts
): { where: string; params: (string | number)[]; order: string } {
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (opts.projectIds && opts.projectIds.length) {
    conds.push(`tasks.project_id IN (${opts.projectIds.map(() => "?").join(",")})`);
    params.push(...opts.projectIds);
  }
  if (!opts.includeArchived) {
    conds.push(`NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND p.archived = 1)`);
  }
  if (opts.q) {
    // Phase 1 fix 1: search title, description, AND notes.
    conds.push(`(tasks.title LIKE ? OR tasks.description LIKE ? OR tasks.notes LIKE ?)`);
    params.push(`%${opts.q}%`, `%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.status) {
    conds.push(`tasks.status = ?`);
    params.push(opts.status);
  }
  if (opts.assignee) {
    if (opts.assignee === "unassigned") {
      conds.push(`tasks.assignee IS NULL`);
    } else {
      conds.push(`tasks.assignee = ?`);
      params.push(opts.assignee);
    }
  }
  if (opts.blocked_kind) {
    conds.push(`tasks.blocked_kind = ?`);
    params.push(opts.blocked_kind);
  }
  if (opts.priority) {
    conds.push(`tasks.priority = ?`);
    params.push(opts.priority);
  }
  if (opts.lane) {
    conds.push(`tasks.lane = ?`);
    params.push(opts.lane);
  }
  if (opts.stale) {
    conds.push(`tasks.status = 'doing' AND tasks.last_activity_at < ?`);
    params.push(this.kbNow() - 86400);
  }
  if (opts.dueDateFrom !== undefined && opts.dueDateFrom !== null) {
    conds.push(`tasks.due_date IS NOT NULL AND tasks.due_date >= ?`);
    params.push(opts.dueDateFrom);
  }
  if (opts.dueDateTo !== undefined && opts.dueDateTo !== null) {
    conds.push(`tasks.due_date IS NOT NULL AND tasks.due_date <= ?`);
    params.push(opts.dueDateTo);
  }
  if (opts.dueDateFilter === "overdue") {
    conds.push(`tasks.due_date IS NOT NULL AND tasks.due_date < ? AND tasks.status != 'done'`);
    params.push(this.kbStartOfTodayJakarta());
  } else if (opts.dueDateFilter === "none") {
    conds.push(`tasks.due_date IS NULL`);
  }
  if (opts.label) {
    conds.push(`EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = tasks.id AND tl.label = ?)`);
    params.push(opts.label.toLowerCase());
  }
  if (opts.subscriberAgent) {
    conds.push(this.kbSubscriberPred("tasks.project_id"));
    params.push(opts.subscriberAgent);
  }
  let order = this.kbDefaultOrder("tasks");
  if (opts.sort === "blocked_since") {
    order = `tasks.status_changed_at ASC, tasks.id ASC`;
  }
  return { where: conds.length ? conds.join(" AND ") : "1=1", params, order };
}
