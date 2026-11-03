// Core TypeScript interfaces and types for Agent Bus backend

export interface Env {
  BUS: DurableObjectNamespace;
  ADMIN_KV?: KVNamespace;
  ADMIN_USER?: string;
  ADMIN_PASS?: string;
  BUS_ADMIN_TOKEN?: string;
  [key: string]: unknown;
}

export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'normal' | 'urgent';
export type BlockedKind = 'waiting-human' | 'waiting-task' | 'waiting-external';
export type TaskLane = 'backend' | 'android' | 'unassigned';

// Database Models
export interface MessageRecord {
  id: number;
  sender: string;
  channel: string;
  priority: string;
  audience: string;
  ts: string;
  body: string;
  reply_to?: number | null;
  edit_version?: number;
  edited_at?: number | null;
  deleted_at?: number | null;
}

export interface AgentRecord {
  agent: string;
  secret: string;
  created: string;
  last_seen?: string | null;
  stale_notified_at?: string | null;
}

export interface AdminRecord {
  user: string;
  pass_hash: string;
  salt: string;
}

export interface ChannelRecord {
  name: string;
  created_by: string;
  created_at: number;
}

export interface ChannelMemberRecord {
  channel: string;
  agent: string;
  added_by: string;
  added_at: number;
}

export interface ProjectRecord {
  id: number;
  title: string;
  description: string | null;
  created_by: string | null;
  created_at: number;
  archived: number;
}

export interface TaskRecord {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  assignee: string | null;
  admin_assigned: string | null;
  priority: TaskPriority;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  blocked_kind?: BlockedKind | null;
  blocked_reason?: string | null;
  status_changed_at?: number | null;
  last_activity_at?: number | null;
  stale_notified_at?: number | null;
  notes?: string | null;
  created_by?: string | null;
  due_date?: number | null;
  lane: TaskLane;
  blocked_from_status?: string | null;
  unblocked_at?: number | null;
  // Argon safety round (migration v10): the blocker whose completion,
  // unlink, or deletion freed this task. Internal storage column —
  // read sites strip it and expose the gated public field
  // freeing_blocker_id instead (null unless unblocked_at is set).
  unblocked_by_blocker_id?: number | null;
}

export interface TodoRecord {
  id: number;
  task_id: number;
  text: string;
  done: number;
  sort_order: number;
}

export interface TaskCommentRecord {
  id: number;
  task_id: number;
  author: string;
  body: string;
  ts: number;
}

export interface TaskLabelRecord {
  task_id: number;
  label: string;
}

export interface TaskTemplateRecord {
  id: number;
  name: string;
  title: string;
  description: string | null;
  notes: string | null;
  priority: TaskPriority;
  lane: TaskLane;
  labels: string;
}

export interface LaneMappingRecord {
  agent: string;
  lane: TaskLane;
  set_by: string;
  set_at: number;
}

export interface WipWarning {
  assignee: string;
  doing_count: number;
  limit: number;
}

export type AutoClaimResult =
  | {
      ok: true;
      autoClaimed: boolean;
      task: TaskRecord;
    }
  | {
      ok: false;
      code: number;
      body: Record<string, unknown>;
    };

export interface ProjectSubscriberRecord {
  project_id: number;
  agent: string;
  added_by: string;
  added_at: number;
}

export interface EventRecord {
  id: number;
  type: string;
  actor: string | null;
  project_id: number | null;
  scope: string;
  recipients: string | null;
  ts: number;
  payload: string;
}

export interface WebSocketAttachment {
  agent: string;
  channels: string[];
  connectedAt: number;
}

// Composite & API types
export interface TaskWithTodos extends TaskRecord {
  todos: TodoRecord[];
  // Argon safety round: public freeing-blocker field, gated on
  // unblocked_at (see the unblocked_by_blocker_id note above).
  freeing_blocker_id?: number | null;
}

