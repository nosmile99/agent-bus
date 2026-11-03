// Kanban endpoints (projects, tasks, claim, release, status)
export * from './kanban-projects.js';
export * from './kanban-todos.js';
export * from './kanban-expansion.js';

import type {
  IBusDO,
  TaskRecord,
  TodoRecord,
  TaskWithTodos,
  BlockedKind,
  TaskPriority,
  TaskLane,
  TaskTemplateRecord,
} from '../types.js';
import {
  depApplyLink,
  depEventRecipients,
  depGateManualStatus,
  depGetTask,
  depLinkCheck,
  depReevaluateOnDone,
  depReblockOnReopen,
  depUnfinishedBlockers,
  depWriteEvent,
} from './dependencies.js';
// Amendment batch item 1: mechanical hold enforcement calls the
// ledger worker's helpers (implemented in handlers/ledger.ts, not
// here) — taskHoldFor for hold/gate rows, dissentHoldFor for
// dissent rows. They are called, never reimplemented, so the hold
// definition stays in one place.
import { taskHoldFor, dissentHoldFor } from './ledger.js';

export const VALID_LANES: readonly TaskLane[] = ['backend', 'android', 'unassigned'];
export const VALID_PRIORITIES: readonly TaskPriority[] = ['low', 'normal', 'urgent'];
export const VALID_STATUSES = ['todo', 'doing', 'done', 'blocked'] as const;
export const VALID_BLOCKED_KINDS: readonly BlockedKind[] = [
  'waiting-human',
  'waiting-task',
  'waiting-external',
];
export const LABEL_REGEX = /^[a-z0-9_-]{1,32}$/;

export class TxAbort extends Error {
  code: number;
  body: Record<string, unknown>;
  constructor(code: number, body: Record<string, unknown>) {
    super('tx_abort');
    this.code = code;
    this.body = body;
  }
}

// Amendment batch item 1: mechanical hold enforcement, shared by
// the claim, status, and admin-assignment paths below. A ledger
// hold/gate is checked first, then a dissent hold; either held
// result is a 409 with no mutation (callers check before any
// write, or throw TxAbort inside the transaction so it rolls
// back). Admin is NOT exempt: a hold binds every writer.
export function kbHoldRejection(
  bus: IBusDO,
  taskId: number
): { code: number; body: Record<string, unknown> } | null {
  const hold = taskHoldFor.call(bus, taskId);
  if (hold.held) {
    return {
      code: 409,
      body: {
        error: 'held',
        ledger_id: hold.ledger_id,
        hint: 'task is under an active ledger hold or gate; resolve the hold first',
      },
    };
  }
  // NOTE: dissentHoldFor takes refId as a STRING (ledger.ref_id is
  // TEXT); the batch brief's call shape passes the raw id, so the
  // conversion happens here, at the single call site.
  const dissent = dissentHoldFor.call(bus, 'task', String(taskId));
  if (dissent.held) {
    return {
      code: 409,
      body: {
        error: 'dissent_held',
        dissent_id: dissent.dissent_id,
        hint: 'task is under an active dissent hold; resolve the dissent first',
      },
    };
  }
  return null;
}

export function kbValidateLabelsArray(
  rawLabels: unknown
): { ok: true; labels: string[] } | { ok: false; error: string } {
  if (!Array.isArray(rawLabels)) {
    return { ok: false, error: 'invalid label' };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawLabels) {
    if (typeof item !== 'string') return { ok: false, error: 'invalid label' };
    const clean = item.trim().toLowerCase();
    if (!LABEL_REGEX.test(clean)) return { ok: false, error: 'invalid label' };
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return { ok: true, labels: out };
}

function substituteTemplatePlaceholders(
  text: string | null,
  vars: Record<string, unknown>
): { ok: true; value: string | null } | { ok: false; missingKey: string } {
  if (text === null || text === undefined) return { ok: true, value: null };
  const placeholderRe = /\{([a-zA-Z0-9_]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = placeholderRe.exec(text)) !== null) {
    const key = match[1]!;
    const val = vars[key];
    if (typeof val !== 'string' || !val.trim()) {
      return { ok: false, missingKey: key };
    }
  }
  const replaced = text.replace(placeholderRe, (_full, key: string) => String(vars[key]).trim());
  return { ok: true, value: replaced };
}

export function kbResolveTaskCreateInput(
  bus: IBusDO,
  payload: Record<string, unknown>,
  defaultLane: TaskLane
):
  | {
      ok: true;
      title: string;
      description: string | null;
      notes: string | null;
      priority: TaskPriority;
      lane: TaskLane;
      due_date: number | null;
      labels: string[];
    }
  | { ok: false; code: number; error: string } {
  let tpl: TaskTemplateRecord | null = null;
  let vars: Record<string, unknown> = {};

  if (payload.template !== undefined && payload.template !== null) {
    if (typeof payload.template !== 'string' || !payload.template.trim()) {
      return { ok: false, code: 400, error: 'unknown template' };
    }
    const tplRows = bus.sql
      .exec(`SELECT * FROM task_templates WHERE name = ?`, payload.template.trim())
      .toArray() as unknown as TaskTemplateRecord[];
    tpl = tplRows[0] || null;
    if (!tpl) {
      return { ok: false, code: 400, error: 'unknown template' };
    }
    if (payload.template_vars !== undefined && payload.template_vars !== null) {
      if (typeof payload.template_vars !== 'object' || Array.isArray(payload.template_vars)) {
        return { ok: false, code: 400, error: 'invalid template_vars' };
      }
      vars = payload.template_vars as Record<string, unknown>;
    }
  }

  // Expand template placeholders first (§2E.5): if any {placeholder} in the selected template
  // lacks a non-empty string key in template_vars, return 400.
  let tplTitle: string | null = null;
  let tplDesc: string | null = null;
  let tplNotes: string | null = null;
  if (tpl) {
    const subTitle = substituteTemplatePlaceholders(tpl.title, vars);
    if (!subTitle.ok) {
      return { ok: false, code: 400, error: `missing template_vars key: ${subTitle.missingKey}` };
    }
    tplTitle = subTitle.value;

    const subDesc = substituteTemplatePlaceholders(tpl.description, vars);
    if (!subDesc.ok) {
      return { ok: false, code: 400, error: `missing template_vars key: ${subDesc.missingKey}` };
    }
    tplDesc = subDesc.value;

    const subNotes = substituteTemplatePlaceholders(tpl.notes, vars);
    if (!subNotes.ok) {
      return { ok: false, code: 400, error: `missing template_vars key: ${subNotes.missingKey}` };
    }
    tplNotes = subNotes.value;
  }

  // Precedence (§2E.5): explicit request body fields override template defaults.
  let title = '';
  if (payload.title !== undefined && payload.title !== null) {
    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      return { ok: false, code: 400, error: 'title required' };
    }
    title = payload.title.trim();
  } else if (tplTitle !== null) {
    title = tplTitle.trim();
  } else {
    return { ok: false, code: 400, error: 'title required' };
  }
  if (!title) {
    return { ok: false, code: 400, error: 'title required' };
  }

  let description: string | null = tplDesc;
  if ('description' in payload && payload.description !== undefined) {
    if (payload.description !== null && typeof payload.description !== 'string') {
      return { ok: false, code: 400, error: 'invalid description' };
    }
    description = payload.description as string | null;
  }

  let notes: string | null = tplNotes;
  if ('notes' in payload && payload.notes !== undefined) {
    if (payload.notes !== null && typeof payload.notes !== 'string') {
      return { ok: false, code: 400, error: 'invalid notes' };
    }
    notes = payload.notes as string | null;
  }

  // Priority: body overrides template, else 'normal'.
  let priority: TaskPriority = tpl ? tpl.priority : 'normal';
  if (payload.priority !== undefined && payload.priority !== null) {
    if (
      typeof payload.priority !== 'string' ||
      !VALID_PRIORITIES.includes(payload.priority as TaskPriority)
    ) {
      return { ok: false, code: 400, error: 'invalid priority' };
    }
    priority = payload.priority as TaskPriority;
  }

  // Lane: body overrides template, else defaultLane.
  let lane: TaskLane = tpl ? tpl.lane : defaultLane;
  if (payload.lane !== undefined && payload.lane !== null) {
    if (typeof payload.lane !== 'string' || !VALID_LANES.includes(payload.lane as TaskLane)) {
      return { ok: false, code: 400, error: 'invalid lane' };
    }
    lane = payload.lane as TaskLane;
  }

  // Due date: nullable integer epoch seconds.
  let due_date: number | null = null;
  if (payload.due_date !== undefined && payload.due_date !== null) {
    if (typeof payload.due_date !== 'number' || !Number.isInteger(payload.due_date)) {
      return { ok: false, code: 400, error: 'invalid due_date' };
    }
    due_date = payload.due_date;
  }

  // Labels: body replaces template labels entirely (no merge).
  let labels: string[] = [];
  if (payload.labels !== undefined) {
    const validated = kbValidateLabelsArray(payload.labels);
    if (!validated.ok) return { ok: false, code: 400, error: validated.error };
    labels = validated.labels;
  } else if (tpl && tpl.labels) {
    try {
      const parsed = JSON.parse(tpl.labels);
      const validated = kbValidateLabelsArray(parsed);
      if (validated.ok) labels = validated.labels;
    } catch {}
  }

  return { ok: true, title, description, notes, priority, lane, due_date, labels };
}

