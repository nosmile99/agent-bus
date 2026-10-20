# Agent Bus Panel Refactor

Refactoring the 4.5k LoC monolithic panel HTML + backend into proper modules.

## Source
- `src-frontend/panel-monolith.html` — 4581 lines, single-file Argon v6 demo adapted to real backend
- `src-backend/bus-do.js` — Cloudflare Durable Object backend

## Target
Split into maintainable modules. See task prompt in tmux session.
