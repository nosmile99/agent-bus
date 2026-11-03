// Schema migrations for BusDO
import { sha256Hex } from '../utils.js';
import type { IBusDO } from '../types.js';

export function migrateV3(bus: IBusDO): void {
  const addCol = (ddl: string) => {
    try {
      bus.sql.exec(ddl);
    } catch (_e) {
      /* column exists */
    }
  };
  addCol(`ALTER TABLE tasks ADD COLUMN blocked_kind TEXT CHECK (blocked_kind IN ('waiting-human','waiting-task','waiting-external'))`);
  addCol(`ALTER TABLE tasks ADD COLUMN status_changed_at INTEGER`);
  addCol(`ALTER TABLE tasks ADD COLUMN last_activity_at INTEGER`);
  addCol(`ALTER TABLE tasks ADD COLUMN stale_notified_at INTEGER`);
  addCol(`ALTER TABLE tasks ADD COLUMN notes TEXT`);
  addCol(`ALTER TABLE tasks ADD COLUMN created_by TEXT`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_stale ON tasks(status, last_activity_at)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_blocked ON tasks(status, blocked_kind, status_changed_at)`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    ts INTEGER NOT NULL
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id)`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS task_labels (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    PRIMARY KEY (task_id, label)
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_labels_label ON task_labels(label)`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS project_subscribers (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, agent)
  )`);
  // Backfill activity timestamps for pre-v3 tasks.
  const now = Math.floor(Date.now() / 1000);
  bus.sql.exec(
    `UPDATE tasks SET status_changed_at = COALESCE(updated_at, created_at, ?),
                      last_activity_at = COALESCE(updated_at, created_at, ?)
     WHERE status_changed_at IS NULL`,
    now,
    now
  );
}

export function migrateV4(bus: IBusDO): void {
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    actor TEXT,
    project_id INTEGER,
    scope TEXT NOT NULL DEFAULT 'all',
    recipients TEXT,
    ts INTEGER NOT NULL,
    payload TEXT NOT NULL
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_ts_id ON events(ts, id)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, ts)`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS channels (
    name TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS channel_members (
    channel TEXT REFERENCES channels(name) ON DELETE CASCADE,
    agent TEXT NOT NULL,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (channel, agent)
  )`);
  try {
    bus.sql.exec(`ALTER TABLE messages ADD COLUMN reply_to INTEGER`);
  } catch (_e) {
    /* exists */
  }
  // Backfill: seed all-agent; every registered agent becomes a member of
  // all-agent and of every pre-existing custom channel.
  const now = Math.floor(Date.now() / 1000);
  bus.sql.exec(
    `INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES ('all-agent', 'system', ?)`,
    now
  );
  const agents = bus.allAgents().map((a) => a.agent);
  for (const a of agents) {
    bus.sql.exec(
      `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('all-agent', ?, 'system', ?)`,
      a,
      now
    );
  }
  const chans = bus.sql
    .exec(`SELECT DISTINCT channel FROM messages WHERE channel NOT LIKE 'dm:%' AND channel != 'all-agent'`)
    .toArray() as Array<{ channel: string }>;
  for (const { channel } of chans) {
    bus.sql.exec(`INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES (?, 'admin', ?)`, channel, now);
    for (const a of agents) {
      bus.sql.exec(
        `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, 'system', ?)`,
        channel,
        a,
        now
      );
    }
  }
}

