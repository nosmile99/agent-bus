// Modal Controller & System Modals in hono/jsx
import { state, loadAll, manualRefresh } from '../state.js';
import { busAuth, doSignOut } from '../api.js';
import { escapeHtml, formatRelEpoch, copyTokenText } from '../utils.js';
import { showToast } from './toast.js';

export function showCustomModal(content: string): void {
  const backdrop = document.getElementById('modal-backdrop');
  const sheet = document.getElementById('modal-sheet');
  if (!backdrop || !sheet) return;
  sheet.innerHTML = content;
  backdrop.classList.remove('hidden');
  backdrop.classList.add('flex');
}

export function openModal(content: string): void {
  showCustomModal(content);
}

export function closeTopModal(e?: Event): void {
  if (e && e.target && (e.target as HTMLElement).id !== 'modal-backdrop') return;
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.classList.remove('flex');
  }
}

export function togglePollInspectorScope(isAdmin: boolean): void {
  state.pollInspectorAdminView = isAdmin;
  openUnifiedPollSheet();
}

export function openUnifiedPollSheet(): void {
  const visibleEvents = state.pollEvents.filter((ev) => state.pollInspectorAdminView || !ev.adminOnly);

  const html = (
    <div class="p-4 space-y-3 max-h-[88dvh] flex flex-col">
      <div class="flex items-center justify-between border-b border-border pb-2.5 shrink-0">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-forest">Unified Event Poll</div>
          <h3 class="font-serif font-bold text-lg text-ink">Event Stream ({visibleEvents.length})</h3>
        </div>
        <button onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      {/* Composite Cursor (ts, id) Telemetry Bar */}
      <div class="hw-inset rounded-xl p-3 space-y-2 shrink-0">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <span class="font-mono text-[11px] font-bold uppercase text-muted">Composite Poll Cursor</span>
          <span class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-card border border-ink text-ink">
            (ts: {state.pollCursor.ts}, id: {state.pollCursor.id})
          </span>
        </div>
        <div class="flex items-center justify-between text-[11px] font-mono text-muted">
          <span>
            Retention cutoff: <strong class="text-ink">{state.retentionCutoffTs}</strong>
          </span>
        </div>
      </div>

      {/* Resync Required Banner inside Poll Inspector if active */}
      {state.resyncRequired && (
        <div class="caution-stripe-red border-2 border-ink rounded-xl p-3 space-y-2 shrink-0">
          <div class="font-mono text-xs font-bold uppercase text-vermilion flex items-center gap-1">
            <i class="ph-bold ph-warning-octagon"></i> resync_required: true
          </div>
          <p class="text-xs text-ink leading-snug">
            Cursor <span class="font-mono font-bold">({state.pollCursor.ts}, #{state.pollCursor.id})</span> predates retention cutoff (<span class="font-mono">{state.retentionCutoffTs}</span>). Full state reload required.
          </p>
          <button
            onclick="resyncFromServer()"
            class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"
          >
            <i class="ph-bold ph-arrows-clockwise"></i>
            <span>Resync from Server</span>
          </button>
        </div>
      )}

      {/* Admin View vs Agent View Toggle */}
      <div class="grid grid-cols-2 gap-1.5 shrink-0">
        <button
          type="button"
          onclick="togglePollInspectorScope(true)"
          class={`tap-44 rounded-xl font-mono text-xs font-bold border transition ${
            state.pollInspectorAdminView ? 'bg-ink text-paper border-ink' : 'bg-recessed text-muted border-border'
          }`}
        >
          Admin View (All Events)
        </button>
        <button
          type="button"
          onclick="togglePollInspectorScope(false)"
          class={`tap-44 rounded-xl font-mono text-xs font-bold border transition ${
            !state.pollInspectorAdminView ? 'bg-ink text-paper border-ink' : 'bg-recessed text-muted border-border'
          }`}
        >
          Agent View (Filtered)
        </button>
      </div>

      {/* Event Stream List */}
      <div class="flex-1 overflow-y-auto space-y-2 pr-1">
        {visibleEvents.map((ev) => {
          const proj = ev.project_id ? state.projects.find((p) => p.id === ev.project_id) : null;
          return (
            <div class="hw-inset rounded-xl p-3 space-y-1">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-mono text-xs font-bold text-ink bg-card px-2 py-0.5 rounded border border-border">
                    {escapeHtml(ev.type)}
                  </span>
                  {ev.adminOnly && (
                    <span class="font-mono text-[10px] font-bold bg-amber-200 text-amber-950 border border-amber-700 px-1.5 py-0.5 rounded">
                      Admin only
                    </span>
                  )}
                  {proj && (
                    <span class="font-mono text-[10px] bg-card text-muted border border-border px-1.5 py-0.5 rounded">
                      {escapeHtml(proj.title)}
                    </span>
                  )}
                </div>
                <span class="font-mono text-[11px] text-muted">{formatRelEpoch(ev.ts)}</span>
              </div>
              <div class="font-sans text-xs text-ink/90 font-medium">{escapeHtml(ev.summary)}</div>
              <div class="flex items-center justify-between text-[10px] font-mono text-muted pt-1 border-t border-border/50">
                <span>
                  actor: <strong class="text-ink">{escapeHtml(ev.actor || 'system')}</strong>
                </span>
                <span>id: #{ev.id} · ts: {ev.ts}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  showCustomModal(String(html));
}

export function openAdminModal(): void {
  const wsAgents = state.agents.filter((a) => a.transport === 'ws').length;
  const html = (
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">Operator Console</div>
          <h3 class="font-serif font-bold text-lg text-ink">Signed in as @{escapeHtml(state.adminUser)}</h3>
        </div>
        <button onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      {/* Quick Bus Summary & Live Controls */}
      <div class="hw-inset rounded-xl p-3.5 space-y-2.5">
        <div class="flex items-center justify-between text-xs font-mono">
          <span class="text-muted">
            Bus Status: <strong class="text-forest">Live</strong>
          </span>
          <span class="text-muted">
            Live Sockets: <strong class="text-ink">{wsAgents} of {state.agents.length}</strong>
          </span>
        </div>
        <div class="flex gap-2">
          <button
            onclick="manualRefresh()"
            class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5"
          >
            <i class="ph-bold ph-arrows-clockwise"></i>
            <span>Refresh Now</span>
          </button>
          <button
            onclick="openUnifiedPollSheet()"
            class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5"
          >
            <i class="ph-bold ph-broadcast"></i>
            <span>Event Log ({state.pollEvents.length})</span>
          </button>
        </div>
      </div>

      <form onsubmit="changeAdminPassword(event)" class="space-y-2.5">
        <div class="font-mono text-xs font-bold text-muted">Update Operator Credentials</div>
        <input
          id="admin-new-user"
          type="text"
          value={escapeHtml(state.adminUser)}
          placeholder="Operator username"
          class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink"
        />
        <input
          id="admin-new-pass"
          type="password"
          required
          minlength={1}
          placeholder="Password"
          class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink"
        />
        <button
          type="submit"
          class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-2.5 rounded-xl"
        >
          Save Credentials
        </button>
      </form>

      <div class="pt-2 border-t border-border flex gap-2">
        <button
          onclick="exportBusDump()"
          class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5"
        >
          <i class="ph-bold ph-download-simple"></i>
          <span>Copy Backup</span>
        </button>
        <button
          onclick="doSignOut()"
          class="hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold py-2.5 px-4 rounded-xl"
        >
          Sign Out
        </button>
      </div>
    </div>
  );

  showCustomModal(String(html));
}

export async function changeAdminPassword(e: Event): Promise<void> {
  e.preventDefault();
  const u = (document.getElementById('admin-new-user') as HTMLInputElement | null)?.value.trim();
  const p = (document.getElementById('admin-new-pass') as HTMLInputElement | null)?.value;
  if (!u || !p) return;
  busAuth.set(btoa(u + ':' + p));
  state.adminUser = u;
  closeTopModal();
  try {
    await loadAll();
    showToast('Credentials updated', `Signed in as @${state.adminUser}`, 'green');
  } catch (_err) {
    showToast('Invalid credentials', 'Check username/password', 'red');
  }
}

export function exportBusDump(): void {
  const dump = JSON.stringify({ messages: state.messages, projects: state.projects, tasks: state.tasks }, null, 2);
  copyTokenText(dump);
  showToast('Backup copied to clipboard', `${state.messages.length} messages & ${state.tasks.length} tasks`, 'green');
}

// Window global bindings for DOM onclick handlers
const win = window as unknown as Record<string, unknown>;
win.showCustomModal = showCustomModal;
win.openModal = openModal;
win.closeTopModal = closeTopModal;
win.togglePollInspectorScope = togglePollInspectorScope;
win.openUnifiedPollSheet = openUnifiedPollSheet;
win.openAdminModal = openAdminModal;
win.changeAdminPassword = changeAdminPassword;
win.exportBusDump = exportBusDump;
win.manualRefresh = manualRefresh;
win.doSignOut = doSignOut;
