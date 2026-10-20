You are refactoring a monolithic codebase into maintainable modules. ALL work must be git tracked — commit after each major step.

## Context
This is the Agent Bus operator panel + backend:
- `src-frontend/panel-monolith.html` (4581 lines) — single-file HTML with embedded CSS + JS. It's an Argon-generated mobile UI adapted to a real backend. Contains: auth/login, API client, state management, 4 views (Bus Feed, Needs You, Kanban, Agents), task drawer, modals, event poller, toasts.
- `src-backend/bus-do.js` (~3400 lines) — Cloudflare Durable Object. Contains: HTTP routing, admin API handlers, kanban logic, unified poll, channel management, event system, migrations.

## Task: Split into modules

### Frontend (`src-frontend/`)
Split `panel-monolith.html` into:
- `index.html` — HTML shell (head, body structure, script tags)
- `css/` — extract all `<style>` content into `main.css`, `components.css`, `views.css`
- `js/api.js` — backend API client (auth, fetch wrappers, all `/admin/api/*` calls)
- `js/state.js` — state object + loaders (loadAll, refreshTasks, refreshMessages, etc.)
- `js/poller.js` — event poller (pollOnce, handlePollEvent, resync logic)
- `js/views/feed.js` — Bus Feed view renderer + handlers
- `js/views/kanban.js` — Kanban board renderer + handlers
- `js/views/agents.js` — Agents view renderer + handlers
- `js/views/needs-you.js` — Needs You view
- `js/components/modal.js` — modal controller
- `js/components/drawer.js` — task drawer
- `js/components/toast.js` — toast notifications
- `js/utils.js` — formatters, helpers, time utils
- `js/app.js` — boot/init, wiring everything together

Rules:
- No file over 500 lines. If a module exceeds that, split further.
- Keep all existing functionality. This is a refactor, not a rewrite.
- Use ES modules with import/export.
- Update index.html to load modules.

### Backend (`src-backend/`)
Split `bus-do.js` into:
- `index.js` — DO class shell, fetch router
- `routes/` — route definitions by domain
- `handlers/admin.js` — admin API handlers
- `handlers/kanban.js` — kanban endpoints
- `handlers/poll.js` — unified poll + legacy poll
- `handlers/channels.js` — channel management
- `handlers/messages.js` — message send/edit/delete
- `handlers/agents.js` — agent register/rotate/revoke
- `db/migrations.js` — schema migrations
- `db/events.js` — event emission
- `panel.js` — panel HTML serving (keep as-is for now)

Rules:
- No file over 500 lines.
- Keep all existing functionality and API contracts byte-identical.
- The DO must still export the same class name.

## Git discipline
- Commit after completing each module file.
- Commit messages: `refactor(frontend): extract api.js` style.
- Never leave uncommitted work at the end.

## Verification
After splitting:
1. Frontend: verify no syntax errors (use `node --check` on each JS file).
2. Backend: verify `node --check` passes on all files.
3. Report: list of files created, line counts, any functionality you couldn't preserve.

Start with the frontend. Work through systematically. Commit often.
