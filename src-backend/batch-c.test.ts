// Amendment batch test suite (items 5, 13a, 13d, 14):
// cutover machine state, wake bundle, separate read/write buckets,
// discovery. Same harness shape as revamp-v12.test.ts: the runner
// supplies createDO.
import { BusDO } from './index.js';
import { rlCheck, rlCheckRead, rlCheckWrite, rlReadRetryAfterSeconds } from './handlers/agents.js';
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
  // Same convention as revamp-v12.test.ts: clear the rate window
  // before each agent call unless keepRate is set (bucket tests use
  // keepRate so they can observe bucket state across calls).
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

function clearRate(bus: BusDO): void {
  (bus as any).rateLimit?.clear?.();
}

export async function runBatchCTests(
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
    body: { title: 'Batch C test project', description: 'amendment batch tests' },
  });
  assertEqual(projRes.status, 200, 'create project');
  const projectId = projRes.data.id as number;

  const now = Math.floor(Date.now() / 1000);
  function mkLedger(
    kind: string,
    title: string,
    targetLane: string | null,
    createdAt: number = now,
    updatedAt: number = now
  ): number {
    sql.exec(
      `INSERT INTO ledger (kind, title, body, author, lane, target_lane, scope, status, provenance_type, is_luki_ordered, created_at, updated_at) VALUES (?, ?, 'batch-c body', 'nyx', 'nyx', ?, 'lane-note', 'active', 'agent_asserted', 0, ?, ?)`,
      kind,
      title,
      targetLane,
      createdAt,
      updatedAt
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }
  function mkTask(
    title: string,
    assignee: string | null,
    status = 'todo',
    opts: { unblockedAt?: number | null; lane?: string } = {}
  ): number {
    sql.exec(
      `INSERT INTO tasks (project_id, title, status, assignee, priority, created_at, updated_at, lane, unblocked_at) VALUES (?, ?, ?, ?, 'normal', ?, ?, ?, ?)`,
      projectId,
      title,
      status,
      assignee,
      now,
      now,
      opts.lane || 'unassigned',
      opts.unblockedAt ?? null
    );
    return (sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
  }
  function ledgerCount(): number {
    return (sql.exec(`SELECT COUNT(*) AS n FROM ledger`).one() as { n: number }).n;
  }

  // ---- Item 5: cutover defaults -------------------------------------
  {
    const r = await reqJson(bus, 'GET', '/api/cutover', { auth: nyxToken });
    assertEqual(r.status, 200, 'agent cutover GET');
    assertEqual(r.data.authority_state, 'memory_authoritative', 'default authority state');
    assertEqual(r.data.seed_checklist, { items: [] }, 'default checklist empty');
    const admin = await reqJson(bus, 'GET', '/admin/api/cutover', { auth: adminAuth });
    assertEqual(admin.status, 200, 'admin cutover GET');
    assertEqual(admin.data.authority_state, 'memory_authoritative', 'admin sees default state');
  }

  // ---- Item 5: non-admin flip rejected -------------------------------
  {
    const r = await reqJson(bus, 'POST', '/admin/api/cutover/flip', {
      auth: nyxToken,
      body: { authority_state: 'bus_authoritative' },
    });
    assertEqual(r.status, 401, 'agent flip rejected');
    const noAuth = await reqJson(bus, 'POST', '/admin/api/cutover/flip', {
      body: { authority_state: 'bus_authoritative' },
    });
    assertEqual(noAuth.status, 401, 'unauthenticated flip rejected');
    const still = await reqJson(bus, 'GET', '/api/cutover', { auth: nyxToken });
    assertEqual(still.data.authority_state, 'memory_authoritative', 'failed flip changes nothing');
    const badValue = await reqJson(bus, 'POST', '/admin/api/cutover/flip', {
      auth: adminAuth,
      body: { authority_state: 'sideways' },
    });
    assertEqual(badValue.status, 400, 'invalid flip value rejected');
  }

  // ---- Item 5: admin flip + flip back --------------------------------
  // Argon safety round: the flip OUT of memory_authoritative is now
  // LOCKED (409) until a seed list plus a checklist mark-done
  // endpoint exist. This block replaces the old flip-away-200
  // expectation with the locked behaviour; the change is deliberate
  // (Luki's LGTM on the dormant-ship default), not a test weakening.
  {
    const flip = await reqJson(bus, 'POST', '/admin/api/cutover/flip', {
      auth: adminAuth,
      body: { authority_state: 'bus_authoritative' },
    });
    assertEqual(flip.status, 409, 'flip away locked');
    assertTrue(typeof flip.data.hint === 'string' && flip.data.hint.includes('seed list'), 'locked flip hints at seed list + mark-done');
    const after = await reqJson(bus, 'GET', '/api/cutover', { auth: nyxToken });
    assertEqual(after.data.authority_state, 'memory_authoritative', 'rejected flip changes nothing');
    const flipsLog = sql.exec(`SELECT value FROM bus_meta WHERE key = 'cutover_flips'`).toArray() as Array<{ value: string }>;
    assertTrue(flipsLog.length === 0 || JSON.parse(flipsLog[0]!.value).length === 0, 'rejected flip writes no audit entry');
    const stay = await reqJson(bus, 'POST', '/admin/api/cutover/flip', {
      auth: adminAuth,
      body: { authority_state: 'memory_authoritative' },
    });
    assertEqual(stay.status, 200, 'flip to memory_authoritative still allowed');
    assertEqual(stay.data.authority_state, 'memory_authoritative', 'stay value');
  }

  // ---- Item 5: checklist append creates NO ledger rows ---------------
  {
    const before = ledgerCount();
    const app = await reqJson(bus, 'POST', '/admin/api/cutover/checklist', {
      auth: adminAuth,
      body: { title: 'Reconcile ledger into MEMORY.md' },
    });
    assertEqual(app.status, 200, 'checklist append');
    assertEqual(app.data.item.state, 'pending', 'appended item is pending');
    assertEqual(app.data.seed_checklist.items.length, 1, 'checklist has one item');
    assertEqual(ledgerCount(), before, 'checklist append creates no ledger rows');
    const agentAppend = await reqJson(bus, 'POST', '/admin/api/cutover/checklist', {
      auth: nyxToken,
      body: { title: 'Agent must not append' },
    });
    assertEqual(agentAppend.status, 401, 'agent checklist append rejected');
    const dup = await reqJson(bus, 'POST', '/admin/api/cutover/checklist', {
      auth: adminAuth,
      body: { id: app.data.item.id, title: 'Duplicate id' },
    });
    assertEqual(dup.status, 409, 'duplicate checklist id rejected');
    const get = await reqJson(bus, 'GET', '/api/cutover', { auth: nyxToken });
    assertEqual(get.data.seed_checklist.items.length, 1, 'checklist visible on GET');
  }

  // ---- Item 13a: wake bundle shape + visibility ----------------------
  const holdPublic = mkLedger('hold', 'Public hold', null);
  const holdNyx = mkLedger('hold', 'Nyx hold', 'nyx');
  const gateOther = mkLedger('gate', 'Nosmile gate', 'nosmile99');
  const decisionLatest = mkLedger('decision', 'Plain decision', null);
  const ownTask = mkTask('Nyx own task', 'nyx', 'doing');
  mkTask('Available task', null, 'todo');
  const unblockedTask = mkTask('Unblocked task', 'nyx', 'todo', { unblockedAt: now });
  mkTask('Nosmile task', 'nosmile99', 'todo');
  {
    const r = await reqJson(bus, 'GET', '/api/wake', { auth: nyxToken });
    assertEqual(r.status, 200, 'wake bundle');
    for (const section of ['holds', 'unblocked', 'tasks', 'ledger_changed']) {
      assertTrue(Array.isArray(r.data[section]), `bundle has ${section} array`);
    }
    const holdIds = (r.data.holds as Array<Record<string, any>>).map((h) => h.id);
    assertTrue(holdIds.includes(holdPublic), 'bundle holds include public hold');
    assertTrue(holdIds.includes(holdNyx), 'bundle holds include own hold');
    assertTrue(!holdIds.includes(gateOther), 'bundle holds exclude other-agent gate');
    assertTrue(
      (r.data.holds as Array<Record<string, any>>).every((h) => h.kind === 'hold' || h.kind === 'gate'),
      'holds are hold/gate only'
    );
    const unblockedIds = (r.data.unblocked as Array<Record<string, any>>).map((t) => t.id);
    assertTrue(unblockedIds.includes(unblockedTask), 'bundle unblocked includes unblocked task');
    const taskIds = (r.data.tasks as Array<Record<string, any>>).map((t) => t.id);
    assertTrue(taskIds.includes(ownTask), 'bundle tasks include own task');
    const changed = r.data.ledger_changed as Array<Record<string, any>>;
    assertTrue(changed.length <= 20, 'bundle ledger_changed defaults to at most 20');
    assertTrue(changed.length > 0 && changed[0]!.id === decisionLatest, 'ledger_changed latest first');
    const noAuth = await reqJson(bus, 'GET', '/api/wake', {});
    assertEqual(noAuth.status, 401, 'wake bundle unauthenticated');
    const badSince = await reqJson(bus, 'GET', '/api/wake?since=not-a-date', { auth: nyxToken });
    assertEqual(badSince.status, 400, 'wake bundle invalid since');
  }

  // ---- Item 13a: ?since narrows ledger_changed -----------------------
  {
    const oldRow = mkLedger('decision', 'Old row', null, now - 10000, now - 10000);
    const newRow = mkLedger('decision', 'New row', null, now, now);
    const sinceIso = new Date((now - 100) * 1000).toISOString();
    const r = await reqJson(bus, 'GET', `/api/wake?since=${encodeURIComponent(sinceIso)}`, { auth: nyxToken });
    assertEqual(r.status, 200, 'wake bundle with since');
    const changedIds = (r.data.ledger_changed as Array<Record<string, any>>).map((row) => row.id);
    assertTrue(changedIds.includes(newRow), 'since filter includes recent row');
    assertTrue(!changedIds.includes(oldRow), 'since filter excludes old row');
  }

  // ---- Item 13a/13d: one bundle call = exactly 1 read unit -----------
  {
    clearRate(bus);
    for (let i = 0; i < 9; i++) {
      assertTrue(rlCheckRead.call(bus, 'nyx'), `direct read unit ${i + 1} of 10`);
    }
    const tenth = await reqJson(bus, 'GET', '/api/wake', { auth: nyxToken, keepRate: true });
    assertEqual(tenth.status, 200, 'bundle succeeds as 10th read unit');
    const eleventh = await reqJson(bus, 'GET', '/api/wake', { auth: nyxToken, keepRate: true });
    assertEqual(eleventh.status, 429, 'bundle fails as 11th read unit');
    assertTrue(typeof eleventh.data.retry_after_seconds === 'number', 'read 429 carries retry_after_seconds');
    assertTrue(rlReadRetryAfterSeconds.call(bus, 'nyx') >= 1, 'read retry-after is at least 1');
  }

  // ---- Item 13d: exhausting write does not block reads ---------------
  {
    clearRate(bus);
    for (let i = 0; i < 10; i++) {
      assertTrue(rlCheckWrite.call(bus, 'nyx'), `write unit ${i + 1} of 10`);
    }
    assertTrue(!rlCheckWrite.call(bus, 'nyx'), 'write bucket exhausted');
    const bundle = await reqJson(bus, 'GET', '/api/wake', { auth: nyxToken, keepRate: true });
    assertEqual(bundle.status, 200, 'bundle still 200 with write bucket exhausted');
    const discovery = await reqJson(bus, 'GET', '/api/discovery', { auth: nyxToken, keepRate: true });
    assertEqual(discovery.status, 200, 'discovery still 200 with write bucket exhausted');
    const cutover = await reqJson(bus, 'GET', '/api/cutover', { auth: nyxToken, keepRate: true });
    assertEqual(cutover.status, 200, 'cutover GET still 200 with write bucket exhausted');
  }

  // ---- Item 13d: exhausting read does not block writes ---------------
  // rlCheck is the write-bucket alias: filling it via rlCheck leaves
  // the read bucket untouched, and vice versa.
  {
    clearRate(bus);
    for (let i = 0; i < 10; i++) {
      assertTrue(rlCheck.call(bus, 'nyx'), `rlCheck alias unit ${i + 1} of 10`);
    }
    assertTrue(rlCheckRead.call(bus, 'nyx'), 'read bucket untouched by rlCheck alias fills');
    clearRate(bus);
    for (let i = 0; i < 10; i++) {
      assertTrue(rlCheckRead.call(bus, 'nyx'), `read unit ${i + 1} of 10`);
    }
    assertTrue(!rlCheckRead.call(bus, 'nyx'), 'read bucket exhausted');
    const create = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      keepRate: true,
      body: { title: 'Batch C write survives read exhaustion', body: 'write bucket is separate', kind: 'decision', scope: 'lane-note', topic: 'test-topic' },
    });
    assertEqual(create.status, 200, 'ledger write still 200 with read bucket exhausted');
  }

  // ---- Fix round (re-review GAP 2, #13): full read migration ---
  // Write-bucket exhaustion must not block ANY triage read, and
  // read-bucket exhaustion must not block writes. Each read below
  // consumes one read unit, so the triage list is split across two
  // write-exhausted rounds (6 + 5) to stay within the 10-unit
  // read window per round.
  {
    const taskId = mkTask('Bucket triage task', 'nyx');
    const ledgerId = mkLedger('decision', 'Bucket ledger row', null);
    async function fillWrite(): Promise<void> {
      clearRate(bus);
      for (let i = 0; i < 10; i++) {
        assertTrue(rlCheckWrite.call(bus, 'nyx'), `gap2 write unit ${i + 1} of 10`);
      }
      assertTrue(!rlCheckWrite.call(bus, 'nyx'), 'gap2 write bucket exhausted');
    }
    async function expectReads200(paths: Array<[string, string]>): Promise<void> {
      for (const [name, path] of paths) {
        const r = await reqJson(bus, 'GET', path, { auth: nyxToken, keepRate: true });
        assertEqual(r.status, 200, `gap2 ${name} still 200 with write bucket exhausted`);
      }
    }
    await fillWrite();
    await expectReads200([
      ['wake bundle', '/api/wake'],
      ['ledger list', '/api/ledger'],
      ['ledger get', `/api/ledger/${ledgerId}`],
      ['ledger events', `/api/ledger/${ledgerId}/events`],
      ['task detail', `/api/kanban/tasks/${taskId}`],
      ['available', '/api/kanban/tasks/available'],
    ]);
    await fillWrite();
    await expectReads200([
      ['search', `/api/kanban/projects/${projectId}/tasks/search?q=Bucket`],
      ['sweep-health', '/api/kanban/sweep-health'],
      ['dep list', `/api/kanban/tasks/${taskId}/dependencies`],
      ['dep events', `/api/kanban/tasks/${taskId}/dependencies/events`],
      ['unblocked', `/api/kanban/tasks/unblocked?project_id=${projectId}`],
    ]);
    // Read-bucket exhaustion blocks reads (proving reads really
    // charge the read bucket) but not writes.
    clearRate(bus);
    for (let i = 0; i < 10; i++) {
      assertTrue(rlCheckRead.call(bus, 'nyx'), `gap2 read unit ${i + 1} of 10`);
    }
    const readBlocked = await reqJson(bus, 'GET', '/api/ledger', { auth: nyxToken, keepRate: true });
    assertEqual(readBlocked.status, 429, 'gap2 ledger list 429 with read bucket exhausted');
    const create = await reqJson(bus, 'POST', '/api/ledger', {
      auth: nyxToken,
      keepRate: true,
      body: { title: 'Gap2 write survives read exhaustion', body: 'write bucket is separate', kind: 'decision', scope: 'lane-note', topic: 'test-topic' },
    });
    assertEqual(create.status, 200, 'gap2 ledger write still 200 with read bucket exhausted');
  }


  // ---- Item 14: discovery --------------------------------------------
  {
    const r = await reqJson(bus, 'GET', '/api/discovery', { auth: nyxToken });
    assertEqual(r.status, 200, 'discovery');
    assertEqual(r.data.version, 'revamp-v12', 'discovery version');
    assertEqual(r.data.commit, 'unknown', 'discovery commit is honestly unknown');
    assertTrue(typeof r.data.spec === 'string' && r.data.spec.includes('17.11'), 'discovery spec reference');
    assertEqual(r.data.routes_generated_from, 'hono-app-routes', 'routes generated from app introspection');
    assertTrue(Array.isArray(r.data.routes), 'discovery routes is an array');
    const paths = (r.data.routes as Array<Record<string, any>>).map((rt) => `${rt.method} ${rt.path}`);
    assertTrue(paths.includes('GET /api/ledger'), 'discovery routes include ledger list');
    assertTrue(paths.includes('GET /api/kanban/tasks/available'), 'discovery routes include kanban available');
    assertTrue(paths.includes('GET /api/wake'), 'discovery routes include wake bundle');
    assertTrue(paths.includes('GET /api/cutover'), 'discovery routes include cutover');
    assertTrue(paths.includes('GET /api/discovery'), 'discovery routes include discovery itself');
    const noAuth = await reqJson(bus, 'GET', '/api/discovery', {});
    assertEqual(noAuth.status, 401, 'discovery unauthenticated');
    void nosmileToken;
  }

  // ---- Argon safety round: authority notes, wake transparency,
  // freeing blocker ---------------------------------------------------
  // Item 2: discovery + wake authority notes (dormant vs bus state).
  {
    const d = await reqJson(bus, 'GET', '/api/discovery', { auth: nyxToken });
    assertEqual(d.status, 200, 'safety discovery');
    assertEqual(d.data.authority_state, 'memory_authoritative', 'discovery dormant state');
    assertTrue(typeof d.data.authority_note === 'string' && d.data.authority_note.includes('MEMORY.md is the sole authoritative source'), 'discovery dormant note');
    assertTrue(typeof d.data.contradiction_note === 'string' && d.data.contradiction_note.includes('annotations only'), 'discovery contradiction note');
    // Bus-state note honesty: simulate a store flipped before the
    // lock existed by writing bus_meta directly (the flip endpoint
    // can no longer produce this state).
    sql.exec(`INSERT INTO bus_meta (key, value) VALUES ('authority_state', 'bus_authoritative') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    const dBus = await reqJson(bus, 'GET', '/api/discovery', { auth: nyxToken });
    assertEqual(dBus.data.authority_state, 'bus_authoritative', 'discovery reflects bus state');
    assertTrue(typeof dBus.data.authority_note === 'string' && dBus.data.authority_note.includes('ledger is the authoritative source'), 'discovery bus note is not the dormant note');
    assertTrue(!String(dBus.data.authority_note).includes('MEMORY.md is the sole'), 'bus note does not hardcode dormant wording');
    sql.exec(`INSERT INTO bus_meta (key, value) VALUES ('authority_state', 'memory_authoritative') ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    const w = await reqJson(bus, 'GET', '/api/wake', { auth: nyxToken });
    assertEqual(w.status, 200, 'safety wake');
    assertEqual(w.data.authority_state, 'memory_authoritative', 'wake dormant state');
    assertTrue(String(w.data.authority_note).includes('MEMORY.md is the sole authoritative source'), 'wake dormant note');
  }

  // Item 3: wake caps + has_more / truncated flags.
  {
    // 21 more unblocked tasks for nyx (1 already exists from the
    // wake-shape section above) -> 22 total, cap 20.
    for (let i = 0; i < 21; i++) mkTask(`Safety unblocked ${i}`, 'nyx', 'todo', { unblockedAt: now });
    const w = await reqJson(bus, 'GET', '/api/wake', { auth: nyxToken });
    assertEqual((w.data.unblocked as any[]).length, 20, 'wake unblocked capped at 20');
    assertEqual(w.data.unblocked_has_more, true, 'wake unblocked has_more');
    assertTrue((w.data.unblocked as any[]).every((t) => 'freeing_blocker_id' in t), 'wake unblocked rows carry freeing_blocker_id');
    // 101 fresh ledger rows with updated_at = now, plus earlier rows
    // -> >100 changed rows under ?since.
    for (let i = 0; i < 101; i++) mkLedger('decision', `Safety changed ${i}`, null);
    const sinceIso = new Date((now - 100) * 1000).toISOString();
    const ws = await reqJson(bus, 'GET', `/api/wake?since=${encodeURIComponent(sinceIso)}`, { auth: nyxToken });
    assertEqual((ws.data.ledger_changed as any[]).length, 100, 'wake ledger_changed capped at 100 with since');
    assertEqual(ws.data.ledger_changed_has_more, true, 'wake ledger_changed has_more');
    // 101 public holds (+2 visible from earlier sections) -> cap 100.
    for (let i = 0; i < 101; i++) mkLedger('hold', `Safety hold ${i}`, null);
    const wh = await reqJson(bus, 'GET', '/api/wake', { auth: nyxToken });
    assertEqual((wh.data.holds as any[]).length, 100, 'wake holds capped at 100');
    assertEqual(wh.data.holds_truncated, true, 'wake holds truncated');
  }

  // Item 4: freeing blocker on dependency completion + manual null.
  {
    const blk = mkTask('Safety blocker', 'nyx');
    const dep = mkTask('Safety dependent', 'nyx');
    assertEqual((await reqJson(bus, 'POST', `/api/kanban/tasks/${dep}/dependencies`, { auth: nyxToken, body: { blocker_id: blk } })).status, 200, 'safety link');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${blk}/status`, { auth: nyxToken, body: { status: 'done' } })).status, 200, 'safety blocker done');
    const unb = await reqJson(bus, 'GET', '/api/kanban/tasks/unblocked?limit=100', { auth: nyxToken });
    const row = (unb.data.tasks as any[]).find((t) => t.id === dep);
    assertTrue(!!row, 'safety dep in unblocked list');
    assertEqual(row.freeing_blocker_id, blk, 'unblocked row names freeing blocker');
    assertEqual(row.unblocked_by_blocker_id, undefined, 'storage column not exposed on unblocked row');
    const w = await reqJson(bus, 'GET', '/api/wake', { auth: nyxToken });
    const wrow = (w.data.unblocked as any[]).find((t) => t.id === dep);
    assertTrue(!!wrow, 'safety dep in wake unblocked');
    assertEqual(wrow.freeing_blocker_id, blk, 'wake unblocked names freeing blocker');
    // Manual unblock: no freeing blocker, never in the list.
    const man = mkTask('Safety manual', 'nyx');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${man}/status`, { auth: nyxToken, body: { status: 'blocked', blocked_kind: 'waiting-human', blocked_reason: 'manual hold' } })).status, 200, 'safety manual block');
    assertEqual((await reqJson(bus, 'PUT', `/api/kanban/tasks/${man}/status`, { auth: nyxToken, body: { status: 'todo' } })).status, 200, 'safety manual unblock');
    const unb2 = await reqJson(bus, 'GET', '/api/kanban/tasks/unblocked?limit=100', { auth: nyxToken });
    assertTrue(!(unb2.data.tasks as any[]).some((t) => t.id === man), 'manually unblocked task not in unblocked list');
    const det = await reqJson(bus, 'GET', `/api/kanban/tasks/${man}`, { auth: nyxToken });
    assertEqual(det.status, 200, 'safety manual detail');
    assertEqual(det.data.task.freeing_blocker_id, null, 'manual detail freeing null');
  }
}
