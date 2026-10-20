// Message send, edit, delete, and import/export
import { BODY_CAP, PRIORITIES, AUDIENCES, utcnow } from '../utils.js';
import type { IBusDO, MessageRecord, AgentRecord } from '../types.js';

export async function handleSend(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid JSON" });
  }
  // Body is consumed before the rate-limit check for the same reason.
  if (!this.rlCheck(agent)) return this.json(429, { error: "rate limited" });
  if (!data || typeof data !== "object") return this.json(400, { error: "invalid JSON" });
  const payload = data as Record<string, unknown>;
  const channel = typeof payload.channel === "string" ? payload.channel : "";
  const body = payload.body;
  const chanErr = this.validateChannel(agent, channel);
  if (chanErr) return this.json(400, { error: chanErr });
  if (typeof body !== "string" || !body) return this.json(400, { error: "body required" });
  if (new TextEncoder().encode(body).length > BODY_CAP) {
    return this.json(413, { error: "body too large (max 8192 bytes)" });
  }
  let priority = payload.priority;
  if (priority === undefined || priority === null || priority === "") {
    priority = agent === "wren" ? "low" : "normal";
  }
  if (typeof priority !== "string" || !PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
    return this.json(400, { error: "priority must be low|normal|urgent" });
  }
  let audience = payload.audience;
  if (audience === undefined || audience === null || audience === "") {
    audience = "agents";
  }
  if (typeof audience !== "string" || !AUDIENCES.includes(audience as (typeof AUDIENCES)[number])) {
    return this.json(400, { error: "audience must be agents|luki" });
  }

  // reply_to (API-SPEC-FULL §1.1, locked with kanban rev 4): must exist and
  // be in the same channel. Immutable once set. Validated BEFORE any
  // channel auto-creation side effects.
  let replyTo = payload.reply_to;
  if (replyTo === undefined || replyTo === null || replyTo === "") {
    replyTo = null;
  } else {
    if (typeof replyTo !== "number" || !Number.isInteger(replyTo)) {
      return this.json(400, { error: "reply_to must be an integer message id" });
    }
    const targetRows = this.sql
      .exec(`SELECT channel FROM messages WHERE id = ?`, replyTo)
      .toArray() as Array<{ channel: string }>;
    const target = targetRows[0];
    if (!target) return this.json(400, { error: "reply_to message not found" });
    if (target.channel !== channel) return this.json(400, { error: "reply_to must be in the same channel" });
  }

  // Channel send permission (poll rev 3): members + DM parties.
  // Sending to a valid non-existent custom channel auto-creates it with the
  // sender as creator (preserves implicit behavior) + channel.created event.
  this.ensureChannelRow(channel, agent);
  if (!this.canSendToChannel(agent, channel)) {
    return this.json(403, { error: "not a member of channel" });
  }

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
  ) as { toArray(): Array<{ id: number }> };
  const id = cursor.toArray()[0]!.id;
  const message = { id, sender: agent, channel, priority, audience, ts, body, reply_to: replyTo };
  this.emitEvent("bus.message", {
    actor: agent,
    scope: "channel:" + channel,
    payload: message,
  });

  // Push to subscribed sockets in the same wake (spec §2.5).
  const frame = JSON.stringify({ op: "msg", message });
  for (const ws of this.state.getWebSockets("ch:" + channel)) {
    try {
      const att = ws.deserializeAttachment() as { channels?: string[] } | null;
      if (att && Array.isArray(att.channels) && att.channels.includes(channel)) {
        ws.send(frame);
      }
    } catch {
      // dead socket; hibernation cleans it up
    }
  }
  return this.json(200, { ok: true, id });
}