export interface TaskDetailResponse extends TaskWithTodos {
  labels: string[];
  comment_count: number;
  activity_count: number;
  count_note?: string;
  dependencies: {
    blockers: Array<{ id: number; title: string; status: TaskStatus; blocked_kind: string | null; blocked_reason: string | null; unfinished: boolean }>;
    blocked_by: Array<{ id: number; title: string; status: TaskStatus; unfinished: boolean }>;
  };
  ledger_refs: Array<{
    id: number;
    kind: string;
    title: string;
    scope: string;
    target_lane: string | null;
    provenance_type?: string | null;
    body_excerpt?: string;
  }>;
  // Capped list: ledger_refs holds at most 20 rows (fetch-21 pattern,
  // see kbTaskDetail); ledger_refs_has_more says whether more exist.
  // ledger_ref_count is the TOTAL filtered active count per locked
  // plan §6 and SPEC, NOT the returned-refs count.
  // Fix round 7, (f): ledger_refs_next_after_id is the
  // continuation pointer when has_more is true — the id of the
  // last returned ref, to pass as after_id to
  // GET /api/ledger?ref_type=task&ref_id=<taskId> (same id-ASC
  // order). Null when there is no next page. Previously refs 21+
  // were unreachable from the detail payload (the workaround
  // existed but was pointed at nowhere).
  ledger_ref_count: number;
  ledger_refs_has_more?: boolean;
  ledger_refs_next_after_id?: number | null;
}

export type LedgerKind =
  | 'decision'
  | 'hold'
  | 'gate'
  | 'protocol'
  | 'handover'
  | 'dead-end'
  | 'dissent';
export type LedgerScope = 'action' | 'lane-note';
export type LedgerStatus = 'active' | 'superseded' | 'tombstoned';
export type LedgerProvenance =
  | 'bus_message'
  | 'task'
  | 'agent_asserted'
  | 'luki_ordered'
  | 'lock_ordered';

export interface LedgerRecord {
  id: number;
  kind: LedgerKind;
  title: string;
  body: string;
  author: string;
  lane: string;
  target_lane: string | null;
  scope: LedgerScope;
  status: LedgerStatus;
  supersedes_id: number | null;
  superseded_by_id: number | null;
  replaces_tombstoned_id: number | null;
  bus_reconciliation_id: number | null;
  ref_type: string | null;
  ref_id: string | null;
  provenance_type: LedgerProvenance;
  is_luki_ordered: number;
  tombstone_reason: string | null;
  tombstoned_by: string | null;
  tombstoned_at: number | null;
  recheck_at: number | null;
  demote_actor: string | null;
  demote_deadline: number | null;
  created_at: number;
  updated_at: number;
}

export interface TaskSearchOpts {
  projectIds?: number[] | null;
  q?: string | null;
  status?: string | null;
  assignee?: string | null;
  label?: string | null;
  blocked_kind?: string | null;
  priority?: string | null;
  lane?: string | null;
  stale?: boolean;
  dueDateFrom?: number | null;
  dueDateTo?: number | null;
  dueDateFilter?: 'overdue' | 'none' | null;
  sort?: string | null;
  includeArchived?: boolean;
  subscriberAgent?: string | null;
}

export interface SendMessageRequest {
  sender?: string;
  channel?: string;
  body: string;
  reply_to?: number | null;
  audience?: string | null;
  priority?: TaskPriority | string;
}

export interface SendMessageResponse {
  ok: true;
  id: number;
  ts: string;
}

export interface EditMessageRequest {
  body: string;
}

export interface EditMessageResponse {
  ok: true;
  id: number;
  edit_version: number;
  edited_at: number;
}

export interface DeleteMessageResponse {
  ok: true;
  id: number;
}

export interface AdminStatsResponse {
  messagesToday: number;
  totalMessages: number;
  perChannel: Array<{ channel: string; count: number }>;
  registeredAgents: number;
  doStatus: string;
  ts: string;
}

// BusDO Interface
export interface IBusDO {
  state: DurableObjectState;
  env: Env;
  sql: SqlStorage;
  rateLimit: Map<string, number[]>;
  churn: Map<string, number[]>;

