// BusDO — the agent-bus hub as a Cloudflare Durable Object.
// Spec: DO-migration-spec.md rev 2 (single build, WS push from day one).
//
// Endpoints (all routed through the singleton DO):
//   POST /send                  {channel, body, priority?, audience?} -> {ok, id}
//   GET  /poll?since=&channel=  -> {messages: [...]}
//   GET  /ws?token=&channels=&since=  (WebSocket upgrade, primary transport)
//   GET  /health                 -> {ok: true}
//   GET  /list                   -> {agents: [{agent, channels, connectedSince, connections}]}
//   GET  /agents                 -> {agents: [{agent, created}]} (registered, never secrets)
//   POST /reg                    (admin token) {agent} -> {ok, agent, token}
//   POST /admin/agents          (admin token) seed agents
//   POST /admin/import          (admin token) import messages with preserved IDs
//   GET  /admin/export          (admin token) dump all messages
//   GET  /admin                 (Basic auth) admin panel HTML
//   GET  /admin/api/agents      (Basic auth) live connected agents
//   GET  /admin/api/messages?channel=&since=&limit=&sender=&priority=&q=  (Basic auth) cross-channel feed
//   GET  /admin/api/channels    (Basic auth) distinct channel list
//   GET  /admin/api/senders     (Basic auth) distinct sender list
//   POST /admin/api/send        (Basic auth) send as "luki" (bypasses rate limit)
//   DELETE /admin/api/messages/:id  (Basic auth) delete a message
//   POST /admin/api/agents       (Basic auth) register agent, returns secret (once)
//   DELETE /admin/api/agents/:agent  (Basic auth) delete agent (messages stay)
//   POST /admin/api/agents/:agent/rotate  (Basic auth) new secret (once)
//   GET  /admin/api/registered   (Basic auth) registered agents (never secrets)
//   Kanban (rev 2 plan, LOCKED 2026-10-19):
//   GET  /admin/api/kanban/projects            (Basic) list projects + task counts
//   POST /admin/api/kanban/projects            (Basic) {title, description?}
//   PUT  /admin/api/kanban/projects/:id        (Basic) {title?, description?, archived?}
//   DELETE /admin/api/kanban/projects/:id      (Basic) cascade
//   GET  /admin/api/kanban/projects/:id/tasks  (Basic) tasks + todos
//   POST /admin/api/kanban/projects/:id/tasks  (Basic) {title, description?, priority?}
//   PUT  /admin/api/kanban/tasks/:id           (Basic) {title?, description?, status?, priority?, assignee?}
//   DELETE /admin/api/kanban/tasks/:id         (Basic) cascade todos
//   POST /admin/api/kanban/tasks/:id/todos     (Basic) {text, sort_order?}
//   PUT  /admin/api/kanban/todos/:id           (Basic) {text?, done?, sort_order?}
//   DELETE /admin/api/kanban/todos/:id         (Basic)
//   GET  /api/kanban/projects                  (Bearer) non-archived projects
//   GET  /api/kanban/projects/:id/tasks        (Bearer) tasks + todos
//   POST /api/kanban/tasks/:id/claim           (Bearer) atomic first-win claim
//   PUT  /api/kanban/tasks/:id/status          (Bearer) {status} own task only
//   POST /api/kanban/tasks/:id/todos           (Bearer) {text} own task only
//   PUT  /api/kanban/todos/:id                (Bearer) {text?, done?} own task only

const BODY_CAP = 8192;
const PRIORITIES = ["low", "normal", "urgent"];
const AUDIENCES = ["agents", "luki"];
const CHURN_LIMIT = 12; // handshakes per agent per 60s
const CHURN_WINDOW = 60;
const RATE_LIMITS = {
  // agent -> [limit, windowSec]; default 10/60s
  wren: [10, 3600],
};
const DEFAULT_RATE = [10, 60];

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// SHA-256 hex digest via Web Crypto (for admin password hashing, Ryuki #286).
async function sha256Hex(input) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function dmChannel(a, b) {
  return "dm:" + [a, b].slice().sort().join(":");
}

function utcnow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

