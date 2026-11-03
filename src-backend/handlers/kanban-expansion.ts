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
  kbHoldRejection,
} from './kanban.js';
import { parseBoolParam } from '../utils.js';

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
  // Amendment batch item 11: ledger_refs paging from detail
  // itself (?ledger_refs_after_id=<id>, strict digits, 'null' =
  // absent); invalid values 400 like every other pager.
  const refsAfterRaw = new URL(req.url).searchParams.get('ledger_refs_after_id');
  let ledgerRefsAfterId: number | null = null;
  if (refsAfterRaw !== null && refsAfterRaw !== 'null') {
    if (!/^\d+$/.test(refsAfterRaw)) return this.json(400, { error: 'invalid ledger_refs_after_id', field: 'ledger_refs_after_id' });
    ledgerRefsAfterId = parseInt(refsAfterRaw, 10);
  }
  // Fix round M2: agent task detail is rate-limited like other agent
  // reads; the check runs after the 404 so invisible tasks do not
  // consume quota (M14).
  // Fix round (re-review GAP 2, #13): agent reads charge the READ bucket.
  if (!this.rlCheckRead(agent)) return this.rlReadLimitedResponse(agent);
  return this.json(200, { task: this.kbTaskDetail(row, { agent, ledgerRefsAfterId }) });
}

