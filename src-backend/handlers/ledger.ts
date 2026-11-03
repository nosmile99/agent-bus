// Canonical decision ledger — agent-bus revamp plan v12 §5.
// Cold, append-only in effect: creates, supersedes (never in-place
// edits), tombstones (never deletes), and admin-only seeds.
//
// KNOWN LIMITATION (fix round, documented not renamed): ledger `lane`
// stores the author agent name (e.g. 'nyx'), NOT a kanban lane
// (backend/android/unassigned). The two 'lane' concepts share a field
// name by history; renaming the ledger field is a direction decision
// and is not done here, so readers must not treat ledger lane as a
// kanban lane.
import type { IBusDO, LedgerRecord } from '../types.js';
import { sha256Hex, parseBoolParam } from '../utils.js';
import { TxAbort } from './kanban.js';

export const LEDGER_KINDS = ['decision', 'hold', 'gate', 'protocol', 'handover', 'dead-end', 'dissent'] as const;
export const LEDGER_SCOPES = ['action', 'lane-note'] as const;

interface MsgRow {
  id: number;
  sender: string;
  channel: string;
  body: string;
  reply_to: number | null;
  ts: string;
}

function isRegistered(bus: IBusDO, name: string): boolean {
  return (
    bus.sql.exec(`SELECT 1 FROM agents WHERE agent = ?`, name).toArray().length > 0
  );
}

function getMessage(bus: IBusDO, id: number): MsgRow | null {
  const rows = bus.sql
    .exec(`SELECT id, sender, channel, body, reply_to, ts FROM messages WHERE id = ?`, id)
    .toArray() as unknown as MsgRow[];
  return rows[0] || null;
}

function getLedger(bus: IBusDO, id: number): LedgerRecord | null {
  const rows = bus.sql.exec(`SELECT * FROM ledger WHERE id = ?`, id).toArray() as unknown as LedgerRecord[];
  return rows[0] || null;
}

// Amendment batch: ledger columns added by migration v9 that the
// locked v12 LedgerRecord type does not declare yet (types.ts is
// outside this batch's file list, so the extension lives here until
// the parent integrates the type declarations).
export type LedgerRowExt = LedgerRecord & {
  topic: string;
  resolver: string | null;
  resolved: number | null;
  resolved_by: string | null;
  resolved_at: number | null;
};

function ledgerExt(row: LedgerRecord): LedgerRowExt {
  const r = row as unknown as Record<string, unknown>;
  return {
    ...row,
    topic: typeof r.topic === 'string' ? r.topic : '',
    resolver: typeof r.resolver === 'string' ? r.resolver : null,
    resolved: typeof r.resolved === 'number' ? r.resolved : 0,
    resolved_by: typeof r.resolved_by === 'string' ? r.resolved_by : null,
    resolved_at: typeof r.resolved_at === 'number' ? r.resolved_at : null,
  };
}

// Amendment batch, contract: true iff an ACTIVE ledger row exists
// with kind 'hold' or 'gate' AND ref_type='task' AND
// ref_id=String(taskId). Returns the lowest such row id.
export function taskHoldFor(this: IBusDO, taskId: number): { held: boolean; ledger_id: number | null } {
  const rows = this.sql
    .exec(
      `SELECT id FROM ledger WHERE status = 'active' AND kind IN ('hold', 'gate') AND ref_type = 'task' AND ref_id = ? ORDER BY id ASC LIMIT 1`,
      String(taskId)
    )
    .toArray() as unknown as Array<{ id: number }>;
  const row = rows[0];
  return row ? { held: true, ledger_id: row.id } : { held: false, ledger_id: null };
}

// Amendment batch, contract: true iff an ACTIVE, UNRESOLVED dissent
// row exists whose ref_type/ref_id match. Unresolved = the v9
// `resolved` flag is 0 or NULL (NULL only for rows predating v9).
// Returns the lowest such dissent row id.
export function dissentHoldFor(this: IBusDO, refType: string, refId: string): { held: boolean; dissent_id: number | null } {
  const rows = this.sql
    .exec(
      `SELECT id FROM ledger WHERE status = 'active' AND kind = 'dissent' AND (resolved IS NULL OR resolved = 0) AND ref_type = ? AND ref_id = ? ORDER BY id ASC LIMIT 1`,
      refType,
      refId
    )
    .toArray() as unknown as Array<{ id: number }>;
  const row = rows[0];
  return row ? { held: true, dissent_id: row.id } : { held: false, dissent_id: null };
}

// Amendment batch, item 19/21: contradiction state for one row.
// contradicts_ids = rows this row flags; contradicted_by_ids = rows
// flagging this row; contradicting_ids = the union (the spec's
// "contradicting ids" surface); has_contradiction = either side
// non-empty.
export function ledgerConflictState(
  bus: IBusDO,
  id: number
): { has_contradiction: boolean; contradicts_ids: number[]; contradicted_by_ids: number[]; contradicting_ids: number[] } {
  let contradicts_ids: number[] = [];
  let contradicted_by_ids: number[] = [];
  try {
    contradicts_ids = (
      bus.sql.exec(`SELECT contradicts_id FROM ledger_contradictions WHERE row_id = ? ORDER BY id ASC`, id).toArray() as unknown as Array<{ contradicts_id: number }>
    ).map((r) => r.contradicts_id);
    contradicted_by_ids = (
      bus.sql.exec(`SELECT row_id FROM ledger_contradictions WHERE contradicts_id = ? ORDER BY id ASC`, id).toArray() as unknown as Array<{ row_id: number }>
    ).map((r) => r.row_id);
  } catch {
    // Pre-v9 store (no contradictions table yet): no conflicts.
  }
  const contradicting_ids = [...new Set([...contradicts_ids, ...contradicted_by_ids])].sort((a, b) => a - b);
  return { has_contradiction: contradicting_ids.length > 0, contradicts_ids, contradicted_by_ids, contradicting_ids };
}

// Amendment batch, item 13: poll wake for ledger writes. Payload
// carries only the row id + action (never title/body), so a
// lane-targeted row's existence is the most that leaks via a
// scope='all' poll event, and every agent able to read the row
// sees it. Follows the emitEvent call shape in index.ts /
// dependencies.ts (type, { actor, scope, payload }).
function emitLedgerChanged(bus: IBusDO, actor: string, ledgerId: number, action: string): void {
  bus.emitEvent('ledger.changed', { actor, scope: 'all', payload: { ledger_id: ledgerId, action } });
}

function readableInChannel(bus: IBusDO, author: string, channel: string): boolean {
  if (channel === 'all-agent') {
    if (author === 'luki') return true;
    return isRegistered(bus, author);
  }
  const dm = /^dm:([^:]+):([^:]+)$/.exec(channel);
  if (dm) {
    return author === dm[1] || author === dm[2];
  }
  return (
    bus.sql
      .exec(`SELECT 1 FROM channel_members WHERE channel = ? AND agent = ?`, channel, author)
      .toArray().length > 0
  );
}

interface ProposeParsed {
  title: string;
  kind: string;
  scope: string;
  hash: string;
}

function parsePropose(body: string): ProposeParsed | null {
  const parts = body.split('|').map((p) => p.trim());
  if (parts.length !== 4) return null;
  const m0 = /^PROPOSE:\s*(.+)$/.exec(parts[0]!);
  const m1 = /^kind:\s*(.+)$/.exec(parts[1]!);
  const m2 = /^scope:\s*(.+)$/.exec(parts[2]!);
  const m3 = /^body_sha256:\s*([0-9a-fA-F]{64})$/.exec(parts[3]!);
  if (!m0 || !m1 || !m2 || !m3) return null;
  const kind = m1[1]!.trim();
  const scope = m2[1]!.trim();
  if (!(LEDGER_KINDS as readonly string[]).includes(kind)) return null;
  if (!(LEDGER_SCOPES as readonly string[]).includes(scope)) return null;
  // Fix round C1: uppercase hex is accepted and lowercased before any
  // comparison (recomputed digests are lowercase).
  return { title: m0[1]!.trim(), kind, scope, hash: m3[1]!.toLowerCase() };
}

function parseEndorse(body: string): { title: string; hash: string } | null {
  const parts = body.split('|').map((p) => p.trim());
  if (parts.length !== 2) return null;
  const m0 = /^ENDORSE:\s*(.+)$/.exec(parts[0]!);
  const m1 = /^body_sha256:\s*([0-9a-fA-F]{64})$/.exec(parts[1]!);
  if (!m0 || !m1) return null;
  return { title: m0[1]!.trim(), hash: m1[1]!.toLowerCase() };
}

// Structured endorsement verification (§5). Throws TxAbort(403) on any
// mismatch, TxAbort(409) if the endorsement was already consumed.
// Fix round C1: every failure carries a machine-readable `reason`
// naming WHICH check failed — never the expected hash, the body, or
// any message content, so a failure response cannot leak the secret
// it was checking against.
async function verifyEndorsement(
  bus: IBusDO,
  caller: string,
  title: string,
  kind: string,
  scope: string,
  body: string,
  endorsementId: number
): Promise<void> {
  const fail = (reason: string): never => {
    throw new TxAbort(403, { error: 'endorsement verification failed', reason });
  };
  const endorseMsg = getMessage(bus, endorsementId);
  if (!endorseMsg) fail('endorsement_not_found');
  // Fix round 7, F1: the test-message ban that fix round 5 (M10)
  // applied to seed/supersede/tombstone never reached this path.
  // A test proposal+endorsement pair (or a luki endorsement in
  // all-agent) could therefore authorise a real action row. Mirror
  // verifyLukiMessage's two checks onto BOTH messages here.
  // Fix round 8, (1): the proposal ban now runs before the
  // title/proposal parse-and-match checks, so a test proposal
  // paired with a mismatched endorsement fails with the test
  // reason, not title_mismatch. Ordering, stated once: the
  // endorsement ban fires first; reply_missing necessarily
  // precedes the proposal fetch (no reply_to means no proposal
  // to check); the proposal ban then fires before any proposal
  // parse or match check.
  if (endorseMsg!.channel === 'v5-seed-test' || endorseMsg!.body.includes('TEST ONLY')) fail('endorsement_test_message');
  const endorse = parseEndorse(endorseMsg!.body);
  if (!endorse) fail('endorsement_malformed');
  if (endorseMsg!.reply_to === null || endorseMsg!.reply_to === undefined) fail('reply_missing');
  const proposeMsg = getMessage(bus, endorseMsg!.reply_to as number);
  if (!proposeMsg) fail('proposal_not_found');
  if (proposeMsg!.channel === 'v5-seed-test' || proposeMsg!.body.includes('TEST ONLY')) fail('endorsement_test_message');
  if (endorse!.title !== title) fail('title_mismatch');
  const propose = parsePropose(proposeMsg!.body);
  if (!propose) fail('proposal_malformed');
  if (propose!.title !== title || propose!.kind !== kind || propose!.scope !== scope) fail('proposal_mismatch');
  if (propose!.hash !== endorse!.hash) fail('hash_mismatch');
  if (proposeMsg!.sender !== caller) fail('proposer_mismatch');
  const endorser = endorseMsg!.sender;
  if (endorser === caller || endorser === proposeMsg!.sender) fail('endorser_self');
  if (endorser === 'luki') {
    // Luki endorsements are readable only in the all-agent channel.
    if (endorseMsg!.channel !== 'all-agent') fail('luki_endorsement_channel');
  } else {
    if (!isRegistered(bus, endorser)) fail('endorser_unregistered');
    if (!readableInChannel(bus, endorser, endorseMsg!.channel)) fail('endorser_not_readable');
  }
  // Fix-round minor: the endorser must be able to read the PROPOSAL's
  // channel, not just the endorsement's — an endorsement from someone
  // who could never have seen the proposal proves nothing.
  if (!readableInChannel(bus, endorser, proposeMsg!.channel)) fail('endorser_not_in_proposal_channel');
  if (!readableInChannel(bus, proposeMsg!.sender, proposeMsg!.channel)) fail('proposer_not_readable');
  const recomputed = await sha256Hex(body);
  if (recomputed !== propose!.hash) fail('body_hash_mismatch');
  const used = bus.sql
    .exec(`SELECT 1 FROM endorsement_uses WHERE endorsement_message_id = ?`, endorsementId)
    .toArray();
  if (used.length > 0) throw new TxAbort(409, { error: 'endorsement already used', reason: 'endorsement_already_used' });
}

