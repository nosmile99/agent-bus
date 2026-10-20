import { api } from './api.js';
import { showToast } from './components/toast.js';

/********************************************************************
 * APPLICATION STATE & LOADERS
 ********************************************************************/

export function evToPollRow(ev) {
  const p = ev.payload || {};
  return {
    id: ev.id,
    ts: ev.ts,
    type: ev.type,
    actor: ev.actor || null,
    project_id: ev.project_id || null,
    summary: p.summary || p.title || ev.type,
    adminOnly: ev.scope === 'admin',
    payload: p,
  };
}

export const state = {
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
    reply_to: null
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
  msgFilter: { channel: 'ALL', sender: 'ALL', q: '' },
  activeProjectId: null,
  projects: [],
  tasks: [],
  kanbanFilter: { q: '', label: 'ALL', assignee: 'ALL' },

  // Unified poll cursor (composite ts + id)
  pollCursor: { ts: 0, id: 0 },
  retentionCutoffTs: 0,
  resyncRequired: false,
  pollInspectorAdminView: true,
  pollEvents: [],
  openTaskId: null,
};

export function getTaskDraft(task) {
  if (!state.taskDrafts[task.id]) {
    state.taskDrafts[task.id] = {
      title: task.title || '',
      description: task.description || '',
      notes: task.notes || '',
      commentDraft: '',
      dirty: false
    };
  }
  return state.taskDrafts[task.id];
}

export function getWaitingHumanTasks() {
  return state.tasks
    .filter(t => t.status === 'blocked' && t.blocked_kind === 'waiting-human')
    .sort((a, b) => (a.status_changed_at || a.updated_at) - (b.status_changed_at || b.updated_at));
}

export function updateHeaderTelemetry() {
  const waitingCount = getWaitingHumanTasks().length;
  const needsBadge = document.getElementById('nav-needs-badge');
  if (needsBadge) {
    needsBadge.textContent = waitingCount;
    needsBadge.style.display = waitingCount > 0 ? 'inline-block' : 'none';
  }

  const msgBadge = document.getElementById('nav-msg-badge');
  if (msgBadge) msgBadge.textContent = state.messages.length;

  const wsAgents = state.agents.filter(a => a.transport === 'ws').length;
  const wsPill = document.getElementById('header-ws-pill');
  if (wsPill) wsPill.textContent = `${wsAgents}/${state.agents.length} live`;
}

export async function refreshTasks() {
  if (!state.activeProjectId) { state.tasks = []; return; }
  const data = await api.get(`/admin/api/kanban/projects/${state.activeProjectId}/tasks`);
  state.tasks = (data.tasks || []).map(t => ({
    id: t.id,
    project_id: t.project_id,
    title: t.title,
    description: t.description || '',
    notes: t.notes || '',
    status: t.status,
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
    todos: [],
    comments: [], // lazy-loaded in drawer
  }));
}

export async function refreshMessages() {
  const msgs = await api.get('/admin/api/messages');
  state.messages = (msgs.messages || []).map(m => ({
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

export async function loadAll() {
  const [msgs, agents, channels, projects] = await Promise.all([
    api.get('/admin/api/messages'),
    api.get('/admin/api/registered'),
    api.get('/admin/api/channels'),
    api.get('/admin/api/kanban/projects'),
  ]);
  state.messages = (msgs.messages || []).map(m => ({
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
  state.agents = (agents.agents || []).map(a => ({
    agent: a.agent,
    role: a.role || '',
    created: a.created_at,
    last_seen: a.last_seen,
    rate: a.rate || { used: 0, limit: 10, windowSec: 60 },
    transport: a.transport || 'poll',
    connectedSince: a.connected_since || null,
    connections: a.connections || 0,
    channels: a.channels || ['all-agent'],
  }));
  state.channels = (channels.channels || []).map(c => c.name || c);
  state.channelMembers = {};
  for (const c of (channels.channels || [])) {
    state.channelMembers[c.name || c] = c.members || [];
  }
  state.projects = (projects.projects || []).map(p => ({
    id: p.id,
    title: p.title,
    description: p.description || '',
    archived: !!p.archived,
    subscribers: p.subscribers || [],
  }));
  if (!state.activeProjectId && state.projects.length) {
    state.activeProjectId = state.projects[0].id;
  }
  await refreshTasks();

  try {
    const poll = await api.get('/poll?since_ts=0&since_id=0&admin=1');
    if (poll.events && poll.events.length) {
      const last = poll.events[poll.events.length - 1];
      state.pollCursor = { ts: last.ts, id: last.id };
      state.pollEvents = poll.events.slice(-50).reverse().map(evToPollRow);
    }
    state.resyncRequired = false;
    state.retentionCutoffTs = Math.floor(Date.now() / 1000) - 30 * 86400;
  } catch (e) { /* poll seed optional */ }
}

export async function loadTaskDetail(taskId) {
  const d = await api.get(`/admin/api/kanban/tasks/${taskId}`);
  const t = d.task || d;
  const task = state.tasks.find(x => x.id === taskId);
  if (task && t) {
    task.todos = (t.todos || []).map(td => ({
      id: td.id,
      task_id: taskId,
      text: td.text,
      done: td.done ? 1 : 0,
      sort_order: td.sort_order || 0,
    }));
    task.comments = (t.comments || []).map(c => ({
      id: c.id,
      task_id: taskId,
      author: c.author,
      body: c.body,
      ts: c.created_at || c.ts,
    }));
    task.labels = t.labels || task.labels;
    task.notes = t.notes !== undefined ? t.notes : task.notes;
    task.description = t.description !== undefined ? t.description : task.description;
    task.title = t.title || task.title;
    task.comment_count = t.comment_count || task.comments.length;
  }
  return task;
}

export async function manualRefresh() {
  try {
    await loadAll();
    if (window.renderMainViewport) window.renderMainViewport(true);
    if (state.openTaskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
    showToast('Refreshed', 'All data reloaded from bus', 'green');
  } catch (e) {
    showToast('Refresh failed', e.message, 'red');
  }
}