  json(code: number, obj: unknown, extraHeaders?: HeadersInit): Response;
  emitEvent(
    type: string,
    opts?: {
      actor?: string | null;
      project_id?: number | null;
      scope?: string;
      recipients?: string[] | null;
      payload?: unknown;
    }
  ): void;

  kbSubscriberPred(projExpr?: string): string;
  kbIsArchived(taskId: number): boolean;
  kbTouchTask(id: number): void;
  kbSystemLog(taskId: number, body: string): void;
  kbProjectSubscribers(projectId: number): string[];
  kbSetSubscribers(projectId: number, subscribers: unknown, addedBy?: string): string[];
  kbTaskDetail(
    row: TaskRecord,
    opts?: { agent?: string | null; isAdmin?: boolean; ledgerRefsAfterId?: number | null }
  ): TaskDetailResponse;
  depReevaluateOnDone(blockerId: number, now: number): { processed: number; capped: boolean; pending_sweep: boolean };
  depReblockOnReopen(blockerId: number, now: number): { processed: number; capped: boolean; pending_sweep: boolean };
  depCascadeOnTaskDelete(taskId: number, now: number): { links_removed: number; dependents_unblocked: number; unblocked_ids: number[]; capped: boolean; pending_sweep: boolean; snapshots_truncated: boolean };
  depCascadeOnProjectDelete(projectId: number, now: number): { links_removed: number; tasks_deleted: number };
  depReevaluateProject(projectId: number, now: number, opts?: { uncapped?: boolean }): { unblocked: { processed: number; capped: boolean; pending_sweep: boolean }; reblocked: { processed: number; capped: boolean; pending_sweep: boolean }; capped: boolean; pending_sweep: boolean; processed: number };
  handleDepLink(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleDepUnlink(req: Request, id: number, blockerId: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleDepList(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleDepEvents(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleDepUnblocked(req: Request, url: URL, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerCreate(req: Request): Promise<Response>;
  handleLedgerList(req: Request, url: URL, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerGet(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerEvents(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerSupersede(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerTombstone(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerSeed(req: Request): Promise<Response>;
  handleLedgerContradiction(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerResolver(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerResolveDissent(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleKbTaskRescue(req: Request, id: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleLedgerRecheckAssignment(req: Request, id: number): Promise<Response>;
  handleLedgerDemote(req: Request, id: number): Promise<Response>;
  handleKbCommentSoftDelete(req: Request, taskId: number, commentId: number): Promise<Response>;
  kbTaskSearchWhere(opts: TaskSearchOpts): { where: string; params: (string | number)[]; order: string };
  kbDefaultOrder(tableAlias?: string): string;
  kbEncodeCursor(key: { d: string | number | null; p: string; c: string | number; i: number }): string;
  kbDecodeCursor(raw: string): { d: string | number | null; p: string; c: string | number; i: number } | null;
  kbKeysetTuple(alias: string): string;
  kbKeysetParams(key: { d: string | number | null; p: string; c: string | number; i: number }): (string | number)[];
  kbSweepVisibility(): Record<string, unknown>;
  kbFanoutIds(allIds: number[]): { count: number; ids: number[]; truncated: boolean };
  kbFanoutPairs(allPairs: Array<{ blocker_id: number; blocked_id: number }>): { count: number; pairs: Array<{ blocker_id: number; blocked_id: number }>; truncated: boolean };
  kbStartOfTodayJakarta(nowSec?: number): number;
  kbAgentLane(agent: string): TaskLane;
  kbLaneOwner(lane: TaskLane): string | null;
  kbWipWarning(assignee: string | null): WipWarning | undefined;
  kbAutoClaimOrVerify(
    taskId: number,
    agent: string,
    opts?: { isStatusEndpoint?: boolean; requestedStatus?: string; requestedLane?: string }
  ): AutoClaimResult;
  kbTodosFor(taskId: number): TodoRecord[];
  kbTaskWithTodos(row: TaskRecord): TaskWithTodos;
  kbTasksWithTodos(rows: TaskRecord[]): TaskWithTodos[];
  kbNow(): number;
  kbBasicUser(req: Request): string;

  kbChannelCreate(name: unknown, creator: string): { ok?: true; name?: string; error?: string; code: number };
  kbChannelAddMember(
    name: string,
    agentName: string,
    addedBy: string
  ): { ok?: true; channel?: string; agent?: string; error?: string; code: number };
  kbChannelRemoveMember(
    name: string,
    agentName: string,
    removedBy: string
  ): { ok?: true; channel?: string; agent?: string; error?: string; code: number };
  kbLabelOp(
    taskId: number,
    label: unknown,
    op: "add" | "remove",
    actor: string
  ): { ok?: true; error?: string; code: number };

  allAgents(): Array<{ agent: string; secret: string }>;
  authedAgent(req: Request): string | null;
  agentForToken(token: string): string | null;
  readableChannels(agent: string): Set<string>;
  validateChannel(agent: string, channel: string | null | undefined): string | null;
  rlCheck(agent: string): boolean;
  rlCheckRead(agent: string): boolean;
  rlCheckWrite(agent: string): boolean;
  rlRetryAfterSeconds(agent: string): number;
  rlReadRetryAfterSeconds(agent: string): number;
  rlLimitedResponse(agent: string, hint?: string, bucket?: string): Response;
  rlReadLimitedResponse(agent: string, hint?: string): Response;
  churnCheck(agent: string): boolean;
  ensureChannelRow(channel: string, sender: string): string;
  canSendToChannel(agent: string, channel: string): boolean;

  checkAdmin(req: Request): boolean;
  checkAdminDrain(req: Request): Promise<boolean>;
  checkBasicAuth(req: Request): Promise<boolean>;
  unauthorizedBasic(req: Request): Promise<Response>;

  handleWs(req: Request, url: URL): Promise<Response>;
  handlePoll(req: Request, url: URL): Promise<Response>;
  handlePollNew(url: URL, agent: string | null, isAdmin: boolean): Promise<Response>;
  handlePollLegacy(url: URL, agent: string): Promise<Response>;
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void>;
  webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void>;
  webSocketError(ws: WebSocket, error: unknown): Promise<void>;
  handleSend(req: Request): Promise<Response>;
  handleAdminImport(req: Request): Promise<Response>;
  handleAdminExport(req: Request): Promise<Response>;
  handleAdminApiMessages(req: Request, url: URL): Promise<Response>;
  handleAdminApiSend(req: Request): Promise<Response>;
  handleAdminApiMessageDelete(req: Request, id: number): Promise<Response>;
  handleAdminApiMessageEdit(req: Request, id: number): Promise<Response>;

  handleList(req: Request): Promise<Response>;
  handleAgents(req: Request): Promise<Response>;
  handleReg(req: Request): Promise<Response>;
  handleAdminAgents(req: Request): Promise<Response>;
  handleAdminApiAgents(req: Request): Promise<Response>;
  handleAdminApiRegistered(req: Request): Promise<Response>;
  handleAdminApiAgentRegister(req: Request): Promise<Response>;
  handleAdminApiAgentDelete(req: Request, agent: string): Promise<Response>;
  handleAdminApiAgentRotate(req: Request, agent: string): Promise<Response>;

  handleAdminApiChannels(req: Request): Promise<Response>;
  handleAdminApiSenders(req: Request): Promise<Response>;
  handleAdminApiChannelMemberRemove(req: Request, channel: string, agent: string): Promise<Response>;
  handleAdminApiChannelDelete(req: Request, channel: string): Promise<Response>;
  handleApiChannelCreate(req: Request): Promise<Response>;
  handleAdminApiChannelCreate(req: Request): Promise<Response>;
  handleAdminApiChannelMemberAdd(req: Request, channel: string): Promise<Response>;
  handleApiChannelMemberAdd(req: Request, channel: string): Promise<Response>;
  handleApiChannelMemberRemove(req: Request, channel: string, agent: string): Promise<Response>;

  handleAdminApiStats(req: Request): Promise<Response>;
  handleAdminApiAuditPurge(req: Request): Promise<Response>;
  handleAdminApiPassword(req: Request): Promise<Response>;

  handleKbAdminProjectsList(req: Request): Promise<Response>;
  handleKbAdminProjectCreate(req: Request): Promise<Response>;
  handleKbAdminProjectUpdate(req: Request, id: number): Promise<Response>;
  handleKbAdminProjectDelete(req: Request, id: number): Promise<Response>;
  handleKbAdminTasksList(req: Request, projectId: number): Promise<Response>;
  handleKbAdminTaskCreate(req: Request, projectId: number): Promise<Response>;
  handleKbAdminTaskUpdate(req: Request, id: number): Promise<Response>;
  handleKbAdminTaskDelete(req: Request, id: number): Promise<Response>;
  handleKbAdminTodoCreate(req: Request, taskId: number): Promise<Response>;
  handleKbAdminTodoUpdate(req: Request, id: number): Promise<Response>;
  handleKbAdminTodoDelete(req: Request, id: number): Promise<Response>;

  handleKbAgentProjectsList(req: Request): Promise<Response>;
  handleKbAgentTasksAvailable(req: Request): Promise<Response>;
  handleKbAgentTasksList(req: Request, projectId: number): Promise<Response>;
  handleKbAgentTaskCreate(req: Request, projectId: number): Promise<Response>;
  handleKbTaskSearch(url: URL, opts: { isAdmin: boolean; agent: string | null; projectId: number | null }): Promise<Response>;
  handleKbAgentTaskDetail(req: Request, id: number): Promise<Response>;
  handleKbAgentTaskUpdate(
    req: Request,
    id: number,
    onlyField?: 'notes' | 'due_date' | 'lane'
  ): Promise<Response>;
  handleKbAgentTaskClaim(req: Request, id: number): Promise<Response>;
  handleKbAgentTaskRelease(req: Request, id: number): Promise<Response>;
  handleKbAgentTaskStatus(req: Request, id: number): Promise<Response>;
  handleKbAgentTodoCreate(req: Request, taskId: number): Promise<Response>;
  handleKbCommentList(req: Request, url: URL, taskId: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleKbCommentAdd(req: Request, taskId: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleKbCommentRestore(req: Request, taskId: number, commentId: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleKbAgentSweepHealth(req: Request): Promise<Response>;
  handleKbAgentLabelAdd(req: Request, taskId: number): Promise<Response>;
  handleKbAgentLabelRemove(req: Request, taskId: number, label: string): Promise<Response>;
  handleKbAgentTodoUpdate(req: Request, id: number): Promise<Response>;
  handleKbAdminProjectLabels(req: Request, projectId: number): Promise<Response>;
  handleKbAdminProjectSubscribers(req: Request, projectId: number): Promise<Response>;
  handleKbAdminTaskDetail(req: Request, id: number): Promise<Response>;
  handleKbAdminLabelAdd(req: Request, taskId: number): Promise<Response>;
  handleKbAdminLabelRemove(req: Request, taskId: number, label: string): Promise<Response>;

  handleKbActivity(
    req: Request,
    url: URL,
    opts: { isAdmin: boolean; agent: string | null; projectId: number | null }
  ): Promise<Response>;
  handleKbSummary(
    req: Request,
    url: URL,
    opts: { isAdmin: boolean; agent: string | null; projectId: number | null }
  ): Promise<Response>;
  handleKbTemplatesList(req: Request, opts: { isAdmin: boolean }): Promise<Response>;
  handleKbAdminTemplateCreate(req: Request): Promise<Response>;
  handleKbAdminWipGet(req: Request): Promise<Response>;
  handleKbAdminWipPut(req: Request): Promise<Response>;
  handleKbAdminLaneMappingGet(req: Request): Promise<Response>;
  handleKbAdminLaneMappingPut(req: Request): Promise<Response>;
}
