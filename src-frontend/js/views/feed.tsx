import { state } from '../state.js';
import { FrontendMessage } from '../types.js';
import {
  escapeHtml,
  getAgentStyle,
  PRIORITY_LABELS,
  AUDIENCE_LABELS
} from '../utils.js';
import { renderMessageCard, renderThreadTimeline } from './feed-card.js';

/********************************************************************
 * BUS FEED VIEW (Social Timeline, Composer, Channels)
 ********************************************************************/

export function getChannelMembers(channelName: string): string[] {
  let members = state.channelMembers[channelName];
  if (!members || members.length === 0) {
    if (channelName.startsWith('dm:')) {
      const parts = channelName.split(':');
      members = parts.slice(1);
    } else {
      members = state.agents.map(a => a.agent);
    }
    state.channelMembers[channelName] = members;
  }
  return members;
}

export function getDistinctSenders(): string[] {
  const set = new Set<string>(['luki']);
  state.messages.forEach(m => set.add(m.sender));
  state.agents.forEach(a => set.add(a.agent));
  return Array.from(set).sort();
}

export function getRootMessageId(msg: FrontendMessage | null | undefined): number | null {
  if (!msg) return null;
  let curr = msg;
  let safety = 0;
  while (curr.reply_to && safety < 20) {
    const parent = state.messages.find(m => m.id === curr.reply_to);
    if (!parent) break;
    curr = parent;
    safety++;
  }
  return curr.id;
}

export function getDirectAndThreadReplies(rootId: number): FrontendMessage[] {
  return state.messages
    .filter(m => m.id !== rootId && getRootMessageId(m) === rootId)
    .sort((a, b) => a.id - b.id);
}

