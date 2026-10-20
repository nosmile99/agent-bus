import { state } from '../state.js';
import { applySwipeResistance, keepFieldAboveKeyboard } from '../utils.js';
import { getRootMessageId } from './feed.js';

/********************************************************************
 * BUS FEED GESTURES, COMPOSER CONTROLS & FILTERS
 ********************************************************************/

export let lastSwipeGestureTs = 0;
export const SWIPE_THRESHOLD_PX = 70;

interface ActiveMsgSwipe {
  msgId: number;
  pointerId: number;
  startX: number;
  startY: number;
  rawDx: number;
  lockedHoriz: boolean;
  aborted: boolean;
  fg: HTMLElement;
  bg: HTMLElement | null;
  icon: HTMLElement | null;
  label: HTMLElement | null;
}

export function openMessageThread(rootId: number, e?: Event): void {
  if (e) e.stopPropagation();
  state.openThreadMsgId = rootId;
  const rootMsg = state.messages.find(m => m.id === rootId);
  if (rootMsg) {
    state.composerDraft.channel = rootMsg.channel;
  }
  if (window.renderMainViewport) window.renderMainViewport(false);
}

export function openMessageThreadIfNotSwiped(rootId: number, e?: Event): void {
  if (Date.now() - lastSwipeGestureTs < 320) {
    if (e) e.stopPropagation();
    return;
  }
  openMessageThread(rootId, e);
}

export function closeMessageThread(): void {
  state.openThreadMsgId = null;
  if (window.renderMainViewport) window.renderMainViewport(false);
}

// Physical swipe right on a message = drag card with resistance, reveal reply track, snap back smoothly, then open reply composer
let activeMsgSwipe: ActiveMsgSwipe | null = null;

export function handleMsgPointerDown(e: PointerEvent, msgId: number): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('button, a, input, select, textarea')) return;

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

export function handleMsgPointerMove(e: PointerEvent): void {
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

export function handleMsgPointerUp(e: PointerEvent): void {
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
  const onFinish = (): void => {
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

export function cleanupMsgPointerListeners(): void {
  window.removeEventListener('pointermove', handleMsgPointerMove as EventListener);
  window.removeEventListener('pointerup', handleMsgPointerUp as EventListener);
  window.removeEventListener('pointercancel', handleMsgPointerUp as EventListener);
}

export function startReplyToMessage(msgId: number, e?: Event): void {
  if (e) e.stopPropagation();
  const target = state.messages.find(m => m.id === msgId);
  if (!target) return;
  state.composerDraft.reply_to = target.id;
  state.composerDraft.channel = target.channel;
  state.composerExpanded = true;
  if (window.renderMainViewport) window.renderMainViewport(true);
  setTimeout(() => {
    const ta = document.getElementById('compose-body') as HTMLTextAreaElement | null;
    if (ta) {
      ta.focus();
      keepFieldAboveKeyboard(ta);
    }
  }, 40);
}

export function cancelComposerReply(): void {
  state.composerDraft.reply_to = null;
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function scrollToQuotedMessage(targetId: number, e?: Event): void {
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

export function expandComposer(): void {
  if (state.msgFilter.channel !== 'ALL' && !state.composerDraft.reply_to) {
    state.composerDraft.channel = state.msgFilter.channel;
  }
  state.composerExpanded = true;
  if (window.renderMainViewport) window.renderMainViewport(true);
  setTimeout(() => {
    const ta = document.getElementById('compose-body') as HTMLTextAreaElement | null;
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      keepFieldAboveKeyboard(ta);
    }
  }, 40);
}

export function collapseComposer(): void {
  state.composerExpanded = false;
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function updateComposerDraft(field: 'channel' | 'priority' | 'audience' | 'body', value: string): void {
  state.composerDraft[field] = value;
}

export function setMsgFilter(key: 'channel' | 'sender' | 'priority' | 'q', val: string): void {
  state.msgFilter[key] = val;
  if (key === 'channel' && val !== 'ALL') {
    state.composerDraft.channel = val;
  }
  if (window.renderMainViewport) window.renderMainViewport(true);
  if (key === 'q') {
    const input = document.getElementById('msg-search-input') as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.setSelectionRange(val.length, val.length);
    }
  }
}

// Window globals
const win = window as unknown as Record<string, unknown>;
win.openMessageThread = openMessageThread;
win.openMessageThreadIfNotSwiped = openMessageThreadIfNotSwiped;
win.closeMessageThread = closeMessageThread;
win.handleMsgPointerDown = handleMsgPointerDown;
win.handleMsgPointerMove = handleMsgPointerMove;
win.handleMsgPointerUp = handleMsgPointerUp;
win.startReplyToMessage = startReplyToMessage;
win.cancelComposerReply = cancelComposerReply;
win.scrollToQuotedMessage = scrollToQuotedMessage;
win.expandComposer = expandComposer;
win.collapseComposer = collapseComposer;
win.updateComposerDraft = updateComposerDraft;
win.setMsgFilter = setMsgFilter;