// GET /admin/api/kanban/tasks/:id — task detail (admin).
export async function handleKbAdminTaskDetail(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const rows = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray() as unknown as TaskRecord[];
  const row = rows[0];
  if (!row) return this.json(404, { error: "task not found" });
  const refsAfterRaw = new URL(req.url).searchParams.get('ledger_refs_after_id');
  let ledgerRefsAfterId: number | null = null;
  if (refsAfterRaw !== null && refsAfterRaw !== 'null') {
    if (!/^\d+$/.test(refsAfterRaw)) return this.json(400, { error: 'invalid ledger_refs_after_id', field: 'ledger_refs_after_id' });
    ledgerRefsAfterId = parseInt(refsAfterRaw, 10);
  }
  return this.json(200, { task: this.kbTaskDetail(row, { isAdmin: true, ledgerRefsAfterId }) });
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
  // Fix round 4, item 13: agent task update takes a closed field
  // set (ledger-allowlist shape); unknown fields such as
  // `priority` or `status` are 400 with the field named, not
  // silently dropped. Allowed fields are documented in the
  // response contract: general PUT takes title/description/
  // notes/due_date/lane; the convenience routes take only their
  // named field.
  {
    const allowed = onlyField
      ? new Set([onlyField])
      : new Set(["title", "description", "notes", "due_date", "lane"]);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) {
        return this.json(400, {
          error: `field ${key} is not a task update field`,
          field: key,
          allowed: [...allowed],
        });
      }
    }
  }
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
        // Amendment batch item 1 (wave-2 follow-up): a lane
        // handoff reassigns the task, so a held/dissent-held task
        // may not be handed off — 409, no mutation (the throw
        // rolls back the whole transaction).
        const held = kbHoldRejection(this, id);
        if (held) throw new TxAbort(held.code, held.body);
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
  // Fix round 3, M10: report whether this call auto-claimed, like
  // label-add already does — a silent claim looked like a plain edit.
  return this.json(200, { ok: true, id, auto_claimed: autoClaimed, ...(wip ? { wip_warning: wip } : {}) });
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
  // Fix round 5, M5: a REAL cursor — offset-based, because the
  // default sort (due_date, priority, created_at, id) is not
  // id-ordered, so an id cursor cannot page it. ?limit=&offset=
  // pages deterministically over a stable list; under concurrent
  // writes an offset page can shift (documented in SPEC §17.5),
  // which is the standard offset trade-off. The old contract
  // (has_more:true with next_after_id:null and "re-request with
  // a larger limit" that itself capped at 100) made tasks 101+
  // unreachable; that lie is gone.
  const url = new URL(req.url);
  // Amendment batch items 11/23: ?status= / ?exclude_blocked=
  // filters, and a REAL keyset cursor (opaque, over the default
  // sort) as the primary paging mechanism. Offset is kept only
  // as a DEPRECATED fallback: when a cursor is given it wins and
  // offset is ignored; when offset is used without a cursor the
  // response carries pagination_note saying so.
  const statusRaw = url.searchParams.get('status');
  if (statusRaw !== null && statusRaw !== 'todo' && statusRaw !== 'blocked') {
    return this.json(400, { error: 'invalid status', field: 'status', allowed: ['todo', 'blocked'] });
  }
  const excludeBlockedParsed = parseBoolParam(url.searchParams.get('exclude_blocked'));
  if (!excludeBlockedParsed.ok) {
    return this.json(400, { error: 'invalid exclude_blocked', field: 'exclude_blocked', allowed: ['1', 'true', '0', 'false'] });
  }
  if (excludeBlockedParsed.value && statusRaw === 'blocked') {
    return this.json(400, { error: 'exclude_blocked conflicts with status=blocked', field: 'exclude_blocked' });
  }
  const statusClause = statusRaw === 'todo' || excludeBlockedParsed.value
    ? `t.status = 'todo'`
    : statusRaw === 'blocked'
      ? `t.status = 'blocked'`
      : `(t.status = 'todo' OR t.status = 'blocked')`;
  const cursorRaw0 = url.searchParams.get('cursor');
  const cursorRaw = cursorRaw0 === 'null' ? null : cursorRaw0;
  const cursorKey = cursorRaw === null ? null : this.kbDecodeCursor(cursorRaw);
  if (cursorRaw !== null && cursorKey === null) {
    return this.json(400, { error: 'invalid cursor', field: 'cursor' });
  }
  // Fix round 6, (e): unified parsing — the string "null" is
  // absent for limit/offset, like every other pager.
  const limitRaw0 = url.searchParams.get('limit');
  const limitRaw = limitRaw0 === 'null' ? null : limitRaw0;
  if (limitRaw !== null && (!/^\d+$/.test(limitRaw) || parseInt(limitRaw, 10) < 1)) {
    return this.json(400, { error: 'invalid limit', field: 'limit' });
  }
  const limit = limitRaw === null ? null : Math.min(parseInt(limitRaw, 10), 100);
  const offsetRaw0 = url.searchParams.get('offset');
  const offsetRaw = offsetRaw0 === 'null' ? null : offsetRaw0;
  if (offsetRaw !== null && !/^\d+$/.test(offsetRaw)) {
    return this.json(400, { error: 'invalid offset', field: 'offset' });
  }
  const offset = offsetRaw === null ? 0 : parseInt(offsetRaw, 10);
  if (cursorKey === null && offset > 0 && limit === null) {
    return this.json(400, { error: 'limit required when paging with offset', field: 'limit' });
  }
  // Fix round (re-review GAP 2, #13): /available was previously
  // uncharged, not write-charged; per the brief it now charges one
  // READ unit, after all param validation so invalid requests do
  // not consume quota.
  if (!this.rlCheckRead(agent)) return this.rlReadLimitedResponse(agent);
  const tasks = this.sql
    .exec(
      `SELECT t.id, t.project_id, t.title, t.priority, t.lane, t.due_date, t.created_at, t.updated_at,
              t.status, t.blocked_kind, t.blocked_reason, t.blocked_from_status
       FROM tasks t
       WHERE t.assignee IS NULL
         AND (t.admin_assigned IS NULL OR t.admin_assigned = ?)
         AND ${statusClause}
         AND (t.lane = 'unassigned' OR t.lane = ?)
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)
         AND ${this.kbSubscriberPred("t.project_id")}
         ${cursorKey !== null ? `AND ${this.kbKeysetTuple('t')} > (?,?,?,?)` : ``}
       ORDER BY ${this.kbDefaultOrder("t")}${limit !== null ? ` LIMIT ? OFFSET ?` : ``}`,
      agent,
      agentLane,
      agent,
      ...(cursorKey !== null ? this.kbKeysetParams(cursorKey) : []),
      ...(limit !== null ? [limit + 1, cursorKey !== null ? 0 : offset] : [])
    )
    .toArray();
  if (limit === null) return this.json(200, { tasks, has_more: false, next_after_id: null, next_offset: null, next_cursor: null });
  const hasMore = tasks.length > limit;
  const pageTasks = tasks.slice(0, limit);
  const lastTask = pageTasks.length > 0 ? pageTasks[pageTasks.length - 1]! as unknown as Record<string, unknown> : null;
  const nextCursor = hasMore && lastTask ? this.kbEncodeCursor({ d: (lastTask['due_date'] as number | null) ?? null, p: String(lastTask['priority']), c: lastTask['created_at'] as string | number, i: Number(lastTask['id']) }) : null;
  const offsetUsed = cursorKey === null && offset > 0;
  return this.json(200, { tasks: pageTasks, has_more: hasMore, next_after_id: null, next_offset: hasMore && cursorKey === null ? offset + limit : null, next_cursor: nextCursor, ...(offsetUsed ? { pagination_note: 'offset is deprecated; use cursor' } : {}) });
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
  // Fix round 7, (a)/(c): unified boolean spelling ("1" and
  // "true" both true; anything else 400, not a silently wrong
  // filter) and field/allowed on every search filter error.
  const globalParsed = parseBoolParam(url.searchParams.get("global"));
  if (!globalParsed.ok) {
    return this.json(400, { error: "invalid global", field: "global", allowed: ["1", "true", "0", "false"] });
  }
  const global = globalParsed.value;
  const includeArchivedParsed = parseBoolParam(url.searchParams.get("include_archived"));
  if (!includeArchivedParsed.ok) {
    return this.json(400, { error: "invalid include_archived", field: "include_archived", allowed: ["1", "true", "0", "false"] });
  }
  const includeArchived = includeArchivedParsed.value;

  if (global && !isAdmin) return this.json(400, { error: "global search is admin-only", field: "global" });
  if (status && !VALID_STATUSES.includes(status as any)) {
    return this.json(400, { error: "invalid status", field: "status", allowed: [...VALID_STATUSES] });
  }
  if (blockedKind && !VALID_BLOCKED_KINDS.includes(blockedKind as any)) {
    return this.json(400, { error: "invalid blocked_kind", field: "blocked_kind", allowed: [...VALID_BLOCKED_KINDS] });
  }
  if (priority && !VALID_PRIORITIES.includes(priority as TaskPriority)) {
    return this.json(400, { error: "invalid priority", field: "priority", allowed: [...VALID_PRIORITIES] });
  }
  if (lane && !VALID_LANES.includes(lane as TaskLane)) {
    return this.json(400, { error: "invalid lane", field: "lane", allowed: [...VALID_LANES] });
  }
  // Fix round 8, (3): stale joins the unified boolean contract
  // ("1"/"true" true, "0"/"false" false, else 400) instead of
  // accepting only "0"/"1" — previously ?stale=true 400'd on the
  // same endpoint where ?global=true works.
  let stale = false;
  if (staleRaw) {
    const staleParsed = parseBoolParam(staleRaw);
    if (!staleParsed.ok) {
      return this.json(400, { error: "invalid stale", field: "stale", allowed: ["1", "true", "0", "false"] });
    }
    stale = staleParsed.value;
  }
  let dueDateFrom: number | null = null;
  if (dueDateFromRaw) {
    if (!/^-?\d+$/.test(dueDateFromRaw.trim())) {
      return this.json(400, { error: "invalid due_date_from", field: "due_date_from" });
    }
    dueDateFrom = parseInt(dueDateFromRaw.trim(), 10);
  }
  let dueDateTo: number | null = null;
  if (dueDateToRaw) {
    if (!/^-?\d+$/.test(dueDateToRaw.trim())) {
      return this.json(400, { error: "invalid due_date_to", field: "due_date_to" });
    }
    dueDateTo = parseInt(dueDateToRaw.trim(), 10);
  }
  let dueDateFilter: "overdue" | "none" | null = null;
  if (dueDateFilterRaw) {
    if (dueDateFilterRaw !== "overdue" && dueDateFilterRaw !== "none") {
      return this.json(400, { error: "invalid due_date filter", field: "due_date", allowed: ["overdue", "none"] });
    }
    dueDateFilter = dueDateFilterRaw;
  }
  if (sort && sort !== "default" && sort !== "blocked_since") {
    return this.json(400, { error: "invalid sort", field: "sort", allowed: ["default", "blocked_since"] });
  }

  let projectIds: number[] | null = null;
  if (!global) {
    if (!projectId) return this.json(400, { error: "project required", field: "project_id" });
    projectIds = [projectId];
  }
  // Amendment batch item 23: real keyset cursor for the default
  // sort (cursor + sort=blocked_since is 400: that sort has a
  // different key and no cursor contract is defined for it).
  // Offset is kept only as a DEPRECATED fallback: a cursor wins
  // over offset, and offset use is flagged in the response.
  const searchCursorRaw0 = url.searchParams.get('cursor');
  const searchCursorRaw = searchCursorRaw0 === 'null' ? null : searchCursorRaw0;
  const searchCursorKey = searchCursorRaw === null ? null : this.kbDecodeCursor(searchCursorRaw);
  if (searchCursorRaw !== null && searchCursorKey === null) {
    return this.json(400, { error: 'invalid cursor', field: 'cursor' });
  }
  if (searchCursorKey !== null && sort === 'blocked_since') {
    return this.json(400, { error: 'cursor requires the default sort', field: 'cursor' });
  }
  let { where, params, order } = this.kbTaskSearchWhere({
    projectIds,
    q,
    status: status || null,
    assignee: assignee || null,
    label: label || null,
    blocked_kind: blockedKind || null,
    priority: (priority as TaskPriority) || null,
    lane: (lane as TaskLane) || null,
    stale,
    dueDateFrom,
    dueDateTo,
    dueDateFilter,
    sort: sort || null,
    includeArchived: isAdmin && includeArchived,
    subscriberAgent: isAdmin ? null : agent,
  });
  // Fix round 5, M5: same offset-cursor contract as /available
  // (same reason: the sort is not id-ordered). The old response
  // returned has_more:true with next_after_id:null at the 200
  // cap — a dead end presented as a next page. next_offset is
  // the real continuation; offset pages can shift under
  // concurrent writes (SPEC §17.5).
  // Fix round 6, (e): unified parsing — the string "null" is
  // absent for limit/offset, like every other pager.
  const limitRaw0 = url.searchParams.get("limit");
  const limitRaw = limitRaw0 === "null" ? null : limitRaw0;
  if (limitRaw !== null && (!/^\d+$/.test(limitRaw) || parseInt(limitRaw, 10) < 1)) {
    return this.json(400, { error: "invalid limit", field: "limit" });
  }
  const limit = limitRaw === null ? 200 : Math.min(parseInt(limitRaw, 10), 200);
  const offsetRaw0 = url.searchParams.get("offset");
  const offsetRaw = offsetRaw0 === "null" ? null : offsetRaw0;
  if (offsetRaw !== null && !/^\d+$/.test(offsetRaw)) {
    return this.json(400, { error: "invalid offset", field: "offset" });
  }
  const offset = offsetRaw === null ? 0 : parseInt(offsetRaw, 10);
  // Fix round 6, Perf M2: one batched todos query for the whole
  // page (kbTasksWithTodos), not one query per result row.
  if (searchCursorKey !== null) {
    where = `${where} AND ${this.kbKeysetTuple('tasks')} > (?,?,?,?)`;
    params = [...params, ...this.kbKeysetParams(searchCursorKey)];
  }
  const searchOffset = searchCursorKey !== null ? 0 : offset;
  // Fix round (re-review GAP 2, #13): search was previously
  // uncharged, not write-charged; per the brief the agent path now
  // charges one READ unit, after all param validation so invalid
  // requests do not consume quota. Admin path stays exempt.
  if (!isAdmin && agent !== null && !this.rlCheckRead(agent)) return this.rlReadLimitedResponse(agent);
  const fetched = this.kbTasksWithTodos(
    this.sql
      .exec(`SELECT tasks.* FROM tasks WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit + 1, searchOffset)
      .toArray() as unknown as TaskRecord[]
  );
  const hasMore = fetched.length > limit;
  const searchPage = fetched.slice(0, limit);
  const searchLast = searchPage.length > 0 ? searchPage[searchPage.length - 1]! as unknown as Record<string, unknown> : null;
  const searchNextCursor = hasMore && searchLast ? this.kbEncodeCursor({ d: (searchLast['due_date'] as number | null) ?? null, p: String(searchLast['priority']), c: searchLast['created_at'] as string | number, i: Number(searchLast['id']) }) : null;
  const searchOffsetUsed = searchCursorKey === null && offset > 0;
  return this.json(200, { tasks: searchPage, has_more: hasMore, next_after_id: null, next_offset: hasMore && searchCursorKey === null ? offset + limit : null, next_cursor: searchNextCursor, ...(searchOffsetUsed ? { pagination_note: 'offset is deprecated; use cursor' } : {}) });
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
  // Fix round minor: report whether this call auto-claimed the task.
  return this.json(200, { ok: true, auto_claimed: autoClaimed, ...(wip ? { wip_warning: wip } : {}) });
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
  // Revamp v12 §6: unlink does NOT auto-claim and does NOT change
  // status. It requires the task owner or admin; a non-owner,
  // non-admin attempt is 403, and an unassigned task cannot be
  // unlinked by a non-admin because it has no owner to verify.
  // Archived projects reject label unlink with 403 project archived.
  const rows = this.sql
    .exec(
      `SELECT t.assignee, p.archived AS project_archived FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
      taskId
    )
    .toArray() as Array<{ assignee: string | null; project_archived: number }>;
  const task = rows[0];
  if (!task) return this.json(404, { error: "task not found" });
  if (task.project_archived) return this.json(403, { error: "project archived" });
  if (task.assignee === null || task.assignee !== agent) {
    return this.json(403, { error: "forbidden: label unlink requires the task owner or admin" });
  }
  const r = this.kbLabelOp(taskId, label, "remove", agent);
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true });
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
  // Revamp v12 §6: soft-deleted comments are excluded from the default
  // list; admin lists them via ?include_deleted=true, with deleted fields.
  // Fix round minor: a non-admin asking for deleted comments gets an
  // explicit 403 instead of a silently filtered list.
  const includeDeletedParam = new URL(req.url).searchParams.get('include_deleted');
  // Fix round 7, (a): unified boolean spelling — previously only
  // "true" counted, so a non-admin ?include_deleted=1 silently
  // skipped the 403 that "true" triggers, and an admin
  // ?include_deleted=1 silently listed non-deleted only.
  const includeDeletedParsed = parseBoolParam(includeDeletedParam);
  if (!includeDeletedParsed.ok) {
    return this.json(400, { error: 'invalid include_deleted', field: 'include_deleted', allowed: ['1', 'true', '0', 'false'] });
  }
  if (!isAdmin && includeDeletedParsed.value) {
    return this.json(403, { error: 'include_deleted is admin-only' });
  }
  const includeDeleted =
    isAdmin && includeDeletedParsed.value;
  // Fix round 4, item 9: optional limit (clamp 100) + id cursor,
  // matching the unblocked/ledger pagers. Without params the
  // full list is returned as before.
  const commentUrl = new URL(req.url);
  // Fix round 5, M12: strict limit parsing (400, not silent
  // coercion), and after_id without a limit is 400 — previously
  // it was silently ignored, so a caller paging comments without
  // a limit got the full list repeatedly.
  // Fix round 6, (e): unified cursor parsing — the string
  // "null" is absent for limit and cursor alike, and after_id
  // is strict digits (12abc/12.9 no longer coerce via parseInt),
  // like every other pager. Comments keep the bare id > filter
  // (append-only log: a stale id means "caught up", see SPEC).
  const commentLimitRaw0 = commentUrl.searchParams.get('limit');
  const commentLimitRaw = commentLimitRaw0 === 'null' ? null : commentLimitRaw0;
  if (commentLimitRaw !== null && (!/^\d+$/.test(commentLimitRaw) || parseInt(commentLimitRaw, 10) < 1)) {
    return this.json(400, { error: 'invalid limit', field: 'limit' });
  }
  const commentLimit = commentLimitRaw === null ? null : Math.min(parseInt(commentLimitRaw, 10), 100);
  const commentAfterRaw0 = commentUrl.searchParams.get('after_id');
  const commentAfterRaw = commentAfterRaw0 === 'null' ? null : commentAfterRaw0;
  if (commentAfterRaw !== null && commentLimitRaw === null) {
    return this.json(400, { error: 'limit required when paging with after_id', field: 'limit' });
  }
  const commentAfterId = commentAfterRaw === null ? 0 : /^\d+$/.test(commentAfterRaw) ? parseInt(commentAfterRaw, 10) : -1;
  if (commentAfterId < 0) {
    return this.json(400, { error: 'invalid after_id', field: 'after_id' });
  }
  const commentWhere = includeDeleted
    ? `task_id = ?`
    : `task_id = ? AND (deleted IS NULL OR deleted = 0)`;
  const commentCols = includeDeleted
    ? `id, author, body, ts, deleted, deleted_by, deleted_reason, deleted_at`
    : `id, author, body, ts`;
  const fetchedComments = this.sql
    .exec(
      commentLimit === null
        ? `SELECT ${commentCols} FROM task_comments WHERE ${commentWhere} ORDER BY ts ASC, id ASC`
        : `SELECT ${commentCols} FROM task_comments WHERE ${commentWhere} AND id > ? ORDER BY ts ASC, id ASC LIMIT ?`,
      taskId,
      ...(commentLimit === null ? [] : [commentAfterId, commentLimit + 1])
    )
    .toArray() as unknown as TaskCommentRecord[];
  if (commentLimit === null) {
    return this.json(200, { comments: fetchedComments, has_more: false, next_after_id: null });
  }
  const commentHasMore = fetchedComments.length > commentLimit;
  const comments = fetchedComments.slice(0, commentLimit);
  return this.json(200, {
    comments,
    has_more: commentHasMore,
    next_after_id: commentHasMore && comments.length ? (comments[comments.length - 1] as unknown as { id: number }).id : null,
  });
}

