---
stepsCompleted: ['step-01-init', 'step-02-context', 'step-03-starter']
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/prd.md
  - _bmad-output/planning-artifacts/tournament/product-brief.md
workflowType: 'architecture'
project_name: 'Tournament'
user_name: 'Josh'
date: '2026-04-18'
parent_monorepo: 'D:/wolf-cup'
sibling_app: 'Wolf Cup (wolf.dagle.cloud)'
target_subdomain: 'tournament.dagle.cloud'
posture: 'foundation-first, ship-when-solid'
target_testing_window: 'Pinehurst 2026-05-07 to 2026-05-10'
fallback_testing_window: 'June 2026 trip'
inheritedFoundationDecisions:
  - FD-1: 'Monorepo no-rename — Wolf Cup keeps apps/api + apps/web; tournament is apps/tournament-*'
  - FD-2: 'Port-verbatim posture — no shared packages/* except engine for pure functions'
  - FD-3: 'Scoring — hole-level soft-lock + full audit log'
  - FD-4: 'Identity — Google SSO + magic-link fallback + one-time GHIN bind; no passwords v1'
  - FD-5: 'Engagement — app-internal only (toasts/banners/feed); no push/SMS/email ever'
  - FD-6: 'Ecosystem columns — context_id + tenant_id on every writable domain table'
  - FD-7: 'Round is the atomic stats unit; seasons/events/series are optional groupers'
  - FD-8: 'Rule sets are tenant-scoped, named, revisioned (rounds pin rule_set_revision_id)'
  - FD-9: 'Filter cube for stats — primary = date range / year'
  - FD-10: 'Sub-games are first-class, round-scoped, participant-scoped'
  - FD-11: 'Skins is the v1 sub-game — gross/net/gross-beats-net modes'
  - FD-12: 'v1 bet menu lean — carry-over greenies as 2v2 rule param; big-trip bets deferred'
  - FD-13: 'Single-admin v1 with four guardrails (mid-event edit, GHIN bailout, handoff, role collapse)'
  - FD-14: 'PWA-primary + in-app install prompt + browser-tab read-only graceful'
  - FD-15: 'Full BMAD architecture workflow (this doc) → create-epics-and-stories next'
---

# Architecture Decision Document — Tournament

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Workflow State

**Step 1 complete (2026-04-18).** Inputs discovered, loaded, and validated. Architecture document initialized.

**Inputs loaded:**
- `prd.md` — 878 lines; through step-06 revised; 63 stories across 9 epics; FD-1..FD-15 locked.
- `product-brief.md` — 324 lines; vision, feature set, 10-item future-proofing checklist, v1.5 Guyan milestone.

**Not loaded (intentional):**
- `drafts/step-07-11-draft.md` — SUPERSEDED banner; do not merge.

**Adjacent context available if needed in later steps:**
- `_bmad-output/planning-artifacts/epics.md` — Wolf Cup v1 authoritative spec (port-source reference).
- `reference/pinehurst-may-2026-courses.json` — 4 validated Pinehurst courses + #2 alternate.
- Root `CLAUDE.md` — evidence-first project posture.

## Project Context Analysis

### Requirements Overview

**Functional Requirements (57 across 8 categories):**

| Category | Count | Architectural drivers |
|---|---|---|
| FR-A Events & Groups | 9 | Event/Group/rule-set/course/invite schema; scorecard PDF→vision pipeline; GHIN lookup |
| FR-B Scoring | 10 | Single-writer enforcement; offline queue + idempotent replay; audit log; round lifecycle FSM |
| FR-H Permissions | 7 | Role matrix middleware; money-visibility Group property |
| FR-C Leaderboard & Live Updates | 5 | Cross-group leaderboard; <30s propagation; in-app toast/banner/feed spine; tie-break |
| FR-D Rules, Money & Bets | 12 | 2v2 best ball engine; press + auto-press; cross-foursome bets; sub-game framework; skins |
| FR-E Player Experience | 10 | Invite-link first-arrival; SSO + GHIN bind; schedule/previews; photo gallery; install prompt |
| FR-F Export | 2 | Server-side PDF generation |
| FR-G Deployment Isolation | 2 | Hard isolation from Wolf Cup (DB, docker, Traefik, auth); engine-only shared surface |

**Non-Functional Requirements (17):** Performance ×3, Reliability/Offline ×3, Security/Auth ×3, Correctness ×3, Deployability ×2, Observability ×2, Device Floor ×1.

### Scale & Complexity

