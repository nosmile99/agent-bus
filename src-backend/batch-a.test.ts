// Automated test suite for the amendment batch (items 0, 1, 12):
// §4 re-claim blanket-clear revert, mechanical hold enforcement
// (ledger hold/gate + dissent hold), and the atomic rescue endpoint
// plus link/unlink-only dependency_changed wake events.
// Same harness shape as revamp-v12.test.ts: the runner supplies
// createDO. NOTE: the hold checks call taskHoldFor/dissentHoldFor
// from handlers/ledger.ts (already present in this copy); the
// handler code here only calls them, never reimplements their
// queries.
import { BusDO } from './index.js';
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
  // Same rate-clearing note as revamp-v12.test.ts: agent endpoints
  // are rate-limited (10/60s), so the harness clears the window
  // before each agent call unless keepRate is set.
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

export async function runBatchATests(
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
    body: { title: 'Batch A test project', description: 'amendment batch tests' },
  });
  assertEqual(projRes.status, 200, 'create project');
  const projectId = projRes.data.id as number;

  const now = Math.floor(Date.now() / 1000);
  function mkTask(title: string, assignee: string | null, status = 'todo'): number {
    sql.exec(
      `INSERT INTO tasks (project_id, title, status, assignee, priority, created_at, updated_at, lane) VALUES (?, ?, ?, ?, 'normal', ?, ?, 'unassigned')`,
      projectId,
      title,
      status,
      assignee,
      now,
      now
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }
  function mkUnblockedTask(title: string, assignee: string | null): number {
    sql.exec(
      `INSERT INTO tasks (project_id, title, status, assignee, priority, created_at, updated_at, lane, unblocked_at) VALUES (?, ?, 'todo', ?, 'normal', ?, ?, 'unassigned', ?)`,
      projectId,
      title,
      assignee,
      now,
      now,
      now
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }
  // Fixture shape the ledger helpers read (handlers/ledger.ts,
  // already present in this copy): an ACTIVE row of the given kind
  // with ref_type 'task' and ref_id the task id as a string
  // (ledger.ref_id is TEXT). Dissent rows additionally need
  // resolved = 0 (unresolved); the column defaults to 0, so the
  // INSERT below omits it deliberately.
  function mkLedgerRow(kind: string, taskId: number): number {
    sql.exec(
      `INSERT INTO ledger (kind, title, body, author, lane, scope, status, ref_type, ref_id, provenance_type, created_at, updated_at) VALUES (?, 't', 'b', 'nyx', 'nyx', 'action', 'active', 'task', ?, 'agent_asserted', ?, ?)`,
      kind,
      String(taskId),
      now,
      now
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }
  function taskRow(id: number): any {
    return sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).one() as any;
  }
  function linkIds(blockedId: number): number[] {
    return (
      sql.exec(`SELECT blocker_id FROM task_dependencies WHERE blocked_id = ? ORDER BY blocker_id ASC`, blockedId).toArray() as Array<{ blocker_id: number }>
    ).map((r) => r.blocker_id);
  }
  function depChangedEvents(taskId: number): Array<{ change: string; blocker_id: number }> {
    const rows = sql.exec(`SELECT payload FROM events WHERE type = 'kanban.task.dependency_changed' ORDER BY id ASC`).toArray() as Array<{ payload: string }>;
    const out: Array<{ change: string; blocker_id: number }> = [];
    for (const r of rows) {
      try {
        const p = JSON.parse(r.payload) as { task_id?: number; change?: string; blocker_id?: number };
        if (p.task_id === taskId && p.change && typeof p.blocker_id === 'number') {
          out.push({ change: p.change, blocker_id: p.blocker_id });
        }
      } catch {}
    }
    return out;
  }

  // ---- ITEM 0: §4 revert — already-owned re-claim clears unblocked_at ----
  {
    const t = mkUnblockedTask('Unblocked owned task', 'nyx');
    const before = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked`, { auth: nyxToken });
    assertEqual(before.status, 200, 'unblocked list ok');
    assertTrue((before.data.tasks as any[]).some((x) => x.id === t), 'task in unblocked list before re-claim');
    const r = await reqJson(bus, 'POST', `/api/kanban/tasks/${t}/claim`, { auth: nyxToken });
    assertEqual(r.status, 200, 'already-owned re-claim ok');
    assertEqual(r.data.already, true, 're-claim keeps already:true shape');
    assertEqual(taskRow(t).unblocked_at, null, 're-claim clears unblocked_at (blanket-clear)');
    const after = await reqJson(bus, 'GET', `/api/kanban/tasks/unblocked`, { auth: nyxToken });
    assertTrue(!(after.data.tasks as any[]).some((x) => x.id === t), 'task leaves unblocked list after re-claim');

    // Fresh claim still clears it too.
    const f = mkUnblockedTask('Unblocked free task', null);
    const fr = await reqJson(bus, 'POST', `/api/kanban/tasks/${f}/claim`, { auth: nyxToken });
    assertEqual(fr.status, 200, 'fresh claim ok');
    assertEqual(taskRow(f).status, 'doing', 'fresh claim moves to doing');
    assertEqual(taskRow(f).unblocked_at, null, 'fresh claim clears unblocked_at');
  }

  // ---- ITEM 1: mechanical hold enforcement ----
  {
    // Held task: agent status move rejected, nothing mutated.
    const held = mkTask('Held task', 'nyx');
    const holdId = mkLedgerRow('hold', held);
    const mv = await reqJson(bus, 'PUT', `/api/kanban/tasks/${held}/status`, {
      auth: nyxToken,
      body: { status: 'doing' },
    });
    assertEqual(mv.status, 409, 'held status move 409');
    assertEqual(mv.data.error, 'held', 'held error name');
    assertEqual(mv.data.ledger_id, holdId, 'held names the ledger row');
    assertEqual(taskRow(held).status, 'todo', 'held status move mutates nothing');
    assertEqual(taskRow(held).assignee, 'nyx', 'held status move keeps assignee');

    // Held task: claim rejected (including already-owned re-claim).
    const heldFree = mkTask('Held free task', null);
    mkLedgerRow('hold', heldFree);
    const cl = await reqJson(bus, 'POST', `/api/kanban/tasks/${heldFree}/claim`, { auth: nyxToken });
    assertEqual(cl.status, 409, 'held claim 409');
    assertEqual(cl.data.error, 'held', 'held claim error name');
    assertEqual(taskRow(heldFree).assignee, null, 'held claim assigns nothing');
    const clOwned = await reqJson(bus, 'POST', `/api/kanban/tasks/${held}/claim`, { auth: nyxToken });
    assertEqual(clOwned.status, 409, 'held already-owned re-claim 409 (not already:true)');

    // Dissent-held task: transition rejected with dissent id.
    const diss = mkTask('Dissent-held task', 'nyx');
    const dissentId = mkLedgerRow('dissent', diss);
    const dm = await reqJson(bus, 'PUT', `/api/kanban/tasks/${diss}/status`, {
      auth: nyxToken,
      body: { status: 'doing' },
    });
    assertEqual(dm.status, 409, 'dissent-held transition 409');
    assertEqual(dm.data.error, 'dissent_held', 'dissent-held error name');
    assertEqual(dm.data.dissent_id, dissentId, 'dissent-held names the dissent row');
    assertEqual(taskRow(diss).status, 'todo', 'dissent-held transition mutates nothing');

    // Unheld task still works.
    const free = mkTask('Free task', 'nyx');
    const ok = await reqJson(bus, 'PUT', `/api/kanban/tasks/${free}/status`, {
      auth: nyxToken,
      body: { status: 'doing' },
    });
    assertEqual(ok.status, 200, 'unheld status move ok');

    // Admin is not exempt: admin status move on a held task rejected.
    const heldAdmin = mkTask('Held admin task', 'nyx');
    mkLedgerRow('gate', heldAdmin);
    const am = await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${heldAdmin}`, {
      auth: adminAuth,
      body: { status: 'doing' },
    });
    assertEqual(am.status, 409, 'admin status move on held task 409');
    assertEqual(am.data.error, 'held', 'admin held error name');
    assertEqual(taskRow(heldAdmin).status, 'todo', 'admin held move mutates nothing');

    // Admin assignee change on a held task rejected.
    const heldAssign = mkTask('Held assign task', 'nyx');
    mkLedgerRow('hold', heldAssign);
    const aa = await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${heldAssign}`, {
      auth: adminAuth,
      body: { assignee: 'nosmile99' },
    });
    assertEqual(aa.status, 409, 'admin assignee change on held task 409');
    assertEqual(taskRow(heldAssign).assignee, 'nyx', 'admin held reassign mutates nothing');

    // A gate-kind row also holds (kind 'gate' counts, per item 1).
    assertTrue(taskRow(heldAdmin).status === 'todo', 'gate-kind hold leaves task untouched');
    void nosmileToken;
  }

  // ---- ITEM 12: atomic rescue endpoint ----
  {
    // Rescue with 2 links + status move + relink 1, one call.
    const target = mkTask('Rescue target', 'nyx');
    const b1 = mkTask('Rescue blocker 1', 'nyx');
    const b2 = mkTask('Rescue blocker 2', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${target}/dependencies`, { auth: nyxToken, body: { blocker_id: b1 } })).status, 200, 'rescue setup link 1');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${target}/dependencies`, { auth: nyxToken, body: { blocker_id: b2 } })).status, 200, 'rescue setup link 2');
    assertEqual(taskRow(target).status, 'blocked', 'rescue setup blocked');
    assertEqual(linkIds(target), [b1, b2].sort((a, b) => a - b), 'rescue setup has both links');
    const r = await reqJson(bus, 'POST', `/api/kanban/tasks/${target}/rescue`, {
      auth: nyxToken,
      body: { status: 'todo', relink: [b1] },
    });
    assertEqual(r.status, 200, 'rescue ok');
    assertEqual(r.data.target_status, 'todo', 'rescue target_status echoed');
    assertEqual([...(r.data.unlinked as number[])].sort((a, b) => a - b), [b1, b2].sort((a, b) => a - b), 'rescue unlinked both old links');
    assertEqual(r.data.relinked, [{ blocker_id: b1, ok: true }], 'rescue relinked 1');
    assertEqual(r.data.relink_failed, [], 'rescue no relink failures');
    assertEqual(linkIds(target), [b1], 'rescue final state: old links gone, new link present');
    // Re-linking an unfinished blocker re-blocks via the normal link
    // transition (see the handler comment): the move to todo
    // happened, then the re-link owned the block again.
    assertEqual(taskRow(target).status, 'blocked', 'rescue final status is blocked after re-link re-blocks');
    assertEqual(r.data.status, 'blocked', 'rescue response status is the final status');
    assertEqual(taskRow(target).blocked_from_status, 'todo', 'rescue re-link owns the block from todo');

    // Retry of the same rescue is a no-op success (idempotent).
    const retry = await reqJson(bus, 'POST', `/api/kanban/tasks/${target}/rescue`, {
      auth: nyxToken,
      body: { status: 'todo', relink: [b1] },
    });
    assertEqual(retry.status, 200, 'rescue retry ok');
    assertEqual(linkIds(target), [b1], 'rescue retry final links unchanged');
    assertEqual(taskRow(target).status, 'blocked', 'rescue retry final status unchanged');

    // Rescue of a task with no links succeeds, status moved.
    const bare = mkTask('Bare rescue task', 'nyx');
    const br = await reqJson(bus, 'POST', `/api/kanban/tasks/${bare}/rescue`, {
      auth: nyxToken,
      body: { status: 'doing' },
    });
    assertEqual(br.status, 200, 'bare rescue ok');
    assertEqual(br.data.unlinked, [], 'bare rescue unlinks nothing');
    assertEqual(br.data.relinked, [], 'bare rescue relinks nothing');
    assertEqual(br.data.status, 'doing', 'bare rescue status moved');
    assertEqual(taskRow(bare).status, 'doing', 'bare rescue db status moved');

    // Default target status is todo, and a relink of an already-
    // satisfied (done) blocker is skipped, not failed.
    const doneBlocker = mkTask('Done blocker', 'nyx', 'done');
    const skip = mkTask('Skip rescue task', 'nyx', 'doing');
    const sr = await reqJson(bus, 'POST', `/api/kanban/tasks/${skip}/rescue`, {
      auth: nyxToken,
      body: { relink: [doneBlocker] },
    });
    assertEqual(sr.status, 200, 'skip rescue ok');
    assertEqual(sr.data.target_status, 'todo', 'rescue default target is todo');
    assertEqual(sr.data.status, 'todo', 'skip rescue final status todo');
    assertEqual(sr.data.relinked, [{ blocker_id: doneBlocker, ok: true, skipped: 'already-satisfied' }], 'done blocker relink skipped');
    assertEqual(sr.data.relink_failed, [], 'done blocker relink not failed');
    assertEqual(linkIds(skip), [], 'done blocker relink stores no link');

    // Admin rescue variant works.
    const adm = mkTask('Admin rescue task', 'nyx', 'doing');
    const ar = await reqJson(bus, 'POST', `/admin/api/kanban/tasks/${adm}/rescue`, {
      auth: adminAuth,
      body: { status: 'todo' },
    });
    assertEqual(ar.status, 200, 'admin rescue ok');
    assertEqual(taskRow(adm).status, 'todo', 'admin rescue db status moved');
  }

  // ---- ITEM 12 (tail): link/unlink-only changes emit a poll wake ----
  {
    const t = mkTask('Wake task', 'nyx');
    const w1 = mkTask('Wake blocker 1', 'nyx');
    const w2 = mkTask('Wake blocker 2', 'nyx');
    const w3 = mkTask('Wake blocker 3', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${t}/dependencies`, { auth: nyxToken, body: { blocker_id: w1 } })).status, 200, 'wake setup link 1');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${t}/dependencies`, { auth: nyxToken, body: { blocker_id: w2 } })).status, 200, 'wake setup link 2');
    // Third link on an already-blocked task is link-only: it must
    // emit kanban.task.dependency_changed with change 'linked'.
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${t}/dependencies`, { auth: nyxToken, body: { blocker_id: w3 } })).status, 200, 'wake link-only ok');
    assertTrue(
      depChangedEvents(t).some((e) => e.change === 'linked' && e.blocker_id === w3),
      'link-only emits dependency_changed linked'
    );
    // Unlinking one of several links is unlink-only (still blocked):
    // it must emit kanban.task.dependency_changed with 'unlinked'.
    const un = await reqJson(bus, 'DELETE', `/api/kanban/tasks/${t}/dependencies/${w3}`, { auth: nyxToken });
    assertEqual(un.status, 200, 'wake unlink-only ok');
    assertEqual(un.data.transition, 'unlink_only', 'wake unlink is unlink-only');
    assertTrue(
      depChangedEvents(t).some((e) => e.change === 'unlinked' && e.blocker_id === w3),
      'unlink-only emits dependency_changed unlinked'
    );
  }
}
