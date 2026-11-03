// Task dependencies — agent-bus revamp plan v12 §4.
// All helpers assume the caller is inside bus.state.storage.transactionSync()
// unless the handler wraps them itself. SQL "BEGIN"/"COMMIT" are forbidden
// inside SqlStorage; transactionSync is the atomicity primitive.
//
// Fan-out cap (fix round M4): every fan-out loop below processes at most
// DEP_FANOUT_CAP dependents per request. The remainder is NOT lost: the
// hourly DO alarm sweep (index.ts alarm()) re-runs depReevaluateProject
// over every non-archived project, and both passes are idempotent
// (processed rows leave the pass's input set: unblocked rows are no
// longer blocked, re-blocked rows are no longer todo/doing), so a
// capped remainder converges on the next sweep instead of starving.
import type { IBusDO, TaskRecord, TaskStatus } from '../types.js';
import { TxAbort } from './kanban.js';

export interface DepTaskRow extends TaskRecord {
  project_archived: number;
}

// Max dependents processed by one fan-out call (done/reopen/unarchive/
// delete cascades). See the header note for the sweep that covers the
// remainder.
export const DEP_FANOUT_CAP = 100;

// Max candidates examined by one fan-out call (fix round 3, M3).
// Pages are fetched by keyset (stable under status changes, which
// never change ids), so no unbounded candidate list is ever loaded.
// Processed rows leave the pass's input set, so a capped remainder
// converges via the hourly alarm sweep; skipped rows (archived,
// wrong status) need no processing.
export const DEP_CANDIDATE_BUDGET = 500;
// Fix round 6, Perf M3: bound on the project edge set a single cycle
// check may load. A graph larger than this fails closed (see
// depHasCycle); at bus scale (single-digit tasks) it never triggers.
export const DEP_CYCLE_EDGE_CAP = 1000;

// Max projects the hourly alarm sweep re-evaluates per sweep
// (fix round 2, item 7): each project pass is already capped at
// DEP_FANOUT_CAP per pass (unblock + reblock), so one sweep costs
// at most 20 projects x 200 row-passes. The alarm rotates its
// window by hour (see index.ts), so a project beyond the cap is
// reached on a later sweep, never starved by a fixed first-N cut.
export const DEP_SWEEP_PROJECT_CAP = 20;

// Amendment batch item 17 — sweep threshold (named constants, not
// magic inline). Below threshold the hourly alarm sweep runs a
// single pass: it visits ALL open projects in one sweep (no
// 20-project rotation window) and lifts the 500-candidate budget
// in depReevaluateProject's passes. Above threshold the existing
// capped machinery applies (rotation window + candidate budget).
// The per-pass processed cap (DEP_FANOUT_CAP) is intentionally NOT
// lifted even below threshold: it bounds one transaction's size,
// and any remainder converges on the next sweep. SPEC §17.11
// documents this precisely.
export const SWEEP_SINGLE_PASS_MAX_PROJECTS = 20;
export const SWEEP_SINGLE_PASS_MAX_TASKS = 500;

// Shared link validation, used BOTH as a pre-transaction check
// (before the rate check, so a semantic 404/403/409 does not
// consume quota — fix round 2, item 3) and again inside the
// transaction (the authoritative check, guarding races).
// Amendment batch item 12: exported so the atomic rescue
// endpoint (handlers/kanban.ts) validates re-links with the exact
// same check as POST dependencies, instead of a second copy.
export function depLinkCheck(
  bus: IBusDO,
  task: DepTaskRow | null,
  blocker: DepTaskRow | null,
  id: number,
  blockerId: number,
  actor: string,
  isAdmin: boolean,
  opts?: { skipCycle?: boolean }
): { code: number; body: Record<string, unknown> } | null {
  if (!task) return { code: 404, body: { error: 'task not found', field: 'task_id' } };
  if (!blocker) return { code: 404, body: { error: 'task not found', field: 'blocker_id' } };
  // Fix round 3, M5: one subscriber query per project per check, not
  // one per task — task and blocker almost always share a project.
  const subCache = new Map<number, boolean>();
  const isSubscribed = (projectId: number): boolean => {
    if (!subCache.has(projectId)) {
      subCache.set(
        projectId,
        bus.sql
          .exec(
            `SELECT 1 FROM projects WHERE id = ? AND ${bus.kbSubscriberPred('projects.id')}`,
            projectId,
            actor
          )
          .toArray().length > 0
      );
    }
    return subCache.get(projectId)!;
  };
  if (!isAdmin && task.assignee !== actor && !isSubscribed(task.project_id)) {
    return { code: 404, body: { error: 'task not found', field: 'task_id' } };
  }
  if (!isAdmin && blocker.assignee !== actor && !isSubscribed(blocker.project_id)) {
    return { code: 404, body: { error: 'task not found', field: 'blocker_id' } };
  }
  if (!isAdmin && task.assignee !== null && task.assignee !== actor) {
    return { code: 403, body: { error: 'forbidden: task owned by another agent' } };
  }
  // Fix round 7, (e): link errors carry the field/hint that
  // not-found link errors already carried — previously self,
  // cross-project, done-task, already-satisfied, and duplicate
  // returned bare error strings, and an already-satisfied caller
  // got no hint that the link was never stored.
  if (blockerId === id) return { code: 400, body: { error: 'self-link not allowed', field: 'blocker_id', hint: 'a task cannot depend on itself' } };
  if (task.project_id !== blocker.project_id) {
    return { code: 400, body: { error: 'cross-project dependency not allowed', field: 'blocker_id', hint: 'link only tasks in the same project' } };
  }
  if (task.project_archived) {
    return { code: 400, body: { error: 'project archived', field: 'project_id', hint: 'unarchive the project first' } };
  }
  if (task.status === 'done') return { code: 400, body: { error: 'cannot link a done task', field: 'task_id', hint: 'a done task cannot gain a dependency; reopen it first' } };
  if (blocker.status === 'done') return { code: 409, body: { error: 'already-satisfied', field: 'blocker_id', hint: 'the blocker is already done, so no link was stored and nothing needs unlinking' } };
  const existing = bus.sql
    .exec(`SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?`, blockerId, id)
    .toArray();
  if (existing.length > 0) return { code: 409, body: { error: 'duplicate link', field: 'blocker_id', hint: 'the link already exists; re-list dependencies to confirm' } };
  // Fix round 3, M5: the cycle check is skipped by the pre-
  // transaction call (handleDepLink passes skipCycle) and runs only
  // in-transaction, where it is authoritative. Trade-off, stated
  // plainly: a pure cycle 409 now consumes quota, where other
  // semantic failures stay quota-exempt; the cycle load was the
  // expensive whole-graph query being deduplicated.
  if (!opts?.skipCycle) {
    const cyc = depHasCycle(bus, blockerId, id, task.project_id);
    if (cyc.cycle) {
    // Fix round 4, item 8: the 409 names the closing path
    // (blockedId -> ... -> blockerId) when BFS found one, or the
    // depth-cap fail-closed case when it did not. The cycle check
    // still runs only in-transaction (quota-consuming), because
    // the whole-graph load is the expensive query the pre-check
    // deliberately skips — documented, not hidden.
    return {
      code: 409,
      body: {
        error: 'cycle detected',
        field: 'blocker_id',
        cycle_path: cyc.path.length > 0 ? cyc.path : undefined,
        // Fix round 7, (h): the fail-closed cause is named, not
        // collapsed into the depth-cap hint.
        cycle_cause: cyc.path.length > 0 ? undefined : cyc.cause,
        hint:
          cyc.path.length > 0
            ? `linking ${blockerId} -> ${id} closes a cycle via ${cyc.path.join(' -> ')}; unlink one edge on that path first`
            : cyc.cause === 'edge_cap'
              ? 'cycle check hit the 1000-edge graph cap and failed closed; the graph is too large to prove acyclic cheaply'
              : 'cycle check hit the 100-edge depth cap and failed closed; the graph is too deep to prove acyclic cheaply',
      },
    };
    }
  }
  return null;
}

export function depNow(bus: IBusDO): number {
  return bus.kbNow();
}

