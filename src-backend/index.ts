// BusDO — the agent-bus hub as a Cloudflare Durable Object.
import { Hono } from 'hono';
import { json } from './utils.js';
import { runMigrations, migrateV3, migrateV4, migrateV6, migrateV7 } from './db/migrations.js';
import * as eventMethods from './db/events.js';
import * as agentHandlers from './handlers/agents.js';
import * as channelHandlers from './handlers/channels.js';
import * as messageHandlers from './handlers/messages.js';
import * as pollHandlers from './handlers/poll.js';
import * as adminHandlers from './handlers/admin.js';
import * as kanbanHandlers from './handlers/kanban.js';
import * as dependencyHandlers from './handlers/dependencies.js';
import * as ledgerHandlers from './handlers/ledger.js';
import { createRouter } from './routes/index.js';
import type {
  IBusDO,
  Env,
  TaskRecord,
  TodoRecord,
  TaskWithTodos,
  TaskDetailResponse,
  TaskSearchOpts,
  TaskLane,
  WipWarning,
  AutoClaimResult,
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
    for (const mod of [eventMethods, agentHandlers, channelHandlers, messageHandlers, pollHandlers, adminHandlers, kanbanHandlers, dependencyHandlers, ledgerHandlers]) {
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn === 'function' && !(this as any)[name]) {
          (this as any)[name] = (fn as Function).bind(this);
        }
      }
    }

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

  migrateV6(): void {
    return migrateV6(this);
  }

  migrateV7(): void {
    return migrateV7(this);
  }

  // ---------- DO alarm: staleness sweep + event retention prune ----------
  // Runs 5 min after boot, then hourly (rescheduled at the end).
  async alarm(): Promise<void> {
    try {
      const now = Math.floor(Date.now() / 1000);
      // Fix round 4, item 5: persistent sweep-health signal. The
      // alarm records each run in bus_meta (created in
      // runMigrations) so health survives DO logs; admin stats
      // surfaces alarm_last_run / alarm_last_error / alarm_boot.
      // Fix round 5, M8b: NO stamp at start. alarm_last_run used
      // to be written here, before the sweep body, so a crash
      // mid-body still recorded a fresh run and fetch re-arm
      // would not fire. Completion is stamped at the end of a
      // successful body (below); a crashed body leaves the old
      // stamp, so re-arm correctly fires.
      // Task staleness (kanban rev 4/5): status='doing' AND last_activity_at older
      // than 24h. Emits kanban.task.stale and writes kbSystemLog ONCE per transition,
      // guarded by stale_notified_at (reset when last_activity_at advances past it).
      const staleCutoff = now - 86400;
      // Fix round 5 minor: stale batches are capped at 100 rows
      // per alarm; the remainder is picked up next hour (the
      // stale_notified_at guard keeps it idempotent).
      const staleTasks = this.sql
        .exec(
          `SELECT id, project_id, lane, assignee FROM tasks
           WHERE status = 'doing' AND last_activity_at < ?
             AND (stale_notified_at IS NULL OR stale_notified_at < last_activity_at) LIMIT 100`,
          staleCutoff
        )
        .toArray() as Array<{ id: number; project_id: number; lane: TaskLane; assignee: string | null }>;
      for (const t of staleTasks) {
        this.sql.exec(`UPDATE tasks SET stale_notified_at = ? WHERE id = ?`, now, t.id);
        this.kbSystemLog(t.id, "task marked stale (no activity for 24h)");
        this.emitEvent("kanban.task.stale", {
          actor: "system",
          project_id: t.project_id,
          payload: { id: t.id, task_id: t.id, lane: t.lane, assignee: t.assignee },
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
             AND (stale_notified_at IS NULL OR stale_notified_at < last_seen) LIMIT 100`,
          agentCutoffIso
        )
        .toArray() as Array<{ agent: string }>;
      for (const { agent } of staleAgents) {
        this.sql.exec(`UPDATE agents SET stale_notified_at = ? WHERE agent = ?`, nowIso, agent);
        this.emitEvent("agent.stale", { actor: "system", scope: "all", payload: { agent } });
      }
      // Event retention: prune poll events older than 30 days.
      // dependency_events and ledger_events are intentionally NOT
      // pruned here: they are the append-only audit trail for the
      // dependency machine and the decision ledger, and pruning them
      // would destroy the history those features exist to keep.
      // (Fix-round minor: retention documented, not extended.)
      // Fix round 5 minor: prune in chunks of 1000, at most 20
      // chunks per alarm (20k rows); an unbounded single DELETE
      // could stall the DO on a large events table, and the
      // remainder converges on later alarms (the cutoff is stable).
      for (let chunk = 0; chunk < 20; chunk++) {
        const r = this.sql.exec(
          `DELETE FROM events WHERE id IN (SELECT id FROM events WHERE ts < ? ORDER BY id ASC LIMIT 1000)`,
          now - 30 * 86400
        ) as { rowsWritten?: number };
        if ((r.rowsWritten ?? 0) === 0) break;
      }
      // Dependency follow-up sweep (fix round M4): re-run the
      // idempotent project re-evaluation over every non-archived
      // project, so any fan-out remainder capped at DEP_FANOUT_CAP
      // (done/reopen/unarchive/delete paths) converges. Processed
      // rows leave the pass's input set, so the sweep cannot starve
      // a remainder. Best-effort per project: one project's failure
      // must not wedge the sweep or the alarm loop.
      // Fix round 2, item 7 — per-alarm work budget: at most
      // DEP_SWEEP_PROJECT_CAP projects per hourly sweep (each pass
      // already capped at DEP_FANOUT_CAP per pass, so a sweep costs
      // at most 20 x 200 row-passes and cannot stall the DO). The
      // window ROTATES by hour so no project starves: window index
      // = floor(now/3600) mod number-of-windows, wrapping around,
      // so every project is visited at least once every
      // ceil(projectCount/20) hours and a capped remainder
      // converges on later sweeps, like the M4 fan-out cap.
      try {
        const openProjects = this.sql
          .exec(`SELECT id FROM projects WHERE archived = 0 ORDER BY id ASC`)
          .toArray() as Array<{ id: number }>;
        const DEP_SWEEP_PROJECT_CAP = dependencyHandlers.DEP_SWEEP_PROJECT_CAP;
        // Amendment batch item 17: explicit sweep threshold,
        // enforced. Below threshold (few projects AND few tasks)
        // the sweep runs a single pass over ALL open projects with
        // the candidate budget lifted; above it, the existing
        // capped machinery (20-project rotation window + budget)
        // applies. The per-pass processed cap still bounds one
        // transaction even in single-pass mode (see dependencies.ts).
        const openTaskCount = (this.sql.exec(`SELECT COUNT(*) AS c FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.archived = 0`).one() as { c: number }).c;
        const singlePass = openProjects.length <= dependencyHandlers.SWEEP_SINGLE_PASS_MAX_PROJECTS && openTaskCount <= dependencyHandlers.SWEEP_SINGLE_PASS_MAX_TASKS;
        let window = openProjects;
        if (!singlePass && openProjects.length > DEP_SWEEP_PROJECT_CAP) {
          const windows = Math.ceil(openProjects.length / DEP_SWEEP_PROJECT_CAP);
          const wi = Math.floor(now / 3600) % windows;
          const start = wi * DEP_SWEEP_PROJECT_CAP;
          window = [...openProjects.slice(start), ...openProjects.slice(0, start)].slice(0, DEP_SWEEP_PROJECT_CAP);
        }
        // Fix round 5, M8e: rotation remainder is a sweep-level
        // pending signal, not hidden. When the window leaves
        // projects unvisited, bus_meta sweep_pending records it
        // (surfaced in admin stats); no deadline beyond the
        // existing hourly cadence is promised.
        // Fix round 6, Domain M9: the loop used to discard
        // depReevaluateProject's return values, so a capped
        // fan-out inside a VISITED project never reached stats
        // — only rotation (project_count > 20) was recorded.
        // Now per-project remainders and failures are persisted
        // in sweep_pending too (lists capped at 20 ids to bound
        // the row), so sweep_pending means a genuine remainder,
        // not just rotation.
        const pendingProjects: number[] = [];
        const failedProjects: number[] = [];
        for (const proj of window) {
          try {
            const res = this.depReevaluateProject(proj.id, now, singlePass ? { uncapped: true } : undefined);
            if (res.pending_sweep && pendingProjects.length < 20) pendingProjects.push(proj.id);
          } catch (e) {
            if (failedProjects.length < 20) failedProjects.push(proj.id);
            // Fix round 3, M2: a per-project failure is a visible
            // signal, not a swallowed catch — DO log (wrangler tail)
            // plus a poll-visible sweep event, so a wedged project
            // is diagnosable instead of silently skipped forever.
            const msg = e instanceof Error ? e.message : String(e);
            try {
              console.error(`[alarm sweep] project ${proj.id} re-evaluation failed: ${msg}`);
            } catch {}
            try {
              this.emitEvent('kanban.sweep.failed', {
                actor: 'system',
                project_id: proj.id,
                payload: { project_id: proj.id, error: msg },
              });
            } catch {}
          }
        }
        try {
          this.sql.exec(
            `INSERT INTO bus_meta (key, value) VALUES ('sweep_pending', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            JSON.stringify({ at: now, pending_sweep: openProjects.length > DEP_SWEEP_PROJECT_CAP || pendingProjects.length > 0 || failedProjects.length > 0, unvisited_projects: Math.max(0, openProjects.length - window.length), window_projects: window.length, pending_projects: pendingProjects, failed_projects: failedProjects, single_pass: singlePass, threshold_projects: dependencyHandlers.SWEEP_SINGLE_PASS_MAX_PROJECTS, threshold_tasks: dependencyHandlers.SWEEP_SINGLE_PASS_MAX_TASKS, open_projects: openProjects.length, open_tasks: openTaskCount })
          );
        } catch {}
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try {
          console.error(`[alarm sweep] sweep body failed: ${msg}`);
        } catch {}
        try {
          this.emitEvent('kanban.sweep.failed', {
            actor: 'system',
            payload: { error: msg },
          });
        } catch {}
      }
      // Fix round 5, M8b: completion stamp — only reached when
      // the whole body above succeeded. Fetch re-arm keys off
      // this (falling back to the legacy alarm_last_run), so a
      // crash mid-body correctly leaves re-arm armed.
      try {
        this.sql.exec(
          `INSERT INTO bus_meta (key, value) VALUES ('alarm_last_completed', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          JSON.stringify({ at: now })
        );
        this.sql.exec(`DELETE FROM bus_meta WHERE key = 'alarm_rearm_failures'`);
      } catch {}
    } catch (e) {
      // Fix round 3, M2: the sweep body failure is logged, not
      // swallowed — but it must never wedge the alarm loop, so the
      // reschedule below runs in a finally regardless.
      // Fix round 4, item 5: the failure is also persisted in
      // bus_meta, not only in DO logs.
      const msg = e instanceof Error ? e.message : String(e);
      try {
        console.error(`[alarm] sweep failed: ${msg}`);
      } catch {}
      try {
        this.sql.exec(
          `INSERT INTO bus_meta (key, value) VALUES ('alarm_last_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          JSON.stringify({ error: msg, at: Math.floor(Date.now() / 1000) })
        );
      } catch {}
    } finally {
      // Fix round 3, M2: reschedule guarantee. The old code swallowed
      // a setAlarm failure, which silently killed all future sweeps.
      // Now it retries (3 attempts) and logs loudly if every attempt
      // fails, so a dead alarm is observable in DO logs.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
          break;
        } catch (e) {
          if (attempt === 2) {
            try {
              console.error(`[alarm] reschedule failed after 3 attempts: ${e instanceof Error ? e.message : String(e)}`);
            } catch {}
            try {
              this.sql.exec(
                `INSERT INTO bus_meta (key, value) VALUES ('alarm_reschedule_error', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                JSON.stringify({ error: e instanceof Error ? e.message : String(e), at: Math.floor(Date.now() / 1000) })
              );
            } catch {}
          }
        }
      }
    }
  }

  async fetch(req: Request): Promise<Response> {
    // Fix round 4, item 5: fetch-path re-arm. The DO API exposes
    // no getAlarm, so a dead alarm is detected by staleness: if
    // no alarm run is recorded (or the last one is >2h old —
    // hourly cadence plus slack), the next request re-arms +5min
    // and records the attempt. A live alarm updates
    // alarm_last_run hourly, so this never fires on a healthy
    // DO; a dead alarm re-arms at most once per request until
    // the alarm runs again. Cadence semantics unchanged.
    // Fix round 5, M8b/c/d: re-arm keys off COMPLETION, not
    // start; it is throttled to at most once per hour per dead
    // episode (same last_completed value); and repeated setAlarm
    // failures emit a poll-visible event, not only a console log
    // — if setAlarm itself is the broken part, a schedule-only
    // re-arm fails the same way, so agents must see it.
    try {
      const meta = (key: string): string | null => {
        try {
          const r = this.sql.exec(`SELECT value FROM bus_meta WHERE key = ?`, key).toArray() as Array<{ value: string }>;
          return r[0]?.value ?? null;
        } catch { return null; }
      };
      const parseAt = (raw: string | null): number => {
        if (!raw) return 0;
        try { return (JSON.parse(raw).at as number) || 0; } catch { return 0; }
      };
      const lastCompleted = parseAt(meta('alarm_last_completed')) || parseAt(meta('alarm_last_run'));
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - lastCompleted > 2 * 3600) {
        const rearm = meta('alarm_rearm');
        let rearmAt = 0;
        let rearmEpisode = -1;
        try { const j = rearm ? JSON.parse(rearm) : null; rearmAt = j?.at || 0; rearmEpisode = j?.last_run ?? -1; } catch {}
        if (!(nowSec - rearmAt < 3600 && rearmEpisode === lastCompleted)) {
          try {
            await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
            this.sql.exec(
              `INSERT INTO bus_meta (key, value) VALUES ('alarm_rearm', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              JSON.stringify({ at: nowSec, last_run: lastCompleted })
            );
            this.sql.exec(`DELETE FROM bus_meta WHERE key = 'alarm_rearm_failures'`);
          } catch (e) {
            try {
              console.error(`[alarm] fetch-path re-arm failed: ${e instanceof Error ? e.message : String(e)}`);
            } catch {}
            try {
              let count = 0;
              try { const raw = meta('alarm_rearm_failures'); count = raw ? (JSON.parse(raw).count as number) || 0 : 0; } catch {}
              count += 1;
              this.sql.exec(
                `INSERT INTO bus_meta (key, value) VALUES ('alarm_rearm_failures', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                JSON.stringify({ count, at: nowSec, last_completed: lastCompleted })
              );
              // Fix round 6, fix-before-deploy: the throttle
              // record alarm_rearm used to be written ONLY on
              // setAlarm success, so a broken setAlarm retried
              // on EVERY fetch, incremented the counter, and
              // re-emitted rearm_failed at count >= 2 — while
              // pruning runs only inside alarm(), so nothing
              // pruned the flood while the alarm was dead. Now
              // a failed attempt writes the same throttle
              // record (same episode key: last_completed), so
              // failures are throttled to one attempt per hour
              // per dead episode, exactly like successes — and
              // the poll event fires only when the count first
              // reaches 2 (once per episode), not on every
              // subsequent hourly failure. The counter resets
              // on the next successful re-arm or alarm run.
              this.sql.exec(
                `INSERT INTO bus_meta (key, value) VALUES ('alarm_rearm', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                JSON.stringify({ at: nowSec, last_run: lastCompleted, failed: true })
              );
              if (count === 2) {
                this.emitEvent('kanban.sweep.rearm_failed', {
                  actor: 'system',
                  payload: { failures: count, last_completed: lastCompleted, error: e instanceof Error ? e.message : String(e) },
                });
              }
            } catch {}
          }
        }
      }
    } catch {}
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
  kbDefaultOrder!: (tableAlias?: string) => string;
  kbStartOfTodayJakarta!: (nowSec?: number) => number;
  kbAgentLane!: (agent: string) => TaskLane;
  kbLaneOwner!: (lane: TaskLane) => string | null;
  kbWipWarning!: (assignee: string | null) => WipWarning | undefined;
  kbAutoClaimOrVerify!: (
    taskId: number,
    agent: string,
    opts?: { isStatusEndpoint?: boolean; requestedStatus?: string; requestedLane?: string }
  ) => AutoClaimResult;
  kbTodosFor!: (taskId: number) => TodoRecord[];
  kbTaskWithTodos!: (row: TaskRecord) => TaskWithTodos;
  kbTasksWithTodos!: (rows: TaskRecord[]) => TaskWithTodos[];
  kbNow!: () => number;
  kbBasicUser!: (req: Request) => string;

  allAgents!: () => Array<{ agent: string; secret: string }>;
  authedAgent!: (req: Request) => string | null;
  agentForToken!: (token: string) => string | null;
  readableChannels!: (agent: string) => Set<string>;
  validateChannel!: (agent: string, channel: string | null | undefined) => string | null;
  rlCheck!: (agent: string) => boolean;
  rlRetryAfterSeconds!: (agent: string) => number;
  rlLimitedResponse!: (agent: string, hint?: string, bucket?: 'read' | 'write') => Response;
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
  handleKbAgentTaskUpdate!: (
    req: Request,
    id: number,
    onlyField?: 'notes' | 'due_date' | 'lane'
  ) => Promise<Response>;
  handleKbAgentTaskClaim!: (req: Request, id: number) => Promise<Response>;
  handleKbAgentTaskRelease!: (req: Request, id: number) => Promise<Response>;
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

  handleKbActivity!: (
    req: Request,
    url: URL,
    opts: { isAdmin: boolean; agent: string | null; projectId: number | null }
  ) => Promise<Response>;
  handleKbSummary!: (
    req: Request,
    url: URL,
    opts: { isAdmin: boolean; agent: string | null; projectId: number | null }
  ) => Promise<Response>;
  handleKbTemplatesList!: (req: Request, opts: { isAdmin: boolean }) => Promise<Response>;
  handleKbAdminTemplateCreate!: (req: Request) => Promise<Response>;
  handleKbAdminWipGet!: (req: Request) => Promise<Response>;
  handleKbAdminWipPut!: (req: Request) => Promise<Response>;
  handleKbAdminLaneMappingGet!: (req: Request) => Promise<Response>;
  handleKbAdminLaneMappingPut!: (req: Request) => Promise<Response>;

  // Revamp v12 (dependencies §4, ledger §5, Phase 3 §6)
  depReevaluateOnDone!: (blockerId: number, now: number) => { processed: number; capped: boolean; pending_sweep: boolean };
  depReblockOnReopen!: (blockerId: number, now: number) => { processed: number; capped: boolean; pending_sweep: boolean };
  depCascadeOnTaskDelete!: (taskId: number, now: number) => { links_removed: number; dependents_unblocked: number; unblocked_ids: number[]; capped: boolean; pending_sweep: boolean; snapshots_truncated: boolean };
  depCascadeOnProjectDelete!: (projectId: number, now: number) => { links_removed: number; tasks_deleted: number };
  depReevaluateProject!: (projectId: number, now: number, opts?: { uncapped?: boolean }) => { unblocked: { processed: number; capped: boolean; pending_sweep: boolean }; reblocked: { processed: number; capped: boolean; pending_sweep: boolean }; capped: boolean; pending_sweep: boolean; processed: number };
  handleDepLink!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleDepUnlink!: (req: Request, id: number, blockerId: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleDepList!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleDepEvents!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleDepUnblocked!: (req: Request, url: URL, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleLedgerCreate!: (req: Request) => Promise<Response>;
  handleLedgerList!: (req: Request, url: URL, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleLedgerGet!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleLedgerEvents!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleLedgerSupersede!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleLedgerTombstone!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleLedgerSeed!: (req: Request) => Promise<Response>;
  handleLedgerRecheckAssignment!: (req: Request, id: number) => Promise<Response>;
  handleLedgerDemote!: (req: Request, id: number) => Promise<Response>;
  handleKbCommentSoftDelete!: (req: Request, taskId: number, commentId: number) => Promise<Response>;

  // Amendment batch (items 0-18): new handlers + helpers.
  // Declared here (like every other handler above) so the
  // class statically satisfies IBusDO; runtime binding still
  // comes from the Object.assign prototype loop below.
  handleLedgerContradiction!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleLedgerResolver!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleLedgerResolveDissent!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleKbTaskRescue!: (req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleKbCommentRestore!: (req: Request, taskId: number, commentId: number, opts: { isAdmin: boolean; agent: string | null }) => Promise<Response>;
  handleKbAgentSweepHealth!: (req: Request) => Promise<Response>;
  handleAdminApiAuditPurge!: (req: Request) => Promise<Response>;
  rlCheckRead!: (agent: string) => boolean;
  rlCheckWrite!: (agent: string) => boolean;
  rlReadRetryAfterSeconds!: (agent: string) => number;
  rlReadLimitedResponse!: (agent: string, hint?: string) => Response;
  kbEncodeCursor!: (key: { d: string | number | null; p: string; c: string | number; i: number }) => string;
  kbDecodeCursor!: (raw: string) => { d: string | number | null; p: string; c: string | number; i: number } | null;
  kbKeysetTuple!: (alias: string) => string;
  kbKeysetParams!: (key: { d: string | number | null; p: string; c: string | number; i: number }) => (string | number)[];
  kbSweepVisibility!: () => Record<string, unknown>;
  kbFanoutIds!: (allIds: number[]) => { count: number; ids: number[]; truncated: boolean };
  kbFanoutPairs!: (allPairs: Array<{ blocker_id: number; blocked_id: number }>) => { count: number; pairs: Array<{ blocker_id: number; blocked_id: number }>; truncated: boolean };
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
  dependencyHandlers,
  ledgerHandlers
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
