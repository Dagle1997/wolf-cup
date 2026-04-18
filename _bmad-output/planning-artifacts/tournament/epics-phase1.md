---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics']
inputDocuments:
  - _bmad-output/planning-artifacts/tournament/prd.md
  - _bmad-output/planning-artifacts/tournament/architecture.md
  - _bmad-output/planning-artifacts/tournament/product-brief.md
workflowType: 'create-epics-and-stories'
project_name: 'Tournament'
output_path_notice: 'Isolated under tournament/ subdirectory to avoid collision with Wolf Cup epics.md / epics-phase2.md at the planning-artifacts root'
---

# Tournament - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Tournament, decomposing the requirements from the PRD and Architecture into implementable stories.

**Source-of-truth hierarchy:**
- Requirements: `_bmad-output/planning-artifacts/tournament/prd.md` (FR-A..G, NFR-P..Dev, FD-1..FD-15)
- Technical decisions + patterns + structure: `_bmad-output/planning-artifacts/tournament/architecture.md`
- Product vision + future-proofing: `_bmad-output/planning-artifacts/tournament/product-brief.md`

This epics file MAY supersede the PRD's embedded Epic T1–T9 list (65 stories) per FD-15 workflow sequencing. If this file supersedes, the PRD's embedded list is preserved as historical context but implementation follows this file.

## Requirements Inventory

PRD requirement naming convention (FR-A1, FR-B10, NFR-C2, etc.) is **preserved** in this document to keep cross-references from the architecture intact. Architecture references FR-B10 / NFR-C3 / FR-D9 / etc. by those exact names; flattening to FR1..FR57 would break traceability.

### Functional Requirements

**FR-A — Event & Group Management (9)**

- **FR-A1** System shall create an Event with name, date range, and an ordered list of rounds (each round = date + course + tees).
- **FR-A2** System shall load a course from a scorecard PDF via vision parser, producing tees + 18-hole table.
- **FR-A3** System shall run a course validator rejecting: par ∉ {3,4,5}, SI not 1–18 unique, Out/In totals inconsistent.
- **FR-A4** System shall allow manual edit of any parsed course field post-validation.
- **FR-A5** System shall persist a Group entity with name, members (name + optional GHIN + handicap), and saved rule sets.
- **FR-A6** System shall look up a player's handicap index by GHIN number via copied Wolf Cup client, with manual override when lookup fails.
- **FR-A7** System shall save and reuse rule sets within a Group. Minimum v1: one saved rule set per Event.
- **FR-A8** System shall suggest pairings across a multi-round Event honoring "everyone plays everyone once" with manual pin/lock per slot.
- **FR-A9** System shall generate a per-Event invite link that routes first-arrival users to roster-confirmation (no auth wall).

**FR-B — Scoring (10)**

- **FR-B1** System shall designate one scorer per foursome; scorer is the only role permitted to enter gross hole scores for that foursome.
- **FR-B2** Scorer entry UI shall accept four gross scores per hole with auto-advance. Target: ≤10s per foursome per hole.
- **FR-B3** System shall accept score entry while offline, queue mutations locally, sync on reconnect without data loss.
- **FR-B4** System shall show a visible sync indicator whenever queued mutations exist, and resolve within 30s of connectivity returning.
- **FR-B5** System shall cache the active round's course data + scorecard shell so score entry works offline.
- **FR-B6** System shall allow a scorer to correct a previously-entered hole score at any time during the Event; correction re-triggers downstream recomputation.
- **FR-B7** System shall support scorer role transfer. Organizer or current scorer can reassign scorer for a foursome mid-round.
- **FR-B8** System shall record an immutable score-correction audit log (actor, hole, group, round, prior, new, timestamp, client_event_id).
- **FR-B9** System shall model round lifecycle with explicit states: `not_started | in_progress | complete_editable | finalized | cancelled`.
- **FR-B10** Scoring shall use a single-writer model (one scorer per foursome); offline mutations queue locally with `client_event_id` for idempotency.

**FR-H — Permissions & Roles (7)**

- **FR-H1** Edit event, rules, pairings — organizer only. Rule-config editable mid-event (FD-13 G1) with audit-logged effective-hole boundary + forward recompute + diff banner.
- **FR-H2** Assign/transfer scorer role — organizer or current scorer (transfer only).
- **FR-H3** Commit/correct gross scores for a foursome — designated scorer only (FR-B10).
- **FR-H4** Generate PDF schedule/pairings — any participant (read-only artifact).
- **FR-H5** View money matrix & settle-up — all Group members, subject to Group money-visibility posture (FR-D9). Spectators never see money.
- **FR-H6** View bets — each participant sees bets they are party to; organizer sees all; spectators see none.
- **FR-H7** Upload photos to gallery — any participant; organizer can delete.

**FR-C — Leaderboard & Live Updates (5)**

- **FR-C1** System shall display a live cross-group leaderboard accessible to any Event participant at any time during the Event.
- **FR-C2** Leaderboard updates shall propagate from scorer entry to other participants' devices in <30s under normal connectivity.
- **FR-C3** System shall surface qualifying score-movement events as in-app toasts/banners/feed entries — never as OS push notifications, SMS, or email (FD-5).
- **FR-C4** No push / SMS / email notification infrastructure ships in v1 or v1.5 (core design principle per FD-5).
- **FR-C5** Leaderboard tie-break ordering shall be explicit: primary metric → gross strokes asc → back-9 count-back → hole-by-hole from 18 backward.

**FR-D — Rules, Money & Bets (12)**

- **FR-D1** System shall support 2v2 best ball (the "Guyan Game") as the v1 team format, parameterized over sandies, auto-press trigger, press multiplier, greenie carryover toggle, greenie validation enum.
- **FR-D2** System shall support manual press via one-tap button, undoable before next hole is scored.
- **FR-D3** System shall support cross-foursome individual bets between any two Event participants, regardless of shared-foursome.
- **FR-D4** Supported individual-bet types v1: match play $/hole, match play with auto-press at N-down.
- **FR-D5** Auto-press engine shall evaluate trigger conditions after every hole-score commit and fire silently.
- **FR-D6** System shall compute a head-to-head money matrix across all Event participants, including pairs that never shared a foursome.
- **FR-D7** Settle-up view shall show per-player net balance and hole-by-hole bet/team contributions drill-down.
- **FR-D8** Money computations shall be deterministic and reproducible: recomputation from raw scores + rule config produces identical output.
- **FR-D9** Group-level money-visibility posture shall be a Group property with enum values: `open | participant | self_only`. v1 ships `open` only.
- **FR-D10** System shall support sub-games as first-class, round-scoped, participant-scoped entities.
- **FR-D11** System shall support Skins as the v1 sub-game: modes `gross | net | gross_beats_net`; ties carry; unclaimed pot splits.
- **FR-D12** Sub-game types recognized by schema: `skins`, `ctp`, `sandies`, `putting_contest`. Only `skins` implemented v1; others are schema stubs.

**FR-E — Player Experience (10 active; E10 retired, E11 added)**

- **FR-E1** First-arrival flow from invite link reaches "you're in, here's the schedule" in ≤3 taps **with no SSO prompt**. *(Revised 2026-04-18.)*
- **FR-E2** Read-only access (schedule, pairings, course previews, leaderboard, standings) available pre-SSO via the raw invite link. SSO triggered only on first mutating action.
- **FR-E3** Schedule view shall display each round's date, course (with hero image), tee times, and viewer's pairing.
- **FR-E4** Course preview shall include per-hole detail (par, yardage, SI) and at least a hero image.
- **FR-E5** System shall support per-Event photo gallery with R2 storage (reusing Wolf Cup gallery pattern).
- **FR-E6** Bets page shall display each individual bet a viewer participates in, with live running standing.
- **FR-E7** Event dates, round dates, and tee times shall be stored and rendered in the Event's declared local timezone.
- **FR-E8** System shall show an in-app install prompt after the player's first successful mutation (iOS: Share → Add to Home Screen; Android: `beforeinstallprompt`).
- **FR-E9** Browser-tab (non-installed) usage shall render read-only surfaces without error; scorer flow requires PWA install.
- **FR-E10** ~~GHIN lookup failure bailout~~ — **RETIRED 2026-04-18** post-Codex pass-3. GHIN is never a precondition for valid identity; nothing to bail out from.
- **FR-E11** System shall provide optional GHIN enrichment as a profile action available any time after SSO bind — never blocking; NULL GHIN is fully supported. *(Added 2026-04-18.)*

**FR-F — Export & Trust (2)**

- **FR-F1** System shall export a printable PDF schedule + pairings for the full Event on demand.
- **FR-F2** PDF export shall function regardless of app availability (generated server-side, downloadable, self-contained).

**FR-G — Deployment Isolation (2)**

- **FR-G1** Tournament shall deploy to `tournament.dagle.cloud` with its own Traefik route, docker service, SQLite volume, and auth realm, sharing no database files or runtime process with Wolf Cup.
- **FR-G2** Tournament code shall not read, write, or import from Wolf Cup's `apps/api` or `apps/web` source; shared dependencies limited to `packages/engine/src/stableford.ts` (post-Codex pass-2 tightening).

**Total: 57 functional requirements** (FR-E10 retired; FR-E11 added 2026-04-18).

### NonFunctional Requirements

**Performance (3)**
- **NFR-P1** Scorer hole-entry interaction shall complete (tap to auto-advance) in ≤10s for a familiar user.
- **NFR-P2** Leaderboard update propagation shall be <30s end-to-end under typical LTE connectivity.
- **NFR-P3** Event home page shall load and render the schedule in <2s on a cold PWA launch with warm cache.

**Reliability & Offline (3)**
- **NFR-R1** Score entry shall remain fully functional with zero connectivity for the duration of an 18-hole round.
- **NFR-R2** Offline-queued mutations shall merge without data loss or duplication on reconnect, validated by an airplane-mode drill before 2026-05-07.
- **NFR-R3** Atomic finalization: if any post-round computation fails, the round remains in its pre-finalize state.

**Security & Auth (3)**
- **NFR-S1** Invite links shall grant read-only access scoped to one Event. Scoring/editing requires an authenticated session via SSO (FD-4).
- **NFR-S2** Authentication uses Google SSO (primary) + magic-link email fallback. No passwords in v1. Apple SSO deferred v1.5.
- **NFR-S3** Only designated scorer for a foursome may commit gross score mutations (FD-3 hole-level soft-lock + audit log on every touch).

**Correctness (3)**
- **NFR-C1** For all Event participant pairs, the head-to-head money matrix shall match hand-calculation at settle-up.
- **NFR-C2** Engine-level tournament tests shall include golden-file fixtures for each supported rule variant.
- **NFR-C3** Wolf Cup test suite (865+ tests) shall remain green on every commit.

**Deployability (2)**
- **NFR-D1** CI shall run engine + Wolf Cup API + tournament tests on every commit and gate deploy on all green.
- **NFR-D2** Course data shall be importable (courses JSON seed) and re-importable without breaking existing Events referencing a course.

