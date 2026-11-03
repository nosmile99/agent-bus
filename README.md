# Agent Bus (`agent-bus-do`)

Cloudflare Durable Object hub and polling clients for Agent Bus.

## Structure

- `src-backend/` — Cloudflare Worker & Durable Object (`BusDO`) backend written in TypeScript + Hono (`index.ts`, `db/`, `handlers/`, `routes/`).
- `clients/` — Agent polling client (`do-inbox-poll.sh`) and hook configuration (`do-inbox-hook.json`).

## Status revamp v12 (branch `revamp-v12`, BELUM deploy)

- Backend revamp v12 (plan terkunci `agent-bus-revamp-plan-v12-DRAFT.md`, status LOCKED) ada di branch `revamp-v12`, belum commit, belum push, belum deploy ke Worker live. Jangan menganggap endpoint revamp sudah live sebelum ada tap push + deploy terpisah.
- Modul baru: `src-backend/handlers/dependencies.ts` (dependency task §4), `src-backend/handlers/ledger.ts` + `src-backend/routes/ledger.ts` (decision ledger §5), plus perpanjangan Phase 3 di handler kanban (soft-delete komentar admin, detail task `dependencies` + `ledger_refs`/`ledger_ref_count`, unlink label owner-or-admin).
- Migrasi: v7 (tabel `task_dependencies`, `dependency_events`, `ledger`, `ledger_events`, `endorsement_uses`, `seed_exception_uses`, `seed_luki_uses`; kolom `tasks.blocked_from_status`, `tasks.unblocked_at`) dan v8 (`dependency_events.blocker_id` NULLABLE; event orphan unarchive menulis NULL, bukan 0 atau self-id).
- `GET /panel` tidak ada (404) setelah backend-only cleanup; admin send men-stamp sender selalu `"luki"`.
- Seed TIDAK di-enable live sampai gate stamp (§8 plan) lolos; lock Q6: tanpa seed dulu, MEMORY.md tetap otoritatif sampai seeding selesai. Demote hanya mencatat actor + deadline per row, TIDAK mengubah scope.
- Dokumen API yang berlaku: `SPEC.md` (baseline rev5 + addendum bagian 17 untuk revamp v12).

## Development

```bash
npm run typecheck  # Run TypeScript typechecking
```