// Luki-message verification for seed/supersede/tombstone. Returns the
// message or throws TxAbort(403). Fix round 5, M10: the
// test-message ban is NO LONGER seed-only. Previously supersede/
// tombstone called this with only afterCreatedAt, so a test Luki
// message (test channel or TEST ONLY body) created after a row
// could authorise a protected supersede/tombstone. The ban now
// applies on every path; `forSeed` is kept for call compatibility.
function verifyLukiMessage(
  bus: IBusDO,
  lukiId: number,
  opts: { afterCreatedAt?: number | null; forSeed?: boolean } = {}
): MsgRow {
  // Fix round: machine-readable reason per check; the message body is
  // never echoed.
  const fail = (reason: string): never => {
    throw new TxAbort(403, { error: 'luki_message_id verification failed', reason });
  };
  const msg = getMessage(bus, lukiId);
  if (!msg) fail('luki_message_not_found');
  if (msg!.sender !== 'luki') fail('luki_message_not_from_luki');
  // Fix round 5, M10: test ban on ALL paths, not only seed.
  if (msg!.channel === 'v5-seed-test') fail('luki_message_test_channel');
  if (msg!.body.includes('TEST ONLY')) fail('luki_message_test_only');
  void opts.forSeed;
  if (opts.afterCreatedAt !== undefined && opts.afterCreatedAt !== null) {
    const ts = Date.parse(msg!.ts);
    if (Number.isNaN(ts) || ts <= opts.afterCreatedAt * 1000) fail('luki_message_before_row');
  }
  return msg!;
}

// Tombstone-style allowlists (fix round): unknown fields are rejected
// with the field name, after any endpoint-specific forbidden-field
// checks above have run (so their specific messages are preserved).
function assertAllowlist(payload: Record<string, unknown>, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw new TxAbort(400, { error: `field ${key} is not a ${label} field`, field: key });
    }
  }
}

function lockRefValid(ref: unknown): ref is string {
  return typeof ref === 'string' && /^lock:\d{4}-\d{2}-\d{2}:[A-Za-z0-9_-]+$/.test(ref);
}

function lockRefDateOk(ref: string): boolean {
  const datePart = ref.split(':')[1]!;
  const today = new Date().toISOString().slice(0, 10);
  return today <= datePart;
}

