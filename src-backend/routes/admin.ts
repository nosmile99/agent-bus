// Admin routes (stats, password) with Hono
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';

export function createAdminRouter(bus: IBusDO): Hono {
  const router = new Hono();

  router.get('/admin/api/stats', (c) => bus.handleAdminApiStats(c.req.raw));
  router.post('/admin/api/password', (c) => bus.handleAdminApiPassword(c.req.raw));

  return router;
}
