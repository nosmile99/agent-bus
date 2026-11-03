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

  router.get('/admin/api/kanban/summary', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleKbSummary(c.req.raw, new URL(c.req.url), {
      isAdmin: true,
      agent: null,
      projectId: null,
    });
  });

  router.get('/admin/api/kanban/projects/:id{[0-9]+}/summary', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleKbSummary(c.req.raw, new URL(c.req.url), {
      isAdmin: true,
      agent: null,
      projectId: parseInt(c.req.param('id'), 10),
    });
  });

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

  // Amendment batch item 12: atomic rescue (admin Basic variant).
  // NOTE (cross-file wiring, parent): handleKbTaskRescue is exported
  // from handlers/kanban.ts and auto-bound onto BusDO by index.ts,
  // but IBusDO (types.ts) and the BusDO field list (index.ts) need
  // a one-line handleKbTaskRescue declaration each for tsc.
  router.post('/admin/api/kanban/tasks/:id{[0-9]+}/rescue', (c) =>
    bus.handleKbTaskRescue(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null })
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

  router.get('/api/kanban/projects/:id{[0-9]+}/summary', (c) => {
    const agent = bus.authedAgent(c.req.raw);
    if (!agent) return bus.json(401, { error: 'unauthorized' });
    return bus.handleKbSummary(c.req.raw, new URL(c.req.url), {
      isAdmin: false,
      agent,
      projectId: parseInt(c.req.param('id'), 10),
    });
  });

  router.get('/api/kanban/projects/:id{[0-9]+}/tasks/search', (c) => {
    const agent = bus.authedAgent(c.req.raw);
    if (!agent) return bus.json(401, { error: 'unauthorized' });
    return bus.handleKbTaskSearch(new URL(c.req.url), {
      isAdmin: false,
      agent,
      projectId: parseInt(c.req.param('id'), 10),
    });
  });

  router.get('/api/kanban/projects/:id{[0-9]+}/activity', (c) => {
    const agent = bus.authedAgent(c.req.raw);
    if (!agent) return bus.json(401, { error: 'unauthorized' });
    return bus.handleKbActivity(c.req.raw, new URL(c.req.url), {
      isAdmin: false,
      agent,
      projectId: parseInt(c.req.param('id'), 10),
    });
  });

  router.get('/api/kanban/templates', (c) => bus.handleKbTemplatesList(c.req.raw, { isAdmin: false }));

  router.get('/api/kanban/tasks/unblocked', (c) =>
    bus.handleDepUnblocked(c.req.raw, new URL(c.req.url), { isAdmin: false, agent: null })
  );
  router.get('/api/kanban/tasks/:id{[0-9]+}/dependencies', (c) =>
    bus.handleDepList(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  router.get('/api/kanban/tasks/:id{[0-9]+}/dependencies/events', (c) =>
    bus.handleDepEvents(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  router.post('/api/kanban/tasks/:id{[0-9]+}/dependencies', (c) =>
    bus.handleDepLink(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  router.delete('/api/kanban/tasks/:id{[0-9]+}/dependencies/:blocker_id{[0-9]+}', (c) =>
    bus.handleDepUnlink(
      c.req.raw,
      parseInt(c.req.param('id'), 10),
      parseInt(c.req.param('blocker_id'), 10),
      { isAdmin: false, agent: null }
    )
  );

  router.get('/api/kanban/tasks/:id{[0-9]+}', (c) =>
    bus.handleKbAgentTaskDetail(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.put('/api/kanban/tasks/:id{[0-9]+}', (c) =>
    bus.handleKbAgentTaskUpdate(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.put('/api/kanban/tasks/:id{[0-9]+}/notes', (c) =>
    bus.handleKbAgentTaskUpdate(c.req.raw, parseInt(c.req.param('id'), 10), 'notes')
  );
  router.put('/api/kanban/tasks/:id{[0-9]+}/due_date', (c) =>
    bus.handleKbAgentTaskUpdate(c.req.raw, parseInt(c.req.param('id'), 10), 'due_date')
  );
  router.put('/api/kanban/tasks/:id{[0-9]+}/lane', (c) =>
    bus.handleKbAgentTaskUpdate(c.req.raw, parseInt(c.req.param('id'), 10), 'lane')
  );
  router.post('/api/kanban/tasks/:id{[0-9]+}/claim', (c) =>
    bus.handleKbAgentTaskClaim(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.post('/api/kanban/tasks/:id{[0-9]+}/release', (c) =>
    bus.handleKbAgentTaskRelease(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.put('/api/kanban/tasks/:id{[0-9]+}/status', (c) =>
    bus.handleKbAgentTaskStatus(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  // Amendment batch item 12: atomic rescue (agent Bearer variant).
  router.post('/api/kanban/tasks/:id{[0-9]+}/rescue', (c) =>
    bus.handleKbTaskRescue(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
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

  // Amendment batch item 22: comment restore (author Bearer).
  router.post('/api/kanban/tasks/:id{[0-9]+}/comments/:comment_id{[0-9]+}/restore', (c) => {
    const agent = bus.authedAgent(c.req.raw);
    if (!agent) return bus.json(401, { error: 'unauthorized' });
    return bus.handleKbCommentRestore(c.req.raw, parseInt(c.req.param('id'), 10), parseInt(c.req.param('comment_id'), 10), {
      isAdmin: false,
      agent,
    });
  });

  // Amendment batch item 25: caller-visible sweep health.
  router.get('/api/kanban/sweep-health', (c) => bus.handleKbAgentSweepHealth(c.req.raw));

  router.post('/api/kanban/tasks/:id{[0-9]+}/labels', (c) =>
    bus.handleKbAgentLabelAdd(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.delete('/api/kanban/tasks/:id{[0-9]+}/labels/:label{.+}', (c) =>
    bus.handleKbAgentLabelRemove(c.req.raw, parseInt(c.req.param('id'), 10), c.req.param('label'))
  );
  router.put('/api/kanban/todos/:id{[0-9]+}', (c) =>
    bus.handleKbAgentTodoUpdate(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  // Kanban expansion: admin search / labels / subscribers / task detail / activity / templates / wip / lane-mapping
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

  router.get('/admin/api/kanban/activity', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleKbActivity(c.req.raw, new URL(c.req.url), {
      isAdmin: true,
      agent: null,
      projectId: null,
    });
  });

  router.get('/admin/api/kanban/templates', (c) => bus.handleKbTemplatesList(c.req.raw, { isAdmin: true }));
  router.post('/admin/api/kanban/templates', (c) => bus.handleKbAdminTemplateCreate(c.req.raw));

  router.get('/admin/api/kanban/wip', (c) => bus.handleKbAdminWipGet(c.req.raw));
  router.put('/admin/api/kanban/wip', (c) => bus.handleKbAdminWipPut(c.req.raw));

  router.get('/admin/api/kanban/lane-mapping', (c) => bus.handleKbAdminLaneMappingGet(c.req.raw));
  router.put('/admin/api/kanban/lane-mapping', (c) => bus.handleKbAdminLaneMappingPut(c.req.raw));

  router.get('/admin/api/kanban/projects/:id{[0-9]+}/labels', (c) =>
    bus.handleKbAdminProjectLabels(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.get('/admin/api/kanban/projects/:id{[0-9]+}/subscribers', (c) =>
    bus.handleKbAdminProjectSubscribers(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.get('/admin/api/kanban/tasks/unblocked', (c) =>
    bus.handleDepUnblocked(c.req.raw, new URL(c.req.url), { isAdmin: true, agent: null })
  );
  router.get('/admin/api/kanban/tasks/:id{[0-9]+}/dependencies', (c) =>
    bus.handleDepList(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null })
  );
  router.get('/admin/api/kanban/tasks/:id{[0-9]+}/dependencies/events', (c) =>
    bus.handleDepEvents(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null })
  );
  router.post('/admin/api/kanban/tasks/:id{[0-9]+}/dependencies', (c) =>
    bus.handleDepLink(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null })
  );
  router.delete('/admin/api/kanban/tasks/:id{[0-9]+}/dependencies/:blocker_id{[0-9]+}', (c) =>
    bus.handleDepUnlink(
      c.req.raw,
      parseInt(c.req.param('id'), 10),
      parseInt(c.req.param('blocker_id'), 10),
      { isAdmin: true, agent: null }
    )
  );
  router.post('/admin/api/kanban/tasks/:id{[0-9]+}/comments/:comment_id{[0-9]+}/soft-delete', (c) =>
    bus.handleKbCommentSoftDelete(
      c.req.raw,
      parseInt(c.req.param('id'), 10),
      parseInt(c.req.param('comment_id'), 10)
    )
  );

  // Amendment batch item 22: comment restore (admin Basic).
  router.post('/admin/api/kanban/tasks/:id{[0-9]+}/comments/:comment_id{[0-9]+}/restore', (c) =>
    bus.handleKbCommentRestore(c.req.raw, parseInt(c.req.param('id'), 10), parseInt(c.req.param('comment_id'), 10), {
      isAdmin: true,
      agent: null,
    })
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
