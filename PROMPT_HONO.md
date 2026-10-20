You are migrating the refactored codebase to Hono + hono/jsx with STRICT TypeScript. ALL work must be git tracked — commit after each major step.

## Current state
- `src-frontend/` — ES modules split (index.html, css/, js/ with views/, components/)
- `src-backend/` — ES modules split (index.js, routes/, handlers/, db/)
- `DESIGN.md` — Argon's design system (colors, typography, components, do's/don'ts). FOLLOW THIS.

## Task: Migrate to Hono + hono/jsx + Strict TypeScript

### Stack
- **Hono** for backend routing (Cloudflare Workers + Durable Objects)
- **hono/jsx** for frontend components (server-rendered or client-hydrated)
- **TypeScript** with `strict: true` in tsconfig — no `any`, no implicit any, strict null checks
- Keep the existing Durable Object class and SQLite logic — only the routing/component layer changes

### Backend (`src-backend/` → TypeScript + Hono)
- Convert all `.js` to `.ts` with full type annotations
- Replace manual route matching with Hono app + router
- Define Zod-like or TypeScript interfaces for all API request/response shapes
- `tsconfig.json` with `"strict": true`, `"noImplicitAny": true`, `"strictNullChecks": true`
- Must pass `tsc --noEmit` with zero errors

### Frontend (`src-frontend/` → hono/jsx + TypeScript)
- Convert views to hono/jsx components (`.tsx`)
- Shared components (modal, drawer, toast, buttons, cards) as typed JSX components
- API client (`api.ts`) with typed request/response interfaces matching backend
- State management with TypeScript interfaces for all state shapes
- Follow `DESIGN.md` exactly — colors, spacing, typography, component specs
- Must pass `tsc --noEmit` with zero errors

### Rules
- No file over 500 lines (existing rule still applies)
- No `any` type. Use `unknown` + narrowing where the shape is truly dynamic.
- All API contracts must match the existing backend byte-identical (don't break the mobile app or other clients)
- The DO class name and export must stay the same

### Git discipline
- Commit after each module conversion
- Messages: `migrate(backend): admin.ts to Hono + strict TS` style
- Never leave uncommitted work

### Verification
1. `tsc --noEmit` passes with zero errors on both frontend and backend
2. `wrangler deploy --dry-run` succeeds (validates Worker compatibility)
3. Report: files converted, any type compromises made, functionality preserved

Start with backend (lower risk), then frontend. Commit often.