// Amendment batch, item 21: named-category form of the blocklist.
// Returns the category label on a hit, null otherwise. Naming only
// the CATEGORY (never the offending text) is what lets a ref-pointer
// rejection say why it failed without leaking the blocked content
// itself; the row title/body path below still returns no details.
export function ledgerBlocklistCategory(text: string): string | null {
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) return 'email';
  const runs = text.match(/[+0-9][+0-9 ()-]*/g) || [];
  for (const run of runs) {
    const stripped = run.replace(/[ ()-]/g, '');
    if (/^(\+62|62|0)8[1-9][0-9]{7,10}$/.test(stripped)) return 'phone';
    if (/^\+[1-9][0-9]{7,14}$/.test(stripped)) return 'phone';
  }
  const upper = text.toUpperCase();
  if (/(?<![A-Z0-9])[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}(?![A-Z0-9])/.test(upper)) return 'iban';
  if (/(rekening|account|iban)(?:\s+(?:number|no|nomor|is|adalah)){0,2}\s*[:#=]?\s*[A-Za-z0-9]{10,}/i.test(text)) return 'account';
  if (/(?<![A-Za-z0-9_])(bearer|api[-_]?key|token|password|secret|auth)\s*[:=\-_]?\s*[A-Za-z0-9_-]{16,}/i.test(text)) return 'secret';
  if (/(?:(?:Jl\.?|Jalan)\s+)?[A-Za-z]+(?:\s+[A-Za-z]+)*?\s+\d{1,4}\s*,\s*(?:\d{5}|(?:Kota|Kabupaten)\s+[A-Za-z]+)/i.test(text)) return 'address';
  return null;
}

// Syntactic personal-data blocklist (§5). Case-insensitive for all
// categories; substring search with boundaries, never whole-field.
export function ledgerBlocklistHit(text: string): boolean {
  return ledgerBlocklistCategory(text) !== null;
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function validateTitleBody(
  title: unknown,
  body: unknown
): { title: string; body: string } {
  if (typeof title !== 'string' || !title.trim()) {
    throw new TxAbort(400, { error: 'title required', field: 'title' });
  }
  if (typeof body !== 'string' || !body.trim()) {
    throw new TxAbort(400, { error: 'body required', field: 'body' });
  }
  const t = title.trim();
  if ([...t].length > 200) throw new TxAbort(413, { error: 'title too long (max 200 characters)', field: 'title', max_characters: 200 });
  if (byteLen(body) > 8192) throw new TxAbort(413, { error: 'body too large (max 8192 bytes)', field: 'body', max_bytes: 8192 });
  if (t.includes('|')) throw new TxAbort(400, { error: 'title must not contain |', field: 'title' });
  // Blocklist failures carry NO details: echoing which category hit,
  // or the offending text, would leak the blocked content itself.
  if (ledgerBlocklistHit(t + '\n' + body)) {
    throw new TxAbort(400, { error: 'personal data blocked by ledger blocklist' });
  }
  return { title: t, body };
}

function validateTargetLane(bus: IBusDO, targetLane: unknown): string | null {
  if (targetLane === undefined || targetLane === null) return null;
  if (typeof targetLane !== 'string' || !isRegistered(bus, targetLane)) {
    throw new TxAbort(400, { error: 'target_lane must be null or a registered agent', field: 'target_lane' });
  }
  return targetLane;
}

// Amendment batch, item 2a: topic is REQUIRED on create for kinds
// decision/hold/gate (the kinds that state something contestable —
// a decision, a hold, or a gate with no topic cannot be
// contradicted, resolved, or listed by subject, which is the whole
// point of the conflict model), and OPTIONAL for the other kinds
// (protocol/handover/dead-end/dissent), where forcing a topic
// would break terse operational rows and note-only dissents.
// Supersede inherits the old topic when omitted (same rule as
// target_lane), so the requirement only bites at creation.
const TOPIC_REQUIRED_KINDS = ['decision', 'hold', 'gate'] as const;
function validateTopic(topic: unknown, kind: string, opts: { required: boolean }): string {
  if (topic === undefined || topic === null) {
    if (opts.required) throw new TxAbort(400, { error: 'topic required for this kind', field: 'topic' });
    return '';
  }
  if (typeof topic !== 'string') throw new TxAbort(400, { error: 'invalid topic', field: 'topic' });
  const t = topic.trim();
  if (opts.required && t === '') throw new TxAbort(400, { error: 'topic required for this kind', field: 'topic' });
  if ([...t].length > 200) throw new TxAbort(413, { error: 'topic too long (max 200 characters)', field: 'topic', max_characters: 200 });
  return t;
}

// Amendment batch, item 2c: resolver must name a registered agent
// or 'admin'; an explicit null clears it (resolver endpoint only).
function validateResolver(bus: IBusDO, value: unknown, opts: { allowNull: boolean }): string | null {
  if (value === undefined || value === null) {
    if (opts.allowNull) return null;
    return null;
  }
  if (typeof value !== 'string' || !(value === 'admin' || isRegistered(bus, value))) {
    throw new TxAbort(400, { error: 'resolver must be admin or a registered agent', field: 'resolver' });
  }
  return value;
}

function validateRef(
  bus: IBusDO,
  refType: unknown,
  refId: unknown,
  opts: { required: boolean; caller?: string | null; isAdmin?: boolean }
): { refType: string | null; refId: string | null } {
  if (refType === undefined || refType === null) {
    if (opts.required) throw new TxAbort(400, { error: 'ref_type required', field: 'ref_type' });
    if (refId !== undefined && refId !== null) {
      throw new TxAbort(400, { error: 'ref_id requires ref_type', field: 'ref_id' });
    }
    return { refType: null, refId: null };
  }
  if (refType !== 'bus_message' && refType !== 'task' && refType !== 'none' && refType !== 'ledger') {
    throw new TxAbort(400, { error: 'invalid ref_type', field: 'ref_type', allowed: ['bus_message', 'task', 'none', 'ledger'] });
  }
  if (refType === 'none') {
    if (refId !== undefined && refId !== null) {
      throw new TxAbort(400, { error: 'ref_id must be null for ref_type none', field: 'ref_id' });
    }
    return { refType: 'none', refId: null };
  }
  if (refId === undefined || refId === null || (typeof refId !== 'string' && typeof refId !== 'number')) {
    throw new TxAbort(400, { error: 'ref_id required', field: 'ref_id' });
  }
  const refText = String(refId);
  // Amendment batch, item 21: ref targets are no longer
  // existence-only. Before a pointer is accepted/stored, the
  // target's title/body is scanned against the ledger blocklist
  // (400 naming the category only, never the content) and the
  // caller must be able to read the target (403). This REPLACES
  // the old existence-only behaviour on every validateRef call
  // path; the old READ-PATH CAVEAT comment is superseded by this.
  // Readability reuses the existing visibility logic per target
  // kind: message channel readability (readableInChannel),
  // task project-subscriber readability (kbSubscriberPred) plus
  // not-archived, ledger row visibility (ledgerRowVisible).
  // Admin callers bypass readability only (they see everything);
  // the blocklist scan still applies to admin writes. There is no
  // single cross-kind readability helper in the codebase, so the
  // per-kind checks above are the conservative composition, and
  // an archived task counts as unreadable (agent task reads
  // exclude archived projects).
  const isAdmin = opts.isAdmin === true;
  const caller = opts.caller ?? null;
  const denyUnreadable = (): never => {
    throw new TxAbort(403, { error: 'referenced target is not readable by the caller', field: 'ref_id' });
  };
  if (refType === 'bus_message') {
    const id = parseInt(refText, 10);
    const msg = Number.isInteger(id) ? getMessage(bus, id) : null;
    if (!msg) {
      throw new TxAbort(400, { error: 'referenced message not found', field: 'ref_id' });
    }
    const hit = ledgerBlocklistCategory(msg.body);
    if (hit) {
      throw new TxAbort(400, { error: 'referenced message blocked by ledger blocklist', field: 'ref_id', reason: hit });
    }
    if (!isAdmin && (!caller || !readableInChannel(bus, caller, msg.channel))) denyUnreadable();
  } else if (refType === 'task') {
    const id = parseInt(refText, 10);
    const rows = Number.isInteger(id)
      ? (bus.sql.exec(`SELECT id, project_id, title, description FROM tasks WHERE id = ?`, id).toArray() as unknown as Array<{ id: number; project_id: number; title: string; description: string | null }>)
      : [];
    const task = rows[0];
    if (!task) {
      throw new TxAbort(400, { error: 'referenced task not found', field: 'ref_id' });
    }
    const hit = ledgerBlocklistCategory(task.title + '\n' + (task.description || ''));
    if (hit) {
      throw new TxAbort(400, { error: 'referenced task blocked by ledger blocklist', field: 'ref_id', reason: hit });
    }
    if (!isAdmin) {
      if (!caller) denyUnreadable();
      const readable = bus.sql
        .exec(
          `SELECT 1 FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.archived = 0 AND ${bus.kbSubscriberPred('t.project_id')}`,
          id,
          caller as string
        )
        .toArray();
      if (readable.length === 0) denyUnreadable();
    }
  } else {
    // Amendment batch, item 19a: ref_type 'ledger' targets a ledger
    // row id. The ledger table carries no CHECK on ref_type, so no
    // migration step is needed to widen it (verified: the v7
    // ledger CREATE lists ref_type TEXT with no constraint).
    const id = parseInt(refText, 10);
    const target = Number.isInteger(id) ? getLedger(bus, id) : null;
    if (!target) {
      throw new TxAbort(400, { error: 'referenced ledger row not found', field: 'ref_id' });
    }
    const hit = ledgerBlocklistCategory(target.title + '\n' + target.body);
    if (hit) {
      throw new TxAbort(400, { error: 'referenced ledger row blocked by ledger blocklist', field: 'ref_id', reason: hit });
    }
    if (!isAdmin && (!caller || !ledgerRowVisible(target, false, caller))) denyUnreadable();
  }
  return { refType, refId: refText };
}

function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  return req
    .json()
    .then((d) => (d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null))
    .catch(() => null);
}

function forbiddenField(payload: Record<string, unknown>, field: string): boolean {
  return field in payload && payload[field] !== undefined;
}

function insertEvent(
  bus: IBusDO,
  ledgerId: number,
  actor: string,
  action: string,
  reason: string | null,
  now: number
): void {
  bus.sql.exec(
    `INSERT INTO ledger_events (ledger_id, actor, action, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
    ledgerId,
    actor,
    action,
    reason,
    now
  );
}

// Fix round 2, item 5: GET output carries the honest recheck_*
// names plus a disclaimer, never bare demote_* fields. Storage
// columns are unchanged; this is a presentation mapping only.
// Amendment batch, items 2/10/19: the same mapping also surfaces
// topic, resolver, resolved state, stale (recheck_at past, a
// distinct field from any deadline flag), recheck_deadline_overdue
// (now > demote_deadline, the Q8 deadline column — no second
// deadline column is invented), and the contradiction state.
function ledgerPublic(bus: IBusDO, row: LedgerRecord): Record<string, unknown> {
  const { demote_actor, demote_deadline, ...rest } = row as LedgerRecord & { demote_actor: unknown; demote_deadline: unknown };
  const ext = ledgerExt(row);
  const now = bus.kbNow();
  const deadline = typeof demote_deadline === 'number' ? demote_deadline : null;
  return {
    ...rest,
    topic: ext.topic,
    resolver: ext.resolver,
    resolved: ext.resolved === 1,
    resolved_by: ext.resolved_by,
    resolved_at: ext.resolved_at,
    recheck_actor: demote_actor,
    recheck_deadline: demote_deadline,
    recheck_note: 'recheck assignment only: scope and authority unchanged, no wake or message sent',
    stale: ext.recheck_at !== null && ext.recheck_at !== undefined && ext.recheck_at <= now,
    recheck_deadline_overdue: deadline !== null && deadline <= now,
    ...ledgerConflictState(bus, row.id),
  };
}

export async function handleLedgerCreate(this: IBusDO, req: Request): Promise<Response> {
  const agent = this.authedAgent(req);
  if (!agent) {
    try {
      await req.text();
    } catch {}
    return this.json(401, { error: 'unauthorized' });
  }
  // Fix round M14: rate-limit AFTER validation (invalid requests must
  // not consume quota); the check sits just before the transaction.
  const payload = await parseJsonBody(req);
  if (!payload) return this.json(400, { error: 'invalid json' });
  try {
    if (forbiddenField(payload, 'author') || forbiddenField(payload, 'lane')) {
      throw new TxAbort(400, { error: 'author/lane are server-stamped' });
    }
    if (forbiddenField(payload, 'supersedes_id') || forbiddenField(payload, 'superseded_by_id')) {
      throw new TxAbort(400, { error: 'supersede fields require the supersede endpoint' });
    }
    if (forbiddenField(payload, 'is_luki_ordered')) {
      throw new TxAbort(400, { error: 'is_luki_ordered cannot be set via normal POST' });
    }
    if (forbiddenField(payload, 'status') && payload.status !== 'active') {
      throw new TxAbort(400, { error: 'status must be active on create' });
    }
    assertAllowlist(
      payload,
      new Set(['title', 'body', 'kind', 'scope', 'target_lane', 'recheck_at', 'replaces_tombstoned_id', 'bus_reconciliation_id', 'ref_type', 'ref_id', 'provenance_type', 'status', 'topic', 'resolver']),
      'create'
    );
    const { title, body } = validateTitleBody(payload.title, payload.body);
    const kind = payload.kind;
    if (typeof kind !== 'string' || !(LEDGER_KINDS as readonly string[]).includes(kind)) {
      throw new TxAbort(400, { error: 'invalid kind', field: 'kind', allowed: [...LEDGER_KINDS] });
    }
    // Amendment batch, item 2a: topic required for decision/hold/gate.
    const topic = validateTopic(payload.topic, kind, { required: (TOPIC_REQUIRED_KINDS as readonly string[]).includes(kind) });
    // Amendment batch, item 2c: resolver settable on create.
    const resolver = payload.resolver === undefined ? null : validateResolver(this, payload.resolver, { allowNull: false });
    const scopeRaw = payload.scope === undefined || payload.scope === null ? 'lane-note' : payload.scope;
    if (scopeRaw !== 'action' && scopeRaw !== 'lane-note') {
      throw new TxAbort(400, { error: 'invalid scope', field: 'scope', allowed: [...LEDGER_SCOPES] });
    }
    const scope = scopeRaw as 'action' | 'lane-note';
    const targetLane = validateTargetLane(this, payload.target_lane);
    const recheckAt =
      payload.recheck_at === undefined || payload.recheck_at === null ? null : payload.recheck_at;
    if (recheckAt !== null && (typeof recheckAt !== 'number' || !Number.isInteger(recheckAt))) {
      throw new TxAbort(400, { error: 'invalid recheck_at' });
    }
    // Replacement path.
    let inheritedScope: 'action' | 'lane-note' | null = null;
    let replacesId: number | null = null;
    if (payload.replaces_tombstoned_id !== undefined && payload.replaces_tombstoned_id !== null) {
      if (typeof payload.replaces_tombstoned_id !== 'number' || !Number.isInteger(payload.replaces_tombstoned_id)) {
        throw new TxAbort(400, { error: 'invalid replaces_tombstoned_id' });
      }
      const old = getLedger(this, payload.replaces_tombstoned_id);
      if (!old) throw new TxAbort(404, { error: 'replaced row not found' });
      if (old.status === 'active' || old.status === 'superseded') {
        throw new TxAbort(409, { error: 'replaces_tombstoned_id must point at a tombstoned row' });
      }
      // Amendment batch, item 2d: single-successor. A tombstoned
      // row may have exactly ONE active replacement; a second
      // replacement 409s. (A superseded replacement's lineage
      // continues through its own supersede chain, so only the
      // ACTIVE successor blocks a new replacement — the chain
      // stays linear via the supersede active-only check.)
      const existingSuccessor = this.sql
        .exec(`SELECT 1 FROM ledger WHERE replaces_tombstoned_id = ? AND status = 'active' LIMIT 1`, old.id)
        .toArray();
      if (existingSuccessor.length > 0) {
        throw new TxAbort(409, { error: 'tombstoned row already has an active successor' });
      }
      if (forbiddenField(payload, 'scope')) {
        throw new TxAbort(400, { error: 'scope must be omitted on replacement; it is inherited' });
      }
      inheritedScope = old.scope;
      replacesId = old.id;
    }
    const effectiveScope = inheritedScope || scope;
    const reconciliation = payload.bus_reconciliation_id;
    if (effectiveScope === 'action') {
      // Fix round 2, item 6 — KEPT at 400, deliberately NOT unified
      // to 403: the locked plan's field matrix says caller values
      // contradicting a derived/server value are rejected 400, and
      // "Forbidden 400: scope action via this path alone (action
      // requires the reconciliation...)". A missing reconciliation
      // on create is that forbidden shape; supersede/seed/tombstone
      // credential failures are verification failures, hence 403.
      // The split is documented here and in SPEC §17.2.
      if (typeof reconciliation !== 'number' || !Number.isInteger(reconciliation)) {
        // Fix round C1: a format hint, not just a bare rejection. The
        // hint is a template (never a computed hash or body text).
        throw new TxAbort(400, {
          error: 'action rows require endorsement',
          field: 'bus_reconciliation_id',
          hint: 'PROPOSE: <title> | kind: <kind> | scope: action | body_sha256: <sha256 hex of body> as a bus message, then have another agent ENDORSE: <title> | body_sha256: <same hex> as a reply to it, and pass the endorsement message id as bus_reconciliation_id',
        });
      }
      await verifyEndorsement(this, agent, title, kind, effectiveScope, body, reconciliation);
    } else if (reconciliation !== undefined && reconciliation !== null) {
      throw new TxAbort(400, { error: 'bus_reconciliation_id is only for action rows' });
    }
    const ref = validateRef(this, payload.ref_type, payload.ref_id, { required: false, caller: agent, isAdmin: false });
    // Fix-round minor: a dissent must explicitly state what it
    // dissents from (a bus_message/task/ledger ref) or explicitly be
    // note-only (ref_type 'none'); a dissent with no ref at all is
    // rejected rather than silently admitted as a floating opinion.
    if (kind === 'dissent' && ref.refType === null) {
      throw new TxAbort(400, {
        error: 'dissent rows require an explicit ref_type',
        field: 'ref_type',
        allowed: ['bus_message', 'task', 'ledger', 'none'],
        hint: 'use ref_type none for a note-only dissent',
      });
    }
    let provenance: string;
    if (ref.refType === 'bus_message') provenance = 'bus_message';
    else if (ref.refType === 'task') provenance = 'task';
    else provenance = 'agent_asserted';
    if (forbiddenField(payload, 'provenance_type') && payload.provenance_type !== provenance) {
      throw new TxAbort(400, { error: 'provenance_type contradicts derived value' });
    }
    if (!this.rlCheck(agent)) return this.rlLimitedResponse(agent);
    const now = this.kbNow();
    let newId = 0;
    this.state.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO ledger (kind, title, body, author, lane, target_lane, scope, status, replaces_tombstoned_id, bus_reconciliation_id, ref_type, ref_id, provenance_type, is_luki_ordered, recheck_at, topic, resolver, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        kind,
        title,
        body,
        agent,
        agent,
        targetLane,
        effectiveScope,
        replacesId,
        effectiveScope === 'action' ? reconciliation : null,
        ref.refType,
        ref.refId,
        provenance,
        recheckAt,
        topic,
        resolver,
        now,
        now
      );
      newId = (this.sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
      if (effectiveScope === 'action') {
        const used = this.sql
          .exec(`SELECT 1 FROM endorsement_uses WHERE endorsement_message_id = ?`, reconciliation)
          .toArray();
        if (used.length > 0) throw new TxAbort(409, { error: 'endorsement already used' });
        this.sql.exec(
          `INSERT INTO endorsement_uses (endorsement_message_id, ledger_id, used_at) VALUES (?, ?, ?)`,
          reconciliation,
          newId,
          now
        );
      }
      insertEvent(this, newId, agent, 'create', null, now);
    });
    // Amendment batch, item 13: ledger writes wake pollers.
    emitLedgerChanged(this, agent, newId, 'create');
    // Fix-round minor: echo server-derived fields so callers need not
    // re-read the row to learn what was stamped.
    return this.json(200, {
      ok: true,
      id: newId,
      author: agent,
      lane: agent,
      provenance_type: provenance,
      is_luki_ordered: false,
      scope: effectiveScope,
      inherited_scope: inheritedScope,
      target_lane: targetLane,
      bus_reconciliation_id: effectiveScope === 'action' ? reconciliation : null,
      ref_type: ref.refType,
      ref_id: ref.refId,
      topic,
      resolver,
    });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

export async function handleLedgerSupersede(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let actor: string;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    actor = this.kbBasicUser(req) || 'admin';
  } else {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
    actor = agent;
  }
  // Fix round M14: agent rate-limit runs just before the transaction,
  // after all validation (invalid requests must not consume quota).
  const payload = await parseJsonBody(req);
  if (!payload) return this.json(400, { error: 'invalid json' });
  try {
    const old = getLedger(this, id);
    if (!old) throw new TxAbort(404, { error: 'ledger row not found' });
    if (old.status !== 'active') throw new TxAbort(409, { error: 'only an active row can be superseded' });
    if (old.title.startsWith('[TEST]')) {
      throw new TxAbort(409, { error: 'supersede of a [TEST] row is rejected' });
    }
    if (forbiddenField(payload, 'scope')) throw new TxAbort(400, { error: 'scope is inherited, never changed' });
    if (
      forbiddenField(payload, 'is_luki_ordered') ||
      forbiddenField(payload, 'provenance_type') ||
      forbiddenField(payload, 'supersedes_id') ||
      forbiddenField(payload, 'superseded_by_id')
    ) {
      throw new TxAbort(400, { error: 'server-managed fields cannot be set by the caller' });
    }
    assertAllowlist(
      payload,
      new Set(['title', 'body', 'kind', 'target_lane', 'recheck_at', 'luki_message_id', 'lock_decision_ref', 'ref_type', 'ref_id', 'bus_reconciliation_id', 'topic', 'resolver']),
      'supersede'
    );
    const isProtected = old.is_luki_ordered === 1 || old.provenance_type === 'lock_ordered';
    if (!opts.isAdmin) {
      if (isProtected) throw new TxAbort(403, { error: 'protected rows are admin-only' });
      if (old.author !== actor) throw new TxAbort(403, { error: 'only the author lane or admin may supersede' });
    }
    const hasLuki = payload.luki_message_id !== undefined && payload.luki_message_id !== null;
    const hasLock = payload.lock_decision_ref !== undefined && payload.lock_decision_ref !== null;
    if (hasLuki && hasLock) throw new TxAbort(400, { error: 'supplying both luki_message_id and lock_decision_ref is rejected' });
    if (!isProtected && (hasLuki || hasLock)) {
      throw new TxAbort(400, { error: 'credentials are only for protected rows' });
    }
    if (old.provenance_type === 'lock_ordered' && hasLuki) {
      // luki credential on a lock row: allowed, binding below.
    } else if (old.provenance_type !== 'lock_ordered' && hasLock) {
      throw new TxAbort(400, { error: 'lock_decision_ref is only for lock_ordered rows' });
    }
    if (isProtected && opts.isAdmin && !hasLuki && !hasLock) {
      throw new TxAbort(403, { error: 'protected supersede requires a luki_message_id or lock_decision_ref' });
    }
    // Fix-round minor: supersede is a full resubmission, not a patch
    // — the error must say title AND body are both required.
    if (
      typeof payload.title !== 'string' ||
      !payload.title.trim() ||
      typeof payload.body !== 'string' ||
      !payload.body.trim()
    ) {
      throw new TxAbort(400, {
        error: 'supersede requires full resubmission: title and body are both required',
        fields: ['title', 'body'],
      });
    }
    const { title, body } = validateTitleBody(payload.title, payload.body);
    const kind =
      payload.kind === undefined || payload.kind === null ? old.kind : payload.kind;
    if (typeof kind !== 'string' || !(LEDGER_KINDS as readonly string[]).includes(kind)) {
      throw new TxAbort(400, { error: 'invalid kind', field: 'kind', allowed: [...LEDGER_KINDS] });
    }
    let targetLane: string | null;
    if (payload.target_lane === undefined) {
      targetLane = old.target_lane;
    } else if (payload.target_lane === null) {
      targetLane = null;
    } else if (opts.isAdmin) {
      targetLane = validateTargetLane(this, payload.target_lane);
    } else {
      if (payload.target_lane !== actor) {
        throw new TxAbort(400, { error: 'target_lane change is only to null or your own agent name' });
      }
      targetLane = actor;
    }
    const recheckAtExplicitNull = payload.recheck_at === null;
    // Amendment batch, item 10b: omitting recheck_at INHERITS the
    // old value (never silently clears); an EXPLICIT null clears
    // it and is recorded in the supersede event reason below.
    const recheckAt =
      payload.recheck_at === undefined ? old.recheck_at : payload.recheck_at;
    if (recheckAt !== null && (typeof recheckAt !== 'number' || !Number.isInteger(recheckAt))) {
      throw new TxAbort(400, { error: 'invalid recheck_at' });
    }
    // Amendment batch, item 2a/2c: topic/resolver inherit when
    // omitted; a supplied topic must satisfy the same rule as on
    // create for the successor kind, a supplied resolver must name
    // a registered agent or 'admin' (explicit null clears it).
    const successorKindEarly: string =
      payload.kind === undefined || payload.kind === null ? old.kind : (payload.kind as string);
    const topic =
      payload.topic === undefined
        ? ledgerExt(old).topic
        : validateTopic(payload.topic, successorKindEarly, { required: (TOPIC_REQUIRED_KINDS as readonly string[]).includes(successorKindEarly) });
    const resolver =
      payload.resolver === undefined ? ledgerExt(old).resolver : validateResolver(this, payload.resolver, { allowNull: true });
    // Credential binding + fresh provenance.
    let provenance: string;
    let eventReason: string | null = null;
    let lockRef: string | null = null;
    if (hasLock) {
      if (!lockRefValid(payload.lock_decision_ref)) {
        throw new TxAbort(400, { error: 'invalid lock_decision_ref format' });
      }
      if (!lockRefDateOk(payload.lock_decision_ref as string)) {
        throw new TxAbort(403, { error: 'lock_decision_ref is past its cutover date' });
      }
      if (payload.ref_type !== undefined && payload.ref_type !== null && payload.ref_type !== 'none') {
        throw new TxAbort(400, { error: 'lock supersede requires ref_type none' });
      }
      if (payload.ref_id !== undefined && payload.ref_id !== null) {
        throw new TxAbort(400, { error: 'lock supersede requires ref_id null' });
      }
      provenance = 'lock_ordered';
      lockRef = payload.lock_decision_ref as string;
      eventReason = `lock_decision_ref:${lockRef}; attested_row:${old.id}`;
    } else if (hasLuki) {
      if (typeof payload.luki_message_id !== 'number' || !Number.isInteger(payload.luki_message_id)) {
        throw new TxAbort(400, { error: 'invalid luki_message_id' });
      }
      const msg = verifyLukiMessage(this, payload.luki_message_id, { afterCreatedAt: old.created_at });
      void msg;
      // m-1 fix: the hasLuki supersede branch previously left
      // eventReason NULL; record the credential marker like the
      // hasLock branch does.
      eventReason = `luki_message_id:${payload.luki_message_id}`;
      // The original seed id must not be reused: seed_luki_uses maps a
      // seed message id to the row it seeded.
      const seedUse = this.sql
        .exec(`SELECT ledger_id FROM seed_luki_uses WHERE luki_message_id = ?`, payload.luki_message_id)
        .toArray() as Array<{ ledger_id: number }>;
      if (seedUse[0] && seedUse[0].ledger_id === old.id) {
        throw new TxAbort(403, { error: 'luki_message_id must not be the original seed id' });
      }
      if (payload.ref_type !== 'bus_message' || String(payload.ref_id) !== String(payload.luki_message_id)) {
        throw new TxAbort(400, { error: 'luki supersede requires ref_type bus_message and ref_id equal to luki_message_id' });
      }
      provenance = 'bus_message';
    } else {
      const ref = validateRef(this, payload.ref_type, payload.ref_id, { required: true, caller: actor, isAdmin: opts.isAdmin });
      // Fix-round minor: a dissent supersede may be note-only
      // (ref_type 'none', provenance agent_asserted) or target a
      // ledger row (amendment batch, item 19a); other kinds
      // still require a bus_message/task ref.
      if (ref.refType !== 'bus_message' && ref.refType !== 'task') {
        if (!(kind === 'dissent' && (ref.refType === 'none' || ref.refType === 'ledger'))) {
          throw new TxAbort(400, { error: 'supersede requires ref_type bus_message or task', field: 'ref_type' });
        }
      }
      // Re-roast 9, bug M2 follow-on (found by the item 19c test):
      // the old mapping copied refType straight into provenance,
      // so a supersede with ref_type 'ledger' inserted provenance
      // 'ledger' and 500d on the provenance_type CHECK (allowed:
      // bus_message/task/agent_asserted/luki_ordered/lock_ordered).
      // Mirror create's mapping exactly: only bus_message and task
      // keep their own provenance; 'none' and 'ledger' are
      // agent_asserted.
      provenance = ref.refType === 'bus_message' ? 'bus_message' : ref.refType === 'task' ? 'task' : 'agent_asserted';
    }
    // Amendment batch, item 10b: an explicit-null recheck_at clear
    // is recorded in the supersede audit event (never silent).
    if (recheckAtExplicitNull) {
      eventReason = eventReason ? `${eventReason}; recheck_at_cleared:explicit_null` : 'recheck_at_cleared:explicit_null';
    }
    // Action-scope endorsement (agent only; admin is carved out).
    const reconciliation = payload.bus_reconciliation_id;
    if (old.scope === 'action') {
      if (opts.isAdmin) {
        // Fix-round minor: an admin-supplied endorsement id is
        // rejected outright (400), not run through a protocol it
        // cannot pass (admin is never a proposal author).
        if (reconciliation !== undefined && reconciliation !== null) {
          throw new TxAbort(400, { error: 'bus_reconciliation_id is not accepted on admin supersede', field: 'bus_reconciliation_id' });
        }
      } else {
        if (typeof reconciliation !== 'number' || !Number.isInteger(reconciliation)) {
          throw new TxAbort(403, {
            error: 'action supersede requires endorsement',
            field: 'bus_reconciliation_id',
            hint: 'PROPOSE: <title> | kind: <kind> | scope: action | body_sha256: <sha256 hex of body> as a bus message, then have another agent ENDORSE it as a reply, and pass the endorsement message id as bus_reconciliation_id',
          });
        }
        await verifyEndorsement(this, actor, title, kind, old.scope, body, reconciliation);
      }
    } else if (reconciliation !== undefined && reconciliation !== null) {
      throw new TxAbort(400, { error: 'bus_reconciliation_id is only for action rows' });
    }
    // Fresh ref for the non-credential path (already validated above).
    const ref = hasLock || hasLuki
      ? { refType: hasLock ? 'none' : 'bus_message', refId: hasLock ? null : String(payload.luki_message_id) }
      : validateRef(this, payload.ref_type, payload.ref_id, { required: true, caller: actor, isAdmin: opts.isAdmin });
    // Fix round (re-review GAP 1, #19): an unresolved dissent
    // targeting this row holds its transition until official
    // resolution (admin or designated resolver via
    // resolve-dissent). Admin is NOT exempt, mirroring
    // task-target dissent holds (kbHoldRejection): the hold binds
    // every writer, and resolution — not a bypassing transition —
    // is the way out. Checked after all validation and before
    // the rate check, so a held request consumes no quota and
    // mutates nothing.
    const ledgerDissent = dissentHoldFor.call(this, 'ledger', String(old.id));
    if (ledgerDissent.held) {
      throw new TxAbort(409, {
        error: 'dissent_held',
        dissent_id: ledgerDissent.dissent_id,
        hint: 'ledger row is under an active dissent hold; resolve the dissent first',
      });
    }
    // Re-roast 9, bug M2: an active UNRESOLVED dissent row cannot exit
    // via supersede/tombstone - that would dissolve its own hold on
    // the target with resolved still 0 and no resolve_dissent event,
    // bypassing the resolve path's rule that the author is NOT
    // authority unless also resolver. The only exit while unresolved
    // is resolve-dissent (admin or designated resolver); admin is NOT
    // exempt here either (admin can resolve first, then transition).
    // Once resolved, the row is an ordinary active row and transitions
    // proceed. Hold/gate rows are deliberately NOT treated this way:
    // they have no dedicated release endpoint, so a hold row exits
    // via tombstone (or a supersede that changes its kind away from
    // hold/gate) - the author lifting their own gate, audited as a
    // ledger transition. A plain supersede with kind inherited
    // REPLACES the hold with a successor hold row, exactly like a
    // dissent successor; a dissent differs because it is a
    // third-party objection with a designated resolver, not the
    // author's own gate.
    if (old.kind === 'dissent' && ledgerExt(old).resolved !== 1) {
      throw new TxAbort(409, {
        error: 'dissent_unresolved',
        dissent_id: old.id,
        hint: 'an active unresolved dissent row can only exit via resolve-dissent (admin or designated resolver); resolve it first',
      });
    }
    if (!opts.isAdmin && !this.rlCheck(actor)) return this.rlLimitedResponse(actor);
    const now = this.kbNow();
    let newId = 0;
    // Amendment batch, item 4 (STICKY PROTECTION): the hardcoded
    // is_luki_ordered=0 decay is removed. A luki_ordered row's
    // successor stays luki_ordered (flag 1, provenance
    // 'luki_ordered') — a fresh luki credential re-affirms rather
    // than overrides the ordering, so the successor still
    // requires the same credential on its next supersede/
    // tombstone via the existing isProtected checks above (they
    // key off is_luki_ordered/provenance_type, which is why no
    // check change is needed here). Lock_ordered successor
    // behaviour is preserved as-is (credential-branch provenance,
    // flag 0). No single-use Luki credential is implemented
    // (explicitly skipped by the batch).
    const successorIsLukiOrdered = old.is_luki_ordered === 1 ? 1 : 0;
    const successorProvenance = old.is_luki_ordered === 1 ? 'luki_ordered' : provenance;
    this.state.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO ledger (kind, title, body, author, lane, target_lane, scope, status, supersedes_id, bus_reconciliation_id, ref_type, ref_id, provenance_type, is_luki_ordered, recheck_at, topic, resolver, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        kind,
        title,
        body,
        actor,
        opts.isAdmin ? 'admin' : actor,
        targetLane,
        old.scope,
        old.id,
        old.scope === 'action' && !opts.isAdmin ? reconciliation : null,
        ref.refType,
        ref.refId,
        successorProvenance,
        successorIsLukiOrdered,
        recheckAt,
        topic,
        resolver,
        now,
        now
      );
      newId = (this.sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
      this.sql.exec(
        `UPDATE ledger SET status = 'superseded', superseded_by_id = ?, updated_at = ? WHERE id = ?`,
        newId,
        now,
        old.id
      );
      if (old.scope === 'action' && !opts.isAdmin) {
        const used = this.sql
          .exec(`SELECT 1 FROM endorsement_uses WHERE endorsement_message_id = ?`, reconciliation)
          .toArray();
        if (used.length > 0) throw new TxAbort(409, { error: 'endorsement already used' });
        this.sql.exec(
          `INSERT INTO endorsement_uses (endorsement_message_id, ledger_id, used_at) VALUES (?, ?, ?)`,
          reconciliation,
          newId,
          now
        );
      }
      if (lockRef) {
        const used = this.sql
          .exec(`SELECT 1 FROM seed_exception_uses WHERE lock_decision_ref = ?`, lockRef)
          .toArray();
        if (used.length > 0) throw new TxAbort(409, { error: 'lock_decision_ref already used' });
        this.sql.exec(
          `INSERT INTO seed_exception_uses (lock_decision_ref, ledger_id, used_at) VALUES (?, ?, ?)`,
          lockRef,
          newId,
          now
        );
      }
      insertEvent(this, newId, actor, 'supersede', eventReason, now);
    });
    // Amendment batch, item 13: ledger writes wake pollers.
    emitLedgerChanged(this, actor, newId, 'supersede');
    // Fix-round minor: echo server-derived fields + the acting
    // actor/lane so agent vs admin supersede paths are discoverable
    // from the response alone.
    return this.json(200, {
      ok: true,
      id: newId,
      supersedes_id: old.id,
      actor,
      lane: opts.isAdmin ? 'admin' : actor,
      provenance_type: successorProvenance,
      is_luki_ordered: successorIsLukiOrdered === 1,
      scope: old.scope,
      inherited_scope: old.scope,
      target_lane: targetLane,
      bus_reconciliation_id: old.scope === 'action' && !opts.isAdmin ? reconciliation : null,
      ref_type: ref.refType,
      ref_id: ref.refId,
      recheck_at: recheckAt,
      topic,
      resolver,
    });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

export async function handleLedgerTombstone(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let actor: string;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    actor = this.kbBasicUser(req) || 'admin';
  } else {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
    actor = agent;
  }
  // Fix round M14: agent rate-limit runs just before the transaction,
  // after all validation (invalid requests must not consume quota).
  const payload = await parseJsonBody(req);
  if (!payload) return this.json(400, { error: 'invalid json' });
  try {
    const old = getLedger(this, id);
    if (!old) throw new TxAbort(404, { error: 'ledger row not found' });
    if (old.status !== 'active') throw new TxAbort(409, { error: 'only an active row can be tombstoned' });
    if (typeof payload.reason !== 'string' || !payload.reason.trim()) {
      throw new TxAbort(400, { error: 'reason required' });
    }
    const reason = payload.reason.trim();
    if (ledgerBlocklistHit(reason)) {
      throw new TxAbort(400, { error: 'personal data blocked by ledger blocklist' });
    }
    const allowed = new Set(['reason', 'luki_message_id', 'lock_decision_ref']);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) throw new TxAbort(400, { error: `field ${key} is not a tombstone field` });
    }
    if (payload.bus_reconciliation_id !== undefined && payload.bus_reconciliation_id !== null) {
      throw new TxAbort(400, { error: 'bus_reconciliation_id is not a tombstone field' });
    }
    const hasLuki = payload.luki_message_id !== undefined && payload.luki_message_id !== null;
    const hasLock = payload.lock_decision_ref !== undefined && payload.lock_decision_ref !== null;
    if (hasLuki && hasLock) throw new TxAbort(400, { error: 'supplying both luki_message_id and lock_decision_ref is rejected' });
    const isProtected = old.is_luki_ordered === 1 || old.provenance_type === 'lock_ordered';
    // Fix-round m-1: the protected/admin-only check runs BEFORE the
    // lock-scope check, so a non-admin agent tombstoning a protected
    // row is 403 regardless of credential (per plan). The lock-scope
    // check below still applies to admin callers, so an admin
    // tombstoning a luki_ordered row with only a lock ref is 400.
    if (!opts.isAdmin && isProtected) throw new TxAbort(403, { error: 'protected rows are admin-only' });
    // MA-1 fix (mirror of the supersede rule): a lock ref is only for
    // lock_ordered rows, so a luki_ordered row tombstoned with only a
    // lock ref is 400, never accepted; a luki_ordered row with neither
    // credential is still 403 below.
    if (old.provenance_type !== 'lock_ordered' && hasLock) throw new TxAbort(400, { error: 'lock_decision_ref is only for lock_ordered rows' });
    if (!opts.isAdmin) {
      if (old.author !== actor) throw new TxAbort(403, { error: 'only the author lane or admin may tombstone' });
    }
    if (!isProtected && (hasLuki || hasLock)) {
      throw new TxAbort(400, { error: 'credentials are only for protected rows' });
    }
    let eventReason = reason;
    let lockRef: string | null = null;
    if (isProtected && opts.isAdmin) {
      if (old.is_luki_ordered === 1 && !hasLuki && !hasLock) {
        throw new TxAbort(403, { error: 'luki_ordered tombstone requires a luki_message_id' });
      }
      if (old.provenance_type === 'lock_ordered' && !hasLuki && !hasLock) {
        throw new TxAbort(403, { error: 'lock_ordered tombstone requires a credential' });
      }
      if (hasLuki) {
        if (typeof payload.luki_message_id !== 'number' || !Number.isInteger(payload.luki_message_id)) {
          throw new TxAbort(400, { error: 'invalid luki_message_id' });
        }
        verifyLukiMessage(this, payload.luki_message_id, { afterCreatedAt: old.created_at });
        const seedUse = this.sql
          .exec(`SELECT ledger_id FROM seed_luki_uses WHERE luki_message_id = ?`, payload.luki_message_id)
          .toArray() as Array<{ ledger_id: number }>;
        if (seedUse[0] && seedUse[0].ledger_id === old.id) {
          throw new TxAbort(403, { error: 'luki_message_id must not be the original seed id' });
        }
        eventReason = `${reason}; luki_message_id:${payload.luki_message_id}`;
      } else if (hasLock) {
        if (!lockRefValid(payload.lock_decision_ref)) {
          throw new TxAbort(400, { error: 'invalid lock_decision_ref format' });
        }
        if (!lockRefDateOk(payload.lock_decision_ref as string)) {
          throw new TxAbort(403, { error: 'lock_decision_ref is past its cutover date' });
        }
        lockRef = payload.lock_decision_ref as string;
        eventReason = `${reason}; lock_decision_ref:${lockRef}; attested_row:${old.id}`;
      }
    }
    // Fix round (re-review GAP 1, #19): an unresolved dissent
    // targeting this row holds its transition until official
    // resolution (admin or designated resolver via
    // resolve-dissent). Admin is NOT exempt, mirroring
    // task-target dissent holds (kbHoldRejection): the hold binds
    // every writer, and resolution — not a bypassing transition —
    // is the way out. Checked after all validation and before
    // the rate check, so a held request consumes no quota and
    // mutates nothing.
    const ledgerDissent = dissentHoldFor.call(this, 'ledger', String(old.id));
    if (ledgerDissent.held) {
      throw new TxAbort(409, {
        error: 'dissent_held',
        dissent_id: ledgerDissent.dissent_id,
        hint: 'ledger row is under an active dissent hold; resolve the dissent first',
      });
    }
    // Re-roast 9, bug M2: an active UNRESOLVED dissent row cannot exit
    // via supersede/tombstone - that would dissolve its own hold on
    // the target with resolved still 0 and no resolve_dissent event,
    // bypassing the resolve path's rule that the author is NOT
    // authority unless also resolver. The only exit while unresolved
    // is resolve-dissent (admin or designated resolver); admin is NOT
    // exempt here either (admin can resolve first, then transition).
    // Once resolved, the row is an ordinary active row and transitions
    // proceed. Hold/gate rows are deliberately NOT treated this way:
    // they have no dedicated release endpoint, so a hold row exits
    // via tombstone (or a supersede that changes its kind away from
    // hold/gate) - the author lifting their own gate, audited as a
    // ledger transition. A plain supersede with kind inherited
    // REPLACES the hold with a successor hold row, exactly like a
    // dissent successor; a dissent differs because it is a
    // third-party objection with a designated resolver, not the
    // author's own gate.
    if (old.kind === 'dissent' && ledgerExt(old).resolved !== 1) {
      throw new TxAbort(409, {
        error: 'dissent_unresolved',
        dissent_id: old.id,
        hint: 'an active unresolved dissent row can only exit via resolve-dissent (admin or designated resolver); resolve it first',
      });
    }
    if (!opts.isAdmin && !this.rlCheck(actor)) return this.rlLimitedResponse(actor);
    const now = this.kbNow();
    this.state.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE ledger SET status = 'tombstoned', tombstone_reason = ?, tombstoned_by = ?, tombstoned_at = ?, updated_at = ? WHERE id = ?`,
        reason,
        actor,
        now,
        now,
        old.id
      );
      if (lockRef) {
        const used = this.sql
          .exec(`SELECT 1 FROM seed_exception_uses WHERE lock_decision_ref = ?`, lockRef)
          .toArray();
        if (used.length > 0) throw new TxAbort(409, { error: 'lock_decision_ref already used' });
        this.sql.exec(
          `INSERT INTO seed_exception_uses (lock_decision_ref, ledger_id, used_at) VALUES (?, ?, ?)`,
          lockRef,
          old.id,
          now
        );
      }
      insertEvent(this, old.id, actor, 'tombstone', eventReason, now);
    });
    // Amendment batch, item 13: ledger writes wake pollers.
    emitLedgerChanged(this, actor, old.id, 'tombstone');
    // Fix-round minor: echo the acting actor/lane so agent vs admin
    // tombstone paths are discoverable from the response alone.
    // Fix round 4, item 13: also echo the resulting status and
    // tombstone_reason, so the caller need not re-read the row.
    return this.json(200, {
      ok: true,
      id: old.id,
      actor,
      lane: opts.isAdmin ? 'admin' : actor,
      status: 'tombstoned',
      tombstone_reason: reason,
    });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

