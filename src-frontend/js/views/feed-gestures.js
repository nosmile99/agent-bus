import { state } from '../state.js';
import { escapeHtml } from '../utils.js';

/********************************************************************
 * BUS FEED GESTURES, COMPOSER CONTROLS & FILTERS
 ********************************************************************/

    export function openMessageThread(rootId, e) {
      if (e) e.stopPropagation();
      state.openThreadMsgId = rootId;
      const rootMsg = state.messages.find(m => m.id === rootId);
      if (rootMsg) {
        state.composerDraft.channel = rootMsg.channel;
      }
      if (window.renderMainViewport) window.renderMainViewport(false);
    }

    export export function openMessageThreadIfNotSwiped(rootId, e) {
      if (Date.now() - lastSwipeGestureTs < 320) {
        if (e) e.stopPropagation();
        return;
      }
      openMessageThread(rootId, e);
    }

    export function closeMessageThread() {
      state.openThreadMsgId = null;
      if (window.renderMainViewport) window.renderMainViewport(false);
    }

    // Physical swipe right on a message = drag card with resistance, reveal reply track, snap back smoothly, then open reply composer
    let activeMsgSwipe = null;

    export function handleMsgPointerDown(e, msgId) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea')) return;

      const fg = document.getElementById(`msg-card-${msgId}`);
      const bg = document.getElementById(`msg-swipe-bg-${msgId}`);
      const icon = document.getElementById(`msg-swipe-icon-${msgId}`);
      const label = document.getElementById(`msg-swipe-label-${msgId}`);
      if (!fg) return;

      fg.classList.remove('swipe-snap');
      activeMsgSwipe = {
        msgId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        rawDx: 0,
        lockedHoriz: false,
        aborted: false,
        fg,
        bg,
        icon,
        label
      };

      window.addEventListener('pointermove', handleMsgPointerMove, { passive: false });
      window.addEventListener('pointerup', handleMsgPointerUp);
      window.addEventListener('pointercancel', handleMsgPointerUp);
    }

    export function handleMsgPointerMove(e) {
      if (!activeMsgSwipe || e.pointerId !== activeMsgSwipe.pointerId || activeMsgSwipe.aborted) return;
      const dx = e.clientX - activeMsgSwipe.startX;
      const dy = e.clientY - activeMsgSwipe.startY;

      if (!activeMsgSwipe.lockedHoriz) {
        if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
          activeMsgSwipe.aborted = true;
          cleanupMsgPointerListeners();
          return;
        }
        // Lock onto horizontal right-swipe (or slight left tug)
        if (dx > 8 && dx > Math.abs(dy) * 1.15) {
          activeMsgSwipe.lockedHoriz = true;
        } else if (dx < -14) {
          activeMsgSwipe.aborted = true;
          cleanupMsgPointerListeners();
          return;
        }
      }

      if (activeMsgSwipe.lockedHoriz) {
        if (e.cancelable) e.preventDefault();
        const clampedDx = Math.max(0, dx);
        activeMsgSwipe.rawDx = clampedDx;
        const damped = applySwipeResistance(clampedDx, SWIPE_THRESHOLD_PX);
        activeMsgSwipe.fg.style.transform = `translate3d(${damped}px, 0, 0)`;

        const past = clampedDx >= SWIPE_THRESHOLD_PX;
        if (activeMsgSwipe.bg) {
          activeMsgSwipe.bg.className = `swipe-bg px-4 flex items-center justify-start gap-2.5 rounded-2xl transition-colors duration-150 ${
            past ? 'bg-forest text-white' : 'bg-charcoal text-stone-200'
          }`;
        }
        if (activeMsgSwipe.icon) {
          activeMsgSwipe.icon.style.transform = `scale(${past ? 1.12 : 0.92})`;
        }
        if (activeMsgSwipe.label) {
          activeMsgSwipe.label.textContent = past ? 'Release to reply' : 'Swipe to reply';
        }
      }
    }

    export function handleMsgPointerUp(e) {
      if (!activeMsgSwipe || e.pointerId !== activeMsgSwipe.pointerId) return;
      const { msgId, lockedHoriz, rawDx, fg } = activeMsgSwipe;
      cleanupMsgPointerListeners();
      activeMsgSwipe = null;

      if (!lockedHoriz || !fg) return;

      lastSwipeGestureTs = Date.now();
      const passedThreshold = rawDx >= SWIPE_THRESHOLD_PX;

      // Smoothly animate card back to 0px first; only open composer after snap-back finishes
      fg.classList.add('swipe-snap');
      requestAnimationFrame(() => {
        fg.style.transform = 'translate3d(0px, 0, 0)';
      });

      let finished = false;
      const onFinish = () => {
        if (finished) return;
        finished = true;
        fg.removeEventListener('transitionend', onFinish);
        fg.classList.remove('swipe-snap');
        if (passedThreshold) {
          startReplyToMessage(msgId);
        }
      };

      fg.addEventListener('transitionend', onFinish);
      setTimeout(onFinish, 290);
    }

    export function cleanupMsgPointerListeners() {
      window.removeEventListener('pointermove', handleMsgPointerMove);
      window.removeEventListener('pointerup', handleMsgPointerUp);
      window.removeEventListener('pointercancel', handleMsgPointerUp);
    }

    export function startReplyToMessage(msgId, e) {
      if (e) e.stopPropagation();
      const target = state.messages.find(m => m.id === msgId);
      if (!target) return;
      state.composerDraft.reply_to = target.id;
      state.composerDraft.channel = target.channel;
      state.composerExpanded = true;
      if (window.renderMainViewport) window.renderMainViewport(true);
      setTimeout(() => {
        const ta = document.getElementById('compose-body');
        if (ta) {
          ta.focus();
          keepFieldAboveKeyboard(ta);
        }
      }, 40);
    }

    export function cancelComposerReply() {
      state.composerDraft.reply_to = null;
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function scrollToQuotedMessage(targetId, e) {
      if (e) e.stopPropagation();
      const targetEl = document.getElementById(`msg-card-${targetId}`);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.classList.remove('highlight-pulse');
        void targetEl.offsetWidth;
        targetEl.classList.add('highlight-pulse');
        return;
      }
      // If the original message is filtered out, clear filters or open its thread so it is visible
      const msg = state.messages.find(m => m.id === targetId);
      if (msg) {
        const rootId = getRootMessageId(msg);
        state.openThreadMsgId = rootId;
        if (window.renderMainViewport) window.renderMainViewport(false);
        setTimeout(() => {
          const el = document.getElementById(`msg-card-${targetId}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-pulse');
          }
        }, 50);
      }
    }

    export function expandComposer() {
      if (state.msgFilter.channel !== 'ALL' && !state.composerDraft.reply_to) {
        state.composerDraft.channel = state.msgFilter.channel;
      }
      state.composerExpanded = true;
      if (window.renderMainViewport) window.renderMainViewport(true);
      setTimeout(() => {
        const ta = document.getElementById('compose-body');
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
          keepFieldAboveKeyboard(ta);
        }
      }, 40);
    }

    export function collapseComposer() {
      state.composerExpanded = false;
      if (window.renderMainViewport) window.renderMainViewport(true);
    }

    export function updateComposerDraft(field, value) {
      state.composerDraft[field] = value;
    }

    export function setMsgFilter(key, val) {
      state.msgFilter[key] = val;
      if (key === 'channel' && val !== 'ALL') {
        state.composerDraft.channel = val;
      }
      if (window.renderMainViewport) window.renderMainViewport(true);
      if (key === 'q') {
        const input = document.getElementById('msg-search-input');
        if (input) {
          input.focus();
          input.setSelectionRange(val.length, val.length);
        }
      }
    }

