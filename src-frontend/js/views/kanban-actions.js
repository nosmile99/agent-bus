import { state, refreshTasks } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { showCustomModal, closeTopModal } from '../components/modal.js';
import { escapeHtml, formatBlockedReason } from '../utils.js';

/********************************************************************
 * 8. KANBAN INTERACTION HANDLERS (Status, Filters, Assignment)
 ********************************************************************/

    /********************************************************************
     * 8. KANBAN INTERACTION HANDLERS (Strict No-Op on Active Status)
     ********************************************************************/
    export async export function selectProject(projId) {
      state.activeProjectId = projId;
      state.kanbanFilter.label = 'ALL';
      if (window.renderMainViewport) window.renderMainViewport(false);
      try {
        await refreshTasks();
        if (window.renderMainViewport) window.renderMainViewport(true);
      } catch (_e) { /* keep showing cached */ }
    }

    export function updateKanbanSearch(val) {
      state.kanbanFilter.q = val;
      if (window.renderMainViewport) window.renderMainViewport(true);
      const input = document.getElementById('kanban-search-input');
      if (input) {
        input.focus();
        input.setSelectionRange(val.length, val.length);
      }
    }

    export function toggleKanbanFilterDrawer() {
      state.kanbanFilter.showFilters = !state.kanbanFilter.showFilters;
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function setKanbanFilter(key, val) {
      state.kanbanFilter[key] = val;
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function resetKanbanFilters() {
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

    // Rule #2: Clicking a status that is already active MUST be a complete no-op!
    export async export function requestTaskStatusChange(taskId, newStatus) {
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
        showToast('Status change failed', err.message, 'red');
        return;
      }
      task.status = newStatus;
      task.blocked_kind = null;
      task.last_activity_at = new Date().toISOString();

      showToast(
        `Task #${task.id} → ${STATUS_LABELS[newStatus]}`,
        prevStatus === 'blocked' ? `Cleared "${formatBlockedReason(prevBlockedKind)}"` : task.title,
        newStatus === 'done' ? 'green' : 'ink'
      );
      if (state.openTaskId === taskId) await loadTaskDetail(taskId);
      await refreshTasks();
      if (state.openTaskId === taskId) if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function openBlockedKindPicker(taskId) {
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

    export async export function confirmSetTaskBlocked(taskId, blockedKind) {
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
        showToast('Block failed', err.message, 'red');
        return;
      }
      task.status = 'blocked';
      task.blocked_kind = kind;
      task.last_activity_at = new Date().toISOString();

      closeTopModal();
      showToast(`Task #${task.id} Blocked`, formatBlockedReason(task.blocked_kind), 'red');
      if (state.openTaskId === taskId) if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    // Rule #5: Unblocking must not force a comment: optional & empty by default
    export function quickUnblockAndReplyModal(taskId) {
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

    export async export function executeQuickUnblock(e, taskId) {
      e.preventDefault();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const body = document.getElementById('quick-unblock-comment').value.trim();

      try {
        if (body) {
          await api.post(`/admin/api/kanban/tasks/${taskId}/comments`, { body });
        }
        await api.put(`/admin/api/kanban/tasks/${taskId}`, { status: 'doing' });
      } catch (err) {
        showToast('Unblock failed', err.message, 'red');
        return;
      }

      task.status = 'doing';
      task.blocked_kind = null;
      task.last_activity_at = new Date().toISOString();

      closeTopModal();
      showToast(`Task #${task.id} Unblocked`, `Moved to In Progress`, 'green');
      if (state.openTaskId === taskId) await loadTaskDetail(taskId);
      await refreshTasks();
      if (state.openTaskId === taskId) if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
      updateHeaderTelemetry();
    }

    export async export function manualAssignTask(taskId, agentVal) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const newAssignee = agentVal ? agentVal : null;
      if (task.assignee === newAssignee) return;

      try {
        await api.put(`/admin/api/kanban/tasks/${taskId}`, { assignee: newAssignee });
      } catch (err) {
        showToast('Assign failed', err.message, 'red');
        return;
      }
      task.assignee = newAssignee;
      task.last_activity_at = new Date().toISOString();

      showToast(
        newAssignee ? `Assigned to @${newAssignee}` : 'Task Unassigned',
        task.title
      );
      if (state.openTaskId === taskId) await loadTaskDetail(taskId);
      await refreshTasks();
      if (state.openTaskId === taskId) if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function updateTaskPriority(taskId, priority) {
      // Priority is a client-side display hint (not persisted server-side).
      const task = state.tasks.find(t => t.id === taskId);
      if (!task || task.priority === priority) return;
      task.priority = priority;
      showToast(`Priority set to ${PRIORITY_LABELS[priority]}`);
      if (state.openTaskId === taskId) if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function setTaskDueOffset(taskId, offsetSec) {
      // due_at is a client-side display hint (not persisted server-side)
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const nowSec = Math.floor(Date.now() / 1000);
      task.due_at = offsetSec === null ? null : nowSec + offsetSec;
      showToast(task.due_at ? 'Due date updated' : 'Due date cleared');
      if (state.openTaskId === taskId) if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export async export function touchTaskActivity(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      await loadTaskDetail(taskId);
      showToast('Task #' + task.id + ' refreshed', 'Latest data loaded', 'green');
      if (state.openTaskId === taskId) if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

