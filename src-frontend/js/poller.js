import { busAuth, api } from './api.js';
import { state, evToPollRow, refreshTasks, refreshMessages, loadAll, updateHeaderTelemetry } from './state.js';
import { showToast } from './components/toast.js';

/********************************************************************
 * EVENT POLLER & RESYNC
 ********************************************************************/

export let pollerTimer = null;

export function startPoller() {
  if (pollerTimer) return;
  pollerTimer = setInterval(pollOnce, 8000);
  pollOnce();
}

export function stopPoller() {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
}

export async function pollOnce() {
  if (!busAuth.get()) return;
  try {
    const c = state.pollCursor;
    const data = await api.get(`/poll?since_ts=${c.ts}&since_id=${c.id}&admin=1`);
    // Only treat as stale if we had a non-zero cursor (real incremental poll).
    // A zero cursor is initial sync, handled by loadAll().
    if (data.resync_required && (c.ts !== 0 || c.id !== 0)) {
      state.resyncRequired = true;
      if (window.renderMainViewport) window.renderMainViewport(true);
      return;
    }
    const events = data.events || [];
    if (!events.length) return;
    let needsRender = false;
    for (const ev of events) {
      if (ev.ts > c.ts || (ev.ts === c.ts && ev.id > c.id)) {
        state.pollCursor = { ts: ev.ts, id: ev.id };
      }
      state.pollEvents.unshift(evToPollRow(ev));
      if (state.pollEvents.length > 100) state.pollEvents.pop();
      if (handlePollEvent(ev)) needsRender = true;
    }
    if (needsRender) {
      if (window.renderMainViewport) window.renderMainViewport(true);
      if (state.openTaskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
    }
    updateHeaderTelemetry();
  } catch (e) { /* silent — next tick retries */ }
}

// Returns true if the event changed visible state
export function handlePollEvent(ev) {
  const t = ev.type;
  if (t === 'bus.message' || t === 'bus.message.edited' || t === 'bus.message.deleted') {
    refreshMessages().then(() => {
      if (window.renderMainViewport) window.renderMainViewport(true);
    });
    showToast(t, evToPollRow(ev).summary, 'ink');
    return false; // refresh handles render
  }
  if (t.startsWith('kanban.')) {
    refreshTasks().then(() => {
      if (window.renderMainViewport) window.renderMainViewport(true);
      if (state.openTaskId && window.renderTaskDrawer) window.renderTaskDrawer(true);
    });
    const p = ev.payload || {};
    const row = evToPollRow(ev);
    showToast(t, p.title ? `#${p.id} ${p.title}` : row.summary, t.includes('blocked') ? 'red' : 'green');
    return false;
  }
  if (t.startsWith('channel.') || t.startsWith('agent.')) {
    loadAll().then(() => {
      if (window.renderMainViewport) window.renderMainViewport(true);
    });
    showToast(t, evToPollRow(ev).summary, 'ink');
    return false;
  }
  return false;
}

export function renderResyncBanner() {
  if (!state.resyncRequired) return '';
  return `
    <div class="mx-3.5 mt-3 caution-stripe-red border-2 border-ink rounded-2xl p-3.5 shadow-[0_3px_0_#161615] flex flex-col gap-2.5">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="font-mono text-[11px] font-bold uppercase text-vermilion flex items-center gap-1">
            <i class="ph-bold ph-warning-octagon text-sm"></i> resync_required
          </div>
          <div class="font-serif text-base font-bold text-ink mt-0.5">
            Poll Cursor Predates Retention Cutoff
          </div>
          <p class="text-xs text-ink/90 mt-0.5 leading-relaxed">
            Composite cursor <span class="font-mono font-bold">(${state.pollCursor.ts}, #${state.pollCursor.id})</span> is older than the retention window (<span class="font-mono">${state.retentionCutoffTs}</span>). Incremental delta polling is paused until you resync state.
          </p>
        </div>
      </div>
      <button onclick="resyncFromServer()" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
        <i class="ph-bold ph-arrows-clockwise text-base"></i>
        <span>Resync from Server</span>
      </button>
    </div>
  `;
}

export async function resyncFromServer() {
  showToast('Resyncing...', 'Reloading all state from server', 'ink');
  try {
    await loadAll();
    state.resyncRequired = false;
    showToast('Resynced from server', 'All lists refreshed', 'green');
  } catch (_e) {
    showToast('Resync failed', _e.message, 'red');
  }
  if (window.renderMainViewport) window.renderMainViewport(true);
  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop && !backdrop.classList.contains('hidden')) {
    if (window.openUnifiedPollSheet) window.openUnifiedPollSheet();
  }
}
