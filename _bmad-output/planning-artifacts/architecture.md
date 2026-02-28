---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-02-27'
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
workflowType: 'architecture'
project_name: 'Wolf-Cup'
user_name: 'Josh'
date: '2026-02-27'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (63 total across 10 categories):**

- **Scoring Engine (FR1–FR10):** Harvey Cup rules — Stableford + money per hole, deterministic wolf
  hole assignments from ball draw, Guyan G&CC course data (hardcoded MVP)
- **Wolf Money Engine (FR11–FR19):** 2v2 team outcomes vs 1v3 lone wolf, zero-sum enforcement per
  hole, bonus modifiers (greenie, polie, birdie/eagle), auto-detect net birdies/eagles
- **Round Management (FR20–FR26):** Official rounds (entry code gated) vs casual rounds (open,
  guests allowed, not counted in YTD), ball draw capture, cancellation/rainout handling
- **Score Entry (FR27–FR35):** Per-hole gross score entry, net calculation via handicap, offline
  queue with ordered sync on reconnect, wolf partner decision capture, greenie/polie recording
- **Leaderboard & Standings (FR36–FR44):** Live 5-second-polling leaderboard ("thru hole X"),
  pull-to-refresh, staleness indicator, commissioner-toggled live Harvey display, YTD standings
  with drop score and sub separation, playoff eligibility display
- **Season & League Admin (FR45–FR51):** Season config (dates, round count, playoff format), weekly
  entry code, headcount, groups, side game schedule, sub management, rainout cancellation
- **Roster & Player Management (FR52–FR54):** League roster, per-round handicap entry (manual,
  no GHIN API), casual round guest players
- **Side Games (FR55–FR56):** Active game display, manual winner recording
- **Statistics (FR57–FR59):** Wolf call decisions, player stat summaries, persistent historical queries
- **Application Access (FR60–FR63):** PWA iPhone install, public read access, code-gated score
  entry, session-auth admin panel

**Non-Functional Requirements:**

- **Correctness (highest priority):** Zero-sum money validation per hole and per round enforced at
  runtime; Harvey Cup point totals must match expected formula output for active player count;
  historical 2025 data validation gate before launch; atomic DB writes for score submissions
- **Performance:** <3s initial load on cold LTE; <2s score submission acknowledgment; <500ms
  server-side recalculation; leaderboard visible to all users within 10s of score entry
- **Reliability:** App must be operational Fridays 1–5:30pm ET; offline score queue preserves 100%
  of data with zero loss; read-only cached mode survives temporary server outage
- **Security:** HTTPS everywhere; session auth for admin; entry codes invalidated when replaced or
  round closed; no SSNs, payment data, or email stored; no third-party analytics
- **Deployment:** Standalone Docker container behind Traefik on existing VPS; no downtime required
  during non-round hours; calculation inputs/outputs logged for post-round dispute resolution

**Scale & Complexity:**

- Primary domain: Full-stack PWA (mobile-first React frontend + backend API + relational database)
- Complexity level: Medium — small user base (~25), but Harvey Cup scoring engine carries
  enterprise-level business logic complexity
- Concurrent active users: 4 scorers + ~21 read-only during a round peak
- Estimated architectural components: 6–8 (scoring engine, API server, database, PWA shell,
  service worker/offline queue, admin panel, leaderboard, auth layer)

### Technical Constraints & Dependencies

- **VPS deployment only:** Existing Traefik/Docker infrastructure — no managed cloud, no
  serverless, no external message queues. Single-process backend.
- **iOS Safari PWA limits:** No Web Push, limited background sync. Offline sync must happen
  on app foreground/reconnect, not background.
- **Hardcoded course data (MVP):** Guyan G&CC course data (par, handicap index, yardages)
  hardcoded — no course API required for MVP.
- **No GHIN API (MVP):** Handicap indexes entered manually by Jason each round.
- **Solo developer, ~6 weeks to opening day:** Architecture must minimize accidental complexity.
  Boring, proven choices over novel ones.
- **No soft launch:** First Friday of 2026 season is go-live. Zero tolerance for incorrect scoring.

### Cross-Cutting Concerns Identified

- **Offline/online state management:** Score entry, local queue, sync ordering — affects PWA
  Service Worker, API design, and leaderboard data freshness
- **Scoring correctness & integrity:** Zero-sum checks, Harvey Cup totals validation — must run
  on every calculation; cannot be a post-hoc audit
- **Tiered access control:** Public read / code-gated score entry / session-auth admin — affects
  every API route and UI view
- **Official vs. casual round distinction:** Determines whether round results flow into YTD
  standings; must be enforced at data model level, not just UI
- **Real-time data freshness:** 5-second polling cycle affects API design and caching strategy
- **Recalculation on score correction:** Editing a completed hole must trigger full downstream
  recalculation for the round — affects data model and API surface

## Starter Template Evaluation

### Primary Technology Domain

Full-stack PWA: mobile-first React SPA frontend + Node.js REST API backend + SQLite database.
Monorepo structure with scoring engine as an isolated package — mandated by the PRD build
sequence (engine first, UI second) and the historical data validation gate before launch.

### Starter Options Considered

**Option A: better-t-stack CLI** (`npm create better-t-stack@latest`)
- Includes: Hono + Vite/React + Drizzle + SQLite + shadcn/ui + Better Auth + tRPC
- Rejected: tRPC over plain REST adds unnecessary complexity for a domain-logic-heavy app;
  Bun package manager complicates Docker deployment; Better Auth is heavier than needed for
  2-user session auth.

**Option B: Manual pnpm workspaces monorepo** ← Selected
- Full control over structure, no framework lock-in for the scoring engine, plain REST API,
  Node.js + Docker alignment with existing VPS infrastructure.

### Selected Starter: Manual pnpm workspaces monorepo

**Rationale for Selection:**
The Harvey Cup scoring engine is the highest-risk component and the non-negotiable first build
priority. Isolating it as `packages/engine` (pure TypeScript, zero framework dependencies) means
it can be developed, unit-tested against 2025 historical data, and validated before any UI or API
code is written. Plain REST API is simpler to reason about for complex domain logic than tRPC.
Node.js (not Bun) in Docker on an existing VPS has fewer unknowns.

**Initialization Commands:**

```bash
mkdir wolf-cup && cd wolf-cup
pnpm init
# Create workspace config (pnpm-workspace.yaml)
# Scaffold engine package
mkdir -p packages/engine && cd packages/engine && pnpm init
# Scaffold web app
pnpm create vite@latest apps/web -- --template react-ts
# Scaffold API
mkdir -p apps/api && cd apps/api && pnpm init
```

**Monorepo Structure:**

