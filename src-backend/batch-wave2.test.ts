// Automated test suite for the amendment batch, wave 2
// (items 11, 17, 18, 20, 22, 23, 24, 25 + the generic-PUT
// lane-handoff hold check from item 1): sheet shape,
// sweep threshold constants, audit retention purge,
// deregistration cleanup, comment restore, real cursors,
// delete fan-out details, pending-sweep visibility.
// Same harness shape as batch-a.test.ts: the runner supplies
// createDO.
import { BusDO } from './index.js';
import type { Env } from './types.js';
import {
  SWEEP_SINGLE_PASS_MAX_PROJECTS,
  SWEEP_SINGLE_PASS_MAX_TASKS,
  DEP_SWEEP_PROJECT_CAP,
} from './handlers/dependencies.js';
import { AUDIT_MIN_RETENTION_DAYS } from './handlers/admin.js';

export interface TestHarness {
  bus: BusDO;
  sql: SqlStorage;
  init: () => Promise<void>;
  setFailAtSql?: (pattern: string | null) => void;
}

function assertEqual(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg ? msg + ': ' : ''}expected ${b}, got ${a}`);
  }
}

function assertTrue(cond: boolean, msg?: string): void {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

async function reqJson(
  bus: BusDO,
  method: string,
  pathStr: string,
  opts?: { auth?: string; body?: unknown; keepRate?: boolean }
): Promise<{ status: number; data: Record<string, any> }> {
  if (opts?.auth?.startsWith('Bearer') && !opts.keepRate) {
    (bus as any).rateLimit?.clear?.();
  }
  const headers: Record<string, string> = {};
  if (opts?.auth) headers['Authorization'] = opts.auth;
  if (opts?.body !== undefined) headers['Content-Type'] = 'application/json';
  const req = new Request(`https://bus.local${pathStr}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await bus.fetch(req);
  const data = (await res.json()) as Record<string, any>;
  return { status: res.status, data };
}

