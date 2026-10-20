// Unified poll (rev 3), legacy poll, and WebSocket handlers
import { dmChannel, utcnow } from '../utils.js';

export async function handlePoll(req, url) {
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
export async function handlePollNew(url, agent, isAdmin) {
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
export async function handlePollLegacy(url, agent) {
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

export async function handleWs(req, url) {
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

export async function webSocketMessage(ws, message) {
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

export async function webSocketClose(ws, code, reason, wasClean) {
    // Emit agent.offline (best-effort; attachment may be gone under hibernation).
    try {
      const att = ws.deserializeAttachment();
      if (att && att.agent) {
        this.emitEvent("agent.offline", { actor: att.agent, scope: "all", payload: { agent: att.agent } });
      }
    } catch {}
  }

export async function webSocketError(ws, error) {
    try {
      ws.close(1011, "error");
    } catch {}
  }

