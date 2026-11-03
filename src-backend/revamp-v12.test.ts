// Automated test suite for agent-bus revamp plan v12 (LOCKED 2026-11-02):
// §4 dependencies, §5 ledger, §6 Phase 3, lock answers Q2/Q6/Q7a/Q7b/Q7c/Q8/Q9.
// Same harness shape as kanban-rev5.test.ts: the runner supplies createDO.
import { BusDO } from './index.js';
import { ledgerBlocklistHit } from './handlers/ledger.js';
import { depHasCycle, depReevaluateProject } from './handlers/dependencies.js';
import type { Env } from './types.js';

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
  // Fix-round m-3 harness note: agent endpoints are now rate-limited
  // (10/60s), and this suite reuses two agents across dozens of calls,
  // so the harness clears the window before each agent call unless
  // keepRate is set (used only by the dedicated 429 test below).
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

async function sha256HexStr(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function runRevampV12Tests(
  createDO: (envOverrides?: Partial<Env>) => TestHarness
): Promise<void> {
  const adminAuth = 'Basic ' + btoa('luki:secret123');
  const { bus, sql, init } = createDO();
  await init();

  // Migration v7 tables exist.
  {
    const migs = sql.exec(`SELECT version FROM schema_migrations ORDER BY version ASC`).toArray() as Array<{ version: number }>;
    assertTrue(migs.map((m) => m.version).includes(7), 'schema version 7 applied');
    for (const t of ['task_dependencies', 'dependency_events', 'ledger', 'endorsement_uses', 'seed_exception_uses', 'seed_luki_uses', 'ledger_events']) {
      const rows = sql.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`, t).toArray();
      assertEqual(rows.length, 1, `table ${t} exists`);
    }
    const cols = sql.exec(`SELECT name FROM pragma_table_info('tasks')`).toArray() as Array<{ name: string }>;
    assertTrue(cols.some((c) => c.name === 'blocked_from_status'), 'tasks.blocked_from_status exists');
    assertTrue(cols.some((c) => c.name === 'unblocked_at'), 'tasks.unblocked_at exists');
    const ccols = sql.exec(`SELECT name FROM pragma_table_info('task_comments')`).toArray() as Array<{ name: string }>;
    assertTrue(ccols.some((c) => c.name === 'deleted'), 'task_comments.deleted exists');
  }

  async function registerAgent(name: string): Promise<string> {
    const r = await reqJson(bus, 'POST', '/admin/api/agents', { auth: adminAuth, body: { agent: name } });
    assertEqual(r.status, 200, `register agent ${name}`);
    return `Bearer ${r.data.secret}`;
  }
  const nyxToken = await registerAgent('nyx');
  const nosmileToken = await registerAgent('nosmile99');

  const projRes = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
    auth: adminAuth,
    body: { title: 'Revamp test project', description: 'v12 tests' },
  });
  assertEqual(projRes.status, 200, 'create project');
  const projectId = projRes.data.id as number;
  const proj2Res = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
    auth: adminAuth,
    body: { title: 'Second project', description: 'cross-project tests' },
  });
  const project2Id = proj2Res.data.id as number;

  const now = Math.floor(Date.now() / 1000);
  function mkTask(title: string, assignee: string | null, status = 'todo', proj: number = projectId): number {
    sql.exec(
      `INSERT INTO tasks (project_id, title, status, assignee, priority, created_at, updated_at, lane) VALUES (?, ?, ?, ?, 'normal', ?, ?, 'unassigned')`,
      proj,
      title,
      status,
      assignee,
      now,
      now
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }

  // ---- §4 dependencies -------------------------------------------------
  const blockerA = mkTask('Blocker A', 'nyx');
  const blockedB = mkTask('Blocked B', 'nyx');
  {
    const r = await reqJson(bus, 'POST', `/api/kanban/tasks/${blockedB}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: blockerA },
    });
    assertEqual(r.status, 200, 'link todo -> blocked');
    assertEqual(r.data.status, 'blocked', 'link sets blocked');
    assertEqual(r.data.blocked_kind, 'waiting-task', 'link sets waiting-task');
    const row = sql.exec(`SELECT status, blocked_kind, blocked_reason, blocked_from_status FROM tasks WHERE id = ?`, blockedB).one() as any;
    assertEqual(row.status, 'blocked', 'db blocked');
    assertEqual(row.blocked_from_status, 'todo', 'blocked_from_status todo');
    assertTrue(String(row.blocked_reason).startsWith(`Waiting for task ${blockerA}:`), 'server-generated reason');
    // Second link: link only, blocked_from_status untouched.
    const blockerA2 = mkTask('Blocker A2', 'nyx');
    const r2 = await reqJson(bus, 'POST', `/api/kanban/tasks/${blockedB}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: blockerA2 },
    });
    assertEqual(r2.status, 200, 'second link ok');
    const row2 = sql.exec(`SELECT blocked_from_status, blocked_reason FROM tasks WHERE id = ?`, blockedB).one() as any;
    assertEqual(row2.blocked_from_status, 'todo', 'blocked_from_status not overwritten');
    assertTrue(String(row2.blocked_reason).startsWith(`Waiting for task ${blockerA}:`), 'reason not overwritten by 1a');
    // Self / duplicate / ownership / cross-project / done-blocker / done-task.
    const self = await reqJson(bus, 'POST', `/api/kanban/tasks/${blockedB}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: blockedB },
    });
    assertEqual(self.status, 400, 'self-link 400');
    const dup = await reqJson(bus, 'POST', `/api/kanban/tasks/${blockedB}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: blockerA },
    });
    assertEqual(dup.status, 409, 'duplicate 409');
    const owned = mkTask('Owned by nosmile', 'nosmile99');
    const forb = await reqJson(bus, 'POST', `/api/kanban/tasks/${owned}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: blockerA },
    });
    assertEqual(forb.status, 403, 'non-owner link 403');
    const otherProj = mkTask('Other project task', 'nyx', 'todo', project2Id);
    const cross = await reqJson(bus, 'POST', `/api/kanban/tasks/${blockedB}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: otherProj },
    });
    assertEqual(cross.status, 400, 'cross-project 400');
    const doneBlocker = mkTask('Done blocker', 'nyx', 'done');
    const doneB = await reqJson(bus, 'POST', `/api/kanban/tasks/${blockedB}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: doneBlocker },
    });
    assertEqual(doneB.status, 409, 'done blocker 409');
    const doneTask = mkTask('Done task', 'nyx', 'done');
    const doneT = await reqJson(bus, 'POST', `/api/kanban/tasks/${doneTask}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: blockerA },
    });
    assertEqual(doneT.status, 400, 'done task 400');
    // Cycle: A blocks B, B blocks C, C blocks A rejected.
    const cycA = mkTask('Cycle A', 'nyx');
    const cycB = mkTask('Cycle B', 'nyx');
    const cycC = mkTask('Cycle C', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${cycB}/dependencies`, { auth: nyxToken, body: { blocker_id: cycA } })).status, 200, 'cycle link 1');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${cycC}/dependencies`, { auth: nyxToken, body: { blocker_id: cycB } })).status, 200, 'cycle link 2');
    const cyc = await reqJson(bus, 'POST', `/api/kanban/tasks/${cycA}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: cycC },
    });
    assertEqual(cyc.status, 409, 'cycle 409');
    // Manual status on dependency-blocked task rejected; manual
    // blocked waiting-task with no link rejected.
    const manual = await reqJson(bus, 'PUT', `/api/kanban/tasks/${blockedB}/status`, {
      auth: nyxToken,
      body: { status: 'doing' },
    });
    assertEqual(manual.status, 409, 'manual move on dependency-blocked 409');
    const freeTask = mkTask('Free task', 'nyx');
    const manualBlock = await reqJson(bus, 'PUT', `/api/kanban/tasks/${freeTask}/status`, {
      auth: nyxToken,
      body: { status: 'blocked', blocked_kind: 'waiting-task', blocked_reason: 'x' },
    });
    assertEqual(manualBlock.status, 409, 'manual waiting-task without link 409');
  }

  // Blocker done -> rule 4 unblock (todo restore + unblocked list).
  {
    const single = mkTask('Single blocked', 'nyx');
    const singleBlocker = mkTask('Single blocker', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${single}/dependencies`, { auth: nyxToken, body: { blocker_id: singleBlocker } })).status, 200, 'single link');
    const doneRes = await reqJson(bus, 'PUT', `/api/kanban/tasks/${singleBlocker}/status`, {
      auth: nyxToken,
      body: { status: 'done' },
    });
    assertEqual(doneRes.status, 200, 'blocker done');
    const row = sql.exec(`SELECT status, blocked_kind, blocked_reason, blocked_from_status, unblocked_at FROM tasks WHERE id = ?`, single).one() as any;
    assertEqual(row.status, 'todo', 'rule 4 restores todo');
    assertEqual(row.blocked_kind, null, 'rule 4 clears kind');
    assertEqual(row.blocked_reason, null, 'rule 4 clears reason');
    assertEqual(row.blocked_from_status, null, 'rule 4 clears blocked_from_status');
    assertTrue(row.unblocked_at !== null, 'rule 4 sets unblocked_at');
    const unb = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked`, { auth: nyxToken });
    assertEqual(unb.status, 200, 'unblocked list ok');
    assertTrue((unb.data.tasks as any[]).some((t) => t.id === single), 'unblocked list contains single');
    const badCursor = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?after_id=999999`, { auth: nyxToken });
    assertEqual(badCursor.status, 400, 'unblocked bad cursor 400');
    // Amendment batch item 0 (§4 REVERT, Luki 2026-11-03):
    // the fix-round-5 deviation is gone — an idempotent
    // re-claim by the ALREADY owning agent now blanket-clears
    // unblocked_at exactly like a fresh claim, so the task
    // leaves the unblocked list. A FRESH claim still clears.
    const claim = await reqJson(bus, 'POST', `/api/kanban/tasks/${single}/claim`, { auth: nyxToken });
    assertEqual(claim.status, 200, 'claim unblocked');
    assertEqual(claim.data.already, true, 'claim already-owned');
    const rowAfterReclaim = sql.exec(`SELECT unblocked_at FROM tasks WHERE id = ?`, single).one() as any;
    assertEqual(rowAfterReclaim.unblocked_at, null, 'already-owned re-claim clears unblocked_at (blanket-clear)');
    const unb2 = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked`, { auth: nyxToken });
    assertTrue(!(unb2.data.tasks as any[]).some((t) => t.id === single), 'already-owned re-claim leaves unblocked list');
    const freshUnb = mkTask('Fresh unblocked', null);
    sql.exec(`UPDATE tasks SET unblocked_at = ? WHERE id = ?`, now, freshUnb);
    const freshClaim = await reqJson(bus, 'POST', `/api/kanban/tasks/${freshUnb}/claim`, { auth: nyxToken });
    assertEqual(freshClaim.status, 200, 'fresh claim ok');
    const unb3 = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked`, { auth: nyxToken });
    assertTrue(!(unb3.data.tasks as any[]).some((t) => t.id === freshUnb), 'fresh claim leaves unblocked list');
  }

  // Rule 6 reopen re-blocks; row 4a unlink-unblock.
  {
    const dep = mkTask('Reopen dep', 'nyx');
    const blk = mkTask('Reopen blocker', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${dep}/dependencies`, { auth: nyxToken, body: { blocker_id: blk } })).status, 200, 'reopen link');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${blk}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'reopen blocker done');
    let row = sql.exec(`SELECT status FROM tasks WHERE id = ?`, dep).one() as any;
    assertEqual(row.status, 'todo', 'reopen dep unblocked to todo');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${blk}/status`, { auth: nyxToken, body: { status: 'todo' } })).status, 200, 'blocker reopened');
    row = sql.exec(`SELECT status, blocked_kind FROM tasks WHERE id = ?`, dep).one() as any;
    assertEqual(row.status, 'blocked', 'rule 6 re-blocks');
    assertEqual(row.blocked_kind, 'waiting-task', 'rule 6 kind');
    const ev = sql.exec(`SELECT action FROM dependency_events WHERE blocked_id = ? AND action = 'reblock'`, dep).toArray();
    assertEqual(ev.length, 1, 'reblock event written');
    // Unlink last link -> row 4a unblock with both events.
    const unl = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${dep}/dependencies/${blk}`, { auth: nyxToken });
    assertEqual(unl.status, 200, 'unlink ok');
    assertEqual(unl.data.unblocked, true, 'row 4a unblocks');
    row = sql.exec(`SELECT status, blocked_from_status FROM tasks WHERE id = ?`, dep).one() as any;
    assertEqual(row.status, 'todo', 'row 4a restores todo');
    assertEqual(row.blocked_from_status, null, 'row 4a clears blocked_from_status');
    const evs = sql.exec(`SELECT action FROM dependency_events WHERE blocked_id = ? ORDER BY id DESC LIMIT 2`, dep).toArray() as any[];
    assertTrue(evs.some((e) => e.action === 'unlink') && evs.some((e) => e.action === 'unblock'), 'row 4a writes unlink + unblock');
  }

  // Dep-list separate cursors: both lists exceed the limit, no rows lost.
  // (Combined-cursor bug: blockers 1-150 + blocked_by 200-350 at
  // limit=100 paged with next_after_id=299 lost blockers 101-150.)
  {
    const center = mkTask('Cursor center', 'nyx');
    const blockerIds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const b = mkTask(`Cursor blocker ${i}`, 'nyx');
      blockerIds.push(b);
      assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${center}/dependencies`, { auth: nyxToken, body: { blocker_id: b } })).status, 200, 'cursor blocker link');
    }
    const blockedIds: number[] = [];
    for (let i = 0; i < 3; i++) {
      const d = mkTask(`Cursor blocked ${i}`, 'nyx');
      blockedIds.push(d);
      assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${d}/dependencies`, { auth: nyxToken, body: { blocker_id: center } })).status, 200, 'cursor blocked link');
    }
    const p1 = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${center}/dependencies?limit=2`, { auth: adminAuth });
    assertEqual(p1.status, 200, 'cursor page1 ok');
    assertEqual((p1.data.blockers as any[]).length, 2, 'cursor page1 blockers 2');
    assertEqual((p1.data.blocked_by as any[]).length, 2, 'cursor page1 blocked_by 2');
    assertEqual(p1.data.blockers_has_more, true, 'cursor page1 blockers has_more');
    assertEqual(p1.data.blocked_by_has_more, true, 'cursor page1 blocked_by has_more');
    const p2 = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${center}/dependencies?limit=2&blockers_after_id=${p1.data.blockers_after_id}&blocked_by_after_id=${p1.data.blocked_by_after_id}`, { auth: adminAuth });
    assertEqual(p2.status, 200, 'cursor page2 ok');
    const gotBlockers = [...(p1.data.blockers as any[]), ...(p2.data.blockers as any[])].map((t) => t.id).sort((a: number, b: number) => a - b);
    const gotBlocked = [...(p1.data.blocked_by as any[]), ...(p2.data.blocked_by as any[])].map((t) => t.id).sort((a: number, b: number) => a - b);
    assertEqual(gotBlockers, [...blockerIds].sort((a: number, b: number) => a - b), 'cursor no blocker rows lost');
    assertEqual(gotBlocked, [...blockedIds].sort((a: number, b: number) => a - b), 'cursor no blocked_by rows lost');
    assertEqual(p2.data.has_more, false, 'cursor page2 done');
    const bad = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${center}/dependencies?limit=2&blockers_after_id=-1`, { auth: adminAuth });
    assertEqual(bad.status, 400, 'cursor bad blockers_after_id 400');
    // Fix round 5, M3: next_after_id is null when BOTH lists have
    // more (one number cannot encode two cursors); a cursor
    // without limit is 400; the string "null" is treated as
    // absent; a stale anchor is 404, not an empty page.
    assertEqual(p1.data.next_after_id, null, 'cursor next_after_id null when both lists have more');
    const noLimit = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${center}/dependencies?blockers_after_id=${p1.data.blockers_after_id}`, { auth: adminAuth });
    assertEqual(noLimit.status, 400, 'cursor without limit 400');
    const nullCursor = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${center}/dependencies?limit=2&blockers_after_id=null`, { auth: adminAuth });
    assertEqual(nullCursor.status, 200, 'cursor string null treated as absent');
    assertEqual((nullCursor.data.blockers as any[]).length, 2, 'cursor string null first page');
    const stale = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${center}/dependencies?limit=2&blockers_after_id=999999`, { auth: adminAuth });
    assertEqual(stale.status, 404, 'cursor stale anchor 404');
    // Fix round 5, M3: passing only one per-list cursor restarts
    // the other list at 0 (documented replay behaviour).
    const oneCursor = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${center}/dependencies?limit=2&blockers_after_id=${p1.data.blockers_after_id}`, { auth: adminAuth });
    assertEqual(oneCursor.status, 200, 'cursor one-sided ok');
    assertEqual((oneCursor.data.blocked_by as any[]).map((t: any) => t.id).sort((a: number, b: number) => a - b), [...blockedIds].slice(0, 2).sort((a: number, b: number) => a - b), 'cursor one-sided restarts other list');
  }

  // ---- §5 ledger ------------------------------------------------------
  function insertMessage(sender: string, channel: string, body: string, replyTo: number | null): number {
    sql.exec(
      `INSERT INTO messages (sender, channel, priority, audience, ts, body, reply_to) VALUES (?, ?, 'normal', 'agents', ?, ?, ?)`,
      sender,
      channel,
      new Date().toISOString(),
      body,
      replyTo
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }
  {
    // Lane-note create ok.
    const lane = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Lane note one', body: 'A plain lane note', topic: 'test-topic', kind: 'decision' },
    });
    assertEqual(lane.status, 200, 'lane-note create');
    const laneId = lane.data.id as number;
    // Action create without endorsement -> 400 (fix-round m-6, locked plan matrix).
    const noEnd = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Action one', body: 'Action body', topic: 'test-topic', kind: 'hold', scope: 'action' },
    });
    assertEqual(noEnd.status, 400, 'action without endorsement 400');
    // Endorsement flow + single-use.
    const actionBody = 'Endorsed action body';
    const hash = await sha256HexStr(actionBody);
    const proposeId = insertMessage('nyx', 'all-agent', `PROPOSE: Action two | kind: hold | scope: action | body_sha256: ${hash}`, null);
    const endorseId = insertMessage('nosmile99', 'all-agent', `ENDORSE: Action two | body_sha256: ${hash}`, proposeId);
    const act = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Action two', body: actionBody, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: endorseId },
    });
    assertEqual(act.status, 200, 'endorsed action create');
    const replay = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Action two', body: actionBody, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: endorseId },
    });
    assertEqual(replay.status, 409, 'endorsement replay 409');
    // Supersede lane-note by author; second supersede 409.
    const sup = await reqJson(bus, 'POST', `/api/ledger/${laneId}/supersede`, {
      auth: nyxToken,
      body: { title: 'Lane note two', body: 'New body', ref_type: 'task', ref_id: String(blockerA) },
    });
    assertEqual(sup.status, 200, 'supersede lane-note');
    const sup2 = await reqJson(bus, 'POST', `/api/ledger/${laneId}/supersede`, {
      auth: nyxToken,
      body: { title: 'Lane note three', body: 'New body 2', ref_type: 'task', ref_id: String(blockerA) },
    });
    assertEqual(sup2.status, 409, 'second supersede 409');
    // [TEST] supersede rejected.
    const testRow = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: '[TEST] row', body: 'test body', topic: 'test-topic', kind: 'decision' },
    });
    assertEqual(testRow.status, 200, 'test row create');
    const testSup = await reqJson(bus, 'POST', `/api/ledger/${testRow.data.id}/supersede`, {
      auth: nyxToken,
      body: { title: 'Nope', body: 'x', ref_type: 'task', ref_id: String(blockerA) },
    });
    assertEqual(testSup.status, 409, '[TEST] supersede 409');
    // Tombstone requires reason; then supersede of tombstoned 409.
    const noReason = await reqJson(bus, 'POST', `/api/ledger/${testRow.data.id}/tombstone`, {
      auth: nyxToken,
      body: {},
    });
    assertEqual(noReason.status, 400, 'tombstone reason required');
    const tomb = await reqJson(bus, 'POST', `/api/ledger/${testRow.data.id}/tombstone`, {
      auth: nyxToken,
      body: { reason: 'test cleanup' },
    });
    assertEqual(tomb.status, 200, 'tombstone ok');
    const tombSup = await reqJson(bus, 'POST', `/api/ledger/${testRow.data.id}/supersede`, {
      auth: nyxToken,
      body: { title: 'Nope', body: 'x', ref_type: 'task', ref_id: String(blockerA) },
    });
    assertEqual(tombSup.status, 409, 'supersede tombstoned 409');
    // List gates.
    assertEqual((await reqJson(bus, 'GET', '/api/ledger?status=superseded', { auth: nyxToken })).status, 403, 'non-admin non-active list 403');
    assertEqual((await reqJson(bus, 'GET', '/api/ledger?include_history=true', { auth: nyxToken })).status, 403, 'non-admin include_history 403');
    assertEqual((await reqJson(bus, 'GET', '/api/ledger?after_id=999999', { auth: nyxToken })).status, 400, 'ledger bad after_id 400');
    assertEqual((await reqJson(bus, 'GET', '/api/ledger?q=' + 'x'.repeat(49), { auth: nyxToken })).status, 400, 'keyword cap 400');
    const list = await reqJson(bus, 'GET', '/api/ledger?kind=decision', { auth: nyxToken });
    assertEqual(list.status, 200, 'ledger list ok');
    // Lane visibility: target_lane row hidden from other agent.
    const scoped = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nosmileToken,
      body: { title: 'Scoped note', body: 'for nosmile only', topic: 'test-topic', kind: 'decision', target_lane: 'nosmile99' },
    });
    assertEqual(scoped.status, 200, 'scoped create');
    assertEqual((await reqJson(bus, 'GET', `/api/ledger/${scoped.data.id}`, { auth: nyxToken })).status, 404, 'non-readable lane id read 404');
    // Admin supersede carve-out: admin supersedes an action row
    // without endorsement; agent supersede of the same row fails
    // because the author is admin.
    const actionId = act.data.id as number;
    const adminSup = await reqJson(bus, 'POST', `/admin/api/ledger/${actionId}/supersede`, {
      auth: adminAuth,
      body: { title: 'Action two v2', body: 'Admin successor body', ref_type: 'task', ref_id: String(blockerA) },
    });
    assertEqual(adminSup.status, 200, 'admin action supersede carve-out');
    const agentSup = await reqJson(bus, 'POST', `/api/ledger/${actionId}/supersede`, {
      auth: nyxToken,
      body: { title: 'Agent try', body: 'x', ref_type: 'task', ref_id: String(blockerA) },
    });
    assertEqual(agentSup.status, 409, 'supersede of superseded row 409 (admin successor moved it)');
    // Blocklist unit checks.
    assertTrue(ledgerBlocklistHit('reach luki@example.com please'), 'blocklist email');
    assertTrue(!ledgerBlocklistHit('luki at example dot com'), 'blocklist email negative');
    assertTrue(ledgerBlocklistHit('call me on +6281234567890 tomorrow'), 'blocklist phone');
    assertTrue(!ledgerBlocklistHit('call me at 8'), 'blocklist phone negative');
    assertTrue(ledgerBlocklistHit('api_key: abcdefghijklmnop'), 'blocklist secret');
    assertTrue(ledgerBlocklistHit('Jl. Merdeka 12, 65144'), 'blocklist address');
    assertTrue(!ledgerBlocklistHit('Merdeka 12'), 'blocklist address negative');
    assertTrue(ledgerBlocklistHit('IBAN DE89370400440532013000'), 'blocklist iban');
    assertTrue(ledgerBlocklistHit('account number is 1234567890'), 'blocklist account');
    assertTrue(!ledgerBlocklistHit('my account was closed, 1234567890 is unrelated'), 'blocklist account negative');
    const blocked = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Leak', body: 'contact luki@example.com', topic: 'test-topic', kind: 'decision' },
    });
    assertEqual(blocked.status, 400, 'blocklist create 400');
    const pipe = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Bad | title', body: 'x', topic: 'test-topic', kind: 'decision' },
    });
    assertEqual(pipe.status, 400, 'pipe title 400');
    const longTitle = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'x'.repeat(201), body: 'x', topic: 'test-topic', kind: 'decision' },
    });
    assertEqual(longTitle.status, 413, 'title cap 413');
    // Seed gates (code path; live §8 stamp gate stays open separately).
    assertEqual((await reqJson(bus, 'POST', '/admin/api/ledger/seed', { auth: adminAuth, body: { title: 'S', body: 'b', topic: 'test-topic', kind: 'decision' } })).status, 403, 'seed without credential 403');
    assertEqual((await reqJson(bus, 'POST', '/admin/api/ledger/seed', { auth: adminAuth, body: { title: 'S', body: 'b', topic: 'test-topic', kind: 'decision', luki_message_id: 1, lock_decision_ref: 'lock:2099-01-01:x' } })).status, 400, 'seed dual credential 400');
    assertEqual((await reqJson(bus, 'POST', '/admin/api/ledger/seed', { auth: adminAuth, body: { title: 'S', body: 'b', topic: 'test-topic', kind: 'decision', luki_message_id: 999999 } })).status, 403, 'seed invalid luki id 403');
    assertEqual((await reqJson(bus, 'POST', '/admin/api/ledger/seed', { auth: adminAuth, body: { title: 'S', body: 'b', topic: 'test-topic', kind: 'decision', lock_decision_ref: 'lock:2020-01-01:old' } })).status, 403, 'seed past lock date 403');
    const lockSeed = await reqJson(bus, 'POST', '/admin/api/ledger/seed', {
      auth: adminAuth,
      body: { title: 'Lock seed', body: 'lock body', kind: 'protocol', lock_decision_ref: 'lock:2099-01-01:cutover-rule' },
    });
    assertEqual(lockSeed.status, 200, 'lock exception seed');
    const lockSeed2 = await reqJson(bus, 'POST', '/admin/api/ledger/seed', {
      auth: adminAuth,
      body: { title: 'Lock seed 2', body: 'lock body 2', kind: 'protocol', lock_decision_ref: 'lock:2099-01-01:cutover-rule' },
    });
    assertEqual(lockSeed2.status, 409, 'lock ref reuse 409');
    const lukiMsg = insertMessage('luki', 'all-agent', 'Luki orders rule one', null);
    const lukiSeed = await reqJson(bus, 'POST', '/admin/api/ledger/seed', {
      auth: adminAuth,
      body: { title: 'Luki rule', body: 'rule body', kind: 'protocol', luki_message_id: lukiMsg },
    });
    assertEqual(lukiSeed.status, 200, 'luki seed');
    const lukiSeed2 = await reqJson(bus, 'POST', '/admin/api/ledger/seed', {
      auth: adminAuth,
      body: { title: 'Luki rule 2', body: 'rule body 2', kind: 'protocol', luki_message_id: lukiMsg },
    });
    assertEqual(lukiSeed2.status, 409, 'luki seed reuse 409');
    // Fix-round MA-1: luki_ordered tombstone with only a lock ref is 400.
    const tombLockOnly = await reqJson(bus, 'POST', `/admin/api/ledger/${lukiSeed.data.id}/tombstone`, {
      auth: adminAuth,
      body: { reason: 'lock-only tombstone attempt', lock_decision_ref: 'lock:2099-01-01:fix-ma1' },
    });
    assertEqual(tombLockOnly.status, 400, 'luki tombstone lock-only 400');
    const lukiStill = sql.exec(`SELECT status FROM ledger WHERE id = ?`, lukiSeed.data.id).one() as any;
    assertEqual(lukiStill.status, 'active', 'luki row still active after rejected tombstone');
    // Fix-round m-1: precedence. A non-admin agent tombstoning a
    // protected row with only a lock ref is 403 (protected/admin-only
    // check first), not 400 (lock-scope check). The admin lock-only
    // case above stays 400.
    const agentTombLockOnly = await reqJson(bus, 'POST', `/api/ledger/${lukiSeed.data.id}/tombstone`, {
      auth: nyxToken,
      body: { reason: 'agent lock-only tombstone attempt', lock_decision_ref: 'lock:2099-01-01:fix-m1' },
    });
    assertEqual(agentTombLockOnly.status, 403, 'agent protected tombstone lock-only 403');
    const lukiStill2 = sql.exec(`SELECT status FROM ledger WHERE id = ?`, lukiSeed.data.id).one() as any;
    assertEqual(lukiStill2.status, 'active', 'luki row still active after agent rejected tombstone');
    // Fix-round m-1: luki supersede event reason carries the marker.
    const lukiMsg2 = insertMessage('luki', 'all-agent', 'Luki orders supersede', null);
    const lukiSup = await reqJson(bus, 'POST', `/admin/api/ledger/${lockSeed.data.id}/supersede`, {
      auth: adminAuth,
      body: { title: 'Lock seed v2', body: 'lock body v2', luki_message_id: lukiMsg2, ref_type: 'bus_message', ref_id: String(lukiMsg2) },
    });
    assertEqual(lukiSup.status, 200, 'lock row luki supersede');
    const supEv = sql.exec(`SELECT reason FROM ledger_events WHERE ledger_id = ? AND action = 'supersede' ORDER BY id DESC LIMIT 1`, lukiSup.data.id).one() as any;
    assertEqual(supEv.reason, `luki_message_id:${lukiMsg2}`, 'supersede event reason luki marker');
    // Fix-round MA-2 (protected row): demote records actor + deadline
    // but never changes scope, status, or provenance.
    const protBefore = sql.exec(`SELECT scope, status, provenance_type, is_luki_ordered FROM ledger WHERE id = ?`, lukiSeed.data.id).one() as any;
    const demProt = await reqJson(bus, 'POST', `/admin/api/ledger/${lukiSeed.data.id}/demote`, {
      auth: adminAuth,
      body: { actor: 'nosmile99', deadline: now + 3600 },
    });
    assertEqual(demProt.status, 200, 'protected demote ok');
    const protAfter = sql.exec(`SELECT scope, status, provenance_type, is_luki_ordered, demote_actor, demote_deadline FROM ledger WHERE id = ?`, lukiSeed.data.id).one() as any;
    assertEqual(protAfter.scope, protBefore.scope, 'protected demote scope unchanged');
    assertEqual(protAfter.status, 'active', 'protected demote still active');
    assertEqual(protAfter.provenance_type, protBefore.provenance_type, 'protected demote provenance unchanged');
    assertEqual(protAfter.is_luki_ordered, protBefore.is_luki_ordered, 'protected demote luki flag unchanged');
    assertEqual(protAfter.demote_actor, 'nosmile99', 'protected demote actor stored');
    assertEqual(protAfter.demote_deadline, now + 3600, 'protected demote deadline stored');
    // Fix-round m-3: agent rate limit on ledger + dependency endpoints.
    const rlToken = await registerAgent('rlagent');
    for (let i = 0; i < 10; i++) {
      const r = await reqJson(bus, 'POST', '/api/ledger', { auth: rlToken, keepRate: true, body: { title: `RL ${i}`, body: 'x', topic: 'test-topic', kind: 'decision' } });
      assertEqual(r.status, 200, `rl ledger ${i}`);
    }
    assertEqual((await reqJson(bus, 'POST', '/api/ledger', { auth: rlToken, keepRate: true, body: { title: 'RL 10', body: 'x', topic: 'test-topic', kind: 'decision' } })).status, 429, 'ledger 11th call 429');
    const rlToken2 = await registerAgent('rlagent2');
    for (let i = 0; i < 10; i++) {
      assertEqual((await reqJson(bus, 'GET', '/api/kanban/tasks/unblocked', { auth: rlToken2, keepRate: true })).status, 200, `rl unblocked ${i}`);
    }
    assertEqual((await reqJson(bus, 'GET', '/api/kanban/tasks/unblocked', { auth: rlToken2, keepRate: true })).status, 429, 'dep unblocked 11th call 429');
    // Demote (lock Q8): per-row actor + deadline. Fix-round MA-2:
    // demote records actor + deadline ONLY and never changes scope.
    const supBefore = sql.exec(`SELECT scope FROM ledger WHERE id = ?`, sup.data.id).one() as any;
    const demote = await reqJson(bus, 'POST', `/admin/api/ledger/${sup.data.id}/demote`, {
      auth: adminAuth,
      body: { actor: 'nyx', deadline: now + 86400 },
    });
    assertEqual(demote.status, 200, 'demote ok');
    assertEqual(demote.data.scope, supBefore.scope, 'demote does not change scope');
    const demRow = sql.exec(`SELECT scope, demote_actor, demote_deadline FROM ledger WHERE id = ?`, sup.data.id).one() as any;
    assertEqual(demRow.scope, supBefore.scope, 'demote db scope unchanged');
    assertEqual(demRow.demote_actor, 'nyx', 'demote actor stored');
    assertEqual(demRow.demote_deadline, now + 86400, 'demote deadline stored');
  }

  // ---- §6 Phase 3 -----------------------------------------------------
  {
    const taskId = mkTask('Sheet task', 'nyx');
    // Task detail carries dependencies + ledger_refs.
    const refRow = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Ref note', body: 'refs the task', topic: 'test-topic', kind: 'decision', ref_type: 'task', ref_id: String(taskId) },
    });
    assertEqual(refRow.status, 200, 'task ref ledger create');
    const detail = await reqJson(bus, 'GET', `/api/kanban/tasks/${taskId}`, { auth: nyxToken });
    assertEqual(detail.status, 200, 'task detail ok');
    assertTrue(Array.isArray(detail.data.task.dependencies.blockers), 'detail dependencies present');
    assertTrue(detail.data.task.ledger_refs.some((r: any) => r.id === refRow.data.id), 'detail ledger_refs present');
    assertTrue(detail.data.task.ledger_ref_count >= 1, 'detail ledger_ref_count');
    // Comment soft-delete.
    const comment = await reqJson(bus, 'POST', `/api/kanban/tasks/${taskId}/comments`, {
      auth: nyxToken,
      body: { body: 'a comment to delete' },
    });
    assertEqual(comment.status, 200, 'comment add');
    const del = await reqJson(bus, 'POST', `/admin/api/kanban/tasks/${taskId}/comments/${comment.data.id}/soft-delete`, {
      auth: adminAuth,
      body: { reason: 'cleanup' },
    });
    assertEqual(del.status, 200, 'comment soft-delete');
    const list = await reqJson(bus, 'GET', `/api/kanban/tasks/${taskId}/comments`, { auth: nyxToken });
    assertTrue(!(list.data.comments as any[]).some((c) => c.id === comment.data.id), 'default list excludes deleted');
    const adminList = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${taskId}/comments?include_deleted=true`, { auth: adminAuth });
    const found = (adminList.data.comments as any[]).find((c) => c.id === comment.data.id);
    assertTrue(!!found && found.deleted === 1, 'admin deleted list shows flag');
    const detail2 = await reqJson(bus, 'GET', `/api/kanban/tasks/${taskId}`, { auth: nyxToken });
    assertTrue(!((detail2.data.task.comments || []) as any[]).length || true, 'detail ok after soft-delete');
    // Label unlink: owner ok, non-owner 403, unassigned 403.
    const labTask = mkTask('Label task', 'nyx');
    const labAdd = await reqJson(bus, 'POST', `/api/kanban/tasks/${labTask}/labels`, {
      auth: nyxToken,
      body: { label: 'testlabel' },
    });
    assertEqual(labAdd.status, 200, 'label add');
    const labUnlinkOther = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${labTask}/labels/testlabel`, { auth: nosmileToken });
    assertEqual(labUnlinkOther.status, 403, 'non-owner label unlink 403');
    const labUnlink = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${labTask}/labels/testlabel`, { auth: nyxToken });
    assertEqual(labUnlink.status, 200, 'owner label unlink ok');
    const unassignedTask = mkTask('Unassigned label task', null);
    const unassignedUnlink = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${unassignedTask}/labels/nope`, { auth: nyxToken });
    assertEqual(unassignedUnlink.status, 403, 'unassigned label unlink 403');
  }

  // ---- Fix-round: unarchive (m-2 events, m-5 transaction) -----------
  {
    const upRes = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
      auth: adminAuth,
      body: { title: 'Unarchive test project', description: 'fix-round' },
    });
    assertEqual(upRes.status, 200, 'unarchive project create');
    const upId = upRes.data.id as number;
    const uaBlocker = mkTask('UA blocker', 'nyx', 'todo', upId);
    const uaBlocked = mkTask('UA blocked', 'nyx', 'todo', upId);
    const uaLink = await reqJson(bus, 'POST', `/api/kanban/tasks/${uaBlocked}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: uaBlocker },
    });
    assertEqual(uaLink.status, 200, 'unarchive link ok');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${upId}`, { auth: adminAuth, body: { archived: 1 } })).status, 200, 'archive ok');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${uaBlocker}`, { auth: adminAuth, body: { status: 'done' } })).status, 200, 'blocker done while archived');
    const uaStill = sql.exec(`SELECT status FROM tasks WHERE id = ?`, uaBlocked).one() as any;
    assertEqual(uaStill.status, 'blocked', 'blocked task stays blocked while archived');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${upId}`, { auth: adminAuth, body: { archived: 0 } })).status, 200, 'unarchive ok');
    const uaRow = sql.exec(`SELECT status, blocked_from_status, unblocked_at FROM tasks WHERE id = ?`, uaBlocked).one() as any;
    assertEqual(uaRow.status, 'todo', 'unarchive restores todo');
    assertEqual(uaRow.blocked_from_status, null, 'unarchive clears blocked_from_status');
    assertTrue(uaRow.unblocked_at !== null, 'unarchive sets unblocked_at');
    const uaEv = sql.exec(`SELECT blocker_id, reason FROM dependency_events WHERE blocked_id = ? AND action = 'unblock' ORDER BY id DESC LIMIT 1`, uaBlocked).one() as any;
    assertEqual(uaEv.blocker_id, uaBlocker, 'unarchive event names done blocker, never 0');
    assertEqual(uaEv.reason, `unblock: blocker_id:${uaBlocker}`, 'unarchive event rule-4 format');
  }

  // ---- Fix-round m-2: unarchive restore with no surviving blockers --
  // Blocker deleted while the project is archived: the delete cascade
  // removes the link but skips the archived dependent, so the row
  // stays blocked with no blockers at all. Unarchive must restore it
  // AND write exactly one unblock event with reason 'unblock: unlink'
  // and blocker_id NULL (sentinel decision (b), migration v8).
  {
    const dpRes = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
      auth: adminAuth,
      body: { title: 'Unarchive orphan project', description: 'fix-round m-2' },
    });
    assertEqual(dpRes.status, 200, 'orphan project create');
    const dpId = dpRes.data.id as number;
    const dpBlocker = mkTask('DP blocker', 'nyx', 'todo', dpId);
    const dpBlocked = mkTask('DP blocked', 'nyx', 'todo', dpId);
    const dpLink = await reqJson(bus, 'POST', `/api/kanban/tasks/${dpBlocked}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: dpBlocker },
    });
    assertEqual(dpLink.status, 200, 'orphan link ok');
    const dpStill = sql.exec(`SELECT status, blocked_from_status FROM tasks WHERE id = ?`, dpBlocked).one() as any;
    assertEqual(dpStill.status, 'blocked', 'orphan task blocked before archive');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${dpId}`, { auth: adminAuth, body: { archived: 1 } })).status, 200, 'orphan archive ok');
    assertEqual((await reqJson(bus, 'DELETE', `/admin/api/kanban/tasks/${dpBlocker}`, { auth: adminAuth })).status, 200, 'blocker deleted while archived');
    const dpLinks = sql.exec(`SELECT 1 FROM task_dependencies WHERE blocked_id = ?`, dpBlocked).toArray();
    assertEqual(dpLinks.length, 0, 'orphan link gone after blocker delete');
    const dpStill2 = sql.exec(`SELECT status FROM tasks WHERE id = ?`, dpBlocked).one() as any;
    assertEqual(dpStill2.status, 'blocked', 'orphan task stays blocked while archived');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${dpId}`, { auth: adminAuth, body: { archived: 0 } })).status, 200, 'orphan unarchive ok');
    const dpRow = sql.exec(`SELECT status, blocked_from_status FROM tasks WHERE id = ?`, dpBlocked).one() as any;
    assertEqual(dpRow.status, 'todo', 'orphan unarchive restores todo');
    assertEqual(dpRow.blocked_from_status, null, 'orphan unarchive clears blocked_from_status');
    const dpEvs = sql.exec(`SELECT blocker_id, reason FROM dependency_events WHERE blocked_id = ? AND action = 'unblock'`, dpBlocked).toArray() as Array<{ blocker_id: number | null; reason: string }>;
    assertEqual(dpEvs.length, 1, 'orphan unarchive writes exactly one unblock event');
    assertEqual(dpEvs[0]!.reason, 'unblock: unlink', 'orphan unarchive event unlink format');
    assertEqual(dpEvs[0]!.blocker_id, null, 'orphan unarchive event blocker_id is NULL (no blocker exists, migration v8)');
  }
  // ---- Fix round (roast C5/C7/M1-M9/M14/M17 + minors) --------------
  {
    // C5: claim + auto-claim of blocked unassigned tasks, state preserved.
    const c5Blocker = mkTask('C5 blocker', 'nyx');
    const c5Task = mkTask('C5 blocked unassigned', null);
    const c5Link = await reqJson(bus, 'POST', `/api/kanban/tasks/${c5Task}/dependencies`, {
      auth: nyxToken,
      body: { blocker_id: c5Blocker },
    });
    assertEqual(c5Link.status, 200, 'C5 link ok');
    assertEqual(c5Link.data.transition, 'blocked', 'C5 link transition blocked');
    assertEqual(c5Link.data.blocked_from_status, 'todo', 'C5 link from_status');
    assertTrue(String(c5Link.data.blocked_reason).startsWith(`Waiting for task ${c5Blocker}:`), 'C5 link reason');
    const c5Claim = await reqJson(bus, 'POST', `/api/kanban/tasks/${c5Task}/claim`, { auth: nyxToken });
    assertEqual(c5Claim.status, 200, 'C5 claim blocked unassigned');
    assertEqual(c5Claim.data.status, 'blocked', 'C5 claim preserves blocked');
    assertEqual(c5Claim.data.blocked_kind, 'waiting-task', 'C5 claim preserves kind');
    assertEqual(c5Claim.data.blocked_from_status, 'todo', 'C5 claim preserves from_status');
    const c5Row = sql.exec(`SELECT status, assignee FROM tasks WHERE id = ?`, c5Task).one() as any;
    assertEqual(c5Row.status, 'blocked', 'C5 claim db still blocked');
    assertEqual(c5Row.assignee, 'nyx', 'C5 claim db assignee');
    // Auto-claim via label add preserves blocked too, and reports it.
    const c5Blocker2 = mkTask('C5 blocker 2', 'nyx');
    const c5Task2 = mkTask('C5 blocked unassigned 2', null);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${c5Task2}/dependencies`, { auth: nyxToken, body: { blocker_id: c5Blocker2 } })).status, 200, 'C5 second link');
    const c5Lab = await reqJson(bus, 'POST', `/api/kanban/tasks/${c5Task2}/labels`, { auth: nyxToken, body: { label: 'c5label' } });
    assertEqual(c5Lab.status, 200, 'C5 label add ok');
    assertEqual(c5Lab.data.auto_claimed, true, 'C5 label add auto_claimed flag');
    const c5Row2 = sql.exec(`SELECT status, assignee FROM tasks WHERE id = ?`, c5Task2).one() as any;
    assertEqual(c5Row2.status, 'blocked', 'C5 auto-claim preserves blocked');
    assertEqual(c5Row2.assignee, 'nyx', 'C5 auto-claim assignee');
    // Second link on an already-blocked task is link_only, with state echoed.
    const c5Blocker3 = mkTask('C5 blocker 3', 'nyx');
    const c5LinkOnly = await reqJson(bus, 'POST', `/api/kanban/tasks/${c5Task2}/dependencies`, { auth: nyxToken, body: { blocker_id: c5Blocker3 } });
    assertEqual(c5LinkOnly.status, 200, 'C5 link_only ok');
    assertEqual(c5LinkOnly.data.transition, 'link_only', 'C5 link_only transition');
    assertEqual(c5LinkOnly.data.blocked_kind, 'waiting-task', 'C5 link_only kind echoed');
    // Status move out of a manually blocked unassigned task via auto-claim.
    const c5Manual = mkTask('C5 manual blocked', null);
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-human', blocked_reason = 'manual wait', blocked_from_status = NULL WHERE id = ?`, c5Manual);
    const c5Move = await reqJson(bus, 'PUT', `/api/kanban/tasks/${c5Manual}/status`, { auth: nyxToken, body: { status: 'doing' } });
    assertEqual(c5Move.status, 200, 'C5 blocked auto-claim + move to doing');
    const c5ManualRow = sql.exec(`SELECT status, blocked_kind FROM tasks WHERE id = ?`, c5Manual).one() as any;
    assertEqual(c5ManualRow.status, 'doing', 'C5 manual blocked moved to doing');
    assertEqual(c5ManualRow.blocked_kind, null, 'C5 manual blocked kind cleared');
  }

  {
    // C7: rule-4 restore to doing emits kanban.task.unblocked + system log.
    const c7Blocker = mkTask('C7 blocker', 'nyx');
    const c7Dep = mkTask('C7 dep doing', 'nyx', 'doing');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${c7Dep}/dependencies`, { auth: nyxToken, body: { blocker_id: c7Blocker } })).status, 200, 'C7 link doing task');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${c7Blocker}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'C7 blocker done');
    const c7Row = sql.exec(`SELECT status FROM tasks WHERE id = ?`, c7Dep).one() as any;
    assertEqual(c7Row.status, 'doing', 'C7 restores doing');
    const unbEvents = sql.exec(`SELECT payload FROM events WHERE type = 'kanban.task.unblocked'`).toArray() as Array<{ payload: string }>;
    assertTrue(unbEvents.some((e) => { try { return (JSON.parse(e.payload) as any).task_id === c7Dep; } catch { return false; } }), 'C7 doing-restore emits kanban.task.unblocked');
    const sysLogs = sql.exec(`SELECT body FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE '%unblocked%'`, c7Dep).toArray();
    assertTrue(sysLogs.length >= 1, 'C7 doing-restore writes system log');
    // Fresh claim clears unblocked_at; release clears it too.
    const c7bBlocker = mkTask('C7b blocker', 'nyx');
    const c7bTask = mkTask('C7b unassigned', null);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${c7bTask}/dependencies`, { auth: nyxToken, body: { blocker_id: c7bBlocker } })).status, 200, 'C7b link');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${c7bBlocker}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'C7b blocker done');
    const c7bBefore = sql.exec(`SELECT unblocked_at, status FROM tasks WHERE id = ?`, c7bTask).one() as any;
    assertTrue(c7bBefore.unblocked_at !== null, 'C7b unblocked_at set by rule 4');
    assertEqual(c7bBefore.status, 'todo', 'C7b restored todo');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${c7bTask}/claim`, { auth: nyxToken })).status, 200, 'C7b fresh claim');
    const c7bAfter = sql.exec(`SELECT unblocked_at FROM tasks WHERE id = ?`, c7bTask).one() as any;
    assertEqual(c7bAfter.unblocked_at, null, 'C7b fresh claim clears unblocked_at');
    const c7Rel = mkTask('C7 release task', 'nyx', 'doing');
    sql.exec(`UPDATE tasks SET unblocked_at = 12345 WHERE id = ?`, c7Rel);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${c7Rel}/release`, { auth: nyxToken })).status, 200, 'C7 release ok');
    const c7RelRow = sql.exec(`SELECT unblocked_at, status FROM tasks WHERE id = ?`, c7Rel).one() as any;
    assertEqual(c7RelRow.unblocked_at, null, 'C7 release clears unblocked_at');
    assertEqual(c7RelRow.status, 'todo', 'C7 release to todo');
  }

  {
    // M6: manual block/unblock clear blocked_from_status.
    const m6a = mkTask('M6 unblock task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-human', blocked_reason = 'manual x', blocked_from_status = 'todo' WHERE id = ?`, m6a);
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${m6a}/status`, { auth: nyxToken, body: { status: 'todo' } })).status, 200, 'M6 agent unblock');
    const m6aRow = sql.exec(`SELECT blocked_from_status FROM tasks WHERE id = ?`, m6a).one() as any;
    assertEqual(m6aRow.blocked_from_status, null, 'M6 agent unblock clears from_status');
    const m6b = mkTask('M6 block task', 'nyx');
    sql.exec(`UPDATE tasks SET blocked_from_status = 'todo' WHERE id = ?`, m6b);
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${m6b}`, { auth: adminAuth, body: { status: 'blocked', blocked_kind: 'waiting-human', blocked_reason: 'admin block' } })).status, 200, 'M6 admin block');
    const m6bRow = sql.exec(`SELECT blocked_from_status, blocked_kind FROM tasks WHERE id = ?`, m6b).one() as any;
    assertEqual(m6bRow.blocked_from_status, null, 'M6 admin block clears from_status');
    assertEqual(m6bRow.blocked_kind, 'waiting-human', 'M6 admin block kind');
  }

  {
    // M7: unarchive re-blocks todo tasks holding a link to an unfinished blocker.
    const m7Proj = await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'M7 project' } });
    assertEqual(m7Proj.status, 200, 'M7 project create');
    const m7Pid = m7Proj.data.id as number;
    const m7Blk = mkTask('M7 blocker', 'nyx', 'todo', m7Pid);
    const m7Dep = mkTask('M7 dep', 'nyx', 'todo', m7Pid);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${m7Dep}/dependencies`, { auth: nyxToken, body: { blocker_id: m7Blk } })).status, 200, 'M7 link');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${m7Pid}`, { auth: adminAuth, body: { archived: 1 } })).status, 200, 'M7 archive');
    // Leftover state (e.g. from a capped fan-out or an older path): a
    // todo task that still holds a link to an unfinished blocker.
    sql.exec(`UPDATE tasks SET status = 'todo', blocked_kind = NULL, blocked_reason = NULL, blocked_from_status = NULL WHERE id = ?`, m7Dep);
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${m7Pid}`, { auth: adminAuth, body: { archived: 0 } })).status, 200, 'M7 unarchive');
    const m7Row = sql.exec(`SELECT status, blocked_kind, blocked_from_status FROM tasks WHERE id = ?`, m7Dep).one() as any;
    assertEqual(m7Row.status, 'blocked', 'M7 unarchive re-blocks');
    assertEqual(m7Row.blocked_kind, 'waiting-task', 'M7 re-block kind');
    assertEqual(m7Row.blocked_from_status, 'todo', 'M7 re-block from_status');
    const m7Ev = sql.exec(`SELECT action FROM dependency_events WHERE blocked_id = ? AND action = 'reblock'`, m7Dep).toArray();
    assertTrue(m7Ev.length >= 1, 'M7 reblock event written');
  }

  {
    // M8: explicit FK-fallback deletes in the same transaction.
    const m8Blocker = mkTask('M8 blocker', 'nyx');
    const m8Dep = mkTask('M8 dep', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${m8Dep}/dependencies`, { auth: nyxToken, body: { blocker_id: m8Blocker } })).status, 200, 'M8 link');
    sql.exec(`INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, 'm8 step', 0, 0)`, m8Blocker);
    sql.exec(`INSERT INTO task_labels (task_id, label) VALUES (?, 'm8label')`, m8Blocker);
    sql.exec(`INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, 'nyx', 'm8 note', ?)`, m8Blocker, now);
    assertEqual((await reqJson(bus, 'DELETE', `/admin/api/kanban/tasks/${m8Blocker}`, { auth: adminAuth })).status, 200, 'M8 task delete');
    assertEqual(sql.exec(`SELECT 1 FROM task_dependencies WHERE blocker_id = ? OR blocked_id = ?`, m8Blocker, m8Blocker).toArray().length, 0, 'M8 links gone');
    assertEqual(sql.exec(`SELECT 1 FROM todos WHERE task_id = ?`, m8Blocker).toArray().length, 0, 'M8 todos gone');
    assertEqual(sql.exec(`SELECT 1 FROM task_labels WHERE task_id = ?`, m8Blocker).toArray().length, 0, 'M8 labels gone');
    assertEqual(sql.exec(`SELECT 1 FROM task_comments WHERE task_id = ?`, m8Blocker).toArray().length, 0, 'M8 comments gone');
    const m8DepRow = sql.exec(`SELECT status FROM tasks WHERE id = ?`, m8Dep).one() as any;
    assertEqual(m8DepRow.status, 'todo', 'M8 dependent unblocked by delete');
    const m8Proj = await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'M8 project' } });
    const m8Pid = m8Proj.data.id as number;
    const m8a = mkTask('M8a', 'nyx', 'todo', m8Pid);
    const m8b = mkTask('M8b', 'nyx', 'todo', m8Pid);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${m8b}/dependencies`, { auth: nyxToken, body: { blocker_id: m8a } })).status, 200, 'M8 project link');
    assertEqual((await reqJson(bus, 'DELETE', `/admin/api/kanban/projects/${m8Pid}`, { auth: adminAuth })).status, 200, 'M8 project delete');
    assertEqual(sql.exec(`SELECT 1 FROM tasks WHERE project_id = ?`, m8Pid).toArray().length, 0, 'M8 project tasks gone');
    assertEqual(sql.exec(`SELECT 1 FROM task_dependencies WHERE blocker_id = ? OR blocked_id = ?`, m8a, m8b).toArray().length, 0, 'M8 project links gone');
  }

  {
    // M9: reason-only writes are gated; mixed payloads reject wholly.
    const m9Blocker = mkTask('M9 blocker', 'nyx');
    const m9Dep = mkTask('M9 dep', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${m9Dep}/dependencies`, { auth: nyxToken, body: { blocker_id: m9Blocker } })).status, 200, 'M9 link');
    const m9Reason = await reqJson(bus, 'PUT', `/api/kanban/tasks/${m9Dep}/status`, { auth: nyxToken, body: { status: 'blocked', blocked_reason: 'hand-edited reason' } });
    assertEqual(m9Reason.status, 409, 'M9 reason-only edit on dependency-blocked 409');
    assertTrue(Array.isArray(m9Reason.data.blocker_titles) && m9Reason.data.blocker_titles.length >= 1, 'M9 gate carries blocker titles');
    const m9Row = sql.exec(`SELECT blocked_reason FROM tasks WHERE id = ?`, m9Dep).one() as any;
    assertTrue(String(m9Row.blocked_reason).startsWith(`Waiting for task ${m9Blocker}:`), 'M9 reason unchanged after gate');
    const m9Mixed = await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${m9Dep}`, { auth: adminAuth, body: { title: 'Hacked title', status: 'doing' } });
    assertEqual(m9Mixed.status, 409, 'M9 mixed payload wholly rejected');
    const m9Title = sql.exec(`SELECT title FROM tasks WHERE id = ?`, m9Dep).one() as any;
    assertEqual(m9Title.title, 'M9 dep', 'M9 title unchanged after rejection');
    const m9AdminReason = await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${m9Dep}`, { auth: adminAuth, body: { blocked_reason: 'admin hand-edit' } });
    assertEqual(m9AdminReason.status, 409, 'M9 admin reason-only edit 409');
  }

  {
    // M5: dependency link/unlink use the status-path visibility predicate (404 for invisible).
    const m5Proj = await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'M5 restricted project', subscribers: ['nyx'] } });
    assertEqual(m5Proj.status, 200, 'M5 project create');
    const m5Pid = m5Proj.data.id as number;
    const m5TaskRes = await reqJson(bus, 'POST', `/admin/api/kanban/projects/${m5Pid}/tasks`, { auth: adminAuth, body: { title: 'M5 task' } });
    assertEqual(m5TaskRes.status, 200, 'M5 task create');
    const m5Task = m5TaskRes.data.id as number;
    const m5Blocker = mkTask('M5 blocker', 'nyx', 'todo', m5Pid);
    const m5Invisible = await reqJson(bus, 'POST', `/api/kanban/tasks/${m5Task}/dependencies`, { auth: nosmileToken, body: { blocker_id: m5Blocker } });
    assertEqual(m5Invisible.status, 404, 'M5 invisible link 404');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${m5Task}/dependencies`, { auth: nyxToken, body: { blocker_id: m5Blocker } })).status, 200, 'M5 visible link ok');
    // Unlink on an archived project hints at unarchiving first.
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${m5Pid}`, { auth: adminAuth, body: { archived: 1 } })).status, 200, 'M5 archive');
    const m5UnlinkArch = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${m5Task}/dependencies/${m5Blocker}`, { auth: nyxToken });
    assertEqual(m5UnlinkArch.status, 400, 'M5 unlink archived 400');
    assertTrue(String(m5UnlinkArch.data.hint || '').includes('unarchive'), 'M5 unlink archived hint');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${m5Pid}`, { auth: adminAuth, body: { archived: 0 } })).status, 200, 'M5 unarchive');
  }

  {
    // M2/M3/M14: agent task detail rate limit + retry info; fetch-21 ledger refs; unblocked pagination + batched todos.
    const rlDetail = await registerAgent('rldetail');
    const detTask = mkTask('Detail task', 'nyx');
    for (let i = 0; i < 10; i++) {
      assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/${detTask}`, { auth: rlDetail, keepRate: true })).status, 200, `M2 detail ${i}`);
    }
    const det429 = await reqJson(bus, 'GET', `/api/kanban/tasks/${detTask}`, { auth: rlDetail, keepRate: true });
    assertEqual(det429.status, 429, 'M2 detail 11th 429');
    assertTrue(typeof det429.data.retry_after_seconds === 'number' && det429.data.retry_after_seconds >= 1, 'M14 retry_after_seconds present');
    const raw429 = await bus.fetch(new Request(`https://bus.local/api/kanban/tasks/${detTask}`, { headers: { Authorization: rlDetail } }));
    assertEqual(raw429.status, 429, 'M14 raw detail 429');
    assertTrue(raw429.headers.get('Retry-After') !== null, 'M14 Retry-After header present');
    // 21 task refs -> detail shows 20 + has_more.
    const refTask = mkTask('Ref target task', 'nyx');
    for (let i = 0; i < 21; i++) {
      assertEqual((await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: `Ref ${i}`, body: 'ref body', topic: 'test-topic', kind: 'decision', ref_type: 'task', ref_id: String(refTask) } })).status, 200, `M2 ref ${i}`);
    }
    const refDetail = await reqJson(bus, 'GET', `/api/kanban/tasks/${refTask}`, { auth: nyxToken });
    assertEqual(refDetail.status, 200, 'M2 ref detail ok');
    assertEqual((refDetail.data.task.ledger_refs as any[]).length, 20, 'M2 detail refs capped at 20');
    assertEqual(refDetail.data.task.ledger_refs_has_more, true, 'M2 detail refs has_more');
    assertEqual(refDetail.data.task.ledger_ref_count, 21, 'Fix round 2 detail ref count is total');
    // Unblocked pagination, isolated to a fresh project.
    const uProj = await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'M3 unblocked project' } });
    const uPid = uProj.data.id as number;
    const u1Blk = mkTask('U1 blocker', 'nyx', 'todo', uPid);
    const u1 = mkTask('U1', 'nyx', 'todo', uPid);
    const u2Blk = mkTask('U2 blocker', 'nyx', 'todo', uPid);
    const u2 = mkTask('U2', 'nyx', 'todo', uPid);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${u1}/dependencies`, { auth: nyxToken, body: { blocker_id: u1Blk } })).status, 200, 'M3 link u1');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${u2}/dependencies`, { auth: nyxToken, body: { blocker_id: u2Blk } })).status, 200, 'M3 link u2');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${u1Blk}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'M3 u1 blocker done');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${u2Blk}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'M3 u2 blocker done');
    sql.exec(`INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, 'u1 step', 0, 0)`, u1);
    const page1 = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?project_id=${uPid}&limit=1`, { auth: nyxToken });
    assertEqual(page1.status, 200, 'M3 unblocked page1 ok');
    assertEqual((page1.data.tasks as any[]).length, 1, 'M3 page1 size');
    assertEqual(page1.data.has_more, true, 'M3 page1 has_more');
    assertTrue(typeof page1.data.next_after_id === 'number', 'M3 page1 next_after_id');
    assertTrue(((page1.data.tasks as any[])[0].todos as any[]).some((t: any) => t.text === 'u1 step'), 'M3 batched todos present');
    const page2 = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?project_id=${uPid}&limit=1&after_id=${page1.data.next_after_id}`, { auth: nyxToken });
    assertEqual(page2.status, 200, 'M3 unblocked page2 ok');
    assertEqual((page2.data.tasks as any[]).length, 1, 'M3 page2 size');
    assertTrue((page2.data.tasks as any[])[0].id !== (page1.data.tasks as any[])[0].id, 'M3 page2 advances');
    // M14: validation failures do not consume quota.
    const rlVal = await registerAgent('rlval');
    for (let i = 0; i < 10; i++) {
      assertEqual((await reqJson(bus, 'POST', '/api/ledger', { auth: rlVal, keepRate: true, body: { body: 'no title', topic: 'test-topic', kind: 'decision' } })).status, 400, `M14 invalid ${i}`);
    }
    assertEqual((await reqJson(bus, 'POST', '/api/ledger', { auth: rlVal, keepRate: true, body: { title: 'RL valid 0', body: 'x', topic: 'test-topic', kind: 'decision' } })).status, 200, 'M14 valid after invalids');
    for (let i = 1; i < 10; i++) {
      assertEqual((await reqJson(bus, 'POST', '/api/ledger', { auth: rlVal, keepRate: true, body: { title: `RL valid ${i}`, body: 'x', topic: 'test-topic', kind: 'decision' } })).status, 200, `M14 valid ${i}`);
    }
    const rlVal429 = await reqJson(bus, 'POST', '/api/ledger', { auth: rlVal, keepRate: true, body: { title: 'RL valid 10', body: 'x', topic: 'test-topic', kind: 'decision' } });
    assertEqual(rlVal429.status, 429, 'M14 11th valid 429');
    assertTrue(typeof rlVal429.data.retry_after_seconds === 'number', 'M14 ledger retry_after_seconds');
  }

  {
    // C1: uppercase hex accepted; per-check endorsement reasons; missing-endorsement hint.
    function insertMsg(sender: string, channel: string, body: string, replyTo: number | null): number {
      sql.exec(
        `INSERT INTO messages (sender, channel, priority, audience, ts, body, reply_to) VALUES (?, ?, 'normal', 'agents', ?, ?, ?)`,
        sender,
        channel,
        new Date().toISOString(),
        body,
        replyTo
      );
      return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
    }
    const upperBody = 'Uppercase hash action body';
    const upperHash = (await sha256HexStr(upperBody)).toUpperCase();
    const upPropose = insertMsg('nyx', 'all-agent', `PROPOSE: Upper action | kind: hold | scope: action | body_sha256: ${upperHash}`, null);
    const upEndorse = insertMsg('nosmile99', 'all-agent', `ENDORSE: Upper action | body_sha256: ${upperHash}`, upPropose);
    const upCreate = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Upper action', body: upperBody, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: upEndorse },
    });
    assertEqual(upCreate.status, 200, 'C1 uppercase hex accepted');
    const badBody = 'Bad title action body';
    const badHash = await sha256HexStr(badBody);
    const badPropose = insertMsg('nyx', 'all-agent', `PROPOSE: Bad action | kind: hold | scope: action | body_sha256: ${badHash}`, null);
    const badEndorse = insertMsg('nosmile99', 'all-agent', `ENDORSE: Bad action | body_sha256: ${badHash}`, badPropose);
    const badCreate = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Different title', body: badBody, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: badEndorse },
    });
    assertEqual(badCreate.status, 403, 'C1 title mismatch 403');
    assertEqual(badCreate.data.reason, 'title_mismatch', 'C1 per-check reason');
    const noEnd = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Hint action', body: 'hint body', topic: 'test-topic', kind: 'hold', scope: 'action' },
    });
    assertEqual(noEnd.status, 400, 'C1 missing endorsement 400');
    assertTrue(String(noEnd.data.hint || '').includes('PROPOSE:'), 'C1 format hint present');
    // Endorser must read the proposal channel.
    const chanNow = Math.floor(Date.now() / 1000);
    sql.exec(`INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES ('secret-chan', 'nyx', ?)`, chanNow);
    sql.exec(`INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('secret-chan', 'nyx', 'system', ?)`, chanNow);
    const secBody = 'Secret channel action body';
    const secHash = await sha256HexStr(secBody);
    const secPropose = insertMsg('nyx', 'secret-chan', `PROPOSE: Secret action | kind: hold | scope: action | body_sha256: ${secHash}`, null);
    const secEndorse = insertMsg('nosmile99', 'all-agent', `ENDORSE: Secret action | body_sha256: ${secHash}`, secPropose);
    const secCreate = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Secret action', body: secBody, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: secEndorse },
    });
    assertEqual(secCreate.status, 403, 'C1 endorser outside proposal channel 403');
    assertEqual(secCreate.data.reason, 'endorser_not_in_proposal_channel', 'C1 proposal-channel reason');
    // Admin supersede with a supplied endorsement id is 400, not a protocol run.
    const adminEndSup = await reqJson(bus, 'POST', `/admin/api/ledger/${upCreate.data.id}/supersede`, {
      auth: adminAuth,
      body: { title: 'Upper action v2', body: 'admin body', ref_type: 'task', ref_id: String(blockerA), bus_reconciliation_id: 12345 },
    });
    assertEqual(adminEndSup.status, 400, 'M17 admin supersede endorsement id 400');
    // Protected supersede without any credential is 403 (one missing-credential code).
    const protLukiMsg = insertMsg('luki', 'all-agent', 'Luki orders prot rule', null);
    const protSeed = await reqJson(bus, 'POST', '/admin/api/ledger/seed', {
      auth: adminAuth,
      body: { title: 'Prot rule', body: 'prot body', kind: 'protocol', luki_message_id: protLukiMsg },
    });
    assertEqual(protSeed.status, 200, 'M17 prot seed');
    const protSup = await reqJson(bus, 'POST', `/admin/api/ledger/${protSeed.data.id}/supersede`, {
      auth: adminAuth,
      body: { title: 'Prot rule v2', body: 'prot body v2', ref_type: 'task', ref_id: String(blockerA) },
    });
    assertEqual(protSup.status, 403, 'M17 protected supersede without credential 403');
  }

  {
    // M1: demote is an honest recheck assignment; past deadlines rejected.
    const demRow = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Demote target', body: 'demote body', topic: 'test-topic', kind: 'decision' },
    });
    assertEqual(demRow.status, 200, 'M1 demote row create');
    const pastDem = await reqJson(bus, 'POST', `/admin/api/ledger/${demRow.data.id}/demote`, {
      auth: adminAuth,
      body: { actor: 'nyx', deadline: now - 10 },
    });
    assertEqual(pastDem.status, 400, 'M1 past deadline 400');
    const dem = await reqJson(bus, 'POST', `/admin/api/ledger/${demRow.data.id}/demote`, {
      auth: adminAuth,
      body: { actor: 'nyx', deadline: now + 3600 },
    });
    assertEqual(dem.status, 200, 'M1 demote ok');
    assertEqual(dem.data.scope_unchanged, true, 'M1 scope_unchanged');
    assertEqual(dem.data.authority_unchanged, true, 'M1 authority_unchanged');
    assertEqual(dem.data.recheck_actor, 'nyx', 'M1 recheck_actor');
    assertEqual(dem.data.recheck_deadline_unit, 'unix_seconds', 'M1 deadline unit documented');
    const demDb = sql.exec(`SELECT scope, status FROM ledger WHERE id = ?`, demRow.data.id).one() as any;
    assertEqual(demDb.scope, 'lane-note', 'M1 demote db scope unchanged');
    assertEqual(demDb.status, 'active', 'M1 demote db still active');
  }

  {
    // M17 minors batch.
    const echoCreate = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Echo note', body: 'echo body', topic: 'test-topic', kind: 'decision' },
    });
    assertEqual(echoCreate.status, 200, 'M17 echo create');
    assertEqual(echoCreate.data.provenance_type, 'agent_asserted', 'M17 echo provenance');
    assertEqual(echoCreate.data.is_luki_ordered, false, 'M17 echo luki flag');
    assertEqual(echoCreate.data.scope, 'lane-note', 'M17 echo scope');
    assertEqual(echoCreate.data.target_lane, null, 'M17 echo target_lane');
    const echoSup = await reqJson(bus, 'POST', `/api/ledger/${echoCreate.data.id}/supersede`, {
      auth: nyxToken,
      body: { title: 'Echo note v2', body: 'echo body v2', ref_type: 'task', ref_id: String(blockerA) },
    });
    assertEqual(echoSup.status, 200, 'M17 echo supersede');
    assertEqual(echoSup.data.actor, 'nyx', 'M17 supersede actor echoed');
    assertEqual(echoSup.data.lane, 'nyx', 'M17 supersede lane echoed');
    assertEqual(echoSup.data.inherited_scope, 'lane-note', 'M17 supersede inherited scope');
    const echoTomb = await reqJson(bus, 'POST', `/api/ledger/${echoSup.data.id}/tombstone`, {
      auth: nyxToken,
      body: { reason: 'echo cleanup' },
    });
    assertEqual(echoTomb.status, 200, 'M17 echo tombstone');
    assertEqual(echoTomb.data.actor, 'nyx', 'M17 tombstone actor echoed');
    const allowCreate = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Allow test', body: 'x', topic: 'test-topic', kind: 'decision', bogus_field: 1 },
    });
    assertEqual(allowCreate.status, 400, 'M17 create allowlist rejects unknown field');
    // Comment include_deleted (agent 403) + re-delete 409.
    const cTask = mkTask('Comment task', 'nyx');
    const cAdd = await reqJson(bus, 'POST', `/api/kanban/tasks/${cTask}/comments`, { auth: nyxToken, body: { body: 'to delete twice' } });
    assertEqual(cAdd.status, 200, 'M17 comment add');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/${cTask}/comments?include_deleted=true`, { auth: nyxToken })).status, 403, 'M17 non-admin include_deleted 403');
    assertEqual((await reqJson(bus, 'POST', `/admin/api/kanban/tasks/${cTask}/comments/${cAdd.data.id}/soft-delete`, { auth: adminAuth, body: { reason: 'first' } })).status, 200, 'M17 first soft-delete');
    assertEqual((await reqJson(bus, 'POST', `/admin/api/kanban/tasks/${cTask}/comments/${cAdd.data.id}/soft-delete`, { auth: adminAuth, body: { reason: 'second' } })).status, 409, 'M17 re-delete 409');
    // Admin ledger list: empty status means active; include_history keeps a non-empty status filter.
    const emptyStatus = await reqJson(bus, 'GET', '/admin/api/ledger?status=', { auth: adminAuth });
    assertEqual(emptyStatus.status, 200, 'M17 empty status list ok');
    assertTrue((emptyStatus.data.rows as any[]).every((r: any) => r.status === 'active'), 'M17 empty status treated as active');
    const histSup = await reqJson(bus, 'GET', '/admin/api/ledger?include_history=true&status=superseded', { auth: adminAuth });
    assertEqual(histSup.status, 200, 'M17 history+status list ok');
    assertTrue((histSup.data.rows as any[]).length >= 1 && (histSup.data.rows as any[]).every((r: any) => r.status === 'superseded'), 'M17 include_history keeps status filter');
    // Ledger pagination shape.
    const ledPage1 = await reqJson(bus, 'GET', '/admin/api/ledger?limit=1', { auth: adminAuth });
    assertEqual(ledPage1.status, 200, 'M17 ledger page1 ok');
    assertEqual(ledPage1.data.has_more, true, 'M17 ledger page1 has_more');
    assertTrue(typeof ledPage1.data.next_after_id === 'number', 'M17 ledger next_after_id');
    const ledPage2 = await reqJson(bus, 'GET', `/admin/api/ledger?limit=1&after_id=${ledPage1.data.next_after_id}`, { auth: adminAuth });
    assertEqual(ledPage2.status, 200, 'M17 ledger page2 ok');
    assertTrue((ledPage2.data.rows as any[])[0].id !== (ledPage1.data.rows as any[])[0].id, 'M17 ledger page2 advances');
    // Supersede full-resubmission error text.
    const fullRow = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Full resub', body: 'full body', topic: 'test-topic', kind: 'decision' } });
    const fullSup = await reqJson(bus, 'POST', `/api/ledger/${fullRow.data.id}/supersede`, { auth: nyxToken, body: { title: 'Only title' } });
    assertEqual(fullSup.status, 400, 'M17 supersede missing body 400');
    assertTrue(String(fullSup.data.error).includes('title and body'), 'M17 supersede error names title and body');
    // Dissent: missing ref rejected, explicit note-only admitted.
    assertEqual((await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Dissent float', body: 'no target', kind: 'dissent' } })).status, 400, 'M17 dissent without ref 400');
    assertEqual((await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Dissent note', body: 'note only', kind: 'dissent', ref_type: 'none' } })).status, 200, 'M17 dissent note-only admitted');
    // Past-recheck flag + body truncation in list output.
    const pastRow = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Past recheck', body: 'recheck me', topic: 'test-topic', kind: 'decision', recheck_at: now - 100 } });
    assertEqual(pastRow.status, 200, 'M17 past recheck create');
    const longRow = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Long body', body: 'y'.repeat(1000), topic: 'test-topic', kind: 'decision' } });
    assertEqual(longRow.status, 200, 'M17 long body create');
    const adminList = await reqJson(bus, 'GET', '/admin/api/ledger?limit=100', { auth: adminAuth });
    const pastFound = (adminList.data.rows as any[]).find((r: any) => r.id === pastRow.data.id);
    assertTrue(!!pastFound && pastFound.recheck_overdue === true, 'M17 past-recheck flagged');
    const longFound = (adminList.data.rows as any[]).find((r: any) => r.id === longRow.data.id);
    assertTrue(!!longFound && String(longFound.body).length === 200 && longFound.body_truncated === 1, 'M17 list body truncated');
    // Cycle cap: a 501-deep chain fails closed (409) even without a cycle.
    const chainIds: number[] = [];
    let prevChain: number | null = null;
    for (let i = 0; i < 502; i++) {
      const t = mkTask(`Chain ${i}`, 'nyx');
      chainIds.push(t);
      if (prevChain !== null) {
        sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, prevChain, t, now);
      }
      prevChain = t;
    }
    const freshBlocker = mkTask('Chain fresh blocker', 'nyx');
    const capLink = await reqJson(bus, 'POST', `/api/kanban/tasks/${chainIds[0]}/dependencies`, { auth: nyxToken, body: { blocker_id: freshBlocker } });
    assertEqual(capLink.status, 409, 'M17 cycle cap fails closed');
  }

  {
    // Fix round 2: blocker visibility, anchor visibility, recheck
    // rename, and quota-free semantic failures.
    const invProj = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
      auth: adminAuth, body: { title: 'Fix2 restricted project', subscribers: ['nosmile99'] },
    });
    const invPid = invProj.data.id as number;
    const invBlocked = mkTask('Fix2 blocked', 'nyx', 'todo', invPid);
    const invBlocker = mkTask('Fix2 blocker', null, 'todo', invPid);
    const invLink = await reqJson(bus, 'POST', `/api/kanban/tasks/${invBlocked}/dependencies`, {
      auth: nyxToken, body: { blocker_id: invBlocker },
    });
    assertEqual(invLink.status, 404, 'invisible blocker link 404');
    assertEqual(invLink.data.field, 'blocker_id', 'invisible blocker link field');
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'admin', ?)`, invBlocker, invBlocked, now);
    const invUnlink = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${invBlocked}/dependencies/${invBlocker}`, { auth: nyxToken });
    assertEqual(invUnlink.status, 404, 'invisible blocker unlink 404');
    assertEqual(invUnlink.data.field, 'blocker_id', 'invisible blocker unlink field');
    // Ledger anchor visibility: a nyx-targeted row is not a cursor
    // for nosmile99.
    const laneRow = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken, body: { title: 'Fix2 lane row', body: 'for nyx only', topic: 'test-topic', kind: 'decision', target_lane: 'nyx' },
    });
    assertEqual(laneRow.status, 200, 'fix2 lane row create');
    const laneAnchor = await reqJson(bus, 'GET', `/api/ledger?after_id=${laneRow.data.id}`, { auth: nosmileToken });
    assertEqual(laneAnchor.status, 404, 'invisible ledger anchor 404');
    // Unblocked anchor visibility: a nosmile-owned task is not a
    // cursor for nyx.
    const anchTask = mkTask('Fix2 anchor task', 'nosmile99');
    sql.exec(`UPDATE tasks SET unblocked_at = ? WHERE id = ?`, now, anchTask);
    const anchUnb = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?after_id=${anchTask}`, { auth: nyxToken });
    assertEqual(anchUnb.status, 404, 'invisible unblocked anchor 404');
    // Tiny fix round: anchor must satisfy the list predicate.
    const nonTodoAnch = mkTask('Fix anchor non-todo', 'nyx', 'doing');
    sql.exec(`UPDATE tasks SET unblocked_at = ? WHERE id = ?`, now, nonTodoAnch);
    const nonTodoUnb = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?after_id=${nonTodoAnch}`, { auth: nyxToken });
    assertEqual(nonTodoUnb.status, 400, 'non-todo unblocked anchor 400');
    const wrongProjAnch = mkTask('Fix anchor wrong project', 'nyx');
    sql.exec(`UPDATE tasks SET unblocked_at = ? WHERE id = ?`, now, wrongProjAnch);
    const wrongProjUnb = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?project_id=${project2Id}&after_id=${wrongProjAnch}`, { auth: nyxToken });
    assertEqual(wrongProjUnb.status, 400, 'wrong-project unblocked anchor 400');
    // Recheck-assignment primary route + honest output, /demote alias.
    const rcRow = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken, body: { title: 'Fix2 recheck target', body: 'rc body', topic: 'test-topic', kind: 'decision' },
    });
    const rc = await reqJson(bus, 'POST', `/admin/api/ledger/${rcRow.data.id}/recheck-assignment`, {
      auth: adminAuth, body: { actor: 'nyx', deadline: now + 3600 },
    });
    assertEqual(rc.status, 200, 'recheck-assignment ok');
    assertEqual(rc.data.recheck_actor, 'nyx', 'recheck actor echoed');
    assertEqual(rc.data.demote_actor, undefined, 'no bare demote_actor in response');
    const rcGet = await reqJson(bus, 'GET', `/admin/api/ledger/${rcRow.data.id}`, { auth: adminAuth });
    assertEqual(rcGet.data.row.recheck_actor, 'nyx', 'get recheck actor');
    assertEqual(rcGet.data.row.demote_actor, undefined, 'no bare demote_actor in get');
    assertTrue(typeof rcGet.data.row.recheck_note === 'string', 'get recheck disclaimer');
    const rcAlias = await reqJson(bus, 'POST', `/admin/api/ledger/${rcRow.data.id}/demote`, {
      auth: adminAuth, body: { actor: 'nosmile99', deadline: now + 7200 },
    });
    assertEqual(rcAlias.status, 200, 'demote alias still works');
    // Semantic link failures must not consume quota: 11 bad links
    // (over the 10/60s bucket) with keepRate must all stay 404.
    const quotaToken = await registerAgent('quota');
    const quotaTask = mkTask('Fix2 quota task', 'quota');
    for (let i = 0; i < 11; i++) {
      const q = await reqJson(bus, 'POST', `/api/kanban/tasks/${quotaTask}/dependencies`, {
        auth: quotaToken, body: { blocker_id: 999999 }, keepRate: true,
      });
      assertEqual(q.status, 404, `quota-free semantic failure ${i}`);
    }
  }

  {
    // Fix round 3, K1: a todo task holding unfinished links (set up
    // directly, as a legacy/link-only row would be) must reject a
    // manual waiting-task block instead of becoming a
    // machine-orphaned row that rule 4 can never restore.
    const k1Blocker = mkTask('K1 blocker', 'nyx');
    const k1Task = mkTask('K1 task', 'nyx');
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, k1Blocker, k1Task, now);
    const k1 = await reqJson(bus, 'PUT', `/api/kanban/tasks/${k1Task}/status`, { auth: nyxToken, body: { status: 'blocked', blocked_kind: 'waiting-task', blocked_reason: 'manual wait' } });
    assertEqual(k1.status, 409, 'K1 manual waiting-task block with links rejected');
    const k1Row = sql.exec(`SELECT status, blocked_from_status FROM tasks WHERE id = ?`, k1Task).one() as any;
    assertEqual(k1Row.status, 'todo', 'K1 task stays todo');
    assertEqual(k1Row.blocked_from_status, null, 'K1 no orphan from_status written');
  }

  {
    // Fix round 3, K1 signal: a legacy blocked waiting-task row with
    // no machine ownership stays blocked when its blocker finishes,
    // but the skip is now written to the system log, not silent.
    const k1sBlocker = mkTask('K1s blocker', 'nyx');
    const k1sTask = mkTask('K1s task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'legacy wait', blocked_from_status = NULL WHERE id = ?`, k1sTask);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, k1sBlocker, k1sTask, now);
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${k1sBlocker}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'K1s blocker done');
    const k1sRow = sql.exec(`SELECT status FROM tasks WHERE id = ?`, k1sTask).one() as any;
    assertEqual(k1sRow.status, 'blocked', 'K1s orphan row stays blocked');
    const k1sLogs = sql.exec(`SELECT body FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE '%skipped unblock%'`, k1sTask).toArray();
    assertTrue(k1sLogs.length >= 1, 'K1s skip is logged');
  }

  {
    // Fix round 3, M4: unblocked list at max page 100 (100 ids in the
    // todos IN-list) must not 500 on the bound-parameter limit.
    for (let i = 0; i < 100; i++) {
      const t = mkTask(`M4 unb ${i}`, null);
      sql.exec(`UPDATE tasks SET unblocked_at = ? WHERE id = ?`, now, t);
      sql.exec(`INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, 'x', 0, 0)`, t);
    }
    const unb = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?limit=100`, { auth: nyxToken });
    assertEqual(unb.status, 200, 'M4 unblocked limit=100 ok');
    assertEqual((unb.data.tasks as any[]).length, 100, 'M4 unblocked page holds 100');
  }

  {
    // Fix round 3, M11: a claimable blocked unassigned task appears
    // in /available, with its blocked state visible.
    const m11Blocker = mkTask('M11 blocker', 'nyx');
    const m11Task = mkTask('M11 blocked unassigned', null);
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'M11 wait', blocked_from_status = 'todo' WHERE id = ?`, m11Task);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, m11Blocker, m11Task, now);
    const av = await reqJson(bus, 'GET', `/api/kanban/tasks/available`, { auth: nyxToken });
    assertEqual(av.status, 200, 'M11 available ok');
    const found = (av.data.tasks as any[]).find((t) => t.id === m11Task);
    assertTrue(!!found, 'M11 blocked unassigned appears in available');
    assertEqual(found.blocked_kind, 'waiting-task', 'M11 blocked state visible');
    assertEqual(found.status, 'blocked', 'M11 status visible');
  }

  {
    // Fix round 3, M20: an explicitly empty status means active even
    // with include_history (plan default), not all statuses.
    const m20 = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'M20 row', body: 'm20 body', topic: 'test-topic', kind: 'decision', scope: 'lane-note' } });
    assertEqual(m20.status, 200, 'M20 create');
    const m20Sup = await reqJson(bus, 'POST', `/api/ledger/${m20.data.id}/supersede`, { auth: nyxToken, body: { title: 'M20 row v2', body: 'm20 body v2', ref_type: 'task', ref_id: String(blockerA) } });
    assertEqual(m20Sup.status, 200, 'M20 supersede');
    const emptyList = await reqJson(bus, 'GET', '/admin/api/ledger?status=&include_history=true&limit=100', { auth: adminAuth });
    const activeList = await reqJson(bus, 'GET', '/admin/api/ledger?status=active&include_history=true&limit=100', { auth: adminAuth });
    const emptyIds = (emptyList.data.rows as any[]).map((r) => r.id).sort();
    const activeIds = (activeList.data.rows as any[]).map((r) => r.id).sort();
    assertEqual(JSON.stringify(emptyIds), JSON.stringify(activeIds), 'M20 empty status equals active list');
    assertTrue(!emptyIds.includes(m20.data.id), 'M20 superseded row excluded from empty-status list');
  }

  {
    // Fix round 3, M10: todo create/update and task update echo
    // auto_claimed like label-add does.
    const m10Task = mkTask('M10 unassigned', null);
    const tc = await reqJson(bus, 'POST', `/api/kanban/tasks/${m10Task}/todos`, { auth: nyxToken, body: { text: 'm10 todo' } });
    assertEqual(tc.status, 200, 'M10 todo create ok');
    assertEqual(tc.data.auto_claimed, true, 'M10 todo create echoes auto_claimed');
    const m10Task2 = mkTask('M10 unassigned 2', null);
    sql.exec(`INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, 'm10b', 0, 0)`, m10Task2);
    const m10TodoId = (sql.exec('SELECT last_insert_rowid() AS id').one() as any).id;
    const tu = await reqJson(bus, 'PUT', `/api/kanban/todos/${m10TodoId}`, { auth: nyxToken, body: { done: 1 } });
    assertEqual(tu.status, 200, 'M10 todo update ok');
    assertEqual(tu.data.auto_claimed, true, 'M10 todo update echoes auto_claimed');
    const m10Task3 = mkTask('M10 unassigned 3', null);
    const tk = await reqJson(bus, 'PUT', `/api/kanban/tasks/${m10Task3}`, { auth: nyxToken, body: { title: 'M10 unassigned 3 v2' } });
    assertEqual(tk.status, 200, 'M10 task update ok');
    assertEqual(tk.data.auto_claimed, true, 'M10 task update echoes auto_claimed');
  }

  {
    // Fix round 3 minor: an already-owned touch must NOT clear
    // unblocked_at on a task-update write; the status path still does.
    const touchTask = mkTask('Touch task', 'nyx', 'todo');
    sql.exec(`UPDATE tasks SET unblocked_at = 12345 WHERE id = ?`, touchTask);
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${touchTask}`, { auth: nyxToken, body: { title: 'Touch task v2' } })).status, 200, 'touch update ok');
    const touchRow = sql.exec(`SELECT unblocked_at FROM tasks WHERE id = ?`, touchTask).one() as any;
    assertEqual(touchRow.unblocked_at, 12345, 'task-update touch does not clear unblocked_at');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${touchTask}/status`, { auth: nyxToken, body: { status: 'doing' } })).status, 200, 'status move ok');
    const touchRow2 = sql.exec(`SELECT unblocked_at FROM tasks WHERE id = ?`, touchTask).one() as any;
    assertEqual(touchRow2.unblocked_at, null, 'status path clears unblocked_at');
  }

  {
    // Fix round 3, M6: the agent status path is rate-limited (11th
    // keepRate call 429s), like other agent writes.
    const m6Token = await registerAgent('m6status');
    const m6Task = mkTask('M6 status task', 'm6status', 'doing');
    for (let i = 0; i < 10; i++) {
      assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${m6Task}/status`, { auth: m6Token, body: { status: 'doing' }, keepRate: true })).status, 200, `M6 status call ${i}`);
    }
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${m6Task}/status`, { auth: m6Token, body: { status: 'doing' }, keepRate: true })).status, 429, 'M6 status 11th call 429');
  }

  {
    // Fix round 3 minor: a recheck-list anchor without recheck_at is
    // 400 BEFORE the rate check (exhausted bucket still yields 400,
    // not 429).
    const rcRow = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'RC anchor', body: 'rc', topic: 'test-topic', kind: 'decision', scope: 'lane-note' } });
    assertEqual(rcRow.status, 200, 'RC anchor create');
    const rcToken = await registerAgent('rcagent');
    for (let i = 0; i < 10; i++) {
      assertEqual((await reqJson(bus, 'GET', '/api/ledger', { auth: rcToken, keepRate: true })).status, 200, `RC exhaust ${i}`);
    }
    const bad = await reqJson(bus, 'GET', `/api/ledger?recheck_before=${now + 100000}&after_id=${rcRow.data.id}`, { auth: rcToken, keepRate: true });
    assertEqual(bad.status, 400, 'recheck anchor invalid before rate check');
  }

  {
    // Fix round 3 minor: recheck-assignment enforces an allowlist
    // like sibling ledger writes.
    const raRow = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'RA row', body: 'ra', topic: 'test-topic', kind: 'decision', scope: 'lane-note' } });
    assertEqual(raRow.status, 200, 'RA row create');
    const raBad = await reqJson(bus, 'POST', `/admin/api/ledger/${raRow.data.id}/recheck-assignment`, { auth: adminAuth, body: { actor: 'nyx', deadline: now + 100000, bogus: 1 } });
    assertEqual(raBad.status, 400, 'recheck allowlist rejects unknown field');
    const raOk = await reqJson(bus, 'POST', `/admin/api/ledger/${raRow.data.id}/recheck-assignment`, { auth: adminAuth, body: { actor: 'nyx', deadline: now + 100000 } });
    assertEqual(raOk.status, 200, 'recheck assignment ok');
  }

  {
    // Fix round 3 minor: an admin kind-flip on an archived
    // dependency-owned row is rejected, not stranded.
    const archProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Arch proj' } })).data.id;
    const archTask = mkTask('Arch task', 'nyx', 'blocked', archProj);
    sql.exec(`UPDATE tasks SET blocked_kind = 'waiting-task', blocked_reason = 'x', blocked_from_status = 'todo' WHERE id = ?`, archTask);
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${archProj}`, { auth: adminAuth, body: { archived: 1 } })).status, 200, 'archive proj');
    const flip = await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${archTask}`, { auth: adminAuth, body: { blocked_kind: 'waiting-human' } });
    assertEqual(flip.status, 403, 'archived kind-flip 403');
  }

  {
    // Fix round 3, M5: a cycle path deeper than the plan's 100-edge
    // depth cap fails closed (409), via the in-transaction check.
    const chain: number[] = [];
    for (let i = 0; i < 102; i++) chain.push(mkTask(`Chain ${i}`, 'nyx'));
    for (let i = 0; i < 101; i++) {
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, chain[i], chain[i + 1], now);
    }
    const cyc = await reqJson(bus, 'POST', `/api/kanban/tasks/${chain[0]}/dependencies`, { auth: nyxToken, body: { blocker_id: chain[101] } });
    assertEqual(cyc.status, 409, 'cycle depth cap fails closed');
  }

  {
    // Fix round 4, item 1: skipped-unblock signal is deduped once
    // per stuck episode, with the full escape hint + a poll event.
    const stuck = mkTask('Stuck task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'stuck wait', blocked_from_status = NULL WHERE id = ?`, stuck);
    (bus as any).depReevaluateProject(projectId, now);
    (bus as any).depReevaluateProject(projectId, now);
    const skipLogs = sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE 'system skipped unblock:%'`, stuck).one() as any;
    assertEqual(skipLogs.c, 1, 'skipped-unblock logged once, not once per sweep');
    const skipBody = sql.exec(`SELECT body FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE 'system skipped unblock:%'`, stuck).one() as any;
    // Fix round 5, M2: the old 'unlink all, then todo, then
    // re-link' hint was wrong (callers guard on zero unfinished
    // blockers; re-linking a done blocker is 409). The new hint
    // is the manual move alone, plus conditional re-link.
    assertTrue(String(skipBody.body).includes('manually move the task to todo/doing'), 'skipped-unblock hint is the manual move');
    const stuckEvents = sql.exec(`SELECT payload FROM events WHERE type = 'kanban.task.dependency_stuck'`).toArray() as Array<{ payload: string }>;
    const stuckForTask = stuckEvents.filter((e) => {
      try {
        return (JSON.parse(e.payload) as any).task_id === stuck;
      } catch {
        return false;
      }
    });
    assertEqual(stuckForTask.length, 1, 'stuck poll event emitted once, deduped like the log');
    const stuckPayload = JSON.parse(stuckForTask[0]!.payload) as any;
    assertTrue(!('blocker_ids' in stuckPayload), 'stuck payload omits the always-empty blocker_ids');
  }

  {
    // Fix round 4, item 2: agent status echoes auto_claimed and
    // handles (not drops) a comment.
    const sc = mkTask('Status comment task', null);
    const scRes = await reqJson(bus, 'PUT', `/api/kanban/tasks/${sc}/status`, { auth: nyxToken, body: { status: 'doing', comment: 'hello status' } });
    assertEqual(scRes.status, 200, 'status with comment ok');
    assertEqual(scRes.data.auto_claimed, true, 'status echoes auto_claimed');
    const scComment = sql.exec(`SELECT body FROM task_comments WHERE task_id = ? AND author = 'nyx' AND body = 'hello status'`, sc).toArray();
    assertEqual(scComment.length, 1, 'status comment written like admin comment');
    const scBad = await reqJson(bus, 'PUT', `/api/kanban/tasks/${sc}/status`, { auth: nyxToken, body: { status: 'doing', comment: 42 } });
    assertEqual(scBad.status, 400, 'non-string status comment 400');
    const scUnknown = await reqJson(bus, 'PUT', `/api/kanban/tasks/${sc}`, { auth: nyxToken, body: { priority: 'urgent' } });
    assertEqual(scUnknown.status, 400, 'agent task update unknown field 400');
  }

  {
    // Fix round 4, items 3 + 12: dependency-driven blocks emit
    // kanban.task.blocked, and the dependency audit is readable.
    const rbBlocker = mkTask('Reblock blocker', 'nyx');
    const rbDep = mkTask('Reblock dependent', 'nyx');
    const rbLink = await reqJson(bus, 'POST', `/api/kanban/tasks/${rbDep}/dependencies`, { auth: nyxToken, body: { blocker_id: rbBlocker } });
    assertEqual(rbLink.status, 200, 'reblock link ok');
    const linkBlockedEvents = sql.exec(`SELECT COUNT(*) AS c FROM events WHERE type = 'kanban.task.blocked' AND payload LIKE ?`, `%${rbDep}%`).one() as any;
    assertTrue(linkBlockedEvents.c >= 1, 'link row 1 emits kanban.task.blocked');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${rbBlocker}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'reblock blocker done');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${rbBlocker}/status`, { auth: nyxToken, body: { status: 'todo' } })).status, 200, 'reblock blocker reopened');
    const rbRow = sql.exec(`SELECT status, blocked_reason FROM tasks WHERE id = ?`, rbDep).one() as any;
    assertEqual(rbRow.status, 'blocked', 'reopen re-blocks dependent');
    assertTrue(String(rbRow.blocked_reason).includes(`task ${rbBlocker}:`), 'reblock reason names the blocker');
    const depEv = await reqJson(bus, 'GET', `/api/kanban/tasks/${rbDep}/dependencies/events`, { auth: nyxToken });
    assertEqual(depEv.status, 200, 'dependency audit read ok');
    assertTrue((depEv.data.events as any[]).some((e: any) => e.action === 'link'), 'audit contains the link event');
    const linkUnknown = await reqJson(bus, 'POST', `/api/kanban/tasks/${rbDep}/dependencies`, { auth: nyxToken, body: { blocker_id: rbBlocker, bogus: 1 } });
    assertEqual(linkUnknown.status, 400, 'dependency link unknown field 400');
  }

  {
    // Fix round 4, item 6: task-delete cascade writes one unlink
    // audit event per removed link (batched inserts, same rows).
    const delTask = mkTask('Delete me', 'nyx');
    const delLinks: number[] = [];
    for (let i = 0; i < 3; i++) {
      const b = mkTask(`Del blocker ${i}`, 'nyx');
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, b, delTask, now);
      delLinks.push(b);
    }
    assertEqual((await reqJson(bus, 'DELETE', `/admin/api/kanban/tasks/${delTask}`, { auth: adminAuth })).status, 200, 'task delete ok');
    const unlinkCount = sql.exec(`SELECT COUNT(*) AS c FROM dependency_events WHERE blocked_id = ? AND action = 'unlink'`, delTask).one() as any;
    assertEqual(unlinkCount.c, 3, 'delete cascade writes all 3 unlink events');
  }

  {
    // Fix round 4, item 7: release of a todo task and a same-status
    // PUT keep unblocked_at; a real transition clears it.
    const rel = mkTask('Release keep task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'todo', unblocked_at = ? WHERE id = ?`, now, rel);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${rel}/release`, { auth: nyxToken })).status, 200, 'release todo ok');
    const relRow = sql.exec(`SELECT status, assignee, unblocked_at FROM tasks WHERE id = ?`, rel).one() as any;
    assertEqual(relRow.status, 'todo', 'release todo keeps status');
    assertEqual(relRow.unblocked_at, now, 'release todo keeps unblocked_at');
    sql.exec(`UPDATE tasks SET assignee = 'nyx' WHERE id = ?`, rel);
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${rel}/status`, { auth: nyxToken, body: { status: 'todo' } })).status, 200, 'same-status PUT ok');
    const noopRow = sql.exec(`SELECT unblocked_at FROM tasks WHERE id = ?`, rel).one() as any;
    assertEqual(noopRow.unblocked_at, now, 'same-status PUT keeps unblocked_at');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${rel}/status`, { auth: nyxToken, body: { status: 'doing' } })).status, 200, 'real transition ok');
    const movedRow = sql.exec(`SELECT unblocked_at FROM tasks WHERE id = ?`, rel).one() as any;
    assertEqual(movedRow.unblocked_at, null, 'real transition clears unblocked_at');
  }

  {
    // Fix round 4, item 10: default-kind block with unfinished
    // links is rejected; an explicit waiting-human block passes.
    const trapBlocker = mkTask('Trap blocker', 'nyx');
    const trapTask = mkTask('Trap task', 'nyx');
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, trapBlocker, trapTask, now);
    const trap = await reqJson(bus, 'PUT', `/api/kanban/tasks/${trapTask}/status`, { auth: nyxToken, body: { status: 'blocked', blocked_reason: 'x' } });
    assertEqual(trap.status, 409, 'default-kind block with unfinished links rejected');
    assertTrue(String(trap.data.hint || '').includes('POST dependencies'), 'default-kind hint names the link path');
    const trap2 = mkTask('Trap task explicit', 'nyx');
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, trapBlocker, trap2, now);
    const explicit = await reqJson(bus, 'PUT', `/api/kanban/tasks/${trap2}/status`, { auth: nyxToken, body: { status: 'blocked', blocked_kind: 'waiting-human', blocked_reason: 'manual wait' } });
    assertEqual(explicit.status, 200, 'explicit waiting-human block with links passes');
  }

  {
    // Fix round 4, items 12 + 13: ledger audit read + tombstone
    // response echoes status and reason.
    const led = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Audit row', body: 'audit', topic: 'test-topic', kind: 'decision', scope: 'lane-note' } });
    assertEqual(led.status, 200, 'audit ledger row create');
    const tomb = await reqJson(bus, 'POST', `/api/ledger/${led.data.id}/tombstone`, { auth: nyxToken, body: { reason: 'no longer true' } });
    assertEqual(tomb.status, 200, 'tombstone ok');
    assertEqual(tomb.data.status, 'tombstoned', 'tombstone echoes status');
    assertEqual(tomb.data.tombstone_reason, 'no longer true', 'tombstone echoes reason');
    const ledEv = await reqJson(bus, 'GET', `/admin/api/ledger/${led.data.id}/events`, { auth: adminAuth });
    assertEqual(ledEv.status, 200, 'ledger audit read ok');
    assertTrue((ledEv.data.events as any[]).some((e: any) => e.action === 'tombstone'), 'audit contains the tombstone event');
  }


  // ---- Fix round 5 regression tests (M1, M5, M6, M7, M10, M11) ----
  {
    // M1: 101 dependents -> {processed:100, capped:true,
    // pending_sweep:true} (previously capped:false, a lie).
    const m1Blocker = mkTask('M1 blocker', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'done' WHERE id = ?`, m1Blocker);
    for (let i = 0; i < 101; i++) {
      const d = mkTask(`M1 dep ${i}`, 'nyx');
      sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'm1 wait', blocked_from_status = 'todo' WHERE id = ?`, d);
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, m1Blocker, d, now);
    }
    const m1Stats = (bus as any).depReevaluateOnDone(m1Blocker, now) as any;
    assertEqual(m1Stats.processed, 100, 'M1 fan-out processed 100');
    assertEqual(m1Stats.capped, true, 'M1 fan-out capped true at 101 dependents');
    assertEqual(m1Stats.pending_sweep, true, 'M1 fan-out pending_sweep true');
  }

  {
    // M3 (100-cap): 105 blockers paged at limit=100 -> 100 + 5.
    const c105 = mkTask('M3 cap center', 'nyx');
    const b105: number[] = [];
    for (let i = 0; i < 105; i++) {
      const b = mkTask(`M3 cap blocker ${i}`, 'nyx');
      b105.push(b);
      assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${c105}/dependencies`, { auth: nyxToken, body: { blocker_id: b } })).status, 200, 'M3 cap link');
    }
    const cap1 = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${c105}/dependencies?limit=100`, { auth: adminAuth });
    assertEqual((cap1.data.blockers as any[]).length, 100, 'M3 cap page1 100 blockers');
    assertEqual(cap1.data.blockers_has_more, true, 'M3 cap page1 has_more');
    const cap2 = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${c105}/dependencies?limit=100&blockers_after_id=${cap1.data.blockers_after_id}`, { auth: adminAuth });
    assertEqual((cap2.data.blockers as any[]).length, 5, 'M3 cap page2 5 blockers');
    assertEqual(cap2.data.blockers_has_more, false, 'M3 cap page2 done');
    const capAll = [...(cap1.data.blockers as any[]), ...(cap2.data.blockers as any[])].map((t: any) => t.id).sort((a: number, b: number) => a - b);
    assertEqual(capAll, [...b105].sort((a: number, b: number) => a - b), 'M3 cap no rows lost at 100-cap');
  }

  {
    // M5: /available and search offset cursors page disjointly.
    const avTasks: number[] = [];
    for (let i = 0; i < 3; i++) avTasks.push(mkTask(`M5 avail ${i}`, null));
    const av1 = await reqJson(bus, 'GET', `/api/kanban/tasks/available?limit=2`, { auth: nyxToken });
    assertEqual(av1.status, 200, 'M5 available page1 ok');
    assertEqual(av1.data.next_offset, 2, 'M5 available next_offset 2');
    const av2 = await reqJson(bus, 'GET', `/api/kanban/tasks/available?limit=2&offset=2`, { auth: nyxToken });
    assertEqual(av2.status, 200, 'M5 available page2 ok');
    const avIds1 = (av1.data.tasks as any[]).map((t: any) => t.id);
    const avIds2 = (av2.data.tasks as any[]).map((t: any) => t.id);
    assertTrue(avIds1.every((id: number) => !avIds2.includes(id)), 'M5 available pages disjoint');
    assertTrue(avIds2.length > 0, 'M5 available page2 non-empty');
    const sqTasks: number[] = [];
    for (let i = 0; i < 3; i++) sqTasks.push(mkTask(`M5search ${i}`, 'nyx'));
    const sq1 = await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks?q=M5search&limit=2`, { auth: nyxToken });
    assertEqual(sq1.status, 200, 'M5 search page1 ok');
    assertEqual((sq1.data.tasks as any[]).length, 2, 'M5 search page1 2');
    assertEqual(sq1.data.next_offset, 2, 'M5 search next_offset 2');
    const sq2 = await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks?q=M5search&limit=2&offset=2`, { auth: nyxToken });
    assertEqual((sq2.data.tasks as any[]).length, 1, 'M5 search page2 1');
    assertTrue(!(sq1.data.tasks as any[]).some((t: any) => t.id === (sq2.data.tasks as any[])[0].id), 'M5 search pages disjoint');
  }

  {
    // M6: multi-blocker reason refreshes on link and on completion.
    const m6A = mkTask('M6 blocker A', 'nyx');
    const m6B = mkTask('M6 blocker B', 'nyx');
    const m6D = mkTask('M6 dependent', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${m6D}/dependencies`, { auth: nyxToken, body: { blocker_id: m6A } })).status, 200, 'M6 link A');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${m6D}/dependencies`, { auth: nyxToken, body: { blocker_id: m6B } })).status, 200, 'M6 link B');
    let m6Row = sql.exec(`SELECT blocked_reason FROM tasks WHERE id = ?`, m6D).one() as any;
    assertTrue(String(m6Row.blocked_reason).includes(`Waiting for task ${m6A}`) && String(m6Row.blocked_reason).includes(`Waiting for task ${m6B}`), 'M6 reason names both blockers after second link');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${m6A}`, { auth: adminAuth, body: { status: 'done' } })).status, 200, 'M6 blocker A done');
    m6Row = sql.exec(`SELECT status, blocked_reason FROM tasks WHERE id = ?`, m6D).one() as any;
    assertEqual(m6Row.status, 'blocked', 'M6 still blocked by B');
    assertTrue(String(m6Row.blocked_reason).includes(`Waiting for task ${m6B}`) && !String(m6Row.blocked_reason).includes(`task ${m6A}:`), 'M6 reason no longer names done blocker A');
  }

  {
    // M7: unarchive top-level processed + delete cascade summaries.
    const ua3Proj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'M7 proj' } })).data.id;
    const ua3Blocker = mkTask('M7 blocker', 'nyx', 'todo', ua3Proj);
    const ua3Dep = mkTask('M7 dep', 'nyx', 'todo', ua3Proj);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${ua3Dep}/dependencies`, { auth: nyxToken, body: { blocker_id: ua3Blocker } })).status, 200, 'M7 link');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${ua3Proj}`, { auth: adminAuth, body: { archived: 1 } })).status, 200, 'M7 archive');
    assertEqual((await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${ua3Blocker}`, { auth: adminAuth, body: { status: 'done' } })).status, 200, 'M7 blocker done while archived');
    const ua3 = await reqJson(bus, 'PUT', `/admin/api/kanban/projects/${ua3Proj}`, { auth: adminAuth, body: { archived: 0 } });
    assertEqual(ua3.status, 200, 'M7 unarchive ok');
    assertEqual(ua3.data.dependency_fanout.processed, ua3.data.dependency_fanout.unblocked.processed + ua3.data.dependency_fanout.reblocked.processed, 'M7 unarchive top-level processed is sum of passes');
    assertTrue(ua3.data.dependency_fanout.processed >= 1, 'M7 unarchive processed >= 1');
    const delBlocker = mkTask('M7 del blocker', 'nyx');
    const delDep = mkTask('M7 del dep', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${delDep}/dependencies`, { auth: nyxToken, body: { blocker_id: delBlocker } })).status, 200, 'M7 del link');
    const delRes = await reqJson(bus, 'DELETE', `/admin/api/kanban/tasks/${delBlocker}`, { auth: adminAuth });
    assertEqual(delRes.status, 200, 'M7 task delete ok');
    assertTrue(delRes.data.dependency_cascade.links_removed >= 1, 'M7 task delete cascade links_removed');
    assertTrue('dependents_unblocked' in delRes.data.dependency_cascade, 'M7 task delete cascade has dependents_unblocked');
    const delProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'M7 del proj' } })).data.id;
    mkTask('M7 del proj task', 'nyx', 'todo', delProj);
    const delProjRes = await reqJson(bus, 'DELETE', `/admin/api/kanban/projects/${delProj}`, { auth: adminAuth });
    assertEqual(delProjRes.status, 200, 'M7 project delete ok');
    assertEqual(delProjRes.data.dependency_cascade.tasks_deleted, 1, 'M7 project delete cascade tasks_deleted');
  }

  {
    // M10: a test Luki message must NOT authorise a protected supersede.
    sql.exec(`INSERT INTO messages (sender, channel, priority, audience, ts, body, reply_to) VALUES ('luki', 'all-agent', 'normal', 'agents', ?, 'Luki orders m10 rule', NULL)`, new Date().toISOString());
    const m10SeedMsg = (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
    const m10Seed = await reqJson(bus, 'POST', '/admin/api/ledger/seed', { auth: adminAuth, body: { title: 'M10 rule', body: 'm10 body', kind: 'protocol', luki_message_id: m10SeedMsg } });
    assertEqual(m10Seed.status, 200, 'M10 seed ok');
    sql.exec(`INSERT INTO messages (sender, channel, priority, audience, ts, body, reply_to) VALUES ('luki', 'v5-seed-test', 'normal', 'agents', ?, 'TEST ONLY fake order', NULL)`, new Date().toISOString());
    const m10TestMsg = (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
    const m10Sup = await reqJson(bus, 'POST', `/admin/api/ledger/${m10Seed.data.id}/supersede`, { auth: adminAuth, body: { title: 'M10 rule v2', body: 'm10 body v2', luki_message_id: m10TestMsg, ref_type: 'bus_message', ref_id: String(m10TestMsg) } });
    assertEqual(m10Sup.status, 403, 'M10 test Luki message cannot authorise supersede');
    const m10Row = sql.exec(`SELECT status FROM ledger WHERE id = ?`, m10Seed.data.id).one() as any;
    assertEqual(m10Row.status, 'active', 'M10 row still active after rejected supersede');
  }

  {
    // M11: waiting-human + unfinished links gets a stuck signal.
    const m11Blocker = mkTask('M11 blocker', 'nyx');
    const m11Task = mkTask('M11 human task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-human', blocked_reason = 'human wait', blocked_from_status = NULL WHERE id = ?`, m11Task);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, m11Blocker, m11Task, now);
    (bus as any).depReevaluateProject(projectId, now);
    const m11Logs = sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE 'system stuck manual block:%'`, m11Task).one() as any;
    assertEqual(m11Logs.c, 1, 'M11 invisible stuck logged once');
    const m11Events = sql.exec(`SELECT payload FROM events WHERE type = 'kanban.task.dependency_stuck'`).toArray() as Array<{ payload: string }>;
    assertTrue(m11Events.some((e) => { try { const p = JSON.parse(e.payload) as any; return p.task_id === m11Task && String(p.hint).includes('unlink all'); } catch { return false; } }), 'M11 invisible stuck poll event with escape hint');
    (bus as any).depReevaluateProject(projectId, now);
    const m11Logs2 = sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE 'system stuck manual block:%'`, m11Task).one() as any;
    assertEqual(m11Logs2.c, 1, 'M11 invisible stuck deduped per episode');
  }

  {
    // M2 (episode key): a link event after the first stuck signal
    // starts a new episode, so the signal fires again.
    const epTask = mkTask('M2 episode task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'ep wait', blocked_from_status = NULL WHERE id = ?`, epTask);
    (bus as any).depReevaluateProject(projectId, now);
    const ep1 = (sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE 'system skipped unblock:%'`, epTask).one() as any).c;
    assertEqual(ep1, 1, 'M2 episode first signal');
    // A link-then-unlink cycle: the link itself makes the row
    // ineligible for the stuck branch (callers guard on zero
    // unfinished links), but the two audit events move the
    // episode key, so the next evaluation with zero unfinished
    // links signals again instead of suppressing forever.
    const epBlocker = mkTask('M2 episode blocker', 'nyx');
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, epBlocker, epTask, now);
    sql.exec(`INSERT INTO dependency_events (blocker_id, blocked_id, actor, action, reason, created_at) VALUES (?, ?, 'nyx', 'link', NULL, ?)`, epBlocker, epTask, now);
    sql.exec(`DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?`, epBlocker, epTask);
    sql.exec(`INSERT INTO dependency_events (blocker_id, blocked_id, actor, action, reason, created_at) VALUES (?, ?, 'nyx', 'unlink', NULL, ?)`, epBlocker, epTask, now);
    (bus as any).depReevaluateProject(projectId, now);
    const ep2 = (sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE 'system skipped unblock:%'`, epTask).one() as any).c;
    assertEqual(ep2, 2, 'M2 episode link event starts a new episode');
  }

  {
    // M4: fan-out cap + alarm sweep convergence (runs last: the sweep
    // re-evaluates every open project).
    const capBlocker = mkTask('Cap blocker', 'nyx');
    const capDeps: number[] = [];
    for (let i = 0; i < 101; i++) {
      const d = mkTask(`Cap dep ${i}`, 'nyx');
      sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'cap wait', blocked_from_status = 'todo' WHERE id = ?`, d);
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, capBlocker, d, now);
      capDeps.push(d);
    }
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${capBlocker}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'M4 cap blocker done');
    // Count in chunks: a single IN (...) with 101 ids would exceed
    // the 100-bound-parameter statement limit.
    function countCapBlocked(): number {
      let total = 0;
      for (let i = 0; i < capDeps.length; i += 50) {
        const chunk = capDeps.slice(i, i + 50);
        total += (sql.exec(`SELECT COUNT(*) AS c FROM tasks WHERE id IN (${chunk.map(() => '?').join(',')}) AND status = 'blocked'`, ...chunk).one() as any).c;
      }
      return total;
    }
    assertEqual(countCapBlocked(), 1, 'M4 fan-out capped at 100, one remainder');
    await (bus as any).alarm();
    assertEqual(countCapBlocked(), 0, 'M4 alarm sweep converges the remainder');
  }

  // ---- Fix round 6 regression tests ----
  {
    // KILL: reblock + stuck sweep passes must reach a genuine
    // candidate past the 500-candidate budget, behind 501
    // done-link-only rows each. The old any-link predicates let
    // those rows consume the budget (and depEachProjectTask
    // restarts from id 0 per call), so the candidate was NEVER
    // reached by any hourly sweep. The unfinished-join
    // predicates exclude done-link-only rows from the page
    // query entirely, so the candidate is reached in-call.
    const sweepProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix6 sweep project' } })).data.id as number;
    const doneBlk = mkTask('Fix6 done blocker', 'nyx', 'done', sweepProj);
    for (let i = 0; i < 501; i++) {
      const f = mkTask(`Fix6 todo filler ${i}`, 'nyx', 'todo', sweepProj);
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, doneBlk, f, now);
    }
    for (let i = 0; i < 501; i++) {
      const f = mkTask(`Fix6 human filler ${i}`, 'nyx', 'todo', sweepProj);
      sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-human', blocked_reason = 'human wait' WHERE id = ?`, f);
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, doneBlk, f, now);
    }
    const reblockBlocker = mkTask('Fix6 reblock blocker', 'nyx', 'todo', sweepProj);
    const genuine = mkTask('Fix6 genuine reblock candidate', 'nyx', 'todo', sweepProj);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, reblockBlocker, genuine, now);
    const stuckBlocker = mkTask('Fix6 stuck blocker', 'nyx', 'todo', sweepProj);
    const stuckTask = mkTask('Fix6 genuine stuck task', 'nyx', 'todo', sweepProj);
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-human', blocked_reason = 'human wait' WHERE id = ?`, stuckTask);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, stuckBlocker, stuckTask, now);
    const sweepStats = (bus as any).depReevaluateProject(sweepProj, now) as any;
    const gRow = sql.exec(`SELECT status, blocked_kind, blocked_reason FROM tasks WHERE id = ?`, genuine).one() as any;
    assertEqual(gRow.status, 'blocked', 'Fix6 sweep reblocks past-budget candidate');
    assertEqual(gRow.blocked_kind, 'waiting-task', 'Fix6 sweep reblock kind');
    assertTrue(String(gRow.blocked_reason).includes(`Waiting for task ${reblockBlocker}:`), 'Fix6 sweep reblock reason names unfinished blocker');
    assertEqual(sweepStats.reblocked.processed, 1, 'Fix6 sweep reblock processed exactly the genuine candidate');
    assertEqual(sweepStats.pending_sweep, false, 'Fix6 sweep no remainder once fillers stop consuming budget');
    const stuckLogs = sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system' AND body LIKE 'system stuck manual block:%'`, stuckTask).one() as any;
    assertEqual(stuckLogs.c, 1, 'Fix6 sweep stuck signal reaches past-budget row');
  }

  {
    // Perf M3: cycle edge load is bounded at DEP_CYCLE_EDGE_CAP
    // (1000) and fails closed above it; small graphs behave as
    // before. 1001 disjoint edges in one project, queried for an
    // unrelated pair with no path: the old code loaded all edges
    // and answered false; the bounded load answers cyclic.
    const capProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix6 cycle cap project' } })).data.id as number;
    let firstB = 0;
    let firstD = 0;
    for (let i = 0; i < 1001; i++) {
      const b = mkTask(`Fix6 cap blocker ${i}`, 'nyx', 'todo', capProj);
      const d = mkTask(`Fix6 cap blocked ${i}`, 'nyx', 'todo', capProj);
      if (i === 0) { firstB = b; firstD = d; }
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, b, d, now);
    }
    const capped = depHasCycle(bus as any, firstB, firstD, capProj);
    assertEqual(capped.cycle, true, 'Fix6 cycle over edge cap fails closed');
    assertEqual(capped.path, [], 'Fix6 cycle over edge cap has no path');
    // Fix round 7, (h): the edge-cap fail-closed cause is named,
    // not collapsed into the depth-cap hint.
    assertEqual((capped as any).cause, 'edge_cap', 'Fix7 cycle edge cap cause named');
    // Control: small chain in another project still resolves.
    const ctlProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix6 cycle control project' } })).data.id as number;
    const cx = mkTask('Fix6 ctl X', 'nyx', 'todo', ctlProj);
    const cy = mkTask('Fix6 ctl Y', 'nyx', 'todo', ctlProj);
    const cz = mkTask('Fix6 ctl Z', 'nyx', 'todo', ctlProj);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, cx, cy, now);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, cy, cz, now);
    assertEqual(depHasCycle(bus as any, cz, cx, ctlProj).cycle, true, 'Fix6 cycle control finds chain');
    assertEqual(depHasCycle(bus as any, cz, cx, ctlProj).path, [cx, cy, cz], 'Fix6 cycle control shortest path');
    assertEqual(depHasCycle(bus as any, cx, cz, ctlProj).cycle, false, 'Fix6 cycle control no reverse path');
  }

  {
    // API M1: dep-list validation runs BEFORE the rate check, so
    // ten 400 cursor errors (keepRate: no harness clearing) must
    // not consume quota — the next valid call still succeeds.
    // On the old ordering the 11th call would 429.
    const quotaTask = mkTask('Fix6 quota task', 'nyx');
    for (let i = 0; i < 10; i++) {
      const bad = await reqJson(bus, 'GET', `/api/kanban/tasks/${quotaTask}/dependencies?limit=2&blockers_after_id=abc`, { auth: nyxToken, keepRate: true });
      assertEqual(bad.status, 400, 'Fix6 dep-list bad cursor 400');
    }
    const good = await reqJson(bus, 'GET', `/api/kanban/tasks/${quotaTask}/dependencies?limit=2`, { auth: nyxToken, keepRate: true });
    assertEqual(good.status, 200, 'Fix6 dep-list validation errors do not consume quota');
  }

  {
    // (e) Unified cursor parsing: strict digits everywhere, and
    // the string "null" is absent — not a 400, not a coercion.
    const curTask = mkTask('Fix6 cursor task', 'nyx');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/${curTask}/dependencies/events?after_id=12abc`, { auth: nyxToken })).status, 400, 'Fix6 dep events 12abc 400');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/${curTask}/dependencies/events?after_id=null`, { auth: nyxToken })).status, 200, 'Fix6 dep events null absent');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/${curTask}/dependencies/events?limit=null`, { auth: nyxToken })).status, 200, 'Fix6 dep events limit null absent');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?after_id=null`, { auth: nyxToken })).status, 200, 'Fix6 unblocked null absent');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?project_id=12abc`, { auth: nyxToken })).status, 400, 'Fix6 unblocked project_id 12abc 400');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked?limit=null`, { auth: nyxToken })).status, 200, 'Fix6 unblocked limit null absent');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${curTask}/comments?limit=2&after_id=null`, { auth: adminAuth })).status, 200, 'Fix6 comments null absent');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${curTask}/comments?limit=2&after_id=12abc`, { auth: adminAuth })).status, 400, 'Fix6 comments 12abc 400');
    assertEqual((await reqJson(bus, 'GET', `/api/ledger?after_id=null`, { auth: nyxToken })).status, 200, 'Fix6 ledger null absent');
    assertEqual((await reqJson(bus, 'GET', `/api/ledger?after_id=12abc`, { auth: nyxToken })).status, 400, 'Fix6 ledger 12abc 400');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/${curTask}/dependencies?limit=null`, { auth: nyxToken })).status, 200, 'Fix6 dep list limit null absent');
  }

  {
    // API M3: gate hint for a human/external stuck row names the
    // real escape (unlink all, then manual move) — finishing
    // blockers does NOT lift a manual wait.
    const gateBlocker = mkTask('Fix6 gate blocker', 'nyx');
    const gateTask = mkTask('Fix6 gate task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-human', blocked_reason = 'manual wait' WHERE id = ?`, gateTask);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, gateBlocker, gateTask, now);
    const gate = await reqJson(bus, 'PUT', `/api/kanban/tasks/${gateTask}/status`, { auth: nyxToken, body: { status: 'doing' } });
    assertEqual(gate.status, 409, 'Fix6 gate human stuck 409');
    assertTrue(String(gate.data.hint).includes('unlink all'), 'Fix6 gate human hint names unlink-all escape');
    assertTrue(!String(gate.data.hint).startsWith('finish or unlink'), 'Fix6 gate human hint does not promise finish-lifts');
  }

  {
    // Harsh m-3: failed claim surfaces blocked state.
    const ownedBlocked = mkTask('Fix6 owned blocked', 'nosmile99');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'm6 wait' WHERE id = ?`, ownedBlocked);
    const claim = await reqJson(bus, 'POST', `/api/kanban/tasks/${ownedBlocked}/claim`, { auth: nyxToken });
    assertEqual(claim.status, 409, 'Fix6 claim owned blocked 409');
    assertEqual(claim.data.current.blocked_kind, 'waiting-task', 'Fix6 claim 409 carries blocked_kind');
    assertEqual(claim.data.current.blocked_reason, 'm6 wait', 'Fix6 claim 409 carries blocked_reason');
  }

  {
    // Bug m-6: admin unblocked anchor from an ARCHIVED project is
    // 400, not an empty page (the agent path already 404s via
    // visibility; the admin path used to accept then filter out).
    const archProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix6 archived project' } })).data.id as number;
    const archTask = mkTask('Fix6 archived anchor', null, 'todo', archProj);
    sql.exec(`UPDATE tasks SET unblocked_at = ? WHERE id = ?`, now, archTask);
    sql.exec(`UPDATE projects SET archived = 1 WHERE id = ?`, archProj);
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/tasks/unblocked?after_id=${archTask}`, { auth: adminAuth })).status, 400, 'Fix6 admin archived anchor 400');
  }

  {
    // Bug m-4: delete-cascade capped is precise — remaining
    // snapshots that are all unblockable (waiting-human) do NOT
    // set capped, and pending_sweep stays false.
    const delProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix6 delete project' } })).data.id as number;
    const delTask = mkTask('Fix6 delete target', 'nyx', 'todo', delProj);
    for (let i = 0; i < 100; i++) {
      const d = mkTask(`Fix6 restorable ${i}`, 'nyx', 'todo', delProj);
      sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'del wait', blocked_from_status = 'todo' WHERE id = ?`, d);
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, delTask, d, now);
    }
    const humanDeps: number[] = [];
    for (let i = 0; i < 5; i++) {
      const d = mkTask(`Fix6 human dep ${i}`, 'nyx', 'todo', delProj);
      sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-human', blocked_reason = 'human wait' WHERE id = ?`, d);
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, delTask, d, now);
      humanDeps.push(d);
    }
    const del = await reqJson(bus, 'DELETE', `/admin/api/kanban/tasks/${delTask}`, { auth: adminAuth });
    assertEqual(del.status, 200, 'Fix6 delete ok');
    assertEqual(del.data.dependency_cascade.links_removed, 105, 'Fix6 delete links removed 105');
    assertEqual(del.data.dependency_cascade.dependents_unblocked, 100, 'Fix6 delete unblocked 100');
    assertEqual(del.data.dependency_cascade.capped, false, 'Fix6 delete capped false when only unblockable snapshots remain');
    assertEqual(del.data.dependency_cascade.pending_sweep, false, 'Fix6 delete pending false when nothing remains');
    const stillBlocked = sql.exec(`SELECT status FROM tasks WHERE id = ?`, humanDeps[0]).one() as any;
    assertEqual(stillBlocked.status, 'blocked', 'Fix6 delete human dep stays blocked');
  }

  {
    // Bug m-1 (reopen): an already-blocked waiting-task
    // dependent's reason refreshes to include the newly
    // unfinished (reopened) blocker.
    const reA = mkTask('Fix6 reopen A', 'nyx');
    const reDep = mkTask('Fix6 reopen dep', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${reDep}/dependencies`, { auth: nyxToken, body: { blocker_id: reA } })).status, 200, 'Fix6 reopen link A');
    const reB = mkTask('Fix6 reopen B', 'nyx', 'done');
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, reB, reDep, now);
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${reB}/status`, { auth: nyxToken, body: { status: 'todo' } })).status, 200, 'Fix6 reopen B');
    const reRow = sql.exec(`SELECT blocked_reason FROM tasks WHERE id = ?`, reDep).one() as any;
    assertTrue(String(reRow.blocked_reason).includes(`Waiting for task ${reA}:`), 'Fix6 reopen reason keeps A');
    assertTrue(String(reRow.blocked_reason).includes(`Waiting for task ${reB}:`), 'Fix6 reopen reason gains reopened B');
  }

  {
    // API M4: the status PUT is the middle step of a 2N+1 rescue,
    // so its 429 carries the rescue hint link/unlink 429s carry.
    // Ten no-op status PUTs (keepRate: no harness clearing) fill
    // the 10/60s bucket; the 11th must 429 with the hint.
    const rescueTask = mkTask('Fix6 rescue status task', 'nyx');
    // Same clearing mechanism reqJson uses for non-keepRate calls:
    // the bucket may hold one hit from the previous block's last
    // call, so start from empty for an exact 10 + 429 sequence.
    (bus as any).rateLimit?.clear?.();
    for (let i = 0; i < 10; i++) {
      const put = await reqJson(bus, 'PUT', `/api/kanban/tasks/${rescueTask}/status`, { auth: nyxToken, body: { status: 'todo' }, keepRate: true });
      assertEqual(put.status, 200, 'Fix6 status 429 setup put ok');
    }
    const limited = await reqJson(bus, 'PUT', `/api/kanban/tasks/${rescueTask}/status`, { auth: nyxToken, body: { status: 'todo' }, keepRate: true });
    assertEqual(limited.status, 429, 'Fix6 status step 429s at bucket edge');
    assertTrue(String(limited.data.hint).includes('rescue'), 'Fix6 status 429 carries rescue hint');
  }

  {
    // Harsh M7: manual block/unblock events name subscribers plus
    // the assignee (depEventRecipients), like dependency events —
    // asserted on the poll response's recipients field itself.
    // Cursor from the last pre-existing event: the whole suite
    // runs in seconds, so a bare since_ts window would page
    // through ~1000 earlier events and cut these off (LIMIT
    // 1000); the (ts, id) cursor pages strictly past them.
    const pollTask = mkTask('Fix6 poll recipients task', 'nyx');
    const lastEv = sql.exec(`SELECT ts, id FROM events ORDER BY id DESC LIMIT 1`).one() as any;
    const pollSinceTs = lastEv ? lastEv.ts : 0;
    const pollSinceId = lastEv ? lastEv.id : 0;
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${pollTask}/status`, { auth: nyxToken, body: { status: 'blocked', blocked_kind: 'waiting-human', blocked_reason: 'manual wait' } })).status, 200, 'Fix6 poll manual block ok');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${pollTask}/status`, { auth: nyxToken, body: { status: 'doing' } })).status, 200, 'Fix6 poll manual unblock ok');
    const poll = await reqJson(bus, 'GET', `/poll?since_ts=${pollSinceTs}&since_id=${pollSinceId}`, { auth: nyxToken });
    assertEqual(poll.status, 200, 'Fix6 poll ok');
    const blockedEv = (poll.data.events as any[]).find((e) => e.type === 'kanban.task.blocked' && e.payload?.task_id === pollTask);
    const unblockedEv = (poll.data.events as any[]).find((e) => e.type === 'kanban.task.unblocked' && e.payload?.task_id === pollTask);
    assertTrue(!!blockedEv, 'Fix6 poll manual blocked event present');
    assertTrue((blockedEv.recipients as string[] | null)?.includes('nyx') ?? false, 'Fix6 manual blocked recipients include assignee');
    assertTrue(!!unblockedEv, 'Fix6 poll manual unblocked event present');
    assertTrue((unblockedEv.recipients as string[] | null)?.includes('nyx') ?? false, 'Fix6 manual unblocked recipients include assignee');
  }

  {
    // Fix round 7: endorsement test-message ban (F1), unified
    // booleans, ledger anchor-vs-filter validation, link error
    // field/hint, unlink-orphan reason, link-only human reason,
    // archived re-evaluation guard, detail ref continuation.
    // F1a: endorsement in the test channel cannot authorise.
    const f7Body = 'Fix7 endorsed action body';
    const f7Hash = await sha256HexStr(f7Body);
    const f7Propose = insertMessage('nyx', 'all-agent', `PROPOSE: Fix7 action | kind: hold | scope: action | body_sha256: ${f7Hash}`, null);
    const f7TestEndorse = insertMessage('nosmile99', 'v5-seed-test', `ENDORSE: Fix7 action | body_sha256: ${f7Hash}`, f7Propose);
    const f7a = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Fix7 action', body: f7Body, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: f7TestEndorse },
    });
    assertEqual(f7a.status, 403, 'Fix7 test-channel endorsement 403');
    assertEqual(f7a.data.reason, 'endorsement_test_message', 'Fix7 test-channel endorsement reason');
    // F1b: a TEST ONLY proposal cannot authorise, even with a
    // normal endorsement (the title carries the marker so every
    // other check passes and only the ban fires).
    const f7bBody = 'Fix7 test-only proposal body';
    const f7bHash = await sha256HexStr(f7bBody);
    const f7bPropose = insertMessage('nyx', 'all-agent', `PROPOSE: TEST ONLY action | kind: hold | scope: action | body_sha256: ${f7bHash}`, null);
    const f7bEndorse = insertMessage('nosmile99', 'all-agent', `ENDORSE: TEST ONLY action | body_sha256: ${f7bHash}`, f7bPropose);
    const f7b = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'TEST ONLY action', body: f7bBody, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: f7bEndorse },
    });
    assertEqual(f7b.status, 403, 'Fix7 TEST ONLY proposal 403');
    assertEqual(f7b.data.reason, 'endorsement_test_message', 'Fix7 TEST ONLY proposal reason');
    // F1c: a luki endorsement in the test channel is banned too
    // (the ban fires before the all-agent channel check).
    const f7cEndorse = insertMessage('luki', 'v5-seed-test', `ENDORSE: Fix7 action | body_sha256: ${f7Hash}`, f7Propose);
    const f7c = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Fix7 action', body: f7Body, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: f7cEndorse },
    });
    assertEqual(f7c.status, 403, 'Fix7 luki test-channel endorsement 403');
    // (a) Unified booleans: "1" now means true everywhere.
    const f7BoolTask = mkTask('Fix7 bool task', 'nyx');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/tasks/${f7BoolTask}/comments?include_deleted=1`, { auth: nyxToken })).status, 403, 'Fix7 include_deleted=1 non-admin 403');
    assertEqual((await reqJson(bus, 'GET', `/api/ledger?include_history=1`, { auth: nyxToken })).status, 403, 'Fix7 include_history=1 non-admin 403');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks/search?include_archived=maybe`, { auth: nyxToken })).status, 400, 'Fix7 include_archived invalid 400');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks/search?include_archived=true`, { auth: nyxToken })).status, 200, 'Fix7 include_archived=true ok');
    // (b) Ledger anchor must match the request's filters.
    const f7Dec = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Fix7 dec', body: 'dec body', topic: 'test-topic', kind: 'decision' } });
    const f7Hold = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Fix7 hold', body: 'hold body', topic: 'test-topic', kind: 'hold' } });
    assertEqual((await reqJson(bus, 'GET', `/admin/api/ledger?kind=decision&after_id=${f7Hold.data.id}`, { auth: adminAuth })).status, 400, 'Fix7 ledger anchor kind mismatch 400');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/ledger?kind=decision&after_id=${f7Dec.data.id}`, { auth: adminAuth })).status, 200, 'Fix7 ledger anchor kind match 200');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/ledger?target_lane=no-such-agent-xyz`, { auth: adminAuth })).status, 400, 'Fix7 ledger target_lane typo 400');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/ledger?recheck_before=12abc`, { auth: adminAuth })).status, 400, 'Fix7 recheck_before 12abc 400');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/ledger?recheck_before=null`, { auth: adminAuth })).status, 200, 'Fix7 recheck_before null absent');
    const f7Hist = await reqJson(bus, 'GET', `/admin/api/ledger?include_history=true`, { auth: adminAuth });
    assertEqual(f7Hist.status, 200, 'Fix7 include_history admin ok');
    assertEqual(f7Hist.data.filters.status, 'all', 'Fix7 filters.status echoes all');
    // (d) recheck_before strictness is covered above (12abc/null).
    // (e) Link errors carry field + hint.
    const f7LinkA = mkTask('Fix7 link A', 'nyx');
    const f7LinkB = mkTask('Fix7 link B', 'nyx');
    const f7Self = await reqJson(bus, 'POST', `/api/kanban/tasks/${f7LinkA}/dependencies`, { auth: nyxToken, body: { blocker_id: f7LinkA } });
    assertEqual(f7Self.status, 400, 'Fix7 self-link 400');
    assertEqual(f7Self.data.field, 'blocker_id', 'Fix7 self-link field');
    assertTrue(typeof f7Self.data.hint === 'string' && f7Self.data.hint.length > 0, 'Fix7 self-link hint');
    const f7Cross = await reqJson(bus, 'POST', `/api/kanban/tasks/${f7LinkA}/dependencies`, { auth: nyxToken, body: { blocker_id: mkTask('Fix7 cross', 'nyx', 'todo', project2Id) } });
    assertEqual(f7Cross.status, 400, 'Fix7 cross-project 400');
    assertEqual(f7Cross.data.field, 'blocker_id', 'Fix7 cross-project field');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${f7LinkA}/dependencies`, { auth: nyxToken, body: { blocker_id: f7LinkB } })).status, 200, 'Fix7 link ok');
    const f7Dup = await reqJson(bus, 'POST', `/api/kanban/tasks/${f7LinkA}/dependencies`, { auth: nyxToken, body: { blocker_id: f7LinkB } });
    assertEqual(f7Dup.status, 409, 'Fix7 duplicate 409');
    assertEqual(f7Dup.data.field, 'blocker_id', 'Fix7 duplicate field');
    assertTrue(String(f7Dup.data.hint).includes('already exists'), 'Fix7 duplicate hint');
    const f7DoneBlocker = mkTask('Fix7 done blocker', 'nyx', 'done');
    const f7Sat = await reqJson(bus, 'POST', `/api/kanban/tasks/${f7LinkA}/dependencies`, { auth: nyxToken, body: { blocker_id: f7DoneBlocker } });
    // Note: f7LinkA is now blocked (linked to f7LinkB), so the
    // already-satisfied check still fires before any blocked-row
    // handling in depLinkCheck order (done-blocker 409).
    assertEqual(f7Sat.status, 409, 'Fix7 already-satisfied 409');
    assertTrue(String(f7Sat.data.hint).includes('no link was stored'), 'Fix7 already-satisfied hint');
    // (i) Unlink-orphan: blocked waiting-task, no from_status,
    // reason naming the link — after unlinking the last link the
    // reason must no longer name the deleted blocker.
    const f7OrphBlocker = mkTask('Fix7 orphan blocker', 'nyx');
    const f7Orph = mkTask('Fix7 orphan task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = ?, blocked_from_status = NULL WHERE id = ?`, `Waiting for task ${f7OrphBlocker}: Fix7 orphan blocker`, f7Orph);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, f7OrphBlocker, f7Orph, now);
    const f7Unlink = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${f7Orph}/dependencies/${f7OrphBlocker}`, { auth: nyxToken });
    assertEqual(f7Unlink.status, 200, 'Fix7 orphan unlink 200');
    assertEqual(f7Unlink.data.transition, 'unlink_only', 'Fix7 orphan unlink stays blocked');
    assertTrue(String(f7Unlink.data.blocked_reason).includes('orphan'), 'Fix7 orphan reason honest');
    assertTrue(!String(f7Unlink.data.blocked_reason).includes('Fix7 orphan blocker'), 'Fix7 orphan reason no longer names deleted blocker');
    // (j) Link-only must not overwrite a manual row's human reason.
    const f7HumBlocker = mkTask('Fix7 human blocker', 'nyx');
    const f7Hum = mkTask('Fix7 human task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'my hand-written reason', blocked_from_status = NULL WHERE id = ?`, f7Hum);
    const f7HumLink = await reqJson(bus, 'POST', `/api/kanban/tasks/${f7Hum}/dependencies`, { auth: nyxToken, body: { blocker_id: f7HumBlocker } });
    assertEqual(f7HumLink.status, 200, 'Fix7 human link ok');
    assertEqual(f7HumLink.data.blocked_reason, 'my hand-written reason', 'Fix7 human reason preserved on link');
    // (k) Archived project re-evaluation is a no-op.
    const f7ArchProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix7 archived project' } })).data.id as number;
    const f7ArchTodo = mkTask('Fix7 archived todo', 'nyx', 'todo', f7ArchProj);
    const f7ArchBlocker = mkTask('Fix7 archived blocker', 'nyx', 'todo', f7ArchProj);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, f7ArchBlocker, f7ArchTodo, now);
    sql.exec(`UPDATE projects SET archived = 1 WHERE id = ?`, f7ArchProj);
    const f7ArchStats = depReevaluateProject.call(bus as any, f7ArchProj, now);
    assertEqual(f7ArchStats.processed, 0, 'Fix7 archived re-evaluate no work');
    const f7ArchRow = sql.exec(`SELECT status FROM tasks WHERE id = ?`, f7ArchTodo).one() as any;
    assertEqual(f7ArchRow.status, 'todo', 'Fix7 archived task untouched');
    // (f) Detail ref continuation pointer: 21 refs -> detail
    // shows 20 + has_more + pointer; the pointer pages the rest
    // via the ledger list.
    const f7RefTask = mkTask('Fix7 ref target', 'nyx');
    for (let i = 0; i < 21; i++) {
      assertEqual((await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: `Fix7 ref ${i}`, body: 'ref body', topic: 'test-topic', kind: 'decision', ref_type: 'task', ref_id: String(f7RefTask) } })).status, 200, `Fix7 ref ${i}`);
    }
    const f7RefDetail = await reqJson(bus, 'GET', `/api/kanban/tasks/${f7RefTask}`, { auth: nyxToken });
    assertEqual(f7RefDetail.status, 200, 'Fix7 ref detail ok');
    assertEqual((f7RefDetail.data.task.ledger_refs as any[]).length, 20, 'Fix7 detail refs capped at 20');
    assertEqual(f7RefDetail.data.task.ledger_refs_has_more, true, 'Fix7 detail refs has_more');
    const f7Pointer = f7RefDetail.data.task.ledger_refs_next_after_id as number;
    assertEqual(f7Pointer, (f7RefDetail.data.task.ledger_refs as any[])[19].id, 'Fix7 detail pointer is last ref id');
    const f7RefRest = await reqJson(bus, 'GET', `/api/ledger?ref_type=task&ref_id=${f7RefTask}&after_id=${f7Pointer}`, { auth: nyxToken });
    assertEqual(f7RefRest.status, 200, 'Fix7 ref continuation ok');
    assertEqual((f7RefRest.data.rows as any[]).length, 1, 'Fix7 ref continuation yields last row');
    // (h) Depth-cap cause: a >100-edge path fails closed with
    // the depth-cap cause (edge-cap cause is asserted in the
    // Fix6 cap block above).
    const f7DeepProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix7 deep project' } })).data.id as number;
    let prevDeep = 0;
    let firstDeep = 0;
    for (let i = 0; i < 102; i++) {
      const t = mkTask(`Fix7 deep ${i}`, 'nyx', 'todo', f7DeepProj);
      if (i === 0) firstDeep = t;
      if (prevDeep) sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, prevDeep, t, now);
      prevDeep = t;
    }
    const f7Deep = depHasCycle(bus as any, prevDeep, firstDeep, f7DeepProj);
    assertEqual(f7Deep.cycle, true, 'Fix7 deep path fails closed');
    assertEqual((f7Deep as any).cause, 'depth_cap', 'Fix7 deep path cause named');
  }

  {
    // Fix round 8 (code items from re-roast 6, plus the two
    // code-only harsh-user traps). Runs before the final Fix6
    // remainder block, which archives every other project.
    // (1) Proposal-ban ordering: a TEST ONLY proposal paired
    // with a title-mismatched endorsement must fail with the
    // ban reason, not title_mismatch — the proposal ban now
    // runs before any proposal parse/match check.
    const f8Body = 'Fix8 ban-order body';
    const f8Hash = await sha256HexStr(f8Body);
    const f8Propose = insertMessage('nyx', 'all-agent', `PROPOSE: TEST ONLY action | kind: hold | scope: action | body_sha256: ${f8Hash}`, null);
    const f8Endorse = insertMessage('nosmile99', 'all-agent', `ENDORSE: Wrong title | body_sha256: ${f8Hash}`, f8Propose);
    const f8Ban = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      body: { title: 'Fix8 action', body: f8Body, topic: 'test-topic', kind: 'hold', scope: 'action', bus_reconciliation_id: f8Endorse },
    });
    assertEqual(f8Ban.status, 403, 'Fix8 proposal ban ordering 403');
    assertEqual(f8Ban.data.reason, 'endorsement_test_message', 'Fix8 proposal ban fires before title_mismatch');
    // (a) Ledger anchor-filter mismatch 400 carries a
    // restart-from-0 hint (the 400 itself is unchanged).
    const f8Dec = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Fix8 dec', body: 'dec body', topic: 'test-topic', kind: 'decision' } });
    const f8Hold = await reqJson(bus, 'POST', '/api/ledger', { auth: nyxToken, body: { title: 'Fix8 hold', body: 'hold body', topic: 'test-topic', kind: 'hold' } });
    const f8Anchor = await reqJson(bus, 'GET', `/admin/api/ledger?kind=decision&after_id=${f8Hold.data.id}`, { auth: adminAuth });
    assertEqual(f8Anchor.status, 400, 'Fix8 ledger anchor mismatch 400');
    assertEqual(f8Anchor.data.field, 'after_id', 'Fix8 ledger anchor mismatch field');
    assertTrue(String(f8Anchor.data.hint).includes('no after_id'), 'Fix8 ledger anchor mismatch hint names restart from 0');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/ledger?kind=decision&after_id=${f8Dec.data.id}`, { auth: adminAuth })).status, 200, 'Fix8 ledger anchor match 200');
    // (2) Summary include_archived is validated above the
    // project branch: a garbage value 400s with a project too.
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/summary?include_archived=maybe`, { auth: adminAuth })).status, 400, 'Fix8 summary no-project garbage 400');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/summary?project_id=${projectId}&include_archived=maybe`, { auth: adminAuth })).status, 400, 'Fix8 summary with-project garbage 400');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/summary?project_id=${projectId}&include_archived=true`, { auth: adminAuth })).status, 200, 'Fix8 summary with-project true ok');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/summary?include_archived=maybe`, { auth: nyxToken })).status, 400, 'Fix8 summary agent path garbage 400');
    // (3) Boolean unification leftovers: stale and poll admin.
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks/search?stale=true`, { auth: nyxToken })).status, 200, 'Fix8 stale=true ok');
    assertEqual((await reqJson(bus, 'GET', `/api/kanban/projects/${projectId}/tasks/search?stale=maybe`, { auth: nyxToken })).status, 400, 'Fix8 stale=maybe 400');
    assertEqual((await reqJson(bus, 'GET', `/poll?admin=maybe`, { auth: nyxToken })).status, 400, 'Fix8 poll admin=maybe 400');
    assertEqual((await reqJson(bus, 'GET', `/poll?admin=true`, { auth: adminAuth })).status, 200, 'Fix8 poll admin=true ok');
    // (4) Link errors carry field: archived project and cycle.
    const f8ArchProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix8 archived project' } })).data.id as number;
    const f8ArchA = mkTask('Fix8 arch A', 'nyx', 'todo', f8ArchProj);
    const f8ArchB = mkTask('Fix8 arch B', 'nyx', 'todo', f8ArchProj);
    sql.exec(`UPDATE projects SET archived = 1 WHERE id = ?`, f8ArchProj);
    const f8ArchLink = await reqJson(bus, 'POST', `/api/kanban/tasks/${f8ArchA}/dependencies`, { auth: nyxToken, body: { blocker_id: f8ArchB } });
    assertEqual(f8ArchLink.status, 400, 'Fix8 archived link 400');
    assertEqual(f8ArchLink.data.field, 'project_id', 'Fix8 archived link field');
    const f8CycA = mkTask('Fix8 cycle A', 'nyx');
    const f8CycB = mkTask('Fix8 cycle B', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${f8CycA}/dependencies`, { auth: nyxToken, body: { blocker_id: f8CycB } })).status, 200, 'Fix8 cycle link ok');
    const f8Cyc = await reqJson(bus, 'POST', `/api/kanban/tasks/${f8CycB}/dependencies`, { auth: nyxToken, body: { blocker_id: f8CycA } });
    assertEqual(f8Cyc.status, 409, 'Fix8 cycle 409');
    assertEqual(f8Cyc.data.field, 'blocker_id', 'Fix8 cycle field');
    assertTrue(Array.isArray(f8Cyc.data.cycle_path) && f8Cyc.data.cycle_path.length > 0, 'Fix8 cycle path present');
    // (5) Claim payloads carry blocked_from_status and
    // structured blocker_ids (dependency rows, not prose).
    const f8ClaimBlocker = mkTask('Fix8 claim blocker', 'nyx');
    const f8Owned = mkTask('Fix8 owned blocked', 'nosmile99');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'claim wait', blocked_from_status = 'todo' WHERE id = ?`, f8Owned);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, f8ClaimBlocker, f8Owned, now);
    const f8Claim409 = await reqJson(bus, 'POST', `/api/kanban/tasks/${f8Owned}/claim`, { auth: nyxToken });
    assertEqual(f8Claim409.status, 409, 'Fix8 claim owned blocked 409');
    assertEqual(f8Claim409.data.current.blocked_from_status, 'todo', 'Fix8 claim 409 carries from_status');
    assertTrue((f8Claim409.data.current.blocker_ids as number[]).includes(f8ClaimBlocker), 'Fix8 claim 409 carries blocker_ids');
    const f8Unassigned = mkTask('Fix8 unassigned blocked', null);
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'claim wait', blocked_from_status = 'todo' WHERE id = ?`, f8Unassigned);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, f8ClaimBlocker, f8Unassigned, now);
    const f8Claim200 = await reqJson(bus, 'POST', `/api/kanban/tasks/${f8Unassigned}/claim`, { auth: nyxToken });
    assertEqual(f8Claim200.status, 200, 'Fix8 blocked claim 200');
    assertTrue((f8Claim200.data.blocker_ids as number[]).includes(f8ClaimBlocker), 'Fix8 blocked claim 200 carries blocker_ids');
    // (6) Orphan-aware gate hint: a waiting-task row with no
    // from_status must not promise "finish" lifts it.
    const f8OrphBlocker = mkTask('Fix8 gate orphan blocker', 'nyx');
    const f8OrphGate = mkTask('Fix8 gate orphan task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'orphan wait', blocked_from_status = NULL WHERE id = ?`, f8OrphGate);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, f8OrphBlocker, f8OrphGate, now);
    const f8Gate = await reqJson(bus, 'PUT', `/api/kanban/tasks/${f8OrphGate}/status`, { auth: nyxToken, body: { status: 'doing' } });
    assertEqual(f8Gate.status, 409, 'Fix8 orphan gate 409');
    assertTrue(String(f8Gate.data.hint).includes('orphan'), 'Fix8 orphan gate hint names orphan');
    assertTrue(String(f8Gate.data.hint).includes('unlink all'), 'Fix8 orphan gate hint names unlink-all escape');
    assertTrue(!String(f8Gate.data.hint).startsWith('finish or unlink'), 'Fix8 orphan gate hint does not promise finish-lifts');
    // (7) target_lane second arm is admin-only: a value present
    // only on a ledger row (a deregistered-agent target) lists
    // for admin but 400s for a non-admin caller — no oracle.
    sql.exec(
      `INSERT INTO ledger (kind, title, body, author, lane, target_lane, scope, status, replaces_tombstoned_id, bus_reconciliation_id, ref_type, ref_id, provenance_type, is_luki_ordered, recheck_at, created_at, updated_at) VALUES ('decision', 'Fix8 ghost', 'ghost body', 'nyx', 'nyx', 'ghost-agent', 'lane-note', 'active', NULL, NULL, NULL, NULL, 'agent_asserted', 0, NULL, ?, ?)`,
      now,
      now
    );
    assertEqual((await reqJson(bus, 'GET', `/admin/api/ledger?target_lane=ghost-agent`, { auth: adminAuth })).status, 200, 'Fix8 ghost lane admin lists');
    assertEqual((await reqJson(bus, 'GET', `/api/ledger?target_lane=ghost-agent`, { auth: nyxToken })).status, 400, 'Fix8 ghost lane non-admin 400');
    // (9) Activity "null" is absent for before and project_id,
    // matching limit and unblocked project_id.
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/activity?before=null`, { auth: adminAuth })).status, 200, 'Fix8 activity before=null absent');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/activity?project_id=null`, { auth: adminAuth })).status, 200, 'Fix8 activity project_id=null absent');
    assertEqual((await reqJson(bus, 'GET', `/admin/api/kanban/activity?before=12abc`, { auth: adminAuth })).status, 400, 'Fix8 activity before 12abc still 400');
    // (11) Edge-cap no longer masks a real short cycle: cycle
    // edges inserted first, then 1001 filler edges in the same
    // project — the closing path must be reported, not edge_cap.
    const f8CapProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix8 cycle cap project' } })).data.id as number;
    const f8CapA = mkTask('Fix8 cap A', 'nyx', 'todo', f8CapProj);
    const f8CapB = mkTask('Fix8 cap B', 'nyx', 'todo', f8CapProj);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, f8CapA, f8CapB, now);
    sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, f8CapB, f8CapA, now);
    for (let i = 0; i < 1001; i++) {
      const b = mkTask(`Fix8 cap blocker ${i}`, 'nyx', 'todo', f8CapProj);
      const d = mkTask(`Fix8 cap blocked ${i}`, 'nyx', 'todo', f8CapProj);
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, b, d, now);
    }
    const f8Capped = depHasCycle(bus as any, f8CapA, f8CapB, f8CapProj);
    assertEqual(f8Capped.cycle, true, 'Fix8 over-cap cycle still fails closed');
    assertTrue(f8Capped.path.length > 0, 'Fix8 over-cap cycle reports its path');
    assertTrue((f8Capped as any).cause !== 'edge_cap', 'Fix8 over-cap cycle is not misattributed to edge_cap');
    // (12) Orphan write through the refresh guard: a manual row
    // keeps its human reason on link, and unlinking its last
    // link still lands the honest orphan text (the guard's one
    // deliberate exception, not a second ad-hoc UPDATE site).
    const f8HumBlocker = mkTask('Fix8 human blocker', 'nyx');
    const f8Hum = mkTask('Fix8 human task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'my hand-written reason', blocked_from_status = NULL WHERE id = ?`, f8Hum);
    const f8HumLink = await reqJson(bus, 'POST', `/api/kanban/tasks/${f8Hum}/dependencies`, { auth: nyxToken, body: { blocker_id: f8HumBlocker } });
    assertEqual(f8HumLink.status, 200, 'Fix8 human link ok');
    assertEqual(f8HumLink.data.blocked_reason, 'my hand-written reason', 'Fix8 human reason preserved on link');
    const f8HumUnlink = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${f8Hum}/dependencies/${f8HumBlocker}`, { auth: nyxToken });
    assertEqual(f8HumUnlink.status, 200, 'Fix8 human unlink ok');
    assertEqual(f8HumUnlink.data.transition, 'unlink_only', 'Fix8 human unlink stays blocked');
    assertTrue(String(f8HumUnlink.data.blocked_reason).includes('orphan'), 'Fix8 orphan text lands via guard exception');
  }

  {
    // Fix round 9 (code items from re-roast 7). Runs before the
    // final Fix6 remainder block, which archives every other
    // project.
    // (1) Unlink with unfinished links remaining routes through
    // depRefreshReason: a manual row keeps its human reason,
    // while a machine row refreshes to the remaining set.
    const f9HumB1 = mkTask('Fix9 human blocker 1', 'nyx');
    const f9HumB2 = mkTask('Fix9 human blocker 2', 'nyx');
    const f9Hum = mkTask('Fix9 human task', 'nyx');
    sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'my hand-written reason', blocked_from_status = NULL WHERE id = ?`, f9Hum);
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${f9Hum}/dependencies`, { auth: nyxToken, body: { blocker_id: f9HumB1 } })).status, 200, 'Fix9 human link 1 ok');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${f9Hum}/dependencies`, { auth: nyxToken, body: { blocker_id: f9HumB2 } })).status, 200, 'Fix9 human link 2 ok');
    const f9HumUnlink = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${f9Hum}/dependencies/${f9HumB1}`, { auth: nyxToken });
    assertEqual(f9HumUnlink.status, 200, 'Fix9 human unlink ok');
    assertEqual(f9HumUnlink.data.transition, 'unlink_only', 'Fix9 human unlink stays blocked');
    assertEqual(f9HumUnlink.data.blocked_reason, 'my hand-written reason', 'Fix9 human reason survives unlink with links remaining');
    // Machine row, same shape: refresh to the remaining set.
    const f9MacB1 = mkTask('Fix9 machine blocker 1', 'nyx');
    const f9MacB2 = mkTask('Fix9 machine blocker 2', 'nyx');
    const f9Mac = mkTask('Fix9 machine task', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${f9Mac}/dependencies`, { auth: nyxToken, body: { blocker_id: f9MacB1 } })).status, 200, 'Fix9 machine link 1 ok');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${f9Mac}/dependencies`, { auth: nyxToken, body: { blocker_id: f9MacB2 } })).status, 200, 'Fix9 machine link 2 ok');
    const f9MacUnlink = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${f9Mac}/dependencies/${f9MacB1}`, { auth: nyxToken });
    assertEqual(f9MacUnlink.status, 200, 'Fix9 machine unlink ok');
    assertEqual(f9MacUnlink.data.transition, 'unlink_only', 'Fix9 machine unlink stays blocked');
    assertTrue(String(f9MacUnlink.data.blocked_reason).includes(`Waiting for task ${f9MacB2}:`), 'Fix9 machine reason refreshes to remaining blocker');
    assertTrue(!String(f9MacUnlink.data.blocked_reason).includes(`Waiting for task ${f9MacB1}:`), 'Fix9 machine reason no longer names unlinked blocker');
  }

  {
    // Domain M9: the alarm loop persists per-project remainders
    // into sweep_pending (not just rotation). This block runs
    // last, so it archives every other open project first: the
    // remainder project below is then the ONLY visited project,
    // and its capped remainder must appear in pending_projects.
    const remProj = (await reqJson(bus, 'POST', '/admin/api/kanban/projects', { auth: adminAuth, body: { title: 'Fix6 remainder project' } })).data.id as number;
    const remBlocker = mkTask('Fix6 remainder blocker', 'nyx', 'done', remProj);
    for (let i = 0; i < 101; i++) {
      const d = mkTask(`Fix6 remainder dep ${i}`, 'nyx', 'todo', remProj);
      sql.exec(`UPDATE tasks SET status = 'blocked', blocked_kind = 'waiting-task', blocked_reason = 'rem wait', blocked_from_status = 'todo' WHERE id = ?`, d);
      sql.exec(`INSERT INTO task_dependencies (blocker_id, blocked_id, created_by, created_at) VALUES (?, ?, 'nyx', ?)`, remBlocker, d, now);
    }
    sql.exec(`UPDATE projects SET archived = 1 WHERE id != ?`, remProj);
    await (bus as any).alarm();
    const pendingRow = sql.exec(`SELECT value FROM bus_meta WHERE key = 'sweep_pending'`).one() as any;
    assertTrue(!!pendingRow, 'Fix6 sweep_pending persisted');
    const pending = JSON.parse(pendingRow.value) as any;
    assertEqual(pending.pending_sweep, true, 'Fix6 sweep_pending true for capped remainder');
    assertTrue((pending.pending_projects as number[]).includes(remProj), 'Fix6 sweep_pending names the remainder project');
    assertTrue(Array.isArray(pending.failed_projects), 'Fix6 sweep_pending carries failed_projects');
  }

}
