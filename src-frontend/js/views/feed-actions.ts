import { state, refreshMessages, updateHeaderTelemetry } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { showCustomModal, closeTopModal } from '../components/modal.js';
import { escapeHtml, getAgentStyle, PRIORITY_LABELS, AUDIENCE_LABELS } from '../utils.js';
import { getChannelMembers } from './feed.js';

/********************************************************************
 * BUS FEED ACTIONS & CHANNEL MANAGEMENT MODALS
 ********************************************************************/

export async function sendOperatorMessage(e: Event): Promise<void> {
  e.preventDefault();
  const channelEl = document.getElementById('compose-channel') as HTMLSelectElement | null;
  const priorityEl = document.getElementById('compose-priority') as HTMLSelectElement | null;
  const audienceEl = document.getElementById('compose-audience') as HTMLSelectElement | null;
  const bodyInput = document.getElementById('compose-body') as HTMLTextAreaElement | null;

  const channel = channelEl ? channelEl.value : state.composerDraft.channel;
  const priority = priorityEl ? priorityEl.value : state.composerDraft.priority;
  const audience = audienceEl ? audienceEl.value : state.composerDraft.audience;
  const body = bodyInput ? bodyInput.value.trim() : '';
  if (!body) return;

  const replyTo = state.composerDraft.reply_to || null;
  let newId: number | null = null;
  try {
    const res = await api.post<{ id: number }>('/admin/api/send', { channel, body, priority, audience, reply_to: replyTo });
    newId = res.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('Send failed', msg, 'red');
    return;
  }

  state.messages.push({
    id: newId,
    sender: 'luki',
    channel,
    priority,
    audience,
    reply_to: replyTo,
    ts: new Date().toISOString(),
    body,
    edited: false
  });
  if (!state.channels.includes(channel)) state.channels.push(channel);

  state.composerDraft = {
    channel,
    priority,
    audience,
    body: '',
    reply_to: null
  };
  state.composerExpanded = false;

  showToast(
    replyTo ? 'Reply sent' : 'Message sent',
    `Posted in #${channel} (${PRIORITY_LABELS[priority] || priority} • ${AUDIENCE_LABELS[audience] || audience})`,
    'green'
  );
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}

export function openEditMessageModal(msgId: number): void {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg) return;
  showCustomModal(`
    <form onsubmit="executeEditMessage(event, ${msg.id})" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">Edit Post</div>
          <h3 class="font-serif font-bold text-lg text-ink">Message by @${escapeHtml(msg.sender)}</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>
      <textarea id="edit-msg-body" rows="4" required class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none">${escapeHtml(msg.body)}</textarea>
      <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
        Save Changes
      </button>
    </form>
  `);
}

export async function executeEditMessage(e: Event, msgId: number): Promise<void> {
  e.preventDefault();
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg) return;
  const input = document.getElementById('edit-msg-body') as HTMLTextAreaElement | null;
  const newBody = input ? input.value.trim() : '';
  try {
    await api.put(`/admin/api/messages/${msgId}`, { body: newBody });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Edit failed', errorMsg, 'red');
    return;
  }
  msg.body = newBody;
  msg.edited = true;
  closeTopModal();
  showToast('Message updated');
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function confirmDeleteMessage(msgId: number): void {
  const msg = state.messages.find(m => m.id === msgId);
  if (!msg) return;
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Message</div>
      <h3 class="font-serif font-bold text-lg text-ink">Remove this post from #${escapeHtml(msg.channel)}?</h3>
      <p class="text-sm text-muted bg-recessed p-3 rounded-xl">"${escapeHtml(msg.body)}"</p>
      <div class="flex gap-2">
        <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
        <button onclick="executeDeleteMessage(${msg.id})" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete</button>
      </div>
    </div>
  `);
}

export async function executeDeleteMessage(msgId: number): Promise<void> {
  try {
    await api.del(`/admin/api/messages/${msgId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Delete failed', errorMsg, 'red');
    return;
  }
  state.messages = state.messages.filter(m => m.id !== msgId);
  if (state.openThreadMsgId === msgId) state.openThreadMsgId = null;
  closeTopModal();
  showToast('Message deleted');
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}

