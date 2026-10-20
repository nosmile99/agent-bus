import { state } from '../state.js';
import {
  escapeHtml,
  formatRelEpoch,
  getAgentStyle,
  formatBlockedReason,
  isTaskStale,
  isTaskOverdue,
  getUserCommentCount
} from '../utils.js';

/********************************************************************
 * KANBAN CARD RENDERER
 ********************************************************************/

    export function renderPriorityPill(priority) {
      if (priority === 'urgent') {
        return `<span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold">Urgent</span>`;
      }
      if (priority === 'low') {
        return `<span class="font-mono text-[11px] bg-stone-200 text-stone-700 border border-stone-400 px-2 py-0.5 rounded-md font-semibold">Low</span>`;
      }
      return `<span class="font-mono text-[11px] bg-paper text-ink border border-ink/40 px-2 py-0.5 rounded-md font-semibold">Normal</span>`;
    }

    export function renderStatusBadge(task) {
      if (task.status === 'blocked') {
        return `<span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
          <i class="ph-bold ph-warning-octagon"></i> ${escapeHtml(formatBlockedReason(task.blocked_kind))}
        </span>`;
      }
      if (task.status === 'doing') {
        return `<span class="font-mono text-[11px] bg-amber-300 text-ink border border-ink px-2 py-0.5 rounded-md font-bold">In Progress</span>`;
      }
      if (task.status === 'done') {
        return `<span class="font-mono text-[11px] bg-forest text-white px-2 py-0.5 rounded-md font-bold">Done</span>`;
      }
      return `<span class="font-mono text-[11px] bg-stone-200 text-ink border border-stone-500 px-2 py-0.5 rounded-md font-bold">To Do</span>`;
    }

    export function renderTaskCard(task) {
      const stale = isTaskStale(task);
      const overdue = isTaskOverdue(task);
      const todosDone = (task.todos || []).filter(td => td.done === 1).length;
      const todosTotal = (task.todos || []).length;
      const commentCount = getUserCommentCount(task);
      const agStyle = task.assignee ? getAgentStyle(task.assignee) : null;
      const isSwiped = state.swipedTaskId === task.id;

      return `
        <div class="swipe-shell select-none" id="task-swipe-shell-${task.id}">
          <!-- Physical Background Track Revealed While Dragging Task Card -->
          <div
            id="task-swipe-bg-${task.id}"
            class="swipe-bg bg-forest text-white px-4 flex items-center justify-between rounded-2xl transition-colors duration-150"
          >
            <div id="task-swipe-left-hint-${task.id}" class="flex items-center gap-2 font-mono text-xs font-bold">
              <span class="w-9 h-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center">
                <i class="ph-bold ph-lightning text-base"></i>
              </span>
              <span>Quick Actions</span>
            </div>
            <div id="task-swipe-right-hint-${task.id}" class="flex items-center gap-2 font-mono text-xs font-bold">
              <span>Quick Actions</span>
              <span class="w-9 h-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center">
                <i class="ph-bold ph-lightning text-base"></i>
              </span>
            </div>
          </div>

          <!-- Foreground Draggable Card -->
          <div
            id="task-swipe-fg-${task.id}"
            class="swipe-fg hw-card rounded-2xl overflow-hidden bg-card relative"
            draggable="true"
            ondragstart="handleKanbanDragStart(event, ${task.id})"
            onpointerdown="handleTaskPointerDown(event, ${task.id})"
          >
            <!-- Special Caution Header for Stale, Overdue, or Blocked -->
            ${task.status === 'blocked' ? `
              <div class="caution-stripe-red px-3 py-1.5 border-b border-ink flex items-center justify-between">
                <span class="font-mono text-[11px] font-bold text-vermilion flex items-center gap-1">
                  <i class="ph-bold ph-hand-palm"></i> ${escapeHtml(formatBlockedReason(task.blocked_kind))}
                </span>
                <span class="font-mono text-[11px] font-semibold text-ink">
                  ${formatRelEpoch(task.status_changed_at)}
                </span>
              </div>
            ` : stale ? `
              <div class="caution-stripe-amber px-3 py-1.5 border-b border-ink flex items-center justify-between">
                <span class="font-mono text-[11px] font-bold text-amber-950 flex items-center gap-1">
                  <i class="ph-bold ph-hourglass-high"></i> Stale (Quiet &gt;24h)
                </span>
                <span class="font-mono text-[11px] font-bold text-amber-950">
                  ${formatRelEpoch(task.last_activity_at)}
                </span>
              </div>
            ` : ''}

            <!-- Swipe-Revealed Quick Action Tray -->
            ${isSwiped ? `
              <div class="bg-charcoal text-paper px-3 py-2 border-b border-ink flex items-center justify-between gap-2">
                <span class="font-mono text-xs font-bold text-amber-300">Quick Actions</span>
                <div class="flex items-center gap-1.5">
                  ${task.status !== 'done' ? `
                    <button onclick="quickCompleteTask(${task.id}, event)" class="tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1">
                      <i class="ph-bold ph-check-circle"></i> Mark done
                    </button>
                  ` : ''}
                  <button onclick="quickCycleAssignee(${task.id}, event)" class="tap-44 px-3 rounded-xl bg-paper text-ink font-mono text-xs font-bold flex items-center gap-1">
                    <i class="ph-bold ph-user-switch"></i> ${task.assignee ? 'Reassign' : 'Claim (nyx)'}
                  </button>
                  <button onclick="clearTaskSwipe(event)" class="tap-44 w-11 rounded-xl bg-black/40 text-paper flex items-center justify-center">
                    <i class="ph-bold ph-x"></i>
                  </button>
                </div>
              </div>
            ` : ''}

            <div class="p-3.5 space-y-2.5">
              <!-- Top Row: ID, Priority, Overdue, Assignee -->
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-mono text-xs font-bold text-muted">#${task.id}</span>
                  ${renderPriorityPill(task.priority)}
                  ${overdue ? `
                    <span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
                      <i class="ph-bold ph-alarm"></i> Overdue (${formatRelEpoch(task.due_at)})
                    </span>
                  ` : task.due_at ? `
                    <span class="font-mono text-[11px] bg-recessed text-ink border border-border px-2 py-0.5 rounded font-medium">
                      Due ${formatRelEpoch(task.due_at)}
                    </span>
                  ` : ''}
                </div>

                <div>
                  ${task.assignee ? `
                    <span class="font-mono text-xs ${agStyle.bg} ${agStyle.text} border ${agStyle.border} px-2.5 py-0.5 rounded-lg font-bold inline-flex items-center gap-1">
                      <span class="w-1.5 h-1.5 rounded-full ${agStyle.dot}"></span>
                      @${escapeHtml(task.assignee)}
                      ${task.admin_assigned ? `<i class="ph-fill ph-lock-key text-[11px]" title="Assigned by you"></i>` : ''}
                    </span>
                  ` : `
                    <span class="font-mono text-xs text-muted bg-recessed px-2 py-0.5 rounded-lg border border-border">
                      Unassigned
                    </span>
                  `}
                </div>
              </div>

              <!-- Title & Short Description -->
              <div onclick="openTaskDrawerIfNotSwiped(event, ${task.id})" class="cursor-pointer group">
                <h3 class="font-serif text-base font-bold text-ink group-hover:text-forest leading-snug">
                  ${escapeHtml(task.title)}
                </h3>
                ${task.description ? `
                  <p class="text-sm text-muted mt-1 line-clamp-2 leading-relaxed">${escapeHtml(task.description)}</p>
                ` : ''}
              </div>

              <!-- Labels Row -->
              ${(task.labels || []).length > 0 ? `
                <div class="flex items-center gap-1.5 flex-wrap">
                  ${task.labels.map(lbl => `
                    <button onclick="setKanbanFilter('label', '${escapeHtml(lbl)}')" class="tap-44 px-2.5 rounded-lg font-mono text-xs bg-recessed hover:bg-ink hover:text-paper text-ink border border-border font-semibold transition flex items-center">
                      #${escapeHtml(lbl)}
                    </button>
                  `).join('')}
                </div>
              ` : ''}

              <!-- Metadata Counters + Direct Mark Done Action -->
              <div class="pt-2 border-t border-border flex items-center justify-between gap-2">
                <button onclick="openTaskDrawerIfNotSwiped(event, ${task.id})" class="tap-44 px-1 flex items-center gap-3 font-mono text-xs text-muted text-left">
                  <span class="flex items-center gap-1 ${todosTotal > 0 && todosDone === todosTotal ? 'text-forest font-bold' : ''}">
                    <i class="ph-bold ph-check-square-offset text-sm"></i>
                    ${todosDone}/${todosTotal}
                  </span>
                  <span class="flex items-center gap-1 ${task.notes ? 'text-ink font-semibold' : ''}">
                    <i class="ph-bold ph-file-text text-sm"></i>
                    ${task.notes ? 'Doc' : '—'}
                  </span>
                  <span class="flex items-center gap-1 ${commentCount > 0 ? 'text-ink font-semibold' : ''}">
                    <i class="ph-bold ph-chats-circle text-sm"></i>
                    ${commentCount}
                  </span>
                </button>

                <div class="flex items-center gap-1.5">
                  ${task.status !== 'done' ? `
                    <button
                      onclick="quickCompleteTask(${task.id}, event)"
                      class="hw-btn tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1"
                      title="Mark task done"
                    >
                      <i class="ph-bold ph-check"></i>
                      <span>Mark done</span>
                    </button>
                  ` : `
                    <span class="font-mono text-xs font-bold text-forest px-2 py-1 flex items-center gap-1">
                      <i class="ph-fill ph-check-circle"></i> Completed
                    </span>
                  `}
                  <button
                    onclick="openTaskDrawerIfNotSwiped(event, ${task.id})"
                    class="hw-btn tap-44 px-3 rounded-xl bg-recessed text-ink font-mono text-xs font-bold flex items-center"
                  >
                    Open
                  </button>
                </div>
              </div>

              <!-- Tap Fallback Status Strip (>=44px targets, no-op if already active) -->
              <div class="grid grid-cols-4 gap-1 pt-1">
                ${[
                  { id: 'todo', label: 'To Do' },
                  { id: 'doing', label: 'Doing' },
                  { id: 'blocked', label: 'Blocked' },
                  { id: 'done', label: 'Done' }
                ].map(st => {
                  const isCurrent = task.status === st.id;
                  return `
                    <button
                      onclick="requestTaskStatusChange(${task.id}, '${st.id}')"
                      class="tap-44 rounded-xl font-mono text-[11px] font-bold border transition flex items-center justify-center ${
                        isCurrent
                          ? st.id === 'blocked'
                            ? 'bg-vermilion text-white border-ink cursor-default'
                            : 'bg-ink text-paper border-ink cursor-default'
                          : 'bg-paper text-muted border-border hover:border-ink hover:text-ink'
                      }"
                      ${isCurrent ? 'aria-current="true"' : ''}
                    >
                      ${st.label}
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    }

