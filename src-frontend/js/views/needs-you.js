import { state, getWaitingHumanTasks } from '../state.js';
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
     * 5. VIEW 1: "NEEDS YOU" (Cross-Project Operator Queue + Deduplicated Radar)
     ********************************************************************/
    export function renderNeedsYouView() {
      const waitingTasks = getWaitingHumanTasks();

      // Deduplicated Radar: tasks that are stale OR overdue (excluding ones already in waitingTasks above)
      const waitingIds = new Set(waitingTasks.map(t => t.id));
      const radarTasks = state.tasks.filter(t => {
        if (waitingIds.has(t.id)) return false;
        return isTaskStale(t) || isTaskOverdue(t);
      });

      return `
        <div class="p-3.5 space-y-4">
          <!-- Masthead -->
          <div class="hw-card rounded-2xl p-3.5 bg-card">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="font-mono text-[11px] uppercase tracking-wider text-vermilion font-bold">
                  Action Required Across All Projects
                </div>
                <h1 class="font-serif text-2xl font-bold text-ink leading-tight mt-0.5">
                  Needs You (${waitingTasks.length})
                </h1>
              </div>
              <span class="font-mono text-[11px] bg-recessed text-ink border border-border px-2.5 py-1 rounded-lg font-bold">
                Oldest First
              </span>
            </div>
            <p class="text-sm text-muted mt-1.5 leading-relaxed">
              Tasks where an agent is paused waiting on your decision or sign-off, ordered by how long they have been waiting.
            </p>
          </div>

          <!-- Waiting on Human List -->
          ${waitingTasks.length === 0 ? `
            <div class="hw-inset rounded-2xl p-8 text-center">
              <i class="ph-duotone ph-check-circle text-4xl text-forest"></i>
              <div class="font-serif text-lg font-bold mt-2">Zero Human Bottlenecks</div>
              <p class="text-sm text-muted mt-1">All agents are unblocked and executing autonomously.</p>
            </div>
          ` : waitingTasks.map((t, idx) => {
            const proj = state.projects.find(p => p.id === t.project_id);
            const blockedSecs = NOW_EPOCH - (t.status_changed_at || t.updated_at);
            const blockedHours = Math.max(1, Math.round(blockedSecs / 3600));
            const overdue = isTaskOverdue(t);
            const lastComment = (t.comments || []).filter(c => c.author !== 'system').slice(-1)[0];

            return `
              <div class="hw-card rounded-2xl overflow-hidden">
                <!-- Caution Top Banner -->
                <div class="caution-stripe-red px-3.5 py-2 border-b border-ink flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-[11px] font-bold bg-vermilion text-white px-2 py-0.5 rounded">
                      #${idx + 1} • Waiting ${blockedHours}h
                    </span>
                    <span class="font-mono text-xs font-bold text-ink">
                      ${escapeHtml(formatBlockedReason(t.blocked_kind))}
                    </span>
                  </div>
                  <span class="font-mono text-xs font-semibold text-ink/80">
                    Task #${t.id}
                  </span>
                </div>

                <div class="p-3.5 space-y-3">
                  <!-- Project & Meta badges -->
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-mono text-xs bg-recessed border border-border px-2.5 py-0.5 rounded-md font-semibold text-ink">
                      ${escapeHtml(proj ? proj.title : 'Project #' + t.project_id)}
                    </span>
                    ${renderPriorityPill(t.priority)}
                    ${overdue ? `<span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold">Overdue</span>` : ''}
                  </div>

                  <!-- Title & Description -->
                  <div onclick="openTaskDrawer(${t.id})" class="cursor-pointer group">
                    <h3 class="font-serif text-lg font-bold text-ink group-hover:text-vermilion transition leading-snug">
                      ${escapeHtml(t.title)}
                    </h3>
                    ${t.description ? `<p class="text-sm text-muted mt-1 leading-relaxed">${escapeHtml(t.description)}</p>` : ''}
                  </div>

                  <!-- Last Agent Message / Context -->
                  ${lastComment ? `
                    <div class="hw-inset rounded-xl p-3 text-sm">
                      <div class="flex items-center justify-between font-mono text-xs text-muted mb-1">
                        <span>Latest note from <strong class="text-ink">@${escapeHtml(lastComment.author)}</strong></span>
                        <span>${formatRelEpoch(lastComment.ts)}</span>
                      </div>
                      <p class="text-ink font-medium leading-snug">"${escapeHtml(lastComment.body)}"</p>
                    </div>
                  ` : ''}

                  <!-- Quick Operator Decision Bar (All >=44px targets + Mark Done directly) -->
                  <div class="pt-1 flex flex-wrap items-center gap-2">
                    <button onclick="quickUnblockAndReplyModal(${t.id})" class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
                      <i class="ph-bold ph-lock-key-open text-base"></i>
                      <span>Unblock</span>
                    </button>
                    <button onclick="quickCompleteTask(${t.id}, event)" class="hw-btn tap-44 bg-card text-forest font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
                      <i class="ph-bold ph-check-circle text-base"></i>
                      <span>Mark done</span>
                    </button>
                    <button onclick="openTaskDrawer(${t.id})" class="hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1">
                      <span>Open</span>
                      <i class="ph-bold ph-arrow-up-right text-sm"></i>
                    </button>
                  </div>
                </div>
              </div>
            `;
          }).join('')}

          <!-- Secondary Watchlist: Stale (>24h Untouched) & Overdue (Deduplicated!) -->
          <div class="pt-2">
            <div class="flex items-center justify-between mb-2">
              <span class="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Radar: Stale &amp; Overdue (${radarTasks.length})
              </span>
            </div>

            ${radarTasks.length === 0 ? `
              <div class="hw-inset rounded-xl p-4 text-center text-sm text-muted">
                No stale or overdue tasks outside your queue.
              </div>
            ` : `
              <div class="space-y-2.5">
                ${radarTasks.map(t => {
                  const stale = isTaskStale(t);
                  const overdue = isTaskOverdue(t);
                  return `
                    <div class="hw-card rounded-xl p-3.5 border-l-4 ${overdue ? 'border-l-vermilion' : 'border-l-ochre'} space-y-2.5">
                      <div class="flex items-center justify-between gap-2 flex-wrap">
                        <div class="flex items-center gap-1.5 flex-wrap">
                          ${stale ? `
                            <span class="font-mono text-[11px] font-bold bg-amber-200 text-amber-950 border border-amber-700 px-2 py-0.5 rounded">
                              Stale • Quiet for ${Math.floor((NOW_EPOCH - tsToEpoch(t.last_activity_at))/3600)}h
                            </span>
                          ` : ''}
                          ${overdue ? `
                            <span class="font-mono text-[11px] font-bold bg-rose-200 text-rose-950 border border-rose-700 px-2 py-0.5 rounded">
                              Overdue • Due ${formatRelEpoch(t.due_at)}
                            </span>
                          ` : ''}
                        </div>
                        <span class="font-mono text-xs text-muted">#${t.id} • ${t.assignee ? '@' + t.assignee : 'Unassigned'}</span>
                      </div>

                      <div onclick="openTaskDrawer(${t.id})" class="font-serif font-bold text-base text-ink cursor-pointer hover:underline">
                        ${escapeHtml(t.title)}
                      </div>

                      <div class="flex items-center gap-2 pt-1">
                        <button onclick="quickCompleteTask(${t.id}, event)" class="hw-btn tap-44 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center gap-1.5">
                          <i class="ph-bold ph-check-circle"></i>
                          <span>Mark done</span>
                        </button>
                        ${stale ? `
                          <button onclick="touchTaskActivity(${t.id})" class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center gap-1.5">
                            <i class="ph-bold ph-bell-ringing"></i>
                            <span>Nudge agent</span>
                          </button>
                        ` : ''}
                        <button onclick="openTaskDrawer(${t.id})" class="hw-btn tap-44 ml-auto bg-recessed text-ink font-mono text-xs font-bold px-3 rounded-xl">
                          Open
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    }

    /********************************************************************
