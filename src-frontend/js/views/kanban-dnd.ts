import { state } from '../state.js';
import { openTaskDrawer } from '../components/drawer.js';
import { applySwipeResistance } from '../utils.js';
import { requestTaskStatusChange, manualAssignTask } from './kanban-actions.js';

/********************************************************************
 * KANBAN DRAG-AND-DROP & PHYSICAL TASK CARD SWIPE GESTURES
 ********************************************************************/

let draggedTaskId: number | null = null;
export let lastSwipeGestureTs = 0;

export function openTaskDrawerIfNotSwiped(e: Event | undefined, taskId: number): void {
  if (Date.now() - lastSwipeGestureTs < 320) {
    if (e) e.stopPropagation();
    return;
  }
  openTaskDrawer(taskId);
}

export function handleKanbanDragStart(e: DragEvent, taskId: number): void {
  draggedTaskId = taskId;
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', String(taskId));
    e.dataTransfer.effectAllowed = 'move';
  }
}

export function handleKanbanDragOver(e: DragEvent): void {
  e.preventDefault();
  const col = e.currentTarget as HTMLElement | null;
  if (col && !col.classList.contains('kanban-drop-active')) {
    col.classList.add('kanban-drop-active');
  }
}

export function handleKanbanDragLeave(e: DragEvent): void {
  const col = e.currentTarget as HTMLElement | null;
  if (col) col.classList.remove('kanban-drop-active');
}

export function handleKanbanDrop(e: DragEvent, targetStatus: string): void {
  e.preventDefault();
  const col = e.currentTarget as HTMLElement | null;
  if (col) col.classList.remove('kanban-drop-active');
  const id = draggedTaskId || Number(e.dataTransfer?.getData('text/plain'));
  draggedTaskId = null;
  if (!id) return;
  void requestTaskStatusChange(id, targetStatus);
}

// Physical touch/pointer swipe on task card with resistance, background icon, and snap-back before action
export const SWIPE_THRESHOLD_PX = 70;

interface ActiveTaskSwipe {
  taskId: number;
  pointerId: number;
  startX: number;
  startY: number;
  rawDx: number;
  lockedHoriz: boolean;
  aborted: boolean;
  fg: HTMLElement;
  bg: HTMLElement | null;
  leftHint: HTMLElement | null;
  rightHint: HTMLElement | null;
  strip: HTMLElement | null;
}

let activeTaskSwipe: ActiveTaskSwipe | null = null;

export function handleTaskPointerDown(e: PointerEvent, taskId: number): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('button, a, input, select, textarea')) return;

  const fg = document.getElementById(`task-swipe-fg-${taskId}`);
  const bg = document.getElementById(`task-swipe-bg-${taskId}`);
  const leftHint = document.getElementById(`task-swipe-left-hint-${taskId}`);
  const rightHint = document.getElementById(`task-swipe-right-hint-${taskId}`);
  const strip = document.getElementById('kanban-board-strip');
  if (!fg) return;

  fg.classList.remove('swipe-snap');
  activeTaskSwipe = {
    taskId,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    rawDx: 0,
    lockedHoriz: false,
    aborted: false,
    fg,
    bg,
    leftHint,
    rightHint,
    strip
  };

  window.addEventListener('pointermove', handleTaskPointerMove, { passive: false });
  window.addEventListener('pointerup', handleTaskPointerUp);
  window.addEventListener('pointercancel', handleTaskPointerUp);
}