**Observability & Recovery (2)**
- **NFR-O1** Production shall log score-mutation sync failures, money/side-game recompute failures, notification delivery failures, course-parse failures — structured JSON lines, append-only log file.
- **NFR-B1** System shall support on-demand export of raw Event state (scores, rounds, players, rule config, money ledger, audit log) as downloadable JSON. Organizer-only.

**Device Support Floor (1)**
- **NFR-Dev1** Primary support: iOS Safari installed as PWA (scorer + player) + desktop Chrome/Edge (organizer). Best-effort: Android Chrome, desktop Safari/Firefox. Out of scope: iOS <16, Windows mobile, non-Chromium Android browsers.

**Total: 17 non-functional requirements.**

### Additional Requirements

Sourced from Architecture (`architecture.md`) and brief (`product-brief.md`). These shape epic/story structure but are not numbered FRs/NFRs.

**Starter template posture:**
- **No public CLI starter.** T1 scaffolds `apps/tournament-api` + `apps/tournament-web` fresh alongside Wolf Cup (sibling-app pattern per FD-1). Matching Wolf Cup's exact versions (TypeScript 5.7.x, Hono 4.x, Drizzle 0.45.x, @libsql/client 0.17.x, React 19, Vite 6, TanStack Router 1.163.x + Query 5.90.x, Tailwind v4, idb 8.x, Vitest 3.x).
- **Port-not-fork posture** (post-Codex pass-2). Fresh scaffold + selective port of 7 proven modules from Wolf Cup with provenance headers (offline queue, iOS keyboard fix, GHIN client, audit log pattern, photo gallery, PDF generation, scorer entry UI). Mirror surface ≈8 files, not 142.

**Infrastructure & deployment:**
- Docker Compose + Traefik on VPS `wolf.dagle.cloud`; wildcard TLS `*.dagle.cloud` already in place.
- Two docker services for tournament: `tournament-api` (Node, internal port 3000) + `tournament-web` (nginx:1.27-alpine serving Vite dist/ + `/api/` reverse proxy + SPA fallback + SW no-cache + immutable asset cache — matches Wolf Cup nginx.conf shape).
- Separate SQLite volume `tournament_sqlite_data`; separate auth realm; zero overlap with Wolf Cup runtime.
- Manual deploy via `DEPLOY_USER=root ./deploy.sh` from Git Bash at monorepo root.
- Pre-migration backup discipline: file copy `tournament.db.pre-{migration}-{timestamp}.bak` on host volume.
- Daily DB backup cron on VPS (30-day retention on host).
- DNS pre-check: `dig tournament.dagle.cloud` must resolve before T1.4 (should via wildcard).

**Integration (5 external services):**
- GHIN handicap lookup — copied Wolf Cup client; used only for optional GHIN enrichment (FR-E11), never in critical path.
- Google OAuth via `arctic` (finalized in architecture step-04 D2-1; not a candidate).
- Magic-link email via Resend (zero Resend API cost at ~16 emails/trip; free tier covers forever).
- Anthropic Vision API for course PDF parsing (existing key).
- Cloudflare R2 for photo gallery — shared Wolf Cup bucket with `tournament/events/{eventId}/` prefix.

**Data & migration:**
- Forward-only Drizzle migrations numbered `{NNNN}_{description}.sql` (own ordinal sequence starting 0001; tournament DB; not shared with Wolf Cup).
- Universal `tenant_id` (default `'guyan'`) + `context_id` (no DB default; stamped on INSERT as opaque `event:{eventId}`; write-once; no UPDATE path in v1) on every writable table (FD-6).
- Domain-grouped schema files under `apps/tournament-api/src/db/schema/*.ts` (not flat single file).
- `rounds.event_id` stays nullable to preserve FD-7 forward-compatibility (standalone rounds as v1.5+ shape).
- Rule-set + course revisioning (FD-8): rounds pin `rule_set_revision_id` + `course_revision_id`; history stays accurate across edits.

**Security implementation:**
- OAuth flow state/PKCE cookies: `SameSite=Lax`, httpOnly, secure, 10-min TTL.
- Post-auth session cookie: `SameSite=Strict`, httpOnly, secure, scoped to `tournament.dagle.cloud` (never parent domain).
- CSRF middleware pinned: `hono/csrf` (built-in to Hono 4.x).
- Session lifetime: 7-day rolling, 30-day hard maximum.
- Rate limiting: magic-link send only (5/email/hr + 30/IP/hr in-memory token bucket).
- CI secrets: stub Arctic OAuth + Resend email in integration tests; zero production credentials in CI.

**Monitoring & observability:**
- Structured JSON logger (`pino` candidate) emitting one log line per event with `ts`, `level`, `requestId`, `msg` + contextual fields.
- Append-only daily log file `/app/logs/tournament-{YYYY-MM-DD}.log` + console stdout (captured by docker log driver).
- No external monitoring service v1. Consider Uptime Robot pre-T9 if trip criticality warrants.

**API versioning & compatibility:**
- No versioning in v1. Internal consumer (tournament-web) only. Add `/api/v2/*` path pattern when v1.5+ external consumer appears.
- `/health` and `/api/version` endpoints (match Wolf Cup commit e0740a5 pattern) for container health checks + frontend version-mismatch refresh banner.

**Architecture enforcement disciplines:**
- **Port Provenance Protocol**: every ported module carries a header (`/* PORTED from apps/.../path.ts @ commit {sha} */`) + an entry in `apps/tournament-{api,web}/PORTS.md` with source path, source commit SHA, ported-on date, deltas, last-checked date.
- **Engine-boundary ESLint rule** (`no-restricted-imports`) in both tournament eslint configs: blocks bare `@wolf-cup/engine` AND subpath imports, with `stableford` as sole allowlist. Enforces FD-11/12 tightening.
- **Audit-row integration test template**: every money / identity / rule mutation route ships with a co-located integration test asserting the audit row exists (template in architecture Implementation Patterns).
- **Bug-fix-mirroring discipline**: when fixing a bug in Wolf Cup code that tournament ports, grep `PORTS.md` for the source path; mirror within one dev session.
- **Amendments Log pathway**: substantive architecture changes (schema, interfaces, infra, FD changes) require Josh sign-off + entry in architecture.md Amendments Log. Minor fixes are direct edits.

**Technical implementation patterns:**
- **Services layer split**: query services (`src/services/money.ts`) read+compute only, never write; transaction helpers (`src/services/activity.ts`, `src/services/audit.ts`) write only when handed a `tx` from the route handler.
- **Transaction boundary rule**: any mutating route handler wraps its work in `db.transaction(async (tx) => { ... })` — no judgment calls on "single vs multi write."
- **Typed error hierarchy**: `TournamentError` base + `ValidationError` / `ConflictError` / `NotFoundError` / `ForbiddenError` / `UnauthenticatedError` / `BusinessRuleError`; centralized `errorMapper` middleware translates to `{ error, code, requestId, fields? }` + HTTP status.
- **Activity spine**: `src/services/activity.ts` `emitActivity(tx, event)` is the ONLY writer; payloads are TS discriminated union + Zod validated BEFORE insert.
- **Tournament-local engine**: `apps/tournament-api/src/engine/formats/{2v2-best-ball,skins}.ts` + `engine/rules/{press,individual-bets}.ts` — NOT in `packages/engine` (post-Codex pass-2). Only `stableford.ts` is shared across apps.
- **SubGameFormat interface** (for v1.5+ extensibility): `{ type, configSchema, resultSchema, compute(...) }`; each new sub-game type registers with dispatcher.
- **Money computation via `services/money.ts`**: `computeMoneyMatrix(eventId)` and `computeLeaderboard(roundId)` called by all read endpoints. No caching v1 (recompute on read; ~576 hole rows per event).

**Test infrastructure:**
- Unit tests co-located `{source}.test.ts`; `:memory:` libsql.
- Integration tests co-located `{source}.integration.test.ts`; file-backed libsql in temp directory (one DB per test file, torn down in `afterAll`).
- Manual drill scripts `src/scripts/drill-*.ts` — checklist-driven console output; not in CI; require human + real device.
- Test data factories `src/db/__fixtures__/make-*.ts` — `makePlayer()`, `makeRound()`, etc. — single source of test-data truth. Plus `src/db/__fixtures__/scenarios.ts` for complex named scenarios (`pinehurstMidTripScenario()`, `plusHandicapScenario()`, `expiredSessionScenario()`).
- Golden-file fixtures `src/engine/formats/__fixtures__/*.json` consumed by engine tests.
- Test pyramid budget: ~400 unit + ~80 integration + ~5 manual drills.