export class BusDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.rateLimit = new Map(); // agent -> [epochSec]
    this.churn = new Map(); // agent -> [epochSec of WS handshakes]
    this.state.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT NOT NULL,
        channel TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'normal',
        audience TEXT NOT NULL DEFAULT 'agents',
        ts TEXT NOT NULL,
        body TEXT NOT NULL
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS agents (
        agent TEXT PRIMARY KEY,
        secret TEXT NOT NULL,
        created TEXT NOT NULL
      )`);
      // Admin credentials: moved from env to DB (Ryuki #286) so password can
      // be changed via panel. Worker cannot mutate its own env at runtime.
      this.sql.exec(`CREATE TABLE IF NOT EXISTS admins (
        user TEXT PRIMARY KEY,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL
      )`);
      // Seed from env on first boot if table empty.
      const adminCount = this.sql.exec(`SELECT COUNT(*) as c FROM admins`).one().c;
      if (adminCount === 0) {
        const envUser = this.env.ADMIN_USER || "";
        const envPass = this.env.ADMIN_PASS || "";
        if (envUser && envPass) {
          const salt = crypto.randomUUID();
          const hash = await sha256Hex(salt + ":" + envPass);
          this.sql.exec(`INSERT INTO admins (user, pass_hash, salt) VALUES (?, ?, ?)`, envUser, hash, salt);
        }
      }
      // Migration: add last_seen column if missing.
      try {
        this.sql.exec(`ALTER TABLE agents ADD COLUMN last_seen TEXT`);
      } catch (e) {
        // Column already exists — ignore.
      }
      this.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel, id)`
      );
      // Kanban base (rev 2 plan, LOCKED 2026-10-19): projects -> tasks -> todos.
      // FK cascades require foreign_keys enforcement (per-connection pragma).
      this.sql.exec(`PRAGMA foreign_keys = ON`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )`);
      this.sql.exec(`CREATE TABLE IF NOT EXISTS tasks (
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
      this.sql.exec(`CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      )`);
      this.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`
      );
      this.sql.exec(
        `CREATE INDEX IF NOT EXISTS idx_todos_task_id ON todos(task_id)`
      );
      // ---------- Schema versioning (kanban rev 4 + poll rev 3, LOCKED 2026-10-20) ----------
      // The DO constructor runs on every cold start, so all DDL is version-gated.
      // Guard idiom matches this file's existing style: IF NOT EXISTS / try-catch
      // on ADD COLUMN. The version row is bumped ONLY after its migration's DDL
      // all succeeds — a failed migration retries cleanly on the next cold start.
      // (Note: workerd's SqlStorage has no db.transaction() helper, so the plan's
      // single-transaction pseudocode is approximated by atomic-per-statement DDL
      // + version-bump-last, which has the same retry-safety property.)
      this.sql.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)`);
      let schemaV = 0;
      try {
        schemaV = this.sql.exec(`SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations`).one().v || 0;
      } catch {}
      const migNow = () => Math.floor(Date.now() / 1000);
      if (schemaV < 2) {
        // v2 = everything above (base messages/agents/admins + kanban base tables).
        this.sql.exec(`INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, ?)`, migNow());
        schemaV = 2;
      }
      if (schemaV < 3) {
        this.migrateV3();
        this.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)`, migNow());
        schemaV = 3;
      }
      if (schemaV < 4) {
        this.migrateV4();
        this.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)`, migNow());
        schemaV = 4;
      }
      if (schemaV < 5) {
        // v5: once-per-transition guard for agent.stale (M5). ISO string to
        // match agents.last_seen's format (lexicographic comparison works).
        try { this.sql.exec(`ALTER TABLE agents ADD COLUMN stale_notified_at TEXT`); } catch (e) { /* exists */ }
        this.sql.exec(`INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)`, migNow());
        schemaV = 5;
      }
      // Periodic sweep: task staleness (24h), agent staleness, event retention
      // prune (30d). First run 5 min after boot, then hourly (rescheduled in alarm()).
      try {
        await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
      } catch {}
    });
    // Protocol ping -> auto pong without waking the DO (zero-cost keepalive).
    this.state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  // ---------- Schema migrations (v3 = kanban expansion, v4 = unified poll) ----------

  // v3: kanban expansion (rev 4 plan, LOCKED 2026-10-20).
  migrateV3() {
    const addCol = (ddl) => {
      try { this.sql.exec(ddl); } catch (e) { /* column exists */ }
    };
    addCol(`ALTER TABLE tasks ADD COLUMN blocked_kind TEXT CHECK (blocked_kind IN ('waiting-human','waiting-task','waiting-external'))`);
    addCol(`ALTER TABLE tasks ADD COLUMN status_changed_at INTEGER`);
    addCol(`ALTER TABLE tasks ADD COLUMN last_activity_at INTEGER`);
    addCol(`ALTER TABLE tasks ADD COLUMN stale_notified_at INTEGER`);
    addCol(`ALTER TABLE tasks ADD COLUMN notes TEXT`);
    addCol(`ALTER TABLE tasks ADD COLUMN created_by TEXT`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_stale ON tasks(status, last_activity_at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_blocked ON tasks(status, blocked_kind, status_changed_at)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      ts INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_comments_task ON task_comments(task_id)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS task_labels (
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      PRIMARY KEY (task_id, label)
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_labels_label ON task_labels(label)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS project_subscribers (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, agent)
    )`);
    // Backfill activity timestamps for pre-v3 tasks.
    const now = Math.floor(Date.now() / 1000);
    this.sql.exec(
      `UPDATE tasks SET status_changed_at = COALESCE(updated_at, created_at, ?),
                        last_activity_at = COALESCE(updated_at, created_at, ?)
       WHERE status_changed_at IS NULL`,
      now, now
    );
  }

  // v4: unified poll (rev 3 plan, LOCKED 2026-10-20). Owns events, channels,
  // channel_members, and messages.reply_to. project_subscribers belongs to v3.
  migrateV4() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      actor TEXT,
      project_id INTEGER,
      scope TEXT NOT NULL DEFAULT 'all',
      recipients TEXT,
      ts INTEGER NOT NULL,
      payload TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_ts_id ON events(ts, id)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, ts)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS channels (
      name TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS channel_members (
      channel TEXT REFERENCES channels(name) ON DELETE CASCADE,
      agent TEXT NOT NULL,
      added_by TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (channel, agent)
    )`);
    try { this.sql.exec(`ALTER TABLE messages ADD COLUMN reply_to INTEGER`); } catch (e) { /* exists */ }
    // Backfill: seed all-agent; every registered agent becomes a member of
    // all-agent and of every pre-existing custom channel (they were
    // group-readable before the overhaul — the migration must not make them
    // unreadable mid-flight). Seeding emits NO events (backfill is not activity).
    const now = Math.floor(Date.now() / 1000);
    this.sql.exec(`INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES ('all-agent', 'system', ?)`, now);
    const agents = this.allAgents().map((a) => a.agent);
    for (const a of agents) {
      this.sql.exec(`INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('all-agent', ?, 'system', ?)`, a, now);
    }
    const chans = this.sql.exec(
      `SELECT DISTINCT channel FROM messages WHERE channel NOT LIKE 'dm:%' AND channel != 'all-agent'`
    ).toArray();
    for (const { channel } of chans) {
      this.sql.exec(`INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES (?, 'admin', ?)`, channel, now);
      for (const a of agents) {
        this.sql.exec(`INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, 'system', ?)`, channel, a, now);
      }
    }
  }

  // ---------- Unified-poll event emission ----------

  // Append one event. Best-effort by design (poll rev 3: event-write failure
  // isolation) — a primary write MUST NOT fail because emission failed.
  // ts is server-assigned inside the INSERT (strftime), never client-supplied.
  emitEvent(type, opts) {
    try {
      const o = opts || {};
      this.sql.exec(
        `INSERT INTO events (type, actor, project_id, scope, recipients, ts, payload)
         VALUES (?, ?, ?, ?, ?, strftime('%s','now'), ?)`,
        type,
        o.actor || null,
        o.project_id === undefined || o.project_id === null ? null : o.project_id,
        o.scope || "all",
        o.recipients ? JSON.stringify(o.recipients) : null,
        JSON.stringify(o.payload || {})
      );
    } catch (e) { /* swallow: primary write already succeeded */ }
  }

  // Canonical subscriber predicate (byte-identical to kanban rev 4). ? = agent name.
  // projExpr = SQL expression for the project id in the outer query scope.
  kbSubscriberPred(projExpr = "project_id") {
    return `${projExpr} IN (
      SELECT id FROM projects
      WHERE NOT EXISTS (SELECT 1 FROM project_subscribers ps WHERE ps.project_id = projects.id)
         OR EXISTS (SELECT 1 FROM project_subscribers ps WHERE ps.project_id = projects.id AND ps.agent = ?)
    )`;
  }

  // True if the task's project is archived (agent writes 403, except comments).
  kbIsArchived(taskId) {
    try {
      const r = this.sql.exec(
        `SELECT p.archived FROM projects p JOIN tasks t ON t.project_id = p.id WHERE t.id = ?`, taskId
      ).toArray()[0];
      return !!(r && r.archived);
    } catch { return false; }
  }

  // Touch a task's activity timestamps (called on every task mutation).
  kbTouchTask(id) {
    try {
      const now = this.kbNow();
      this.sql.exec(`UPDATE tasks SET updated_at = ?, last_activity_at = ? WHERE id = ?`, now, now, id);
    } catch {}
  }

  // Silent system activity log (author='system'). Emits NO poll event by design.
  kbSystemLog(taskId, body) {
    try {
      this.sql.exec(
        `INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, 'system', ?, ?)`,
        taskId, body, this.kbNow()
      );
    } catch {}
  }

  // Project subscribers (join table, NOT JSON).
  kbProjectSubscribers(projectId) {
    try {
      return this.sql.exec(`SELECT agent FROM project_subscribers WHERE project_id = ? ORDER BY agent`, projectId)
        .toArray().map((r) => r.agent);
    } catch { return []; }
  }

  // Replace the subscriber set. Empty/absent array = open to all (no rows).
  kbSetSubscribers(projectId, subscribers, addedBy) {
    this.sql.exec(`DELETE FROM project_subscribers WHERE project_id = ?`, projectId);
    if (!Array.isArray(subscribers) || subscribers.length === 0) return [];
    const now = this.kbNow();
    const clean = [...new Set(subscribers.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()))];
    for (const a of clean) {
      this.sql.exec(
        `INSERT OR IGNORE INTO project_subscribers (project_id, agent, added_by, added_at) VALUES (?, ?, ?, ?)`,
        projectId, a, addedBy || "admin", now
      );
    }
    return clean;
  }

  // Task detail payload (kanban rev 4): labels, comment/activity counts, todos.
  kbTaskDetail(row) {
    let labels = [];
    let comment_count = 0;
    let activity_count = 0;
    try {
      labels = this.sql.exec(`SELECT label FROM task_labels WHERE task_id = ? ORDER BY label`, row.id)
        .toArray().map((r) => r.label);
      comment_count = this.sql.exec(
        `SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ? AND author != 'system'`, row.id
      ).one().c;
      activity_count = this.sql.exec(
        `SELECT COUNT(*) AS c FROM task_comments WHERE task_id = ?`, row.id
      ).one().c;
    } catch {}
    return { ...this.kbTaskWithTodos(row), labels, comment_count, activity_count };
  }

  // Shared task search builder. opts: {projectIds (array|null=all), q, status,
  // assignee, label, blocked_kind, sort, includeArchived, subscriberAgent}.
  // Returns {where, params} for "... FROM tasks WHERE <where>".
  kbTaskSearchWhere(opts) {
    const conds = [];
    const params = [];
    if (opts.projectIds && opts.projectIds.length) {
      conds.push(`tasks.project_id IN (${opts.projectIds.map(() => "?").join(",")})`);
      params.push(...opts.projectIds);
    }
    if (!opts.includeArchived) {
      conds.push(`NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND p.archived = 1)`);
    }
    if (opts.q) {
      conds.push(`(tasks.title LIKE ? OR tasks.description LIKE ?)`);
      params.push(`%${opts.q}%`, `%${opts.q}%`);
    }
    if (opts.status) {
      conds.push(`tasks.status = ?`);
      params.push(opts.status);
    }
    if (opts.assignee) {
      conds.push(`tasks.assignee = ?`);
      params.push(opts.assignee);
    }
    if (opts.blocked_kind) {
      conds.push(`tasks.blocked_kind = ?`);
      params.push(opts.blocked_kind);
    }
    if (opts.label) {
      conds.push(`EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = tasks.id AND tl.label = ?)`);
      params.push(opts.label.toLowerCase());
    }
    if (opts.subscriberAgent) {
      conds.push(this.kbSubscriberPred("tasks.project_id"));
      params.push(opts.subscriberAgent);
    }
    let order = `tasks.id ASC`;
    if (opts.sort === "blocked_since") order = `tasks.status_changed_at ASC`;
    return { where: conds.length ? conds.join(" AND ") : "1=1", params, order };
  }

  // Ensure a channel row exists (custom channels auto-create on first send).
  // Returns the row's created_by, or null if the name is a DM (DM rows are
  // created lazily with created_by='system' and emit no channel.created).
  ensureChannelRow(channel, sender) {
    if (channel === "all-agent") return "system";
    if (channel.startsWith("dm:")) {
      const now = this.kbNow();
      this.sql.exec(`INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES (?, 'system', ?)`, channel, now);
      const parts = channel.split(":");
      for (const p of [parts[1], parts[2]]) {
        if (p) this.sql.exec(`INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, 'system', ?)`, channel, p, now);
      }
      return "system";
    }
    const row = this.sql.exec(`SELECT created_by FROM channels WHERE name = ?`, channel).toArray()[0];
    if (row) return row.created_by;
    const now = this.kbNow();
    this.sql.exec(`INSERT INTO channels (name, created_by, created_at) VALUES (?, ?, ?)`, channel, sender, now);
    this.sql.exec(`INSERT INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`, channel, sender, sender, now);
    this.emitEvent("channel.created", { actor: sender, scope: "all", payload: { channel, created_by: sender } });
    return sender;
  }

  // Can this agent SEND to this channel? Members + DM parties. (Admin bypasses.)
  canSendToChannel(agent, channel) {
    if (channel === "all-agent") return true;
    if (channel.startsWith("dm:")) {
      const m = /^dm:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$/.exec(channel || "");
      return !!m && (m[1] === agent || m[2] === agent);
    }
    const row = this.sql.exec(`SELECT 1 FROM channel_members WHERE channel = ? AND agent = ?`, channel, agent).toArray();
    return row.length > 0;
  }

  // ---------- DO alarm: staleness sweep + event retention prune ----------
  // Runs 5 min after boot, then hourly (rescheduled at the end).
  async alarm() {
    try {
      const now = Math.floor(Date.now() / 1000);
      // Task staleness (kanban rev 4): status='doing' AND last_activity_at older
      // than 24h. Emits kanban.task.stale ONCE per transition, guarded by
      // stale_notified_at (reset when last_activity_at advances past it).
      const staleCutoff = now - 86400;
      const staleTasks = this.sql.exec(
        `SELECT id, project_id FROM tasks
         WHERE status = 'doing' AND last_activity_at < ?
           AND (stale_notified_at IS NULL OR stale_notified_at < last_activity_at)`,
        staleCutoff
      ).toArray();
      for (const t of staleTasks) {
        this.sql.exec(`UPDATE tasks SET stale_notified_at = ? WHERE id = ?`, now, t.id);
        this.emitEvent("kanban.task.stale", {
          actor: "system", project_id: t.project_id, payload: { id: t.id },
        });
      }
      // Agent staleness: registered but no poll/WS heartbeat within 24h.
      // Once-per-transition (M5): guarded by stale_notified_at, re-armed when
      // last_seen advances (ISO-8601 strings sort lexicographically).
      const agentCutoffIso = new Date((now - 86400) * 1000).toISOString();
      const nowIso = new Date(now * 1000).toISOString();
      const staleAgents = this.sql.exec(
        `SELECT agent FROM agents
         WHERE last_seen IS NOT NULL AND last_seen < ?
           AND (stale_notified_at IS NULL OR stale_notified_at < last_seen)`,
        agentCutoffIso
      ).toArray();
      for (const { agent } of staleAgents) {
        this.sql.exec(`UPDATE agents SET stale_notified_at = ? WHERE agent = ?`, nowIso, agent);
        this.emitEvent("agent.stale", { actor: "system", scope: "all", payload: { agent } });
      }
      // Event retention: prune events older than 30 days.
      this.sql.exec(`DELETE FROM events WHERE ts < ?`, now - 30 * 86400);
    } catch (e) { /* sweep must never wedge the alarm loop */ }
    try {
      await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    } catch {}
  }

  // ---------- helpers ----------

  allAgents() {
    return this.sql
      .exec("SELECT agent, secret FROM agents")
      .toArray()
      .map((r) => ({ agent: r.agent, secret: r.secret }));
  }

  authedAgent(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.get("Authorization") || "");
    if (!m) return null;
    for (const { agent, secret } of this.allAgents()) {
      if (timingSafeEqual(secret, m[1])) {
        // Touch last_seen (best-effort, don't fail auth on DB error).
        try {
          this.sql.exec("UPDATE agents SET last_seen = ? WHERE agent = ?", new Date().toISOString(), agent);
        } catch {}
        return agent;
      }
    }
    return null;
  }

  agentForToken(token) {
    if (!token) return null;
    for (const { agent, secret } of this.allAgents()) {
      if (timingSafeEqual(secret, token)) return agent;
    }
    return null;
  }

  readableChannels(agent) {
    // Members-only model (poll rev 3): all-agent + channels the agent is a
    // member of + every dm channel the agent is a party of. Backfill in
    // migrateV4() preserves pre-overhaul group-read semantics.
    const chans = new Set(["all-agent"]);
    try {
      const rows = this.sql
        .exec("SELECT channel FROM channel_members WHERE agent = ?", agent)
        .toArray();
      for (const r of rows) chans.add(r.channel);
    } catch {}
    for (const { agent: other } of this.allAgents()) {
      if (other !== agent) chans.add(dmChannel(agent, other));
    }
    return chans;
  }

  validateChannel(agent, channel) {
    // Returns null if ok, else an error string.
    if (channel === "all-agent") return null;
    // Custom public channels (e.g. kanban-do): allow any sane name.
    // DM channels are validated strictly below.
    if (typeof channel === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel)) return null;
    const m = /^dm:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$/.exec(channel || "");
    if (!m) return "unknown channel";
    const [, a, b] = m;
    if (dmChannel(a, b) !== channel) return "dm pair not sorted";
    const known = new Set(this.allAgents().map((r) => r.agent));
    if (!known.has(a) || !known.has(b)) return "unknown channel";
    if (agent !== a && agent !== b) return "not a party of this channel";
    return null;
  }

  rlCheck(agent) {
    const [limit, window] = RATE_LIMITS[agent] || DEFAULT_RATE;
    const now = Date.now() / 1000;
    const hits = (this.rateLimit.get(agent) || []).filter(
      (t) => now - t < window
    );
    if (hits.length >= limit) {
      this.rateLimit.set(agent, hits);
      return false;
    }
    hits.push(now);
    this.rateLimit.set(agent, hits);
    return true;
  }

  churnCheck(agent) {
    const now = Date.now() / 1000;
    const hits = (this.churn.get(agent) || []).filter(
      (t) => now - t < CHURN_WINDOW
    );
    hits.push(now);
    this.churn.set(agent, hits);
    return hits.length <= CHURN_LIMIT;
  }

  json(code, obj, extraHeaders) {
    return new Response(JSON.stringify(obj), {
      status: code,
      headers: { "Content-Type": "application/json", ...(extraHeaders || {}) },
    });
  }

  // ---------- HTTP routes ----------

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/health") return this.json(200, { ok: true });
      if (path === "/ws") return this.handleWs(req, url);
      if (path === "/send" && req.method === "POST")
        return this.handleSend(req);
      if (path === "/poll" && req.method === "GET")
        return this.handlePoll(req, url);
      if (path === "/list" && req.method === "GET")
        return this.handleList(req);
      if (path === "/agents" && req.method === "GET")
        return this.handleAgents(req);
      if (path === "/reg" && req.method === "POST")
        return this.handleReg(req);
      if (path === "/admin/agents" && req.method === "POST")
        return this.handleAdminAgents(req);
      if (path === "/admin/import" && req.method === "POST")
        return this.handleAdminImport(req);
      if (path === "/admin/export" && req.method === "GET")
        return this.handleAdminExport(req);
      // --- Admin panel (Ryuki #268, Basic auth, separate realm) ---
      // /panel is a cache-busting alias for /admin (Ryuki 2026-10-17).
      if ((path === "/admin" || path === "/panel") && req.method === "GET")
        return this.handleAdminPanel(req);
      // /logout — static logged-out page (auth lives in panel JS sessionStorage).
      if (path === "/logout" && req.method === "GET")
        return new Response(
          '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logged out</title>' +
          '<style>body{background:#0f0f13;color:#e8e8ea;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
          'a{color:#7c6cf0}</style></head><body><div style="text-align:center">' +
          '<h2>👑 Logged out</h2><p>Session cleared. <a href="/panel">Back to panel</a></p></div></body></html>',
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
        );
      if (path === "/admin/api/agents" && req.method === "GET")
        return this.handleAdminApiAgents(req);
      if (path === "/admin/api/messages" && req.method === "GET")
        return this.handleAdminApiMessages(req, url);
      if (path === "/admin/api/channels" && req.method === "GET")
        return this.handleAdminApiChannels(req);
      if (path === "/admin/api/senders" && req.method === "GET")
        return this.handleAdminApiSenders(req);
      if (path === "/admin/api/registered" && req.method === "GET")
        return this.handleAdminApiRegistered(req);
      if (path === "/admin/api/stats" && req.method === "GET")
        return this.handleAdminApiStats(req);
      if (path === "/admin/api/send" && req.method === "POST")
        return this.handleAdminApiSend(req);
      // --- Admin password change (Ryuki #286) ---
      if (path === "/admin/api/password" && req.method === "POST")
        return this.handleAdminApiPassword(req);
      // --- Admin agent management (Ryuki #272) ---
      if (path === "/admin/api/agents" && req.method === "POST")
        return this.handleAdminApiAgentRegister(req);
      {
        const m = /^\/admin\/api\/agents\/([^/]+)$/.exec(path);
        if (m && req.method === "DELETE")
          return this.handleAdminApiAgentDelete(req, decodeURIComponent(m[1]));
      }
      {
        const m = /^\/admin\/api\/agents\/([^/]+)\/rotate$/.exec(path);
        if (m && req.method === "POST")
          return this.handleAdminApiAgentRotate(req, decodeURIComponent(m[1]));
      }
      // --- Admin message delete (Ryuki #272) ---
      {
        const m = /^\/admin\/api\/messages\/(\d+)$/.exec(path);
        if (m && req.method === "DELETE")
          return this.handleAdminApiMessageDelete(req, parseInt(m[1], 10));
        if (m && req.method === "PUT")
          return this.handleAdminApiMessageEdit(req, parseInt(m[1], 10));
      }
      // --- Channel management (poll rev 3) ---
      // NOTE: specific member routes MUST come before the greedy channel-name
      // route below, or DELETE .../members/:agent would be swallowed by it (C1).
      {
        const m = /^\/admin\/api\/channels\/([^/]+)\/members\/([^/]+)$/.exec(path);
        if (m && req.method === "DELETE")
          return this.handleAdminApiChannelMemberRemove(req, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      }
      {
        const m = /^\/admin\/api\/channels\/([^/]+)$/.exec(path);
        if (m && req.method === "DELETE")
          return this.handleAdminApiChannelDelete(req, decodeURIComponent(m[1]));
      }
      if (path === "/api/channels" && req.method === "POST")
        return this.handleApiChannelCreate(req);
      if (path === "/admin/api/channels" && req.method === "POST")
        return this.handleAdminApiChannelCreate(req);
      {
        const m = /^\/admin\/api\/channels\/([^/]+)\/members$/.exec(path);
        if (m && req.method === "POST")
          return this.handleAdminApiChannelMemberAdd(req, decodeURIComponent(m[1]));
      }
      {
        const m = /^\/api\/channels\/([^/]+)\/members$/.exec(path);
        if (m && req.method === "POST")
          return this.handleApiChannelMemberAdd(req, decodeURIComponent(m[1]));
      }
      {
        const m = /^\/api\/channels\/([^/]+)\/members\/([^/]+)$/.exec(path);
        if (m && req.method === "DELETE")
          return this.handleApiChannelMemberRemove(req, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
      }
      // --- Kanban (rev 2 plan, LOCKED 2026-10-19) ---
      // Admin (Basic auth)
      if (path === "/admin/api/kanban/projects" && req.method === "GET")
        return this.handleKbAdminProjectsList(req);
      if (path === "/admin/api/kanban/projects" && req.method === "POST")
        return this.handleKbAdminProjectCreate(req);
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)$/.exec(path);
        if (m && req.method === "PUT")
          return this.handleKbAdminProjectUpdate(req, parseInt(m[1], 10));
        if (m && req.method === "DELETE")
          return this.handleKbAdminProjectDelete(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)\/tasks$/.exec(path);
        if (m && req.method === "GET")
          return this.handleKbAdminTasksList(req, parseInt(m[1], 10));
        if (m && req.method === "POST")
          return this.handleKbAdminTaskCreate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)$/.exec(path);
        if (m && req.method === "PUT")
          return this.handleKbAdminTaskUpdate(req, parseInt(m[1], 10));
        if (m && req.method === "DELETE")
          return this.handleKbAdminTaskDelete(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)\/todos$/.exec(path);
        if (m && req.method === "POST")
          return this.handleKbAdminTodoCreate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/todos\/(\d+)$/.exec(path);
        if (m && req.method === "PUT")
          return this.handleKbAdminTodoUpdate(req, parseInt(m[1], 10));
        if (m && req.method === "DELETE")
          return this.handleKbAdminTodoDelete(req, parseInt(m[1], 10));
      }
      // Agent (Bearer auth)
      if (path === "/api/kanban/projects" && req.method === "GET")
        return this.handleKbAgentProjectsList(req);
      if (path === "/api/kanban/tasks/available" && req.method === "GET")
        return this.handleKbAgentTasksAvailable(req);
      {
        const m = /^\/api\/kanban\/projects\/(\d+)\/tasks$/.exec(path);
        if (m && req.method === "GET")
          return this.handleKbAgentTasksList(req, parseInt(m[1], 10));
        if (m && req.method === "POST")
          return this.handleKbAgentTaskCreate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/projects\/(\d+)\/tasks\/search$/.exec(path);
        if (m && req.method === "GET") {
          const agent = this.authedAgent(req);
          if (!agent) return this.json(401, { error: "unauthorized" });
          return this.handleKbTaskSearch(url, { isAdmin: false, agent, projectId: parseInt(m[1], 10) });
        }
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)$/.exec(path);
        if (m && req.method === "GET")
          return this.handleKbAgentTaskDetail(req, parseInt(m[1], 10));
        if (m && req.method === "PUT")
          return this.handleKbAgentTaskUpdate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/claim$/.exec(path);
        if (m && req.method === "POST")
          return this.handleKbAgentTaskClaim(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/status$/.exec(path);
        if (m && req.method === "PUT")
          return this.handleKbAgentTaskStatus(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/todos$/.exec(path);
        if (m && req.method === "POST")
          return this.handleKbAgentTodoCreate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/comments$/.exec(path);
        if (m && req.method === "GET") {
          const agent = this.authedAgent(req);
          if (!agent) return this.json(401, { error: "unauthorized" });
          return this.handleKbCommentList(req, url, parseInt(m[1], 10), { isAdmin: false, agent });
        }
        if (m && req.method === "POST") {
          const agent = this.authedAgent(req);
          if (!agent) return this.json(401, { error: "unauthorized" });
          return this.handleKbCommentAdd(req, parseInt(m[1], 10), { isAdmin: false, agent });
        }
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/labels$/.exec(path);
        if (m && req.method === "POST")
          return this.handleKbAgentLabelAdd(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/labels\/(.+)$/.exec(path);
        if (m && req.method === "DELETE")
          return this.handleKbAgentLabelRemove(req, parseInt(m[1], 10), decodeURIComponent(m[2]));
      }
      {
        const m = /^\/api\/kanban\/todos\/(\d+)$/.exec(path);
        if (m && req.method === "PUT")
          return this.handleKbAgentTodoUpdate(req, parseInt(m[1], 10));
      }
      // --- Kanban expansion: admin search/labels/subscribers/task detail ---
      if (path === "/admin/api/kanban/tasks/search" && req.method === "GET") {
        if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
        return this.handleKbTaskSearch(url, { isAdmin: true, agent: null, projectId: null });
      }
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)\/tasks\/search$/.exec(path);
        if (m && req.method === "GET") {
          if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
          return this.handleKbTaskSearch(url, { isAdmin: true, agent: null, projectId: parseInt(m[1], 10) });
        }
      }
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)\/labels$/.exec(path);
        if (m && req.method === "GET")
          return this.handleKbAdminProjectLabels(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)\/subscribers$/.exec(path);
        if (m && req.method === "GET")
          return this.handleKbAdminProjectSubscribers(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)$/.exec(path);
        if (m && req.method === "GET")
          return this.handleKbAdminTaskDetail(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)\/comments$/.exec(path);
        if (m && req.method === "GET") {
          if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
          return this.handleKbCommentList(req, url, parseInt(m[1], 10), { isAdmin: true, agent: null });
        }
        if (m && req.method === "POST") {
          if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
          return this.handleKbCommentAdd(req, parseInt(m[1], 10), { isAdmin: true, agent: null });
        }
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)\/labels$/.exec(path);
        if (m && req.method === "POST")
          return this.handleKbAdminLabelAdd(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)\/labels\/(.+)$/.exec(path);
        if (m && req.method === "DELETE")
          return this.handleKbAdminLabelRemove(req, parseInt(m[1], 10), decodeURIComponent(m[2]));
      }
      return this.json(404, { error: "not found" });
    } catch (e) {
      return this.json(500, { error: "internal: " + String(e && e.message || e) });
    }
  }

  async handleSend(req) {
    const agent = this.authedAgent(req);
    if (!agent) {
      // Drain the body: returning while the request stream is unread makes
      // workerd fail the connection ("Can't read from request stream after
      // response has been sent").
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid JSON" });
    }
    // Body is consumed before the rate-limit check for the same reason.
    if (!this.rlCheck(agent)) return this.json(429, { error: "rate limited" });
    if (!data || typeof data !== "object")
      return this.json(400, { error: "invalid JSON" });
    // sender is stamped server-side from the Bearer binding; a client-supplied
    // "sender"/"from" field is ignored (spec §12.1).
    const channel = data.channel;
    const body = data.body;
    const chanErr = this.validateChannel(agent, channel);
    if (chanErr) return this.json(400, { error: chanErr });
    if (typeof body !== "string" || !body)
      return this.json(400, { error: "body required" });
    if (new TextEncoder().encode(body).length > BODY_CAP)
      return this.json(413, { error: "body too large (max 8192 bytes)" });
    let priority = data.priority;
    if (priority === undefined || priority === null || priority === "") {
      priority = agent === "wren" ? "low" : "normal";
    }
    if (!PRIORITIES.includes(priority))
      return this.json(400, { error: "priority must be low|normal|urgent" });
    let audience = data.audience;
    if (audience === undefined || audience === null || audience === "") {
      audience = "agents";
    }
    if (!AUDIENCES.includes(audience))
      return this.json(400, { error: "audience must be agents|luki" });

    // reply_to (API-SPEC-FULL §1.1, locked with kanban rev 4): must exist and
    // be in the same channel. Immutable once set. Validated BEFORE any
    // channel auto-creation side effects.
    let replyTo = data.reply_to;
    if (replyTo === undefined || replyTo === null || replyTo === "") {
      replyTo = null;
    } else {
      if (!Number.isInteger(replyTo))
        return this.json(400, { error: "reply_to must be an integer message id" });
      const target = this.sql.exec(`SELECT channel FROM messages WHERE id = ?`, replyTo).toArray()[0];
      if (!target) return this.json(400, { error: "reply_to message not found" });
      if (target.channel !== channel)
        return this.json(400, { error: "reply_to must be in the same channel" });
    }

    // Channel send permission (poll rev 3): members + DM parties.
    // Sending to a valid non-existent custom channel auto-creates it with the
    // sender as creator (preserves implicit behavior) + channel.created event.
    this.ensureChannelRow(channel, agent);
    if (!this.canSendToChannel(agent, channel))
      return this.json(403, { error: "not a member of channel" });

    const ts = utcnow();
    const cursor = this.sql.exec(
      "INSERT INTO messages (sender, channel, priority, audience, ts, body, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
      agent,
      channel,
      priority,
      audience,
      ts,
      body,
      replyTo
    );
    const id = cursor.toArray()[0].id;
    const message = { id, sender: agent, channel, priority, audience, ts, body, reply_to: replyTo };
    this.emitEvent("bus.message", {
      actor: agent, scope: "channel:" + channel, payload: message,
    });

    // Push to subscribed sockets in the same wake (spec §2.5).
    const frame = JSON.stringify({ op: "msg", message });
    for (const ws of this.state.getWebSockets("ch:" + channel)) {
      try {
        const att = ws.deserializeAttachment();
        if (att && Array.isArray(att.channels) && att.channels.includes(channel)) {
          ws.send(frame);
        }
      } catch {
        // dead socket; hibernation cleans it up
      }
    }
    return this.json(200, { ok: true, id });
  }

  // GET /poll — unified poll (rev 3 plan, LOCKED 2026-10-20).
  // New mode:  ?since_ts=<ts>&since_id=<id>  -> {events: [...], resync_required}
  // Legacy:    ?since=<id>                   -> {messages: [...]} (wire format pinned)
  // ?admin=1 requires valid Basic auth and bypasses all scoping (admins are not agents).
  async handlePoll(req, url) {
    const sinceTsRaw = url.searchParams.get("since_ts");
    const adminMode = url.searchParams.get("admin") === "1";
    if (adminMode) {
      if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
      return this.handlePollNew(url, null, true);
    }
    const agent = this.authedAgent(req);
    if (!agent) return this.json(401, { error: "unauthorized" });
    if (sinceTsRaw !== null) return this.handlePollNew(url, agent, false);
    return this.handlePollLegacy(url, agent);
  }

  // New-mode poll: composite (ts, id) cursor over the events table.
  async handlePollNew(url, agent, isAdmin) {
    const tsRaw = (url.searchParams.get("since_ts") || "0").trim();
    const idRaw = (url.searchParams.get("since_id") || "0").trim();
    if (!/^\d+$/.test(tsRaw) || !/^\d+$/.test(idRaw))
      return this.json(400, { error: "since_ts and since_id must be non-negative integers" });
    const sinceTs = parseInt(tsRaw, 10);
    const sinceId = parseInt(idRaw, 10);
    const now = Math.floor(Date.now() / 1000);
    const RETENTION_SEC = 30 * 86400;
    const resync_required = sinceTs < now - RETENTION_SEC;
    const cursorSql = `(ts > ? OR (ts = ? AND id > ?))`;
    let rows;
    if (isAdmin) {
      // Admin bypass (normative): NO scoping AND-clause — sees everything incl. scope='admin'.
      rows = this.sql.exec(
        `SELECT id, type, actor, project_id, scope, recipients, ts, payload FROM events
         WHERE ${cursorSql} ORDER BY ts ASC, id ASC LIMIT 1000`,
        sinceTs, sinceTs, sinceId
      ).toArray();
    } else {
      // Agent scoping (poll rev 3, normative combined filter).
      const readable = [...this.readableChannels(agent)];
      const chanPlace = readable.map(() => "?").join(",");
      rows = this.sql.exec(
        `SELECT id, type, actor, project_id, scope, recipients, ts, payload FROM events
         WHERE ${cursorSql} AND (
           (project_id IS NOT NULL AND ${this.kbSubscriberPred()})
           OR (project_id IS NULL AND (
                scope = 'all'
             OR scope = ('agent:' || ?)
             OR (scope LIKE 'channel:%' AND substr(scope, 9) IN (${chanPlace}))
           ))
           OR (project_id IS NOT NULL AND recipients IS NOT NULL
               AND EXISTS (SELECT 1 FROM json_each(recipients) WHERE value = ?))
         ) ORDER BY ts ASC, id ASC LIMIT 1000`,
        sinceTs, sinceTs, sinceId,
        agent,                       // subscriber predicate
        agent,                       // scope = 'agent:' || agent
        ...readable,                 // channel IN (...)
        agent                        // recipients json_each
      ).toArray();
    }
    const events = rows.map((r) => {
      let data = {};
      try { data = JSON.parse(r.payload); } catch {}
      return {
        id: r.id, type: r.type, ts: r.ts,
        actor: r.actor, project_id: r.project_id, scope: r.scope,
        recipients: r.recipients ? JSON.parse(r.recipients) : null,
        payload: data,
      };
    });
    return this.json(200, { events, resync_required });
  }

  // Legacy ?since= mode — wire format pinned byte-exact (poll rev 3).
  // Result set follows the members-only channel model; shape does not change.
  async handlePollLegacy(url, agent) {
    const sinceRaw = (url.searchParams.get("since") || "0").trim();
    if (!/^\d+$/.test(sinceRaw))
      return this.json(400, { error: "since must be a non-negative integer" });
    const since = parseInt(sinceRaw, 10);
    const readable = this.readableChannels(agent);
    const channel = url.searchParams.get("channel");
    let chans;
    if (channel) {
      const err = this.validateChannel(agent, channel);
      if (err) return this.json(403, { error: "channel not readable: " + err });
      if (!readable.has(channel)) return this.json(403, { error: "channel not readable: not a member" });
      chans = [channel];
    } else {
      chans = [...readable];
    }
    const placeholders = chans.map(() => "?").join(",");
    const rows = this.sql
      .exec(
        `SELECT id, sender, channel, priority, audience, ts, body FROM messages
         WHERE id > ? AND channel IN (${placeholders}) ORDER BY id ASC`,
        since,
        ...chans
      )
      .toArray();
    // Readiness-gated deprecation signal (non-breaking): header + field.
    return this.json(
      200,
      { messages: rows, deprecated: "use ?since_ts=&since_id=" },
      { Deprecation: "true" }
    );
  }

  // ---------- WebSocket ----------

  async handleWs(req, url) {
    if (req.headers.get("Upgrade") !== "websocket") {
      return this.json(400, { error: "expected websocket upgrade" });
    }
    // Token validated BEFORE acceptWebSocket — unauthenticated sockets are
    // never accepted (spec §2.3, §11.2).
    const agent = this.agentForToken(url.searchParams.get("token"));
    if (!agent) {
      return new Response("unauthorized", { status: 401 });
    }
    if (!this.churnCheck(agent)) {
      // Spec §2.5: accept, deliver the churn error frame, then close.
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ op: "error", reason: "churn" }));
      server.close(1013, "churn");
      return new Response(null, { status: 101, webSocket: client });
    }

    const readable = this.readableChannels(agent);
    // Optional initial subscription via query params; the sub frame can
    // re-tag later. Intersection with the readable set is enforced.
    const qChans = (url.searchParams.get("channels") || "")
      .split(",")
      .map((s) => s.trim())
      .filter((c) => c && readable.has(c) && !this.validateChannel(agent, c));
    const initialChannels = qChans.length ? qChans : [...readable];
    const sinceRaw = (url.searchParams.get("since") || "0").trim();
    const since = /^\d+$/.test(sinceRaw) ? parseInt(sinceRaw, 10) : 0;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Tag with the full readable set (superset); the attachment carries the
    // effective subscription, which a later sub frame may narrow.
    this.state.acceptWebSocket(
      server,
      [...readable].map((c) => "ch:" + c)
    );
    server.serializeAttachment({
      agent,
      channels: initialChannels,
      cursor: since,
      connectedAt: Date.now(),
    });
    this.emitEvent("agent.online", { actor: agent, scope: "all", payload: { agent } });
    server.send(JSON.stringify({ op: "hello", since }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    let data;
    try {
      data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      ws.send(JSON.stringify({ op: "error", reason: "invalid frame" }));
      return;
    }
    if (!data || data.op !== "sub") {
      ws.send(JSON.stringify({ op: "error", reason: "unknown op" }));
      return;
    }
    let att;
    try {
      att = ws.deserializeAttachment();
    } catch {
      att = null;
    }
    const agent = att && att.agent;
    if (!agent) {
      ws.send(JSON.stringify({ op: "error", reason: "no session" }));
      ws.close(1011, "no session");
      return;
    }
    const readable = this.readableChannels(agent);
    const requested = Array.isArray(data.channels) ? data.channels : [];
    // Server re-checks every sub frame: only readable channels survive (spec §8).
    const channels = requested.filter(
      (c) => typeof c === "string" && readable.has(c) && !this.validateChannel(agent, c)
    );
    if (!channels.length) {
      ws.send(JSON.stringify({ op: "error", reason: "no readable channels" }));
      return;
    }
    let since = att.cursor || 0;
    if (data.since !== undefined && data.since !== null) {
      const s = String(data.since).trim();
      if (/^\d+$/.test(s)) since = parseInt(s, 10);
    }
    ws.serializeAttachment({
      agent,
      channels,
      cursor: since,
      connectedAt: (att && att.connectedAt) || Date.now(),
    });
    ws.send(JSON.stringify({ op: "hello", since }));
  }

  async webSocketClose(ws, code, reason, wasClean) {
    // Emit agent.offline (best-effort; attachment may be gone under hibernation).
    try {
      const att = ws.deserializeAttachment();
      if (att && att.agent) {
        this.emitEvent("agent.offline", { actor: att.agent, scope: "all", payload: { agent: att.agent } });
      }
    } catch {}
  }

  async webSocketError(ws, error) {
    try {
      ws.close(1011, "error");
    } catch {}
  }

  // ---------- admin (cutover tooling) ----------

  // GET /list — currently connected agents (active WebSocket connections).
  // Auth: Bearer (any registered agent). Returns one entry per agent:
  //   {agent, channels, connectedSince, connections}
  async handleList(req) {
    const agent = this.authedAgent(req);
    if (!agent) return this.json(401, { error: "unauthorized" });
    const byAgent = new Map();
    for (const ws of this.state.getWebSockets()) {
      let att;
      try {
        att = ws.deserializeAttachment();
      } catch {
        continue;
      }
      if (!att || !att.agent) continue;
      const entry = byAgent.get(att.agent) || {
        agent: att.agent,
        channels: new Set(),
        connectedSince: null,
        connections: 0,
      };
      for (const c of att.channels || []) entry.channels.add(c);
      const since = att.connectedAt ? new Date(att.connectedAt).toISOString() : null;
      if (since && (!entry.connectedSince || since < entry.connectedSince)) {
        entry.connectedSince = since;
      }
      entry.connections++;
      byAgent.set(att.agent, entry);
    }
    const agents = [...byAgent.values()]
      .map((e) => ({
        agent: e.agent,
        channels: [...e.channels].sort(),
        connectedSince: e.connectedSince,
        connections: e.connections,
      }))
      .sort((a, b) => (a.agent < b.agent ? -1 : 1));
    return this.json(200, { agents });
  }

  // GET /agents — all registered agents (from the agents table), connected or not.
  // Auth: Bearer (any registered agent). Returns [{agent, created}] ONLY —
  // NEVER secrets. (Ryuki 2026-10-17: visibility into who's on the bus.)
  async handleAgents(req) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    const agents = this.sql
      .exec("SELECT agent, created FROM agents ORDER BY agent")
      .toArray()
      .map((r) => ({ agent: r.agent, created: r.created }));
    return this.json(200, { agents });
  }

  // POST /reg — register a new agent. Body: {agent: "name"}.
  // Auth: admin token (X-Admin-Token), NOT a regular agent token.
  // This is the simple secure option: the operator runs it from the SG VM
  // (admin token in wrangler secret / .dev.vars). Returns the new token —
  // store it as the agent's BUS_TOKEN / Bearer secret.
  async handleReg(req) {
    if (!(await this.checkAdminDrain(req)))
      return this.json(401, { error: "unauthorized" });
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid JSON" });
    }
    const name = data && data.agent;
    if (typeof name !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(name)) {
      return this.json(400, {
        error: "agent must be 1-32 chars of [A-Za-z0-9_]",
      });
    }
    const exists = this.sql
      .exec("SELECT 1 FROM agents WHERE agent = ?", name)
      .toArray();
    if (exists.length) return this.json(409, { error: "agent already registered" });
    const token = crypto.randomUUID().replace(/-/g, "");
    this.sql.exec(
      "INSERT INTO agents (agent, secret, created) VALUES (?, ?, ?)",
      name,
      token,
      utcnow()
    );
    // New agents join all-agent automatically (poll rev 3).
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      this.sql.exec(`INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('all-agent', ?, 'system', ?)`, name, nowSec);
    } catch {}
    this.emitEvent("agent.registered", { actor: "admin", scope: "admin", payload: { agent: name } });
    return this.json(200, { ok: true, agent: name, token });
  }

  checkAdmin(req) {
    const token = req.headers.get("X-Admin-Token") || "";
    const expected = this.env.BUS_ADMIN_TOKEN || "";
    return expected !== "" && timingSafeEqual(token, expected);
  }

  async checkAdminDrain(req) {
    // Admin auth failure: drain the body before the 401 (see handleSend).
    if (this.checkAdmin(req)) return true;
    try {
      await req.text();
    } catch {}
    return false;
  }

  async handleAdminAgents(req) {
    if (!(await this.checkAdminDrain(req)))
      return this.json(401, { error: "unauthorized" });
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid JSON" });
    }
    const agents = (data && data.agents) || [];
    if (!Array.isArray(agents)) return this.json(400, { error: "agents must be an array" });
    for (const a of agents) {
      if (!a || typeof a.agent !== "string" || typeof a.secret !== "string" || !a.agent || !a.secret) {
        return this.json(400, { error: "each agent needs {agent, secret}" });
      }
      this.sql.exec(
        "INSERT INTO agents (agent, secret, created) VALUES (?, ?, ?) ON CONFLICT(agent) DO UPDATE SET secret=excluded.secret",
        a.agent,
        a.secret,
        utcnow()
      );
      // Imported agents join all-agent too (poll rev 3).
      try {
        const nowSec = Math.floor(Date.now() / 1000);
        this.sql.exec(`INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('all-agent', ?, 'system', ?)`, a.agent, nowSec);
      } catch {}
    }
    return this.json(200, { ok: true, count: agents.length });
  }

  async handleAdminImport(req) {
    if (!(await this.checkAdminDrain(req)))
      return this.json(401, { error: "unauthorized" });
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid JSON" });
    }
    const messages = (data && data.messages) || [];
    if (!Array.isArray(messages)) return this.json(400, { error: "messages must be an array" });
    const known = new Set(this.allAgents().map((r) => r.agent));
    let count = 0;
    for (const m of messages) {
      if (!m || typeof m.id !== "number" || !m.sender || !m.channel || !m.ts || typeof m.body !== "string") {
        return this.json(400, { error: "each message needs {id, sender, channel, ts, body}" });
      }
      if (!known.has(m.sender)) return this.json(400, { error: "unknown sender: " + m.sender });
      const priority = PRIORITIES.includes(m.priority) ? m.priority : "normal";
      const audience = AUDIENCES.includes(m.audience) ? m.audience : "agents";
      this.sql.exec(
        "INSERT INTO messages (id, sender, channel, priority, audience, ts, body) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        m.id,
        m.sender,
        m.channel,
        priority,
        audience,
        m.ts,
        m.body
      );
      count++;
    }
    // Fix the AUTOINCREMENT sequence so new sends continue after MAX(id).
    this.sql.exec(
      "UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM messages) WHERE name = 'messages'"
    );
    return this.json(200, { ok: true, imported: count });
  }

  async handleAdminExport(req) {
    if (!this.checkAdmin(req)) return this.json(401, { error: "unauthorized" });
    const messages = this.sql
      .exec("SELECT id, sender, channel, priority, audience, ts, body FROM messages ORDER BY id ASC")
      .toArray();
    const agents = this.sql.exec("SELECT agent, created FROM agents").toArray();
    return this.json(200, { messages, agents });
  }

  // ---------- Admin panel (Ryuki #268) ----------
  // Separate auth realm: HTTP Basic, credentials in DO SQLite (admins table).
  // Seeded from ADMIN_USER/ADMIN_PASS env on first boot (Ryuki #286).
  // Agent Bearer tokens NEVER authorize /admin/*.

  async checkBasicAuth(req) {
    const h = req.headers.get("Authorization") || "";
    const m = /^Basic (\S+)$/.exec(h);
    if (!m) return false;
    let decoded;
    try {
      decoded = atob(m[1]);
    } catch {
      return false;
    }
    const idx = decoded.indexOf(":");
    if (idx < 0) return false;
    const u = decoded.slice(0, idx);
    const p = decoded.slice(idx + 1);
    // Look up in admins table.
    const rows = this.sql.exec(`SELECT user, pass_hash, salt FROM admins WHERE user = ?`, u).toArray();
    if (rows.length === 0) return false;
    const row = rows[0];
    const hash = await sha256Hex(row.salt + ":" + p);
    return timingSafeEqual(hash, row.pass_hash);
  }

  async unauthorizedBasic(req) {
    // Drain the body: returning while the request stream is unread makes
    // workerd fail the connection ("Can't read from request stream after
    // response has been sent").
    try {
      await req.text();
    } catch {}
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  // GET /admin — the panel HTML.
  async handleAdminPanel(req) {
    // No auth on the HTML shell itself — the JS login form handles auth,
    // and all /admin/api/* endpoints still require Basic auth.
    // (Native browser Basic dialog breaks fetch() credential handling on mobile.)
    return new Response(ADMIN_PANEL_HTML, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  // GET /admin/api/agents — live connected agents (reuses /list logic).
  async handleAdminApiAgents(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    // Reuse the same logic as /list but without requiring agent auth.
    const byAgent = new Map();
    for (const ws of this.state.getWebSockets()) {
      let att;
      try {
        att = ws.deserializeAttachment();
      } catch {
        continue;
      }
      if (!att || !att.agent) continue;
      const entry = byAgent.get(att.agent) || {
        agent: att.agent,
        channels: new Set(),
        connectedSince: null,
        connections: 0,
      };
      for (const c of att.channels || []) entry.channels.add(c);
      const since = att.connectedAt ? new Date(att.connectedAt).toISOString() : null;
      if (since && (!entry.connectedSince || since < entry.connectedSince)) {
        entry.connectedSince = since;
      }
      entry.connections++;
      byAgent.set(att.agent, entry);
    }
    const agents = [...byAgent.values()]
      .map((e) => ({
        agent: e.agent,
        channels: [...e.channels].sort(),
        connectedSince: e.connectedSince,
        connections: e.connections,
      }))
      .sort((a, b) => (a.agent < b.agent ? -1 : 1));
    return this.json(200, { agents });
  }

  // GET /admin/api/messages?channel=&since=&limit=&sender=&priority=&q= — cross-channel, newest-first.
  async handleAdminApiMessages(req, url) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const channel = url.searchParams.get("channel") || null;
    const sender = url.searchParams.get("sender") || null;
    const priority = url.searchParams.get("priority") || null;
    const q = url.searchParams.get("q") || null;
    const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
    let limit = parseInt(url.searchParams.get("limit") || "50", 10) || 50;
    limit = Math.min(Math.max(limit, 1), 200);
    let sql = "SELECT id, sender, channel, priority, audience, ts, body FROM messages WHERE id > ?";
    const params = [since];
    if (channel) { sql += " AND channel = ?"; params.push(channel); }
    if (sender) { sql += " AND sender = ?"; params.push(sender); }
    if (priority && PRIORITIES.includes(priority)) { sql += " AND priority = ?"; params.push(priority); }
    if (q) { sql += " AND body LIKE ?"; params.push("%" + q.replace(/[%_]/g, "") + "%"); }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);
    const messages = this.sql.exec(sql, ...params).toArray();
    return this.json(200, { messages });
  }

  // GET /admin/api/channels — distinct channel list for the filter dropdown.
  async handleAdminApiChannels(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const rows = this.sql.exec("SELECT DISTINCT channel FROM messages ORDER BY channel").toArray();
    const channels = [];
    for (const r of rows) {
      const name = r.channel;
      let members = [];
      try {
        members = this.sql.exec("SELECT agent FROM channel_members WHERE channel = ? ORDER BY agent", name)
          .toArray().map((m) => m.agent);
      } catch {}
      // DM channels: members are the two parties
      if (!members.length && name.startsWith("dm:")) {
        members = name.split(":").slice(1);
      }
      channels.push({ name, members });
    }
    return this.json(200, { channels });
  }

  // GET /admin/api/senders — distinct sender list for the filter dropdown.
  async handleAdminApiSenders(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const rows = this.sql.exec("SELECT DISTINCT sender FROM messages ORDER BY sender").toArray();
    return this.json(200, { senders: rows.map((r) => r.sender) });
  }

  // GET /admin/api/registered — all registered agents (for the management table). Never secrets.
  async handleAdminApiRegistered(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const agents = this.sql
      .exec("SELECT agent, created, last_seen FROM agents ORDER BY agent")
      .toArray()
      .map((r) => ({ agent: r.agent, created: r.created, last_seen: r.last_seen || null }));
    // Attach rate-limit usage: [used, limit, windowSec].
    const now = Math.floor(Date.now() / 1000);
    for (const a of agents) {
      const [limit, windowSec] = RATE_LIMITS[a.agent] || DEFAULT_RATE;
      const stamps = (this.rateLimit.get(a.agent) || []).filter((t) => t > now - windowSec);
      a.rate = { used: stamps.length, limit, windowSec };
    }
    // Attach transport: "ws" if connected, else "poll".
    const connected = new Set();
    for (const ws of this.state.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment();
        if (att && att.agent) connected.add(att.agent);
      } catch {}
    }
    for (const a of agents) a.transport = connected.has(a.agent) ? "ws" : "poll";
    return this.json(200, { agents });
  }

  // GET /admin/api/stats — messages today, per-channel counts, DO status.
  async handleAdminApiStats(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = this.sql
      .exec("SELECT COUNT(*) AS c FROM messages WHERE ts >= ?", today + "T00:00:00.000Z")
      .one().c;
    const perChannel = this.sql
      .exec("SELECT channel, COUNT(*) AS c FROM messages GROUP BY channel ORDER BY c DESC")
      .toArray()
      .map((r) => ({ channel: r.channel, count: r.c }));
    const total = this.sql.exec("SELECT COUNT(*) AS c FROM messages").one().c;
    const agentCount = this.sql.exec("SELECT COUNT(*) AS c FROM agents").one().c;
    return this.json(200, {
      messagesToday: todayCount,
      totalMessages: total,
      perChannel,
      registeredAgents: agentCount,
      doStatus: "ok",
      ts: new Date().toISOString(),
    });
  }

  // POST /admin/api/send — send as "luki" (server-stamped, bypasses rate limit).
  async handleAdminApiSend(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let body;
    try {
      body = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const channel = body.channel;
    const text = body.body;
    if (!channel || typeof channel !== "string" || !text || typeof text !== "string") {
      return this.json(400, { error: "channel and body required" });
    }
    if (text.length > BODY_CAP) {
      return this.json(400, { error: "body too long" });
    }
    const priority = PRIORITIES.includes(body.priority) ? body.priority : "normal";
    const audience = AUDIENCES.includes(body.audience) ? body.audience : "agents";
    // Validate channel name, then ensure the row exists. New custom channels go
    // through ensureChannelRow so channel.created is emitted (M2); DM rows are
    // system-managed. (M1/minor#6: admin path now validates like /send.)
    if (channel === "all-agent") {
      /* always valid */
    } else if (typeof channel === "string" && channel.startsWith("dm:")) {
      const dm = /^dm:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$/.exec(channel);
      if (!dm) return this.json(400, { error: "invalid dm channel" });
      this.ensureChannelRow(channel, "luki");
    } else {
      if (typeof channel !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel))
        return this.json(400, { error: "invalid channel name" });
      this.ensureChannelRow(channel, "admin");
    }
    // reply_to validation (same rules as /send).
    let replyTo = body.reply_to;
    if (replyTo === undefined || replyTo === null || replyTo === "") {
      replyTo = null;
    } else {
      if (!Number.isInteger(replyTo))
        return this.json(400, { error: "reply_to must be an integer message id" });
      const target = this.sql.exec(`SELECT channel FROM messages WHERE id = ?`, replyTo).toArray()[0];
      if (!target) return this.json(400, { error: "reply_to message not found" });
      if (target.channel !== channel)
        return this.json(400, { error: "reply_to must be in the same channel" });
    }
    const ts = new Date().toISOString();
    // Sender is ALWAYS "luki" — client-supplied sender is ignored.
    const id = this.sql
      .exec(
        "INSERT INTO messages (sender, channel, priority, audience, ts, body, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        "luki",
        channel,
        priority,
        audience,
        ts,
        text,
        replyTo
      )
      .one().id;
    // Broadcast over WS (same as /send): correct tag + attachment check + frame shape (M1).
    const msg = { id, sender: "luki", channel, priority, audience, ts, body: text, reply_to: replyTo };
    const payload = JSON.stringify({ op: "msg", message: msg });
    for (const ws of this.state.getWebSockets("ch:" + channel)) {
      try {
        const att = ws.deserializeAttachment();
        if (att && Array.isArray(att.channels) && att.channels.includes(channel)) {
          ws.send(payload);
        }
      } catch {
        // dead socket; hibernation cleans it up
      }
    }
    // Admin sends are bus.message like everything else (no announcement type).
    // Payload = clean message object (no WS frame wrapper).
    this.emitEvent("bus.message", {
      actor: "admin", scope: "channel:" + channel, payload: msg,
    });
    return this.json(200, { ok: true, id });
  }

  // ---------- Admin agent management (Ryuki #272) ----------

  // POST /admin/api/agents — register a new agent, returns the secret (shown once).
  async handleAdminApiAgentRegister(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let body;
    try {
      body = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const name = (body.agent || "").trim();
    if (!name || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
      return this.json(400, { error: "invalid agent name (lowercase alnum, _-, max 32)" });
    }
    const exists = this.sql.exec("SELECT 1 FROM agents WHERE agent = ?", name).toArray();
    if (exists.length > 0) return this.json(409, { error: "agent already registered" });
    // Generate a secure random secret.
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const secret = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "x".repeat(32);
    const created = new Date().toISOString();
    this.sql.exec("INSERT INTO agents (agent, secret, created) VALUES (?, ?, ?)", name, secret, created);
    // New agents join all-agent automatically (poll rev 3).
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      this.sql.exec(`INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('all-agent', ?, 'system', ?)`, name, nowSec);
    } catch {}
    this.emitEvent("agent.registered", { actor: "admin", scope: "admin", payload: { agent: name } });
    return this.json(200, { ok: true, agent: name, secret, created });
  }

  // DELETE /admin/api/agents/:agent — delete an agent. Their old messages stay.
  async handleAdminApiAgentDelete(req, name) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    const exists = this.sql.exec("SELECT 1 FROM agents WHERE agent = ?", name).toArray();
    if (exists.length === 0) return this.json(404, { error: "agent not found" });
    this.sql.exec("DELETE FROM agents WHERE agent = ?", name);
    // Drop channel memberships (keeps member lists accurate).
    try { this.sql.exec("DELETE FROM channel_members WHERE agent = ?", name); } catch {}
    // Close any open WebSockets for this agent.
    for (const ws of this.state.getWebSockets()) {
      try {
        const att = ws.deserializeAttachment();
        if (att && att.agent === name) ws.close(1008, "agent deleted");
      } catch {}
    }
    this.emitEvent("agent.deregistered", { actor: "admin", scope: "admin", payload: { agent: name } });
    return this.json(200, { ok: true, agent: name });
  }

  // POST /admin/api/agents/:agent/rotate — issue a new secret (shown once). Old stops working.
  async handleAdminApiAgentRotate(req, name) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    const exists = this.sql.exec("SELECT 1 FROM agents WHERE agent = ?", name).toArray();
    if (exists.length === 0) return this.json(404, { error: "agent not found" });
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const secret = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "x".repeat(32);
    this.sql.exec("UPDATE agents SET secret = ? WHERE agent = ?", secret, name);
    // Payload MUST NOT contain token material (poll rev 3) — the agent learns
    // its own revocation via 401.
    this.emitEvent("agent.token_issued", { actor: "admin", scope: "admin", payload: { agent: name } });
    return this.json(200, { ok: true, agent: name, secret });
  }

  // DELETE /admin/api/messages/:id — delete a message. IDs stay stable (never reused).
  async handleAdminApiMessageDelete(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    const exists = this.sql.exec("SELECT channel FROM messages WHERE id = ?", id).toArray()[0];
    if (!exists) return this.json(404, { error: "message not found" });
    this.sql.exec("DELETE FROM messages WHERE id = ?", id);
    this.emitEvent("bus.message.deleted", {
      actor: "admin", scope: "channel:" + exists.channel, payload: { id },
    });
    return this.json(200, { ok: true, id });
  }

  // PUT /admin/api/messages/:id — edit a message (god-mode). Body: { body?, priority?, channel? }.
  async handleAdminApiMessageEdit(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const exists = this.sql.exec("SELECT 1 FROM messages WHERE id = ?", id).toArray();
    if (exists.length === 0) return this.json(404, { error: "message not found" });
    const updates = [];
    const vals = [];
    if (typeof data.body === "string" && data.body.length > 0) {
      updates.push("body = ?");
      vals.push(data.body);
    }
    if (typeof data.priority === "string" && ["low", "normal", "urgent"].includes(data.priority)) {
      updates.push("priority = ?");
      vals.push(data.priority);
    }
    if (typeof data.channel === "string" && data.channel.length > 0) {
      updates.push("channel = ?");
      vals.push(data.channel);
    }
    if (updates.length === 0) return this.json(400, { error: "nothing to update" });
    vals.push(id);
    this.sql.exec(`UPDATE messages SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    const chanRow = this.sql.exec(`SELECT channel FROM messages WHERE id = ?`, id).toArray()[0];
    this.emitEvent("bus.message.edited", {
      actor: "admin", scope: "channel:" + (chanRow ? chanRow.channel : "all-agent"),
      payload: { id, body: typeof data.body === "string" && data.body.length > 0 ? data.body : undefined },
    });
    return this.json(200, { ok: true, id });
  }

  // DELETE /admin/api/channels/:name — delete a channel and all its messages.
  // all-agent and dm:* are not deletable (poll rev 3).
  async handleAdminApiChannelDelete(req, name) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    if (name === "all-agent" || name.startsWith("dm:"))
      return this.json(400, { error: "cannot delete all-agent or dm channels" });
    const count = this.sql.exec("SELECT COUNT(*) as n FROM messages WHERE channel = ?", name).toArray()[0].n;
    this.sql.exec("DELETE FROM messages WHERE channel = ?", name);
    this.sql.exec("DELETE FROM channels WHERE name = ?", name); // cascades channel_members
    this.emitEvent("channel.deleted", { actor: "admin", scope: "all", payload: { channel: name } });
    return this.json(200, { ok: true, channel: name, deleted: count });
  }

  // ---------- Channel management (poll rev 3) ----------

  // Shared create logic. Returns {ok, name} or {error, code}.
  kbChannelCreate(name, creator) {
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name))
      return { error: "invalid channel name", code: 400 };
    if (name === "all-agent" || name.startsWith("dm:"))
      return { error: "reserved channel name", code: 400 };
    const exists = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
    if (exists.length) return { error: "channel already exists", code: 409 };
    const now = this.kbNow();
    this.sql.exec(`INSERT INTO channels (name, created_by, created_at) VALUES (?, ?, ?)`, name, creator, now);
    this.sql.exec(`INSERT INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`, name, creator, creator, now);
    this.emitEvent("channel.created", { actor: creator, scope: "all", payload: { channel: name, created_by: creator } });
    return { ok: true, name };
  }

  // POST /api/channels — agent creates a channel. Body {name}.
  async handleApiChannelCreate(req) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const r = this.kbChannelCreate(data && data.name, agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // POST /admin/api/channels — admin creates a channel. Body {name}.
  async handleAdminApiChannelCreate(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const r = this.kbChannelCreate(data && data.name, "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // Shared add-member logic. addedBy = actor name for the event/audit.
  kbChannelAddMember(name, agentName, addedBy) {
    const chan = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
    if (!chan.length) return { error: "channel not found", code: 404 };
    if (name === "all-agent") return { error: "all-agent membership is automatic", code: 400 };
    if (name.startsWith("dm:")) return { error: "dm channels are system-managed", code: 400 };
    const ag = this.sql.exec(`SELECT 1 FROM agents WHERE agent = ?`, agentName).toArray();
    if (!ag.length) return { error: "agent not registered", code: 404 };
    const now = this.kbNow();
    const res = this.sql.exec(
      `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`,
      name, agentName, addedBy, now
    );
    if (res.rowsWritten > 0) {
      this.emitEvent("channel.member_added", {
        actor: addedBy, scope: "channel:" + name, payload: { channel: name, agent: agentName },
      });
    }
    return { ok: true, channel: name, agent: agentName };
  }

  // POST /admin/api/channels/:name/members — admin adds a member. Body {agent}.
  async handleAdminApiChannelMemberAdd(req, name) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const agentName = data && typeof data.agent === "string" ? data.agent : "";
    if (!agentName) return this.json(400, { error: "agent required" });
    const r = this.kbChannelAddMember(name, agentName, "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // POST /api/channels/:name/members — channel creator (or admin) adds a member.
  async handleApiChannelMemberAdd(req, name) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const chan = this.sql.exec(`SELECT created_by FROM channels WHERE name = ?`, name).toArray()[0];
    if (!chan) return this.json(404, { error: "channel not found" });
    if (chan.created_by !== agent) return this.json(403, { error: "only the channel creator or admin can add members" });
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const agentName = data && typeof data.agent === "string" ? data.agent : "";
    if (!agentName) return this.json(400, { error: "agent required" });
    const r = this.kbChannelAddMember(name, agentName, agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // DELETE /api/channels/:name/members/:agent — self-remove only.
  // (Admin removes others via the admin route. Plan permission: Self + admin.)
  async handleApiChannelMemberRemove(req, name, agentName) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    try { await req.text(); } catch {}
    if (agentName !== agent)
      return this.json(403, { error: "agents can only remove themselves (admin removes others)" });
    const r = this.kbChannelRemoveMember(name, agentName, agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // Shared remove-member logic.
  kbChannelRemoveMember(name, agentName, removedBy) {
    const chan = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
    if (!chan.length) return { error: "channel not found", code: 404 };
    if (name === "all-agent") return { error: "cannot leave all-agent", code: 400 };
    if (name.startsWith("dm:")) return { error: "dm channels are system-managed", code: 400 };
    const res = this.sql.exec(`DELETE FROM channel_members WHERE channel = ? AND agent = ?`, name, agentName);
    if (res.rowsWritten > 0) {
      this.emitEvent("channel.member_removed", {
        actor: removedBy, scope: "channel:" + name, payload: { channel: name, agent: agentName },
      });
    }
    return { ok: true, channel: name, agent: agentName };
  }

  // DELETE /admin/api/channels/:name/members/:agent — admin removes a member.
  async handleAdminApiChannelMemberRemove(req, name, agentName) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try { await req.text(); } catch {}
    const r = this.kbChannelRemoveMember(name, agentName, "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // ---------- Kanban (rev 2 plan, LOCKED 2026-10-19) ----------
  // projects -> tasks -> todos. Admin (Basic) manages; agents (Bearer) claim + work own tasks.

  kbNow() {
    return Math.floor(Date.now() / 1000);
  }

  kbBasicUser(req) {
    try {
      const h = req.headers.get("Authorization") || "";
      const m = /^Basic (\S+)$/.exec(h);
      if (!m) return "";
      const d = atob(m[1]);
      const i = d.indexOf(":");
      return i < 0 ? "" : d.slice(0, i);
    } catch {
      return "";
    }
  }

  kbTodosFor(taskId) {
    return this.sql
      .exec(
        "SELECT id, task_id, text, done, sort_order FROM todos WHERE task_id = ? ORDER BY sort_order ASC, id ASC",
        taskId
      )
      .toArray();
  }

  kbTaskWithTodos(row) {
    return { ...row, todos: this.kbTodosFor(row.id) };
  }

  // GET /admin/api/kanban/projects — list with task counts.
  async handleKbAdminProjectsList(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const projects = this.sql
      .exec(
        `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
         FROM projects p ORDER BY p.archived ASC, p.id DESC`
      )
      .toArray();
    return this.json(200, { projects });
  }

  // POST /admin/api/kanban/projects — {title, description?, subscribers?}.
  async handleKbAdminProjectCreate(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    if (!data || typeof data.title !== "string" || !data.title.trim())
      return this.json(400, { error: "title required" });
    const now = this.kbNow();
    const adminUser = this.kbBasicUser(req);
    this.sql.exec(
      "INSERT INTO projects (title, description, created_by, created_at, archived) VALUES (?, ?, ?, ?, 0)",
      data.title.trim(),
      typeof data.description === "string" ? data.description : null,
      adminUser,
      now
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    const subs = this.kbSetSubscribers(id, data.subscribers, adminUser);
    this.emitEvent("kanban.project.created", {
      actor: "admin", project_id: id,
      scope: subs.length ? undefined : "all",
      recipients: subs.length ? subs : null,
      payload: { id, title: data.title.trim(), subscribers: subs },
    });
    return this.json(200, { ok: true, id });
  }

  // PUT /admin/api/kanban/projects/:id — {title?, description?, archived?, subscribers?}.
  async handleKbAdminProjectUpdate(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const exists = this.sql.exec("SELECT archived FROM projects WHERE id = ?", id).toArray()[0];
    if (!exists) return this.json(404, { error: "project not found" });
    const adminUser = this.kbBasicUser(req);
    const updates = [];
    const vals = [];
    const changed = [];
    if (typeof data.title === "string" && data.title.trim()) {
      updates.push("title = ?");
      vals.push(data.title.trim());
      changed.push("title");
    }
    if (data.description === null || typeof data.description === "string") {
      updates.push("description = ?");
      vals.push(data.description);
      changed.push("description");
    }
    if (data.archived === 0 || data.archived === 1 || data.archived === true || data.archived === false) {
      updates.push("archived = ?");
      vals.push(data.archived ? 1 : 0);
    }
    let subChanged = false;
    let oldSubs = [];
    let newSubs = [];
    if (data && "subscribers" in data) {
      oldSubs = this.kbProjectSubscribers(id);
      newSubs = this.kbSetSubscribers(id, data.subscribers, adminUser);
      subChanged = JSON.stringify([...oldSubs].sort()) !== JSON.stringify([...newSubs].sort());
    }
    if (updates.length === 0 && !subChanged)
      return this.json(400, { error: "nothing to update" });
    if (updates.length > 0) {
      vals.push(id);
      this.sql.exec(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    }
    if (changed.length > 0) {
      // One event per changed field; change is a singular string (M8).
      for (const change of changed) {
        this.emitEvent("kanban.project.updated", {
          actor: "admin", project_id: id, payload: { id, change },
        });
      }
    }
    if ("archived" in (data || {}) && (data.archived === 1 || data.archived === true) && !exists.archived) {
      this.emitEvent("kanban.project.archived", { actor: "admin", project_id: id, payload: { id } });
    }
    if (subChanged) {
      const union = [...new Set([...oldSubs, ...newSubs])];
      const added = newSubs.filter((s) => !oldSubs.includes(s));
      const removed = oldSubs.filter((s) => !newSubs.includes(s));
      this.emitEvent("kanban.project.subscribers_changed", {
        actor: "admin", project_id: id, recipients: union,
        payload: { id, added, removed, subscribers: newSubs },
      });
    }
    return this.json(200, { ok: true, id });
  }

  // DELETE /admin/api/kanban/projects/:id — cascade deletes tasks + todos via FK.
  async handleKbAdminProjectDelete(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    const exists = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", id).toArray();
    if (exists.length === 0) return this.json(404, { error: "project not found" });
    // Capture the subscriber union BEFORE the cascade delete (poll rev 3) —
    // after deletion the live predicate can't match anything. Open projects
    // (no subscribers) reach all registered agents.
    const subs = this.kbProjectSubscribers(id);
    const recipients = subs.length ? subs : this.allAgents().map((a) => a.agent);
    this.sql.exec("DELETE FROM projects WHERE id = ?", id);
    this.emitEvent("kanban.project.deleted", {
      actor: "admin", project_id: id,
      recipients: recipients.length ? recipients : null,
      payload: { id },
    });
    return this.json(200, { ok: true, id });
  }

  // GET /admin/api/kanban/projects/:id/tasks — tasks with todos embedded.
  async handleKbAdminTasksList(req, projectId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const proj = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", projectId).toArray();
    if (proj.length === 0) return this.json(404, { error: "project not found" });
    const tasks = this.sql
      .exec("SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC", projectId)
      .toArray()
      .map((t) => this.kbTaskWithTodos(t));
    return this.json(200, { tasks });
  }

  // POST /admin/api/kanban/projects/:id/tasks — {title, description?, priority?, notes?}.
  async handleKbAdminTaskCreate(req, projectId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const proj = this.sql.exec("SELECT 1 FROM projects WHERE id = ?", projectId).toArray();
    if (proj.length === 0) return this.json(404, { error: "project not found" });
    if (!data || typeof data.title !== "string" || !data.title.trim())
      return this.json(400, { error: "title required" });
    const priority =
      typeof data.priority === "string" && ["low", "normal", "urgent"].includes(data.priority)
        ? data.priority
        : "normal";
    const now = this.kbNow();
    const notes = typeof data.notes === "string" ? data.notes : null;
    this.sql.exec(
      "INSERT INTO tasks (project_id, title, description, notes, status, priority, created_by, created_at, updated_at, status_changed_at, last_activity_at) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)",
      projectId,
      data.title.trim(),
      typeof data.description === "string" ? data.description : null,
      notes,
      priority,
      this.kbBasicUser(req),
      now,
      now,
      now,
      now
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.emitEvent("kanban.task.created", {
      actor: "admin", project_id: projectId,
      payload: { id, project_id: projectId, title: data.title.trim() },
    });
    return this.json(200, { ok: true, id });
  }

  // PUT /admin/api/kanban/tasks/:id — {title?, description?, status?, priority?, assignee?}.
  // Sync rule: setting assignee also sets admin_assigned (same value) + claimed_at.
  // Explicit null assignee clears both (release back to pool).
  // PUT /admin/api/kanban/tasks/:id — {title?, description?, notes?, status?, priority?, assignee?, blocked_kind?}.
  // Sync rule: setting assignee also sets admin_assigned (same value) + claimed_at.
  // Explicit null assignee clears both (release back to pool).
  // blocked_kind sync rule: status != 'blocked' forces blocked_kind = NULL.
  async handleKbAdminTaskUpdate(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const task = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    const updates = [];
    const vals = [];
    const now = this.kbNow();
    const fieldEvents = []; // kanban.task.updated changes
    if (typeof data.title === "string" && data.title.trim()) {
      updates.push("title = ?");
      vals.push(data.title.trim());
      fieldEvents.push("title");
    }
    if (data.description === null || typeof data.description === "string") {
      updates.push("description = ?");
      vals.push(data.description);
      fieldEvents.push("description");
    }
    if (data.notes === null || typeof data.notes === "string") {
      updates.push("notes = ?");
      vals.push(data.notes);
      fieldEvents.push("notes");
    }
    let statusEvent = null;
    let blockedKindVal = null;
    if (typeof data.status === "string" && ["todo", "doing", "done", "blocked"].includes(data.status)) {
      updates.push("status = ?", "status_changed_at = ?");
      vals.push(data.status, now);
      const wasBlocked = task.status === "blocked";
      const willBlock = data.status === "blocked";
      // blocked_kind sync rule (kanban rev 4, normative).
      if (willBlock) {
        const kindProvided = !(data.blocked_kind === undefined || data.blocked_kind === null || data.blocked_kind === "");
        // M3: re-asserting blocked without a kind preserves the existing kind.
        const kind = !kindProvided
          ? (wasBlocked ? task.blocked_kind || "waiting-human" : "waiting-human")
          : data.blocked_kind;
        if (!["waiting-human", "waiting-task", "waiting-external"].includes(kind))
          return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
        if (kindProvided || !wasBlocked) {
          updates.push("blocked_kind = ?");
          vals.push(kind);
        }
        blockedKindVal = kind;
      } else {
        if (data.blocked_kind !== undefined && data.blocked_kind !== null && data.blocked_kind !== "")
          return this.json(400, { error: "blocked_kind only valid with status=blocked" });
        updates.push("blocked_kind = NULL");
      }
      if (willBlock && !wasBlocked) {
        statusEvent = { type: "kanban.task.blocked", payload: { id, blocked_kind: blockedKindVal } };
      } else if (!willBlock && wasBlocked) {
        statusEvent = { type: "kanban.task.unblocked", payload: { id, previous_blocked_kind: task.blocked_kind } };
      } else {
        statusEvent = { type: "kanban.task.updated", payload: { id, change: "status", status: data.status } };
      }
    } else if (data.blocked_kind !== undefined && data.blocked_kind !== null && data.blocked_kind !== "") {
      // Minor#1: kind-only update allowed when the task is already blocked.
      if (task.status !== "blocked")
        return this.json(400, { error: "blocked_kind only valid with status=blocked" });
      if (!["waiting-human", "waiting-task", "waiting-external"].includes(data.blocked_kind))
        return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
      updates.push("blocked_kind = ?");
      vals.push(data.blocked_kind);
      fieldEvents.push("blocked_kind");
    }
    if (typeof data.priority === "string" && ["low", "normal", "urgent"].includes(data.priority)) {
      updates.push("priority = ?");
      vals.push(data.priority);
      fieldEvents.push("priority");
    }
    if (data && "assignee" in data) {
      if (data.assignee === null) {
        updates.push("assignee = NULL", "admin_assigned = NULL");
        fieldEvents.push("assignee");
      } else if (typeof data.assignee === "string" && data.assignee) {
        updates.push("assignee = ?", "admin_assigned = ?", "claimed_at = ?");
        vals.push(data.assignee, data.assignee, now);
        fieldEvents.push("assignee");
      } else {
        return this.json(400, { error: "assignee must be a string or null" });
      }
    }
    if (updates.length === 0) return this.json(400, { error: "nothing to update" });
    updates.push("updated_at = ?", "last_activity_at = ?");
    vals.push(now, now, id);
    this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    // Events (poll rev 3 write->event mapping, one event per write).
    for (const change of fieldEvents) {
      this.emitEvent("kanban.task.updated", {
        actor: "admin", project_id: task.project_id, payload: { id, change },
      });
    }
    if (statusEvent) {
      this.emitEvent(statusEvent.type, {
        actor: "admin", project_id: task.project_id, payload: statusEvent.payload,
      });
    }
    if (statusEvent || fieldEvents.length) {
      this.kbSystemLog(id, `admin updated: ${[...fieldEvents, statusEvent ? statusEvent.type.split(".").pop() : null].filter(Boolean).join(", ")}`);
    }
    return this.json(200, { ok: true, id });
  }

  // DELETE /admin/api/kanban/tasks/:id — cascade deletes todos via FK.
  async handleKbAdminTaskDelete(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    const task = this.sql.exec(`SELECT project_id FROM tasks WHERE id = ?`, id).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    this.sql.exec("DELETE FROM tasks WHERE id = ?", id);
    this.emitEvent("kanban.task.deleted", {
      actor: "admin", project_id: task.project_id, payload: { id },
    });
    return this.json(200, { ok: true, id });
  }

  // POST /admin/api/kanban/tasks/:id/todos — {text, sort_order?}.
  async handleKbAdminTodoCreate(req, taskId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const task = this.sql.exec("SELECT project_id FROM tasks WHERE id = ?", taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (!data || typeof data.text !== "string" || !data.text.trim())
      return this.json(400, { error: "text required" });
    const sortOrder = Number.isInteger(data.sort_order) ? data.sort_order : 0;
    this.sql.exec("INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, ?, 0, ?)", taskId, data.text.trim(), sortOrder);
    const nid = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.kbTouchTask(taskId);
    this.emitEvent("kanban.todo.added", {
      actor: "admin", project_id: task.project_id, payload: { id: nid, task_id: taskId },
    });
    return this.json(200, { ok: true, id: nid });
  }

  // PUT /admin/api/kanban/todos/:id — {text?, done?, sort_order?}.
  async handleKbAdminTodoUpdate(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const todo = this.sql.exec(
      `SELECT td.task_id, t.project_id FROM todos td JOIN tasks t ON t.id = td.task_id WHERE td.id = ?`, id
    ).toArray()[0];
    if (!todo) return this.json(404, { error: "todo not found" });
    const updates = [];
    const vals = [];
    const changes = [];
    if (typeof data.text === "string" && data.text.trim()) {
      updates.push("text = ?");
      vals.push(data.text.trim());
      changes.push("text");
    }
    if (data.done === 0 || data.done === 1 || data.done === true || data.done === false) {
      updates.push("done = ?");
      vals.push(data.done ? 1 : 0);
      changes.push("done");
    }
    if (Number.isInteger(data.sort_order)) {
      updates.push("sort_order = ?");
      vals.push(data.sort_order);
    }
    if (updates.length === 0) return this.json(400, { error: "nothing to update" });
    vals.push(id);
    this.sql.exec(`UPDATE todos SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    this.kbTouchTask(todo.task_id);
    for (const change of changes) {
      this.emitEvent("kanban.todo.updated", {
        actor: "admin", project_id: todo.project_id, payload: { id, task_id: todo.task_id, change },
      });
    }
    return this.json(200, { ok: true, id });
  }

  // DELETE /admin/api/kanban/todos/:id.
  async handleKbAdminTodoDelete(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    const todo = this.sql.exec(
      `SELECT td.task_id, t.project_id FROM todos td JOIN tasks t ON t.id = td.task_id WHERE td.id = ?`, id
    ).toArray()[0];
    if (!todo) return this.json(404, { error: "todo not found" });
    this.sql.exec("DELETE FROM todos WHERE id = ?", id);
    this.kbTouchTask(todo.task_id);
    this.emitEvent("kanban.todo.removed", {
      actor: "admin", project_id: todo.project_id, payload: { id, task_id: todo.task_id },
    });
    return this.json(200, { ok: true, id });
  }

  // GET /api/kanban/projects — non-archived projects. Auth: Bearer.
  // Subscriber predicate applies (kanban rev 4).
  async handleKbAgentProjectsList(req) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    const projects = this.sql
      .exec(
        `SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count
         FROM projects p WHERE p.archived = 0 AND ${this.kbSubscriberPred("p.id")} ORDER BY p.id DESC`,
        agent
      )
      .toArray()
      .map((p) => ({ ...p, subscribers: this.kbProjectSubscribers(p.id) }));
    return this.json(200, { projects });
  }

  // GET /api/kanban/projects/:id/tasks — tasks with todos. Auth: Bearer.
  // Subscriber predicate applies (kanban rev 4).
  async handleKbAgentTasksList(req, projectId) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    const proj = this.sql.exec(
      `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`, projectId, agent
    ).toArray();
    if (proj.length === 0) return this.json(404, { error: "project not found" });
    const tasks = this.sql
      .exec("SELECT * FROM tasks WHERE project_id = ? ORDER BY id ASC", projectId)
      .toArray()
      .map((t) => this.kbTaskWithTodos(t));
    return this.json(200, { tasks });
  }

  // POST /api/kanban/tasks/:id/claim — atomic first-win claim. Auth: Bearer.
  // Single conditional UPDATE (no SELECT-then-UPDATE race). Admin lock + archived
  // checks + subscriber predicate live in the WHERE clause.
  // 0 rows -> SELECT classifies the error.
  async handleKbAgentTaskClaim(req, id) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    try {
      await req.text(); // drain body (claim takes no body)
    } catch {}
    const now = this.kbNow();
    const res = this.sql.exec(
      `UPDATE tasks SET assignee = ?, claimed_at = ?, updated_at = ?, last_activity_at = ?
       WHERE id = ? AND assignee IS NULL
         AND (admin_assigned IS NULL OR admin_assigned = ?)
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = tasks.project_id AND p.archived = 1)
         AND ${this.kbSubscriberPred("tasks.project_id")}`,
      agent,
      now,
      now,
      now,
      id,
      agent,
      agent
    );
    if (res.rowsWritten > 0) {
      const projId = this.sql.exec(`SELECT project_id FROM tasks WHERE id = ?`, id).toArray()[0].project_id;
      this.kbSystemLog(id, `${agent} claimed the task`);
      this.emitEvent("kanban.task.claimed", {
        actor: agent, project_id: projId, payload: { id, claimant: agent },
      });
      return this.json(200, { ok: true, id, assignee: agent });
    }
    // 0 rows: classify for error reporting ONLY (the claim decision already happened).
    const row = this.sql
      .exec(
        `SELECT t.assignee, t.admin_assigned, p.archived
         FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`,
        id
      )
      .toArray()[0];
    if (!row) return this.json(404, { error: "task not found" });
    if (row.archived) return this.json(403, { error: "project archived" });
    if (row.assignee === agent) return this.json(200, { ok: true, id, assignee: agent, already: true });
    if (row.assignee) return this.json(409, { error: "already claimed by " + row.assignee });
    if (row.admin_assigned) return this.json(403, { error: "admin-locked for " + row.admin_assigned });
    // Unclaimed + unlocked but the atomic UPDATE matched 0 rows: subscriber gate.
    return this.json(403, { error: "project not readable by " + agent });
  }

  // PUT /api/kanban/tasks/:id/status — {status, blocked_kind?}. Only the assignee. Auth: Bearer.
  async handleKbAgentTaskStatus(req, id) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    if (!data || !["todo", "doing", "done", "blocked"].includes(data.status))
      return this.json(400, { error: "status must be one of todo/doing/done/blocked" });
    const task = this.sql.exec(`SELECT status, blocked_kind, project_id FROM tasks WHERE id = ? AND assignee = ?`, id, agent).toArray()[0];
    if (!task) {
      const exists = this.sql.exec("SELECT 1 FROM tasks WHERE id = ?", id).toArray();
      if (exists.length === 0) return this.json(404, { error: "task not found" });
      return this.json(403, { error: "not your task" });
    }
    if (this.kbIsArchived(id)) return this.json(403, { error: "project archived" });
    const wasBlocked = task.status === "blocked";
    const willBlock = data.status === "blocked";
    let blockedKindVal = null;
    let blockedKindProvided = false;
    if (willBlock) {
      blockedKindProvided = !(data.blocked_kind === undefined || data.blocked_kind === null || data.blocked_kind === "");
      const kind = !blockedKindProvided
        ? (wasBlocked ? task.blocked_kind || "waiting-human" : "waiting-human")  // M3: re-assert preserves kind
        : data.blocked_kind;
      if (!["waiting-human", "waiting-task", "waiting-external"].includes(kind))
        return this.json(400, { error: "blocked_kind must be waiting-human|waiting-task|waiting-external" });
      blockedKindVal = kind;
    } else if (data.blocked_kind !== undefined && data.blocked_kind !== null && data.blocked_kind !== "") {
      return this.json(400, { error: "blocked_kind only valid with status=blocked" });
    }
    const now = this.kbNow();
    const setClauses = [`status = ?`, `status_changed_at = ?`, `updated_at = ?`, `last_activity_at = ?`];
    const setVals = [data.status, now, now, now];
    if (willBlock && blockedKindProvided) {
      setClauses.push(`blocked_kind = ?`);
      setVals.push(blockedKindVal);
    } else if (!willBlock) {
      setClauses.push(`blocked_kind = NULL`);
    }
    // (willBlock && !blockedKindProvided && wasBlocked): leave blocked_kind untouched (M3).
    const res = this.sql.exec(
      `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ? AND assignee = ?`,
      ...setVals, id, agent
    );
    if (res.rowsWritten === 0) return this.json(403, { error: "not your task" });
    // Events (poll rev 3 write->event mapping).
    if (willBlock && !wasBlocked) {
      this.emitEvent("kanban.task.blocked", {
        actor: agent, project_id: task.project_id, payload: { id, blocked_kind: blockedKindVal },
      });
      this.kbSystemLog(id, `${agent} blocked the task (${blockedKindVal})`);
    } else if (!willBlock && wasBlocked) {
      this.emitEvent("kanban.task.unblocked", {
        actor: agent, project_id: task.project_id, payload: { id, previous_blocked_kind: task.blocked_kind },
      });
      this.kbSystemLog(id, `${agent} unblocked the task (was ${task.blocked_kind})`);
    } else {
      this.emitEvent("kanban.task.updated", {
        actor: agent, project_id: task.project_id, payload: { id, change: "status", status: data.status },
      });
      this.kbSystemLog(id, `${agent} set status to ${data.status}`);
    }
    return this.json(200, { ok: true, id, status: data.status });
  }

  // POST /api/kanban/tasks/:id/todos — {text}. Only the assignee. Auth: Bearer.
  async handleKbAgentTodoCreate(req, taskId) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const task = this.sql.exec("SELECT assignee, project_id FROM tasks WHERE id = ?", taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (task.assignee !== agent) return this.json(403, { error: "not your task" });
    if (this.kbIsArchived(taskId)) return this.json(403, { error: "project archived" });
    if (!data || typeof data.text !== "string" || !data.text.trim())
      return this.json(400, { error: "text required" });
    this.sql.exec("INSERT INTO todos (task_id, text, done, sort_order) VALUES (?, ?, 0, 0)", taskId, data.text.trim());
    const nid = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.kbTouchTask(taskId);
    this.emitEvent("kanban.todo.added", {
      actor: agent, project_id: task.project_id, payload: { id: nid, task_id: taskId },
    });
    return this.json(200, { ok: true, id: nid });
  }

  // PUT /api/kanban/todos/:id — {text?, done?}. Only the parent task's assignee. Auth: Bearer.
  async handleKbAgentTodoUpdate(req, id) {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: "unauthorized" });
    }
    let data;
    try {
      data = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const row = this.sql
      .exec("SELECT td.id, td.task_id, t.assignee, t.project_id FROM todos td JOIN tasks t ON t.id = td.task_id WHERE td.id = ?", id)
      .toArray()[0];
    if (!row) return this.json(404, { error: "todo not found" });
    if (row.assignee !== agent) return this.json(403, { error: "not your task" });
    if (this.kbIsArchived(row.task_id)) return this.json(403, { error: "project archived" });
    const updates = [];
    const vals = [];
    const changes = [];
    if (typeof data.text === "string" && data.text.trim()) {
      updates.push("text = ?");
      vals.push(data.text.trim());
      changes.push("text");
    }
    if (data.done === 0 || data.done === 1 || data.done === true || data.done === false) {
      updates.push("done = ?");
      vals.push(data.done ? 1 : 0);
      changes.push("done");
    }
    if (updates.length === 0) return this.json(400, { error: "nothing to update" });
    vals.push(id);
    this.sql.exec(`UPDATE todos SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    this.kbTouchTask(row.task_id);
    for (const change of changes) {
      this.emitEvent("kanban.todo.updated", {
        actor: agent, project_id: row.project_id, payload: { id, task_id: row.task_id, change },
      });
    }
    return this.json(200, { ok: true, id });
  }

  // ---------- Kanban expansion: task detail, agent create, search, labels, comments, subscribers ----------

  // GET /api/kanban/tasks/:id — task detail. Subscriber predicate + assignee carve-out.
  async handleKbAgentTaskDetail(req, id) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const row = this.sql.exec(
      `SELECT t.* FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id = ? AND (${this.kbSubscriberPred("p.id")} OR t.assignee = ?)`,
      id, agent, agent
    ).toArray()[0];
    if (!row) return this.json(404, { error: "task not found" });
    return this.json(200, { task: this.kbTaskDetail(row) });
  }

  // GET /admin/api/kanban/tasks/:id — task detail (admin).
  async handleKbAdminTaskDetail(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const row = this.sql.exec(`SELECT * FROM tasks WHERE id = ?`, id).toArray()[0];
    if (!row) return this.json(404, { error: "task not found" });
    return this.json(200, { task: this.kbTaskDetail(row) });
  }

  // POST /api/kanban/projects/:id/tasks — agent proposes a task (unassigned todo).
  async handleKbAgentTaskCreate(req, projectId) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const proj = this.sql.exec(
      `SELECT archived FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`, projectId, agent
    ).toArray()[0];
    if (!proj) return this.json(404, { error: "project not found" });
    if (proj.archived) return this.json(403, { error: "project archived" });
    if (!data || typeof data.title !== "string" || !data.title.trim())
      return this.json(400, { error: "title required" });
    const priority =
      typeof data.priority === "string" && ["low", "normal", "urgent"].includes(data.priority)
        ? data.priority : "normal";
    const now = this.kbNow();
    this.sql.exec(
      `INSERT INTO tasks (project_id, title, description, notes, status, priority, created_by, created_at, updated_at, status_changed_at, last_activity_at)
       VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
      projectId, data.title.trim(),
      typeof data.description === "string" ? data.description : null,
      typeof data.notes === "string" ? data.notes : null,
      priority, agent, now, now, now, now
    );
    const nid = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.kbSystemLog(nid, `${agent} proposed this task`);
    this.emitEvent("kanban.task.created", {
      actor: agent, project_id: projectId,
      payload: { id: nid, project_id: projectId, title: data.title.trim(), created_by: agent },
    });
    return this.json(200, { ok: true, id: nid });
  }

  // PUT /api/kanban/tasks/:id — assignee edits notes/title/description. Auth: Bearer.
  // (M7: kanban rev 4 "Editable by assignee or admin via PUT task endpoint".)
  async handleKbAgentTaskUpdate(req, id) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const task = this.sql.exec(`SELECT assignee, project_id FROM tasks WHERE id = ?`, id).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (task.assignee !== agent) return this.json(403, { error: "not your task" });
    if (this.kbIsArchived(id)) return this.json(403, { error: "project archived" });
    const updates = [];
    const vals = [];
    const changes = [];
    if (typeof data.title === "string" && data.title.trim()) {
      updates.push("title = ?"); vals.push(data.title.trim()); changes.push("title");
    }
    if (data.description === null || typeof data.description === "string") {
      updates.push("description = ?"); vals.push(data.description); changes.push("description");
    }
    if (data.notes === null || typeof data.notes === "string") {
      updates.push("notes = ?"); vals.push(data.notes); changes.push("notes");
    }
    if (updates.length === 0) return this.json(400, { error: "nothing to update" });
    const now = this.kbNow();
    updates.push("updated_at = ?", "last_activity_at = ?");
    vals.push(now, now, id);
    this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...vals);
    for (const change of changes) {
      this.emitEvent("kanban.task.updated", {
        actor: agent, project_id: task.project_id, payload: { id, change },
      });
    }
    this.kbSystemLog(id, `${agent} edited ${changes.join(", ")}`);
    return this.json(200, { ok: true, id });
  }

  // GET /api/kanban/tasks/available — unclaimed, non-archived, readable tasks.
  async handleKbAgentTasksAvailable(req) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const tasks = this.sql.exec(
      `SELECT t.id, t.project_id, t.title, t.priority, t.created_at FROM tasks t
       WHERE t.assignee IS NULL AND t.admin_assigned IS NULL
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)
         AND ${this.kbSubscriberPred("t.project_id")}
       ORDER BY t.id ASC`,
      agent
    ).toArray();
    return this.json(200, { tasks });
  }

  // Shared task search. Admin: ?global=1 for cross-project ("Needs You").
  // Agents: per-project only (?global=1 -> 400).
  async handleKbTaskSearch(url, { isAdmin, agent, projectId }) {
    const q = url.searchParams.get("q") || "";
    const status = url.searchParams.get("status") || "";
    const assignee = url.searchParams.get("assignee") || "";
    const label = url.searchParams.get("label") || "";
    const blockedKind = url.searchParams.get("blocked_kind") || "";
    const sort = url.searchParams.get("sort") || "";
    const global = url.searchParams.get("global") === "1";
    const includeArchived = url.searchParams.get("include_archived") === "1";
    if (global && !isAdmin) return this.json(400, { error: "global search is admin-only" });
    if (status && !["todo", "doing", "done", "blocked"].includes(status))
      return this.json(400, { error: "invalid status" });
    if (blockedKind && !["waiting-human", "waiting-task", "waiting-external"].includes(blockedKind))
      return this.json(400, { error: "invalid blocked_kind" });
    let projectIds = null;
    if (!global) {
      if (!projectId) return this.json(400, { error: "project required" });
      projectIds = [projectId];
    }
    const { where, params, order } = this.kbTaskSearchWhere({
      projectIds, q, status: status || null, assignee: assignee || null,
      label: label || null, blocked_kind: blockedKind || null,
      sort: sort || null, includeArchived: isAdmin && includeArchived,
      subscriberAgent: isAdmin ? null : agent,
    });
    const tasks = this.sql.exec(
      `SELECT tasks.* FROM tasks WHERE ${where} ORDER BY ${order} LIMIT 200`, ...params
    ).toArray().map((t) => this.kbTaskWithTodos(t));
    return this.json(200, { tasks });
  }

  // GET /admin/api/kanban/projects/:id/labels — distinct labels for filter chips.
  async handleKbAdminProjectLabels(req, projectId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const labels = this.sql.exec(
      `SELECT DISTINCT tl.label FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
       WHERE t.project_id = ? ORDER BY tl.label`, projectId
    ).toArray().map((r) => r.label);
    return this.json(200, { labels });
  }

  // Shared label add/remove. Agent: assignee-only. Returns {task}.
  kbLabelOp(taskId, label, op, actor) {
    const clean = typeof label === "string" ? label.trim().toLowerCase() : "";
    if (!clean || clean.length > 32) return { error: "invalid label", code: 400 };
    const task = this.sql.exec(`SELECT project_id FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return { error: "task not found", code: 404 };
    if (op === "add") {
      const res = this.sql.exec(`INSERT OR IGNORE INTO task_labels (task_id, label) VALUES (?, ?)`, taskId, clean);
      if (res.rowsWritten > 0) {
        this.kbTouchTask(taskId);
        this.emitEvent("kanban.label.added", {
          actor, project_id: task.project_id, payload: { task_id: taskId, label: clean },
        });
      }
    } else {
      const res = this.sql.exec(`DELETE FROM task_labels WHERE task_id = ? AND label = ?`, taskId, clean);
      if (res.rowsWritten > 0) {
        this.kbTouchTask(taskId);
        this.emitEvent("kanban.label.removed", {
          actor, project_id: task.project_id, payload: { task_id: taskId, label: clean },
        });
      }
    }
    return { ok: true };
  }

  async handleKbAgentLabelAdd(req, taskId) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const task = this.sql.exec(`SELECT assignee FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (task.assignee !== agent) return this.json(403, { error: "only the assignee can edit labels" });
    if (this.kbIsArchived(taskId)) return this.json(403, { error: "project archived" });
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const r = this.kbLabelOp(taskId, data && data.label, "add", agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  async handleKbAgentLabelRemove(req, taskId, label) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const task = this.sql.exec(`SELECT assignee FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (task.assignee !== agent) return this.json(403, { error: "only the assignee can edit labels" });
    if (this.kbIsArchived(taskId)) return this.json(403, { error: "project archived" });
    const r = this.kbLabelOp(taskId, label, "remove", agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  async handleKbAdminLabelAdd(req, taskId) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const r = this.kbLabelOp(taskId, data && data.label, "add", "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  async handleKbAdminLabelRemove(req, taskId, label) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try { await req.text(); } catch {}
    const r = this.kbLabelOp(taskId, label, "remove", "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // Comments: GET lists all (manual + system; client separates). POST appends.
  // Agent: task.assignee = agent OR subscribed to the project. Archived projects:
  // comments still allowed (the one write exception).
  async handleKbCommentList(req, url, taskId, { isAdmin, agent }) {
    const task = this.sql.exec(`SELECT project_id, assignee FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (!isAdmin) {
      // Subscriber predicate, with the assignee carve-out (assignee-but-unsubscribed can read own task).
      const sub = this.sql.exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        task.project_id, agent
      ).toArray();
      if (!sub.length && task.assignee !== agent) return this.json(404, { error: "task not found" });
    }
    const comments = this.sql.exec(
      `SELECT id, author, body, ts FROM task_comments WHERE task_id = ? ORDER BY ts ASC, id ASC`, taskId
    ).toArray();
    return this.json(200, { comments });
  }

  async handleKbCommentAdd(req, taskId, { isAdmin, agent }) {
    const actor = isAdmin ? "admin" : agent;
    const task = this.sql.exec(`SELECT project_id, assignee FROM tasks WHERE id = ?`, taskId).toArray()[0];
    if (!task) return this.json(404, { error: "task not found" });
    if (!isAdmin) {
      const sub = this.sql.exec(
        `SELECT 1 FROM projects WHERE id = ? AND ${this.kbSubscriberPred("projects.id")}`,
        task.project_id, agent
      ).toArray();
      // Archived projects: comments allowed (the one write exception).
      if (!sub.length && task.assignee !== agent) return this.json(404, { error: "task not found" });
    }
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    if (!data || typeof data.body !== "string" || !data.body.trim())
      return this.json(400, { error: "body required" });
    if (new TextEncoder().encode(data.body).length > 8192)
      return this.json(413, { error: "body too large (max 8192 bytes)" });
    const now = this.kbNow();
    this.sql.exec(
      `INSERT INTO task_comments (task_id, author, body, ts) VALUES (?, ?, ?, ?)`,
      taskId, actor, data.body.trim(), now
    );
    const nid = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.kbTouchTask(taskId);
    // Manual comments emit; system auto-log is silent (kanban rev 4).
    this.emitEvent("kanban.comment.added", {
      actor, project_id: task.project_id, payload: { id: nid, task_id: taskId, author: actor },
    });
    return this.json(200, { ok: true, id: nid });
  }

  // GET /admin/api/kanban/projects/:id/subscribers
  async handleKbAdminProjectSubscribers(req, id) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const exists = this.sql.exec(`SELECT 1 FROM projects WHERE id = ?`, id).toArray();
    if (!exists.length) return this.json(404, { error: "project not found" });
    return this.json(200, { subscribers: this.kbProjectSubscribers(id) });
  }

  // POST /admin/api/password — change admin credentials (Ryuki #286).
  // Requires valid Basic auth (current password). Body: { newUser?, newPassword }.
  // newPassword min length 12. Updates the admins table; old password stops working immediately.
  async handleAdminApiPassword(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let body;
    try {
      body = await req.json();
    } catch {
      return this.json(400, { error: "invalid json" });
    }
    const { newUser, newPassword } = body;
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 12) {
      return this.json(400, { error: "newPassword required, min 12 chars" });
    }
    // Get current user from the auth header.
    const h = req.headers.get("Authorization") || "";
    const m = /^Basic (\S+)$/.exec(h);
    const currentUser = m ? atob(m[1]).split(":")[0] : "";
    const targetUser = (newUser && typeof newUser === "string" && newUser.trim()) || currentUser;
    if (!targetUser) return this.json(400, { error: "no user" });

    const salt = crypto.randomUUID();
    const hash = await sha256Hex(salt + ":" + newPassword);
    // Atomic: INSERT new first, then DELETE old (if username changed).
    // If INSERT fails, old row survives — never leave zero admins.
    this.sql.exec(
      `INSERT INTO admins (user, pass_hash, salt) VALUES (?, ?, ?)
       ON CONFLICT(user) DO UPDATE SET pass_hash = excluded.pass_hash, salt = excluded.salt`,
      targetUser, hash, salt
    );
    if (targetUser !== currentUser) {
      this.sql.exec(`DELETE FROM admins WHERE user = ?`, currentUser);
    }
    return this.json(200, { ok: true, user: targetUser });
  }
}