- **Primary domain:** PWA (iOS Safari installed, primary) + Hono API + SQLite.
- **Complexity level:** medium. Domain-deep, not team-scale or regulatory.
- **Architectural components (top-level ~12):** tournament-api, tournament-web, engine (shared), auth subsystem, GHIN client (copied), R2 gallery client (copied), Anthropic vision pipeline, offline queue (ported), audit log, permissions middleware, in-app event spine, PDF generation.

**Engine asymmetry:** `packages/engine` is tiny by LOC but carries the highest-correctness NFRs (C1, C2, D6, D8). It deserves disproportionate review attention relative to its size.

### External Integrations (5)

| Service | Purpose | Posture | Decision needed in Step 7 |
|---|---|---|---|
| GHIN | Handicap lookup | Copied client from Wolf Cup (FD-2) | No |
| Google OAuth | Primary SSO | New | OAuth library choice |
| Email magic-link | SSO fallback (FD-4) | New | Provider (Resend / Postmark / other) |
| Anthropic Vision | Course PDF parsing | Existing key | Prompt stability, rate limits |
| Cloudflare R2 | Photo gallery | Shared bucket w/ Event prefix OR separate | Ops open item |

### Implicit Assumptions (now explicit)

1. **Wolf Cup code is actively evolving** on live-round feedback cadence (first live round 2026-04-17; season runs through 2026-09-04). FD-2's copy-don't-extract posture is justified by Wolf Cup's priority on its own stability, NOT by Wolf Cup code stability. Every copied module (offline queue, GHIN client, PDF gen, audit log, photo gallery, iOS keyboard fix) is a live drift surface. Bug fixes MUST be mirrored within one dev session. See memory: `project_wolf_cup_code_evolution.md`.
2. **PWA install adoption is 8/8.** FD-14 depends on this. Fallback if a player refuses install: reassign scorer within foursome to an installed device; their personal write access (if needed) is degraded to browser-tab read-only.
3. **Conflict window is small by design** (FR-B1 single-scorer per foursome). LWW + soft-lock is adequate because the offline-drain-collision case is rare — not because it's a solved distributed-systems problem.

### Cross-Cutting Concerns

1. **Determinism & revisioning** — rule-sets and courses are revisioned; rounds pin revision IDs; engine is pure; golden fixtures.
2. **Cache invalidation across revisioning** — mid-event rule edits (FD-13) + cross-foursome federation + forward recompute compose a cache dependency graph. Architecture must name propagation model (Step 7+).
3. **Audit logging** — score corrections, rule-config changes, scorer handoffs. All carry actor + prior/new + timestamp.
4. **Visibility & permissions** — role matrix × Group money-visibility posture (open v1). Every read path filters.
5. **Idempotency** — all offline-queueable mutations carry `client_event_id`; server dedups.
6. **Timezone correctness** — Event declares TZ; all date math uses it.
7. **Identity composition** — `device_bindings` × `scorer_assignments` × session cookie × `players.google_sub` × `players.ghin` must compose as a system. Includes a GHIN disambiguation UI (same-name collisions) as v1, not v2.
8. **In-app event spine replay** — offline drain batches N events. Must distinguish live vs replayed; no stacked-toast storms.
9. **Engine change protocol** — "engine-only shared surface" is not safe-by-construction; shared modules need an explicit change-review rule (who signs off when a new export lands, what Wolf Cup test gate protects the merge).

### Unique Technical Challenges

1. **Cross-foursome individual bets** — engine federates hole scores from different scorecards at compute time; partial-result handling when one side hasn't scored yet.
2. **Mid-event rule edit with forward-only recompute** (FD-13) — golden-file fixture required; v1 won't exercise organically.
3. **Sub-game participant scoping** (FD-10) — independent pots per sub-game across round participants.
4. **Rule-set revisioning semantics** (FD-8) — same `rule_set_id` across edits; history pins revision; v1 won't exercise organically, so deliberate test fixture needed.
5. **Hole-level soft-lock across offline window** (FD-3) — resolution UX when both writers drain queues simultaneously is not yet specified.

### Open Architectural Decisions (to resolve in later steps)

1. **Event spine implementation model** — lightweight `activity` table (derived events written durably; UI pulls last-N on reconnect) vs ephemeral bus vs full event sourcing. Leaning toward `activity` table.
2. **Auto-press UX tier within FD-5** — money-affecting events may need a *louder* in-app surface than ambient birdie toasts (e.g., persistent banner until acknowledged). FD-5's "pull-not-push" is a principle; tier within it is a design choice.
3. **Offline soft-lock resolution spec** — what happens when both writers drain offline queues and the "overwrite?" prompt lands on a backgrounded app.
4. **R2 bucket strategy** — reuse Wolf Cup bucket with Event-id prefix vs separate tournament bucket.
5. **Email magic-link provider** — Resend / Postmark / alternative.

