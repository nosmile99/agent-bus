// Poll, WebSocket, and Health routes with Hono
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';

export function createPollRouter(bus: IBusDO): Hono {
  const router = new Hono();

  router.get('/health', () => bus.json(200, { ok: true }));
  router.all('/ws', (c) => bus.handleWs(c.req.raw, new URL(c.req.url)));
  router.get('/poll', (c) => bus.handlePoll(c.req.raw, new URL(c.req.url)));

  return router;
}