export function depGetTask(bus: IBusDO, id: number): DepTaskRow | null {
  const rows = bus.sql
    .exec(
      `SELECT t.*, p.archived AS project_archived FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
      id
    )
    .toArray() as unknown as DepTaskRow[];
  return rows[0] || null;
}

export function depUnfinishedBlockers(
  bus: IBusDO,
  blockedId: number
): Array<{ blocker_id: number; title: string; status: string }> {
  return bus.sql
    .exec(
      `SELECT d.blocker_id, t.title, t.status FROM task_dependencies d
       JOIN tasks t ON t.id = d.blocker_id
       WHERE d.blocked_id = ? AND t.status != 'done' ORDER BY d.blocker_id ASC`,
      blockedId
    )
    .toArray() as Array<{ blocker_id: number; title: string; status: string }>;
}

export function depIsDependencyBlocked(bus: IBusDO, task: TaskRecord): boolean {
  if (task.status !== 'blocked') return false;
  return depUnfinishedBlockers(bus, task.id).length > 0;
}

export function depServerReason(blocker: { id: number; title: string }): string {
  return `Waiting for task ${blocker.id}: ${blocker.title}`.slice(0, 500);
}

// Fix round 5, M14: every unfinished blocker is prefixed, not just
// the first — `Waiting for task 3: A; Waiting for task 5: B`.
// Single-blocker rows keep the plan's shape, so old assertions hold.
export function depMultiReason(blockers: Array<{ id: number; title: string }>): string {
  return blockers.map((b) => `Waiting for task ${b.id}: ${b.title}`).join('; ').slice(0, 500);
}

// Fix round 5, M6: refresh a dependency-blocked row's reason to the
// CURRENT unfinished set. Called on link (rows 1a/2), unlink, and
// completion-with-remaining-blockers — previously only re-block
// refreshed, so a reason could name a done blocker while another
// still blocked the task. No-op unless the row is blocked
// waiting-task with machine ownership and unfinished links remain.
// Fix round 8, (12): the orphan case is the ONE deliberate
// exception inside this guard, not a second ad-hoc UPDATE site.
// Fix round 9, (1): the unlink unfinished>0 branch also routes
// here now (previously a direct depMultiReason write that clobbered
// manual rows' human reasons); the guard's manual-row no-op is what
// protects them.
// A blocked waiting-task row with no blocked_from_status and no
// unfinished links (manual/legacy orphan) gets honest orphan text
// via opts.orphan — every other caller passes no opts, so the
// guard's human-reason protection (manual rows keep their reason
// on link/reopen/delete/completion) is untouched.
export function depRefreshReason(bus: IBusDO, taskId: number, opts?: { orphan?: boolean }): void {
  const task = depGetTask(bus, taskId);
  if (!task || task.status !== 'blocked' || task.blocked_kind !== 'waiting-task') return;
  const unfinished = depUnfinishedBlockers(bus, taskId);
  if (unfinished.length > 0) {
    if (task.blocked_from_status !== 'todo' && task.blocked_from_status !== 'doing') return;
    const reason = depMultiReason(unfinished.map((b) => ({ id: b.blocker_id, title: b.title })));
    if (reason !== task.blocked_reason) {
      bus.sql.exec(`UPDATE tasks SET blocked_reason = ? WHERE id = ?`, reason, taskId);
    }
    return;
  }
  if (opts?.orphan && task.blocked_from_status !== 'todo' && task.blocked_from_status !== 'doing') {
    const orphanReason = 'blocked with no unfinished links (orphan: manually move the task to todo/doing; see the system log for the skipped-unblock signal)';
    if (orphanReason !== task.blocked_reason) {
      bus.sql.exec(`UPDATE tasks SET blocked_reason = ? WHERE id = ?`, orphanReason, taskId);
    }
  }
}

// Fix round 5, M9: dependency poll events name project subscribers
// (plus the assignee) as recipients, broadcast-consistent with manual
// events. The poll subscriber clause already reaches subscribers, but
// an assignee-only recipient list hid the transition from clients
// that filter on recipients, and a deregistered assignee alone was a
// dead name. Open projects (no subscriber list) keep recipients null
// (broadcast); that leaks nothing, because an open project is
// readable by every registered agent by definition.
export function depEventRecipients(bus: IBusDO, projectId: number, assignee: string | null): string[] | null {
  let subs: string[] = [];
  try { subs = bus.kbProjectSubscribers(projectId) || []; } catch { subs = []; }
  if (subs.length === 0) return assignee ? [assignee] : null;
  const out = [...subs];
  if (assignee && !out.includes(assignee)) out.push(assignee);
  return out;
}

// Fix round 5, M2: a stuck episode is keyed by (last status change,
// dependency-event count for the task). The old key — status change
// alone — missed link-cycle episodes (link/unlink do not update
// status_changed_at) and same-second re-blocks (same-second
// timestamps collide). Every link/unlink/reblock/unblock writes a
// dependency_events row, so the count moves on every episode change
// while staying stable within one episode (dedup preserved).
export function depStuckEpisode(bus: IBusDO, task: TaskRecord): string {
  const n = bus.sql.exec(`SELECT COUNT(*) AS c FROM dependency_events WHERE blocked_id = ?`, task.id).toArray() as Array<{ c: number }>;
  return `${task.status_changed_at ?? 0}:${n[0]?.c ?? 0}`;
}
function depStuckAlreadyLogged(bus: IBusDO, taskId: number, prefix: string, episode: string): boolean {
  const rows = bus.sql.exec(
    `SELECT body FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE ? ORDER BY id DESC LIMIT 1`,
    taskId, `${prefix}%`
  ).toArray() as Array<{ body: string }>;
  const m = rows[0]?.body.match(/episode:([^\s]+)/);
  return !!m && m[1] === episode;
}

export function depWriteEvent(
  bus: IBusDO,
  blockerId: number | null,
  blockedId: number,
  actor: string,
  action: 'link' | 'unlink' | 'reblock' | 'unblock',
  reason: string | null,
  now: number
): void {
  bus.sql.exec(
    `INSERT INTO dependency_events (blocker_id, blocked_id, actor, action, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    blockerId,
    blockedId,
    actor,
    action,
    reason,
    now
  );
}

export interface DepEventInput {
  blockerId: number | null;
  blockedId: number;
  actor: string;
  action: 'link' | 'unlink' | 'reblock' | 'unblock';
  reason: string | null;
  now: number;
}

// Batched version of depWriteEvent (fix round M4): one multi-row
// INSERT per chunk. Chunked at 16 events (96 bound parameters) to stay
// under the 100-bound-parameter SQL statement limit. Order is
// preserved: events are inserted in collection order.
export function depWriteEvents(bus: IBusDO, events: DepEventInput[]): void {
  for (let i = 0; i < events.length; i += 16) {
    const chunk = events.slice(i, i + 16);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params: (number | string | null)[] = [];
    for (const e of chunk) {
      params.push(e.blockerId, e.blockedId, e.actor, e.action, e.reason, e.now);
    }
    bus.sql.exec(
      `INSERT INTO dependency_events (blocker_id, blocked_id, actor, action, reason, created_at) VALUES ${placeholders}`,
      ...params
    );
  }
}

// Cycle check (§4.2): for edge blocker B -> blocked D, a cycle exists iff
// there is already a path D -> ... -> B following blocker-to-blocked edges.
// Fix round: edges are loaded ONCE into memory (one query) instead of
// one query per visited node, and reachability is a breadth-first
// search (BFS) over the in-memory adjacency map.
// Fix round 6, Perf M3: that one query is BOUNDED (LIMIT cap+1). The
// old code loaded the entire project edge set per link — an
// un-LIMITed query, a full adjacency map, O(E) per link,
// in-transaction. A graph larger than DEP_CYCLE_EDGE_CAP fails
// closed (cycle:true, empty path), the same fail-closed philosophy
// as the 100-edge depth cap: a truncated edge set cannot prove
// acyclicity, so the link is rejected rather than admitted.
export function depHasCycle(bus: IBusDO, blockerId: number, blockedId: number, projectId?: number): { cycle: boolean; path: number[]; cause?: 'depth_cap' | 'edge_cap' } {
  // Fix round 3, M5: edges are scoped to the link's project (links
  // are intra-project by rule, so the scoped graph has the same
  // reachability as the whole table) and the cap is the plan's
  // 100 stack depth, failing closed — a path longer than 100 edges
  // without reaching the blocker is treated as cyclic rather than
  // admitted. The old 500-visited-node cap is dropped: the visited
  // set is bounded by the scoped graph already loaded in memory.
  const edges = (
    projectId !== undefined
      ? bus.sql.exec(
          `SELECT d.blocker_id, d.blocked_id FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_id WHERE t.project_id = ? LIMIT ?`,
          projectId,
          DEP_CYCLE_EDGE_CAP + 1
        )
      : bus.sql.exec(`SELECT blocker_id, blocked_id FROM task_dependencies LIMIT ?`, DEP_CYCLE_EDGE_CAP + 1)
  ).toArray() as Array<{ blocker_id: number; blocked_id: number }>;
  // Fix round 7, (h): the two fail-closed causes are
  // distinguished in the return value — previously both rendered
  // with the "100-edge depth cap" hint, so a 1001-edge acyclic
  // graph was misdiagnosed as a depth-cap hit.
  // Fix round 8, (11): the edge cap is checked AFTER the BFS, not
  // before it. Truncation can only hide a path, never fabricate
  // one — every loaded edge is a real edge — so a closing path
  // found in the truncated set is a real cycle and is reported
  // with the path, even on a >1000-edge graph. Only when no path
  // is found does the cap fail closed (edge_cap), because a
  // truncated set cannot prove acyclicity.
  const adj = new Map<number, number[]>();
  for (const e of edges) {
    const list = adj.get(e.blocker_id) || [];
    list.push(e.blocked_id);
    adj.set(e.blocker_id, list);
  }
  // Fix round 4, item 13: breadth-first, not depth-first. A DFS
  // that pops a node first reached via a >100-edge detour rejects
  // even when a <=100-edge path exists, because the detour's pop
  // trips the depth cap before the short path is explored. BFS
  // explores strictly by path length, so a cycle reachable within
  // 100 edges is always found before any >100-edge path can trip
  // the fail-closed cap; exhausting depth 100 without reaching
  // the blocker still fails closed. The returned path (for the
  // 409 hint) is the shortest cycle-closing path found.
  const visited = new Set<number>([blockedId]);
  const queue: Array<{ node: number; depth: number; path: number[] }> = [{ node: blockedId, depth: 0, path: [blockedId] }];
  let foundPath: number[] | null = null;
  let truncated = false;
  // Fix round 5 minor: index pointer instead of queue.shift()
  // (O(n) per pop) and path arrays are still copied per edge —
  // bounded by the 100-edge depth cap, so copies stay cheap.
  for (let qi = 0; qi < queue.length && !foundPath; qi++) {
    const { node, depth, path } = queue[qi]!;
    if (node === blockerId) {
      foundPath = path;
      break;
    }
    if (depth >= 100) {
      // Depth cap reached with unexplored edges: fail closed, as
      // before — a longer cycle cannot be ruled out cheaply.
      if ((adj.get(node) || []).length > 0) truncated = true;
      continue;
    }
    for (const next of adj.get(node) || []) {
      if (next === blockerId) {
        foundPath = [...path, next];
        break;
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ node: next, depth: depth + 1, path: [...path, next] });
      }
    }
  }
  if (foundPath) return { cycle: true, path: foundPath };
  if (edges.length > DEP_CYCLE_EDGE_CAP) return { cycle: true, path: [], cause: 'edge_cap' };
  if (truncated) return { cycle: true, path: [], cause: 'depth_cap' };
  return { cycle: false, path: [] };
}

// Fix round 5, M13: the cycle path is threaded through depHasCycle's
// return value, not module-global state. The old module-level
// depLastCyclePath was correct under DO single-threading but shared
// across requests and fragile; no caller may inherit a stale path now.

// Paginated candidate iteration helpers (fix round 3, M3). Each
// yields candidates in keyset pages of DEP_FANOUT_CAP and stops
// after DEP_CANDIDATE_BUDGET examined candidates, so a fan-out call
// never loads or walks an unbounded list. The callback returns
// false to stop early (processed cap reached).
// Fix round 5, M1: iterators return whether unexamined candidates
// remain. The old void return let callbacks lie: a callback returning
// processed<CAP stopped the iterator, and the processed>=CAP branch
// that would have set capped=true was never re-entered, so 101
// dependents reported {processed:100, capped:false}. Now a stop
// mid-page reports more=true from the rest of the page, and budget
// exhaustion reports more=true from a one-row probe past the last
// examined id — callers can no longer report a clean finish while
// candidates wait.
// Fix round 5 minor (examined-vs-processed gap): the iterator
// carries a narrow status projection (status/kind/archived) from
// a JOIN, so callers can skip non-matching candidates WITHOUT a
// second full-row depGetTask per candidate. Full rows are still
// fetched only for candidates that pass the filter.
export interface DepLite { status: string; blocked_kind: string | null; project_archived: number; }
function depEachDependent(bus: IBusDO, blockerId: number, fn: (blockedId: number, lite: DepLite | null) => boolean): { more: boolean } {
  let last = 0;
  let examined = 0;
  const hasNext = (after: number): boolean =>
    bus.sql.exec(`SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id > ? LIMIT 1`, blockerId, after).toArray().length > 0;
  while (examined < DEP_CANDIDATE_BUDGET) {
    const page = bus.sql
      .exec(
        `SELECT d.blocked_id, t.status, t.blocked_kind, p.archived AS project_archived FROM task_dependencies d LEFT JOIN tasks t ON t.id = d.blocked_id LEFT JOIN projects p ON p.id = t.project_id WHERE d.blocker_id = ? AND d.blocked_id > ? ORDER BY d.blocked_id ASC LIMIT ?`,
        blockerId,
        last,
        DEP_FANOUT_CAP
      )
      .toArray() as Array<{ blocked_id: number; status: string | null; blocked_kind: string | null; project_archived: number | null }>;
    if (page.length === 0) return { more: false };
    last = page[page.length - 1]!.blocked_id;
    examined += page.length;
    for (let i = 0; i < page.length; i++) {
      const row = page[i]!;
      const lite: DepLite | null = row.status === null ? null : { status: row.status, blocked_kind: row.blocked_kind, project_archived: row.project_archived ?? 0 };
      if (!fn(row.blocked_id, lite)) return { more: i + 1 < page.length || hasNext(last) };
    }
  }
  return { more: hasNext(last) };
}

function depEachProjectTask(
  bus: IBusDO,
  projectId: number,
  cond: string,
  fn: (task: TaskRecord) => boolean,
  budget: number = DEP_CANDIDATE_BUDGET
): { more: boolean } {
  let last = 0;
  let examined = 0;
  const hasNext = (after: number): boolean =>
    bus.sql.exec(`SELECT 1 FROM tasks WHERE project_id = ? AND ${cond} AND id > ? LIMIT 1`, projectId, after).toArray().length > 0;
  while (examined < budget) {
    const page = bus.sql
      .exec(
        `SELECT * FROM tasks WHERE project_id = ? AND ${cond} AND id > ? ORDER BY id ASC LIMIT ?`,
        projectId,
        last,
        DEP_FANOUT_CAP
      )
      .toArray() as unknown as TaskRecord[];
    if (page.length === 0) return { more: false };
    last = page[page.length - 1]!.id;
    examined += page.length;
    for (let i = 0; i < page.length; i++) {
      if (!fn(page[i]!)) return { more: i + 1 < page.length || hasNext(last) };
    }
  }
  return { more: hasNext(last) };
}

// Paginated link iteration (fix round 3, M3): composite keyset over
// (fix round 5 minor: deliberately NOT candidate-budgeted. The
// delete cascade deletes links set-based and complete, and these
// unlink events are the audit for that delete — a budget cut would
// silently drop audit rows for surviving links' removal. Paging
// bounds memory, not completeness, here.)
// (blocker_id, blocked_id), so link-event writing never holds the
// whole link list in memory. Used by the delete cascades, where the
// delete itself stays complete (set-based) and only the iteration
// is paged.
function depEachTaskLink(
  bus: IBusDO,
  taskId: number,
  fn: (link: { blocker_id: number; blocked_id: number }) => void
): void {
  let lastBlocker = 0;
  let lastBlocked = 0;
  for (;;) {
    const page = bus.sql
      .exec(
        `SELECT blocker_id, blocked_id FROM task_dependencies
         WHERE (blocker_id = ? OR blocked_id = ?)
           AND (blocker_id > ? OR (blocker_id = ? AND blocked_id > ?))
         ORDER BY blocker_id ASC, blocked_id ASC LIMIT ?`,
        taskId,
        taskId,
        lastBlocker,
        lastBlocker,
        lastBlocked,
        DEP_FANOUT_CAP
      )
      .toArray() as Array<{ blocker_id: number; blocked_id: number }>;
    if (page.length === 0) break;
    const lastRow = page[page.length - 1]!;
    lastBlocker = lastRow.blocker_id;
    lastBlocked = lastRow.blocked_id;
    for (const link of page) fn(link);
  }
}

