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
  return { ...row, todos: this.kbTodosFor(row.id) };
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
  const tasks = (
    this.sql
      .exec(`SELECT * FROM tasks WHERE project_id = ? ORDER BY ${this.kbDefaultOrder("tasks")}`, projectId)
      .toArray() as unknown as TaskRecord[]
  ).map((t) => this.kbTaskWithTodos(t));
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
          return this.json(400, { error: "blocked_reason required when status=blocked" });
        }
        const trimmed = payload.blocked_reason.trim();
        if (trimmed.length < 1 || trimmed.length > 280) {
          return this.json(400, { error: "blocked_reason required when status=blocked" });
        }
        finalReason = trimmed;
      } else if (task.blocked_reason && task.blocked_reason.trim()) {
        finalReason = task.blocked_reason.trim();
      } else {
        return this.json(400, { error: "blocked_reason required when status=blocked" });
      }

      updates.push("blocked_kind = ?", "blocked_reason = ?");
      vals.push(kind, finalReason);

      if (!wasBlocked) {
        statusEvent = {
          type: "kanban.task.blocked",
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
      updates.push("blocked_kind = NULL", "blocked_reason = NULL");
      if (wasBlocked) {
        statusEvent = {
          type: "kanban.task.unblocked",
          recipients: finalAssignee ? [finalAssignee] : null,
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
        return this.json(400, { error: "blocked_reason required when status=blocked" });
      }
      const trimmed = payload.blocked_reason.trim();
      if (trimmed.length < 1 || trimmed.length > 280) {
        return this.json(400, { error: "blocked_reason required when status=blocked" });
      }
      finalReason = trimmed;
      updates.push("blocked_reason = ?");
      vals.push(finalReason);
    } else if (!finalReason || !finalReason.trim()) {
      return this.json(400, { error: "blocked_reason required when status=blocked" });
    }
    fieldEvents.push({
      change: "blocked_kind",
      extra: { blocked_kind: finalKind, blocked_reason: finalReason },
    });
  }

  if (updates.length === 0 && !commentBody) {
    return this.json(400, { error: "nothing to update" });
  }

  this.state.storage.transactionSync(() => {
    if (updates.length > 0) {
      updates.push("updated_at = ?", "last_activity_at = ?");
      vals.push(now, now, id);
      this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    } else {
      this.kbTouchTask(id);
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
  return this.json(200, { ok: true, id, ...(wip_warning ? { wip_warning } : {}) });
}

// DELETE /admin/api/kanban/tasks/:id — cascade deletes todos via FK.
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
  this.sql.exec("DELETE FROM tasks WHERE id = ?", id);
  this.emitEvent("kanban.task.deleted", {
    actor: "admin",
    project_id: task.project_id,
    payload: { id, task_id: id, lane: task.lane, assignee: task.assignee },
  });
  return this.json(200, { ok: true, id });
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
  const tasks = (
    this.sql
      .exec(`SELECT * FROM tasks WHERE project_id = ? ORDER BY ${this.kbDefaultOrder("tasks")}`, projectId)
      .toArray() as unknown as TaskRecord[]
  ).map((t) => this.kbTaskWithTodos(t));
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
  if (row.assignee === agent) {
    const wip_warning = this.kbWipWarning(agent);
    return this.json(200, {
      ok: true,
      id,
      assignee: agent,
      status: row.status,
      lane: row.lane,
      already: true,
      ...(wip_warning ? { wip_warning } : {}),
    });
  }

  const now = this.kbNow();
  const agentLane = this.kbAgentLane(agent);
  let claimedLane: TaskLane = row.lane;
  let claimed = false;

  this.state.storage.transactionSync(() => {
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
      id,
      agent,
      agent,
      agentLane
    ) as { rowsWritten?: number };

    if ((res.rowsWritten ?? 0) === 1) {
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
  } else if (row.status !== "todo") {
    reason = "invalid_status";
  } else {
    reason = "wrong_lane";
  }
  return this.json(409, {
    error: "auto_claim_failed",
    reason,
    current: {
      assignee: row.assignee,
      admin_assigned: row.admin_assigned,
      status: row.status,
      lane: row.lane,
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

  this.state.storage.transactionSync(() => {
    this.sql.exec(
      `UPDATE tasks
       SET assignee = NULL, status = ?, status_changed_at = ?, admin_assigned = ?, updated_at = ?, last_activity_at = ?
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

  if (!willBlock) {
    if (
      hasBlockedKindInPayload ||
      (hasBlockedReasonInPayload && String(payload.blocked_reason).trim() !== "")
    ) {
      return this.json(400, { error: "blocked_kind only valid with status=blocked" });
    }
  }

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

      // If auto-claimed, kbAutoClaimOrVerify already transitioned the task to 'doing' and emitted kanban.task.claimed.
      // Per §2A.2: if the triggering write is status='doing', no second status event is emitted.
      if (autoClaimed && status === "doing") {
        return;
      }

      const wasBlocked = !autoClaimed && task.status === "blocked";
      const now = this.kbNow();

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
            throw new TxAbort(400, { error: "blocked_reason required when status=blocked" });
          }
          const trimmed = payload.blocked_reason.trim();
          if (trimmed.length < 1 || trimmed.length > 280) {
            throw new TxAbort(400, { error: "blocked_reason required when status=blocked" });
          }
          finalReason = trimmed;
        } else if (wasBlocked && task.blocked_reason && task.blocked_reason.trim()) {
          finalReason = task.blocked_reason.trim();
        } else {
          throw new TxAbort(400, { error: "blocked_reason required when status=blocked" });
        }

        const newBlockedStatusChangedAt = wasBlocked ? (task.status_changed_at ?? now) : now;
        this.sql.exec(
          `UPDATE tasks
           SET status = 'blocked', blocked_kind = ?, blocked_reason = ?, status_changed_at = ?, updated_at = ?, last_activity_at = ?
           WHERE id = ? AND assignee = ?`,
          kind,
          finalReason,
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
        this.sql.exec(
          `UPDATE tasks
           SET status = ?, blocked_kind = NULL, blocked_reason = NULL, status_changed_at = ?, updated_at = ?, last_activity_at = ?
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
            recipients: [agent],
            payload: {
              id,
              task_id: id,
              lane: task.lane,
              assignee: agent,
              previous_blocked_kind: task.blocked_kind,
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
    });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }

  const wip_warning = status === "doing" ? this.kbWipWarning(agent) : undefined;
  return this.json(200, { ok: true, id, status, ...(wip_warning ? { wip_warning } : {}) });
}
