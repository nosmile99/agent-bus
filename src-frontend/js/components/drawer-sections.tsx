import { escapeHtml, formatRelEpoch, getAgentStyle, keepFieldAboveKeyboard } from '../utils.js';
import type { FrontendTask, FrontendComment, TaskDraft } from '../types.js';

export function DrawerNotesSection({ task, draft }: { task: FrontendTask; draft: TaskDraft }) {
  return (
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
  );
}

export function DrawerChecklistSection({ task }: { task: FrontendTask }) {
  const completedCount = (task.todos || []).filter((td) => td.done === 1).length;
  const totalCount = (task.todos || []).length;

  return (
    <section class="hw-card rounded-2xl p-4 space-y-3 bg-card">
      <div class="flex items-center justify-between">
        <span class="font-serif font-bold text-lg text-ink">Checklist</span>
        <span class="font-mono text-xs font-bold bg-recessed px-2.5 py-1 rounded-lg border border-border text-ink">
          {completedCount} of {totalCount} complete
        </span>
      </div>

      <div class="space-y-2">
        {totalCount === 0 ? (
          <div class="text-sm text-muted py-2">No checklist steps added yet.</div>
        ) : (
          task.todos.map((td) => (
            <div key={td.id} class="flex items-center justify-between gap-2 p-2 rounded-xl bg-recessed border border-border">
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
  );
}

export function DrawerCommentsSection({
  task,
  draft,
  userComments
}: {
  task: FrontendTask;
  draft: TaskDraft;
  userComments: FrontendComment[];
}) {
  return (
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
              <div key={c.id} class="p-3 rounded-xl bg-recessed border border-border space-y-1.5">
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
  );
}

export function DrawerTimelineSection({ systemLogs }: { systemLogs: FrontendComment[] }) {
  return (
    <section class="hw-inset rounded-2xl p-3.5 space-y-2">
      <div class="font-mono text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
        <i class="ph-bold ph-clock-counter-clockwise"></i> Activity History
      </div>
      {systemLogs.length === 0 ? (
        <div class="text-xs text-muted">No status transitions recorded yet.</div>
      ) : (
        systemLogs.map((s) => (
          <div key={s.id} class="text-xs text-muted flex items-center justify-between gap-2 py-1 border-b border-border/60 last:border-none">
            <span>• {s.body}</span>
            <span class="font-mono shrink-0">{formatRelEpoch(s.ts)}</span>
          </div>
        ))
      )}
    </section>
  );
}
