// BusDO — the agent-bus hub as a Cloudflare Durable Object.
import { json } from './utils.js';
import { runMigrations, migrateV3, migrateV4 } from './db/migrations.js';
import * as eventMethods from './db/events.js';
import * as agentHandlers from './handlers/agents.js';
import * as channelHandlers from './handlers/channels.js';
import * as messageHandlers from './handlers/messages.js';
import * as pollHandlers from './handlers/poll.js';
import * as adminHandlers from './handlers/admin.js';
import * as kanbanHandlers from './handlers/kanban.js';
import { handleAdminPanel } from './panel.js';
import { dispatchRoute } from './routes/index.js';

export class BusDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.rateLimit = new Map(); // agent -> [epochSec]
    this.churn = new Map(); // agent -> [epochSec of WS handshakes]
    this.state.blockConcurrencyWhile(async () => {
      await runMigrations(this);
    });
    // Protocol ping -> auto pong without waking the DO (zero-cost keepalive).
    if (typeof WebSocketRequestResponsePair !== "undefined" && this.state.setWebSocketAutoResponse) {
      this.state.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong")
      );
    }
  }

  json(code, obj, extraHeaders) {
    return json(code, obj, extraHeaders);
  }

  migrateV3() {
    return migrateV3(this);
  }

  migrateV4() {
    return migrateV4(this);
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

  async fetch(req) {
    return dispatchRoute(this, req);
  }
}

// Attach all domain methods and handlers to BusDO prototype
Object.assign(
  BusDO.prototype,
  eventMethods,
  agentHandlers,
  channelHandlers,
  messageHandlers,
  pollHandlers,
  adminHandlers,
  kanbanHandlers,
  { handleAdminPanel }
);
