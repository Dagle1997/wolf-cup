---
stepsCompleted: ['step-01-init', 'step-02-context', 'step-03-starter', 'step-04-decisions', 'step-05-patterns', 'step-06-structure', 'step-07-validation', 'step-08-complete']
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '2026-04-18'
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/prd.md
  - _bmad-output/planning-artifacts/tournament/product-brief.md
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

**Engine architecture** *(revised 2026-04-18 post-Codex pass 2)*: `packages/engine` stays minimal with only `stableford.ts` as the shared primitive, read-only from tournament's perspective per brief §3. Tournament's format engines (2v2 best ball, skins, press, individual bets, carry-greenies) live in **`apps/tournament-api/src/engine/`** — tournament-local, not shared. That module carries tournament's highest-correctness NFRs (C1, C2, D6, D8); the asymmetry of "small LOC, outsized correctness weight" now lives there, not in `packages/engine`. Extraction to shared is a separate tracked decision with explicit Wolf Cup owner sign-off if a primitive becomes genuinely shared (rule-of-three trigger).

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
7. **Identity composition** *(revised 2026-04-18 post-Codex pass 2)* — `device_bindings` × `scorer_assignments` × session cookie × `players.google_sub` must compose as a system. Identity trust anchor is `player_id` + SSO sub only; `players.ghin` is optional enrichment, never a precondition for valid identity. Disambiguation UI (same-name collisions) runs at GHIN-link time as a profile action (FR-E11), decoupled from SSO bind.
8. **In-app event spine replay** — offline drain batches N events. Must distinguish live vs replayed; no stacked-toast storms.
9. **Engine change protocol** — "engine-only shared surface" is not safe-by-construction; shared modules need an explicit change-review rule (who signs off when a new export lands, what Wolf Cup test gate protects the merge).

### Unique Technical Challenges

1. **Cross-foursome individual bets** — engine federates hole scores from different scorecards at compute time; partial-result handling when one side hasn't scored yet.
2. **Mid-event rule edit with forward-only recompute** (FD-13) — golden-file fixture required; v1 won't exercise organically.
3. **Sub-game participant scoping** (FD-10) — independent pots per sub-game across round participants.
4. **Rule-set revisioning semantics** (FD-8) — same `rule_set_id` across edits; history pins revision; v1 won't exercise organically, so deliberate test fixture needed.
5. **Hole-level soft-lock across offline window** (FD-3) — resolution UX when both writers drain queues simultaneously is not yet specified.

### Top Risks (v1-scoped, solo-dev)

Ordered by dominance. Expanded / tiered version lands in Step 10 of this workflow; captured here so Step 4 decisions weight these correctly.