export function kbTodosFor(this: IBusDO, taskId: number): TodoRecord[] {
  return this.sql
    .exec(
      "SELECT id, task_id, text, done, sort_order FROM todos WHERE task_id = ? ORDER BY sort_order ASC, id ASC",
      taskId
    )
    .toArray() as unknown as TodoRecord[];
}

export function kbTaskWithTodos(this: IBusDO, row: TaskRecord): TaskWithTodos {
  // Argon safety round: strip the internal unblocked_by_blocker_id
  // column and expose the gated public freeing_blocker_id instead,
  // so a stale column value on a claimed or re-blocked task never
  // surfaces (same pattern as ledgerPublicRow's demote_* handling).
  const { unblocked_by_blocker_id, ...rest } = row;
  return {
    ...rest,
    todos: this.kbTodosFor(row.id),
    freeing_blocker_id: row.unblocked_at ? (unblocked_by_blocker_id ?? null) : null,
  };
}

// Fix round 6, Perf M2: batched todos for whole lists — one
// chunked IN query per 50 tasks instead of kbTaskWithTodos's one
// query per task (search mapped up to 200 sequential todos
// queries; bare project lists were unbounded). Same row shape
// and ordering (sort_order, id) within each task; chunked at 50
// to stay under the 100-bound-parameter statement limit, like
// the unblocked pager's batching.
export function kbTasksWithTodos(this: IBusDO, rows: TaskRecord[]): TaskWithTodos[] {
  const todosByTask = new Map<number, TodoRecord[]>();
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const placeholders = chunk.map(() => '?').join(', ');
    const todoRows = this.sql
      .exec(
        `SELECT id, task_id, text, done, sort_order FROM todos WHERE task_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`,
        ...chunk.map((t) => t.id)
      )
      .toArray() as unknown as TodoRecord[];
    for (const tr of todoRows) {
      const list = todosByTask.get(tr.task_id) || [];
      list.push(tr);
      todosByTask.set(tr.task_id, list);
    }
  }
  // Argon safety round: same strip + gated freeing field as
  // kbTaskWithTodos above, per row.
  return rows.map((t) => {
    const { unblocked_by_blocker_id, ...rest } = t;
    return {
      ...rest,
      todos: todosByTask.get(t.id) || [],
      freeing_blocker_id: t.unblocked_at ? (unblocked_by_blocker_id ?? null) : null,
    };
  });
}

// GET /admin/api/kanban/projects/:id/tasks — tasks with todos embedded, ordered by default sort (§2E.3).
export async function handleKbAdminTasksList(this: IBusDO, req: Request, projectId: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const proj = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", projectId).toArray();
  if (proj.length === 0) return this.json(404, { error: "project not found" });
  const url = new URL(req.url);
  if (url.searchParams.toString().length > 0) {
    if (!url.searchParams.has("include_archived")) {
      url.searchParams.set("include_archived", "1");
    }
    return this.handleKbTaskSearch(url, { isAdmin: true, agent: null, projectId });
  }
  const tasks = this.kbTasksWithTodos(
    this.sql
      .exec(`SELECT * FROM tasks WHERE project_id = ? ORDER BY ${this.kbDefaultOrder("tasks")}`, projectId)
      .toArray() as unknown as TaskRecord[]
  );
  return this.json(200, { tasks });
}