export function renderMessagesView(): string {
  const mf = state.msgFilter;
  const senders = getDistinctSenders();

  if (!state.channels.includes(state.composerDraft.channel)) {
    state.composerDraft.channel = mf.channel !== 'ALL' ? mf.channel : 'all-agent';
  }

  // If a thread is open, render the focused thread view
  const threadRootMsg = state.openThreadMsgId
    ? state.messages.find(m => m.id === state.openThreadMsgId)
    : null;

  if (state.openThreadMsgId && !threadRootMsg) {
    state.openThreadMsgId = null;
  }

  // Reverse-chronological social timeline
  const sortedMsgs = [...state.messages].sort((a, b) => b.id - a.id);
  const filteredMsgs = sortedMsgs.filter(m => {
    if (mf.channel && mf.channel !== 'ALL' && m.channel !== mf.channel) return false;
    if (mf.sender && mf.sender !== 'ALL' && m.sender !== mf.sender) return false;
    if (mf.priority && mf.priority !== 'ALL' && m.priority !== mf.priority) return false;
    if (mf.q && mf.q.trim() !== '') {
      const needle = mf.q.trim().toLowerCase().replace(/[%_]/g, '');
      if (!m.body.toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  const draft = state.composerDraft;
  const replyTarget = draft.reply_to ? state.messages.find(m => m.id === draft.reply_to) : null;
  const prioHintStyle = draft.priority === 'urgent'
    ? 'bg-vermilion text-white border-vermilion'
    : draft.priority === 'low'
      ? 'bg-stone-200 text-stone-700 border-stone-400'
      : 'bg-recessed text-ink border-border';

  const targetCh = mf.channel !== 'ALL' ? mf.channel : state.composerDraft.channel;
  const members = getChannelMembers(targetCh);

  const html = (
    <div class="flex-1 flex flex-col justify-between min-h-full">
      {threadRootMsg ? (
        <div dangerouslySetInnerHTML={{ __html: renderThreadTimeline(threadRootMsg) }} />
      ) : (
        <div class="p-3.5 pb-24 space-y-3">
          {/* Channel & Filter Card */}
          <div class="hw-card rounded-2xl p-3 bg-card space-y-2.5">
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Channels ({state.channels.length})
              </span>
              <div class="flex items-center gap-1.5">
                {mf.channel !== 'ALL' && mf.channel !== 'all-agent' && (
                  <button
                    onclick={`confirmDeleteChannel('${escapeHtml(mf.channel)}')`}
                    class="tap-44 px-3 font-mono text-xs font-bold bg-rose-100 text-vermilion border border-rose-400 rounded-xl flex items-center"
                  >
                    Delete #{mf.channel}
                  </button>
                )}
                <button
                  onclick="openCreateChannelModal()"
                  class="hw-btn tap-44 px-3 font-mono text-xs font-bold bg-ink text-paper rounded-xl flex items-center gap-1"
                >
                  <i class="ph-bold ph-plus"></i> New Channel
                </button>
              </div>
            </div>

            {/* Horizontal Channel Pill Strip */}
            <div data-scroll-id="msg-channel-strip" class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              <button
                onclick="setMsgFilter('channel', 'ALL')"
                class={`tap-44 px-3 rounded-xl font-mono text-xs font-bold shrink-0 border transition flex items-center ${
                  mf.channel === 'ALL' ? 'bg-ink text-paper border-ink' : 'bg-recessed text-ink border-border'
                }`}
              >
                All ({state.messages.length})
              </button>
              {state.channels.slice().sort().map(ch => {
                const count = state.messages.filter(m => m.channel === ch).length;
                const active = mf.channel === ch;
                const isDm = ch.startsWith('dm:');
                return (
                  <button
                    key={ch}
                    onclick={`setMsgFilter('channel', '${escapeHtml(ch)}')`}
                    class={`tap-44 px-3 rounded-xl font-mono text-xs font-bold shrink-0 border transition flex items-center gap-1.5 ${
                      active ? 'bg-ink text-paper border-ink' : 'bg-recessed text-ink border-border'
                    }`}
                  >
                    <i class={`ph-bold ${isDm ? 'ph-chats' : 'ph-hash'} text-xs opacity-75`}></i>
                    <span>{ch}</span>
                    <span class="text-[11px] opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Channel Membership Strip */}
            <div class="pt-2 border-t border-border flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                <span class="font-mono text-[11px] font-bold text-muted flex items-center gap-1">
                  <i class="ph-bold ph-users"></i> #{targetCh} members ({members.length}):
                </span>
                {members.length === 0 ? (
                  <span class="font-mono text-[11px] text-muted italic">No members</span>
                ) : (
                  members.map(ag => {
                    const st = getAgentStyle(ag);
                    return (
                      <span key={ag} class={`font-mono text-[11px] ${st.bg} ${st.text} border ${st.border} px-2 py-0.5 rounded-md font-bold`}>
                        @{ag}
                      </span>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                onclick={`openChannelMembersModal('${escapeHtml(targetCh)}')`}
                class="tap-44 px-2.5 rounded-xl bg-recessed border border-border font-mono text-xs font-bold text-ink shrink-0 flex items-center gap-1"
              >
                <i class="ph-bold ph-user-gear text-sm"></i>
                <span>Members</span>
              </button>
            </div>

            {/* Sender, Priority & Search Filter Row */}
            <div class="grid grid-cols-3 gap-1.5 pt-1 border-t border-border">
              <select onchange="setMsgFilter('sender', this.value)" class="tap-44 hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink">
                <option value="ALL" selected={mf.sender === 'ALL'}>All senders</option>
                {senders.map(s => (
                  <option key={s} value={s} selected={mf.sender === s}>@{s}</option>
                ))}
              </select>

              <select onchange="setMsgFilter('priority', this.value)" class="tap-44 hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink">
                <option value="ALL" selected={mf.priority === 'ALL'}>Any priority</option>
                <option value="urgent" selected={mf.priority === 'urgent'}>Urgent</option>
                <option value="normal" selected={mf.priority === 'normal'}>Normal</option>
                <option value="low" selected={mf.priority === 'low'}>Low</option>
              </select>

              <input
                id="msg-search-input"
                type="text"
                value={mf.q}
                oninput="setMsgFilter('q', this.value)"
                placeholder="Search posts..."
                class="tap-44 hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink focus:outline-none"
              />
            </div>
          </div>

          <div class="text-xs text-muted px-1 flex items-center justify-between">
            <span><i class="ph-bold ph-hand-swipe-right mr-1"></i>Swipe right on any post to reply • Tap a post to open its thread</span>
          </div>

          {/* Social Timeline Feed */}
          <div class="space-y-2.5">
            {filteredMsgs.length === 0 ? (
              <div class="hw-inset rounded-2xl p-8 text-center text-sm text-muted">
                No messages match your filter.
              </div>
            ) : (
              filteredMsgs.map(m => (
                <div key={m.id} dangerouslySetInnerHTML={{ __html: renderMessageCard(m, false) }} />
              ))
            )}
          </div>
        </div>
      )}

      {/* STICKY BOTTOM COMPACT / EXPANDABLE MESSAGE COMPOSER */}
      <div id="composer-dock" class="sticky bottom-0 left-0 right-0 z-20 px-3 pb-2.5 pt-1.5 bg-gradient-to-t from-paper via-paper to-transparent">
        {!state.composerExpanded ? (
          /* Compact Bar */
          <button
            type="button"
            onclick="expandComposer()"
            class="hw-card tap-44 w-full rounded-2xl px-3.5 py-2.5 bg-card flex items-center justify-between gap-2 text-left active:translate-y-0.5 transition"
          >
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <span class="font-mono text-xs font-bold bg-ink text-paper px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1">
                <i class="ph-bold ph-hash text-xs text-amber-400"></i>{draft.channel}
              </span>
              <span class={`font-mono text-[11px] px-2 py-0.5 rounded-md border font-bold shrink-0 ${prioHintStyle}`}>
                {PRIORITY_LABELS[draft.priority] || 'Normal'}
              </span>
              <span class="text-sm text-muted truncate pl-1">
                {replyTarget ? `Replying to @${replyTarget.sender}...` : draft.body ? draft.body : 'Send a message...'}
              </span>
            </div>
            <span class="w-10 h-10 rounded-xl bg-ink text-paper flex items-center justify-center shrink-0">
              <i class="ph-bold ph-paper-plane-tilt text-base"></i>
            </span>
          </button>
        ) : (
          /* Expanded Full Composer Sheet */
          <form onsubmit="sendOperatorMessage(event)" class="hw-card rounded-2xl p-3.5 bg-card space-y-3 shadow-2xl">
            <div class="flex items-center justify-between border-b border-border pb-2">
              <span class="font-serif text-base font-bold text-ink flex items-center gap-1.5">
                <i class="ph-bold ph-chat-centered-text text-forest"></i> Send a message
              </span>
              <button
                type="button"
                onclick="collapseComposer()"
                class="tap-44 px-3 rounded-xl bg-recessed text-ink font-mono text-xs font-bold flex items-center gap-1 border border-border"
              >
                <span>Dismiss</span>
                <i class="ph-bold ph-caret-down"></i>
              </button>
            </div>

            {/* Reply Banner if Replying */}
            {replyTarget && (
              <div class="hw-inset rounded-xl p-2.5 flex items-start justify-between gap-2 border-l-4 border-l-forest">
                <div class="min-w-0">
                  <div class="font-mono text-xs font-bold text-forest">
                    Replying to @{replyTarget.sender} in #{replyTarget.channel}
                  </div>
                  <div class="text-xs text-muted truncate mt-0.5">
                    "{replyTarget.body}"
                  </div>
                </div>
                <button
                  type="button"
                  onclick="cancelComposerReply()"
                  class="tap-44 w-11 rounded-xl bg-card text-ink flex items-center justify-center shrink-0 border border-border"
                  title="Cancel reply"
                >
                  <i class="ph-bold ph-x"></i>
                </button>
              </div>
            )}

            <div class="grid grid-cols-3 gap-2">
              <div>
                <label class="block font-mono text-[11px] font-bold text-muted mb-1">Channel</label>
                <select
                  id="compose-channel"
                  onchange="updateComposerDraft('channel', this.value)"
                  class="tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-mono text-xs font-bold text-ink"
                >
                  {state.channels.slice().sort().map(ch => (
                    <option key={ch} value={ch} selected={draft.channel === ch}>
                      #{ch}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label class="block font-mono text-[11px] font-bold text-muted mb-1">Priority</label>
                <select
                  id="compose-priority"
                  onchange="updateComposerDraft('priority', this.value)"
                  class="tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink"
                >
                  <option value="normal" selected={draft.priority === 'normal'}>Normal</option>
                  <option value="urgent" selected={draft.priority === 'urgent'}>Urgent</option>
                  <option value="low" selected={draft.priority === 'low'}>Low</option>
                </select>
              </div>
              <div>
                <label class="block font-mono text-[11px] font-bold text-muted mb-1">Audience</label>
                <select
                  id="compose-audience"
                  onchange="updateComposerDraft('audience', this.value)"
                  class="tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink"
                >
                  <option value="agents" selected={draft.audience === 'agents'}>Agents</option>
                  <option value="luki" selected={draft.audience === 'luki'}>Just me</option>
                </select>
              </div>
            </div>

            <textarea
              id="compose-body"
              rows={3}
              required
              oninput="updateComposerDraft('body', this.value)"
              onfocus="keepFieldAboveKeyboard(this)"
              placeholder="Write your message..."
              class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none leading-relaxed"
            >{draft.body}</textarea>

            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                onclick="collapseComposer()"
                class="hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold px-4 rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                onclick="sendOperatorMessage(event)"
                class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-5 rounded-xl flex items-center gap-1.5"
              >
                <i class="ph-bold ph-paper-plane-right"></i>
                <span>Send a message</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  return String(html);
}

export { renderMessageCard, renderThreadTimeline };