export async function handleAdminImport(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkAdminDrain(req))) return this.json(401, { error: "unauthorized" });
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid JSON" });
  }
  const payload = data as Record<string, unknown> | null;
  const messages = payload?.messages;
  if (!Array.isArray(messages)) return this.json(400, { error: "messages must be an array" });
  const known = new Set(this.allAgents().map((r) => r.agent));
  let count = 0;
  for (const m of messages) {
    const item = m as Record<string, unknown> | null;
    if (
      !item ||
      typeof item.id !== "number" ||
      typeof item.sender !== "string" ||
      typeof item.channel !== "string" ||
      typeof item.ts !== "string" ||
      typeof item.body !== "string"
    ) {
      return this.json(400, { error: "each message needs {id, sender, channel, ts, body}" });
    }
    if (!known.has(item.sender)) return this.json(400, { error: "unknown sender: " + item.sender });
    const priority =
      typeof item.priority === "string" && PRIORITIES.includes(item.priority as (typeof PRIORITIES)[number])
        ? item.priority
        : "normal";
    const audience =
      typeof item.audience === "string" && AUDIENCES.includes(item.audience as (typeof AUDIENCES)[number])
        ? item.audience
        : "agents";
    this.sql.exec(
      "INSERT INTO messages (id, sender, channel, priority, audience, ts, body) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
      item.id,
      item.sender,
      item.channel,
      priority,
      audience,
      item.ts,
      item.body
    );
    count++;
  }
  // Fix the AUTOINCREMENT sequence so new sends continue after MAX(id).
  this.sql.exec("UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM messages) WHERE name = 'messages'");
  return this.json(200, { ok: true, imported: count });
}

export async function handleAdminExport(this: IBusDO, req: Request): Promise<Response> {
  if (!this.checkAdmin(req)) return this.json(401, { error: "unauthorized" });
  const messages = this.sql
    .exec("SELECT id, sender, channel, priority, audience, ts, body FROM messages ORDER BY id ASC")
    .toArray() as MessageRecord[];
  const agents = this.sql.exec("SELECT agent, created FROM agents").toArray() as AgentRecord[];
  return this.json(200, { messages, agents });
}

export async function handleAdminApiMessages(this: IBusDO, req: Request, url: URL): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const channel = url.searchParams.get("channel") || null;
  const sender = url.searchParams.get("sender") || null;
  const priority = url.searchParams.get("priority") || null;
  const q = url.searchParams.get("q") || null;
  const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
  let limit = parseInt(url.searchParams.get("limit") || "50", 10) || 50;
  limit = Math.min(Math.max(limit, 1), 200);
  let sql = "SELECT id, sender, channel, priority, audience, ts, body FROM messages WHERE id > ?";
  const params: (string | number)[] = [since];
  if (channel) {
    sql += " AND channel = ?";
    params.push(channel);
  }
  if (sender) {
    sql += " AND sender = ?";
    params.push(sender);
  }
  if (priority && PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
    sql += " AND priority = ?";
    params.push(priority);
  }
  if (q) {
    sql += " AND body LIKE ?";
    params.push("%" + q.replace(/[%_]/g, "") + "%");
  }
  sql += " ORDER BY id DESC LIMIT ?";
  params.push(limit);
  const messages = this.sql.exec(sql, ...params).toArray() as MessageRecord[];
  return this.json(200, { messages });
}

