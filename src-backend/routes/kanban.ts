// Kanban routes (admin & agent) with Hono
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';

export function createKanbanRouter(bus: IBusDO): Hono {
  const router = new Hono();

  // Admin Kanban (Basic auth)
  router.get('/admin/api/kanban/projects', (c) => bus.handleKbAdminProjectsList(c.req.raw));
  router.post('/admin/api/kanban/projects', (c) => bus.handleKbAdminProjectCreate(c.req.raw));
  router.put('/admin/api/kanban/projects/:id{[0-9]+}', (c) =>
    bus.handleKbAdminProjectUpdate(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.delete('/admin/api/kanban/projects/:id{[0-9]+}', (c) =>
    bus.handleKbAdminProjectDelete(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  router.get('/admin/api/kanban/projects/:id{[0-9]+}/tasks', (c) =>
    bus.handleKbAdminTasksList(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.post('/admin/api/kanban/projects/:id{[0-9]+}/tasks', (c) =>
    bus.handleKbAdminTaskCreate(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  router.put('/admin/api/kanban/tasks/:id{[0-9]+}', (c) =>
    bus.handleKbAdminTaskUpdate(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.delete('/admin/api/kanban/tasks/:id{[0-9]+}', (c) =>
    bus.handleKbAdminTaskDelete(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  router.post('/admin/api/kanban/tasks/:id{[0-9]+}/todos', (c) =>
    bus.handleKbAdminTodoCreate(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.put('/admin/api/kanban/todos/:id{[0-9]+}', (c) =>
    bus.handleKbAdminTodoUpdate(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.delete('/admin/api/kanban/todos/:id{[0-9]+}', (c) =>
    bus.handleKbAdminTodoDelete(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  // Agent Kanban (Bearer auth)
  router.get('/api/kanban/projects', (c) => bus.handleKbAgentProjectsList(c.req.raw));
  router.get('/api/kanban/tasks/available', (c) => bus.handleKbAgentTasksAvailable(c.req.raw));
  router.get('/api/kanban/projects/:id{[0-9]+}/tasks', (c) =>
    bus.handleKbAgentTasksList(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.post('/api/kanban/projects/:id{[0-9]+}/tasks', (c) =>
    bus.handleKbAgentTaskCreate(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  router.get('/api/kanban/projects/:id{[0-9]+}/tasks/search', (c) => {
    const agent = bus.authedAgent(c.req.raw);
    if (!agent) return bus.json(401, { error: 'unauthorized' });
    return bus.handleKbTaskSearch(new URL(c.req.url), {
      isAdmin: false,
      agent,
      projectId: parseInt(c.req.param('id'), 10),
    });
  });

  router.get('/api/kanban/tasks/:id{[0-9]+}', (c) =>
    bus.handleKbAgentTaskDetail(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.put('/api/kanban/tasks/:id{[0-9]+}', (c) =>
    bus.handleKbAgentTaskUpdate(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.post('/api/kanban/tasks/:id{[0-9]+}/claim', (c) =>
    bus.handleKbAgentTaskClaim(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.put('/api/kanban/tasks/:id{[0-9]+}/status', (c) =>
    bus.handleKbAgentTaskStatus(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.post('/api/kanban/tasks/:id{[0-9]+}/todos', (c) =>
    bus.handleKbAgentTodoCreate(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  router.get('/api/kanban/tasks/:id{[0-9]+}/comments', (c) => {
    const agent = bus.authedAgent(c.req.raw);
    if (!agent) return bus.json(401, { error: 'unauthorized' });
    return bus.handleKbCommentList(c.req.raw, new URL(c.req.url), parseInt(c.req.param('id'), 10), {
      isAdmin: false,
      agent,
    });
  });

  router.post('/api/kanban/tasks/:id{[0-9]+}/comments', (c) => {
    const agent = bus.authedAgent(c.req.raw);
    if (!agent) return bus.json(401, { error: 'unauthorized' });
    return bus.handleKbCommentAdd(c.req.raw, parseInt(c.req.param('id'), 10), {
      isAdmin: false,
      agent,
    });
  });

  router.post('/api/kanban/tasks/:id{[0-9]+}/labels', (c) =>
    bus.handleKbAgentLabelAdd(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.delete('/api/kanban/tasks/:id{[0-9]+}/labels/:label{.+}', (c) =>
    bus.handleKbAgentLabelRemove(c.req.raw, parseInt(c.req.param('id'), 10), c.req.param('label'))
  );
  router.put('/api/kanban/todos/:id{[0-9]+}', (c) =>
    bus.handleKbAgentTodoUpdate(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  // Kanban expansion: admin search / labels / subscribers / task detail
  router.get('/admin/api/kanban/tasks/search', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleKbTaskSearch(new URL(c.req.url), { isAdmin: true, agent: null, projectId: null });
  });

  router.get('/admin/api/kanban/projects/:id{[0-9]+}/tasks/search', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleKbTaskSearch(new URL(c.req.url), {
      isAdmin: true,
      agent: null,
      projectId: parseInt(c.req.param('id'), 10),
    });
  });

  router.get('/admin/api/kanban/projects/:id{[0-9]+}/labels', (c) =>
    bus.handleKbAdminProjectLabels(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.get('/admin/api/kanban/projects/:id{[0-9]+}/subscribers', (c) =>
    bus.handleKbAdminProjectSubscribers(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.get('/admin/api/kanban/tasks/:id{[0-9]+}', (c) =>
    bus.handleKbAdminTaskDetail(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  router.get('/admin/api/kanban/tasks/:id{[0-9]+}/comments', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleKbCommentList(c.req.raw, new URL(c.req.url), parseInt(c.req.param('id'), 10), {
      isAdmin: true,
      agent: null,
    });
  });

  router.post('/admin/api/kanban/tasks/:id{[0-9]+}/comments', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleKbCommentAdd(c.req.raw, parseInt(c.req.param('id'), 10), {
      isAdmin: true,
      agent: null,
    });
  });

  router.post('/admin/api/kanban/tasks/:id{[0-9]+}/labels', (c) =>
    bus.handleKbAdminLabelAdd(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.delete('/admin/api/kanban/tasks/:id{[0-9]+}/labels/:label{.+}', (c) =>
    bus.handleKbAdminLabelRemove(c.req.raw, parseInt(c.req.param('id'), 10), c.req.param('label'))
  );

  return router;
}
