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
  status_changed_at?: number | null;
  last_activity_at?: number | null;
  stale_notified_at?: number | null;
  notes?: string | null;
  created_by?: string | null;
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
}

export interface TaskDetailResponse extends TaskWithTodos {
  labels: string[];
  comment_count: number;
  activity_count: number;
}

export interface TaskSearchOpts {
  projectIds?: number[] | null;
  q?: string | null;
  status?: string | null;
  assignee?: string | null;
  label?: string | null;
  blocked_kind?: string | null;
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
  kbTaskDetail(row: TaskRecord): TaskDetailResponse;
  kbTaskSearchWhere(opts: TaskSearchOpts): { where: string; params: (string | number)[]; order: string };
  kbTodosFor(taskId: number): TodoRecord[];
  kbTaskWithTodos(row: TaskRecord): TaskWithTodos;
  kbNow(): number;
  kbBasicUser(req: Request): string;

  allAgents(): Array<{ agent: string; secret: string }>;
  authedAgent(req: Request): string | null;
  agentForToken(token: string): string | null;
  readableChannels(agent: string): Set<string>;
  validateChannel(agent: string, channel: string | null | undefined): string | null;
  rlCheck(agent: string): boolean;
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
  handleAdminApiPassword(req: Request): Promise<Response>;
  handleAdminPanel(req: Request): Promise<Response>;

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
  handleKbAgentTaskUpdate(req: Request, id: number): Promise<Response>;
  handleKbAgentTaskClaim(req: Request, id: number): Promise<Response>;
  handleKbAgentTaskStatus(req: Request, id: number): Promise<Response>;
  handleKbAgentTodoCreate(req: Request, taskId: number): Promise<Response>;
  handleKbCommentList(req: Request, url: URL, taskId: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleKbCommentAdd(req: Request, taskId: number, opts: { isAdmin: boolean; agent: string | null }): Promise<Response>;
  handleKbAgentLabelAdd(req: Request, taskId: number): Promise<Response>;
  handleKbAgentLabelRemove(req: Request, taskId: number, label: string): Promise<Response>;
  handleKbAgentTodoUpdate(req: Request, id: number): Promise<Response>;
  handleKbAdminProjectLabels(req: Request, projectId: number): Promise<Response>;
  handleKbAdminProjectSubscribers(req: Request, projectId: number): Promise<Response>;
  handleKbAdminTaskDetail(req: Request, id: number): Promise<Response>;
  handleKbAdminLabelAdd(req: Request, taskId: number): Promise<Response>;
  handleKbAdminLabelRemove(req: Request, taskId: number, label: string): Promise<Response>;
}
