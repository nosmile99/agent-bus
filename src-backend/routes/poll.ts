// Poll, WebSocket, and Health routes with Hono
import { Hono } from "hono";
import type { IBusDO } from "../types.js";
import { handlePoll, handleWs } from "../handlers/poll.js";

export function createPollRouter(bus: IBusDO): Hono {
  const router = new Hono();

  router.get("/health", () => bus.json(200, { ok: true }));
  router.all("/ws", (c) => handleWs.call(bus, c.req.raw, new URL(c.req.url)));
  router.get("/poll", (c) => handlePoll.call(bus, c.req.raw, new URL(c.req.url)));

  return router;
}
