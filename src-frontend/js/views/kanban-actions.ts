import { state, refreshTasks, loadTaskDetail, updateHeaderTelemetry } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { showCustomModal, closeTopModal } from '../components/modal.js';
import { escapeHtml, formatBlockedReason, STATUS_LABELS, PRIORITY_LABELS, keepFieldAboveKeyboard } from '../utils.js';
import { KanbanFilterState, TaskPriority, TaskStatus } from '../types.js';

/********************************************************************
 * KANBAN INTERACTION HANDLERS (Status, Filters, Assignment)
 ********************************************************************/

export async function selectProject(projId: number): Promise<void> {
  state.activeProjectId = projId;
  state.kanbanFilter.label = 'ALL';
  if (window.renderMainViewport) window.renderMainViewport(false);
  try {
    await refreshTasks();
    if (window.renderMainViewport) window.renderMainViewport(true);
  } catch (_e) { /* keep showing cached */ }
}

export function updateKanbanSearch(val: string): void {
  state.kanbanFilter.q = val;
  if (window.renderMainViewport) window.renderMainViewport(true);
  const input = document.getElementById('kanban-search-input') as HTMLInputElement | null;
  if (input) {
    input.focus();
    input.setSelectionRange(val.length, val.length);
  }
}

export function toggleKanbanFilterDrawer(): void {
  state.kanbanFilter.showFilters = !state.kanbanFilter.showFilters;
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function setKanbanFilter(key: keyof KanbanFilterState, val: string | boolean): void {
  // @ts-expect-error key/value dynamic assignment
  state.kanbanFilter[key] = val;
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function resetKanbanFilters(): void {
  state.kanbanFilter = {
    q: '',
    status: 'ALL',
    assignee: 'ALL',
    label: 'ALL',
    blocked_kind: 'ALL',
    priority: 'ALL',
    showFilters: true
  };
  if (window.renderMainViewport) window.renderMainViewport(true);
}

// Strict No-Op on Active Status
export async function requestTaskStatusChange(taskId: number, newStatus: string): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  // Strict no-op when status is already active
  if (task.status === newStatus) {
    return;
  }

  if (newStatus === 'blocked') {
    openBlockedKindPicker(taskId);
    return;
  }

  const prevStatus = task.status;
  const prevBlockedKind = task.blocked_kind;
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}`, { status: newStatus });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Status change failed', errorMsg, 'red');
    return;
  }
  task.status = newStatus as TaskStatus;
  task.blocked_kind = null;
  task.last_activity_at = Math.floor(Date.now() / 1000);

  showToast(
    `Task #${task.id} → ${STATUS_LABELS[newStatus] || newStatus}`,
    prevStatus === 'blocked' ? `Cleared "${formatBlockedReason(prevBlockedKind)}"` : task.title,
    newStatus === 'done' ? 'green' : 'ink'
  );
  if (state.openTaskId === taskId) await loadTaskDetail(taskId);
  await refreshTasks();
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function openBlockedKindPicker(taskId: number): void {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const current = task.blocked_kind || 'waiting-human';

  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-vermilion">Blocked Reason</div>
          <h3 class="font-serif font-bold text-lg text-ink">Why is Task #${task.id} blocked?</h3>
        </div>
        <button onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <p class="text-sm text-muted">
        Choosing <strong class="text-ink">Waiting on me</strong> places this task in your <em>Needs You</em> queue.
      </p>

      <div class="space-y-2.5">
        ${[
          {
            kind: 'waiting-human',
            title: 'Waiting on me',
            desc: 'Paused for your decision, approval, or credentials.'
          },
          {
            kind: 'waiting-task',
            title: 'Waiting on another task',
            desc: 'Depends on another task or migration finishing first.'
          },
          {
            kind: 'waiting-external',
            title: 'Waiting on external service',
            desc: 'Blocked on an upstream release, network check, or quota window.'
          }
        ].map(opt => `
          <button
            onclick="confirmSetTaskBlocked(${task.id}, '${opt.kind}')"
            class="w-full text-left p-3.5 rounded-2xl border-2 transition flex items-start justify-between gap-3 ${
              current === opt.kind && task.status === 'blocked'
                ? 'bg-rose-50 border-vermilion shadow-[0_2px_0_#E03E1A]'
                : 'bg-card border-ink hover:bg-recessed'
            }"
          >
            <div>
              <div class="font-serif text-base font-bold text-ink">${opt.title}</div>
              <div class="text-xs text-muted mt-0.5">${opt.desc}</div>
            </div>
            <i class="ph-bold ph-arrow-right text-vermilion mt-1 text-base"></i>
          </button>
        `).join('')}
      </div>
    </div>
  `);
}

export async function confirmSetTaskBlocked(taskId: number, blockedKind: string): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  // If already blocked with the exact same reason, do not re-stamp timestamps or log duplicate entries
  if (task.status === 'blocked' && task.blocked_kind === blockedKind) {
    closeTopModal();
    return;
  }

  const kind = blockedKind || 'waiting-human';
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}`, { status: 'blocked', blocked_kind: kind });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Block failed', errorMsg, 'red');
    return;
  }
  task.status = 'blocked';
  task.blocked_kind = kind;
  task.last_activity_at = Math.floor(Date.now() / 1000);

  closeTopModal();
  showToast(`Task #${task.id} Blocked`, formatBlockedReason(task.blocked_kind), 'red');
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