// Fix round 5, M11: the invisible stuck class. A task blocked
// explicitly waiting-human/waiting-external while holding unfinished
// links is skipped by every re-evaluation path (rule 4 is
// waiting-task-only; the sweep never revisits it), and manual
// unblock is 409 until ALL links are unlinked — discoverable only
// by attempting the unblock and reading its hint. This signal
// (poll event + system log, deduped per episode like M2) makes it
// visible, with a hint naming the escape.
export function depEmitInvisibleStuck(bus: IBusDO, task: TaskRecord, now: number): void {
  void now;
  if (task.status !== 'blocked') return;
  if (task.blocked_kind !== 'waiting-human' && task.blocked_kind !== 'waiting-external') return;
  const unfinished = depUnfinishedBlockers(bus, task.id);
  if (unfinished.length === 0) return;
  const episode = depStuckEpisode(bus, task);
  if (depStuckAlreadyLogged(bus, task.id, 'system stuck manual block:', episode)) return;
  const hint = 'escape: unlink all dependency links, then manually unblock or move the task';
  bus.kbSystemLog(
    task.id,
    `system stuck manual block: task is blocked ${task.blocked_kind} but holds unfinished dependency links no re-evaluation path will clear; task stays blocked until rescued — ${hint} — episode:${episode}`
  );
  bus.emitEvent('kanban.task.dependency_stuck', {
    actor: 'system',
    project_id: task.project_id,
    recipients: depEventRecipients(bus, task.project_id, task.assignee),
    payload: {
      id: task.id,
      task_id: task.id,
      lane: task.lane,
      assignee: task.assignee,
      blocked_kind: task.blocked_kind,
      blocker_ids: unfinished.map((b) => b.blocker_id),
      hint,
      episode,
    },
  });
}

// Argon safety round: depUnblockRow threads the freeing blocker
// through. freeingBlockerId is the blocker whose completion, unlink,
// or deletion freed this task (null when no single blocker freed it,
// e.g. the sweep's no-done-blocker orphan case). It is stored on the
// task row (migration v10 column unblocked_by_blocker_id) and named
// in the kanban.task.unblocked event, so unblocked rows and events
// answer "what freed me" without a second lookup. The public field is
// freeing_blocker_id, gated on unblocked_at at every read site — a
// stale column value on a later-claimed or re-blocked task never
// surfaces. Manual unblocks never call this function (they clear
// unblocked_at instead), so they carry no freeing blocker.
function depUnblockRow(
  bus: IBusDO,
  task: TaskRecord,
  now: number,
  freeingBlockerId: number | null = null
): string | null {
  // Only dependency-blocked rows (blocked_from_status set) restore.
  // A manual block that merely shares kind waiting-task must not be
  // restored to a NULL status by a blocker completion.
  // Fix round 3, K1: the null path is no longer silent — a
  // waiting-task row with no machine ownership stays blocked, and
  // that stuck state is written to the task's system log so it is
  // visible instead of vanishing inside re-evaluation.
  if (task.blocked_from_status !== 'todo' && task.blocked_from_status !== 'doing') {
    if (task.blocked_kind === 'waiting-task') {
      // Fix round 4, item 1: the skipped-unblock signal is deduped
      // ONCE per stuck episode, not once per hourly sweep. An
      // episode starts at the task's last status change, so a
      // skipped log (or stuck poll event) at/after
      // status_changed_at suppresses repeats, while a later
      // re-block after a status change logs again. The hint is
      // the FULL escape, not just "manual status change or
      // unlink": unlink every link, then move the task to todo
      // (the gate passes once no unfinished links remain), then
      // re-link the blockers so the machine owns the block.
      // The machine-readable signal is the poll event
      // kanban.task.dependency_stuck (chosen over a new task
      // column: the existing emit contract already carries it to
      // poll clients, and the system log keeps it visible on the
      // task sheet); both are written only on the first sighting.
      // Fix round 5, M2: the old hint was wrong on every caller path.
      // Every caller guards on zero unfinished blockers, so the
      // unfinished list inside this branch is always [] (an empty
      // blocker_ids payload), and re-linking a done blocker is a
      // 409 already-satisfied — with zero links the old hint was
      // vacuous. The real escape is the manual move alone; re-link
      // only an unfinished blocker afterwards, if machine ownership
      // is wanted again. The payload omits the empty blocker_ids
      // and instead names retained (finished) links, if any.
      const episode = depStuckEpisode(bus, task);
      if (!depStuckAlreadyLogged(bus, task.id, 'system skipped unblock:', episode)) {
        const finished = bus.sql
          .exec(`SELECT d.blocker_id FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_id WHERE d.blocked_id = ? AND t.status = 'done' ORDER BY d.blocker_id ASC`, task.id)
          .toArray() as Array<{ blocker_id: number }>;
        const hint =
          'escape: manually move the task to todo/doing; re-link only an unfinished blocker afterwards if machine ownership is wanted again';
        bus.kbSystemLog(
          task.id,
          `system skipped unblock: task is blocked waiting-task but blocked_from_status is not set (manual block without machine ownership); task stays blocked until it is rescued — ${hint} — episode:${episode}`
        );
        bus.emitEvent('kanban.task.dependency_stuck', {
          actor: 'system',
          project_id: task.project_id,
          recipients: depEventRecipients(bus, task.project_id, task.assignee),
          payload: {
            id: task.id,
            task_id: task.id,
            lane: task.lane,
            assignee: task.assignee,
            blocked_kind: task.blocked_kind,
            ...(finished.length ? { finished_blocker_ids: finished.map((b) => b.blocker_id) } : {}),
            hint,
            episode,
          },
        });
      }
    }
    return null;
  }
  const restored = task.blocked_from_status;
  const prevKind = task.blocked_kind;
  // unblocked_at is set only when restored to todo: a task restored to
  // doing is already resumed and must never surface later in the
  // unblocked list (e.g. after a manual move back to todo).
  // ONLY rule 4/4a (this function) may set unblocked_at; every other
  // path (claim, release, manual block/unblock) clears it.
  bus.sql.exec(
    `UPDATE tasks SET status = ?, blocked_kind = NULL, blocked_reason = NULL, blocked_from_status = NULL, unblocked_at = ?, unblocked_by_blocker_id = ?, updated_at = ?, status_changed_at = ? WHERE id = ?`,
    restored,
    restored === 'todo' ? now : null,
    freeingBlockerId,
    now,
    now,
    task.id
  );
  // Fix round C7: every rule-4/4a unblock — including restores to
  // doing, which never enter the unblocked list — emits the poll
  // event kanban.task.unblocked plus a system log, so agents learn
  // about the resume from the event stream, not only from the
  // unblocked list. (The dependency_events audit row is written by
  // the caller, not here, because its blocker_id/reason vary.)
  bus.emitEvent('kanban.task.unblocked', {
    actor: 'system',
    project_id: task.project_id,
    recipients: depEventRecipients(bus, task.project_id, task.assignee),
    payload: {
      id: task.id,
      task_id: task.id,
      lane: task.lane,
      assignee: task.assignee,
      previous_blocked_kind: prevKind,
      restored_status: restored,
      freeing_blocker_id: freeingBlockerId,
    },
  });
  bus.kbSystemLog(task.id, `system unblocked the task (was ${prevKind})`);
  return restored;
}

// Shared re-block update (rule 6 shape): todo/doing task with a
// retained link to an unfinished blocker becomes dependency-blocked.
// The caller writes the matching 'reblock' dependency event.
// Fix round 4: the visible blocked_reason lists ALL unfinished
// blockers (not only the first), as `Waiting for task 3: A; task 5: B`
// (single-blocker rows keep the plan's `Waiting for task {id}: {title}`
// shape, so existing assertions on that prefix still hold). The
// re-block also emits the poll event kanban.task.blocked, like a
// manual block — dependency-driven blocks are no longer poll-silent.
function depReblockRow(
  bus: IBusDO,
  task: TaskRecord,
  blockers: Array<{ id: number; title: string }>,
  now: number
): void {
  const first = blockers[0]!;
  // Fix round 5, M14: every item prefixed (see depMultiReason).
  // The dependency_events column for a reblock names the FIRST
  // unfinished blocker (the primary), and the event reason lists
  // ALL of them — column and reason agree by that documented rule,
  // and the poll payload carries blocker_ids for all of them.
  const reason = depMultiReason(blockers);
  bus.sql.exec(
    `UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = ?, blocked_from_status = ?, unblocked_at = NULL, updated_at = ?, status_changed_at = ? WHERE id = ?`,
    reason,
    task.status,
    now,
    now,
    task.id
  );
  bus.emitEvent('kanban.task.blocked', {
    actor: 'system',
    project_id: task.project_id,
    recipients: depEventRecipients(bus, task.project_id, task.assignee),
    payload: {
      id: task.id,
      task_id: task.id,
      lane: task.lane,
      assignee: task.assignee,
      blocked_kind: 'waiting-task',
      blocked_reason: reason,
      blocker_ids: blockers.map((b) => b.id),
    },
  });
  // Fix round 5, M14: system-log parity with depUnblockRow and
  // manual blocks, which both log; re-block previously did not.
  bus.kbSystemLog(task.id, `system re-blocked the task (waiting-task): ${reason}`);
}

// Fan-out result (fix round 4, item 4): callers surface this in
// their response when a cap truncated work, so a capped remainder
// is visible instead of silently converging later. `capped` means
// the pass stopped at DEP_FANOUT_CAP with at least one more
// candidate waiting; `pending_sweep` is the same fact in the
// response's words — the hourly alarm sweep converges the rest.
export interface DepFanoutStats {
  processed: number;
  capped: boolean;
  pending_sweep: boolean;
}

// Fix round 5, M1/M8e: pending_sweep is an independent remainder
// signal, not an alias of capped. It is true when the pass stopped
// at the processed cap with candidates waiting, OR when the
// iterator ran out of candidate budget (500 examined) with
// candidates still waiting. Rotation delay (sweep window) is a
// sweep-level signal surfaced in admin stats, not per-fanout.
function depFanoutStats(processed: number, capped: boolean, remainder = false): DepFanoutStats {
  return { processed, capped, pending_sweep: capped || remainder };
}

// Rule 4/5: a blocker reached done. Unblock every waiting-task dependent
// with no remaining unfinished blockers, in the caller's transaction.
// Capped at DEP_FANOUT_CAP (remainder converges via the alarm sweep);
// dependency events are batched (see depWriteEvents).
export function depReevaluateOnDone(this: IBusDO, blockerId: number, now: number): DepFanoutStats {
  const events: DepEventInput[] = [];
  let processed = 0;
  let capped = false;
  const iter = depEachDependent(this, blockerId, (blocked_id, lite) => {
    if (processed >= DEP_FANOUT_CAP) {
      capped = true;
      return false;
    }
    if (!lite) return true;
    if (lite.project_archived) return true;
    // Fix round 5, M11: waiting-human/external rows with unfinished
    // links are signalled, not silently skipped, on this path.
    // (Full row fetched only for the signalled class.)
    if (lite.status === 'blocked' && lite.blocked_kind !== 'waiting-task') {
      const t = depGetTask(this, blocked_id);
      if (t) depEmitInvisibleStuck(this, t, now);
      return true;
    }
    if (lite.status !== 'blocked' || lite.blocked_kind !== 'waiting-task') return true;
    const task = depGetTask(this, blocked_id);
    if (!task) return true;
    const unfinished = depUnfinishedBlockers(this, blocked_id);
    if (unfinished.length > 0) { depRefreshReason(this, blocked_id); return true; }
    // Argon safety round: the completed blocker is the freeing blocker.
    const restored = depUnblockRow(this, task, now, blockerId);
    if (restored === null) return true;
    processed++;
    events.push({ blockerId, blockedId: blocked_id, actor: 'system', action: 'unblock', reason: `unblock: blocker_id:${blockerId}`, now });
    return processed < DEP_FANOUT_CAP;
  });
  depWriteEvents(this, events);
  // Fix round 5, M1: a pass that processed exactly CAP rows and
  // still has candidates waiting IS capped — the callback is
  // never re-entered after the 100th row, so the in-callback
  // capped flag alone under-reports. (pending_sweep already
  // covered this via iter.more; capped now says it too.)
  if (processed >= DEP_FANOUT_CAP && iter.more) capped = true;
  return depFanoutStats(processed, capped, iter.more);
}

