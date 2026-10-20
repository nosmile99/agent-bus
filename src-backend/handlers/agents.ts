// Agent registration, management, and authentication helpers
import {
  RATE_LIMITS,
  DEFAULT_RATE,
  CHURN_LIMIT,
  CHURN_WINDOW,
  timingSafeEqual,
  dmChannel,
  utcnow,
} from '../utils.js';
import type { IBusDO, WebSocketAttachment } from '../types.js';

export function allAgents(this: IBusDO): Array<{ agent: string; secret: string }> {
  return (this.sql.exec("SELECT agent, secret FROM agents").toArray() as Array<{
    agent: string;
    secret: string;
  }>).map((r) => ({ agent: r.agent, secret: r.secret }));
}

export function authedAgent(this: IBusDO, req: Request): string | null {
  const m = /^Bearer (\S+)$/.exec(req.headers.get("Authorization") || "");
  if (!m || !m[1]) return null;
  const token = m[1];
  for (const { agent, secret } of this.allAgents()) {
    if (timingSafeEqual(secret, token)) {
      // Touch last_seen (best-effort, don't fail auth on DB error).
      try {
        this.sql.exec("UPDATE agents SET last_seen = ? WHERE agent = ?", new Date().toISOString(), agent);
      } catch {}
      return agent;
    }
  }
  return null;
}

export function agentForToken(this: IBusDO, token: string): string | null {
  if (!token) return null;
  for (const { agent, secret } of this.allAgents()) {
    if (timingSafeEqual(secret, token)) return agent;
  }
  return null;
}

export function readableChannels(this: IBusDO, agent: string): Set<string> {
  // Members-only model (poll rev 3): all-agent + channels the agent is a
  // member of + every dm channel the agent is a party of. Backfill in
  // migrateV4() preserves pre-overhaul group-read semantics.
  const chans = new Set<string>(["all-agent"]);
  try {
    const rows = this.sql
      .exec("SELECT channel FROM channel_members WHERE agent = ?", agent)
      .toArray() as Array<{ channel: string }>;
    for (const r of rows) chans.add(r.channel);
  } catch {}
  for (const { agent: other } of this.allAgents()) {
    if (other !== agent) chans.add(dmChannel(agent, other));
  }
  return chans;
}

export function validateChannel(this: IBusDO, agent: string, channel: string | null | undefined): string | null {
  // Returns null if ok, else an error string.
  if (channel === "all-agent") return null;
  // Custom public channels (e.g. kanban-do): allow any sane name.
  // DM channels are validated strictly below.
  if (typeof channel === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel)) return null;
  const m = /^dm:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$/.exec(channel || "");
  if (!m || !m[1] || !m[2]) return "unknown channel";
  const [, a, b] = m;
  if (dmChannel(a, b) !== channel) return "dm pair not sorted";
  const known = new Set(this.allAgents().map((r) => r.agent));
  if (!known.has(a) || !known.has(b)) return "unknown channel";
  if (agent !== a && agent !== b) return "not a party of this channel";
  return null;
}

export function rlCheck(this: IBusDO, agent: string): boolean {
  const [limit, window] = RATE_LIMITS[agent] || DEFAULT_RATE;
  const now = Date.now() / 1000;
  const hits = (this.rateLimit.get(agent) || []).filter((t) => now - t < window);
  if (hits.length >= limit) {
    this.rateLimit.set(agent, hits);
    return false;
  }
  hits.push(now);
  this.rateLimit.set(agent, hits);
  return true;
}

export function churnCheck(this: IBusDO, agent: string): boolean {
  const now = Date.now() / 1000;
  const hits = (this.churn.get(agent) || []).filter((t) => now - t < CHURN_WINDOW);
  hits.push(now);
  this.churn.set(agent, hits);
  return hits.length <= CHURN_LIMIT;
}

export async function handleAgents(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const agents = (
    this.sql.exec("SELECT agent, created FROM agents ORDER BY agent").toArray() as Array<{
      agent: string;
      created: string;
    }>
  ).map((r) => ({ agent: r.agent, created: r.created }));
  return this.json(200, { agents });
}

// POST /reg — register a new agent. Body: {agent: "name"}.
// Auth: admin token (X-Admin-Token), NOT a regular agent token.
export async function handleReg(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkAdminDrain(req))) return this.json(401, { error: "unauthorized" });
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid JSON" });
  }
  const payload = data as Record<string, unknown> | null;
  const name = payload?.agent;
  if (typeof name !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(name)) {
    return this.json(400, {
      error: "agent must be 1-32 chars of [A-Za-z0-9_]",
    });
  }
  const exists = this.sql.exec("SELECT 1 FROM agents WHERE agent = ?", name).toArray();
  if (exists.length) return this.json(409, { error: "agent already registered" });
  const token = crypto.randomUUID().replace(/-/g, "");
  this.sql.exec("INSERT INTO agents (agent, secret, created) VALUES (?, ?, ?)", name, token, utcnow());
  // New agents join all-agent automatically (poll rev 3).
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    this.sql.exec(
      `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('all-agent', ?, 'system', ?)`,
      name,
      nowSec
    );
  } catch {}
  this.emitEvent("agent.registered", { actor: "admin", scope: "admin", payload: { agent: name } });
  return this.json(200, { ok: true, agent: name, token });
}