export async function handleAdminApiSend(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = body as Record<string, unknown> | null;
  const channel = payload?.channel;
  const text = payload?.body;
  if (!channel || typeof channel !== "string" || !text || typeof text !== "string") {
    return this.json(400, { error: "channel and body required" });
  }
  if (text.length > BODY_CAP) {
    return this.json(400, { error: "body too long" });
  }
  const priority =
    typeof payload?.priority === "string" && PRIORITIES.includes(payload.priority as (typeof PRIORITIES)[number])
      ? payload.priority
      : "normal";
  const audience =
    typeof payload?.audience === "string" && AUDIENCES.includes(payload.audience as (typeof AUDIENCES)[number])
      ? payload.audience
      : "agents";
  if (channel === "all-agent") {
    /* always valid */
  } else if (channel.startsWith("dm:")) {
    const dm = /^dm:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$/.exec(channel);
    if (!dm) return this.json(400, { error: "invalid dm channel" });
    this.ensureChannelRow(channel, "luki");
  } else {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel)) {
      return this.json(400, { error: "invalid channel name" });
    }
    this.ensureChannelRow(channel, "admin");
  }

  let replyTo = payload?.reply_to;
  if (replyTo === undefined || replyTo === null || replyTo === "") {
    replyTo = null;
  } else {
    if (typeof replyTo !== "number" || !Number.isInteger(replyTo)) {
      return this.json(400, { error: "reply_to must be an integer message id" });
    }
    const targetRows = this.sql
      .exec(`SELECT channel FROM messages WHERE id = ?`, replyTo)
      .toArray() as Array<{ channel: string }>;
    const target = targetRows[0];
    if (!target) return this.json(400, { error: "reply_to message not found" });
    if (target.channel !== channel) return this.json(400, { error: "reply_to must be in the same channel" });
  }
  const ts = new Date().toISOString();
  // Sender is ALWAYS "luki" — client-supplied sender is ignored.
  const row = this.sql
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
    .one() as { id: number };
  const id = row.id;

  const msg = { id, sender: "luki", channel, priority, audience, ts, body: text, reply_to: replyTo };
  const wsPayload = JSON.stringify({ op: "msg", message: msg });
  for (const ws of this.state.getWebSockets("ch:" + channel)) {
    try {
      const att = ws.deserializeAttachment() as { channels?: string[] } | null;
      if (att && Array.isArray(att.channels) && att.channels.includes(channel)) {
        ws.send(wsPayload);
      }
    } catch {
      // dead socket; hibernation cleans it up
    }
  }
  this.emitEvent("bus.message", {
    actor: "admin",
    scope: "channel:" + channel,
    payload: msg,
  });
  return this.json(200, { ok: true, id });
}

export async function handleAdminApiMessageDelete(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  const rows = this.sql.exec("SELECT channel FROM messages WHERE id = ?", id).toArray() as Array<{ channel: string }>;
  const exists = rows[0];
  if (!exists) return this.json(404, { error: "message not found" });
  this.sql.exec("DELETE FROM messages WHERE id = ?", id);
  this.emitEvent("bus.message.deleted", {
    actor: "admin",
    scope: "channel:" + exists.channel,
    payload: { id },
  });
  return this.json(200, { ok: true, id });
}

export async function handleAdminApiMessageEdit(this: IBusDO, req: Request, id: number): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const exists = this.sql.exec("SELECT 1 FROM messages WHERE id = ?", id).toArray();
  if (exists.length === 0) return this.json(404, { error: "message not found" });
  const updates: string[] = [];
  const vals: (string | number)[] = [];
  if (typeof payload?.body === "string" && payload.body.length > 0) {
    updates.push("body = ?");
    vals.push(payload.body);
  }
  if (typeof payload?.priority === "string" && ["low", "normal", "urgent"].includes(payload.priority)) {
    updates.push("priority = ?");
    vals.push(payload.priority);
  }
  if (typeof payload?.channel === "string" && payload.channel.length > 0) {
    updates.push("channel = ?");
    vals.push(payload.channel);
  }
  if (updates.length === 0) return this.json(400, { error: "nothing to update" });
  vals.push(id);
  this.sql.exec(`UPDATE messages SET ${updates.join(", ")} WHERE id = ?`, ...vals);
  const chanRows = this.sql.exec(`SELECT channel FROM messages WHERE id = ?`, id).toArray() as Array<{ channel: string }>;
  const chanRow = chanRows[0];
  this.emitEvent("bus.message.edited", {
    actor: "admin",
    scope: "channel:" + (chanRow ? chanRow.channel : "all-agent"),
    payload: { id, body: typeof payload?.body === "string" && payload.body.length > 0 ? payload.body : undefined },
  });
  return this.json(200, { ok: true, id });
}
