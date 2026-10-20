// Channel management (poll rev 3)
import { dmChannel } from '../utils.js';

export function ensureChannelRow(channel, sender) {
    if (channel === "all-agent") return "system";
    if (channel.startsWith("dm:")) {
      const now = this.kbNow();
      this.sql.exec(`INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES (?, 'system', ?)`, channel, now);
      const parts = channel.split(":");
      for (const p of [parts[1], parts[2]]) {
        if (p) this.sql.exec(`INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, 'system', ?)`, channel, p, now);
      }
      return "system";
    }
    const row = this.sql.exec(`SELECT created_by FROM channels WHERE name = ?`, channel).toArray()[0];
    if (row) return row.created_by;
    const now = this.kbNow();
    this.sql.exec(`INSERT INTO channels (name, created_by, created_at) VALUES (?, ?, ?)`, channel, sender, now);
    this.sql.exec(`INSERT INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`, channel, sender, sender, now);
    this.emitEvent("channel.created", { actor: sender, scope: "all", payload: { channel, created_by: sender } });
    return sender;
  }

  // Can this agent SEND to this channel? Members + DM parties. (Admin bypasses.)
export function canSendToChannel(agent, channel) {
    if (channel === "all-agent") return true;
    if (channel.startsWith("dm:")) {
      const m = /^dm:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$/.exec(channel || "");
      return !!m && (m[1] === agent || m[2] === agent);
    }
    const row = this.sql.exec(`SELECT 1 FROM channel_members WHERE channel = ? AND agent = ?`, channel, agent).toArray();
    return row.length > 0;
  }


export async function handleAdminApiChannels(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const rows = this.sql.exec("SELECT DISTINCT channel FROM messages ORDER BY channel").toArray();
    const channels = [];
    for (const r of rows) {
      const name = r.channel;
      let members = [];
      try {
        members = this.sql.exec("SELECT agent FROM channel_members WHERE channel = ? ORDER BY agent", name)
          .toArray().map((m) => m.agent);
      } catch {}
      // DM channels: members are the two parties
      if (!members.length && name.startsWith("dm:")) {
        members = name.split(":").slice(1);
      }
      channels.push({ name, members });
    }
    return this.json(200, { channels });
  }

  // GET /admin/api/senders — distinct sender list for the filter dropdown.
export async function handleAdminApiSenders(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    const rows = this.sql.exec("SELECT DISTINCT sender FROM messages ORDER BY sender").toArray();
    return this.json(200, { senders: rows.map((r) => r.sender) });
  }

  // GET /admin/api/registered — all registered agents (for the management table). Never secrets.

export async function handleAdminApiChannelDelete(req, name) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try {
      await req.text(); // drain body
    } catch {}
    if (name === "all-agent" || name.startsWith("dm:"))
      return this.json(400, { error: "cannot delete all-agent or dm channels" });
    const count = this.sql.exec("SELECT COUNT(*) as n FROM messages WHERE channel = ?", name).toArray()[0].n;
    this.sql.exec("DELETE FROM messages WHERE channel = ?", name);
    this.sql.exec("DELETE FROM channels WHERE name = ?", name); // cascades channel_members
    this.emitEvent("channel.deleted", { actor: "admin", scope: "all", payload: { channel: name } });
    return this.json(200, { ok: true, channel: name, deleted: count });
  }

  // ---------- Channel management (poll rev 3) ----------

  // Shared create logic. Returns {ok, name} or {error, code}.
export function kbChannelCreate(name, creator) {
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name))
      return { error: "invalid channel name", code: 400 };
    if (name === "all-agent" || name.startsWith("dm:"))
      return { error: "reserved channel name", code: 400 };
    const exists = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
    if (exists.length) return { error: "channel already exists", code: 409 };
    const now = this.kbNow();
    this.sql.exec(`INSERT INTO channels (name, created_by, created_at) VALUES (?, ?, ?)`, name, creator, now);
    this.sql.exec(`INSERT INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`, name, creator, creator, now);
    this.emitEvent("channel.created", { actor: creator, scope: "all", payload: { channel: name, created_by: creator } });
    return { ok: true, name };
  }

  // POST /api/channels — agent creates a channel. Body {name}.