export function handleTaskPointerMove(e: PointerEvent): void {
  if (!activeTaskSwipe || e.pointerId !== activeTaskSwipe.pointerId || activeTaskSwipe.aborted) return;
  const dx = e.clientX - activeTaskSwipe.startX;
  const dy = e.clientY - activeTaskSwipe.startY;

  if (!activeTaskSwipe.lockedHoriz) {
    if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
      activeTaskSwipe.aborted = true;
      cleanupTaskPointerListeners();
      return;
    }
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      activeTaskSwipe.lockedHoriz = true;
      if (activeTaskSwipe.strip) {
        activeTaskSwipe.strip.style.overflowX = 'hidden';
      }
      activeTaskSwipe.fg.setAttribute('draggable', 'false');
    }
  }

  if (activeTaskSwipe.lockedHoriz) {
    if (e.cancelable) e.preventDefault();
    activeTaskSwipe.rawDx = dx;
    const damped = applySwipeResistance(dx, SWIPE_THRESHOLD_PX);
    activeTaskSwipe.fg.style.transform = `translate3d(${damped}px, 0, 0)`;

    const past = Math.abs(dx) >= SWIPE_THRESHOLD_PX;
    if (activeTaskSwipe.bg) {
      activeTaskSwipe.bg.className = `swipe-bg px-4 flex items-center justify-between rounded-2xl transition-colors duration-150 ${
        past ? 'bg-forest text-white' : 'bg-charcoal text-stone-300'
      }`;
    }
    if (activeTaskSwipe.leftHint && activeTaskSwipe.rightHint) {
      activeTaskSwipe.leftHint.style.opacity = dx > 0 ? '1' : '0.15';
      activeTaskSwipe.leftHint.style.transform = `scale(${past && dx > 0 ? 1.08 : 0.95})`;
      activeTaskSwipe.rightHint.style.opacity = dx < 0 ? '1' : '0.15';
      activeTaskSwipe.rightHint.style.transform = `scale(${past && dx < 0 ? 1.08 : 0.95})`;
    }
  }
}

export function handleTaskPointerUp(e: PointerEvent): void {
  if (!activeTaskSwipe || e.pointerId !== activeTaskSwipe.pointerId) return;
  const { taskId, lockedHoriz, rawDx, fg, strip } = activeTaskSwipe;
  cleanupTaskPointerListeners();
  activeTaskSwipe = null;

  if (strip) {
    strip.style.overflowX = '';
  }
  if (fg) {
    fg.setAttribute('draggable', 'true');
  }

  if (!lockedHoriz || !fg) return;

  lastSwipeGestureTs = Date.now();
  const passedThreshold = Math.abs(rawDx) >= SWIPE_THRESHOLD_PX;

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
      state.swipedTaskId = state.swipedTaskId === taskId ? null : taskId;
      if (window.renderMainViewport) window.renderMainViewport(true);
    }
  };

  fg.addEventListener('transitionend', onFinish);
  setTimeout(onFinish, 290);
}

export function cleanupTaskPointerListeners(): void {
  window.removeEventListener('pointermove', handleTaskPointerMove as EventListener);
  window.removeEventListener('pointerup', handleTaskPointerUp as EventListener);
  window.removeEventListener('pointercancel', handleTaskPointerUp as EventListener);
}

export function clearTaskSwipe(e?: Event): void {
  if (e) e.stopPropagation();
  state.swipedTaskId = null;
  if (window.renderMainViewport) window.renderMainViewport(true);
}

export function quickCompleteTask(taskId: number, e?: Event): void {
  if (e) e.stopPropagation();
  state.swipedTaskId = null;
  void requestTaskStatusChange(taskId, 'done');
}

export function quickCycleAssignee(taskId: number, e?: Event): void {
  if (e) e.stopPropagation();
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  const order: (string | null)[] = [null, ...state.agents.map(a => a.agent)];
  const idx = order.indexOf(task.assignee);
  const next = order[(idx + 1) % order.length];
  state.swipedTaskId = null;
  void manualAssignTask(taskId, next || '');
}

// Window globals
const win = window as unknown as Record<string, unknown>;
win.openTaskDrawerIfNotSwiped = openTaskDrawerIfNotSwiped;
win.handleKanbanDragStart = handleKanbanDragStart;
win.handleKanbanDragOver = handleKanbanDragOver;
win.handleKanbanDragLeave = handleKanbanDragLeave;
win.handleKanbanDrop = handleKanbanDrop;
win.handleTaskPointerDown = handleTaskPointerDown;
win.handleTaskPointerMove = handleTaskPointerMove;
win.handleTaskPointerUp = handleTaskPointerUp;
win.clearTaskSwipe = clearTaskSwipe;
win.quickCompleteTask = quickCompleteTask;
win.quickCycleAssignee = quickCycleAssignee;
