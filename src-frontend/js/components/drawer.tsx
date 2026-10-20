// Single-Scroll Document Page Task Drawer in hono/jsx
import { state, getTaskDraft, loadTaskDetail } from '../state.js';
import { api } from '../api.js';
import { showToast } from './toast.js';
import {
  escapeHtml,
  formatRelEpoch,
  getAgentStyle,
  formatBlockedReason,
  isTaskStale,
  isTaskOverdue,
  keepFieldAboveKeyboard,
} from '../utils.js';

export async function openTaskDrawer(taskId: number): Promise<void> {
  state.openTaskId = taskId;
  const task = state.tasks.find((t) => t.id === taskId);
  if (task) getTaskDraft(task);
  const drawer = document.getElementById('task-drawer');
  if (drawer) {
    drawer.classList.remove('hidden');
    drawer.classList.add('flex');
  }
  renderTaskDrawer(false);
  try {
    await loadTaskDetail(taskId);
    if (state.openTaskId === taskId) renderTaskDrawer(true);
  } catch (_e) {
    /* drawer shows what we have */
  }
}

export function closeTaskDrawer(): void {
  if (state.openTaskId) {
    void commitTaskDraftIfNeeded(state.openTaskId, true);
  }
  state.openTaskId = null;
  const drawer = document.getElementById('task-drawer');
  if (drawer) {
    drawer.classList.add('hidden');
    drawer.classList.remove('flex');
  }
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function updateTaskDraftField(taskId: number, field: string, value: string): void {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const draft = getTaskDraft(task);
  const draftRecord = draft as unknown as Record<string, unknown>;
  draftRecord[field] = value;
  if (field === 'title' || field === 'description' || field === 'notes') {
    draft.dirty = true;
    const badge = document.getElementById('drawer-draft-status');
    if (badge) {
      badge.textContent = 'Unsaved edits (auto-saved on close)';
      badge.className = 'font-mono text-[11px] text-amber-300';
    }
  }
}

export async function commitTaskDraftIfNeeded(taskId: number, silent = false): Promise<void> {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const draft = state.taskDrafts[taskId];
  if (!draft || !draft.dirty) return;

  const trimmedTitle = draft.title.trim();
  const payload: Record<string, string> = {};
  if (trimmedTitle) payload.title = trimmedTitle;
  payload.description = draft.description.trim() || '';
  payload.notes = draft.notes.trim() ? draft.notes : '';
  try {
    await api.put(`/admin/api/kanban/tasks/${taskId}`, payload);
  } catch (err) {
    showToast('Save failed', err instanceof Error ? err.message : String(err), 'red');
    return;
  }
  if (trimmedTitle) task.title = trimmedTitle;
  task.description = payload.description;
  task.notes = payload.notes;
  task.last_activity_at = Math.floor(Date.now() / 1000);
  draft.dirty = false;

  if (!silent) {
    showToast('Saved changes to task', task.title, 'green');
    renderTaskDrawer(true);
    if (window.renderMainViewport) window.renderMainViewport(true);
  }
}

export function renderTaskDrawer(preserveScroll = true): void {
  const task = state.tasks.find((t) => t.id === state.openTaskId);
  if (!task) return closeTaskDrawer();

  const draft = getTaskDraft(task);
  const proj = state.projects.find((p) => p.id === task.project_id);
  const stale = isTaskStale(task);
  const overdue = isTaskOverdue(task);
  const userComments = (task.comments || []).filter((c) => c.author !== 'system');
  const systemLogs = (task.comments || []).filter((c) => c.author === 'system');
  const inner = document.getElementById('task-drawer-inner');
  const scroller = document.getElementById('task-drawer-scroller');
  const prevScroll = preserveScroll && scroller ? scroller.scrollTop : 0;
  if (!inner) return;

  const html = (
    <div>
      {/* Sticky Drawer Top Bar */}
      <div class="bg-charcoal text-paper px-3.5 py-2.5 border-b-2 border-ink flex items-center justify-between gap-2 shrink-0">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs font-bold bg-paper text-ink px-2 py-0.5 rounded">Task #{task.id}</span>
            <span class="font-mono text-xs text-stone-300 truncate">{proj ? proj.title : ''}</span>
          </div>
          <div
            id="drawer-draft-status"
            class={`font-mono text-[11px] ${draft.dirty ? 'text-amber-300' : 'text-stone-400'} mt-0.5`}
          >
            {draft.dirty ? 'Unsaved edits in draft' : `Updated ${formatRelEpoch(task.updated_at)}`}
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          {task.status !== 'done' && (
            <button
              onclick={`quickCompleteTask(${task.id}, event); renderTaskDrawer(true);`}
              class="tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1"
            >
              <i class="ph-bold ph-check"></i>
              <span>Mark done</span>
            </button>
          )}
          <button
            onclick={`confirmDeleteTask(${task.id})`}
            class="tap-44 w-11 rounded-xl bg-black/40 text-stone-300 hover:bg-vermilion hover:text-white border border-white/15 flex items-center justify-center"
            title="Delete task"
          >
            <i class="ph-bold ph-trash text-base"></i>
          </button>
          <button
            onclick="closeTaskDrawer()"
            class="tap-44 px-3.5 rounded-xl bg-paper text-ink font-mono text-xs font-bold flex items-center gap-1"
          >
            <span>Close</span>
            <i class="ph-bold ph-x text-sm"></i>
          </button>
        </div>
      </div>

      {/* Single-Scroll Document Body */}
      <div id="task-drawer-scroller" class="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Blocked Alert Banner */}
        {task.status === 'blocked' && (
          <div class="caution-stripe-red border-2 border-ink rounded-2xl p-3.5 flex items-center justify-between gap-2">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-vermilion">
                Blocked • {formatBlockedReason(task.blocked_kind)}
              </div>
              <div class="text-xs text-ink mt-0.5">Blocked {formatRelEpoch(task.status_changed_at)}</div>
            </div>
            <button
              onclick={`openBlockedKindPicker(${task.id})`}
              class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl shrink-0"
            >
              Change reason
            </button>
          </div>
        )}

        {/* Stale Alert Banner */}
        {stale && (
          <div class="caution-stripe-amber border-2 border-ink rounded-2xl p-3.5 flex items-center justify-between gap-2">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-amber-950">Stale — Quiet for over 24 hours</div>
              <div class="text-xs text-ink mt-0.5">Last activity {formatRelEpoch(task.last_activity_at)}.</div>
            </div>
            <button
              onclick={`touchTaskActivity(${task.id})`}
              class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-3 rounded-xl shrink-0"
            >
              Nudge / Touch
            </button>
          </div>
        )}

        {/* 1. DOCUMENT HEADER */}
        <section class="hw-card rounded-2xl p-4 space-y-3 bg-card">
          <div>
            <label class="block font-mono text-xs font-bold uppercase text-muted mb-1">Task Title</label>
            <input
              id="edit-task-title"
              type="text"
              value={draft.title}
              oninput={`updateTaskDraftField(${task.id}, 'title', this.value)`}
              onfocus="keepFieldAboveKeyboard(this)"
              class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-serif font-bold text-ink focus:outline-none"
            />
          </div>
          <div>
            <label class="block font-mono text-xs font-bold uppercase text-muted mb-1">Short Summary</label>
            <textarea
              id="edit-task-desc"
              rows={2}
              placeholder="Brief one-line context shown on board cards..."
              oninput={`updateTaskDraftField(${task.id}, 'description', this.value)`}
              onfocus="keepFieldAboveKeyboard(this)"
              class="w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none"
            >
              {draft.description}
            </textarea>
          </div>
        </section>

        {/* 2. PROPERTIES TABLE */}
        <section class="hw-card rounded-2xl p-4 space-y-3.5 bg-card">
          <div class="font-mono text-xs font-bold uppercase tracking-wider text-muted">Properties</div>
          <div>
            <label class="block font-mono text-xs text-muted mb-1.5">Status</label>
            <div class="grid grid-cols-4 gap-1.5">
              {[
                { id: 'todo', label: 'To Do' },
                { id: 'doing', label: 'Doing' },
                { id: 'blocked', label: 'Blocked' },
                { id: 'done', label: 'Done' },
              ].map((st) => {
                const isCurrent = task.status === st.id;
                const activeStyle =
                  st.id === 'blocked'
                    ? 'bg-vermilion text-white border-ink shadow-[0_2px_0_#161615] cursor-default'
                    : 'bg-ink text-paper border-ink shadow-[0_2px_0_#161615] cursor-default';
                return (
                  <button
                    onclick={`requestTaskStatusChange(${task.id}, '${st.id}')`}
                    class={`tap-44 rounded-xl font-mono text-xs font-bold border-1.5 transition ${
                      isCurrent ? activeStyle : 'bg-recessed text-ink border-border'
                    }`}
                  >
                    {st.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block font-mono text-xs text-muted mb-1">Assignee</label>
              <select
                onchange={`manualAssignTask(${task.id}, this.value)`}
                class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans font-bold text-ink"
              >
                <option value="" selected={!task.assignee}>
                  Unassigned
                </option>
                {state.agents.map((a) => (
                  <option value={a.agent} selected={task.assignee === a.agent}>
                    @{a.agent}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label class="block font-mono text-xs text-muted mb-1">Priority</label>
              <select
                onchange={`updateTaskPriority(${task.id}, this.value)`}
                class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans font-bold text-ink"
              >
                <option value="low" selected={task.priority === 'low'}>
                  Low
                </option>
                <option value="normal" selected={task.priority === 'normal'}>
                  Normal
                </option>
                <option value="urgent" selected={task.priority === 'urgent'}>
                  Urgent
                </option>
              </select>
            </div>
          </div>

          {/* Due Date Presets */}
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="font-mono text-xs text-muted">
                Due Date {overdue ? <strong class="text-vermilion">(Overdue)</strong> : ''}
              </label>
              <span class="font-mono text-xs font-bold text-ink">
                {task.due_at ? `Due ${formatRelEpoch(task.due_at)}` : 'No due date'}
              </span>
            </div>
            <div class="grid grid-cols-4 gap-1.5">
              <button
                onclick={`setTaskDueOffset(${task.id}, -7200)`}
                class="tap-44 px-2 rounded-xl bg-rose-100 text-rose-900 border border-rose-400 font-mono text-xs font-bold"
              >
                2h ago
              </button>
              <button
                onclick={`setTaskDueOffset(${task.id}, 14400)`}
                class="tap-44 px-2 rounded-xl bg-recessed text-ink border border-border font-mono text-xs font-bold"
              >
                In 4h
              </button>
              <button
                onclick={`setTaskDueOffset(${task.id}, 86400)`}
                class="tap-44 px-2 rounded-xl bg-recessed text-ink border border-border font-mono text-xs font-bold"
              >
                Tomorrow
              </button>
              <button
                onclick={`setTaskDueOffset(${task.id}, null)`}
                class="tap-44 px-2 rounded-xl bg-recessed text-muted border border-border font-mono text-xs font-bold"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Labels */}
          <div class="pt-1 border-t border-border space-y-2">
            <label class="block font-mono text-xs text-muted">Labels</label>
            <div class="flex flex-wrap gap-1.5">
              {(task.labels || []).length === 0 && <span class="text-sm text-muted">No labels yet</span>}
              {(task.labels || []).map((lbl) => (
                <span class="font-mono text-xs bg-recessed border border-ink pl-2.5 pr-1 py-1 rounded-xl font-bold flex items-center gap-1">
                  #{escapeHtml(lbl)}
                  <button
                    onclick={`removeTaskLabel(${task.id}, '${escapeHtml(lbl)}')`}
                    class="tap-44 w-9 h-9 rounded-lg text-muted hover:text-vermilion flex items-center justify-center"
                    title="Remove label"
                  >
                    <i class="ph-bold ph-x"></i>
                  </button>
                </span>
              ))}
            </div>
            <form onsubmit={`addTaskLabel(event, ${task.id})`} class="flex gap-2">
              <input
                id="new-label-input"
                type="text"
                onfocus="keepFieldAboveKeyboard(this)"
                placeholder="Add label (e.g. security, spec)..."
                class="tap-44 flex-1 hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none"
              />
              <button
                type="submit"
                class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-4 rounded-xl"
              >
                Add
              </button>
            </form>
          </div>
        </section>

        {/* 3. DOCUMENT BODY */}
        <section class="hw-card rounded-2xl p-4 space-y-3 bg-card">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-forest">Document Notes</div>
              <h3 class="font-serif font-bold text-lg text-ink">Specification &amp; Working Notes</h3>
            </div>
            {task.notes && (
              <button
                onclick={`clearTaskNotes(${task.id})`}
                class="tap-44 px-2.5 font-mono text-xs text-muted hover:text-vermilion underline"
              >
                Clear notes
              </button>
            )}
          </div>
          <p class="text-xs text-muted leading-relaxed">
            Shared working document for you and {task.assignee ? '@' + task.assignee : 'the assigned agent'}. Separate
            from the discussion thread below.
          </p>
          <textarea
            id="task-notes-editor"
            rows={8}
            oninput={`updateTaskDraftField(${task.id}, 'notes', this.value)`}
            onfocus="keepFieldAboveKeyboard(this)"
            placeholder="Write specifications, checklists, runbooks, or findings..."
            class="w-full hw-inset rounded-xl p-3 font-mono text-sm text-ink leading-relaxed focus:outline-none"
          >
            {draft.notes}
          </textarea>

          <button
            onclick={`commitTaskDraftIfNeeded(${task.id}, false)`}
            class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
          >
            <i class="ph-bold ph-floppy-disk text-base"></i>
            <span>Save Title, Summary &amp; Notes</span>
          </button>
        </section>

        {/* 4. CHECKLIST */}
        <section class="hw-card rounded-2xl p-4 space-y-3 bg-card">
          <div class="flex items-center justify-between">
            <span class="font-serif font-bold text-lg text-ink">Checklist</span>
            <span class="font-mono text-xs font-bold bg-recessed px-2.5 py-1 rounded-lg border border-border text-ink">
              {(task.todos || []).filter((td) => td.done === 1).length} of {(task.todos || []).length} complete
            </span>
          </div>

          <div class="space-y-2">
            {(task.todos || []).length === 0 ? (
              <div class="text-sm text-muted py-2">No checklist steps added yet.</div>
            ) : (
              task.todos.map((td) => (
                <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-recessed border border-border">
                  <button
                    onclick={`toggleTodoItem(${task.id}, ${td.id})`}
                    class="tap-44 flex items-center gap-3 text-left flex-1 min-w-0 py-1 px-1"
                  >
                    <span
                      class={`w-6 h-6 rounded-lg border-1.5 border-ink flex items-center justify-center shrink-0 ${
                        td.done ? 'bg-forest text-white' : 'bg-card'
                      }`}
                    >
                      {td.done ? <i class="ph-bold ph-check text-sm"></i> : null}
                    </span>
                    <span class={`text-sm font-medium ${td.done ? 'line-through text-muted' : 'text-ink'} break-words`}>
                      {td.text}
                    </span>
                  </button>
                  <button
                    onclick={`deleteTodoItem(${task.id}, ${td.id})`}
                    class="tap-44 w-11 rounded-xl text-muted hover:text-vermilion flex items-center justify-center shrink-0"
                    title="Delete checklist item"
                  >
                    <i class="ph-bold ph-trash text-base"></i>
                  </button>
                </div>
              ))
            )}
          </div>

          <form onsubmit={`addTodoItem(event, ${task.id})`} class="flex gap-2 pt-1">
            <input
              id="new-todo-input"
              type="text"
              onfocus="keepFieldAboveKeyboard(this)"
              placeholder="Add a checklist step..."
              class="tap-44 flex-1 hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none"
            />
            <button type="submit" class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-4 rounded-xl">
              Add
            </button>
          </form>
        </section>

        {/* 5. DISCUSSION THREAD */}
        <section class="hw-card rounded-2xl p-4 space-y-3.5 bg-card">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-forest">Discussion</div>
              <h3 class="font-serif font-bold text-lg text-ink">Comments ({userComments.length})</h3>
            </div>
            <span class="font-mono text-[11px] text-muted">Permanent audit history</span>
          </div>

          <div class="space-y-2.5">
            {userComments.length === 0 ? (
              <div class="hw-inset rounded-xl p-4 text-center text-sm text-muted">
                No comments yet. Leave guidance for your agents below.
              </div>
            ) : (
              userComments.map((c) => {
                const displayAuthor = c.author === 'admin' ? 'luki' : c.author;
                const st = getAgentStyle(displayAuthor);
                return (
                  <div class="p-3 rounded-xl bg-recessed border border-border space-y-1.5">
                    <div class="flex items-center justify-between">
                      <span class={`font-mono text-xs font-bold ${st.bg} ${st.text} border ${st.border} px-2 py-0.5 rounded-md`}>
                        @{displayAuthor}
                      </span>
                      <span class="font-mono text-xs text-muted">{formatRelEpoch(c.ts)}</span>
                    </div>
                    <p class="text-sm text-ink leading-relaxed whitespace-pre-wrap">{c.body}</p>
                  </div>
                );
              })
            )}
          </div>

          <form onsubmit={`postTaskComment(event, ${task.id})`} class="space-y-2.5 pt-2 border-t border-border">
            <textarea
              id="new-comment-body"
              rows={2}
              oninput={`updateTaskDraftField(${task.id}, 'commentDraft', this.value)`}
              onfocus="keepFieldAboveKeyboard(this)"
              placeholder="Write a comment as @luki..."
              class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none"
            >
              {draft.commentDraft || ''}
            </textarea>
            <button
              type="submit"
              class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
            >
              <i class="ph-bold ph-paper-plane-right text-base"></i>
              <span>Post Comment</span>
            </button>
          </form>
        </section>

        {/* 6. SEPARATE ACTIVITY LOG */}
        <section class="hw-inset rounded-2xl p-3.5 space-y-2">
          <div class="font-mono text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
            <i class="ph-bold ph-clock-counter-clockwise"></i> Activity History
          </div>
          {systemLogs.length === 0 ? (
            <div class="text-xs text-muted">No status transitions recorded yet.</div>
          ) : (
            systemLogs.map((s) => (
              <div class="text-xs text-muted flex items-center justify-between gap-2 py-1 border-b border-border/60 last:border-none">
                <span>• {s.body}</span>
                <span class="font-mono shrink-0">{formatRelEpoch(s.ts)}</span>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );

  inner.innerHTML = String(html);

  if (preserveScroll) {
    const nextScroller = document.getElementById('task-drawer-scroller');
    if (nextScroller) nextScroller.scrollTop = prevScroll;
  }
}

// Window global bindings for inline handlers
const win = window as unknown as Record<string, unknown>;
win.openTaskDrawer = openTaskDrawer;
win.closeTaskDrawer = closeTaskDrawer;
win.updateTaskDraftField = updateTaskDraftField;
win.commitTaskDraftIfNeeded = commitTaskDraftIfNeeded;
win.renderTaskDrawer = renderTaskDrawer;
win.keepFieldAboveKeyboard = keepFieldAboveKeyboard;
