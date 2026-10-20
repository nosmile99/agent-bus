import { state, loadAll, refreshTasks } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { showCustomModal, closeTopModal } from '../components/modal.js';
import { closeTaskDrawer } from '../components/drawer.js';
import { escapeHtml } from '../utils.js';

/********************************************************************
 * KANBAN MODALS & TASK DETAIL ACTIONS (Create, Edit, Delete, Todos, Comments)
 ********************************************************************/

    export async export function clearTaskNotes(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.put('/admin/api/kanban/tasks/' + taskId, { notes: '' });
      } catch (_e) {
        showToast('Clear failed', _e.message, 'red');
        return;
      }
      task.notes = '';
      const draft = getTaskDraft(task);
      draft.notes = '';
      draft.dirty = false;
      task.last_activity_at = new Date().toISOString();
      showToast('Cleared document notes');
      if (state.openTaskId === taskId) if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export async export function addTaskLabel(e, taskId) {
      e.preventDefault();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const input = document.getElementById('new-label-input');
      const raw = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!raw) return;
      if (!task.labels.includes(raw)) {
        try {
          await api.post(`/admin/api/kanban/tasks/${taskId}/labels`, { label: raw });
        } catch (err) {
          showToast('Add label failed', err.message, 'red');
          return;
        }
        task.labels.push(raw);
        task.last_activity_at = new Date().toISOString();
        showToast(`Added label #${raw}`);
      }
      if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export async export function removeTaskLabel(taskId, label) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.del(`/admin/api/kanban/tasks/${taskId}/labels/${encodeURIComponent(label)}`);
      } catch (err) {
        showToast('Remove label failed', err.message, 'red');
        return;
      }
      task.labels = task.labels.filter(l => l !== label);
      task.last_activity_at = new Date().toISOString();
      showToast(`Removed #${label}`);
      if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export async export function toggleTodoItem(taskId, todoId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const todo = task.todos.find(td => td.id === todoId);
      if (!todo) return;
      const newDone = todo.done === 1 ? 0 : 1;
      try {
        await api.put(`/admin/api/kanban/tasks/${taskId}/todos/${todoId}`, { done: newDone });
      } catch (err) {
        showToast('Todo update failed', err.message, 'red');
        return;
      }
      todo.done = newDone;
      task.last_activity_at = new Date().toISOString();
      if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export async export function addTodoItem(e, taskId) {
      e.preventDefault();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const input = document.getElementById('new-todo-input');
      const text = input.value.trim();
      if (!text) {
        showToast('Please enter checklist text', '', 'red');
        return;
      }
      let newTodo = null;
      try {
        newTodo = await api.post(`/admin/api/kanban/tasks/${taskId}/todos`, { text });
      } catch (err) {
        showToast('Add todo failed', err.message, 'red');
        return;
      }
      task.todos.push({
        id: newTodo.id || newTodo.todo?.id,
        task_id: task.id,
        text,
        done: 0,
        sort_order: task.todos.length
      });
      task.last_activity_at = new Date().toISOString();
      showToast('Added checklist step');
      if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export async export function deleteTodoItem(taskId, todoId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.del(`/admin/api/kanban/tasks/${taskId}/todos/${todoId}`);
      } catch (err) {
        showToast('Delete todo failed', err.message, 'red');
        return;
      }
      task.todos = task.todos.filter(td => td.id !== todoId);
      task.last_activity_at = new Date().toISOString();
      if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export async export function postTaskComment(e, taskId) {
      e.preventDefault();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const input = document.getElementById('new-comment-body');
      const body = input.value.trim();
      if (!body) return;
      let saved = null;
      try {
        saved = await api.post(`/admin/api/kanban/tasks/${taskId}/comments`, { body });
      } catch (err) {
        showToast('Comment failed', err.message, 'red');
        return;
      }
      task.comments.push({
        id: saved.id || saved.comment?.id,
        task_id: task.id,
        author: 'luki',
        body,
        ts: new Date().toISOString()
      });
      const draft = getTaskDraft(task);
      draft.commentDraft = '';
      task.last_activity_at = new Date().toISOString();
      showToast('Comment posted');
      if (window.renderTaskDrawer) window.renderTaskDrawer(true);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function confirmDeleteTask(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      showCustomModal(`
        <div class="p-4 space-y-4">
          <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Task</div>
          <h3 class="font-serif font-bold text-lg text-ink">Delete Task #${task.id}?</h3>
          <p class="text-sm text-muted">
            This permanently deletes <strong>"${escapeHtml(task.title)}"</strong> and its ${(task.todos || []).length} checklist steps.
          </p>
          <div class="flex gap-2">
            <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
            <button onclick="executeDeleteTask(${task.id})" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete Task</button>
          </div>
        </div>
      `);
    }

    export async export function executeDeleteTask(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.del(`/admin/api/kanban/tasks/${taskId}`);
      } catch (err) {
        showToast('Delete failed', err.message, 'red');
        return;
      }
      state.tasks = state.tasks.filter(t => t.id !== taskId);
      delete state.taskDrafts[taskId];
      closeTopModal();
      state.openTaskId = null;
      const drawer = document.getElementById('task-drawer');
      drawer.classList.add('hidden');
      drawer.classList.remove('flex');
      showToast(`Deleted Task #${taskId}`);
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function openCreateTaskModal() {
      const proj = state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
      showCustomModal(`
        <form onsubmit="executeCreateTask(event)" class="p-4 space-y-3.5">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-muted">${escapeHtml(proj.title)}</div>
              <h3 class="font-serif font-bold text-lg text-ink">New Task</h3>
            </div>
            <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Title</label>
            <input id="create-task-title" type="text" required placeholder="What needs to be done?" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-bold text-ink focus:outline-none" />
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Summary (optional)</label>
            <input id="create-task-desc" type="text" placeholder="Short context..." class="tap-44 w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block font-mono text-xs font-bold text-muted mb-1">Priority</label>
              <select id="create-task-priority" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans text-ink">
                <option value="normal" selected>Normal</option>
                <option value="urgent">Urgent</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label class="block font-mono text-xs font-bold text-muted mb-1">Assignee</label>
              <select id="create-task-assignee" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans text-ink">
                <option value="">Unassigned</option>
                ${state.agents.map(a => `<option value="${a.agent}">@${a.agent}</option>`).join('')}
              </select>
            </div>
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Labels (comma-separated)</label>
            <input id="create-task-labels" type="text" placeholder="spec, storage" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none" />
          </div>

          <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
            Create Task
          </button>
        </form>
      `);
    }

    export async export function executeCreateTask(e) {
      e.preventDefault();
      const title = document.getElementById('create-task-title').value.trim();
      const desc = document.getElementById('create-task-desc').value.trim();
      const assigneeVal = document.getElementById('create-task-assignee').value || null;
      const rawLabels = document.getElementById('create-task-labels').value;
      const labels = rawLabels
        .split(',')
        .map(s => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
        .filter(Boolean);

      let created = null;
      try {
        created = await api.post(`/admin/api/kanban/projects/${state.activeProjectId}/tasks`, {
          title, description: desc, assignee: assigneeVal, labels,
        });
      } catch (err) {
        showToast('Create failed', err.message, 'red');
        return;
      }
      const newTask = {
        id: created.id || created.task?.id,
        project_id: state.activeProjectId,
        title,
        description: desc || '',
        notes: '',
        status: 'todo',
        blocked_kind: null,
        assignee: assigneeVal,
        labels,
        todos: [],
        comments: [],
        comment_count: 0,
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      };

      state.tasks.unshift(newTask);
      closeTopModal();
      showToast(`Created Task #${newTask.id}`, title, 'green');
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function openProjectModal(projId) {
      const proj = projId ? state.projects.find(p => p.id === projId) : null;
      const subs = proj ? (proj.subscribers || []) : [];

      showCustomModal(`
        <form onsubmit="saveProjectModal(event, ${proj ? proj.id : 'null'})" class="p-4 space-y-3.5">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-muted">
                ${proj ? 'Project Settings' : 'New Project'}
              </div>
              <h3 class="font-serif font-bold text-lg text-ink">
                ${proj ? 'Edit Project & Agent Access' : 'Create Kanban Project'}
              </h3>
            </div>
            <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Project Title</label>
            <input id="proj-modal-title" type="text" required value="${escapeHtml(proj ? proj.title : '')}" placeholder="Project title..." class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-bold text-ink" />
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Description</label>
            <textarea id="proj-modal-desc" rows="2" class="w-full hw-inset rounded-xl px-3 py-2 text-ink">${escapeHtml(proj && proj.description ? proj.description : '')}</textarea>
          </div>

          <!-- Project Subscribers -->
          <div class="hw-inset rounded-xl p-3.5 space-y-2">
            <div class="font-mono text-xs font-bold uppercase text-ink">
              Subscribed Agents
            </div>
            <p class="text-xs text-muted leading-snug">
              Leave all unchecked so every agent can view and claim tasks. Or select specific agents to restrict access.
            </p>
            <div class="grid grid-cols-3 gap-2 pt-1">
              ${state.agents.map(a => `
                <label class="tap-44 flex items-center gap-2 p-2.5 rounded-xl bg-card border border-border cursor-pointer font-mono text-xs font-bold">
                  <input type="checkbox" name="proj-sub" value="${a.agent}" ${subs.includes(a.agent) ? 'checked' : ''} class="accent-ink w-4 h-4" />
                  <span>@${a.agent}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="flex gap-2 pt-1">
            ${proj && state.projects.length > 1 ? `
              <button type="button" onclick="deleteProject(${proj.id})" class="hw-btn tap-44 bg-rose-100 text-vermilion font-mono text-xs font-bold px-3.5 rounded-xl">
                Delete
              </button>
            ` : ''}
            <button type="submit" class="hw-btn tap-44 flex-1 bg-ink text-paper font-mono text-xs font-bold py-2.5 rounded-xl">
              ${proj ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      `);
    }

    export async export function saveProjectModal(e, projId) {
      e.preventDefault();
      const title = document.getElementById('proj-modal-title').value.trim();
      const desc = document.getElementById('proj-modal-desc').value.trim();
      const checked = Array.from(document.querySelectorAll('input[name="proj-sub"]:checked')).map(el => el.value);

      if (!title) return;

      try {
        if (projId) {
          await api.put(`/admin/api/kanban/projects/${projId}`, { title, description: desc, subscribers: checked });
          const proj = state.projects.find(p => p.id === projId);
          if (proj) {
            proj.title = title;
            proj.description = desc || '';
            proj.subscribers = checked;
            showToast(`Updated ${proj.title}`, checked.length ? `Access: ${checked.join(', ')}` : 'Open to all agents');
          }
        } else {
          const created = await api.post('/admin/api/kanban/projects', { title, description: desc, subscribers: checked });
          const newProj = {
            id: created.id || created.project?.id,
            title, description: desc || '',
            archived: false, subscribers: checked,
          };
          state.projects.push(newProj);
          state.activeProjectId = newProj.id;
          await refreshTasks();
          showToast(`Created ${newProj.title}`, '', 'green');
        }
      } catch (err) {
        showToast('Project save failed', err.message, 'red');
        return;
      }

      closeTopModal();
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export async export function deleteProject(projId) {
      const proj = state.projects.find(p => p.id === projId);
      try {
        await api.del(`/admin/api/kanban/projects/${projId}`);
      } catch (err) {
        showToast('Delete failed', err.message, 'red');
        return;
      }
      state.projects = state.projects.filter(p => p.id !== projId);
      state.tasks = state.tasks.filter(t => t.project_id !== projId);
      state.activeProjectId = state.projects.length ? state.projects[0].id : null;
      await refreshTasks();
      closeTopModal();
      showToast(`Deleted project`, proj ? proj.title : '', 'red');
      renderMainViewport(false);
    }

