// Message routes

export async function matchMessagesRoute(bus, req, url, path) {
  if (path === "/send" && req.method === "POST")
    return bus.handleSend(req);
  if (path === "/admin/import" && req.method === "POST")
    return bus.handleAdminImport(req);
  if (path === "/admin/export" && req.method === "GET")
    return bus.handleAdminExport(req);
  if (path === "/admin/api/messages" && req.method === "GET")
    return bus.handleAdminApiMessages(req, url);
  if (path === "/admin/api/send" && req.method === "POST")
    return bus.handleAdminApiSend(req);
  {
    const m = /^\/admin\/api\/messages\/(\d+)$/.exec(path);
    if (m && req.method === "DELETE")
      return bus.handleAdminApiMessageDelete(req, parseInt(m[1], 10));
    if (m && req.method === "PUT")
      return bus.handleAdminApiMessageEdit(req, parseInt(m[1], 10));
  }
  return null;
}
