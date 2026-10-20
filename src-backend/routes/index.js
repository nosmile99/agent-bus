// Master router dispatcher
import { matchPollRoute } from './poll.js';
import { matchMessagesRoute } from './messages.js';
import { matchAgentsRoute } from './agents.js';
import { matchAdminRoute } from './admin.js';
import { matchChannelsRoute } from './channels.js';
import { matchKanbanRoute } from './kanban.js';

export async function dispatchRoute(bus, req) {
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    let res = await matchPollRoute(bus, req, url, path);
    if (res) return res;

    res = await matchMessagesRoute(bus, req, url, path);
    if (res) return res;

    res = await matchAgentsRoute(bus, req, url, path);
    if (res) return res;

    res = await matchAdminRoute(bus, req, url, path);
    if (res) return res;

    res = await matchChannelsRoute(bus, req, url, path);
    if (res) return res;

    res = await matchKanbanRoute(bus, req, url, path);
    if (res) return res;

    return bus.json(404, { error: "not found" });
  } catch (e) {
    return bus.json(500, { error: "internal: " + String(e && e.message || e) });
  }
}
