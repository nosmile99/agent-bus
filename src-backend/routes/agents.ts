// Agent management routes with Hono
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';

export function createAgentsRouter(bus: IBusDO): Hono {
  const router = new Hono();

  router.get('/list', (c) => bus.handleList(c.req.raw));
  router.get('/agents', (c) => bus.handleAgents(c.req.raw));
  router.post('/reg', (c) => bus.handleReg(c.req.raw));
  router.post('/admin/agents', (c) => bus.handleAdminAgents(c.req.raw));
  router.get('/admin/api/agents', (c) => bus.handleAdminApiAgents(c.req.raw));
  router.get('/admin/api/registered', (c) => bus.handleAdminApiRegistered(c.req.raw));
  router.post('/admin/api/agents', (c) => bus.handleAdminApiAgentRegister(c.req.raw));
  router.delete('/admin/api/agents/:agent', (c) => bus.handleAdminApiAgentDelete(c.req.raw, c.req.param('agent')));
  router.post('/admin/api/agents/:agent/rotate', (c) =>
    bus.handleAdminApiAgentRotate(c.req.raw, c.req.param('agent'))
  );

  return router;
}
