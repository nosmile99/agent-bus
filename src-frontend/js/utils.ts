// Time, Constants & Helper Utilities
import { showToast } from './components/toast.js';
import type { FrontendTask } from './types.js';

export function currentEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

export let NOW_EPOCH = currentEpoch();
setInterval(() => {
  NOW_EPOCH = currentEpoch();
}, 30000);

export function getNowEpoch(): number {
  return NOW_EPOCH;
}

export function nowIso(): string {
  return new Date(NOW_EPOCH * 1000).toISOString();
}

export interface AgentColorDef {
  bg: string;
  text: string;
  border: string;
  dot: string;
  badge: string;
}

export const AGENT_COLORS: Record<string, AgentColorDef> = {
  nyx: { bg: 'bg-indigo-100', text: 'text-indigo-950', border: 'border-indigo-800', dot: 'bg-indigo-600', badge: '#3730A3' },
  nosmile99: { bg: 'bg-emerald-100', text: 'text-emerald-950', border: 'border-emerald-800', dot: 'bg-emerald-600', badge: '#065F46' },
  wren: { bg: 'bg-amber-100', text: 'text-amber-950', border: 'border-amber-800', dot: 'bg-amber-600', badge: '#92400E' },
  luki: { bg: 'bg-stone-200', text: 'text-stone-900', border: 'border-stone-700', dot: 'bg-forest', badge: '#1E6F50' }
};

export function getAgentStyle(name: string): AgentColorDef {
  return AGENT_COLORS[name] || { bg: 'bg-stone-200', text: 'text-stone-900', border: 'border-stone-700', dot: 'bg-stone-600', badge: '#44403C' };
}

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  urgent: 'Urgent'
};

export const AUDIENCE_LABELS: Record<string, string> = {
  agents: 'Agents',
  luki: 'Just me'
};

export const STATUS_LABELS: Record<string, string> = {
  todo: 'To Do',
  doing: 'In Progress',
  blocked: 'Blocked',
  done: 'Done'
};

export const BLOCKED_REASON_LABELS: Record<string, string> = {
  'waiting-human': 'Waiting on me',
  'waiting-task': 'Waiting on another task',
  'waiting-external': 'Waiting on external service'
};

export function formatBlockedReason(kind: string | null | undefined): string {
  return (kind && BLOCKED_REASON_LABELS[kind]) || 'Waiting on me';
}

export function tsToEpoch(ts: string | number | null | undefined): number {
  if (ts == null) return 0;
  if (typeof ts === 'number') return ts;
  const p = Date.parse(ts);
  return isNaN(p) ? 0 : Math.floor(p / 1000);
}

export function isTaskStale(task: FrontendTask): boolean {
  return task.status === 'doing' && (NOW_EPOCH - tsToEpoch(task.last_activity_at)) > 86400;
}

export function isTaskOverdue(task: FrontendTask): boolean {
  return Boolean(task.due_at && task.status !== 'done' && NOW_EPOCH > task.due_at);
}

export function formatRelEpoch(epochSec: number | string | null | undefined): string {
  const ep = tsToEpoch(epochSec);
  if (!ep) return '—';
  const diff = NOW_EPOCH - ep;
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60);
  const hours = Math.floor(abs / 3600);
  const days = Math.floor(abs / 86400);

  if (diff >= 0) {
    if (abs < 60) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 48) return `${hours}h ago`;
    return `${days}d ago`;
  } else {
    if (mins < 60) return `in ${mins}m`;
    if (hours < 48) return `in ${hours}h`;
    return `in ${days}d`;
  }
}

export function formatFriendlyIsoTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

export function formatRelIso(isoStr: string | null | undefined): string {
  if (!isoStr) return 'never';
  const epoch = Math.floor(new Date(isoStr).getTime() / 1000);
  return formatRelEpoch(epoch);
}

export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const ADMIN_ONLY_EVENTS = new Set<string>([
  'agent.registered',
  'agent.deregistered',
  'agent.token_issued',
  'agent.token_revoked'
]);

// Legacy mock hook — real events arrive via pollOnce(). Kept as no-op
export function emitPollEvent(_typeLabel: string, _projectId?: number | null, _summaryText?: string, _forceAdminOnly = false): void {
  // no-op: real backend emits events, poller picks them up
}

export function getUserCommentCount(task: FrontendTask): number {
  return (task.comments || []).filter(c => c.author !== 'system').length;
}

export function copyTokenText(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  showToast('Copied to clipboard', text.slice(0, 36) + (text.length > 36 ? '…' : ''), 'green');
}

export const horizScrolls: Record<string, number> = {};

export function keepFieldAboveKeyboard(el: HTMLElement | null): void {
  if (!el) return;
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 180);
}
