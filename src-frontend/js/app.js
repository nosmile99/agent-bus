import { busAuth, handleLogin, showLogin, hideLogin, doSignOut, setLoginSuccessHandler } from './api.js';
import { state, loadAll, refreshTasks, refreshMessages, loadTaskDetail, manualRefresh, updateHeaderTelemetry } from './state.js';
import { startPoller, pollOnce, handlePollEvent, renderResyncBanner, resyncFromServer } from './poller.js';
import { showToast } from './components/toast.js';
import {
  showCustomModal,
  openModal,
  closeTopModal,
  openAdminModal,
  changeAdminPassword,
  exportBusDump,
  openUnifiedPollSheet,
  togglePollInspectorScope
} from './components/modal.js';
import {
  openTaskDrawer,
  closeTaskDrawer,
  updateTaskDraftField,
  commitTaskDraftIfNeeded,
  renderTaskDrawer
} from './components/drawer.js';
import {
  horizScrolls,
  keepFieldAboveKeyboard,
  copyTokenText,
  escapeHtml
} from './utils.js';

// Views
import { renderNeedsYouView } from './views/needs-you.js';
import { renderKanbanView, scrollToKanbanColumn } from './views/kanban.js';
import {
  applySwipeResistance,
  openTaskDrawerIfNotSwiped,
  handleKanbanDragStart,
  handleKanbanDragOver,
  handleKanbanDragLeave,
  handleKanbanDrop,
  handleTaskPointerDown,
  handleTaskPointerMove,
  handleTaskPointerUp,
  cleanupTaskPointerListeners,
  clearTaskSwipe,
  quickCompleteTask,
  quickCycleAssignee
} from './views/kanban-dnd.js';
import {
  selectProject,
  updateKanbanSearch,
  toggleKanbanFilterDrawer,
  setKanbanFilter,
  resetKanbanFilters,
  requestTaskStatusChange,
  openBlockedKindPicker,
  confirmSetTaskBlocked,
  quickUnblockAndReplyModal,
  executeQuickUnblock,
  manualAssignTask,
  updateTaskPriority,
  setTaskDueOffset,
  touchTaskActivity
} from './views/kanban-actions.js';
import {
  clearTaskNotes,
  addTaskLabel,
  removeTaskLabel,
  toggleTodoItem,
  addTodoItem,
  deleteTodoItem,
  postTaskComment,
  confirmDeleteTask,
  executeDeleteTask,
  openCreateTaskModal,
  executeCreateTask,
  openProjectModal,
  saveProjectModal,
  deleteProject
} from './views/kanban-modals.js';
import { renderMessagesView } from './views/feed.js';
import {
  openMessageThread,
  openMessageThreadIfNotSwiped,
  closeMessageThread,
  handleMsgPointerDown,
  handleMsgPointerMove,
  handleMsgPointerUp,
  cleanupMsgPointerListeners,
  startReplyToMessage,
  cancelComposerReply,
  scrollToQuotedMessage,
  expandComposer,
  collapseComposer,
  updateComposerDraft,
  setMsgFilter
} from './views/feed-gestures.js';
import {
  sendOperatorMessage,
  openEditMessageModal,
  executeEditMessage,
  confirmDeleteMessage,
  executeDeleteMessage,
  openChannelMembersModal,
  addChannelMember,
  addCustomChannelMember,
  removeChannelMember,
  openCreateChannelModal,
  executeCreateChannel,
  confirmDeleteChannel,
  executeDeleteChannel
} from './views/feed-actions.js';
import {
  renderAgentsView,
  generateHexToken,
  openRegisterAgentModal,
  executeRegisterAgent,
  rotateAgentToken,
  confirmRevokeAgent,
  executeRevokeAgent,
  toggleAgentTransport
} from './views/agents.js';

/********************************************************************
 * 4. NAVIGATION, THEME & SCROLL-PRESERVING VIEW RENDERER
 ********************************************************************/

export function initTheme() {
  try {
    const saved = localStorage.getItem('bus_op01_theme');
    state.darkMode = saved === 'dark';
  } catch (e) {
    state.darkMode = false;
  }
  applyThemeClass();
}

export function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  try {
    localStorage.setItem('bus_op01_theme', state.darkMode ? 'dark' : 'light');
  } catch (e) {}
  applyThemeClass();
}

export function applyThemeClass() {
  const root = document.documentElement;
  if (state.darkMode) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  const icon = document.getElementById('theme-toggle-icon');
  const label = document.getElementById('theme-toggle-label');
  if (icon && label) {
    if (state.darkMode) {
      icon.className = 'ph-bold ph-sun-dim text-lg text-amber-400';
      label.textContent = 'Light';
    } else {
      icon.className = 'ph-bold ph-moon text-lg';
      label.textContent = 'Dark';
    }
  }
}

export function switchMainTab(tab) {
  const changed = state.activeTab !== tab;
  state.activeTab = tab;
  if (tab !== 'messages') {
    state.openThreadMsgId = null;
  }
  renderNavState();
  renderMainViewport(!changed);
  if (changed) {
    const vp = document.getElementById('main-viewport');
    if (vp) vp.scrollTop = 0;
  }
}

export function renderNavState() {
  const tabs = ['messages', 'needs-you', 'kanban', 'agents'];
  tabs.forEach(t => {
    const btn = document.getElementById(`nav-${t}`);
    if (!btn) return;
    if (state.activeTab === t) {
      btn.className = 'tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition bg-ink text-paper shadow-[0_2px_0_#161615]';
    } else {
      btn.className = 'tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition text-muted hover:text-ink';
    }
  });
  updateHeaderTelemetry();
}

