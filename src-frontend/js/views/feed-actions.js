import { state, loadAll, refreshMessages } from '../state.js';
import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { showCustomModal, closeTopModal } from '../components/modal.js';
import { escapeHtml, formatRelEpoch } from '../utils.js';
import { cancelComposerReply } from './feed-gestures.js';

/********************************************************************
 * BUS FEED ACTIONS & CHANNEL MANAGEMENT MODALS
 ********************************************************************/

    export async export function sendOperatorMessage(e) {
      e.preventDefault();
      const channel = document.getElementById('compose-channel').value;
      const priority = document.getElementById('compose-priority').value;
      const audience = document.getElementById('compose-audience').value;
      const bodyInput = document.getElementById('compose-body');
      const body = bodyInput.value.trim();
      if (!body) return;

      const replyTo = state.composerDraft.reply_to || null;
      let newId = null;
      try {
        const res = await api.post('/admin/api/send', { channel, body, priority, audience, reply_to: replyTo });
        newId = res.id;
      } catch (err) {
        showToast('Send failed', err.message, 'red');
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
        body
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
        `Posted in #${channel} (${PRIORITY_LABELS[priority]} • ${AUDIENCE_LABELS[audience]})`,
        'green'
      );
      if (window.renderMainViewport) window.renderMainViewport(true);
      updateHeaderTelemetry();
    }

    export function openEditMessageModal(msgId) {
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

    export async export function executeEditMessage(e, msgId) {
      e.preventDefault();
      const msg = state.messages.find(m => m.id === msgId);
      if (!msg) return;
      const newBody = document.getElementById('edit-msg-body').value.trim();
      try {
        await api.put(`/admin/api/messages/${msgId}`, { body: newBody });
      } catch (err) {
        showToast('Edit failed', err.message, 'red');
        return;
      }
      msg.body = newBody;
      msg.edited = true;
      closeTopModal();
      showToast('Message updated');
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function confirmDeleteMessage(msgId) {
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

    export async export function executeDeleteMessage(msgId) {
      const msg = state.messages.find(m => m.id === msgId);
      try {
        await api.del(`/admin/api/messages/${msgId}`);
      } catch (err) {
        showToast('Delete failed', err.message, 'red');
        return;
      }
      state.messages = state.messages.filter(m => m.id !== msgId);
      if (state.openThreadMsgId === msgId) state.openThreadMsgId = null;
      closeTopModal();
      showToast('Message deleted');
      if (window.renderMainViewport) window.renderMainViewport(true);
      updateHeaderTelemetry();
    }

    export function openChannelMembersModal(channelName) {
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

    export async export function addChannelMember(channelName, agentName) {
      try {
        await api.post(`/admin/api/channels/${encodeURIComponent(channelName)}/members`, { agent: agentName });
      } catch (err) {
        showToast('Add member failed', err.message, 'red');
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

    export function addCustomChannelMember(e, channelName) {
      e.preventDefault();
      const input = document.getElementById('custom-channel-member-input');
      const handle = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!handle) return;
      addChannelMember(channelName, handle);
    }

    export async export function removeChannelMember(channelName, agentName) {
      try {
        await api.del(`/admin/api/channels/${encodeURIComponent(channelName)}/members/${encodeURIComponent(agentName)}`);
      } catch (err) {
        showToast('Remove member failed', err.message, 'red');
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

    export function openCreateChannelModal() {
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

    export async export function executeCreateChannel(e) {
      e.preventDefault();
      const name = document.getElementById('new-channel-name').value.trim();
      const seed = document.getElementById('new-channel-seed').value.trim();

      if (name.startsWith('dm:')) {
        const parts = name.split(':');
        if (parts.length !== 3) {
          showToast('Invalid DM channel name', 'Format must be dm:agentA:agentB', 'red');
          return;
        }
        const [, a, b] = parts;
        const regNames = state.agents.map(ag => ag.agent);
        if (!regNames.includes(a) || !regNames.includes(b)) {
          showToast('Unknown agent in DM pair', 'Both agents must be registered', 'red');
          return;
        }
        if (a >= b) {
          showToast('Order agent names alphabetically', `Try dm:${[a,b].sort().join(':')}`, 'red');
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
        showToast('Create channel failed', err.message, 'red');
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
          showToast('Opening message failed', err.message, 'red');
        }
      }
      state.msgFilter.channel = name;
      state.composerDraft.channel = name;
      closeTopModal();
      showToast(`Created #${name}`, seed ? 'Opening message posted' : '', 'green');
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function confirmDeleteChannel(channelName) {
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

    export async export function executeDeleteChannel(channelName) {
      try {
        await api.del(`/admin/api/channels/${encodeURIComponent(channelName)}`);
      } catch (err) {
        showToast('Delete failed', err.message, 'red');
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

    /********************************************************************
