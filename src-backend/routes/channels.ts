// Channel management routes with Hono
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';

export function createChannelsRouter(bus: IBusDO): Hono {
  const router = new Hono();

  router.get('/admin/api/channels', (c) => bus.handleAdminApiChannels(c.req.raw));
  router.get('/admin/api/senders', (c) => bus.handleAdminApiSenders(c.req.raw));
  router.delete('/admin/api/channels/:channel/members/:agent', (c) =>
    bus.handleAdminApiChannelMemberRemove(c.req.raw, c.req.param('channel'), c.req.param('agent'))
  );
  router.delete('/admin/api/channels/:channel', (c) =>
    bus.handleAdminApiChannelDelete(c.req.raw, c.req.param('channel'))
  );
  router.post('/api/channels', (c) => bus.handleApiChannelCreate(c.req.raw));
  router.post('/admin/api/channels', (c) => bus.handleAdminApiChannelCreate(c.req.raw));
  router.post('/admin/api/channels/:channel/members', (c) =>
    bus.handleAdminApiChannelMemberAdd(c.req.raw, c.req.param('channel'))
  );
  router.post('/api/channels/:channel/members', (c) =>
    bus.handleApiChannelMemberAdd(c.req.raw, c.req.param('channel'))
  );
  router.delete('/api/channels/:channel/members/:agent', (c) =>
    bus.handleApiChannelMemberRemove(c.req.raw, c.req.param('channel'), c.req.param('agent'))
  );

  return router;
}
