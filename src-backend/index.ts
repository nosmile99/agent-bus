// BusDO — the agent-bus hub as a Cloudflare Durable Object.
import { Hono } from 'hono';
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
import { createRouter } from './routes/index.js';
import type {
  IBusDO,
  Env,
  TaskRecord,
  TodoRecord,
  TaskWithTodos,
  TaskDetailResponse,
  TaskSearchOpts,
} from './types.js';

export class BusDO implements IBusDO {
  state: DurableObjectState;
  env: Env;
  sql: SqlStorage;
  rateLimit: Map<string, number[]>;
  churn: Map<string, number[]>;
  private app: Hono;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.rateLimit = new Map<string, number[]>();
    this.churn = new Map<string, number[]>();
    this.app = createRouter(this);

    this.state.blockConcurrencyWhile(async () => {
      await runMigrations(this);
    });

    // Protocol ping -> auto pong without waking the DO (zero-cost keepalive).
    const stateAny = this.state as unknown as {
      setWebSocketAutoResponse?: (pair: unknown) => void;
    };
    if (typeof WebSocketRequestResponsePair !== "undefined" && stateAny.setWebSocketAutoResponse) {
      stateAny.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong")
      );
    }
  }

  json(code: number, obj: unknown, extraHeaders?: HeadersInit): Response {
    return json(code, obj, extraHeaders);
  }

  migrateV3(): void {
    return migrateV3(this);
  }

  migrateV4(): void {
    return migrateV4(this);
  }

  // ---------- DO alarm: staleness sweep + event retention prune ----------
  // Runs 5 min after boot, then hourly (rescheduled at the end).
  async alarm(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      // Task staleness (kanban rev 4): status='doing' AND last_activity_at older
      // than 24h. Emits kanban.task.stale ONCE per transition, guarded by
      // stale_notified_at (reset when last_activity_at advances past it).
      const staleCutoff = now - 86400;
      const staleTasks = this.sql
        .exec(
          `SELECT id, project_id FROM tasks
           WHERE status = 'doing' AND last_activity_at < ?
             AND (stale_notified_at IS NULL OR stale_notified_at < last_activity_at)`,
          staleCutoff
        )
        .toArray() as Array<{ id: number; project_id: number }>;
      for (const t of staleTasks) {
        this.sql.exec(`UPDATE tasks SET stale_notified_at = ? WHERE id = ?`, now, t.id);
        this.emitEvent("kanban.task.stale", {
          actor: "system",
          project_id: t.project_id,
          payload: { id: t.id },
        });
      }
      // Agent staleness: registered but no poll/WS heartbeat within 24h.
      // Once-per-transition (M5): guarded by stale_notified_at, re-armed when
      // last_seen advances (ISO-8601 strings sort lexicographically).
      const agentCutoffIso = new Date((now - 86400) * 1000).toISOString();
      const nowIso = new Date(now * 1000).toISOString();
      const staleAgents = this.sql
        .exec(
          `SELECT agent FROM agents
           WHERE last_seen IS NOT NULL AND last_seen < ?
             AND (stale_notified_at IS NULL OR stale_notified_at < last_seen)`,
          agentCutoffIso
        )
        .toArray() as Array<{ agent: string }>;
      for (const { agent } of staleAgents) {
        this.sql.exec(`UPDATE agents SET stale_notified_at = ? WHERE agent = ?`, nowIso, agent);
        this.emitEvent("agent.stale", { actor: "system", scope: "all", payload: { agent } });
      }
      // Event retention: prune events older than 30 days.
      this.sql.exec(`DELETE FROM events WHERE ts < ?`, now - 30 * 86400);
    } catch (_e) {
      /* sweep must never wedge the alarm loop */
    }
    try {
      await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    } catch {}
  }

  async fetch(req: Request): Promise<Response> {
    const res = this.app.fetch(req);
    return res instanceof Promise ? await res : res;
  }

  // Durable Object hibernatable WebSocket methods
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    return pollHandlers.webSocketMessage.call(this, ws, message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    return pollHandlers.webSocketClose.call(this, ws, code, reason, wasClean);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    return pollHandlers.webSocketError.call(this, ws, error);
  }

  // Explicit type implementations delegated to handler modules
  emitEvent!: (
    type: string,
    opts?: {
      actor?: string | null;
      project_id?: number | null;
      scope?: string;
      recipients?: string[] | null;
      payload?: unknown;
    }
  ) => void;
  kbSubscriberPred!: (projExpr?: string) => string;
  kbIsArchived!: (taskId: number) => boolean;
  kbTouchTask!: (id: number) => void;
  kbSystemLog!: (taskId: number, body: string) => void;
  kbProjectSubscribers!: (projectId: number) => string[];
  kbSetSubscribers!: (projectId: number, subscribers: unknown, addedBy?: string) => string[];
  kbChannelCreate!: (name: unknown, creator: string) => { ok?: true; name?: string; error?: string; code: number };
  kbChannelAddMember!: (
    name: string,
    agentName: string,
    addedBy: string
  ) => { ok?: true; channel?: string; agent?: string; error?: string; code: number };
  kbChannelRemoveMember!: (
    name: string,
    agentName: string,
    removedBy: string
  ) => { ok?: true; channel?: string; agent?: string; error?: string; code: number };
  kbLabelOp!: (
    taskId: number,
    label: unknown,
    op: "add" | "remove",
    actor: string
  ) => { ok?: true; error?: string; code: number };
  kbTaskDetail!: (row: TaskRecord) => TaskDetailResponse;
  kbTaskSearchWhere!: (opts: TaskSearchOpts) => { where: string; params: (string | number)[]; order: string };
  kbTodosFor!: (taskId: number) => TodoRecord[];
  kbTaskWithTodos!: (row: TaskRecord) => TaskWithTodos;
  kbNow!: () => number;
  kbBasicUser!: (req: Request) => string;

  allAgents!: () => Array<{ agent: string; secret: string }>;
  authedAgent!: (req: Request) => string | null;
  agentForToken!: (token: string) => string | null;
  readableChannels!: (agent: string) => Set<string>;
  validateChannel!: (agent: string, channel: string | null | undefined) => string | null;
  rlCheck!: (agent: string) => boolean;
  churnCheck!: (agent: string) => boolean;
  ensureChannelRow!: (channel: string, sender: string) => string;
  canSendToChannel!: (agent: string, channel: string) => boolean;

  checkAdmin!: (req: Request) => boolean;
  checkAdminDrain!: (req: Request) => Promise<boolean>;
  checkBasicAuth!: (req: Request) => Promise<boolean>;
  unauthorizedBasic!: (req: Request) => Promise<Response>;

  handleWs!: (req: Request, url: URL) => Promise<Response>;
  handlePoll!: (req: Request, url: URL) => Promise<Response>;
  handlePollNew!: (url: URL, agent: string | null, isAdmin: boolean) => Promise<Response>;
  handlePollLegacy!: (url: URL, agent: string) => Promise<Response>;
  handleSend!: (req: Request) => Promise<Response>;
  handleAdminImport!: (req: Request) => Promise<Response>;
  handleAdminExport!: (req: Request) => Promise<Response>;
  handleAdminApiMessages!: (req: Request, url: URL) => Promise<Response>;
  handleAdminApiSend!: (req: Request) => Promise<Response>;
  handleAdminApiMessageDelete!: (req: Request, id: number) => Promise<Response>;
  handleAdminApiMessageEdit!: (req: Request, id: number) => Promise<Response>;

  handleList!: (req: Request) => Promise<Response>;
  handleAgents!: (req: Request) => Promise<Response>;
  handleReg!: (req: Request) => Promise<Response>;
  handleAdminAgents!: (req: Request) => Promise<Response>;
  handleAdminApiAgents!: (req: Request) => Promise<Response>;
  handleAdminApiRegistered!: (req: Request) => Promise<Response>;
  handleAdminApiAgentRegister!: (req: Request) => Promise<Response>;
  handleAdminApiAgentDelete!: (req: Request, agent: string) => Promise<Response>;
  handleAdminApiAgentRotate!: (req: Request, agent: string) => Promise<Response>;

  handleAdminApiChannels!: (req: Request) => Promise<Response>;
  handleAdminApiSenders!: (req: Request) => Promise<Response>;
  handleAdminApiChannelMemberRemove!: (req: Request, channel: string, agent: string) => Promise<Response>;
  handleAdminApiChannelDelete!: (req: Request, channel: string) => Promise<Response>;
  handleApiChannelCreate!: (req: Request) => Promise<Response>;
  handleAdminApiChannelCreate!: (req: Request) => Promise<Response>;
  handleAdminApiChannelMemberAdd!: (req: Request, channel: string) => Promise<Response>;
  handleApiChannelMemberAdd!: (req: Request, channel: string) => Promise<Response>;
  handleApiChannelMemberRemove!: (req: Request, channel: string, agent: string) => Promise<Response>;

  handleAdminApiStats!: (req: Request) => Promise<Response>;
  handleAdminApiPassword!: (req: Request) => Promise<Response>;
  handleAdminPanel!: (req: Request) => Promise<Response>;

  handleKbAdminProjectsList!: (req: Request) => Promise<Response>;
  handleKbAdminProjectCreate!: (req: Request) => Promise<Response>;
  handleKbAdminProjectUpdate!: (req: Request, id: number) => Promise<Response>;
  handleKbAdminProjectDelete!: (req: Request, id: number) => Promise<Response>;
  handleKbAdminTasksList!: (req: Request, projectId: number) => Promise<Response>;
  handleKbAdminTaskCreate!: (req: Request, projectId: number) => Promise<Response>;
  handleKbAdminTaskUpdate!: (req: Request, id: number) => Promise<Response>;
  handleKbAdminTaskDelete!: (req: Request, id: number) => Promise<Response>;
  handleKbAdminTodoCreate!: (req: Request, taskId: number) => Promise<Response>;
  handleKbAdminTodoUpdate!: (req: Request, id: number) => Promise<Response>;
  handleKbAdminTodoDelete!: (req: Request, id: number) => Promise<Response>;

  handleKbAgentProjectsList!: (req: Request) => Promise<Response>;
  handleKbAgentTasksAvailable!: (req: Request) => Promise<Response>;
  handleKbAgentTasksList!: (req: Request, projectId: number) => Promise<Response>;
  handleKbAgentTaskCreate!: (req: Request, projectId: number) => Promise<Response>;
  handleKbTaskSearch!: (
    url: URL,
    opts: { isAdmin: boolean; agent: string | null; projectId: number | null }
  ) => Promise<Response>;
  handleKbAgentTaskDetail!: (req: Request, id: number) => Promise<Response>;
  handleKbAgentTaskUpdate!: (req: Request, id: number) => Promise<Response>;
  handleKbAgentTaskClaim!: (req: Request, id: number) => Promise<Response>;
  handleKbAgentTaskStatus!: (req: Request, id: number) => Promise<Response>;
  handleKbAgentTodoCreate!: (req: Request, taskId: number) => Promise<Response>;
  handleKbCommentList!: (
    req: Request,
    url: URL,
    taskId: number,
    opts: { isAdmin: boolean; agent: string | null }
  ) => Promise<Response>;
  handleKbCommentAdd!: (
    req: Request,
    taskId: number,
    opts: { isAdmin: boolean; agent: string | null }
  ) => Promise<Response>;
  handleKbAgentLabelAdd!: (req: Request, taskId: number) => Promise<Response>;
  handleKbAgentLabelRemove!: (req: Request, taskId: number, label: string) => Promise<Response>;
  handleKbAgentTodoUpdate!: (req: Request, id: number) => Promise<Response>;
  handleKbAdminProjectLabels!: (req: Request, projectId: number) => Promise<Response>;
  handleKbAdminProjectSubscribers!: (req: Request, projectId: number) => Promise<Response>;
  handleKbAdminTaskDetail!: (req: Request, id: number) => Promise<Response>;
  handleKbAdminLabelAdd!: (req: Request, taskId: number) => Promise<Response>;
  handleKbAdminLabelRemove!: (req: Request, taskId: number, label: string) => Promise<Response>;
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

// SAFEGUARD: Explicitly ensure critical handlers are on prototype (bundler may drop Object.assign)
for (const [name, fn] of Object.entries(pollHandlers)) {
  if (typeof fn === "function" && !(BusDO.prototype as any)[name]) {
    (BusDO.prototype as any)[name] = fn;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const id = env.BUS.idFromName("bus");
    return env.BUS.get(id).fetch(req);
  },
};
