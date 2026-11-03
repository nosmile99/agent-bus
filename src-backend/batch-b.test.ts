// Amendment batch tests (items 2, 4, 5b/13, 10, 19, 21).
// Same harness shape as revamp-v12.test.ts: the runner supplies
// createDO. Run by the parent at integration; this file only
// exports runBatchBTests(createDO).
import { BusDO } from './index.js';
import { taskHoldFor, dissentHoldFor } from './handlers/ledger.js';
import type { Env, IBusDO } from './types.js';

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

export async function runBatchBTests(
  createDO: (envOverrides?: Partial<Env>) => TestHarness
): Promise<void> {
  const adminAuth = 'Basic ' + btoa('luki:secret123');
  const { bus, sql, init } = createDO();
  await init();
  const busDO = bus as unknown as IBusDO;

  // Migration v9 applied.
  {
    const migs = sql.exec(`SELECT version FROM schema_migrations ORDER BY version ASC`).toArray() as Array<{ version: number }>;
    assertTrue(migs.map((m) => m.version).includes(9), 'schema version 9 applied');
    const cols = sql.exec(`SELECT name FROM pragma_table_info('ledger')`).toArray() as Array<{ name: string }>;
    for (const c of ['topic', 'resolver', 'resolved', 'resolved_by', 'resolved_at']) {
      assertTrue(cols.some((x) => x.name === c), `ledger.${c} exists`);
    }
    const ct = sql.exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='ledger_contradictions'`).toArray();
    assertEqual(ct.length, 1, 'ledger_contradictions exists');
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
    body: { title: 'Batch B project', description: 'batch-b tests' },
  });
  assertEqual(projRes.status, 200, 'create project');
  const projectId = projRes.data.id as number;

  const now = Math.floor(Date.now() / 1000);
  function mkTask(title: string, proj: number = projectId, description: string | null = null): number {
    sql.exec(
      `INSERT INTO tasks (project_id, title, description, status, priority, created_at, updated_at, lane) VALUES (?, ?, ?, 'todo', 'normal', ?, ?, 'unassigned')`,
      proj,
      title,
      description,
      now,
      now
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }
  function insertMessage(sender: string, channel: string, body: string, replyTo: number | null = null): number {
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
  async function mkLedger(
    auth: string,
    body: Record<string, unknown>
  ): Promise<{ status: number; data: Record<string, any> }> {
    return reqJson(bus, 'POST', '/api/ledger', { auth, body });
  }
  function ledgerRow(id: number): Record<string, any> {
    return sql.exec(`SELECT * FROM ledger WHERE id = ?`, id).one() as unknown as Record<string, any>;
  }

  // ---- Item 4: sticky protection -------------------------------------
  {
    const seedMsg = insertMessage('luki', 'all-agent', 'Luki orders batch-b rule');
    const seed = await reqJson(bus, 'POST', '/admin/api/ledger/seed', {
      auth: adminAuth,
      body: { title: 'Batch rule', body: 'rule body', kind: 'protocol', luki_message_id: seedMsg },
    });
    assertEqual(seed.status, 200, 'item4 luki seed');
    const lukiId = seed.data.id as number;
    assertEqual(ledgerRow(lukiId).is_luki_ordered, 1, 'item4 seed is luki_ordered');
    // Admin + valid luki message supersede -> successor still luki_ordered.
    const supMsg = insertMessage('luki', 'all-agent', 'Luki orders batch-b supersede');
    const sup = await reqJson(bus, 'POST', `/admin/api/ledger/${lukiId}/supersede`, {
      auth: adminAuth,
      body: { title: 'Batch rule v2', body: 'rule body v2', luki_message_id: supMsg, ref_type: 'bus_message', ref_id: String(supMsg) },
    });
    assertEqual(sup.status, 200, 'item4 luki supersede');
    const succId = sup.data.id as number;
    assertEqual(sup.data.is_luki_ordered, true, 'item4 successor response luki_ordered');
    assertEqual(sup.data.provenance_type, 'luki_ordered', 'item4 successor provenance');
    assertEqual(ledgerRow(succId).is_luki_ordered, 1, 'item4 successor db luki_ordered');
    // Second supersede without credential -> 403 (admin and agent).
    assertEqual(
      (await reqJson(bus, 'POST', `/admin/api/ledger/${succId}/supersede`, {
        auth: adminAuth,
        body: { title: 'No cred', body: 'x', ref_type: 'task', ref_id: String(mkTask('Item4 task')) },
      })).status,
      403,
      'item4 admin supersede without credential 403'
    );
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${succId}/supersede`, {
        auth: nyxToken,
        body: { title: 'No cred agent', body: 'x', ref_type: 'task', ref_id: String(mkTask('Item4 task 2')) },
      })).status,
      403,
      'item4 agent supersede protected 403'
    );
    // With credential -> succeeds and stays luki_ordered.
    const supMsg2 = insertMessage('luki', 'all-agent', 'Luki orders batch-b supersede 2');
    const sup2 = await reqJson(bus, 'POST', `/admin/api/ledger/${succId}/supersede`, {
      auth: adminAuth,
      body: { title: 'Batch rule v3', body: 'rule body v3', luki_message_id: supMsg2, ref_type: 'bus_message', ref_id: String(supMsg2) },
    });
    assertEqual(sup2.status, 200, 'item4 second luki supersede');
    assertEqual(ledgerRow(sup2.data.id as number).is_luki_ordered, 1, 'item4 chain stays luki_ordered');
    // Tombstone of the protected successor without credential -> 403;
    // with a fresh luki message -> succeeds (protection chain intact).
    assertEqual(
      (await reqJson(bus, 'POST', `/admin/api/ledger/${sup2.data.id}/tombstone`, {
        auth: adminAuth,
        body: { reason: 'no cred tombstone' },
      })).status,
      403,
      'item4 protected tombstone without credential 403'
    );
    const tombMsg = insertMessage('luki', 'all-agent', 'Luki orders batch-b tombstone');
    assertEqual(
      (await reqJson(bus, 'POST', `/admin/api/ledger/${sup2.data.id}/tombstone`, {
        auth: adminAuth,
        body: { reason: 'cred tombstone', luki_message_id: tombMsg },
      })).status,
      200,
      'item4 protected tombstone with credential ok'
    );
  }

  // ---- Item 2a: topic -------------------------------------------------
  {
    assertEqual(
      (await mkLedger(nyxToken, { title: 'No topic decision', body: 'x', kind: 'decision' })).status,
      400,
      'item2a decision without topic 400'
    );
    assertEqual(
      (await mkLedger(nyxToken, { title: 'Empty topic hold', body: 'x', kind: 'hold', topic: '   ' })).status,
      400,
      'item2a hold empty topic 400'
    );
    assertEqual(
      (await mkLedger(nyxToken, { title: 'No topic gate', body: 'x', kind: 'gate' })).status,
      400,
      'item2a gate without topic 400'
    );
    const proto = await mkLedger(nyxToken, { title: 'Proto no topic', body: 'x', kind: 'protocol' });
    assertEqual(proto.status, 200, 'item2a protocol without topic ok');
    const dec = await mkLedger(nyxToken, { title: 'Topical decision', body: 'x', kind: 'decision', topic: 'auth-model' });
    assertEqual(dec.status, 200, 'item2a decision with topic ok');
    const got = await reqJson(bus, 'GET', `/api/ledger/${dec.data.id}`, { auth: nyxToken });
    assertEqual(got.status, 200, 'item2a get topical');
    assertEqual((got.data.row as any).topic, 'auth-model', 'item2a get carries topic');
  }

  // ---- Item 2b/2c: contradiction + resolver ----------------------------
  let contraRowId = 0;
  let contraTargetId = 0;
  {
    const a = await mkLedger(nyxToken, { title: 'Nyx claim', body: 'nyx body', kind: 'decision', topic: 'claims' });
    assertEqual(a.status, 200, 'item2b nyx row');
    const b = await mkLedger(nosmileToken, { title: 'Nosmile claim', body: 'nosmile body', kind: 'decision', topic: 'claims' });
    assertEqual(b.status, 200, 'item2b nosmile row');
    contraRowId = b.data.id as number;
    contraTargetId = a.data.id as number;
    // Flagging your own row -> 400.
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${contraRowId}/contradiction`, {
        auth: nosmileToken,
        body: { contradicts_id: contraTargetId },
      })).status,
      400,
      'item2b own-row flag 400'
    );
    // Nonexistent target -> 404; self -> 400.
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${contraRowId}/contradiction`, {
        auth: nyxToken,
        body: { contradicts_id: 999999 },
      })).status,
      404,
      'item2b nonexistent contradicts 404'
    );
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${contraRowId}/contradiction`, {
        auth: nyxToken,
        body: { contradicts_id: contraRowId },
      })).status,
      400,
      'item2b self-contradiction 400'
    );
    // Nyx flags nosmile's row as contradicting nyx's row -> 200.
    const flag = await reqJson(bus, 'POST', `/api/ledger/${contraRowId}/contradiction`, {
      auth: nyxToken,
      body: { contradicts_id: contraTargetId },
    });
    assertEqual(flag.status, 200, 'item2b flag ok');
    // Duplicate -> 409.
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${contraRowId}/contradiction`, {
        auth: nyxToken,
        body: { contradicts_id: contraTargetId },
      })).status,
      409,
      'item2b duplicate flag 409'
    );
    // Surfaces on both rows.
    const rowGet = await reqJson(bus, 'GET', `/api/ledger/${contraRowId}`, { auth: nyxToken });
    assertEqual((rowGet.data.row as any).has_contradiction, true, 'item2b flagged row has_contradiction');
    assertTrue(((rowGet.data.row as any).contradicts_ids as number[]).includes(contraTargetId), 'item2b contradicts_ids');
    const targetGet = await reqJson(bus, 'GET', `/api/ledger/${contraTargetId}`, { auth: nyxToken });
    assertEqual((targetGet.data.row as any).has_contradiction, true, 'item2b target has_contradiction');
    assertTrue(((targetGet.data.row as any).contradicted_by_ids as number[]).includes(contraRowId), 'item2b contradicted_by_ids');
    assertTrue(((targetGet.data.row as any).contradicting_ids as number[]).includes(contraRowId), 'item2b contradicting_ids union');
    // Admin variant flags a fresh pair.
    const c = await mkLedger(nyxToken, { title: 'Admin contra row', body: 'x', kind: 'decision', topic: 'claims' });
    const d = await mkLedger(nosmileToken, { title: 'Admin contra target', body: 'x', kind: 'decision', topic: 'claims' });
    assertEqual(
      (await reqJson(bus, 'POST', `/admin/api/ledger/${c.data.id}/contradiction`, {
        auth: adminAuth,
        body: { contradicts_id: d.data.id },
      })).status,
      200,
      'item2b admin flag ok'
    );
    // Resolver: invalid -> 400; create with resolver ok; non-author
    // set -> 403; author set -> 200; admin set -> 200.
    assertEqual(
      (await mkLedger(nyxToken, { title: 'Bad resolver', body: 'x', kind: 'decision', topic: 't', resolver: 'ghost' })).status,
      400,
      'item2c create bad resolver 400'
    );
    const withRes = await mkLedger(nyxToken, { title: 'With resolver', body: 'x', kind: 'decision', topic: 't', resolver: 'nosmile99' });
    assertEqual(withRes.status, 200, 'item2c create with resolver ok');
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${withRes.data.id}/resolver`, {
        auth: nosmileToken,
        body: { resolver: 'nyx' },
      })).status,
      403,
      'item2c non-author resolver 403'
    );
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${withRes.data.id}/resolver`, {
        auth: nyxToken,
        body: { resolver: 'ghost' },
      })).status,
      400,
      'item2c resolver invalid 400'
    );
    const setRes = await reqJson(bus, 'POST', `/api/ledger/${withRes.data.id}/resolver`, {
      auth: nyxToken,
      body: { resolver: 'admin' },
    });
    assertEqual(setRes.status, 200, 'item2c author resolver set ok');
    assertEqual(setRes.data.resolver, 'admin', 'item2c resolver echoed');
    const adminSet = await reqJson(bus, 'POST', `/admin/api/ledger/${withRes.data.id}/resolver`, {
      auth: adminAuth,
      body: { resolver: 'nyx' },
    });
    assertEqual(adminSet.status, 200, 'item2c admin resolver set ok');
  }

  // ---- Item 2d: single successor --------------------------------------
  {
    const base = await mkLedger(nyxToken, { title: 'Doomed row', body: 'x', kind: 'decision', topic: 'doom' });
    assertEqual(base.status, 200, 'item2d base');
    const baseId = base.data.id as number;
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${baseId}/tombstone`, { auth: nyxToken, body: { reason: 'superseded by replacement' } })).status,
      200,
      'item2d tombstone base'
    );
    const rep1 = await mkLedger(nyxToken, { title: 'Replacement one', body: 'x', kind: 'decision', topic: 'doom', replaces_tombstoned_id: baseId });
    assertEqual(rep1.status, 200, 'item2d first replacement ok');
    assertEqual(
      (await mkLedger(nyxToken, { title: 'Replacement two', body: 'x', kind: 'decision', topic: 'doom', replaces_tombstoned_id: baseId })).status,
      409,
      'item2d second replacement 409'
    );
    // Supersede chain stays linear: superseding the already
    // superseded base 409s (existing behaviour, verified not
    // duplicated by the new guard).
    const live = await mkLedger(nyxToken, { title: 'Chain row', body: 'x', kind: 'decision', topic: 'chain' });
    const taskForChain = mkTask('Chain task');
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${live.data.id}/supersede`, {
        auth: nyxToken,
        body: { title: 'Chain row v2', body: 'x', ref_type: 'task', ref_id: String(taskForChain) },
      })).status,
      200,
      'item2d chain supersede ok'
    );
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${live.data.id}/supersede`, {
        auth: nyxToken,
        body: { title: 'Chain row v3', body: 'x', ref_type: 'task', ref_id: String(taskForChain) },
      })).status,
      409,
      'item2d supersede of superseded 409'
    );
  }

  // ---- Item 10: stale / recheck inherit / deadline --------------------
  {
    const past = await mkLedger(nyxToken, { title: 'Past recheck', body: 'x', kind: 'decision', topic: 'recheck', recheck_at: now - 3600 });
    assertEqual(past.status, 200, 'item10 past recheck create');
    const pastGet = await reqJson(bus, 'GET', `/api/ledger/${past.data.id}`, { auth: nyxToken });
    assertEqual((pastGet.data.row as any).stale, true, 'item10 GET stale true');
    const future = await mkLedger(nyxToken, { title: 'Future recheck', body: 'x', kind: 'decision', topic: 'recheck', recheck_at: now + 86400 });
    assertEqual(future.status, 200, 'item10 future recheck create');
    const futureGet = await reqJson(bus, 'GET', `/api/ledger/${future.data.id}`, { auth: nyxToken });
    assertEqual((futureGet.data.row as any).stale, false, 'item10 GET stale false');
    const list = await reqJson(bus, 'GET', '/api/ledger?kind=decision&limit=100', { auth: nyxToken });
    assertEqual(list.status, 200, 'item10 list ok');
    const pastInList = (list.data.rows as any[]).find((r) => r.id === past.data.id);
    assertTrue(!!pastInList && pastInList.stale === true, 'item10 list stale true');
    // Supersede omitting recheck_at inherits; explicit null clears
    // with an audit note.
    const inheritTask = mkTask('Inherit task');
    const supOmit = await reqJson(bus, 'POST', `/api/ledger/${future.data.id}/supersede`, {
      auth: nyxToken,
      body: { title: 'Future recheck v2', body: 'x', ref_type: 'task', ref_id: String(inheritTask) },
    });
    assertEqual(supOmit.status, 200, 'item10 supersede omit ok');
    assertEqual(ledgerRow(supOmit.data.id as number).recheck_at, now + 86400, 'item10 supersede inherits recheck_at');
    const supNull = await reqJson(bus, 'POST', `/api/ledger/${supOmit.data.id}/supersede`, {
      auth: nyxToken,
      body: { title: 'Future recheck v3', body: 'x', ref_type: 'task', ref_id: String(inheritTask), recheck_at: null },
    });
    assertEqual(supNull.status, 200, 'item10 supersede explicit null ok');
    assertEqual(ledgerRow(supNull.data.id as number).recheck_at, null, 'item10 explicit null clears recheck_at');
    const ev = sql.exec(
      `SELECT reason FROM ledger_events WHERE ledger_id = ? AND action = 'supersede' ORDER BY id DESC LIMIT 1`,
      supNull.data.id
    ).one() as any;
    assertTrue(String(ev.reason).includes('recheck_at_cleared:explicit_null'), 'item10 explicit null audit note');
    // Q8 deadline flags: past deadline -> overdue true, future false.
    // (The endpoint rejects past deadlines, so set them via SQL.)
    const dlRow = await mkLedger(nyxToken, { title: 'Deadline row', body: 'x', kind: 'decision', topic: 'deadline' });
    sql.exec(`UPDATE ledger SET demote_deadline = ? WHERE id = ?`, now - 60, dlRow.data.id);
    const dlGet = await reqJson(bus, 'GET', `/api/ledger/${dlRow.data.id}`, { auth: nyxToken });
    assertEqual((dlGet.data.row as any).recheck_deadline_overdue, true, 'item10 GET deadline overdue true');
    sql.exec(`UPDATE ledger SET demote_deadline = ? WHERE id = ?`, now + 86400, dlRow.data.id);
    const dlGet2 = await reqJson(bus, 'GET', `/api/ledger/${dlRow.data.id}`, { auth: nyxToken });
    assertEqual((dlGet2.data.row as any).recheck_deadline_overdue, false, 'item10 GET deadline overdue false');
    const dlList = await reqJson(bus, 'GET', '/api/ledger?kind=decision&limit=100', { auth: nyxToken });
    const dlInList = (dlList.data.rows as any[]).find((r) => r.id === dlRow.data.id);
    assertTrue(!!dlInList && dlInList.recheck_deadline_overdue === false, 'item10 list deadline flag');
  }

  // ---- Item 19: dissent effect ----------------------------------------
  {
    const base = await mkLedger(nyxToken, { title: 'Dissent base', body: 'x', kind: 'decision', topic: 'dissent-base' });
    assertEqual(base.status, 200, 'item19 base');
    const baseId = base.data.id as number;
    // Dissent on a ledger row (ref_type 'ledger').
    const dis = await mkLedger(nosmileToken, { title: 'Dissent ledger', body: 'disagree', kind: 'dissent', ref_type: 'ledger', ref_id: String(baseId), resolver: 'nyx' });
    assertEqual(dis.status, 200, 'item19 dissent on ledger row');
    const disId = dis.data.id as number;
    let hold = dissentHoldFor.call(busDO, 'ledger', String(baseId));
    assertEqual(hold.held, true, 'item19 dissentHoldFor ledger true');
    assertEqual(hold.dissent_id, disId, 'item19 dissentHoldFor ledger id');
    // Dissent on a task.
    const taskTarget = mkTask('Dissent task target');
    const disTask = await mkLedger(nyxToken, { title: 'Dissent task', body: 'disagree', kind: 'dissent', ref_type: 'task', ref_id: String(taskTarget), resolver: 'nosmile99' });
    assertEqual(disTask.status, 200, 'item19 dissent on task');
    hold = dissentHoldFor.call(busDO, 'task', String(taskTarget));
    assertEqual(hold.held, true, 'item19 dissentHoldFor task true');
    // taskHoldFor contract: hold/gate rows on a task.
    const holdRow = await mkLedger(nyxToken, { title: 'Hold row', body: 'x', kind: 'hold', topic: 'holds', ref_type: 'task', ref_id: String(taskTarget) });
    assertEqual(holdRow.status, 200, 'item19 hold row');
    const th = taskHoldFor.call(busDO, taskTarget);
    assertEqual(th.held, true, 'item19 taskHoldFor true');
    assertEqual(th.ledger_id, holdRow.data.id, 'item19 taskHoldFor id');
    assertEqual(taskHoldFor.call(busDO, 999999).held, false, 'item19 taskHoldFor false');
    // Non-authority resolve -> 403 (author nosmile is not the
    // resolver of the ledger dissent; resolver is nyx).
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${disId}/resolve-dissent`, { auth: nosmileToken, body: {} })).status,
      403,
      'item19 non-resolver resolve 403'
    );
    // Resolver resolves -> hold lifts.
    assertEqual(
      (await reqJson(bus, 'POST', `/api/ledger/${disId}/resolve-dissent`, { auth: nyxToken, body: {} })).status,
      200,
      'item19 resolver resolve ok'
    );
    hold = dissentHoldFor.call(busDO, 'ledger', String(baseId));
    assertEqual(hold.held, false, 'item19 dissentHoldFor false after resolve');
    // Admin variant resolves the task dissent.
    assertEqual(
      (await reqJson(bus, 'POST', `/admin/api/ledger/${disTask.data.id}/resolve-dissent`, { auth: adminAuth, body: {} })).status,
      200,
      'item19 admin resolve ok'
    );
    assertEqual(dissentHoldFor.call(busDO, 'task', String(taskTarget)).held, false, 'item19 task dissent lifted');
    // Resolving a non-dissent row -> 400 (via the ADMIN route:
    // the agent route needs a Bearer agent, so Basic auth on it
    // is 401 by the auth layer, not a statement about the row);
    // dissent on a missing ledger row -> 400.
    assertEqual(
      (await reqJson(bus, 'POST', `/admin/api/ledger/${baseId}/resolve-dissent`, { auth: adminAuth, body: {} })).status,
      400,
      'item19 resolve non-dissent 400'
    );
    assertEqual(
      (await mkLedger(nyxToken, { title: 'Dissent ghost', body: 'x', kind: 'dissent', ref_type: 'ledger', ref_id: '999999' })).status,
      400,
      'item19 dissent missing ledger target 400'
    );
  }

  // ---- Item 19b (fix round, re-review GAP 1): ledger-target
  // dissent holds supersede/tombstone ---------------------------
  {
    const base = await mkLedger(nyxToken, { title: 'Dissent hold base', body: 'x', kind: 'decision', topic: 'dissent-hold' });
    assertEqual(base.status, 200, 'item19b base');
    const baseId = base.data.id as number;
    const dis = await mkLedger(nosmileToken, { title: 'Dissent hold', body: 'disagree', kind: 'dissent', ref_type: 'ledger', ref_id: String(baseId), resolver: 'nyx' });
    assertEqual(dis.status, 200, 'item19b dissent');
    const disId = dis.data.id as number;
    const taskRef = mkTask('Dissent hold ref task');
    const supBody = { title: 'Dissent hold base v2', body: 'x', ref_type: 'task', ref_id: String(taskRef) };
    // Author supersede held -> 409 dissent_held, row unchanged.
    const supHeld = await reqJson(bus, 'POST', `/api/ledger/${baseId}/supersede`, { auth: nyxToken, body: supBody });
    assertEqual(supHeld.status, 409, 'item19b supersede held 409');
    assertEqual(supHeld.data.error, 'dissent_held', 'item19b supersede held error');
    assertEqual(supHeld.data.dissent_id, disId, 'item19b supersede held dissent_id');
    assertEqual(ledgerRow(baseId).status, 'active', 'item19b row still active after held supersede');
    // Author tombstone held -> 409 dissent_held, row unchanged.
    const tombHeld = await reqJson(bus, 'POST', `/api/ledger/${baseId}/tombstone`, { auth: nyxToken, body: { reason: 'try tombstone' } });
    assertEqual(tombHeld.status, 409, 'item19b tombstone held 409');
    assertEqual(tombHeld.data.error, 'dissent_held', 'item19b tombstone held error');
    assertEqual(ledgerRow(baseId).status, 'active', 'item19b row still active after held tombstone');
    // Admin is NOT exempt from a dissent hold either.
    const supAdminHeld = await reqJson(bus, 'POST', `/admin/api/ledger/${baseId}/supersede`, { auth: adminAuth, body: supBody });
    assertEqual(supAdminHeld.status, 409, 'item19b admin supersede held 409');
    assertEqual(ledgerRow(baseId).status, 'active', 'item19b row still active after held admin supersede');
    // Resolver resolves -> hold lifts; supersede then succeeds.
    assertEqual((await reqJson(bus, 'POST', `/api/ledger/${disId}/resolve-dissent`, { auth: nyxToken, body: {} })).status, 200, 'item19b resolver resolve ok');
    const supOk = await reqJson(bus, 'POST', `/api/ledger/${baseId}/supersede`, { auth: nyxToken, body: supBody });
    assertEqual(supOk.status, 200, 'item19b supersede ok after resolve');
    assertEqual(ledgerRow(baseId).status, 'superseded', 'item19b row superseded after resolve');
    // Second row: tombstone path end-to-end.
    const base2 = await mkLedger(nyxToken, { title: 'Dissent hold base 2', body: 'x', kind: 'decision', topic: 'dissent-hold-2' });
    const base2Id = base2.data.id as number;
    const dis2 = await mkLedger(nosmileToken, { title: 'Dissent hold 2', body: 'disagree', kind: 'dissent', ref_type: 'ledger', ref_id: String(base2Id), resolver: 'nyx' });
    assertEqual(dis2.status, 200, 'item19b dissent 2');
    assertEqual((await reqJson(bus, 'POST', `/api/ledger/${base2Id}/tombstone`, { auth: nyxToken, body: { reason: 'try' } })).status, 409, 'item19b tombstone 2 held 409');
    assertEqual((await reqJson(bus, 'POST', `/api/ledger/${dis2.data.id}/resolve-dissent`, { auth: nyxToken, body: {} })).status, 200, 'item19b resolve 2 ok');
    const tombOk = await reqJson(bus, 'POST', `/api/ledger/${base2Id}/tombstone`, { auth: nyxToken, body: { reason: 'resolved, tombstoning' } });
    assertEqual(tombOk.status, 200, 'item19b tombstone ok after resolve');
    assertEqual(ledgerRow(base2Id).status, 'tombstoned', 'item19b row tombstoned after resolve');
  }

  // ---- Item 19c (re-roast 9, bug M2): an active unresolved dissent
  // row cannot exit via supersede/tombstone - that would dissolve its
  // own hold with resolved still 0 and no resolve_dissent event.
  // The only exit while unresolved is resolve-dissent (admin or
  // designated resolver); admin is NOT exempt. Once resolved, the
  // row is an ordinary active row and transitions proceed.
  {
    const base = await mkLedger(nyxToken, { title: 'M2 base', body: 'x', kind: 'decision', topic: 'm2-base' });
    const baseId = base.data.id as number;
    const dis = await mkLedger(nosmileToken, { title: 'M2 dissent', body: 'disagree', kind: 'dissent', ref_type: 'ledger', ref_id: String(baseId), resolver: 'nyx' });
    assertEqual(dis.status, 200, 'item19c dissent');
    const disId = dis.data.id as number;
    // Author supersede -> 409 dissent_unresolved, row + hold intact.
    const supSelf = await reqJson(bus, 'POST', `/api/ledger/${disId}/supersede`, { auth: nosmileToken, body: { title: 'M2 dissent v2', body: 'still disagree', ref_type: 'ledger', ref_id: String(baseId) } });
    assertEqual(supSelf.status, 409, 'item19c author supersede own dissent 409');
    assertEqual(supSelf.data.error, 'dissent_unresolved', 'item19c supersede error name');
    assertEqual(ledgerRow(disId).status, 'active', 'item19c dissent still active after supersede attempt');
    assertEqual(dissentHoldFor.call(busDO, 'ledger', String(baseId)).held, true, 'item19c target hold intact after supersede attempt');
    // Author tombstone -> same 409.
    const tombSelf = await reqJson(bus, 'POST', `/api/ledger/${disId}/tombstone`, { auth: nosmileToken, body: { reason: 'withdraw' } });
    assertEqual(tombSelf.status, 409, 'item19c author tombstone own dissent 409');
    assertEqual(tombSelf.data.error, 'dissent_unresolved', 'item19c tombstone error name');
    assertEqual(ledgerRow(disId).status, 'active', 'item19c dissent still active after tombstone attempt');
    // Admin is NOT exempt either (admin can resolve first).
    assertEqual((await reqJson(bus, 'POST', `/admin/api/ledger/${disId}/supersede`, { auth: adminAuth, body: { title: 'Admin v2', body: 'x', ref_type: 'ledger', ref_id: String(baseId) } })).status, 409, 'item19c admin supersede unresolved dissent 409');
    assertEqual(ledgerRow(disId).resolved, 0, 'item19c dissent still unresolved');
    // Resolver resolves -> supersede now proceeds. The successor
    // inherits kind 'dissent', so it IS a new active dissent and the
    // hold legitimately persists via the successor (supersede
    // replaces a dissent, it does not dissolve it); resolving the
    // successor then lifts the hold.
    assertEqual((await reqJson(bus, 'POST', `/api/ledger/${disId}/resolve-dissent`, { auth: nyxToken, body: {} })).status, 200, 'item19c resolver resolve ok');
    const supAfter = await reqJson(bus, 'POST', `/api/ledger/${disId}/supersede`, { auth: nosmileToken, body: { title: 'M2 dissent v2', body: 'still disagree', ref_type: 'ledger', ref_id: String(baseId) } });
    assertEqual(supAfter.status, 200, 'item19c supersede after resolve ok');
    assertEqual(ledgerRow(disId).status, 'superseded', 'item19c original dissent superseded');
    const succId = supAfter.data.id as number;
    assertEqual(ledgerRow(succId).kind, 'dissent', 'item19c successor is still a dissent');
    assertEqual(dissentHoldFor.call(busDO, 'ledger', String(baseId)).held, true, 'item19c hold persists via successor dissent');
    assertEqual((await reqJson(bus, 'POST', `/api/ledger/${succId}/resolve-dissent`, { auth: nyxToken, body: {} })).status, 200, 'item19c successor resolve ok');
    assertEqual(dissentHoldFor.call(busDO, 'ledger', String(baseId)).held, false, 'item19c hold lifted after successor resolve');
    // Second dissent: tombstone after resolve proceeds.
    const base2 = await mkLedger(nyxToken, { title: 'M2 base 2', body: 'x', kind: 'decision', topic: 'm2-base-2' });
    const base2Id = base2.data.id as number;
    const dis2 = await mkLedger(nosmileToken, { title: 'M2 dissent 2', body: 'disagree', kind: 'dissent', ref_type: 'ledger', ref_id: String(base2Id), resolver: 'nyx' });
    const dis2Id = dis2.data.id as number;
    assertEqual((await reqJson(bus, 'POST', `/api/ledger/${dis2Id}/resolve-dissent`, { auth: nyxToken, body: {} })).status, 200, 'item19c resolve 2 ok');
    const tombAfter = await reqJson(bus, 'POST', `/api/ledger/${dis2Id}/tombstone`, { auth: nosmileToken, body: { reason: 'resolved, withdrawing' } });
    assertEqual(tombAfter.status, 200, 'item19c tombstone after resolve ok');
    assertEqual(ledgerRow(dis2Id).status, 'tombstoned', 'item19c dissent 2 tombstoned');
    // Hold rows differ by design: no dedicated release endpoint.
    // A plain supersede (kind inherited) REPLACES the hold with a
    // successor hold row; tombstone (or a supersede changing kind
    // away from hold/gate) is what releases it - the author lifting
    // their own gate, audited as a ledger transition.
    const holdTask = mkTask('M2 hold task');
    const hold = await mkLedger(nyxToken, { title: 'M2 hold', body: 'hold body', kind: 'hold', topic: 'm2-hold', ref_type: 'task', ref_id: String(holdTask) });
    assertEqual(hold.status, 200, 'item19c hold row');
    assertEqual(taskHoldFor.call(busDO, holdTask).held, true, 'item19c hold active');
    const holdSup = await reqJson(bus, 'POST', `/api/ledger/${hold.data.id}/supersede`, { auth: nyxToken, body: { title: 'M2 hold v2', body: 'hold body v2', ref_type: 'task', ref_id: String(holdTask) } });
    assertEqual(holdSup.status, 200, 'item19c hold supersede ok');
    assertEqual(taskHoldFor.call(busDO, holdTask).held, true, 'item19c hold persists via successor hold');
    const holdSuccId = holdSup.data.id as number;
    const holdTomb = await reqJson(bus, 'POST', `/api/ledger/${holdSuccId}/tombstone`, { auth: nyxToken, body: { reason: 'gate lifted' } });
    assertEqual(holdTomb.status, 200, 'item19c hold tombstone ok');
    assertEqual(taskHoldFor.call(busDO, holdTask).held, false, 'item19c hold lifted by tombstone');
  }


  // ---- Item 21: ref-pointer scan + readability -------------------------
  {
    // Blocklisted message -> 400 naming the category.
    const secretMsg = insertMessage('nyx', 'all-agent', 'note api_key: abcdefghijklmnop here');
    const blocked = await mkLedger(nyxToken, { title: 'Ref secret', body: 'x', kind: 'decision', topic: 'refs', ref_type: 'bus_message', ref_id: String(secretMsg) });
    assertEqual(blocked.status, 400, 'item21 blocklisted message ref 400');
    assertEqual(blocked.data.reason, 'secret', 'item21 blocklist reason names category');
    // Clean readable message -> ok.
    const cleanMsg = insertMessage('nyx', 'all-agent', 'a perfectly ordinary note');
    assertEqual(
      (await mkLedger(nyxToken, { title: 'Ref clean', body: 'x', kind: 'decision', topic: 'refs', ref_type: 'bus_message', ref_id: String(cleanMsg) })).status,
      200,
      'item21 clean readable message ref ok'
    );
    // Unreadable message: private channel with only nyx as member.
    sql.exec(`INSERT INTO channels (name, created_by, created_at) VALUES ('private-chan', 'nyx', ?)`, now);
    sql.exec(`INSERT INTO channel_members (channel, agent, added_by, added_at) VALUES ('private-chan', 'nyx', 'nyx', ?)`, now);
    const privMsg = insertMessage('nyx', 'private-chan', 'private note for nyx only');
    assertEqual(
      (await mkLedger(nosmileToken, { title: 'Ref private', body: 'x', kind: 'decision', topic: 'refs', ref_type: 'bus_message', ref_id: String(privMsg) })).status,
      403,
      'item21 unreadable message ref 403'
    );
    assertEqual(
      (await mkLedger(nyxToken, { title: 'Ref private self', body: 'x', kind: 'decision', topic: 'refs', ref_type: 'bus_message', ref_id: String(privMsg) })).status,
      200,
      'item21 readable private message ref ok'
    );
    // Unreadable task: project restricted to nyx via subscribers.
    const privProj = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
      auth: adminAuth,
      body: { title: 'Restricted project', description: 'nyx only' },
    });
    assertEqual(privProj.status, 200, 'item21 restricted project');
    const privProjId = privProj.data.id as number;
    sql.exec(`INSERT INTO project_subscribers (project_id, agent, added_by, added_at) VALUES (?, 'nyx', 'admin', ?)`, privProjId, now);
    const privTask = mkTask('Restricted task', privProjId);
    assertEqual(
      (await mkLedger(nosmileToken, { title: 'Ref restricted task', body: 'x', kind: 'decision', topic: 'refs', ref_type: 'task', ref_id: String(privTask) })).status,
      403,
      'item21 unreadable task ref 403'
    );
    assertEqual(
      (await mkLedger(nyxToken, { title: 'Ref restricted task self', body: 'x', kind: 'decision', topic: 'refs', ref_type: 'task', ref_id: String(privTask) })).status,
      200,
      'item21 readable task ref ok'
    );
    // Blocklisted task title -> 400.
    const badTask = mkTask('task api_key: abcdefghijklmnop leak');
    assertEqual(
      (await mkLedger(nyxToken, { title: 'Ref bad task', body: 'x', kind: 'decision', topic: 'refs', ref_type: 'task', ref_id: String(badTask) })).status,
      400,
      'item21 blocklisted task ref 400'
    );
  }

  // ---- Item 5b/13: since/changed filters + poll wake -------------------
  {
    // since: bump two rows' updated_at to fixed points either side
    // of the filter (other rows sit at real now, below the filter).
    const rowA = await mkLedger(nyxToken, { title: 'Since A', body: 'x', kind: 'decision', topic: 'since' });
    const rowB = await mkLedger(nyxToken, { title: 'Since B', body: 'x', kind: 'decision', topic: 'since' });
    sql.exec(`UPDATE ledger SET updated_at = 1000000000 WHERE id = ?`, rowA.data.id);
    sql.exec(`UPDATE ledger SET updated_at = 3000000000 WHERE id = ?`, rowB.data.id);
    const sinceIso = new Date(2000000000 * 1000).toISOString();
    const sinceList = await reqJson(bus, 'GET', `/api/ledger?since=${encodeURIComponent(sinceIso)}&limit=100`, { auth: nyxToken });
    assertEqual(sinceList.status, 200, 'item13 since list ok');
    const sinceIds = (sinceList.data.rows as any[]).map((r) => r.id);
    assertTrue(sinceIds.includes(rowB.data.id), 'item13 since includes newer row');
    assertTrue(!sinceIds.includes(rowA.data.id), 'item13 since excludes older row');
    assertEqual(
      (await reqJson(bus, 'GET', '/api/ledger?since=not-a-date', { auth: nyxToken })).status,
      400,
      'item13 since invalid 400'
    );
    // changed_after_id: every returned row id must exceed it, and
    // a row created after it must be present.
    const gateRow = await mkLedger(nyxToken, { title: 'Changed gate', body: 'x', kind: 'gate', topic: 'changed' });
    assertEqual(gateRow.status, 200, 'item13 changed gate create');
    const changedList = await reqJson(bus, 'GET', `/api/ledger?kind=gate&changed_after_id=${(gateRow.data.id as number) - 1}&limit=100`, { auth: nyxToken });
    assertEqual(changedList.status, 200, 'item13 changed list ok');
    assertTrue((changedList.data.rows as any[]).every((r) => r.id > (gateRow.data.id as number) - 1), 'item13 changed rows all after cursor');
    assertTrue((changedList.data.rows as any[]).some((r) => r.id === gateRow.data.id), 'item13 changed includes new row');
    // Poll wake: a ledger create emits a ledger.changed event the
    // creating agent can read via poll.
    const wakeRow = await mkLedger(nyxToken, { title: 'Wake row', body: 'x', kind: 'decision', topic: 'wake' });
    assertEqual(wakeRow.status, 200, 'item13 wake create');
    const poll = await reqJson(bus, 'GET', '/poll?since_ts=0&since_id=0', { auth: nyxToken });
    assertEqual(poll.status, 200, 'item13 poll ok');
    const wakeEvents = (poll.data.events as any[]).filter(
      (e) => e.type === 'ledger.changed' && (e.payload as any).ledger_id === wakeRow.data.id
    );
    assertTrue(wakeEvents.length >= 1, 'item13 poll shows ledger.changed for created row');
    // Event-row fallback (same event in the events table).
    const evRow = sql.exec(`SELECT type FROM events WHERE type = 'ledger.changed' AND payload LIKE ?`, `%${wakeRow.data.id}%`).toArray();
    assertTrue(evRow.length >= 1, 'item13 ledger.changed event row exists');
  }
}