// POST /admin/api/kanban/projects/:id/tasks — {title?, description?, notes?, priority?, assignee?, lane?, due_date?, template?, template_vars?, labels?}.
export async function handleKbAdminTaskCreate(this: IBusDO, req: Request, projectId: number): Promise<Response> {
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
  const proj = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", projectId).toArray();
  if (proj.length === 0) return this.json(404, { error: "project not found" });

  const resolved = kbResolveTaskCreateInput(this, payload, "unassigned");
  if (!resolved.ok) return this.json(resolved.code, { error: resolved.error });

  const { title, description, notes, priority, lane, due_date, labels } = resolved;

  // Assignee resolution (§2A.6 & §2H):
  // If assignee is explicitly null -> stays unassigned.
  // If assignee is omitted and lane is 'backend' or 'android' -> auto-assigns mapped lane owner.
  let assignee: string | null = null;
  if ("assignee" in payload && payload.assignee !== undefined) {
    if (payload.assignee === null) {
      assignee = null;
    } else if (typeof payload.assignee === "string" && payload.assignee.trim()) {
      assignee = payload.assignee.trim();
    } else {
      return this.json(400, { error: "assignee must be a string or null" });
    }
  } else if (lane === "backend" || lane === "android") {
    assignee = this.kbLaneOwner(lane);
  }

  const now = this.kbNow();
  const adminUser = this.kbBasicUser(req) || "admin";
  let id = 0;

  this.state.storage.transactionSync(() => {
    this.sql.exec(
      `INSERT INTO tasks (
        project_id, title, description, notes, status, priority, assignee, admin_assigned,
        claimed_at, created_by, created_at, updated_at, status_changed_at, last_activity_at, due_date, lane
      ) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId,
      title,
      description,
      notes,
      priority,
      assignee,
      assignee,
      assignee ? now : null,
      adminUser,
      now,
      now,
      now,
      now,
      due_date,
      lane
    );
    id = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;

    this.kbSystemLog(id, `admin created task (${lane}${assignee ? `, assigned to ${assignee}` : ""})`);

    const laneOwner = this.kbLaneOwner(lane);
    this.emitEvent("kanban.task.created", {
      actor: "admin",
      project_id: projectId,
      recipients: !assignee && laneOwner ? [laneOwner] : null,
      payload: {
        id,
        task_id: id,
        project_id: projectId,
        title,
        lane,
        assignee,
        created_by: adminUser,
      },
    });

    if (assignee) {
      this.emitEvent("kanban.task.assigned", {
        actor: "admin",
        project_id: projectId,
        recipients: [assignee],
        payload: {
          id,
          task_id: id,
          project_id: projectId,
          lane,
          assignee,
          assigned_by: adminUser,
        },
      });
    }

    for (const label of labels) {
      const r = this.kbLabelOp(id, label, "add", "admin");
      if (r.error) throw new TxAbort(r.code, { error: r.error });
    }
  });

  return this.json(200, { ok: true, id, lane, assignee });
}

// PUT /admin/api/kanban/tasks/:id — {title?, description?, notes?, status?, priority?, assignee?, blocked_kind?, blocked_reason?, due_date?, lane?, comment?, unblock?}.
export async function handleKbAdminTaskUpdate(this: IBusDO, req: Request, id: number): Promise<Response> {
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
  const taskRows = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray() as unknown as TaskRecord[];
  const task = taskRows[0];
  if (!task) return this.json(404, { error: "task not found" });

  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  const now = this.kbNow();
  const fieldEvents: Array<{ change: string; extra?: Record<string, unknown> }> = [];
  const adminUser = this.kbBasicUser(req) || "admin";

  if ("title" in payload && payload.title !== undefined) {
    if (typeof payload.title !== "string" || !payload.title.trim()) {
      return this.json(400, { error: "invalid title" });
    }
    updates.push("title = ?");
    vals.push(payload.title.trim());
    fieldEvents.push({ change: "title" });
  }
  if ("description" in payload && payload.description !== undefined) {
    if (payload.description !== null && typeof payload.description !== "string") {
      return this.json(400, { error: "invalid description" });
    }
    updates.push("description = ?");
    vals.push(payload.description as string | null);
    fieldEvents.push({ change: "description" });
  }
  if ("notes" in payload && payload.notes !== undefined) {
    if (payload.notes !== null && typeof payload.notes !== "string") {
      return this.json(400, { error: "invalid notes" });
    }
    updates.push("notes = ?");
    vals.push(payload.notes as string | null);
    fieldEvents.push({ change: "notes" });
  }
  if ("priority" in payload && payload.priority !== undefined) {
    if (
      typeof payload.priority !== "string" ||
      !VALID_PRIORITIES.includes(payload.priority as TaskPriority)
    ) {
      return this.json(400, { error: "invalid priority" });
    }
    updates.push("priority = ?");
    vals.push(payload.priority);
    fieldEvents.push({ change: "priority", extra: { priority: payload.priority } });
  }
  if ("due_date" in payload && payload.due_date !== undefined) {
    if (
      payload.due_date !== null &&
      (typeof payload.due_date !== "number" || !Number.isInteger(payload.due_date))
    ) {
      return this.json(400, { error: "invalid due_date" });
    }
    updates.push("due_date = ?");
    vals.push(payload.due_date as number | null);
    fieldEvents.push({ change: "due_date", extra: { due_date: payload.due_date } });
  }

  // Validate lane & assignee according to the exhaustive branch table in §2A.6.
  let finalLane: TaskLane = task.lane;
  let laneChanged = false;
  if ("lane" in payload && payload.lane !== undefined) {
    if (typeof payload.lane !== "string" || !VALID_LANES.includes(payload.lane as TaskLane)) {
      return this.json(400, { error: "invalid lane" });
    }
    finalLane = payload.lane as TaskLane;
    laneChanged = finalLane !== task.lane;
  }

  let finalAssignee: string | null = task.assignee;
  let assignedAssignee: string | null = null;
  const hasExplicitAssignee = "assignee" in payload && payload.assignee !== undefined;

  if (hasExplicitAssignee) {
    if (payload.assignee === null) {
      updates.push("assignee = NULL", "admin_assigned = NULL");
      finalAssignee = null;
      fieldEvents.push({ change: "assignee" });
    } else if (typeof payload.assignee === "string" && payload.assignee.trim()) {
      const a = payload.assignee.trim();
      updates.push("assignee = ?", "admin_assigned = ?", "claimed_at = ?");
      vals.push(a, a, now);
      finalAssignee = a;
      assignedAssignee = a;
      fieldEvents.push({ change: "assignee" });
    } else {
      return this.json(400, { error: "assignee must be a string or null" });
    }
  } else if (laneChanged) {
    // Exhaustive status-based branch table when lane changes and assignee is omitted (§2A.6):
    if (task.status === "doing" || task.status === "blocked") {
      return this.json(409, {
        error: "lane_change_conflict",
        reason: "task_in_progress",
        current: { assignee: task.assignee, status: task.status, lane: task.lane },
      });
    } else if (task.status === "todo") {
      if (finalLane === "backend" || finalLane === "android") {
        const newOwner = this.kbLaneOwner(finalLane);
        updates.push("assignee = ?", "admin_assigned = ?", "claimed_at = ?");
        vals.push(newOwner, newOwner, newOwner ? now : null);
        finalAssignee = newOwner;
        assignedAssignee = newOwner;
        fieldEvents.push({ change: "assignee" });
      } else {
        // finalLane === 'unassigned', status === 'todo', assignee omitted
        updates.push("assignee = NULL", "admin_assigned = NULL");
        finalAssignee = null;
        if (task.assignee !== null) fieldEvents.push({ change: "assignee" });
      }
    }
    // When task.status === 'done', assignee is unchanged and no wake is emitted.
  }

  if (laneChanged) {
    updates.push("lane = ?");
    vals.push(finalLane);
    fieldEvents.push({ change: "lane", extra: { lane: finalLane } });
  }

  // Comment & one-tap unblock default (§2A.8 & §2H):
  let commentBody: string | null = null;
  if ("comment" in payload && payload.comment !== undefined && payload.comment !== null) {
    if (typeof payload.comment !== "string") {
      return this.json(400, { error: "invalid comment" });
    }
    if (payload.comment.trim()) {
      commentBody = payload.comment.trim();
    }
  }

  let requestedStatus: string | undefined =
    payload.status !== undefined && payload.status !== null ? String(payload.status) : undefined;
  if (requestedStatus === undefined && payload.unblock === true) {
    requestedStatus = finalAssignee ? "doing" : "todo";
  }

  let statusEvent: {
    type: string;
    recipients?: string[] | null;
    payload: Record<string, unknown>;
  } | null = null;

  const wasBlocked = task.status === "blocked";
  const hasBlockedKindInPayload =
    payload.blocked_kind !== undefined && payload.blocked_kind !== null;
  const hasBlockedReasonInPayload =
    payload.blocked_reason !== undefined && payload.blocked_reason !== null;

  // Fix round 3 minor: an admin kind/reason flip on a task in an
  // archived project is rejected outright — otherwise a
  // dependency-owned row could be stranded by a kind change while
  // frozen (the unarchive re-evaluation never sees the flip).
  // Other admin field edits on archived tasks stay allowed, as before.
  if (
    (hasBlockedKindInPayload || hasBlockedReasonInPayload || requestedStatus === 'blocked') &&
    this.kbIsArchived(id)
  ) {
    return this.json(403, { error: 'project archived', hint: 'unarchive the project first' });
  }
  // Fix round 5 minor: a reason/kind-only payload on a NON-blocked
  // task is a 400 (blocked fields only valid with status=blocked),
  // not a link-state-dependent 409 — the 400 is ordered BEFORE
  // the gate, which would otherwise 409 on unfinished links.
  if (requestedStatus === undefined && task.status !== 'blocked' && (hasBlockedKindInPayload || hasBlockedReasonInPayload)) {
    return this.json(400, { error: 'blocked_kind only valid with status=blocked' });
  }
  // Revamp v12 §4.1 row 9: route admin manual status changes through
  // the dependency machine, with whole-request rejection (the gate
  // returns before any update is applied, so no partial apply).
  // Fix round M9: reason-only blocked-field writes are gated too
  // (gateStatus is 'blocked' for a reason-only payload, and the
  // reason change itself is passed to the gate).
  {
    const gateStatus =
      requestedStatus !== undefined
        ? requestedStatus
        : hasBlockedKindInPayload || hasBlockedReasonInPayload
          ? 'blocked'
          : undefined;
    // m-4 fix: gateKind is set only when the effective status is
    // 'blocked' (mirroring the agent gate, which passes undefined
    // otherwise), so a stray blocked_kind on a non-block move never
    // reaches the gate. Effective status is gateStatus, which is
    // 'blocked' for kind-only payloads as well as status='blocked'.
    const gateKind =
      gateStatus === 'blocked'
        ? (requestedStatus === 'blocked'
            ? (hasBlockedKindInPayload ? (payload.blocked_kind as string) : wasBlocked ? task.blocked_kind || 'waiting-human' : 'waiting-human')
            : (payload.blocked_kind as string | undefined))
        : undefined;
    if (gateStatus !== undefined) {
      const reasonChanged =
        hasBlockedReasonInPayload &&
        String(payload.blocked_reason).trim() !== (task.blocked_reason || '').trim();
      const gate = depGateManualStatus(this, task, gateStatus, gateKind, { reasonChanged, kindOmitted: !hasBlockedKindInPayload });
      if (gate) return this.json(gate.code, gate.body);
    }
  }

  if (requestedStatus !== undefined) {
    if (!VALID_STATUSES.includes(requestedStatus as (typeof VALID_STATUSES)[number])) {
      return this.json(400, { error: "status must be one of todo/doing/done/blocked" });
    }
    const willBlock = requestedStatus === "blocked";
    if (requestedStatus !== task.status) {
      updates.push("status = ?", "status_changed_at = ?");
      vals.push(requestedStatus, now);
    } else {
      updates.push("status = ?");
      vals.push(requestedStatus);
    }
    // Fix round C7: any manual status move clears unblocked_at — only
    // rule 4/4a may set it, so a manual unblock to todo must not leave
    // a stale timestamp that would surface the task in the unblocked
    // list, and a manual block must not carry one either.
    // Fix round 4, item 7: a same-status admin PUT is not a
    // transition, so it keeps unblocked_at (a rule-4-unblocked todo
    // task survives a no-op admin write); only a real status change
    // or a move out of blocked clears it.
    if (requestedStatus !== task.status || wasBlocked) {
      updates.push("unblocked_at = NULL");
    }

    if (willBlock) {
      const kind = !hasBlockedKindInPayload
        ? wasBlocked
          ? task.blocked_kind || "waiting-human"
          : "waiting-human"
        : payload.blocked_kind;
      if (typeof kind !== "string" || !VALID_BLOCKED_KINDS.includes(kind as BlockedKind)) {
        return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
      }
      let finalReason: string | null = null;
      if (hasBlockedReasonInPayload) {
        if (typeof payload.blocked_reason !== "string") {
          return this.json(400, { error: "blocked_reason must be a string" });
        }
        const trimmed = payload.blocked_reason.trim();
        if (trimmed.length < 1 || trimmed.length > 280) {
          return this.json(400, { error: "blocked_reason must be 1-280 characters" });
        }
        finalReason = trimmed;
      } else if (task.blocked_reason && task.blocked_reason.trim()) {
        finalReason = task.blocked_reason.trim();
      } else {
        return this.json(400, { error: "blocked_reason required when status=blocked" });
      }

      updates.push("blocked_kind = ?", "blocked_reason = ?");
      vals.push(kind, finalReason);
      // Fix round M6: a manual block clears blocked_from_status. The
      // one exception is a blocked-to-blocked edit of a genuinely
      // dependency-owned row (from_status set): clearing it there
      // would break the rule-4 restore, so it is preserved.
      if (!(wasBlocked && task.blocked_from_status)) {
        updates.push("blocked_from_status = NULL");
      }

      if (!wasBlocked) {
        statusEvent = {
          type: "kanban.task.blocked",
          // Fix round 6, Harsh M7 / Domain M9 parity: manual
          // block/unblock events name project subscribers plus
          // the assignee, like dependency events — the old
          // blocked event named nobody (broadcast-null, so a
          // non-subscriber owner on a closed project missed it
          // via recipients filtering) and the old unblocked
          // event named only the assignee (subscribers missed
          // it the same way). Poll itself also reaches project
          // subscribers; recipients parity is for clients that
          // filter on the recipients field.
          recipients: depEventRecipients(this, task.project_id, finalAssignee),
          payload: {
            id,
            task_id: id,
            lane: finalLane,
            assignee: finalAssignee,
            blocked_kind: kind,
            blocked_reason: finalReason,
          },
        };
      } else {
        // Blocked-to-blocked update (Amendment A2 & Phase 1 fix 3): emit change='blocked_kind', NOT change='status'.
        fieldEvents.push({
          change: "blocked_kind",
          extra: { blocked_kind: kind, blocked_reason: finalReason },
        });
      }
    } else {
      if (
        hasBlockedKindInPayload ||
        (hasBlockedReasonInPayload && String(payload.blocked_reason).trim() !== "")
      ) {
        return this.json(400, { error: "blocked_kind only valid with status=blocked" });
      }
      updates.push("blocked_kind = NULL", "blocked_reason = NULL", "blocked_from_status = NULL");
      if (wasBlocked) {
        statusEvent = {
          type: "kanban.task.unblocked",
          recipients: depEventRecipients(this, task.project_id, finalAssignee),
          payload: {
            id,
            task_id: id,
            lane: finalLane,
            assignee: finalAssignee,
            previous_blocked_kind: task.blocked_kind,
          },
        };
      } else {
        statusEvent = {
          type: "kanban.task.updated",
          payload: {
            id,
            task_id: id,
            lane: finalLane,
            assignee: finalAssignee,
            change: "status",
            status: requestedStatus,
          },
        };
      }
    }
  } else if (hasBlockedKindInPayload || hasBlockedReasonInPayload) {
    if (task.status !== "blocked") {
      return this.json(400, { error: "blocked_kind only valid with status=blocked" });
    }
    let finalKind: BlockedKind = (task.blocked_kind as BlockedKind) || "waiting-human";
    if (hasBlockedKindInPayload) {
      if (
        typeof payload.blocked_kind !== "string" ||
        !VALID_BLOCKED_KINDS.includes(payload.blocked_kind as BlockedKind)
      ) {
        return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
      }
      finalKind = payload.blocked_kind as BlockedKind;
      updates.push("blocked_kind = ?");
      vals.push(finalKind);
    }
    let finalReason: string | null = task.blocked_reason || null;
    if (hasBlockedReasonInPayload) {
      if (typeof payload.blocked_reason !== "string") {
        return this.json(400, { error: "blocked_reason must be a string" });
      }
      const trimmed = payload.blocked_reason.trim();
      if (trimmed.length < 1 || trimmed.length > 280) {
        return this.json(400, { error: "blocked_reason must be 1-280 characters" });
      }
      finalReason = trimmed;
      updates.push("blocked_reason = ?");
      vals.push(finalReason);
    } else if (!finalReason || !finalReason.trim()) {
      return this.json(400, { error: "blocked_reason required when status=blocked" });
    }
    // Fix round C7: a blocked row never carries unblocked_at, even
    // when only its kind/reason is edited. blocked_from_status is
    // deliberately NOT cleared here: a kind-only edit of a
    // dependency-owned row (same kind, per the gate) must keep it so
    // rule 4 can still restore; a manual row already has NULL.
    updates.push("unblocked_at = NULL");
    fieldEvents.push({
      change: "blocked_kind",
      extra: { blocked_kind: finalKind, blocked_reason: finalReason },
    });
  }

  // Amendment batch item 1: mechanical hold enforcement on the
  // admin path, for status moves and assignee changes only (a
  // title/notes/comment-only edit on a held task stays allowed).
  // An explicit assignee write, or a lane change that re-derives
  // the assignee on a todo task, counts as an assignment change
  // when the resulting assignee differs. Checked after all
  // validation above and before the transaction below, so a
  // rejection mutates nothing. Admin is not exempt from holds.
  {
    const assigneeChanged =
      (hasExplicitAssignee || laneChanged) && finalAssignee !== task.assignee;
    if (requestedStatus !== undefined || assigneeChanged) {
      const held = kbHoldRejection(this, id);
      if (held) return this.json(held.code, held.body);
    }
  }

  if (updates.length === 0 && !commentBody) {
    return this.json(400, { error: "nothing to update" });
  }

  let adminFanout: { processed: number; capped: boolean; pending_sweep: boolean } | null = null;
  this.state.storage.transactionSync(() => {
    if (updates.length > 0) {
      updates.push("updated_at = ?", "last_activity_at = ?");
      vals.push(now, now, id);
      this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    } else {
      this.kbTouchTask(id);
    }

    // Revamp v12 §4.1 rules 4/6, in this same transaction.
    // Fix round 4, item 4: fan-out stats are captured for the
    // response below when the cap truncates the pass.
    if (requestedStatus !== undefined && requestedStatus !== task.status) {
      if (requestedStatus === "done") {
        adminFanout = this.depReevaluateOnDone(id, now);
      } else if (task.status === "done") {
        adminFanout = this.depReblockOnReopen(id, now);
      }
    }

    if (commentBody) {
      this.sql.exec(
        `INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, ?, ?, ?)`,
        id,
        adminUser,
        commentBody,
        now
      );
      const cid = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
      this.emitEvent("kanban.comment.added", {
        actor: "admin",
        project_id: task.project_id,
        recipients: finalAssignee ? [finalAssignee] : null,
        payload: {
          id: cid,
          task_id: id,
          author: adminUser,
          lane: finalLane,
          assignee: finalAssignee,
        },
      });
    }

    for (const fe of fieldEvents) {
      const laneOwner = fe.change === "lane" && !finalAssignee ? this.kbLaneOwner(finalLane) : null;
      this.emitEvent("kanban.task.updated", {
        actor: "admin",
        project_id: task.project_id,
        recipients: laneOwner ? [laneOwner] : null,
        payload: {
          id,
          task_id: id,
          lane: finalLane,
          assignee: finalAssignee,
          change: fe.change,
          ...(fe.extra || {}),
        },
      });
    }

    if (statusEvent) {
      this.emitEvent(statusEvent.type, {
        actor: "admin",
        project_id: task.project_id,
        recipients: statusEvent.recipients || null,
        payload: statusEvent.payload,
      });
    }

    if (assignedAssignee) {
      this.emitEvent("kanban.task.assigned", {
        actor: "admin",
        project_id: task.project_id,
        recipients: [assignedAssignee],
        payload: {
          id,
          task_id: id,
          project_id: task.project_id,
          lane: finalLane,
          assignee: assignedAssignee,
          assigned_by: adminUser,
        },
      });
    }

    if (statusEvent || fieldEvents.length) {
      this.kbSystemLog(
        id,
        `admin updated: ${[...fieldEvents.map((f) => f.change), statusEvent ? statusEvent.type.split(".").pop() : null].filter(Boolean).join(", ")}`
      );
    }
  });

  const wip_warning =
    requestedStatus === "doing" && finalAssignee ? this.kbWipWarning(finalAssignee) : undefined;
  return this.json(200, {
    ok: true,
    id,
    ...(adminFanout ? { dependency_fanout: adminFanout } : {}),
    ...(wip_warning ? { wip_warning } : {}),
  });
}

// DELETE /admin/api/kanban/tasks/:id — cascade deletes todos via FK.
// Revamp v12 §4.1 rule 7: dependency links cascade with unlink events,
// and snapshotted dependents are re-evaluated in the same transaction.
export async function handleKbAdminTaskDelete(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  const rows = this.sql
    .exec(`SELECT project_id, lane, assignee FROM tasks WHERE id = ?`, id)
    .toArray() as Array<{
    project_id: number;
    lane: TaskLane;
    assignee: string | null;
  }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  // Amendment batch item 24: full fan-out impact, snapshotted
  // BEFORE the cascade delete (counts exact, ids capped at 100
  // each with a truncated flag). The cascade also removes
  // links/todos/labels/comments, so the snapshot must precede
  // it — after the delete there is nothing left to count.
  const fanout = {
    links_as_blocked: this.kbFanoutIds((this.sql.exec(`SELECT blocker_id AS id FROM task_dependencies WHERE blocked_id = ?`, id).toArray() as Array<{ id: number }>).map((r) => r.id)),
    links_as_blocker: this.kbFanoutIds((this.sql.exec(`SELECT blocked_id AS id FROM task_dependencies WHERE blocker_id = ?`, id).toArray() as Array<{ id: number }>).map((r) => r.id)),
    todos: this.kbFanoutIds((this.sql.exec(`SELECT id FROM todos WHERE task_id = ?`, id).toArray() as Array<{ id: number }>).map((r) => r.id)),
    labels: (() => {
      const all = (this.sql.exec(`SELECT label FROM task_labels WHERE task_id = ?`, id).toArray() as Array<{ label: string }>).map((r) => r.label);
      return { count: all.length, labels: all.slice(0, 100), truncated: all.length > 100 };
    })(),
    comments: this.kbFanoutIds((this.sql.exec(`SELECT id FROM task_comments WHERE task_id = ?`, id).toArray() as Array<{ id: number }>).map((r) => r.id)),
  };
  // Fix round 5, M7: the cascade summary is surfaced, not dropped.
  let cascadeSummary: { links_removed: number; dependents_unblocked: number; unblocked_ids: number[]; capped: boolean; pending_sweep: boolean; snapshots_truncated: boolean } | null = null;
  this.state.storage.transactionSync(() => {
    cascadeSummary = this.depCascadeOnTaskDelete(id, this.kbNow());
  });
  this.emitEvent("kanban.task.deleted", {
    actor: "admin",
    project_id: task.project_id,
    payload: { id, task_id: id, lane: task.lane, assignee: task.assignee },
  });
  return this.json(200, { ok: true, id, fanout, ...(cascadeSummary ? { dependency_cascade: cascadeSummary } : {}) });
}

// GET /api/kanban/projects/:id/tasks — non-archived subscribed project tasks ordered by default sort (§2E.3).
export async function handleKbAgentTasksList(this: IBusDO, req: Request, projectId: number): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const proj = this.sql
    .exec(
      `SELECT 1 FROM projects WHERE id = ? AND archived = 0 AND ${this.kbSubscriberPred("projects.id")}`,
      projectId,
      agent
    )
    .toArray();
  if (proj.length === 0) return this.json(404, { error: "project not found" });
  const url = new URL(req.url);
  if (url.searchParams.toString().length > 0) {
    return this.handleKbTaskSearch(url, { isAdmin: false, agent, projectId });
  }
  const tasks = this.kbTasksWithTodos(
    this.sql
      .exec(`SELECT * FROM tasks WHERE project_id = ? ORDER BY ${this.kbDefaultOrder("tasks")}`, projectId)
      .toArray() as unknown as TaskRecord[]
  );
  return this.json(200, { tasks });
}

// POST /api/kanban/tasks/:id/claim — atomic first-win claim (§2A.5). Auth: Bearer.
export async function handleKbAgentTaskClaim(this: IBusDO, req: Request, id: number): Promise<Response> {
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

  const rows = this.sql
    .exec(
      `SELECT t.*, p.archived AS project_archived
       FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
      id
    )
    .toArray() as unknown as Array<TaskRecord & { project_archived: number }>;
  const row = rows[0];
  if (!row) return this.json(404, { error: "task not found" });

  // Subscriber predicate check first so restricted projects never leak task state (§2A.2 / §2A.5).
  const subCheck = this.sql
    .exec(
      `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
      row.project_id,
      agent
    )
    .toArray();
  if (subCheck.length === 0) {
    return this.json(403, { error: "auto_claim_failed", reason: "project_not_readable" });
  }
  if (row.project_archived) {
    return this.json(403, { error: "auto_claim_failed", reason: "project_archived" });
  }
  // Amendment batch item 1: a held or dissent-held task cannot be
  // claimed at all — checked before the already-owned early return
  // below, so an already-owned re-claim on a held task is rejected
  // too, not silently allowed through the idempotent path.
  {
    const held = kbHoldRejection(this, id);
    if (held) return this.json(held.code, held.body);
  }
  if (row.assignee === agent) {
    // Amendment batch item 0 (§4 REVERT): the round-5 deviation
    // that let an already-owned re-claim preserve unblocked_at is
    // reverted. ANY claim — fresh or already-owned re-claim —
    // clears unblocked_at (blanket-clear, same transaction as the
    // claim itself), so a re-claimed task leaves the unblocked
    // list exactly like a fresh claim does. The response shape is
    // unchanged (already:true, same fields as before).
    this.state.storage.transactionSync(() => {
      this.sql.exec(`UPDATE tasks SET unblocked_at = NULL WHERE id = ? AND assignee = ?`, id, agent);
    });
    const wip_warning = this.kbWipWarning(agent);
    return this.json(200, {
      ok: true,
      id,
      assignee: agent,
      status: row.status,
      lane: row.lane,
      blocked_kind: row.blocked_kind || null,
      blocked_reason: row.blocked_reason || null,
      blocked_from_status: row.blocked_from_status || null,
      already: true,
      ...(wip_warning ? { wip_warning } : {}),
    });
  }

  const now = this.kbNow();
  const agentLane = this.kbAgentLane(agent);

  // Fix round C5: a blocked unassigned task can be claimed. The claim
  // preserves the blocked state exactly (status, kind, reason,
  // from_status) — it only assigns the task, so the new owner can
  // then work the unblock path. status_changed_at is untouched
  // because the status did not change.
  if (row.status === 'blocked') {
    let blockedClaimed = false;
    let blockedLane: TaskLane = row.lane;
    this.state.storage.transactionSync(() => {
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
        id,
        agent,
        agent,
        agentLane
      ) as { rowsWritten?: number };
      if ((res.rowsWritten ?? 0) > 0) {
        blockedClaimed = true;
        const updated = (
          this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray() as unknown as TaskRecord[]
        )[0]!;
        blockedLane = updated.lane;
        this.kbSystemLog(id, `${agent} claimed the task`);
        this.emitEvent("kanban.task.claimed", {
          actor: agent,
          project_id: updated.project_id,
          payload: {
            id,
            task_id: id,
            claimant: agent,
            assignee: agent,
            auto: false,
            lane: blockedLane,
            status: 'blocked',
            blocked_kind: updated.blocked_kind,
            blocked_reason: updated.blocked_reason,
            blocked_from_status: updated.blocked_from_status,
          },
        });
      }
    });
    if (blockedClaimed) {
      const wip_warning = this.kbWipWarning(agent);
      return this.json(200, {
        ok: true,
        id,
        assignee: agent,
        status: 'blocked',
        lane: blockedLane,
        blocked_kind: row.blocked_kind || null,
        blocked_reason: row.blocked_reason || null,
        blocked_from_status: row.blocked_from_status || null,
        // Fix round 8, (5): structured blocker ids, same source
        // as the 409 current payload — no prose parsing needed.
        blocker_ids: depUnfinishedBlockers(this, id).map((b) => b.blocker_id),
        ...(wip_warning ? { wip_warning } : {}),
      });
    }
    // Fall through to the reason computation below (lane mismatch on
    // a blocked task reports wrong_lane, not invalid_status).
  }

  let claimedLane: TaskLane = row.lane;
  let claimed = false;

  this.state.storage.transactionSync(() => {
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
      id,
      agent,
      agent,
      agentLane
    ) as { rowsWritten?: number };

    // Same rowsWritten note as kbAutoClaimOrVerify: index writes inflate
    // the count (3 for a 1-row update), so match on > 0, not === 1.
    if ((res.rowsWritten ?? 0) > 0) {
      claimed = true;
      const updated = (
        this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray() as unknown as TaskRecord[]
      )[0]!;
      claimedLane = updated.lane;
      this.kbSystemLog(id, `${agent} claimed the task`);
      this.emitEvent("kanban.task.claimed", {
        actor: agent,
        project_id: updated.project_id,
        payload: {
          id,
          task_id: id,
          claimant: agent,
          assignee: agent,
          auto: false,
          lane: claimedLane,
        },
      });
    }
  });

  if (claimed) {
    const wip_warning = this.kbWipWarning(agent);
    return this.json(200, {
      ok: true,
      id,
      assignee: agent,
      status: "doing",
      lane: claimedLane,
      ...(wip_warning ? { wip_warning } : {}),
    });
  }

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
  // Fix round 6, Harsh m-3: a failed claim used to hide the
  // blocked state ({assignee, admin_assigned, status, lane}),
  // costing an extra detail call (+1 token) to learn why the
  // task is blocked. The blocked fields ride along now.
  // Fix round 8, (5): blocked_from_status rides along too (the
  // 200 claim paths already carry it), plus structured
  // blocker_ids — blocker identity previously lived only inside
  // the prose blocked_reason (depMultiReason, truncated to 500
  // chars), so a caller needing the blocker set had to parse
  // prose. The ids come from the live dependency rows, not the
  // reason text, so truncation cannot cut them.
  return this.json(409, {
    error: "auto_claim_failed",
    reason,
    current: {
      assignee: row.assignee,
      admin_assigned: row.admin_assigned,
      status: row.status,
      lane: row.lane,
      blocked_kind: row.blocked_kind || null,
      blocked_reason: row.blocked_reason || null,
      blocked_from_status: row.blocked_from_status || null,
      blocker_ids: row.status === 'blocked' ? depUnfinishedBlockers(this, id).map((b) => b.blocker_id) : [],
    },
  });
}

// POST /api/kanban/tasks/:id/release — assignee releases task (§2H). Auth: Bearer.
export async function handleKbAgentTaskRelease(this: IBusDO, req: Request, id: number): Promise<Response> {
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

  const rows = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray() as unknown as TaskRecord[];
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  if (task.assignee !== agent) {
    const sub = this.sql
      .exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        task.project_id,
        agent
      )
      .toArray();
    if (!sub.length) return this.json(404, { error: "task not found" });
    return this.json(403, { error: "not your task" });
  }
  if (this.kbIsArchived(id)) return this.json(403, { error: "project archived" });

  const now = this.kbNow();
  const newStatus = task.status === "doing" ? "todo" : task.status;
  const newStatusChangedAt = task.status === "doing" ? now : task.status_changed_at ?? now;
  const newAdminAssigned = task.admin_assigned === agent ? null : task.admin_assigned;
  // Fix round 4, item 7: release is a status transition only when
  // doing -> todo. Releasing a todo task only unassigns it, so it
  // must KEEP unblocked_at and stay in the unblocked list; the old
  // code cleared it on every release (the claim-release
  // resurrection bug in reverse: a legitimately unblocked todo
  // task vanished from the list on release).
  const releaseChangedStatus = newStatus !== task.status;

  this.state.storage.transactionSync(() => {
    this.sql.exec(
      `UPDATE tasks
       SET assignee = NULL, status = ?, status_changed_at = ?, admin_assigned = ?, updated_at = ?, last_activity_at = ?${releaseChangedStatus ? `, unblocked_at = NULL` : ``}
       WHERE id = ? AND assignee = ?`,
      newStatus,
      newStatusChangedAt,
      newAdminAssigned,
      now,
      now,
      id,
      agent
    );
    this.kbSystemLog(id, `${agent} released the task`);
    this.emitEvent("kanban.task.released", {
      actor: agent,
      project_id: task.project_id,
      payload: {
        id,
        task_id: id,
        released_by: agent,
        assignee: null,
        lane: task.lane,
        status: newStatus,
      },
    });
  });

  return this.json(200, { ok: true, id, status: newStatus, assignee: null });
}

// PUT /api/kanban/tasks/:id/status — {status, blocked_kind?, blocked_reason?}. Assignee or auto-claim (§2A.2, §2H). Auth: Bearer.
export async function handleKbAgentTaskStatus(this: IBusDO, req: Request, id: number): Promise<Response> {
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
  if (!payload || typeof payload !== "object") return this.json(400, { error: "invalid json" });
  const status = payload.status;
  if (typeof status !== "string" || !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return this.json(400, { error: "status must be one of todo/doing/done/blocked" });
  }

  const willBlock = status === "blocked";
  const hasBlockedKindInPayload =
    payload.blocked_kind !== undefined && payload.blocked_kind !== null;
  const hasBlockedReasonInPayload =
    payload.blocked_reason !== undefined && payload.blocked_reason !== null;

  // Fix round 4, item 13: kind-enum and reason-length 400s are
  // payload-level validation and run BEFORE the rate check, like
  // the status-enum check above — they must not consume quota.
  // (The in-transaction checks below stay as the authoritative
  // re-check after auto-claim, but a bad payload never reaches
  // the rate check now.)
  if (hasBlockedKindInPayload) {
    if (typeof payload.blocked_kind !== "string" || !VALID_BLOCKED_KINDS.includes(payload.blocked_kind as BlockedKind)) {
      return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
    }
  }
  if (hasBlockedReasonInPayload) {
    if (typeof payload.blocked_reason !== "string") {
      return this.json(400, { error: "blocked_reason must be a string" });
    }
    if (willBlock) {
      const trimmed = payload.blocked_reason.trim();
      if (trimmed.length < 1 || trimmed.length > 280) {
        return this.json(400, { error: "blocked_reason must be 1-280 characters" });
      }
    }
  }
  // Fix round 4, item 2: an agent status write may carry a comment,
  // like the admin update does. It is validated here (bad type =
  // 400 before quota) and written inside the transaction below;
  // it is never silently dropped.
  let statusCommentBody: string | null = null;
  if ("comment" in payload && payload.comment !== undefined && payload.comment !== null) {
    if (typeof payload.comment !== "string") {
      return this.json(400, { error: "invalid comment" });
    }
    // Fix round 5 minor: status comments carry the comment
    // endpoint's 8192-byte cap, enforced here — before quota and
    // before the transaction — so it holds on no-op PUTs too.
    if (new TextEncoder().encode(payload.comment).length > 8192) {
      return this.json(413, { error: "comment too large (max 8192 bytes)" });
    }
    if (payload.comment.trim()) statusCommentBody = payload.comment.trim();
  }

  if (!willBlock) {
    if (
      hasBlockedKindInPayload ||
      (hasBlockedReasonInPayload && String(payload.blocked_reason).trim() !== "")
    ) {
      return this.json(400, { error: "blocked_kind only valid with status=blocked" });
    }
  }

  // Fix round 3, M6: rate-check after payload validation (status
  // enum + blocked-field presence above), before the fan-out
  // transaction. Gate failures inside the transaction may still
  // consume quota — the gate needs the post-claim row, so it cannot
  // run before the claim — but payload-level 400s above do not.
  // Admin is exempt here, as on every other endpoint: applying an
  // agent bucket to the Basic admin user would 429 ordinary admin
  // bulk work (and the test harness, which never clears it).
  // Fix round 6, API M4: the status PUT is the MIDDLE step of a
  // 2N+1 rescue (unlinks applied, links pending), so its 429
  // carries the rescue hint link/unlink 429s already carry —
  // the step whose state most needs one.
  if (!this.rlCheck(agent)) return this.rlLimitedResponse(agent, 'rate limited mid-rescue? wait retry_after_seconds, then retry only the status step (already-applied unlinks are safe to re-check; re-list dependencies first, then re-link the still-missing links)');
  // Fix round 4, item 2 + item 4: auto_claimed is echoed in the
  // response (it was computed but dropped), and fan-out stats
  // from a done/reopen move are surfaced when the cap truncates.
  let autoClaimedOut = false;
  let statusFanout: { processed: number; capped: boolean; pending_sweep: boolean } | null = null;
  const insertStatusComment = () => {
    if (!statusCommentBody) return;
    const nowC = this.kbNow();
    this.sql.exec(
      `INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, ?, ?, ?)`,
      id,
      agent,
      statusCommentBody,
      nowC
    );
    const cid = (this.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number }).id;
    // The caller's post-claim task row is available via the
    // closure below through taskForComment; set by the caller.
    this.emitEvent("kanban.comment.added", {
      actor: agent,
      project_id: taskForComment?.project_id ?? null,
      recipients: taskForComment?.assignee ? [taskForComment.assignee] : null,
      payload: { id: cid, task_id: id, author: agent, lane: taskForComment?.lane, assignee: agent },
    });
  };
  let taskForComment: TaskRecord | null = null;
  try {
    this.state.storage.transactionSync(() => {
      const claimRes = this.kbAutoClaimOrVerify(id, agent, {
        isStatusEndpoint: true,
        requestedStatus: status,
      });
      if (!claimRes.ok) {
        throw new TxAbort(claimRes.code!, claimRes.body!);
      }
      const task = claimRes.task!;
      const autoClaimed = !!claimRes.autoClaimed;
      autoClaimedOut = autoClaimed;
      taskForComment = task;

      // Amendment batch item 1: mechanical hold enforcement on
      // the agent status path. Checked here — after auto-claim
      // verification (so invisible tasks still fail on visibility
      // first) but before the auto-claimed early return and before
      // any status write — and thrown as TxAbort, so the whole
      // transaction (including any just-applied auto-claim) rolls
      // back and no mutation persists.
      {
        const held = kbHoldRejection(this, id);
        if (held) throw new TxAbort(held.code, held.body);
      }

      // If auto-claimed from todo, kbAutoClaimOrVerify already
      // transitioned the task to 'doing' and emitted kanban.task.claimed.
      // Per §2A.2: if the triggering write is status='doing', no second status event is emitted.
      // A blocked auto-claim does NOT early-return: the claim preserved
      // 'blocked', and this write is the move out of it.
      if (autoClaimed && status === "doing" && task.status !== "blocked") {
        insertStatusComment();
        return;
      }

      // Fix round C5: wasBlocked is about the post-claim row, whether
      // or not the claim just happened — a blocked auto-claim followed
      // by a status move must emit kanban.task.unblocked, not a plain
      // status update.
      const wasBlocked = task.status === "blocked";
      const now = this.kbNow();

      // Revamp v12 §4.1 row 9: manual status changes on a
      // dependency-blocked task are rejected, and a manual blocked
      // waiting-task with no unfinished link is rejected.
      {
        const gateKind = willBlock
          ? (hasBlockedKindInPayload ? (payload.blocked_kind as string) : task.blocked_kind || 'waiting-human')
          : undefined;
        // Fix round M9: a reason edit on a blocked task is gated too.
        const reasonChanged =
          hasBlockedReasonInPayload &&
          String(payload.blocked_reason).trim() !== (task.blocked_reason || '').trim();
        const gate = depGateManualStatus(this, task, status, gateKind, { reasonChanged, kindOmitted: !hasBlockedKindInPayload });
        if (gate) throw new TxAbort(gate.code, gate.body);
      }

      if (willBlock) {
        const kind = !hasBlockedKindInPayload
          ? wasBlocked
            ? task.blocked_kind || "waiting-human"
            : "waiting-human"
          : payload.blocked_kind;
        if (typeof kind !== "string" || !VALID_BLOCKED_KINDS.includes(kind as BlockedKind)) {
          throw new TxAbort(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
        }

        let finalReason: string | null = null;
        if (hasBlockedReasonInPayload) {
          if (typeof payload.blocked_reason !== "string") {
            throw new TxAbort(400, { error: "blocked_reason must be a string" });
          }
          const trimmed = payload.blocked_reason.trim();
          if (trimmed.length < 1 || trimmed.length > 280) {
            throw new TxAbort(400, { error: "blocked_reason must be 1-280 characters" });
          }
          finalReason = trimmed;
        } else if (wasBlocked && task.blocked_reason && task.blocked_reason.trim()) {
          finalReason = task.blocked_reason.trim();
        } else {
          throw new TxAbort(400, { error: "blocked_reason required when status=blocked" });
        }

        const newBlockedStatusChangedAt = wasBlocked ? (task.status_changed_at ?? now) : now;
        // Fix round M6: a manual block clears blocked_from_status,
        // except a blocked-to-blocked edit of a dependency-owned row,
        // which must keep it for the rule-4 restore.
        const preserveFrom = wasBlocked && !!task.blocked_from_status;
        this.sql.exec(
          `UPDATE tasks
           SET status = 'blocked', blocked_kind = ?, blocked_reason = ?, blocked_from_status = ?, status_changed_at = ?, updated_at = ?, last_activity_at = ?, unblocked_at = NULL
           WHERE id = ? AND assignee = ?`,
          kind,
          finalReason,
          preserveFrom ? task.blocked_from_status : null,
          newBlockedStatusChangedAt,
          now,
          now,
          id,
          agent
        );

        if (!wasBlocked) {
          this.emitEvent("kanban.task.blocked", {
            actor: agent,
            project_id: task.project_id,
            // Fix round 6, Harsh M7 parity: subscribers plus
            // assignee, like dependency events (see the admin
            // update note above).
            recipients: depEventRecipients(this, task.project_id, agent),
            payload: {
              id,
              task_id: id,
              lane: task.lane,
              assignee: agent,
              blocked_kind: kind,
              blocked_reason: finalReason,
            },
          });
          this.kbSystemLog(id, `${agent} blocked the task (${kind}): ${finalReason}`);
        } else {
          // Blocked-to-blocked update (Amendment A2 & Phase 1 fix 3): emit change='blocked_kind', NOT change='status'.
          this.emitEvent("kanban.task.updated", {
            actor: agent,
            project_id: task.project_id,
            payload: {
              id,
              task_id: id,
              lane: task.lane,
              assignee: agent,
              change: "blocked_kind",
              blocked_kind: kind,
              blocked_reason: finalReason,
            },
          });
          this.kbSystemLog(id, `${agent} updated blocked state (${kind}): ${finalReason}`);
        }
      } else {
        // Fix round C7/M6: a manual unblock always clears both
        // unblocked_at (only rule 4/4a may set it) and
        // blocked_from_status — a stale timestamp must never surface
        // a manually unblocked task in the unblocked list.
        // Fix round 4, item 7: a SAME-STATUS put is not a
        // transition (the plan clears on "any transition out of
        // todo"), so it must NOT clear unblocked_at: a todo task
        // that was rule-4-unblocked keeps its list stamp through
        // a no-op status write. Only a real status change, or a
        // move out of blocked, clears it.
        const statusChanged = status !== task.status;
        const clearUnblocked = wasBlocked || statusChanged;
        this.sql.exec(
          `UPDATE tasks
           SET status = ?, blocked_kind = NULL, blocked_reason = NULL, blocked_from_status = NULL, status_changed_at = ?, updated_at = ?, last_activity_at = ?${clearUnblocked ? `, unblocked_at = NULL` : ``}
           WHERE id = ? AND assignee = ?`,
          status,
          now,
          now,
          now,
          id,
          agent
        );

        if (wasBlocked) {
          this.emitEvent("kanban.task.unblocked", {
            actor: agent,
            project_id: task.project_id,
            recipients: depEventRecipients(this, task.project_id, agent),
            payload: {
              id,
              task_id: id,
              lane: task.lane,
              assignee: agent,
              previous_blocked_kind: task.blocked_kind,
              // Argon safety round: a manual unblock has no freeing
              // blocker (the task never enters the unblocked list:
              // unblocked_at is cleared, not set, on this path).
              freeing_blocker_id: null,
            },
          });
          this.kbSystemLog(id, `${agent} unblocked the task (was ${task.blocked_kind})`);
        } else {
          this.emitEvent("kanban.task.updated", {
            actor: agent,
            project_id: task.project_id,
            payload: {
              id,
              task_id: id,
              lane: task.lane,
              assignee: agent,
              change: "status",
              status,
            },
          });
          this.kbSystemLog(id, `${agent} set status to ${status}`);
        }
      }

      // Agent status comment (fix round 4, item 2): written after
      // the status move succeeds, before fan-out, in the same
      // transaction as the move.
      insertStatusComment();

      // Revamp v12 §4.1 rules 4/6: a blocker reaching done unblocks
      // waiting-task dependents; a done blocker reopening re-blocks
      // todo/doing dependents. Both run in this same transaction.
      if (status === 'done' && task.status !== 'done') {
        statusFanout = this.depReevaluateOnDone(id, now);
      } else if (task.status === 'done' && status !== 'done') {
        statusFanout = this.depReblockOnReopen(id, now);
      }
    });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }

  const wip_warning = status === "doing" ? this.kbWipWarning(agent) : undefined;
  return this.json(200, {
    ok: true,
    id,
    status,
    auto_claimed: autoClaimedOut,
    ...(statusFanout ? { dependency_fanout: statusFanout } : {}),
    ...(wip_warning ? { wip_warning } : {}),
  });
}

// POST /api/kanban/tasks/:id/rescue and /admin/api/kanban/tasks/:id/rescue —
// {status?, relink?}. Amendment batch item 12: atomic rescue.
// Unlink-all (unfinished links only) + status move + re-link run in
// ONE transactionSync, replacing the manual 2N+1 rescue (one unlink
// call per link, one status call, one link call per re-link). A
// single call costs a single rate unit (one rlCheck for agents;
// admin is exempt, as elsewhere). Safe to retry: already-unlinked
// links are no-ops (the unlink step only deletes links that exist),
// and re-link entries that are already satisfied (done blocker) or
// duplicates (already linked) are skipped idempotently, not errors.
//
// Response: { ok, id, status, target_status, unlinked: [...ids],
// relinked: [{blocker_id, ok, skipped?}],
// relink_failed: [{blocker_id, error}],
// dependency_fanout? }. `status` is the FINAL task status after
// all steps; `target_status` is the requested move target. They
// differ when a re-link re-blocks the task: re-linking uses the
// normal link transition (depApplyLink, same as POST dependencies),
// so re-linking an unfinished blocker onto a todo/doing task
// blocks it again waiting-task — the documented manual escape
// (unlink all, move to todo, re-link so the machine owns the block)
// ends the same way. A rescue with relink:[] (or only skipped
// entries) leaves the task at exactly target_status.
//
// Deliberately NOT hold-enforced (see item 1): the item-1 path list
// is status/claim/assign; whether rescue must also reject held
// tasks is left for the parent to decide — it currently moves a
// held task like any other manual move would not.
export async function handleKbTaskRescue(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  // Auth without rate first, mirroring the dependency handlers:
  // malformed bodies and failed auth must not consume quota.
  let actor: string;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    actor = this.kbBasicUser(req) || 'admin';
  } else {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
    actor = agent;
  }
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: 'invalid json' });
  }
  const payload = data as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return this.json(400, { error: 'invalid json' });
  }
  for (const key of Object.keys(payload)) {
    if (key !== 'status' && key !== 'relink') {
      return this.json(400, { error: `field ${key} is not a rescue field`, field: key, allowed: ['status', 'relink'] });
    }
  }
  let targetStatus = 'todo';
  if (payload.status !== undefined && payload.status !== null) {
    if (typeof payload.status !== 'string' || !VALID_STATUSES.includes(payload.status as (typeof VALID_STATUSES)[number])) {
      return this.json(400, { error: 'status must be one of todo/doing/done/blocked' });
    }
    targetStatus = payload.status;
  }
  // A rescue moves a task OUT of a stuck state; blocking it again
  // via rescue would need a kind/reason the body does not carry,
  // so a blocked target is rejected rather than half-built.
  if (targetStatus === 'blocked') {
    return this.json(400, { error: 'rescue target status must not be blocked', hint: 'rescue to todo, doing, or done; block via the status or dependency endpoints' });
  }
  let relink: number[] = [];
  if (payload.relink !== undefined && payload.relink !== null) {
    if (!Array.isArray(payload.relink) || payload.relink.some((v) => typeof v !== 'number' || !Number.isInteger(v))) {
      return this.json(400, { error: 'relink must be an array of task ids', field: 'relink' });
    }
    relink = payload.relink as number[];
  }

  // Pre-checks (read-only, no await between here and the
  // transaction, so the DO's single-threaded execution keeps them
  // authoritative enough; the transaction re-checks the same
  // conditions). Mirrors handleDepUnlink's visibility/ownership/
  // archived shape: an agent that neither owns the task nor
  // subscribes to its project gets 404, never a leak.
  const preTask = depGetTask(this, id);
  if (!preTask) return this.json(404, { error: 'task not found', field: 'task_id' });
  if (!opts.isAdmin) {
    const visible =
      preTask.assignee === actor ||
      this.sql
        .exec(
          `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred('projects.id')}`,
          preTask.project_id,
          actor
        )
        .toArray().length > 0;
    if (!visible) return this.json(404, { error: 'task not found', field: 'task_id' });
    if (preTask.assignee !== null && preTask.assignee !== actor) {
      return this.json(403, { error: 'forbidden: task owned by another agent' });
    }
  }
  if (preTask.project_archived) {
    return this.json(400, { error: 'project archived', hint: 'unarchive the project first' });
  }
  // Single rate unit for the whole rescue (agent path only).
  if (!opts.isAdmin && !this.rlCheck(actor)) return this.rlLimitedResponse(actor);

  try {
    let result: Record<string, unknown> = {};
    this.state.storage.transactionSync(() => {
      const task = depGetTask(this, id);
      if (!task) throw new TxAbort(404, { error: 'task not found', field: 'task_id' });
      if (!opts.isAdmin) {
        const visible =
          task.assignee === actor ||
          this.sql
            .exec(
              `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred('projects.id')}`,
              task.project_id,
              actor
            )
            .toArray().length > 0;
        if (!visible) throw new TxAbort(404, { error: 'task not found', field: 'task_id' });
        if (task.assignee !== null && task.assignee !== actor) {
          throw new TxAbort(403, { error: 'forbidden: task owned by another agent' });
        }
      }
      if (task.project_archived) {
        throw new TxAbort(400, { error: 'project archived', hint: 'unarchive the project first' });
      }
      const now = this.kbNow();

      // Step 1: unlink all current UNFINISHED links (blocker not
      // done). Links to done blockers are already satisfied and
      // stay; re-linking one later skips as already-satisfied.
      // Each unlink writes its dependency_events audit row, like
      // handleDepUnlink — but no per-link unblock/restore runs
      // here: the explicit status move below supersedes it.
      const unlinked: number[] = [];
      for (const b of depUnfinishedBlockers(this, id)) {
        this.sql.exec(`DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?`, b.blocker_id, id);
        depWriteEvent(this, b.blocker_id, id, actor, 'unlink', null, now);
        unlinked.push(b.blocker_id);
      }

      // Step 2: status move. The dependency gate runs on the
      // post-unlink row (zero unfinished links, so it passes for
      // every non-blocked target today) to keep gate invariants
      // holding on this path too.
      const postUnlink = depGetTask(this, id)!;
      const gate = depGateManualStatus(this, postUnlink, targetStatus, undefined, { kindOmitted: true });
      if (gate) throw new TxAbort(gate.code, gate.body);
      const wasBlocked = postUnlink.status === 'blocked';
      const statusChanged = targetStatus !== postUnlink.status;
      // Same-status rule (mirrors the agent status handler, fix
      // round 4 item 7): a no-op move keeps unblocked_at; only a
      // real change, or a move out of blocked, clears it.
      const clearUnblocked = wasBlocked || statusChanged;
      this.sql.exec(
        `UPDATE tasks
         SET status = ?, blocked_kind = NULL, blocked_reason = NULL, blocked_from_status = NULL, status_changed_at = ?, updated_at = ?, last_activity_at = ?${clearUnblocked ? `, unblocked_at = NULL` : ``}
         WHERE id = ?`,
        targetStatus,
        statusChanged ? now : (postUnlink.status_changed_at ?? now),
        now,
        now,
        id
      );
      if (wasBlocked) {
        this.emitEvent('kanban.task.unblocked', {
          actor,
          project_id: postUnlink.project_id,
          recipients: depEventRecipients(this, postUnlink.project_id, postUnlink.assignee),
          payload: {
            id,
            task_id: id,
            lane: postUnlink.lane,
            assignee: postUnlink.assignee,
            previous_blocked_kind: postUnlink.blocked_kind,
            // Argon safety round: same manual-unblock rule as the
            // agent status path above — no freeing blocker.
            freeing_blocker_id: null,
          },
        });
      } else {
        this.emitEvent('kanban.task.updated', {
          actor,
          project_id: postUnlink.project_id,
          payload: {
            id,
            task_id: id,
            lane: postUnlink.lane,
            assignee: postUnlink.assignee,
            change: 'status',
            status: targetStatus,
          },
        });
      }
      this.kbSystemLog(id, `${actor} rescued the task to ${targetStatus} (unlinked ${unlinked.length})`);

      // Fan-out parity with the status handlers: reaching done
      // unblocks dependents, reopening a done task re-blocks them,
      // in this same transaction.
      let rescueFanout: { processed: number; capped: boolean; pending_sweep: boolean } | null = null;
      if (targetStatus === 'done' && postUnlink.status !== 'done') {
        rescueFanout = this.depReevaluateOnDone(id, now);
      } else if (postUnlink.status === 'done' && targetStatus !== 'done') {
        rescueFanout = this.depReblockOnReopen(id, now);
      }

      // Step 3: re-link, each entry validated with the existing
      // link validation (depLinkCheck, in-transaction and
      // authoritative, cycle check included). Already-satisfied
      // (done blocker) and duplicate entries are skipped
      // idempotently — they land in relinked with ok:true and a
      // skipped reason, not in relink_failed. Real validation
      // failures (self, cross-project, cycle, done task, …)
      // land in relink_failed and fail only that link, never the
      // whole rescue.
      const relinked: Array<{ blocker_id: number; ok: boolean; skipped?: string }> = [];
      const relinkFailed: Array<{ blocker_id: number; error: string }> = [];
      for (const blockerId of relink) {
        const cur = depGetTask(this, id)!;
        const blocker = depGetTask(this, blockerId);
        const txErr = depLinkCheck(this, cur, blocker, id, blockerId, actor, opts.isAdmin);
        if (txErr) {
          const errName = txErr.body.error as string;
          if (errName === 'already-satisfied' || errName === 'duplicate link') {
            relinked.push({ blocker_id: blockerId, ok: true, skipped: errName });
          } else {
            relinkFailed.push({ blocker_id: blockerId, error: errName });
          }
          continue;
        }
        // Unreachable after depLinkCheck (it 404s on null
        // task/blocker), kept only so TS narrows below.
        if (!blocker) {
          relinkFailed.push({ blocker_id: blockerId, error: 'task not found' });
          continue;
        }
        depApplyLink(this, cur, blocker, actor, now);
        relinked.push({ blocker_id: blockerId, ok: true });
      }

      const finalRow = depGetTask(this, id)!;
      result = {
        ok: true,
        id,
        status: finalRow.status,
        target_status: targetStatus,
        unlinked,
        relinked,
        relink_failed: relinkFailed,
        ...(rescueFanout ? { dependency_fanout: rescueFanout } : {}),
      };
    });
    return this.json(200, result);
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}
