// Channel management (poll rev 3)
import type { IBusDO, ChannelRecord } from '../types.js';

export function ensureChannelRow(this: IBusDO, channel: string, sender: string): string {
  if (channel === "all-agent") return "system";
  if (channel.startsWith("dm:")) {
    const now = this.kbNow();
    this.sql.exec(
      `INSERT OR IGNORE INTO channels (name, created_by, created_at) VALUES (?, 'system', ?)`,
      channel,
      now
    );
    const parts = channel.split(":");
    for (const p of [parts[1], parts[2]]) {
      if (p) {
        this.sql.exec(
          `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, 'system', ?)`,
          channel,
          p,
          now
        );
      }
    }
    return "system";
  }
  const rows = this.sql
    .exec(`SELECT created_by FROM channels WHERE name = ?`, channel)
    .toArray() as Array<{ created_by: string }>;
  const row = rows[0];
  if (row) return row.created_by;
  const now = this.kbNow();
  this.sql.exec(`INSERT INTO channels (name, created_by, created_at) VALUES (?, ?, ?)`, channel, sender, now);
  this.sql.exec(
    `INSERT INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`,
    channel,
    sender,
    sender,
    now
  );
  this.emitEvent("channel.created", { actor: sender, scope: "all", payload: { channel, created_by: sender } });
  return sender;
}

// Can this agent SEND to this channel? Members + DM parties. (Admin bypasses.)
export function canSendToChannel(this: IBusDO, agent: string, channel: string): boolean {
  if (channel === "all-agent") return true;
  if (channel.startsWith("dm:")) {
    const m = /^dm:([A-Za-z0-9_]+):([A-Za-z0-9_]+)$/.exec(channel || "");
    return !!m && (m[1] === agent || m[2] === agent);
  }
  const row = this.sql
    .exec(`SELECT 1 FROM channel_members WHERE channel = ? AND agent = ?`, channel, agent)
    .toArray();
  return row.length > 0;
}

export async function handleAdminApiChannels(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const rows = this.sql
    .exec("SELECT DISTINCT channel FROM messages ORDER BY channel")
    .toArray() as Array<{ channel: string }>;
  const channels: Array<{ name: string; members: string[] }> = [];
  for (const r of rows) {
    const name = r.channel;
    let members: string[] = [];
    try {
      members = (
        this.sql
          .exec("SELECT agent FROM channel_members WHERE channel = ? ORDER BY agent", name)
          .toArray() as Array<{ agent: string }>
      ).map((m) => m.agent);
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
export async function handleAdminApiSenders(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const rows = this.sql
    .exec("SELECT DISTINCT sender FROM messages ORDER BY sender")
    .toArray() as Array<{ sender: string }>;
  return this.json(200, { senders: rows.map((r) => r.sender) });
}

export async function handleAdminApiChannelDelete(this: IBusDO, req: Request, name: string): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text(); // drain body
  } catch {}
  if (name === "all-agent" || name.startsWith("dm:")) {
    return this.json(400, { error: "cannot delete all-agent or dm channels" });
  }
  const rows = this.sql
    .exec("SELECT COUNT(*) as n FROM messages WHERE channel = ?", name)
    .toArray() as Array<{ n: number }>;
  const count = rows[0]?.n ?? 0;
  this.sql.exec("DELETE FROM messages WHERE channel = ?", name);
  this.sql.exec("DELETE FROM channels WHERE name = ?", name); // cascades channel_members
  this.emitEvent("channel.deleted", { actor: "admin", scope: "all", payload: { channel: name } });
  return this.json(200, { ok: true, channel: name, deleted: count });
}

// Shared create logic. Returns {ok, name} or {error, code}.
export function kbChannelCreate(
  this: IBusDO,
  name: unknown,
  creator: string
): { ok?: true; name?: string; error?: string; code: number } {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) {
    return { error: "invalid channel name", code: 400 };
  }
  if (name === "all-agent" || name.startsWith("dm:")) {
    return { error: "reserved channel name", code: 400 };
  }
  const exists = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
  if (exists.length) return { error: "channel already exists", code: 409 };
  const now = this.kbNow();
  this.sql.exec(`INSERT INTO channels (name, created_by, created_at) VALUES (?, ?, ?)`, name, creator, now);
  this.sql.exec(
    `INSERT INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`,
    name,
    creator,
    creator,
    now
  );
  this.emitEvent("channel.created", { actor: creator, scope: "all", payload: { channel: name, created_by: creator } });
  return { ok: true, name, code: 200 };
}

// POST /api/channels — agent creates a channel. Body {name}.
export async function handleApiChannelCreate(this: IBusDO, req: Request): Promise<Response> {
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
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const r = this.kbChannelCreate(payload?.name, agent);
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true, name: r.name });
}