export function openChannelMembersModal(channelName: string): void {
  const members = getChannelMembers(channelName);
  const allAgentNames = state.agents.map(a => a.agent);

  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-forest">Channel Membership</div>
          <h3 class="font-serif font-bold text-lg text-ink">#${escapeHtml(channelName)} Members</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <p class="text-xs text-muted leading-relaxed">
        Add or remove agents on <strong class="text-ink">#${escapeHtml(channelName)}</strong>. Changes immediately emit <span class="font-mono">channel.member_added</span> or <span class="font-mono">channel.member_removed</span> on the bus.
      </p>

      <!-- Current Members List -->
      <div class="space-y-2">
        <div class="font-mono text-xs font-bold uppercase text-muted">
          Current Members (${members.length})
        </div>
        ${members.length === 0 ? `
          <div class="hw-inset rounded-xl p-3.5 text-center text-xs text-muted">
            No agents currently assigned to #${escapeHtml(channelName)}.
          </div>
        ` : members.map(ag => {
          const st = getAgentStyle(ag);
          const agObj = state.agents.find(a => a.agent === ag);
          return `
            <div class="hw-inset rounded-xl p-2.5 flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-mono text-xs font-bold ${st.bg} ${st.text} border ${st.border} px-2.5 py-1 rounded-lg">
                  @${escapeHtml(ag)}
                </span>
                <span class="text-xs text-muted truncate">${escapeHtml(agObj ? agObj.role : 'Registered Agent')}</span>
              </div>
              <button
                type="button"
                onclick="removeChannelMember('${escapeHtml(channelName)}', '${escapeHtml(ag)}')"
                class="hw-btn tap-44 px-3 rounded-xl bg-rose-100 text-vermilion font-mono text-xs font-bold flex items-center gap-1 shrink-0"
              >
                <i class="ph-bold ph-user-minus"></i>
                <span>Remove</span>
              </button>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Available Agents to Add -->
      <div class="space-y-2 pt-2 border-t border-border">
        <div class="font-mono text-xs font-bold uppercase text-muted">
          Add Agent to #${escapeHtml(channelName)}
        </div>
        ${allAgentNames.filter(a => !members.includes(a)).length === 0 ? `
          <div class="text-xs text-muted py-1">All registered agents are already members of this channel.</div>
        ` : `
          <div class="grid grid-cols-2 gap-2">
            ${allAgentNames.filter(a => !members.includes(a)).map(ag => `
              <button
                type="button"
                onclick="addChannelMember('${escapeHtml(channelName)}', '${escapeHtml(ag)}')"
                class="hw-btn tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <i class="ph-bold ph-user-plus"></i>
                <span>Add @${escapeHtml(ag)}</span>
              </button>
            `).join('')}
          </div>
        `}

        <!-- Custom Handle Add -->
        <form onsubmit="addCustomChannelMember(event, '${escapeHtml(channelName)}')" class="flex gap-2 pt-1">
          <input
            id="custom-channel-member-input"
            type="text"
            placeholder="Or enter agent handle..."
            class="tap-44 flex-1 hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none"
          />
          <button type="submit" class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-4 rounded-xl">
            Add
          </button>
        </form>
      </div>
    </div>
  `);
}

export async function addChannelMember(channelName: string, agentName: string): Promise<void> {
  try {
    await api.post(`/admin/api/channels/${encodeURIComponent(channelName)}/members`, { agent: agentName });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Add member failed', errorMsg, 'red');
    return;
  }
  const members = getChannelMembers(channelName);
  if (!members.includes(agentName)) {
    members.push(agentName);
    const ag = state.agents.find(a => a.agent === agentName);
    if (ag && ag.channels && !ag.channels.includes(channelName)) {
      ag.channels.push(channelName);
    }
    showToast(`Added @${agentName}`, `Member of #${channelName}`, 'green');
  }
  openChannelMembersModal(channelName);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function addCustomChannelMember(e: Event, channelName: string): void {
  e.preventDefault();
  const input = document.getElementById('custom-channel-member-input') as HTMLInputElement | null;
  const handle = input ? input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') : '';
  if (!handle) return;
  addChannelMember(channelName, handle);
}

export async function removeChannelMember(channelName: string, agentName: string): Promise<void> {
  try {
    await api.del(`/admin/api/channels/${encodeURIComponent(channelName)}/members/${encodeURIComponent(agentName)}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Remove member failed', errorMsg, 'red');
    return;
  }
  const members = getChannelMembers(channelName);
  state.channelMembers[channelName] = members.filter(m => m !== agentName);
  const ag = state.agents.find(a => a.agent === agentName);
  if (ag && ag.channels) {
    ag.channels = ag.channels.filter(c => c !== channelName);
  }
  showToast(`Removed @${agentName}`, `Removed from #${channelName}`);
  openChannelMembersModal(channelName);
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function openCreateChannelModal(): void {
  showCustomModal(`
    <form onsubmit="executeCreateChannel(event)" class="p-4 space-y-3.5">
      <div class="flex items-center justify-between border-b border-border pb-2.5">
        <div>
          <div class="font-mono text-xs font-bold uppercase text-muted">New Channel</div>
          <h3 class="font-serif font-bold text-lg text-ink">Create or Open Channel</h3>
        </div>
        <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
          <i class="ph-bold ph-x text-base"></i>
        </button>
      </div>

      <p class="text-sm text-muted leading-relaxed">
        Use lowercase letters, numbers, or hyphens (e.g. <strong class="text-ink">deploy-log</strong>), or open a direct message between two agents in alphabetical order (e.g. <strong class="text-ink">dm:nyx:wren</strong>).
      </p>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Channel Name</label>
        <input id="new-channel-name" type="text" required placeholder="e.g. deploy-log or dm:nyx:wren" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none" />
      </div>

      <div>
        <label class="block font-mono text-xs font-bold text-muted mb-1">Opening Message</label>
        <input id="new-channel-seed" type="text" required value="Channel opened by luki." class="tap-44 w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none" />
      </div>

      <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
        Create Channel
      </button>
    </form>
  `);
}

export async function executeCreateChannel(e: Event): Promise<void> {
  e.preventDefault();
  const nameInput = document.getElementById('new-channel-name') as HTMLInputElement | null;
  const seedInput = document.getElementById('new-channel-seed') as HTMLInputElement | null;
  const name = nameInput ? nameInput.value.trim() : '';
  const seed = seedInput ? seedInput.value.trim() : '';

  if (name.startsWith('dm:')) {
    const parts = name.split(':');
    if (parts.length !== 3) {
      showToast('Invalid DM channel name', 'Format must be dm:agentA:agentB', 'red');
      return;
    }
    const [, a, b] = parts;
    if (!a || !b) {
      showToast('Invalid DM channel name', 'Format must be dm:agentA:agentB', 'red');
      return;
    }
    const regNames = state.agents.map(ag => ag.agent);
    if (!regNames.includes(a) || !regNames.includes(b)) {
      showToast('Unknown agent in DM pair', 'Both agents must be registered', 'red');
      return;
    }
    if (a >= b) {
      showToast('Order agent names alphabetically', `Try dm:${[a, b].sort().join(':')}`, 'red');
      return;
    }
  } else {
    const re = /^[a-z0-9][a-z0-9_-]{0,31}$/;
    if (!re.test(name)) {
      showToast('Invalid channel name', 'Use lowercase letters, digits, hyphens, or underscores', 'red');
      return;
    }
  }

  try {
    await api.post('/admin/api/channels', { name });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Create channel failed', errorMsg, 'red');
    return;
  }
  if (!state.channels.includes(name)) {
    state.channels.push(name);
  }
  if (!state.channelMembers[name]) {
    state.channelMembers[name] = name.startsWith('dm:')
      ? name.split(':').slice(1)
      : state.agents.map(a => a.agent);
  }
  if (seed) {
    try {
      await api.post('/admin/api/send', { channel: name, body: seed, priority: 'normal', audience: 'agents' });
      await refreshMessages();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast('Opening message failed', errorMsg, 'red');
    }
  }
  state.msgFilter.channel = name;
  state.composerDraft.channel = name;
  closeTopModal();
  showToast(`Created #${name}`, seed ? 'Opening message posted' : '', 'green');
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function confirmDeleteChannel(channelName: string): void {
  const count = state.messages.filter(m => m.channel === channelName).length;
  showCustomModal(`
    <div class="p-4 space-y-4">
      <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Channel</div>
      <h3 class="font-serif font-bold text-lg text-ink">Delete #${escapeHtml(channelName)}?</h3>
      <p class="text-sm text-muted">
        This removes the channel and all <strong>${count} messages</strong> inside it.
      </p>
      <div class="flex gap-2">
        <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
        <button onclick="executeDeleteChannel('${escapeHtml(channelName)}')" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete Channel</button>
      </div>
    </div>
  `);
}

export async function executeDeleteChannel(channelName: string): Promise<void> {
  try {
    await api.del(`/admin/api/channels/${encodeURIComponent(channelName)}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    showToast('Delete failed', errorMsg, 'red');
    return;
  }
  state.channels = state.channels.filter(c => c !== channelName);
  delete state.channelMembers[channelName];
  state.messages = state.messages.filter(m => m.channel !== channelName);
  state.msgFilter.channel = 'ALL';
  state.composerDraft.channel = 'all-agent';
  closeTopModal();
  showToast(`Deleted #${channelName}`);
  if (window.renderMainViewport) window.renderMainViewport(true);
  updateHeaderTelemetry();
}

// Window globals
const win = window as unknown as Record<string, unknown>;
win.sendOperatorMessage = sendOperatorMessage;
win.openEditMessageModal = openEditMessageModal;
win.executeEditMessage = executeEditMessage;
win.confirmDeleteMessage = confirmDeleteMessage;
win.executeDeleteMessage = executeDeleteMessage;
win.openChannelMembersModal = openChannelMembersModal;
win.addChannelMember = addChannelMember;
win.addCustomChannelMember = addCustomChannelMember;
win.removeChannelMember = removeChannelMember;
win.openCreateChannelModal = openCreateChannelModal;
win.executeCreateChannel = executeCreateChannel;
win.confirmDeleteChannel = confirmDeleteChannel;
win.executeDeleteChannel = executeDeleteChannel;
