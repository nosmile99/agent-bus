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
  return this.json(200, {
    messagesToday: todayCount,
    totalMessages: total,
    perChannel,
    registeredAgents: agentCount,
    doStatus: "ok",
    ts: new Date().toISOString(),
  });
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