### Architectural Tripwires

- **Monorepo split:** CI time >5min OR tournament dev count >1.
- **Postgres revisit:** concurrent-write contention >N/sec (unlikely for years).
- **`apps/api` rename reconsider:** when Wolf Cup 2026 season ends (2026-09-07), rename is a 1-day refactor; reassess then.
- **Package extraction trigger (strengthens FD-2):** when the same Wolf Cup bug fix lands in a copied module twice (not three times), extract immediately.

### Disciplines to Establish

1. **Bug-fix-mirroring protocol:** Weekly diff check (`git log apps/api/src/routes/admin/score-corrections.ts` etc.) against tournament's copy; fix mirrored within one dev session.
2. **Engine-change protocol:** New exports or modified signatures in `packages/engine` require running Wolf Cup's full test suite locally before commit; CI dual-run catches it but local run catches faster.
3. **Golden-file discipline for unexercised-in-v1 paths:** Build deliberate fixtures for mid-event rule edit (FD-13) and revisioning (FD-8); v1 won't exercise them organically.

## Starter Template Evaluation

### Primary Technology Domain

Full-stack TypeScript PWA + API inside an existing pnpm monorepo (`D:/wolf-cup`). Tournament scaffolds as sibling to Wolf Cup per FD-1.

### Starter Options Considered

| Option | Verdict | Why |
|---|---|---|
| **Wolf Cup `apps/api` + `apps/web` as scaffold-by-example** | **Selected** | FD-1 locks monorepo placement; FD-2 sets copy-posture for ported code; version alignment with Wolf Cup is a drift-mitigation goal, not a constraint |
| Fresh Vite + Hono scaffold | Rejected | Marginal difference from copying Wolf Cup; forgoes inherited CI wiring, Traefik config, Docker compose patterns |
| Next.js / T3 stack | Rejected | Different runtime (Node adapter, not Hono); would fork the monorepo toolchain; doesn't match Wolf Cup's shape |
| SvelteKit / Remix | Rejected | Different UI paradigm; no reuse surface against Wolf Cup |
| Turborepo template | Rejected | Wolf Cup already uses pnpm workspaces; swapping orchestrator = Wolf Cup regression risk |

### Selected Starter: Wolf Cup-scaffold-by-example

**Rationale for Selection:**
- FD-1 mandates sibling placement in the same pnpm monorepo under `apps/tournament-api` + `apps/tournament-web`
- FD-2 makes "copy Wolf Cup shapes into tournament tree" the default for non-engine surfaces (offline queue, GHIN client, PDF gen, audit log, photo gallery, iOS keyboard fix)
- Matching versions with Wolf Cup reduces drift surface (critical given Wolf Cup is actively evolving per Project Context)
- Existing CI already runs engine + Wolf Cup API tests; adding tournament's CI job is additive

**Initialization Approach (no CLI command):**

Scaffold by directory copy + scoped replace. Sequence (Epic T1 spine):

1. Create `apps/tournament-api/` by copying `apps/api/` structure; strip Wolf Cup routes and schema; rename package to `@tournament/api`; remove `bcrypt` (FD-4 SSO).
2. Create `apps/tournament-web/` by copying `apps/web/` structure; strip Wolf Cup routes; rename package to `@tournament/web`; keep Vite + React 19 + TanStack stack intact.
3. Add `apps/tournament-api` + `apps/tournament-web` to pnpm workspace globs (if not already covered).
4. Add `tournament-api` + `tournament` (web) services to `docker-compose.yml`; mount separate SQLite volume; add Traefik labels for `tournament.dagle.cloud`.
5. Add tournament to CI pipeline (`.github/workflows/ci.yml`) — run alongside engine + Wolf Cup API + web test suites.
6. Leave `packages/engine` untouched in this step (new engine modules — `skins.ts`, `best-ball-2v2.ts` — land via rule-of-three extraction in later epics).

### Architectural Decisions Inherited from Wolf Cup

**Language & Runtime:**
- TypeScript 5.7.x strict mode (existing tsconfig shape), Node 22+, ESM modules (`"type": "module"`)
- ESLint 9.x + typescript-eslint 8.x (flat config pattern inherited)