**Release gates for T9.2 pre-event checklist:**
- Trip-critical PRD items (event creation + pairings + PDF export + single-scorer flow + offline sync + money correctness + skins + carry-greenies + SSO+magic-link + GHIN optional + mid-event edit + in-app engagement + install prompt + T9.4 per-device install verification)
- **Medium-confidence drivers**: SSO-outage behavior verified in staging (#3) + deployment rollback drill completed (#6)
- Technical gates: Wolf Cup 865+ tests still green; tournament CI suite green; DNS resolves; Traefik routing live; daily backup cron running

### FR Coverage Map

Every active FR (57) and NFR (17) maps to a primary epic. Cross-cutting touches noted where applicable. Architecture's directory-level mapping (step-06) complements this by showing which files implement each story; this map shows which epic each requirement belongs to.

```
FR-A1 → T3 (event creation)
FR-A2 → T2 (PDF vision parse)
FR-A3 → T2 (validator)
FR-A4 → T2 (manual edit)
FR-A5 → T3 (group entity)
FR-A6 → T3 (GHIN lookup; ported client)
FR-A7 → T3 (rule sets)
FR-A8 → T4 (suggest pairings)
FR-A9 → T3 (invite link)

FR-B1 → T5 (single scorer)
FR-B2 → T5 (≤10s entry)
FR-B3 → T5 (offline queue)
FR-B4 → T5 (sync indicator)
FR-B5 → T5 (cache round data)
FR-B6 → T5 (score correction)
FR-B7 → T5 (scorer handoff)
FR-B8 → T5 (audit log)
FR-B9 → T5 (lifecycle FSM)
FR-B10 → T5 (single-writer enforcement)

FR-H1 → T3 (basic edit) + T5 (mid-event edit T5.11)
FR-H2 → T5 (assign/transfer scorer)
FR-H3 → T5 (scorer-only commit)
FR-H4 → T4 (PDF export — any participant)
FR-H5 → T6 (money matrix view)
FR-H6 → T6 (bets view)
FR-H7 → T7 (photo upload)

FR-C1 → T5 (cross-group leaderboard)
FR-C2 → T5 (<30s propagation; arch D3-1)
FR-C3 → T8 (in-app surfaces)
FR-C4 → T8 (no push/SMS/email)
FR-C5 → T6 (tie-break ordering)

FR-D1 → T6 (2v2 best ball params; schema in T3)
FR-D2 → T6 (manual press)
FR-D3 → T6 (cross-foursome bets)
FR-D4 → T6 (individual bet types)
FR-D5 → T6 (auto-press engine)
FR-D6 → T6 (head-to-head matrix)
FR-D7 → T6 (settle-up)
FR-D8 → T6 (deterministic money)
FR-D9 → T6 (visibility posture; schema column ships v1, only `open` mode active)
FR-D10 → T6 (sub-games framework)
FR-D11 → T6 (skins v1)
FR-D12 → T6 (sub-game schema stubs)

FR-E1 → T3 (first-arrival no SSO)
FR-E2 → T3 (read-only via invite)
FR-E3 → T7 (schedule view)
FR-E4 → T7 (course preview)
FR-E5 → T7 (photo gallery)
FR-E6 → T6 (bets page)
FR-E7 → T3 (timezone capture; cross-cutting via lib/tz.ts)
FR-E8 → T7 (install prompt)
FR-E9 → T7 (browser-tab graceful)
FR-E10 → RETIRED 2026-04-18
FR-E11 → T3 (optional GHIN enrichment T3.10)

FR-F1 → T4 (PDF export)
FR-F2 → T4 (server-side PDF)

FR-G1 → T1 (separate infra)
FR-G2 → T1 (only packages/engine/stableford shared; ESLint rule)

NFR-P1 → T5 (≤10s scorer entry)
NFR-P2 → T5 (<30s leaderboard)
NFR-P3 → T7 (cold PWA launch with T1 nginx cache)
NFR-R1 → T5 (18-hole zero connectivity)
NFR-R2 → T5 (offline merge; validated T9)
NFR-R3 → T5 (atomic finalization)
NFR-S1 → T3 (invite-link read-only scoped)
NFR-S2 → T1 (auth realm)
NFR-S3 → T5 (scorer-only commits)
NFR-C1 → T6 (money matches hand-calc; validated T9)
NFR-C2 → T6 (golden fixtures; cross-cutting)
NFR-C3 → T1 (CI dual-run; Wolf Cup tests green)
NFR-D1 → T1 (CI runs all suites)
NFR-D2 → T2 (course re-importable)
NFR-O1 → T1 (structured log sink)
NFR-B1 → T7 (raw-state export)
NFR-Dev1 → T7 (iOS PWA primary; with T1 PWA setup)
```

## Epic List

**Summary:**
- **9 epics** (preserving PRD T1-T9 naming; architecture's 1,246 lines cross-reference stories by these IDs)
- **65 stories total:** T1(7) + T2(5) + T3(10) + T4(3) + T5(11) + T6(14) + T7(7) + T8(4) + T9(4)
- **T3 + T5 + T6 = 35/65 stories = 54% of v1 effort.** These are the long epics; budget accordingly and watch for scope creep
- **Sequencing posture:** foundation-first, ship-when-solid. Target testing window Pinehurst 2026-05-07; fallback June 2026 trip (FD-15)

### Epic T1: Tournament Foundation

**User outcome:** Technical foundation; no direct user-facing outcome. Required substrate for T2–T9. Owning this honestly per PM feedback — pretending a scaffold epic delivers user value doesn't survive retrospective.

**Entry criteria:**
- CLAUDE.md disambiguation (Wolf Cup = `apps/api`+`apps/web`; tournament = `apps/tournament-*`) approved
- Wildcard TLS `*.dagle.cloud` verified at Traefik
- DNS for `tournament.dagle.cloud` resolves (via existing wildcard)
- Wolf Cup's 865+ tests currently green on `master`

**Exit criteria (observable):**
- `curl https://tournament.dagle.cloud/api/health` returns 200 with JSON body `{ status: 'ok', startupTime: <integer epoch ms> }` (matches Wolf Cup's `/api/health` shape verified in `docker-compose.yml`)
- Root path of `tournament.dagle.cloud` loads a sign-in surface over HTTPS without 500s (UI copy-agnostic; any sign-in entry point counts)
- Wolf Cup's full test suite passes unchanged after tournament CI additions land
- CI pipeline runs all three test suites (engine + Wolf Cup API/web + tournament API/web) on pull requests and on main pushes
- Structured JSON log file present at the expected path inside the tournament API container; at least one log line with `level: 'info'` produced at startup

**Journeys served:** substrate only; no PRD journey directly served. Enables all subsequent epics.

**Stories:** 7 (T1.1–T1.7)

**Target-miss-tolerable:** none. All of T1 is trip-critical.

**FRs covered:** FR-G1, FR-G2, NFR-C3, NFR-D1, NFR-O1, NFR-S2 (auth realm)

#### Story T1.1: CLAUDE.md Disambiguation Note

As a developer working in this monorepo,
I want a CLAUDE.md note that disambiguates Wolf Cup paths from tournament paths,
So that I don't accidentally edit Wolf Cup files when working on tournament.

**Acceptance Criteria:**

**Given** the root `CLAUDE.md`
**When** a developer reads it
**Then** it contains a section that explicitly states: `apps/api` + `apps/web` belong to Wolf Cup; `apps/tournament-*` belongs to Tournament; tournament work does not edit Wolf Cup paths without explicit approval (FD-1, FD-2)

#### Story T1.2: Scaffold tournament-api

As a developer,
I want a fresh Hono + Drizzle + libsql scaffold at `apps/tournament-api/` matching Wolf Cup's versions,
So that tournament has a deployable API skeleton independent of Wolf Cup.

**Acceptance Criteria:**

**Given** a fresh checkout
**When** `pnpm install` runs
**Then** `apps/tournament-api/` resolves cleanly as a pnpm workspace with deps including `hono@^4.x`, `@hono/node-server@^1.x`, `drizzle-orm@^0.45.x`, `drizzle-kit@^0.30.x`, `@libsql/client@^0.17.x`, `zod@^3.24.x`, `vitest@^3.x`

**Given** the scaffolded API
**When** `pnpm -F @tournament/api dev` runs
**Then** an HTTP server listens on port 3000 and responds to `GET /api/health` with body `{ status: 'ok', startupTime: <integer epoch ms> }` and HTTP 200 (matches Wolf Cup's `/api/health` shape)

**Given** `apps/tournament-api/package.json`
**When** inspected
**Then** `bcrypt` and `@types/bcrypt` are NOT present (FD-4 SSO posture)

**Given** the source tree
**When** inspected
**Then** `src/db/schema/index.ts` exists as a re-export file (architecture step-3 schema organization); `src/db/schema/_columns.ts` exists with a shared helper producing `tenant_id` (default `'guyan'`) + `context_id` (NOT NULL, no DB default) per FD-6

**Given** `apps/tournament-api/eslint.config.js`
**When** inspected
**Then** the engine-boundary `no-restricted-imports` rule is present (architecture validation gap #7) blocking bare `@wolf-cup/engine` imports AND subpath imports except `stableford`

**Given** the API workspace
**When** `pnpm -F @tournament/api test` runs
**Then** Vitest 3.x executes successfully (zero tests acceptable initially)

#### Story T1.3: Scaffold tournament-web

As a developer,
I want a fresh Vite + React 19 + TanStack Router + Tailwind v4 scaffold at `apps/tournament-web/` matching Wolf Cup's versions,
So that tournament has a deployable PWA skeleton independent of Wolf Cup.

**Acceptance Criteria:**

**Given** the scaffolded web workspace
**When** `pnpm -F @tournament/web dev` runs
**Then** Vite serves on port 5173 with `/api/*` proxied to tournament-api on port 3000

**Given** `apps/tournament-web/package.json`
**When** inspected
**Then** dependency versions match Wolf Cup exactly: `react@^19.0.0`, `vite@^6.x`, `@tanstack/react-router@^1.163.x`, `@tanstack/react-query@^5.90.x`, `@tailwindcss/vite@^4.2.x`, `idb@^8.x`, `vite-plugin-pwa@^1.2.x`, `lucide-react@^0.575.x`, `@radix-ui/react-slot@^1.2.x`, `class-variance-authority@^0.7.x`, `clsx@^2.x`, `tailwind-merge@^3.x`

**Given** the route tree
**When** inspected
**Then** `src/main.tsx` wires TanStack Router + TanStack Query providers; `src/routes/__root.tsx` and `src/routes/index.tsx` exist as anchor routes; `routeTree.gen.ts` regenerates cleanly via `pnpm -F @tournament/web typecheck`

**Given** the build
**When** `pnpm -F @tournament/web build` runs
**Then** Vite produces `dist/` with the PWA manifest configured for tournament branding (not Wolf Cup branding)

**Given** `apps/tournament-web/eslint.config.js`
**When** inspected
**Then** the engine-boundary `no-restricted-imports` rule is present (matching the api-side rule from T1.2) blocking bare `@wolf-cup/engine` imports AND subpath imports except `stableford`

#### Story T1.4: Docker Compose + Traefik for tournament.dagle.cloud

As a developer,
I want tournament-api + tournament-web added as separate docker-compose services with Traefik labels for `tournament.dagle.cloud`,
So that tournament deploys to its own subdomain alongside Wolf Cup without disrupting Wolf Cup's routing.

**Acceptance Criteria:**

**Given** `docker-compose.yml`
**When** inspected
**Then** `tournament-api` service exists on the `internal` network ONLY (no `n8n_default`); `tournament-web` service exists on BOTH `internal` and `n8n_default` (matches Wolf Cup `web`-only-on-Traefik-network shape); tournament-api has a healthcheck against `http://localhost:3000/api/health`

**Given** `docker-compose.yml`
**When** inspected
**Then** ONLY `tournament-web` carries Traefik labels; the labels route `Host('tournament.dagle.cloud')` over `websecure` with TLS via `mytlschallenge` certresolver and `loadbalancer.server.port=80` (matches Wolf Cup label shape exactly)

**Given** the volumes section
**When** inspected
**Then** a separate `tournament_sqlite_data` volume is declared and mounted at `/app/data` in tournament-api (no overlap with Wolf Cup's `sqlite_data`)

**Given** `apps/tournament-web/nginx.conf`
**When** inspected
**Then** it mirrors Wolf Cup's `nginx.conf` shape, with `/api/` reverse-proxying to `http://tournament-api:3000` (NOT `http://api:3000` — different service name); plus service-worker + manifest no-cache headers, immutable asset cache for `.(js|css|png|svg|woff|woff2)`, PDF cache, SPA fallback `try_files $uri $uri/ /index.html`

**Given** `dig tournament.dagle.cloud`
**When** run
**Then** it resolves to the VPS IP via the existing `*.dagle.cloud` wildcard (D5-9 checkpoint)

**Given** a successful deploy
**When** `curl https://tournament.dagle.cloud/api/health` runs against prod
**Then** it returns HTTP 200 with the expected JSON body (request hits Traefik → tournament-web nginx → `/api/` proxy → tournament-api:3000)

**Given** the deploy
**When** Wolf Cup's `wolf-cup-api` and `wolf-cup-web` containers are checked in parallel
**Then** they continue to run and serve `wolf.dagle.cloud` without disruption (FR-G1)

#### Story T1.5: CI Dual-Run Pipeline

As a developer,
I want CI to run engine + Wolf Cup + tournament test suites on every commit,
So that tournament work cannot regress Wolf Cup tests undetected (NFR-C3, NFR-D1).

**Acceptance Criteria:**

**Given** a pull request
**When** the CI pipeline runs
**Then** all of these execute and must pass: `pnpm -F @wolf-cup/engine test`, `pnpm -F @wolf-cup/api test`, `pnpm -F @wolf-cup/web typecheck`, `pnpm -F @tournament/api test`, `pnpm -F @tournament/web typecheck`

**Given** any test failure
**When** the PR is checked
**Then** the PR is blocked from merging until green

**Given** integration tests requiring OAuth
**When** they run in CI
**Then** they use stubbed Arctic state/exchange and a stubbed Resend SDK (architecture validation gap #5); zero production credentials are required

**Given** GitHub Actions secrets
**When** inspected
**Then** only test-grade values are stored (no production OAuth client secret, no production Resend API key)

**Given** a clean local checkout
**When** `time pnpm test` is measured
**Then** the wall-clock baseline is recorded in this story's completion notes (informs the 5-minute monorepo-split tripwire from architecture D5-3)

#### Story T1.6: Auth Realm — SSO + Magic-Link

As a developer,
I want a working auth realm in tournament-api with Google SSO via `arctic` + magic-link email via Resend + Drizzle-backed sessions + magic-link tokens table,
So that subsequent stories can require authentication on mutation routes (FD-4, NFR-S2).

**Acceptance Criteria:**

**Given** `db/schema/players.ts` (minimal slice — full player schema lands in T3.1)
**When** inspected
**Then** a `players` table exists with columns: `id PK (TEXT, app-generated UUID for opaque context_id stamping)`, `is_organizer BOOLEAN NOT NULL DEFAULT false`, `created_at`, plus universal `tenant_id` + `context_id` per FD-6. T3.1 will extend this table with name/ghin/google_sub/etc. without a destructive migration.

**Given** `db/schema/auth.ts`
**When** inspected
**Then** it defines `sessions(session_id PK, player_id FK → players.id, created_at, last_seen_at, device_info, expires_at)` and `magic_link_tokens(token PK, player_id FK → players.id, expires_at, consumed_at)` (player_id is the identity anchor per FD-4; no separate users table is introduced; players table is created in this story per the previous AC)

**Given** a player taps "Sign in with Google"
**When** the OAuth flow completes successfully via the `arctic` library
**Then** a session cookie is set with `SameSite=Strict`, `HttpOnly`, `Secure`, scoped to `tournament.dagle.cloud` (never parent domain)

**Given** the OAuth flow's intermediate cookies (`oauth_state`, `oauth_code_verifier`)
**When** inspected during the round-trip to Google
**Then** they have `SameSite=Lax`, `HttpOnly`, `Secure`, 10-min TTL; cleared on callback success

**Given** a magic-link send request
**When** the rate limit (5/email/hour, 30/IP/hour) is not exceeded
**Then** Resend sends an email containing a token from `crypto.randomBytes(32)`; a row is written to `magic_link_tokens` with `expires_at` 15 minutes in the future and the `player_id` set

**Given** an over-rate-limit magic-link request
**When** received
**Then** the API returns HTTP 429 with `{ error: 'rate_limited', code: 'magic_link_rate_limit', requestId }`

**Given** an authenticated session
**When** the player makes an authenticated request
**Then** the session's `last_seen_at` updates and `expires_at` extends 7 days from now (rolling)

**Given** a session whose age (created_at) exceeds 30 days
**When** checked at request time
**Then** it is rejected as expired regardless of recent activity (hard maximum)

**Given** both Google OAuth AND Resend are unreachable simultaneously
**When** a player attempts to sign in
**Then** the API returns HTTP 503 `{ error: 'auth_unavailable', code: 'auth_provider_outage', requestId }` (architecture validation gap #3); invite-link reads (FR-E2) continue to function

**Given** a successful first SSO bind
**When** inspected
**Then** a `players` row exists with `players.google_sub` populated, `players.ghin = NULL`, and `players.id` (the local primary key) acting as the identity trust anchor paired with `google_sub` (FD-4). FR-E11 GHIN enrichment UI is NOT exercised in this story; that lives in T3.10.

**Given** `apps/tournament-api/package.json`
**When** inspected
**Then** `bcrypt` is NOT present; `arctic` is added at a pinned/ranged version recorded in the package.json (NOT `arctic@latest`) per the version-pin posture; Resend SDK is added at a pinned/ranged version; `hono/csrf` (built-in to Hono 4.x) is wired into the auth flow

**Given** `src/middleware/require-session.ts` and `src/middleware/require-organizer.ts`
**When** inspected
**Then** `require-session` (Hono middleware) returns 401 if no valid session cookie; `require-organizer` returns 403 if the session's player has `is_organizer = false`; both middleware exist and are exported for use by `/admin/*` routes (T2.3, T2.5, and downstream stories). Full role-matrix middleware (require-scorer-for-round, etc.) is added in T3.8 as the matrix grows; this story ships the minimum (session + organizer) to unblock T2 admin endpoints. *(Amendment 2026-04-18 — gap surfaced by T2 review: T2.3/T2.5 reference organizer-only gating that must exist before T2 can land.)*

**Given** the seed flow (T2.2 prerequisite consumer)
**When** Josh's player record is created
**Then** `players.is_organizer = true` is set by the seed for Josh; all other seeded players default to false.

#### Story T1.7: Structured JSON Log Sink

As a developer,
I want tournament-api to emit structured JSON log lines to both stdout and an append-only daily log file,
So that production failures can be diagnosed without external observability infrastructure (NFR-O1).

**Acceptance Criteria:**

**Given** a tournament-api startup
**When** the process boots
**Then** at least one log line is emitted to stdout with `{ ts: <ISO>, level: 'info', msg: <string>, requestId: null }` (or omitted requestId at boot)

**Given** an inbound HTTP request
**When** the request-id middleware runs
**Then** a unique `requestId` is assigned, propagated through subsequent log lines for that request, and included in the response body's error payload (D3-6)

**Given** an error in a route handler
**When** logged
**Then** the log line includes `level: 'error'`, `msg`, `stack`, `cause` (if `Error.cause` is set), `requestId`, and any contextual fields (`eventId`, `roundId`, `playerId`, `holeNumber` when applicable)

**Given** the log destinations
**When** inspected
**Then** logs go to BOTH stdout (captured by docker log driver) AND `/app/logs/tournament-{YYYY-MM-DD}.log` (append-only, daily rotation by filename)

---

### Epic T2: Course Library

**User outcome:** Organizer has a course picker with Pinehurst courses pre-loaded before event creation. Courses are re-loadable without data loss.

**Entry criteria:**
- T1 exit met (tournament API + DB reachable, schema directory in place)

**Exit criteria (observable):**
- 4 Pinehurst courses (Talamore, Mid Pines, Pine Needles, Tobacco Road) loaded + marked verified in the course picker
- 1 Pinehurst No. 2 alternate loaded (may remain flagged unverified pending source reconciliation)
- The PDF-upload flow completes end-to-end on at least one new course without manual DB editing
- Validator rejects at least one known-invalid fixture (par sum mismatch OR SI collision OR Out/In total mismatch)
- Course re-import on an existing course does not break Events that reference the course (NFR-D2)

**Journeys served:** J1 (Josh organizer) primary.

**Stories:** 5 (T2.1–T2.5)

**Target-miss-tolerable:** T2.3 (PDF vision parser — manual-entry path via T2.5 is sufficient)

**FRs covered:** FR-A2, FR-A3, FR-A4, NFR-D2

#### Story T2.1: Courses + Revisions Schema

As a developer,
I want `courses` + `course_revisions` + `course_tees` + `course_holes` tables defined with revision-aware referential integrity,
So that course data persists durably across re-tees and resurfacings (FD-8 revisioning; brief §4.2 source_url + extraction_date).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/db/schema/courses.ts`
**When** inspected
**Then** it defines four tables: `courses(id PK, name, club_name, created_at)`; `course_revisions(id PK, course_id FK → courses.id, revision_number, source_url, extraction_date, verified BOOLEAN, out_total, in_total, course_total, created_at)`; `course_tees(id PK, course_revision_id FK → course_revisions.id, tee_color, rating, slope)`; `course_holes(id PK, course_revision_id FK → course_revisions.id, hole_number, par, si, yardage_per_tee_json TEXT)`. The 18 holes per revision live in `course_holes` (not per-tee); per-tee yardages are stored as a JSON object on each hole row.

**Given** all four tables
**When** inspected
**Then** each carries `tenant_id` + `context_id` NOT NULL columns per FD-6. `tenant_id` defaults to `'guyan'`. **Course library rows are tenant-scoped, not event-scoped** — `context_id` is stamped at insert as `'library:{tenant_id}'` (e.g., `'library:guyan'`), the most-specific owning scope for course library rows; write-once, never UPDATE'd. **Course inserts do NOT depend on an event existing** — courses pre-exist any event that references them.

**Given** `drizzle-kit generate`
**When** run after schema additions
**Then** a migration file `0002_<descriptive_name>.sql` (or current ordinal — sequence starts at 0001 from T1.6 auth schema) is produced; `drizzle-kit migrate` runs cleanly on a fresh DB

**Given** a re-import of the same course (matched by `source_url`)
**When** processed
**Then** a NEW `course_revisions` row is inserted attached to the existing `courses` row; the existing `course_revisions` row remains intact (NFR-D2; durable across re-tees)

#### Story T2.2: Pinehurst Seed Importer + Course List API

As a developer,
I want a seed script that loads `reference/pinehurst-may-2026-courses.json` AND a `GET /api/courses` route that returns the loaded course library,
So that all 5 Pinehurst courses are present after `pnpm seed` AND consumers (T2.5 admin UI, T3.2 event creation) have a canonical course-list API to query.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/scripts/seed-live.ts` (matching Wolf Cup's `src/scripts/` location)
**When** invoked via `pnpm -F @tournament/api seed`
**Then** the script reads `reference/pinehurst-may-2026-courses.json` and inserts 5 courses: Talamore, Mid Pines, Pine Needles, Tobacco Road (verified=true) + Pinehurst No. 2 (verified=false per the alternate flag)

**Given** each seeded course
**When** inspected post-seed
**Then** it has at least one `course_revisions` row with `source_url` + `extraction_date` populated AND with `out_total`, `in_total`, `course_total` populated from the JSON; one `course_tees` row per tee color on the revision; **18 `course_holes` rows per revision** (NOT per-tee) — each hole row carries `par` + `si` + `yardage_per_tee_json` (a JSON object mapping tee color → yardage)

**Given** a re-run of the seed script
**When** executed
**Then** no duplicate `courses` rows are created; the script is idempotent (matches existing courses by `name + club_name`; if `source_url + extraction_date` match an existing revision, no-op; otherwise add a new revision per T2.1)

**Given** `GET /api/courses` (route owned by THIS story)
**When** queried after seed
**Then** the route returns HTTP 200 with body shaped as `{ courses: [{ id, name, club_name, latest_revision: { id, revision_number, verified, tees: [{ color, rating, slope }] } }, ...] }`. All 5 seeded courses appear. **This route is the canonical course-list API** consumed by T2.5 admin UI (course picker) and T3.2 event-creation course picker; future consumers must use this route, not query the DB directly.

**Given** Josh's player record
**When** the seed completes
**Then** `players.is_organizer = true` is set for Josh (per T1.6 amendment); other seed players default to `false`

#### Story T2.3: [target-miss tolerable] Scorecard PDF Vision Parser

As an organizer (Josh),
I want to upload a course's scorecard PDF and have it parsed into structured course data,
So that loading a new course doesn't require manual cell-by-cell entry.

**Acceptance Criteria:**

**Given** `POST /api/admin/courses/parse-pdf` gated by `require-organizer` middleware (provided by T1.6 amendment; explicit dependency)
**When** invoked with a multipart PDF upload by an organizer
**Then** the server invokes the Anthropic Vision API via `src/lib/course-parser.ts` with a structured prompt and returns a JSON body shaped as `{ name, club_name, tees: [{ color, rating, slope }], holes: [{ number, par, si, yardages: { <color>: number } }], totals: { out_total, in_total, course_total } }` on success. The `totals` block is required so T2.4 validator can compare displayed-vs-computed totals.

**Given** a vision API failure (rate limit, network error, API error, malformed response)
**When** received
**Then** the endpoint returns HTTP 503 with `{ error: 'parser_unavailable', code: 'vision_api_failed', requestId }`; manual entry path (T2.5) remains the fallback

**Given** a successful parse
**When** the response is returned
**Then** the parsed data is NOT auto-persisted; it must flow through T2.5's review/edit UI before save (catches vision-parser inaccuracies)

**Given** a non-organizer caller
**When** invoking this endpoint
**Then** the API returns HTTP 403 with `{ error: 'forbidden', code: 'organizer_required', requestId }` (enforced by T1.6's `require-organizer` middleware)

**Note:** This story is target-miss-tolerable per PRD sequencing. T2.5 manual entry covers all 5 known v1 courses; this story is convenience for future-course loading.

#### Story T2.4: Course Validator

As a developer (consumed by T2.3 parser output and T2.5 form submission),
I want a pure validator function that rejects malformed course data (including printed-vs-computed totals mismatches),
So that bad data never reaches the courses tables.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/engine/validators/course.ts`
**When** inspected
**Then** it exports a pure function `validateCourse(course): { valid: boolean, errors: string[] }` with no DB or I/O side effects. The `course` input shape includes `holes` array AND `totals: { out_total, in_total, course_total }` (parser/admin-form populate these per T2.3 + T2.5).

**Given** any of the following invalid inputs
**When** validated
**Then** `valid: false` is returned with a descriptive error per failure mode: par value outside {3, 4, 5} on any hole; SI duplicates or missing values from 1..18; `out_total` (printed) ≠ sum of holes 1-9 par (computed); `in_total` (printed) ≠ sum of holes 10-18 par (computed); `course_total` (printed) ≠ `out_total + in_total`. Totals comparison catches OCR errors where the parser misread a hole value but the printed totals are correct (or vice versa).

**Given** all 4 verified Pinehurst courses from `reference/pinehurst-may-2026-courses.json`
**When** validated
**Then** `valid: true` is returned for each (regression check that the validator doesn't reject known-good data; assumes seed JSON includes the totals fields)

**Given** `apps/tournament-api/src/engine/validators/course.test.ts`
**When** `pnpm -F @tournament/api test` runs
**Then** at least one unit test exists per rejection mode + at least one happy-path test per Pinehurst course; all tests pass

#### Story T2.5: Course Admin UI — Manual + PDF Upload Review

As an organizer (Josh),
I want a course-creation UI that supports both manual cell-by-cell entry AND PDF-upload review (when T2.3 parser succeeds),
So that I can load any course regardless of whether the vision parser handles it cleanly.

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/admin/courses.new.tsx`
**When** rendered for an organizer (gated by `require-organizer` from T1.6 — route's `beforeLoad` hook checks session + organizer flag; explicit dependency)
**Then** the form displays: course name, club name, tee colors + rating + slope per tee, an 18-hole table with par + SI + yardage-per-tee inputs, AND **out_total / in_total / course_total fields** for printed-totals entry (so T2.4 validator can compare to computed)

**Given** the form
**When** the organizer fills fields manually and submits
**Then** client-side Zod validation runs (mirroring server-side T2.4 validator including totals comparison); field-level errors display inline; on success, `POST /api/admin/courses` is called with the form data

**Given** the "Upload Scorecard PDF" button
**When** the organizer uploads a PDF
**Then** the request hits T2.3's parser endpoint; on success, the parsed fields (including totals) populate the form for review/edit (organizer can correct any vision-parser inaccuracy before save); on failure, an error message displays and the form remains in manual-entry mode

**Given** a successful save (manual or post-parse)
**When** persisted
**Then** the API creates a `courses` + `course_revisions` (with totals) + `course_tees` + 18 `course_holes` rows in one DB transaction (architecture step-5 transaction-boundary rule); responds 201 with the new course id

**Given** all 5 seeded courses (post-T2.2) plus any course added via this UI
**When** the course picker is queried via `GET /api/courses` (route owned by T2.2)
**Then** all loaded courses appear; T2.5-added courses are indistinguishable from T2.2-seeded courses in the API response shape

**Given** a non-organizer attempting to access `/admin/courses/new`
**When** they navigate to the route
**Then** the route's `beforeLoad` hook redirects to `/auth/sign-in?next=...` if unauthenticated, OR shows a "forbidden" surface if authenticated-but-not-organizer (relying on `require-organizer` middleware from T1.6)

---

### Epic T3: Event, Group, Rules, Invites, Permissions

**User outcome:** Organizer creates the Pinehurst Event with roster + rule set + invite link; players tap invite and reach a schedule without any authentication wall.

**Entry criteria:**
- T1 + T2 exits met (DB + courses exist)

**Exit criteria (observable):**
- Pinehurst Event exists in prod DB with 8-player roster attached as a Group
- One `rule_set_revision` saved with 2v2-best-ball config (sandies toggle, auto-press-at-N trigger, press multiplier, `greenie_carryover` toggle, `greenie_validation` enum); a round in the Event pins `rule_set_revision_id`
- Invite link generated; tapping the invite link on a fresh browser session reaches a schedule view without triggering an SSO flow
- At least one player has `players.ghin` populated via the optional enrichment flow (verifies FR-E11 path works)
- At least one player has `players.ghin = NULL` with manual handicap on the Group — verifies non-GHIN players are fully supported
- Permissions middleware rejects non-organizer access to `/admin/*` (403) and non-scorer access to a round's scoring endpoints (403) — verified via integration test
- Sub-game opt-in UI allows per-round, per-player toggle for skins (other sub-game types return 501)

**Journeys served:** J1 (Josh organizer) primary, J3 (Mark reluctant — invite first-arrival flow) secondary.

**Stories:** 10 (T3.1–T3.10; T3.10 optional GHIN enrichment added 2026-04-18 post-Codex pass-3).

**Target-miss-tolerable:** none. All of T3 is trip-critical (event/rule/invite/permissions is the foundation for every user-facing flow).

**FRs covered:** FR-A1, FR-A5, FR-A6, FR-A7, FR-A9, FR-D1 (schema only — engine in T6), FR-E1, FR-E2, FR-E7 (timezone capture), FR-E11, FR-H1 (basic edit; mid-event edit in T5.11), NFR-S1

#### Story T3.1: Event + Group + Rule-Set + Invite + Sub-Game + Device-Binding Schema

As a developer,
I want events + event_rounds + groups + group_members + rule_sets + rule_set_revisions + invites + sub_games + sub_game_participants + device_bindings tables defined, plus the `players` table extended with full identity columns beyond T1.6's minimal slice,
So that event creation, roster management, rule-set editing, invite flows, sub-game opt-ins, and "that's me" device claims have durable schema that's fully executable in T3 sequence without forward dependencies.

**Acceptance Criteria:**

**Given** `db/schema/events.ts`
**When** inspected
**Then** it defines `events(id TEXT PK — app-generated opaque identifier, name, start_date, end_date, timezone TEXT — IANA, organizer_player_id FK → players.id, created_at)` + `event_rounds(id PK, event_id FK → events.id, round_number, round_date, course_revision_id FK → course_revisions.id, tee_color TEXT, created_at)` + `invites(id PK, event_id FK, token TEXT UNIQUE, expires_at, created_by_player_id FK, created_at)`. **`invites` is event-scoped only** — no `player_id` column (per-player invites are a v1.5+ feature).

**Given** `db/schema/groups.ts`
**When** inspected
**Then** it defines `groups(id PK, event_id FK → events.id, name, money_visibility_mode TEXT CHECK IN ('open','participant','self_only') DEFAULT 'open', created_at)` + `group_members(group_id FK, player_id FK, PRIMARY KEY(group_id, player_id))`. Only `open` mode is exercised in v1; schema column defaults position v1.5 to add the other modes without migration.

**Given** `db/schema/rules.ts`
**When** inspected
**Then** it defines `rule_sets(id PK, name, created_at)` + `rule_set_revisions(id PK, rule_set_id FK, revision_number, config_json TEXT, created_at)`. Rule sets are tenant-scoped (tenant_id from `_columns.ts`) per FD-8.

**Given** the extended `players` table (building on T1.6's minimal slice)
**When** inspected
**Then** columns added: `name TEXT NOT NULL`, `ghin TEXT UNIQUE` (nullable; partial unique index where non-null), `google_sub TEXT UNIQUE` (nullable; partial unique index), `apple_sub TEXT UNIQUE` (nullable; partial unique index — v1.5 use only), `manual_handicap_index REAL` (nullable — for non-GHIN players or outage fallback), `preferred_tee_color TEXT` (nullable). Migration is additive (ALTER TABLE ADD COLUMN), non-destructive to T1.6's minimal schema.

**Given** `db/schema/players.ts` (continued)
**When** inspected
**Then** `device_bindings(id PK, player_id FK → players.id, session_id FK → sessions.session_id NULLABLE, device_info TEXT, created_at)` is defined. **`session_id` is NULLABLE** to support the invite-link "that's me" claim flow (FR-E1 / T3.6) where the device claims a `player_id` BEFORE any SSO has happened (no session row exists yet). When SSO later occurs (T3.7), the device_binding's `session_id` is updated to link the new sessions row to the previously-claimed device.

**Given** `db/schema/subgames.ts`
**When** inspected
**Then** it defines `sub_games(id PK, event_round_id FK → event_rounds.id, type TEXT CHECK IN ('skins','ctp','sandies','putting_contest'), config_json TEXT, buy_in_per_participant REAL DEFAULT 0, created_at)` + `sub_game_participants(sub_game_id FK → sub_games.id, player_id FK → players.id, opted_in_at, PRIMARY KEY(sub_game_id, player_id))`. **Sub-games FK to `event_rounds` (T3.1 scope), not to the scoring `rounds` table (T5.1)** — sub-games are a setup-time entity; T6.13 dispatcher joins `sub_games` via `event_round_id` to the scoring `rounds` row at compute time. T6.13 narrows to adding `sub_game_results` + the dispatcher; the opt-in setup schema lives here.

**Given** `context_id` stamping rules (FD-6)
**When** application code inserts rows
**Then** events are stamped at insert with `context_id = 'event:' + event.id` (opaque; generated before insert); child rows (event_rounds, groups, group_members, invites, device_bindings, sub_games, sub_game_participants) inherit parent event's `context_id`; rule_sets and rule_set_revisions are tenant-scoped using `context_id = 'library:{tenant_id}'` (parallel to courses per T2.1); write-once everywhere.

**Given** `drizzle-kit generate`
**When** run after schema additions
**Then** a migration file with the next ordinal (0003 or later; T1.6 is 0001, T2.1 is 0002) is produced; `drizzle-kit migrate` runs cleanly on a fresh DB and as an additive migration on a T2-populated DB

#### Story T3.2: Event Creation Wizard

As an organizer (Josh),
I want a multi-step form that creates an Event with its rounds + initial Group + invite link in a single flow,
So that I can stand up Pinehurst 2026 without manually stitching together sub-resources.

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/admin/events.new.tsx` (gated by `require-organizer` from T1.6)
**When** rendered
**Then** it presents a 3-step form: (1) basics — name, start_date, end_date, timezone (defaulted from the organizer's browser tz, editable to any IANA tz); (2) rounds — one row per round with round_date, course picker via `GET /api/courses` (T2.2), tee_color; (3) review + submit

**Given** a valid submit
**When** `POST /api/admin/events` fires
**Then** the API creates `events` + N `event_rounds` + 1 `invites` row + 1 initial Group (default name `"{Event Name} Crew"`) in a single `db.transaction(async (tx) => { ... })` (architecture step-5 transaction-boundary rule); `events.context_id` = `'event:' + events.id`; child rows inherit

**Given** form validation
**When** running client-side via Zod
**Then** end_date ≥ start_date; each round_date is within [start_date, end_date]; each course_revision_id exists in the GET /api/courses response; timezone is a valid IANA string

**Given** a non-organizer caller
**When** hitting `/admin/events/new` or `POST /api/admin/events`
**Then** the route/API returns 403 (via `require-organizer` middleware); `beforeLoad` redirects to `/auth/sign-in?next=...` if unauthenticated

#### Story T3.3: Group CRUD UI

As an organizer,
I want to manage the Pinehurst Crew Group's roster (add/remove players; view members) and set its money_visibility_mode (v1 locked to `open`; others stubbed),
So that I can shape the 8-player Pinehurst roster from within the app.

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/admin/groups.$groupId.edit.tsx` (gated by require-organizer)
**When** rendered
**Then** it shows: group name (editable); list of current `group_members` with player name + GHIN (if set) + handicap source (GHIN-derived vs manual); "Add Player" action; "Remove Player" action per member; money_visibility_mode selector (radio or dropdown)

**Given** "Add Player"
**When** invoked
**Then** a search form allows GHIN lookup (via T3.4 client) OR manual entry (name + optional manual handicap); on match, a new `players` row is created (or existing player reused if already in DB); a `group_members` row is inserted linking `group_id` + `player_id`

**Given** "Remove Player"
**When** invoked
**Then** the `group_members` row is deleted; the `players` row remains (player may exist in other groups or across events)

**Given** the money_visibility_mode selector
**When** the user selects `open` / `participant` / `self_only`
**Then** v1 accepts only `open` on save; `participant` and `self_only` display a "v1.5" tooltip and are disabled in the UI; schema column stores the value so v1.5 enabling is zero-migration

#### Story T3.4: [port] GHIN Client

As a developer,
I want Wolf Cup's GHIN client ported into tournament-api with a provenance header + PORTS.md entry,
So that GHIN lookup + search works in tournament without touching Wolf Cup source and without violating the engine-boundary rule.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/lib/ghin-client.ts`
**When** inspected
**Then** the file begins with a provenance header: `/* PORTED from apps/api/src/lib/ghin-client.ts @ commit {sha} (dated YYYY-MM-DD). Scope: lookup-by-GHIN-number + search-by-name-state. Known deltas from source: none at port time. */` (matching step-3 Port Provenance Protocol)

**Given** `apps/tournament-api/PORTS.md`
**When** inspected
**Then** an entry exists with columns: Target file, Source file, Source commit, Ported-on date, Deltas, Last-checked-for-updates. The source commit SHA is the exact SHA from Wolf Cup's `apps/api/src/lib/ghin-client.ts` at port time.

**Given** `GET /api/players/search?name=&state=` (gated by require-session — any authenticated player can search)
**When** invoked
**Then** the endpoint returns GHIN search results matching Wolf Cup's response shape (`{ results: [...] }` per the `res.results` pattern from memory 2026-03-20)

**Given** `GET /api/players/lookup?ghin=<number>`
**When** invoked
**Then** returns the single GHIN record's details or 404 if not found; handles GHIN service outage with 503 (not a 500)

**Given** `.env.example`
**When** inspected
**Then** `GHIN_USERNAME` and `GHIN_PASSWORD` are documented (matching Wolf Cup's `docker-compose.yml:16-17`); the tournament-api container reads them via `src/lib/env.ts`

#### Story T3.5: Rule-Set Editor (tenant-scoped, revisioned)

As an organizer,
I want to edit and save named rule sets at tenant scope with revision-aware history (per FD-8),
So that "Pinehurst stakes" is reusable across events and historical rounds stay pinned to the exact config they were played under.

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/admin/rule-sets.$id.edit.tsx` (gated by require-organizer)
**When** rendered
**Then** the form covers 2v2 best-ball config: sandies toggle, auto-press trigger (N-down number, default `N = 2`), press multiplier (default `2x`), `greenie_carryover` toggle (default off per FD-12), `greenie_validation` enum (`2-putt` when carryover on; `none` otherwise), individual-bet defaults (match play $/hole with optional N-down auto-press), per-round buy-in defaults for sub-games

**Given** a save
**When** `POST /api/admin/rule-sets/:id/revisions` fires
**Then** a new `rule_set_revisions` row is inserted with `revision_number = current_max + 1` and `config_json` serialized from the form; existing `rule_set_revisions` rows are untouched (history preserved per FD-8)

**Given** an Event pinning a previous `rule_set_revision_id`
**When** the rule set is edited
**Then** the pinned revision on that Event does NOT change; the Event continues to use its pinned revision for money computation (FD-8 immutability of historical context)

**Given** client-side validation
**When** the form is submitted
**Then** Zod enforces: auto-press N is an integer 1-4; press multiplier is a positive number; greenie_validation matches enum when carryover is on

#### Story T3.6: [revised] Invite-Link First-Arrival Flow (no SSO)

As a player tapping an invite link for the first time,
I want to see "you're in" + the schedule without any sign-in,
So that first-arrival friction is zero on setup day (FR-E1 revised 2026-04-18).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/invite.$token.tsx`
**When** a player taps the invite link
**Then** the route validates `token` against the `invites` table; on valid + not-expired, it displays a roster-picker ("Tap your name") populated from the event's `group_members`. **Per-player pre-fill is NOT supported in v1** — `invites` is event-scoped only (no `player_id` column per T3.1 schema); player identity comes from the user's name-tap action, not from the invite token alone. (Per-player invite share-targeting is a v1.5+ feature requiring an `invited_player_id` column addition to `invites`.)

**Given** the player taps their name from the roster
**When** the confirm action fires
**Then** `POST /api/invites/:token/claim` with body `{ playerId }` creates a `device_bindings` row with `player_id = :playerId`, `session_id = NULL` (per T3.1 nullable `session_id`), `device_info` from request headers; the API sets a transient device-id cookie on the response so subsequent invite-scoped reads recognize the device; NO SSO flow is triggered

**Given** a claimed device
**When** the player navigates to schedule/leaderboard/pairings/course-preview routes
**Then** all read-only surfaces render correctly scoped to the Event (FR-E2); the player appears "you're in" without a sign-in page ever appearing

**Given** an expired or invalid token
**When** the route is loaded
**Then** an error surface displays with messaging to request a new invite; no claim is written

**Given** this story
**When** examined for SSO touchpoints
**Then** no SSO flow is exercised; SSO triggers only on the first MUTATION (score entry in T5, photo upload in T7, admin action in admin routes); covered in those epics

#### Story T3.7: Post-SSO Device Cookie + "That's Not Me" Re-bind

As a player completing SSO on a device,
I want my session cookie bound to my player_id + google_sub, with a "that's not me" escape hatch,
So that the device is correctly identified for scoring/mutating flows, and I can recover if the app mistakenly identified me as someone else.

**Acceptance Criteria:**

**Given** the `/auth/callback` handler (builds on T1.6 auth flow)
**When** Google SSO returns a `google_sub`
**Then** the handler looks up `players.google_sub = :sub`; if found, binds the session to that player; if not found, looks for a `device_bindings` row on the current device (tracked by the transient device-id cookie from T3.6) with `players.google_sub IS NULL`, and retroactively sets that player's `google_sub` + creates a sessions row + updates the device_binding's `session_id` from NULL to the new session's id (claims the invite-linked player at first SSO)

**Given** no matching player + no unclaimed device binding
**When** the SSO completes
**Then** a new `players` row is created with `google_sub` set (rare case — SSO before invite, e.g., from a bookmark); player has `ghin = NULL`, `name` inferred from Google profile (can be edited later via T3.10 profile)

**Given** a "That's not me" action on any authenticated page
**When** invoked
**Then** the current session is invalidated (cookie cleared, `sessions` row deleted); any `device_bindings` for the current device are cleared; the user is redirected to the invite flow or `/auth/sign-in`

**Given** a session with a player_id that already has `google_sub` set to a different value than the SSO response returned
**When** the callback runs
**Then** the API refuses (409 Conflict with clear error) — prevents accidental re-binding; explicit re-binding is an admin action (`player_identity_merges` in T5+)

#### Story T3.8: Permissions Middleware — Event-Level Role Matrix

As a developer,
I want the permissions middleware covering event-level roles (participant, invite-token spectator) beyond T1.6's minimal (session, organizer) slice,
So that every event-scoped route enforces the correct access level. Scorer-specific middleware is intentionally deferred to T5 where its schema dependencies exist.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/middleware/require-event-participant.ts`
**When** inspected
**Then** returns 403 unless `session.player_id` is a `group_members.player_id` for some `groups.event_id = :event_id`

**Given** `apps/tournament-api/src/middleware/require-invite-token.ts`
**When** inspected
**Then** validates a URL/cookie invite token against the `invites` table; on valid, attaches `{ invite: { event_id, invite_id } }` to the request context (**event-scoped only** — invites are not player-scoped per T3.1 schema; if a handler needs player_id, it looks up the device_binding separately); on invalid/expired, returns 401

**Given** the T1.6 middleware (`require-session`, `require-organizer`)
**When** tournament-api is inspected
**Then** those middleware are unchanged and continue to work alongside the new additions

**Given** `src/middleware/*.integration.test.ts` per middleware
**When** `pnpm test` runs
**Then** at least one integration test per middleware covers positive + 401/403 negative cases

**Note (sequencing):** `require-scorer-for-round` middleware is intentionally NOT in this story. It depends on the `scorer_assignments` table which lands in T5.1; the middleware itself is added in **T5.6 (single-writer enforcement)** where its dependencies exist. T3.8 ships the role-matrix middleware that's exercisable in epic-T3 sequence; scorer-specific gating arrives with the scoring epic.

#### Story T3.9: Sub-Game Opt-In UI on Round Setup

As an organizer,
I want a per-round per-player sub-game opt-in toggle (v1 exposes skins only; ctp/sandies/putting-contest are schema stubs per FD-10/FD-11),
So that subsets of players can join skins pots and future sub-games register through the same flow.

**Acceptance Criteria:**

**Given** a round-setup surface (either within T3.2 event creation flow OR a standalone per-round opt-in page)
**When** rendered
**Then** for each recognized sub-game type, a per-player opt-in toggle + pot buy-in field is shown; v1 shows `skins` enabled; `ctp`/`sandies`/`putting-contest` shown but disabled with a "v1.5" tooltip

**Given** opt-ins submitted
**When** the save fires
**Then** `POST /api/event-rounds/:eventRoundId/sub-games` creates `sub_games` rows (one per type opted-in for the round) + `sub_game_participants` rows (one per opted-in player per sub-game). Schema lives in T3.1 (`sub_games` + `sub_game_participants` tables). The **dispatcher + `sub_game_results`** are created in T6.13 (which reads T3.1's setup rows at compute time). This story is fully executable in T3 sequence — no forward dependency on T6.13.

**Given** non-opted-in players
**When** the round scorer submits hole scores (in T5)
**Then** non-opted-in players' scores don't affect sub-game pot calculations; only opt-ins contribute to and draw from the pot (enforcement is in T6.13 compute logic; this story writes the opt-in state)

#### Story T3.10: Optional GHIN Enrichment Profile Action

As a player,
I want a "Link your GHIN" button in my profile that I can use any time post-SSO,
So that I can opt into cross-event stats without having GHIN block my ability to play (FR-E11 revised 2026-04-18).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/profile.tsx` (gated by require-session)
**When** `players.ghin` is NULL for the current player
**Then** a "Link your GHIN" button appears; clicking opens a form with inputs: GHIN number (direct lookup) OR name + state (search)

**Given** the player submits the form
**When** `POST /api/players/me/ghin/link` fires
**Then** the API invokes T3.4 GHIN client; on single match, sets `players.ghin` + returns the linked record; on multiple matches, returns a disambiguation payload listing candidates with enough detail (club name, city) for the player to pick the right one (e.g., Matt W vs Matt J); on no matches or lookup failure, returns a descriptive error; on retry after an outage, the player may try again later

**Given** `players.ghin` is populated
**When** the profile is viewed
**Then** a "GHIN linked: <number>" label appears with an "Unlink" action

**Given** "Unlink" is invoked
**When** confirmed via a dialog
**Then** `PATCH /api/players/me/ghin` sets `players.ghin = NULL`; the player record stays valid; re-linking requires repeating the flow

**Given** this entire story
**When** examined for blocking behavior
**Then** at no point does GHIN being NULL OR lookup failing break the player's ability to use the app; handicap index may be entered manually via `players.manual_handicap_index` (separate form field on profile, NOT linked to GHIN state)

---

### Epic T4: Pairings

**User outcome:** Organizer locks pairings across 4 rounds and exports a printable PDF as paper fallback for trip-day.

**Entry criteria:**
- T3 exit met (Event + Group + rule set exist)

**Exit criteria (observable):**
- 4 rounds × 2 foursomes of pairings locked for the Pinehurst Event in prod
- Organizer UI supports pinning individual players to specific groups + locking whole rounds + regenerating unpinned slots
- PDF export generates for the full Event schedule + pairings + roster + handicaps
- Generated PDF opens without errors in a standard PDF viewer on both desktop and mobile
- PDF is downloadable via standard browser share/download mechanisms on mobile

**Journeys served:** J1 (Josh organizer) primary.

**Stories:** 3 (T4.1–T4.3)

**Target-miss-tolerable:** T4.1 (pairings optimizer — manual pin/lock UI is enough for an 8-player, 4-round event)

**FRs covered:** FR-A8, FR-F1, FR-F2, FR-H4

#### Story T4.1: [target-miss tolerable] Pairings Suggest Engine

As a developer,
I want `suggestPairings(roster, numRounds, constraint, pins)` as a pure function that produces a pairings grid minimizing repeats,
So that organizers have a "Suggest Pairings" button that produces a reasonable starting point (target-miss: T4.2 manual pin/lock covers Pinehurst entirely if this slips).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/engine/pairings/suggest.ts`
**When** inspected
**Then** it exports `suggestPairings({ roster: PlayerId[], numRounds: number, foursomeSize: number, constraint: 'everyone-once' | 'custom', pins?: Array<{ round: number, foursome: number, playerId: PlayerId }> }): { grid: PairingsGrid, warnings: string[] }` as a pure function with no DB / I/O / env access. Return shape is explicit — `grid` is always populated; `warnings` is an array of strings (empty on full success; populated when constraints can't be fully satisfied given pins).

**Given** 8 players × 4 rounds × foursomes-of-4 with `constraint: 'everyone-once'` and no pins
**When** invoked
**Then** the returned `grid` has every player pair sharing at least one foursome across the 4 rounds (verifiable via test assertion over all C(8,2)=28 pairs); `warnings` is an empty array

**Given** the same input twice
**When** invoked
**Then** the output is byte-for-byte identical (deterministic; no unseeded randomness). If randomness is needed for variety, the seed is an explicit parameter on the input.

**Given** a partial `pins` array (e.g., pin Josh+Ben to round 1 foursome 1)
**When** invoked
**Then** the returned `grid` honors every pin verbatim; remaining unpinned slots are permuted around the pins to maintain the constraint where possible; if the constraint cannot be satisfied given the pins, the returned `warnings` array lists each violated constraint as a descriptive string (does NOT throw)

**Given** `apps/tournament-api/src/engine/pairings/suggest.test.ts`
**When** `pnpm -F @tournament/api test` runs
**Then** at least three golden-file fixtures pass: (a) 8-player × 4-round everyone-once with no pins (warnings empty), (b) partial-pinned regenerate (verify pins honored + remaining slots permuted), (c) fully-pinned no-regen case (suggest returns the pinned grid unchanged with empty warnings); plus an 8-player all-pairs-met assertion

**Note:** This story is target-miss-tolerable per PRD sequencing. Josh can hand-construct 8 foursomes for Pinehurst if the optimizer slips; T4.2 manual pin-and-save is the trip-critical path AND must function fully without this story landing.

#### Story T4.2: Pairings UI + Persistence

As an organizer,
I want a pairings grid UI with hand-assign / pin / lock / save / refresh / export AND a `pairings` + `pairing_members` schema with slot-order preservation,
So that I can produce 4 rounds × 2 foursomes for Pinehurst entirely by hand if needed, and T5 scoring can look up each round's foursomes deterministically.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/db/schema/pairings.ts`
**When** inspected
**Then** it defines `pairings(id PK, event_round_id FK → event_rounds.id, foursome_number INTEGER, locked BOOLEAN DEFAULT false, created_at, UNIQUE(event_round_id, foursome_number))` + `pairing_members(pairing_id FK → pairings.id, player_id FK → players.id, slot_number INTEGER, PRIMARY KEY(pairing_id, player_id), UNIQUE(pairing_id, slot_number))`. Both tables carry `tenant_id` + `context_id` (inherited from parent event). `slot_number` preserves cell order (1..foursomeSize). Drizzle migration runs cleanly as an additive migration on the post-T3 schema.

**Given** the API endpoint `POST /api/events/:eventId/pairings`
**When** a save is submitted
**Then** the API validates that NO player_id appears in more than one pairing for the same event_round (cross-pairing uniqueness check at the application level since this constraint isn't enforceable via simple table constraints); on violation returns `422 { error: 'duplicate_player', code: 'player_in_multiple_pairings_per_round', requestId, conflicts: [{ player_id, round, foursomes: [a, b] }] }`

**Given** `apps/tournament-web/src/routes/admin/events.$eventId.pairings.tsx` (gated by `require-organizer`)
**When** rendered for an Event with N event_rounds
**Then** a grid displays N rows (rounds) × 2 columns (foursomes for Pinehurst; generalizes) × 4 cells (players per foursome). Each cell shows the assigned player's name; empty cells show a placeholder. **The full hand-assign workflow (drag-drop or tap, pin, lock, save, refresh, export) functions independently of T4.1** — if T4.1 has not landed, the "Regenerate unpinned" button is hidden or disabled with a "Manual entry only — suggest engine pending" tooltip; ALL other flows work end-to-end.

**Given** the grid UI with T4.1 available
**When** the organizer hits "Regenerate unpinned"
**Then** the button POSTs to `POST /api/events/:eventId/pairings/suggest` (which calls T4.1 engine) with current pins + locked rows; response fills only unpinned, unlocked cells; locked rows are untouched; any returned `warnings` from T4.1 surface as a banner above the grid

**Given** "Lock round" per-row
**When** clicked
**Then** all pairings in that row are marked `locked=true` (visually greyed); subsequent regenerate operations skip locked rows

**Given** "Save"
**When** clicked
**Then** the API upserts pairings + pairing_members rows in one `db.transaction(...)` (step-5 transaction-boundary rule) with slot_number preserved per cell ordering; idempotent — re-saving the same grid state results in zero row changes; cross-pairing player-uniqueness check runs server-side per the validation AC above

**Given** a saved grid state
**When** the page is refreshed OR another organizer device opens it
**Then** the grid reloads the persisted state verbatim from `GET /api/events/:eventId/pairings` (slot_number preserves cell order)

**Given** a non-organizer caller
**When** hitting the route or API
**Then** 401 / 403 as appropriate via `require-organizer`

#### Story T4.3: [port] PDF Schedule + Pairings Export

As any Event participant,
I want a "Export PDF" action that generates a printable Event schedule + pairings + roster + handicaps,
So that the trip has a paper fallback if the app fails day-of (FR-F1, FR-F2, FR-H4).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/lib/pdf-gen.ts`
**When** inspected
**Then** it begins with a provenance header citing **the concrete Wolf Cup source file path(s) used for the PDF pipeline + the exact commit SHA at port time** (NOT a memory citation). The dev agent doing the port must grep Wolf Cup's source for the existing PDF generation implementation (e.g., `apps/api/src/lib/pdf-gen.ts` if extant, or `reference/wolf-cup-marketing.html`/`-admin-guide.html` templates + the headless-Chrome script that renders them) and cite the actual paths + SHA. Provenance header format: `/* PORTED from {actual/wolf/cup/path.ts (and template paths if any)} @ commit {sha} (dated YYYY-MM-DD). Scope: ... */`

**Given** `apps/tournament-api/PORTS.md`
**When** inspected
**Then** an entry exists for `pdf-gen.ts` with the same concrete source path(s) + commit SHA + ported-on date + any deltas from source. The entry is auditable: any future developer can `git show {sha}:{source-path}` to compare against tournament's copy.

**Given** `POST /api/events/:eventId/pdf/schedule` (gated by `require-event-participant` from T3.8 — any participant can generate; FR-H4 "any participant")
**When** invoked for a fully-configured Event
**Then** the response returns a PDF blob with `Content-Type: application/pdf` + `Content-Disposition: attachment; filename="...schedule.pdf"`. The PDF renders:
- Event title, date range, timezone
- Per-round section: round number, round date, course name + tees, the two foursomes (player name + handicap index per row, in `slot_number` order from T4.2)
- Full roster table with handicaps

**Given** the generated PDF
**When** opened on iOS Safari AND desktop Chrome PDF viewers
**Then** it renders without errors or missing fonts; page breaks occur naturally (no row splits across pages); text is selectable (not rasterized)

**Given** an Event with no pairings yet saved (T4.2 not run)
**When** the PDF is requested
**Then** the API returns HTTP 422 `{ error: 'pairings_missing', code: 'event_pairings_not_saved', requestId }` — caller should run T4.2 first

**Given** a non-participant caller (no `group_members` row for this event)
**When** invoked
**Then** HTTP 403 via `require-event-participant`

---

### Epic T5: Scoring, Offline Sync, Leaderboard

**User outcome:** Scorer enters hole scores quickly and offline-tolerantly; spectators see the cross-group leaderboard updating live; score corrections are auditable; mid-event rule edits recompute forward without drift.

**Entry criteria:**
- T3 + T4 exits met (Event + roster + rule set + pairings exist)

**Exit criteria (observable):**
- A 9-hole practice foursome is scored end-to-end with scores committed to prod DB
- At least 3 of those 9 holes are scored with the device in airplane mode and merge on reconnect without data loss (NFR-R2)
- Leaderboard visible on a second device (non-scorer) reflects the first device's commits within 30 seconds under typical connectivity (NFR-P2)
- Deliberate 409-collision integration test passes in CI (two clients, same roundId+holeNumber+playerId, different clientEventId; first gets 200, second gets 409 with `conflictingEntry` payload) — covers D3-3 + T5.10
- Mid-event rule-edit path executes without money drift: a rule-config change with effective-hole boundary produces recomputed money from boundary forward; pre-boundary money is unchanged
- Score-correction audit log row exists for each correction with `actor_user_id`, `prior_value_json`, `new_value_json`, `request_id`, `created_at`
- Scorer handoff endpoint atomically transfers `scorer_assignments[round][group]` from one user to another; both devices observe the new state

**Journeys served:** J2 (Jeff scorer) primary, J3 (Mark viewing leaderboard) secondary.

**Stories:** 11 (T5.1–T5.11)

**Target-miss-tolerable:** none. T5.10 airplane-mode drill IS the validation story for the epic, not target-miss.

**FRs covered:** FR-B1..B10, FR-C1, FR-C2, FR-C5, FR-H1 (mid-event edit), FR-H2, FR-H3, NFR-P1, NFR-P2, NFR-R1, NFR-R2, NFR-R3, NFR-S3

---

### Epic T6: Rules Engine, Money, Bets, Settle-up

**User outcome:** 2v2 best ball + skins + carry-greenies + press/auto-press + cross-foursome individual bets all compute deterministically; head-to-head money is correct at end-of-trip settle-up for all player pairs including pairs that never shared a foursome; no spreadsheet needed.

**Entry criteria:**
- T5 exit met (scores flow end-to-end through the system)

**Exit criteria (observable):**
- Golden-file tests pass for: 2v2 best ball; skins (all 3 modes — gross, net, gross_beats_net); press + auto-press N-down trigger family; cross-foursome individual bets; carry-over greenies
- One full 4-player 4-round Pinehurst-shaped fixture computes identically to hand-calculation at both engine level AND HTTP-roundtrip level (T6.9 expanded test): `GET /events/:id/money` response matches the fixture byte-for-byte
- Head-to-head money matrix renders for all player pairs in the Event, including pairs that never shared a foursome
- Settle-up view shows per-player net balance + hole-by-hole drill-down of team + individual-bet contributions
- Skins column displays on leaderboard with carry count visible when a hole's pot carries
- Tie-break ordering observable and deterministic across a constructed tied scorecard fixture
- Auto-press fires silently on trigger condition; banner surfaces on affected players' views (visible; doesn't dismiss until acknowledged — D3-4)

**Journeys served:** J4 (Rick power user — cross-foursome bets) primary, J2 (Jeff + scorers — auto-press feedback in money surfaces) primary, J1 (Josh verifies settle-up) secondary. J2 spans T5 + T6 + T8 as multi-epic primary.

**Stories:** 14 (T6.1–T6.14)

**Target-miss-tolerable:** T6.7 (manual-press UI polish — capability must ship, aesthetic can lag), T6.8 (dedicated Bets page — Money page shows the same data until this ships)

**FRs covered:** FR-D1..D12, FR-H5, FR-H6, NFR-C1, NFR-C2

---

### Epic T7: Player Experience

**User outcome:** Non-scorer players and spectators have a screenshot-worthy, friction-free surface that makes the app content flow into the iMessage chat. Install prompt lands only for players who actually mutate state; browser-tab read-only browsing works for pure spectators.

**Entry criteria:**
- T3 exit met (Event + roster exist for player navigation)

**Exit criteria (observable):**
- Invite-link first-arrival flow lands a player on a schedule view without SSO (covered in T3, verified here as a full-flow test)
- Each round's schedule page displays course hero image, tee times, and the viewer's pairing for that round
- Course preview page shows per-hole detail (par, yardage, SI) with at least one hero image per course
- Photo gallery renders uploaded photos grouped per Event; upload from camera or library works on iOS
- In-app install prompt appears on first successful mutation for a player (verified on a real iOS device per T9.4)
- Browser-tab (non-installed) access to leaderboard, standings, pairings, and schedule renders without errors or 500s
- Opening a scorer surface in a non-installed browser tab triggers an install-required state (not a silent failure)
- Organizer-only raw-state JSON export downloads containing scores + rounds + players + rule config + money ledger + audit log

**Journeys served:** J3 (Mark reluctant) primary, J1 (Josh raw-state export) secondary.

**Stories:** 7 (T7.1–T7.7)

**Target-miss-tolerable:** T7.4 (photo gallery port — low-effort-but-permissible-to-defer)

**FRs covered:** FR-E3, FR-E4, FR-E5, FR-E6, FR-E8, FR-E9, FR-H7, NFR-B1, NFR-Dev1, NFR-P3

---

### Epic T8: In-App Engagement Surfaces

**User outcome:** Birdies, presses firing, lead changes, and award triggers surface inside the app as toasts / banners / feed entries. Players pull their phone out between shots, see the latest, screenshot to iMessage. Zero push, zero SMS, zero email — app creates pull, not push (FD-5).

**Entry criteria:**
- T5 + T6 exits met (scoring events + money state changes flow through the system and are available to emit into the spine)
- **Parallelism note:** T8.1 (activity table schema + `services/activity.ts` emitter stub) may land in parallel with T5 and T6 since its schema has no runtime dependency on T5/T6 outputs. Only T8.2–T8.4 (Toast, Banner, Feed UI components) require T5+T6 exits met for realistic event-flow verification. Helps sequencing risk: if T5 or T6 slips, T8.1 isn't blocked.

**Exit criteria (observable):**
- `activity` table receives rows for each of: score.committed, press.fired, bet.flipped, lead.changed, award.triggered
- Toast component renders on event commit; visible on a second device within 6 seconds of the emitting device's commit
- Banner component persists for money-affecting events (auto-press fire, bet flip) until user acknowledges; stacked banners collapse to a single "N updates" summary entry (protects against offline-drain-storm UX)
- Feed surface on player home shows reverse-chronological event list scoped to the current Event
- Production config audit confirms zero push-notification / SMS / email-notification infrastructure present (no VAPID keys, no APNs cert, no Twilio credentials, no email-send endpoints in the scope of FD-5)

**Journeys served:** J3 (Mark glance pattern) primary, J2 (Jeff + scorers — in-app banners on peer events) primary (J2 multi-epic primary spans T5 + T6 + T8).

**Stories:** 4 (T8.1–T8.4)

**Target-miss-tolerable:** all four stories. PRD sequencing explicitly lists T8 as target-miss-tolerable. Basic event spine can ship with minimal UI; polish banners + feed components can slip to the next window if trip-critical epics need time.

**FRs covered:** FR-C3, FR-C4

---

### Epic T9: Pre-Event Validation

**User outcome:** All 8 Pinehurst players can use the app on day 1 with confidence, OR a deliberate defer-to-next-window decision is documented with a clear punch list.

**Entry criteria:**
- T1–T8 exits all met, OR any unmet exit explicitly waived with written justification from Josh

**Exit criteria (observable):**
- A full 9-hole live foursome has been played end-to-end through the app at Guyan (Josh + Jeff + Ben + 1 more), including ≥3 offline holes; reported bugs either fixed or triaged-and-deferred. **T9.1 is the cross-epic integration test for the v1 plan** — exercising T3 (event + invites + roster) + T4 (pairings) + T5 (scoring + offline + leaderboard) + T6 (money + bets) + T7 (player UX surfaces) + T8 (engagement surfaces) end-to-end in one session. Pass → full stack works under real-world conditions. Fail → punch list drives defer/fix.
- Per-scorer-device install verification completed (T9.4): every designated scorer's device has the PWA installed, IndexedDB persists across app restart, and offline score entry → reconnect sync validated on that specific device
- SSO-outage drill completed: with Resend API key intentionally invalid in staging, mutation routes return 503 `{ error: 'auth_unavailable' }` and invite-link reads remain functional
- Deployment rollback drill completed: a post-T1 commit is tagged, prior tag is redeployed via `./deploy.sh`, functional rollback verified
- Release Gates for T9.2 (architecture validation section) all green OR documented exceptions with rationale
- **Validation against PRD §Measurable Outcomes table** — Pinehurst player adoption target (8/8), score entry speed (≤10s per hole), leaderboard latency (<30s), head-to-head money correctness (matches hand-calc), PDF fallback availability, Wolf Cup test suite still green, in-app engagement surfaces firing, offline sync drill passing, 9-hole foursome test passing
- Ship/defer decision documented: greenlight for target Event (May 7 at Pinehurst) OR deliberate defer-to-next-window decision with a written punch list of what must land before the next window

**Journeys served:** meta — validates all four PRD journeys before real players hit the app.

**Stories:** 4 (T9.1–T9.4; T9.4 per-device install verification added 2026-04-18 post-Codex pass-2)

**Target-miss-tolerable:** none. Validation is the gate.

**FRs covered:** validation against NFR-R2 (airplane-mode drill), NFR-C1 (hand-calc match), and the T9.4 install-verification gate covering FD-14 PWA-primary posture.