// Rule 6: a done blocker reopened. Re-block every todo/doing dependent
// with a retained link, never overwriting an existing blocked kind
// (a blocked dependent is not todo/doing, so it is excluded by status).
// Capped at DEP_FANOUT_CAP (remainder converges via the alarm sweep).
export function depReblockOnReopen(this: IBusDO, blockerId: number, now: number): DepFanoutStats {
  const blocker = depGetTask(this, blockerId);
  if (!blocker) return depFanoutStats(0, false);
  const events: DepEventInput[] = [];
  let processed = 0;
  let capped = false;
  const iter = depEachDependent(this, blockerId, (blocked_id, lite) => {
    if (processed >= DEP_FANOUT_CAP) {
      capped = true;
      return false;
    }
    if (!lite) return true;
    if (lite.project_archived) return true;
    // Fix round 6, bug m-1: an already-blocked waiting-task
    // dependent is excluded by the todo/doing filter, so its
    // reason used to omit the newly-unfinished (reopened)
    // blocker until a later link/unlink/completion. Refresh it
    // in place — no status change, no processed count, no event.
    if (lite.status === 'blocked' && lite.blocked_kind === 'waiting-task') {
      depRefreshReason(this, blocked_id);
      return true;
    }
    if (lite.status !== 'todo' && lite.status !== 'doing') return true;
    const task = depGetTask(this, blocked_id);
    if (!task) return true;
    // Fix round 4, item 11: the reblock event names ALL unfinished
    // blockers (plural blocker_ids), and the visible reason lists
    // them all too — the reopened blocker is not necessarily the
    // only unfinished link the dependent holds.
    const unfinished = depUnfinishedBlockers(this, blocked_id);
    if (unfinished.length === 0) return true;
    depReblockRow(this, task, unfinished.map((b) => ({ id: b.blocker_id, title: b.title })), now);
    processed++;
    const allIds = unfinished.map((b) => b.blocker_id).join(',');
    // Round-5 re-review minor 2: column = FIRST unfinished blocker per the documented rule
    // (reason lists ALL unfinished ids); the trigger blocker is not necessarily first.
    events.push({ blockerId: unfinished[0]!.blocker_id, blockedId: blocked_id, actor: 'system', action: 'reblock', reason: `reblock: blocker_ids:${allIds}`, now });
    return processed < DEP_FANOUT_CAP;
  });
  depWriteEvents(this, events);
  if (processed >= DEP_FANOUT_CAP && iter.more) capped = true;
  return depFanoutStats(processed, capped, iter.more);
}

// Rule 7, task delete: snapshot dependents and links, delete the task
// and its links, write one unlink event per removed link, then
// re-evaluate snapshotted dependents under rules 4/5. Assumes the
// caller is inside transactionSync; the task row itself is deleted here.
// Fix round M8: links, todos, labels, and comments are deleted
// EXPLICITLY in this same transaction instead of relying on FK
// cascades (FK enforcement is code-proven, not live-proven), so a
// store with FK enforcement off still ends clean. Re-evaluation is
// capped at DEP_FANOUT_CAP (remainder converges via the alarm sweep).
export interface DepCascadeSummary {
  links_removed: number;
  dependents_unblocked: number;
  unblocked_ids: number[];
  capped: boolean;
  pending_sweep: boolean;
  // True when the snapshot pass hit the 500-candidate budget: links
  // are still deleted set-based and complete, but dependents beyond
  // the snapshot window were not re-evaluated in-call and converge
  // via the hourly sweep. Stated, not hidden.
  snapshots_truncated: boolean;
}
export function depCascadeOnTaskDelete(this: IBusDO, taskId: number, now: number): DepCascadeSummary {
  // Fix round 3, M3: snapshots and link events are paged, never held
  // whole. Unlink events are written per page before the deletes
  // (same transaction, so order is still unlink-then-unblock); the
  // deletes themselves stay complete and set-based.
  const depSnapshots: DepTaskRow[] = [];
  let linksRemoved = 0;
  const snapIter = depEachDependent(this, taskId, (blocked_id) => {
    const t = depGetTask(this, blocked_id);
    if (t) depSnapshots.push(t);
    return true;
  });
  // Fix round 6, Perf M4: link events stream in bounded buffers
  // instead of accumulating the whole list in memory (the
  // project-delete cascade already streams per page; task delete
  // did not). Each buffer is flushed (batched multi-row inserts,
  // fix round 4 item 6) before the deletes below, same
  // transaction, so unlink-then-unblock order is preserved.
  let linkBuffer: DepEventInput[] = [];
  const flushLinks = () => { if (linkBuffer.length > 0) { depWriteEvents(this, linkBuffer); linkBuffer = []; } };
  depEachTaskLink(this, taskId, (link) => {
    linkBuffer.push({ blockerId: link.blocker_id, blockedId: link.blocked_id, actor: 'admin', action: 'unlink' as const, reason: null, now });
    linksRemoved++;
    if (linkBuffer.length >= 100) flushLinks();
  });
  flushLinks();
  this.sql.exec(`DELETE FROM task_dependencies WHERE blocker_id = ? OR blocked_id = ?`, taskId, taskId);
  this.sql.exec(`DELETE FROM todos WHERE task_id = ?`, taskId);
  this.sql.exec(`DELETE FROM task_labels WHERE task_id = ?`, taskId);
  this.sql.exec(`DELETE FROM task_comments WHERE task_id = ?`, taskId);
  this.sql.exec(`DELETE FROM tasks WHERE id = ?`, taskId);
  const events: DepEventInput[] = [];
  let processed = 0;
  const unblockedIds: number[] = [];
  let capped = false;
  for (let i = 0; i < depSnapshots.length; i++) {
    const task = depSnapshots[i]!;
    if (processed >= DEP_FANOUT_CAP) {
      // Fix round 6, bug m-4: the old code set capped=true
      // whenever snapshots remained, even when every remaining
      // snapshot was unblockable (waiting-human, archived, or
      // still-linked) and the loop would skip it. capped now
      // means a RESTORABLE snapshot remains. The scan is bounded
      // by the snapshot window (<=500) and the unfinished sets
      // are stable across the loop (each unblock touches only
      // its own row; the deleted blocker is already gone).
      capped = depSnapshots.slice(i).some((t) => t.status === 'blocked' && t.blocked_kind === 'waiting-task' && !t.project_archived && depUnfinishedBlockers(this, t.id).length === 0);
      break;
    }
    if (task.status !== 'blocked' || task.blocked_kind !== 'waiting-task') continue;
    if (task.project_archived) continue;
    // Fix round 6, bug m-1: a dependent with remaining links
    // keeps its reason fresh (the deleted blocker drops out of
    // the unfinished set via the JOIN), instead of naming a
    // deleted blocker until a later link/unlink/completion.
    if (depUnfinishedBlockers(this, task.id).length > 0) { depRefreshReason(this, task.id); continue; }
    // Argon safety round: the deleted blocker freed this task.
    const restored = depUnblockRow(this, task, now, taskId);
    if (restored === null) continue;
    processed++;
    unblockedIds.push(task.id);
    events.push({ blockerId: taskId, blockedId: task.id, actor: 'admin', action: 'unblock', reason: 'unblock: unlink', now });
  }
  depWriteEvents(this, events);
  // Fix round 5, M7: the cascade summary is returned so delete
  // responses can surface it (links removed, dependents unblocked
  // + ids, cap flag). Previously the function returned void and
  // task delete returned only {ok, id}.
  return {
    links_removed: linksRemoved,
    dependents_unblocked: processed,
    unblocked_ids: unblockedIds,
    capped,
    pending_sweep: capped || snapIter.more,
    snapshots_truncated: snapIter.more,
  };
}

// Project delete: cross-project links are forbidden, so no surviving
// external dependents exist; write one unlink event per removed link.
// Fix round M8: tasks, then their links, todos, labels, and comments,
// then subscribers, then the project itself are deleted EXPLICITLY in
// this same transaction instead of relying on FK cascades.
export interface DepProjectCascadeSummary { links_removed: number; tasks_deleted: number; }
export function depCascadeOnProjectDelete(this: IBusDO, projectId: number, now: number): DepProjectCascadeSummary {
  const tasksDeleted = (this.sql.exec(`SELECT COUNT(*) AS c FROM tasks WHERE project_id = ?`, projectId).toArray() as Array<{ c: number }>)[0]?.c ?? 0;
  let linksRemoved = 0;
  // Fix round 3, M3: link events are written in keyset pages before
  // the deletes (same transaction); the deletes stay complete and
  // set-based, so paging the audit never drops a link event.
  let lastBlocker = 0;
  let lastBlocked = 0;
  for (;;) {
    const page = this.sql
      .exec(
        `SELECT d.blocker_id, d.blocked_id FROM task_dependencies d
         JOIN tasks t ON t.id = d.blocked_id WHERE t.project_id = ?
           AND (d.blocker_id > ? OR (d.blocker_id = ? AND d.blocked_id > ?))
         ORDER BY d.blocker_id ASC, d.blocked_id ASC LIMIT ?`,
        projectId,
        lastBlocker,
        lastBlocker,
        lastBlocked,
        DEP_FANOUT_CAP
      )
      .toArray() as Array<{ blocker_id: number; blocked_id: number }>;
    if (page.length === 0) break;
    const lastRow = page[page.length - 1]!;
    lastBlocker = lastRow.blocker_id;
    lastBlocked = lastRow.blocked_id;
    linksRemoved += page.length;
    depWriteEvents(
      this,
      page.map((link) => ({ blockerId: link.blocker_id, blockedId: link.blocked_id, actor: 'admin', action: 'unlink' as const, reason: null, now }))
    );
  }
  this.sql.exec(
    `DELETE FROM task_dependencies WHERE blocked_id IN (SELECT id FROM tasks WHERE project_id = ?) OR blocker_id IN (SELECT id FROM tasks WHERE project_id = ?)`,
    projectId,
    projectId
  );
  this.sql.exec(`DELETE FROM todos WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, projectId);
  this.sql.exec(`DELETE FROM task_labels WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, projectId);
  this.sql.exec(`DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)`, projectId);
  this.sql.exec(`DELETE FROM tasks WHERE project_id = ?`, projectId);
  this.sql.exec(`DELETE FROM project_subscribers WHERE project_id = ?`, projectId);
  this.sql.exec(`DELETE FROM projects WHERE id = ?`, projectId);
  return { links_removed: linksRemoved, tasks_deleted: tasksDeleted };
}

