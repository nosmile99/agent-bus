// Frontend TypeScript types and interfaces for Agent Bus Operator Console

export type TabType = 'messages' | 'needs-you' | 'kanban' | 'agents';
export type TaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
export type TaskPriority = 'low' | 'normal' | 'urgent';
export type BlockedKind = 'waiting-human' | 'waiting-task' | 'waiting-external';

export interface FrontendMessage {
  id: number;
  channel: string;
  sender: string;
  body: string;
  ts: string;
  priority: string;
  audience: string;
  reply_to: number | null;
  edited: boolean;
}

export interface FrontendAgent {
  agent: string;
  role: string;
  created: string;
  last_seen?: string | null;
  rate: {
    used: number;
    limit: number;
    windowSec: number;
  };
  transport: 'ws' | 'poll';
  connectedSince: string | null;
  connections: number;
  channels: string[];
}

export interface FrontendProject {
  id: number;
  title: string;
  description: string;
  archived: boolean;
  subscribers: string[];
}

export interface FrontendTodo {
  id: number;
  task_id: number;
  text: string;
  done: number;
  sort_order: number;
}

export interface FrontendComment {
  id: number;
  task_id: number;
  author: string;
  body: string;
  ts: number;
}

export interface FrontendTask {
  id: number;
  project_id: number;
  title: string;
  description: string;
  notes: string;
  status: TaskStatus;
  priority?: TaskPriority | string;
  blocked_kind: string | null;
  assignee: string | null;
  admin_assigned?: string | number | boolean | null;
  claimed_at: number | null;
  labels: string[];
  comment_count: number;
  status_changed_at?: number | null;
  created_at: number;
  updated_at: number;
  last_activity_at?: number | null;
  created_by: string | null;
  todos: FrontendTodo[];
  comments: FrontendComment[];
  due_at?: number | null;
}

export interface TaskDraft {
  title: string;
  description: string;
  notes: string;
  commentDraft: string;
  dirty: boolean;
}

export interface ComposerDraft {
  channel: string;
  priority: string;
  audience: string;
  body: string;
  reply_to: number | null;
}

export interface FrontendPollEvent {
  id: number;
  ts: number;
  type: string;
  actor: string | null;
  project_id: number | null;
  summary: string;
  adminOnly: boolean;
  payload: Record<string, unknown>;
}

export interface RawPollEvent {
  id: number;
  ts: number;
  type: string;
  actor?: string | null;
  project_id?: number | null;
  scope?: string;
  payload?: Record<string, unknown>;
}

export interface KanbanFilterState {
  q: string;
  status: string;
  assignee: string;
  label: string;
  blocked_kind: string;
  priority: string;
  showFilters: boolean;
}

export interface FrontendState {
  activeTab: TabType;
  adminUser: string;
  darkMode: boolean;
  openThreadMsgId: number | null;
  composerExpanded: boolean;
  composerDraft: ComposerDraft;
  taskDrafts: Record<number, TaskDraft>;
  swipedTaskId: number | null;
  swipedTaskDir: 'left' | 'right' | null;
  agents: FrontendAgent[];
  channels: string[];
  channelMembers: Record<string, string[]>;
  messages: FrontendMessage[];
  msgFilter: { channel: string; sender: string; priority: string; q: string };
  activeProjectId: number | null;
  projects: FrontendProject[];
  tasks: FrontendTask[];
  kanbanFilter: KanbanFilterState;
  pollCursor: { ts: number; id: number };
  retentionCutoffTs: number;
  resyncRequired: boolean;
  pollInspectorAdminView: boolean;
  pollEvents: FrontendPollEvent[];
  openTaskId: number | null;
}

// Window augmentations for global event handlers
declare global {
  interface Window {
    renderMainViewport?: (keepScroll?: boolean) => void;
    renderTaskDrawer?: (keepScroll?: boolean) => void;
    renderKanbanColumn?: (col: string) => void;
  }
}