```
wolf-cup/
├── pnpm-workspace.yaml
├── package.json               (root — scripts, shared devDeps)
├── packages/
│   └── engine/                (Harvey Cup scoring engine — pure TypeScript)
│       ├── src/
│       │   ├── stableford.ts
│       │   ├── money.ts
│       │   ├── harvey.ts
│       │   ├── wolf.ts
│       │   └── index.ts
│       ├── tests/             (vitest — validated against 2025 historical data)
│       └── package.json
├── apps/
│   ├── web/                   (Vite + React + TypeScript PWA)
│   │   ├── src/
│   │   ├── vite.config.ts     (vite-plugin-pwa configured)
│   │   └── package.json
│   └── api/                   (Hono + @hono/node-server + Drizzle + SQLite)
│       ├── src/
│       │   ├── index.ts
│       │   ├── routes/
│       │   └── db/
│       └── package.json
└── docker-compose.yml
```

**Architectural Decisions Provided by Starter:**

**Language & Runtime:**
TypeScript throughout — `strict` mode enabled. Shared types possible via `packages/engine`
exports. Node.js ≥18 runtime for API.

**Styling Solution:**
Tailwind CSS v4 + shadcn/ui component library. Added to `apps/web` only. Chosen for rapid
mobile-first development with accessible, high-contrast components suitable for on-course use.

**Build Tooling:**
Vite 7.3.1 for frontend — fastest dev server, optimal PWA bundle splitting. tsc + esbuild for
API and engine packages.

**Testing Framework:**
Vitest — fast, TypeScript-native, identical API to Jest. `packages/engine` gets comprehensive
test coverage first; `apps/api` routes tested with Hono's test utilities.

**Code Organization:**
- `packages/engine` — pure domain logic, no HTTP/DB dependencies, independently versioned
- `apps/api` — HTTP layer only; calls engine for all scoring calculations
- `apps/web` — UI only; all scoring display logic derived from API responses

**PWA / Offline:**
vite-plugin-pwa 1.2.0 — Service Worker with Workbox, offline app shell caching, manifest for
iPhone home screen install. Offline score queue implemented in `apps/web` using IndexedDB
(via idb library) — syncs to API on reconnect.

**Development Experience:**
pnpm workspaces for dependency management; shared `tsconfig.base.json` at root for consistent
TypeScript configuration across all packages and apps.

**Note:** Project initialization (pnpm workspace setup, package scaffolding, Tailwind + shadcn
install, Drizzle config, vite-plugin-pwa config) should be Story 1.0. The Harvey Cup engine
(`packages/engine`) development and historical data validation should be Stories 1.1–1.x before
any API or UI stories begin.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Recalculate on write, store results — determines DB schema (computed fields required)
- Custom cookie sessions — determines admin route middleware and DB schema
- TanStack Query with 5s polling interval — determines API design (no WebSocket needed)
- IndexedDB offline queue — determines Service Worker strategy and score submission API design

**Important Decisions (Shape Architecture):**
- TanStack Router for SPA routing (type-safe, file-based)
- Zod for validation across API + frontend (shared schemas)
- Two-container Docker compose (api + nginx)

**Deferred Decisions (Post-MVP):**
- Rate limiting (25 users makes it unnecessary for MVP)
- Database backups (simple VPS cron on sqlite.db file)
- Formal uptime monitoring

---

### Data Architecture

**Database:** SQLite (@libsql/client (Turso — Rust prebuilt, no MSVC required; replaces better-sqlite3)) + Drizzle ORM 0.45.1
- Rationale: Zero operational overhead, single-process backend, perfect for ~25 users.
  SQLite file lives in a Docker volume — persists across container restarts.
- Migration approach: drizzle-kit generate + drizzle-kit migrate; migration files committed to repo.
- Schema design principle: Store both raw inputs (gross scores, handicaps, wolf decisions) AND
  computed results (net scores, Stableford points, money balances, Harvey Cup points, round ranks).
  Raw inputs are the source of truth; computed results are regenerated on every score write.

**Recalculation strategy: On-write, store results**
- Every score submission calls `packages/engine` for full round recalculation
- Computed results written atomically to DB in same transaction as raw score
- Reads (leaderboard, standings) query stored results — no engine call on read
- Score correction triggers full round recalculation (all downstream holes recomputed)
- Aligns with <500ms recalculation NFR and ensures zero-sum validation runs on every write

**Data validation:** Zod schemas defined in `packages/engine` or `apps/api/src/schemas`
- Shared between API request validation (Hono Zod middleware) and frontend form validation
- All score submissions validated for type, range, and completeness before engine call

**Caching:** TanStack Query client-side cache only (no server-side cache)
- 25 users, SQLite reads are sub-millisecond — server-side caching adds complexity without benefit
- TanStack Query stale-while-revalidate: shows cached leaderboard instantly, refetches in background

---

### Authentication & Security

**Admin authentication:** Custom cookie sessions
- `admins` table: id, username, password_hash (bcrypt). Two rows: Jason + Josh.
- `sessions` table: id, admin_id, created_at, expires_at. Cookie: httpOnly, Secure, SameSite=Strict.
- Session TTL: 24 hours with sliding expiry on activity.
- Hono middleware: `adminAuthMiddleware` validates session cookie on all `/api/admin/*` routes.
- Password change via direct DB update (no self-service UI needed for 2 users).

**Entry code authorization:**
- `rounds` table stores hashed weekly entry code.
- Score entry routes validate submitted code against stored hash for the active round.
- Code automatically invalid when: new code set by admin, or round is closed/cancelled.
- Client stores validated code in sessionStorage — scorer doesn't re-enter each hole.

