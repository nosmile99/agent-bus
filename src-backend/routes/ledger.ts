// Ledger routes (agent Bearer, admin Basic, never mixed) — plan v12 §5.
import { Hono } from 'hono';
import type { IBusDO } from '../types.js';

// Amendment batch: the three new ledger handlers live in
// handlers/ledger.ts and are attached to BusDO.prototype by
// index.ts's Object.assign, but their declarations are not yet in
// the IBusDO interface (types.ts is outside this batch's file
// list). This local cast keeps the router typechecking until the
// parent integrates the declarations; it changes no behaviour.
interface BatchBLedgerHandlers {
  handleLedgerContradiction(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerResolver(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerResolveDissent(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
}

export function createLedgerRouter(bus: IBusDO): Hono {
  const router = new Hono();
  const batchB = bus as unknown as BatchBLedgerHandlers;

  router.post('/api/ledger', (c) => bus.handleLedgerCreate(c.req.raw));
  router.get('/api/ledger', (c) =>
    bus.handleLedgerList(c.req.raw, new URL(c.req.url), { isAdmin: false, agent: null })
  );
  router.get('/api/ledger/:id{[0-9]+}', (c) =>
    bus.handleLedgerGet(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  router.get('/api/ledger/:id{[0-9]+}/events', (c) =>
    bus.handleLedgerEvents(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  router.post('/api/ledger/:id{[0-9]+}/supersede', (c) =>
    bus.handleLedgerSupersede(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  router.post('/api/ledger/:id{[0-9]+}/tombstone', (c) =>
    bus.handleLedgerTombstone(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  // Amendment batch, items 2b/2c/19c (agent Bearer variants).
  router.post('/api/ledger/:id{[0-9]+}/contradiction', (c) =>
    batchB.handleLedgerContradiction(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  router.post('/api/ledger/:id{[0-9]+}/resolver', (c) =>
    batchB.handleLedgerResolver(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );
  router.post('/api/ledger/:id{[0-9]+}/resolve-dissent', (c) =>
    batchB.handleLedgerResolveDissent(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: false, agent: null })
  );

  router.post('/admin/api/ledger/seed', (c) => bus.handleLedgerSeed(c.req.raw));
  router.get('/admin/api/ledger', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleLedgerList(c.req.raw, new URL(c.req.url), { isAdmin: true, agent: null });
  });
  router.get('/admin/api/ledger/:id{[0-9]+}', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleLedgerGet(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null });
  });
  router.get('/admin/api/ledger/:id{[0-9]+}/events', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleLedgerEvents(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null });
  });
  router.post('/admin/api/ledger/:id{[0-9]+}/supersede', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleLedgerSupersede(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null });
  });
  router.post('/admin/api/ledger/:id{[0-9]+}/tombstone', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return bus.handleLedgerTombstone(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null });
  });
  // Amendment batch, items 2b/2c/19c (admin Basic variants).
  router.post('/admin/api/ledger/:id{[0-9]+}/contradiction', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return batchB.handleLedgerContradiction(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null });
  });
  router.post('/admin/api/ledger/:id{[0-9]+}/resolver', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return batchB.handleLedgerResolver(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null });
  });
  router.post('/admin/api/ledger/:id{[0-9]+}/resolve-dissent', async (c) => {
    if (!(await bus.checkBasicAuth(c.req.raw))) return bus.unauthorizedBasic(c.req.raw);
    return batchB.handleLedgerResolveDissent(c.req.raw, parseInt(c.req.param('id'), 10), { isAdmin: true, agent: null });
  });
  // Fix round 2, item 5: primary name is recheck-assignment;
  // /demote is a documented compatibility alias only.
  router.post('/admin/api/ledger/:id{[0-9]+}/recheck-assignment', (c) =>
    bus.handleLedgerRecheckAssignment(c.req.raw, parseInt(c.req.param('id'), 10))
  );
  router.post('/admin/api/ledger/:id{[0-9]+}/demote', (c) =>
    bus.handleLedgerRecheckAssignment(c.req.raw, parseInt(c.req.param('id'), 10))
  );

  return router;
}