// Rule #5: Unblocking must not force a comment: optional & empty by default
export function quickUnblockAndReplyModal(taskId: number): void {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  showCustomModal(`
    <form onsubmit="executeQuickUnblock(event, ${task.id})" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-forest">Unblock Task</div>
          <h3 class="font-serif font-bold text-lg text-ink">Unblock Task #${task.id}</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <div class="text-sm font-semibold text-ink">${escapeHtml(task.title)}</div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">
          Note for ${escapeHtml(task.assignee ? '@' + task.assignee : 'agents')} (optional)
        </label>
        <textarea
          id="quick-unblock-comment"
          rows="3"
          onfocus="keepFieldAboveKeyboard(this)"
          placeholder="Leave an optional note or instructions..."
          class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none"
        ></textarea>
      </div>

      <button type="submit" class="hw-btn tap-44 w-full bg-forest text-white font-mono text-xs font-bold py-3 rounded-xl">
        Unblock &amp; Move to In Progress
      </button>
    </form>
  `);
}

export async function executeQuickUnblock(e: Event, taskId: number): Promise<void> {
  e.preventDefault();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const input = document.getElementById('quick-unblock-comment') as HTMLTextAreaElement | null;
  const body = input ? input.value.trim() : '';

  try {
    if (body) {
      await api.post(`/admin/api/kanban/tasks/${taskId}/comments`, { body });
    }
    await api.put(`/admin/api/kanban/tasks/${taskId}`, { status: 'doing' });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Unblock failed', errorMsg, 'red');
    return;
  }

  task.status = 'doing';
  task.blocked_kind = null;
  task.last_activity_at = Math.floor(Date.now() / 1000);

  closeTopModal();
  showToast(`Task #${task.id} Unblocked`, `Moved to In Progress`, 'green');
  if (state.openTaskId === taskId) await loadTaskDetail(taskId);
  await refreshTasks();
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}

export async function manualAssignTask(taskId: number, agentVal: string): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const newAssignee = agentVal ? agentVal : null;
  if (task.assignee === newAssignee) return;

  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}`, { assignee: newAssignee });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Assign failed', errorMsg, 'red');
    return;
  }
  task.assignee = newAssignee;
  task.last_activity_at = Math.floor(Date.now() / 1000);

  showToast(
    newAssignee ? `Assigned to @${newAssignee}` : 'Task Unassigned',
    task.title
  );
  if (state.openTaskId === taskId) await loadTaskDetail(taskId);
  await refreshTasks();
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function updateTaskPriority(taskId: number, priority: TaskPriority): void {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || task.priority === priority) return;
  task.priority = priority;
  showToast(`Priority set to ${PRIORITY_LABELS[priority] || priority}`);
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function setTaskDueOffset(taskId: number, offsetSec: number | null): void {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const nowSec = Math.floor(Date.now() / 1000);
  task.due_at = offsetSec === null ? null : nowSec + offsetSec;
  showToast(task.due_at ? 'Due date updated' : 'Due date cleared');
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export async function touchTaskActivity(taskId: number): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  await loadTaskDetail(taskId);
  showToast('Task #' + task.id + ' refreshed', 'Latest data loaded', 'green');
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

// Window globals
const win = window as unknown as Record<string, unknown>;
win.selectProject = selectProject;
win.updateKanbanSearch = updateKanbanSearch;
win.toggleKanbanFilterDrawer = toggleKanbanFilterDrawer;
win.setKanbanFilter = setKanbanFilter;
win.resetKanbanFilters = resetKanbanFilters;
win.requestTaskStatusChange = requestTaskStatusChange;
win.openBlockedKindPicker = openBlockedKindPicker;
win.confirmSetTaskBlocked = confirmSetTaskBlocked;
win.quickUnblockAndReplyModal = quickUnblockAndReplyModal;
win.executeQuickUnblock = executeQuickUnblock;
win.manualAssignTask = manualAssignTask;
win.updateTaskPriority = updateTaskPriority;
win.setTaskDueOffset = setTaskDueOffset;
win.touchTaskActivity = touchTaskActivity;
win.keepFieldAboveKeyboard = keepFieldAboveKeyboard;