export async function handleLedgerSeed(this: IBusDO, req: Request): Promise<Response> {
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const actor = this.kbBasicUser(req) || 'admin';
  const payload = await parseJsonBody(req);
  if (!payload) return this.json(400, { error: 'invalid json' });
  try {
    if (forbiddenField(payload, 'author') || forbiddenField(payload, 'lane')) {
      throw new TxAbort(400, { error: 'author/lane are server-stamped' });
    }
    if (forbiddenField(payload, 'is_luki_ordered') || forbiddenField(payload, 'provenance_type')) {
      throw new TxAbort(400, { error: 'provenance is derived from the seed credential' });
    }
    assertAllowlist(
      payload,
      new Set(['title', 'body', 'kind', 'scope', 'target_lane', 'recheck_at', 'replaces_tombstoned_id', 'luki_message_id', 'lock_decision_ref', 'ref_type', 'ref_id', 'topic', 'resolver']),
      'seed'
    );
    const hasLuki = payload.luki_message_id !== undefined && payload.luki_message_id !== null;
    const hasLock = payload.lock_decision_ref !== undefined && payload.lock_decision_ref !== null;
    if (hasLuki && hasLock) throw new TxAbort(400, { error: 'supplying both luki_message_id and lock_decision_ref is rejected' });
    if (!hasLuki && !hasLock) throw new TxAbort(403, { error: 'seed requires a luki_message_id or lock_decision_ref' });
    const { title, body } = validateTitleBody(payload.title, payload.body);
    const kind = payload.kind;
    if (typeof kind !== 'string' || !(LEDGER_KINDS as readonly string[]).includes(kind)) {
      throw new TxAbort(400, { error: 'invalid kind', field: 'kind', allowed: [...LEDGER_KINDS] });
    }
    // Amendment batch, item 2a/2c: seed is a create path, so the
    // same topic requirement and resolver validation apply.
    const topic = validateTopic(payload.topic, kind, { required: (TOPIC_REQUIRED_KINDS as readonly string[]).includes(kind) });

    const resolver = payload.resolver === undefined ? null : validateResolver(this, payload.resolver, { allowNull: false });
    const targetLane = validateTargetLane(this, payload.target_lane);
    const recheckAt =
      payload.recheck_at === undefined || payload.recheck_at === null ? null : payload.recheck_at;
    if (recheckAt !== null && (typeof recheckAt !== 'number' || !Number.isInteger(recheckAt))) {
      throw new TxAbort(400, { error: 'invalid recheck_at' });
    }
    let replacesId: number | null = null;
    let scope: 'action' | 'lane-note';
    if (payload.replaces_tombstoned_id !== undefined && payload.replaces_tombstoned_id !== null) {
      if (typeof payload.replaces_tombstoned_id !== 'number' || !Number.isInteger(payload.replaces_tombstoned_id)) {
        throw new TxAbort(400, { error: 'invalid replaces_tombstoned_id' });
      }
      const old = getLedger(this, payload.replaces_tombstoned_id);
      if (!old) throw new TxAbort(404, { error: 'replaced row not found' });
      if (old.status === 'active' || old.status === 'superseded') {
        throw new TxAbort(409, { error: 'replaces_tombstoned_id must point at a tombstoned row' });
      }
      // Amendment batch, item 2d: single-successor guard, same as
      // the agent create path.
      const existingSuccessor = this.sql
        .exec(`SELECT 1 FROM ledger WHERE replaces_tombstoned_id = ? AND status = 'active' LIMIT 1`, old.id)
        .toArray();
      if (existingSuccessor.length > 0) {
        throw new TxAbort(409, { error: 'tombstoned row already has an active successor' });
      }
      if (forbiddenField(payload, 'scope')) {
        throw new TxAbort(400, { error: 'scope must be omitted on replacement; it is inherited' });
      }
      replacesId = old.id;
      scope = old.scope;
    } else {
      const scopeRaw = payload.scope === undefined || payload.scope === null ? 'lane-note' : payload.scope;
      if (scopeRaw !== 'action' && scopeRaw !== 'lane-note') {
        throw new TxAbort(400, { error: 'invalid scope' });
      }
      scope = scopeRaw;
    }
    const ref = validateRef(this, payload.ref_type, payload.ref_id, { required: false, caller: null, isAdmin: true });
    // Same dissent rule as create: an explicit ref (or explicit
    // note-only 'none') is required; a missing ref is rejected.
    if (kind === 'dissent' && ref.refType === null) {
      throw new TxAbort(400, {
        error: 'dissent rows require an explicit ref_type',
        field: 'ref_type',
        allowed: ['bus_message', 'task', 'ledger', 'none'],
        hint: 'use ref_type none for a note-only dissent',
      });
    }
    let provenance: string;
    let isLukiOrdered: number;
    let eventReason: string;
    let lockRef: string | null = null;
    if (hasLuki) {
      if (typeof payload.luki_message_id !== 'number' || !Number.isInteger(payload.luki_message_id)) {
        throw new TxAbort(400, { error: 'invalid luki_message_id' });
      }
      verifyLukiMessage(this, payload.luki_message_id, { forSeed: true });
      const used = this.sql
        .exec(`SELECT 1 FROM seed_luki_uses WHERE luki_message_id = ?`, payload.luki_message_id)
        .toArray();
      if (used.length > 0) throw new TxAbort(409, { error: 'luki_message_id already used for a seed' });
      provenance = 'luki_ordered';
      isLukiOrdered = 1;
      eventReason = `luki_message_id:${payload.luki_message_id}`;
    } else {
      if (!lockRefValid(payload.lock_decision_ref)) {
        throw new TxAbort(400, { error: 'invalid lock_decision_ref format' });
      }
      if (!lockRefDateOk(payload.lock_decision_ref as string)) {
        throw new TxAbort(403, { error: 'lock_decision_ref is past its cutover date' });
      }
      const used = this.sql
        .exec(`SELECT 1 FROM seed_exception_uses WHERE lock_decision_ref = ?`, payload.lock_decision_ref)
        .toArray();
      if (used.length > 0) throw new TxAbort(409, { error: 'lock_decision_ref already used' });
      // Row-specific lock authorisation is admin attestation, not
      // server verification: there is no lock-decision table to read.
      provenance = 'lock_ordered';
      isLukiOrdered = 0;
      lockRef = payload.lock_decision_ref as string;
      eventReason = `lock_decision_ref:${lockRef}`;
    }
    const now = this.kbNow();
    let newId = 0;
    this.state.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO ledger (kind, title, body, author, lane, target_lane, scope, status, replaces_tombstoned_id, ref_type, ref_id, provenance_type, is_luki_ordered, recheck_at, topic, resolver, created_at, updated_at)
         VALUES (?, ?, ?, 'admin', 'admin', ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        kind,
        title,
        body,
        targetLane,
        scope,
        replacesId,
        ref.refType,
        ref.refId,
        provenance,
        isLukiOrdered,
        recheckAt,
        topic,
        resolver,
        now,
        now
      );
      newId = (this.sql.exec('SELECT last_insert_rowid() AS id').one() as { id: number }).id;
      // Fix round 3 minor: single-use re-checked INSIDE the
      // transaction, like supersede/tombstone already do. The
      // pre-transaction check alone would let a duplicate insert
      // hit the PRIMARY KEY and surface as a 500 instead of a 409.
      if (hasLuki) {
        const usedAgain = this.sql
          .exec(`SELECT 1 FROM seed_luki_uses WHERE luki_message_id = ?`, payload.luki_message_id)
          .toArray();
        if (usedAgain.length > 0) throw new TxAbort(409, { error: 'luki_message_id already used for a seed' });
        this.sql.exec(
          `INSERT INTO seed_luki_uses (luki_message_id, ledger_id, used_at) VALUES (?, ?, ?)`,
          payload.luki_message_id,
          newId,
          now
        );
      } else if (lockRef) {
        const usedAgain = this.sql
          .exec(`SELECT 1 FROM seed_exception_uses WHERE lock_decision_ref = ?`, lockRef)
          .toArray();
        if (usedAgain.length > 0) throw new TxAbort(409, { error: 'lock_decision_ref already used' });
        this.sql.exec(
          `INSERT INTO seed_exception_uses (lock_decision_ref, ledger_id, used_at) VALUES (?, ?, ?)`,
          lockRef,
          newId,
          now
        );
      }
      insertEvent(this, newId, actor, 'seed', eventReason, now);
    });
    // Amendment batch, item 13: ledger writes wake pollers.
    emitLedgerChanged(this, actor, newId, 'seed');
    // Fix-round minor: echo server-derived fields.
    return this.json(200, {
      ok: true,
      id: newId,
      actor,
      lane: 'admin',
      provenance_type: provenance,
      is_luki_ordered: isLukiOrdered === 1,
      scope,
      target_lane: targetLane,
      ref_type: ref.refType,
      ref_id: ref.refId,
      topic,
      resolver,
    });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