export function migrateV6(bus: IBusDO): void {
  // Version-insert ownership, locked: runMigrations owns sequencing (it calls
  // migrateV6 only after v5), migrateV6 owns its own version insert, inside
  // bus.state.storage.transactionSync(...) on success only.
  // NOTE: Cloudflare Durable Objects SqlStorage forbids raw SQL "BEGIN" / "COMMIT" /
  // "ROLLBACK" inside sql.exec(); transactionSync() is the required DO primitive
  // that atomically commits on normal return and rolls back all writes on throw.
  const addColIfMissing = (table: 'tasks', column: string, ddl: string) => {
    const rows = bus.sql
      .exec(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ? LIMIT 1`, column)
      .toArray();
    if (rows.length === 0) {
      bus.sql.exec(ddl);
    }
  };
  bus.state.storage.transactionSync(() => {
    addColIfMissing(`tasks`, `due_date`, `ALTER TABLE tasks ADD COLUMN due_date INTEGER`);
    addColIfMissing(
      `tasks`,
      `lane`,
      `ALTER TABLE tasks ADD COLUMN lane TEXT NOT NULL DEFAULT 'unassigned' CHECK (lane IN ('backend', 'android', 'unassigned'))`
    );
    addColIfMissing(`tasks`, `blocked_reason`, `ALTER TABLE tasks ADD COLUMN blocked_reason TEXT`);

    bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date)`);
    bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_lane ON tasks(lane)`);

    bus.sql.exec(`CREATE TABLE IF NOT EXISTS task_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      notes TEXT,
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
      lane TEXT NOT NULL CHECK (lane IN ('backend', 'android', 'unassigned')),
      labels TEXT NOT NULL DEFAULT '[]'
    )`);

    bus.sql.exec(`CREATE TABLE IF NOT EXISTS kanban_wip_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      per_assignee_doing_limit INTEGER
    )`);

    bus.sql.exec(`CREATE TABLE IF NOT EXISTS lane_mapping (
      agent TEXT PRIMARY KEY,
      lane TEXT NOT NULL CHECK (lane IN ('backend', 'android', 'unassigned')),
      set_by TEXT NOT NULL,
      set_at INTEGER NOT NULL
    )`);

    const now = Math.floor(Date.now() / 1000);
    bus.sql.exec(`UPDATE tasks SET lane = 'unassigned' WHERE lane IS NULL`);

    bus.sql.exec(
      `INSERT OR IGNORE INTO lane_mapping (agent, lane, set_by, set_at) VALUES
        ('nyx', 'backend', 'system', ?),
        ('nosmile99', 'android', 'system', ?),
        ('wren', 'unassigned', 'system', ?),
        ('luki', 'unassigned', 'system', ?)`,
      now,
      now,
      now,
      now
    );

    bus.sql.exec(
      `INSERT OR IGNORE INTO task_templates (name, title, description, notes, priority, lane, labels) VALUES
        ('backend-audit-finding', '[audit] {finding}', 'Audit finding, see comment for evidence', '', 'normal', 'backend', '["audit"]'),
        ('android-audit-finding', '[audit] {finding}', 'Audit finding, see comment for evidence', '', 'normal', 'android', '["audit","android"]'),
        ('backend-feature', '{feature}', '', '', 'normal', 'backend', '[]'),
        ('android-feature', '{feature}', '', '', 'normal', 'android', '["android"]')`
    );

    // Version 6 is recorded ONLY here, inside the same transactionSync block, on success.
    // Any thrown error aborts transactionSync and rolls back all DDL + version 6 insert.
    bus.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (6, strftime('%s','now'))`);
  });
}