// POST /admin/api/kanban/tasks/:id/comments/:comment_id/soft-delete —
// revamp v12 §6, admin Basic only. Sets the deleted flag, actor,
// reason, and timestamp; never hard-deletes. Reason required.
export async function handleKbCommentSoftDelete(
  this: IBusDO,
  req: Request,
  taskId: number,
  commentId: number
): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: 'invalid json' });
  }
  const payload = data as Record<string, unknown> | null;
  const reason = payload?.reason;
  if (typeof reason !== 'string' || !reason.trim()) {
    return this.json(400, { error: 'reason required' });
  }
  const rows = this.sql
    .exec(`SELECT id, deleted FROM task_comments WHERE id = ? AND task_id = ?`, commentId, taskId)
    .toArray() as Array<{ id: number; deleted: number | null }>;
  if (rows.length === 0) return this.json(404, { error: 'comment not found' });
  // Fix round minor: soft-delete is one-way, no restore endpoint, so
  // re-deleting an already-deleted comment is 409, not a silent 200.
  if (rows[0]!.deleted) return this.json(409, { error: 'already_deleted' });
  const adminUser = this.kbBasicUser(req) || 'admin';
  const now = this.kbNow();
  this.sql.exec(
    `UPDATE task_comments SET deleted = 1, deleted_by = ?, deleted_reason = ?, deleted_at = ? WHERE id = ?`,
    adminUser,
    reason.trim(),
    now,
    commentId
  );
  return this.json(200, { ok: true, id: commentId });
}