**Authorization tiers (Hono middleware):**
- Public (no middleware): GET /api/leaderboard/*, GET /api/standings/*, GET /api/rounds/*
- Code-gated (entryCodeMiddleware): POST /api/scores/*, POST /api/rounds/:id/start
- Session-auth (adminAuthMiddleware): All /api/admin/* routes

**Security baseline:**
- HTTPS enforced at Traefik level (Let's Encrypt)
- No sensitive PII stored (no email, no payment data)
- No third-party analytics or tracking scripts
- Scoring calculation inputs + outputs logged to structured JSON for dispute resolution

---

### API & Communication Patterns

**API style:** REST (Hono + @hono/node-server)
- Plain JSON REST over HTTP — no tRPC, no GraphQL
- Route structure: /api/rounds, /api/scores, /api/leaderboard, /api/standings, /api/admin/*
- All mutation endpoints return the updated computed state (score submission returns updated
  leaderboard data) — reduces client round-trips

**Real-time strategy: 5-second polling (TanStack Query)**
- No WebSocket — polling is sufficient for 4 concurrent groups, ~25 users
- TanStack Query `refetchInterval: 5000` on leaderboard queries
- `GET /api/leaderboard/live` returns current state with `lastUpdated` timestamp
- Clients show "last updated X seconds ago" from the timestamp — no server-push needed

**Error handling standard:**
- All API errors return `{ error: string, code: string }` JSON with appropriate HTTP status
- Scoring engine validation failures (zero-sum violation) return 422 with detailed error
- Client surfaces scoring errors immediately — never silently fails

**Offline score submission:**
- Scores queued in IndexedDB when network unavailable
- Queue entries: `{ holeNumber, scores, wolfDecision, timestamp, roundId }`
- On reconnect: queue drained in hole-number order via sequential POST /api/scores
- Service Worker (vite-plugin-pwa / Workbox) handles background sync where iOS permits;
  foreground sync (on app focus/visibility) as primary iOS fallback

---

### Frontend Architecture

**Routing:** TanStack Router (file-based, type-safe)
- Routes: / (leaderboard), /standings, /score-entry, /admin/*, /round/:id
- Type-safe search params for leaderboard filtering (round, player)
- No SSR — pure SPA, all routing client-side

**Server state management:** TanStack Query
- All API data fetched and cached via useQuery / useMutation
- Leaderboard: `refetchInterval: 5000`, `staleTime: 4000` — shows cached data instantly
- Score submission: useMutation with optimistic update + rollback on error
- Admin queries: standard useQuery, no polling needed

**Client state:** Minimal — React useState for local form state only
- Score entry form state: current hole, gross scores, wolf decision (local until submitted)
- No global client state store (no Zustand, no Context for state) — TanStack Query covers all
  server-derived state; local form state stays in components

**Offline queue:** IndexedDB via `idb` library
- `offlineQueue` object store in IndexedDB
- Queue manager: enqueue on failed POST, dequeue in order on reconnect
- Online/offline detection: `navigator.onLine` + `window.addEventListener('online', ...)`
- Queue status visible in score entry UI ("X scores pending sync")

**Component architecture:** shadcn/ui + Tailwind CSS v4
- shadcn/ui provides accessible, unstyled-first components (Button, Table, Dialog, etc.)
- Tailwind CSS v4 for all layout and custom styling
- Mobile-first breakpoints: base (375px) → sm (640px) for desktop leaderboard
- Touch targets minimum 48×48px enforced via Tailwind utility classes
- High-contrast color palette (no light gray on white) — enforced in Tailwind config

---

### Infrastructure & Deployment

**Docker compose structure (two containers):**
```
services:
  api:      # Hono + Node.js — serves /api/* routes, port 3000
  web:      # nginx — serves Vite SPA build as static files, proxies /api/* to api:3000
```
- SQLite file mounted as Docker volume: `./data/wolf-cup.db:/app/data/wolf-cup.db`
- Traefik at VPS level handles TLS termination and routing to `web` container
- `wolf.dagle.cloud` → Traefik → web container (nginx) → static files + /api/* proxy → api container

**Environment configuration:**
- `.env` file (not committed): `ADMIN_SESSION_SECRET`, `DB_PATH`, `PORT`
- `.env.example` committed with documented variables
- Frontend env vars prefixed `VITE_` (e.g., `VITE_API_BASE_URL`)

**CI/CD: GitHub Actions + manual deploy**
- On every push/PR: run `vitest` (engine tests), `tsc --noEmit`, `eslint`
- No auto-deploy — deliberate SSH deploy: `ssh vps "cd wolf-cup && git pull && docker compose up -d --build"`
- Deploy script committed to repo for repeatability
- Deploy only when no active round is in progress (checked manually)

**Logging:**
- API: structured JSON logs via `console.log` — captured by Docker, viewable with `docker logs`
- Every scoring engine call logs: input (player scores, handicaps) + output (results) + round ID
- Log retention: Docker default (no rotation needed for this scale)

---

### Decision Impact Analysis

**Implementation Sequence (order matters):**
1. Monorepo scaffold + CI pipeline
2. `packages/engine` — Harvey Cup scoring engine (pure TypeScript, fully tested)
3. Historical data validation (engine output vs 2025 Excel for all 17 rounds)
4. `apps/api` — Drizzle schema + migrations (schema driven by what engine needs to store)
5. Score submission API routes + recalculate-on-write pipeline
6. Admin API routes + custom session auth
7. `apps/web` — TanStack Router setup + TanStack Query configuration + PWA manifest
8. Score entry UI + offline queue (IndexedDB)
9. Leaderboard UI (5-second polling)
10. Standings UI + admin panel UI
11. Docker compose + VPS deployment

**Cross-Component Dependencies:**
- Engine schema defines DB schema (what computed fields are stored)
- DB schema defines API response shapes
- API response shapes define TanStack Query types in frontend
- Zod schemas bridge API validation ↔ frontend form validation
- vite-plugin-pwa Service Worker strategy depends on offline queue design (IndexedDB first)

## Implementation Patterns & Consistency Rules

### Critical Conflict Points Identified

10 areas where AI agents could make different choices without explicit rules:
database naming conventions, API endpoint naming, TypeScript code naming, file/directory
structure, test co-location, API response format, date/JSON field naming, TanStack Query
key structure, error handling approach, and loading state management.

---

### Naming Patterns

**Database Naming Conventions (Drizzle/SQLite):**
- Tables: `snake_case`, plural — `players`, `rounds`, `hole_scores`, `harvey_results`, `sessions`
- Columns: `snake_case` — `player_id`, `gross_score`, `stableford_points`, `created_at`
- Foreign keys: `{table_singular}_id` — `player_id`, `round_id`, `group_id`
- Indexes: `idx_{table}_{column(s)}` — `idx_hole_scores_round_id`
- Drizzle table variable names: `camelCase` in TypeScript — `holescores`, `harveyResults`

**API Naming Conventions:**
- Endpoints: `kebab-case`, plural nouns — `/api/rounds`, `/api/hole-scores`, `/api/players`
- Route params: `:id` for primary key, `:roundId` when context-specific
- Query params: `camelCase` — `?roundId=1&playerId=2`
- Admin routes: all under `/api/admin/` prefix — `/api/admin/roster`, `/api/admin/rounds`
- No trailing slashes

**Code Naming Conventions (TypeScript):**
- Files: `kebab-case` — `score-entry.tsx`, `harvey-engine.ts`, `offline-queue.ts`
- React components: `PascalCase` — `ScoreEntry`, `LiveLeaderboard`, `AdminRosterTable`
- Functions: `camelCase` — `calculateHarveyPoints`, `getActiveRound`, `enqueueScore`
- Types & Interfaces: `PascalCase` — `RoundResult`, `HarveyPointsResult`, `WolfAssignment`
- Constants: `SCREAMING_SNAKE_CASE` — `WOLF_HOLE_ASSIGNMENTS`, `HARVEY_POINT_TABLE`
- Zod schemas: `camelCase` + `Schema` suffix — `scoreSubmissionSchema`, `createRoundSchema`
- TanStack Router routes: `{routeName}Route` — `leaderboardRoute`, `scoreEntryRoute`
- Custom hooks: `use` prefix + `camelCase` — `useOfflineQueue`, `useLiveLeaderboard`

---

### Structure Patterns

**Engine Package (`packages/engine/src/`):**
```
types.ts           ← all shared TypeScript types for the engine (import from here, not inline)
stableford.ts      ← Stableford point calculation per hole
money.ts           ← Wolf money engine + zero-sum validation
harvey.ts          ← Harvey Cup points: rank-based, tie splits, best-10-of-N, playoff multipliers
wolf.ts            ← Wolf hole assignments from batting order (deterministic)
course.ts          ← Guyan G&CC course data (hardcoded: par, handicap index, yardages)
validation.ts      ← Zero-sum checks, Harvey Cup total integrity checks
index.ts           ← Re-exports all public functions and types
```
Rule: Engine functions are **pure** — same input always produces same output.
No database access, no HTTP calls, no side effects, no console.log in engine code.

**API Package (`apps/api/src/`):**
```
index.ts           ← Hono app setup + serve()
routes/
  rounds.ts        ← GET /api/rounds, POST /api/rounds/:id/start
  scores.ts        ← POST /api/scores (score submission, triggers recalculation)
  leaderboard.ts   ← GET /api/leaderboard/live, GET /api/leaderboard/:roundId
  standings.ts     ← GET /api/standings (YTD season standings)
  admin/
    auth.ts        ← POST /api/admin/login, POST /api/admin/logout
    roster.ts      ← CRUD /api/admin/players
    rounds.ts      ← CRUD /api/admin/rounds (create, configure, cancel)
    season.ts      ← /api/admin/season (config, side games, Harvey toggle)
middleware/
  admin-auth.ts    ← Session cookie validation (applied to all /api/admin/* routes)
  entry-code.ts    ← Weekly code validation (applied to score submission routes)
db/
  index.ts         ← Drizzle client initialization
  schema.ts        ← All table definitions (single file for this scale)
  seed.ts          ← Course data seed + admin user seed
```

**Web Package (`apps/web/src/`):**
```
routes/            ← TanStack Router file-based routes
  index.tsx        ← / → Live leaderboard (home)
  standings.tsx    ← /standings → YTD standings
  score-entry.tsx  ← /score-entry → Score entry flow
  round.$roundId.tsx  ← /round/:roundId → Round detail/history
  admin/
    index.tsx      ← /admin → Admin dashboard
    roster.tsx     ← /admin/roster
    rounds.tsx     ← /admin/rounds
    season.tsx     ← /admin/season
components/
  leaderboard/     ← LeaderboardTable, PlayerRow, GroupProgress, StalenessIndicator
  score-entry/     ← HoleCard, ScoreInput, WolfDisplay, OfflineQueueBadge
  admin/           ← Admin-specific forms and tables
  ui/              ← shadcn/ui re-exports (Button, Table, Dialog, etc.)
hooks/
  useOfflineQueue.ts   ← IndexedDB queue management
  useLiveLeaderboard.ts ← TanStack Query wrapper for live leaderboard
  useOnlineStatus.ts   ← navigator.onLine + event listener
lib/
  api.ts           ← Typed fetch wrapper (base URL, auth headers, error normalization)
  query-client.ts  ← TanStack Query client configuration
  offline-queue.ts ← IndexedDB queue operations (idb library)
```

**Test co-location:** Tests live next to source files.
- `src/harvey.ts` → `src/harvey.test.ts`
- `src/routes/scores.ts` → `src/routes/scores.test.ts`
- `src/components/leaderboard/LeaderboardTable.tsx` → `LeaderboardTable.test.tsx`

---

### Format Patterns

**API Response Formats:**
- **Single resource:** Direct object — `{ round: { id, date, status, ... } }`
- **Collection:** `{ items: [...] }` (no pagination at this scale — always return all)
- **Score submission (mutation):** Returns full updated leaderboard — `{ leaderboard: [...] }`
  (avoid extra client round-trip after submission)
- **Admin mutation:** Returns updated resource — `{ player: { id, name, handicap, ... } }`
- **Error:** `{ error: string, code: string }` — `code` is machine-readable (e.g., `"INVALID_CODE"`,
  `"ZERO_SUM_VIOLATION"`, `"ROUND_NOT_ACTIVE"`)
- **HTTP status codes:** 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden,
  404 Not Found, 409 Conflict, 422 Unprocessable (scoring engine validation failures), 500 Server Error

**Date/Time Formats:**
- API JSON: ISO 8601 strings — `"2026-06-06T13:00:00Z"` (always UTC)
- DB storage: Drizzle `integer` with `mode: 'timestamp'` (Unix milliseconds)
- Display: formatted client-side using `Intl.DateTimeFormat` (no date library needed at this scale)
- Round dates (date only): `"2026-06-06"` (no time component for round scheduling dates)

**JSON Field Naming:**
- All API request and response JSON: `camelCase` — `{ playerId, grossScore, stablefordPoints }`
- DB columns: `snake_case` — Drizzle maps automatically via column definitions
- No mixing: never return snake_case from API, never use camelCase in DB schema

**Numeric Precision:**
- Money balances: integers representing whole dollar amounts (all wolf money is whole dollars;
  no half-dollar splits exist in this game). e.g., `2` = $2 won, `-1` = $1 lost.
- Harvey Cup points: stored as floats (half-points from tie splits, e.g., `2.5`)
- Stableford points: integers

---

### Communication Patterns

**TanStack Query Key Conventions:**
```typescript
['leaderboard', 'live']              // current round live leaderboard
['leaderboard', 'round', roundId]    // specific round leaderboard
['standings', 'season']              // YTD season standings
['rounds', 'active']                 // current active round
['rounds', 'history']                // all past rounds
['rounds', 'detail', roundId]        // single round detail
['admin', 'roster']                  // full player roster
['admin', 'rounds']                  // admin round list
['admin', 'season']                  // season config
```
- Invalidation: `queryClient.invalidateQueries({ queryKey: ['leaderboard'] })` busts all leaderboard queries
- Never use string-only keys — always use array format

**Score Submission Flow:**
```
User taps "Submit Hole"
  → Validate form (Zod, client-side)
  → useMutation: POST /api/scores
    → Online: await response → on success: invalidate ['leaderboard', 'live'], advance hole
    → Offline (network error): enqueue to IndexedDB → show "Saved offline (X pending)" → advance hole
  → On server error (422): show error toast, do NOT advance hole (score not accepted)
```

**Offline Queue Drain Pattern:**
```typescript
window.addEventListener('online', async () => {
  const queue = await getOfflineQueue()   // sorted by holeNumber ASC
  for (const entry of queue) {
    await POST /api/scores (entry)        // sequential, not parallel
    await removeFromQueue(entry.id)
  }
  invalidateQueries(['leaderboard', 'live'])
})
```
Rule: Queue drained **sequentially by hole number** — never in parallel. Parallel creates
race conditions in the recalculate-on-write pipeline.

---

### Process Patterns

**Error Handling:**
- Engine validation errors (zero-sum, invalid score): surface to user immediately, block submission
- Network errors (timeout, 5xx): TanStack Query auto-retry ×2, then toast "Connection issue —
  score saved locally" if offline queue accepts it
- Auth errors (401, 403): redirect to login (admin) or show "Invalid code" (scorer)
- Never swallow errors silently — every catch block either re-throws, logs, or shows user feedback

**Loading State Patterns:**
- **Leaderboard:** Show stale data immediately + spinner in staleness indicator while refetching.
  No full-page skeleton — always show data, even if 5 seconds old.
- **Score entry:** Disable "Submit Hole" button during mutation (`isPending`). No skeleton.
- **Admin forms:** Disable submit during mutation. Show inline error on failure.
- **Initial page load (no cached data):** Show skeleton for table rows only, not the full layout.
- Never show blank page while loading — always show layout chrome immediately.

**Scoring Engine Calling Convention:**
```typescript
// ALWAYS call engine functions via the API route — never import engine directly from web
// ✅ Correct: web → POST /api/scores → api calls engine → stores result → returns computed state
// ❌ Wrong:   web imports @wolf-cup/engine directly and calculates client-side
```
The engine is server-side only. Frontend never performs scoring calculations.

---

### Enforcement Guidelines

**All AI Agents MUST:**
- Use `snake_case` for all DB column names; `camelCase` for all API JSON fields
- Place engine calls exclusively in `apps/api` — never import engine in `apps/web`
- Return full updated leaderboard state from score mutation endpoints (not just 200 OK)
- Drain the offline queue **sequentially by hole number** — never in parallel
- Validate all API inputs with Zod middleware before calling any engine function
- Log scoring engine inputs + outputs to console (structured JSON) on every call
- Use TanStack Query key arrays — never string-only keys

**Anti-Patterns to Avoid:**
- ❌ Calling the scoring engine on reads (GET requests) — recalculation is on-write only
- ❌ Direct DB reads in React components — all data through TanStack Query + API
- ❌ `snake_case` in API JSON responses (e.g., returning `player_id` instead of `playerId`)
- ❌ Silently catching scoring errors — zero-sum violations must surface immediately
- ❌ Advancing to next hole after a 422 error — only advance on success or offline queue acceptance
- ❌ Parallel offline queue drain — sequential by hole number only

## Project Structure & Boundaries

### Complete Project Directory Structure

```
wolf-cup/
├── .env.example                        ← documented env vars (committed)
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml                      ← vitest + tsc + eslint on push/PR
├── pnpm-workspace.yaml                 ← declares packages/* and apps/*
├── package.json                        ← root scripts: test, lint, build, typecheck
├── tsconfig.base.json                  ← shared TypeScript strict config
├── docker-compose.yml                  ← api + web (nginx) services
├── nginx.conf                          ← nginx: serve /dist, proxy /api/* → api:3000
├── deploy.sh                           ← SSH deploy script (committed)
│
├── packages/
│   └── engine/                         ← Harvey Cup scoring engine (pure TypeScript)
│       ├── package.json                ← name: "@wolf-cup/engine"
│       ├── tsconfig.json               ← extends ../../tsconfig.base.json
│       ├── vitest.config.ts
│       └── src/
│           ├── types.ts                ← FR1-FR19: all shared types (Player, Hole, Round,
│           │                               WolfAssignment, MoneyResult, HarveyResult, etc.)
│           ├── course.ts               ← FR10: Guyan G&CC hardcoded data (par, SI, yardages)
│           ├── wolf.ts                 ← FR9: deterministic wolf hole assignments from batting order
│           ├── stableford.ts           ← FR1: Stableford points per hole (net score vs par)
│           ├── money.ts                ← FR2,FR3,FR11-FR19: wolf money engine + zero-sum validation
│           ├── harvey.ts               ← FR4-FR8: rank-based Harvey Cup points, tie splits,
│           │                               best-10-of-N, two-tier playoff multipliers
│           ├── validation.ts           ← runtime integrity checks (zero-sum, Harvey total)
│           ├── index.ts                ← re-exports all public functions + types
│           │
│           ├── types.test.ts
│           ├── wolf.test.ts            ← FR9: all 4 batting positions, all 18 holes
│           ├── stableford.test.ts      ← FR1: par/birdie/eagle/bogey/double-bogey cases
│           ├── money.test.ts           ← FR11-FR19: 2v2 team, 1v3 lone wolf, all bonuses,
│           │                               zero-sum validation, tie (no blood) cases
│           ├── harvey.test.ts          ← FR4-FR8: all player counts 8-20, tie splits,
│           │                               best-10 with rainouts, playoff multipliers
│           ├── validation.test.ts      ← zero-sum violations, Harvey total mismatches
│           └── fixtures/
│               └── season-2025/        ← historical validation: 17 rounds of 2025 data
│                   ├── round-01.json   ← input: player scores, handicaps; expected: Harvey results
│                   ├── round-02.json
│                   └── ...             ← used in harvey.test.ts acceptance tests
│
└── apps/
    ├── api/                            ← Hono + Node.js REST API
    │   ├── package.json                ← name: "@wolf-cup/api"
    │   ├── tsconfig.json
    │   ├── drizzle.config.ts           ← points to src/db/schema.ts + DB_PATH
    │   ├── Dockerfile                  ← Node 20 alpine, pnpm install, tsc build, serve
    │   └── src/
    │       ├── index.ts                ← Hono app init + route registration + serve()
    │       │
    │       ├── schemas/                ← Zod request/response schemas
    │       │   ├── score.ts            ← scoreSubmissionSchema (FR27-FR35)
    │       │   ├── round.ts            ← createRoundSchema, ballDrawSchema (FR20-FR26)
    │       │   ├── player.ts           ← createPlayerSchema, updateHandicapSchema (FR52-FR54)
    │       │   └── admin.ts            ← loginSchema, seasonConfigSchema (FR45-FR51)
    │       │
    │       ├── middleware/
    │       │   ├── admin-auth.ts       ← FR63: validates session cookie → 401 if invalid
    │       │   └── entry-code.ts       ← FR62: validates weekly code → 403 if invalid/expired
    │       │
    │       ├── routes/
    │       │   ├── rounds.ts           ← FR20-FR26: GET /api/rounds, GET /api/rounds/active,
    │       │   │                           POST /api/rounds/:id/start (entry code gated)
    │       │   ├── scores.ts           ← FR27-FR35: POST /api/scores (entry code gated)
    │       │   │                           triggers engine recalculation + DB write
    │       │   ├── leaderboard.ts      ← FR36-FR41: GET /api/leaderboard/live,
    │       │   │                           GET /api/leaderboard/:roundId
    │       │   ├── standings.ts        ← FR42-FR44: GET /api/standings (YTD, best-10, subs)
    │       │   ├── stats.ts            ← FR57-FR59: GET /api/stats/players/:id
    │       │   └── admin/
    │       │       ├── auth.ts         ← FR63: POST /api/admin/login, POST /api/admin/logout
    │       │       ├── roster.ts       ← FR52-FR54: CRUD /api/admin/players, handicaps
    │       │       ├── rounds.ts       ← FR20-FR22,FR45-FR47: CRUD /api/admin/rounds,
    │       │       │                       cancel/rainout, headcount, groups, entry code
    │       │       └── season.ts       ← FR45-FR51: season config, side games (FR48-FR49),
    │       │                               sub management (FR50-FR51), Harvey toggle (FR41)
    │       │
    │       └── db/
    │           ├── index.ts            ← Drizzle client (@libsql/client (Turso — Rust prebuilt, no MSVC required; replaces better-sqlite3)), singleton
    │           ├── schema.ts           ← all table definitions:
    │           │                           admins, sessions,
    │           │                           seasons, rounds, groups, players, round_players,
    │           │                           hole_scores (raw), round_results (computed),
    │           │                           harvey_results, wolf_decisions (FR57),
    │           │                           side_games, side_game_results
    │           ├── seed.ts             ← course data + admin user seed (Jason + Josh)
    │           └── migrations/         ← drizzle-kit generated SQL migrations
    │               ├── 0000_init.sql
    │               └── meta/
    │
    └── web/                            ← Vite + React + TypeScript PWA
        ├── package.json                ← name: "@wolf-cup/web"
        ├── tsconfig.json
        ├── tsconfig.node.json
        ├── vite.config.ts              ← react(), VitePWA({ registerType, manifest, workbox })
        ├── index.html
        ├── Dockerfile                  ← build Vite, output to /dist, serve via nginx
        │
        ├── public/
        │   ├── manifest.webmanifest    ← FR60: name, icons, display:standalone, theme_color
        │   ├── icon-192.png            ← AssTV / Wolf Cup branded icon
        │   ├── icon-512.png
        │   └── favicon.ico
        │
        └── src/
            ├── main.tsx                ← React root, QueryClientProvider, RouterProvider
            ├── router.tsx              ← TanStack Router route tree definition
            │
            ├── routes/
            │   ├── index.tsx           ← FR36-FR40: / → Live leaderboard (public, polling)
            │   ├── standings.tsx       ← FR42-FR44: /standings → YTD season standings
            │   ├── score-entry.tsx     ← FR27-FR35: /score-entry → code entry + scoring flow
            │   ├── round.$roundId.tsx  ← /round/:roundId → completed round detail/history
            │   └── admin/
            │       ├── login.tsx       ← FR63: /admin/login → session auth form
            │       ├── index.tsx       ← /admin → dashboard (season overview)
            │       ├── roster.tsx      ← FR52-FR54: /admin/roster
            │       ├── rounds.tsx      ← FR20-FR22,FR45-FR47: /admin/rounds
            │       └── season.tsx      ← FR45-FR51: /admin/season
            │
            ├── components/
            │   ├── leaderboard/
            │   │   ├── LeaderboardTable.tsx
            │   │   ├── LeaderboardTable.test.tsx
            │   │   ├── PlayerRow.tsx
            │   │   ├── GroupProgress.tsx          ← FR37: "Thru hole X" per group
            │   │   └── StalenessIndicator.tsx     ← FR40: "Updated X seconds ago"
            │   ├── score-entry/
            │   │   ├── ScoreEntryFlow.tsx         ← FR24-FR26: code entry → ball draw → holes
            │   │   ├── HoleCard.tsx               ← FR27-FR35: per-hole gross score inputs
            │   │   ├── ScoreInput.tsx             ← numeric input, touch-friendly, 48px target
            │   │   ├── WolfDisplay.tsx            ← FR29: wolf assignment for current hole
            │   │   └── OfflineQueueBadge.tsx      ← FR31: "X scores pending sync"
            │   ├── admin/
            │   │   ├── AdminNav.tsx
            │   │   ├── RosterTable.tsx
            │   │   ├── RoundForm.tsx
            │   │   ├── GroupBuilder.tsx
            │   │   └── SeasonConfig.tsx
            │   └── ui/                            ← shadcn/ui component re-exports
            │       ├── button.tsx
            │       ├── table.tsx
            │       ├── dialog.tsx
            │       ├── input.tsx
            │       └── toast.tsx
            │
            ├── hooks/
            │   ├── useLiveLeaderboard.ts    ← refetchInterval: 5000, key ['leaderboard','live']
            │   ├── useOfflineQueue.ts       ← IndexedDB queue: enqueue, drain on reconnect
            │   ├── useOnlineStatus.ts       ← navigator.onLine + 'online'/'offline' events
            │   └── useAdminAuth.ts          ← session state, login/logout mutations
            │
            └── lib/
                ├── api.ts               ← typed fetch wrapper: base URL, error normalization
                ├── query-client.ts      ← TanStack QueryClient config
                └── offline-queue.ts     ← idb library: openDB, offlineQueue store CRUD
```

---

### Architectural Boundaries

**API Boundary — Public (no auth):**
```
GET  /api/rounds/active          → active round info (type, status, groups)
GET  /api/rounds/:id             → specific round detail
GET  /api/leaderboard/live       → current live leaderboard + lastUpdated
GET  /api/leaderboard/:roundId   → historical round leaderboard
GET  /api/standings              → YTD season standings
GET  /api/stats/players/:id      → player statistics
```

**API Boundary — Code-Gated (entryCodeMiddleware):**
```
POST /api/rounds/:id/start       → scorer initiates round with entry code
POST /api/scores                 → submit hole scores (code validated per-request)
```

**API Boundary — Session-Auth (adminAuthMiddleware):**
```
POST /api/admin/login            → create session
POST /api/admin/logout           → destroy session
CRUD /api/admin/players          → roster + handicaps
CRUD /api/admin/rounds           → round lifecycle, cancel, headcount, groups
PUT  /api/admin/season           → season config, Harvey toggle
POST /api/admin/side-games/:id/winner → record side game result
```

**Package Boundary — Engine:**
- `@wolf-cup/engine` imported ONLY by `apps/api` — never by `apps/web`
- Exports pure functions + TypeScript types only
- Zero runtime dependencies (no DB, no HTTP, no logging)

**Data Boundary — Recalculation:**
- Raw score writes and computed result writes in a single Drizzle transaction
- No GET route ever calls the engine — only POST /api/scores triggers recalculation
- Score correction: API recalculates entire round (all holes) atomically

---

### Requirements to Structure Mapping

| FR Category | Primary Files |
|---|---|
| FR1–FR10 Scoring Engine | `packages/engine/src/stableford.ts`, `money.ts`, `harvey.ts`, `wolf.ts`, `course.ts` |
| FR11–FR19 Wolf Money | `packages/engine/src/money.ts`, `validation.ts` |
| FR20–FR26 Round Mgmt | `apps/api/src/routes/rounds.ts`, `admin/rounds.ts` |
| FR27–FR35 Score Entry | `apps/api/src/routes/scores.ts` + `apps/web/src/routes/score-entry.tsx` + `components/score-entry/` |
| FR36–FR44 Leaderboard | `apps/api/src/routes/leaderboard.ts`, `standings.ts` + `apps/web/src/routes/index.tsx`, `standings.tsx` |
| FR45–FR51 Season Admin | `apps/api/src/routes/admin/season.ts`, `admin/rounds.ts` + `apps/web/src/routes/admin/season.tsx` |
| FR52–FR54 Roster | `apps/api/src/routes/admin/roster.ts` + `apps/web/src/routes/admin/roster.tsx` |
| FR55–FR56 Side Games | `apps/api/src/routes/admin/season.ts` + leaderboard footer display |
| FR57–FR59 Statistics | `apps/api/src/db/schema.ts` (wolf_decisions) + `apps/api/src/routes/stats.ts` |
| FR60–FR63 App Access | `apps/web/public/manifest.webmanifest`, `vite.config.ts` + `apps/api/src/middleware/` |

**Historical Validation Gate (pre-launch acceptance test):**
- Location: `packages/engine/src/fixtures/season-2025/`
- 17 JSON files: input scores → expected Harvey + money output
- Must pass 100% before any UI or API story begins

---

### Integration Points & Data Flow

**Score Submission Data Flow:**
```
ScoreEntryFlow (web)
  → validate via scoreSubmissionSchema (Zod, client-side)
  → POST /api/scores { holeNumber, groupId, scores: [{playerId, grossScore}],
                        wolfDecision, greenies, polies }
    → entryCodeMiddleware (verify code for this round)
    → Zod middleware (validate body shape)
    → load round context from DB (players, handicaps, batting order)
    → engine.calculateRound(roundContext, newHoleScore)
      → wolf.getAssignment(battingOrder, holeNumber)
      → stableford.calculate(grossScore, handicap, par, strokeIndex)
      → money.calculate(netScores, wolfAssignment, greenies, polies)
      → validation.assertZeroSum(moneyResults)     ← throws 422 on violation
      → harvey.calculate(allPlayerStableford, allPlayerMoney, playerCount)
    → db.transaction():
        INSERT hole_scores (raw)
        UPSERT round_results (computed)
        UPSERT harvey_results
        UPSERT season_standings (best-10 recalc)
    → log: { roundId, hole, input, output }
    → return { leaderboard: [...] }
  → invalidate ['leaderboard', 'live']
  → advance to holeNumber + 1
```

**Leaderboard Polling Data Flow:**
```
useLiveLeaderboard:
  useQuery({ queryKey: ['leaderboard','live'], refetchInterval: 5000, staleTime: 4000 })
  → StalenessIndicator reads dataUpdatedAt → "Updated X seconds ago"
```

---

### Development Workflow

```bash
pnpm -r dev                                    # all apps in parallel (api :3000, web :5173)
pnpm --filter @wolf-cup/engine test            # engine tests only — run first
pnpm -r typecheck                              # tsc --noEmit across all packages
pnpm --filter @wolf-cup/web build              # Vite build → apps/web/dist/
docker compose build && docker compose up -d   # local Docker test
./deploy.sh                                    # production deploy via SSH
```

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are version-compatible and work together without conflicts:
- Vite 7.3.1 + vite-plugin-pwa 1.2.0: compatible, standard integration
- Hono 4.12.2 + @hono/node-server + TypeScript: native support
- Drizzle ORM 0.45.1 + @libsql/client (Turso — Rust prebuilt, no MSVC required; replaces better-sqlite3): fully tested combination
- TanStack Router + TanStack Query + React 19: designed to work together
- shadcn/ui + Tailwind CSS v4: compatible, officially supported
- pnpm workspaces + Vitest: both work across monorepo packages
- idb (IndexedDB) + Service Worker (vite-plugin-pwa): independent layers, no conflict

**Pattern Consistency:**
- Naming conventions are coherent: `snake_case` DB → Drizzle maps to TypeScript → `camelCase` API JSON — no manual transformation required
- File structure defined in patterns (step 5) matches the project tree (step 6) exactly
- TanStack Query key arrays align with the polling architecture decision
- Offline queue drain (sequential by hole number) is consistent with recalculate-on-write pipeline
- Engine-only-in-API rule enforces the pure function / no-side-effects boundary architecturally

**Structure Alignment:**
- `packages/engine` isolation enforces the server-side-only engine rule
- `apps/api/middleware/` structure directly supports the three-tier auth model
- `apps/web/lib/offline-queue.ts` + `hooks/useOfflineQueue.ts` cleanly separates queue mechanics from UI
- Two-container Docker compose (api + nginx) matches deployment architecture decision
- `fixtures/season-2025/` in the engine package places the historical validation gate adjacent to the tests that use it

---

### Requirements Coverage Validation ✅

**Functional Requirements — All 63 FRs Covered:**

| FR Category | Coverage Status | Notes |
|---|---|---|
| FR1–FR10 Scoring Engine | ✅ Full | `packages/engine` covers all; course.ts hardcoded per MVP |
| FR11–FR19 Wolf Money | ✅ Full | `money.ts` + `validation.ts`; zero-sum enforced at engine level |
| FR20–FR26 Round Mgmt | ✅ Full | Official/casual distinction enforced in DB schema (`rounds.type`) |
| FR27–FR35 Score Entry | ✅ Full | Offline queue covers FR31; wolf display covers FR29; greenie/polie covers FR34-35 |
| FR36–FR44 Leaderboard | ✅ Full | Harvey toggle in `seasons` table; playoff always-on handled per round type |
| FR45–FR51 Season Admin | ✅ Full | Sub management + best-10 recalc on cancellation covered |
| FR52–FR54 Roster | ✅ Full | Guest players for casual rounds via `round_players` without roster entry |
| FR55–FR56 Side Games | ✅ Full | `side_games` + `side_game_results` tables in schema |
| FR57–FR59 Statistics | ✅ Full | `wolf_decisions` table; `stats.ts` route for per-player summaries |
| FR60–FR63 App Access | ✅ Full | PWA manifest, middleware tiers, sessionStorage for entry code |

**Non-Functional Requirements Coverage:**

- **Correctness (highest priority):** ✅ Zero-sum enforced in engine (throws before DB write), Harvey total integrity check in `validation.ts`, atomic Drizzle transaction for score + computed results, 17-round historical fixture set in `fixtures/season-2025/`
- **Performance:** ✅ Recalculate-on-write means leaderboard reads are pure DB queries (~1ms SQLite); TanStack Query `staleTime: 4000` eliminates redundant requests during 5s polling cycle; Vite PWA app shell loads from cache instantly
- **Reliability:** ✅ IndexedDB queue preserves 100% of offline scores; TanStack Query stale-while-revalidate keeps leaderboard visible during server unreachability; atomic DB transactions prevent partial writes
- **Security:** ✅ bcrypt password hashing, httpOnly+Secure+SameSite cookies, HTTPS via Traefik, entry code invalidation on round close, no PII stored
- **Deployment:** ✅ Standalone Docker compose, deploy.sh for deliberate SSH deploy, Traefik integration

---

### Gap Analysis Results

**Critical Gaps:** None. All FRs have architectural support and all implementation-blocking decisions are made.

**Important Gaps Identified and Resolved:**

**Gap 1: Casual round entry code bypass**
FR25 states casual rounds require no code. The `entryCodeMiddleware` must be conditional:
if `round.type === 'casual'`, skip code validation entirely. Route handler loads the round first,
then applies code check only for official rounds.
Resolution: Document in `middleware/entry-code.ts` that it checks `round.type` before validating.

**Gap 2: Sub player data model**
FR43 (sub results displayed separately) and FR50-FR51 (sub management) require per-round sub status.
Resolution: `round_players` table has `is_sub: boolean` column. A player can be a sub in one round
and a full member in another. Sub-to-member conversion (FR51) is an UPDATE on future `round_players` rows.

**Gap 3: Harvey live toggle scope**
FR41 specifies the toggle is per-season (off by default regular season, always on playoffs). The
`seasons` table has a `harvey_live_enabled: boolean` column. Playoff rounds override this to always
show Harvey live regardless of the toggle.
Resolution: API route reads `round.is_playoff` and OR's with `season.harvey_live_enabled` to
determine response shape.

**Nice-to-Have (deferred, non-blocking):**
- Explicit ESLint flat config for modern Vite projects
- Turborepo pipeline config for parallel builds (pnpm -r scripts sufficient for MVP)
- VPS cron job for SQLite backup (add post-MVP when season data is irreplaceable)

---

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed (63 FRs across 10 categories)
- [x] Scale and complexity assessed (medium — ~25 users, high-complexity scoring engine)
- [x] Technical constraints identified (VPS/Docker, iOS Safari PWA limits, solo dev timeline)
- [x] Cross-cutting concerns mapped (offline state, scoring integrity, auth tiers, recalculation)

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions (all technology versions verified via web search)
- [x] Technology stack fully specified (TypeScript, Vite+React, Hono, SQLite+Drizzle, pnpm workspaces)
- [x] Integration patterns defined (REST, 5s polling, IndexedDB queue, recalculate-on-write)
- [x] Performance considerations addressed (<500ms recalc via on-write strategy, TanStack Query staleTime)

**✅ Implementation Patterns**
- [x] Naming conventions established (DB snake_case, API camelCase, TypeScript conventions)
- [x] Structure patterns defined (engine isolation, route organization, component co-location)
- [x] Communication patterns specified (TanStack Query key arrays, score submission flow, queue drain)
- [x] Process patterns documented (error handling, loading states, engine calling convention)

**✅ Project Structure**
- [x] Complete directory structure defined (every file and directory named)
- [x] Component boundaries established (engine / api / web with explicit import rules)
- [x] Integration points mapped (score submission data flow, leaderboard polling flow, offline queue drain)
- [x] Requirements to structure mapping complete (all 63 FRs mapped to specific files)

---

### Architecture Readiness Assessment

**Overall Status: READY FOR IMPLEMENTATION**

**Confidence Level: High**

The architecture is coherent, complete, and directly traceable to project requirements. The most
complex risk (Harvey Cup engine) is architecturally de-risked by isolation into a pure TypeScript
package with a dedicated historical validation gate before any UI work begins. The offline-first
score entry is concretely specified. The deployment target is well-understood.

**Key Strengths:**
- Harvey Cup engine isolated as `packages/engine` — testable in isolation, zero framework coupling
- Historical validation fixtures (`fixtures/season-2025/`) are a first-class architectural artifact
- Recalculate-on-write keeps reads instant while ensuring zero-sum validation runs on every change
- IndexedDB offline queue with sequential drain prevents data loss and race conditions on reconnect
- Three-tier auth model is simple and correct for the 2-admin, ~25-user scale
- All decisions favor proven, boring technology — no novel choices that could surprise a solo dev

**Areas for Future Enhancement (Post-MVP):**
- Phase 2: Video/photo gallery, satellite hole views, course lookup API
- Phase 2: Historical season import (2022–2025 data into existing schema)
- Phase 3: Push notifications (deferred due to iOS PWA limitations)
- Post-season: VPS SQLite backup automation

---

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented in this file
- Use implementation patterns from the Naming, Structure, Format, and Process sections
- Respect package boundaries: engine is `apps/api` only, never `apps/web`
- Refer to the Requirements to Structure Mapping table when implementing any FR
- Apply the three gap resolutions above in DB schema and middleware implementation

**First Implementation Priority:**
```bash
# Story 1.0: Monorepo scaffold
mkdir wolf-cup && cd wolf-cup && pnpm init
# create pnpm-workspace.yaml, tsconfig.base.json, root package.json scripts
# scaffold packages/engine, apps/api, apps/web
# configure CI (GitHub Actions: vitest + tsc + eslint)

# Story 1.1+: Harvey Cup engine — before any API or UI work
cd packages/engine
# implement in order: types.ts → wolf.ts → stableford.ts → money.ts → harvey.ts → validation.ts
# write tests; load fixtures/season-2025/ data
# ALL 17 ROUNDS MUST PASS before proceeding to API or UI stories
```