1. **Integration pressure — too many correctness-sensitive systems landing together in 19 days** *(as of 2026-04-18)*. Solo dev, ~55 new stories across auth, permissions, offline sync, live updates, money engine, cross-foursome bets, skins, event spine, revisioning, mid-event edit. Mitigations: Pinehurst May 7 is a **target not a deadline** (foundation-first posture); June trip is the explicit fallback window (FD-15); ship trip-critical hard blockers first per the PRD's sequencing; target-miss-tolerable stories slip rather than compromise the blockers. **This is the dominant risk to v1, above money correctness** — money correctness has a clear mitigation path (pure engine + golden fixtures); schedule compression has no single technical mitigation.
2. **Money correctness failure at settle-up** — any pair's balance off by any amount loses product credibility instantly. Mitigations: pure engine + golden-file fixtures per rule variant + hand-calc fixture release gate (T6.9) + score-correction audit log (FR-B8) + raw-state export for external verification (NFR-B1).
3. **Wolf Cup regression during tournament build** — live weekly product, 865+ tests. Mitigations: CI dual-run; copy-don't-extract posture (FD-2) with per-module provenance; no Wolf Cup runtime edits without explicit approval; engine-change protocol (discipline #2 below).
4. **Offline sync edge cases** — hole-level soft-lock × offline-drain collision is undefined. Mitigation: airplane-mode drill (T5.10) + explicit spec for simultaneous-drain resolution (captured as Open Architectural Decision #3 above).
5. **iOS PWA storage eviction** — latent risk (empirically fine in Wolf Cup so far); memory pressure could evict IndexedDB and lose unsynced scores. Mitigation: monitor; validate in the PWA install adoption spike (brief §7c).
6. **GHIN bind disambiguation on same-name collisions** — Matt W vs Matt J shipping without disambiguation UI = misbound player_id. Mitigation: disambiguation UI in v1 scope (FD-4 revised), not v2.
7. **Mid-event rule-edit forward-recompute correctness** — high-complexity path, low-exercise path. Mitigation: deliberate golden-file fixture (discipline #3); scope to organizer-only; visible diff banner for transparency.

Risks retired in this revision (see Codex external review 2026-04-18):
- ~~"PWA install adoption <100%"~~ — de-escalated; FD-14 fallback (reassign scorer to installed device) covers it.
- ~~"Mid-event rule edit not exercised"~~ — still open, but scoped; see risk 7.

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
| **Fresh scaffold + selective port from Wolf Cup** | **Selected** *(revised 2026-04-18 post-Codex)* | FD-1 locks monorepo placement + same stack; FD-2 copy-posture applies to **specific proven modules** (offline queue, GHIN client, PDF gen, audit log, photo gallery, iOS keyboard fix) with provenance tracking, NOT to wholesale directory copy. Reduces mirror surface from ~142 files to ~8 ported modules |
| Copy `apps/api` + `apps/web` and strip routes | Rejected | 118 API files + 24 web route files would fork Wolf Cup's shape; every stripped file is a permanent mirror-debt liability even after deletion, because the scaffolded project inherits every non-stripped shape decision wholesale |
| Fresh Vite + Hono scaffold (no Wolf Cup modules ported) | Rejected | Forgoes the real value: battle-tested offline queue (2026 season verified), GHIN client wrapper, PDF pattern, audit log pattern — all of which have non-obvious bug fixes baked in |
| Next.js / T3 stack | Rejected | Different runtime (Node adapter, not Hono); would fork the monorepo toolchain; doesn't match Wolf Cup's shape |
| SvelteKit / Remix | Rejected | Different UI paradigm; no reuse surface against Wolf Cup |
| Turborepo template | Rejected | Wolf Cup already uses pnpm workspaces; swapping orchestrator = Wolf Cup regression risk |

### Selected Starter: Fresh scaffold + selective port from Wolf Cup *(revised 2026-04-18)*

**Rationale for Selection:**
- FD-1 mandates sibling placement in the same pnpm monorepo under `apps/tournament-api` + `apps/tournament-web`
- FD-2 copy-posture applies to **specific proven modules** with provenance tracking, not to wholesale directory copy — the reduction in mirror surface from ~142 files to ~8 ported modules is the key architectural win
- Same stack + versions as Wolf Cup (TypeScript 5.7, Hono 4, Drizzle 0.45, Vite 6, React 19, TanStack Router/Query, Tailwind v4, Vitest 3, idb 8, libsql) — but tournament's source tree is its own, not a fork of Wolf Cup's
- Proven modules (offline queue, audit log, GHIN client, PDF gen, photo gallery, iOS keyboard fix) get ported one-at-a-time, each carrying a provenance header and a port-inventory entry
- Existing CI already runs engine + Wolf Cup API tests; adding tournament's CI job is additive

**Initialization Approach — T1 Foundation Sequence:**

1. **Fresh scaffold of `apps/tournament-api/`** — generate a minimal Hono + Drizzle + @libsql/client project from scratch matching Wolf Cup's versions (NOT `cp -r apps/api apps/tournament-api`). Minimum shape: `package.json` (deps match Wolf Cup; no `bcrypt`), `tsconfig.json` + `tsconfig.build.json`, `drizzle.config.ts` pointing at `src/db/schema/*`, `vitest.config.ts`, `eslint.config.js`, `src/index.ts` (Hono app + `/api/health` endpoint), `src/db/index.ts`, `src/db/schema/index.ts` (empty re-export file). Total: ~8 hand-written files, zero copied-and-stripped.
2. **Fresh scaffold of `apps/tournament-web/`** — generate a minimal Vite + React 19 + TanStack Router + Tailwind v4 + vite-plugin-pwa project from scratch matching Wolf Cup's versions. Minimum shape: `package.json`, `tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json`, `vite.config.ts` (tournament PWA manifest), `postcss.config.js`, `tailwind.config.ts`, `eslint.config.js`, `index.html`, `src/main.tsx` (Router + Query providers only). Total: ~10 hand-written files.
3. **Add to pnpm workspace** — `apps/tournament-api` + `apps/tournament-web` covered by `apps/*` glob already.
4. **Add tournament services to `docker-compose.yml`** — separate SQLite volume, Traefik labels for `tournament.dagle.cloud`.
5. **Add tournament to CI pipeline** — `.github/workflows/ci.yml` runs alongside engine + Wolf Cup suites.
6. **Engine untouched in T1** — new engine modules (`skins.ts`, `best-ball-2v2.ts`) land later per rule-of-three discipline.

**Proven modules ported one-at-a-time after T1 scaffold, driven by story need:**

| Module | Wolf Cup source path | Ports into | Story trigger |
|---|---|---|---|
| Offline queue | `apps/web/src/lib/offline-queue.ts` + `useOfflineQueue` + `useOnlineStatus` hooks | `apps/tournament-web/src/lib/offline-queue.ts` | T5.3 |
| iOS keyboard focus fix | scorer UI pattern (commit `ebe3cea`) | `apps/tournament-web/src/routes/score-entry/` | T5.2 |
| GHIN client wrapper | `apps/api/src/lib/ghin-client.ts` + scheduled-refresh pattern | `apps/tournament-api/src/lib/ghin-client.ts` | T3.4 |
| Audit log pattern | `apps/api/src/routes/admin/score-corrections.ts` | `apps/tournament-api/src/routes/score-corrections.ts` | T5.9 |
| Photo gallery (R2 upload + lightbox) | `apps/api/src/routes/gallery/*` + `apps/web/src/routes/gallery/*` | `apps/tournament-{api,web}/src/routes/gallery/*` | T7.4 |
| PDF generation pattern | `reference/wolf-cup-admin-guide.html` template + headless-Chrome pipeline | `apps/tournament-web/src/lib/pdf/` (or api if server-generated) | T4.3 |
| Scorer entry UI shape | `apps/web/src/routes/score-entry/*` | `apps/tournament-web/src/routes/score-entry/*` | T5.2 |

Each port carries a provenance header (see Port Provenance Protocol below) and an entry in `apps/tournament-*/PORTS.md`.

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

### Version Alignment Posture *(revised 2026-04-18 post-Codex)*

Tournament **pins to Wolf Cup's current versions at scaffold time**, not "latest on npm." Rationale:
- Matching versions reduce the cognitive-switching cost between the two apps for a solo dev
- When tournament wants to bump a major version (e.g., React 20 when released), bump both apps together

**But version-pinning is not the real drift defense.** Codex's 2026-04-18 review correctly flagged: behavioral drift happens at the file/module level, not the semver level. A dependency-graph diff check produces false confidence — it catches `"react": "^19.0.0"` vs `"react": "^19.1.0"` but misses the 3 bug fixes Wolf Cup landed in `offline-queue.ts` last month that tournament's port is missing. **Provenance tracking is the real drift defense; version pinning is a secondary discipline.**

**Vitest alignment:** tournament-api + tournament-web scaffold with Vitest 3.x; engine's Vitest 2.x stays until Wolf Cup owners (Josh) choose to bump. Architecture does not force Wolf Cup to upgrade.

### Port Provenance Protocol *(replaces "Version-Drift Enforcement")*

Each ported module carries a **provenance header** at the top of the file:

```typescript
/**
 * PORTED from apps/web/src/lib/offline-queue.ts
 * Source commit: 6bb6fba (2026-04-16)
 * Scope: IndexedDB queue for mutations, online-status hook, queue-drain-on-reconnect.
 * Known deltas from source:
 *   - Added `clientEventId` field for server-side dedup (tournament FR-B10)
 *   - DB name: `tournament-offline` (source uses `wolf-cup-offline`)
 * Mirroring discipline: check Wolf Cup source for new commits before each port-touching story.
 */
```

A single-file **port inventory** (`apps/tournament-api/PORTS.md` and `apps/tournament-web/PORTS.md`) tracks every ported module:

| Target file | Source file | Source commit | Ported on | Deltas | Last checked for Wolf Cup updates |
|---|---|---|---|---|---|
| `src/lib/offline-queue.ts` | `apps/web/src/lib/offline-queue.ts` | `6bb6fba` | 2026-04-?? | clientEventId, DB name | pending |

**Discipline:**
- When fixing a bug in Wolf Cup code that tournament ports, grep `PORTS.md` for the source path; if matched, mirror the fix and update the "Last checked" date.
- When starting work on a story that touches a ported module, first `git log apps/.../source-file.ts --since="{last-checked-date}"` and review any new commits for behavior tournament should inherit.
- **No automated drift-check script.** Behavioral drift at the module level is what matters; semver drift at the dependency level is noise. Keep the cognitive protocol, drop the CI gate.

### Auth Subsystem Shape Sketch (candidates for Step 7 final pick)

FD-4 replaces Wolf Cup's bcrypt/password auth with SSO + magic-link. Concrete candidate shape to build on in Step 4, finalize in Step 7:

- **Google OAuth:** `arctic` (provider-agnostic, minimal, zero external deps beyond crypto) — leading candidate. Alternative: `@hono/oauth-providers` (tighter Hono integration; more magic).
- **Magic-link email:** custom endpoint using `crypto.randomBytes(32)` for token generation + Drizzle-backed `magic_link_tokens` table (token, user_id, expires_at, consumed_at). Token delivered via email provider (Resend / Postmark / SES — Step 7 decision).
- **Session store:** Drizzle-backed `sessions` table (session_id, user_id, created_at, last_seen_at, device_info). Session cookie scoped to `tournament.dagle.cloud` (future-proof checklist item 6 from brief).
- **GHIN bind:** one-time post-SSO; writes `players.ghin` + `players.google_sub` atomically; disambiguation UI handles same-name collisions.

Not locked here. Step 7 picks the final libs with versions.

### Scaffold Manifest *(revised 2026-04-18 — fresh-not-copied)*

Tournament's scaffold files are authored fresh, matching Wolf Cup's versions but not copied from Wolf Cup's source. Reference Wolf Cup's file shape when helpful; do not `cp -r`. The goal is tournament owning its own source tree, not inheriting Wolf Cup's route/schema legacy.

**apps/tournament-api/ (fresh-authored skeleton):**
- `package.json` — `@tournament/api`; deps match Wolf Cup versions; no `bcrypt`
- `tsconfig.json`, `tsconfig.build.json` — reference Wolf Cup's shape, author fresh
- `drizzle.config.ts` — point at tournament DB path + `schema: './src/db/schema/*'`
- `vitest.config.ts` — Vitest 3.x config
- `eslint.config.js` — same flat-config shape as Wolf Cup
- `src/index.ts` — Hono app with `/api/health` endpoint only; routes added per story
- `src/db/index.ts` — drizzle init pointing at tournament DB file
- `src/db/schema/index.ts` — empty re-export file; per-domain schema files added per T2/T3/T5/T6

**apps/tournament-web/ (fresh-authored skeleton):**
- `package.json` — `@tournament/web`; deps match Wolf Cup versions
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` — reference Wolf Cup's shape
- `vite.config.ts` — tournament PWA manifest, not copied from Wolf Cup's
- `postcss.config.js`, `tailwind.config.ts` — Tailwind v4 defaults
- `eslint.config.js` — flat-config shape
- `index.html` — tournament branding, not copied from Wolf Cup
- `src/main.tsx` — Router + Query providers only; routes added per story

**Proven modules ported later (per the table in Initialization Approach above), each carrying a provenance header.**

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

## Core Architectural Decisions

All decisions made 2026-04-18 across a single facilitation pass, with party-mode review (Winston / Amelia / Quinn / Barry) + Codex external pass. Most categories inherit heavily from the starter (Wolf Cup sibling) and the 15 Foundation Decisions (FD-1..FD-15). Listed below are the *genuinely open* choices made in this step.

### Decision Priority Analysis

**Critical (block implementation):**
- D1-1 Recompute on read via `src/services/money.ts` service functions (no cache)
- D2-1 OAuth library: `arctic`
- D2-2 Magic-link email provider: Resend
- D3-1 Real-time updates: TanStack Query polling with visibilitychange pause
- D3-2 Event spine: lightweight `activity` table with transactional writes + Zod-validated typed payloads
- D3-3 Offline soft-lock resolution: server 409 + UI overwrite prompt at drain time

**Important (shape architecture):**
- D2-3 Authorization middleware: hybrid path-pattern + per-route manual
- D2-4 Session lifetime: 7-day rolling, 30-day hard maximum
- D3-4 Auto-press UX tier: persistent banner until acknowledged
- D3-5 Partial-result handling: `pending` / `pending-all` response shapes
- D4-1 Client state: local `useState` + TanStack Query + URL params, no state library
- D4-3 Toast/banner/feed: `sonner` wrapped in `<TournamentToast>` for Toast; custom Banner + Feed
- D5-7 DB backup: pre-migration + daily cron
- D5-10 R2 bucket: shared with Event-id prefix

**Deferred (explicitly post-v1):**
- Cache layer (re-evaluate if read-time performance degrades at scale)
- Staging environment (re-evaluate if manual prod deploys become bottleneck)
- Monitoring/alerting beyond on-site Josh (add Uptime Robot pre-T9 if trip criticality warrants)
- Formal OpenAPI docs (re-evaluate if external consumers appear)
- State management library (add Zustand or Context only when specific need emerges)
- Framer Motion (Tailwind + CSS only for v1)
- SSE/WebSocket real-time (upgrade path from polling if T9.1 live drill shows lag)

### Data Architecture

| Decision | Choice | Rationale |
|---|---|---|
| D1-1 Cache invalidation | **No cache. Recompute on read.** Centralized in `apps/tournament-api/src/services/money.ts` exporting `computeMoneyMatrix(eventId)` + `computeLeaderboard(roundId)` — pure functions wrapping engine + DB reads; called by all read endpoints. | 8 players × 18 × 4 = ~576 hole rows; SQLite SELECT is milliseconds; engine is pure + golden-file tested; zero invalidation bugs. Naming the service location prevents step-05 re-litigation. |
| D1-2 Seed strategy | `pnpm seed` (prod Pinehurst data) + `pnpm seed:demo` (deterministic 8-player dev/E2E seed) | Match Wolf Cup convention |
| D1-3 DB file path | `/app/data/tournament.db` on docker volume `tournament_sqlite_data` | Match Wolf Cup |
| D1-4 Backup discipline | Pre-migration file copy: `tournament.db.pre-{migration}-{timestamp}.bak` on host volume | Match Wolf Cup |

### Authentication & Security

| Decision | Choice | Rationale |
|---|---|---|
| D2-1 OAuth library | `arctic` | Explicit PKCE flows, minimal deps, Drizzle-session compatible |
| D2-2 Magic-link email provider | Resend | 3k/mo free covers our lifetime at ~16 emails/trip; simplest API |
| D2-3 Authorization middleware | Hybrid: path-pattern guards (`app.use('/admin/*', requireOrganizer)`) + per-route manual checks for fine-grained (`requireScorerForRound`) | Matches Wolf Cup pattern; right granularity |
| D2-4 Session lifetime | **7-day rolling, 30-day hard maximum.** Each authenticated request extends expiration by 7 days; total session age capped at 30 days. | Covers 4-day trip with headroom; 30-day max bounds damage from lost phones / drop-in guests in future use cases (v1.5 Thursday league). |
| D2-5 CSRF + cookie model | **Cookie split explicit:** (1) Post-auth **session cookie** — `SameSite=Strict`, `HttpOnly`, `Secure`, `Path=/`; (2) OAuth-flow **state/PKCE cookies** (`oauth_state`, `oauth_code_verifier`) — `SameSite=Lax` (must survive the Google-redirect return trip), `HttpOnly`, `Secure`, 10-min TTL, cleared on callback success. CSRF defense relies on `SameSite=Strict` on the session cookie; no Origin/Referer middleware check. No double-submit tokens. | SameSite=Strict on the authenticated cookie is sufficient CSRF defense; the OAuth-flow cookies intentionally have different requirements — Lax is mandatory for cross-site redirect return. Codex pass-3 flagged that dropping Origin check without naming this split would leave a latent auth bug. |
| D2-6 Secrets | Node 22 `--env-file=.env.production` flag (no dotenv dep) | Match Wolf Cup |
| D2-7 Rate limiting | Magic-link send only: 5/email/hr + 30/IP/hr via in-memory token bucket | Only abuse vector at our scale; no other rate limiting v1 |

### API & Communication Patterns

| Decision | Choice | Rationale |
|---|---|---|
| D3-1 Real-time updates | TanStack Query `refetchInterval`: **5s during active rounds**, 30s idle, **pause when a scorer surface is the active viewport** (scorers create the updates; they don't need to poll for them), **resume on `visibilitychange`**. | Simplest path to NFR-P2; battery-friendly; upgrade path to SSE if T9.1 surfaces lag. |
| D3-2 Event spine | Lightweight `activity` table: `(id, event_id, round_id, player_id, type, payload_json, created_at)`. **Writes are transactional with the score write** — same DB transaction, multi-insert, commit at end (no partial-state on crash). **`payload_json` is a TypeScript discriminated union typed per event type** (birdie, press-fire, bet-flip, lead-change, award-trigger), **Zod-validated BEFORE insert** (not just on read), and defensively parsed on read as a belt-and-suspenders. | Durable; replay via `since={ts}`; consumed by toast/banner/feed (D4-3) and T8 stories. Write-side validation prevents corrupt rows; read-side parsing handles legacy/schema-drift edge cases. |
| D3-3 Offline soft-lock resolution | Server 409 on second writer at queue drain. UI shows overwrite prompt at drain time (lands when app is foregrounded, coinciding with user attention). Drain processes entries in hole-order; only conflicting entries trigger the prompt. Response body: `{ error: 'conflict', conflictingEntry: { actor, timestamp, value } }`. | Drain + prompt coincide with user focus; LWW at DB with full audit log regardless. **T5.10 airplane-mode drill expanded to include a deliberate 409-collision scripted test** — two clients, same roundId/holeNumber/playerId, different `client_event_id`, assert first gets 200 + second gets 409 with conflict payload. |
| D3-4 Auto-press UX tier | Persistent banner at top of leaderboard/home until tap-to-dismiss; stacked banners collapse to "N updates — tap to review"; modal rejected (too disruptive mid-putt). | Money-affecting > ambient birdies; collapse protects against offline-drain-storm UX. |
| D3-5 Partial-result handling | Engine returns one of three shapes: `{ status: 'complete', result }` / `{ status: 'pending', result: <provisional-for-scored-holes>, missingPlayers: [...], missingHoles: [...] }` / `{ status: 'pending-all', holesMissing: [1..18] }` when zero input exists. UI on Bets page: show "waiting on {player}" per pending hole; suppress display entirely on `pending-all`. | Prevents misleading values; UI handling is deterministic per status tag. |
| D3-6 Error response shape | `{ error: string, code?: string, requestId: string, fields?: Record<string, string[]> }` — Zod validation errors map to `code: 'invalid_input'` with `fields` populated. | Match Wolf Cup + correlate to structured logs |
| D3-7 API documentation | Skip formal OpenAPI v1. Zod schemas as code-level docs. Add `apps/tournament-api/ROUTES.md` index if route count grows past ~30. | Solo dev, no external consumers |
| D3-8 Route file organization | **Resource-nested where a natural parent exists** (`/rounds/:roundId/scores`, `/events/:eventId/invites`, `/events/:eventId/rule-sets`); **flat for top-level resources** (`/rounds`, `/events`, `/players`); `/admin/*` for organizer-scoped routes. | Match Wolf Cup mental model; explicit convention prevents per-story debate. |

### Frontend Architecture

| Decision | Choice | Rationale |
|---|---|---|
| D4-1 Client state | Local `useState` + TanStack Query + URL params. No state library. | Match Wolf Cup (verified: zero state lib, zero Context); add only when need emerges |
| D4-2 Forms | Native controlled React forms with Zod validation (same schemas as API) | Match Wolf Cup (no react-hook-form); adopt RHF selectively if a form becomes complex |
| D4-3 Toast / banner / feed | **Toast:** `sonner` wrapped in a thin `<TournamentToast>` styling component (never import sonner directly from feature code) — gains accessibility/focus/animation for free; Tailwind-skinned to match app. **Banner** (persistent, stackable-collapsing, top-of-viewport) and **Feed** (reverse-chron list on player home): custom React Portal + Tailwind. All three consume the `activity` table (D3-2). | Commodity surface (Toast) uses battle-tested lib; distinctive surfaces (Banner, Feed) are custom for control. |
| D4-4 Animations | Tailwind + CSS transitions only. No Framer Motion. | Match Wolf Cup |
| D4-5 Auth-protected routes | TanStack Router `beforeLoad` hook calls `useSession()`; redirect to `/auth/sign-in?next={currentUrl}` if SSO required and missing. Invite-token reads use separate `useInviteSession()` (no SSO check). | SPA flow; clear separation of read vs write access |
| D4-6 Component organization | `src/components/ui/` for shadcn + flat `src/components/` for app-specific; group by domain if count exceeds ~30 | Match Wolf Cup; avoid premature grouping |
| D4-7 Branding config | Frozen const `src/lib/brand.ts` (appName, title, primaryColor, etc.). Single-tenant v1; future multi-tenancy swaps const for a resolver. | Brief checklist item 10 |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|---|---|---|
| D5-1 Deploy workflow | Manual `DEPLOY_USER=root ./deploy.sh` from Git Bash | Match Wolf Cup; solo dev controls cadence; tag-triggered CI deploy deferred |
| D5-2 Environment tiers | Prod + local dev only. No staging. | Solo dev; T9.1 live drill happens on prod or local |
| D5-3 CI test scope + flaky policy | Run all suites on every commit (engine + Wolf Cup api/web + tournament api/web). **Flaky-test policy:** any test failing twice in a row for non-code reasons gets quarantined (runs but doesn't gate merge); fix-or-delete within 2 weeks. Re-evaluate scope split if CI wall-clock > 5 min. | Dual-run catches regressions early; quarantine prevents flaky cross-app noise from blocking merges. |
| D5-4 Health endpoint | `GET /api/health` returns `{ status: 'ok', startupTime: <epoch_ms> }`. Dual-use: container healthcheck + frontend version-mismatch refresh banner. | Match Wolf Cup commit e0740a5 pattern |
| D5-5 Build + serve topology | **Two docker services** matching Wolf Cup's exact shape: (1) `tournament-api` (Node) — `node dist/index.js` on internal port 3000, internal network only; (2) `tournament-web` — **multi-stage Dockerfile**: builder stage (Node 22 alpine → pnpm build) produces `apps/tournament-web/dist/`; runtime stage (`nginx:1.27-alpine`) serves `dist/` on port 80 with an **nginx.conf matching Wolf Cup's pattern**: `/api/` reverse-proxy to `http://api:3000` (keeps Traefik out of API routing), service-worker + manifest `Cache-Control: no-store`, versioned assets (js/css/png/svg/woff/woff2) `max-age=31536000 immutable`, PDFs `max-age=3600`, SPA fallback `try_files $uri $uri/ /index.html`. Traefik sees only the web container on port 80 and routes `Host('tournament.dagle.cloud')` to it — TLS terminator, nothing more. | Wolf Cup-verified pattern (docker-compose.yml + nginx.conf). Codex pass-3 correctly flagged that Traefik FileServer is a divergence, not a simplification — nginx does substantive work (API proxy, SPA fallback, cache semantics, SW no-cache). |
| D5-6 Monitoring / alerting | None for v1. Consider Uptime Robot pre-T9 if trip criticality warrants. | Josh on-site during the trip |
| D5-7 DB backup cadence | Pre-migration file copy (D1-4) + daily cron on VPS (`cp ...tournament.db.$(date +%Y%m%d).bak`, 30-day retention on host) | Trivial; saves work |
| D5-8 Rollback strategy | Git tag each production deploy (`tournament-v0.x.0`); rollback = `git checkout <prev-tag> && ./deploy.sh`. No blue/green. | Match Wolf Cup |
| D5-9 DNS prep | Verify `dig tournament.dagle.cloud` resolves to VPS before Epic T1.4. Should resolve via existing wildcard (`*.dagle.cloud`). | Non-decision checkpoint |
| D5-10 R2 bucket | Shared Wolf Cup bucket with Event-id prefix: `r2://{bucket}/tournament/events/{eventId}/photos/...` | Lower ops overhead; per-tenant buckets are v2+ |

### PRD Adjustment (triggered by D1-1 + D3-3 + D3-2)

The following PRD edits land as part of this architecture pass:
- **T6.9** expanded from "golden file checked in" to "golden file checked in **+ integration test asserting HTTP roundtrip** — seed scores → GET `/events/:id/money` → response matches fixture." Closes NFR-C1 gate end-to-end, not just engine-level.
- **T5.10** airplane-mode drill expanded to include deliberate 409-collision scripted test (per D3-3).

### Cross-Component Dependencies

- **`activity` table** (D3-2) is consumed by: D3-4 auto-press banner, D4-3 Toast/Banner/Feed primitives, T8 all stories (engagement surfaces). Single upstream source of truth; four downstream consumers.
- **TanStack Query polling** (D3-1) drives both leaderboard refresh AND event spine delivery — single polling mechanism, multiple hook subscriptions.
- **`arctic` + `crypto.randomBytes` + Drizzle `sessions` / `magic_link_tokens`** (D2-1, D2-2, step-3 schema) share the `auth.ts` schema domain file.
- **Engine purity boundary** (D1-1): engine lives in `apps/tournament-api/src/engine/` and is called by `src/services/money.ts`; services are called by route handlers. Routes never import engine directly; engine never writes to DB directly.
- **`brand.ts`** (D4-7) is the single-tenant surface that multi-tenancy (v2+) swaps for a per-tenant resolver without code changes.

### Deferred With Explicit Tripwires

| Deferred | Tripwire | Action when tripped |
|---|---|---|
| Cache layer | Single-round leaderboard SELECT > 200ms at realistic data scale | Add `round_computations` table; invalidate on score-write |
| Monorepo split | CI wall-clock > 5 min OR tournament dev count > 1 | Split into separate repos; retain `packages/engine` as published workspace dep |
| SSE / WebSocket real-time | T9.1 live drill shows polling lag degrades UX | Swap polling hooks for SSE subscription via `hono/streaming` |
| Staging tier | Manual prod deploys block iteration cadence | Add `staging.tournament.dagle.cloud` via Traefik label |
| Off-site backup (R2) | Production data grows beyond "4-day trip history" | Add weekly rsync to R2 via cron on VPS |
| Zustand / state lib | Prop-drilling exceeds 3 levels for shared state across distant siblings | Add Zustand for the specific state slice; never all-at-once adoption |
| Formal OpenAPI docs | External consumer appears (v1.5 Guyan league integration, per-club tier, etc.) | Generate via `@hono/zod-openapi` from existing Zod schemas |

## Implementation Patterns & Consistency Rules

Conventions agents follow when writing tournament code. Most inherit Wolf Cup directly (verified in `apps/api/src/db/schema.ts`, `apps/api/src/routes/*`, `apps/web/src/components/*`); novel patterns relate to tournament-specific shapes (activity spine, services layer, engine organization, provenance headers).

Party-mode review (Winston / Amelia / Barry / Quinn 2026-04-18) + Codex external pass added the transaction rule, services-layer split, typed error hierarchy, env-access pattern, test-data factories, and Hard Boundaries vs Preferences split.

### Naming Patterns

**Database (match Wolf Cup exactly):**
- **Table names:** `snake_case plural` — `hole_scores`, `rule_set_revisions`, `sub_game_participants`
- **Column names:** `snake_case` — `client_event_id`, `course_revision_id`, `effective_hole`
- **Drizzle exports:** `camelCase` matching entity — `export const holeScores = sqliteTable('hole_scores', ...)`
- **Foreign keys:** `{referenced_table_singular}_id` — `player_id`, `round_id`, `rule_set_revision_id`
- **Timestamps:** `created_at`, `updated_at`, `expires_at` (snake_case, past participle)
- **Boolean columns:** `is_*` or plain verb — `is_active`, `consumed`, `finalized`
- **Context columns on every writable table (FD-6):** `tenant_id`, `context_id` — NOT NULL, with defaults; NOT filtered by v1 queries

**Migration file naming** (match Wolf Cup): `{NNNN}_{description}.sql` where `NNNN` is a zero-padded 4-digit ordinal (`0001_initial.sql`, `0002_add_rule_sets.sql`, etc.). Same ordinal space as Wolf Cup? No — tournament has its own migration directory, its own ordinal sequence starting at `0001`.

**API routes:**
- **Resource routes:** plural noun, kebab-case if multi-word — `/events`, `/rule-sets`, `/sub-games`
- **Route params:** `:paramName` in camelCase — `:roundId`, `:eventId`, `:playerId`, `:holeNumber`
- **Nested where natural parent exists** (D3-8) — `/rounds/:roundId/groups/:groupId/holes/:holeNumber/scores`
- **Action routes (non-CRUD):** POST with verb in path — `/rounds/:id/finalize`, `/scorer-assignments/transfer`
- **Admin-scoped:** `/admin/*` prefix
- **Query params:** camelCase — `?since=1234567890&limit=50`
- **JSON field names in bodies:** camelCase — `{ roundId, holeNumber, playerId, clientEventId }`

**Code:**
- **TypeScript files:** `kebab-case.ts` — `offline-queue.ts`, `ghin-client.ts`, `money.ts`
- **React component files:** `kebab-case.tsx` (Wolf Cup pattern, not PascalCase)
- **React component exports:** `PascalCase` — `export function Scorecard()`, `export function TournamentToast()`
- **Hooks:** `use{PascalCase}` — `useSession()`, `useInviteSession()`, `useOfflineQueue()`, `useActivityFeed()`
- **Functions / variables:** `camelCase` — `computeMoneyMatrix`, `activePlayerCount`
- **Constants:** `UPPER_SNAKE_CASE` only for true constants (env vars, numeric limits); otherwise camelCase
- **Zod schemas:** `{entity}Schema` — `scoreCommitSchema`, `ruleSetConfigSchema`
- **Types / interfaces:** `PascalCase`, no `I` prefix
- **Discriminated-union activity types:** exported from `src/engine/types/activity-events.ts`
- **Exports: named only. No `default export`** — helps IDE rename, grep, tree-shaking; matches Wolf Cup.

### Structure Patterns

**API (`apps/tournament-api/src/`):**
```
src/
  index.ts                         — Hono app + middleware wiring + /api/health endpoint (inline, match Wolf Cup)
  routes/                          — Hono route files, grouped by top-level resource
    events.ts, rounds.ts, scores.ts, gallery.ts, auth.ts, rule-sets.ts, …
    admin/                         — organizer-scoped routes
  services/                        — see Services Layer Pattern below
    money.ts                       — query service: computeMoneyMatrix, computeLeaderboard (D1-1)
    activity.ts                    — transaction helper: emitActivity(tx, event)
    sub-games.ts                   — dispatcher per sub-game type
  engine/                          — tournament-local pure functions (FD-11/12)
    formats/
      best-ball-2v2.ts, skins.ts, __fixtures__/
    rules/
      press.ts, individual-bets.ts
    types/
      activity-events.ts           — discriminated union + Zod schemas for activity payloads
  db/
    index.ts                       — Drizzle client init
    __fixtures__/                  — test-data factories: makePlayer, makeRound, makeEvent, etc.
    schema/                        — domain-grouped schema files (step-3)
      events.ts, groups.ts, rules.ts, courses.ts, players.ts, scoring.ts, subgames.ts, activity.ts, auth.ts, index.ts
    migrations/                    — drizzle-kit output; {NNNN}_{desc}.sql naming
  lib/
    env.ts                         — Zod-validated env object (see Env Var Access below)
    errors.ts                      — TournamentError class hierarchy (see Typed Error Hierarchy)
    tz.ts, audit.ts, logger.ts, csrf.ts, arctic.ts, …
  middleware/
    require-session.ts, require-organizer.ts, require-scorer-for-round.ts, error-mapper.ts
  PORTS.md                         — port inventory (architecture Step 3 Port Provenance Protocol)
```

**Web (`apps/tournament-web/src/`):**
```
src/
  main.tsx, index.html
  routes/                          — TanStack Router file-based; auto-gens routeTree.gen.ts
  components/
    ui/                            — shadcn primitives
    tournament-toast.tsx           — sonner wrapper (D4-3)
    banner.tsx, feed.tsx           — custom FD-5 surfaces
    scorecard.tsx, leaderboard.tsx, …
  hooks/
    use-session.ts, use-invite-session.ts, use-offline-queue.ts, use-activity-feed.ts
  lib/
    brand.ts                       — branding config (D4-7)
    offline-queue.ts               — ported; provenance header
    api-client.ts                  — fetch wrapper with credentials + error shape handling
    env.ts                         — Vite-side env access (import.meta.env) with Zod
  PORTS.md
```

**Tests:**
- **Unit tests:** `{source}.test.ts` co-located next to source (Wolf Cup pattern)
- **Integration tests:** `{source}.integration.test.ts` — hit HTTP, DB, real dependencies
- **Engine golden fixtures:** `src/engine/formats/__fixtures__/*.json` consumed by `*.test.ts`
- **Test data factories:** `src/db/__fixtures__/*.ts` exports `makePlayer(overrides?)`, `makeRound(overrides?)`, `makeEvent(overrides?)` — single source of test-data truth; used by both unit and integration tests
- **Manual drill scripts:** `scripts/drill-*.ts` — e.g., `scripts/drill-offline-409.ts` for D3-3 collision test

### Services Layer Pattern *(Codex pass-4 clarification)*

Two distinct service patterns, explicitly named to prevent the "services never write" / "activity.ts writes" contradiction:

**Query services** — read + compute, never write. Examples: `money.ts`, `leaderboard.ts`, `sub-games.ts` (dispatch + read). Called by route handlers to compute responses. Signature example:

```typescript
// services/money.ts
export async function computeMoneyMatrix(
  eventId: string
): Promise<MoneyMatrix> { /* read from DB, call engine, return */ }
```

**Transaction helpers** — may write, but only when handed a transaction context (`tx`) from a route handler. Transaction ownership stays with the handler. Examples: `activity.ts`, `audit.ts`. Signature example:

```typescript
// services/activity.ts
export async function emitActivity(
  tx: TransactionContext,
  event: ActivityEvent  // Zod-validated discriminated union
): Promise<void> { /* insert into activity table via tx */ }
```

Route handlers open the transaction, call query services for reads, call transaction helpers for writes, commit at end:

```typescript
app.post('/rounds/:roundId/holes/:holeNumber/scores', async (c) => {
  await db.transaction(async (tx) => {
    // 1. validate + write score
    await tx.insert(holeScores).values(...)
    // 2. compute derived events via engine
    const events = deriveActivityEvents(scoreInput, rules)
    // 3. emit via transaction helper (all in same tx)
    for (const event of events) {
      await emitActivity(tx, event)
    }
    // 4. audit log via transaction helper
    await writeAudit(tx, { actor, action: 'score.committed', ... })
  })
})
```

**Rule:** query services never import `db` for writes; transaction helpers take `tx` as first parameter, never open their own transaction.

### Format Patterns

**API response shapes:**
- **Success:** direct data, no wrapper — `GET /events/:id` returns `{ id, name, rounds: [...] }`
- **Error:** `{ error: string, code?: string, requestId: string, fields?: Record<string, string[]> }` (D3-6)
- **Status codes:** 200 / 201 / 204 / 400 (validation) / 401 (unauthenticated) / 403 (forbidden) / 404 / 409 (conflict) / 422 (business-rule rejection) / 500

**Dates + times:**
- **In DB:** SQLite INTEGER epoch ms for instants (`created_at`, `expires_at`), ISO date strings for calendar dates (`event_date`)
- **In JSON:** ISO 8601 strings always (`"2026-05-07T08:30:00-04:00"`)
- **Timezones:** every Event has declared `timezone` (IANA); all date math uses it (FR-E7)

**JSON conventions:**
- **Field names:** camelCase on the wire (Drizzle infers TS types as camelCase from snake_case DB columns automatically)
- **Booleans:** `true` / `false`
- **Null handling:** explicit `null` for nullable fields, not undefined
- **Empty collections:** `[]` / `{}`, not null

### Communication Patterns

**Activity event types (D3-2):**
- **Event type names:** `dot.separated.lowercase` — `score.committed`, `press.fired`, `bet.flipped`, `lead.changed`, `award.triggered`, `rule_set.edited`
- **Payload typing:** TypeScript discriminated union on `type` in `src/engine/types/activity-events.ts`; **Zod validates BEFORE insert** (D3-2 Codex tightening); defensive parse on read
- **Emission rule:** only through `services/activity.ts` `emitActivity(tx, event)` — **never** insert into `activity` table from anywhere else

**Client mutations:**
- **Idempotency:** every offline-queueable mutation request body includes `clientEventId: string` (UUIDv4 client-generated before queueing); server dedups via `onConflictDoUpdate` keyed on `(roundId, playerId, holeNumber, clientEventId)` or equivalent
- **Validation:** Zod on server; invalid → 400 with `code: 'invalid_input'` + `fields` map

**Logging:**
- **Format:** structured JSON lines to stdout + append-only file `/app/logs/tournament-{YYYY-MM-DD}.log`
- **Required fields per entry:** `ts` (ISO), `level` (debug/info/warn/error), `requestId`, `msg`; plus context when applicable (`eventId`, `roundId`, `userId`, `holeNumber`)
- **Error logs:** include `stack`, `cause` (if Error.cause used); no PII beyond what's in DB

**Audit log format (FR-B8, FD-13, FR-B7):**
- **Table:** `audit_log(id, actor_user_id, entity_type, entity_id, action, prior_value_json, new_value_json, request_id, created_at)`
- **Rule:** every money / identity / rule / score-correction mutation writes one audit row in the **same transaction** as the mutation; `services/audit.ts` provides `writeAudit(tx, entry)`
- **`prior_value_json` / `new_value_json`:** Zod-typed per entity-type; PII redacted per visibility mode for `self_only` Groups

### Process Patterns

**Transaction boundary rule** *(Codex pass-4)*: **any mutating route handler** (POST, PUT, PATCH, DELETE) runs its work inside `db.transaction(async (tx) => { ... })`. No judgment call on "single write vs multi-write" — the consistency rule is: every mutation route is a transaction. Activity emissions, audit writes, and the primary mutation all participate in the same transaction.

**Typed error hierarchy** (`src/lib/errors.ts`):

```typescript
export class TournamentError extends Error {
  constructor(public code: string, message: string, public cause?: unknown) { super(message) }
}
export class ValidationError extends TournamentError { /* → 400 */ }
export class UnauthenticatedError extends TournamentError { /* → 401 */ }
export class ForbiddenError extends TournamentError { /* → 403 */ }
export class NotFoundError extends TournamentError { /* → 404 */ }
export class ConflictError extends TournamentError { /* → 409 */ }
export class BusinessRuleError extends TournamentError { /* → 422 */ }
```

Services and handlers **throw** typed errors; centralized `errorMapper` middleware translates to `{ error, code, requestId, fields? }` + correct status. No manual `c.json({error: ...}, 400)` in route handlers.

**Environment variable access:** centralized in `src/lib/env.ts`:

```typescript
import { z } from 'zod'
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  DB_PATH: z.string(),
  PORT: z.coerce.number().default(3000),
  ADMIN_SESSION_SECRET: z.string().min(32),
  GOOGLE_OAUTH_CLIENT_ID: z.string(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string(),
  RESEND_API_KEY: z.string(),
  GHIN_USERNAME: z.string().optional(),
  GHIN_PASSWORD: z.string().optional(),
  R2_ACCOUNT_ID: z.string(),
  // ...
})
export const env = envSchema.parse(process.env)  // fails startup if invalid
```

Never `process.env.X` scattered across files. Rule: import `{ env }` from `lib/env.ts`.

**Authentication flow** (matches FD-4 three-tier):
1. Invite-token reads: cookie `invite_token=` or URL param; read-only; no SSO
2. SSO flow: `/auth/sign-in?next={url}` → Google OAuth via arctic → `/auth/callback` → session cookie set → redirect to `next`
3. Session enforcement: `requireSession` middleware on mutating routes; `requireOrganizer` on `/admin/*`; `requireScorerForRound` at route handler level for score mutations (D2-3)

**Offline + sync:**
- Queue: IndexedDB via `idb` (ported from Wolf Cup with provenance header)
- Drain order: insertion order; server idempotency via `clientEventId`
- Conflict: 409 response `{ error: 'conflict', code: 'hole_already_scored', conflictingEntry: {...} }`; UI overwrite prompt at drain time (D3-3)
- Sync indicator: visible whenever queue depth > 0

**Error handling (client):**
- TanStack Query `onError` logs + UI surface (toast for transient, banner for persistent)
- Form validation: client-side Zod mirroring server; display field-level errors from 400 `fields` map
- Auth errors: 401 → redirect to `/auth/sign-in?next={url}`; 403 → "you can't do that" message with requestId

**Loading states:**
- Server data: `useQuery` `isPending` / `isFetching`; no redundant client state
- Mutations: `useMutation` `isPending` disables submit + shows spinner
- Initial route load: suspense boundary; fallback is shadcn `<Skeleton>` matching eventual layout

### Enforcement

**Enforced by ESLint flat-config + TypeScript strict + CI dual-run + manual review against this section.**

**Audit-row integration test template** (copy-paste for every money/identity/rule mutation route):

```typescript
import { describe, expect, test } from 'vitest'
import { testApp, testDb, makeUser, makeRound } from './test-helpers'

describe('POST /rounds/:id/holes/:n/scores — audit log', () => {
  test('writes audit row in same transaction as score mutation', async () => {
    const user = await makeUser({ role: 'scorer' })
    const round = await makeRound({ scorerId: user.id })
    const res = await testApp.request(
      `/rounds/${round.id}/holes/7/scores`,
      { method: 'POST', headers: authHeaders(user), body: JSON.stringify({ ... }) }
    )
    expect(res.status).toBe(200)
    const audit = await testDb.query.auditLog.findMany({
      where: (a, { eq }) => eq(a.entityId, String(round.id)),
    })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: 'score.committed',
      actorUserId: user.id,
      entityType: 'hole_score',
    })
    expect(audit[0].priorValueJson).toBeDefined()
    expect(audit[0].newValueJson).toBeDefined()
  })
})
```

Every PR adding a new money/identity/rule mutation route must include at least one test of this shape.

### Hard Boundaries (must follow; no automated check)

1. **Ported modules carry provenance headers + PORTS.md entries.** No copy-paste from Wolf Cup without the header and inventory update (architecture Step 3 Port Provenance Protocol).
2. **Activity table writes go through `services/activity.ts` `emitActivity(tx, event)` only.** No direct `tx.insert(activity)` from routes, other services, or engine code.
3. **`packages/engine` imports from tournament are limited to `stableford.ts`** (FD-11/12 post-Codex). New shared-engine exports require explicit Wolf Cup owner approval (Josh) + a passing Wolf Cup test suite.

### Preferences (positive framing of style choices)

- **Prefer named exports over default exports** — better IDE rename, grep, tree-shaking; matches Wolf Cup.
- **Prefer kebab-case filenames over PascalCase** even for React components (Wolf Cup pattern).
- **Prefer centralized `services/` over inline engine calls in routes** — every route handler that needs money or leaderboard data calls `services/money.ts`, not the engine directly.
- **Prefer throwing typed errors over returning result objects** — `throw new ValidationError(...)` beats `return { ok: false, error: ... }`; error-mapper middleware handles the HTTP translation once.
- **Prefer `{ env }` from `lib/env.ts` over `process.env.X` scattered** — single Zod-validated source of truth.
- **Prefer transaction-wrap-everything over case-by-case transaction decisions** — any mutation route is a transaction; no judgment calls.
- **Prefer `src/db/__fixtures__/makePlayer()` factories over inline `{ name: 'Test' }` objects in tests** — single shape; evolves once.
- **Prefer camelCase JSON on the wire over snake_case** even though DB is snake_case — Drizzle handles the mapping.
- **Prefer integration tests with real DB over mocked DB** — Wolf Cup's proven pattern; tournament inherits.
- **Prefer in-app toast / banner / feed surfaces over modal dialogs** for ambient events (FD-5 pull-not-push).

## Project Structure & Boundaries

Party-mode review (Winston / Amelia / Barry / Quinn 2026-04-18) grounded the tree against Wolf Cup's verified structure: scripts live at `src/scripts/`, no dedicated `test-helpers/` directory at current scale, sub-routes mostly flatten, middleware-per-file only for substantive reused checks. Tree scaffolds the skeleton — individual route / component / hook files are story-level decisions, not architecture-level.

### Monorepo-Level Tree *(tournament additions shown; Wolf Cup and engine untouched)*

```
D:/wolf-cup/                         ← existing pnpm monorepo root; DO NOT rename (FD-1)
├── package.json                     ← root workspace config
├── pnpm-workspace.yaml              ← "apps/*" + "packages/*" already covers tournament
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.js                 ← root flat-config; apps inherit
├── .env.production                  ← VPS only; read by both apps via --env-file
├── .env.example                     ← checked in; includes tournament-specific vars
├── docker-compose.yml               ← EXISTING; add tournament-api + tournament-web services
├── deploy.sh                        ← EXISTING; extend to deploy tournament alongside Wolf Cup
├── .github/workflows/ci.yml         ← EXISTING; add tournament jobs
├── reference/
│   └── pinehurst-may-2026-courses.json    ← EXISTING seed for T2
├── _bmad-output/planning-artifacts/tournament/
│   ├── prd.md, architecture.md, product-brief.md
│   ├── epics-phase1.md              ← produced by create-epics-and-stories post-arch
│   └── stories/                     ← produced by create-story per story
├── apps/
│   ├── api/                         ← Wolf Cup — DO NOT EDIT (FD-1/FD-2)
│   ├── web/                         ← Wolf Cup — DO NOT EDIT
│   ├── tournament-api/              ← NEW (Epic T1 scaffold; detailed tree below)
│   └── tournament-web/              ← NEW (Epic T1 scaffold; detailed tree below)
└── packages/
    └── engine/
        └── src/stableford.ts        ← ONLY surface shared with tournament (FD-11/12)
```

### apps/tournament-api/ Skeleton Tree *(scaffolded at T1; individual route/service files added per story)*

```
apps/tournament-api/
├── package.json                     ← @tournament/api; versions match Wolf Cup; no bcrypt (FD-4)
├── tsconfig.json, tsconfig.build.json
├── drizzle.config.ts                ← schema: './src/db/schema/*'
├── vitest.config.ts                 ← Vitest 3.x
├── eslint.config.js
├── Dockerfile                       ← multi-stage: build Node → runtime node:22-alpine
├── PORTS.md                         ← port inventory per Port Provenance Protocol
└── src/
    ├── index.ts                     ← Hono app + middleware wiring + /api/health inline.
    │                                   Small middleware (request-id, csrf) inline here by default;
    │                                   extract to src/middleware/ only when >30 LOC or reused.
    ├── routes/                      ← per-resource files added as stories land
    │   ├── admin/                   ← organizer-scoped routes, per-story
    │   └── *.integration.test.ts    ← integration tests co-located with routes
    ├── services/                    ← query services (read+compute) + transaction helpers (write w/ tx)
    │   ├── money.ts                 ← query service — computeMoneyMatrix, computeLeaderboard (D1-1)
    │   ├── activity.ts              ← transaction helper — emitActivity(tx, event) (D3-2)
    │   ├── audit.ts                 ← transaction helper — writeAudit(tx, entry) (FR-B8)
    │   └── sub-games.ts             ← dispatcher conforming to SubGameFormat interface
    ├── engine/                      ← tournament-local pure functions (FD-11/12)
    │   ├── formats/
    │   │   └── __fixtures__/        ← golden-file scorecards per format
    │   ├── rules/
    │   ├── pairings/                ← T4 suggest engine (target-miss tolerable)
    │   └── types/
    │       ├── activity-events.ts   ← discriminated union + Zod for activity payloads (D3-2)
    │       └── sub-game-format.ts   ← SubGameFormat interface contract (see Integration Boundaries)
    ├── db/
    │   ├── index.ts                 ← Drizzle client init from env.DB_PATH
    │   ├── schema/                  ← domain-grouped (step-3 Schema File Organization)
    │   │   ├── index.ts             ← re-exports
    │   │   ├── _columns.ts          ← shared helper producing tenant_id + context_id NOT NULL (FD-6)
    │   │   ├── events.ts, groups.ts, rules.ts, courses.ts, players.ts,
    │   │   ├── scoring.ts, subgames.ts, activity.ts, auth.ts, audit.ts
    │   ├── migrations/              ← drizzle-kit output; 0001_*.sql, 0002_*.sql, … matching Wolf Cup convention
    │   └── __fixtures__/
    │       ├── make-player.ts, make-event.ts, make-round.ts, make-group.ts, make-rule-set.ts    ← atom factories
    │       └── scenarios.ts         ← complex named scenarios (pinehurstMidTripScenario, plusHandicapScenario, etc.)
    ├── lib/
    │   ├── env.ts                   ← Zod-validated env object (step-5 env access)
    │   ├── errors.ts                ← TournamentError class hierarchy (step-5)
    │   ├── logger.ts, tz.ts
    │   ├── arctic.ts                ← Google OAuth wiring (D2-1)
    │   ├── magic-link.ts            ← token gen + Resend (D2-2)
    │   ├── ghin-client.ts           ← PORTED (provenance header)
    │   ├── r2-client.ts             ← PORTED pattern
    │   └── course-parser.ts         ← Anthropic Vision wrapper (T2.3)
    ├── middleware/                  ← substantive + reused checks only
    │   ├── require-session.ts       ← coarse auth gate (D2-3)
    │   ├── require-organizer.ts     ← /admin/* gate
    │   └── require-scorer-for-round.ts  ← per-route fine-grained
    │                                      (error-mapper may extract here if typed-error translation grows non-trivial; until then inline in index.ts)
    └── src/scripts/                 ← match Wolf Cup: src/scripts/ not apps/*/scripts/
        ├── seed-live.ts             ← pnpm seed (production Pinehurst data)
        ├── seed-demo.ts             ← pnpm seed:demo (deterministic 8-player E2E seed)
        ├── clear-demo.ts
        └── drill-scorer-install.ts  ← MANUAL checklist-driven script with console output; NOT run in CI; requires real device (T9.4)