// Unarchive re-evaluation: every blocked waiting-task task in the
// project with no unfinished blockers unblocks under rules 4/5.
// Fix round M7: after the unblock pass, a RE-BLOCK pass runs over
// todo/doing tasks in the same project that still hold a link to an
// unfinished blocker (e.g. an admin manually unblocked a dependent
// while the project was archived, or a previous fan-out was capped):
// each is re-blocked with the same update + 'reblock' event as rule 6,
// in the same transaction. Manual blocks are never touched here:
// the unblock pass restores only dependency-owned rows
// (blocked_from_status set), and the re-block pass only touches
// todo/doing rows. Both passes are capped at DEP_FANOUT_CAP and
// idempotent, so the alarm sweep converges any remainder.
export function depReevaluateProject(this: IBusDO, projectId: number, now: number, opts?: { uncapped?: boolean }): {
  unblocked: DepFanoutStats;
  reblocked: DepFanoutStats;
  capped: boolean;
  pending_sweep: boolean;
  // Fix round 5, M7: top-level processed (sum of both passes) so
  // the unarchive response matches SPEC:495's promise that all
  // fan-out paths carry dependency_fanout {processed, capped,
  // pending_sweep} at top level.
  processed: number;
} {
  // Fix round 7, (k): an archived-project guard of its own. The
  // unblock pass SQL has no archived filter; correctness used to
  // rest entirely on callers (the sweep window is archived = 0,
  // unarchive runs its UPDATE before re-evaluation in the same
  // transaction). A future caller passing an archived project
  // would have mutated it. Now an archived project is a no-op
  // with empty stats, never a mutation.
  const projRows = this.sql.exec(`SELECT archived FROM projects WHERE id = ?`, projectId).toArray() as Array<{ archived: number }>;
  if (projRows.length === 0 || projRows[0]!.archived) {
    return {
      unblocked: depFanoutStats(0, false),
      reblocked: depFanoutStats(0, false),
      capped: false,
      pending_sweep: false,
      processed: 0,
    };
  }
  // Amendment batch item 17: single-pass mode lifts the
  // candidate budget (examined uncapped); the per-pass processed
  // cap (DEP_FANOUT_CAP) still bounds one transaction.
  const candidateBudget = opts?.uncapped ? Number.POSITIVE_INFINITY : DEP_CANDIDATE_BUDGET;
  // Fix round 3, M3: both passes are keyset-paged, never whole-table.
  const events: DepEventInput[] = [];
  let processed = 0;
  let unblockCapped = false;
  // Fix round 5, M2 follow-up: the page query skips rows with
  // unfinished links in SQL (the NOT EXISTS predicate is exactly
  // depUnfinishedBlockers, which JOINs out deleted blockers and
  // keeps blockers whose status != 'done'). Those rows are no-ops
  // in this pass — the callback guards on zero unfinished links
  // before restoring or signalling — but they used to consume
  // the 500 candidate budget, so a late-id stuck row behind
  // hundreds of re-blocked chain tasks was never reached by this
  // pass at all (the first project re-evaluation's reblock pass
  // re-blocks every todo task holding an unfinished link, so the
  // blocked set grows past the budget and stays there). With the
  // filter, only actionable rows (restorable or stuck-signalled)
  // consume budget; the in-callback guard stays as a safety net.
  const unblockIter = depEachProjectTask(this, projectId, `status = 'blocked' AND blocked_kind = 'waiting-task' AND NOT EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks b ON b.id = d.blocker_id WHERE d.blocked_id = tasks.id AND b.status != 'done')`, (task) => {
    if (processed >= DEP_FANOUT_CAP) {
      unblockCapped = true;
      return false;
    }
    if (depUnfinishedBlockers(this, task.id).length > 0) return true;
    // Argon safety round: the freeing blocker for the sweep path is
    // the lowest-id done blocker link (several may be done; the full
    // set stays in the per-blocker audit events below). The query
    // runs BEFORE depUnblockRow so the id can be threaded through;
    // links survive depUnblockRow, which only clears status fields.
    const doneBlockers = this.sql
      .exec(`SELECT d.blocker_id FROM task_dependencies d JOIN tasks b ON b.id = d.blocker_id WHERE d.blocked_id = ? AND b.status = 'done' ORDER BY d.blocker_id ASC`, task.id)
      .toArray() as Array<{ blocker_id: number }>;
    const restored = depUnblockRow(this, task, now, doneBlockers[0]?.blocker_id ?? null);
    if (restored === null) return true;
    processed++;
    // m-2 fix: unarchive unblock events must name actually-done
    // blockers per rule-4 format, never blocker_id 0. One event per
    // done blocker link.
    for (const db of doneBlockers) {
      events.push({ blockerId: db.blocker_id, blockedId: task.id, actor: 'system', action: 'unblock', reason: `unblock: blocker_id:${db.blocker_id}`, now });
    }
    // Fix-round m-2: a restore with no done blockers (e.g. the blocker
    // was deleted while the project was archived, so the delete
    // cascade removed the link while the row stayed blocked) must
    // still leave exactly one audit event. Sentinel decision (b),
    // Luki's word 2026-11-02: blocker_id is NULL here (migration v8
    // made the column nullable) because no blocker exists — NULL
    // means "no blocker", never a self-block. The 'unblock: unlink'
    // reason (the delete-cascade format) distinguishes it from
    // rule-4 events, which always name an actually-done blocker.
    if (doneBlockers.length === 0) {
      events.push({ blockerId: null, blockedId: task.id, actor: 'system', action: 'unblock', reason: 'unblock: unlink', now });
    }
    return processed < DEP_FANOUT_CAP;
  }, candidateBudget);
  depWriteEvents(this, events);
  // M7 re-block pass (same update + event as rule 6), keyset-paged.
  // Fix round 3 minor: the re-block reason names ALL unfinished
  // blockers (ids), not only the first — the row itself is still
  // reasoned from the first blocker, as before.
  // Fix round 5, M8a: the page query skips linkless tasks with an
  // EXISTS link predicate instead of fetching every todo/doing row
  // and calling depUnfinishedBlockers per task.
  const reblockEvents: DepEventInput[] = [];
  let reblocked = 0;
  let reblockCapped = false;
  // Fix round 6, KILL: the page predicate is the unfinished-join
  // (same as the unblock pass below), not any-link. The old
  // EXISTS-any-link shape let done-link-only rows consume the 500
  // candidate budget — and depEachProjectTask restarts from id 0
  // per call — so a genuine reblock candidate past position 500
  // in a project full of done-link-only rows was NEVER reached by
  // any hourly sweep. The callback's unfinished==0 skip stays as a
  // safety net, but no longer consumes budget.
  const reblockIter = depEachProjectTask(this, projectId, `status IN ('todo', 'doing') AND EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks b ON b.id = d.blocker_id WHERE d.blocked_id = tasks.id AND b.status != 'done')`, (task) => {
    if (reblocked >= DEP_FANOUT_CAP) {
      reblockCapped = true;
      return false;
    }
    const unfinished = depUnfinishedBlockers(this, task.id);
    if (unfinished.length === 0) return true;
    depReblockRow(this, task, unfinished.map((b) => ({ id: b.blocker_id, title: b.title })), now);
    reblocked++;
    const allIds = unfinished.map((b) => b.blocker_id).join(',');
    reblockEvents.push({ blockerId: unfinished[0]!.blocker_id, blockedId: task.id, actor: 'system', action: 'reblock', reason: `reblock: blocker_ids:${allIds}`, now });
    return reblocked < DEP_FANOUT_CAP;
  }, candidateBudget);
  depWriteEvents(this, reblockEvents);
  // Fix round 5, M11: signal-only pass over blocked human/external
  // rows holding unfinished links (the invisible stuck class). It
  // does not count toward processed — it unblocks nothing — and
  // its own budget remainder converges via the hourly sweep, like
  // every other capped pass.
  // Round-5 re-review minor 3: this pass counts toward nothing, but its
  // budget remainder IS folded into pending_sweep below, so a truncated
  // signal pass is visible instead of silently converging later.
  // Fix round 6, KILL: same unfinished-join predicate as the
  // reblock pass — the old any-link shape starved the stuck
  // signal the same way (done-link-only human/external rows
  // consumed budget; a genuine stuck row past position 500 was
  // never signalled). depEmitInvisibleStuck itself returns early
  // on zero unfinished links, so the filter removes only budget
  // consumption, not behaviour.
  const stuckIter = depEachProjectTask(this, projectId, `status = 'blocked' AND blocked_kind IN ('waiting-human', 'waiting-external') AND EXISTS (SELECT 1 FROM task_dependencies d JOIN tasks b ON b.id = d.blocker_id WHERE d.blocked_id = tasks.id AND b.status != 'done')`, (task) => {
    depEmitInvisibleStuck(this, task, now);
    return true;
  }, candidateBudget);
  if (processed >= DEP_FANOUT_CAP && unblockIter.more) unblockCapped = true;
  if (reblocked >= DEP_FANOUT_CAP && reblockIter.more) reblockCapped = true;
  const capped = unblockCapped || reblockCapped;
  const pending = capped || unblockIter.more || reblockIter.more || stuckIter.more;
  return {
    unblocked: depFanoutStats(processed, unblockCapped, unblockIter.more),
    reblocked: depFanoutStats(reblocked, reblockCapped, reblockIter.more),
    capped,
    pending_sweep: pending,
    processed: processed + reblocked,
  };
}

// Manual-status gate (§4.1 row 9). Returns a TxAbort-style failure or null.
// requestedKind is the effective blocked kind when the request blocks.
// Fix round M9: reason-only blocked-field writes are routed through
// this gate too (opts.reasonChanged), so editing the reason of a
// dependency-blocked task is rejected like any other manual change;
// a pure no-op (same status, same kind, same reason) still passes.
// Gate failures carry blocker titles + a hint (fix-round minor), never
// just bare ids.
export function depGateManualStatus(
  bus: IBusDO,
  task: TaskRecord,
  requestedStatus: string | undefined,
  requestedKind: string | undefined,
  opts?: { reasonChanged?: boolean; kindOmitted?: boolean }
): { code: number; body: Record<string, unknown> } | null {
  if (requestedStatus === undefined) return null;
  const unfinished = depUnfinishedBlockers(bus, task.id);
  if (task.status === 'blocked' && unfinished.length > 0) {
    // Any manual status change on a dependency-blocked task is rejected,
    // including a move to the same status with a kind change that would
    // break the machine, and including a reason edit; a pure no-op
    // (same status, no kind change, no reason change) is not a change
    // and passes. That pass is deliberate even for legacy orphans
    // (manual waiting-task rows with unfinished links and no
    // blocked_from_status): rejecting a no-op would not rescue the
    // row — it changes nothing — and the stuck row is instead made
    // visible by depUnblockRow's deduped skipped-unblock signal
    // (system log + kanban.task.dependency_stuck poll event) with
    // the full unlink -> todo -> re-link escape. The gate only
    // rejects moves that would change state.
    if (
      requestedStatus !== task.status ||
      (requestedKind !== undefined && requestedKind !== task.blocked_kind) ||
      !!opts?.reasonChanged
    ) {
      // Fix round 6, API M3: the old hint told every blocked
      // task to "finish ... first", but finishing blockers does
      // NOT lift a waiting-human/waiting-external block — rule 4
      // restores waiting-task rows only, and the done path merely
      // emits the stuck signal. The correct escape for a manual
      // wait is unlink-all then manual move, and it is the hint
      // now (the same escape the stuck signal names).
      const isManualWait = task.blocked_kind === 'waiting-human' || task.blocked_kind === 'waiting-external';
      // Fix round 8, (6): a machine-orphan waiting-task row
      // (blocked_from_status NULL) is never lifted by blocker
      // completion — depUnblockRow returns null and only the
      // skipped-unblock signal fires — so "finish" is a dead end
      // for it, exactly as for a manual wait. Only unlink works.
      const isOrphan = task.blocked_kind === 'waiting-task' && task.blocked_from_status !== 'todo' && task.blocked_from_status !== 'doing';
      return {
        code: 409,
        body: {
          error: 'dependency_blocked',
          reason: 'task has unfinished dependency links',
          blockers: unfinished.map((b) => b.blocker_id),
          blocker_titles: unfinished.map((b) => ({ id: b.blocker_id, title: b.title })),
          hint: isManualWait
            ? 'blocker completion does not lift a waiting-human/waiting-external block; unlink all unfinished links first, then manually move the task'
            : isOrphan
              ? 'this waiting-task block is orphaned (no blocked_from_status), so blocker completion never lifts it; unlink all unfinished links first, then manually move the task'
              : 'finish or unlink the blocking tasks first; manual status, kind, or reason changes are rejected while links are unfinished',
        },
      };
    }
    return null;
  }
  // Fix round 4, item 10 (default-kind trap): a todo/doing task
  // with unfinished links, blocked with the kind OMITTED, used to
  // pass the gate and land as waiting-human — and blocker
  // completion then never clears it, because rule 4 only restores
  // waiting-task rows. Rejected, with a hint, instead of silently
  // writing a block the machine can never lift. An EXPLICIT
  // waiting-human block with unfinished links still passes: the
  // caller chose a manual wait, and manual unblock is the escape
  // for that. The distinction is omission vs choice, and only
  // omission is rejected here.
  if (requestedStatus === 'blocked' && opts?.kindOmitted && unfinished.length > 0 && task.status !== 'blocked') {
    return {
      code: 409,
      body: {
        error: 'dependency_blocked',
        reason: 'blocked with the default kind while unfinished dependency links exist; blocker completion only clears waiting-task blocks',
        blockers: unfinished.map((b) => b.blocker_id),
        blocker_titles: unfinished.map((b) => ({ id: b.blocker_id, title: b.title })),
        hint: 'link an unfinished blocker via POST dependencies so the machine owns a waiting-task block, or pass blocked_kind explicitly (waiting-human for a manual human wait)',
      },
    };
  }
  // (blocked_from_status NULL — e.g. a legacy rev5 row, or a
  // link-only row) is rejected, not written as a machine-orphaned
  // row that depUnblockRow can never restore. The machine owns a
  // waiting-task block only when it created it via a link.
  if (requestedStatus === 'blocked' && requestedKind === 'waiting-task' && unfinished.length > 0 && !task.blocked_from_status) {
    return {
      code: 409,
      body: {
        error: 'dependency_blocked',
        reason: 'manual blocked waiting-task with unfinished links is not dependency-owned',
        blockers: unfinished.map((b) => b.blocker_id),
        blocker_titles: unfinished.map((b) => ({ id: b.blocker_id, title: b.title })),
        hint: 'unlink all unfinished links and re-link them via POST dependencies so the machine owns the block, or block with waiting-human instead',
      },
    };
  }
  if (requestedStatus === 'blocked' && requestedKind === 'waiting-task' && unfinished.length === 0) {
    return {
      code: 409,
      body: {
        error: 'dependency_blocked',
        reason: 'manual blocked waiting-task requires an unfinished dependency link',
        hint: 'link an unfinished blocker task first (POST dependencies with blocker_id), then the block is dependency-owned',
      },
    };
  }
  if (task.status === 'blocked' && requestedKind === 'waiting-task' && task.blocked_kind !== 'waiting-task' && unfinished.length === 0) {
    return {
      code: 409,
      body: {
        error: 'dependency_blocked',
        reason: 'manual blocked waiting-task requires an unfinished dependency link',
        hint: 'link an unfinished blocker task first (POST dependencies with blocker_id), then the block is dependency-owned',
      },
    };
  }
  return null;
}

