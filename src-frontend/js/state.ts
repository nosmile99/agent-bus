import { api } from './api.js';
import { showToast } from './components/toast.js';
import type {
  FrontendState,
  FrontendTask,
  TaskDraft,
  FrontendPollEvent,
  RawPollEvent,
  FrontendMessage,
  FrontendAgent,
  FrontendProject,
  TaskStatus,
  TaskPriority,
  FrontendTodo,
  FrontendComment,
} from './types.js';

/********************************************************************
 * APPLICATION STATE & LOADERS
 ********************************************************************/

export function evToPollRow(ev: RawPollEvent): FrontendPollEvent {
  const p = (ev.payload || {}) as Record<string, unknown>;
  const summary = (p.summary as string) || (p.title as string) || ev.type;
  return {
    id: ev.id,
    ts: ev.ts,
    type: ev.type,
    actor: ev.actor || null,
    project_id: ev.project_id || null,
    summary,
    adminOnly: ev.scope === 'admin',
    payload: p,
  };
}

export const state: FrontendState = {
  activeTab: 'messages', // 'messages' (default far-left) | 'needs-you' | 'kanban' | 'agents'
  adminUser: 'luki',
  darkMode: false,

  // Bus Feed thread view state (null = main timeline, number = root message ID)
  openThreadMsgId: null,

  // Compact / Expanded Composer State for Bus Feed
  composerExpanded: false,
  composerDraft: {
    channel: 'all-agent',
    priority: 'normal',
    audience: 'agents',
    body: '',
    reply_to: null,
  },

  // Unsaved task drafts keyed by taskId
  taskDrafts: {},

  // Swiped task card ID for quick action reveal
  swipedTaskId: null,
  swipedTaskDir: null,

  // Real data (loaded via loadAll())
  agents: [],
  channels: [],
  channelMembers: {},
  messages: [],
  msgFilter: { channel: 'ALL', sender: 'ALL', priority: 'ALL', q: '' },
  activeProjectId: null,
  projects: [],
  tasks: [],
  kanbanFilter: { q: '', status: 'ALL', assignee: 'ALL', label: 'ALL', blocked_kind: 'ALL', priority: 'ALL', showFilters: false },

  // Unified poll cursor (composite ts + id)
  pollCursor: { ts: 0, id: 0 },
  retentionCutoffTs: 0,
  resyncRequired: false,
  pollInspectorAdminView: true,
  pollEvents: [],
  openTaskId: null,
};

export function getTaskDraft(task: FrontendTask): TaskDraft {
  const existing = state.taskDrafts[task.id];
  if (!existing) {
    const draft: TaskDraft = {
      title: task.title || '',
      description: task.description || '',
      notes: task.notes || '',
      commentDraft: '',
      dirty: false,
    };
    state.taskDrafts[task.id] = draft;
    return draft;
  }
  return existing;
}

export function getWaitingHumanTasks(): FrontendTask[] {
  return state.tasks
    .filter((t) => t.status === 'blocked' && t.blocked_kind === 'waiting-human')
    .sort((a, b) => (a.status_changed_at || a.updated_at) - (b.status_changed_at || b.updated_at));
}

export function updateHeaderTelemetry(): void {
  const waitingCount = getWaitingHumanTasks().length;
  const needsBadge = document.getElementById('nav-needs-badge');
  if (needsBadge) {
    needsBadge.textContent = String(waitingCount);
    needsBadge.style.display = waitingCount > 0 ? 'inline-block' : 'none';
  }

  const msgBadge = document.getElementById('nav-msg-badge');
  if (msgBadge) msgBadge.textContent = String(state.messages.length);

  const wsAgents = state.agents.filter((a) => a.transport === 'ws').length;
  const wsPill = document.getElementById('header-ws-pill');
  if (wsPill) wsPill.textContent = `${wsAgents}/${state.agents.length} live`;
}

export async function refreshTasks(): Promise<void> {
  if (!state.activeProjectId) {
    state.tasks = [];
    return;
  }
  interface TasksListResponse {
    tasks?: Array<{
      id: number;
      project_id: number;
      title: string;
      description?: string | null;
      notes?: string | null;
      status: TaskStatus;
      priority?: string;
      blocked_kind?: string | null;
      assignee?: string | null;
      claimed_at?: number | null;
      labels?: string[];
      comment_count?: number;
      status_changed_at?: number | null;
      created_at: number;
      updated_at: number;
      last_activity_at?: number | null;
      created_by?: string | null;
      todos?: FrontendTodo[];
      comments?: FrontendComment[];
    }>;
  }
  const data = await api.get<TasksListResponse>(`/admin/api/kanban/projects/${state.activeProjectId}/tasks`);
  state.tasks = (data.tasks || []).map((t) => ({
    id: t.id,
    project_id: t.project_id,
    title: t.title,
    description: t.description || '',
    notes: t.notes || '',
    status: t.status,
    priority: (t.priority as TaskPriority) || 'normal',
    blocked_kind: t.blocked_kind || null,
    assignee: t.assignee || null,
    claimed_at: t.claimed_at || null,
    labels: t.labels || [],
    comment_count: t.comment_count || 0,
    status_changed_at: t.status_changed_at,
    created_at: t.created_at,
    updated_at: t.updated_at,
    last_activity_at: t.last_activity_at,
    created_by: t.created_by || null,
    todos: t.todos || [],
    comments: t.comments || [],
  }));
}

export async function refreshMessages(): Promise<void> {
  interface MessagesResponse {
    messages?: Array<{
      id: number;
      channel: string;
      sender: string;
      body: string;
      ts: string;
      priority?: string;
      audience?: string;
      reply_to?: number | null;
      edited?: boolean;
    }>;
  }
  const msgs = await api.get<MessagesResponse>('/admin/api/messages');
  state.messages = (msgs.messages || []).map((m) => ({
    id: m.id,
    channel: m.channel,
    sender: m.sender,
    body: m.body,
    ts: m.ts,
    priority: m.priority || 'normal',
    audience: m.audience || 'agents',
    reply_to: m.reply_to || null,
    edited: !!m.edited,
  }));
}

