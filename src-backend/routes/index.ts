// Master Hono router dispatcher
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';
import { createPollRouter } from './poll.js';
import { createMessagesRouter } from './messages.js';
import { createAgentsRouter } from './agents.js';
import { createAdminRouter } from './admin.js';
import { createChannelsRouter } from './channels.js';
import { createKanbanRouter } from './kanban.js';

export function createRouter(bus: IBusDO) {
  const app = new Hono()
    .route('/', createPollRouter(bus))
    .route('/', createMessagesRouter(bus))
    .route('/', createAgentsRouter(bus))
    .route('/', createAdminRouter(bus))
    .route('/', createChannelsRouter(bus))
    .route('/', createKanbanRouter(bus));

  app.notFound(() => bus.json(404, { error: 'not found' }));
  app.onError((err) =>
    bus.json(500, { error: 'internal: ' + String((err && err.message) || err) })
  );

  return app;
}

export type AppType = ReturnType<typeof createRouter>;

