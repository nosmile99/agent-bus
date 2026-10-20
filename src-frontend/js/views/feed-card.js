import { state } from '../state.js';
import {
  escapeHtml,
  formatRelEpoch,
  formatFriendlyIsoTime,
  getAgentStyle,
  PRIORITY_LABELS,
  AUDIENCE_LABELS
} from '../utils.js';
import { getDirectAndThreadReplies, getRootMessageId } from './feed.js';

/********************************************************************
 * BUS FEED MESSAGE CARD & THREAD TIMELINE RENDERER
 ********************************************************************/

    export function renderMessageCard(m, isInsideThread = false) {
      const st = getAgentStyle(m.sender);
      const parentMsg = m.reply_to ? state.messages.find(p => p.id === m.reply_to) : null;
      const rootId = getRootMessageId(m);
      const replies = getDirectAndThreadReplies(rootId);
      const replyCount = replies.length;

      return `
        <div class="swipe-shell select-none" id="msg-swipe-shell-${m.id}">
          <!-- Physical Background Track Revealed While Swiping Right to Reply -->
          <div
            id="msg-swipe-bg-${m.id}"
            class="swipe-bg bg-charcoal text-stone-200 px-4 flex items-center justify-start gap-2.5 rounded-2xl transition-colors duration-150"
          >
            <span
              id="msg-swipe-icon-${m.id}"
              class="w-10 h-10 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center transition-transform duration-150"
            >
              <i class="ph-bold ph-arrow-bend-up-left text-lg"></i>
            </span>
            <div class="font-mono text-xs font-bold">
              <div id="msg-swipe-label-${m.id}">Swipe to reply</div>
              <div class="text-[10px] opacity-80">@${escapeHtml(m.sender)} • #${escapeHtml(m.channel)}</div>
            </div>
          </div>

          <!-- Foreground Draggable Message Card -->
          <article
            id="msg-card-${m.id}"
            onpointerdown="handleMsgPointerDown(event, ${m.id})"
            onclick="openMessageThreadIfNotSwiped(${rootId}, event)"
            class="swipe-fg hw-card rounded-2xl p-3.5 bg-card space-y-2.5 cursor-pointer relative ${m.priority === 'urgent' ? 'border-l-4 border-l-vermilion' : ''}"
          >
            <!-- Quote Strip if this message is a reply -->
            ${parentMsg ? `
              <button
                type="button"
                onclick="scrollToQuotedMessage(${parentMsg.id}, event)"
                class="w-full text-left hw-inset rounded-xl px-3 py-2 border-l-4 border-l-forest flex items-center justify-between gap-2 hover:bg-card transition"
              >
                <div class="min-w-0">
                  <div class="font-mono text-xs font-bold text-forest flex items-center gap-1">
                    <i class="ph-bold ph-arrow-bend-up-left"></i>
                    <span>Replying to @${escapeHtml(parentMsg.sender)}</span>
                  </div>
                  <div class="text-xs text-muted truncate mt-0.5">
                    "${escapeHtml(parentMsg.body)}"
                  </div>
                </div>
                <span class="font-mono text-[11px] text-muted shrink-0">Jump</span>
              </button>
            ` : ''}

            <!-- Top Author & Channel Row -->
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5 flex-wrap">
                <button onclick="event.stopPropagation(); setMsgFilter('sender', '${escapeHtml(m.sender)}')" class="tap-44 px-2.5 rounded-xl font-mono text-xs font-bold ${st.bg} ${st.text} border ${st.border} flex items-center gap-1">
                  @${escapeHtml(m.sender)}
                </button>
                <button onclick="event.stopPropagation(); setMsgFilter('channel', '${escapeHtml(m.channel)}')" class="tap-44 px-2.5 rounded-xl font-mono text-xs font-bold bg-recessed text-ink border border-border flex items-center">
                  #${escapeHtml(m.channel)}
                </button>
                ${m.priority === 'urgent' ? `<span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold">Urgent</span>` : ''}
                ${m.priority === 'low' ? `<span class="font-mono text-[11px] bg-stone-200 text-stone-700 px-2 py-0.5 rounded-md font-semibold">Low</span>` : ''}
                ${m.audience === 'luki' ? `
                  <span class="font-mono text-[11px] px-2 py-0.5 rounded-md bg-amber-200 text-amber-950 border border-amber-700 font-bold">
                    Just me
                  </span>
                ` : ''}
              </div>

              <!-- 44px Ergonomic Action Buttons (Reply, Edit, Delete) -->
              <div class="flex items-center gap-1" onclick="event.stopPropagation()">
                <button onclick="startReplyToMessage(${m.id}, event)" class="tap-44 w-11 rounded-xl bg-recessed hover:bg-ink hover:text-paper text-ink flex items-center justify-center transition" title="Reply to message">
                  <i class="ph-bold ph-arrow-bend-up-left text-base"></i>
                </button>
                <button onclick="openEditMessageModal(${m.id})" class="tap-44 w-11 rounded-xl bg-recessed hover:bg-ink hover:text-paper text-ink flex items-center justify-center transition" title="Edit message">
                  <i class="ph-bold ph-pencil-simple text-base"></i>
                </button>
                <button onclick="confirmDeleteMessage(${m.id})" class="tap-44 w-11 rounded-xl bg-recessed hover:bg-vermilion hover:text-white text-muted flex items-center justify-center transition" title="Delete message">
                  <i class="ph-bold ph-trash text-base"></i>
                </button>
              </div>
            </div>

            <!-- Message Body (>=14px / text-sm for easy reading) -->
            <p class="text-sm text-ink leading-relaxed break-words whitespace-pre-wrap">${escapeHtml(m.body)}</p>

            <!-- Footer: Friendly Time + Thread Count -->
            <div class="flex items-center justify-between font-mono text-xs text-muted pt-1.5 border-t border-border/60">
              <span>${formatFriendlyIsoTime(m.ts)} • ${formatRelIso(m.ts)}</span>
              <div class="flex items-center gap-2">
                ${!isInsideThread && replyCount > 0 ? `
                  <span class="text-forest font-bold flex items-center gap-1">
                    <i class="ph-bold ph-chats-circle"></i>
                    ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                ` : `
                  <span class="text-muted flex items-center gap-1">
                    <i class="ph-bold ph-chat-teardrop"></i> Thread
                  </span>
                `}
              </div>
            </div>
          </article>
        </div>
      `;
    }

    export function renderThreadTimeline(rootMsg) {
      const replies = getDirectAndThreadReplies(rootMsg.id);
      return `
        <div class="p-3.5 pb-24 space-y-3.5">
          <!-- Back to Timeline Bar -->
          <div class="hw-card rounded-2xl p-2.5 bg-card flex items-center justify-between gap-2">
            <button onclick="closeMessageThread()" class="tap-44 px-3 rounded-xl bg-recessed text-ink font-mono text-xs font-bold flex items-center gap-1.5 border border-border">
              <i class="ph-bold ph-arrow-left text-base"></i>
              <span>Back to Bus Feed</span>
            </button>
            <span class="font-serif font-bold text-base text-ink pr-2">
              Thread in #${escapeHtml(rootMsg.channel)}
            </span>
          </div>

          <!-- Original Post on Top -->
          <div class="space-y-1.5">
            <div class="font-mono text-xs font-bold uppercase text-muted px-1">Original Post</div>
            ${renderMessageCard(rootMsg, true)}
          </div>

          <!-- Replies Underneath in Chronological Order -->
          <div class="space-y-2.5 pt-1">
            <div class="font-mono text-xs font-bold uppercase text-muted px-1">
              Replies (${replies.length})
            </div>
            ${replies.length === 0 ? `
              <div class="hw-inset rounded-2xl p-6 text-center text-sm text-muted">
                No replies yet. Swipe right on the post above or tap below to reply.
              </div>
            ` : replies.map(r => `
              <div class="pl-3 border-l-2 border-forest">
                ${renderMessageCard(r, true)}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

