# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**No Fun League** is an AI-powered fantasy football platform. It's a full-stack TypeScript monorepo with an Express.js backend, Next.js 15 frontend, and PostgreSQL database. It integrates with the Sleeper fantasy football API and uses Anthropic's Claude for AI features (trash talk, weekly recaps, lineup advice).

## Development Commands

### From the repo root

```bash
npm run dev              # Start both backend (port 3001) and frontend (port 3000) concurrently
npm run dev:backend      # Backend only
npm run dev:frontend     # Frontend only
npm run build            # Build both packages
npm run db:migrate       # Run all pending SQL migrations
npm run db:seed          # Seed database with test data
```

### Database (Docker)

```bash
docker-compose up -d     # Start PostgreSQL (nofunleague DB, port 5432)
```

### Frontend only

```bash
cd packages/frontend
npm run lint             # ESLint
```

### Backend only

```bash
cd packages/backend
npm run build            # TypeScript compile → dist/
```

## Environment Setup

Copy `.env.example` to `.env` in `packages/backend/`:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | HS256 signing key |
| `FRONTEND_URL` | Yes | CORS allowed origin |
| `ANTHROPIC_API_KEY` | No | AI features will warn and degrade gracefully |
| `SLEEPER_API_BASE_URL` | No | Defaults to `https://api.sleeper.app/v1` |

Copy `.env.local.example` to `.env.local` in `packages/frontend/`:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL (default: `http://localhost:3001`) |

Local Docker credentials: `postgresql://nfl_user:nfl_password@localhost:5432/nofunleague`

## Architecture

### Monorepo Structure

```
packages/
  backend/    Express.js API server (port 3001)
  frontend/   Next.js 15 App Router (port 3000)
```

### Backend (`packages/backend/src/`)

**Entry point:** `index.ts` — mounts all routes, applies middleware stack in order: health check → Helmet → CORS → JSON body parser → rate limiting → routes.

**Rate limits:**
- Global: 200 req / 15 min
- Auth routes: 20 req / 15 min (brute-force protection)
- AI routes: 10 req / 1 min

**Routes → Services pattern:** Routes handle HTTP concerns; business logic lives in `services/`.

Key services:
- `sleeperService.ts` — Wraps Sleeper's public API (no auth required). Used to sync leagues, rosters, matchups, and the NFL schedule.
- `scheduler.ts` — Cron jobs with DB logging (`sync_logs` table). Handles player sync, stats updates, roster syncs. Admin can manually trigger via `POST /api/admin/sync/...`.
- `draftService.ts` / `draftEngine.ts` — Draft state machine. `draftEngine` manages pick order and auto-pick on timeout; `draftService` wraps DB persistence.
- `anthropicService.ts` — Claude API calls for AI content generation.
- `socketServer.ts` — socket.io instance for real-time draft updates and chat.

**Middleware:**
- `auth.ts` — `authenticate` (blocks, 401) and `optionalAuth` (enriches req, no block). Reads `Authorization: Bearer <token>`.
- `commissioner.ts` — `requireCommissioner` checks the league's `commissioner_id` matches the authenticated user.

**Database migrations:** Sequential SQL files in `src/db/migrations/` named `NNN_description.sql`. The runner in `src/db/migrate.ts` executes them in filename order. Always add new migrations as the next numbered file — never edit existing ones.

### Frontend (`packages/frontend/src/`)

**Framework:** Next.js 15 App Router. All dashboard pages are under `app/dashboard/` and protected by an auth guard in `app/dashboard/layout.tsx`.

**API client:** `lib/api.ts` — Single fetch wrapper that reads the token from localStorage (`nfl_token`), injects the `Authorization` header, and auto-logouts on 401. Organized into namespaced modules: `api.auth`, `api.leagues`, `api.teams`, `api.players`, `api.chat`, `api.ai`, `api.invites`, `api.draft`, `api.trades`.

**State management (Zustand):** `lib/store.ts`
- `useAuthStore` — user + token, persisted to localStorage as `nfl-auth` / `nfl_token`.
- `useLeagueStore` — active league selection, persisted as `nfl-league`.

**Data fetching:** SWR for most server state; raw `api.*` calls for mutations.

**Next.js config:** `/api/*` requests are proxied to `NEXT_PUBLIC_API_URL`. Sleeper CDN domains (`sleepercdn.com`, `avatars.sleeper.app`) are whitelisted for `next/image`.

### Database Schema

Core tables: `users`, `leagues`, `teams`, `players`, `rosters`, `matchups`, `weekly_scores`, `league_chat`, `ai_generations`.

Migration tables: `draft_sessions`, `draft_picks`, `trades`, `trade_items`, `league_invites`, `sync_logs`, `nfl_games`.

All timestamp columns use a trigger to auto-update `updated_at`. UUIDs are used for all primary keys except `players` (which uses Sleeper's `player_id` string as PK).

### Deployment

- **Backend:** Railway.app — builds TypeScript and runs `dist/index.js`. Health check at `/health` (placed before rate limiting middleware intentionally).
- **Frontend:** Likely Vercel (not in this repo's config).