async function depAuth(
  bus: IBusDO,
  req: Request,
  isAdmin: boolean,
  opts?: { rate?: boolean }
): Promise<{ ok: true; actor: string } | { ok: false; res: Response }> {
  if (isAdmin) {
    if (!(await bus.checkBasicAuth(req))) return { ok: false, res: await bus.unauthorizedBasic(req) };
    return { ok: true, actor: bus.kbBasicUser(req) || 'admin' };
  }
  const agent = bus.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return { ok: false, res: bus.json(401, { error: 'unauthorized' }) };
  }
  // m-3 fix: rate-limit agent dependency endpoints like other agent
  // writes (plan rate limits); admin path is exempt, as elsewhere.
  // Fix round M14: pass { rate: false } when the handler must validate
  // first (bad requests must not consume quota); the handler then
  // calls bus.rlCheck + rlLimitedResponse itself after validation.
  if (opts?.rate !== false && !bus.rlCheck(agent)) {
    return { ok: false, res: bus.rlLimitedResponse(agent) };
  }
  return { ok: true, actor: agent };
}

function depTaskVisible(bus: IBusDO, task: DepTaskRow, isAdmin: boolean, agent: string | null): boolean {
  if (isAdmin) return true;
  if (task.assignee === agent) return true;
  const sub = bus.sql
    .exec(
      `SELECT 1 FROM projects WHERE id = ? AND ${bus.kbSubscriberPred('projects.id')}`,
      task.project_id,
      agent
    )
    .toArray();
  return sub.length > 0;
}

// Amendment batch item 12: the shared link-apply step, extracted
// verbatim from handleDepLink's post-check block so POST
// dependencies and the atomic rescue endpoint insert + transition
// identically. Caller must already have run depLinkCheck (the
// task/blocker rows passed here are the authoritative in-transaction
// rows). Returns the post-link row shape handleDepLink used to
// build inline: status/kind/reason/from_status + transition.
// NOTE: this does NOT emit kanban.task.dependency_changed — the
// endpoint wrapper does that for link-only changes (the rescue
// endpoint must not wake per link; its status event wakes once).
export function depApplyLink(
  bus: IBusDO,
  task: DepTaskRow,
  blocker: DepTaskRow,
  actor: string,
  now: number
): {
  status: string;
  blocked_kind: string | null;
  blocked_reason: string | null;
  blocked_from_status: string | null;
  transition: 'blocked' | 'link_only';
} {
  bus.sql.exec(
    `INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, ?, ?)`,
    blocker.id,
    task.id,
    actor,
    now
  );
  depWriteEvent(bus, blocker.id, task.id, actor, 'link', null, now);
  if (task.status === 'todo' || task.status === 'doing') {
    // Row 1: first transition to dependency-blocked. A blocked row
    // never carries a stale unblocked_at.
    bus.sql.exec(
      `UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = ?, blocked_from_status = ?, unblocked_at = NULL, updated_at = ?, status_changed_at = ?, last_activity_at = ? WHERE id = ?`,
      depServerReason(blocker),
      task.status,
      now,
      now,
      now,
      task.id
    );
    // Fix round 4, item 3: a dependency-driven block emits
    // kanban.task.blocked like a manual block (previously the
    // link wrote only a dependency_events audit row, so poll
    // clients never woke for it).
    bus.emitEvent('kanban.task.blocked', {
      actor,
      project_id: task.project_id,
      // Round-5 re-review minor 1: subscribers + assignee, like unblock/reblock/stuck events.
      recipients: depEventRecipients(bus, task.project_id, task.assignee),
      payload: {
        id: task.id,
        task_id: task.id,
        lane: task.lane,
        assignee: task.assignee,
        blocked_kind: 'waiting-task',
        blocked_reason: depServerReason(blocker),
        blocker_id: blocker.id,
        blocker_ids: [blocker.id],
      },
    });
    return {
      status: 'blocked',
      blocked_kind: 'waiting-task',
      blocked_reason: depServerReason(blocker),
      blocked_from_status: task.status,
      transition: 'blocked',
    };
  }
  // Rows 1a/2: link only; kind and blocked_from_status
  // untouched — and the reason refresh now follows the SAME
  // rule as every other path (fix round 7, (j)): only
  // machine-owned rows (blocked_from_status todo/doing)
  // get a machine reason. The old link-only code refreshed
  // unconditionally for any blocked waiting-task row, so
  // adding a link to a MANUAL waiting-task row rewrote its
  // human-typed reason with a machine multi-reason, while
  // reopen/delete paths (via depRefreshReason) deliberately
  // left human reasons alone. One rule everywhere now:
  // depRefreshReason no-ops on manual rows, so a manual
  // row keeps its human reason when a link is added.
  let reason = task.blocked_reason || null;
  if (task.status === 'blocked' && task.blocked_kind === 'waiting-task') {
    depRefreshReason(bus, task.id);
    const refreshed = depGetTask(bus, task.id);
    if (refreshed) reason = refreshed.blocked_reason || null;
  }
  return {
    status: task.status,
    blocked_kind: task.blocked_kind || null,
    blocked_reason: reason,
    blocked_from_status: task.blocked_from_status || null,
    transition: 'link_only',
  };
}

