// Admin panel HTML serving

export async function handleAdminPanel(_req: Request): Promise<Response> {
  // No auth on the HTML shell itself — the JS login form handles auth,
  // and all /admin/api/* endpoints still require Basic auth.
  // (Native browser Basic dialog breaks fetch() credential handling on mobile.)
  return new Response(ADMIN_PANEL_HTML, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

export const ADMIN_PANEL_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Bus — Operator Console</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,600;0,9..144,700;1,9..144,600&family=IBM+Plex+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/@phosphor-icons/web"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            paper: 'var(--bg-paper)',
            card: 'var(--bg-card)',
            recessed: 'var(--bg-recessed)',
            ink: 'var(--text-ink)',
            charcoal: 'var(--bg-charcoal)',
            muted: 'var(--text-muted)',
            border: 'var(--border-subtle)',
            vermilion: '#E03E1A',
            ochre: '#D98200',
            forest: '#1E6F50',
            cobalt: '#1D4ED8',
            plum: '#6D28D9'
          },
          fontFamily: {
            serif: ['"Fraunces"', 'serif'],
            sans: ['"Plus Jakarta Sans"', 'sans-serif'],
            mono: ['"IBM Plex Mono"', 'monospace'],
          }
        }
      }
    }
  </script>
  <style>
    :root {
      --bg-outer: #E2DDD3;
      --bg-paper: #F4F1EA;
      --bg-card: #FAF8F5;
      --bg-recessed: #EAE5DC;
      --text-ink: #161615;
      --bg-charcoal: #262523;
      --text-muted: #6E6A63;
      --border-subtle: #D6D0C4;
      --hw-border: #161615;
      --hw-shadow: #161615;
      --hw-inset-border: #C8C1B4;
      --caution-red-a: #FEE2E2;
      --caution-red-b: #FECACA;
      --caution-amber-a: #FEF3C7;
      --caution-amber-b: #FDE68A;
    }
    html.dark {
      --bg-outer: #0D0C0B;
      --bg-paper: #171614;
      --bg-card: #211F1C;
      --bg-recessed: #121110;
      --text-ink: #F2EFE9;
      --bg-charcoal: #1D1B18;
      --text-muted: #9E988E;
      --border-subtle: #35322D;
      --hw-border: #090908;
      --hw-shadow: #090908;
      --hw-inset-border: #2E2B27;
      --caution-red-a: #3B1815;
      --caution-red-b: #4C1D19;
      --caution-amber-a: #382810;
      --caution-amber-b: #493414;
    }
    * {
      -webkit-tap-highlight-color: transparent;
      box-sizing: border-box;
    }
    body {
      background-color: var(--bg-outer);
      color: var(--text-ink);
      font-family: 'Plus Jakarta Sans', sans-serif;
      overscroll-behavior-y: none;
      margin: 0;
      padding: 0;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    /* Custom tactile shadows & borders */
    .hw-card {
      background-color: var(--bg-card);
      border: 1.5px solid var(--hw-border);
      box-shadow: 0 3px 0 var(--hw-shadow);
      transition: transform 0.08s ease, box-shadow 0.08s ease, background-color 0.15s ease;
    }
    html.dark .hw-card {
      border-color: #3A3630;
      box-shadow: 0 3px 0 #090908;
    }
    .hw-card-active:active {
      transform: translateY(2px);
      box-shadow: 0 1px 0 var(--hw-shadow);
    }
    .hw-card-subtle {
      background-color: var(--bg-card);
      border: 1.5px solid var(--border-subtle);
      box-shadow: 0 2px 0 var(--border-subtle);
    }
    .hw-btn {
      border: 1.5px solid var(--hw-border);
      box-shadow: 0 2.5px 0 var(--hw-shadow);
      transition: all 0.08s ease;
    }
    html.dark .hw-btn {
      border-color: #3E3A34;
      box-shadow: 0 2.5px 0 #080807;
    }
    .hw-btn:active {
      transform: translateY(2px);
      box-shadow: 0 0.5px 0 var(--hw-shadow);
    }
    .hw-inset {
      background-color: var(--bg-recessed);
      border: 1.5px solid var(--hw-inset-border);
      box-shadow: inset 0 2px 3px rgba(0,0,0,0.12);
    }
    /* Diagonal caution stripe for blocked / stale */
    .caution-stripe-red {
      background: repeating-linear-gradient(
        -45deg,
        var(--caution-red-a),
        var(--caution-red-a) 8px,
        var(--caution-red-b) 8px,
        var(--caution-red-b) 16px
      );
    }
    .caution-stripe-amber {
      background: repeating-linear-gradient(
        -45deg,
        var(--caution-amber-a),
        var(--caution-amber-a) 8px,
        var(--caution-amber-b) 8px,
        var(--caution-amber-b) 16px
      );
    }
    /* Adapt hardcoded light utility pills in dark mode while keeping identical warm craft */
    html.dark .bg-stone-200 { background-color: #2C2925 !important; color: #E6E1D8 !important; border-color: #46413A !important; }
    html.dark .bg-stone-100 { background-color: #24221F !important; color: #A8A298 !important; }
    html.dark .bg-indigo-100 { background-color: #232544 !important; color: #E0E7FF !important; border-color: #5B63B7 !important; }
    html.dark .bg-emerald-100 { background-color: #143327 !important; color: #D1FAE5 !important; border-color: #2D7A5B !important; }
    html.dark .bg-amber-100, html.dark .bg-amber-200, html.dark .bg-amber-300 { background-color: #3D2B12 !important; color: #FDE68A !important; border-color: #926018 !important; }
    html.dark .bg-rose-100, html.dark .bg-rose-200, html.dark .bg-rose-50 { background-color: #3D1A1A !important; color: #FECDD3 !important; border-color: #9F2D2D !important; }
    /* Hide scrollbars cleanly while keeping scrollability */
    .no-scrollbar::-webkit-scrollbar {
      display: none;
    }
    .no-scrollbar {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    @keyframes pulse-fast {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    .led-blink {
      animation: pulse-fast 1.8s infinite ease-in-out;
    }
    @keyframes msg-highlight {
      0% { box-shadow: 0 0 0 4px #D98200, 0 3px 0 var(--hw-shadow); }
      100% { box-shadow: 0 0 0 0 rgba(217, 130, 0, 0), 0 3px 0 var(--hw-shadow); }
    }
    .highlight-pulse {
      animation: msg-highlight 1.6s ease-out;
    }
    /* Ensure 16px minimum on all form controls to prevent iOS/Android focus auto-zoom */
    input, textarea, select {
      font-size: 16px !important;
    }
    .tap-44 {
      min-width: 44px;
      min-height: 44px;
    }
    .kanban-drop-active {
      outline: 2.5px dashed #1E6F50;
      outline-offset: -2px;
      background-color: rgba(30, 111, 80, 0.08) !important;
    }
    /* Physical Swipe Track & Snap-back Transitions */
    .swipe-shell {
      position: relative;
      border-radius: 16px;
      overflow: hidden;
    }
    .swipe-fg {
      position: relative;
      z-index: 2;
      will-change: transform;
      touch-action: pan-y;
    }
    .swipe-snap {
      transition: transform 0.26s cubic-bezier(0.22, 1, 0.36, 1) !important;
    }
    .swipe-bg {
      position: absolute;
      inset: 0;
      z-index: 1;
      pointer-events: none;
    }
  </style>
</head>
<body class="min-h-screen flex justify-center items-start sm:py-4">

  <!-- LOGIN OVERLAY (real backend auth) -->
  <div id="loginOverlay" class="fixed inset-0 z-50 hidden items-center justify-center bg-ink/70 backdrop-blur-sm p-4">
    <form onsubmit="handleLogin(event)" class="w-full max-w-[340px] bg-paper rounded-2xl p-6 space-y-4 border-2 border-ink">
      <div>
        <div class="font-mono text-xs font-bold uppercase text-muted">Agent Bus</div>
        <h2 class="font-serif font-bold text-xl text-ink">Operator Sign In</h2>
      </div>
      <div id="loginError" class="hidden text-sm font-mono text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2"></div>
      <input id="loginUser" type="text" autocomplete="username" placeholder="Username" class="tap-44 w-full hw-inset rounded-xl px-3 py-2.5 font-mono text-ink" />
      <input id="loginPass" type="password" autocomplete="current-password" placeholder="Password" class="tap-44 w-full hw-inset rounded-xl px-3 py-2.5 font-mono text-ink" />
      <button id="loginBtn" type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-sm font-bold py-3 rounded-xl">Sign in</button>
    </form>
  </div>

  <!-- MOBILE HARDWARE CHASSIS (360px - 430px optimal, pinned viewport height so top/bottom bars stay sticky while scrolling) -->
  <div id="app-chassis" class="w-full max-w-[430px] h-[100dvh] sm:h-[880px] bg-paper sm:rounded-[28px] sm:border-[3px] sm:border-ink sm:shadow-[0_16px_40px_rgba(0,0,0,0.28)] flex flex-col relative overflow-hidden">

    <!-- SLIM SINGLE-ROW HARDWARE HEADER -->
    <header class="sticky top-0 bg-[#262523] text-[#F4F1EA] px-3 py-1.5 border-b-2 border-[#161615] select-none shrink-0 z-20 flex items-center justify-between gap-2 min-h-[54px]">
      <div class="flex items-center gap-2 min-w-0">
        <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 led-blink shadow-[0_0_8px_#34d399] shrink-0"></span>
        <div class="truncate">
          <span class="font-serif text-base font-bold tracking-tight text-[#F4F1EA]">Agent Bus</span>
          <span id="header-ws-pill" class="ml-1.5 font-mono text-[11px] bg-black/45 text-emerald-300 px-2 py-0.5 rounded-md border border-white/15">2/3 live</span>
        </div>
      </div>

      <div class="flex items-center gap-1.5 shrink-0">
        <!-- Dark Mode Hardware Toggle in Header -->
        <button onclick="toggleDarkMode()" id="header-theme-toggle" class="tap-44 px-3 rounded-xl bg-black/50 hover:bg-black text-[#F4F1EA] border border-white/15 flex items-center justify-center gap-1.5 active:scale-95 transition" title="Switch appearance">
          <i id="theme-toggle-icon" class="ph-bold ph-moon text-lg"></i>
          <span id="theme-toggle-label" class="font-mono text-xs font-bold">Dark</span>
        </button>

        <!-- Operator Settings & Activity Tools -->
        <button onclick="openAdminModal()" class="tap-44 w-11 rounded-xl bg-black/50 text-[#F4F1EA]/90 hover:text-white border border-white/15 flex items-center justify-center active:scale-95 transition" title="Operator settings & tools">
          <i class="ph-bold ph-sliders-horizontal text-lg"></i>
        </button>
      </div>
    </header>

    <!-- MAIN SCROLLABLE WORKSPACE -->
    <main id="main-viewport" class="flex-1 overflow-y-auto overflow-x-hidden pb-6 flex flex-col relative">
      <!-- Views dynamically rendered here -->
    </main>

    <!-- STICKY BOTTOM TACTILE NAVIGATION DECK (4 Content Tabs) -->
    <nav class="sticky bottom-0 bg-card border-t-2 border-ink px-2 py-1.5 grid grid-cols-4 gap-1.5 shrink-0 z-30 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
      <button onclick="switchMainTab('messages')" id="nav-messages" class="tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition">
        <div class="relative flex items-center justify-center">
          <i class="ph-bold ph-chats-teardrop text-xl"></i>
          <span id="nav-msg-badge" class="absolute -top-1.5 -right-4 bg-ink text-paper font-mono text-[10px] font-bold px-1.5 py-0.2 rounded-full border border-paper">10</span>
        </div>
        <span class="font-mono text-[11px] font-bold tracking-tight mt-0.5">Bus Feed</span>
      </button>

      <button onclick="switchMainTab('needs-you')" id="nav-needs-you" class="tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition">
        <div class="relative flex items-center justify-center">
          <i class="ph-bold ph-hand-palm text-xl"></i>
          <span id="nav-needs-badge" class="absolute -top-1.5 -right-3.5 bg-vermilion text-white font-mono text-[10px] font-bold px-1.5 py-0.2 rounded-full border border-ink shadow-sm">3</span>
        </div>
        <span class="font-mono text-[11px] font-bold tracking-tight mt-0.5">Needs You</span>
      </button>

      <button onclick="switchMainTab('kanban')" id="nav-kanban" class="tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition">
        <i class="ph-bold ph-kanban text-xl"></i>
        <span class="font-mono text-[11px] font-bold tracking-tight mt-0.5">Kanban</span>
      </button>

      <button onclick="switchMainTab('agents')" id="nav-agents" class="tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition">
        <i class="ph-bold ph-cpu text-xl"></i>
        <span class="font-mono text-[11px] font-bold tracking-tight mt-0.5">Agents</span>
      </button>
    </nav>

    <!-- SLIDE-OVER / BOTTOM SHEET OVERLAY CONTAINER -->
    <div id="modal-backdrop" onclick="closeTopModal(event)" class="fixed inset-0 bg-ink/60 backdrop-blur-[1px] z-40 hidden items-end sm:items-center justify-center">
      <div id="modal-sheet" onclick="event.stopPropagation()" class="w-full max-w-[430px] bg-paper border-t-2 sm:border-2 border-ink rounded-t-[24px] sm:rounded-[22px] max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">
        <!-- Dynamic modal content -->
      </div>
    </div>

    <!-- FULL-HEIGHT SINGLE-SCROLL TASK DOCUMENT DRAWER -->
    <div id="task-drawer" class="fixed inset-0 z-30 hidden flex-col items-center justify-end sm:justify-center bg-ink/50 backdrop-blur-[1px]">
      <div id="task-drawer-inner" class="w-full max-w-[430px] h-[96dvh] sm:h-[88vh] bg-paper border-t-2 sm:border-2 border-ink rounded-t-[24px] sm:rounded-[24px] flex flex-col overflow-hidden shadow-2xl">
        <!-- Populated when inspecting/editing a task document -->
      </div>
    </div>

    <!-- TOAST STACK -->
    <div id="toast-container" class="fixed top-16 left-1/2 -translate-x-1/2 w-[92%] max-w-[390px] z-50 pointer-events-none flex flex-col gap-2"></div>

  </div>

  <script>
    /********************************************************************
     * 0. REAL BACKEND API CLIENT (Basic auth, sessionStorage \`busBasic\`)
     ********************************************************************/
    const busAuth = {
      get() { return sessionStorage.getItem('busBasic'); },
      set(v) { sessionStorage.setItem('busBasic', v); },
      clear() { sessionStorage.removeItem('busBasic'); }
    };

    async function apiFetch(path, opts = {}) {
      const res = await fetch(path, {
        ...opts,
        headers: {
          'Authorization': 'Basic ' + (busAuth.get() || ''),
          'Content-Type': 'application/json',
          ...(opts.headers || {})
        }
      });
      if (res.status === 401) {
        busAuth.clear();
        showLogin('Session expired — sign in again.');
        throw new Error('unauthorized');
      }
      return res;
    }
    async function apiReq(method, path, body) {
      const r = await apiFetch(path, { method, body: body !== undefined ? JSON.stringify(body) : undefined });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || (method + ' ' + path + ' → ' + r.status));
      return data;
    }
    const api = {
      get: (p) => apiReq('GET', p),
      post: (p, b) => apiReq('POST', p, b || {}),
      put: (p, b) => apiReq('PUT', p, b || {}),
      del: (p) => apiReq('DELETE', p),
    };

    function showLogin(msg) {
      const ov = document.getElementById('loginOverlay');
      ov.classList.remove('hidden');
      ov.classList.add('flex');
      const err = document.getElementById('loginError');
      if (msg) { err.textContent = msg; err.classList.remove('hidden'); }
      else err.classList.add('hidden');
      setTimeout(() => document.getElementById('loginUser').focus(), 80);
    }
    function hideLogin() {
      const ov = document.getElementById('loginOverlay');
      ov.classList.add('hidden');
      ov.classList.remove('flex');
      document.getElementById('loginPass').value = '';
    }
    async function handleLogin(e) {
      e.preventDefault();
      const user = document.getElementById('loginUser').value.trim();
      const pass = document.getElementById('loginPass').value;
      if (!user || !pass) return;
      busAuth.set(btoa(user + ':' + pass));
      const btn = document.getElementById('loginBtn');
      btn.textContent = 'Verifying…';
      try {
        await loadAll();
        state.adminUser = user;
        hideLogin();
        renderNavState();
        renderMainViewport(false);
        startPoller();
        showToast('Signed in', \`Welcome back @\${user}\`, 'green');
      } catch (err) {
        busAuth.clear();
        showLogin('Invalid credentials — try again.');
      } finally {
        btn.textContent = 'Sign in';
      }
    }

    // Load all real data into state (replaces mock state)
    async function loadAll() {
      const [msgs, agents, channels, projects] = await Promise.all([
        api.get('/admin/api/messages'),
        api.get('/admin/api/registered'),
        api.get('/admin/api/channels'),
        api.get('/admin/api/kanban/projects'),
      ]);
      state.messages = (msgs.messages || []).map(m => ({
        id: m.id, channel: m.channel, sender: m.sender, body: m.body,
        ts: m.ts, priority: m.priority || 'normal', audience: m.audience || 'agents',
        reply_to: m.reply_to || null, edited: !!m.edited,
      }));
      state.agents = (agents.agents || []).map(a => ({
        agent: a.agent, role: a.role || '', created: a.created_at,
        last_seen: a.last_seen, rate: a.rate || { used: 0, limit: 10, windowSec: 60 },
        transport: a.transport || 'poll', connectedSince: a.connected_since || null,
        connections: a.connections || 0, channels: a.channels || ['all-agent'],
      }));
      state.channels = (channels.channels || []).map(c => c.name || c);
      // channel members map
      state.channelMembers = {};
      for (const c of (channels.channels || [])) {
        state.channelMembers[c.name || c] = c.members || [];
      }
      state.projects = (projects.projects || []).map(p => ({
        id: p.id, title: p.title, description: p.description || '',
        archived: !!p.archived, subscribers: p.subscribers || [],
      }));
      if (!state.activeProjectId && state.projects.length) {
        state.activeProjectId = state.projects[0].id;
      }
      await refreshTasks();
      // seed poll cursor from latest event
      // Note: a fresh load with cursor (0,0) always gets resync_required=true
      // from the server, but that's fine — we just synced everything, so we
      // are NOT in a resync-required state. That flag is for stale incremental
      // cursors, handled in pollOnce().
      try {
        const poll = await api.get('/poll?since_ts=0&since_id=0&admin=1');
        if (poll.events && poll.events.length) {
          const last = poll.events[poll.events.length - 1];
          state.pollCursor = { ts: last.ts, id: last.id };
          state.pollEvents = poll.events.slice(-50).reverse().map(evToPollRow);
        }
        state.resyncRequired = false;
        state.retentionCutoffTs = Math.floor(Date.now() / 1000) - 30 * 86400;
      } catch (e) { /* poll seed optional */ }
    }

    async function refreshTasks() {
      if (!state.activeProjectId) { state.tasks = []; return; }
      const data = await api.get(\`/admin/api/kanban/projects/\${state.activeProjectId}/tasks\`);
      state.tasks = (data.tasks || []).map(t => ({
        id: t.id, project_id: t.project_id, title: t.title,
        description: t.description || '', notes: t.notes || '',
        status: t.status, blocked_kind: t.blocked_kind || null,
        assignee: t.assignee || null, claimed_at: t.claimed_at || null,
        labels: t.labels || [], comment_count: t.comment_count || 0,
        status_changed_at: t.status_changed_at, created_at: t.created_at,
        updated_at: t.updated_at, last_activity_at: t.last_activity_at,
        created_by: t.created_by || null,
        todos: [], comments: [], // lazy-loaded in drawer
      }));
    }

    async function refreshMessages() {
      const msgs = await api.get('/admin/api/messages');
      state.messages = (msgs.messages || []).map(m => ({
        id: m.id, channel: m.channel, sender: m.sender, body: m.body,
        ts: m.ts, priority: m.priority || 'normal', audience: m.audience || 'agents',
        reply_to: m.reply_to || null, edited: !!m.edited,
      }));
    }

    // Load full task detail (todos + comments) for the drawer
    async function loadTaskDetail(taskId) {
      const d = await api.get(\`/admin/api/kanban/tasks/\${taskId}\`);
      const t = d.task || d;
      const task = state.tasks.find(x => x.id === taskId);
      if (task && t) {
        task.todos = (t.todos || []).map(td => ({
          id: td.id, task_id: taskId, text: td.text, done: td.done ? 1 : 0, sort_order: td.sort_order || 0,
        }));
        task.comments = (t.comments || []).map(c => ({
          id: c.id, task_id: taskId, author: c.author, body: c.body, ts: c.created_at || c.ts,
        }));
        task.labels = t.labels || task.labels;
        task.notes = t.notes !== undefined ? t.notes : task.notes;
        task.description = t.description !== undefined ? t.description : task.description;
        task.title = t.title || task.title;
        task.comment_count = t.comment_count || task.comments.length;
      }
      return task;
    }

    function evToPollRow(ev) {
      const p = ev.payload || {};
      return {
        id: ev.id, ts: ev.ts, type: ev.type,
        actor: ev.actor || null,
        project_id: ev.project_id || null,
        summary: p.summary || p.title || ev.type,
        adminOnly: ev.scope === 'admin',
        payload: p,
      };
    }

    async function manualRefresh() {
      try {
        await loadAll();
        renderMainViewport(true);
        if (state.openTaskId) renderTaskDrawer(true);
        showToast('Refreshed', 'All data reloaded from bus', 'green');
      } catch (e) {
        showToast('Refresh failed', e.message, 'red');
      }
    }

    // Real event poller (replaces simulateAgentActivity)
    let pollerTimer = null;
    function startPoller() {
      if (pollerTimer) return;
      pollerTimer = setInterval(pollOnce, 8000);
      pollOnce();
    }
    async function pollOnce() {
      if (!busAuth.get()) return;
      try {
        const c = state.pollCursor;
        const data = await api.get(\`/poll?since_ts=\${c.ts}&since_id=\${c.id}&admin=1\`);
        // Only treat as stale if we had a non-zero cursor (real incremental poll).
        // A zero cursor is initial sync, handled by loadAll().
        if (data.resync_required && (c.ts !== 0 || c.id !== 0)) {
          state.resyncRequired = true;
          renderMainViewport(true);
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
          renderMainViewport(true);
          if (state.openTaskId) renderTaskDrawer(true);
        }
        updateHeaderTelemetry();
      } catch (e) { /* silent — next tick retries */ }
    }
    // Returns true if the event changed visible state
    function handlePollEvent(ev) {
      const t = ev.type;
      if (t === 'bus.message' || t === 'bus.message.edited' || t === 'bus.message.deleted') {
        refreshMessages().then(() => renderMainViewport(true));
        showToast(t, evToPollRow(ev).summary, 'ink');
        return false; // refresh handles render
      }
      if (t.startsWith('kanban.')) {
        refreshTasks().then(() => { renderMainViewport(true); if (state.openTaskId) renderTaskDrawer(true); });
        const p = ev.payload || {};
        const row = evToPollRow(ev);
        showToast(t, p.title ? \`#\${p.id} \${p.title}\` : row.summary, t.includes('blocked') ? 'red' : 'green');
        return false;
      }
      if (t.startsWith('channel.') || t.startsWith('agent.')) {
        loadAll().then(() => renderMainViewport(true));
        showToast(t, evToPollRow(ev).summary, 'ink');
        return false;
      }
      return false;
    }

    /********************************************************************
     * 1. TIME & CONSTANTS
     ********************************************************************/
    // Real clock: backend timestamps are real ISO strings, so the
    // "now" used for stale/relative-time math must be live too.
    function currentEpoch() { return Math.floor(Date.now() / 1000); }
    let NOW_EPOCH = currentEpoch();
    setInterval(() => { NOW_EPOCH = currentEpoch(); }, 30000);
    function nowIso() {
      return new Date(NOW_EPOCH * 1000).toISOString();
    }

    const AGENT_COLORS = {
      nyx: { bg: 'bg-indigo-100', text: 'text-indigo-950', border: 'border-indigo-800', dot: 'bg-indigo-600', badge: '#3730A3' },
      nosmile99: { bg: 'bg-emerald-100', text: 'text-emerald-950', border: 'border-emerald-800', dot: 'bg-emerald-600', badge: '#065F46' },
      wren: { bg: 'bg-amber-100', text: 'text-amber-950', border: 'border-amber-800', dot: 'bg-amber-600', badge: '#92400E' },
      luki: { bg: 'bg-stone-200', text: 'text-stone-900', border: 'border-stone-700', dot: 'bg-forest', badge: '#1E6F50' }
    };

    function getAgentStyle(name) {
      return AGENT_COLORS[name] || { bg: 'bg-stone-200', text: 'text-stone-900', border: 'border-stone-700', dot: 'bg-stone-600' };
    }

    const PRIORITY_LABELS = {
      low: 'Low',
      normal: 'Normal',
      urgent: 'Urgent'
    };

    const AUDIENCE_LABELS = {
      agents: 'Agents',
      luki: 'Just me'
    };

    const STATUS_LABELS = {
      todo: 'To Do',
      doing: 'In Progress',
      blocked: 'Blocked',
      done: 'Done'
    };

    const BLOCKED_REASON_LABELS = {
      'waiting-human': 'Waiting on me',
      'waiting-task': 'Waiting on another task',
      'waiting-external': 'Waiting on external service'
    };

    function formatBlockedReason(kind) {
      return BLOCKED_REASON_LABELS[kind] || 'Waiting on me';
    }

    /********************************************************************
     * 2. RICH MOCK STATE
     ********************************************************************/
    const state = {
      activeTab: 'messages', // 'messages' (default far-left) | 'needs-you' | 'kanban' | 'agents'
      adminUser: 'luki',
      darkMode: false,

      // Bus Feed thread view state (null = main timeline, number = root message ID)
      openThreadMsgId: null,

      // Compact / Expanded Composer State for Bus Feed
      composerExpanded: false,
      composerDraft: {
        channel: 'all-agent',
        priority: 'normal',
        audience: 'agents',
        body: '',
        reply_to: null
      },

      // Unsaved task drafts keyed by taskId
      taskDrafts: {},

      // Swiped task card ID for quick action reveal
      swipedTaskId: null,
      swipedTaskDir: null,

      // Real data (loaded via loadAll())
      agents: [],
      channels: [],
      channelMembers: {},
      messages: [],
      msgFilter: { channel: 'ALL', sender: 'ALL', q: '' },
      activeProjectId: null,
      projects: [],
      tasks: [],
      kanbanFilter: { q: '', label: 'ALL', assignee: 'ALL' },

      // Unified poll cursor (composite ts + id)
      pollCursor: { ts: 0, id: 0 },
      retentionCutoffTs: 0,
      resyncRequired: false,
      pollInspectorAdminView: true,
      pollEvents: [],
      openTaskId: null,
    };

    /********************************************************************
     * 3. HELPER UTILITIES & SCROLL PRESERVATION
     ********************************************************************/
    function tsToEpoch(ts) {
      if (ts == null) return 0;
      if (typeof ts === 'number') return ts;
      const p = Date.parse(ts);
      return isNaN(p) ? 0 : Math.floor(p / 1000);
    }
    function isTaskStale(task) {
      return task.status === 'doing' && (NOW_EPOCH - tsToEpoch(task.last_activity_at)) > 86400;
    }

    function isTaskOverdue(task) {
      return Boolean(task.due_at && task.status !== 'done' && NOW_EPOCH > task.due_at);
    }

    function formatRelEpoch(epochSec) {
      const ep = tsToEpoch(epochSec);
      if (!ep) return '—';
      const diff = NOW_EPOCH - ep;
      const abs = Math.abs(diff);
      const mins = Math.floor(abs / 60);
      const hours = Math.floor(abs / 3600);
      const days = Math.floor(abs / 86400);

      if (diff >= 0) {
        if (abs < 60) return 'just now';
        if (mins < 60) return \`\${mins}m ago\`;
        if (hours < 48) return \`\${hours}h ago\`;
        return \`\${days}d ago\`;
      } else {
        if (mins < 60) return \`in \${mins}m\`;
        if (hours < 48) return \`in \${hours}h\`;
        return \`in \${days}d\`;
      }
    }

    function formatFriendlyIsoTime(isoStr) {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      return \`\${hh}:\${mm} UTC\`;
    }

    function formatRelIso(isoStr) {
      if (!isoStr) return 'never';
      const epoch = Math.floor(new Date(isoStr).getTime() / 1000);
      return formatRelEpoch(epoch);
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function getTaskDraft(task) {
      if (!state.taskDrafts[task.id]) {
        state.taskDrafts[task.id] = {
          title: task.title || '',
          description: task.description || '',
          notes: task.notes || '',
          commentDraft: '',
          dirty: false
        };
      }
      return state.taskDrafts[task.id];
    }

    const ADMIN_ONLY_EVENTS = new Set([
      'agent.registered',
      'agent.deregistered',
      'agent.token_issued',
      'agent.token_revoked'
    ]);

    // Legacy mock hook — real events arrive via pollOnce(). Kept as no-op
    // so any leftover calls don't break.
    function emitPollEvent(typeLabel, projectId, summaryText, forceAdminOnly = false) {
      // no-op: real backend emits events, poller picks them up
    }

    function renderResyncBanner() {
      if (!state.resyncRequired) return '';
      return \`
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
                Composite cursor <span class="font-mono font-bold">(\${state.pollCursor.ts}, #\${state.pollCursor.id})</span> is older than the retention window (<span class="font-mono">\${state.retentionCutoffTs}</span>). Incremental delta polling is paused until you resync state.
              </p>
            </div>
          </div>
          <button onclick="resyncFromServer()" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
            <i class="ph-bold ph-arrows-clockwise text-base"></i>
            <span>Resync from Server</span>
          </button>
        </div>
      \`;
    }

    async function resyncFromServer() {
      showToast('Resyncing...', 'Reloading all state from server', 'ink');
      try {
        await loadAll();
        state.resyncRequired = false;
        showToast('Resynced from server', 'All lists refreshed', 'green');
      } catch (_e) {
        showToast('Resync failed', _e.message, 'red');
      }
      renderMainViewport(true);
      if (!document.getElementById('modal-backdrop').classList.contains('hidden')) {
        openUnifiedPollSheet();
      }
    }

    function showToast(title, subtitle = '', tone = 'ink') {
      const container = document.getElementById('toast-container');
      const el = document.createElement('div');
      const toneClasses = tone === 'red'
        ? 'bg-vermilion text-white border-ink'
        : tone === 'green'
          ? 'bg-forest text-white border-ink'
          : 'bg-charcoal text-paper border-ink';

      el.className = \`\${toneClasses} border-2 rounded-xl px-3.5 py-2.5 shadow-[0_4px_0_#161615] flex items-center justify-between gap-2 pointer-events-auto transition-all duration-200\`;
      el.innerHTML = \`
        <div class="min-w-0">
          <div class="font-sans text-sm font-bold truncate">\${escapeHtml(title)}</div>
          \${subtitle ? \`<div class="font-sans text-xs opacity-90 truncate">\${escapeHtml(subtitle)}</div>\` : ''}
        </div>
        <i class="ph-bold ph-check-circle text-lg shrink-0 opacity-90"></i>
      \`;
      container.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-6px)';
        setTimeout(() => el.remove(), 200);
      }, 2500);
    }

    function getUserCommentCount(task) {
      return (task.comments || []).filter(c => c.author !== 'system').length;
    }

    function getWaitingHumanTasks() {
      return state.tasks
        .filter(t => t.status === 'blocked' && t.blocked_kind === 'waiting-human')
        .sort((a, b) => (a.status_changed_at || a.updated_at) - (b.status_changed_at || b.updated_at));
    }

    function updateHeaderTelemetry() {
      const waitingCount = getWaitingHumanTasks().length;
      const needsBadge = document.getElementById('nav-needs-badge');
      if (needsBadge) {
        needsBadge.textContent = waitingCount;
        needsBadge.style.display = waitingCount > 0 ? 'inline-block' : 'none';
      }

      const msgBadge = document.getElementById('nav-msg-badge');
      if (msgBadge) msgBadge.textContent = state.messages.length;

      const wsAgents = state.agents.filter(a => a.transport === 'ws').length;
      const wsPill = document.getElementById('header-ws-pill');
      if (wsPill) wsPill.textContent = \`\${wsAgents}/\${state.agents.length} live\`;
    }

    /********************************************************************
     * 4. NAVIGATION & SCROLL-PRESERVING VIEW RENDERER
     ********************************************************************/
    function initTheme() {
      try {
        const saved = localStorage.getItem('bus_op01_theme');
        state.darkMode = saved === 'dark';
      } catch (e) {
        state.darkMode = false;
      }
      applyThemeClass();
    }

    function toggleDarkMode() {
      state.darkMode = !state.darkMode;
      try {
        localStorage.setItem('bus_op01_theme', state.darkMode ? 'dark' : 'light');
      } catch (e) {}
      applyThemeClass();
    }

    function applyThemeClass() {
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

    function switchMainTab(tab) {
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

    function renderNavState() {
      const tabs = ['messages', 'needs-you', 'kanban', 'agents'];
      tabs.forEach(t => {
        const btn = document.getElementById(\`nav-\${t}\`);
        if (!btn) return;
        if (state.activeTab === t) {
          btn.className = 'tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition bg-ink text-paper shadow-[0_2px_0_#161615]';
        } else {
          btn.className = 'tap-44 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl relative transition text-muted hover:text-ink';
        }
      });
      updateHeaderTelemetry();
    }

    // Preserves vertical and horizontal scroll positions across re-renders
    function renderMainViewport(preserveScroll = true) {
      const vp = document.getElementById('main-viewport');
      if (!vp) return;

      const prevTop = preserveScroll ? vp.scrollTop : 0;
      if ( preserveScroll) {
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

    function keepFieldAboveKeyboard(el) {
      if (!el) return;
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 180);
    }

    /********************************************************************
     * 5. VIEW 1: "NEEDS YOU" (Cross-Project Operator Queue + Deduplicated Radar)
     ********************************************************************/
    function renderNeedsYouView() {
      const waitingTasks = getWaitingHumanTasks();

      // Deduplicated Radar: tasks that are stale OR overdue (excluding ones already in waitingTasks above)
      const waitingIds = new Set(waitingTasks.map(t => t.id));
      const radarTasks = state.tasks.filter(t => {
        if (waitingIds.has(t.id)) return false;
        return isTaskStale(t) || isTaskOverdue(t);
      });

      return \`
        <div class="p-3.5 space-y-4">
          <!-- Masthead -->
          <div class="hw-card rounded-2xl p-3.5 bg-card">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="font-mono text-[11px] uppercase tracking-wider text-vermilion font-bold">
                  Action Required Across All Projects
                </div>
                <h1 class="font-serif text-2xl font-bold text-ink leading-tight mt-0.5">
                  Needs You (\${waitingTasks.length})
                </h1>
              </div>
              <span class="font-mono text-[11px] bg-recessed text-ink border border-border px-2.5 py-1 rounded-lg font-bold">
                Oldest First
              </span>
            </div>
            <p class="text-sm text-muted mt-1.5 leading-relaxed">
              Tasks where an agent is paused waiting on your decision or sign-off, ordered by how long they have been waiting.
            </p>
          </div>

          <!-- Waiting on Human List -->
          \${waitingTasks.length === 0 ? \`
            <div class="hw-inset rounded-2xl p-8 text-center">
              <i class="ph-duotone ph-check-circle text-4xl text-forest"></i>
              <div class="font-serif text-lg font-bold mt-2">Zero Human Bottlenecks</div>
              <p class="text-sm text-muted mt-1">All agents are unblocked and executing autonomously.</p>
            </div>
          \` : waitingTasks.map((t, idx) => {
            const proj = state.projects.find(p => p.id === t.project_id);
            const blockedSecs = NOW_EPOCH - (t.status_changed_at || t.updated_at);
            const blockedHours = Math.max(1, Math.round(blockedSecs / 3600));
            const overdue = isTaskOverdue(t);
            const lastComment = (t.comments || []).filter(c => c.author !== 'system').slice(-1)[0];

            return \`
              <div class="hw-card rounded-2xl overflow-hidden">
                <!-- Caution Top Banner -->
                <div class="caution-stripe-red px-3.5 py-2 border-b border-ink flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-[11px] font-bold bg-vermilion text-white px-2 py-0.5 rounded">
                      #\${idx + 1} • Waiting \${blockedHours}h
                    </span>
                    <span class="font-mono text-xs font-bold text-ink">
                      \${escapeHtml(formatBlockedReason(t.blocked_kind))}
                    </span>
                  </div>
                  <span class="font-mono text-xs font-semibold text-ink/80">
                    Task #\${t.id}
                  </span>
                </div>

                <div class="p-3.5 space-y-3">
                  <!-- Project & Meta badges -->
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-mono text-xs bg-recessed border border-border px-2.5 py-0.5 rounded-md font-semibold text-ink">
                      \${escapeHtml(proj ? proj.title : 'Project #' + t.project_id)}
                    </span>
                    \${renderPriorityPill(t.priority)}
                    \${overdue ? \`<span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold">Overdue</span>\` : ''}
                  </div>

                  <!-- Title & Description -->
                  <div onclick="openTaskDrawer(\${t.id})" class="cursor-pointer group">
                    <h3 class="font-serif text-lg font-bold text-ink group-hover:text-vermilion transition leading-snug">
                      \${escapeHtml(t.title)}
                    </h3>
                    \${t.description ? \`<p class="text-sm text-muted mt-1 leading-relaxed">\${escapeHtml(t.description)}</p>\` : ''}
                  </div>

                  <!-- Last Agent Message / Context -->
                  \${lastComment ? \`
                    <div class="hw-inset rounded-xl p-3 text-sm">
                      <div class="flex items-center justify-between font-mono text-xs text-muted mb-1">
                        <span>Latest note from <strong class="text-ink">@\${escapeHtml(lastComment.author)}</strong></span>
                        <span>\${formatRelEpoch(lastComment.ts)}</span>
                      </div>
                      <p class="text-ink font-medium leading-snug">"\${escapeHtml(lastComment.body)}"</p>
                    </div>
                  \` : ''}

                  <!-- Quick Operator Decision Bar (All >=44px targets + Mark Done directly) -->
                  <div class="pt-1 flex flex-wrap items-center gap-2">
                    <button onclick="quickUnblockAndReplyModal(\${t.id})" class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
                      <i class="ph-bold ph-lock-key-open text-base"></i>
                      <span>Unblock</span>
                    </button>
                    <button onclick="quickCompleteTask(\${t.id}, event)" class="hw-btn tap-44 bg-card text-forest font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
                      <i class="ph-bold ph-check-circle text-base"></i>
                      <span>Mark done</span>
                    </button>
                    <button onclick="openTaskDrawer(\${t.id})" class="hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1">
                      <span>Open</span>
                      <i class="ph-bold ph-arrow-up-right text-sm"></i>
                    </button>
                  </div>
                </div>
              </div>
            \`;
          }).join('')}

          <!-- Secondary Watchlist: Stale (>24h Untouched) & Overdue (Deduplicated!) -->
          <div class="pt-2">
            <div class="flex items-center justify-between mb-2">
              <span class="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                Radar: Stale &amp; Overdue (\${radarTasks.length})
              </span>
            </div>

            \${radarTasks.length === 0 ? \`
              <div class="hw-inset rounded-xl p-4 text-center text-sm text-muted">
                No stale or overdue tasks outside your queue.
              </div>
            \` : \`
              <div class="space-y-2.5">
                \${radarTasks.map(t => {
                  const stale = isTaskStale(t);
                  const overdue = isTaskOverdue(t);
                  return \`
                    <div class="hw-card rounded-xl p-3.5 border-l-4 \${overdue ? 'border-l-vermilion' : 'border-l-ochre'} space-y-2.5">
                      <div class="flex items-center justify-between gap-2 flex-wrap">
                        <div class="flex items-center gap-1.5 flex-wrap">
                          \${stale ? \`
                            <span class="font-mono text-[11px] font-bold bg-amber-200 text-amber-950 border border-amber-700 px-2 py-0.5 rounded">
                              Stale • Quiet for \${Math.floor((NOW_EPOCH - tsToEpoch(t.last_activity_at))/3600)}h
                            </span>
                          \` : ''}
                          \${overdue ? \`
                            <span class="font-mono text-[11px] font-bold bg-rose-200 text-rose-950 border border-rose-700 px-2 py-0.5 rounded">
                              Overdue • Due \${formatRelEpoch(t.due_at)}
                            </span>
                          \` : ''}
                        </div>
                        <span class="font-mono text-xs text-muted">#\${t.id} • \${t.assignee ? '@' + t.assignee : 'Unassigned'}</span>
                      </div>

                      <div onclick="openTaskDrawer(\${t.id})" class="font-serif font-bold text-base text-ink cursor-pointer hover:underline">
                        \${escapeHtml(t.title)}
                      </div>

                      <div class="flex items-center gap-2 pt-1">
                        <button onclick="quickCompleteTask(\${t.id}, event)" class="hw-btn tap-44 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center gap-1.5">
                          <i class="ph-bold ph-check-circle"></i>
                          <span>Mark done</span>
                        </button>
                        \${stale ? \`
                          <button onclick="touchTaskActivity(\${t.id})" class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center gap-1.5">
                            <i class="ph-bold ph-bell-ringing"></i>
                            <span>Nudge agent</span>
                          </button>
                        \` : ''}
                        <button onclick="openTaskDrawer(\${t.id})" class="hw-btn tap-44 ml-auto bg-recessed text-ink font-mono text-xs font-bold px-3 rounded-xl">
                          Open
                        </button>
                      </div>
                    </div>
                  \`;
                }).join('')}
              </div>
            \`}
          </div>
        </div>
      \`;
    }

    /********************************************************************
     * 6. VIEW 2: KANBAN BOARD (One Column Per Status, Drag & Drop + Swipe + Tap Fallback)
     ********************************************************************/
    function getProjectDistinctLabels(projectId) {
      const set = new Set();
      state.tasks
        .filter(t => t.project_id === projectId)
        .forEach(t => (t.labels || []).forEach(l => set.add(l)));
      return Array.from(set).sort();
    }

    function renderKanbanView() {
      const currentProj = state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
      const projectLabels = getProjectDistinctLabels(currentProj.id);
      const kf = state.kanbanFilter;

      const allProjTasks = state.tasks.filter(t => t.project_id === currentProj.id);
      const filteredTasks = allProjTasks.filter(t => {
        if (kf.status !== 'ALL' && t.status !== kf.status) return false;
        if (kf.assignee !== 'ALL') {
          if (kf.assignee === 'UNASSIGNED' && t.assignee !== null) return false;
          if (kf.assignee !== 'UNASSIGNED' && t.assignee !== kf.assignee) return false;
        }
        if (kf.priority !== 'ALL' && t.priority !== kf.priority) return false;
        if (kf.label !== 'ALL' && !(t.labels || []).includes(kf.label)) return false;
        if (kf.blocked_kind !== 'ALL' && t.blocked_kind !== kf.blocked_kind) return false;
        if (kf.q.trim() !== '') {
          const needle = kf.q.trim().toLowerCase().replace(/[%_]/g, '');
          const hay = \`\${t.title || ''} \${t.description || ''}\`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      });

      const activeFilterCount = [
        kf.status !== 'ALL',
        kf.assignee !== 'ALL',
        kf.priority !== 'ALL',
        kf.label !== 'ALL',
        kf.blocked_kind !== 'ALL',
        kf.q.trim() !== ''
      ].filter(Boolean).length;

      const columns = [
        { id: 'todo', title: 'To Do', dot: 'bg-stone-500' },
        { id: 'doing', title: 'In Progress', dot: 'bg-ochre' },
        { id: 'blocked', title: 'Blocked', dot: 'bg-vermilion' },
        { id: 'done', title: 'Done', dot: 'bg-forest' }
      ];

      return \`
        <div class="p-3.5 space-y-3 flex-1 flex flex-col">
          <!-- Project Selector Deck -->
          <div class="hw-card rounded-2xl p-3 bg-card">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-[11px] uppercase tracking-wider text-muted font-bold">Active Project</span>
                  \${currentProj.archived ? \`<span class="font-mono text-[10px] bg-stone-800 text-white px-2 py-0.5 rounded">Archived</span>\` : ''}
                </div>
                <div class="relative mt-1">
                  <select onchange="selectProject(Number(this.value))" class="tap-44 w-full appearance-none bg-recessed border-1.5 border-ink rounded-xl px-3 py-2 pr-9 font-serif font-bold text-ink focus:outline-none">
                    \${state.projects.map(p => \`
                      <option value="\${p.id}" \${p.id === currentProj.id ? 'selected' : ''}>
                        \${escapeHtml(p.title)} (\${state.tasks.filter(t => t.project_id === p.id).length})
                      </option>
                    \`).join('')}
                  </select>
                  <i class="ph-bold ph-caret-up-down absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-ink"></i>
                </div>
              </div>

              <div class="flex items-center gap-1.5 shrink-0 pt-5">
                <button onclick="openProjectModal(\${currentProj.id})" class="hw-btn tap-44 w-11 rounded-xl bg-paper flex items-center justify-center text-ink" title="Project settings & access">
                  <i class="ph-bold ph-sliders-horizontal text-lg"></i>
                </button>
                <button onclick="openProjectModal(null)" class="hw-btn tap-44 w-11 rounded-xl bg-ink text-paper flex items-center justify-center" title="New Project">
                  <i class="ph-bold ph-folder-plus text-lg"></i>
                </button>
              </div>
            </div>

            \${currentProj.description ? \`
              <p class="text-sm text-muted mt-2 leading-relaxed">\${escapeHtml(currentProj.description)}</p>
            \` : ''}

            <!-- Project Subscribers Pill Bar -->
            <div class="mt-2.5 pt-2 border-t border-border flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-mono text-[11px] font-bold text-muted flex items-center gap-1">
                  <i class="ph-bold ph-users-three"></i> Access:
                </span>
                \${(currentProj.subscribers || []).length === 0 ? \`
                  <span class="font-mono text-[11px] bg-emerald-100 text-emerald-950 border border-emerald-700 px-2 py-0.5 rounded-md font-semibold">
                    All agents
                  </span>
                \` : currentProj.subscribers.map(ag => {
                  const st = getAgentStyle(ag);
                  return \`<span class="font-mono text-[11px] \${st.bg} \${st.text} border \${st.border} px-2 py-0.5 rounded-md font-bold">@\${escapeHtml(ag)}</span>\`;
                }).join('')}
              </div>
              <button onclick="openProjectModal(\${currentProj.id})" class="tap-44 px-2 font-mono text-xs underline font-bold text-ink shrink-0 flex items-center">
                Edit access
              </button>
            </div>
          </div>

          <!-- Search & Filter Bar -->
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <div class="relative flex-1">
                <i class="ph-bold ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-base"></i>
                <input
                  id="kanban-search-input"
                  type="text"
                  value="\${escapeHtml(kf.q)}"
                  oninput="updateKanbanSearch(this.value)"
                  placeholder="Search tasks..."
                  class="tap-44 w-full hw-inset rounded-xl pl-9 pr-9 py-2 font-medium text-ink placeholder:text-muted focus:outline-none focus:border-ink"
                />
                \${kf.q ? \`
                  <button onclick="updateKanbanSearch('')" class="tap-44 absolute right-1 top-1/2 -translate-y-1/2 text-muted hover:text-ink flex items-center justify-center">
                    <i class="ph-bold ph-x-circle text-lg"></i>
                  </button>
                \` : ''}
              </div>

              <button onclick="toggleKanbanFilterDrawer()" class="hw-btn tap-44 px-3 rounded-xl font-mono text-xs font-bold flex items-center gap-1.5 \${kf.showFilters || activeFilterCount > 0 ? 'bg-ink text-paper' : 'bg-card text-ink'}">
                <i class="ph-bold ph-funnel text-base"></i>
                <span>Filter</span>
                \${activeFilterCount > 0 ? \`<span class="bg-ochre text-white px-1.5 py-0.2 rounded-full text-[10px]">\${activeFilterCount}</span>\` : ''}
              </button>

              <button onclick="openCreateTaskModal()" class="hw-btn tap-44 px-3.5 rounded-xl bg-ink text-paper font-mono text-xs font-bold flex items-center gap-1 shrink-0">
                <i class="ph-bold ph-plus-bold text-sm"></i>
                <span>New Task</span>
              </button>
            </div>

            <!-- Collapsible Multi-Facet Filter Panel (Human Labels Only) -->
            \${kf.showFilters ? \`
              <div class="hw-card rounded-2xl p-3.5 bg-card space-y-3">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                    Filter Board
                  </span>
                  <button onclick="resetKanbanFilters()" class="tap-44 px-2 font-mono text-xs text-ink font-bold underline flex items-center">
                    Reset filters
                  </button>
                </div>

                <div class="grid grid-cols-2 gap-2.5">
                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Status</label>
                    <select onchange="setKanbanFilter('status', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" \${kf.status === 'ALL' ? 'selected' : ''}>All statuses</option>
                      <option value="todo" \${kf.status === 'todo' ? 'selected' : ''}>To Do</option>
                      <option value="doing" \${kf.status === 'doing' ? 'selected' : ''}>In Progress</option>
                      <option value="blocked" \${kf.status === 'blocked' ? 'selected' : ''}>Blocked</option>
                      <option value="done" \${kf.status === 'done' ? 'selected' : ''}>Done</option>
                    </select>
                  </div>

                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Assignee</label>
                    <select onchange="setKanbanFilter('assignee', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" \${kf.assignee === 'ALL' ? 'selected' : ''}>Anyone</option>
                      <option value="UNASSIGNED" \${kf.assignee === 'UNASSIGNED' ? 'selected' : ''}>Unassigned</option>
                      \${state.agents.map(a => \`<option value="\${a.agent}" \${kf.assignee === a.agent ? 'selected' : ''}>@\${a.agent}</option>\`).join('')}
                    </select>
                  </div>

                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Priority</label>
                    <select onchange="setKanbanFilter('priority', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" \${kf.priority === 'ALL' ? 'selected' : ''}>Any priority</option>
                      <option value="urgent" \${kf.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                      <option value="normal" \${kf.priority === 'normal' ? 'selected' : ''}>Normal</option>
                      <option value="low" \${kf.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                  </div>

                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Label</label>
                    <select onchange="setKanbanFilter('label', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" \${kf.label === 'ALL' ? 'selected' : ''}>All labels</option>
                      \${projectLabels.map(l => \`<option value="\${l}" \${kf.label === l ? 'selected' : ''}>#\${l}</option>\`).join('')}
                    </select>
                  </div>

                  <div class="col-span-2">
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Blocked reason</label>
                    <select onchange="setKanbanFilter('blocked_kind', this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink">
                      <option value="ALL" \${kf.blocked_kind === 'ALL' ? 'selected' : ''}>Any reason</option>
                      <option value="waiting-human" \${kf.blocked_kind === 'waiting-human' ? 'selected' : ''}>Waiting on me</option>
                      <option value="waiting-task" \${kf.blocked_kind === 'waiting-task' ? 'selected' : ''}>Waiting on another task</option>
                      <option value="waiting-external" \${kf.blocked_kind === 'waiting-external' ? 'selected' : ''}>Waiting on external service</option>
                    </select>
                  </div>
                </div>
              </div>
            \` : ''}
          </div>

          <!-- Column Jump Pills + Swipe/Drag Hint -->
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              \${columns.map(col => {
                const colCount = filteredTasks.filter(t => t.status === col.id).length;
                return \`
                  <button onclick="scrollToKanbanColumn('\${col.id}')" class="tap-44 px-3 rounded-xl bg-recessed hover:bg-card border border-border font-mono text-xs font-bold text-ink flex items-center gap-1.5 shrink-0">
                    <span class="w-2 h-2 rounded-full \${col.dot}"></span>
                    <span>\${col.title}</span>
                    <span class="text-muted">\${colCount}</span>
                  </button>
                \`;
              }).join('')}
            </div>
          </div>

          <div class="text-xs text-muted flex items-center justify-between px-0.5">
            <span><i class="ph-bold ph-arrows-left-right mr-1"></i>Scroll columns • Drag cards or swipe a card for quick actions</span>
          </div>

          <!-- Horizontal Kanban Board: One Column Per Status -->
          <div
            id="kanban-board-strip"
            data-scroll-id="kanban-board-horiz"
            class="flex gap-3 overflow-x-auto pb-3 pt-0.5 snap-x snap-mandatory no-scrollbar -mx-3.5 px-3.5"
          >
            \${columns.filter(c => kf.status === 'ALL' || kf.status === c.id).map(col => {
              const colTasks = filteredTasks.filter(t => t.status === col.id);
              return \`
                <div
                  id="kanban-col-\${col.id}"
                  data-col-status="\${col.id}"
                  ondragover="handleKanbanDragOver(event)"
                  ondragleave="handleKanbanDragLeave(event)"
                  ondrop="handleKanbanDrop(event, '\${col.id}')"
                  class="w-[85vw] max-w-[330px] shrink-0 snap-center hw-inset rounded-2xl p-2.5 flex flex-col gap-2.5 min-h-[420px] transition-colors"
                >
                  <!-- Column Header -->
                  <div class="flex items-center justify-between px-2 py-1 border-b border-border">
                    <div class="flex items-center gap-2">
                      <span class="w-2.5 h-2.5 rounded-full \${col.dot}"></span>
                      <h2 class="font-serif font-bold text-base text-ink">\${col.title}</h2>
                    </div>
                    <span class="font-mono text-xs font-bold bg-card border border-border px-2 py-0.5 rounded-lg text-ink">
                      \${colTasks.length}
                    </span>
                  </div>

                  <!-- Column Cards -->
                  <div class="space-y-2.5 flex-1">
                    \${colTasks.length === 0 ? \`
                      <div class="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted my-2">
                        Drop a card here or tap a status button to move tasks to <strong>\${col.title}</strong>.
                      </div>
                    \` : colTasks.map(task => renderTaskCard(task)).join('')}
                  </div>
                </div>
              \`;
            }).join('')}
          </div>
        </div>
      \`;
    }

    function scrollToKanbanColumn(colId) {
      const col = document.getElementById(\`kanban-col-\${colId}\`);
      if (col) {
        col.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }

    function renderPriorityPill(priority) {
      if (priority === 'urgent') {
        return \`<span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold">Urgent</span>\`;
      }
      if (priority === 'low') {
        return \`<span class="font-mono text-[11px] bg-stone-200 text-stone-700 border border-stone-400 px-2 py-0.5 rounded-md font-semibold">Low</span>\`;
      }
      return \`<span class="font-mono text-[11px] bg-paper text-ink border border-ink/40 px-2 py-0.5 rounded-md font-semibold">Normal</span>\`;
    }

    function renderStatusBadge(task) {
      if (task.status === 'blocked') {
        return \`<span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
          <i class="ph-bold ph-warning-octagon"></i> \${escapeHtml(formatBlockedReason(task.blocked_kind))}
        </span>\`;
      }
      if (task.status === 'doing') {
        return \`<span class="font-mono text-[11px] bg-amber-300 text-ink border border-ink px-2 py-0.5 rounded-md font-bold">In Progress</span>\`;
      }
      if (task.status === 'done') {
        return \`<span class="font-mono text-[11px] bg-forest text-white px-2 py-0.5 rounded-md font-bold">Done</span>\`;
      }
      return \`<span class="font-mono text-[11px] bg-stone-200 text-ink border border-stone-500 px-2 py-0.5 rounded-md font-bold">To Do</span>\`;
    }

    function renderTaskCard(task) {
      const stale = isTaskStale(task);
      const overdue = isTaskOverdue(task);
      const todosDone = (task.todos || []).filter(td => td.done === 1).length;
      const todosTotal = (task.todos || []).length;
      const commentCount = getUserCommentCount(task);
      const agStyle = task.assignee ? getAgentStyle(task.assignee) : null;
      const isSwiped = state.swipedTaskId === task.id;

      return \`
        <div class="swipe-shell select-none" id="task-swipe-shell-\${task.id}">
          <!-- Physical Background Track Revealed While Dragging Task Card -->
          <div
            id="task-swipe-bg-\${task.id}"
            class="swipe-bg bg-forest text-white px-4 flex items-center justify-between rounded-2xl transition-colors duration-150"
          >
            <div id="task-swipe-left-hint-\${task.id}" class="flex items-center gap-2 font-mono text-xs font-bold">
              <span class="w-9 h-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center">
                <i class="ph-bold ph-lightning text-base"></i>
              </span>
              <span>Quick Actions</span>
            </div>
            <div id="task-swipe-right-hint-\${task.id}" class="flex items-center gap-2 font-mono text-xs font-bold">
              <span>Quick Actions</span>
              <span class="w-9 h-9 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center">
                <i class="ph-bold ph-lightning text-base"></i>
              </span>
            </div>
          </div>

          <!-- Foreground Draggable Card -->
          <div
            id="task-swipe-fg-\${task.id}"
            class="swipe-fg hw-card rounded-2xl overflow-hidden bg-card relative"
            draggable="true"
            ondragstart="handleKanbanDragStart(event, \${task.id})"
            onpointerdown="handleTaskPointerDown(event, \${task.id})"
          >
            <!-- Special Caution Header for Stale, Overdue, or Blocked -->
            \${task.status === 'blocked' ? \`
              <div class="caution-stripe-red px-3 py-1.5 border-b border-ink flex items-center justify-between">
                <span class="font-mono text-[11px] font-bold text-vermilion flex items-center gap-1">
                  <i class="ph-bold ph-hand-palm"></i> \${escapeHtml(formatBlockedReason(task.blocked_kind))}
                </span>
                <span class="font-mono text-[11px] font-semibold text-ink">
                  \${formatRelEpoch(task.status_changed_at)}
                </span>
              </div>
            \` : stale ? \`
              <div class="caution-stripe-amber px-3 py-1.5 border-b border-ink flex items-center justify-between">
                <span class="font-mono text-[11px] font-bold text-amber-950 flex items-center gap-1">
                  <i class="ph-bold ph-hourglass-high"></i> Stale (Quiet &gt;24h)
                </span>
                <span class="font-mono text-[11px] font-bold text-amber-950">
                  \${formatRelEpoch(task.last_activity_at)}
                </span>
              </div>
            \` : ''}

            <!-- Swipe-Revealed Quick Action Tray -->
            \${isSwiped ? \`
              <div class="bg-charcoal text-paper px-3 py-2 border-b border-ink flex items-center justify-between gap-2">
                <span class="font-mono text-xs font-bold text-amber-300">Quick Actions</span>
                <div class="flex items-center gap-1.5">
                  \${task.status !== 'done' ? \`
                    <button onclick="quickCompleteTask(\${task.id}, event)" class="tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1">
                      <i class="ph-bold ph-check-circle"></i> Mark done
                    </button>
                  \` : ''}
                  <button onclick="quickCycleAssignee(\${task.id}, event)" class="tap-44 px-3 rounded-xl bg-paper text-ink font-mono text-xs font-bold flex items-center gap-1">
                    <i class="ph-bold ph-user-switch"></i> \${task.assignee ? 'Reassign' : 'Claim (nyx)'}
                  </button>
                  <button onclick="clearTaskSwipe(event)" class="tap-44 w-11 rounded-xl bg-black/40 text-paper flex items-center justify-center">
                    <i class="ph-bold ph-x"></i>
                  </button>
                </div>
              </div>
            \` : ''}

            <div class="p-3.5 space-y-2.5">
              <!-- Top Row: ID, Priority, Overdue, Assignee -->
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-mono text-xs font-bold text-muted">#\${task.id}</span>
                  \${renderPriorityPill(task.priority)}
                  \${overdue ? \`
                    <span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold flex items-center gap-1">
                      <i class="ph-bold ph-alarm"></i> Overdue (\${formatRelEpoch(task.due_at)})
                    </span>
                  \` : task.due_at ? \`
                    <span class="font-mono text-[11px] bg-recessed text-ink border border-border px-2 py-0.5 rounded font-medium">
                      Due \${formatRelEpoch(task.due_at)}
                    </span>
                  \` : ''}
                </div>

                <div>
                  \${task.assignee ? \`
                    <span class="font-mono text-xs \${agStyle.bg} \${agStyle.text} border \${agStyle.border} px-2.5 py-0.5 rounded-lg font-bold inline-flex items-center gap-1">
                      <span class="w-1.5 h-1.5 rounded-full \${agStyle.dot}"></span>
                      @\${escapeHtml(task.assignee)}
                      \${task.admin_assigned ? \`<i class="ph-fill ph-lock-key text-[11px]" title="Assigned by you"></i>\` : ''}
                    </span>
                  \` : \`
                    <span class="font-mono text-xs text-muted bg-recessed px-2 py-0.5 rounded-lg border border-border">
                      Unassigned
                    </span>
                  \`}
                </div>
              </div>

              <!-- Title & Short Description -->
              <div onclick="openTaskDrawerIfNotSwiped(event, \${task.id})" class="cursor-pointer group">
                <h3 class="font-serif text-base font-bold text-ink group-hover:text-forest leading-snug">
                  \${escapeHtml(task.title)}
                </h3>
                \${task.description ? \`
                  <p class="text-sm text-muted mt-1 line-clamp-2 leading-relaxed">\${escapeHtml(task.description)}</p>
                \` : ''}
              </div>

              <!-- Labels Row -->
              \${(task.labels || []).length > 0 ? \`
                <div class="flex items-center gap-1.5 flex-wrap">
                  \${task.labels.map(lbl => \`
                    <button onclick="setKanbanFilter('label', '\${escapeHtml(lbl)}')" class="tap-44 px-2.5 rounded-lg font-mono text-xs bg-recessed hover:bg-ink hover:text-paper text-ink border border-border font-semibold transition flex items-center">
                      #\${escapeHtml(lbl)}
                    </button>
                  \`).join('')}
                </div>
              \` : ''}

              <!-- Metadata Counters + Direct Mark Done Action -->
              <div class="pt-2 border-t border-border flex items-center justify-between gap-2">
                <button onclick="openTaskDrawerIfNotSwiped(event, \${task.id})" class="tap-44 px-1 flex items-center gap-3 font-mono text-xs text-muted text-left">
                  <span class="flex items-center gap-1 \${todosTotal > 0 && todosDone === todosTotal ? 'text-forest font-bold' : ''}">
                    <i class="ph-bold ph-check-square-offset text-sm"></i>
                    \${todosDone}/\${todosTotal}
                  </span>
                  <span class="flex items-center gap-1 \${task.notes ? 'text-ink font-semibold' : ''}">
                    <i class="ph-bold ph-file-text text-sm"></i>
                    \${task.notes ? 'Doc' : '—'}
                  </span>
                  <span class="flex items-center gap-1 \${commentCount > 0 ? 'text-ink font-semibold' : ''}">
                    <i class="ph-bold ph-chats-circle text-sm"></i>
                    \${commentCount}
                  </span>
                </button>

                <div class="flex items-center gap-1.5">
                  \${task.status !== 'done' ? \`
                    <button
                      onclick="quickCompleteTask(\${task.id}, event)"
                      class="hw-btn tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1"
                      title="Mark task done"
                    >
                      <i class="ph-bold ph-check"></i>
                      <span>Mark done</span>
                    </button>
                  \` : \`
                    <span class="font-mono text-xs font-bold text-forest px-2 py-1 flex items-center gap-1">
                      <i class="ph-fill ph-check-circle"></i> Completed
                    </span>
                  \`}
                  <button
                    onclick="openTaskDrawerIfNotSwiped(event, \${task.id})"
                    class="hw-btn tap-44 px-3 rounded-xl bg-recessed text-ink font-mono text-xs font-bold flex items-center"
                  >
                    Open
                  </button>
                </div>
              </div>

              <!-- Tap Fallback Status Strip (>=44px targets, no-op if already active) -->
              <div class="grid grid-cols-4 gap-1 pt-1">
                \${[
                  { id: 'todo', label: 'To Do' },
                  { id: 'doing', label: 'Doing' },
                  { id: 'blocked', label: 'Blocked' },
                  { id: 'done', label: 'Done' }
                ].map(st => {
                  const isCurrent = task.status === st.id;
                  return \`
                    <button
                      onclick="requestTaskStatusChange(\${task.id}, '\${st.id}')"
                      class="tap-44 rounded-xl font-mono text-[11px] font-bold border transition flex items-center justify-center \${
                        isCurrent
                          ? st.id === 'blocked'
                            ? 'bg-vermilion text-white border-ink cursor-default'
                            : 'bg-ink text-paper border-ink cursor-default'
                          : 'bg-paper text-muted border-border hover:border-ink hover:text-ink'
                      }"
                      \${isCurrent ? 'aria-current="true"' : ''}
                    >
                      \${st.label}
                    </button>
                  \`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      \`;
    }

    /********************************************************************
     * 6B. KANBAN DRAG-AND-DROP & PHYSICAL TASK CARD SWIPE GESTURES
     ********************************************************************/
    let draggedTaskId = null;
    let lastSwipeGestureTs = 0;

    function applySwipeResistance(dx, maxFree = 70) {
      const sign = dx < 0 ? -1 : 1;
      const abs = Math.abs(dx);
      if (abs <= maxFree) {
        return sign * abs * 0.82;
      }
      return sign * (maxFree * 0.82 + (abs - maxFree) * 0.32);
    }

    function openTaskDrawerIfNotSwiped(e, taskId) {
      if (Date.now() - lastSwipeGestureTs < 320) {
        if (e) e.stopPropagation();
        return;
      }
      openTaskDrawer(taskId);
    }

    function handleKanbanDragStart(e, taskId) {
      draggedTaskId = taskId;
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', String(taskId));
        e.dataTransfer.effectAllowed = 'move';
      }
    }

    function handleKanbanDragOver(e) {
      e.preventDefault();
      const col = e.currentTarget;
      if (col && !col.classList.contains('kanban-drop-active')) {
        col.classList.add('kanban-drop-active');
      }
    }

    function handleKanbanDragLeave(e) {
      const col = e.currentTarget;
      if (col) col.classList.remove('kanban-drop-active');
    }

    function handleKanbanDrop(e, targetStatus) {
      e.preventDefault();
      const col = e.currentTarget;
      if (col) col.classList.remove('kanban-drop-active');
      const id = draggedTaskId || Number(e.dataTransfer?.getData('text/plain'));
      draggedTaskId = null;
      if (!id) return;
      requestTaskStatusChange(id, targetStatus);
    }

    // Physical touch/pointer swipe on task card with resistance, background icon, and snap-back before action
    const SWIPE_THRESHOLD_PX = 70;
    let activeTaskSwipe = null;

    function handleTaskPointerDown(e, taskId) {
      // Only track primary touch or left mouse button, and ignore taps directly on interactive buttons
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea')) return;

      const fg = document.getElementById(\`task-swipe-fg-\${taskId}\`);
      const bg = document.getElementById(\`task-swipe-bg-\${taskId}\`);
      const leftHint = document.getElementById(\`task-swipe-left-hint-\${taskId}\`);
      const rightHint = document.getElementById(\`task-swipe-right-hint-\${taskId}\`);
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

    function handleTaskPointerMove(e) {
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
          // Temporarily disable horizontal board scroll-snap while physically dragging the card
          if (activeTaskSwipe.strip) {
            activeTaskSwipe.strip.style.overflowX = 'hidden';
          }
          // Disable HTML5 drag while touch-swiping
          activeTaskSwipe.fg.setAttribute('draggable', 'false');
        }
      }

      if (activeTaskSwipe.lockedHoriz) {
        if (e.cancelable) e.preventDefault();
        activeTaskSwipe.rawDx = dx;
        const damped = applySwipeResistance(dx, SWIPE_THRESHOLD_PX);
        activeTaskSwipe.fg.style.transform = \`translate3d(\${damped}px, 0, 0)\`;

        const past = Math.abs(dx) >= SWIPE_THRESHOLD_PX;
        if (activeTaskSwipe.bg) {
          activeTaskSwipe.bg.className = \`swipe-bg px-4 flex items-center justify-between rounded-2xl transition-colors duration-150 \${
            past ? 'bg-forest text-white' : 'bg-charcoal text-stone-300'
          }\`;
        }
        if (activeTaskSwipe.leftHint && activeTaskSwipe.rightHint) {
          activeTaskSwipe.leftHint.style.opacity = dx > 0 ? '1' : '0.15';
          activeTaskSwipe.leftHint.style.transform = \`scale(\${past && dx > 0 ? 1.08 : 0.95})\`;
          activeTaskSwipe.rightHint.style.opacity = dx < 0 ? '1' : '0.15';
          activeTaskSwipe.rightHint.style.transform = \`scale(\${past && dx < 0 ? 1.08 : 0.95})\`;
        }
      }
    }

    function handleTaskPointerUp(e) {
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

      // Animate card smoothly back to 0px first, then trigger action if threshold was crossed
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
          state.swipedTaskId = state.swipedTaskId === taskId ? null : taskId;
          renderMainViewport(true);
        }
      };

      fg.addEventListener('transitionend', onFinish);
      setTimeout(onFinish, 290);
    }

    function cleanupTaskPointerListeners() {
      window.removeEventListener('pointermove', handleTaskPointerMove);
      window.removeEventListener('pointerup', handleTaskPointerUp);
      window.removeEventListener('pointercancel', handleTaskPointerUp);
    }

    function clearTaskSwipe(e) {
      if (e) e.stopPropagation();
      state.swipedTaskId = null;
      renderMainViewport(true);
    }

    function quickCompleteTask(taskId, e) {
      if (e) e.stopPropagation();
      state.swipedTaskId = null;
      requestTaskStatusChange(taskId, 'done');
    }

    function quickCycleAssignee(taskId, e) {
      if (e) e.stopPropagation();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const order = [null, ...state.agents.map(a => a.agent)];
      const idx = order.indexOf(task.assignee);
      const next = order[(idx + 1) % order.length];
      state.swipedTaskId = null;
      manualAssignTask(taskId, next || '');
    }

    /********************************************************************
     * 7. SINGLE-SCROLL DOCUMENT PAGE TASK DRAWER (No Tabs, Live Draft Persistence)
     ********************************************************************/
    async function openTaskDrawer(taskId) {
      state.openTaskId = taskId;
      const task = state.tasks.find(t => t.id === taskId);
      if (task) getTaskDraft(task); // initialize draft if needed
      const drawer = document.getElementById('task-drawer');
      drawer.classList.remove('hidden');
      drawer.classList.add('flex');
      renderTaskDrawer(false);
      // Load full detail (todos + comments) in background
      try {
        await loadTaskDetail(taskId);
        if (state.openTaskId === taskId) renderTaskDrawer(true);
      } catch (_e) { /* drawer shows what we have */ }
    }

    function closeTaskDrawer() {
      // Auto-commit any unsaved draft edits before closing so edits are never silently lost
      if (state.openTaskId) {
        commitTaskDraftIfNeeded(state.openTaskId, true);
      }
      state.openTaskId = null;
      const drawer = document.getElementById('task-drawer');
      drawer.classList.add('hidden');
      drawer.classList.remove('flex');
      renderMainViewport(true);
    }

    function updateTaskDraftField(taskId, field, value) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const draft = getTaskDraft(task);
      draft[field] = value;
      if (field === 'title' || field === 'description' || field === 'notes') {
        draft.dirty = true;
        const badge = document.getElementById('drawer-draft-status');
        if (badge) {
          badge.textContent = 'Unsaved edits (auto-saved on close)';
          badge.className = 'font-mono text-[11px] text-amber-300';
        }
      }
    }

    async function commitTaskDraftIfNeeded(taskId, silent = false) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const draft = state.taskDrafts[taskId];
      if (!draft || !draft.dirty) return;

      const trimmedTitle = draft.title.trim();
      const payload = {};
      if (trimmedTitle) payload.title = trimmedTitle;
      payload.description = draft.description.trim() || '';
      payload.notes = draft.notes.trim() ? draft.notes : '';
      try {
        await api.put(\`/admin/api/kanban/tasks/\${taskId}\`, payload);
      } catch (err) {
        showToast('Save failed', err.message, 'red');
        return;
      }
      if (trimmedTitle) task.title = trimmedTitle;
      task.description = payload.description;
      task.notes = payload.notes;
      task.last_activity_at = new Date().toISOString();
      draft.dirty = false;

      if (!silent) {
        showToast('Saved changes to task', task.title, 'green');
        renderTaskDrawer(true);
        renderMainViewport(true);
      }
    }

    function renderTaskDrawer(preserveScroll = true) {
      const task = state.tasks.find(t => t.id === state.openTaskId);
      if (!task) return closeTaskDrawer();

      const draft = getTaskDraft(task);
      const proj = state.projects.find(p => p.id === task.project_id);
      const stale = isTaskStale(task);
      const overdue = isTaskOverdue(task);
      const userComments = (task.comments || []).filter(c => c.author !== 'system');
      const systemLogs = (task.comments || []).filter(c => c.author === 'system');
      const inner = document.getElementById('task-drawer-inner');
      const scroller = document.getElementById('task-drawer-scroller');
      const prevScroll = preserveScroll && scroller ? scroller.scrollTop : 0;

      inner.innerHTML = \`
        <!-- Sticky Drawer Top Bar ("Close" button + Quick "Mark done") -->
        <div class="bg-charcoal text-paper px-3.5 py-2.5 border-b-2 border-ink flex items-center justify-between gap-2 shrink-0">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-mono text-xs font-bold bg-paper text-ink px-2 py-0.5 rounded">Task #\${task.id}</span>
              <span class="font-mono text-xs text-stone-300 truncate">\${escapeHtml(proj ? proj.title : '')}</span>
            </div>
            <div id="drawer-draft-status" class="font-mono text-[11px] \${draft.dirty ? 'text-amber-300' : 'text-stone-400'} mt-0.5">
              \${draft.dirty ? 'Unsaved edits in draft' : \`Updated \${formatRelEpoch(task.updated_at)}\`}
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            \${task.status !== 'done' ? \`
              <button onclick="quickCompleteTask(\${task.id}, event); renderTaskDrawer(true);" class="tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center gap-1">
                <i class="ph-bold ph-check"></i>
                <span>Mark done</span>
              </button>
            \` : ''}
            <button onclick="confirmDeleteTask(\${task.id})" class="tap-44 w-11 rounded-xl bg-black/40 text-stone-300 hover:bg-vermilion hover:text-white border border-white/15 flex items-center justify-center" title="Delete task">
              <i class="ph-bold ph-trash text-base"></i>
            </button>
            <button onclick="closeTaskDrawer()" class="tap-44 px-3.5 rounded-xl bg-paper text-ink font-mono text-xs font-bold flex items-center gap-1">
              <span>Close</span>
              <i class="ph-bold ph-x text-sm"></i>
            </button>
          </div>
        </div>

        <!-- Single-Scroll Document Body: Title -> Properties -> Notes Body -> Checklist -> Discussion -->
        <div id="task-drawer-scroller" class="flex-1 overflow-y-auto p-4 space-y-5">

          <!-- Alert Banners if Blocked or Stale -->
          \${task.status === 'blocked' ? \`
            <div class="caution-stripe-red border-2 border-ink rounded-2xl p-3.5 flex items-center justify-between gap-2">
              <div>
                <div class="font-mono text-xs font-bold uppercase text-vermilion">Blocked • \${escapeHtml(formatBlockedReason(task.blocked_kind))}</div>
                <div class="text-xs text-ink mt-0.5">Blocked \${formatRelEpoch(task.status_changed_at)}</div>
              </div>
              <button onclick="openBlockedKindPicker(\${task.id})" class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl shrink-0">
                Change reason
              </button>
            </div>
          \` : ''}

          \${stale ? \`
            <div class="caution-stripe-amber border-2 border-ink rounded-2xl p-3.5 flex items-center justify-between gap-2">
              <div>
                <div class="font-mono text-xs font-bold uppercase text-amber-950">Stale — Quiet for over 24 hours</div>
                <div class="text-xs text-ink mt-0.5">Last activity \${formatRelEpoch(task.last_activity_at)}.</div>
              </div>
              <button onclick="touchTaskActivity(\${task.id})" class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-3 rounded-xl shrink-0">
                Nudge / Touch
              </button>
            </div>
          \` : ''}

          <!-- 1. DOCUMENT HEADER: Title & Short Summary -->
          <section class="hw-card rounded-2xl p-4 space-y-3 bg-card">
            <div>
              <label class="block font-mono text-xs font-bold uppercase text-muted mb-1">Task Title</label>
              <input
                id="edit-task-title"
                type="text"
                value="\${escapeHtml(draft.title)}"
                oninput="updateTaskDraftField(\${task.id}, 'title', this.value)"
                onfocus="keepFieldAboveKeyboard(this)"
                class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-serif font-bold text-ink focus:outline-none"
              />
            </div>
            <div>
              <label class="block font-mono text-xs font-bold uppercase text-muted mb-1">Short Summary</label>
              <textarea
                id="edit-task-desc"
                rows="2"
                placeholder="Brief one-line context shown on board cards..."
                oninput="updateTaskDraftField(\${task.id}, 'description', this.value)"
                onfocus="keepFieldAboveKeyboard(this)"
                class="w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none"
              >\${escapeHtml(draft.description)}</textarea>
            </div>
          </section>

          <!-- 2. PROPERTIES TABLE: Status, Assignee, Priority, Due Date, Labels -->
          <section class="hw-card rounded-2xl p-4 space-y-3.5 bg-card">
            <div class="font-mono text-xs font-bold uppercase tracking-wider text-muted">
              Properties
            </div>

            <!-- Status Selector -->
            <div>
              <label class="block font-mono text-xs text-muted mb-1.5">Status</label>
              <div class="grid grid-cols-4 gap-1.5">
                \${[
                  { id: 'todo', label: 'To Do' },
                  { id: 'doing', label: 'Doing' },
                  { id: 'blocked', label: 'Blocked' },
                  { id: 'done', label: 'Done' }
                ].map(st => {
                  const isCurrent = task.status === st.id;
                  return \`
                    <button
                      onclick="requestTaskStatusChange(\${task.id}, '\${st.id}')"
                      class="tap-44 rounded-xl font-mono text-xs font-bold border-1.5 transition \${
                        isCurrent
                          ? st.id === 'blocked'
                            ? 'bg-vermilion text-white border-ink shadow-[0_2px_0_#161615] cursor-default'
                            : 'bg-ink text-paper border-ink shadow-[0_2px_0_#161615] cursor-default'
                          : 'bg-recessed text-ink border-border'
                      }"
                    >
                      \${st.label}
                    </button>
                  \`;
                }).join('')}
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2.5">
              <!-- Manual Assignee -->
              <div>
                <label class="block font-mono text-xs text-muted mb-1">Assignee</label>
                <select onchange="manualAssignTask(\${task.id}, this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans font-bold text-ink">
                  <option value="" \${!task.assignee ? 'selected' : ''}>Unassigned</option>
                  \${state.agents.map(a => \`
                    <option value="\${a.agent}" \${task.assignee === a.agent ? 'selected' : ''}>@\${a.agent}</option>
                  \`).join('')}
                </select>
              </div>

              <!-- Priority -->
              <div>
                <label class="block font-mono text-xs text-muted mb-1">Priority</label>
                <select onchange="updateTaskPriority(\${task.id}, this.value)" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans font-bold text-ink">
                  <option value="low" \${task.priority === 'low' ? 'selected' : ''}>Low</option>
                  <option value="normal" \${task.priority === 'normal' ? 'selected' : ''}>Normal</option>
                  <option value="urgent" \${task.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                </select>
              </div>
            </div>

            <!-- Due Date Presets -->
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="font-mono text-xs text-muted">Due Date \${overdue ? '<strong class="text-vermilion">(Overdue)</strong>' : ''}</label>
                <span class="font-mono text-xs font-bold text-ink">\${task.due_at ? \`Due \${formatRelEpoch(task.due_at)}\` : 'No due date'}</span>
              </div>
              <div class="grid grid-cols-4 gap-1.5">
                <button onclick="setTaskDueOffset(\${task.id}, -7200)" class="tap-44 px-2 rounded-xl bg-rose-100 text-rose-900 border border-rose-400 font-mono text-xs font-bold">
                  2h ago
                </button>
                <button onclick="setTaskDueOffset(\${task.id}, 14400)" class="tap-44 px-2 rounded-xl bg-recessed text-ink border border-border font-mono text-xs font-bold">
                  In 4h
                </button>
                <button onclick="setTaskDueOffset(\${task.id}, 86400)" class="tap-44 px-2 rounded-xl bg-recessed text-ink border border-border font-mono text-xs font-bold">
                  Tomorrow
                </button>
                <button onclick="setTaskDueOffset(\${task.id}, null)" class="tap-44 px-2 rounded-xl bg-recessed text-muted border border-border font-mono text-xs font-bold">
                  Clear
                </button>
              </div>
            </div>

            <!-- Labels -->
            <div class="pt-1 border-t border-border space-y-2">
              <label class="block font-mono text-xs text-muted">Labels</label>
              <div class="flex flex-wrap gap-1.5">
                \${(task.labels || []).length === 0 ? \`<span class="text-sm text-muted">No labels yet</span>\` : ''}
                \${(task.labels || []).map(lbl => \`
                  <span class="font-mono text-xs bg-recessed border border-ink pl-2.5 pr-1 py-1 rounded-xl font-bold flex items-center gap-1">
                    #\${escapeHtml(lbl)}
                    <button onclick="removeTaskLabel(\${task.id}, '\${escapeHtml(lbl)}')" class="tap-44 w-9 h-9 rounded-lg text-muted hover:text-vermilion flex items-center justify-center" title="Remove label">
                      <i class="ph-bold ph-x"></i>
                    </button>
                  </span>
                \`).join('')}
              </div>
              <form onsubmit="addTaskLabel(event, \${task.id})" class="flex gap-2">
                <input
                  id="new-label-input"
                  type="text"
                  onfocus="keepFieldAboveKeyboard(this)"
                  placeholder="Add label (e.g. security, spec)..."
                  class="tap-44 flex-1 hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none"
                />
                <button type="submit" class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold px-4 rounded-xl">
                  Add
                </button>
              </form>
            </div>
          </section>

          <!-- 3. DOCUMENT BODY: Long-form Editable Notes + Save Document Bar -->
          <section class="hw-card rounded-2xl p-4 space-y-3 bg-card">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-mono text-xs font-bold uppercase text-forest">Document Notes</div>
                <h3 class="font-serif font-bold text-lg text-ink">Specification &amp; Working Notes</h3>
              </div>
              \${task.notes ? \`
                <button onclick="clearTaskNotes(\${task.id})" class="tap-44 px-2.5 font-mono text-xs text-muted hover:text-vermilion underline">
                  Clear notes
                </button>
              \` : ''}
            </div>
            <p class="text-xs text-muted leading-relaxed">
              Shared working document for you and \${task.assignee ? '@' + task.assignee : 'the assigned agent'}. Separate from the discussion thread below.
            </p>
            <textarea
              id="task-notes-editor"
              rows="8"
              oninput="updateTaskDraftField(\${task.id}, 'notes', this.value)"
              onfocus="keepFieldAboveKeyboard(this)"
              placeholder="Write specifications, checklists, runbooks, or findings..."
              class="w-full hw-inset rounded-xl p-3 font-mono text-sm text-ink leading-relaxed focus:outline-none"
            >\${escapeHtml(draft.notes)}</textarea>

            <button onclick="commitTaskDraftIfNeeded(\${task.id}, false)" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
              <i class="ph-bold ph-floppy-disk text-base"></i>
              <span>Save Title, Summary &amp; Notes</span>
            </button>
          </section>

          <!-- 4. CHECKLIST (Todos) -->
          <section class="hw-card rounded-2xl p-4 space-y-3 bg-card">
            <div class="flex items-center justify-between">
              <span class="font-serif font-bold text-lg text-ink">
                Checklist
              </span>
              <span class="font-mono text-xs font-bold bg-recessed px-2.5 py-1 rounded-lg border border-border text-ink">
                \${(task.todos || []).filter(td => td.done === 1).length} of \${(task.todos || []).length} complete
              </span>
            </div>

            <div class="space-y-2">
              \${(task.todos || []).length === 0 ? \`
                <div class="text-sm text-muted py-2">No checklist steps added yet.</div>
              \` : task.todos.map(td => \`
                <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-recessed border border-border">
                  <button onclick="toggleTodoItem(\${task.id}, \${td.id})" class="tap-44 flex items-center gap-3 text-left flex-1 min-w-0 py-1 px-1">
                    <span class="w-6 h-6 rounded-lg border-1.5 border-ink flex items-center justify-center shrink-0 \${td.done ? 'bg-forest text-white' : 'bg-card'}">
                      \${td.done ? '<i class="ph-bold ph-check text-sm"></i>' : ''}
                    </span>
                    <span class="text-sm font-medium \${td.done ? 'line-through text-muted' : 'text-ink'} break-words">
                      \${escapeHtml(td.text)}
                    </span>
                  </button>
                  <button onclick="deleteTodoItem(\${task.id}, \${td.id})" class="tap-44 w-11 rounded-xl text-muted hover:text-vermilion flex items-center justify-center shrink-0" title="Delete checklist item">
                    <i class="ph-bold ph-trash text-base"></i>
                  </button>
                </div>
              \`).join('')}
            </div>

            <form onsubmit="addTodoItem(event, \${task.id})" class="flex gap-2 pt-1">
              <input
                id="new-todo-input"
                type="text"
                onfocus="keepFieldAboveKeyboard(this)"
                placeholder="Add a checklist step..."
                class="tap-44 flex-1 hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none"
              />
              <button type="submit" class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-4 rounded-xl">
                Add
              </button>
            </form>
          </section>

          <!-- 5. DISCUSSION THREAD (Separate from Silent Activity Log) -->
          <section class="hw-card rounded-2xl p-4 space-y-3.5 bg-card">
            <div class="flex items-center justify-between">
              <div>
                <div class="font-mono text-xs font-bold uppercase text-forest">Discussion</div>
                <h3 class="font-serif font-bold text-lg text-ink">Comments (\${userComments.length})</h3>
              </div>
              <span class="font-mono text-[11px] text-muted">Permanent audit history</span>
            </div>

            <div class="space-y-2.5">
              \${userComments.length === 0 ? \`
                <div class="hw-inset rounded-xl p-4 text-center text-sm text-muted">
                  No comments yet. Leave guidance for your agents below.
                </div>
              \` : userComments.map(c => {
                const displayAuthor = c.author === 'admin' ? 'luki' : c.author;
                const st = getAgentStyle(displayAuthor);
                return \`
                  <div class="p-3 rounded-xl bg-recessed border border-border space-y-1.5">
                    <div class="flex items-center justify-between">
                      <span class="font-mono text-xs font-bold \${st.bg} \${st.text} border \${st.border} px-2 py-0.5 rounded-md">
                        @\${escapeHtml(displayAuthor)}
                      </span>
                      <span class="font-mono text-xs text-muted">
                        \${formatRelEpoch(c.ts)}
                      </span>
                    </div>
                    <p class="text-sm text-ink leading-relaxed whitespace-pre-wrap">\${escapeHtml(c.body)}</p>
                  </div>
                \`;
              }).join('')}
            </div>

            <!-- Post Comment Form (stays visible above keyboard) -->
            <form onsubmit="postTaskComment(event, \${task.id})" class="space-y-2.5 pt-2 border-t border-border">
              <textarea
                id="new-comment-body"
                rows="2"
                oninput="updateTaskDraftField(\${task.id}, 'commentDraft', this.value)"
                onfocus="keepFieldAboveKeyboard(this)"
                placeholder="Write a comment as @luki..."
                class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none"
              >\${escapeHtml(draft.commentDraft || '')}</textarea>
              <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
                <i class="ph-bold ph-paper-plane-right text-base"></i>
                <span>Post Comment</span>
              </button>
            </form>
          </section>

          <!-- 6. SEPARATE ACTIVITY LOG -->
          <section class="hw-inset rounded-2xl p-3.5 space-y-2">
            <div class="font-mono text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
              <i class="ph-bold ph-clock-counter-clockwise"></i> Activity History
            </div>
            \${systemLogs.length === 0 ? \`
              <div class="text-xs text-muted">No status transitions recorded yet.</div>
            \` : systemLogs.map(s => \`
              <div class="text-xs text-muted flex items-center justify-between gap-2 py-1 border-b border-border/60 last:border-none">
                <span>• \${escapeHtml(s.body)}</span>
                <span class="font-mono shrink-0">\${formatRelEpoch(s.ts)}</span>
              </div>
            \`).join('')}
          </section>

        </div>
      \`;

      if (preserveScroll) {
        const nextScroller = document.getElementById('task-drawer-scroller');
        if (nextScroller) nextScroller.scrollTop = prevScroll;
      }
    }

    /********************************************************************
     * 8. KANBAN INTERACTION HANDLERS (Strict No-Op on Active Status)
     ********************************************************************/
    async function selectProject(projId) {
      state.activeProjectId = projId;
      state.kanbanFilter.label = 'ALL';
      renderMainViewport(false);
      try {
        await refreshTasks();
        renderMainViewport(true);
      } catch (_e) { /* keep showing cached */ }
    }

    function updateKanbanSearch(val) {
      state.kanbanFilter.q = val;
      renderMainViewport(true);
      const input = document.getElementById('kanban-search-input');
      if (input) {
        input.focus();
        input.setSelectionRange(val.length, val.length);
      }
    }

    function toggleKanbanFilterDrawer() {
      state.kanbanFilter.showFilters = !state.kanbanFilter.showFilters;
      renderMainViewport(true);
    }

    function setKanbanFilter(key, val) {
      state.kanbanFilter[key] = val;
      renderMainViewport(true);
    }

    function resetKanbanFilters() {
      state.kanbanFilter = {
        q: '',
        status: 'ALL',
        assignee: 'ALL',
        label: 'ALL',
        blocked_kind: 'ALL',
        priority: 'ALL',
        showFilters: true
      };
      renderMainViewport(true);
    }

    // Rule #2: Clicking a status that is already active MUST be a complete no-op!
    async function requestTaskStatusChange(taskId, newStatus) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;

      // Strict no-op when status is already active
      if (task.status === newStatus) {
        return;
      }

      if (newStatus === 'blocked') {
        openBlockedKindPicker(taskId);
        return;
      }

      const prevStatus = task.status;
      const prevBlockedKind = task.blocked_kind;
      try {
        await api.put(\`/admin/api/kanban/tasks/\${taskId}\`, { status: newStatus });
      } catch (err) {
        showToast('Status change failed', err.message, 'red');
        return;
      }
      task.status = newStatus;
      task.blocked_kind = null;
      task.last_activity_at = new Date().toISOString();

      showToast(
        \`Task #\${task.id} → \${STATUS_LABELS[newStatus]}\`,
        prevStatus === 'blocked' ? \`Cleared "\${formatBlockedReason(prevBlockedKind)}"\` : task.title,
        newStatus === 'done' ? 'green' : 'ink'
      );
      if (state.openTaskId === taskId) await loadTaskDetail(taskId);
      await refreshTasks();
      if (state.openTaskId === taskId) renderTaskDrawer(true);
      renderMainViewport(true);
    }

    function openBlockedKindPicker(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const current = task.blocked_kind || 'waiting-human';

      showCustomModal(\`
        <div class="p-4 space-y-4">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-vermilion">Blocked Reason</div>
              <h3 class="font-serif font-bold text-lg text-ink">Why is Task #\${task.id} blocked?</h3>
            </div>
            <button onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <p class="text-sm text-muted">
            Choosing <strong class="text-ink">Waiting on me</strong> places this task in your <em>Needs You</em> queue.
          </p>

          <div class="space-y-2.5">
            \${[
              {
                kind: 'waiting-human',
                title: 'Waiting on me',
                desc: 'Paused for your decision, approval, or credentials.'
              },
              {
                kind: 'waiting-task',
                title: 'Waiting on another task',
                desc: 'Depends on another task or migration finishing first.'
              },
              {
                kind: 'waiting-external',
                title: 'Waiting on external service',
                desc: 'Blocked on an upstream release, network check, or quota window.'
              }
            ].map(opt => \`
              <button
                onclick="confirmSetTaskBlocked(\${task.id}, '\${opt.kind}')"
                class="w-full text-left p-3.5 rounded-2xl border-2 transition flex items-start justify-between gap-3 \${
                  current === opt.kind && task.status === 'blocked'
                    ? 'bg-rose-50 border-vermilion shadow-[0_2px_0_#E03E1A]'
                    : 'bg-card border-ink hover:bg-recessed'
                }"
              >
                <div>
                  <div class="font-serif text-base font-bold text-ink">\${opt.title}</div>
                  <div class="text-xs text-muted mt-0.5">\${opt.desc}</div>
                </div>
                <i class="ph-bold ph-arrow-right text-vermilion mt-1 text-base"></i>
              </button>
            \`).join('')}
          </div>
        </div>
      \`);
    }

    async function confirmSetTaskBlocked(taskId, blockedKind) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;

      // If already blocked with the exact same reason, do not re-stamp timestamps or log duplicate entries
      if (task.status === 'blocked' && task.blocked_kind === blockedKind) {
        closeTopModal();
        return;
      }

      const kind = blockedKind || 'waiting-human';
      try {
        await api.put(\`/admin/api/kanban/tasks/\${taskId}\`, { status: 'blocked', blocked_kind: kind });
      } catch (err) {
        showToast('Block failed', err.message, 'red');
        return;
      }
      task.status = 'blocked';
      task.blocked_kind = kind;
      task.last_activity_at = new Date().toISOString();

      closeTopModal();
      showToast(\`Task #\${task.id} Blocked\`, formatBlockedReason(task.blocked_kind), 'red');
      if (state.openTaskId === taskId) renderTaskDrawer(true);
      renderMainViewport(true);
    }

    // Rule #5: Unblocking must not force a comment: optional & empty by default
    function quickUnblockAndReplyModal(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      showCustomModal(\`
        <form onsubmit="executeQuickUnblock(event, \${task.id})" class="p-4 space-y-3.5">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-forest">Unblock Task</div>
              <h3 class="font-serif font-bold text-lg text-ink">Unblock Task #\${task.id}</h3>
            </div>
            <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <div class="text-sm font-semibold text-ink">\${escapeHtml(task.title)}</div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">
              Note for \${escapeHtml(task.assignee ? '@' + task.assignee : 'agents')} (optional)
            </label>
            <textarea
              id="quick-unblock-comment"
              rows="3"
              onfocus="keepFieldAboveKeyboard(this)"
              placeholder="Leave an optional note or instructions..."
              class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none"
            ></textarea>
          </div>

          <button type="submit" class="hw-btn tap-44 w-full bg-forest text-white font-mono text-xs font-bold py-3 rounded-xl">
            Unblock &amp; Move to In Progress
          </button>
        </form>
      \`);
    }

    async function executeQuickUnblock(e, taskId) {
      e.preventDefault();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const body = document.getElementById('quick-unblock-comment').value.trim();

      try {
        if (body) {
          await api.post(\`/admin/api/kanban/tasks/\${taskId}/comments\`, { body });
        }
        await api.put(\`/admin/api/kanban/tasks/\${taskId}\`, { status: 'doing' });
      } catch (err) {
        showToast('Unblock failed', err.message, 'red');
        return;
      }

      task.status = 'doing';
      task.blocked_kind = null;
      task.last_activity_at = new Date().toISOString();

      closeTopModal();
      showToast(\`Task #\${task.id} Unblocked\`, \`Moved to In Progress\`, 'green');
      if (state.openTaskId === taskId) await loadTaskDetail(taskId);
      await refreshTasks();
      if (state.openTaskId === taskId) renderTaskDrawer(true);
      renderMainViewport(true);
      updateHeaderTelemetry();
    }

    async function manualAssignTask(taskId, agentVal) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const newAssignee = agentVal ? agentVal : null;
      if (task.assignee === newAssignee) return;

      try {
        await api.put(\`/admin/api/kanban/tasks/\${taskId}\`, { assignee: newAssignee });
      } catch (err) {
        showToast('Assign failed', err.message, 'red');
        return;
      }
      task.assignee = newAssignee;
      task.last_activity_at = new Date().toISOString();

      showToast(
        newAssignee ? \`Assigned to @\${newAssignee}\` : 'Task Unassigned',
        task.title
      );
      if (state.openTaskId === taskId) await loadTaskDetail(taskId);
      await refreshTasks();
      if (state.openTaskId === taskId) renderTaskDrawer(true);
      renderMainViewport(true);
    }

    function updateTaskPriority(taskId, priority) {
      // Priority is a client-side display hint (not persisted server-side).
      const task = state.tasks.find(t => t.id === taskId);
      if (!task || task.priority === priority) return;
      task.priority = priority;
      showToast(\`Priority set to \${PRIORITY_LABELS[priority]}\`);
      if (state.openTaskId === taskId) renderTaskDrawer(true);
      renderMainViewport(true);
    }

    function setTaskDueOffset(taskId, offsetSec) {
      // due_at is a client-side display hint (not persisted server-side)
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const nowSec = Math.floor(Date.now() / 1000);
      task.due_at = offsetSec === null ? null : nowSec + offsetSec;
      showToast(task.due_at ? 'Due date updated' : 'Due date cleared');
      if (state.openTaskId === taskId) renderTaskDrawer(true);
      renderMainViewport(true);
    }

    async function touchTaskActivity(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      await loadTaskDetail(taskId);
      showToast('Task #' + task.id + ' refreshed', 'Latest data loaded', 'green');
      if (state.openTaskId === taskId) renderTaskDrawer(true);
      renderMainViewport(true);
    }

    async function clearTaskNotes(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.put('/admin/api/kanban/tasks/' + taskId, { notes: '' });
      } catch (_e) {
        showToast('Clear failed', _e.message, 'red');
        return;
      }
      task.notes = '';
      const draft = getTaskDraft(task);
      draft.notes = '';
      draft.dirty = false;
      task.last_activity_at = new Date().toISOString();
      showToast('Cleared document notes');
      if (state.openTaskId === taskId) renderTaskDrawer(true);
      renderMainViewport(true);
    }

    async function addTaskLabel(e, taskId) {
      e.preventDefault();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const input = document.getElementById('new-label-input');
      const raw = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!raw) return;
      if (!task.labels.includes(raw)) {
        try {
          await api.post(\`/admin/api/kanban/tasks/\${taskId}/labels\`, { label: raw });
        } catch (err) {
          showToast('Add label failed', err.message, 'red');
          return;
        }
        task.labels.push(raw);
        task.last_activity_at = new Date().toISOString();
        showToast(\`Added label #\${raw}\`);
      }
      renderTaskDrawer(true);
      renderMainViewport(true);
    }

    async function removeTaskLabel(taskId, label) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.del(\`/admin/api/kanban/tasks/\${taskId}/labels/\${encodeURIComponent(label)}\`);
      } catch (err) {
        showToast('Remove label failed', err.message, 'red');
        return;
      }
      task.labels = task.labels.filter(l => l !== label);
      task.last_activity_at = new Date().toISOString();
      showToast(\`Removed #\${label}\`);
      renderTaskDrawer(true);
      renderMainViewport(true);
    }

    async function toggleTodoItem(taskId, todoId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const todo = task.todos.find(td => td.id === todoId);
      if (!todo) return;
      const newDone = todo.done === 1 ? 0 : 1;
      try {
        await api.put(\`/admin/api/kanban/tasks/\${taskId}/todos/\${todoId}\`, { done: newDone });
      } catch (err) {
        showToast('Todo update failed', err.message, 'red');
        return;
      }
      todo.done = newDone;
      task.last_activity_at = new Date().toISOString();
      renderTaskDrawer(true);
      renderMainViewport(true);
    }

    async function addTodoItem(e, taskId) {
      e.preventDefault();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const input = document.getElementById('new-todo-input');
      const text = input.value.trim();
      if (!text) {
        showToast('Please enter checklist text', '', 'red');
        return;
      }
      let newTodo = null;
      try {
        newTodo = await api.post(\`/admin/api/kanban/tasks/\${taskId}/todos\`, { text });
      } catch (err) {
        showToast('Add todo failed', err.message, 'red');
        return;
      }
      task.todos.push({
        id: newTodo.id || newTodo.todo?.id,
        task_id: task.id,
        text,
        done: 0,
        sort_order: task.todos.length
      });
      task.last_activity_at = new Date().toISOString();
      showToast('Added checklist step');
      renderTaskDrawer(true);
      renderMainViewport(true);
    }

    async function deleteTodoItem(taskId, todoId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.del(\`/admin/api/kanban/tasks/\${taskId}/todos/\${todoId}\`);
      } catch (err) {
        showToast('Delete todo failed', err.message, 'red');
        return;
      }
      task.todos = task.todos.filter(td => td.id !== todoId);
      task.last_activity_at = new Date().toISOString();
      renderTaskDrawer(true);
      renderMainViewport(true);
    }

    async function postTaskComment(e, taskId) {
      e.preventDefault();
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      const input = document.getElementById('new-comment-body');
      const body = input.value.trim();
      if (!body) return;
      let saved = null;
      try {
        saved = await api.post(\`/admin/api/kanban/tasks/\${taskId}/comments\`, { body });
      } catch (err) {
        showToast('Comment failed', err.message, 'red');
        return;
      }
      task.comments.push({
        id: saved.id || saved.comment?.id,
        task_id: task.id,
        author: 'luki',
        body,
        ts: new Date().toISOString()
      });
      const draft = getTaskDraft(task);
      draft.commentDraft = '';
      task.last_activity_at = new Date().toISOString();
      showToast('Comment posted');
      renderTaskDrawer(true);
      renderMainViewport(true);
    }

    function confirmDeleteTask(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      showCustomModal(\`
        <div class="p-4 space-y-4">
          <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Task</div>
          <h3 class="font-serif font-bold text-lg text-ink">Delete Task #\${task.id}?</h3>
          <p class="text-sm text-muted">
            This permanently deletes <strong>"\${escapeHtml(task.title)}"</strong> and its \${(task.todos || []).length} checklist steps.
          </p>
          <div class="flex gap-2">
            <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
            <button onclick="executeDeleteTask(\${task.id})" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete Task</button>
          </div>
        </div>
      \`);
    }

    async function executeDeleteTask(taskId) {
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.del(\`/admin/api/kanban/tasks/\${taskId}\`);
      } catch (err) {
        showToast('Delete failed', err.message, 'red');
        return;
      }
      state.tasks = state.tasks.filter(t => t.id !== taskId);
      delete state.taskDrafts[taskId];
      closeTopModal();
      state.openTaskId = null;
      const drawer = document.getElementById('task-drawer');
      drawer.classList.add('hidden');
      drawer.classList.remove('flex');
      showToast(\`Deleted Task #\${taskId}\`);
      renderMainViewport(true);
    }

    function openCreateTaskModal() {
      const proj = state.projects.find(p => p.id === state.activeProjectId) || state.projects[0];
      showCustomModal(\`
        <form onsubmit="executeCreateTask(event)" class="p-4 space-y-3.5">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-muted">\${escapeHtml(proj.title)}</div>
              <h3 class="font-serif font-bold text-lg text-ink">New Task</h3>
            </div>
            <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Title</label>
            <input id="create-task-title" type="text" required placeholder="What needs to be done?" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-bold text-ink focus:outline-none" />
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Summary (optional)</label>
            <input id="create-task-desc" type="text" placeholder="Short context..." class="tap-44 w-full hw-inset rounded-xl px-3 py-2 text-ink focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block font-mono text-xs font-bold text-muted mb-1">Priority</label>
              <select id="create-task-priority" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans text-ink">
                <option value="normal" selected>Normal</option>
                <option value="urgent">Urgent</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label class="block font-mono text-xs font-bold text-muted mb-1">Assignee</label>
              <select id="create-task-assignee" class="tap-44 w-full hw-inset rounded-xl px-2.5 py-2 font-sans text-ink">
                <option value="">Unassigned</option>
                \${state.agents.map(a => \`<option value="\${a.agent}">@\${a.agent}</option>\`).join('')}
              </select>
            </div>
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Labels (comma-separated)</label>
            <input id="create-task-labels" type="text" placeholder="spec, storage" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink focus:outline-none" />
          </div>

          <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
            Create Task
          </button>
        </form>
      \`);
    }

    async function executeCreateTask(e) {
      e.preventDefault();
      const title = document.getElementById('create-task-title').value.trim();
      const desc = document.getElementById('create-task-desc').value.trim();
      const assigneeVal = document.getElementById('create-task-assignee').value || null;
      const rawLabels = document.getElementById('create-task-labels').value;
      const labels = rawLabels
        .split(',')
        .map(s => s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
        .filter(Boolean);

      let created = null;
      try {
        created = await api.post(\`/admin/api/kanban/projects/\${state.activeProjectId}/tasks\`, {
          title, description: desc, assignee: assigneeVal, labels,
        });
      } catch (err) {
        showToast('Create failed', err.message, 'red');
        return;
      }
      const newTask = {
        id: created.id || created.task?.id,
        project_id: state.activeProjectId,
        title,
        description: desc || '',
        notes: '',
        status: 'todo',
        blocked_kind: null,
        assignee: assigneeVal,
        labels,
        todos: [],
        comments: [],
        comment_count: 0,
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      };

      state.tasks.unshift(newTask);
      closeTopModal();
      showToast(\`Created Task #\${newTask.id}\`, title, 'green');
      renderMainViewport(true);
    }

    function openProjectModal(projId) {
      const proj = projId ? state.projects.find(p => p.id === projId) : null;
      const subs = proj ? (proj.subscribers || []) : [];

      showCustomModal(\`
        <form onsubmit="saveProjectModal(event, \${proj ? proj.id : 'null'})" class="p-4 space-y-3.5">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-muted">
                \${proj ? 'Project Settings' : 'New Project'}
              </div>
              <h3 class="font-serif font-bold text-lg text-ink">
                \${proj ? 'Edit Project & Agent Access' : 'Create Kanban Project'}
              </h3>
            </div>
            <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Project Title</label>
            <input id="proj-modal-title" type="text" required value="\${escapeHtml(proj ? proj.title : '')}" placeholder="Project title..." class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-bold text-ink" />
          </div>

          <div>
            <label class="block font-mono text-xs font-bold text-muted mb-1">Description</label>
            <textarea id="proj-modal-desc" rows="2" class="w-full hw-inset rounded-xl px-3 py-2 text-ink">\${escapeHtml(proj && proj.description ? proj.description : '')}</textarea>
          </div>

          <!-- Project Subscribers -->
          <div class="hw-inset rounded-xl p-3.5 space-y-2">
            <div class="font-mono text-xs font-bold uppercase text-ink">
              Subscribed Agents
            </div>
            <p class="text-xs text-muted leading-snug">
              Leave all unchecked so every agent can view and claim tasks. Or select specific agents to restrict access.
            </p>
            <div class="grid grid-cols-3 gap-2 pt-1">
              \${state.agents.map(a => \`
                <label class="tap-44 flex items-center gap-2 p-2.5 rounded-xl bg-card border border-border cursor-pointer font-mono text-xs font-bold">
                  <input type="checkbox" name="proj-sub" value="\${a.agent}" \${subs.includes(a.agent) ? 'checked' : ''} class="accent-ink w-4 h-4" />
                  <span>@\${a.agent}</span>
                </label>
              \`).join('')}
            </div>
          </div>

          <div class="flex gap-2 pt-1">
            \${proj && state.projects.length > 1 ? \`
              <button type="button" onclick="deleteProject(\${proj.id})" class="hw-btn tap-44 bg-rose-100 text-vermilion font-mono text-xs font-bold px-3.5 rounded-xl">
                Delete
              </button>
            \` : ''}
            <button type="submit" class="hw-btn tap-44 flex-1 bg-ink text-paper font-mono text-xs font-bold py-2.5 rounded-xl">
              \${proj ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      \`);
    }

    async function saveProjectModal(e, projId) {
      e.preventDefault();
      const title = document.getElementById('proj-modal-title').value.trim();
      const desc = document.getElementById('proj-modal-desc').value.trim();
      const checked = Array.from(document.querySelectorAll('input[name="proj-sub"]:checked')).map(el => el.value);

      if (!title) return;

      try {
        if (projId) {
          await api.put(\`/admin/api/kanban/projects/\${projId}\`, { title, description: desc, subscribers: checked });
          const proj = state.projects.find(p => p.id === projId);
          if (proj) {
            proj.title = title;
            proj.description = desc || '';
            proj.subscribers = checked;
            showToast(\`Updated \${proj.title}\`, checked.length ? \`Access: \${checked.join(', ')}\` : 'Open to all agents');
          }
        } else {
          const created = await api.post('/admin/api/kanban/projects', { title, description: desc, subscribers: checked });
          const newProj = {
            id: created.id || created.project?.id,
            title, description: desc || '',
            archived: false, subscribers: checked,
          };
          state.projects.push(newProj);
          state.activeProjectId = newProj.id;
          await refreshTasks();
          showToast(\`Created \${newProj.title}\`, '', 'green');
        }
      } catch (err) {
        showToast('Project save failed', err.message, 'red');
        return;
      }

      closeTopModal();
      renderMainViewport(true);
    }

    async function deleteProject(projId) {
      const proj = state.projects.find(p => p.id === projId);
      try {
        await api.del(\`/admin/api/kanban/projects/\${projId}\`);
      } catch (err) {
        showToast('Delete failed', err.message, 'red');
        return;
      }
      state.projects = state.projects.filter(p => p.id !== projId);
      state.tasks = state.tasks.filter(t => t.project_id !== projId);
      state.activeProjectId = state.projects.length ? state.projects[0].id : null;
      await refreshTasks();
      closeTopModal();
      showToast(\`Deleted project\`, proj ? proj.title : '', 'red');
      renderMainViewport(false);
    }

    /********************************************************************
     * 9. VIEW 3: BUS FEED (Social Timeline, Thread View, Swipe-Right Reply, Quote Strips)
     ********************************************************************/
    function getChannelMembers(channelName) {
      if (!state.channelMembers[channelName]) {
        if (channelName.startsWith('dm:')) {
          const parts = channelName.split(':');
          state.channelMembers[channelName] = parts.slice(1);
        } else {
          state.channelMembers[channelName] = state.agents.map(a => a.agent);
        }
      }
      return state.channelMembers[channelName];
    }

    function getDistinctSenders() {
      const set = new Set(['luki']);
      state.messages.forEach(m => set.add(m.sender));
      state.agents.forEach(a => set.add(a.agent));
      return Array.from(set).sort();
    }

    function getRootMessageId(msg) {
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

    function getDirectAndThreadReplies(rootId) {
      return state.messages
        .filter(m => m.id !== rootId && getRootMessageId(m) === rootId)
        .sort((a, b) => a.id - b.id);
    }

    function renderMessagesView() {
      const mf = state.msgFilter;
      const senders = getDistinctSenders();

      if (!state.channels.includes(state.composerDraft.channel)) {
        state.composerDraft.channel = mf.channel !== 'ALL' ? mf.channel : 'all-agent';
      }

      // If a thread is open, render the focused thread view (original on top, replies in order below)
      const threadRootMsg = state.openThreadMsgId
        ? state.messages.find(m => m.id === state.openThreadMsgId)
        : null;

      if (state.openThreadMsgId && !threadRootMsg) {
        state.openThreadMsgId = null;
      }

      // Reverse-chronological social timeline
      const sortedMsgs = [...state.messages].sort((a, b) => b.id - a.id);
      const filteredMsgs = sortedMsgs.filter(m => {
        if (mf.channel !== 'ALL' && m.channel !== mf.channel) return false;
        if (mf.sender !== 'ALL' && m.sender !== mf.sender) return false;
        if (mf.priority !== 'ALL' && m.priority !== mf.priority) return false;
        if (mf.q.trim() !== '') {
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

      return \`
        <div class="flex-1 flex flex-col justify-between min-h-full">
          \${threadRootMsg ? renderThreadTimeline(threadRootMsg) : \`
            <div class="p-3.5 pb-24 space-y-3">
              <!-- Channel & Filter Card -->
              <div class="hw-card rounded-2xl p-3 bg-card space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono text-xs font-bold uppercase tracking-wider text-muted">
                    Channels (\${state.channels.length})
                  </span>
                  <div class="flex items-center gap-1.5">
                    \${mf.channel !== 'ALL' && mf.channel !== 'all-agent' ? \`
                      <button onclick="confirmDeleteChannel('\${escapeHtml(mf.channel)}')" class="tap-44 px-3 font-mono text-xs font-bold bg-rose-100 text-vermilion border border-rose-400 rounded-xl flex items-center">
                        Delete #\${escapeHtml(mf.channel)}
                      </button>
                    \` : ''}
                    <button onclick="openCreateChannelModal()" class="hw-btn tap-44 px-3 font-mono text-xs font-bold bg-ink text-paper rounded-xl flex items-center gap-1">
                      <i class="ph-bold ph-plus"></i> New Channel
                    </button>
                  </div>
                </div>

                <!-- Horizontal Channel Pill Strip (all >=44px tall) -->
                <div data-scroll-id="msg-channel-strip" class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  <button
                    onclick="setMsgFilter('channel', 'ALL')"
                    class="tap-44 px-3 rounded-xl font-mono text-xs font-bold shrink-0 border transition flex items-center \${
                      mf.channel === 'ALL' ? 'bg-ink text-paper border-ink' : 'bg-recessed text-ink border-border'
                    }"
                  >
                    All (\${state.messages.length})
                  </button>
                  \${state.channels.slice().sort().map(ch => {
                    const count = state.messages.filter(m => m.channel === ch).length;
                    const active = mf.channel === ch;
                    const isDm = ch.startsWith('dm:');
                    return \`
                      <button
                        onclick="setMsgFilter('channel', '\${escapeHtml(ch)}')"
                        class="tap-44 px-3 rounded-xl font-mono text-xs font-bold shrink-0 border transition flex items-center gap-1.5 \${
                          active ? 'bg-ink text-paper border-ink' : 'bg-recessed text-ink border-border'
                        }"
                      >
                        <i class="ph-bold \${isDm ? 'ph-chats' : 'ph-hash'} text-xs opacity-75"></i>
                        <span>\${escapeHtml(ch)}</span>
                        <span class="text-[11px] opacity-70">\${count}</span>
                      </button>
                    \`;
                  }).join('')}
                </div>

                <!-- Channel Membership Strip (Visible on active channel or composer target channel) -->
                \${(() => {
                  const targetCh = mf.channel !== 'ALL' ? mf.channel : state.composerDraft.channel;
                  const members = getChannelMembers(targetCh);
                  return \`
                    <div class="pt-2 border-t border-border flex items-center justify-between gap-2">
                      <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span class="font-mono text-[11px] font-bold text-muted flex items-center gap-1">
                          <i class="ph-bold ph-users"></i> #\${escapeHtml(targetCh)} members (\${members.length}):
                        </span>
                        \${members.length === 0 ? \`
                          <span class="font-mono text-[11px] text-muted italic">No members</span>
                        \` : members.map(ag => {
                          const st = getAgentStyle(ag);
                          return \`<span class="font-mono text-[11px] \${st.bg} \${st.text} border \${st.border} px-2 py-0.5 rounded-md font-bold">@\${escapeHtml(ag)}</span>\`;
                        }).join('')}
                      </div>
                      <button
                        type="button"
                        onclick="openChannelMembersModal('\${escapeHtml(targetCh)}')"
                        class="tap-44 px-2.5 rounded-xl bg-recessed border border-border font-mono text-xs font-bold text-ink shrink-0 flex items-center gap-1"
                      >
                        <i class="ph-bold ph-user-gear text-sm"></i>
                        <span>Members</span>
                      </button>
                    </div>
                  \`;
                })()}

                <!-- Sender, Priority & Search Filter Row -->
                <div class="grid grid-cols-3 gap-1.5 pt-1 border-t border-border">
                  <select onchange="setMsgFilter('sender', this.value)" class="tap-44 hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink">
                    <option value="ALL" \${mf.sender === 'ALL' ? 'selected' : ''}>All senders</option>
                    \${senders.map(s => \`<option value="\${s}" \${mf.sender === s ? 'selected' : ''}>@\${s}</option>\`).join('')}
                  </select>

                  <select onchange="setMsgFilter('priority', this.value)" class="tap-44 hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink">
                    <option value="ALL" \${mf.priority === 'ALL' ? 'selected' : ''}>Any priority</option>
                    <option value="urgent" \${mf.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                    <option value="normal" \${mf.priority === 'normal' ? 'selected' : ''}>Normal</option>
                    <option value="low" \${mf.priority === 'low' ? 'selected' : ''}>Low</option>
                  </select>

                  <input
                    id="msg-search-input"
                    type="text"
                    value="\${escapeHtml(mf.q)}"
                    oninput="setMsgFilter('q', this.value)"
                    placeholder="Search posts..."
                    class="tap-44 hw-inset rounded-xl px-2.5 py-1.5 font-sans text-ink focus:outline-none"
                  />
                </div>
              </div>

              <div class="text-xs text-muted px-1 flex items-center justify-between">
                <span><i class="ph-bold ph-hand-swipe-right mr-1"></i>Swipe right on any post to reply • Tap a post to open its thread</span>
              </div>

              <!-- Social Timeline Feed -->
              <div class="space-y-2.5">
                \${filteredMsgs.length === 0 ? \`
                  <div class="hw-inset rounded-2xl p-8 text-center text-sm text-muted">
                    No messages match your filter.
                  </div>
                \` : filteredMsgs.map(m => renderMessageCard(m, false)).join('')}
              </div>
            </div>
          \`}

          <!-- STICKY BOTTOM COMPACT / EXPANDABLE MESSAGE COMPOSER -->
          <div id="composer-dock" class="sticky bottom-0 left-0 right-0 z-20 px-3 pb-2.5 pt-1.5 bg-gradient-to-t from-paper via-paper to-transparent">
            \${!state.composerExpanded ? \`
              <!-- Compact Bar -->
              <button
                type="button"
                onclick="expandComposer()"
                class="hw-card tap-44 w-full rounded-2xl px-3.5 py-2.5 bg-card flex items-center justify-between gap-2 text-left active:translate-y-0.5 transition"
              >
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <span class="font-mono text-xs font-bold bg-ink text-paper px-2.5 py-1 rounded-lg shrink-0 flex items-center gap-1">
                    <i class="ph-bold ph-hash text-xs text-amber-400"></i>\${escapeHtml(draft.channel)}
                  </span>
                  <span class="font-mono text-[11px] px-2 py-0.5 rounded-md border font-bold shrink-0 \${prioHintStyle}">
                    \${escapeHtml(PRIORITY_LABELS[draft.priority] || 'Normal')}
                  </span>
                  <span class="text-sm text-muted truncate pl-1">
                    \${replyTarget ? \`Replying to @\${replyTarget.sender}...\` : draft.body ? escapeHtml(draft.body) : 'Send a message...'}
                  </span>
                </div>
                <span class="w-10 h-10 rounded-xl bg-ink text-paper flex items-center justify-center shrink-0">
                  <i class="ph-bold ph-paper-plane-tilt text-base"></i>
                </span>
              </button>
            \` : \`
              <!-- Expanded Full Composer Sheet -->
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

                <!-- Reply Banner if Replying -->
                \${replyTarget ? \`
                  <div class="hw-inset rounded-xl p-2.5 flex items-start justify-between gap-2 border-l-4 border-l-forest">
                    <div class="min-w-0">
                      <div class="font-mono text-xs font-bold text-forest">
                        Replying to @\${escapeHtml(replyTarget.sender)} in #\${escapeHtml(replyTarget.channel)}
                      </div>
                      <div class="text-xs text-muted truncate mt-0.5">
                        "\${escapeHtml(replyTarget.body)}"
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
                \` : ''}

                <div class="grid grid-cols-3 gap-2">
                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Channel</label>
                    <select
                      id="compose-channel"
                      onchange="updateComposerDraft('channel', this.value)"
                      class="tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-mono text-xs font-bold text-ink"
                    >
                      \${state.channels.slice().sort().map(ch => \`
                        <option value="\${escapeHtml(ch)}" \${draft.channel === ch ? 'selected' : ''}>
                          #\${escapeHtml(ch)}
                        </option>
                      \`).join('')}
                    </select>
                  </div>
                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Priority</label>
                    <select
                      id="compose-priority"
                      onchange="updateComposerDraft('priority', this.value)"
                      class="tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink"
                    >
                      <option value="normal" \${draft.priority === 'normal' ? 'selected' : ''}>Normal</option>
                      <option value="urgent" \${draft.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
                      <option value="low" \${draft.priority === 'low' ? 'selected' : ''}>Low</option>
                    </select>
                  </div>
                  <div>
                    <label class="block font-mono text-[11px] font-bold text-muted mb-1">Audience</label>
                    <select
                      id="compose-audience"
                      onchange="updateComposerDraft('audience', this.value)"
                      class="tap-44 w-full hw-inset rounded-xl px-2 py-1.5 font-sans text-xs font-bold text-ink"
                    >
                      <option value="agents" \${draft.audience === 'agents' ? 'selected' : ''}>Agents</option>
                      <option value="luki" \${draft.audience === 'luki' ? 'selected' : ''}>Just me</option>
                    </select>
                  </div>
                </div>

                <textarea
                  id="compose-body"
                  rows="3"
                  required
                  oninput="updateComposerDraft('body', this.value)"
                  onfocus="keepFieldAboveKeyboard(this)"
                  placeholder="Write your message..."
                  class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none leading-relaxed"
                >\${escapeHtml(draft.body)}</textarea>

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
                    class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-5 rounded-xl flex items-center gap-1.5"
                  >
                    <i class="ph-bold ph-paper-plane-right"></i>
                    <span>Send a message</span>
                  </button>
                </div>
              </form>
            \`}
          </div>
        </div>
      \`;
    }

    function renderMessageCard(m, isInsideThread = false) {
      const st = getAgentStyle(m.sender);
      const parentMsg = m.reply_to ? state.messages.find(p => p.id === m.reply_to) : null;
      const rootId = getRootMessageId(m);
      const replies = getDirectAndThreadReplies(rootId);
      const replyCount = replies.length;

      return \`
        <div class="swipe-shell select-none" id="msg-swipe-shell-\${m.id}">
          <!-- Physical Background Track Revealed While Swiping Right to Reply -->
          <div
            id="msg-swipe-bg-\${m.id}"
            class="swipe-bg bg-charcoal text-stone-200 px-4 flex items-center justify-start gap-2.5 rounded-2xl transition-colors duration-150"
          >
            <span
              id="msg-swipe-icon-\${m.id}"
              class="w-10 h-10 rounded-xl bg-white/15 border border-white/25 flex items-center justify-center transition-transform duration-150"
            >
              <i class="ph-bold ph-arrow-bend-up-left text-lg"></i>
            </span>
            <div class="font-mono text-xs font-bold">
              <div id="msg-swipe-label-\${m.id}">Swipe to reply</div>
              <div class="text-[10px] opacity-80">@\${escapeHtml(m.sender)} • #\${escapeHtml(m.channel)}</div>
            </div>
          </div>

          <!-- Foreground Draggable Message Card -->
          <article
            id="msg-card-\${m.id}"
            onpointerdown="handleMsgPointerDown(event, \${m.id})"
            onclick="openMessageThreadIfNotSwiped(\${rootId}, event)"
            class="swipe-fg hw-card rounded-2xl p-3.5 bg-card space-y-2.5 cursor-pointer relative \${m.priority === 'urgent' ? 'border-l-4 border-l-vermilion' : ''}"
          >
            <!-- Quote Strip if this message is a reply -->
            \${parentMsg ? \`
              <button
                type="button"
                onclick="scrollToQuotedMessage(\${parentMsg.id}, event)"
                class="w-full text-left hw-inset rounded-xl px-3 py-2 border-l-4 border-l-forest flex items-center justify-between gap-2 hover:bg-card transition"
              >
                <div class="min-w-0">
                  <div class="font-mono text-xs font-bold text-forest flex items-center gap-1">
                    <i class="ph-bold ph-arrow-bend-up-left"></i>
                    <span>Replying to @\${escapeHtml(parentMsg.sender)}</span>
                  </div>
                  <div class="text-xs text-muted truncate mt-0.5">
                    "\${escapeHtml(parentMsg.body)}"
                  </div>
                </div>
                <span class="font-mono text-[11px] text-muted shrink-0">Jump</span>
              </button>
            \` : ''}

            <!-- Top Author & Channel Row -->
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5 flex-wrap">
                <button onclick="event.stopPropagation(); setMsgFilter('sender', '\${escapeHtml(m.sender)}')" class="tap-44 px-2.5 rounded-xl font-mono text-xs font-bold \${st.bg} \${st.text} border \${st.border} flex items-center gap-1">
                  @\${escapeHtml(m.sender)}
                </button>
                <button onclick="event.stopPropagation(); setMsgFilter('channel', '\${escapeHtml(m.channel)}')" class="tap-44 px-2.5 rounded-xl font-mono text-xs font-bold bg-recessed text-ink border border-border flex items-center">
                  #\${escapeHtml(m.channel)}
                </button>
                \${m.priority === 'urgent' ? \`<span class="font-mono text-[11px] bg-vermilion text-white px-2 py-0.5 rounded-md font-bold">Urgent</span>\` : ''}
                \${m.priority === 'low' ? \`<span class="font-mono text-[11px] bg-stone-200 text-stone-700 px-2 py-0.5 rounded-md font-semibold">Low</span>\` : ''}
                \${m.audience === 'luki' ? \`
                  <span class="font-mono text-[11px] px-2 py-0.5 rounded-md bg-amber-200 text-amber-950 border border-amber-700 font-bold">
                    Just me
                  </span>
                \` : ''}
              </div>

              <!-- 44px Ergonomic Action Buttons (Reply, Edit, Delete) -->
              <div class="flex items-center gap-1" onclick="event.stopPropagation()">
                <button onclick="startReplyToMessage(\${m.id}, event)" class="tap-44 w-11 rounded-xl bg-recessed hover:bg-ink hover:text-paper text-ink flex items-center justify-center transition" title="Reply to message">
                  <i class="ph-bold ph-arrow-bend-up-left text-base"></i>
                </button>
                <button onclick="openEditMessageModal(\${m.id})" class="tap-44 w-11 rounded-xl bg-recessed hover:bg-ink hover:text-paper text-ink flex items-center justify-center transition" title="Edit message">
                  <i class="ph-bold ph-pencil-simple text-base"></i>
                </button>
                <button onclick="confirmDeleteMessage(\${m.id})" class="tap-44 w-11 rounded-xl bg-recessed hover:bg-vermilion hover:text-white text-muted flex items-center justify-center transition" title="Delete message">
                  <i class="ph-bold ph-trash text-base"></i>
                </button>
              </div>
            </div>

            <!-- Message Body (>=14px / text-sm for easy reading) -->
            <p class="text-sm text-ink leading-relaxed break-words whitespace-pre-wrap">\${escapeHtml(m.body)}</p>

            <!-- Footer: Friendly Time + Thread Count -->
            <div class="flex items-center justify-between font-mono text-xs text-muted pt-1.5 border-t border-border/60">
              <span>\${formatFriendlyIsoTime(m.ts)} • \${formatRelIso(m.ts)}</span>
              <div class="flex items-center gap-2">
                \${!isInsideThread && replyCount > 0 ? \`
                  <span class="text-forest font-bold flex items-center gap-1">
                    <i class="ph-bold ph-chats-circle"></i>
                    \${replyCount} \${replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                \` : \`
                  <span class="text-muted flex items-center gap-1">
                    <i class="ph-bold ph-chat-teardrop"></i> Thread
                  </span>
                \`}
              </div>
            </div>
          </article>
        </div>
      \`;
    }

    function renderThreadTimeline(rootMsg) {
      const replies = getDirectAndThreadReplies(rootMsg.id);
      return \`
        <div class="p-3.5 pb-24 space-y-3.5">
          <!-- Back to Timeline Bar -->
          <div class="hw-card rounded-2xl p-2.5 bg-card flex items-center justify-between gap-2">
            <button onclick="closeMessageThread()" class="tap-44 px-3 rounded-xl bg-recessed text-ink font-mono text-xs font-bold flex items-center gap-1.5 border border-border">
              <i class="ph-bold ph-arrow-left text-base"></i>
              <span>Back to Bus Feed</span>
            </button>
            <span class="font-serif font-bold text-base text-ink pr-2">
              Thread in #\${escapeHtml(rootMsg.channel)}
            </span>
          </div>

          <!-- Original Post on Top -->
          <div class="space-y-1.5">
            <div class="font-mono text-xs font-bold uppercase text-muted px-1">Original Post</div>
            \${renderMessageCard(rootMsg, true)}
          </div>

          <!-- Replies Underneath in Chronological Order -->
          <div class="space-y-2.5 pt-1">
            <div class="font-mono text-xs font-bold uppercase text-muted px-1">
              Replies (\${replies.length})
            </div>
            \${replies.length === 0 ? \`
              <div class="hw-inset rounded-2xl p-6 text-center text-sm text-muted">
                No replies yet. Swipe right on the post above or tap below to reply.
              </div>
            \` : replies.map(r => \`
              <div class="pl-3 border-l-2 border-forest">
                \${renderMessageCard(r, true)}
              </div>
            \`).join('')}
          </div>
        </div>
      \`;
    }

    function openMessageThread(rootId, e) {
      if (e) e.stopPropagation();
      state.openThreadMsgId = rootId;
      const rootMsg = state.messages.find(m => m.id === rootId);
      if (rootMsg) {
        state.composerDraft.channel = rootMsg.channel;
      }
      renderMainViewport(false);
    }

    function openMessageThreadIfNotSwiped(rootId, e) {
      if (Date.now() - lastSwipeGestureTs < 320) {
        if (e) e.stopPropagation();
        return;
      }
      openMessageThread(rootId, e);
    }

    function closeMessageThread() {
      state.openThreadMsgId = null;
      renderMainViewport(false);
    }

    // Physical swipe right on a message = drag card with resistance, reveal reply track, snap back smoothly, then open reply composer
    let activeMsgSwipe = null;

    function handleMsgPointerDown(e, msgId) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea')) return;

      const fg = document.getElementById(\`msg-card-\${msgId}\`);
      const bg = document.getElementById(\`msg-swipe-bg-\${msgId}\`);
      const icon = document.getElementById(\`msg-swipe-icon-\${msgId}\`);
      const label = document.getElementById(\`msg-swipe-label-\${msgId}\`);
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

    function handleMsgPointerMove(e) {
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
        activeMsgSwipe.fg.style.transform = \`translate3d(\${damped}px, 0, 0)\`;

        const past = clampedDx >= SWIPE_THRESHOLD_PX;
        if (activeMsgSwipe.bg) {
          activeMsgSwipe.bg.className = \`swipe-bg px-4 flex items-center justify-start gap-2.5 rounded-2xl transition-colors duration-150 \${
            past ? 'bg-forest text-white' : 'bg-charcoal text-stone-200'
          }\`;
        }
        if (activeMsgSwipe.icon) {
          activeMsgSwipe.icon.style.transform = \`scale(\${past ? 1.12 : 0.92})\`;
        }
        if (activeMsgSwipe.label) {
          activeMsgSwipe.label.textContent = past ? 'Release to reply' : 'Swipe to reply';
        }
      }
    }

    function handleMsgPointerUp(e) {
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

    function cleanupMsgPointerListeners() {
      window.removeEventListener('pointermove', handleMsgPointerMove);
      window.removeEventListener('pointerup', handleMsgPointerUp);
      window.removeEventListener('pointercancel', handleMsgPointerUp);
    }

    function startReplyToMessage(msgId, e) {
      if (e) e.stopPropagation();
      const target = state.messages.find(m => m.id === msgId);
      if (!target) return;
      state.composerDraft.reply_to = target.id;
      state.composerDraft.channel = target.channel;
      state.composerExpanded = true;
      renderMainViewport(true);
      setTimeout(() => {
        const ta = document.getElementById('compose-body');
        if (ta) {
          ta.focus();
          keepFieldAboveKeyboard(ta);
        }
      }, 40);
    }

    function cancelComposerReply() {
      state.composerDraft.reply_to = null;
      renderMainViewport(true);
    }

    function scrollToQuotedMessage(targetId, e) {
      if (e) e.stopPropagation();
      const targetEl = document.getElementById(\`msg-card-\${targetId}\`);
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
        renderMainViewport(false);
        setTimeout(() => {
          const el = document.getElementById(\`msg-card-\${targetId}\`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('highlight-pulse');
          }
        }, 50);
      }
    }

    function expandComposer() {
      if (state.msgFilter.channel !== 'ALL' && !state.composerDraft.reply_to) {
        state.composerDraft.channel = state.msgFilter.channel;
      }
      state.composerExpanded = true;
      renderMainViewport(true);
      setTimeout(() => {
        const ta = document.getElementById('compose-body');
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
          keepFieldAboveKeyboard(ta);
        }
      }, 40);
    }

    function collapseComposer() {
      state.composerExpanded = false;
      renderMainViewport(true);
    }

    function updateComposerDraft(field, value) {
      state.composerDraft[field] = value;
    }

    function setMsgFilter(key, val) {
      state.msgFilter[key] = val;
      if (key === 'channel' && val !== 'ALL') {
        state.composerDraft.channel = val;
      }
      renderMainViewport(true);
      if (key === 'q') {
        const input = document.getElementById('msg-search-input');
        if (input) {
          input.focus();
          input.setSelectionRange(val.length, val.length);
        }
      }
    }

    async function sendOperatorMessage(e) {
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
        \`Posted in #\${channel} (\${PRIORITY_LABELS[priority]} • \${AUDIENCE_LABELS[audience]})\`,
        'green'
      );
      renderMainViewport(true);
      updateHeaderTelemetry();
    }

    function openEditMessageModal(msgId) {
      const msg = state.messages.find(m => m.id === msgId);
      if (!msg) return;
      showCustomModal(\`
        <form onsubmit="executeEditMessage(event, \${msg.id})" class="p-4 space-y-3.5">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-muted">Edit Post</div>
              <h3 class="font-serif font-bold text-lg text-ink">Message by @\${escapeHtml(msg.sender)}</h3>
            </div>
            <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>
          <textarea id="edit-msg-body" rows="4" required class="w-full hw-inset rounded-xl p-3 text-ink focus:outline-none">\${escapeHtml(msg.body)}</textarea>
          <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-3 rounded-xl">
            Save Changes
          </button>
        </form>
      \`);
    }

    async function executeEditMessage(e, msgId) {
      e.preventDefault();
      const msg = state.messages.find(m => m.id === msgId);
      if (!msg) return;
      const newBody = document.getElementById('edit-msg-body').value.trim();
      try {
        await api.put(\`/admin/api/messages/\${msgId}\`, { body: newBody });
      } catch (err) {
        showToast('Edit failed', err.message, 'red');
        return;
      }
      msg.body = newBody;
      msg.edited = true;
      closeTopModal();
      showToast('Message updated');
      renderMainViewport(true);
    }

    function confirmDeleteMessage(msgId) {
      const msg = state.messages.find(m => m.id === msgId);
      if (!msg) return;
      showCustomModal(\`
        <div class="p-4 space-y-4">
          <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Message</div>
          <h3 class="font-serif font-bold text-lg text-ink">Remove this post from #\${escapeHtml(msg.channel)}?</h3>
          <p class="text-sm text-muted bg-recessed p-3 rounded-xl">"\${escapeHtml(msg.body)}"</p>
          <div class="flex gap-2">
            <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
            <button onclick="executeDeleteMessage(\${msg.id})" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete</button>
          </div>
        </div>
      \`);
    }

    async function executeDeleteMessage(msgId) {
      const msg = state.messages.find(m => m.id === msgId);
      try {
        await api.del(\`/admin/api/messages/\${msgId}\`);
      } catch (err) {
        showToast('Delete failed', err.message, 'red');
        return;
      }
      state.messages = state.messages.filter(m => m.id !== msgId);
      if (state.openThreadMsgId === msgId) state.openThreadMsgId = null;
      closeTopModal();
      showToast('Message deleted');
      renderMainViewport(true);
      updateHeaderTelemetry();
    }

    function openChannelMembersModal(channelName) {
      const members = getChannelMembers(channelName);
      const allAgentNames = state.agents.map(a => a.agent);

      showCustomModal(\`
        <div class="p-4 space-y-4">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-forest">Channel Membership</div>
              <h3 class="font-serif font-bold text-lg text-ink">#\${escapeHtml(channelName)} Members</h3>
            </div>
            <button type="button" onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <p class="text-xs text-muted leading-relaxed">
            Add or remove agents on <strong class="text-ink">#\${escapeHtml(channelName)}</strong>. Changes immediately emit <span class="font-mono">channel.member_added</span> or <span class="font-mono">channel.member_removed</span> on the bus.
          </p>

          <!-- Current Members List -->
          <div class="space-y-2">
            <div class="font-mono text-xs font-bold uppercase text-muted">
              Current Members (\${members.length})
            </div>
            \${members.length === 0 ? \`
              <div class="hw-inset rounded-xl p-3.5 text-center text-xs text-muted">
                No agents currently assigned to #\${escapeHtml(channelName)}.
              </div>
            \` : members.map(ag => {
              const st = getAgentStyle(ag);
              const agObj = state.agents.find(a => a.agent === ag);
              return \`
                <div class="hw-inset rounded-xl p-2.5 flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="font-mono text-xs font-bold \${st.bg} \${st.text} border \${st.border} px-2.5 py-1 rounded-lg">
                      @\${escapeHtml(ag)}
                    </span>
                    <span class="text-xs text-muted truncate">\${escapeHtml(agObj ? agObj.role : 'Registered Agent')}</span>
                  </div>
                  <button
                    type="button"
                    onclick="removeChannelMember('\${escapeHtml(channelName)}', '\${escapeHtml(ag)}')"
                    class="hw-btn tap-44 px-3 rounded-xl bg-rose-100 text-vermilion font-mono text-xs font-bold flex items-center gap-1 shrink-0"
                  >
                    <i class="ph-bold ph-user-minus"></i>
                    <span>Remove</span>
                  </button>
                </div>
              \`;
            }).join('')}
          </div>

          <!-- Available Agents to Add -->
          <div class="space-y-2 pt-2 border-t border-border">
            <div class="font-mono text-xs font-bold uppercase text-muted">
              Add Agent to #\${escapeHtml(channelName)}
            </div>
            \${allAgentNames.filter(a => !members.includes(a)).length === 0 ? \`
              <div class="text-xs text-muted py-1">All registered agents are already members of this channel.</div>
            \` : \`
              <div class="grid grid-cols-2 gap-2">
                \${allAgentNames.filter(a => !members.includes(a)).map(ag => \`
                  <button
                    type="button"
                    onclick="addChannelMember('\${escapeHtml(channelName)}', '\${escapeHtml(ag)}')"
                    class="hw-btn tap-44 px-3 rounded-xl bg-forest text-white font-mono text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <i class="ph-bold ph-user-plus"></i>
                    <span>Add @\${escapeHtml(ag)}</span>
                  </button>
                \`).join('')}
              </div>
            \`}

            <!-- Custom Handle Add -->
            <form onsubmit="addCustomChannelMember(event, '\${escapeHtml(channelName)}')" class="flex gap-2 pt-1">
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
      \`);
    }

    async function addChannelMember(channelName, agentName) {
      try {
        await api.post(\`/admin/api/channels/\${encodeURIComponent(channelName)}/members\`, { agent: agentName });
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
        showToast(\`Added @\${agentName}\`, \`Member of #\${channelName}\`, 'green');
      }
      openChannelMembersModal(channelName);
      renderMainViewport(true);
    }

    function addCustomChannelMember(e, channelName) {
      e.preventDefault();
      const input = document.getElementById('custom-channel-member-input');
      const handle = input.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!handle) return;
      addChannelMember(channelName, handle);
    }

    async function removeChannelMember(channelName, agentName) {
      try {
        await api.del(\`/admin/api/channels/\${encodeURIComponent(channelName)}/members/\${encodeURIComponent(agentName)}\`);
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
      showToast(\`Removed @\${agentName}\`, \`Removed from #\${channelName}\`);
      openChannelMembersModal(channelName);
      renderMainViewport(true);
    }

    function openCreateChannelModal() {
      showCustomModal(\`
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
      \`);
    }

    async function executeCreateChannel(e) {
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
          showToast('Order agent names alphabetically', \`Try dm:\${[a,b].sort().join(':')}\`, 'red');
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
      showToast(\`Created #\${name}\`, seed ? 'Opening message posted' : '', 'green');
      renderMainViewport(true);
    }

    function confirmDeleteChannel(channelName) {
      const count = state.messages.filter(m => m.channel === channelName).length;
      showCustomModal(\`
        <div class="p-4 space-y-4">
          <div class="font-mono text-xs font-bold uppercase text-vermilion">Delete Channel</div>
          <h3 class="font-serif font-bold text-lg text-ink">Delete #\${escapeHtml(channelName)}?</h3>
          <p class="text-sm text-muted">
            This removes the channel and all <strong>\${count} messages</strong> inside it.
          </p>
          <div class="flex gap-2">
            <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
            <button onclick="executeDeleteChannel('\${escapeHtml(channelName)}')" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Delete Channel</button>
          </div>
        </div>
      \`);
    }

    async function executeDeleteChannel(channelName) {
      try {
        await api.del(\`/admin/api/channels/\${encodeURIComponent(channelName)}\`);
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
      showToast(\`Deleted #\${channelName}\`);
      renderMainViewport(true);
      updateHeaderTelemetry();
    }

    /********************************************************************
     * 10. VIEW 4: AGENTS (Live Status, Rate Quota, Register, Rotate, Revoke + Activity Tools)
     ********************************************************************/
    function renderAgentsView() {
      return \`
        <div class="p-3.5 space-y-3.5">
          <!-- Header Card -->
          <div class="hw-card rounded-2xl p-3.5 bg-card flex items-center justify-between gap-2">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-muted">Connected Crew</div>
              <h1 class="font-serif text-xl font-bold text-ink">Agents (\${state.agents.length})</h1>
              <p class="text-xs text-muted mt-0.5">Manage agent credentials, live connection modes, and rate quotas.</p>
            </div>
            <button onclick="openRegisterAgentModal()" class="hw-btn tap-44 bg-ink text-paper font-mono text-xs font-bold px-3.5 rounded-xl shrink-0 flex items-center gap-1.5">
              <i class="ph-bold ph-plus-bold"></i>
              <span>Register</span>
            </button>
          </div>

          <!-- Simulation & Live Event Feed Tools (Moved out of Header per #11, using neutral/forest accents per #8) -->
          <div class="hw-card rounded-2xl p-3 bg-card flex items-center justify-between gap-2">
            <button onclick="pollOnce().then(() => openUnifiedPollSheet())" class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
              <i class="ph-bold ph-lightning text-sm"></i>
              <span>Simulate Agent Activity</span>
            </button>
            <button onclick="openUnifiedPollSheet()" class="hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold px-3.5 rounded-xl flex items-center justify-center gap-1.5">
              <i class="ph-bold ph-broadcast text-sm"></i>
              <span>Event Log (\${state.pollEvents.length})</span>
            </button>
          </div>

          <!-- Agent Cards -->
          <div class="space-y-3">
            \${state.agents.map(ag => {
              const st = getAgentStyle(ag.agent);
              const pct = Math.min(100, Math.round((ag.rate.used / ag.rate.limit) * 100));
              const isHighRate = pct >= 85;
              const isLiveWs = ag.transport === 'ws';
              const windowLabel = ag.rate.windowSec === 3600 ? 'Hourly quota' : 'Per-minute quota';

              return \`
                <div class="hw-card rounded-2xl p-3.5 bg-card space-y-3">
                  <!-- Top Identity Row -->
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex items-center gap-2.5">
                      <div class="w-11 h-11 rounded-xl \${st.bg} border-1.5 \${st.border} flex items-center justify-center font-mono font-bold text-base \${st.text}">
                        \${escapeHtml(ag.agent.slice(0, 2).toUpperCase())}
                      </div>
                      <div>
                        <div class="flex items-center gap-1.5 flex-wrap">
                          <span class="font-mono text-base font-bold text-ink">@\${escapeHtml(ag.agent)}</span>
                          <span class="font-mono text-[11px] px-2 py-0.5 rounded-md font-bold flex items-center gap-1 \${
                            isLiveWs
                              ? 'bg-emerald-100 text-emerald-950 border border-emerald-700'
                              : 'bg-amber-100 text-amber-950 border border-amber-700'
                          }">
                            <span class="w-1.5 h-1.5 rounded-full \${isLiveWs ? 'bg-emerald-600 led-blink' : 'bg-amber-600'}"></span>
                            \${isLiveWs ? 'Live Socket' : 'Polling'}
                          </span>
                        </div>
                        <div class="text-xs text-muted mt-0.5">\${escapeHtml(ag.role || 'Autonomous Agent')}</div>
                      </div>
                    </div>

                    <button onclick="toggleAgentTransport('\${escapeHtml(ag.agent)}')" class="tap-44 px-2.5 rounded-xl bg-recessed border border-border font-mono text-xs font-bold text-ink">
                      Switch mode
                    </button>
                  </div>

                  <!-- Rate Limit Meter -->
                  <div class="hw-inset rounded-xl p-3 space-y-1.5">
                    <div class="flex items-center justify-between font-mono text-xs">
                      <span class="text-muted font-semibold">
                        \${windowLabel}
                      </span>
                      <span class="font-bold \${isHighRate ? 'text-ochre' : 'text-ink'}">
                        \${ag.rate.used} of \${ag.rate.limit} sends used
                      </span>
                    </div>
                    <div class="w-full h-2.5 bg-paper rounded-full overflow-hidden border border-border">
                      <div class="h-full transition-all duration-300 \${isHighRate ? 'bg-ochre' : 'bg-forest'}" style="width: \${pct}%"></div>
                    </div>
                  </div>

                  <!-- Subscribed Channels & Timestamps -->
                  <div class="space-y-1 font-mono text-xs text-muted">
                    <div class="flex justify-between">
                      <span>Registered: <strong class="text-ink">\${ag.created.slice(0, 10)}</strong></span>
                      <span>Last active: <strong class="text-ink">\${formatRelIso(ag.last_seen)}</strong></span>
                    </div>
                    \${isLiveWs && ag.channels ? \`
                      <div class="pt-1.5 flex items-center gap-1.5 flex-wrap">
                        <span>Listening:</span>
                        \${ag.channels.map(c => \`<span class="bg-recessed text-ink px-2 py-0.5 rounded border border-border">#\${escapeHtml(c)}</span>\`).join('')}
                      </div>
                    \` : ''}
                  </div>

                  <!-- Actions: Rotate Token, Revoke (>=44px targets) -->
                  <div class="pt-1 flex items-center gap-2">
                    <button onclick="rotateAgentToken('\${escapeHtml(ag.agent)}')" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
                      <i class="ph-bold ph-key text-base"></i>
                      <span>Rotate Secret</span>
                    </button>
                    <button onclick="confirmRevokeAgent('\${escapeHtml(ag.agent)}')" class="hw-btn tap-44 bg-recessed hover:bg-vermilion hover:text-white text-ink font-mono text-xs font-bold px-3.5 rounded-xl flex items-center justify-center gap-1.5 transition">
                      <i class="ph-bold ph-prohibit text-base"></i>
                      <span>Revoke</span>
                    </button>
                  </div>
                </div>
              \`;
            }).join('')}
          </div>
        </div>
      \`;
    }

    function generateHexToken(len = 48) {
      const chars = '0123456789abcdef';
      let out = '';
      for (let i = 0; i < len; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
      }
      return out;
    }

    function openRegisterAgentModal() {
      showCustomModal(\`
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
      \`);
    }

    async function executeRegisterAgent(e) {
      e.preventDefault();
      const name = document.getElementById('reg-agent-name').value.trim();
      const role = document.getElementById('reg-agent-role').value.trim();

      const re = /^[a-z0-9][a-z0-9_-]{0,31}$/;
      if (!re.test(name)) {
        showToast('Invalid agent handle', 'Use lowercase letters, numbers, hyphens, or underscores', 'red');
        return;
      }
      if (state.agents.some(a => a.agent === name)) {
        showToast('Agent already registered', \`@\${name} is already on the bus\`, 'red');
        return;
      }

      let token = null;
      try {
        const _r = await api.post('/admin/api/agents', { agent: name, role: role || undefined });
        token = _r.token || _r.secret || null;
      } catch (_e) {
        showToast('Registration failed', _e.message, 'red');
        return;
      }
      await loadAll();
      renderMainViewport(true);
      updateHeaderTelemetry();
      if (token) showOneTimeTokenModal(name, token, 'REGISTERED');
      else showToast(\`Registered @\${name}\`, '', 'green');
    }

    async function rotateAgentToken(agentName) {
      let _tok = null;
      try {
        const _r = await api.post('/admin/api/agents/' + encodeURIComponent(agentName) + '/rotate');
        _tok = _r.token || _r.secret || null;
      } catch (_e) {
        showToast('Rotate failed', _e.message, 'red');
        return;
      }
      renderMainViewport(true);
      if (_tok) showOneTimeTokenModal(agentName, _tok, 'ROTATED');
      else showToast('Rotated @' + agentName, '', 'green');
    }

    function showOneTimeTokenModal(agentName, token, mode) {
      showCustomModal(\`
        <div class="p-4 space-y-4">
          <div class="caution-stripe-amber border-2 border-ink rounded-xl p-3.5">
            <div class="font-mono text-xs font-bold uppercase text-amber-950">
              \${mode === 'ROTATED' ? 'Secret Rotated' : 'Agent Registered'}
            </div>
            <div class="font-serif font-bold text-base text-ink mt-0.5">
              One-Time Secret for @\${escapeHtml(agentName)}
            </div>
            <p class="text-xs text-amber-950 mt-0.5">
              Copy this secret now. For security, it is only shown once.
            </p>
          </div>

          <div class="hw-inset rounded-xl p-3.5 font-mono text-sm break-all select-all text-ink border-2 border-ink" id="secret-token-box">\${token}</div>

          <div class="flex gap-2">
            <button onclick="copyTokenText('\${token}')" class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold py-3 rounded-xl flex items-center justify-center gap-1.5">
              <i class="ph-bold ph-copy text-base"></i>
              <span>Copy Secret</span>
            </button>
            <button onclick="closeTopModal()" class="hw-btn tap-44 bg-card text-ink font-mono text-xs font-bold py-3 px-4 rounded-xl">
              Close
            </button>
          </div>
        </div>
      \`);
    }

    function copyTokenText(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('Copied to clipboard', '', 'green');
    }

    function confirmRevokeAgent(agentName) {
      showCustomModal(\`
        <div class="p-4 space-y-4">
          <div class="font-mono text-xs font-bold uppercase text-vermilion">Revoke Access</div>
          <h3 class="font-serif font-bold text-lg text-ink">Revoke @\${escapeHtml(agentName)}?</h3>
          <p class="text-sm text-muted">
            Their secret token stops working immediately. Past messages from <strong>@\${escapeHtml(agentName)}</strong> stay in the feed.
          </p>
          <div class="flex gap-2">
            <button onclick="closeTopModal()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl">Cancel</button>
            <button onclick="executeRevokeAgent('\${escapeHtml(agentName)}')" class="hw-btn tap-44 flex-1 bg-vermilion text-white font-mono text-xs font-bold py-2.5 rounded-xl">Revoke Agent</button>
          </div>
        </div>
      \`);
    }

    async function executeRevokeAgent(agentName) {
      try {
        await api.del('/admin/api/agents/' + encodeURIComponent(agentName));
      } catch (_e) {
        showToast('Revoke failed', _e.message, 'red');
        return;
      }
      state.agents = state.agents.filter(a => a.agent !== agentName);
      Object.keys(state.channelMembers).forEach(ch => {
        state.channelMembers[ch] = (state.channelMembers[ch] || []).filter(m => m !== agentName);
      });
      closeTopModal();
      showToast(\`Revoked @\${agentName}\`, 'Credentials deactivated');
      renderMainViewport(true);
      updateHeaderTelemetry();
    }

    function toggleAgentTransport(agentName) {
      const ag = state.agents.find(a => a.agent === agentName);
      if (!ag) return;
      NOW_EPOCH += 1;
      ag.transport = ag.transport === 'ws' ? 'poll' : 'ws';
      ag.last_seen = nowIso();
      // transport toggle is display-only (no backend endpoint)
      showToast(\`@\${agentName} → \${ag.transport === 'ws' ? 'Live Socket' : 'Polling'}\`);
      renderMainViewport(true);
      updateHeaderTelemetry();
    }

    /********************************************************************
     * 11. LIVE EVENT STREAM SHEET & SIMULATOR (Composite Cursor + Admin View + Resync)
     ********************************************************************/
    function togglePollInspectorScope(isAdmin) {
      state.pollInspectorAdminView = isAdmin;
      openUnifiedPollSheet();
    }

    function openUnifiedPollSheet() {
      const visibleEvents = state.pollEvents.filter(ev => state.pollInspectorAdminView || !ev.adminOnly);

      showCustomModal(\`
        <div class="p-4 space-y-3 max-h-[88dvh] flex flex-col">
          <div class="flex items-center justify-between border-b border-border pb-2.5 shrink-0">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-forest">Unified Event Poll</div>
              <h3 class="font-serif font-bold text-lg text-ink">Event Stream (\${visibleEvents.length})</h3>
            </div>
            <button onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <!-- Composite Cursor (ts, id) Telemetry Bar -->
          <div class="hw-inset rounded-xl p-3 space-y-2 shrink-0">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="font-mono text-[11px] font-bold uppercase text-muted">Composite Poll Cursor</span>
              <span class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-card border border-ink text-ink">
                (ts: \${state.pollCursor.ts}, id: \${state.pollCursor.id})
              </span>
            </div>
            <div class="flex items-center justify-between text-[11px] font-mono text-muted">
              <span>Retention cutoff: <strong class="text-ink">\${state.retentionCutoffTs}</strong></span>
            </div>
          </div>

          <!-- Resync Required Banner inside Poll Inspector if active -->
          \${state.resyncRequired ? \`
            <div class="caution-stripe-red border-2 border-ink rounded-xl p-3 space-y-2 shrink-0">
              <div class="font-mono text-xs font-bold uppercase text-vermilion flex items-center gap-1">
                <i class="ph-bold ph-warning-octagon"></i> resync_required: true
              </div>
              <p class="text-xs text-ink leading-snug">
                Cursor <span class="font-mono font-bold">(\${state.pollCursor.ts}, #\${state.pollCursor.id})</span> predates retention cutoff (<span class="font-mono">\${state.retentionCutoffTs}</span>). Full state reload required.
              </p>
              <button onclick="resyncFromServer()" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
                <i class="ph-bold ph-arrows-clockwise"></i>
                <span>Resync from Server</span>
              </button>
            </div>
          \` : ''}

          <!-- Admin View vs Agent View Toggle (Controls visibility of the 4 admin-only agent events) -->
          <div class="grid grid-cols-2 gap-1.5 shrink-0">
            <button
              type="button"
              onclick="togglePollInspectorScope(true)"
              class="tap-44 rounded-xl font-mono text-xs font-bold border transition \${
                state.pollInspectorAdminView ? 'bg-ink text-paper border-ink' : 'bg-recessed text-muted border-border'
              }"
            >
              Admin View (All Events)
            </button>
            <button
              type="button"
              onclick="togglePollInspectorScope(false)"
              class="tap-44 rounded-xl font-mono text-xs font-bold border transition \${
                !state.pollInspectorAdminView ? 'bg-ink text-paper border-ink' : 'bg-recessed text-muted border-border'
              }"
            >
              Agent View (Filtered)
            </button>
          </div>

          <!-- Event Stream List -->
          <div class="flex-1 overflow-y-auto space-y-2 pr-1">
            \${visibleEvents.map(ev => {
              const proj = ev.project_id ? state.projects.find(p => p.id === ev.project_id) : null;
              return \`
                <div class="hw-inset rounded-xl p-3 space-y-1">
                  <div class="flex items-center justify-between gap-2 flex-wrap">
                    <div class="flex items-center gap-1.5 flex-wrap">
                      <span class="font-mono text-xs font-bold text-ink bg-card px-2 py-0.5 rounded border border-border">\${escapeHtml(ev.type)}</span>
                      \${ev.adminOnly ? \`<span class="font-mono text-[10px] font-bold bg-amber-200 text-amber-950 border border-amber-700 px-1.5 py-0.5 rounded">Admin only</span>\` : ''}
                    </div>
                    <span class="font-mono text-[11px] text-muted">(\${ev.ts}, #\${ev.id}) • \${formatRelEpoch(ev.ts)}</span>
                  </div>
                  <div class="text-sm text-ink font-medium pt-0.5">\${escapeHtml(ev.summary || '')}</div>
                  <div class="font-mono text-[11px] text-muted">
                    Scope: <strong class="text-ink">\${proj ? escapeHtml(proj.title) : 'Global bus'}</strong>
                  </div>
                </div>
              \`;
            }).join('')}
          </div>

          <button onclick="pollOnce().then(() => openUnifiedPollSheet());" class="hw-btn tap-44 w-full bg-forest text-white font-mono text-xs font-bold py-2.5 rounded-xl shrink-0 flex items-center justify-center gap-1.5">
            <i class="ph-bold ph-lightning"></i>
            <span>Advance Poll &amp; Simulate Activity</span>
          </button>
        </div>
      \`);
    }

    // Real event poll trigger (replaces the mock simulator).
    // The automatic poller (startPoller) also runs every 8s.
    async function simulateAgentActivity() {
      await pollOnce();
      showToast('Events refreshed', 'Polled live event stream', 'green');
    }


    /********************************************************************
     * 12. OPERATOR SETTINGS, SIMULATOR & EVENT STREAM DRAWER
     ********************************************************************/    function openAdminModal() {
      const wsAgents = state.agents.filter(a => a.transport === 'ws').length;
      showCustomModal(\`
        <div class="p-4 space-y-4">
          <div class="flex items-center justify-between border-b border-border pb-2.5">
            <div>
              <div class="font-mono text-xs font-bold uppercase text-muted">Operator Console</div>
              <h3 class="font-serif font-bold text-lg text-ink">Signed in as @\${escapeHtml(state.adminUser)}</h3>
            </div>
            <button onclick="closeTopModal()" class="tap-44 w-11 rounded-xl bg-recessed flex items-center justify-center">
              <i class="ph-bold ph-x text-base"></i>
            </button>
          </div>

          <!-- Quick Bus Summary & Live Controls -->
          <div class="hw-inset rounded-xl p-3.5 space-y-2.5">
            <div class="flex items-center justify-between text-xs font-mono">
              <span class="text-muted">Bus Status: <strong class="text-forest">Live</strong></span>
              <span class="text-muted">Live Sockets: <strong class="text-ink">\${wsAgents} of \${state.agents.length}</strong></span>
            </div>
            <div class="flex gap-2">
              <button onclick="manualRefresh()" class="hw-btn tap-44 flex-1 bg-forest text-white font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
                <i class="ph-bold ph-arrows-clockwise"></i>
                <span>Refresh Now</span>
              </button>
              <button onclick="openUnifiedPollSheet()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold px-3 rounded-xl flex items-center justify-center gap-1.5">
                <i class="ph-bold ph-broadcast"></i>
                <span>Event Log (\${state.pollEvents.length})</span>
              </button>
            </div>
          </div>

          <form onsubmit="changeAdminPassword(event)" class="space-y-2.5">
            <div class="font-mono text-xs font-bold text-muted">Update Operator Credentials</div>
            <input id="admin-new-user" type="text" value="\${escapeHtml(state.adminUser)}" placeholder="Operator username" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink" />
            <input id="admin-new-pass" type="password" required minlength="1" placeholder="Password" class="tap-44 w-full hw-inset rounded-xl px-3 py-2 font-mono text-ink" />
            <button type="submit" class="hw-btn tap-44 w-full bg-ink text-paper font-mono text-xs font-bold py-2.5 rounded-xl">
              Save Credentials
            </button>
          </form>

          <div class="pt-2 border-t border-border flex gap-2">
            <button onclick="exportBusDump()" class="hw-btn tap-44 flex-1 bg-card text-ink font-mono text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-1.5">
              <i class="ph-bold ph-download-simple"></i>
              <span>Copy Backup</span>
            </button>
            <button onclick="doSignOut()" class="hw-btn tap-44 bg-recessed text-ink font-mono text-xs font-bold py-2.5 px-4 rounded-xl">
              Sign Out
            </button>
          </div>
        </div>
      \`);
    }

    async function changeAdminPassword(e) {
      e.preventDefault();
      const u = document.getElementById('admin-new-user').value.trim();
      const p = document.getElementById('admin-new-pass').value;
      if (!u || !p) return;
      busAuth.set(btoa(u + ':' + p));
      state.adminUser = u;
      closeTopModal();
      try {
        await loadAll();
        showToast('Credentials updated', \`Signed in as @\${state.adminUser}\`, 'green');
      } catch (err) {
        showToast('Invalid credentials', 'Check username/password', 'red');
      }
    }

    function doSignOut() {
      busAuth.clear();
      closeTopModal();
      showLogin('Signed out.');
    }

    function exportBusDump() {
      const dump = JSON.stringify({ messages: state.messages, projects: state.projects, tasks: state.tasks }, null, 2);
      copyTokenText(dump);
      showToast('Backup copied to clipboard', \`\${state.messages.length} messages & \${state.tasks.length} tasks\`, 'green');
    }

    /********************************************************************
     * 13. MODAL CONTROLLER
     ********************************************************************/
    function showCustomModal(htmlContent) {
      const backdrop = document.getElementById('modal-backdrop');
      const sheet = document.getElementById('modal-sheet');
      sheet.innerHTML = htmlContent;
      backdrop.classList.remove('hidden');
      backdrop.classList.add('flex');
    }

    function closeTopModal(e) {
      if (e && e.target && e.target.id !== 'modal-backdrop') return;
      const backdrop = document.getElementById('modal-backdrop');
      backdrop.classList.add('hidden');
      backdrop.classList.remove('flex');
    }

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
  </script>
</body>
</html>
`;
