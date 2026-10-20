import { handleAdminPanel, handleAdminAppJs, handleAdminCss } from '../panel.js';
// Admin routes (panel, logout, stats, password) with Hono
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';

export function createAdminRouter(bus: IBusDO): Hono {
  const router = new Hono();

  // Admin panel (Ryuki #268, Basic auth, separate realm)
  // /panel is a cache-busting alias for /admin (Ryuki 2026-10-17)
  router.get('/admin', (c) => handleAdminPanel(c.req.raw));
  router.get('/panel', (c) => handleAdminPanel(c.req.raw));

  // Static assets for the modular frontend
  router.get('/js/app.js', () => handleAdminAppJs());
  router.get('/admin/js/app.js', () => handleAdminAppJs());
  router.get('/panel/js/app.js', () => handleAdminAppJs());
  router.get('/css/:file', (c) => handleAdminCss(c.req.param('file')));
  router.get('/admin/css/:file', (c) => handleAdminCss(c.req.param('file')));
  router.get('/panel/css/:file', (c) => handleAdminCss(c.req.param('file')));


  // /logout — static logged-out page (auth lives in panel JS sessionStorage).
  router.get('/logout', () => {
    return new Response(
      '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logged out</title>' +
        '<style>body{background:#0f0f13;color:#e8e8ea;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
        'a{color:#7c6cf0}</style></head><body><div style="text-align:center">' +
        '<h2>👑 Logged out</h2><p>Session cleared. <a href="/panel">Back to panel</a></p></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  });

  router.get('/admin/api/stats', (c) => bus.handleAdminApiStats(c.req.raw));
  router.post('/admin/api/password', (c) => bus.handleAdminApiPassword(c.req.raw));

  return router;
}