export async function handleDepLink(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  // M14: auth without rate so a malformed body does not consume quota.
  const auth = await depAuth(this, req, opts.isAdmin, { rate: false });
  if (!auth.ok) return auth.res;
  const actor = auth.actor;
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: 'invalid json' });
  }
  const payload = data as Record<string, unknown> | null;
  // Fix round 4, item 13: dependency link takes exactly one field;
  // unknown fields are 400, not silently dropped (ledger-allowlist
  // shape, applied here before quota so the 400 costs nothing).
  if (payload) {
    for (const key of Object.keys(payload)) {
      if (key !== 'blocker_id') {
        return this.json(400, { error: `field ${key} is not a dependency link field`, field: key, allowed: ['blocker_id'] });
      }
    }
  }
  const blockerId = payload?.blocker_id;
  if (typeof blockerId !== 'number' || !Number.isInteger(blockerId)) {
    return this.json(400, { error: 'blocker_id required', field: 'blocker_id' });
  }
  // Fix round 2, item 3: cheap semantic validation runs BEFORE the
  // rate check, so a 404/403/409 link does not consume quota. The
  // transaction below re-runs the same checks authoritatively.
  const preErr = depLinkCheck(this, depGetTask(this, id), depGetTask(this, blockerId), id, blockerId, actor, opts.isAdmin, { skipCycle: true });
  if (preErr) return this.json(preErr.code, preErr.body);
  // Fix round 5, M4: re-link retries are cheap after the window
  // resets — the duplicate-link 409 above is a pre-check, so it
  // never consumed quota (verified: it returns before rlCheck).
  // And a 429 here, mid-rescue, names the safe retry: only the
  // links still missing after the window resets, never a blind
  // replay of the whole unlink-all/status/re-link sequence.
  if (!opts.isAdmin && !this.rlCheck(actor)) return this.rlLimitedResponse(actor, 'rate limited mid-rescue? wait retry_after_seconds, then retry only the links still missing (re-list dependencies first); already-applied unlinks/links are safe to re-check, and duplicate-link 409s cost no quota');
  try {
    let result: Record<string, unknown> = {};
    this.state.storage.transactionSync(() => {
      const task = depGetTask(this, id);
      const blocker = depGetTask(this, blockerId);
      // Error precedence (§4.1): 404 missing -> 404 invisible (M5:
      // same visibility predicate as the status path: an agent that
      // neither owns the task nor subscribes to its project gets
      // 404, never a leak or a 403) -> 403 ownership -> 400
      // self -> 400 cross-project -> 400 archived -> 400 done-task ->
      // 409 done-blocker -> 409 duplicate -> 409 cycle.
      // Authoritative in-transaction check: depLinkCheck (same
      // function as the pre-transaction check, now including blocker
      // visibility) so a race between pre-check and transaction
      // cannot slip an invisible blocker past the gate.
      const txErr = depLinkCheck(this, task, blocker, id, blockerId, actor, opts.isAdmin);
      if (txErr) throw new TxAbort(txErr.code, txErr.body);
      // Unreachable after depLinkCheck (it 404s on null task/blocker),
      // kept only so TS narrows task/blocker to non-null below.
      if (!task || !blocker) throw new TxAbort(500, { error: 'internal: link check passed with missing task' });
      const now = depNow(this);
      // Amendment batch item 12: the insert + transition lives in
      // depApplyLink now (shared with the rescue endpoint); this
      // handler only builds its response shape from it, unchanged.
      const applied = depApplyLink(this, task, blocker, actor, now);
      result = {
        ok: true,
        blocker_id: blockerId,
        blocked_id: id,
        status: applied.status,
        blocked_kind: applied.blocked_kind,
        blocked_reason: applied.blocked_reason,
        blocked_from_status: applied.blocked_from_status,
        transition: applied.transition,
      };
      // Amendment batch item 12: link-only changes now emit a poll
      // wake. A row-1 link already wakes via kanban.task.blocked
      // above, so only the link-only branch needs this event:
      // kanban.task.dependency_changed, payload {task_id, change:
      // 'linked', blocker_id, ...} (the same event name the
      // unlink-only branch emits with change 'unlinked' below).
      if (applied.transition === 'link_only') {
        this.emitEvent('kanban.task.dependency_changed', {
          actor,
          project_id: task.project_id,
          recipients: depEventRecipients(this, task.project_id, task.assignee),
          payload: {
            id,
            task_id: id,
            change: 'linked',
            blocker_id: blockerId,
            blocker_ids: [blockerId],
            transition: 'link_only',
          },
        });
      }
    });
    return this.json(200, result);
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

export async function handleDepUnlink(
  this: IBusDO,
  req: Request,
  id: number,
  blockerId: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  // M14: auth without rate; pre-checks run before the rate check so
  // a 404/403/400 unlink does not consume quota.
  const auth = await depAuth(this, req, opts.isAdmin, { rate: false });
  if (!auth.ok) return auth.res;
  const actor = auth.actor;
  try {
    await req.text();
  } catch {}
  // Pre-checks (read-only, no await between here and the transaction,
  // so the DO's single-threaded execution keeps them atomic enough).
  const preTask = depGetTask(this, id);
  if (!preTask) return this.json(404, { error: 'task not found', field: 'task_id' });
  if (!opts.isAdmin && !depTaskVisible(this, preTask, false, actor)) {
    return this.json(404, { error: 'task not found', field: 'task_id' });
  }
  if (!opts.isAdmin && preTask.assignee !== null && preTask.assignee !== actor) {
    return this.json(403, { error: 'forbidden: task owned by another agent' });
  }
  if (preTask.project_archived) {
    return this.json(400, { error: 'project archived', hint: 'unarchive the project first' });
  }
  const preExisting = this.sql
    .exec(`SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?`, blockerId, id)
    .toArray();
  if (preExisting.length === 0) return this.json(404, { error: 'dependency not found' });
  // Fix round 2, item 2: the blocker gets the same visibility
  // predicate as the blocked task (404, never a leak).
  const preBlocker = depGetTask(this, blockerId);
  if (!opts.isAdmin && preBlocker && !depTaskVisible(this, preBlocker, false, actor)) {
    return this.json(404, { error: 'task not found', field: 'blocker_id' });
  }
  if (!opts.isAdmin && !this.rlCheck(actor)) return this.rlLimitedResponse(actor, 'rate limited mid-rescue? wait retry_after_seconds, then retry only the unlinks still missing (re-list dependencies first); already-applied unlinks are safe to re-check');
  try {
    let result: Record<string, unknown> = {};
    this.state.storage.transactionSync(() => {
      const task = depGetTask(this, id);
      if (!task) throw new TxAbort(404, { error: 'task not found', field: 'task_id' });
      if (!opts.isAdmin && !depTaskVisible(this, task, false, actor)) {
        throw new TxAbort(404, { error: 'task not found', field: 'task_id' });
      }
      if (!opts.isAdmin && task.assignee !== null && task.assignee !== actor) {
        throw new TxAbort(403, { error: 'forbidden: task owned by another agent' });
      }
      if (task.project_archived) {
        throw new TxAbort(400, { error: 'project archived', hint: 'unarchive the project first' });
      }
      const existing = this.sql
        .exec(`SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?`, blockerId, id)
        .toArray();
      if (existing.length === 0) throw new TxAbort(404, { error: 'dependency not found' });
      const txBlocker = depGetTask(this, blockerId);
      if (!opts.isAdmin && txBlocker && !depTaskVisible(this, txBlocker, false, actor)) {
        throw new TxAbort(404, { error: 'task not found', field: 'blocker_id' });
      }
      const now = depNow(this);
      this.sql.exec(`DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?`, blockerId, id);
      depWriteEvent(this, blockerId, id, actor, 'unlink', null, now);
      // Row 4a: last unfinished link removed from a waiting-task task.
      if (task.status === 'blocked' && task.blocked_kind === 'waiting-task') {
        if (depUnfinishedBlockers(this, id).length === 0) {
          // Argon safety round: the just-unlinked blocker freed it.
          const restored = depUnblockRow(this, task, now, blockerId);
          if (restored !== null) {
            depWriteEvent(this, blockerId, id, actor, 'unblock', 'unblock: unlink', now);
            result = {
              ok: true,
              blocker_id: blockerId,
              blocked_id: id,
              status: restored,
              unblocked: true,
              transition: 'unblocked',
              blocked_kind: null,
              blocked_reason: null,
              blocked_from_status: null,
            };
            return;
          }
        }
      }
      // Fix round 5, M6: still-blocked rows get their reason
      // refreshed to the remaining unfinished set after the unlink.
      // Fix round 7, (i): the zero-unfinished case used to fall
      // through here with no refresh at all — when depUnblockRow
      // returned null (a manual/legacy orphan with no
      // blocked_from_status), blocked_reason kept naming the
      // just-deleted link while the row stayed blocked with no
      // unfinished links. An orphaned row now gets an honest
      // reason naming its state (the skipped-unblock signal
      // already fired above via depUnblockRow, so this row is
      // visible, just no longer mislabelled).
      // Fix round 8, (12): the orphan write goes through
      // depRefreshReason's explicit orphan exception, not a
      // second ad-hoc UPDATE site — the one-refresh-rule holds,
      // with the orphan case documented inside the guard.
      // Fix round 9, (1): the unfinished>0 branch below used to
      // write depMultiReason directly with no blocked_from_status
      // check, silently overwriting a manual row's human reason
      // when one of its >=2 links was unlinked. It now routes
      // through depRefreshReason too: machine rows refresh to
      // the remaining set exactly as before, manual rows no-op
      // and keep their reason. Every unlink reason write now
      // goes through the guard — no direct UPDATE remains on
      // this path (the extra depUnfinishedBlockers call inside
      // the guard is one indexed query on a single-row path).
      let reason = task.blocked_reason || null;
      if (task.status === 'blocked' && task.blocked_kind === 'waiting-task') {
        const unf = depUnfinishedBlockers(this, id);
        if (unf.length > 0) {
          depRefreshReason(this, id);
          const refreshed = depGetTask(this, id);
          if (refreshed) reason = refreshed.blocked_reason || null;
        } else if (task.blocked_from_status !== 'todo' && task.blocked_from_status !== 'doing') {
          depRefreshReason(this, id, { orphan: true });
          const refreshed = depGetTask(this, id);
          if (refreshed) reason = refreshed.blocked_reason || null;
        }
      }
      result = {
        ok: true,
        blocker_id: blockerId,
        blocked_id: id,
        status: task.status,
        unblocked: false,
        transition: 'unlink_only',
        blocked_kind: task.blocked_kind || null,
        blocked_reason: reason,
        blocked_from_status: task.blocked_from_status || null,
      };
      // Amendment batch item 12: unlink-only changes now emit a
      // poll wake. An unlink that unblocks already wakes via
      // kanban.task.unblocked (depUnblockRow, early return above),
      // so only this unlink-only branch needs the event:
      // kanban.task.dependency_changed, payload {task_id, change:
      // 'unlinked', blocker_id, ...} (the same event name the
      // link-only branch emits with change 'linked' above).
      this.emitEvent('kanban.task.dependency_changed', {
        actor,
        project_id: task.project_id,
        recipients: depEventRecipients(this, task.project_id, task.assignee),
        payload: {
          id,
          task_id: id,
          change: 'unlinked',
          blocker_id: blockerId,
          blocker_ids: [blockerId],
          transition: 'unlink_only',
        },
      });
    });
    return this.json(200, result);
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

export async function handleDepList(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  // M14: rate after the visibility check, so a 404 read does not
  // consume quota.
  const auth = await depAuth(this, req, opts.isAdmin, { rate: false });
  if (!auth.ok) return auth.res;
  const task = depGetTask(this, id);
  if (!task || !depTaskVisible(this, task, opts.isAdmin, auth.actor)) {
    return this.json(404, { error: 'task not found' });
  }
  // Fix round 4, item 9: optional pagination matching the
  // unblocked/ledger pagers. WITHOUT a limit param the behaviour
  // is unchanged (full lists, for existing callers); WITH one,
  // both lists are id-cursored (after_id), clamped to 100, and
  // the response gains has_more plus per-list cursors.
  // Separate cursors (fix: combined-cursor row loss): blockers and
  // blocked_by are independent id spaces, so a single shared cursor
  // silently dropped rows — e.g. blockers 1-150 and blocked_by
  // 200-350 at limit=100 paged with next_after_id=299, then both
  // lists filtered by id>299, losing blockers 101-150. Each list
  // therefore has its own cursor (blockers_after_id /
  // blocked_by_after_id) and its own has_more flag; page with those,
  // not with next_after_id. Backward compatibility: the legacy
  // after_id is still accepted and initialises BOTH cursors (so a
  // first page with after_id works as before), and next_after_id is
  // still returned (max of the last ids of lists that have more),
  // but it is NOT sufficient to page both lists — a caller looping
  // on next_after_id alone can still lose rows, by construction of
  // a single number encoding two cursors.
  // Fix round 5, M3: cursor footguns closed. (1) A cursor without
  // a limit no longer silently returns the full list — limit is
  // required when any cursor is passed. (2) The string "null"
  // (a JSON null echoed by a caller) is treated as absent, not
  // parsed to NaN and 400'd. (3) Per-list cursors are anchor-
  // validated like ledger/unblocked anchors: a stale id (not in
  // that list) is 404, not an empty page with has_more:false.
  // (4) Passing only one per-list cursor restarts the other list
  // at 0 — callers MUST pass both cursors on subsequent pages;
  // that replay behaviour is documented in SPEC §17.5, because
  // stateless preservation of an unpassed cursor is impossible.
  // (5) next_after_id is null when BOTH lists have more (a single
  // number cannot encode two cursors); otherwise it is the max of
  // the lists that have more, for legacy single-list callers.
  // Fix round 6, API M1: limit/cursor parsing and anchor
  // validation below run BEFORE the rate check (moved down),
  // so a 400/404 cursor error costs no quota — the opposite
  // ordering the old comment admitted. Matches ledger/unblocked/
  // dep-events/link/unlink, which all validate first.
  // Fix round 6, API minor-8: a legacy after_id applies only to
  // the list(s) containing it (see below) — the old code
  // initialised BOTH cursors from it, so a cursor present in
  // only one list silently skipped the other list's early rows.
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get('limit');
  const parseCursor = (raw: string | null, field: string): number | null | Response => {
    if (raw === null || raw === 'null') return null;
    if (!/^\d+$/.test(raw)) return this.json(400, { error: `invalid ${field}`, field });
    return parseInt(raw, 10);
  };
  const afterParsed = parseCursor(url.searchParams.get('after_id'), 'after_id');
  if (afterParsed instanceof Response) return afterParsed;
  const blockersParsed = parseCursor(url.searchParams.get('blockers_after_id'), 'blockers_after_id');
  if (blockersParsed instanceof Response) return blockersParsed;
  const blockedByParsed = parseCursor(url.searchParams.get('blocked_by_after_id'), 'blocked_by_after_id');
  if (blockedByParsed instanceof Response) return blockedByParsed;
  // Fix round 6, (e): unified cursor parsing — the string
  // "null" is absent for limit as for cursors, on every pager.
  const limitParam = limitRaw === 'null' ? null : limitRaw;
  const anyCursor = afterParsed !== null || blockersParsed !== null || blockedByParsed !== null;
  if (anyCursor && limitParam === null) {
    return this.json(400, { error: 'limit required when paging with a cursor', field: 'limit' });
  }
  let limit: number | null = null;
  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam) || parseInt(limitParam, 10) < 1) {
      return this.json(400, { error: 'invalid limit', field: 'limit' });
    }
    limit = Math.min(parseInt(limitParam, 10), 100);
  }
  const afterId = afterParsed ?? 0;
  // Anchor validation (before the rate check — see the note
  // above — so a stale anchor is 404 without costing quota,
  // never a silent empty page).
  const anchorInList = (listSql: string, cursor: number): boolean => {
    if (cursor === 0) return true;
    return this.sql.exec(`${listSql} AND t.id = ?`, id, cursor).toArray().length > 0;
  };
  const blockersSqlPre = `SELECT t.id FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_id WHERE d.blocked_id = ?`;
  const blockedBySqlPre = `SELECT t.id FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_id WHERE d.blocker_id = ?`;
  if (blockersParsed !== null && !anchorInList(blockersSqlPre, blockersParsed)) {
    return this.json(404, { error: 'task not found', field: 'blockers_after_id' });
  }
  if (blockedByParsed !== null && !anchorInList(blockedBySqlPre, blockedByParsed)) {
    return this.json(404, { error: 'task not found', field: 'blocked_by_after_id' });
  }
  if (afterParsed !== null && afterParsed > 0 && !anchorInList(blockersSqlPre, afterId) && !anchorInList(blockedBySqlPre, afterId)) {
    return this.json(404, { error: 'task not found', field: 'after_id' });
  }
  // Fix round 6, API minor-8 (see above): a legacy after_id
  // initialises a list's cursor only when the id is IN that
  // list; a list without it starts at 0 instead of skipping its
  // early rows. Explicit per-list cursors still take precedence.
  const blockersAfterId = blockersParsed ?? (afterParsed !== null && anchorInList(blockersSqlPre, afterId) ? afterId : 0);
  const blockedByAfterId = blockedByParsed ?? (afterParsed !== null && anchorInList(blockedBySqlPre, afterId) ? afterId : 0);
  // Fix round (re-review GAP 2, #13): agent reads charge the READ bucket.
  if (!opts.isAdmin && !this.rlCheckRead(auth.actor)) return this.rlReadLimitedResponse(auth.actor);
  const fetchList = (sql: string, cursor: number): Array<Record<string, unknown>> => {
    if (limit === null) {
      return this.sql.exec(`${sql} ORDER BY t.id ASC`, id).toArray() as Array<Record<string, unknown>>;
    }
    return this.sql
      .exec(`${sql} AND t.id > ? ORDER BY t.id ASC LIMIT ?`, id, cursor, limit + 1)
      .toArray() as Array<Record<string, unknown>>;
  };
  // The base queries already ORDER BY t.id; the paged variant
  // appends the cursor condition before ORDER BY, so strip the
  // trailing ORDER BY from the base text here.
  const blockersSql = `SELECT t.id, t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.blocker_id WHERE d.blocked_id = ?`;
  const blockedBySql = `SELECT t.id, t.title, t.status FROM task_dependencies d JOIN tasks t ON t.id = d.blocked_id WHERE d.blocker_id = ?`;
  const blockersRaw = fetchList(blockersSql, blockersAfterId);
  const blockedByRaw = fetchList(blockedBySql, blockedByAfterId);
  if (limit === null) {
    return this.json(200, {
      blockers: blockersRaw,
      blocked_by: blockedByRaw,
      has_more: false,
      blockers_has_more: false,
      blocked_by_has_more: false,
      blockers_after_id: null,
      blocked_by_after_id: null,
      next_after_id: null,
    });
  }
  const hasMoreBlockers = blockersRaw.length > limit;
  const hasMoreBlockedBy = blockedByRaw.length > limit;
  const blockers = blockersRaw.slice(0, limit);
  const blocked_by = blockedByRaw.slice(0, limit);
  // Fix round 5, M3: null when both lists have more (see above).
  const lastIds = !(hasMoreBlockers && hasMoreBlockedBy)
    ? [
        ...(hasMoreBlockers && blockers.length ? [blockers[blockers.length - 1]!.id as number] : []),
        ...(hasMoreBlockedBy && blocked_by.length ? [blocked_by[blocked_by.length - 1]!.id as number] : []),
      ]
    : [];
  return this.json(200, {
    blockers,
    blocked_by,
    has_more: hasMoreBlockers || hasMoreBlockedBy,
    blockers_has_more: hasMoreBlockers,
    blocked_by_has_more: hasMoreBlockedBy,
    blockers_after_id: hasMoreBlockers && blockers.length ? (blockers[blockers.length - 1]!.id as number) : null,
    blocked_by_after_id: hasMoreBlockedBy && blocked_by.length ? (blocked_by[blocked_by.length - 1]!.id as number) : null,
    // Legacy only: see the cursor note above — page with the
    // per-list cursors, not with this value.
    next_after_id: lastIds.length ? Math.max(...lastIds) : null,
  });
}