**API Stack:**
- Hono 4.x + @hono/node-server 1.x
- Drizzle ORM 0.45.x + drizzle-kit 0.30.x + @libsql/client 0.17.x (local SQLite file; libsql preserves future remote Turso option without code change)
- Zod 3.24.x for request/response validation
- @spicygolf/ghin 0.8.x (copied GHIN client wrapper lives in tournament's tree per FD-2)
- @aws-sdk/client-s3 3.x for R2 (bucket strategy open — Step 7 decision)
- **Dropped:** bcrypt (FD-4 no passwords)
- **Added (new for tournament, shape sketched below; finalized Step 7):**
  - Google OAuth library (candidate: `arctic`)
  - Magic-link token generation via `crypto.randomBytes(32)`
  - Email provider SDK for magic-link delivery (candidate: Resend / Postmark / SES)
  - `@anthropic-ai/sdk` for course PDF vision

**Web Stack:**
- React 19, Vite 6, TanStack Router 1.163.x + Query 5.90.x
- Tailwind CSS v4 via `@tailwindcss/vite`
- shadcn/ui pattern: `@radix-ui/react-slot` + `class-variance-authority` + `clsx` + `tailwind-merge`
- `lucide-react` for icons
- `idb` 8.x for IndexedDB offline queue
- `vite-plugin-pwa` for service worker + manifest (FD-14 install prompt uses this)

**Build Tooling:**
- pnpm 9.15.x workspaces; `pnpm -r build` for all packages
- TypeScript project references (Wolf Cup pattern: `tsconfig.build.json`, `tsconfig.app.json`, `tsconfig.node.json`)
- `tsr generate` (TanStack Router CLI) as part of typecheck

**Testing Framework:**
- Vitest 3.x in tournament-api + tournament-web from day one (skip engine-vs-API drift Wolf Cup currently has)
- Coverage via `@vitest/coverage-v8` 3.x
- Golden-file fixtures pattern for engine math in `packages/engine/src/formats/__fixtures__/`
- **Engine test helpers are engine-internal** — do not export from `packages/engine/src/index.ts`; apps import engine functions under test but bring their own test scaffolding. Protects tournament (Vitest 3) from engine (Vitest 2) version skew.

**Code Organization:**
- Hono routes grouped by resource under `src/routes/` (mirrors Wolf Cup API shape)
- `src/lib/` utilities (timezone, audit log, auth middleware)
- Web: TanStack Router file-based routes under `src/routes/` with auto-generated route tree

**Development Experience:**
- Hot reload: Vite dev server (web), `node --watch dist/index.js` (API — Wolf Cup's chosen pattern for production-parity)
- Route tree generation: `tsr generate` on typecheck
- Migrations: `drizzle-kit generate` + `drizzle-kit migrate`
- Deploy: Docker Compose + Traefik on VPS (existing infra)

### Version Alignment Discipline

Tournament **pins to Wolf Cup's current versions at scaffold time**, not "latest on npm." Rationale:
- Wolf Cup bug fixes land in these versions and get mirrored to tournament copies
- Version drift between Wolf Cup and tournament creates back-port friction
- When tournament wants to bump a major version (e.g., React 20 when released), bump both apps together or neither

**Vitest alignment:** tournament-api + tournament-web scaffold with Vitest 3.x; engine's Vitest 2.x stays until Wolf Cup owners (Josh, again) choose to bump. Architecture does not force Wolf Cup to upgrade.

### Version-Drift Enforcement

A `tools/check-version-drift.mjs` script runs in CI and compares shared dependencies between `apps/api/package.json` and `apps/tournament-api/package.json` (same for web). Script maintains an allowlist of intentional deltas:

- **Wolf-Cup-only:** `bcrypt`, `@types/bcrypt` (FD-4 — tournament has no passwords)
- **Tournament-only:** Google OAuth library (TBD Step 7), magic-link email lib (TBD Step 7), `@anthropic-ai/sdk` (course PDF vision)
- **Test-runner allowed-skew:** engine's Vitest 2.x vs apps' Vitest 3.x (until Wolf Cup independently chooses to bump)

Drift outside the allowlist fails CI. Ten lines of Node. Hard-enforces version-pinning instead of relying on developer vigilance.

### Auth Subsystem Shape Sketch (candidates for Step 7 final pick)

FD-4 replaces Wolf Cup's bcrypt/password auth with SSO + magic-link. Concrete candidate shape to build on in Step 4, finalize in Step 7:

- **Google OAuth:** `arctic` (provider-agnostic, minimal, zero external deps beyond crypto) — leading candidate. Alternative: `@hono/oauth-providers` (tighter Hono integration; more magic).
- **Magic-link email:** custom endpoint using `crypto.randomBytes(32)` for token generation + Drizzle-backed `magic_link_tokens` table (token, user_id, expires_at, consumed_at). Token delivered via email provider (Resend / Postmark / SES — Step 7 decision).
- **Session store:** Drizzle-backed `sessions` table (session_id, user_id, created_at, last_seen_at, device_info). Session cookie scoped to `tournament.dagle.cloud` (future-proof checklist item 6 from brief).
- **GHIN bind:** one-time post-SSO; writes `players.ghin` + `players.google_sub` atomically; disambiguation UI handles same-name collisions.

Not locked here. Step 7 picks the final libs with versions.

### Explicit Scaffold-by-Copy File Manifest

Concrete files to copy-and-rename from Wolf Cup during T1 Foundation (supersedes hand-waving "copy the structure"):

**apps/tournament-api/ (copied from apps/api/):**
- `package.json` (rename to `@tournament/api`; remove `bcrypt` + `@types/bcrypt`)
- `tsconfig.json`, `tsconfig.build.json`
- `drizzle.config.ts` (update DB path to tournament's volume; point `schema` at `src/db/schema/*`)
- `vitest.config.ts`
- `eslint.config.js`
- `src/index.ts` (strip Wolf Cup routes; keep Hono app skeleton + health endpoint)
- `src/db/index.ts` (keep; point at tournament DB file)
- `src/db/schema/` (new — empty, populated per T2/T3/T5/T6 stories; NOT a copy of Wolf Cup's flat `schema.ts`)

**apps/tournament-web/ (copied from apps/web/):**
- `package.json` (rename to `@tournament/web`)
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- `vite.config.ts` (update PWA manifest for tournament branding)
- `postcss.config.js`, `tailwind.config.ts`
- `eslint.config.js`
- `src/main.tsx` (strip Wolf Cup routes; keep TanStack Router + Query providers)
- `index.html`

**What is NOT copied:**
- Wolf Cup's `src/routes/` (tournament routes are new per stories)
- Wolf Cup's `src/db/schema.ts` flat file — tournament uses `src/db/schema/` directory pattern (see Schema File Organization below)
- Wolf Cup's `src/lib/password.ts` (FD-4 no passwords)

### Schema File Organization (delta from Wolf Cup)

Wolf Cup uses flat `src/db/schema.ts` (17 tables). Tournament projects ~25 tables. Flat would become unwieldy.

Tournament uses **domain-grouped schema files from day one**:
- `src/db/schema/events.ts` — events, event_rounds, invites
- `src/db/schema/groups.ts` — groups, group_members
- `src/db/schema/rules.ts` — rule_sets, rule_set_revisions
- `src/db/schema/courses.ts` — courses, course_revisions, course_tees, course_holes
- `src/db/schema/players.ts` — players, player_identity_merges, device_bindings
- `src/db/schema/scoring.ts` — rounds, round_states, scorer_assignments, hole_scores, score_corrections
- `src/db/schema/subgames.ts` — sub_games, sub_game_participants, sub_game_results
- `src/db/schema/activity.ts` — event spine
- `src/db/schema/auth.ts` — sessions, magic_link_tokens
- `src/db/schema/index.ts` — re-exports all

Drizzle supports multi-file schemas via `schema: './src/db/schema/*'` in `drizzle.config.ts`. Wolf Cup's flat file is legacy-by-inertia; not a pattern to copy.

### CI Baseline (measure before T1 lands)

Current Wolf Cup test wall-clock is the baseline against which the architectural tripwire "CI > 5 min → split monorepo" is measured. Without a baseline, the tripwire is meaningless.

**Action:** run `time pnpm test` on a clean checkout before T1.1 lands; record result in the T1 story or an architecture doc addendum.

### Dependencies NOT Inherited (tournament-specific adds)

Resolved later in the workflow (Step 7 Technical Decisions). Pre-identified list:
- Google OAuth library (TBD — `arctic` leading)
- Magic-link email provider (TBD — Resend / Postmark / SES)
- Possibly a structured JSON logger for NFR-O1 (candidate: `pino`; Wolf Cup uses console + file append today)
- `@anthropic-ai/sdk` for course PDF vision parsing

**Note:** Project initialization is Epic T1 (Tournament Foundation) in the PRD. The 6-step sequence above is the implementation spine for that epic.