// Fix round 2, item 5: user-facing name is RECHECK ASSIGNMENT.
// The old /demote route remains as a documented compatibility alias
// only (see routes/ledger.ts); the event action value stays
// 'demote' because the v7 ledger_events CHECK enumerates it and
// renaming it would need a migration — its reason string now
// carries the honest recheck-assignment disclaimer instead.
// Semantics unchanged: recording-only, no wake, no message.
export async function handleLedgerRecheckAssignment(this: IBusDO, req: Request, id: number): Promise<Response> {
  // Lock decision Q8: demote step with a per-row actor and a per-row
  // deadline. This endpoint is NOT in the plan v12 §5 endpoint table;
  // it exists because the lock answer orders the step. MA-2 fix:
  // demote records demote_actor and demote_deadline on the row ONLY
  // and never changes scope: authority removal goes through the
  // existing supersede/tombstone paths with their credential
  // protections, so demote can never strip authority from a
  // protected row on admin Basic alone.
  // Fix round M1 (demote renamed honestly): this endpoint is a
  // RECHECK ASSIGNMENT, nothing more. It assigns who must recheck
  // the row by when; it does not change scope, does not change
  // authority, and it sends NO wake and NO message — there is no
  // enforcement here, because enforcement (wake/message) was never
  // decided and must not be invented. Deadlines are Unix seconds
  // (documented unit, echoed in the response) and a past deadline
  // is rejected. Storage column names (demote_actor/demote_deadline)
  // are unchanged, but the response carries ONLY the honest
  // recheck_* names — there are no old demote_* compatibility
  // aliases in the response (the test asserts demote_actor is
  // undefined); demote_* survives only as internal storage names.
  if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  const actor = this.kbBasicUser(req) || 'admin';
  const payload = await parseJsonBody(req);
  if (!payload) return this.json(400, { error: 'invalid json' });
  try {
    // Fix round 3 minor: sibling ledger writes enforce allowlists;
    // recheck-assignment silently dropped unknown fields before.
    assertAllowlist(payload, new Set(['actor', 'deadline']), 'recheck-assignment');
    const old = getLedger(this, id);
    if (!old) throw new TxAbort(404, { error: 'ledger row not found' });
    if (old.status !== 'active') throw new TxAbort(409, { error: 'only an active row can be assigned a recheck' });
    const demoteActor = payload.actor;
    const deadline = payload.deadline;
    if (typeof demoteActor !== 'string' || !(demoteActor === 'admin' || isRegistered(this, demoteActor))) {
      throw new TxAbort(400, { error: 'actor must be admin or a registered agent' });
    }
    if (typeof deadline !== 'number' || !Number.isInteger(deadline)) {
      throw new TxAbort(400, { error: 'deadline must be an integer timestamp', field: 'deadline', unit: 'unix_seconds' });
    }
    const now = this.kbNow();
    if (deadline <= now) {
      throw new TxAbort(400, { error: 'deadline must be in the future', field: 'deadline', unit: 'unix_seconds' });
    }
    this.state.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE ledger SET demote_actor = ?, demote_deadline = ?, updated_at = ? WHERE id = ?`,
        demoteActor,
        deadline,
        now,
        id
      );
      insertEvent(this, id, actor, 'demote', `recheck_assignment: actor:${demoteActor}; deadline:${deadline}; scope and authority unchanged, no wake or message sent`, now);
    });
    // Amendment batch, item 13: recheck-assignment deliberately
    // emits NO ledger.changed event — its locked semantics are
    // recording-only ("no wake or message sent"), and a poll wake
    // here would contradict that lock. Only create/supersede/
    // tombstone/seed/contradiction/resolver/resolve-dissent wake.
    return this.json(200, {
      ok: true,
      id,
      scope: old.scope,
      scope_unchanged: true,
      authority_unchanged: true,
      recheck_actor: demoteActor,
      recheck_deadline: deadline,
      recheck_deadline_unit: 'unix_seconds',
      note: 'recheck assignment only: scope and authority are unchanged, and no wake or message is sent',
    });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

export const handleLedgerDemote = handleLedgerRecheckAssignment;

function ledgerRowVisible(row: LedgerRecord, isAdmin: boolean, agent: string | null): boolean {
  if (isAdmin) return true;
  return row.target_lane === null || row.target_lane === agent;
}

export async function handleLedgerList(
  this: IBusDO,
  req: Request,
  url: URL,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let agent: string | null = null;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  } else {
    agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
  }
  // Fix round M14: all parameter validation runs BEFORE the rate
  // check, so a 400/403 list does not consume quota.
  const q = url.searchParams;
  // Fix round 7, (a): unified boolean spelling — "1" and "true"
  // both mean true (previously only "true" did, so
  // ?include_history=1 silently listed active-only rows).
  const includeHistoryParsed = parseBoolParam(q.get('include_history'));
  if (!includeHistoryParsed.ok) {
    return this.json(400, { error: 'invalid include_history', field: 'include_history', allowed: ['1', 'true', '0', 'false'] });
  }
  const includeHistory = includeHistoryParsed.value;
  if (includeHistory && !opts.isAdmin) {
    return this.json(403, { error: 'include_history is admin-only' });
  }
  const statusParam = q.get('status');
  if (statusParam !== null && statusParam !== 'active' && statusParam !== 'superseded' && statusParam !== 'tombstoned' && statusParam !== '') {
    return this.json(400, { error: 'invalid status', field: 'status', allowed: ['active', 'superseded', 'tombstoned'] });
  }
  // Fix-round minors, status semantics (fix round 3, M20):
  // - An explicitly EMPTY status is treated as 'active' (not "all"),
  //   even with include_history — the plan's default is status
  //   active, and the old code contradicted this comment by
  //   returning all statuses for ?status=&include_history=true.
  // - include_history with NO status param means all statuses, but a
  //   NON-EMPTY status filter is never discarded by include_history.
  // - A non-admin list is active-only (an explicit non-active status
  //   is 403; an empty status is treated as active, as for admin).
  let effectiveStatus: string;
  if (statusParam === null) {
    effectiveStatus = includeHistory ? '' : 'active';
  } else if (statusParam === '') {
    effectiveStatus = 'active';
  } else {
    effectiveStatus = statusParam;
  }
  if (!opts.isAdmin && effectiveStatus !== 'active') {
    return this.json(403, { error: 'non-admin list is active-only' });
  }
  // Fix round 5, M12: strict limit parsing (400, not silent
  // coercion to 20) to match cursor-error behaviour.
  // Fix round 6, (e): unified parsing — the string "null" is
  // absent for limit and cursor, like every other pager.
  const limitRaw0 = q.get('limit');
  const limitRaw = limitRaw0 === 'null' ? null : limitRaw0;
  if (limitRaw !== null && (!/^\d+$/.test(limitRaw) || parseInt(limitRaw, 10) < 1)) {
    return this.json(400, { error: 'invalid limit', field: 'limit' });
  }
  let limit = limitRaw === null ? 20 : parseInt(limitRaw, 10);
  if (limit > 100) limit = 100;
  const kind = q.get('kind');
  if (kind !== null && !(LEDGER_KINDS as readonly string[]).includes(kind)) {
    return this.json(400, { error: 'invalid kind', field: 'kind', allowed: [...LEDGER_KINDS] });
  }
  const targetLaneParam = q.get('target_lane');
  // Fix round 7, cheap: a typo'd target_lane used to return an
  // empty page indistinguishable from "no rows". It is now 400
  // unless it names a registered agent or a lane value actually
  // present on a ledger row (the second arm keeps rows targeted
  // at a since-deregistered agent listable).
  // Fix round 8, (7): the second arm is admin-only. For a
  // non-admin caller it was an existence oracle: an unknown
  // string 400'd while another agent's registered name passed
  // validation (then returned an empty page via the visibility
  // filter), so 400-vs-200 leaked whether a lane value exists
  // anywhere. Non-admin callers lose nothing in practice: their
  // list filter already restricts to (target_lane IS NULL OR
  // target_lane = own name), and their own name passes the
  // registered-agent arm. Admin keeps the deregistered-target
  // listability the second arm was added for.
  if (targetLaneParam !== null) {
    const known =
      isRegistered(this, targetLaneParam) ||
      (opts.isAdmin &&
        this.sql.exec(`SELECT 1 FROM ledger WHERE target_lane = ? LIMIT 1`, targetLaneParam).toArray().length > 0);
    if (!known) {
      return this.json(400, { error: 'invalid target_lane', field: 'target_lane' });
    }
  }
  const refType = q.get('ref_type');
  if (refType !== null && refType !== 'bus_message' && refType !== 'task' && refType !== 'none' && refType !== 'ledger') {
    return this.json(400, { error: 'invalid ref_type', field: 'ref_type', allowed: ['bus_message', 'task', 'none', 'ledger'] });
  }
  const refId = q.get('ref_id');
  const keywordRaw = q.get('q');
  const keyword = keywordRaw === null ? null : keywordRaw.trim();
  if (keyword !== null && keyword !== '' && byteLen(keyword) > 48) {
    return this.json(400, { error: 'keyword too long (max 48 bytes)', field: 'q', max_bytes: 48 });
  }
  const recheckBeforeRaw = q.get('recheck_before');
  // Fix round 7, (d): strict digits + "null"-as-absent, like every
  // other pager — previously parseInt coerced "12abc" to 12 and
  // "null" to NaN (which then 400'd only via the integer check,
  // unlike the unified pagers that treat it as absent).
  let recheckBefore: number | null = null;
  if (recheckBeforeRaw !== null && recheckBeforeRaw !== 'null') {
    if (!/^\d+$/.test(recheckBeforeRaw)) return this.json(400, { error: 'invalid recheck_before', field: 'recheck_before' });
    recheckBefore = parseInt(recheckBeforeRaw, 10);
  }
  // Amendment batch, item 13b: since/changed filters. ?since is an
  // ISO timestamp; rows qualify on updated_at (which equals
  // created_at on create and is bumped on every supersede/
  // tombstone/recheck/resolver/contradiction write, so it covers
  // created-or-updated). ?changed_after_id is a ledger-row id
  // cursor (rows with id greater than it) — the same id-ASC
  // direction as after_id, but without anchor-match validation,
  // so it composes with since and with kind/status filters. Both
  // filters AND together and AND with after_id when present.
  const sinceRaw = q.get('since');
  let sinceSec: number | null = null;
  if (sinceRaw !== null && sinceRaw !== '') {
    const ms = Date.parse(sinceRaw);
    if (Number.isNaN(ms)) return this.json(400, { error: 'invalid since', field: 'since' });
    sinceSec = Math.floor(ms / 1000);
  }
  const changedRaw0 = q.get('changed_after_id');
  const changedRaw = changedRaw0 === 'null' ? null : changedRaw0;
  let changedAfterId: number | null = null;
  if (changedRaw !== null) {
    if (!/^\d+$/.test(changedRaw)) return this.json(400, { error: 'invalid changed_after_id', field: 'changed_after_id' });
    changedAfterId = parseInt(changedRaw, 10);
  }
  const afterIdRaw0 = q.get('after_id');
  const afterIdRaw = afterIdRaw0 === 'null' ? null : afterIdRaw0;
  let anchor: LedgerRecord | null = null;
  if (afterIdRaw !== null) {
    if (!/^\d+$/.test(afterIdRaw)) return this.json(400, { error: 'invalid after_id', field: 'after_id' });
    const afterId = parseInt(afterIdRaw, 10);
    anchor = getLedger(this, afterId);
    if (!anchor) return this.json(400, { error: 'invalid after_id', field: 'after_id' });
    // Fix round 2, item 4: an anchor must be readable by the caller,
    // like an id-read — a lane-invisible row is 404, not a cursor.
    if (!opts.isAdmin && !ledgerRowVisible(anchor, false, agent)) {
      return this.json(404, { error: 'ledger row not found', field: 'after_id' });
    }
    // Fix round 3 minor: the recheck-list anchor validity check
    // (anchor must carry recheck_at) used to sit after the rate
    // check, so an invalid recheck cursor consumed quota. It is
    // validated here, before the rate check, like other lists.
    if (recheckBefore !== null && anchor.recheck_at === null) {
      return this.json(400, { error: 'invalid after_id for recheck list', field: 'after_id' });
    }
    // Fix round 7, (b): the anchor must itself satisfy the
    // request's filters. A cursor reused across a filter change
    // used to silently skip rows: the page query is
    // filters AND id > anchor, so rows before the anchor that
    // match the NEW filter never appear, with no error. Now the
    // anchor is 400 unless it matches every filter in the
    // request (status, kind, target_lane, ref_type, ref_id,
    // recheck_before window, and the keyword substring when
    // present). Callers paging one filtered list keep working:
    // every row of that list's page satisfies its own filters.
    const anchorFilterMismatch =
      (effectiveStatus !== '' && anchor.status !== effectiveStatus) ||
      (kind !== null && anchor.kind !== kind) ||
      (targetLaneParam !== null && anchor.target_lane !== targetLaneParam) ||
      (refType !== null && anchor.ref_type !== refType) ||
      (refId !== null && anchor.ref_id !== refId) ||
      (recheckBefore !== null && (anchor.recheck_at === null || anchor.recheck_at > recheckBefore)) ||
      (sinceSec !== null && anchor.updated_at <= sinceSec) ||
      (changedAfterId !== null && anchor.id <= changedAfterId) ||
      (keyword !== null && keyword !== '' &&
        !anchor.title.toLowerCase().includes(keyword.toLowerCase()) &&
        !anchor.body.toLowerCase().includes(keyword.toLowerCase()));
    if (anchorFilterMismatch) {
      return this.json(400, { error: 'anchor does not match filters', field: 'after_id', hint: 'the anchor row changed (e.g. superseded) or the filters changed since page 1; re-list from the start with no after_id to resume paging' });
    }
  }
  // Fix round (re-review GAP 2, #13): agent reads charge the READ
  // bucket, never the write bucket.
  if (!opts.isAdmin && agent !== null && !this.rlCheckRead(agent)) return this.rlReadLimitedResponse(agent);
  const conds: string[] = [];
  const params: (string | number)[] = [];
  if (effectiveStatus !== '') {
    conds.push(`status = ?`);
    params.push(effectiveStatus);
  }
  if (kind !== null) {
    conds.push(`kind = ?`);
    params.push(kind);
  }
  if (targetLaneParam !== null) {
    conds.push(`target_lane = ?`);
    params.push(targetLaneParam);
  }
  if (refType !== null) {
    conds.push(`ref_type = ?`);
    params.push(refType);
  }
  if (refId !== null) {
    conds.push(`ref_id = ?`);
    params.push(refId);
  }
  if (sinceSec !== null) {
    conds.push(`updated_at > ?`);
    params.push(sinceSec);
  }
  if (changedAfterId !== null) {
    conds.push(`id > ?`);
    params.push(changedAfterId);
  }
  if (!opts.isAdmin) {
    conds.push(`(target_lane IS NULL OR target_lane = ?)`);
    params.push(agent as string);
  }
  if (keyword !== null && keyword !== '') {
    const escaped = keyword.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;
    conds.push(`(LOWER(title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(body) LIKE LOWER(?) ESCAPE '\\')`);
    params.push(pattern, pattern);
  }
  let order = `id ASC`;
  if (recheckBefore !== null) {
    conds.push(`recheck_at IS NOT NULL AND recheck_at <= ?`);
    params.push(recheckBefore);
    order = `recheck_at ASC, id ASC`;
    if (anchor) {
      conds.push(`(recheck_at > ? OR (recheck_at = ? AND id > ?))`);
      // Non-null by the pre-rate anchor check above (recheck lists
      // reject anchors without recheck_at before any quota use).
      params.push(anchor.recheck_at!, anchor.recheck_at!, anchor.id);
    }
  } else if (anchor) {
    conds.push(`id > ?`);
    params.push(anchor.id);
  }
  // Fix-round minor: list only the columns a list needs. The body is
  // truncated to 200 characters (body_truncated flags a cut); the
  // full body stays available via GET. This keeps a 100-row list
  // from hauling up to ~800KB of bodies.
  // Fix round 2, item 5: list output carries the honest recheck_*
  // names plus a disclaimer, never bare demote_* fields. Storage
  // columns (demote_actor/demote_deadline) are unchanged.
  const listCols = `id, kind, title, SUBSTR(body, 1, 200) AS body, (CASE WHEN LENGTH(body) > 200 THEN 1 ELSE 0 END) AS body_truncated, author, lane, target_lane, scope, status, supersedes_id, superseded_by_id, replaces_tombstoned_id, bus_reconciliation_id, ref_type, ref_id, provenance_type, is_luki_ordered, tombstone_reason, tombstoned_by, tombstoned_at, recheck_at, topic, resolver, resolved, resolved_by, resolved_at, demote_actor AS recheck_actor, demote_deadline AS recheck_deadline, 'recheck assignment only: scope and authority unchanged, no wake or message sent' AS recheck_note, created_at, updated_at`;
  const fetched = this.sql
    .exec(
      `SELECT ${listCols} FROM ledger ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY ${order} LIMIT ?`,
      ...params,
      limit + 1
    )
    .toArray() as unknown as Array<LedgerRecord & { body_truncated: number; recheck_deadline: number | null; topic: string; resolver: string | null; resolved: number | null; resolved_by: string | null; resolved_at: number | null }>;
  const hasMore = fetched.length > limit;
  const page = fetched.slice(0, limit);
  const now = this.kbNow();
  // Amendment batch, item 2: one bulk contradiction lookup for the
  // page (not one query per row).
  const conflictById = new Map<number, { has_contradiction: boolean; contradicts_ids: number[]; contradicted_by_ids: number[]; contradicting_ids: number[] }>();
  if (page.length > 0) {
    try {
      const ids = page.map((r) => r.id);
      const ph = ids.map(() => '?').join(',');
      const pairs = this.sql
        .exec(
          `SELECT row_id, contradicts_id FROM ledger_contradictions WHERE row_id IN (${ph}) OR contradicts_id IN (${ph})`,
          ...ids,
          ...ids
        )
        .toArray() as unknown as Array<{ row_id: number; contradicts_id: number }>;
      const empty = (): { has_contradiction: boolean; contradicts_ids: number[]; contradicted_by_ids: number[]; contradicting_ids: number[] } => ({ has_contradiction: false, contradicts_ids: [], contradicted_by_ids: [], contradicting_ids: [] });
      for (const r of page) conflictById.set(r.id, empty());
      for (const p of pairs) {
        const a = conflictById.get(p.row_id);
        if (a) a.contradicts_ids.push(p.contradicts_id);
        const b = conflictById.get(p.contradicts_id);
        if (b) b.contradicted_by_ids.push(p.row_id);
      }
      for (const v of conflictById.values()) {
        v.contradicting_ids = [...new Set([...v.contradicts_ids, ...v.contradicted_by_ids])].sort((x, y) => x - y);
        v.has_contradiction = v.contradicting_ids.length > 0;
      }
    } catch {
      // Pre-v9 store: no contradiction data.
    }
  }
  const rows = page.map((r) => ({
    ...r,
    // Amendment batch: list resolved mirrors the GET boolean shape.
    resolved: r.resolved === 1,
    // Fix-round minor: flag rows whose recheck deadline has passed.
    recheck_overdue: r.recheck_at !== null && r.recheck_at !== undefined && r.recheck_at <= now,
    // Amendment batch, item 10a/10c: stale mirrors the recheck_at
    // flag under its own name; recheck_deadline_overdue is the
    // separate Q8 deadline flag.
    stale: r.recheck_at !== null && r.recheck_at !== undefined && r.recheck_at <= now,
    recheck_deadline_overdue: r.recheck_deadline !== null && r.recheck_deadline !== undefined && r.recheck_deadline <= now,
    ...(conflictById.get(r.id) ?? { has_contradiction: false, contradicts_ids: [], contradicted_by_ids: [], contradicting_ids: [] }),
  }));
  const nextAfterId = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;
  // Fix round 5 minor: echo the effective filters so callers can
  // see what was actually applied (admin history flag included).
  // Fix round 7, cheap: filters.status used to echo "" for "all
  // statuses" (include_history with no status param), which is
  // only inferable, not stated. It now echoes "all".
  return this.json(200, { rows, next_after_id: nextAfterId, has_more: hasMore, filters: { status: effectiveStatus === '' ? 'all' : effectiveStatus, include_history: includeHistory, target_lane: targetLaneParam, kind, ref_type: refType, ref_id: refId, search: keyword, since: sinceRaw, changed_after_id: changedAfterId } });
}

export async function handleLedgerGet(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let agent: string | null = null;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  } else {
    agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
  }
  const row = getLedger(this, id);
  if (!row || !ledgerRowVisible(row, opts.isAdmin, agent)) {
    return this.json(404, { error: 'ledger row not found' });
  }
  if (!opts.isAdmin && row.status !== 'active') {
    return this.json(403, { error: 'non-active rows require admin' });
  }
  // Fix round M14: a 404/403 read does not consume quota.
  // Fix round (re-review GAP 2, #13): agent reads charge the READ bucket.
  if (!opts.isAdmin && agent !== null && !this.rlCheckRead(agent)) return this.rlReadLimitedResponse(agent);
  return this.json(200, { row: ledgerPublic(this, row) });
}

// Fix round 4, item 12: the ledger audit trail is now readable,
// not write-only. Same visibility as the ledger get (lane-visible
// row; agents see events only for active rows, like the get),
// same rate rule (validation before the rate check).
export async function handleLedgerEvents(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let agent: string | null = null;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
  } else {
    agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
  }
  const row = getLedger(this, id);
  if (!row || !ledgerRowVisible(row, opts.isAdmin, agent)) {
    return this.json(404, { error: 'ledger row not found' });
  }
  if (!opts.isAdmin && row.status !== 'active') {
    return this.json(403, { error: 'non-active rows require admin' });
  }
  const url = new URL(req.url);
  const limitRaw0 = url.searchParams.get('limit');
  // Fix round 6, (e): unified parsing — "null" is absent.
  const limitRaw = limitRaw0 === 'null' ? null : limitRaw0;
  // Fix round 5, M12: strict limit parsing (400, not silent coercion).
  if (limitRaw !== null && (!/^\d+$/.test(limitRaw) || parseInt(limitRaw, 10) < 1)) {
    return this.json(400, { error: 'invalid limit', field: 'limit' });
  }
  const limit = limitRaw === null ? 20 : Math.min(parseInt(limitRaw, 10), 100);
  const afterRaw0 = url.searchParams.get('after_id');
  const afterRaw = afterRaw0 === 'null' ? null : afterRaw0;
  const afterId = afterRaw === null ? 0 : /^\d+$/.test(afterRaw) ? parseInt(afterRaw, 10) : -1;
  if (afterId < 0) {
    return this.json(400, { error: 'invalid after_id', field: 'after_id' });
  }
  // Fix round (re-review GAP 2, #13): agent reads charge the READ bucket.
  if (!opts.isAdmin && agent !== null && !this.rlCheckRead(agent)) return this.rlReadLimitedResponse(agent);
  const fetched = this.sql
    .exec(
      `SELECT id, ledger_id, actor, action, reason, created_at FROM ledger_events WHERE ledger_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
      id,
      afterId,
      limit + 1
    )
    .toArray();
  const hasMore = fetched.length > limit;
  const events = fetched.slice(0, limit);
  return this.json(200, {
    events,
    has_more: hasMore,
    next_after_id: hasMore && events.length ? (events[events.length - 1] as unknown as { id: number }).id : null,
  });
}

// Amendment batch, item 2b: flag a row as contradicting another
// row. Agent path: caller must read both rows (invisible rows are
// 404, like the get), the row must be active (agents see active
// rows only), and flagging your OWN row is 400 (a contradiction
// must come from someone else). Admin path: admin reads
// everything, and the own-row rule does not apply (admin is not a
// row author in the agent sense). Self-contradiction is 400, a
// missing contradicts target is 404, a duplicate pair is 409
// (UNIQUE pair, pre-checked so it surfaces as 409, not 500).
export async function handleLedgerContradiction(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let actor: string;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    actor = this.kbBasicUser(req) || 'admin';
  } else {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
    actor = agent;
  }
  const payload = await parseJsonBody(req);
  if (!payload) return this.json(400, { error: 'invalid json' });
  try {
    const row = getLedger(this, id);
    if (!row || (!opts.isAdmin && !ledgerRowVisible(row, false, actor))) {
      throw new TxAbort(404, { error: 'ledger row not found' });
    }
    if (!opts.isAdmin && row.status !== 'active') {
      throw new TxAbort(403, { error: 'non-active rows require admin' });
    }
    assertAllowlist(payload, new Set(['contradicts_id']), 'contradiction');
    const contradictsId = payload.contradicts_id;
    if (typeof contradictsId !== 'number' || !Number.isInteger(contradictsId)) {
      throw new TxAbort(400, { error: 'invalid contradicts_id', field: 'contradicts_id' });
    }
    const other = getLedger(this, contradictsId);
    if (!other || (!opts.isAdmin && !ledgerRowVisible(other, false, actor))) {
      throw new TxAbort(404, { error: 'contradicted row not found' });
    }
    if (contradictsId === id) {
      throw new TxAbort(400, { error: 'a row cannot contradict itself', field: 'contradicts_id' });
    }
    if (!opts.isAdmin && row.author === actor) {
      throw new TxAbort(400, { error: 'cannot flag your own row as contradicting', field: 'contradicts_id' });
    }
    const dup = this.sql
      .exec(`SELECT 1 FROM ledger_contradictions WHERE row_id = ? AND contradicts_id = ?`, id, contradictsId)
      .toArray();
    if (dup.length > 0) {
      throw new TxAbort(409, { error: 'contradiction already flagged' });
    }
    if (!opts.isAdmin && !this.rlCheck(actor)) return this.rlLimitedResponse(actor);
    const now = this.kbNow();
    this.state.storage.transactionSync(() => {
      this.sql.exec(
        `INSERT INTO ledger_contradictions (row_id, contradicts_id, flagged_by, created_at) VALUES (?, ?, ?, ?)`,
        id,
        contradictsId,
        actor,
        now
      );
      this.sql.exec(`UPDATE ledger SET updated_at = ? WHERE id = ?`, now, id);
      insertEvent(this, id, actor, 'contradiction', `contradicts_id:${contradictsId}`, now);
    });
    emitLedgerChanged(this, actor, id, 'contradiction');
    return this.json(200, { ok: true, id, contradicts_id: contradictsId, flagged_by: actor, has_contradiction: true });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

// Amendment batch, item 2c: designate (or clear, with explicit
// null) a row's resolver. Author or admin only, else 403; the
// value must name a registered agent or 'admin', else 400. Only
// active rows can gain a resolver (409 otherwise) — a resolver
// designates who resolves a live row's conflicts, and the
// resolve-dissent authority check reads this same column.
export async function handleLedgerResolver(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let actor: string;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    actor = this.kbBasicUser(req) || 'admin';
  } else {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
    actor = agent;
  }
  const payload = await parseJsonBody(req);
  if (!payload) return this.json(400, { error: 'invalid json' });
  try {
    const row = getLedger(this, id);
    if (!row || (!opts.isAdmin && !ledgerRowVisible(row, false, actor))) {
      throw new TxAbort(404, { error: 'ledger row not found' });
    }
    if (!opts.isAdmin && row.author !== actor) {
      throw new TxAbort(403, { error: 'only the author lane or admin may set the resolver' });
    }
    assertAllowlist(payload, new Set(['resolver']), 'resolver');
    if (!('resolver' in payload)) {
      throw new TxAbort(400, { error: 'resolver required', field: 'resolver' });
    }
    const resolver = validateResolver(this, payload.resolver, { allowNull: true });
    if (row.status !== 'active') {
      throw new TxAbort(409, { error: 'only an active row can have a resolver set' });
    }
    if (!opts.isAdmin && !this.rlCheck(actor)) return this.rlLimitedResponse(actor);
    const now = this.kbNow();
    this.state.storage.transactionSync(() => {
      this.sql.exec(`UPDATE ledger SET resolver = ?, updated_at = ? WHERE id = ?`, resolver, now, id);
      insertEvent(this, id, actor, 'resolver', `resolver:${resolver === null ? 'null' : resolver}`, now);
    });
    emitLedgerChanged(this, actor, id, 'resolver');
    return this.json(200, { ok: true, id, resolver });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}

// Amendment batch, item 19c: resolve a dissent row. Admin or the
// row's designated resolver only, else 403 — the author is NOT
// authority unless they are also the resolver, and a null
// resolver means admin-only. After resolution dissentHoldFor
// returns held:false for the dissent's target. The resolution is
// audited in ledger_events (action 'resolve_dissent').
export async function handleLedgerResolveDissent(
  this: IBusDO,
  req: Request,
  id: number,
  opts: { isAdmin: boolean; agent: string | null }
): Promise<Response> {
  let actor: string;
  if (opts.isAdmin) {
    if (!(await this.checkBasicAuth(req))) return this.unauthorizedBasic(req);
    actor = this.kbBasicUser(req) || 'admin';
  } else {
    const agent = this.authedAgent(req);
    if (!agent) {
      try {
        await req.text();
      } catch {}
      return this.json(401, { error: 'unauthorized' });
    }
    actor = agent;
  }
  // Resolve takes no fields: a missing/empty body is an empty
  // object, not invalid JSON (unlike the contradiction/resolver
  // endpoints, which require a payload).
  const payload = (await parseJsonBody(req)) ?? {};
  try {
    const row = getLedger(this, id);
    if (!row || (!opts.isAdmin && !ledgerRowVisible(row, false, actor))) {
      throw new TxAbort(404, { error: 'ledger row not found' });
    }
    if (row.kind !== 'dissent') {
      throw new TxAbort(400, { error: 'only a dissent row can be resolved' });
    }
    if (!opts.isAdmin && ledgerExt(row).resolver !== actor) {
      throw new TxAbort(403, { error: 'only admin or the designated resolver may resolve a dissent' });
    }
    assertAllowlist(payload, new Set([]), 'resolve-dissent');
    if (row.status !== 'active') {
      throw new TxAbort(409, { error: 'only an active dissent can be resolved' });
    }
    if (ledgerExt(row).resolved === 1) {
      throw new TxAbort(409, { error: 'dissent already resolved' });
    }
    if (!opts.isAdmin && !this.rlCheck(actor)) return this.rlLimitedResponse(actor);
    const now = this.kbNow();
    this.state.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE ledger SET resolved = 1, resolved_by = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
        actor,
        now,
        now,
        id
      );
      insertEvent(this, id, actor, 'resolve_dissent', `resolved_by:${actor}`, now);
    });
    emitLedgerChanged(this, actor, id, 'resolve_dissent');
    return this.json(200, { ok: true, id, resolved: true, resolved_by: actor });
  } catch (e) {
    if (e instanceof TxAbort) return this.json(e.code, e.body);
    throw e;
  }
}
