import { state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { renderTaskCard, renderPriorityPill, renderStatusBadge } from './kanban-card.js';

/********************************************************************
 * 6. VIEW 2: KANBAN BOARD
 ********************************************************************/

    /********************************************************************
     * 6. VIEW 2: KANBAN BOARD (One Column Per Status, Drag & Drop + Swipe + Tap Fallback)
     ********************************************************************/
    export function getProjectDistinctLabels(projectId) {
      const set = new Set();
      state.tasks
        .filter(t => t.project_id === projectId)
        .forEach(t => (t.labels || []).forEach(l => set.add(l)));
      return Array.from(set).sort();
    }

    export function renderKanbanView() {
      const currentProj = state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
      const projectLabels = getProjectDistinctLabels(currentProj.id);
      const kf = state.kanbanFilter;

      const allProjTasks = state.tasks.filter(t => t.project_id === currentProj.id);
      const filteredTasks = allProjTasks.filter(t => {
        if (kf.status !== 'ALL' && t.status !== kf.status) return false;
        if (kf.assignee !== 'ALL') {
          if (kf.assignee === 'UNASSIGNED' && t.assignee !== null) return false;
          if (kf.assignee !== 'UNASSIGNED' && t.assignee !== kf.assignee) return false;
        }
        if (kf.priority !== 'ALL' && t.priority !== kf.priority) return false;
        if (kf.label !== 'ALL' && !(t.labels || []).includes(kf.label)) return false;
        if (kf.blocked_kind !== 'ALL' && t.blocked_kind !== kf.blocked_kind) return false;
        if (kf.q.trim() !== '') {
          const needle = kf.q.trim().toLowerCase().replace(/[%_]/g, '');
          const hay = `${t.title || ''} ${t.description || ''}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      });

      const activeFilterCount = [
        kf.status !== 'ALL',
        kf.assignee !== 'ALL',
        kf.priority !== 'ALL',
        kf.label !== 'ALL',
        kf.blocked_kind !== 'ALL',
        kf.q.trim() !== ''
      ].filter(Boolean).length;

      const columns = [
        { id: 'todo', title: 'To Do', dot: 'bg-stone-500' },
        { id: 'doing', title: 'In Progress', dot: 'bg-ochre' },
        { id: 'blocked', title: 'Blocked', dot: 'bg-vermilion' },
        { id: 'done', title: 'Done', dot: 'bg-forest' }
      ];

      return `
        <div class="p-3.5 space-y-3 flex-1 flex flex-col">
          <!-- Project Selector Deck -->
          <div class="hw-card rounded-2xl p-3 bg-card">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-[11px] uppercase tracking-wider text-muted font-bold">Active Project</span>
                  ${currentProj.archived ? `<span class="font-mono text-[10px] bg-stone-800 text-white px-2 py-0.5 rounded">Archived</span>` : ''}
                </div>
                <div class="relative mt-1">
                  <select onchange="selectProject(Number(this.value))" class="tap-44 w-full appearance-none bg-recessed border-1.5 border-ink rounded-xl px-3 py-2 pr-9 font-serif font-bold text-ink focus:outline-none">
                    ${state.projects.map(p => `
                      <option value="${p.id}" ${p.id === currentProj.id ? 'selected' : ''}>
                        ${escapeHtml(p.title)} (${state.tasks.filter(t => t.project_id === p.id).length})
                      </option>
                    `).join('')}
                  </select>
                  <i class="ph-bold ph-caret-up-down absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink"></i>
                </div>
              </div>

              <div class="flex items-center gap-1.5 shrink-0 pt-5">
                <button onclick="openProjectModal(${currentProj.id})" class="hw-btn tap-44 w-11 rounded-xl bg-paper flex items-center justify-center text-ink" title="Project settings & access">
                  <i class="ph-bold ph-sliders-horizontal text-lg"></i>
                </button>
                <button onclick="openProjectModal(null)" class="hw-btn tap-44 w-11 rounded-xl bg-ink text-paper flex items-center justify-center" title="New Project">
                  <i class="ph-bold ph-folder-plus text-lg"></i>
                </button>
              </div>
            </div>

            ${currentProj.description ? `
              <p class="text-sm text-muted mt-2 leading-relaxed">${escapeHtml(currentProj.description)}</p>
            ` : ''}

            <!-- Project Subscribers Pill Bar -->
            <div class="mt-2.5 pt-2 border-t border-border flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-mono text-[11px] font-bold text-muted flex items-center gap-1">
                  <i class="ph-bold ph-users-three"></i> Access:
                </span>
                ${(currentProj.subscribers || []).length === 0 ? `
                  <span class="font-mono text-[11px] bg-emerald-100 text-emerald-950 border border-emerald-700 px-2 py-0.5 rounded-md font-semibold">
                    All agents
                  </span>
                ` : currentProj.subscribers.map(ag => {
                  const st = getAgentStyle(ag);
                  return `<span class="font-mono text-[11px] ${st.bg} ${st.text} border ${st.border} px-2 py-0.5 rounded-md font-bold">@${escapeHtml(ag)}</span>`;
                }).join('')}
              </div>
              <button onclick="openProjectModal(${currentProj.id})" class="tap-44 px-2 font-mono text-xs underline font-bold text-ink shrink-0 flex items-center">
                Edit access
              </button>
            </div>
          </div>

          <!-- Search & Filter Bar -->
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <div class="relative flex-1">
                <i class="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-base"></i>
                <input
                  id="kanban-search-input"
                  type="text"
                  value="${escapeHtml(kf.q)}"
                  oninput="updateKanbanSearch(this.value)"
                  placeholder="Search tasks..."
                  class="tap-44 w-full hw-inset rounded-xl pl-9 pr-9 py-2 font-medium text-ink placeholder:text-muted focus:outline-none focus:border-ink"
                />
                ${kf.q ? `
                  <button onclick="updateKanbanSearch('')" class="tap-44 absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-ink flex items-center justify-center">
                    <i class="ph-bold ph-x-circle text-lg"></i>
                  </button>
                ` : ''}
              </div>

              <button onclick="toggleKanbanFilterDrawer()" class="hw-btn tap-44 px-3 rounded-xl font-mono text-xs font-bold flex items-center gap-1.5 ${kf.showFilters || activeFilterCount > 0 ? 'bg-ink text-paper' : 'bg-card text-ink'}">
                <i class="ph-bold ph-funnel text-base"></i>
                <span>Filter</span>
                ${activeFilterCount > 0 ? `<span class="bg-ochre text-white px-1.5 py-0.2 rounded-full text-[10px]">${activeFilterCount}</span>` : ''}
              </button>

              <button onclick="openCreateTaskModal()" class="hw-btn tap-44 px-3.5 rounded-xl bg-ink text-paper font-mono text-xs font-bold flex items-center gap-1 shrink-0">
                <i class="ph-bold ph-plus-bold text-sm"></i>
                <span>New Task</span>
              </button>
            </div>

            <!-- Collapsible Multi-Facet Filter Panel (Human Labels Only) -->
            ${kf.showFilters ? `
              <div class="hw-card rounded-2xl p-3.5 bg-card space-y-3">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                    Filter Board
                  </span>
                  <button onclick="resetKanbanFilters()" class="tap-44 px-2 font-mono text-xs text-ink font-bold underline flex items-center">
                    Reset filters
                  </button>
                </div>

                <div class="grid grid-cols-2 gap-2.5">
                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Status</label>
                    <select onchange="setKanbanFilter('status', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" ${kf.status === 'ALL' ? 'selected' : ''}>All statuses</option>
                      <option value="todo" ${kf.status === 'todo' ? 'selected' : ''}>To Do</option>
                      <option value="doing" ${kf.status === 'doing' ? 'selected' : ''}>In Progress</option>
                      <option value="blocked" ${kf.status === 'blocked' ? 'selected' : ''}>Blocked</option>
                      <option value="done" ${kf.status === 'done' ? 'selected' : ''}>Done</option>
                    </select>
                  </div>

                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Assignee</label>
                    <select onchange="setKanbanFilter('assignee', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" ${kf.assignee === 'ALL' ? 'selected' : ''}>Anyone</option>
                      <option value="UNASSIGNED" ${kf.assignee === 'UNASSIGNED' ? 'selected' : ''}>Unassigned</option>
                      ${state.agents.map(a => `<option value="${a.agent}" ${kf.assignee === a.agent ? 'selected' : ''}>@${a.agent}</option>`).join('')}
                    </select>
                  </div>

                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Priority</label>
                    <select onchange="setKanbanFilter('priority', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" ${kf.priority === 'ALL' ? 'selected' : ''}>Any priority</option>
                      <option value="urgent" ${kf.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                      <option value="normal" ${kf.priority === 'normal' ? 'selected' : ''}>Normal</option>
                      <option value="low" ${kf.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                  </div>

                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Label</label>
                    <select onchange="setKanbanFilter('label', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" ${kf.label === 'ALL' ? 'selected' : ''}>All labels</option>
                      ${projectLabels.map(l => `<option value="${l}" ${kf.label === l ? 'selected' : ''}>#${l}</option>`).join('')}
                    </select>
                  </div>

                  <div class="col-span-2">
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Blocked reason</label>
                    <select onchange="setKanbanFilter('blocked_kind', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" ${kf.blocked_kind === 'ALL' ? 'selected' : ''}>Any reason</option>
                      <option value="waiting-human" ${kf.blocked_kind === 'waiting-human' ? 'selected' : ''}>Waiting on me</option>
                      <option value="waiting-task" ${kf.blocked_kind === 'waiting-task' ? 'selected' : ''}>Waiting on another task</option>
                      <option value="waiting-external" ${kf.blocked_kind === 'waiting-external' ? 'selected' : ''}>Waiting on external service</option>
                    </select>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Column Jump Pills + Swipe/Drag Hint -->
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              ${columns.map(col => {
                const colCount = filteredTasks.filter(t => t.status === col.id).length;
                return `
                  <button onclick="scrollToKanbanColumn('${col.id}')" class="tap-44 px-3 rounded-xl bg-recessed hover:bg-card border border-border font-mono text-xs font-bold text-ink flex items-center gap-1.5 shrink-0">
                    <span class="w-2 h-2 rounded-full ${col.dot}"></span>
                    <span>${col.title}</span>
                    <span class="text-muted">${colCount}</span>
                  </button>
                `;
              }).join('')}
            </div>
          </div>

          <div class="text-xs text-muted flex items-center justify-between px-0.5">
            <span><i class="ph-bold ph-arrows-left-right mr-1"></i>Scroll columns • Drag cards or swipe a card for quick actions</span>
          </div>

          <!-- Horizontal Kanban Board: One Column Per Status -->
          <div
            id="kanban-board-strip"
            data-scroll-id="kanban-board-horiz"
            class="flex gap-3 overflow-x-auto pb-3 pt-0.5 snap-x snap-mandatory no-scrollbar -mx-3.5 px-3.5"
          >
            ${columns.filter(c => kf.status === 'ALL' || kf.status === c.id).map(col => {
              const colTasks = filteredTasks.filter(t => t.status === col.id);
              return `
                <div
                  id="kanban-col-${col.id}"
                  data-col-status="${col.id}"
                  ondragover="handleKanbanDragOver(event)"
                  ondragleave="handleKanbanDragLeave(event)"
                  ondrop="handleKanbanDrop(event, '${col.id}')"
                  class="w-[85vw] max-w-[330px] shrink-0 snap-center hw-inset rounded-2xl p-2.5 flex flex-col gap-2.5 min-h-[420px] transition-colors"
                >
                  <!-- Column Header -->
                  <div class="flex items-center justify-between px-2 py-1 border-b border-border">
                    <div class="flex items-center gap-2">
                      <span class="w-2.5 h-2.5 rounded-full ${col.dot}"></span>
                      <h2 class="font-serif font-bold text-base text-ink">${col.title}</h2>
                    </div>
                    <span class="font-mono text-xs font-bold bg-card border border-border px-2 py-0.5 rounded-lg text-ink">
                      ${colTasks.length}
                    </span>
                  </div>

                  <!-- Column Cards -->
                  <div class="space-y-2.5 flex-1">
                    ${colTasks.length === 0 ? `
                      <div class="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted my-2">
                        Drop a card here or tap a status button to move tasks to <strong>${col.title}</strong>.
                      </div>
                    ` : colTasks.map(task => renderTaskCard(task)).join('')}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    export function scrollToKanbanColumn(colId) {
      const col = document.getElementById(`kanban-col-${colId}`);
      if (col) {
        col.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }


export { renderTaskCard, renderPriorityPill, renderStatusBadge };
