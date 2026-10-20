import { state, loadAll, updateHeaderTelemetry } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { showCustomModal, closeTopModal } from '../components/modal.js';
import {
  escapeHtml,
  formatRelIso,
  getAgentStyle,
  copyTokenText,
  nowIso,
  NOW_EPOCH,
  setNowEpoch
} from '../utils.js';

/********************************************************************
 * VIEW 4: AGENTS (Live Status, Rate Quota, Register, Rotate, Revoke)
 ********************************************************************/

export function renderAgentsView(): string {
  const html = (
    <div class="p-3.5 space-y-3.5">
      {/* Header Card */}
      <div class="hw-card rounded-2xl p-3.5 bg-card flex items-center justify-between gap-2">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">Connected Crew</div>
          <h1 class="font-serif text-xl font-bold text-ink">Agents ({state.agents.length})</h1>
          <p class="text-xs text-muted mt-0.5">Manage agent credentials, live connection modes, and rate quotas.</p>
        </div>
        <button onclick="openRegisterAgentModal()" class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-3.5 rounded-xl shrink-0 flex items-center gap-1.5">
          <i class="ph-bold ph-plus-bold"></i>
          <span>Register</span>
        </button>
      </div>

      {/* Simulation & Live Event Feed Tools */}
      <div class="hw-card rounded-2xl p-3 bg-card flex items-center justify-between gap-2">
        <button onclick="pollOnce().then(() => openUnifiedPollSheet())" class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
          <i class="ph-bold ph-lightning text-sm"></i>
          <span>Simulate Agent Activity</span>
        </button>
        <button onclick="openUnifiedPollSheet()" class="hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold px-3.5 rounded-xl flex items-center justify-center gap-1.5">
          <i class="ph-bold ph-broadcast text-sm"></i>
          <span>Event Log ({state.pollEvents.length})</span>
        </button>
      </div>

      {/* Agent Cards */}
      <div class="space-y-3">
        {state.agents.map(ag => {
          const st = getAgentStyle(ag.agent);
          const pct = Math.min(100, Math.round((ag.rate.used / ag.rate.limit) * 100));
          const isHighRate = pct >= 85;
          const isLiveWs = ag.transport === 'ws';
          const windowLabel = ag.rate.windowSec === 3600 ? 'Hourly quota' : 'Per-minute quota';

          return (
            <div key={ag.agent} class="hw-card rounded-2xl p-3.5 bg-card space-y-3">
              {/* Top Identity Row */}
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2.5">
                  <div class={`w-11 h-11 rounded-xl ${st.bg} border-1.5 ${st.border} flex items-center justify-center font-mono font-bold text-base ${st.text}`}>
                    {ag.agent.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="font-mono text-base font-bold text-ink">@{ag.agent}</span>
                      <span class={`font-mono text-[11px] px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${
                        isLiveWs
                          ? 'bg-emerald-100 text-emerald-950 border border-emerald-700'
                          : 'bg-amber-100 text-amber-950 border border-amber-700'
                      }`}>
                        <span class={`w-1.5 h-1.5 rounded-full ${isLiveWs ? 'bg-emerald-600 led-blink' : 'bg-amber-600'}`}></span>
                        {isLiveWs ? 'Live Socket' : 'Polling'}
                      </span>
                    </div>
                    <div class="text-xs text-muted mt-0.5">{ag.role || 'Autonomous Agent'}</div>
                  </div>
                </div>

                <button onclick={`toggleAgentTransport('${escapeHtml(ag.agent)}')`} class="tap-44 px-2.5 rounded-xl bg-recessed border border-border font-mono text-xs font-bold text-ink">
                  Switch mode
                </button>
              </div>

              {/* Rate Limit Meter */}
              <div class="hw-inset rounded-xl p-3 space-y-1.5">
                <div class="flex items-center justify-between font-mono text-xs">
                  <span class="text-muted font-semibold">
                    {windowLabel}
                  </span>
                  <span class={`font-bold ${isHighRate ? 'text-ochre' : 'text-ink'}`}>
                    {ag.rate.used} of {ag.rate.limit} sends used
                  </span>
                </div>
                <div class="w-full h-2.5 bg-paper rounded-full overflow-hidden border border-border">
                  <div class={`h-full transition-all duration-300 ${isHighRate ? 'bg-ochre' : 'bg-forest'}`} style={`width: ${pct}%`}></div>
                </div>
              </div>

              {/* Subscribed Channels & Timestamps */}
              <div class="space-y-1 font-mono text-xs text-muted">
                <div class="flex justify-between">
                  <span>Registered: <strong class="text-ink">{(ag.created || '').slice(0, 10) || '—'}</strong></span>
                  <span>Last active: <strong class="text-ink">{formatRelIso(ag.last_seen)}</strong></span>
                </div>
                {isLiveWs && ag.channels ? (
                  <div class="pt-1.5 flex items-center gap-1.5 flex-wrap">
                    <span>Listening:</span>
                    {ag.channels.map(c => (
                      <span key={c} class="bg-recessed text-ink px-2 py-0.5 rounded border border-border">#{c}</span>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Actions: Rotate Token, Revoke */}
              <div class="pt-1 flex items-center gap-2">
                <button onclick={`rotateAgentToken('${escapeHtml(ag.agent)}')`} class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
                  <i class="ph-bold ph-key text-base"></i>
                  <span>Rotate Secret</span>
                </button>
                <button onclick={`confirmRevokeAgent('${escapeHtml(ag.agent)}')`} class="hw-btn tap-44 bg-recessed hover:bg-vermilion hover:text-white text-ink font-mono text-xs font-bold px-3.5 rounded-xl flex items-center justify-center gap-1.5 transition">
                  <i class="ph-bold ph-prohibit text-base"></i>
                  <span>Revoke</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return String(html);
}

export function generateHexToken(len = 48): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function openRegisterAgentModal(): void {
  showCustomModal(`
    <form onsubmit="executeRegisterAgent(event)" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">New Crew Member</div>
          <h3 class="font-serif font-bold text-lg text-ink">Register Agent</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <p class="text-sm text-muted">
        Choose a lowercase handle (letters, numbers, hyphens). You will receive a one-time secret token for the agent.
      </p>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Agent Handle</label>
        <input id="reg-agent-name" type="text" required placeholder="e.g. kestral-02" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none" />
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Role Description</label>
        <input id="reg-agent-role" type="text" placeholder="e.g. Telemetry & Alerting Worker" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none" />
      </div>

      <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
        Register &amp; Generate Secret
      </button>
    </form>
  `);
}

export async function executeRegisterAgent(e: Event): Promise<void> {
  e.preventDefault();
  const nameInput = document.getElementById('reg-agent-name') as HTMLInputElement | null;
  const roleInput = document.getElementById('reg-agent-role') as HTMLInputElement | null;
  const name = nameInput ? nameInput.value.trim() : '';
  const role = roleInput ? roleInput.value.trim() : '';

  const re = /^[a-z0-9][a-z0-9_-]{0,31}$/;
  if (!re.test(name)) {
    showToast('Invalid agent handle', 'Use lowercase letters, numbers, hyphens, or underscores', 'red');
    return;
  }
  if (state.agents.some(a => a.agent === name)) {
    showToast('Agent already registered', `@${name} is already on the bus`, 'red');
    return;
  }

  let token: string | null = null;
  try {
    const _r = await api.post<{ token?: string; secret?: string }>('/admin/api/agents', { agent: name, role: role || undefined });
    token = _r.token || _r.secret || null;
  } catch (_e) {
    const errorMsg = _e instanceof Error ? _e.message : String(_e);
    showToast('Registration failed', errorMsg, 'red');
    return;
  }
  await loadAll();
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
  if (token) showOneTimeTokenModal(name, token, 'REGISTERED');
  else showToast(`Registered @${name}`, '', 'green');
}

export async function rotateAgentToken(agentName: string): Promise<void> {
  let _tok: string | null = null;
  try {
    const _r = await api.post<{ token?: string; secret?: string }>('/admin/api/agents/' + encodeURIComponent(agentName) + '/rotate');
    _tok = _r.token || _r.secret || null;
  } catch (_e) {
    const errorMsg = _e instanceof Error ? _e.message : String(_e);
    showToast('Rotate failed', errorMsg, 'red');
    return;
  }
  if (window.renderMainViewport) window.renderMainViewport(true);
  if (_tok) showOneTimeTokenModal(agentName, _tok, 'ROTATED');
  else showToast('Rotated @' + agentName, '', 'green');
}

export function showOneTimeTokenModal(agentName: string, token: string, mode: 'REGISTERED' | 'ROTATED'): void {
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="caution-stripe-amber border-2 border-ink rounded-xl p-3.5">
        <div class="font-mono text-xs font-bold uppercase text-amber-950">
          ${mode === 'ROTATED' ? 'Secret Rotated' : 'Agent Registered'}
        </div>
        <div class="font-serif font-bold text-base text-ink mt-0.5">
          One-Time Secret for @${escapeHtml(agentName)}
        </div>
        <p class="text-xs text-amber-950 mt-0.5">
          Copy this secret now. For security, it is only shown once.
        </p>
      </div>

      <div class="hw-inset rounded-xl p-3.5 font-mono text-sm break-all select-all text-ink border-2 border-ink" id="secret-token-box">${token}</div>

      <div class="flex gap-2">
        <button onclick="copyTokenText('${token}')" class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-1.5">
          <i class="ph-bold ph-copy text-base"></i>
          <span>Copy Secret</span>
        </button>
        <button onclick="closeTopModal()" class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold py-3 px-4 rounded-xl">
          Close
        </button>
      </div>
    </div>
  `);
}

export function confirmRevokeAgent(agentName: string): void {
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="font-mono text-xs font-bold uppercase text-vermilion">Revoke Access</div>
      <h3 class="font-serif font-bold text-lg text-ink">Revoke @${escapeHtml(agentName)}?</h3>
      <p class="text-sm text-muted">
        Their secret token stops working immediately. Past messages from <strong>@${escapeHtml(agentName)}</strong> stay in the feed.
      </p>
      <div class="flex gap-2">
        <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
        <button onclick="executeRevokeAgent('${escapeHtml(agentName)}')" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Revoke Agent</button>
      </div>
    </div>
  `);
}

export async function executeRevokeAgent(agentName: string): Promise<void> {
  try {
    await api.del('/admin/api/agents/' + encodeURIComponent(agentName));
  } catch (_e) {
    const errorMsg = _e instanceof Error ? _e.message : String(_e);
    showToast('Revoke failed', errorMsg, 'red');
    return;
  }
  state.agents = state.agents.filter(a => a.agent !== agentName);
  Object.keys(state.channelMembers).forEach(ch => {
    const mems = state.channelMembers[ch];
    if (mems) {
      state.channelMembers[ch] = mems.filter(m => m !== agentName);
    }
  });
  closeTopModal();
  showToast(`Revoked @${agentName}`, 'Credentials deactivated');
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}

export function toggleAgentTransport(agentName: string): void {
  const ag = state.agents.find(a => a.agent === agentName);
  if (!ag) return;
  setNowEpoch(NOW_EPOCH + 1);
  ag.transport = ag.transport === 'ws' ? 'poll' : 'ws';
  ag.last_seen = nowIso();
  showToast(`@${agentName} → ${ag.transport === 'ws' ? 'Live Socket' : 'Polling'}`);
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}

// Window globals
const win = window as unknown as Record<string, unknown>;
win.openRegisterAgentModal = openRegisterAgentModal;
win.executeRegisterAgent = executeRegisterAgent;
win.rotateAgentToken = rotateAgentToken;
win.confirmRevokeAgent = confirmRevokeAgent;
win.executeRevokeAgent = executeRevokeAgent;
win.toggleAgentTransport = toggleAgentTransport;
win.copyTokenText = copyTokenText;
