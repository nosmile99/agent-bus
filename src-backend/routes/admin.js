// Admin routes (panel, logout, stats, password)

export async function matchAdminRoute(bus, req, url, path) {
  // --- Admin panel (Ryuki #268, Basic auth, separate realm) ---
  // /panel is a cache-busting alias for /admin (Ryuki 2026-10-17).
  if ((path === "/admin" || path === "/panel") && req.method === "GET")
    return bus.handleAdminPanel(req);

  // /logout — static logged-out page (auth lives in panel JS sessionStorage).
  if (path === "/logout" && req.method === "GET")
    return new Response(
      '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logged out</title>' +
      '<style>body{background:#0f0f13;color:#e8e8ea;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
      'a{color:#7c6cf0}</style></head><body><div style="text-align:center">' +
      '<h2>👑 Logged out</h2><p>Session cleared. <a href="/panel">Back to panel</a></p></div></body></html>',
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
    );

  if (path === "/admin/api/stats" && req.method === "GET")
    return bus.handleAdminApiStats(req);

  // --- Admin password change (Ryuki #286) ---
  if (path === "/admin/api/password" && req.method === "POST")
    return bus.handleAdminApiPassword(req);

  return null;
}