export async function loadAll(): Promise<void> {
  interface MessagesResponse {
    messages?: Array<{
      id: number;
      channel: string;
      sender: string;
      body: string;
      ts: string;
      priority?: string;
      audience?: string;
      reply_to?: number | null;
      edited?: boolean;
    }>;
  }
  interface RegisteredAgentsResponse {
    agents?: Array<{
      agent: string;
      role?: string;
      created_at?: string;
      created?: string;
      last_seen?: string | null;
      rate?: { used: number; limit: number; windowSec: number };
      transport?: 'ws' | 'poll';
      connected_since?: string | null;
      connectedSince?: string | null;
      connections?: number;
      channels?: string[];
    }>;
  }
  interface ChannelsResponse {
    channels?: Array<{ name?: string; members?: string[] } | string>;
  }
  interface ProjectsResponse {
    projects?: Array<{
      id: number;
      title: string;
      description?: string | null;
      archived?: number | boolean;
      subscribers?: string[];
    }>;
  }

  const [msgs, agents, channels, projects] = await Promise.all([
    api.get<MessagesResponse>('/admin/api/messages'),
    api.get<RegisteredAgentsResponse>('/admin/api/registered'),
    api.get<ChannelsResponse>('/admin/api/channels'),
    api.get<ProjectsResponse>('/admin/api/kanban/projects'),
  ]);

  state.messages = (msgs.messages || []).map((m) => ({
    id: m.id,
    channel: m.channel,
    sender: m.sender,
    body: m.body,
    ts: m.ts,
    priority: m.priority || 'normal',
    audience: m.audience || 'agents',
    reply_to: m.reply_to || null,
    edited: !!m.edited,
  }));

  state.agents = (agents.agents || []).map((a) => ({
    agent: a.agent,
    role: a.role || '',
    created: a.created || a.created_at || '',
    last_seen: a.last_seen || null,
    rate: a.rate || { used: 0, limit: 10, windowSec: 60 },
    transport: a.transport || 'poll',
    connectedSince: a.connectedSince || a.connected_since || null,
    connections: a.connections || 0,
    channels: a.channels || ['all-agent'],
  }));

  const channelList: string[] = [];
  state.channelMembers = {};
  for (const c of channels.channels || []) {
    const name = typeof c === 'string' ? c : c.name || '';
    if (name) {
      channelList.push(name);
      const members =
        typeof c === 'object' && Array.isArray(c.members) && c.members.length > 0
          ? c.members
          : name.startsWith('dm:')
            ? name.split(':').slice(1)
            : state.agents.map((a) => a.agent);
      state.channelMembers[name] = members;
    }
  }
  state.channels = channelList;

  state.projects = (projects.projects || []).map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description || '',
    archived: !!p.archived,
    subscribers: p.subscribers || [],
  }));

  if (!state.activeProjectId && state.projects.length > 0 && state.projects[0]) {
    state.activeProjectId = state.projects[0].id;
  }
  await refreshTasks();

  try {
    interface PollResponse {
      events?: RawPollEvent[];
    }
    const poll = await api.get<PollResponse>('/poll?since_ts=0&since_id=0&admin=1');
    if (poll.events && poll.events.length) {
      const last = poll.events[poll.events.length - 1];
      if (last) {
        state.pollCursor = { ts: last.ts, id: last.id };
        state.pollEvents = poll.events.slice(-50).reverse().map(evToPollRow);
      }
    }
    state.resyncRequired = false;
    state.retentionCutoffTs = Math.floor(Date.now() / 1000) - 30 * 86400;
  } catch (_e) {
    /* poll seed optional */
  }
}

export async function loadTaskDetail(taskId: number): Promise<FrontendTask | undefined> {
  interface TaskDetailResp {
    task?: {
      id: number;
      title?: string;
      description?: string | null;
      notes?: string | null;
      labels?: string[];
      comment_count?: number;
      todos?: Array<{ id: number; text: string; done?: number | boolean; sort_order?: number }>;
      comments?: Array<{ id: number; author: string; body: string; created_at?: number; ts?: number }>;
    };
  }
  const d = await api.get<TaskDetailResp>(`/admin/api/kanban/tasks/${taskId}`);
  const t = d.task || (d as unknown as TaskDetailResp['task']);
  const task = state.tasks.find((x) => x.id === taskId);
  if (task && t) {
    task.todos = (t.todos || []).map((td) => ({
      id: td.id,
      task_id: taskId,
      text: td.text,
      done: td.done ? 1 : 0,
      sort_order: td.sort_order || 0,
    }));
    task.comments = (t.comments || []).map((c) => ({
      id: c.id,
      task_id: taskId,
      author: c.author,
      body: c.body,
      ts: c.created_at || c.ts || 0,
    }));
    task.labels = t.labels || task.labels;
    task.notes = t.notes !== undefined && t.notes !== null ? t.notes : task.notes;
    task.description = t.description !== undefined && t.description !== null ? t.description : task.description;
    task.title = t.title || task.title;
    task.comment_count = t.comment_count || task.comments.length;
  }
  return task;
}

export async function manualRefresh(): Promise<void> {
  try {
    await loadAll();
    if (window.renderMainViewport) window.renderMainViewport(true);
    if (state.openTaskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
    showToast('Refreshed', 'All data reloaded from bus', 'green');
  } catch (e) {
    showToast('Refresh failed', e instanceof Error ? e.message : String(e), 'red');
  }
}
