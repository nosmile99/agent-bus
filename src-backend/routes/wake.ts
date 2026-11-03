// Amendment batch routes: wake bundle (13a), cutover (5), discovery (14).
// Handlers are imported directly and invoked with .call(bus, ...)
// because index.ts does not bind the wake handler module onto BusDO
// (see the routing note at the top of handlers/wake.ts).
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';
import {
  handleWake,
  handleDiscovery,
  handleCutoverGet,
  handleCutoverAdminGet,
  handleCutoverFlip,
  handleCutoverChecklistAppend,
} from '../handlers/wake.js';

export function createWakeRouter(bus: IBusDO): Hono {
  const router = new Hono();

  router.get('/api/wake', (c) => handleWake.call(bus, c.req.raw));
  router.get('/api/discovery', (c) => handleDiscovery.call(bus, c.req.raw));
  router.get('/api/cutover', (c) => handleCutoverGet.call(bus, c.req.raw));

  router.get('/admin/api/cutover', (c) => handleCutoverAdminGet.call(bus, c.req.raw));
  router.post('/admin/api/cutover/flip', (c) => handleCutoverFlip.call(bus, c.req.raw));
  router.post('/admin/api/cutover/checklist', (c) => handleCutoverChecklistAppend.call(bus, c.req.raw));

  return router;
}