export function migrateV7(bus: IBusDO): void {
  // Agent-bus revamp plan v12 (LOCKED 2026-11-02): dependencies (§4),
  // decision ledger (§5), Phase 3 comment soft-delete (§6). Additive
  // only: CREATE TABLE IF NOT EXISTS plus try/catch ALTER columns, so
  // re-runs never fail on existing columns. No DROP, no backfill.
  const addCol = (ddl: string) => {
    try {
      bus.sql.exec(ddl);
    } catch (_e) {
      /* column exists */
    }
  };
  addCol(`ALTER TABLE tasks ADD COLUMN blocked_from_status TEXT`);
  addCol(`ALTER TABLE tasks ADD COLUMN unblocked_at INTEGER`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS task_dependencies (
    blocker_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_dep_blocked ON task_dependencies(blocked_id)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_dep_blocker ON task_dependencies(blocker_id)`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS dependency_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blocker_id INTEGER NOT NULL,
    blocked_id INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('link','unlink','reblock','unblock')),
    reason TEXT,
    created_at INTEGER NOT NULL
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_dep_events_blocked ON dependency_events(blocked_id)`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('decision','hold','gate','protocol','handover','dead-end','dissent')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    author TEXT NOT NULL,
    lane TEXT NOT NULL,
    target_lane TEXT,
    scope TEXT NOT NULL DEFAULT 'lane-note' CHECK (scope IN ('action','lane-note')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','tombstoned')),
    supersedes_id INTEGER REFERENCES ledger(id),
    superseded_by_id INTEGER REFERENCES ledger(id),
    replaces_tombstoned_id INTEGER REFERENCES ledger(id),
    bus_reconciliation_id INTEGER,
    ref_type TEXT,
    ref_id TEXT,
    provenance_type TEXT NOT NULL CHECK (provenance_type IN ('bus_message','task','agent_asserted','luki_ordered','lock_ordered')),
    is_luki_ordered INTEGER NOT NULL DEFAULT 0,
    tombstone_reason TEXT,
    tombstoned_by TEXT,
    tombstoned_at INTEGER,
    recheck_at INTEGER,
    demote_actor TEXT,
    demote_deadline INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_kind_status ON ledger(kind, status)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_recheck ON ledger(recheck_at)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_lane ON ledger(target_lane)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_supersedes ON ledger(supersedes_id)`);
  // Fix round M2: serves the task-detail ledger_refs lookup
  // (ref_type + ref_id + status) without scanning the ledger.
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_task_ref ON ledger(ref_type, ref_id, status)`);
  // Fix round M3: partial index for the unblocked list (only rows
  // that can ever appear in it).
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_unblocked ON tasks(status, unblocked_at, id) WHERE unblocked_at IS NOT NULL`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_superseded_by ON ledger(superseded_by_id)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_replaces ON ledger(replaces_tombstoned_id)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_reconciliation ON ledger(bus_reconciliation_id)`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS endorsement_uses (
    endorsement_message_id INTEGER PRIMARY KEY,
    ledger_id INTEGER NOT NULL REFERENCES ledger(id),
    used_at INTEGER NOT NULL
  )`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS seed_exception_uses (
    lock_decision_ref TEXT PRIMARY KEY,
    ledger_id INTEGER NOT NULL REFERENCES ledger(id),
    used_at INTEGER NOT NULL
  )`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS seed_luki_uses (
    luki_message_id INTEGER PRIMARY KEY,
    ledger_id INTEGER NOT NULL REFERENCES ledger(id),
    used_at INTEGER NOT NULL
  )`);
  // NOTE: 'demote' is NOT in the plan v12 §5 action enumeration
  // (create/supersede/tombstone/seed). It is added here because the
  // lock decision Q8 orders a demote step with a per-row actor and a
  // per-row deadline; demote events need an auditable action value.
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS ledger_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id INTEGER NOT NULL REFERENCES ledger(id),
    actor TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('create','supersede','tombstone','seed','demote')),
    reason TEXT,
    created_at INTEGER NOT NULL
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_events_ledger ON ledger_events(ledger_id)`);
  addCol(`ALTER TABLE task_comments ADD COLUMN deleted INTEGER DEFAULT 0`);
  addCol(`ALTER TABLE task_comments ADD COLUMN deleted_by TEXT`);
  addCol(`ALTER TABLE task_comments ADD COLUMN deleted_reason TEXT`);
  addCol(`ALTER TABLE task_comments ADD COLUMN deleted_at INTEGER`);
}

export function migrateV8(bus: IBusDO): void {
  // Sentinel decision (b), Luki's word 2026-11-02: dependency_events.blocker_id
  // becomes NULLABLE. The unarchive orphan event (blocker deleted while the
  // project was archived, so no blocker exists) writes blocker_id = NULL —
  // an honest "no blocker" — instead of the self-id sentinel.
  // SQLite cannot ALTER a column to drop NOT NULL, so this uses the
  // recreate-table pattern inside a single transactionSync (the DO
  // primitive; raw BEGIN/COMMIT are forbidden in SqlStorage).
  // dependency_events has no FK references in either direction, so
  // DROP + RENAME is safe, and all existing rows are copied verbatim.
  // Idempotent: if blocker_id is already nullable this is a no-op, so a
  // re-run after a crash cannot duplicate or lose rows.
  // NOTE: select * here, not the notnull column by name — NOTNULL is a
  // SQLite keyword, so a bare `SELECT notnull ...` fails to parse in
  // workerd's SQLite. Reading the field from the row object in JS is fine.
  const info = bus.sql
    .exec(`SELECT * FROM pragma_table_info('dependency_events') WHERE name = 'blocker_id'`)
    .toArray() as Array<{ notnull: number }>;
  if (info.length > 0 && info[0]!.notnull === 0) return; // already nullable
  bus.state.storage.transactionSync(() => {
    if (info.length === 0) {
      // Table missing (unreachable in runMigrations order, where v7 runs
      // first): create it directly in the nullable shape.
      bus.sql.exec(`CREATE TABLE IF NOT EXISTS dependency_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blocker_id INTEGER,
        blocked_id INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('link','unlink','reblock','unblock')),
        reason TEXT,
        created_at INTEGER NOT NULL
      )`);
    } else {
      bus.sql.exec(`CREATE TABLE dependency_events_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blocker_id INTEGER,
        blocked_id INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('link','unlink','reblock','unblock')),
        reason TEXT,
        created_at INTEGER NOT NULL
      )`);
      bus.sql.exec(`INSERT INTO dependency_events_new (id, blocker_id, blocked_id, actor, action, reason, created_at)
        SELECT id, blocker_id, blocked_id, actor, action, reason, created_at FROM dependency_events`);
      bus.sql.exec(`DROP TABLE dependency_events`);
      bus.sql.exec(`ALTER TABLE dependency_events_new RENAME TO dependency_events`);
    }
    bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_dep_events_blocked ON dependency_events(blocked_id)`);
  });
}

export function migrateV9(bus: IBusDO): void {
  // Amendment batch, items 2/10/19: additive ledger extensions.
  // - ledger.topic TEXT NOT NULL DEFAULT '' (existing rows get
  //   '', new rows carry the item-2a topic rule from the handler).
  // - ledger.resolver TEXT (nullable, agent name or 'admin').
  // - ledger.resolved INTEGER NOT NULL DEFAULT 0 + resolved_by /
  //   resolved_at (dissent resolution, item 19c; the flag is
  //   meaningful only on kind='dissent' rows).
  // - ledger_contradictions (item 2b): one row per flag, UNIQUE
  //   (row_id, contradicts_id) pair.
  // - ledger_events.action CHECK widened to the new audit actions
  //   (contradiction/resolver/resolve_dissent). SQLite cannot
  //   ALTER a CHECK, so this uses the v8 recreate-table pattern
  //   inside transactionSync; idempotent via the sqlite_master
  //   CHECK-text probe (a re-run after a crash is a no-op).
  // No CHECK exists on ledger.ref_type (verified against the v7
  // CREATE), so item 19a's 'ledger' ref_type needs no schema step.
  const addColIfMissing = (column: string, ddl: string) => {
    const rows = bus.sql
      .exec(`SELECT 1 FROM pragma_table_info('ledger') WHERE name = ? LIMIT 1`, column)
      .toArray();
    if (rows.length === 0) {
      bus.sql.exec(ddl);
    }
  };
  addColIfMissing('topic', `ALTER TABLE ledger ADD COLUMN topic TEXT NOT NULL DEFAULT ''`);
  addColIfMissing('resolver', `ALTER TABLE ledger ADD COLUMN resolver TEXT`);
  addColIfMissing('resolved', `ALTER TABLE ledger ADD COLUMN resolved INTEGER NOT NULL DEFAULT 0`);
  addColIfMissing('resolved_by', `ALTER TABLE ledger ADD COLUMN resolved_by TEXT`);
  addColIfMissing('resolved_at', `ALTER TABLE ledger ADD COLUMN resolved_at INTEGER`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS ledger_contradictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_id INTEGER NOT NULL REFERENCES ledger(id),
    contradicts_id INTEGER NOT NULL REFERENCES ledger(id),
    flagged_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (row_id, contradicts_id)
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_contradictions_row ON ledger_contradictions(row_id)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_contradictions_target ON ledger_contradictions(contradicts_id)`);
  const evSql = bus.sql
    .exec(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ledger_events'`)
    .toArray() as Array<{ sql: string | null }>;
  const evText = evSql[0]?.sql || '';
  if (evSql.length === 0) {
    // Unreachable in runMigrations order (v7 creates the table),
    // but a missing table must not make the copy step throw.
    bus.sql.exec(`CREATE TABLE IF NOT EXISTS ledger_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_id INTEGER NOT NULL REFERENCES ledger(id),
      actor TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('create','supersede','tombstone','seed','demote','contradiction','resolver','resolve_dissent')),
      reason TEXT,
      created_at INTEGER NOT NULL
    )`);
    bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_events_ledger ON ledger_events(ledger_id)`);
  } else if (!evText.includes('contradiction')) {
    bus.state.storage.transactionSync(() => {
      bus.sql.exec(`CREATE TABLE ledger_events_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ledger_id INTEGER NOT NULL REFERENCES ledger(id),
        actor TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('create','supersede','tombstone','seed','demote','contradiction','resolver','resolve_dissent')),
        reason TEXT,
        created_at INTEGER NOT NULL
      )`);
      bus.sql.exec(`INSERT INTO ledger_events_new (id, ledger_id, actor, action, reason, created_at)
        SELECT id, ledger_id, actor, action, reason, created_at FROM ledger_events`);
      bus.sql.exec(`DROP TABLE ledger_events`);
      bus.sql.exec(`ALTER TABLE ledger_events_new RENAME TO ledger_events`);
      bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_events_ledger ON ledger_events(ledger_id)`);
    });
  }
}

