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
  try {
    await bus.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
  } catch {}
}
