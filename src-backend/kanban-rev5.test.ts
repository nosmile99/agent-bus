// Automated test suite for Kanban Expansion Plan rev 5 (Phase 0, Phase 1, Migration v6, Phase 2)
import { BusDO } from './index.js';
import { LABEL_REGEX, kbValidateLabelsArray } from './handlers/kanban.js';
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
  if (!cond) {
    throw new Error(msg || 'Assertion failed');
  }
}

async function reqJson(
  bus: BusDO,
  method: string,
  pathStr: string,
  opts?: { auth?: string; body?: unknown }
): Promise<{ status: number; data: Record<string, any> }> {
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

export async function runKanbanRev5Tests(
  createDO: (envOverrides?: Partial<Env>) => TestHarness
): Promise<void> {
  const adminAuth = 'Basic ' + btoa('luki:secret123');

  // ---------------------------------------------------------------------------
  // 1. Migration v6 & transactionSync Rollback Safety (§2G, Acceptance 2)
  // ---------------------------------------------------------------------------
  {
    const h = createDO();
    await h.init();

    const migs = h.sql.exec(`SELECT version FROM schema_migrations ORDER BY version ASC`).toArray() as Array<{
      version: number;
    }>;
    assertEqual(
      migs.map((m) => m.version),
      [2, 3, 4, 5, 6, 7, 8],
      'runMigrations versions'
    );

    const mappings = h.sql
      .exec(`SELECT agent, lane FROM lane_mapping ORDER BY agent ASC`)
      .toArray();
    assertEqual(
      mappings,
      [
        { agent: 'luki', lane: 'unassigned' },
        { agent: 'nosmile99', lane: 'android' },
        { agent: 'nyx', lane: 'backend' },
        { agent: 'wren', lane: 'unassigned' },
      ],
      'lane_mapping seed rows'
    );

    const tpls = h.sql.exec(`SELECT name, lane FROM task_templates ORDER BY id ASC`).toArray();
    assertEqual(
      tpls,
      [
        { name: 'backend-audit-finding', lane: 'backend' },
        { name: 'android-audit-finding', lane: 'android' },
        { name: 'backend-feature', lane: 'backend' },
        { name: 'android-feature', lane: 'android' },
      ],
      'task_templates seed rows'
    );

    // Seed project 'Agent bus improvement' & pre-existing task, re-run migrateV6 idempotently
    h.sql.exec(
      `INSERT INTO projects (id, title, description, created_by, created_at, archived)
       VALUES (1, 'Agent bus improvement', 'Main project', 'luki', 1000, 0)`
    );
    h.sql.exec(
      `INSERT INTO tasks (id, project_id, title, status, priority, created_at, updated_at, status_changed_at, last_activity_at)
       VALUES (1, 1, 'Existing task', 'todo', 'normal', 1000, 1000, 1000, 1000)`
    );
    h.sql.exec(`DELETE FROM schema_migrations WHERE version = 6`);
    h.bus.migrateV6();

    const projs = h.sql.exec(`SELECT title FROM projects WHERE id = 1`).toArray();
    assertEqual(projs[0]?.title, 'Agent bus improvement', 'preserved project');
    const existingTask = h.sql.exec(`SELECT lane FROM tasks WHERE id = 1`).one() as { lane: string };
    assertEqual(existingTask.lane, 'unassigned', 'backfilled lane');

    if (h.setFailAtSql) {
      const sim = createDO();
      await sim.init();
      sim.sql.exec(`DELETE FROM schema_migrations WHERE version = 6`);
      sim.sql.exec(`DROP TABLE task_templates`);
      sim.setFailAtSql!('INSERT INTO schema_migrations (version, applied_at) VALUES (6');
      let threw = false;
      try {
        sim.bus.migrateV6();
      } catch {
        threw = true;
      }
      assertTrue(threw, 'migrateV6 should throw on simulated SQL failure');
      sim.setFailAtSql!(null);
      const v6Rows = sim.sql.exec(`SELECT 1 FROM schema_migrations WHERE version = 6`).toArray();
      assertEqual(v6Rows.length, 0, 'failed migrateV6 must not insert version 6');
      const tplTable = sim.sql
        .exec(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_templates'`)
        .toArray();
      assertEqual(tplTable.length, 0, 'failed migrateV6 must roll back DDL inside transactionSync');
    }
  }

  // Shared instance for endpoint tests
  const { bus, sql, init } = createDO();
  await init();

  async function registerAgent(name: string): Promise<string> {
    const r = await reqJson(bus, 'POST', '/admin/api/agents', {
      auth: adminAuth,
      body: { agent: name },
    });
    assertEqual(r.status, 200, `register agent ${name}`);
    return `Bearer ${r.data.secret}`;
  }

  const nyxToken = await registerAgent('nyx');
  const nosmileToken = await registerAgent('nosmile99');
  const wrenToken = await registerAgent('wren');

  const projRes = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
    auth: adminAuth,
    body: { title: 'Agent bus improvement', description: 'Core kanban project' },
  });
  assertEqual(projRes.status, 200, 'create project 1');

  // ---------------------------------------------------------------------------
  // 2. Phase 0.2: Fail-first Backend Label Validation (SEC-01, Acceptance 1)
  // ---------------------------------------------------------------------------
  {
    assertTrue(LABEL_REGEX.test('valid_label-01'), 'LABEL_REGEX valid');
    assertTrue(!LABEL_REGEX.test("bad'quote"), 'LABEL_REGEX rejects single quote');
    assertTrue(!LABEL_REGEX.test('<script>'), 'LABEL_REGEX rejects angle brackets');
    assertTrue(!LABEL_REGEX.test('has space'), 'LABEL_REGEX rejects space');
    assertEqual(kbValidateLabelsArray(['<script>']).ok, false, 'kbValidateLabelsArray rejects XSS');

    const badLabels = [
      "bad'quote",
      '<script>alert(1)</script>',
      'has space',
      'bad"quote',
      'bad`tick',
      'a'.repeat(33),
      '',
    ];

    for (const bad of badLabels) {
      // (a) Admin task create
      const r1 = await reqJson(bus, 'POST', '/admin/api/kanban/projects/1/tasks', {
        auth: adminAuth,
        body: { title: 'Sec test admin', labels: [bad] },
      });
      assertEqual(r1.status, 400, `admin task create must reject label "${bad}"`);

      // (b) Agent task create
      const r2 = await reqJson(bus, 'POST', '/api/kanban/projects/1/tasks', {
        auth: nyxToken,
        body: { title: 'Sec test agent', labels: [bad] },
      });
      assertEqual(r2.status, 400, `agent task create must reject label "${bad}"`);

      // (c) Admin template create
      const rTpl = await reqJson(bus, 'POST', '/admin/api/kanban/templates', {
        auth: adminAuth,
        body: { name: 'bad-tpl', title: 'Bad', lane: 'backend', labels: [bad] },
      });
      assertEqual(rTpl.status, 400, `admin template create must reject label "${bad}"`);
    }

    const validTask = await reqJson(bus, 'POST', '/admin/api/kanban/projects/1/tasks', {
      auth: adminAuth,
      body: { title: 'Label target task', lane: 'unassigned', labels: ['Valid_Label-1'] },
    });
    assertEqual(validTask.status, 200);
    const tid = validTask.data.id as number;

    for (const bad of badLabels) {
      // (d) Admin label add
      const r3 = await reqJson(bus, 'POST', `/admin/api/kanban/tasks/${tid}/labels`, {
        auth: adminAuth,
        body: { label: bad },
      });
      assertEqual(r3.status, 400, `admin label add must reject label "${bad}"`);

      // (e) Agent label add (must reject with 400 AND roll back auto-claim)
      const r4 = await reqJson(bus, 'POST', `/api/kanban/tasks/${tid}/labels`, {
        auth: nyxToken,
        body: { label: bad },
      });
      assertEqual(r4.status, 400, `agent label add must reject label "${bad}"`);
    }

    // Verify no malformed label was stored in task_labels and auto-claim was rolled back
    const det = await reqJson(bus, 'GET', `/admin/api/kanban/tasks/${tid}`, { auth: adminAuth });
    assertEqual(det.data.task.assignee, null, 'failed agent label add must roll back auto-claim');
    assertEqual(det.data.task.labels, ['valid_label-1'], 'only valid lowercased label stored');

    await reqJson(bus, 'DELETE', `/admin/api/kanban/tasks/${tid}`, { auth: adminAuth });
  }

  // ---------------------------------------------------------------------------
  // 3. Phase 1 Mandatory Fixes & One-Tap Human Unblock (§Phase 1, §2A.8, A2, A4)
  // ---------------------------------------------------------------------------
  {
    const cRes = await reqJson(bus, 'POST', '/admin/api/kanban/projects/1/tasks', {
      auth: adminAuth,
      body: {
        title: 'Phase 1 task',
        description: 'desc text',
        notes: 'secret-note-token-xyz',
        lane: 'backend',
      },
    });
    assertEqual(cRes.status, 200);
    const tid = cRes.data.id as number;

    // Verify q search includes notes (Phase 1 fix 1)
    const sRes = await reqJson(bus, 'GET', `/api/kanban/projects/1/tasks/search?q=secret-note-token-xyz`, {
      auth: nyxToken,
    });
    assertEqual(sRes.status, 200);
    assertEqual(sRes.data.tasks.length, 1, 'q search must match notes');

    // Empty blocked_kind: "" must return 400 (Round 1 Minor 5 fix)
    const emptyKindRes = await reqJson(bus, 'PUT', `/api/kanban/tasks/${tid}/status`, {
      auth: nyxToken,
      body: { status: 'blocked', blocked_kind: '', blocked_reason: 'Reason' },
    });
    assertEqual(emptyKindRes.status, 400, 'empty string blocked_kind must 400');

    // Non-blocked to blocked without blocked_reason -> 400
    const noReasonRes = await reqJson(bus, 'PUT', `/api/kanban/tasks/${tid}/status`, {
      auth: nyxToken,
      body: { status: 'blocked', blocked_kind: 'waiting-human' },
    });
    assertEqual(noReasonRes.status, 400);
    assertEqual(noReasonRes.data.error, 'blocked_reason required when status=blocked');

    // Block with valid reason
    const bOk = await reqJson(bus, 'PUT', `/api/kanban/tasks/${tid}/status`, {
      auth: nyxToken,
      body: { status: 'blocked', blocked_kind: 'waiting-human', blocked_reason: 'Need Luki decision' },
    });
    assertEqual(bOk.status, 200);

    // Backdate status_changed_at to test that blocked-to-blocked update preserves blocked_since (Round 1 Minor 2 fix)
    sql.exec(`UPDATE tasks SET status_changed_at = 123456 WHERE id = ?`, tid);
    const maxEvBefore = (sql.exec(`SELECT COALESCE(MAX(id), 0) AS m FROM events`).one() as { m: number }).m;
    const b2b = await reqJson(bus, 'PUT', `/api/kanban/tasks/${tid}/status`, {
      auth: nyxToken,
      body: { status: 'blocked', blocked_kind: 'waiting-external' },
    });
    assertEqual(b2b.status, 200);
    const afterB2B = await reqJson(bus, 'GET', `/api/kanban/tasks/${tid}`, { auth: nyxToken });
    assertEqual(afterB2B.data.task.status_changed_at, 123456, 'blocked-to-blocked must preserve status_changed_at');
    const b2bEv = sql.exec(`SELECT type, payload FROM events WHERE id > ?`, maxEvBefore).toArray() as Array<{
      type: string;
      payload: string;
    }>;
    assertEqual(b2bEv.length, 1);
    assertEqual(b2bEv[0]?.type, 'kanban.task.updated');
    assertEqual(JSON.parse(b2bEv[0]!.payload).change, 'blocked_kind');

    // One-tap admin unblock with comment (§2A.8)
    const unblockRes = await reqJson(bus, 'PUT', `/admin/api/kanban/tasks/${tid}`, {
      auth: adminAuth,
      body: { unblock: true, comment: 'Approved!' },
    });
    assertEqual(unblockRes.status, 200);
    const detUnblocked = await reqJson(bus, 'GET', `/api/kanban/tasks/${tid}`, { auth: nyxToken });
    assertEqual(detUnblocked.data.task.status, 'doing');
    assertEqual(detUnblocked.data.task.blocked_kind, null);
    assertEqual(detUnblocked.data.task.blocked_reason, null);
    assertEqual(detUnblocked.data.task.comment_count, 1);

    // Stale once-per-transition guard in alarm() (Phase 1 fix 2 & 4)
    const oldTs = Math.floor(Date.now() / 1000) - 90000;
    sql.exec(`UPDATE tasks SET last_activity_at = ?, stale_notified_at = NULL WHERE id = ?`, oldTs, tid);
    const sysBefore = (
      sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system'`, tid).one() as {
        c: number;
      }
    ).c;
    await bus.alarm();
    const sysAfter1 = (
      sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system'`, tid).one() as {
        c: number;
      }
    ).c;
    assertEqual(sysAfter1, sysBefore + 1, 'first stale sweep logs kbSystemLog');
    await bus.alarm();
    const sysAfter2 = (
      sql.exec(`SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author = 'system'`, tid).one() as {
        c: number;
      }
    ).c;
    assertEqual(sysAfter2, sysAfter1, 'repeat stale sweep writes no duplicate log');

    await reqJson(bus, 'DELETE', `/admin/api/kanban/tasks/${tid}`, { auth: adminAuth });
  }

  // ---------------------------------------------------------------------------
  // 4. Restricted Project Isolation & Round 1 Major Fixes (§2A.2, §2E.5, §2A.6)
  // ---------------------------------------------------------------------------
  {
    // Create a restricted project (subscribed only to nyx)
    const p2 = await reqJson(bus, 'POST', '/admin/api/kanban/projects', {
      auth: adminAuth,
      body: { title: 'Restricted Backend Project', subscribers: ['nyx'] },
    });
    assertEqual(p2.status, 200);
    const restrictedProjId = p2.data.id as number;

    const rtRes = await reqJson(bus, 'POST', `/admin/api/kanban/projects/${restrictedProjId}/tasks`, {
      auth: adminAuth,
      body: { title: 'Secret task', lane: 'unassigned' },
    });
    const rtid = rtRes.data.id as number;

    // Round 1 Major 1 fix: non-subscribed agent calling PUT .../status {status: 'todo'} on unassigned task
    // in restricted project MUST get 403 project_not_readable, NOT 400 cannot_auto_claim_to_todo
    const leakTest = await reqJson(bus, 'PUT', `/api/kanban/tasks/${rtid}/status`, {
      auth: wrenToken,
      body: { status: 'todo' },
    });
    assertEqual(leakTest.status, 403, 'restricted project must return 403 before 400 cannot_auto_claim_to_todo');
    assertEqual(leakTest.data.reason, 'project_not_readable');

    // Round 1 Minor 3 fix: non-subscribed agent calling POST .../release on restricted project gets 404, not 403
    const relLeakTest = await reqJson(bus, 'POST', `/api/kanban/tasks/${rtid}/release`, {
      auth: wrenToken,
    });
    assertEqual(relLeakTest.status, 404, 'release on restricted project must return 404 to non-subscriber');

    // Subscribed agent calling PUT .../status {status: 'todo'} on unassigned task gets 400 cannot_auto_claim_to_todo
    const subTodoStatus = await reqJson(bus, 'PUT', `/api/kanban/tasks/${rtid}/status`, {
      auth: nyxToken,
      body: { status: 'todo' },
    });
    assertEqual(subTodoStatus.status, 400);
    assertEqual(subTodoStatus.data.error, 'cannot_auto_claim_to_todo');

    // Round 1 Major 2 fix: template creation with explicit description/notes containing {id} or {status}
    // must NOT fail with missing template_vars key
    const tplWithBraceOverride = await reqJson(bus, 'POST', `/api/kanban/projects/${restrictedProjId}/tasks`, {
      auth: nyxToken,
      body: {
        template: 'backend-audit-finding',
        template_vars: { finding: 'Check payload {id} handling' },
        description: 'Payload includes {id, task_id, lane, assignee} JSON object',
        notes: 'Verify {status: "doing"} transition',
      },
    });
    assertEqual(tplWithBraceOverride.status, 200, 'explicit description/notes with braces must succeed');

    // Round 1 Major 3 fix: wren (lane='unassigned') owns an 'unassigned' lane task and updates notes + unchanged lane='unassigned'
    const wrenTaskCreate = await reqJson(bus, 'POST', '/api/kanban/projects/1/tasks', {
      auth: wrenToken,
      body: { title: 'Wren unassigned task' },
    });
    const wtid = wrenTaskCreate.data.id as number;
    const wrenClaim = await reqJson(bus, 'POST', `/api/kanban/tasks/${wtid}/claim`, {
      auth: wrenToken,
    });
    assertEqual(wrenClaim.status, 200);
    const wrenUpdate = await reqJson(bus, 'PUT', `/api/kanban/tasks/${wtid}`, {
      auth: wrenToken,
      body: { notes: 'Still my task', lane: 'unassigned' },
    });
    assertEqual(wrenUpdate.status, 200);
    const wrenDet = await reqJson(bus, 'GET', `/api/kanban/tasks/${wtid}`, { auth: wrenToken });
    assertEqual(wrenDet.data.task.assignee, 'wren', 'unchanged lane=unassigned in PUT /tasks/:id must not unassign owner');
    assertEqual(wrenDet.data.task.status, 'doing');

    // Explicit PUT /api/kanban/tasks/:id/lane {lane: 'unassigned'} DOES hand off to unassigned
    const wrenHandoff = await reqJson(bus, 'PUT', `/api/kanban/tasks/${wtid}/lane`, {
      auth: wrenToken,
      body: { lane: 'unassigned' },
    });
    assertEqual(wrenHandoff.status, 200);
    const wrenDetAfterHandoff = await reqJson(bus, 'GET', `/api/kanban/tasks/${wtid}`, { auth: wrenToken });
    assertEqual(wrenDetAfterHandoff.data.task.assignee, null, 'explicit PUT .../lane {lane: unassigned} hands off');
    assertEqual(wrenDetAfterHandoff.data.task.status, 'todo');
  }
}
