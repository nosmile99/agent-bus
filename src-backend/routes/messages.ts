// Message routes with Hono
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';

export function createMessagesRouter(bus: IBusDO): Hono {
  const router = new Hono();

  router.post('/send', (c) => bus.handleSend(c.req.raw));
  router.post('/admin/import', (c) => bus.handleAdminImport(c.req.raw));
  router.get('/admin/export', (c) => bus.handleAdminExport(c.req.raw));
  router.get('/admin/api/messages', (c) => bus.handleAdminApiMessages(c.req.raw, new URL(c.req.url)));
  router.post('/admin/api/send', (c) => bus.handleAdminApiSend(c.req.raw));
  router.delete('/admin/api/messages/:id{[0-9]+}', (c) =>
    bus.handleAdminApiMessageDelete(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.put('/admin/api/messages/:id{[0-9]+}', (c) =>
    bus.handleAdminApiMessageEdit(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  return router;
}
