// Poll, WebSocket, and Health routes

export async function matchPollRoute(bus, req, url, path) {
  if (path === "/health") return bus.json(200, { ok: true });
  if (path === "/ws") return bus.handleWs(req, url);
  if (path === "/poll" && req.method === "GET")
    return bus.handlePoll(req, url);
  return null;
}