export async function runBatchWave2Tests(
  createDO: (envOverrides?: Partial<Env>) => TestHarness
): Promise<void> {
  const adminAuth = 'Basic ' + btoa('luki:secret123');
  const { bus, sql, init } = createDO();
  await init();

  async function registerAgent(name: string): Promise<string> {
    const r = await reqJson(bus, 'POST', '/admin/api/agents', { auth: adminAuth, body: { agent: name } });
    assertEqual(r.status, 200, `register agent ${name}`);
    return `Bearer ${r.data.secret}`;
  }
  const nyxToken = await registerAgent('nyx');
  const nosmileToken = await registerAgent('nosmile99');

  const projRes = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
    auth: adminAuth,
    body: { title: 'Wave2 test project', description: 'amendment batch wave 2' },
  });
  assertEqual(projRes.status, 200, 'create project');
  const projectId = projRes.data.id as number;

  const now = Math.floor(Date.now() / 1000);
  function mkTask(title: string, assignee: string | null, status = 'todo', extra = ''): number {
    sql.exec(
      `INSERT INTO tasks (project_id, title, status, assignee, priority, created_at, updated_at, lane ${extra ? ', ' + extra.split('=')[0] : ''}) VALUES (?, ?, ?, ?, 'normal', ?, ?, 'unassigned' ${extra ? ', ' + extra.split('=')[1] : ''})`,
      projectId,
      title,
      status,
      assignee,
      now,
      now
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }
  function taskRow(id: number): any {
    return sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).one() as any;
  }

  // ---- Item 17: named threshold constants, not magic inline.
  assertEqual(SWEEP_SINGLE_PASS_MAX_PROJECTS, 20, 'threshold projects');
  assertEqual(SWEEP_SINGLE_PASS_MAX_TASKS, 500, 'threshold tasks');
  assertEqual(DEP_SWEEP_PROJECT_CAP, 20, 'rotation cap matches threshold');
  assertEqual(AUDIT_MIN_RETENTION_DAYS, 90, 'audit retention days');

  // ---- Item 11/23: /available filters + cursor.
  const availTodo = mkTask('avail-todo', null, 'todo');
  const availBlocked = mkTask('avail-blocked', null, 'blocked');
  sql.exec(`UPDATE tasks SET blocked_kind = 'waiting-task', blocked_reason = 'blocked by test' WHERE id = ?`, availBlocked);
  const availTodo2 = mkTask('avail-todo2', null, 'todo');
  const availTodo3 = mkTask('avail-todo3', null, 'todo');

  const onlyTodo = await reqJson(bus, 'GET', '/api/kanban/tasks/available?status=todo', { auth: nyxToken });
  assertEqual(onlyTodo.status, 200, 'available status=todo');
  assertTrue(!(onlyTodo.data.tasks as any[]).some((t) => t.id === availBlocked), 'status=todo excludes blocked');
  assertTrue((onlyTodo.data.tasks as any[]).some((t) => t.id === availTodo), 'status=todo includes todo');
  const onlyBlocked = await reqJson(bus, 'GET', '/api/kanban/tasks/available?status=blocked', { auth: nyxToken });
  assertTrue((onlyBlocked.data.tasks as any[]).every((t) => t.status === 'blocked'), 'status=blocked only blocked');
  const excl = await reqJson(bus, 'GET', '/api/kanban/tasks/available?exclude_blocked=1', { auth: nyxToken });
  assertTrue((excl.data.tasks as any[]).every((t) => t.status === 'todo'), 'exclude_blocked only todo');
  const conflict = await reqJson(bus, 'GET', '/api/kanban/tasks/available?status=blocked&exclude_blocked=1', { auth: nyxToken });
  assertEqual(conflict.status, 400, 'status=blocked + exclude_blocked conflicts');
  const badStatus = await reqJson(bus, 'GET', '/api/kanban/tasks/available?status=doing', { auth: nyxToken });
  assertEqual(badStatus.status, 400, 'invalid status 400');

  // Cursor paging over the todo set: limit=1, walk pages, no
  // overlap, ends with has_more false.
  const p1 = await reqJson(bus, 'GET', '/api/kanban/tasks/available?status=todo&limit=1', { auth: nyxToken });
  assertEqual(p1.status, 200, 'available page 1');
  assertTrue(p1.data.has_more === true, 'page 1 has_more');
  assertTrue(typeof p1.data.next_cursor === 'string' && p1.data.next_cursor.length > 0, 'page 1 next_cursor');
  const p2 = await reqJson(bus, 'GET', `/api/kanban/tasks/available?status=todo&limit=1&cursor=${encodeURIComponent(p1.data.next_cursor)}`, { auth: nyxToken });
  assertEqual(p2.status, 200, 'available page 2');
  assertTrue(p2.data.tasks[0].id !== p1.data.tasks[0].id, 'cursor page differs from page 1');
  const badCursor = await reqJson(bus, 'GET', '/api/kanban/tasks/available?cursor=!!!not-a-cursor', { auth: nyxToken });
  assertEqual(badCursor.status, 400, 'invalid cursor 400');
  const off = await reqJson(bus, 'GET', '/api/kanban/tasks/available?status=todo&limit=1&offset=1', { auth: nyxToken });
  assertEqual(off.status, 200, 'offset fallback still works');
  assertTrue(typeof off.data.pagination_note === 'string' && off.data.pagination_note.includes('deprecated'), 'offset use flagged deprecated');

  // ---- Item 23: search cursor (default sort only).
  const s1 = await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks/search?q=avail&limit=1`, { auth: nyxToken });
  assertEqual(s1.status, 200, 'search page 1');
  if (s1.data.has_more) {
    assertTrue(typeof s1.data.next_cursor === 'string', 'search next_cursor');
    const s2 = await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks/search?q=avail&limit=1&cursor=${encodeURIComponent(s1.data.next_cursor)}`, { auth: nyxToken });
    assertEqual(s2.status, 200, 'search page 2');
    assertTrue(s2.data.tasks[0].id !== s1.data.tasks[0].id, 'search cursor page differs');
  }
  const sSort = await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks/search?q=avail&sort=blocked_since&cursor=${encodeURIComponent(s1.data.next_cursor || 'x')}`, { auth: nyxToken });
  assertEqual(sSort.status, 400, 'cursor + blocked_since sort 400');

  // ---- Item 23 (re-roast 9, bug M1): cursors survive due dates.
  // due_date is an INTEGER epoch; the old string-only cursor codec
  // rejected the server's own page-2 cursor whenever the page-1
  // boundary task had a due date. Page /available AND search across
  // a due-dated boundary and assert continuation, order, no dupes.
  const dueB = mkTask('duecur-b', null, 'todo', 'due_date=' + (now + 100));
  const dueC = mkTask('duecur-c', null, 'todo', 'due_date=' + (now + 200));
  const dueA = mkTask('duecur-a', null, 'todo', 'due_date=' + (now + 300));
  // /available walk, limit=1: due-dated tasks sort before null-due
  // tasks, in due_date order; the first page boundary IS due-dated.
  {
    const seen: number[] = [];
    let cursor: string | null = null;
    let guard = 0;
    for (;;) {
      const url = `/api/kanban/tasks/available?status=todo&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const pg = await reqJson(bus, 'GET', url, { auth: nyxToken });
      assertEqual(pg.status, 200, 'duecur available page 200');
      const ids = (pg.data.tasks as any[]).map((x) => x.id);
      assertEqual(ids.length, 1, 'duecur available page size 1');
      assertTrue(!seen.includes(ids[0]), 'duecur available no duplicate page');
      seen.push(ids[0]);
      if (!pg.data.has_more) break;
      assertTrue(typeof pg.data.next_cursor === 'string', 'duecur available next_cursor');
      cursor = pg.data.next_cursor;
      if (++guard > 50) throw new Error('duecur available walk did not terminate');
    }
    assertEqual(seen.slice(0, 3), [dueB, dueC, dueA], 'duecur available due-date order first');
  }
  // Search walk over the same tasks (default sort, same codec).
  {
    const seen: number[] = [];
    let cursor: string | null = null;
    let guard = 0;
    for (;;) {
      const url = `/api/kanban/projects/${projectId}/tasks/search?q=duecur&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const pg = await reqJson(bus, 'GET', url, { auth: nyxToken });
      assertEqual(pg.status, 200, 'duecur search page 200');
      const ids = (pg.data.tasks as any[]).map((x) => x.id);
      assertEqual(ids.length, 1, 'duecur search page size 1');
      assertTrue(!seen.includes(ids[0]), 'duecur search no duplicate page');
      seen.push(ids[0]);
      if (!pg.data.has_more) break;
      assertTrue(typeof pg.data.next_cursor === 'string', 'duecur search next_cursor');
      cursor = pg.data.next_cursor;
      if (++guard > 50) throw new Error('duecur search walk did not terminate');
    }
    assertEqual(seen, [dueB, dueC, dueA], 'duecur search due-date order exact');
  }

  // ---- Item 11: task detail full dependency fields + ledger_refs.
  const blockerDone = mkTask('blocker-done', null, 'done');
  const blockerOpen = mkTask('blocker-open', null, 'todo');
  const blockedTask = mkTask('blocked-detail', null, 'blocked');
  sql.exec(`UPDATE tasks SET blocked_kind = 'waiting-task', blocked_reason = 'waiting on two' WHERE id = ?`, blockedTask);
  sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'admin', ?)`, blockerDone, blockedTask, now);
  sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'admin', ?)`, blockerOpen, blockedTask, now);
  const longBody = 'x'.repeat(300);
  sql.exec(
    `INSERT INTO ledger (kind, title, body, author, lane, scope, status, ref_type, ref_id, provenance_type, created_at, updated_at) VALUES ('decision', 'ref row', ?, 'nyx', 'nyx', 'action', 'active', 'task', ?, 'agent_asserted', ?, ?)`,
    longBody,
    String(blockedTask),
    now,
    now
  );
  const detail = await reqJson(bus, 'GET', `/api/kanban/tasks/${blockedTask}`, { auth: nyxToken });
  assertEqual(detail.status, 200, 'detail 200');
  const blockers = detail.data.task.dependencies.blockers as any[];
  const doneEntry = blockers.find((b) => b.id === blockerDone);
  const openEntry = blockers.find((b) => b.id === blockerOpen);
  assertTrue(doneEntry && doneEntry.unfinished === false, 'done blocker unfinished=false');
  assertTrue(openEntry && openEntry.unfinished === true, 'open blocker unfinished=true');
  assertTrue(openEntry && openEntry.blocked_kind === null, 'blocker row blocked_kind present (null for todo)');
  const refs = detail.data.task.ledger_refs as any[];
  assertTrue(refs.length >= 1, 'ledger_refs present');
  assertEqual(refs[0].provenance_type, 'agent_asserted', 'ledger_ref provenance_type');
  assertTrue(typeof refs[0].body_excerpt === 'string' && refs[0].body_excerpt.length === 200, 'ledger_ref body excerpt truncated to 200');
  // Detail ledger_refs paging: 25 refs -> page 1 has 20 + pointer.
  for (let i = 0; i < 24; i++) {
    sql.exec(
      `INSERT INTO ledger (kind, title, body, author, lane, scope, status, ref_type, ref_id, provenance_type, created_at, updated_at) VALUES ('decision', ?, 'b', 'nyx', 'nyx', 'action', 'active', 'task', ?, 'agent_asserted', ?, ?)`,
      `ref-${i}`,
      String(blockedTask),
      now,
      now
    );
  }
  const d1 = await reqJson(bus, 'GET', `/api/kanban/tasks/${blockedTask}`, { auth: nyxToken });
  assertEqual((d1.data.task.ledger_refs as any[]).length, 20, 'detail refs page 1 = 20');
  assertTrue(typeof d1.data.task.ledger_refs_next_after_id === 'number', 'detail refs pointer');
  const d2 = await reqJson(bus, 'GET', `/api/kanban/tasks/${blockedTask}?ledger_refs_after_id=${d1.data.task.ledger_refs_next_after_id}`, { auth: nyxToken });
  assertEqual((d2.data.task.ledger_refs as any[]).length, 5, 'detail refs page 2 = 5');
  const dBad = await reqJson(bus, 'GET', `/api/kanban/tasks/${blockedTask}?ledger_refs_after_id=abc`, { auth: nyxToken });
  assertEqual(dBad.status, 400, 'invalid ledger_refs_after_id 400');

  // ---- Item 22: comment restore.
  const cTask = mkTask('comment-task', 'nyx', 'todo');
  const cAdd = await reqJson(bus, 'POST', `/api/kanban/tasks/${cTask}/comments`, { auth: nyxToken, body: { body: 'restore me' } });
  assertEqual(cAdd.status, 200, 'comment add');
  const commentId = cAdd.data.id as number;
  const cDel = await reqJson(bus, 'POST', `/admin/api/kanban/tasks/${cTask}/comments/${commentId}/soft-delete`, { auth: adminAuth, body: { reason: 'test delete' } });
  assertEqual(cDel.status, 200, 'comment soft-delete');
  const beforeRestore = await reqJson(bus, 'GET', `/api/kanban/tasks/${cTask}`, { auth: nyxToken });
  const countDeleted = beforeRestore.data.task.comment_count as number;
  const restoreOther = await reqJson(bus, 'POST', `/api/kanban/tasks/${cTask}/comments/${commentId}/restore`, { auth: nosmileToken });
  assertEqual(restoreOther.status, 403, 'non-author restore 403');
  const restore = await reqJson(bus, 'POST', `/api/kanban/tasks/${cTask}/comments/${commentId}/restore`, { auth: nyxToken });
  assertEqual(restore.status, 200, 'author restore 200');
  assertEqual(restore.data.restored_by, 'nyx', 'restored_by recorded');
  const afterRestore = await reqJson(bus, 'GET', `/api/kanban/tasks/${cTask}`, { auth: nyxToken });
  assertEqual(afterRestore.data.task.comment_count, countDeleted + 1, 'restored comment counts again');
  const auditRow = sql.exec(`SELECT body FROM task_comments WHERE author = 'system' AND body LIKE 'comment restored:%' ORDER BY id DESC LIMIT 1`).one() as any;
  assertTrue(auditRow && String(auditRow.body).includes('nyx'), 'restore audit trail names restorer');
  const restoreAgain = await reqJson(bus, 'POST', `/api/kanban/tasks/${cTask}/comments/${commentId}/restore`, { auth: nyxToken });
  assertEqual(restoreAgain.status, 409, 'restore non-deleted 409');
  // Admin restore path.
  await reqJson(bus, 'POST', `/admin/api/kanban/tasks/${cTask}/comments/${commentId}/soft-delete`, { auth: adminAuth, body: { reason: 'again' } });
  const adminRestore = await reqJson(bus, 'POST', `/admin/api/kanban/tasks/${cTask}/comments/${commentId}/restore`, { auth: adminAuth });
  assertEqual(adminRestore.status, 200, 'admin restore 200');

  // ---- Item 1 (wave-2 follow-up): lane-handoff hold check.
  sql.exec(`INSERT OR IGNORE INTO lane_mapping (agent, lane, set_by, set_at) VALUES ('nosmile99', 'android', 'admin', ?)`, now);
  const handoffTask = mkTask('handoff-task', 'nyx', 'todo');
  sql.exec(
    `INSERT INTO ledger (kind, title, body, author, lane, scope, status, ref_type, ref_id, provenance_type, created_at, updated_at) VALUES ('hold', 'hold row', 'b', 'nyx', 'nyx', 'action', 'active', 'task', ?, 'agent_asserted', ?, ?)`,
    String(handoffTask),
    now,
    now
  );
  const heldHandoff = await reqJson(bus, 'PUT', `/api/kanban/tasks/${handoffTask}`, { auth: nyxToken, body: { lane: 'android' } });
  assertEqual(heldHandoff.status, 409, 'held handoff 409');
  assertEqual(heldHandoff.data.error, 'held', 'held handoff error');
  assertEqual(taskRow(handoffTask).assignee, 'nyx', 'held handoff no mutation');
  sql.exec(`UPDATE ledger SET status = 'tombstoned' WHERE ref_type = 'task' AND ref_id = ?`, String(handoffTask));
  const okHandoff = await reqJson(bus, 'PUT', `/api/kanban/tasks/${handoffTask}`, { auth: nyxToken, body: { lane: 'android' } });
  assertEqual(okHandoff.status, 200, 'unheld handoff 200');
  assertEqual(taskRow(handoffTask).assignee, 'nosmile99', 'handoff reassigns to lane owner');

  // ---- Item 24: delete fan-out details.
  const delBlocker = mkTask('del-blocker', null, 'todo');
  const delTask = mkTask('del-task', null, 'todo');
  sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'admin', ?)`, delBlocker, delTask, now);
  sql.exec(`INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, 'del todo', 0, 0)`, delTask);
  sql.exec(`INSERT INTO task_labels (task_id, label) VALUES (?, 'del-label')`, delTask);
  sql.exec(`INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, 'nyx', 'del comment', ?)`, delTask, now);
  const delRes = await reqJson(bus, 'DELETE', `/admin/api/kanban/tasks/${delTask}`, { auth: adminAuth });
  assertEqual(delRes.status, 200, 'task delete 200');
  assertEqual(delRes.data.fanout.links_as_blocked.count, 1, 'fanout link count');
  assertTrue((delRes.data.fanout.links_as_blocked.ids as number[]).includes(delBlocker), 'fanout link id');
  assertEqual(delRes.data.fanout.todos.count, 1, 'fanout todo count');
  assertEqual(delRes.data.fanout.labels.count, 1, 'fanout label count');
  assertEqual(delRes.data.fanout.comments.count, 1, 'fanout comment count');
  assertEqual(sql.exec(`SELECT 1 FROM tasks WHERE id = ?`, delTask).toArray().length, 0, 'task actually deleted');

  const proj2Res = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
    auth: adminAuth,
    body: { title: 'Wave2 delete project' },
  });
  const proj2 = proj2Res.data.id as number;
  sql.exec(`INSERT INTO tasks (project_id, title, status, assignee, priority, created_at, updated_at, lane) VALUES (?, 'proj-del-task', 'todo', NULL, 'normal', ?, ?, 'unassigned')`, proj2, now, now);
  const projTaskId = (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  sql.exec(`INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, 'nyx', 'proj comment', ?)`, projTaskId, now);
  const projDel = await reqJson(bus, 'DELETE', `/admin/api/kanban/projects/${proj2}`, { auth: adminAuth });
  assertEqual(projDel.status, 200, 'project delete 200');
  assertEqual(projDel.data.fanout.tasks.count, 1, 'project fanout task count');
  assertTrue((projDel.data.fanout.tasks.ids as number[]).includes(projTaskId), 'project fanout task id');
  assertEqual(projDel.data.fanout.comments.count, 1, 'project fanout comment count');

  // ---- Item 20: deregistration cleanup, full cycle.
  const tempToken = await registerAgent('temp');
  const tempTodo = mkTask('temp-todo', 'temp', 'todo');
  const tempDoing = mkTask('temp-doing', 'temp', 'doing');
  const tempBlocked = mkTask('temp-blocked', 'temp', 'blocked');
  sql.exec(`UPDATE tasks SET blocked_kind = 'waiting-task', blocked_reason = 'x', blocked_from_status = 'doing' WHERE id = ?`, tempBlocked);
  sql.exec(`INSERT OR IGNORE INTO project_subscribers (project_id, agent, added_by, added_at) VALUES (?, 'temp', 'admin', ?)`, projectId, now);
  sql.exec(`INSERT OR IGNORE INTO lane_mapping (agent, lane, set_by, set_at) VALUES ('temp', 'backend', 'admin', ?)`, now);
  sql.exec(
    `INSERT INTO ledger (kind, title, body, author, lane, scope, status, ref_type, ref_id, provenance_type, created_at, updated_at) VALUES ('decision', 'temp row', 'b', 'temp', 'temp', 'action', 'active', 'task', ?, 'agent_asserted', ?, ?)`,
    String(tempTodo),
    now,
    now
  );
  // Give temp a rate-bucket entry, then deregister.
  await reqJson(bus, 'GET', '/api/kanban/tasks/available', { auth: tempToken });
  const dereg = await reqJson(bus, 'DELETE', '/admin/api/agents/temp', { auth: adminAuth });
  assertEqual(dereg.status, 200, 'deregister 200');
  assertTrue((dereg.data.cleanup.released.todo as number[]).includes(tempTodo), 'cleanup released todo');
  assertTrue((dereg.data.cleanup.released.doing as number[]).includes(tempDoing), 'cleanup released doing');
  assertTrue((dereg.data.cleanup.released.blocked as number[]).includes(tempBlocked), 'cleanup released blocked');
  assertEqual(taskRow(tempTodo).assignee, null, 'todo unassigned');
  assertEqual(taskRow(tempDoing).status, 'todo', 'doing -> todo');
  assertEqual(taskRow(tempDoing).assignee, null, 'doing unassigned');
  assertEqual(taskRow(tempBlocked).status, 'blocked', 'blocked stays blocked');
  assertEqual(taskRow(tempBlocked).blocked_from_status, 'doing', 'blocked_from_status preserved');
  assertEqual(taskRow(tempBlocked).assignee, null, 'blocked unassigned');
  const agentsLeft = sql.exec(`SELECT 1 FROM agents WHERE agent = 'temp'`).toArray();
  assertEqual(agentsLeft.length, 0, 'agents row revoked');
  const subsLeft = sql.exec(`SELECT 1 FROM project_subscribers WHERE agent = 'temp'`).toArray();
  assertEqual(subsLeft.length, 0, 'subscribers dropped');
  const laneLeft = sql.exec(`SELECT 1 FROM lane_mapping WHERE agent = 'temp'`).toArray();
  assertEqual(laneLeft.length, 0, 'lane mapping dropped');
  const ledgerKept = sql.exec(`SELECT author FROM ledger WHERE author = 'temp'`).toArray() as Array<{ author: string }>;
  assertTrue(ledgerKept.length >= 1 && ledgerKept[0]!.author === 'temp', 'ledger author preserved as history');
  const oldTempCall = await reqJson(bus, 'GET', '/api/kanban/tasks/available', { auth: tempToken });
  assertEqual(oldTempCall.status, 401, 'old bearer revoked');
  const tempToken2 = await registerAgent('temp');
  assertTrue(tempToken2 !== tempToken, 're-registration gets a fresh secret');
  assertEqual(taskRow(tempTodo).assignee, null, 're-registration inherits no claim');

  // ---- Item 18: audit retention purge.
  const oldTs = now - 100 * 86400;
  const newTs = now - 10 * 86400;
  sql.exec(`INSERT INTO dependency_events (blocker_id, blocked_id, actor, action, reason, created_at) VALUES (1, 2, 'admin', 'link', NULL, ?)`, oldTs);
  sql.exec(`INSERT INTO dependency_events (blocker_id, blocked_id, actor, action, reason, created_at) VALUES (1, 2, 'admin', 'link', NULL, ?)`, newTs);
  const purgeInside = await reqJson(bus, 'POST', '/admin/api/audit/purge', { auth: adminAuth, body: { before_ts: now } });
  assertEqual(purgeInside.status, 400, 'purge inside retention window 400');
  const purgeOk = await reqJson(bus, 'POST', '/admin/api/audit/purge', { auth: adminAuth, body: { before_ts: now - 91 * 86400 } });
  assertEqual(purgeOk.status, 200, 'purge past window 200');
  assertTrue((purgeOk.data.deleted.dependency_events as number) >= 1, 'purge deleted the old row');
  const kept = sql.exec(`SELECT COUNT(*) AS c FROM dependency_events WHERE created_at = ?`, newTs).one() as { c: number };
  assertEqual(kept.c, 1, 'purge kept the young row');

  // ---- Item 25: pending-sweep visibility, both surfaces.
  const sweepHealth = await reqJson(bus, 'GET', '/api/kanban/sweep-health', { auth: nyxToken });
  assertEqual(sweepHealth.status, 200, 'sweep-health 200');
  assertTrue('pending_sweep' in sweepHealth.data.sweep, 'sweep pending_sweep present');
  assertTrue('pending_projects' in sweepHealth.data.sweep, 'sweep pending_projects present');
  assertTrue('failed_projects' in sweepHealth.data.sweep, 'sweep failed_projects present');
  assertTrue('unvisited_projects' in sweepHealth.data.sweep, 'sweep unvisited_projects present');
  assertTrue(typeof sweepHealth.data.sweep.expected_convergence_at === 'string', 'sweep convergence bound present');
  const stats = await reqJson(bus, 'GET', '/admin/api/stats', { auth: adminAuth });
  assertEqual(stats.status, 200, 'admin stats 200');
  assertTrue(typeof stats.data.sweepVisibility === 'object', 'stats sweepVisibility present');
  assertTrue(typeof stats.data.auditSizes === 'object', 'stats auditSizes present');
  assertTrue(typeof stats.data.auditSizes.dependency_events === 'number' && stats.data.auditSizes.dependency_events >= 0, 'stats dependency_events count');
  assertTrue(typeof stats.data.auditSizes.ledger_events === 'number' && stats.data.auditSizes.ledger_events >= 0, 'stats ledger_events count');

  // Silence unused-var warnings for fixtures kept for later asserts.
  assertTrue([availTodo2, availTodo3, blockerDone].length === 3, 'fixtures used');
}
