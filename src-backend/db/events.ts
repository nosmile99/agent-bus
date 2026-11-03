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
// Revamp v12 §6: extended with dependencies (both directions) and
// ledger_refs (first 20 active task-ref rows, lane-filtered like ledger
// list reads; admin sees all). comment_count excludes soft-deleted
// comments; activity_count keeps counting all rows.
// Amendment batch item 11: kbTaskDetail now also serves ledger_refs
// paging itself (ledgerRefsAfterId) instead of only pointing at the
// ledger list, and detail dependencies/refs carry the full fields
// callers need (blocked_kind/reason + unfinished per blocker,
// provenance_type + 200-char body excerpt per ref).
export function kbTaskDetail(
  this: IBusDO,
  row: TaskRecord,
  opts?: { agent?: string | null; isAdmin?: boolean; ledgerRefsAfterId?: number | null }
): TaskDetailResponse {
  let labels: string[] = [];
  let comment_count = 0;
  let activity_count = 0;
  let dependencies: TaskDetailResponse['dependencies'] = { blockers: [], blocked_by: [] };
  let ledger_refs: TaskDetailResponse['ledger_refs'] = [];
  let ledger_ref_count = 0;
  try {
    labels = (
      this.sql.exec(`SELECT label FROM task_labels WHERE task_id = ? ORDER BY label`, row.id).toArray() as Array<{
        label: string;
      }>
    ).map((r) => r.label);
    const commentCountRow = this.sql
      .exec(
        `SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author != 'system' AND (deleted IS NULL OR deleted = 0)`,
        row.id
      )
      .one() as { c: number };
    comment_count = commentCountRow.c;
    const actCountRow = this.sql
      .exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ?`, row.id)
      .one() as { c: number };
    activity_count = actCountRow.c;
  } catch {}
  try {
    const blockerRows = this.sql
      .exec(
        `SELECT t.id, t.title, t.status, t.blocked_kind, t.blocked_reason FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_id WHERE d.blocked_id = ? ORDER BY t.id ASC`,
        row.id
      )
      .toArray() as Array<{ id: number; title: string; status: string; blocked_kind: string | null; blocked_reason: string | null }>;
    const blockedByRows = this.sql
      .exec(
        `SELECT t.id, t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_id WHERE d.blocker_id = ? ORDER BY t.id ASC`,
        row.id
      )
      .toArray() as Array<{ id: number; title: string; status: string }>;
    dependencies = {
      blockers: blockerRows.map((r) => ({ ...r, status: r.status as TaskDetailResponse['dependencies']['blockers'][number]['status'], unfinished: r.status !== 'done' })),
      blocked_by: blockedByRows.map((r) => ({ ...r, status: r.status as TaskDetailResponse['dependencies']['blocked_by'][number]['status'], unfinished: r.status !== 'done' })),
    };
  } catch {}
  // Fix round 2 (MAJOR): ledger_ref_count is the TOTAL filtered
  // active count per locked plan §6 and SPEC, NOT the returned
  // count. The COUNT is restored alongside the fetch-21 window
  // (ledger_refs capped at 20 + has_more); idx_ledger_task_ref
  // (ref_type, ref_id, status) keeps the count an index scan.
  let ledger_refs_has_more = false;
  let ledger_refs_next_after_id: number | null = null;
  try {
    const laneFilter = opts?.isAdmin
      ? `1=1`
      : opts?.agent
        ? `(target_lane IS NULL OR target_lane = ?)`
        : `target_lane IS NULL`;
    const laneParams: (string | number)[] = opts?.isAdmin || !opts?.agent ? [] : [opts.agent];
    // Amendment batch item 11: refs page by id keyset when the
    // caller passes ledgerRefsAfterId; provenance_type + a
    // 200-char body excerpt ride along (same truncation as the
    // ledger list's body_truncated).
    const afterClause = opts?.ledgerRefsAfterId ? `AND id > ?` : ``;
    const afterParams: number[] = opts?.ledgerRefsAfterId ? [opts.ledgerRefsAfterId] : [];
    const fetchedRaw = this.sql
      .exec(
        `SELECT id, kind, title, scope, target_lane, provenance_type, body FROM ledger
         WHERE status = 'active' AND ref_type = 'task' AND ref_id = ? AND ${laneFilter} ${afterClause}
         ORDER BY id ASC LIMIT 21`,
        String(row.id),
        ...laneParams,
        ...afterParams
      )
      .toArray() as Array<{ id: number; kind: string; title: string; scope: string; target_lane: string | null; provenance_type: string | null; body: string }>;
    const fetched: TaskDetailResponse['ledger_refs'] = fetchedRaw.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, scope: r.scope, target_lane: r.target_lane,
      provenance_type: r.provenance_type, body_excerpt: (r.body || '').slice(0, 200),
    }));
    ledger_refs_has_more = fetched.length > 20;
    ledger_refs = fetched.slice(0, 20);
    // Fix round 7, (f): continuation pointer for refs 21+ (see
    // types.ts): the last returned ref's id, for the ledger-list
    // workaround, which the payload now points at explicitly.
    ledger_refs_next_after_id = ledger_refs_has_more && ledger_refs.length > 0 ? ledger_refs[ledger_refs.length - 1]!.id : null;
    const countRow = this.sql
      .exec(
        `SELECT COUNT(*) AS c FROM ledger
         WHERE status = 'active' AND ref_type = 'task' AND ref_id = ? AND ${laneFilter}`,
        String(row.id),
        ...laneParams
      )
      .one() as { c: number };
    ledger_ref_count = countRow.c;
  } catch {}
  return {
    ...this.kbTaskWithTodos(row),
    labels,
    comment_count,
    activity_count,
    // Fix round 4, item 13: the two counts differ by design, and
    // the payload now says so instead of leaving callers to
    // guess why comment_count < activity_count on a task with
    // system logs or soft-deleted comments.
    count_note:
      'comment_count counts non-system, non-deleted comments only; activity_count counts every task_comments row, including system logs and soft-deleted comments',
    dependencies,
    ledger_refs,
    ledger_ref_count,
    ledger_refs_has_more,
    ledger_refs_next_after_id,
  };
}

// Locked default sort (§2E.3): due_date ASC NULLS LAST, priority DESC (urgent > normal > low), created_at ASC, id ASC.
export function kbDefaultOrder(tableAlias = "tasks"): string {
  const t = tableAlias;
  return `CASE WHEN ${t}.due_date IS NULL THEN 1 ELSE 0 END ASC, ${t}.due_date ASC, CASE ${t}.priority WHEN 'urgent' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, ${t}.created_at ASC, ${t}.id ASC`;
}

// Amendment batch items 23/25: opaque keyset cursor for the
// default sort, and the pending-sweep visibility object.
// Cursor payload: { d: due_date|null, p: priority, c: created_at,
// i: id }. The SQL tuple uses COALESCE(due_date,'9999-12-31') so
// NULL due dates sort last exactly like the default order, and a
// numeric priority rank (urgent 0 < normal 1 < low 2) ASC, which
// matches the default order's priority DESC. Row-value comparison
// Re-roast 9, bug M1: d is the STORED due_date - an INTEGER epoch,
// or null - never a string (the old string-only decode rejected the
// server's own cursors whenever the page-boundary task had a due
// date). Decode accepts number or string for robustness, and
// kbKeysetParams passes d through un-coerced so SQLite's
// INTEGER < TEXT ordering keeps due-dated rows before null-due
// rows, exactly like kbDefaultOrder's NULLS-LAST.
// (a,b,c,d) > (?,?,?,?) is supported by SQLite. Offset is kept
// only as a deprecated fallback (see callers); the cursor is the
// primary mechanism.
export interface KbSortKey { d: string | number | null; p: string; c: string | number; i: number }
export function kbEncodeCursor(key: KbSortKey): string {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(key))));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function kbDecodeCursor(raw: string): KbSortKey | null {
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    const v = JSON.parse(json) as KbSortKey;
    if ((typeof v.c !== 'string' && typeof v.c !== 'number') || typeof v.i !== 'number' || typeof v.p !== 'string') return null;
    if (v.d !== null && typeof v.d !== 'string' && typeof v.d !== 'number') return null;
    return v;
  } catch {
    return null;
  }
}
export function kbKeysetTuple(alias: string): string {
  return `(COALESCE(${alias}.due_date, '9999-12-31'), CASE ${alias}.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, ${alias}.created_at, ${alias}.id)`;
}
export function kbKeysetParams(key: KbSortKey): (string | number)[] {
  const rank = key.p === 'urgent' ? 0 : key.p === 'normal' ? 1 : key.p === 'low' ? 2 : 3;
  return [key.d ?? '9999-12-31', rank, key.c, key.i];
}

// Amendment batch item 24: delete fan-out detail shape. Id
// lists are capped (sane cap, not whole-table dumps); counts
// are exact totals, and truncated flags say whether the list
// was cut. Callers snapshot BEFORE the cascade delete.
export const DELETE_FANOUT_ID_CAP = 100;
export function kbFanoutIds(allIds: number[]): { count: number; ids: number[]; truncated: boolean } {
  return { count: allIds.length, ids: allIds.slice(0, DELETE_FANOUT_ID_CAP), truncated: allIds.length > DELETE_FANOUT_ID_CAP };
}
export function kbFanoutPairs(allPairs: Array<{ blocker_id: number; blocked_id: number }>): { count: number; pairs: Array<{ blocker_id: number; blocked_id: number }>; truncated: boolean } {
  return { count: allPairs.length, pairs: allPairs.slice(0, DELETE_FANOUT_ID_CAP), truncated: allPairs.length > DELETE_FANOUT_ID_CAP };
}

// Amendment batch item 25: pending-sweep visibility, shared by
// admin stats and the agent-visible sweep-health endpoint. The
// deadline is explicit: the hourly alarm cadence means a sweep
// converges within ceil(open_projects / 20) hours (rotation
// bound); in single-pass mode (see index.ts) it is 1 hour.
// expected_convergence_at is now + that bound; next_sweep_at is
// alarm_last_completed + 3600s when a completion stamp exists.
export function kbSweepVisibility(this: IBusDO): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  let meta: Record<string, unknown> = {};
  try {
    const rows = this.sql.exec(`SELECT value FROM bus_meta WHERE key = 'sweep_pending'`).toArray() as Array<{ value: string }>;
    if (rows[0]) meta = JSON.parse(rows[0].value) as Record<string, unknown>;
  } catch {}
  let lastCompleted: number | null = null;
  try {
    const rows = this.sql.exec(`SELECT value FROM bus_meta WHERE key = 'alarm_last_completed'`).toArray() as Array<{ value: string }>;
    if (rows[0]) lastCompleted = (JSON.parse(rows[0].value) as { at?: number }).at ?? null;
  } catch {}
  const openProjects = (this.sql.exec(`SELECT COUNT(*) AS c FROM projects WHERE archived = 0`).one() as { c: number }).c;
  const singlePass = meta['single_pass'] === true;
  const rotationHours = singlePass ? 1 : Math.max(1, Math.ceil(openProjects / 20));
  return {
    pending_sweep: meta['pending_sweep'] ?? false,
    pending_projects: meta['pending_projects'] ?? [],
    failed_projects: meta['failed_projects'] ?? [],
    unvisited_projects: meta['unvisited_projects'] ?? 0,
    window_projects: meta['window_projects'] ?? null,
    open_projects: openProjects,
    single_pass: singlePass,
    rotation_window_hours: rotationHours,
    expected_convergence_at: new Date((now + rotationHours * 3600) * 1000).toISOString(),
    next_sweep_at: lastCompleted !== null ? new Date((lastCompleted + 3600) * 1000).toISOString() : null,
    sweep_pending_at: typeof meta['at'] === 'number' ? new Date((meta['at'] as number) * 1000).toISOString() : null,
  };
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
  // Fix round 3 minor: an already-owned touch clears unblocked_at
  // ONLY on the status path (isStatusEndpoint). The plan's clearing
  // list is claim, release, and status — a todo/label/note/task-update
  // touch by the owner must not clear the stamp merely because the
  // owner wrote. (Fresh auto-claims still clear it in the claim
  // branches below, and claim/release handlers clear it themselves.)
  if (row.assignee === agent) {
    if (row.project_archived) {
      return { ok: false, code: 403, body: { error: "project archived" } };
    }
    if (opts?.isStatusEndpoint) {
      // Fix round 4, item 7: the status-path touch clears
      // unblocked_at only on a real transition (or a move out of
      // blocked, which clears by rule). A same-status status PUT
      // is not a transition, so it keeps the stamp — the old code
      // cleared it on every already-owned status write, wiping a
      // rule-4-unblocked todo task from the unblocked list on a
      // no-op.
      const requested = opts?.requestedStatus;
      const clears = requested === undefined || requested !== row.status || row.status === 'blocked';
      if (clears) {
        this.sql.exec(`UPDATE tasks SET unblocked_at = NULL WHERE id = ?`, taskId);
      }
      const refreshed = (
        this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, taskId).toArray() as unknown as TaskRecord[]
      )[0]!;
      return { ok: true, autoClaimed: false, task: refreshed };
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
  // Fix round C5: a blocked unassigned task is exempt — claiming it
  // preserves 'blocked', and the requested 'todo' is then the unblock
  // move, not a claim into todo.
  if (
    row.assignee === null &&
    row.status !== 'blocked' &&
    opts?.isStatusEndpoint &&
    opts.requestedStatus === "todo"
  ) {
    return { ok: false, code: 400, body: { error: "cannot_auto_claim_to_todo" } };
  }

  const agentLane = this.kbAgentLane(agent);
  const tryingOtherLane =
    row.assignee === null &&
    opts?.requestedLane !== undefined &&
    opts.requestedLane !== agentLane;

  // Fix round C5: auto-claim of a blocked unassigned task preserves
  // the blocked state exactly (status, kind, reason, from_status).
  // Callers then decide the next move (status endpoint moves out of
  // blocked with the unblocked event; label/update callers keep the
  // task blocked). status_changed_at is untouched: status did not move.
  if (row.assignee === null && row.status === 'blocked' && !tryingOtherLane) {
    const now = this.kbNow();
    const res = this.sql.exec(
      `UPDATE tasks
       SET assignee = ?, claimed_at = ?, updated_at = ?, last_activity_at = ?, unblocked_at = NULL,
           lane = CASE WHEN lane = 'unassigned' THEN ? ELSE lane END
       WHERE id = ?
         AND assignee IS NULL
         AND (admin_assigned IS NULL OR admin_assigned = ?)
         AND status = 'blocked'
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND p.archived = 1)
         AND ${this.kbSubscriberPred("tasks.project_id")}
         AND (lane = 'unassigned' OR lane = ?)`,
      agent,
      now,
      now,
      now,
      agentLane,
      taskId,
      agent,
      agent,
      agentLane
    ) as { rowsWritten?: number };
    if ((res.rowsWritten ?? 0) > 0) {
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
          status: 'blocked',
          blocked_kind: updated.blocked_kind,
          blocked_reason: updated.blocked_reason,
          blocked_from_status: updated.blocked_from_status,
        },
      });
      return { ok: true, autoClaimed: true, task: updated };
    }
  }

  if (row.assignee === null && !tryingOtherLane) {
    const now = this.kbNow();
    const res = this.sql.exec(
      `UPDATE tasks
       SET assignee = ?, status = 'doing', claimed_at = ?, status_changed_at = ?, updated_at = ?, last_activity_at = ?, unblocked_at = NULL,
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

    // NOTE: rowsWritten counts index writes too (a 1-row tasks UPDATE
    // reports 3 in workerd: the row plus its stale/blocked indexes), so
    // the match test is > 0, not === 1. The === 1 form made every
    // unassigned-task auto-claim fail with 409 wrong_lane even though
    // the UPDATE had matched. Same fix in handleKbAgentTaskClaim.
    if ((res.rowsWritten ?? 0) > 0) {
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
  } else if (row.status !== "todo" && row.status !== "blocked") {
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
