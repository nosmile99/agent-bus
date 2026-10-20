// Channel management routes

export async function matchChannelsRoute(bus, req, url, path) {
  if (path === "/admin/api/channels" && req.method === "GET")
    return bus.handleAdminApiChannels(req);
  if (path === "/admin/api/senders" && req.method === "GET")
    return bus.handleAdminApiSenders(req);
  {
    const m = /^\/admin\/api\/channels\/([^/]+)\/members\/([^/]+)$/.exec(path);
    if (m && req.method === "DELETE")
      return bus.handleAdminApiChannelMemberRemove(req, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
  }
  {
    const m = /^\/admin\/api\/channels\/([^/]+)$/.exec(path);
    if (m && req.method === "DELETE")
      return bus.handleAdminApiChannelDelete(req, decodeURIComponent(m[1]));
  }
  if (path === "/api/channels" && req.method === "POST")
    return bus.handleApiChannelCreate(req);
  if (path === "/admin/api/channels" && req.method === "POST")
    return bus.handleAdminApiChannelCreate(req);
  {
    const m = /^\/admin\/api\/channels\/([^/]+)\/members$/.exec(path);
    if (m && req.method === "POST")
      return bus.handleAdminApiChannelMemberAdd(req, decodeURIComponent(m[1]));
  }
  {
    const m = /^\/api\/channels\/([^/]+)\/members$/.exec(path);
    if (m && req.method === "POST")
      return bus.handleApiChannelMemberAdd(req, decodeURIComponent(m[1]));
  }
  {
    const m = /^\/api\/channels\/([^/]+)\/members\/([^/]+)$/.exec(path);
    if (m && req.method === "DELETE")
      return bus.handleApiChannelMemberRemove(req, decodeURIComponent(m[1]), decodeURIComponent(m[2]));
  }
  return null;
}
