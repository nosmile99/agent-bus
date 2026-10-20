// Unified-poll event emission & kanban event helpers
import type { IBusDO, TaskRecord, TaskDetailResponse, TaskSearchOpts } from '../types.js';

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

// Task detail payload (kanban rev 4): labels, comment/activity counts, todos.
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

// Shared task search builder. opts: {projectIds (array|null=all), q, status,
// assignee, label, blocked_kind, sort, includeArchived, subscriberAgent}.
// Returns {where, params, order} for "... FROM tasks WHERE <where>".
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
    conds.push(`(tasks.title LIKE ? OR tasks.description LIKE ?)`);
    params.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.status) {
    conds.push(`tasks.status = ?`);
    params.push(opts.status);
  }
  if (opts.assignee) {
    conds.push(`tasks.assignee = ?`);
    params.push(opts.assignee);
  }
  if (opts.blocked_kind) {
    conds.push(`tasks.blocked_kind = ?`);
    params.push(opts.blocked_kind);
  }
  if (opts.label) {
    conds.push(`EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = tasks.id AND tl.label = ?)`);
    params.push(opts.label.toLowerCase());
  }
  if (opts.subscriberAgent) {
    conds.push(this.kbSubscriberPred("tasks.project_id"));
    params.push(opts.subscriberAgent);
  }
  let order = `tasks.id ASC`;
  if (opts.sort === "blocked_since") order = `tasks.status_changed_at ASC`;
  return { where: conds.length ? conds.join(" AND ") : "1=1", params, order };
}