export function migrateV10(bus: IBusDO): void {
  // Argon safety round: freeing-blocker column for the unblocked
  // list / wake unblocked section / unblocked event. Written only by
  // depUnblockRow; read sites gate on unblocked_at, so pre-v10 rows
  // (NULL) and later-claimed rows (stale value, unblocked_at NULL)
  // both surface freeing_blocker_id null.
  try {
    bus.sql.exec(`ALTER TABLE tasks ADD COLUMN unblocked_by_blocker_id INTEGER`);
  } catch (_e) {
    /* column exists */
  }
}

export async function runMigrations(bus: IBusDO): Promise<void> {
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    channel TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    audience TEXT NOT NULL DEFAULT 'agents',
    ts TEXT NOT NULL,
    body TEXT NOT NULL
  )`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS agents (
    agent TEXT PRIMARY KEY,
    secret TEXT NOT NULL,
    created TEXT NOT NULL
  )`);
  // Admin credentials: moved from env to DB (Ryuki #286) so password can
  // be changed via panel. Worker cannot mutate its own env at runtime.
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS admins (
    user TEXT PRIMARY KEY,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL
  )`);
  // Seed from env on first boot if table empty.
  const adminCount = (bus.sql.exec(`SELECT COUNT(*) as c FROM admins`).one() as { c: number }).c;
  if (adminCount === 0) {
    const envUser = (bus.env.ADMIN_USER as string | undefined) || "";
    const envPass = (bus.env.ADMIN_PASS as string | undefined) || "";
    if (envUser && envPass) {
      const salt = crypto.randomUUID();
      const hash = await sha256Hex(salt + ":" + envPass);
      bus.sql.exec(`INSERT INTO admins (user, pass_hash, salt) VALUES (?, ?, ?)`, envUser, hash, salt);
    }
  }
  // Migration: add last_seen column if missing.
  try {
    bus.sql.exec(`ALTER TABLE agents ADD COLUMN last_seen TEXT`);
  } catch (_e) {
    // Column already exists — ignore.
  }
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel, id)`);
  // Kanban base (rev 2 plan, LOCKED 2026-10-19): projects -> tasks -> todos.
  // FK cascades require foreign_keys enforcement (per-connection pragma).
  bus.sql.exec(`PRAGMA foreign_keys = ON`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  )`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done','blocked')),
    assignee TEXT,
    admin_assigned TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','urgent')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    claimed_at INTEGER
  )`);
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_todos_task_id ON todos(task_id)`);

  bus.sql.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`
  );
  let schemaV = 0;
  try {
    const row = bus.sql.exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations`).one() as { v: number };
    schemaV = row.v || 0;
  } catch {}
  const migNow = () => Math.floor(Date.now() / 1000);
  if (schemaV < 2) {
    bus.sql.exec(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)`, migNow());
    schemaV = 2;
  }
  if (schemaV < 3) {
    migrateV3(bus);
    bus.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)`, migNow());
    schemaV = 3;
  }
  if (schemaV < 4) {
    migrateV4(bus);
    bus.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)`, migNow());
    schemaV = 4;
  }
  if (schemaV < 5) {
    try {
      bus.sql.exec(`ALTER TABLE agents ADD COLUMN stale_notified_at TEXT`);
    } catch (_e) {
      /* exists */
    }
    bus.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)`, migNow());
    schemaV = 5;
  }
  if (schemaV < 6) {
    migrateV6(bus);
    schemaV = 6;
  }
  if (schemaV < 7) {
    migrateV7(bus);
    bus.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)`, migNow());
    schemaV = 7;
  }
  // ORDERING HAZARD (fix-round minor): v8 must never ship without v7.
  // v7 creates dependency_events.blocker_id NOT NULL; v8 makes it
  // nullable. Code writes blocker_id NULL for orphan unblocks (a
  // blocker deleted while its project was archived), so a deployment
  // that applied v7 but not v8 would fail those writes. The two
  // migrations are sequential in runMigrations and must stay that way.
  if (schemaV < 8) {
    migrateV8(bus);
    bus.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?)`, migNow());
    schemaV = 8;
  }
  // Amendment batch: v9 ledger extensions (topic/resolver/
  // resolved, contradictions table, widened ledger_events CHECK).
  if (schemaV < 9) {
    migrateV9(bus);
    bus.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?)`, migNow());
    schemaV = 9;
  }
  // Argon safety round: v10 freeing-blocker column. Plain ADD COLUMN
  // (no table rebuild): existing rows get NULL, which the read sites
  // already treat as "unknown freeing blocker". Idempotent via the
  // try/catch addCol pattern, same as migrateV3.
  if (schemaV < 10) {
    migrateV10(bus);
    bus.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (10, ?)`, migNow());
    schemaV = 10;
  }
  // Fix-round M2/M3 indexes, applied idempotently on every boot so
  // stores that already passed v7/v8 still gain them (CREATE INDEX IF
  // NOT EXISTS is a no-op when the index already exists).
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ledger_task_ref ON ledger(ref_type, ref_id, status)`);
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_unblocked ON tasks(status, unblocked_at, id) WHERE unblocked_at IS NOT NULL`);
  // Fix round 5 minor: the dependency-events read path filters
  // (blocked_id = ? OR blocker_id = ?) but only the blocked arm
  // was indexed — the blocker arm scanned. Same idempotent-boot
  // pattern as the indexes above, no new migration version.
  bus.sql.exec(`CREATE INDEX IF NOT EXISTS idx_dep_events_blocker ON dependency_events(blocker_id)`);
  // Fix round 4, item 5: sweep-health meta table. The alarm loop's
  // health must survive DO logs (which are ephemeral and
  // tail-only): boot + each alarm run record their outcome here,
  // and the admin stats endpoint surfaces it. No cadence change:
  // boot still arms +5min, alarm still reschedules hourly.
  bus.sql.exec(`CREATE TABLE IF NOT EXISTS bus_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const setMeta = (key: string, value: string) => {
    try {
      bus.sql.exec(`INSERT INTO bus_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);
    } catch {}
  };
  let bootAlarmOk = false;
  let bootAlarmError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await bus.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
      bootAlarmOk = true;
      break;
    } catch (e) {
      bootAlarmError = e instanceof Error ? e.message : String(e);
    }
  }
  if (bootAlarmOk) {
    setMeta('alarm_boot', JSON.stringify({ ok: true, at: Math.floor(Date.now() / 1000) }));
  } else {
    // The old code swallowed this in an empty catch, silently
    // killing all future sweeps. Now it is logged AND persisted,
    // and the fetch-path re-arm in index.ts retries on the next
    // request if the alarm still has not run.
    try {
      console.error(`[alarm] boot setAlarm failed after 3 attempts: ${bootAlarmError}`);
    } catch {}
    setMeta('alarm_boot', JSON.stringify({ ok: false, error: bootAlarmError, at: Math.floor(Date.now() / 1000) }));
  }
}
