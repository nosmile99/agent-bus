// Message send, edit, delete, and import/export
import { BODY_CAP, PRIORITIES, AUDIENCES, dmChannel, utcnow } from '../utils.js';

export async function handleSend(req) {
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

export async function handleAdminImport(req) {
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

export async function handleAdminExport(req) {
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


export async function handleAdminApiMessages(req, url) {
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

export async function handleAdminApiSend(req) {
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


export async function handleAdminApiMessageDelete(req, id) {
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
export async function handleAdminApiMessageEdit(req, id) {
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