export async function handleAdminAgents(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkAdminDrain(req))) return this.json(401, { error: "unauthorized" });
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid JSON" });
  }
  const payload = data as Record<string, unknown> | null;
  const agents = payload?.agents;
  if (!Array.isArray(agents)) return this.json(400, { error: "agents must be an array" });
  for (const a of agents) {
    const agentItem = a as Record<string, unknown> | null;
    if (
      !agentItem ||
      typeof agentItem.agent !== "string" ||
      typeof agentItem.secret !== "string" ||
      !agentItem.agent ||
      !agentItem.secret
    ) {
      return this.json(400, { error: "each agent needs {agent, secret}" });
    }
    this.sql.exec(
      "INSERT INTO agents (agent, secret, created) VALUES (?, ?, ?) ON CONFLICT(agent) DO UPDATE SET secret=excluded.secret",
      agentItem.agent,
      agentItem.secret,
      utcnow()
    );
    // Imported agents join all-agent too (poll rev 3).
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      this.sql.exec(
        `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('all-agent', ?, 'system', ?)`,
        agentItem.agent,
        nowSec
      );
    } catch {}
  }
  return this.json(200, { ok: true, count: agents.length });
}

export async function handleAdminApiAgents(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  // Reuse the same logic as /list but without requiring agent auth.
  const byAgent = new Map<
    string,
    { agent: string; channels: Set<string>; connectedSince: string | null; connections: number }
  >();
  for (const ws of this.state.getWebSockets()) {
    let att: WebSocketAttachment | null = null;
    try {
      att = ws.deserializeAttachment() as WebSocketAttachment | null;
    } catch {
      continue;
    }
    if (!att || !att.agent) continue;
    const entry = byAgent.get(att.agent) || {
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

export async function handleAdminApiRegistered(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const rows = this.sql
    .exec("SELECT agent, created, last_seen FROM agents ORDER BY agent")
    .toArray() as Array<{ agent: string; created: string; last_seen?: string | null }>;
  const agents: Array<{
    agent: string;
    created: string;
    last_seen: string | null;
    rate?: { used: number; limit: number; windowSec: number };
    transport?: 'ws' | 'poll';
  }> = rows.map((r) => ({ agent: r.agent, created: r.created, last_seen: r.last_seen || null }));

  // Attach rate-limit usage: [used, limit, windowSec].
  const now = Math.floor(Date.now() / 1000);
  for (const a of agents) {
    const [limit, windowSec] = RATE_LIMITS[a.agent] || DEFAULT_RATE;
    const stamps = (this.rateLimit.get(a.agent) || []).filter((t) => t > now - windowSec);
    a.rate = { used: stamps.length, limit, windowSec };
  }
  // Attach transport: "ws" if connected, else "poll".
  const connected = new Set<string>();
  for (const ws of this.state.getWebSockets()) {
    try {
      const att = ws.deserializeAttachment() as WebSocketAttachment | null;
      if (att && att.agent) connected.add(att.agent);
    } catch {}
  }
  for (const a of agents) a.transport = connected.has(a.agent) ? "ws" : "poll";
  return this.json(200, { agents });
}

// POST /admin/api/agents — register a new agent, returns the secret (shown once).
export async function handleAdminApiAgentRegister(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = body as Record<string, unknown> | null;
  const name = typeof payload?.agent === "string" ? payload.agent.trim() : "";
  if (!name || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
    return this.json(400, { error: "invalid agent name (lowercase alnum, _-, max 32)" });
  }
  const exists = this.sql.exec("SELECT 1 FROM agents WHERE agent = ?", name).toArray();
  if (exists.length > 0) return this.json(409, { error: "agent already registered" });
  // Generate a secure random secret.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const secret =
    btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "x".repeat(32);
  const created = new Date().toISOString();
  this.sql.exec("INSERT INTO agents (agent, secret, created) VALUES (?, ?, ?)", name, secret, created);
  // New agents join all-agent automatically (poll rev 3).
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    this.sql.exec(
      `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES ('all-agent', ?, 'system', ?)`,
      name,
      nowSec
    );
  } catch {}
  this.emitEvent("agent.registered", { actor: "admin", scope: "admin", payload: { agent: name } });
  return this.json(200, { ok: true, agent: name, secret, created });
}

// DELETE /admin/api/agents/:agent — delete an agent. Their old messages stay.
export async function handleAdminApiAgentDelete(this: IBusDO, req: Request, name: string): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  const exists = this.sql.exec("SELECT 1 FROM agents WHERE agent = ?", name).toArray();
  if (exists.length === 0) return this.json(404, { error: "agent not found" });
  this.sql.exec("DELETE FROM agents WHERE agent = ?", name);
  // Drop channel memberships (keeps member lists accurate).
  try {
    this.sql.exec("DELETE FROM channel_members WHERE agent = ?", name);
  } catch {}
  // Close any open WebSockets for this agent.
  for (const ws of this.state.getWebSockets()) {
    try {
      const att = ws.deserializeAttachment() as WebSocketAttachment | null;
      if (att && att.agent === name) ws.close(1008, "agent deleted");
    } catch {}
  }
  this.emitEvent("agent.deregistered", { actor: "admin", scope: "admin", payload: { agent: name } });
  return this.json(200, { ok: true, agent: name });
}

// POST /admin/api/agents/:agent/rotate — issue a new secret (shown once). Old stops working.
export async function handleAdminApiAgentRotate(this: IBusDO, req: Request, name: string): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  const exists = this.sql.exec("SELECT 1 FROM agents WHERE agent = ?", name).toArray();
  if (exists.length === 0) return this.json(404, { error: "agent not found" });
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const secret =
    btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32) || "x".repeat(32);
  this.sql.exec("UPDATE agents SET secret = ? WHERE agent = ?", secret, name);
  // Payload MUST NOT contain token material (poll rev 3) — the agent learns
  // its own revocation via 401.
  this.emitEvent("agent.token_issued", { actor: "admin", scope: "admin", payload: { agent: name } });
  return this.json(200, { ok: true, agent: name, secret });
}