```

**Note:** `drill-offline-409` is NOT a script — it's an integration test at `src/routes/scores.integration.test.ts` that exercises the 409-collision case automatically in CI. Scripts are for manual-only drills; tests are for automated verification.

### apps/tournament-web/ Skeleton Tree *(scaffolded at T1; individual route/component/hook files added per story)*

```
apps/tournament-web/
├── package.json                     ← @tournament/web; versions match Wolf Cup
├── tsconfig.json, tsconfig.app.json, tsconfig.node.json
├── vite.config.ts                   ← tournament PWA manifest; proxy /api/* to tournament-api in dev
├── postcss.config.js, tailwind.config.ts
├── eslint.config.js
├── index.html
├── Dockerfile                       ← multi-stage: Node build → nginx:1.27-alpine runtime
├── nginx.conf                       ← matches Wolf Cup shape: /api proxy, SPA fallback, SW no-cache, immutable assets (D5-5)
├── PORTS.md
├── scripts/
│   └── generate-icons.mjs           ← build-tool-only (match apps/web/scripts/)
└── src/
    ├── main.tsx                     ← TanStack Router + Query providers
    ├── routeTree.gen.ts             ← auto-generated; DO NOT edit
    ├── routes/                      ← TanStack Router file-based; Wolf Cup uses dot-notation for segments
    │   ├── __root.tsx               ← root layout; branding, version-check banner, toast+banner portals
    │   ├── index.tsx                ← landing
    │   ├── invite.$token.tsx        ← first-arrival roster confirmation (T3.6; no SSO)
    │   ├── auth/
    │   │   ├── sign-in.tsx          ← magic-link / Google SSO entry
    │   │   └── callback.tsx         ← OAuth callback
    │   ├── events.$eventId.tsx      ← event home (anchor route for event-scoped features)
    │   ├── events.$eventId.leaderboard.tsx  ← cross-group leaderboard (trip-critical)
    │   ├── rounds.$roundId.score-entry.tsx  ← scorer UI (THE critical path; T5.2)
    │   └── [additional routes added per T3/T4/T5/T6/T7 stories; tab-style surfaces like money/settle-up/bets may collapse into a single route with client-side tabs rather than separate routes]
    ├── components/                  ← shadcn primitives under ui/ + app components flat; individual files added per story
    │   └── ui/                      ← shadcn (button.tsx, card.tsx, etc.)
    ├── hooks/                       ← load-bearing hooks named; rest are story-level
    │   ├── use-session.ts           ← SSO session (D4-5)
    │   ├── use-invite-session.ts    ← invite-token read session
    │   ├── use-offline-queue.ts     ← PORTED (T5.3)
    │   └── use-activity-feed.ts     ← polling via TanStack Query (D3-1); visibilitychange-aware
    ├── lib/
    │   ├── brand.ts                 ← branding config (D4-7)
    │   ├── env.ts                   ← import.meta.env via Zod
    │   ├── api-client.ts            ← fetch wrapper: credentials, error-shape, requestId
    │   ├── offline-queue.ts         ← PORTED core module; provenance header required
    │   └── activity-types.ts        ← discriminated-union client types (mirrors api/engine/types)
    └── [test helpers emerge only when same helper is used across 3+ test files — rule-of-three for tests]
```

### Architectural Boundaries

**Tournament ↔ Wolf Cup (non-negotiable):**
- Tournament MUST NOT import from `apps/api/src/*` or `apps/web/src/*`.
- Tournament MAY import `packages/engine/src/stableford.ts` only.
- Wolf Cup code is ported by copy-with-provenance; never by TypeScript import.
- Wolf Cup is never run against by tournament's test suite.

**Route ↔ Service:**
- Routes own HTTP concerns (parse, Zod-validate, status via error-mapper, response shaping).
- Query services (`services/money.ts`, `services/leaderboard.ts`) called for reads; never write.
- Transaction helpers (`services/activity.ts`, `services/audit.ts`) called for writes, with `tx` from handler; never open their own transactions.
- Route handlers always wrap mutations in `db.transaction(...)`.

**Service ↔ Engine:**
- Engine pure: no DB access, no I/O, no `env` imports. Called by services with already-loaded data.
- Services load data, call engine, return computed results.
- Engine tests use golden fixtures, never DB state.
- **Services-never-write tightening (Codex pass-4):** `services/money.ts` may perform reads inside the handler's transaction for read-write consistency; it does not issue any `insert` / `update` / `delete`. Writes in the transaction happen via route-handler code + transaction helpers (`services/activity.ts`, `services/audit.ts`).

**Sub-game dispatcher contract** (for v1.5+ extensibility — FD-10/FD-11):

```typescript
// src/engine/types/sub-game-format.ts
export interface SubGameFormat<TConfig = unknown, TResult = unknown> {
  type: string  // 'skins' | 'ctp' | 'sandies' | 'putting-contest' | ...
  configSchema: z.ZodType<TConfig>
  resultSchema: z.ZodType<TResult>
  compute(input: {
    config: TConfig
    holeScores: HoleScore[]
    participants: Player[]
  }): TResult
}
```

Each format module (`engine/formats/skins.ts`, future `ctp.ts`, `sandies.ts`) exports a `SubGameFormat` implementation. `services/sub-games.ts` is a dispatcher that registers formats and routes `compute()` calls by `type`. v1.5+ adds new formats without dispatcher-service rewrites.

**Data access:**
- Only `services/*` and route handlers touch the DB via Drizzle.
- Engine never imports `db`.
- `lib/*` never imports `db`.
- Migrations (`db/migrations/*.sql`) are the only source of DDL.

**Frontend ↔ Backend:**
- Web communicates with api via `lib/api-client.ts` only — no direct `fetch()` elsewhere.
- All requests include `credentials: 'include'` for session cookie.
- 401 responses → redirect to `/auth/sign-in?next={currentUrl}` from api-client.
- 409 responses → conflict-resolution UI (D3-3 overwrite prompt) via api-client error handler.

**Activity spine:**
- Writers: `services/activity.ts` `emitActivity(tx, event)` ONLY.
- Readers: `GET /activity?eventId=&since=<ts>`; consumed by `useActivityFeed` via TanStack Query polling (D3-1).
- Payload schemas in `src/engine/types/activity-events.ts`; Zod-validated on write.

**Browser install:**
- Scorer routes require `display-mode: standalone` (PWA install) — checked at route `beforeLoad`.
- Read routes work in browser tab without install.

### Requirements → Structure Mapping *(code-producing stories only)*

**Epic T1 — Foundation** (scaffolds above)
- T1.1 CLAUDE.md disambig → root `CLAUDE.md`
- T1.2 API scaffold → `apps/tournament-api/` skeleton
- T1.3 Web scaffold → `apps/tournament-web/` skeleton
- T1.4 Docker + Traefik → `docker-compose.yml` + `apps/tournament-web/nginx.conf`
- T1.5 CI → `.github/workflows/ci.yml`
- T1.6 Auth realm → `src/routes/auth.ts` + `lib/arctic.ts` + `lib/magic-link.ts` + `db/schema/auth.ts`
- T1.7 Log sink → `src/lib/logger.ts`

**Epic T2 — Courses**: `db/schema/courses.ts`, `src/routes/courses.ts`, `src/services/courses.ts`, `src/lib/course-parser.ts`, `src/engine/validators/course.ts`

**Epic T3 — Events/Groups/Rules/Invites/Permissions**: `db/schema/events.ts`/`groups.ts`/`rules.ts`/`players.ts`, `src/routes/events.ts`/`groups.ts`/`rule-sets.ts`/`invites.ts`/`players.ts`, `src/lib/ghin-client.ts` (ported), `src/middleware/require-*.ts`, T3.10 profile/GHIN-enrichment route (location per story — profile page is story-level, not architecture-level)

**Epic T4 — Pairings**: `src/engine/pairings/suggest.ts`, `src/routes/pairings.ts`, `src/lib/pdf-gen.ts`

**Epic T5 — Scoring/Offline/Leaderboard**: `db/schema/scoring.ts` + `audit.ts`, `src/routes/scores.ts` + `src/routes/scores.integration.test.ts` (includes 409-collision case), `apps/tournament-web/src/lib/offline-queue.ts` (ported), `src/routes/admin/score-corrections.ts` (ported), `src/routes/admin/scorer-assignments.ts`, `src/routes/admin/rule-edits.ts` (T5.11), `src/services/money.ts`, `src/services/activity.ts`, `src/services/audit.ts`

**Epic T6 — Rules Engine/Money/Bets/Settle-up** (tournament-local engine per FD-11/12): `src/engine/formats/best-ball-2v2.ts` + `skins.ts`, `src/engine/rules/press.ts` + `individual-bets.ts`, `src/routes/money.ts` + `money.integration.test.ts` (T6.9 HTTP roundtrip test), `src/routes/settle-up.ts` + `bets.ts` + `sub-games.ts`, `src/services/sub-games.ts` (dispatcher)

**Epic T7 — Player UX**: `apps/tournament-web/src/routes/events.$eventId.tsx` + leaderboard/schedule/gallery tabs (routes vs tabs decided per story), `src/routes/gallery.ts` (api, ported), `src/routes/admin/export.ts` (T7.5), `apps/tournament-web/src/components/install-prompt.tsx` (T7.6)

**Epic T8 — Engagement Surfaces**: `src/services/activity.ts` + `src/engine/types/activity-events.ts` + `db/schema/activity.ts`; `apps/tournament-web/src/components/tournament-toast.tsx` + `banner.tsx` + `feed.tsx`; `src/hooks/use-activity-feed.ts`

**Epic T9 — Pre-Event Validation**: T9.4 `src/scripts/drill-scorer-install.ts` (manual device-by-device checklist script); other T9 stories produce checklist artifacts, not code.

**Cross-cutting concerns:**
- **Auth** → `src/routes/auth.ts` + `src/lib/arctic.ts` + `src/lib/magic-link.ts` + `src/middleware/require-session.ts` + `src/db/schema/auth.ts`
- **Permissions matrix (FR-H1-H7)** → `src/middleware/require-*.ts` + `src/services/permissions.ts` (if permissions logic grows)
- **Audit logging** → `src/services/audit.ts` + `src/db/schema/audit.ts` (every mutation calls it via the transaction helper pattern)
- **Activity spine (FD-5, T8)** → `src/services/activity.ts` + `src/db/schema/activity.ts` + `src/engine/types/activity-events.ts`
- **Money visibility (FR-D9)** → `src/services/money.ts` filter logic + `src/db/schema/groups.ts` `money_visibility` column
- **Timezone (FR-E7)** → `src/lib/tz.ts` + `src/db/schema/events.ts` `timezone` column
- **Request ID + structured logging (NFR-O1)** → request-id inline in `src/index.ts` + `src/lib/logger.ts`
- **Ecosystem columns (FD-6)** → `src/db/schema/_columns.ts` shared drizzle helper producing `tenant_id` + `context_id` NOT NULL per domain table

### Integration Points

**Internal communication:**
- Route → Service (query): `await computeMoneyMatrix(eventId)` — pure read path
- Route → Service (transaction helper): inside `db.transaction(async (tx) => { await emitActivity(tx, {...}); await writeAudit(tx, {...}) })`
- Service → Engine: services import engine functions; engine never imports service
- Frontend → Backend: all fetches through `lib/api-client.ts`
- Activity spine: `services/activity.ts` writes → `/activity` endpoint serves → `useActivityFeed` polls → Toast/Banner/Feed components render

**External integrations (all proxied through `lib/*`):**
- GHIN (`lib/ghin-client.ts`) — ported; invoked at profile-GHIN-link time (T3.10); not in critical path
- Google OAuth (`lib/arctic.ts`) — state/PKCE cookies SameSite=Lax 10-min TTL; post-auth session cookie SameSite=Strict
- Resend (`lib/magic-link.ts`) — email send on magic-link request
- Anthropic Vision (`lib/course-parser.ts`) — PDF upload during T2.3
- Cloudflare R2 (`lib/r2-client.ts`) — shared bucket with `tournament/events/{eventId}/` prefix (D5-10)

**Data flow: scorer submits a hole score (canonical path):**
```
User enters score → useOfflineQueue enqueues { roundId, holeNumber, playerId, clientEventId, value }
  → api-client POST /rounds/:roundId/holes/:n/scores
  → require-session middleware validates cookie
  → require-scorer-for-round middleware validates session.userId === scorer_assignments[round][group]
  → route handler opens db.transaction(tx)
    → tx.insert(holeScores) with onConflictDoUpdate on (roundId, playerId, holeNumber, clientEventId)
    → services/money.ts reads updated state within tx for read-write consistency (no writes)
    → engine/rules/press.ts evaluates triggers against new state (pure)
    → services/activity.ts emitActivity(tx, 'score.committed') [+ 'press.fired' if triggered]
    → services/audit.ts writeAudit(tx, { action: 'score.committed', actor, prior, new })
  → tx commits atomically
  → 200 response { status: 'ok', clientEventId, requestId }
  → web: TanStack Query invalidates leaderboard; feed/banner pick up activity on next poll (≤5s)
```

### Test Organization

**Unit tests:** `{source}.test.ts` co-located; run against `:memory:` libsql for speed and isolation.

**Integration tests:** `{source}.integration.test.ts` co-located; run against a file-backed libsql DB in a temp directory (one DB per test file, torn down in `afterAll`); match Wolf Cup's `practice-round.integration.test.ts` pattern. **Run in CI.** Automated 409-collision test lives here (`src/routes/scores.integration.test.ts`), not as a drill script.

**Manual drills:** `src/scripts/drill-*.ts` — checklist-driven console output; not run in CI; require human + real device. v1 drill scripts: `drill-scorer-install.ts` (T9.4 per-device PWA install verification).

**Engine fixtures:** `src/engine/formats/__fixtures__/*.json` — golden files consumed by `*.test.ts`.

**Test data factories:** `src/db/__fixtures__/make-*.ts` — atom-level `makePlayer()`, `makeRound()`, etc. Plus `src/db/__fixtures__/scenarios.ts` — complex named scenarios (`pinehurstMidTripScenario()`, `plusHandicapScenario()` for Noah-Mullens-style +5 HI edge cases, `expiredSessionScenario()`, etc.).

**Audit-row integration test pattern:** every money/identity/rule mutation route ships with a co-located integration test asserting the audit row exists (template in "Implementation Patterns" section above).

**Test-helper extraction:** rule-of-three — extract a helper to a shared location only when the same helper is used across 3+ test files. Default: inline helpers next to their tests.

### Development Workflow

**Local dev:**
- `pnpm install` at monorepo root (one-time)
- Terminal 1: `pnpm -F @tournament/api dev` — API on :3000
- Terminal 2: `pnpm -F @tournament/web dev` — Vite on :5173 with proxy to :3000/api
- Tests: `pnpm -F @tournament/api test` or root `pnpm test` (runs all)

**Build:**
- `pnpm -r build` produces `dist/` per workspace

**Deploy:**
- `DEPLOY_USER=root ./deploy.sh` from Git Bash (same script, same VPS)
- Rsync + docker-compose up --build; both Wolf Cup and tournament
- Pre-first-deploy: verify `dig tournament.dagle.cloud` (D5-9 checkpoint)
- Migrations auto-run on API container start; pre-migration backup via deploy hook (D5-7)

## Architecture Validation Results

Party-mode review (2026-04-18) surfaced substantive gaps; this section records the final state after cherry-pick + tweaks.

### Coherence Validation ✅

All 15 Foundation Decisions (FD-1..FD-15) traced to downstream implementation paths across steps 3–6. No contradictions remain after Codex pass-3 + pass-4 tightening:

| FD | Coherence verdict |
|---|---|
| FD-1 No rename | Wolf Cup paths untouched; tournament scaffolds under `apps/tournament-*` |
| FD-2 Copy not extract | Port Provenance Protocol (step-3) + PORTS.md per app + bug-fix-mirroring discipline |
| FD-3 Hole-level soft-lock | D3-3 server 409 + UI overwrite; integration test at `scores.integration.test.ts` |
| FD-4 SSO + GHIN optional | Fully revised post-Codex pass-3: `player_id + google_sub` = anchor; GHIN enrichment via T3.10 |
| FD-5 No push ever | D3-1 polling + D3-2 activity + D3-4 in-app banner; step-5 preferences reinforce |
| FD-6 Ecosystem columns | `db/schema/_columns.ts` helper; v1 doesn't filter — see gap resolution below for write-semantics |
| FD-7 Round atomic stats unit | `rounds.event_id` stays nullable — see gap resolution below |
| FD-8 Rule-set revisioning | `rule_set_revisions` schema; T3.5 editor; T5.11 mid-event edit with effective-hole boundary |
| FD-9 Filter cube | Deferred to v1.5+ UI; schema supports it |
| FD-10 Sub-games first-class | `SubGameFormat` interface contract (step-6); dispatcher extensible |
| FD-11 Skins v1 | Tournament-local engine per Codex pass-2; T6.11 with golden fixtures |
| FD-12 v1 bets + carry-greenies | Tournament-local; T6.12 golden-file tested |
| FD-13 Four guardrails | Mid-event edit (T5.11), GHIN superseded by FR-E11, handoff (T5.7), role collapse |
| FD-14 PWA-primary | Install prompt T7.6, browser-tab graceful T7.7, pre-trip verification T9.4 |
| FD-15 BMAD arch workflow | This document |

### Requirements Coverage ✅

- **57 functional requirements** across 8 categories — every FR traces to at least one story in Epics T1-T9 or a cross-cutting mechanism
- **17 non-functional requirements** — all have implementation paths; correctness NFRs (C1-C3) gated by golden fixtures + HTTP roundtrip tests + CI dual-run
- **65 stories** (6 port, 1 extract, 58 new) — all mapped to directory/file locations per step-6
- **FR-E10 retired** (GHIN-bailout moot post-FD-4 revision); **FR-E11 added** (optional GHIN enrichment profile action)
- **Pattern consistency:** step-5 services-never-write tightening reconciled via query-services vs transaction-helpers distinction

### Test Pyramid Estimate (v1 budget, Quinn pass)

Rough order-of-magnitude for CI time budgeting + under/over-investment signaling:
- **~400 unit tests** — engine modules (2v2, skins, press, individual-bets, carry-greenies) + services (money, sub-games) + validators (course, rule-set) + lib (tz, env, errors) + component render tests
- **~80 integration tests** — per-route audit-row assertions + happy-path flow tests + the 409 collision test + mid-event rule-edit recompute test + SSO-outage behavior
- **~5 manual drill scripts** — scorer install verification per-device (T9.4), other T9 checklist artifacts

Combined with Wolf Cup's existing 865, CI baseline post-T1 sits around 1,350 tests. Watch the 5-minute tripwire against this.

### Gap Resolution *(sequenced by story-blocking boundary)*

**Schema-design gates (resolve before T3.1 DB schema story lands):**

1. **FD-7 forward compatibility.** `rounds.event_id` stays nullable in schema. v1 always writes non-null (rounds are event-scoped); schema permits NULL so a v1.5+ standalone round at Guyan is a valid shape without migration. Explicit in `db/schema/scoring.ts` column definition + comment.

2. **`context_id` write semantics.**
   - `tenant_id TEXT NOT NULL DEFAULT 'guyan'` — DB-level default OK (single-tenant v1).
   - `context_id TEXT NOT NULL` **no DB-level default** — forces explicit stamping on INSERT from the owning scope. Application code rule: when inserting an Event row, compute `context_id = 'event:' + eventId` where `eventId` is the **opaque row ID** (app-generated UUID or similar), **never** a name-derived slug like `event:pinehurst-may-2026` (rename-fragile). Child rows (rounds, scores, sub-games, etc.) inherit `context_id` from the parent Event at insert time.
   - **`context_id` is write-once in v1** — no UPDATE path. If the context a row belongs to needs to change, that's a data-migration operation with explicit amend-all-child-tables handling; not a normal mutation. v2+ concern.
   - Test-fixture rows use `'test:fixture'` — explicit marker, never `'default'`.

**T1 story-level details (resolve during T1.5 / T1.6 planning):**

3. **SSO-provider-outage behavior** *(medium-confidence driver — could cause trip-day failure).* When both Google OAuth AND Resend magic-link are unreachable simultaneously, mutation routes return `503 { error: 'auth_unavailable', requestId }`. Invite-link reads remain fully functional. Frontend surfaces a banner "can't authenticate right now — try again in a minute." Covered in T1.6 auth-realm story.

4. **CSRF middleware pinned.** Tournament uses `hono/csrf` (built-in to Hono 4.x). Named here to prevent T1.6 re-litigation.

5. **CI secrets — stubbed OAuth + email, not real credentials.** Integration tests mock Arctic's state/exchange round-trip (tests exercise callback handler without hitting Google) and replace Resend's SDK with a fake that asserts correct `to` + `subject` fields. **Zero production credentials in CI.** Simpler + faster + no revocation risk. Named in T1.5 CI setup.

**Pre-T9 drill:**

6. **Deployment rollback drill** *(medium-confidence driver).* Before T9.2 final pre-event walkthrough, tag a post-T1 commit, intentionally redeploy the prior tag via `./deploy.sh`, verify functional rollback. One-afternoon exercise; confirms D5-8 rollback strategy works in practice, not just on paper.

**Enforcement automation (add during T1 scaffold):**

7. **ESLint rule enforcing engine-boundary** (Hard Boundary #3 from step-5 patterns). Put in both `apps/tournament-api/eslint.config.js` AND `apps/tournament-web/eslint.config.js`:

```js
rules: {
  'no-restricted-imports': ['error', {
    paths: [{
      name: '@wolf-cup/engine',
      message: 'Tournament may only import from @wolf-cup/engine/stableford (FD-11/12). Use the subpath import.',
    }],
    patterns: [{
      group: ['@wolf-cup/engine/*', '!@wolf-cup/engine/stableford'],
      message: 'Tournament may only import @wolf-cup/engine/stableford (FD-11/12).',
    }],
  }],
}
```

Blocks both bare `import '@wolf-cup/engine'` AND subpath imports except `stableford`. Single allowlist; boundary cannot be bypassed accidentally.

**Deferred (not blocking):**

8. **Activity spine observability** — v1.5 concern; transactional guarantees in v1 prevent partial-write corruption.
9. **Test-DB teardown under parallel Vitest workers** — trivial fix (include worker-id in temp DB path); address on first flake.

### Architecture Amendment Pathway

Architecture is not immutable. Stories will surface decisions needing mutation. Pathway:

**Substantive amendments** (schema shapes, interfaces between layers, infrastructure topology, or any FD-1..FD-15 change):
1. Story author proposes the amendment inline in the story's completion report with rationale.
2. Explicit Josh sign-off required before the story PR merges.
3. Architecture.md gets a new entry appended to the Amendments Log section (below).
4. Frontmatter note on the affected `stepsCompleted` item (e.g., adds `step-06-structure-amended-by-T3.1`).

**Minor amendments** (wording, clarity, example fixes, typo corrections):
- Direct edits are fine; no sign-off gate; no log entry required.

**Silent divergence from architecture is NOT permitted** for any substantive item.

### Amendments Log

*(Empty at step-07 commit. Populated by stories that require substantive amendments. Format: date, amendment summary, owning-story, Josh-approved-at.)*

### Release Gates for T9.2 Pre-Event Checklist Walkthrough

Concrete pass criteria (replaces "Josh feels good about it"). T9.2 PASSES only when all items below pass; FAILS when any item fails:

**Trip-critical PRD items (from PRD "Trip-Critical Scope Lock"):**
- Event creation + pairings locked + PDF export generates cleanly
- Single-scorer score entry working per foursome with authorization enforcement (FR-B10)
- Offline queue + reconnect sync verified via airplane-mode drill (T5.10) including 409-collision case
- Head-to-head money matrix correct for Pinehurst hand-calc fixture (T6.9 HTTP roundtrip test green)
- Round lifecycle FSM transitions audit-logged
- Score-correction audit log visible to organizer
- Skins sub-game running alongside 2v2 (FD-11); carry-over greenies working (FD-12)
- SSO + magic-link working; GHIN enrichment (FR-E11) working or cleanly skipped
- Mid-event rule-edit path (FD-13 guardrail 1) executes without money drift
- In-app engagement surfaces (toasts / banners / feed) firing on qualifying events (FD-5); no push/SMS/email infra present
- PWA install prompt visible + browser-tab read-only graceful (FD-14)
- T9.4 per-scorer-device install verification passed for every designated scorer

**Medium-confidence drivers (validation-surfaced gaps):**
- **#3 SSO outage behavior verified** — manually drop Resend API key in staging environment; confirm mutation routes return `503 { error: 'auth_unavailable' }` and invite-link reads remain functional
- **#6 Deployment rollback drill completed** — tag a post-T1 commit, redeploy prior tag, verify functional rollback

**Technical gates:**
- Wolf Cup's 865 tests still green on main; tournament CI suite running in CI
- `dig tournament.dagle.cloud` resolves to VPS; Traefik routing working (`/api/health` returns 200 over HTTPS)
- Daily DB backup cron running on VPS; pre-migration backups generated

### Medium-Confidence Drivers

Explicit naming for readiness-confidence assessment below. Two gaps drop confidence from "high" to "medium":
- **Gap #3** (SSO outage behavior) — could cause trip-day failure on hotel wifi / captive portals
- **Gap #6** (deployment rollback drill) — D5-8 strategy untested in practice

All other gaps are process hygiene, not trip-day risks.

### Architecture Readiness Assessment

**Status: READY FOR EPIC + STORY CREATION.** (`create-epics-and-stories` is the next BMAD workflow per FD-15.)

**Confidence:**
- **High** for coherence + requirements coverage (no contradictions, every FR/NFR has implementation path)
- **Medium** for implementation readiness (gaps #3 and #6 are known risks scheduled pre-T9; #1, #2 block T3.1; #4, #5 resolve during T1)

**First implementation priority** remains T1 Foundation: scaffold `apps/tournament-api` + `apps/tournament-web` alongside Wolf Cup, add CI + docker-compose + Traefik labels, ship `/api/health` reachable at `tournament.dagle.cloud/api/health`. Zero Wolf Cup regressions (865 tests green); empty login page loads.
