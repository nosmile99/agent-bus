// Kanban routes (admin & agent)

export async function matchKanbanRoute(bus, req, url, path) {
      // --- Kanban (rev 2 plan, LOCKED 2026-10-19) ---
      // Admin (Basic auth)
      if (path === "/admin/api/kanban/projects" && req.method === "GET")
        return bus.handleKbAdminProjectsList(req);
      if (path === "/admin/api/kanban/projects" && req.method === "POST")
        return bus.handleKbAdminProjectCreate(req);
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)$/.exec(path);
        if (m && req.method === "PUT")
          return bus.handleKbAdminProjectUpdate(req, parseInt(m[1], 10));
        if (m && req.method === "DELETE")
          return bus.handleKbAdminProjectDelete(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)\/tasks$/.exec(path);
        if (m && req.method === "GET")
          return bus.handleKbAdminTasksList(req, parseInt(m[1], 10));
        if (m && req.method === "POST")
          return bus.handleKbAdminTaskCreate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)$/.exec(path);
        if (m && req.method === "PUT")
          return bus.handleKbAdminTaskUpdate(req, parseInt(m[1], 10));
        if (m && req.method === "DELETE")
          return bus.handleKbAdminTaskDelete(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)\/todos$/.exec(path);
        if (m && req.method === "POST")
          return bus.handleKbAdminTodoCreate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/todos\/(\d+)$/.exec(path);
        if (m && req.method === "PUT")
          return bus.handleKbAdminTodoUpdate(req, parseInt(m[1], 10));
        if (m && req.method === "DELETE")
          return bus.handleKbAdminTodoDelete(req, parseInt(m[1], 10));
      }
      // Agent (Bearer auth)
      if (path === "/api/kanban/projects" && req.method === "GET")
        return bus.handleKbAgentProjectsList(req);
      if (path === "/api/kanban/tasks/available" && req.method === "GET")
        return bus.handleKbAgentTasksAvailable(req);
      {
        const m = /^\/api\/kanban\/projects\/(\d+)\/tasks$/.exec(path);
        if (m && req.method === "GET")
          return bus.handleKbAgentTasksList(req, parseInt(m[1], 10));
        if (m && req.method === "POST")
          return bus.handleKbAgentTaskCreate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/projects\/(\d+)\/tasks\/search$/.exec(path);
        if (m && req.method === "GET") {
          const agent = bus.authedAgent(req);
          if (!agent) return bus.json(401, { error: "unauthorized" });
          return bus.handleKbTaskSearch(url, { isAdmin: false, agent, projectId: parseInt(m[1], 10) });
        }
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)$/.exec(path);
        if (m && req.method === "GET")
          return bus.handleKbAgentTaskDetail(req, parseInt(m[1], 10));
        if (m && req.method === "PUT")
          return bus.handleKbAgentTaskUpdate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/claim$/.exec(path);
        if (m && req.method === "POST")
          return bus.handleKbAgentTaskClaim(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/status$/.exec(path);
        if (m && req.method === "PUT")
          return bus.handleKbAgentTaskStatus(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/todos$/.exec(path);
        if (m && req.method === "POST")
          return bus.handleKbAgentTodoCreate(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/comments$/.exec(path);
        if (m && req.method === "GET") {
          const agent = bus.authedAgent(req);
          if (!agent) return bus.json(401, { error: "unauthorized" });
          return bus.handleKbCommentList(req, url, parseInt(m[1], 10), { isAdmin: false, agent });
        }
        if (m && req.method === "POST") {
          const agent = bus.authedAgent(req);
          if (!agent) return bus.json(401, { error: "unauthorized" });
          return bus.handleKbCommentAdd(req, parseInt(m[1], 10), { isAdmin: false, agent });
        }
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/labels$/.exec(path);
        if (m && req.method === "POST")
          return bus.handleKbAgentLabelAdd(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/api\/kanban\/tasks\/(\d+)\/labels\/(.+)$/.exec(path);
        if (m && req.method === "DELETE")
          return bus.handleKbAgentLabelRemove(req, parseInt(m[1], 10), decodeURIComponent(m[2]));
      }
      {
        const m = /^\/api\/kanban\/todos\/(\d+)$/.exec(path);
        if (m && req.method === "PUT")
          return bus.handleKbAgentTodoUpdate(req, parseInt(m[1], 10));
      }
      // --- Kanban expansion: admin search/labels/subscribers/task detail ---
      if (path === "/admin/api/kanban/tasks/search" && req.method === "GET") {
        if (!(await bus.checkBasicAuth(req))) return bus.unauthorizedBasic(req);
        return bus.handleKbTaskSearch(url, { isAdmin: true, agent: null, projectId: null });
      }
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)\/tasks\/search$/.exec(path);
        if (m && req.method === "GET") {
          if (!(await bus.checkBasicAuth(req))) return bus.unauthorizedBasic(req);
          return bus.handleKbTaskSearch(url, { isAdmin: true, agent: null, projectId: parseInt(m[1], 10) });
        }
      }
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)\/labels$/.exec(path);
        if (m && req.method === "GET")
          return bus.handleKbAdminProjectLabels(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/projects\/(\d+)\/subscribers$/.exec(path);
        if (m && req.method === "GET")
          return bus.handleKbAdminProjectSubscribers(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)$/.exec(path);
        if (m && req.method === "GET")
          return bus.handleKbAdminTaskDetail(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)\/comments$/.exec(path);
        if (m && req.method === "GET") {
          if (!(await bus.checkBasicAuth(req))) return bus.unauthorizedBasic(req);
          return bus.handleKbCommentList(req, url, parseInt(m[1], 10), { isAdmin: true, agent: null });
        }
        if (m && req.method === "POST") {
          if (!(await bus.checkBasicAuth(req))) return bus.unauthorizedBasic(req);
          return bus.handleKbCommentAdd(req, parseInt(m[1], 10), { isAdmin: true, agent: null });
        }
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)\/labels$/.exec(path);
        if (m && req.method === "POST")
          return bus.handleKbAdminLabelAdd(req, parseInt(m[1], 10));
      }
      {
        const m = /^\/admin\/api\/kanban\/tasks\/(\d+)\/labels\/(.+)$/.exec(path);
        if (m && req.method === "DELETE")
          return bus.handleKbAdminLabelRemove(req, parseInt(m[1], 10), decodeURIComponent(m[2]));
      }
      return bus.json(404, { error: "not found" });

  return null;
}
