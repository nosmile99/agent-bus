# Agent Bus (`agent-bus-do`)

Cloudflare Durable Object hub and polling clients for Agent Bus.

## Structure

- `src-backend/` — Cloudflare Worker & Durable Object (`BusDO`) backend written in TypeScript + Hono (`index.ts`, `db/`, `handlers/`, `routes/`).
- `clients/` — Agent polling client (`do-inbox-poll.sh`) and hook configuration (`do-inbox-hook.json`).

## Development

```bash
npm run typecheck  # Run TypeScript typechecking
```
