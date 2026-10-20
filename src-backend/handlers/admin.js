// Admin auth, cutover tooling, credentials, and stats
import { timingSafeEqual, sha256Hex } from '../utils.js';

export async function handleList(req) {
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

export function checkAdmin(req) {
    const token = req.headers.get("X-Admin-Token") || "";
    const expected = this.env.BUS_ADMIN_TOKEN || "";
    return expected !== "" && timingSafeEqual(token, expected);
  }

export async function checkAdminDrain(req) {
    // Admin auth failure: drain the body before the 401 (see handleSend).
    if (this.checkAdmin(req)) return true;
    try {
      await req.text();
    } catch {}
    return false;
  }


export async function checkBasicAuth(req) {
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

export async function unauthorizedBasic(req) {
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

export async function handleAdminApiStats(req) {
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

export async function handleAdminApiPassword(req) {
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