export async function handleApiChannelCreate(req) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const r = this.kbChannelCreate(data && data.name, agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // POST /admin/api/channels — admin creates a channel. Body {name}.
export async function handleAdminApiChannelCreate(req) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const r = this.kbChannelCreate(data && data.name, "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // Shared add-member logic. addedBy = actor name for the event/audit.
export function kbChannelAddMember(name, agentName, addedBy) {
    const chan = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
    if (!chan.length) return { error: "channel not found", code: 404 };
    if (name === "all-agent") return { error: "all-agent membership is automatic", code: 400 };
    if (name.startsWith("dm:")) return { error: "dm channels are system-managed", code: 400 };
    const ag = this.sql.exec(`SELECT 1 FROM agents WHERE agent = ?`, agentName).toArray();
    if (!ag.length) return { error: "agent not registered", code: 404 };
    const now = this.kbNow();
    const res = this.sql.exec(
      `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`,
      name, agentName, addedBy, now
    );
    if (res.rowsWritten > 0) {
      this.emitEvent("channel.member_added", {
        actor: addedBy, scope: "channel:" + name, payload: { channel: name, agent: agentName },
      });
    }
    return { ok: true, channel: name, agent: agentName };
  }

  // POST /admin/api/channels/:name/members — admin adds a member. Body {agent}.
export async function handleAdminApiChannelMemberAdd(req, name) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const agentName = data && typeof data.agent === "string" ? data.agent : "";
    if (!agentName) return this.json(400, { error: "agent required" });
    const r = this.kbChannelAddMember(name, agentName, "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // POST /api/channels/:name/members — channel creator (or admin) adds a member.
export async function handleApiChannelMemberAdd(req, name) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    const chan = this.sql.exec(`SELECT created_by FROM channels WHERE name = ?`, name).toArray()[0];
    if (!chan) return this.json(404, { error: "channel not found" });
    if (chan.created_by !== agent) return this.json(403, { error: "only the channel creator or admin can add members" });
    let data;
    try { data = await req.json(); } catch { return this.json(400, { error: "invalid json" }); }
    const agentName = data && typeof data.agent === "string" ? data.agent : "";
    if (!agentName) return this.json(400, { error: "agent required" });
    const r = this.kbChannelAddMember(name, agentName, agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // DELETE /api/channels/:name/members/:agent — self-remove only.
  // (Admin removes others via the admin route. Plan permission: Self + admin.)
export async function handleApiChannelMemberRemove(req, name, agentName) {
    const agent = this.authedAgent(req);
    if (!agent) { try { await req.text(); } catch {} return this.json(401, { error: "unauthorized" }); }
    try { await req.text(); } catch {}
    if (agentName !== agent)
      return this.json(403, { error: "agents can only remove themselves (admin removes others)" });
    const r = this.kbChannelRemoveMember(name, agentName, agent);
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

  // Shared remove-member logic.
export function kbChannelRemoveMember(name, agentName, removedBy) {
    const chan = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
    if (!chan.length) return { error: "channel not found", code: 404 };
    if (name === "all-agent") return { error: "cannot leave all-agent", code: 400 };
    if (name.startsWith("dm:")) return { error: "dm channels are system-managed", code: 400 };
    const res = this.sql.exec(`DELETE FROM channel_members WHERE channel = ? AND agent = ?`, name, agentName);
    if (res.rowsWritten > 0) {
      this.emitEvent("channel.member_removed", {
        actor: removedBy, scope: "channel:" + name, payload: { channel: name, agent: agentName },
      });
    }
    return { ok: true, channel: name, agent: agentName };
  }

  // DELETE /admin/api/channels/:name/members/:agent — admin removes a member.
export async function handleAdminApiChannelMemberRemove(req, name, agentName) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    try { await req.text(); } catch {}
    const r = this.kbChannelRemoveMember(name, agentName, "admin");
    if (r.error) return this.json(r.code, { error: r.error });
    return this.json(200, r);
  }