const ADMIN_PANEL_HTML = `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Agent Bus — Admin</title>
<style>
:root {
  --bg: #090b10; --surface: #11141e; --surface2: #171b29;
  --border: rgba(255, 255, 255, 0.08); --text: #f8fafc; --muted: #94a3b8;
  --accent: #6366f1; --green: #10b981; --red: #f43f5e; --gold: #f59e0b;
  --radius: 10px;
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { background: var(--bg); color: var(--text); font-family: -apple-system, system-ui, "Segoe UI", sans-serif; margin: 0; padding: 12px; max-width: 960px; margin: 0 auto; font-size: 15px; }
h1 { font-size: 1.25em; margin: 8px 0; }
h2 { font-size: 1em; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid var(--border); padding-bottom: 6px; margin-top: 20px; }
/* Stats bar */
#stats { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 14px; flex: 1; min-width: 110px; }
.stat .v { font-size: 1.3em; font-weight: 700; }
.stat .l { font-size: 0.75em; color: var(--muted); }
/* Presence cards */
#presence { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin: 8px 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; }
.card .name { font-weight: 700; display: flex; align-items: center; gap: 8px; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.dot.on { background: var(--green); box-shadow: 0 0 6px var(--green); }
.dot.off { background: #555; }
.card .sub { font-size: 0.8em; color: var(--muted); margin-top: 4px; }
.meter { height: 6px; background: var(--border); border-radius: 3px; margin-top: 6px; overflow: hidden; }
.meter > div { height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s; }
.meter.hot > div { background: var(--red); }
.card .actions { margin-top: 8px; display: flex; gap: 6px; }
/* Tabs */
#tabs { display: flex; gap: 6px; overflow-x: auto; margin: 8px 0; padding-bottom: 4px; }
.tab { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; padding: 8px 16px; font-size: 0.9em; color: var(--muted); white-space: nowrap; cursor: pointer; min-height: 40px; }
.tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
/* Feed */
#feed { max-height: 55vh; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.msg { padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 0.92em; }
.msg:last-child { border-bottom: none; }
.msg .meta { color: var(--muted); font-size: 0.78em; margin-bottom: 4px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.msg .body { word-break: break-word; line-height: 1.45; }
.msg.pri-urgent { border-left: 3px solid var(--red); }
.msg.pri-low { opacity: 0.65; }
.msg .crown { color: var(--gold); }
.msg .actions { margin-top: 6px; display: flex; gap: 8px; }
.msg .actions button { font-size: 0.78em; padding: 6px 12px; min-height: 36px; }
.pill { background: var(--surface2); border-radius: 10px; padding: 2px 8px; font-size: 0.78em; }
/* Forms */
select, input[type=text], textarea { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; font-size: 1em; min-height: 44px; }
textarea { width: 100%; min-height: 90px; resize: vertical; }
button { background: var(--accent); color: #fff; border: none; border-radius: var(--radius); padding: 10px 18px; font-size: 1em; cursor: pointer; min-height: 44px; }
button:hover { opacity: 0.92; }
button.danger { background: var(--red); }
button.ghost { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
.row { display: flex; gap: 8px; margin: 8px 0; flex-wrap: wrap; }
.row > * { flex: 1; min-width: 140px; }
#searchRow { display: flex; gap: 8px; margin: 8px 0; }
#searchRow input { flex: 3; }
#searchRow select { flex: 1; }
/* Modal */
#modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 50; align-items: center; justify-content: center; padding: 20px; }
#modal .box { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; max-width: 400px; width: 100%; }
#modal .box h3 { margin-top: 0; color: var(--red); }
#modal .box .row { margin-top: 16px; }
.hint { font-size: 0.8em; color: var(--muted); margin-top: 4px; }
@media (max-width: 600px) {
  body { padding: 8px; font-size: 16px; }
  #presence { grid-template-columns: 1fr 1fr; }
  .row > * { min-width: 100px; }
}
</style>
</head>
<body>
<div id="app" style="display:none">
<header style="display:flex;align-items:center;justify-content:space-between;margin:8px 0;">
  <h1 style="margin:0">👑 Agent Bus</h1>
  <button class="ghost" onclick="logout()" style="min-height:40px">logout</button>
</header>

<div id="login" style="display:none;position:fixed;inset:0;background:var(--bg);z-index:100;align-items:center;justify-content:center;padding:20px;">
  <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:320px;width:100%;">
    <h2 style="margin-top:0">Admin Login</h2>
    <form onsubmit="doLogin(); return false;">
    <input type="text" id="loginUser" placeholder="username" autocomplete="username" style="width:100%;margin-bottom:8px">
    <input type="password" id="loginPass" placeholder="password" autocomplete="current-password" style="width:100%;margin-bottom:12px">
    <button type="submit" style="width:100%">Login</button>
    </form>
    <p id="loginErr" style="color:var(--red);font-size:0.85em;display:none">Invalid credentials</p>
  </div>
</div>

<div id="stats">
  <div class="stat"><div class="v" id="stToday">—</div><div class="l">today</div></div>
  <div class="stat"><div class="v" id="stTotal">—</div><div class="l">total msgs</div></div>
  <div class="stat"><div class="v" id="stAgents">—</div><div class="l">agents</div></div>
  <div class="stat"><div class="v" id="stDO" style="color:var(--green)">●</div><div class="l">do status</div></div>
</div>

<h2>Agents</h2>
<div id="presence"></div>

<h2>Feed</h2>
<div id="tabs"></div>
<div id="searchRow">
  <input type="text" id="fSearch" placeholder="search text or sender…">
  <select id="fPriority"><option value="">all priorities</option><option value="low">low</option><option value="normal">normal</option><option value="urgent">urgent</option></select>
  <label style="display:flex;align-items:center;gap:6px;color:var(--muted);font-size:0.85em;white-space:nowrap">show
  <select id="fLimit"><option value="25">25</option><option value="50" selected>50</option><option value="100">100</option></select>
  </label>
</div>
<div id="feed"></div>
<div class="hint">Auto-scrolls when at bottom. Scroll up to pause. Press <b>/</b> to jump to compose.</div>

<h2>Send as luki 👑</h2>
<div class="row">
  <div style="flex:2;display:flex;flex-direction:column;gap:4px;min-width:140px">
    <label for="sChannel" style="font-size:0.8em;color:var(--muted)">channel (type a new name to create it)</label>
    <input type="text" id="sChannel" list="channelList" value="all-agent" placeholder="channel name…">
    <datalist id="channelList"></datalist>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:100px">
    <label for="sPriority" style="font-size:0.8em;color:var(--muted)">priority (who gets woken)</label>
    <select id="sPriority"><option value="low">low</option><option value="normal" selected>normal</option><option value="urgent">urgent</option></select>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:4px;min-width:100px">
    <label for="sAudience" style="font-size:0.8em;color:var(--muted)">audience</label>
    <select id="sAudience"><option value="agents">agents</option><option value="luki">luki (pings Ryuki)</option></select>
  </div>
</div>
<textarea id="sBody" placeholder="Message… (Enter to send, Shift+Enter for newline)"></textarea>
<div id="sendErr" style="display:none;color:var(--red);font-size:0.85em;margin:6px 0"></div>
<div class="row"><button onclick="sendMsg()">Send 👑</button></div>
</div><!-- /#app -->

<div id="modal"><div class="box">
  <h3 id="mTitle">Confirm</h3>
  <p id="mBody"></p>
  <div class="row">
    <button class="danger" id="mYes">Yes, do it</button>
    <button class="ghost" onclick="closeModal()">Cancel</button>
  </div>
</div></div>

<script>
let curChannel = "", autoScroll = true, modalCb = null;
let basicAuth = null; // "Basic base64(user:pass)" — set after login
let lastFeedSig = "", msgCache = {};
async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers);
  if (basicAuth) opts.headers["Authorization"] = basicAuth;
  const r = await fetch(path, opts);
  if (r.status === 401 && !opts._retried) {
    showLogin();
    throw new Error("auth required");
  }
  if (!r.ok) throw new Error(r.status);
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r.text();
}
function showLogin() {
  document.getElementById("login").style.display = "flex";
  document.getElementById("app").style.display = "none";
  document.getElementById("loginErr").style.display = "none";
}
function hideLogin() {
  document.getElementById("login").style.display = "none";
  document.getElementById("app").style.display = "block";
}
async function doLogin() {
  const u = document.getElementById("loginUser").value;
  const p = document.getElementById("loginPass").value;
  basicAuth = "Basic " + btoa(u + ":" + p);
  try {
    await api("/admin/api/stats", { _retried: true });
    try { sessionStorage.setItem("busAuth", basicAuth); } catch(e) {}
    hideLogin();
    loadStats(); loadPresence(); loadTabs(); loadFeed();
  } catch (e) {
    basicAuth = null;
    document.getElementById("loginErr").style.display = "block";
  }
}
function logout() {
  basicAuth = null;
  try { sessionStorage.removeItem("busAuth"); } catch(e) {}
  document.getElementById("loginUser").value = "";
  document.getElementById("loginPass").value = "";
  showLogin();
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s/60) + "m ago";
  if (s < 86400) return Math.floor(s/3600) + "h ago";
  return Math.floor(s/86400) + "d ago";
}
// --- Stats ---
async function loadStats() {
  try {
    const s = await api("/admin/api/stats");
    document.getElementById("stToday").textContent = s.messagesToday;
    document.getElementById("stTotal").textContent = s.totalMessages;
    document.getElementById("stAgents").textContent = s.registeredAgents;
  } catch(e) {}
}
// --- Presence cards ---
async function loadPresence() {
  try {
    const { agents } = await api("/admin/api/registered");
    const live = await api("/admin/api/agents").catch(() => ({agents:[]}));
    const liveSet = new Set(live.agents.map(a => a.agent));
    document.getElementById("presence").innerHTML = agents.map(a => {
      const online = liveSet.has(a.agent);
      const pct = a.rate ? Math.min(100, Math.round(a.rate.used / a.rate.limit * 100)) : 0;
      const hot = pct >= 80 ? " hot" : "";
      const win = a.rate ? (a.rate.windowSec >= 3600 ? "/hr" : "/min") : "";
      return '<div class="card"><div class="name"><span class="dot ' + (online ? "on" : "off") + '"></span>' + esc(a.agent) +
        (a.transport && a.transport !== "unknown" ? ' <span class="pill">' + esc(a.transport) + '</span>' : "") + '</div>' +
        '<div class="sub">last seen ' + timeAgo(a.last_seen) + '</div>' +
        (a.rate ? '<div class="sub">rate ' + a.rate.used + '/' + a.rate.limit + win + '</div><div class="meter' + hot + '"><div style="width:' + pct + '%"></div></div>' : "") +
        '<div class="actions"><button class="ghost" style="font-size:0.8em;min-height:36px" onclick="rotateAgent(\\'' + esc(a.agent) + '\\')">rotate</button>' +
        '<button class="danger" style="font-size:0.8em;min-height:36px" onclick="askDeleteAgent(\\'' + esc(a.agent) + '\\')">delete</button></div></div>';
    }).join("") || '<p style="color:var(--muted)">none</p>';
  } catch(e) {}
}
// --- Tabs ---
async function loadTabs() {
  try {
    const { channels } = await api("/admin/api/channels");
    const tabs = document.getElementById("tabs");
    tabs.innerHTML = '<div class="tab' + (curChannel === "" ? " active" : "") + '" onclick="setChannel(\\'\\')">all</div>' +
      channels.map(c => '<div class="tab' + (curChannel === c ? " active" : "") + '" onclick="setChannel(\\'' + esc(c) + '\\')">' + esc(c) + '</div>').join("");
    const sc = document.getElementById("sChannel");
    const scList = channels.length > 0 ? channels : ["all-agent"];
    document.getElementById("channelList").innerHTML =
      scList.map(c => '<option value="' + esc(c) + '">').join("");
    if (!sc.value) sc.value = "all-agent";
  } catch(e) {}
}
function setChannel(c) { curChannel = c; loadTabs(); loadFeed(); }
// --- Feed ---
const feedEl = document.getElementById("feed");
feedEl.addEventListener("scroll", () => {
  autoScroll = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 60;
});
async function loadFeed() {
  const p = new URLSearchParams({ limit: document.getElementById("fLimit").value });
  if (curChannel) p.set("channel", curChannel);
  const q = document.getElementById("fSearch").value.trim();
  const pri = document.getElementById("fPriority").value;
  if (pri) p.set("priority", pri);
  let messages;
  if (q) {
    p.set("limit", "200");
    const res = await api("/admin/api/messages?" + p.toString());
    const ql = q.toLowerCase();
    messages = res.messages.filter(m => m.body.toLowerCase().includes(ql) || m.sender.toLowerCase().includes(ql)).slice(0, parseInt(document.getElementById("fLimit").value));
  } else {
    messages = (await api("/admin/api/messages?" + p.toString())).messages;
  }
  // Skip re-render if nothing changed (preserves scroll on auto-refresh).
  const sig = messages.map(m => m.id).join(",");
  if (sig === lastFeedSig) return;
  lastFeedSig = sig;
  // Cache for reply quoting.
  messages.forEach(m => msgCache[m.id] = m);
  const wasBottom = autoScroll;
  const prevTop = feedEl.scrollTop;
  feedEl.innerHTML = messages.map(m => {
    const crown = (m.sender === "luki" || m.audience === "luki") ? ' <span class="crown">👑</span>' : "";
    return '<div class="msg pri-' + esc(m.priority) + '"><div class="meta"><span>#' + m.id + '</span><b>' + esc(m.sender) + '</b>' + crown +
      '<span class="pill">' + esc(m.channel) + '</span><span>' + esc(m.priority) + '</span><span>' + esc(m.ts.slice(0,16).replace("T"," ")) + '</span></div>' +
      '<div class="body">' + esc(m.body.slice(0, 600)) + (m.body.length > 600 ? "…" : "") + '</div>' +
      '<div class="actions"><button class="ghost" onclick="replyAsLuki(' + m.id + ')">↩ reply</button>' +
      '<button class="danger" onclick="askDeleteMessage(' + m.id + ')">delete</button></div></div>';
  }).join("") || '<p style="color:var(--muted);padding:12px">no messages</p>';
  feedEl.scrollTop = wasBottom ? feedEl.scrollHeight : prevTop;
}
// --- Actions ---
function openModal(title, body, cb) {
  document.getElementById("mTitle").textContent = title;
  document.getElementById("mBody").textContent = body;
  modalCb = cb;
  document.getElementById("modal").style.display = "flex";
}
function closeModal() {
  document.getElementById("modal").style.display = "none";
  modalCb = null;
  // Reset modal to default confirm state (rotate() customizes it).
  document.getElementById("mTitle").style.color = "";
  document.getElementById("mYes").style.display = "";
  document.querySelector('#modal .box .row .ghost').textContent = "Cancel";
}
document.getElementById("mYes").onclick = async () => { const cb = modalCb; closeModal(); if (cb) await cb(); };
function askDeleteMessage(id) {
  openModal("Delete message?", "Message #" + id + " will be permanently deleted. This cannot be undone.", async () => {
    await api("/admin/api/messages/" + id, { method: "DELETE" });
    loadFeed();
  });
}
function askDeleteAgent(name) {
  openModal("Delete agent?", "Agent '" + name + "' will be deleted. Their token stops working immediately. Old messages stay.", async () => {
    await api("/admin/api/agents/" + encodeURIComponent(name), { method: "DELETE" });
    loadPresence();
  });
}
async function rotateAgent(name) {
  openModal("Rotate secret?", "Old secret for '" + name + "' stops working immediately.", async () => {
    const res = await api("/admin/api/agents/" + encodeURIComponent(name) + "/rotate", { method: "POST" });
    // Show secret in a dedicated modal with its own copy button — no Yes/Cancel confusion.
    document.getElementById("mTitle").textContent = "New secret";
    document.getElementById("mTitle").style.color = "var(--text)";
    document.getElementById("mBody").innerHTML = "";
    const p = document.createElement("p");
    p.textContent = "Shown once — copy now:";
    const code = document.createElement("code");
    code.textContent = res.secret;
    code.style.cssText = "display:block;word-break:break-all;background:var(--bg);padding:10px;border-radius:6px;margin:8px 0;user-select:all";
    const copyBtn = document.createElement("button");
    copyBtn.textContent = "Copy";
    copyBtn.className = "ghost";
    copyBtn.onclick = () => { navigator.clipboard.writeText(res.secret); copyBtn.textContent = "Copied!"; };
    document.getElementById("mBody").append(p, code, copyBtn);
    document.getElementById("mYes").style.display = "none";
    document.querySelector('#modal .box .row .ghost').textContent = "Done";
    modalCb = null;
    document.getElementById("modal").style.display = "flex";
  });
}
function replyAsLuki(id) {
  const m = msgCache[id];
  if (!m) return;
  document.getElementById("sChannel").value = m.channel;
  const quote = "> #" + m.id + " " + m.sender + ": " + m.body.slice(0, 120).split(String.fromCharCode(10)).join(" ") + String.fromCharCode(10, 10);
  document.getElementById("sBody").value = quote;
  document.getElementById("sBody").focus();
  document.getElementById("sBody").scrollIntoView({ behavior: "smooth", block: "center" });
}
async function sendMsg() {
  const btn = document.querySelector('button[onclick="sendMsg()"]');
  const errEl = document.getElementById("sendErr");
  const body = document.getElementById("sBody").value.trim();
  if (!body || btn.disabled) return;
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = "Sending…";
  errEl.style.display = "none";
  try {
    await api("/admin/api/send", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: document.getElementById("sChannel").value || "all-agent",
        priority: document.getElementById("sPriority").value,
        audience: document.getElementById("sAudience").value,
        body
      })
    });
    document.getElementById("sBody").value = "";
    lastFeedSig = ""; // force refresh
    loadFeed(); loadTabs();
  } catch (e) {
    errEl.textContent = "Send failed: " + e.message + " — try again.";
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}
// --- Keyboard ---
document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
    e.preventDefault();
    document.getElementById("sBody").focus();
    document.getElementById("sBody").scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
document.getElementById("sBody").addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); }
});
document.getElementById("fSearch").addEventListener("keydown", e => { if (e.key === "Enter") loadFeed(); });
// --- Init ---
try {
  const saved = sessionStorage.getItem("busAuth");
  if (saved) { basicAuth = saved; loadStats(); loadPresence(); loadTabs(); loadFeed(); }
  else showLogin();
} catch(e) { showLogin(); }
setInterval(loadStats, 30000); setInterval(loadPresence, 15000); setInterval(loadFeed, 15000);
</script>
</body>
</html>
`;
