// Amendment batch handlers: wake bundle (item 13a), cutover machine
// state (item 5), and discovery (item 14). All agent-facing reads
// here charge the READ rate bucket (item 13d); admin Basic paths
// skip rate checks per the existing admin convention (admin routes
// in this codebase generally never call rlCheck).
//
// ROUTING NOTE: these handlers are wired by routes/wake.ts via direct
// imports (handleWake.call(bus, ...)), NOT via bus.handleWake —
// index.ts does not yet bind this module, so a bus.* call would be
// undefined at runtime. The parent integration may additionally bind
// this module in index.ts (and declare the methods on IBusDO); the
// direct-import routes keep working either way.
import type { IBusDO, LedgerRecord, TaskRecord } from '../types.js';
import { rlCheckRead, rlReadLimitedResponse } from './agents.js';

// ------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------

// bus_meta is a key/value table (key TEXT PRIMARY KEY, value TEXT).
function metaGet(bus: IBusDO, key: string): string | null {
  try {
    const rows = bus.sql.exec(`SELECT value FROM bus_meta WHERE key = ?`, key).toArray() as Array<{ value: string }>;
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

function metaSet(bus: IBusDO, key: string, value: string): void {
  bus.sql.exec(
    `INSERT INTO bus_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

// Ledger list presentation mapping (mirrors handlers/ledger.ts
// ledgerPublic): storage columns demote_actor/demote_deadline are
// NEVER exposed bare — they surface as recheck_* with the disclaimer.
function ledgerPublicRow(row: LedgerRecord): Record<string, unknown> {
  const { demote_actor, demote_deadline, ...rest } = row as LedgerRecord & {
    demote_actor: unknown;
    demote_deadline: unknown;
  };
  return {
    ...rest,
    recheck_actor: demote_actor,
    recheck_deadline: demote_deadline,
    recheck_note: 'recheck assignment only: scope and authority unchanged, no wake or message sent',
  };
}

// Ledger visibility, same rule as the ledger list (handlers/ledger.ts
// ledgerRowVisible): a row is visible to an agent when it is
// untargeted (target_lane NULL) or targeted at that agent.
function visibleLedgerWhere(agent: string): { where: string; params: (string | number)[] } {
  return { where: `(target_lane IS NULL OR target_lane = ?)`, params: [agent] };
}

async function drain(req: Request): Promise<void> {
  try {
    await req.text();
  } catch {}
}

// ------------------------------------------------------------------
// Item 5 — cutover machine state
// ------------------------------------------------------------------
//
// CONTRACT (defined + locked NOW; seed execution is DEFERRED —
// nothing in this file inserts a ledger row, ever):
//   bus_meta 'authority_state': 'memory_authoritative' (default when
//     the key is absent, and fallback for any unrecognised stored
//     value) | 'bus_authoritative'.
//   bus_meta 'seed_checklist': JSON { items: [{ id, title, state }] }
//     with state 'pending' | 'done'; starts empty ({ items: [] }).
//     Appending an item records INTENT ONLY — it does not create a
//     ledger row, a task, or any other bus record. Seeding stays a
//     separate future step on Luki's order.
//   bus_meta 'cutover_flips': JSON audit log of flips, newest last,
//     capped at 50 entries: [{ from, to, at, by }]. A poll-visible
//     'cutover.flipped' event is also emitted (best-effort;
//     emitEvent swallows its own failures). ledger_events is NOT
//     used: its action column has a CHECK constraint over
//     create/supersede/tombstone/seed/demote and its ledger_id is a
//     foreign key to a ledger row, neither of which fits a
//     machine-state flip.
//
// FLIP PROCEDURE (for the operator, not the machine):
//   1. Confirm the ledger state you are flipping FROM is fully
//      reconciled in MEMORY.md (the outgoing authority) — the flip
//      itself moves no rows and reconciles nothing.
//   2. POST /admin/api/cutover/flip { authority_state } with admin
//      Basic auth. The response echoes { previous, authority_state }.
//      Argon safety round (Luki's LGTM on the dormant-ship default):
//      a flip OUT of memory_authoritative is LOCKED (409) until a
//      seed list plus a checklist mark-done endpoint exist. Since
//      mark-done does not exist yet, no flip away is possible now;
//      flipping back to / staying at memory_authoritative stays
//      allowed, and rejected flips write no audit entry and emit
//      no event.
//   3. GET /admin/api/cutover (or agent GET /api/cutover) and confirm
//      the new state is reflected before announcing the cutover.
//   4. To roll back, repeat step 2 with the previous value — allowed
//      flips are symmetric and reversible; no state is destroyed by
//      a flip. (A rollback TO memory_authoritative is never locked.)
//   5. Seed execution (turning checklist items into ledger rows) is
//      NOT part of this procedure and remains deferred.

export type AuthorityState = 'memory_authoritative' | 'bus_authoritative';

export interface SeedChecklistItem {
  id: string;
  title: string;
  state: 'pending' | 'done';
}

export interface SeedChecklist {
  items: SeedChecklistItem[];
}

export function getAuthorityState(bus: IBusDO): AuthorityState {
  const raw = metaGet(bus, 'authority_state');
  if (raw === 'bus_authoritative') return 'bus_authoritative';
  return 'memory_authoritative';
}

// Argon safety round: the explicit authority note carried by discovery
// and wake. It is derived from the CURRENT flag, never hardcoded to
// the dormant wording: while memory_authoritative, MEMORY.md is the
// sole authority and the ledger must not be used as final decision
// authority; under bus_authoritative the note says so honestly.
export function authorityNote(state: AuthorityState): string {
  return state === 'memory_authoritative'
    ? 'MEMORY.md is the sole authoritative source; the ledger must not be used as final decision authority.'
    : 'The ledger is the authoritative source (authority_state is bus_authoritative).';
}

// Argon safety round: contradiction flags are annotations only. This
// is a semantic statement, not state-dependent: unlike dissent, which
// holds transitions until official resolution, a contradiction flag
// never blocks anything on its own.
export const CONTRADICTION_NOTE =
  'Ledger contradiction flags are annotations only: unlike dissent, which holds transitions until official resolution, a contradiction flag does not hold any transition.';

export function getSeedChecklist(bus: IBusDO): SeedChecklist {
  const raw = metaGet(bus, 'seed_checklist');
  if (!raw) return { items: [] };
  try {
    const parsed = JSON.parse(raw) as { items?: unknown };
    if (!parsed || !Array.isArray(parsed.items)) return { items: [] };
    const items: SeedChecklistItem[] = [];
    for (const it of parsed.items) {
      const row = it as Record<string, unknown> | null;
      if (!row || typeof row.id !== 'string' || typeof row.title !== 'string') continue;
      items.push({
        id: row.id,
        title: row.title,
        state: row.state === 'done' ? 'done' : 'pending',
      });
    }
    return { items };
  } catch {
    return { items: [] };
  }
}

function cutoverPayload(bus: IBusDO): { authority_state: AuthorityState; seed_checklist: SeedChecklist } {
  return { authority_state: getAuthorityState(bus), seed_checklist: getSeedChecklist(bus) };
}

// GET /api/cutover — agent Bearer, READ bucket. Returns the current
// authority state plus the seed checklist.
export async function handleCutoverGet(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    await drain(req);
    return this.json(401, { error: 'unauthorized' });
  }
  if (!rlCheckRead.call(this, agent)) return rlReadLimitedResponse.call(this, agent);
  return this.json(200, cutoverPayload(this));
}

// GET /admin/api/cutover — admin Basic, no rate check (admin convention).
export async function handleCutoverAdminGet(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  return this.json(200, cutoverPayload(this));
}

// POST /admin/api/cutover/flip — admin Basic only, no rate check.
// Body: { authority_state: 'memory_authoritative' | 'bus_authoritative' }.
// Validates the value (anything else is 400), then — Argon safety
// round — rejects a flip OUT of memory_authoritative with 409 (the
// lock above) until a seed list plus a checklist mark-done endpoint
// exist. Allowed flips record in bus_meta ('authority_state' + the
// 'cutover_flips' audit log), emit a poll-visible 'cutover.flipped'
// event, and return the previous/new pair. A flip moves NO rows and
// reconciles nothing.
export async function handleCutoverFlip(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const by = this.kbBasicUser(req) || 'admin';
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return this.json(400, { error: 'invalid json' });
  }
  const next = (payload as Record<string, unknown> | null)?.authority_state;
  if (next !== 'memory_authoritative' && next !== 'bus_authoritative') {
    return this.json(400, {
      error: 'invalid authority_state',
      field: 'authority_state',
      allowed: ['memory_authoritative', 'bus_authoritative'],
    });
  }
  const previous = getAuthorityState(this);
  // Argon safety round: the flip OUT of memory_authoritative is
  // locked until a seed list plus a checklist mark-done endpoint
  // exist. Mark-done does not exist, so no flip away is possible
  // now. A rejected flip writes nothing: no state change, no audit
  // entry, no event. Flips to memory_authoritative (including a
  // no-op stay) are never locked.
  if (previous === 'memory_authoritative' && next === 'bus_authoritative') {
    return this.json(409, {
      error: 'cutover flip locked',
      field: 'authority_state',
      hint: 'flip out of memory_authoritative is locked until a seed list and a checklist mark-done endpoint exist; the ledger ships dormant under MEMORY.md until then',
    });
  }
  const at = this.kbNow();
  metaSet(this, 'authority_state', next);
  try {
    const raw = metaGet(this, 'cutover_flips');
    let log: Array<{ from: AuthorityState; to: AuthorityState; at: number; by: string }> = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) log = parsed as typeof log;
      } catch {}
    }
    log.push({ from: previous, to: next, at, by });
    if (log.length > 50) log = log.slice(log.length - 50);
    metaSet(this, 'cutover_flips', JSON.stringify(log));
  } catch {}
  try {
    this.emitEvent('cutover.flipped', { actor: by, scope: 'admin', payload: { from: previous, to: next } });
  } catch {}
  return this.json(200, { ok: true, previous, authority_state: next });
}

// POST /admin/api/cutover/checklist — admin Basic only, no rate check.
// Body: { id?: string, title: string }. Appends one checklist item
// in state 'pending' (a client-supplied state is ignored — items are
// born pending; marking done is a separate future step). Duplicate
// ids are 409. Appending does NOT create a ledger row or any other
// bus record: this is intent bookkeeping only, seed execution stays
// deferred.
export async function handleCutoverChecklistAppend(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return this.json(400, { error: 'invalid json' });
  }
  const body = (payload as Record<string, unknown> | null) || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return this.json(400, { error: 'title required', field: 'title' });
  const checklist = getSeedChecklist(this);
  const id =
    typeof body.id === 'string' && body.id.trim()
      ? body.id.trim()
      : `check-${checklist.items.length + 1}`;
  if (checklist.items.some((it) => it.id === id)) {
    return this.json(409, { error: 'checklist item id already exists', field: 'id' });
  }
  const item: SeedChecklistItem = { id, title, state: 'pending' };
  checklist.items.push(item);
  metaSet(this, 'seed_checklist', JSON.stringify(checklist));
  return this.json(200, { ok: true, item, seed_checklist: checklist });
}

// ------------------------------------------------------------------
// Item 13a — wake bundle
// ------------------------------------------------------------------
//
// GET /api/wake — agent Bearer, costing EXACTLY ONE read-bucket unit
// (a single rlCheckRead call; invalid ?since is 400 BEFORE the charge,
// following the codebase's validate-before-rate-check convention).
//
// Response shape:
//   {
//     authority_state, authority_note,  // Argon safety round: the
//                              // explicit non-authoritative statement
//                              // while memory_authoritative (see
//                              // authorityNote above)
//     holds: [...],          // active hold/gate ledger rows visible
//                              // to the caller (target_lane NULL or
//                              // = caller), id ASC, capped at 100
//     holds_truncated: bool, // Argon safety round: true when the
//                              // 100-cap truncated the holds set
//     unblocked: [...],      // the caller's tasks with unblocked_at
//                              // set (i.e. tasks the dependency
//                              // machine unblocked), newest first,
//                              // max 20, non-archived projects only;
//                              // each row carries freeing_blocker_id
//                              // (the blocker whose completion freed
//                              // it, or null when unknown)
//     unblocked_has_more: bool, // Argon safety round: true when the
//                              // 20-cap truncated the unblocked set
//     tasks: [...],          // the caller's actionable tasks: tasks
//                              // assigned to the caller (todo/doing/
//                              // blocked) PLUS the /available set
//                              // (unclaimed todo/blocked in
//                              // non-archived subscribed projects
//                              // matching the caller's lane), in the
//                              // standard default order, max 100
//     ledger_changed: [...], // ledger rows visible to the caller
//                              // (any status — a tombstone IS a
//                              // change), id DESC: with ?since, rows
//                              // with updated_at >= since (ISO
//                              // timestamp parsed to epoch seconds),
//                              // max 100; without it, the latest 20
//     ledger_changed_has_more: bool, // Argon safety round: true when
//                              // the applicable cap truncated the set
//   }
// Caps are computed via LIMIT cap+1 (one query per section, no second
// count query): a fetched cap+1 rows means the cap truncated.
// ?since is an ISO timestamp (e.g. 2026-11-03T00:00:00.000Z). Ledger
// created_at/updated_at are epoch SECONDS, so the ISO value is
// floored to seconds before comparison.
export async function handleWake(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    await drain(req);
    return this.json(401, { error: 'unauthorized' });
  }
  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get('since');
  let sinceSec: number | null = null;
  if (sinceRaw !== null) {
    const ms = Date.parse(sinceRaw);
    if (Number.isNaN(ms)) {
      return this.json(400, { error: 'invalid since', field: 'since', hint: 'ISO timestamp, e.g. 2026-11-03T00:00:00.000Z' });
    }
    sinceSec = Math.floor(ms / 1000);
  }
  // Exactly one read-bucket unit for the whole bundle.
  if (!rlCheckRead.call(this, agent)) return rlReadLimitedResponse.call(this, agent);

  const vis = visibleLedgerWhere(agent);

  // Argon safety round: holds gain a safe cap (100). The storage
  // column unblocked_by_blocker_id is internal: it is stripped from
  // every task row below, and surfaced only as the gated public
  // field freeing_blocker_id (null unless unblocked_at is set, so a
  // stale id from an earlier unblock never surfaces on a claimed or
  // re-blocked task). Same pattern as ledgerPublicRow's demote_*.
  const stripFreeingStorage = (row: TaskRecord): Record<string, unknown> => {
    const { unblocked_by_blocker_id: _raw, ...rest } = row as TaskRecord & { unblocked_by_blocker_id?: number | null };
    return rest;
  };
  const withFreeingBlocker = (row: TaskRecord): Record<string, unknown> => {
    const rest = stripFreeingStorage(row);
    const stored = (row as TaskRecord & { unblocked_by_blocker_id?: number | null }).unblocked_by_blocker_id;
    return { ...rest, freeing_blocker_id: row.unblocked_at ? (stored ?? null) : null };
  };

  const holdsFetched = (
    this.sql
      .exec(
        `SELECT * FROM ledger WHERE status = 'active' AND kind IN ('hold', 'gate') AND ${vis.where} ORDER BY id ASC LIMIT 101`,
        ...vis.params
      )
      .toArray() as unknown as LedgerRecord[]
  ).map(ledgerPublicRow);
  const holdsTruncated = holdsFetched.length > 100;
  const holds = holdsFetched.slice(0, 100);

  const unblockedFetched = this.sql
    .exec(
      `SELECT t.* FROM tasks t
       WHERE t.assignee = ? AND t.unblocked_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)
       ORDER BY t.unblocked_at DESC, t.id DESC LIMIT 21`,
      agent
    )
    .toArray() as unknown as TaskRecord[];
  const unblockedHasMore = unblockedFetched.length > 20;
  const unblocked = unblockedFetched.slice(0, 20).map(withFreeingBlocker);

  const agentLane = this.kbAgentLane(agent);
  const tasksRaw = this.sql
    .exec(
      `SELECT t.* FROM tasks t
       WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.archived = 1)
         AND (
           (t.assignee = ? AND t.status IN ('todo', 'doing', 'blocked'))
           OR (
             t.assignee IS NULL
             AND (t.admin_assigned IS NULL OR t.admin_assigned = ?)
             AND t.status IN ('todo', 'blocked')
             AND (t.lane = 'unassigned' OR t.lane = ?)
             AND ${this.kbSubscriberPred('t.project_id')}
           )
         )
       ORDER BY ${this.kbDefaultOrder('t')} LIMIT 100`,
      agent,
      agent,
      agentLane,
      agent
    )
    .toArray() as unknown as TaskRecord[];
  // The tasks section is the actionable set, not the unblocked list:
  // strip the internal column here without adding the freeing field.
  const tasks = tasksRaw.map(stripFreeingStorage);

  const changedVis = visibleLedgerWhere(agent);
  const changedCap = sinceSec !== null ? 100 : 20;
  const ledgerChangedFetched = (
    sinceSec !== null
      ? (this.sql
          .exec(
            `SELECT * FROM ledger WHERE ${changedVis.where} AND updated_at >= ? ORDER BY id DESC LIMIT 101`,
            ...changedVis.params,
            sinceSec
          )
          .toArray() as unknown as LedgerRecord[])
      : (this.sql
          .exec(
            `SELECT * FROM ledger WHERE ${changedVis.where} ORDER BY id DESC LIMIT 21`,
            ...changedVis.params
          )
          .toArray() as unknown as LedgerRecord[])
  ).map(ledgerPublicRow);
  const ledgerChangedHasMore = ledgerChangedFetched.length > changedCap;
  const ledgerChanged = ledgerChangedFetched.slice(0, changedCap);

  const authorityState = getAuthorityState(this);
  return this.json(200, {
    authority_state: authorityState,
    authority_note: authorityNote(authorityState),
    holds,
    holds_truncated: holdsTruncated,
    unblocked,
    unblocked_has_more: unblockedHasMore,
    tasks,
    ledger_changed: ledgerChanged,
    ledger_changed_has_more: ledgerChangedHasMore,
  });
}

// ------------------------------------------------------------------
// Item 14 — discovery
// ------------------------------------------------------------------
//
// GET /api/discovery — agent Bearer, READ bucket. Returns
//   { version, commit, spec, routes, routes_generated_from,
//     authority_state, authority_note, contradiction_note }.
// authority_note/contradiction_note are Argon safety-round additions
// (see authorityNote/CONTRADICTION_NOTE above).
// version is the branch name ('revamp-v12'): a Worker cannot read
// wrangler.toml or package.json at runtime, and no build-time
// version/commit constant exists in this codebase (searched before
// writing this), so commit is honestly 'unknown' — the deployed
// commit is unproven without build info, and inventing a hash would
// be a lie. routes is GENERATED at request time by introspecting
// the Hono app instance (app.routes), NOT hand-written: it lists
// every route the live router actually serves, including routes
// mounted from other router modules. If app introspection is
// unavailable (e.g. the handler is invoked outside a real BusDO),
// routes is [] and routes_generated_from says so plainly instead of
// substituting a static list and calling it generated.
export async function handleDiscovery(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    await drain(req);
    return this.json(401, { error: 'unauthorized' });
  }
  if (!rlCheckRead.call(this, agent)) return rlReadLimitedResponse.call(this, agent);

  let routes: Array<{ method: string; path: string }> = [];
  let routesGeneratedFrom = 'unavailable (no Hono app introspection)';
  const app = (this as unknown as { app?: { routes?: Array<{ method: string; path: string }> } }).app;
  if (app && Array.isArray(app.routes)) {
    const seen = new Set<string>();
    for (const r of app.routes) {
      if (!r || typeof r.method !== 'string' || typeof r.path !== 'string') continue;
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push({ method: r.method, path: r.path });
    }
    routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.method < b.method ? -1 : 1));
    routesGeneratedFrom = 'hono-app-routes';
  }
  const authorityState = getAuthorityState(this);
  return this.json(200, {
    version: 'revamp-v12',
    commit: 'unknown',
    spec: 'SPEC.md §17.11 (amendment batch)',
    routes,
    routes_generated_from: routesGeneratedFrom,
    // Argon safety round: the explicit authority statement (derived
    // from the current flag, never hardcoded) plus the contradiction
    // annotation note (doc only; contradiction endpoints unchanged).
    authority_state: authorityState,
    authority_note: authorityNote(authorityState),
    contradiction_note: CONTRADICTION_NOTE,
  });
}