// POST .../comments/:comment_id/restore — amendment batch item
// 22. Restores a soft-deleted comment: clears the deleted flag
// (so comment_count, which counts non-system non-deleted rows,
// counts it again — no separate recount is needed), and writes
// an audit trail entry: a system log row naming the restorer
// (its ts column is the restore time) plus a
// kanban.comment.restored poll event. Permission: admin Basic,
// or the comment's own author via Bearer (matching the
// existing permission shape: admin can soft-delete, authors
// own their comments). Not-deleted -> 409; missing -> 404.
export async function handleKbCommentRestore(
  this: IBusDO,
  req: Request,
  taskId: number,
  commentId: number,
  { isAdmin, agent }: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let actor: string;
  if (isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    actor = this.kbBasicUser(req) || 'admin';
  } else {
    const a = this.authedAgent(req);
    if (!a) {
      try { await req.text(); } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
    actor = a;
  }
  const rows = this.sql
    .exec(`SELECT c.id, c.author, c.deleted, t.project_id FROM task_comments c JOIN tasks t ON t.id = c.task_id WHERE c.id = ? AND c.task_id = ?`, commentId, taskId)
    .toArray() as Array<{ id: number; author: string; deleted: number | null; project_id: number }>;
  if (rows.length === 0) return this.json(404, { error: 'comment not found' });
  const comment = rows[0]!;
  if (!isAdmin && comment.author !== actor) return this.json(403, { error: 'only the comment author or admin can restore' });
  if (!comment.deleted) return this.json(409, { error: 'not_deleted' });
  this.sql.exec(
    `UPDATE task_comments SET deleted = 0, deleted_by = NULL, deleted_reason = NULL, deleted_at = NULL WHERE id = ?`,
    commentId
  );
  this.kbSystemLog(taskId, `comment restored: id=${commentId} by ${actor}`);
  this.emitEvent('kanban.comment.restored', {
    actor,
    project_id: comment.project_id,
    payload: { id: commentId, task_id: taskId, restored_by: actor },
  });
  return this.json(200, { ok: true, id: commentId, restored_by: actor });
}

// GET /api/kanban/sweep-health — amendment batch item 25,
// caller-visible surface. Any authed agent may read it (it
// exposes only counts and the convergence bound, no task
// content). Admin stats carries the same object.
export async function handleKbAgentSweepHealth(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try { await req.text(); } catch {}
    return this.json(401, { error: 'unauthorized' });
  }
  // Fix round (re-review GAP 2, #13): agent reads charge the READ bucket.
  if (!this.rlCheckRead(agent)) return this.rlReadLimitedResponse(agent);
  return this.json(200, { sweep: this.kbSweepVisibility() });
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
    if (!projectId) return this.json(400, { error: "project required", field: "project_id" });
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
    const projParamRaw = (url.searchParams.get("project_id") || "").trim();
    // Fix round 8, (9): the string "null" is absent for
    // project_id too (previously it 400'd here while unblocked
    // project_id=null was absent) — an echoed JSON null must not
    // 400 a pager that treats null as absent everywhere else.
    const projParam = projParamRaw === "null" ? "" : projParamRaw;
    if (projectId !== null) {
      conds.push(`t.project_id = ?`);
      params.push(projectId);
    } else if (projParam) {
      if (!/^\d+$/.test(projParam.trim())) {
        return this.json(400, { error: "invalid project_id", field: "project_id" });
      }
      conds.push(`t.project_id = ?`);
      params.push(parseInt(projParam.trim(), 10));
    }
  }

  const agentFilter = (url.searchParams.get("agent") || "").trim();
  if (agentFilter) {
    // §2B.1 locked: matches agent=X if task assignee = X OR comment author = X.
    // Free-text filter (like search assignee): no existence check,
    // so there is no agent error to carry a field/allowed pair.
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
      return this.json(400, { error: "invalid lane", field: "lane", allowed: [...VALID_LANES] });
    }
    conds.push(`t.lane = ?`);
    params.push(laneFilter);
  }

  // Fix round 8, (9): the string "null" is absent for before
  // too (previously before=null 400'd while limit=null in this
  // same handler was absent) — one handler, one "null" rule.
  const beforeRaw0 = (url.searchParams.get("before") || "").trim();
  const beforeRaw = beforeRaw0 === "null" ? "" : beforeRaw0;
  if (beforeRaw) {
    if (!/^\d+$/.test(beforeRaw)) {
      return this.json(400, { error: "invalid before", field: "before" });
    }
    conds.push(`tc.id < ?`);
    params.push(parseInt(beforeRaw, 10));
  }

  // Fix round 7, cheap: activity joins the unified pager contract —
  // the string "null" is absent for limit (previously it 400'd
  // while every other pager treated it as absent).
  let limit = 50;
  const limitRaw = (url.searchParams.get("limit") || "").trim();
  if (limitRaw && limitRaw !== "null") {
    if (!/^\d+$/.test(limitRaw)) {
      return this.json(400, { error: "invalid limit", field: "limit" });
    }
    const parsed = parseInt(limitRaw, 10);
    if (parsed < 1) return this.json(400, { error: "invalid limit", field: "limit" });
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

  // Fix round 8, (2): the include_archived spelling is validated
  // for EVERY branch, not only the admin no-project branch where
  // the value is consumed. Previously a garbage value with an
  // explicit project_id (admin query param or non-admin path
  // project) was silently ignored and returned 200, while the
  // same value without a project returned 400. The parsed value
  // is still consumed only by the admin no-project branch below;
  // the parse here exists so a garbage value 400s regardless of
  // branch.
  const includeArchivedParsed = parseBoolParam(url.searchParams.get("include_archived"));
  if (!includeArchivedParsed.ok) {
    return this.json(400, { error: "invalid include_archived", field: "include_archived", allowed: ["1", "true", "0", "false"] });
  }

  if (!isAdmin) {
    if (!projectId) return this.json(400, { error: "project required", field: "project_id" });
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
        return this.json(400, { error: "invalid project_id", field: "project_id" });
      }
      targetProjectId = parseInt(projParam, 10);
    }
    if (targetProjectId !== null) {
      const exists = this.sql.exec(`SELECT 1 FROM projects WHERE id = ?`, targetProjectId).toArray();
      if (!exists.length) return this.json(404, { error: "project not found" });
      conds.push(`tasks.project_id = ?`);
      params.push(targetProjectId);
    } else {
      // Fix round 7, (a): unified boolean spelling for
      // include_archived ("1" and "true" both true; else 400).
      // Fix round 8, (2): the parse itself is hoisted above the
      // branches, so this branch only consumes the value.
      const includeArchived = includeArchivedParsed.value;
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
