// Agent management routes

export async function matchAgentsRoute(bus, req, url, path) {
  if (path === "/list" && req.method === "GET")
    return bus.handleList(req);
  if (path === "/agents" && req.method === "GET")
    return bus.handleAgents(req);
  if (path === "/reg" && req.method === "POST")
    return bus.handleReg(req);
  if (path === "/admin/agents" && req.method === "POST")
    return bus.handleAdminAgents(req);
  if (path === "/admin/api/agents" && req.method === "GET")
    return bus.handleAdminApiAgents(req);
  if (path === "/admin/api/registered" && req.method === "GET")
    return bus.handleAdminApiRegistered(req);
  if (path === "/admin/api/agents" && req.method === "POST")
    return bus.handleAdminApiAgentRegister(req);
  {
    const m = /^\/admin\/api\/agents\/([^/]+)$/.exec(path);
    if (m && req.method === "DELETE")
      return bus.handleAdminApiAgentDelete(req, decodeURIComponent(m[1]));
  }
  {
    const m = /^\/admin\/api\/agents\/([^/]+)\/rotate$/.exec(path);
    if (m && req.method === "POST")
      return bus.handleAdminApiAgentRotate(req, decodeURIComponent(m[1]));
  }
  return null;
}