export async function handleDepEvents(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  // Fix round 4, item 12: the dependency audit trail is now
  // readable, not write-only. Same visibility as the dependency
  // list (task visible to the caller) and the same rate rules as
  // other agent dependency reads: validation before the rate
  // check, so a 400/404 costs no quota.
  const auth = await depAuth(this, req, opts.isAdmin, { rate: false });
  if (!auth.ok) return auth.res;
  const task = depGetTask(this, id);
  if (!task || !depTaskVisible(this, task, opts.isAdmin, auth.actor)) {
    return this.json(404, { error: 'task not found' });
  }
  const url = new URL(req.url);
  const limitRaw0 = url.searchParams.get('limit');
  // Fix round 6, (e): unified parsing — "null" is absent.
  const limitRaw = limitRaw0 === 'null' ? null : limitRaw0;
  // Fix round 5, M12: strict limit parsing (400, not silent
  // coercion to 20) to match cursor-error behaviour.
  if (limitRaw !== null && (!/^\d+$/.test(limitRaw) || parseInt(limitRaw, 10) < 1)) {
    return this.json(400, { error: 'invalid limit', field: 'limit' });
  }
  const limit = limitRaw === null ? 20 : Math.min(parseInt(limitRaw, 10), 100);
  // Fix round 6, (e): unified cursor parsing — strict digits,
  // and the string "null" (a JSON null echoed by a caller) is
  // absent, like the dep list. (Dep events and comments keep
  // the bare id > filter, not anchor validation: they are
  // append-only logs, so a stale id genuinely means "caught
  // up", not an ambiguous row — see SPEC §17.6.)
  const afterRaw0 = url.searchParams.get('after_id');
  const afterRaw = afterRaw0 === 'null' ? null : afterRaw0;
  const afterId = afterRaw === null ? 0 : /^\d+$/.test(afterRaw) ? parseInt(afterRaw, 10) : -1;
  if (afterId < 0) {
    return this.json(400, { error: 'invalid after_id', field: 'after_id' });
  }
  // Fix round (re-review GAP 2, #13): agent reads charge the READ bucket.
  if (!opts.isAdmin && !this.rlCheckRead(auth.actor)) return this.rlReadLimitedResponse(auth.actor);
  const fetched = this.sql
    .exec(
      `SELECT id, blocker_id, blocked_id, actor, action, reason, created_at FROM dependency_events
       WHERE (blocked_id = ? OR blocker_id = ?) AND id > ? ORDER BY id ASC LIMIT ?`,
      id,
      id,
      afterId,
      limit + 1
    )
    .toArray();
  const hasMore = fetched.length > limit;
  const events = fetched.slice(0, limit);
  return this.json(200, {
    events,
    has_more: hasMore,
    next_after_id: hasMore && events.length ? (events[events.length - 1] as unknown as { id: number }).id : null,
  });
}

export async function handleDepUnblocked(
  this: IBusDO,
  req: Request,
  url: URL,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  // M14: auth without rate; all parameter validation runs before the
  // rate check so a 400 does not consume quota.
  const auth = await depAuth(this, req, opts.isAdmin, { rate: false });
  if (!auth.ok) return auth.res;
  const agent = auth.actor;
  // Fix round 6, (e): unified parsing — strict digits, and the
  // string "null" is absent (previously parseInt-lax: 12abc
  // silently became 12).
  const projectIdParam0 = url.searchParams.get('project_id');
  const projectIdParam = projectIdParam0 === 'null' ? null : projectIdParam0;
  const projectId = projectIdParam !== null ? (/^\d+$/.test(projectIdParam) ? parseInt(projectIdParam, 10) : -1) : null;
  if (projectIdParam !== null && (projectId as number) < 1) {
    return this.json(400, { error: 'invalid project_id', field: 'project_id' });
  }
  // Fix round 5, M12: strict limit parsing (400, not silent
  // coercion to 20) to match cursor-error behaviour.
  const unblockedLimitRaw0 = url.searchParams.get('limit');
  const unblockedLimitRaw = unblockedLimitRaw0 === 'null' ? null : unblockedLimitRaw0;
  if (unblockedLimitRaw !== null && (!/^\d+$/.test(unblockedLimitRaw) || parseInt(unblockedLimitRaw, 10) < 1)) {
    return this.json(400, { error: 'invalid limit', field: 'limit' });
  }
  let limit = unblockedLimitRaw === null ? 20 : parseInt(unblockedLimitRaw, 10);
  if (limit > 100) limit = 100;
  const afterIdParam0 = url.searchParams.get('after_id');
  const afterIdParam = afterIdParam0 === 'null' ? null : afterIdParam0;
  let anchor: { unblocked_at: number; id: number } | null = null;
  if (afterIdParam !== null) {
    if (!/^\d+$/.test(afterIdParam)) {
      return this.json(400, { error: 'invalid after_id', field: 'after_id' });
    }
    const afterId = parseInt(afterIdParam, 10);
    const rows = this.sql
      .exec(`SELECT id, unblocked_at, status, project_id FROM tasks WHERE id = ?`, afterId)
      .toArray() as Array<{ id: number; unblocked_at: number | null; status: string; project_id: number }>;
    const row = rows[0];
    if (!row || row.unblocked_at === null || row.unblocked_at === undefined) {
      return this.json(400, { error: 'invalid after_id', field: 'after_id' });
    }
    // Fix round 2, item 4: an anchor must be list-visible to the
    // caller, like an id-read — a task outside the unblocked-list
    // predicate (archived, assigned to another agent, or in an
    // unsubscribed project) is 404, not a usable cursor.
    if (!opts.isAdmin) {
      const anchorTask = depGetTask(this, afterId);
      const subscribed = anchorTask
        ? this.sql.exec(`SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred('projects.id')}`, anchorTask.project_id, agent).toArray().length > 0
        : false;
      const anchorVisible = !!anchorTask && !anchorTask.project_archived && subscribed && (anchorTask.assignee === agent || anchorTask.assignee === null);
      if (!anchorVisible) return this.json(404, { error: 'task not found', field: 'after_id' });
    }
    // Fix round 6, bug m-6: the admin path skipped the
    // visibility block above, so an anchor from an ARCHIVED
    // project was accepted and then filtered out of the list
    // (empty page, has_more:false) instead of the 400 the anchor
    // rule implies. Archived anchors are outside the list
    // predicate for every caller now.
    if (opts.isAdmin) {
      const anchorTask = depGetTask(this, afterId);
      if (anchorTask?.project_archived) {
        return this.json(400, { error: 'invalid after_id', field: 'after_id' });
      }
    }
    // Tiny fix round: the anchor must itself satisfy the list
    // predicate — a non-todo task never appears in the list, and
    // an anchor from another project is outside a filtered list —
    // so neither may be accepted as a cursor (400, not a silent
    // empty page). Visibility 404 above still takes precedence.
    if (row.status !== 'todo' || (projectId !== null && row.project_id !== projectId)) {
      return this.json(400, { error: 'invalid after_id', field: 'after_id' });
    }
    anchor = { unblocked_at: row.unblocked_at, id: row.id };
  }
  // Fix round (re-review GAP 2, #13): agent reads charge the READ bucket.
  if (!opts.isAdmin && !this.rlCheckRead(agent)) return this.rlReadLimitedResponse(agent);
  const conds: string[] = [
    `t.unblocked_at IS NOT NULL`,
    `t.status = 'todo'`,
    `NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)`,
  ];
  const params: (string | number)[] = [];
  if (projectId !== null) {
    conds.push(`t.project_id = ?`);
    params.push(projectId);
  }
  if (!opts.isAdmin) {
    conds.push(`(t.assignee = ? OR t.assignee IS NULL)`);
    params.push(agent);
    conds.push(`t.project_id IN (SELECT id FROM projects WHERE ${this.kbSubscriberPred('projects.id')})`);
    params.push(agent);
  }
  if (anchor) {
    conds.push(`(t.unblocked_at > ? OR (t.unblocked_at = ? AND t.id > ?))`);
    params.push(anchor.unblocked_at, anchor.unblocked_at, anchor.id);
  }
  // Fetch limit+1 for the has_more/next_after_id pagination shape.
  const fetched = this.sql
    .exec(
      `SELECT t.* FROM tasks t WHERE ${conds.join(' AND ')} ORDER BY t.unblocked_at ASC, t.id ASC LIMIT ?`,
      ...params,
      limit + 1
    )
    .toArray() as unknown as TaskRecord[];
  const hasMore = fetched.length > limit;
  const page = fetched.slice(0, limit);
  // Fix round M3: one batched todos query for the whole page instead
  // of kbTaskWithTodos's one query per task.
  const todosByTask = new Map<number, unknown[]>();
  // Fix round 3, M4: chunk the IN-list at 50 ids. A full page is 100
  // tasks; one IN (...) with 100 placeholders plus the page query's
  // other parameters exceeds the 100-bound-parameter statement
  // limit and surfaced as a 500. Chunked queries stay under it.
  if (page.length > 0) {
    for (let i = 0; i < page.length; i += 50) {
      const chunk = page.slice(i, i + 50);
      const placeholders = chunk.map(() => '?').join(', ');
      const todoRows = this.sql
        .exec(
          `SELECT id, task_id, text, done, sort_order FROM todos WHERE task_id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`,
          ...chunk.map((t) => t.id)
        )
        .toArray() as Array<{ task_id: number } & Record<string, unknown>>;
      for (const tr of todoRows) {
        const list = todosByTask.get(tr.task_id) || [];
        list.push(tr);
        todosByTask.set(tr.task_id, list);
      }
    }
  }
  // Argon safety round: strip the internal unblocked_by_blocker_id
  // column and surface the gated public freeing_blocker_id instead
  // (this list already filters unblocked_at IS NOT NULL, so the gate
  // is redundant here but kept explicit for the same reason as in
  // wake.ts: a stale column value must never surface).
  const tasks = page.map((t) => {
    const { unblocked_by_blocker_id, ...rest } = t as TaskRecord & { unblocked_by_blocker_id?: number | null };
    return { ...rest, todos: todosByTask.get(t.id) || [], freeing_blocker_id: t.unblocked_at ? (unblocked_by_blocker_id ?? null) : null };
  });
  const nextAfterId = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;
  return this.json(200, { tasks, rows: tasks, next_after_id: nextAfterId, has_more: hasMore });
}