// POST /admin/api/channels — admin creates a channel. Body {name}.
export async function handleAdminApiChannelCreate(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const r = this.kbChannelCreate(payload?.name, "admin");
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true, name: r.name });
}

// Shared add-member logic. addedBy = actor name for the event/audit.
export function kbChannelAddMember(
  this: IBusDO,
  name: string,
  agentName: string,
  addedBy: string
): { ok?: true; channel?: string; agent?: string; error?: string; code: number } {
  const chan = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
  if (!chan.length) return { error: "channel not found", code: 404 };
  if (name === "all-agent") return { error: "all-agent membership is automatic", code: 400 };
  if (name.startsWith("dm:")) return { error: "dm channels are system-managed", code: 400 };
  const ag = this.sql.exec(`SELECT 1 FROM agents WHERE agent = ?`, agentName).toArray();
  if (!ag.length) return { error: "agent not registered", code: 404 };
  const now = this.kbNow();
  const res = this.sql.exec(
    `INSERT OR IGNORE INTO channel_members (channel, agent, added_by, added_at) VALUES (?, ?, ?, ?)`,
    name,
    agentName,
    addedBy,
    now
  ) as { rowsWritten?: number };
  if ((res.rowsWritten ?? 0) > 0) {
    this.emitEvent("channel.member_added", {
      actor: addedBy,
      scope: "channel:" + name,
      payload: { channel: name, agent: agentName },
    });
  }
  return { ok: true, channel: name, agent: agentName, code: 200 };
}

// POST /admin/api/channels/:name/members — admin adds a member. Body {agent}.
export async function handleAdminApiChannelMemberAdd(this: IBusDO, req: Request, name: string): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const agentName = typeof payload?.agent === "string" ? payload.agent : "";
  if (!agentName) return this.json(400, { error: "agent required" });
  const r = this.kbChannelAddMember(name, agentName, "admin");
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true, channel: r.channel, agent: r.agent });
}

// POST /api/channels/:name/members — channel creator (or admin) adds a member.
export async function handleApiChannelMemberAdd(this: IBusDO, req: Request, name: string): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  const rows = this.sql.exec(`SELECT created_by FROM channels WHERE name = ?`, name).toArray() as unknown as ChannelRecord[];
  const chan = rows[0];
  if (!chan) return this.json(404, { error: "channel not found" });
  if (chan.created_by !== agent) {
    return this.json(403, { error: "only the channel creator or admin can add members" });
  }
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return this.json(400, { error: "invalid json" });
  }
  const payload = data as Record<string, unknown> | null;
  const agentName = typeof payload?.agent === "string" ? payload.agent : "";
  if (!agentName) return this.json(400, { error: "agent required" });
  const r = this.kbChannelAddMember(name, agentName, agent);
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true, channel: r.channel, agent: r.agent });
}

// Shared remove-member logic.
export function kbChannelRemoveMember(
  this: IBusDO,
  name: string,
  agentName: string,
  removedBy: string
): { ok?: true; channel?: string; agent?: string; error?: string; code: number } {
  const chan = this.sql.exec(`SELECT 1 FROM channels WHERE name = ?`, name).toArray();
  if (!chan.length) return { error: "channel not found", code: 404 };
  if (name === "all-agent") return { error: "cannot leave all-agent", code: 400 };
  if (name.startsWith("dm:")) return { error: "dm channels are system-managed", code: 400 };
  const res = this.sql.exec(
    `DELETE FROM channel_members WHERE channel = ? AND agent = ?`,
    name,
    agentName
  ) as { rowsWritten?: number };
  if ((res.rowsWritten ?? 0) > 0) {
    this.emitEvent("channel.member_removed", {
      actor: removedBy,
      scope: "channel:" + name,
      payload: { channel: name, agent: agentName },
    });
  }
  return { ok: true, channel: name, agent: agentName, code: 200 };
}

// DELETE /api/channels/:name/members/:agent — self-remove only.
export async function handleApiChannelMemberRemove(
  this: IBusDO,
  req: Request,
  name: string,
  agentName: string
): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: "unauthorized" });
  }
  try {
    await req.text();
  } catch {}
  if (agentName !== agent) {
    return this.json(403, { error: "agents can only remove themselves (admin removes others)" });
  }
  const r = this.kbChannelRemoveMember(name, agentName, agent);
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true, channel: r.channel, agent: r.agent });
}

// DELETE /admin/api/channels/:name/members/:agent — admin removes a member.
export async function handleAdminApiChannelMemberRemove(
  this: IBusDO,
  req: Request,
  name: string,
  agentName: string
): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  try {
    await req.text();
  } catch {}
  const r = this.kbChannelRemoveMember(name, agentName, "admin");
  if (r.error) return this.json(r.code, { error: r.error });
  return this.json(200, { ok: true, channel: r.channel, agent: r.agent });
}
