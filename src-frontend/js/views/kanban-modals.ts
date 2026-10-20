import { state, refreshTasks, getTaskDraft } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { showCustomModal, closeTopModal } from '../components/modal.js';
import { escapeHtml } from '../utils.js';
import { FrontendTask, FrontendTodo, FrontendComment, FrontendProject } from '../types.js';

/********************************************************************
 * KANBAN MODALS & TASK DETAIL ACTIONS (Create, Edit, Delete, Todos, Comments)
 ********************************************************************/

export async function clearTaskNotes(taskId: number): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  try {
    await api.put('/admin/api/kanban/tasks/' + taskId, { notes: '' });
  } catch (_e) {
    const errorMsg = _e instanceof Error ? _e.message : String(_e);
    showToast('Clear failed', errorMsg, 'red');
    return;
  }
  task.notes = '';
  const draft = getTaskDraft(task);
  draft.notes = '';
  draft.dirty = false;
  task.last_activity_at = Math.floor(Date.now() / 1000);
  showToast('Cleared document notes');
  if (state.openTaskId === taskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export async function addTaskLabel(e: Event, taskId: number): Promise<void> {
  e.preventDefault();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const input = document.getElementById('new-label-input') as HTMLInputElement | null;
  const raw = input ? input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
  if (!raw) return;
  if (!task.labels.includes(raw)) {
    try {
      await api.post(`/admin/api/kanban/tasks/${taskId}/labels`, { label: raw });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast('Add label failed', errorMsg, 'red');
      return;
    }
    task.labels.push(raw);
    task.last_activity_at = Math.floor(Date.now() / 1000);
    showToast(`Added label #${raw}`);
  }
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export async function removeTaskLabel(taskId: number, label: string): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  try {
    await api.del(`/admin/api/kanban/tasks/${taskId}/labels/${encodeURIComponent(label)}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Remove label failed', errorMsg, 'red');
    return;
  }
  task.labels = task.labels.filter(l => l !== label);
  task.last_activity_at = Math.floor(Date.now() / 1000);
  showToast(`Removed #${label}`);
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export async function toggleTodoItem(taskId: number, todoId: number): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const todo = task.todos.find(td => td.id === todoId);
  if (!todo) return;
  const newDone = todo.done === 1 ? 0 : 1;
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}/todos/${todoId}`, { done: newDone });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Todo update failed', errorMsg, 'red');
    return;
  }
  todo.done = newDone;
  task.last_activity_at = Math.floor(Date.now() / 1000);
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export async function addTodoItem(e: Event, taskId: number): Promise<void> {
  e.preventDefault();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const input = document.getElementById('new-todo-input') as HTMLInputElement | null;
  const text = input ? input.value.trim() : '';
  if (!text) {
    showToast('Please enter checklist text', '', 'red');
    return;
  }
  let newTodo: { id?: number; todo?: { id: number } } | null = null;
  try {
    newTodo = await api.post<{ id?: number; todo?: { id: number } }>(`/admin/api/kanban/tasks/${taskId}/todos`, { text });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Add todo failed', errorMsg, 'red');
    return;
  }
  task.todos.push({
    id: newTodo.id || newTodo.todo?.id || Date.now(),
    task_id: task.id,
    text,
    done: 0,
    sort_order: task.todos.length
  });
  task.last_activity_at = Math.floor(Date.now() / 1000);
  showToast('Added checklist step');
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export async function deleteTodoItem(taskId: number, todoId: number): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  try {
    await api.del(`/admin/api/kanban/tasks/${taskId}/todos/${todoId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Delete todo failed', errorMsg, 'red');
    return;
  }
  task.todos = task.todos.filter(td => td.id !== todoId);
  task.last_activity_at = Math.floor(Date.now() / 1000);
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export async function postTaskComment(e: Event, taskId: number): Promise<void> {
  e.preventDefault();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const input = document.getElementById('new-comment-body') as HTMLTextAreaElement | null;
  const body = input ? input.value.trim() : '';
  if (!body) return;
  let saved: { id?: number; comment?: { id: number } } | null = null;
  try {
    saved = await api.post<{ id?: number; comment?: { id: number } }>(`/admin/api/kanban/tasks/${taskId}/comments`, { body });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Comment failed', errorMsg, 'red');
    return;
  }
  task.comments.push({
    id: saved.id || saved.comment?.id || Date.now(),
    task_id: task.id,
    author: 'luki',
    body,
    ts: Math.floor(Date.now() / 1000)
  });
  const draft = getTaskDraft(task);
  draft.commentDraft = '';
  task.last_activity_at = Math.floor(Date.now() / 1000);
  showToast('Comment posted');
  if (window.renderTaskDrawer) window.renderTaskDrawer(true);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function confirmDeleteTask(taskId: number): void {
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

export async function executeDeleteTask(taskId: number): Promise<void> {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  try {
    await api.del(`/admin/api/kanban/tasks/${taskId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Delete failed', errorMsg, 'red');
    return;
  }
  state.tasks = state.tasks.filter(t => t.id !== taskId);
  delete state.taskDrafts[taskId];
  closeTopModal();
  state.openTaskId = null;
  const drawer = document.getElementById('task-drawer');
  if (drawer) {
    drawer.classList.add('hidden');
    drawer.classList.remove('flex');
  }
  showToast(`Deleted Task #${taskId}`);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function openCreateTaskModal(): void {
  const proj = state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
  const title = proj ? proj.title : 'Project';
  showCustomModal(`
    <form onsubmit="executeCreateTask(event)" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">${escapeHtml(title)}</div>
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

export async function executeCreateTask(e: Event): Promise<void> {
  e.preventDefault();
  const titleInput = document.getElementById('create-task-title') as HTMLInputElement | null;
  const descInput = document.getElementById('create-task-desc') as HTMLInputElement | null;
  const assigneeSelect = document.getElementById('create-task-assignee') as HTMLSelectElement | null;
  const labelsInput = document.getElementById('create-task-labels') as HTMLInputElement | null;

  const title = titleInput ? titleInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';
  const assigneeVal = assigneeSelect && assigneeSelect.value ? assigneeSelect.value : null;
  const rawLabels = labelsInput ? labelsInput.value : '';
  const labels = rawLabels
    .split(',')
    .map(s => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
    .filter(Boolean);

  let created: { id?: number; task?: { id: number } } | null = null;
  try {
    created = await api.post<{ id?: number; task?: { id: number } }>(`/admin/api/kanban/projects/${state.activeProjectId}/tasks`, {
      title, description: desc, assignee: assigneeVal, labels,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Create failed', errorMsg, 'red');
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const newTask: FrontendTask = {
    id: created.id || created.task?.id || Date.now(),
    project_id: state.activeProjectId || 1,
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
    created_at: now,
    updated_at: now,
    last_activity_at: now,
    created_by: 'luki',
    claimed_at: null
  };

  state.tasks.unshift(newTask);
  closeTopModal();
  showToast(`Created Task #${newTask.id}`, title, 'green');
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function openProjectModal(projId: number | null): void {
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

export async function saveProjectModal(e: Event, projId: number | null): Promise<void> {
  e.preventDefault();
  const titleInput = document.getElementById('proj-modal-title') as HTMLInputElement | null;
  const descInput = document.getElementById('proj-modal-desc') as HTMLTextAreaElement | null;
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="proj-sub"]:checked')).map(el => el.value);

  const title = titleInput ? titleInput.value.trim() : '';
  const desc = descInput ? descInput.value.trim() : '';

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
      const created = await api.post<{ id?: number; project?: { id: number } }>('/admin/api/kanban/projects', { title, description: desc, subscribers: checked });
      const newProj: FrontendProject = {
        id: created.id || created.project?.id || Date.now(),
        title,
        description: desc || '',
        archived: false,
        subscribers: checked,
      };
      state.projects.push(newProj);
      state.activeProjectId = newProj.id;
      await refreshTasks();
      showToast(`Created ${newProj.title}`, '', 'green');
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Project save failed', errorMsg, 'red');
    return;
  }

  closeTopModal();
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export async function deleteProject(projId: number): Promise<void> {
  const proj = state.projects.find(p => p.id === projId);
  try {
    await api.del(`/admin/api/kanban/projects/${projId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Delete failed', errorMsg, 'red');
    return;
  }
  state.projects = state.projects.filter(p => p.id !== projId);
  state.tasks = state.tasks.filter(t => t.project_id !== projId);
  state.activeProjectId = state.projects.length && state.projects[0] ? state.projects[0].id : null;
  await refreshTasks();
  closeTopModal();
  showToast(`Deleted project`, proj ? proj.title : '', 'red');
  if (window.renderMainViewport) window.renderMainViewport(false);
}

// Window globals
const win = window as unknown as Record<string, unknown>;
win.clearTaskNotes = clearTaskNotes;
win.addTaskLabel = addTaskLabel;
win.removeTaskLabel = removeTaskLabel;
win.toggleTodoItem = toggleTodoItem;
win.addTodoItem = addTodoItem;
win.deleteTodoItem = deleteTodoItem;
win.postTaskComment = postTaskComment;
win.confirmDeleteTask = confirmDeleteTask;
win.executeDeleteTask = executeDeleteTask;
win.openCreateTaskModal = openCreateTaskModal;
win.executeCreateTask = executeCreateTask;
win.openProjectModal = openProjectModal;
win.saveProjectModal = saveProjectModal;
win.deleteProject = deleteProject;
