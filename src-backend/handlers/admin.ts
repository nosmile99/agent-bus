// Admin auth, cutover tooling, credentials, and stats
import { timingSafeEqual, sha256Hex } from '../utils.js';
import type { IBusDO, WebSocketAttachment, AdminRecord } from '../types.js';

interface AgentConnectionEntry {
  agent: string;
  channels: Set<string>;
  connectedSince: string | null;
  connections: number;
}

export async function handleList(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) return this.json(401, { error: "unauthorized" });
  const byAgent = new Map<string, AgentConnectionEntry>();
  for (const ws of this.state.getWebSockets()) {
    let att: WebSocketAttachment | null = null;
    try {
      att = ws.deserializeAttachment() as WebSocketAttachment | null;
    } catch {
      continue;
    }
    if (!att || !att.agent) continue;
    const entry: AgentConnectionEntry = byAgent.get(att.agent) || {
      agent: att.agent,
      channels: new Set<string>(),
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

export function checkAdmin(this: IBusDO, req: Request): boolean {
  const token = req.headers.get("X-Admin-Token") || "";
  const expected = (this.env.BUS_ADMIN_TOKEN as string | undefined) || "";
  return expected !== "" && timingSafeEqual(token, expected);
}

export async function checkAdminDrain(this: IBusDO, req: Request): Promise<boolean> {
  // Admin auth failure: drain the body before the 401 (see handleSend).
  if (this.checkAdmin(req)) return true;
  try {
    await req.text();
  } catch {}
  return false;
}

export async function checkBasicAuth(this: IBusDO, req: Request): Promise<boolean> {
  const h = req.headers.get("Authorization") || "";
  const m = /^Basic (\S+)$/.exec(h);
  if (!m || !m[1]) return false;
  let decoded: string;
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
  const rows = this.sql
    .exec(`SELECT user, pass_hash, salt FROM admins WHERE user = ?`, u)
    .toArray() as unknown as AdminRecord[];
  if (rows.length === 0) return false;
  const row = rows[0]!;
  const hash = await sha256Hex(row.salt + ":" + p);
  return timingSafeEqual(hash, row.pass_hash);
}

export async function unauthorizedBasic(_req: Request): Promise<Response> {
  // Drain the body: returning while the request stream is unread makes
  // workerd fail the connection ("Can't read from request stream after
  // response has been sent").
  try {
    await _req.text();
  } catch {}
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export async function handleAdminApiStats(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = (
    this.sql
      .exec("SELECT COUNT(*) AS c FROM messages WHERE ts >= ?", today + "T00:00:00.000Z")
      .one() as { c: number }
  ).c;
  const perChannel = (
    this.sql
      .exec("SELECT channel, COUNT(*) AS c FROM messages GROUP BY channel ORDER BY c DESC")
      .toArray() as Array<{ channel: string; c: number }>
  ).map((r) => ({ channel: r.channel, count: r.c }));
  const total = (this.sql.exec("SELECT COUNT(*) AS c FROM messages").one() as { c: number }).c;
  const agentCount = (this.sql.exec("SELECT COUNT(*) AS c FROM agents").one() as { c: number }).c;
  // Fix round 4, item 5: sweep health from bus_meta (persisted,
  // not DO-log-only). Missing keys mean the meta table predates
  // this round or migrations have not run yet — reported as
  // null, never invented.
  const sweepHealth: Record<string, unknown> = {};
  try {
    for (const row of this.sql
      .exec(`SELECT key, value FROM bus_meta WHERE key IN ('alarm_boot', 'alarm_last_run', 'alarm_last_completed', 'alarm_last_error', 'alarm_reschedule_error', 'alarm_rearm', 'alarm_rearm_failures', 'sweep_pending')`)
      .toArray() as Array<{ key: string; value: string }>) {
      try {
        sweepHealth[row.key] = JSON.parse(row.value);
      } catch {
        sweepHealth[row.key] = row.value;
      }
    }
  } catch {}
  // Amendment batch item 25: the same sweep-visibility object
  // the agent endpoint serves, so admin stats and the caller
  // surface agree (counts, convergence bound, next sweep).
  // Amendment batch item 18: audit-table sizes for
  // observability (row counts only, never row content).
  const auditSizes: Record<string, number> = {};
  for (const tbl of ['dependency_events', 'ledger_events']) {
    try {
      auditSizes[tbl] = (this.sql.exec(`SELECT COUNT(*) AS c FROM ${tbl}`).one() as { c: number }).c;
    } catch {
      auditSizes[tbl] = -1;
    }
  }
  return this.json(200, {
    messagesToday: todayCount,
    totalMessages: total,
    perChannel,
    registeredAgents: agentCount,
    sweepHealth,
    sweepVisibility: this.kbSweepVisibility(),
    auditSizes,
    doStatus: "ok",
    ts: new Date().toISOString(),
  });
}

// POST /admin/api/audit/purge — amendment batch item 18,
// enforcement hook for the retention rules. Minimum
// retention: AUDIT_MIN_RETENTION_DAYS (90) for both
// dependency_events and ledger_events, counted from the
// event's created_at (epoch seconds). Rows younger than the minimum
// are NEVER deleted by this endpoint: a request with a
// cutoff inside the retention window is 400, and the purge
// itself only deletes rows with ts <= cutoff AND ts <=
// now - 90 days. The cutoff is explicit in the request
// (before_ts, epoch seconds, required) so no purge is ever
// implicit or alarm-driven: the alarm path never deletes
// audit rows. The deleted counts are reported per table,
// and the purge is recorded in bus_meta (audit_purge_log,
// capped at 20 entries) — the log itself is metadata, not
// an audit row, so it survives the purge.
export const AUDIT_MIN_RETENTION_DAYS = 90;
export async function handleAdminApiAuditPurge(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: 'invalid json' });
  }
  const payload = data as Record<string, unknown> | null;
  const beforeTs = payload?.before_ts;
  if (typeof beforeTs !== 'number' || !Number.isFinite(beforeTs) || beforeTs <= 0) {
    return this.json(400, { error: 'before_ts required (epoch seconds)', field: 'before_ts' });
  }
  const now = this.kbNow();
  const minCutoff = now - AUDIT_MIN_RETENTION_DAYS * 86400;
  if (beforeTs > minCutoff) {
    return this.json(400, {
      error: 'before_ts inside the minimum retention window',
      field: 'before_ts',
      min_retention_days: AUDIT_MIN_RETENTION_DAYS,
      earliest_allowed_cutoff: minCutoff,
    });
  }
  const deleted: Record<string, number> = {};
  this.state.storage.transactionSync(() => {
    for (const tbl of ['dependency_events', 'ledger_events']) {
      this.sql.exec(`DELETE FROM ${tbl} WHERE created_at <= ?`, beforeTs);
      deleted[tbl] = (this.sql.exec('SELECT changes() AS c').one() as { c: number }).c;
    }
    let log: Array<Record<string, unknown>> = [];
    try {
      const rows = this.sql.exec(`SELECT value FROM bus_meta WHERE key = 'audit_purge_log'`).toArray() as Array<{ value: string }>;
      if (rows[0]) log = JSON.parse(rows[0].value) as Array<Record<string, unknown>>;
    } catch {}
    log.push({ at: now, by: this.kbBasicUser(req) || 'admin', before_ts: beforeTs, deleted });
    log = log.slice(-20);
    this.sql.exec(
      `INSERT INTO bus_meta (key, value) VALUES ('audit_purge_log', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(log)
    );
  });
  return this.json(200, { ok: true, before_ts: beforeTs, min_retention_days: AUDIT_MIN_RETENTION_DAYS, deleted });
}

export async function handleAdminApiPassword(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = body as Record<string, unknown> | null;
  const newUser = payload?.newUser;
  const newPassword = payload?.newPassword;
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 12) {
    return this.json(400, { error: "newPassword required, min 12 chars" });
  }
  // Get current user from the auth header.
  const h = req.headers.get("Authorization") || "";
  const m = /^Basic (\S+)$/.exec(h);
  const currentUser = m && m[1] ? atob(m[1]).split(":")[0] || "" : "";
  const targetUser = (newUser && typeof newUser === "string" && newUser.trim()) || currentUser;
  if (!targetUser) return this.json(400, { error: "no user" });

  const salt = crypto.randomUUID();
  const hash = await sha256Hex(salt + ":" + newPassword);
  // Atomic: INSERT new first, then DELETE old (if username changed).
  // If INSERT fails, old row survives — never leave zero admins.
  this.sql.exec(
    `INSERT INTO admins (user, pass_hash, salt) VALUES (?, ?, ?)
     ON CONFLICT(user) DO UPDATE SET pass_hash = excluded.pass_hash, salt = excluded.salt`,
    targetUser,
    hash,
    salt
  );
  if (targetUser !== currentUser) {
    this.sql.exec(`DELETE FROM admins WHERE user = ?`, currentUser);
  }
  return this.json(200, { ok: true, user: targetUser });
}