export function renderMainViewport(preserveScroll = true) {
  const vp = document.getElementById('main-viewport');
  if (!vp) return;

  const prevTop = preserveScroll ? vp.scrollTop : 0;
  if (preserveScroll) {
    vp.querySelectorAll('[data-scroll-id]').forEach(el => {
      horizScrolls[el.getAttribute('data-scroll-id')] = {
        left: el.scrollLeft,
        top: el.scrollTop
      };
    });
  }

  const bannerHtml = renderResyncBanner();
  if (state.activeTab === 'needs-you') {
    vp.innerHTML = bannerHtml + renderNeedsYouView();
  } else if (state.activeTab === 'kanban') {
    vp.innerHTML = bannerHtml + renderKanbanView();
  } else if (state.activeTab === 'messages') {
    vp.innerHTML = bannerHtml + renderMessagesView();
  } else if (state.activeTab === 'agents') {
    vp.innerHTML = bannerHtml + renderAgentsView();
  }

  if (preserveScroll) {
    vp.scrollTop = prevTop;
    vp.querySelectorAll('[data-scroll-id]').forEach(el => {
      const saved = horizScrolls[el.getAttribute('data-scroll-id')];
      if (saved) {
        el.scrollLeft = saved.left;
        el.scrollTop = saved.top;
      }
    });
  }
}

// Wire login success handler
setLoginSuccessHandler(async (user) => {
  await loadAll();
  state.adminUser = user;
  renderNavState();
  renderMainViewport(false);
  startPoller();
  showToast('Signed in', `Welcome back @${user}`, 'green');
});

// Expose all functions to window for HTML inline event handlers
Object.assign(window, {
  busAuth,
  state,
  initTheme,
  toggleDarkMode,
  applyThemeClass,
  switchMainTab,
  renderNavState,
  renderMainViewport,
  showLogin,
  hideLogin,
  handleLogin,
  doSignOut,
  loadAll,
  refreshTasks,
  refreshMessages,
  loadTaskDetail,
  manualRefresh,
  updateHeaderTelemetry,
  startPoller,
  pollOnce,
  handlePollEvent,
  renderResyncBanner,
  resyncFromServer,
  showToast,
  showCustomModal,
  openModal,
  closeTopModal,
  openAdminModal,
  changeAdminPassword,
  exportBusDump,
  openUnifiedPollSheet,
  togglePollInspectorScope,
  openTaskDrawer,
  closeTaskDrawer,
  updateTaskDraftField,
  commitTaskDraftIfNeeded,
  renderTaskDrawer,
  keepFieldAboveKeyboard,
  copyTokenText,
  escapeHtml,
  renderNeedsYouView,
  renderKanbanView,
  scrollToKanbanColumn,
  applySwipeResistance,
  openTaskDrawerIfNotSwiped,
  handleKanbanDragStart,
  handleKanbanDragOver,
  handleKanbanDragLeave,
  handleKanbanDrop,
  handleTaskPointerDown,
  handleTaskPointerMove,
  handleTaskPointerUp,
  cleanupTaskPointerListeners,
  clearTaskSwipe,
  quickCompleteTask,
  quickCycleAssignee,
  selectProject,
  updateKanbanSearch,
  toggleKanbanFilterDrawer,
  setKanbanFilter,
  resetKanbanFilters,
  requestTaskStatusChange,
  openBlockedKindPicker,
  confirmSetTaskBlocked,
  quickUnblockAndReplyModal,
  executeQuickUnblock,
  manualAssignTask,
  updateTaskPriority,
  setTaskDueOffset,
  touchTaskActivity,
  clearTaskNotes,
  addTaskLabel,
  removeTaskLabel,
  toggleTodoItem,
  addTodoItem,
  deleteTodoItem,
  postTaskComment,
  confirmDeleteTask,
  executeDeleteTask,
  openCreateTaskModal,
  executeCreateTask,
  openProjectModal,
  saveProjectModal,
  deleteProject,
  renderMessagesView,
  openMessageThread,
  openMessageThreadIfNotSwiped,
  closeMessageThread,
  handleMsgPointerDown,
  handleMsgPointerMove,
  handleMsgPointerUp,
  cleanupMsgPointerListeners,
  startReplyToMessage,
  cancelComposerReply,
  scrollToQuotedMessage,
  expandComposer,
  collapseComposer,
  updateComposerDraft,
  setMsgFilter,
  sendOperatorMessage,
  openEditMessageModal,
  executeEditMessage,
  confirmDeleteMessage,
  executeDeleteMessage,
  openChannelMembersModal,
  addChannelMember,
  addCustomChannelMember,
  removeChannelMember,
  openCreateChannelModal,
  executeCreateChannel,
  confirmDeleteChannel,
  executeDeleteChannel,
  renderAgentsView,
  generateHexToken,
  openRegisterAgentModal,
  executeRegisterAgent,
  rotateAgentToken,
  confirmRevokeAgent,
  executeRevokeAgent,
  toggleAgentTransport
});

// Boot application
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  if (busAuth.get()) {
    loadAll().then(() => {
      renderNavState();
      renderMainViewport(false);
      startPoller();
    }).catch(() => showLogin('Session expired — sign in again.'));
  } else {
    showLogin();
  }
});
