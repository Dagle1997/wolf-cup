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
**Then** it defines `events(id TEXT PK — app-generated opaque identifier, name, start_date, end_date, timezone TEXT — IANA, organizer_player_id FK → players.id, created_at)` + `event_rounds(id PK, event_id FK → events.id, round_number, round_date, course_revision_id FK → course_revisions.id, tee_color TEXT, holes_to_play INTEGER NOT NULL DEFAULT 18 CHECK(holes_to_play IN (9, 18)), created_at)` + `invites(id PK, event_id FK, token TEXT UNIQUE, expires_at, created_by_player_id FK, created_at)`. **`invites` is event-scoped only** — no `player_id` column (per-player invites are a v1.5+ feature). **`holes_to_play` is locked at creation** (no mutation path v1): supports 9-hole rounds (Emergency 9 after 18; Member-Member-style two-9-match days; Fall tournament 9-hole matches). All 4 Pinehurst rounds default to 18. Multiple event_rounds can share a `round_date` — no uniqueness constraint — enabling 27-hole days (18 + 9) via two consecutive event_rounds.

**Given** `db/schema/groups.ts`
**When** inspected
**Then** it defines `groups(id PK, event_id FK → events.id, name, money_visibility_mode TEXT CHECK IN ('open','participant','self_only') DEFAULT 'open', created_at)` + `group_members(group_id FK, player_id FK, PRIMARY KEY(group_id, player_id))`. Only `open` mode is exercised in v1; schema column defaults position v1.5 to add the other modes without migration.

**Given** `db/schema/rules.ts`
**When** inspected
**Then** it defines `rule_sets(id PK, name, created_at)` + `rule_set_revisions(id PK, rule_set_id FK → rule_sets.id, revision_number INTEGER NOT NULL, config_json TEXT NOT NULL, effective_from_round_id FK → event_rounds.id NULLABLE, effective_from_hole INTEGER NOT NULL DEFAULT 1 CHECK(effective_from_hole BETWEEN 1 AND 19), created_by_player_id FK → players.id NOT NULL, reason TEXT NULLABLE, created_at)`. Rule sets are tenant-scoped (tenant_id from `_columns.ts`) per FD-8. **Mid-event rule-edit columns semantics** (per T5.11): `effective_from_round_id = NULL` means "effective from event start (round 1, hole 1)" — the baseline revision created at rule-set creation time; non-NULL points at the scheduled round where the boundary falls. `effective_from_hole = 19` means "effective from the NEXT scheduled round onward" (no effect on `effective_from_round_id`). FK target is `event_rounds.id` (setup-time schedule entity from T3.1 events.ts) NOT the scoring `rounds.id` (T5.1) — the scheduled round is the stable identity across the edit lifecycle; T6 money recompute joins through to scoring rounds at dispatch time.

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

**FRs covered:** FR-B1..B10, FR-C1, FR-C2, FR-C5, FR-H1 (mid-event edit), FR-H2, FR-H3, NFR-P1, NFR-P2, NFR-P3 (leaderboard path), NFR-R1, NFR-R2, NFR-R3, NFR-S3

#### Story T5.1: [extract] Scoring Schema (rounds, hole_scores, score_corrections, round_states, scorer_assignments)

As a developer,
I want the scoring-domain Drizzle schema — `rounds` (scoring runtime instance), `hole_scores` (Wolf Cup shape + `scorer_player_id` + `client_event_id`), `score_corrections`, `round_states`, `scorer_assignments` — landed as one additive migration,
So that every later T5 story (and T6/T8 downstream) has stable tables to write against from day one.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/db/schema/scoring.ts` + `apps/tournament-api/src/db/schema/audit.ts`
**When** inspected
**Then** they export these tables (all carrying `tenant_id` + `context_id NOT NULL` via the `_columns.ts` helper from T3.1):

- `rounds(id PK, event_id FK → events.id NULLABLE, event_round_id FK → event_rounds.id NULLABLE, holes_to_play INTEGER NOT NULL DEFAULT 18 CHECK(holes_to_play IN (9, 18)), opened_at NULLABLE, opened_by_player_id FK → players.id NULLABLE, created_at)` — both `event_id` and `event_round_id` are NULLABLE per FD-7 forward compat (standalone-round v1.5 shape); v1 always writes non-null. **`rounds.holes_to_play` mirrors `event_rounds.holes_to_play` at round-open time** (seeded from the parent event_round); locked once set. `opened_at` / `opened_by_player_id` are NULL pre-open and set on the first state transition out of `not_started` (T5.8).
- `hole_scores(id PK, round_id FK → rounds.id, player_id FK → players.id, hole_number INTEGER NOT NULL CHECK(hole_number BETWEEN 1 AND 18), gross_strokes INTEGER NOT NULL CHECK(gross_strokes >= 1), putts INTEGER NULLABLE, scorer_player_id FK → players.id NOT NULL, client_event_id TEXT NOT NULL, created_at, updated_at, UNIQUE(round_id, player_id, hole_number), UNIQUE(round_id, player_id, hole_number, client_event_id))`
- `score_corrections(id PK, round_id FK → rounds.id, player_id FK → players.id, hole_number INTEGER NOT NULL, actor_player_id FK → players.id NOT NULL, prior_value_json TEXT NOT NULL, new_value_json TEXT NOT NULL, request_id TEXT NOT NULL, reason TEXT NULLABLE, created_at)` — append-only; no UPDATE path v1
- `round_states(round_id PK/FK → rounds.id, state TEXT NOT NULL CHECK(state IN ('not_started','in_progress','complete_editable','finalized','cancelled')), entered_at NOT NULL, entered_by_player_id FK → players.id NULLABLE)` — current state only; historical transitions land in `audit_log` per T5.8
- `scorer_assignments(round_id FK → rounds.id, foursome_number INTEGER NOT NULL, scorer_player_id FK → players.id NOT NULL, assigned_at NOT NULL, assigned_by_player_id FK → players.id NOT NULL, PRIMARY KEY(round_id, foursome_number))`

**Given** the migration `{NNNN}_tournament_scoring.sql`
**When** `pnpm -F @tournament/api db:migrate` runs on a fresh DB (post-T3 + T4 migrations)
**Then** it applies cleanly as an additive migration; no existing table is modified; migration is forward-only (no `DROP`, no `ALTER TABLE ... RENAME`)

**Given** Wolf Cup's `apps/api/src/db/schema.ts` `holeScores` table
**When** compared to tournament's `hole_scores`
**Then** the Wolf Cup shape is preserved (same column names + types for the shared fields) and tournament adds exactly two new columns: `scorer_player_id` (FR-B10 attribution) and `client_event_id` (FD-3 / FD-5 offline idempotency). Provenance: `scoring.ts` header cites the Wolf Cup source path + commit SHA per Port Provenance Protocol; `apps/tournament-api/PORTS.md` has an entry.

**Given** the two overlapping UNIQUE constraints on `hole_scores`
**When** a client POSTs a second write to the same cell
**Then** (a) if `client_event_id` matches the existing row, `ON CONFLICT (round_id, player_id, hole_number, client_event_id) DO NOTHING` dedupes (T5.6 idempotent replay path); (b) if `client_event_id` differs, the tighter `(round_id, player_id, hole_number)` UNIQUE throws, surfacing the 409 path (T5.6 / T5.10). Codex verified this behavior locally on SQLite 3.50.4 with a dual-constraint repro.

**Given** `apps/tournament-api/src/db/schema/scoring.test.ts`
**When** `pnpm -F @tournament/api test` runs
**Then** table-existence + unique-constraint + foreign-key assertions pass on `:memory:` libsql; specifically a test inserts into the cell-level UNIQUE with two different `client_event_id` values to assert the 409 conflict target, and a second test inserts with identical `client_event_id` to assert the dedupe target.

#### Story T5.2: [port] Scorer Entry UI (iOS keyboard synchronous-focus fix intact)

As a scorer,
I want a scorer entry screen for `/rounds/:roundId/score-entry` that auto-advances across 4 players per hole with ≤10s interaction (NFR-P1) and keeps the iOS keyboard open across hole advances (Wolf Cup commit `ebe3cea`),
So that I can score a foursome of Pinehurst at the hoped-for cadence (FR-B2) without the keyboard flapping.

**Depends on:** T5.1 (`rounds` + `hole_scores` schema), T5.3 (offline queue for optimistic writes), T5.6 (server-side scorer gate — the UI is a courtesy; auth is enforced server-side).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/rounds.$roundId.score-entry.tsx`
**When** inspected
**Then** it begins with a provenance header citing the concrete Wolf Cup source path(s) (`apps/web/src/routes/score-entry/*`) + the commit SHA at port time + the specific `ebe3cea` commit referenced for the iOS-keyboard fix. Format: `/* PORTED from apps/web/src/routes/score-entry/{files} @ commit {sha} (dated YYYY-MM-DD). iOS-keyboard fix: commit ebe3cea. Scope: scorer UI, no wolf-decision logic. */`

**Given** `apps/tournament-web/PORTS.md`
**When** inspected
**Then** an entry exists for the scorer entry UI referencing the Wolf Cup source path(s) + commit SHA + port date + a delta note: "removed wolf-decision payload; added clientEventId to all mutations; scores-only + optional putts"

**Given** the scorer entry route
**When** rendered for a round that the current session is assigned scorer of (per T5.6)
**Then** the screen shows (a) the hole number, par, and SI; (b) four stable inputs — one per player in the foursome — with `key={player.id}` preserved across hole advances; (c) the "Save" / "Next hole" action

**Given** the user tapping the "Next hole" action on iOS Safari
**When** handled
**Then** the `onClick` synchronously calls `scoreInputRefs.current[0]?.focus()` inside the user-gesture — NOT inside a mutation's `onSuccess` callback (the keyboard-flap bug). React re-uses the same input DOM across hole change via stable `key`. (Per Wolf Cup 2026-04-12 fix.)

**Given** a hole score Save action
**When** invoked
**Then** the UI calls `enqueueMutation({ kind: 'hole_score', roundId, holeNumber, playerId, grossStrokes, putts?, clientEventId: uuid() })` via the T5.3 offline queue. The UI does NOT block on the network response — optimistic UI shows the score immediately with a "pending sync" chip until the queue flushes 200.

**Given** a hole where a player has no entry yet
**When** the scorer advances past the hole
**Then** the app rejects the advance with an inline validation banner ("4 scores required before advancing"), unless the scorer explicitly taps "Skip hole" (which writes nothing and logs nothing — just permits navigation)

**Given** a non-scorer session opening `/rounds/:roundId/score-entry`
**When** the route renders
**Then** the page renders a read-only placeholder directing them to the leaderboard; no score inputs are editable (T5.6 enforces server-side — this is a UX courtesy, not a security control)

**Given** any 1-screen interaction (tap a score input → type 4 digits → tap next player → type 4 digits ×3 → advance)
**When** measured against a familiar user
**Then** the full foursome-for-one-hole entry lands in ≤10s on a typical iOS 17+ device (NFR-P1). Acceptance is qualitative — observed during T9.1 9-hole drill — not a gated test in CI.

#### Story T5.3: [port] Offline Queue (IndexedDB) with clientEventId Idempotency

As a scorer,
I want an IndexedDB offline queue ported verbatim from Wolf Cup (`apps/web/src/lib/offline-queue.ts` + `useOfflineQueue` + `useOnlineStatus`),
So that score entry continues uninterrupted in dead-cell zones at Tobacco Road (NFR-R1 / NFR-R2 / FR-B3).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/lib/offline-queue.ts` + `apps/tournament-web/src/hooks/use-offline-queue.ts` + `apps/tournament-web/src/hooks/use-online-status.ts`
**When** inspected
**Then** each file begins with a provenance header citing the Wolf Cup source paths + commit SHA at port time. `apps/tournament-web/PORTS.md` has entries for all three.

**Given** the ported queue
**When** compared to Wolf Cup's version
**Then** the only deltas are:
  (a) IndexedDB DB name renamed `wolf-cup-offline` → `tournament-offline`
  (b) Entry type no longer carries `wolfDecision`; carries `clientEventId: string` (UUID v4, generated at enqueue time) on every entry
  (c) Entry payload kinds restricted to v1 scope: `'hole_score'`, `'sub_game_result'`, `'scorer_handoff'`, `'round_finalize'` — no wolf / greenie / polie kinds. Other v1.5+ kinds reject at enqueue with a type error.

**Given** the scorer enqueues N mutations while offline
**When** `online` becomes true (driven by `navigator.onLine` + ping heartbeat as in Wolf Cup)
**Then** the queue drains FIFO; each entry POSTs to the appropriate endpoint with `clientEventId` in the body; on 200 the entry is removed; on 409 the entry is held and the UI surfaces the D3-3 overwrite prompt (see T5.10); on any other 4xx/5xx the entry is retried with backoff (same pattern as Wolf Cup)

**Given** the same offline entry submitted twice (network flake after 200)
**When** the server receives the second POST with the same `clientEventId`
**Then** the server dedups via the composite UNIQUE on `(round_id, player_id, hole_number, client_event_id)` and returns 200 (idempotent success); no duplicate row inserted; no audit row for the dedup hit

**Given** the scorer on the entry screen with queued mutations
**When** rendered
**Then** a persistent sync chip visible in the header shows "3 queued" / "syncing…" / "all synced" states; the chip is the port of Wolf Cup's equivalent UI — do not redesign

**Given** `apps/tournament-web/src/lib/offline-queue.test.ts`
**When** `pnpm -F @tournament/web test` runs
**Then** unit tests cover (a) enqueue → dequeue order, (b) dedupe on identical `clientEventId`, (c) 409 retention path (entry stays in queue, overwrite prompt event fires), (d) corrupted entry quarantine (entry moved to `errored` bucket, not lost). Wolf Cup's existing test cases port over; tournament adds the `clientEventId` dedupe case.

#### Story T5.4: [port] Offline Course + Scorecard Shell Cache

As a scorer,
I want the active round's course data + scorecard shell cached locally the moment the round is opened online,
So that the scorer UI renders fully offline even on a cold PWA launch in the parking lot at Mid Pines (FR-B5).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/lib/round-cache.ts`
**When** inspected
**Then** it begins with a provenance header citing the Wolf Cup equivalent (scorecard-shell cache pattern; dev agent greps Wolf Cup source for the actual path + SHA at port time). Entry in `PORTS.md`.

**Given** the scorer opening a round's score-entry URL while online for the first time
**When** the route loads
**Then** the hook fetches `GET /api/rounds/:roundId` (round meta) + `GET /api/events/:eventId/rounds/:roundId/course` (course revision: 18 holes × par, SI, yardage per tee) + `GET /api/events/:eventId/pairings` (filtered to this round) and persists each response into IndexedDB (separate object store from the mutation queue; keyed by `roundId`)

**Given** the scorer closes the tab and later opens the route with zero connectivity
**When** the route loads
**Then** the scorecard shell renders from IndexedDB: course hole grid, pairings for this round, roster handicaps — all visible without any network call. The sync chip from T5.3 shows "offline"; no error banners.

**Given** a cached round where the course revision has since been superseded upstream (FD-8 / T2.4 revision)
**When** the client comes back online
**Then** the client refetches the course on re-connect and replaces the cached copy transparently; if a scorer is mid-entry, the UI surfaces a soft banner "course data updated — review hole SIs" but does NOT discard in-flight entry

**Given** a non-scorer participant loading the same route
**When** rendered
**Then** course + pairings cache same as scorer; no score inputs render (T5.2 UX)

#### Story T5.5: [new] Cross-Group Stroke-Play Leaderboard (v1)

As any Event participant,
I want a cross-group stroke-play leaderboard that ranks all players across all foursomes for the current Event, updating within 30s of upstream score commits (NFR-P2),
So that Mark can watch Pinehurst Day 2 from the clubhouse without bothering Jeff (FR-C1, FR-C2, FR-C5).

**Scope:** v1 is stroke-play only (gross + net through the rule-set's handicap-allowance config). Match-play formats and alternate primary-metric leaderboards are deferred to v1.5 when the rule-set contract can declare its own tie-break order; v1 hardcodes FR-C5 stroke-play tie-break.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/services/leaderboard.ts`
**When** inspected
**Then** it exports `computeLeaderboard(eventId: EventId, { roundId?: RoundId, scope: 'round' | 'event' }): LeaderboardRow[]` as a query-service function (reads-only — per step-5 services layer split; never writes). `LeaderboardRow` shape: `{ playerId, playerName, handicapIndex, grossThroughHole, netThroughHole, throughHole, rank, tiedWith: number }`.

**Given** a round in progress with partial scores
**When** `computeLeaderboard(eventId, { roundId, scope: 'round' })` is called
**Then** it returns rows sorted per FR-C5 stroke-play tie-break: gross strokes ascending → back-9 count-back (lower back-9 gross wins the tie) → hole-by-hole from 18 backward (first differing hole wins). **Once T6.10 lands, the service MUST delegate tie-break resolution to `breakTie()` from `apps/tournament-api/src/engine/rules/tie-break.ts` (one tie-break implementation only; no inlining).** Unscored players appear last with `grossThroughHole = null` and `throughHole = 0`.

**Given** an Event with multiple completed + in-progress rounds
**When** `computeLeaderboard(eventId, { scope: 'event' })` is called
**Then** rows aggregate across rounds (sum of gross strokes across all scored holes); tie-break order as above applied to the aggregated totals; `throughHole` represents the player's total scored holes across the event (e.g., a player through 18 of round 1 and 9 of round 2 shows `throughHole: 27`)

**Given** `GET /api/events/:eventId/leaderboard?round=<roundId | 'current'>`
**When** invoked by any Event participant (gated by `require-event-participant` from T3.8)
**Then** it returns `{ rows: LeaderboardRow[], round: {...}, computedAt: ISO }` — no caching v1; recompute on read per architecture decision

**Given** `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx`
**When** rendered
**Then** the page shows a single table: rank column, player name, handicap, thru hole, gross / net. The table polls `/leaderboard` every 15s via TanStack Query (so visible delta after an upstream commit is ≤15s + propagation ≈ within the 30s NFR-P2 envelope). No SSE / WebSocket in v1.

**Given** a scorer commits a score on their device
**When** another participant's leaderboard tab refreshes (next poll)
**Then** the new score is reflected in the row's `grossThroughHole` / `netThroughHole`; rank shifts are visible if the commit moved the player

**Given** a non-participant (no `group_members` row for this event) hitting the API or UI
**When** the request lands
**Then** 403 via `require-event-participant`

**Given** `apps/tournament-api/src/services/leaderboard.test.ts`
**When** tests run
**Then** at least three fixtures pass: (a) all 8 players tied with zero scores at round start (all rank=1, tiedWith=8), (b) mid-round with one player through 9 holes and others at hole 4 — ordering + thru values correct, (c) back-9 countback tie-break: two players with identical 18-hole totals, one has better back-9 → ranks correctly, (d) hole-by-hole from 18 backward tie-break: two players with identical 18-hole AND back-9 totals — first differing hole from 18 resolves

#### Story T5.6: [new] Score POST + require-scorer-for-round Middleware (single-writer enforcement)

As a developer,
I want `POST /api/rounds/:roundId/holes/:n/scores` behind a `require-scorer-for-round` middleware that checks `session.userId === scorer_assignments.scorer_player_id` for the foursome containing the target player,
So that a non-scorer participant physically cannot write scores — even if they construct the request by hand (FR-B10, NFR-S3, FR-H3).

**Depends on:** T4.2 (`pairing_members` join for foursome membership lookup), T5.1 (`scorer_assignments` + `hole_scores` + `round_states`).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/middleware/require-scorer-for-round.ts`
**When** inspected
**Then** it looks up which foursome the request's `playerId` belongs to for the target round (join `pairing_members` → `pairings` on `pairing_id` filtered by `event_round_id` resolving from `rounds.event_round_id`), retrieves `scorer_assignments.scorer_player_id` for `(round_id, foursome_number)`, compares against `session.userId` from the cookie, and: returns 401 on no session / 403 on mismatch `{ error: 'forbidden', code: 'not_scorer_for_this_foursome', currentScorerPlayerId, currentScorerName, requestId }` / 404 if the player is not in any foursome for this round / `next()` on match

**Given** `POST /api/rounds/:roundId/holes/:n/scores` with body `{ playerId, grossStrokes, putts?, clientEventId }`
**When** invoked by the assigned scorer (session matches)
**Then** the handler opens `db.transaction(async (tx) => { ... })` that:
  (a) validates the round's `round_states.state ∈ ('in_progress', 'complete_editable')` — other states return 422
  (b) executes `tx.insert(holeScores).values({...}).onConflictDoNothing({ target: [holeScores.round_id, holeScores.player_id, holeScores.hole_number, holeScores.client_event_id] })` — explicit target specification is required; bare `ON CONFLICT DO NOTHING` would swallow the tighter cell-level UNIQUE 409 path per Codex SQLite repro
  (c) on insert of a NEW cell (no prior row for `(round_id, player_id, hole_number)`): `writeAudit(tx, { action: 'score.committed', actor, prior: null, new })` + `emitActivity(tx, { type: 'score.committed', ... })`
  (d) on conflict with a DIFFERENT `clientEventId` (cell already has a row — the tighter UNIQUE throws): catch, return 409 `{ error: 'conflict', code: 'hole_already_scored', conflictingEntry: { scorer_player_id, created_at, client_event_id } }` — no audit row written; no activity emitted (D3-3)
  (e) on conflict with the SAME `clientEventId` (idempotent replay — handled by the composite UNIQUE + `onConflictDoNothing`): return 200 `{ status: 'ok', clientEventId, deduped: true }` — no audit row written; no activity emitted

**Given** a score commit that transitions the round from `not_started` → `in_progress`
**When** handled
**Then** the transaction ALSO updates `round_states.state = 'in_progress'`, sets `rounds.opened_at = now()` + `rounds.opened_by_player_id = session.userId`, and writes an audit row for the state transition (T5.8 covers the full FSM; this AC covers the first-commit path specifically)

**Given** a non-scorer session POSTing the endpoint
**When** handled
**Then** 403 via `require-scorer-for-round`; zero rows inserted; no audit row written; response body includes `currentScorerName` for UX

**Given** a scorer POSTing for a `playerId` that is NOT in their assigned foursome (e.g., scoring someone from another group)
**When** handled
**Then** 403 `{ error: 'forbidden', code: 'player_not_in_your_foursome', requestId }` — integration test `scores.integration.test.ts` includes a constructed cross-foursome attempt

**Given** `apps/tournament-api/src/routes/scores.integration.test.ts`
**When** run
**Then** the co-located audit-row assertion passes: for each successful score commit, `score_corrections` is NOT written (that table is corrections only — T5.9); instead the generic `audit_log` row exists with `action='score.committed'`, `actor_player_id=session.userId`, `request_id` present. 409 path asserts no audit row. 403 path asserts no audit row. Idempotent-replay path asserts no audit row (`deduped: true` response).

#### Story T5.7: [new] Scorer Handoff Endpoint

As an organizer or the current scorer,
I want `POST /api/rounds/:roundId/scorer-assignments/transfer` that atomically reassigns a foursome's scorer from one player to another,
So that Jeff can hand off to Ben at the turn without dropping the queue or leaving both devices uncertain who's the scorer (FR-B7, FR-H2).

**Depends on:** T4.2 (`pairing_members` foursome membership), T5.1 (`scorer_assignments`), T5.3 (offline queue for stale-queue recovery).

**Acceptance Criteria:**

**Given** `POST /api/rounds/:roundId/scorer-assignments/transfer` with body `{ foursomeNumber, toPlayerId }`
**When** invoked
**Then** the handler is gated by a check that `session.userId` is EITHER the current `scorer_assignments.scorer_player_id` for `(roundId, foursomeNumber)` OR the Event's organizer (`events.organizer_player_id`). On mismatch: 403 `{ error: 'forbidden', code: 'not_authorized_for_handoff', requestId }`

**Given** `toPlayerId` is not a member of the foursome (per T4.2 `pairing_members` join)
**When** handled
**Then** 422 `{ error: 'invalid_assignee', code: 'assignee_not_in_foursome', requestId }` — scorers must be foursome members

**Given** a valid transfer request
**When** handled
**Then** `db.transaction(async (tx) => { ... })`:
  (a) `UPDATE scorer_assignments SET scorer_player_id=:toPlayerId, assigned_at=now(), assigned_by_player_id=session.userId WHERE round_id=:roundId AND foursome_number=:foursomeNumber` (atomic replace)
  (b) `writeAudit(tx, { action: 'scorer.transferred', actor, prior: { scorer_player_id: oldScorer }, new: { scorer_player_id: toPlayerId } })`
  (c) `emitActivity(tx, { type: 'scorer.transferred', roundId, foursomeNumber, from, to })`

**Given** two devices — the prior scorer's and the new scorer's — both polling the round
**When** the transfer commits
**Then** within one poll cycle (≤15s) the prior scorer's UI transitions to read-only ("Ben is now scoring") and the new scorer's UI unlocks the score inputs. The transition is driven by the `GET /api/rounds/:roundId` response including `scorer_player_id` + `scorer_name` per foursome — no sockets / SSE v1.

**Given** a pending offline mutation queued by the old scorer BEFORE the handoff
**When** that mutation drains after the handoff
**Then** the server's `require-scorer-for-round` middleware (T5.6) returns 403 because the session.userId no longer matches `scorer_player_id`. The 403 payload includes `currentScorerName` so the client UI can display "Ben is now scoring for foursome 1 — these queued scores were held; ask Ben to re-enter or request an admin correction (T5.9)." The client holds the entry in an `errored` bucket; no silent data loss.

**Given** `apps/tournament-api/src/routes/admin/scorer-assignments.integration.test.ts`
**When** run
**Then** audit-row assertion + activity-row assertion + the post-handoff 403-stale-queue scenario (asserting `currentScorerName` in the 403 payload) all pass

#### Story T5.8: [new] Round Lifecycle State Machine

As a developer,
I want a gated state machine for `round_states.state` with transitions `not_started → in_progress → complete_editable → finalized`, plus a terminal `cancelled` branch,
So that every downstream recompute (money, leaderboard, activity) knows what state to trust — and `finalized` is immutable via normal write paths (FR-B9, NFR-R3).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/services/round-state.ts`
**When** inspected
**Then** it exports `transitionState(tx, roundId, to: RoundState, actorPlayerId): Promise<void>` that enforces the allowed transitions:
  - `not_started → in_progress` (driven by first score commit, T5.6 AC)
  - `in_progress → complete_editable` (driven by all-cells-scored auto-detection OR by explicit `POST /api/rounds/:roundId/complete`)
  - `complete_editable → finalized` (organizer-only via `POST /api/rounds/:roundId/finalize`)
  - `complete_editable → in_progress` (organizer or scorer rollback if auto-complete fired prematurely — allowed before finalize only)
  - Any non-`finalized` state → `cancelled` (organizer-only, irreversible)
  Any disallowed transition throws `BusinessRuleError` → 422

**Given** `POST /api/rounds/:roundId/complete` by the organizer or the scorer of any foursome in the round
**When** invoked
**Then** the handler counts missing cells: expected count = `pairing_members.count_for_this_round × rounds.holes_to_play` (reads `holes_to_play` from the round itself; supports 9-hole rounds by scoping the check to holes 1..9 when `holes_to_play = 9`); actual count = rows in `hole_scores` filtered by `round_id` AND `hole_number <= rounds.holes_to_play`. If missing > 0, return 422 `{ error: 'round_incomplete', code: 'missing_holes', missingCells: [{ playerId, holeNumber }, ...], requestId }` — v1 requires fully-scored rounds to transition to `complete_editable`; WD/DNF handling deferred to v1.5 (2026 Pinehurst has no WD plan). If missing = 0, transition to `complete_editable` proceeds.

**Given** the T5.6 score-commit handler
**When** a commit causes the last-cell condition (all expected cells now filled)
**Then** the handler automatically invokes `transitionState(tx, roundId, 'complete_editable', session.userId)` within the same transaction — `complete_editable` is reached via auto-transition OR explicit POST; both paths converge on the same state

**Given** the finalization transition via `POST /api/rounds/:roundId/finalize`
**When** the handler runs
**Then** it wraps the following in `db.transaction(async (tx) => { ... })`:
  (a) re-verify all cells scored (defensive — state could have rolled back) — if missing, 422
  (b) money/leaderboard recomputation (T6 services reading via `tx`)
  (c) `round_states.state = 'finalized'` with `entered_at`, `entered_by_player_id = session.userId`
  (d) audit row `action='round.finalized'`
  (e) activity row `type='round.finalized'`
  If any step fails, the transaction rolls back → round remains in `complete_editable` (NFR-R3 atomic finalization; Wolf Cup precedent 2026-03-19)

**Given** the round is `finalized`
**When** the scorer POSTs a score mutation via T5.6
**Then** 422 `{ error: 'round_finalized', code: 'round_state_locks_writes', requestId }` — the only writable path to a finalized round is T5.9 score-correction (which creates an audit row AND re-triggers recompute)

**Given** `POST /api/rounds/:roundId/cancel` by the organizer
**When** handled
**Then** `round_states.state = 'cancelled'`; audit row `action='round.cancelled'` with actor; activity emits; subsequent score mutations return 422. Cancelled rounds are excluded from money + leaderboard computations (T6 services filter on `state != 'cancelled'`).

**Given** `apps/tournament-api/src/services/round-state.integration.test.ts`
**When** run
**Then** tests cover: legal transition matrix (happy path per state), every illegal transition (each throws), atomic finalize rollback (inject a computed failure — assert state reverts), finalized-lock (score POST returns 422), `/complete` missing-cells rejection (422 with `missingCells` array populated), auto-transition from last-cell commit (no explicit POST needed)

#### Story T5.9: [port] Score Correction Endpoint + Audit Log

As a scorer or organizer,
I want `POST /api/rounds/:roundId/scores/:playerId/:holeNumber/correct` that writes a `score_corrections` row AND updates `hole_scores` AND triggers downstream recompute,
So that Jeff can fix a miskeyed 4-that-should-have-been-5 on hole 11 of round 2 without voiding the whole round (FR-B6, FR-B8, NFR-R3).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/routes/admin/score-corrections.ts`
**When** inspected
**Then** it begins with a provenance header citing Wolf Cup's `apps/api/src/routes/admin/score-corrections.ts` + commit SHA at port time. `PORTS.md` entry exists with the source path + SHA + deltas: "added actor_player_id persistence per FR-B8; added FR-D9 visibility filter on response; added T5.8 state-machine integration (allowed in `complete_editable` and `finalized`, rejected in `not_started` / `cancelled`)."

**Given** `POST /api/rounds/:roundId/scores/:playerId/:holeNumber/correct` with body `{ grossStrokes, putts?, reason? }`
**When** invoked
**Then** it's gated to `require-scorer-for-round` OR `require-organizer` (either can correct; scorer is the common path, organizer is the recovery path per T5.7 stale-queue scenario)

**Given** a valid correction request
**When** handled
**Then** `db.transaction(async (tx) => { ... })`:
  (a) fetches the current `hole_scores` row for `(round_id, player_id, hole_number)`; if none exists, returns 404 `{ error: 'hole_not_scored', code: 'cannot_correct_unscored_hole' }`
  (b) inserts a `score_corrections` row with `actor_player_id=session.userId`, `prior_value_json=JSON.stringify({ grossStrokes: existing, putts: existing })`, `new_value_json=JSON.stringify({ grossStrokes: new, putts: new })`, `request_id` from middleware, `reason?`, `created_at=now()`
  (c) `UPDATE hole_scores SET gross_strokes=..., putts=..., updated_at=now() WHERE round_id=... AND player_id=... AND hole_number=...`
  (d) `writeAudit(tx, { action: 'score.corrected', actor, prior, new, reason? })`
  (e) if the round is `finalized`, also triggers T6 money/side-game recompute within the same `tx` (Wolf Cup precedent: correction after finalize re-runs Harvey)
  (f) `emitActivity(tx, { type: 'score.corrected', ... })`

**Given** a correction on a round in state `not_started` or `cancelled`
**When** handled
**Then** 422 `{ error: 'invalid_state', code: 'round_state_forbids_correction', requestId }`

**Given** `GET /api/rounds/:roundId/score-corrections`
**When** invoked by an Event participant
**Then** returns the correction history filtered by FR-D9 money-visibility posture (v1 `open` mode: all participants see all corrections; reserved columns only `participant` / `self_only` modes will activate later)

**Given** `apps/tournament-api/src/routes/admin/score-corrections.integration.test.ts`
**When** run
**Then** tests cover: happy path (pre-finalize + post-finalize with recompute), 404 on unscored cell, 422 on `not_started`, audit row + correction row both present after commit

#### Story T5.10: [new] Airplane-Mode Drill + 409-Collision Integration Test

As a developer / organizer,
I want (a) `apps/tournament-api/src/routes/scores.integration.test.ts` containing a deliberate 409-collision test run in CI, and (b) `apps/tournament-web/src/scripts/drill-offline-scorer.md` — a checklist-driven manual drill run before each target Event,
So that offline-merge correctness (NFR-R2) is proven automatically AND the end-to-end device-level offline behavior is validated by a human before the trip.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/routes/scores.integration.test.ts`
**When** `pnpm -F @tournament/api test` runs in CI
**Then** a test case named "409 conflict: two clients, same cell, different clientEventId" runs:
  (a) Setup: `pinehurstMidTripScenario()` fixture yields a round with state `in_progress`, scorer assigned, foursome populated
  (b) Client A POSTs `{ roundId, holeNumber: 5, playerId: P1, grossStrokes: 4, clientEventId: 'a-uuid' }` → assert 200, asserted row in `hole_scores`
  (c) Client B (same scorer session — simulates the same device's queue replaying vs. a second device that stole scorer slot mid-transfer) POSTs `{ roundId, holeNumber: 5, playerId: P1, grossStrokes: 5, clientEventId: 'b-uuid' }` → assert 409 `{ error: 'conflict', code: 'hole_already_scored', conflictingEntry: { scorer_player_id, created_at, client_event_id: 'a-uuid' } }`
  (d) Assert `hole_scores` still holds only one row for that cell, with `gross_strokes=4` (first-writer-wins — D3-3)
  (e) Assert NO audit row was written for the 409 path

**Given** a second test case in the same file "idempotent replay: same clientEventId submitted twice"
**When** run
**Then** (a) Client POSTs `{ ..., clientEventId: 'c-uuid' }` → 200, one row in `hole_scores`, one audit row. (b) Client POSTs identical body → 200 `{ status: 'ok', clientEventId: 'c-uuid', deduped: true }`, still one row, still one audit row (dedupe verified)

**Given** `apps/tournament-web/src/scripts/drill-offline-scorer.md`
**When** inspected
**Then** it's a manual checklist (not executable TS script) covering:
  1. Install tournament PWA on iOS device
  2. Open a round while online; verify scorecard shell cached (T5.4)
  3. Enable airplane mode
  4. Score 3 consecutive holes for 4 players (12 cells); verify sync chip shows "queued 12"
  5. Disable airplane mode
  6. Within 30s, verify sync chip reaches "all synced" AND leaderboard on a second (online) device reflects all 12 cells
  7. Post-drill: verify `score_corrections` is empty (no corrections needed) AND `audit_log` has 12 `score.committed` rows
  Plus a "who/when" record: drill executed by {name} on {date} against tournament version {commit sha}. Artifacts archived in `reference/drills/`.

**Given** the drill checklist
**When** completed successfully
**Then** the NFR-R2 gate for the associated Event is cleared. (Drills run pre-trip per T9 validation plan.)

**Note:** This story merges the two per architecture step-4 expansion: the 409 path is an integration test (automated, CI-gated) and the airplane-mode drill is a manual device-level checklist. Both ship in v1.

#### Story T5.11: [new] Mid-Event Rule Edit with Effective-Hole Boundary

As an organizer,
I want `POST /api/events/:eventId/rule-sets/:ruleSetId/revisions` that creates a new `rule_set_revision` with an effective-hole boundary, stamps audit log, triggers money recompute from the boundary forward, and emits an activity so all participants see a diff banner,
So that I can fix a sandies-on vs sandies-off misconfiguration in the middle of Talamore without voiding money from the pre-boundary holes (FD-13 guardrail 1, FR-H1 mid-event edit).

**Depends on:** T3.1 amended `rule_set_revisions` schema (effective_from_round_id + effective_from_hole + created_by_player_id + reason columns), T5.8 round-state FSM (for frozen-round check), T6 money recompute dispatch (the consumer that reacts to this story's revision insert).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/routes/admin/rule-edits.ts`
**When** inspected
**Then** it exposes `POST /api/events/:eventId/rule-sets/:ruleSetId/revisions` with body `{ configJson, effectiveFromRoundId, effectiveFromHole, reason? }`. `effectiveFromRoundId` references an `event_rounds.id` in this event (not `rounds.id`); `effectiveFromHole` is an integer in `[1..19]` where `19` means "effective from the NEXT scheduled round onward". Gated `require-organizer`.

**Given** the proposed edit's effective window
**When** the handler computes the affected-round set — {anchor round if `effectiveFromHole ∈ [1..18]`} ∪ {every event_round with `round_number > anchor.round_number`}
**Then** if ANY round in that set has `round_states.state = 'finalized'`, return 422 `{ error: 'frozen_round_in_window', code: 'rule_edit_would_recompute_finalized_round', frozenRoundIds: [...], requestId }` — freeze-window fix per Codex High finding. To unblock, organizer must narrow the boundary (advance `effectiveFromRoundId` past the frozen round) or issue individual score corrections (T5.9) on frozen rounds if the intent is to change their money computation.

**Given** a valid rule-edit request (no frozen rounds in window)
**When** handled
**Then** `db.transaction(async (tx) => { ... })`:
  (a) inserts a new `rule_set_revisions` row with `revision_number = current_max + 1`, `config_json`, `effective_from_round_id`, `effective_from_hole`, `created_by_player_id = session.userId`, `reason?`, `created_at`
  (b) writes audit row `action='rule_set.revised'` with prior + new config diff
  (c) triggers T6 money recompute: for the anchor round, all holes >= `effective_from_hole` recompute under the new config; for subsequent rounds, all holes recompute under the new config; for rounds BEFORE anchor, no recompute (frozen per existing revision)
  (d) emits activity `type='rule_set.revised'` with the config diff payload; T8 consumes this to render the participant-visible banner

**Given** participant devices polling the activity feed (T8)
**When** the rule-edit activity appears
**Then** a dismissible diff banner renders at the top of the leaderboard + money views showing "Rules changed at hole N of round M: [human diff]". The banner does NOT auto-dismiss; persists until the participant taps dismiss (D3-4 acknowledgement pattern).

**Given** `GET /api/events/:eventId/money?at=<effective_from_round_id>:<effective_from_hole>`
**When** invoked
**Then** the response shows a breakdown: `preBoundary` (money from holes scored before the boundary under the prior revision) + `postBoundary` (money from the boundary forward under the new revision); both are additive; total money for the event = sum. This is the audit surface for organizers to confirm "pre-edit money is unchanged."

**Given** `apps/tournament-api/src/routes/admin/rule-edits.integration.test.ts`
**When** run
**Then** four scenarios pass:
  (a) Edit mid-round (`effectiveFromHole=12`, no finalized rounds): assert holes 1-11 money unchanged; holes 12-18 recomputed under new config; one audit row; one activity row
  (b) Edit between rounds (`effectiveFromHole=19`, no finalized rounds): assert round N money unchanged; round N+1 uses new config
  (c) Edit targeting a window that includes a finalized round: assert 422 with `frozenRoundIds` populated — the freeze-window Codex High finding guard
  (d) Edit with `effectiveFromRoundId` pointing at an event_round that belongs to a different event: assert 422 `{ error: 'invalid_boundary', code: 'round_not_in_event' }`

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

**Money type discipline (applies across T6):** all money values — stakes, bases, pot shares, matrix cells, settle-up amounts — are stored and transmitted as **INTEGER CENTS** (schema columns: `INTEGER NOT NULL`; TypeScript `number` representing cents). UI converts to `$X.XX` at render only. Division operations (skins pot splits, pair attribution) use integer division + explicit remainder distribution; no floating-point arithmetic on money anywhere in the engine or services. This forecloses the float-drift risk that sinks NFR-C1 correctness.

**Pairwise money convention (2v2 best ball):** `basePerHole` is the **per-pair** dollar amount (in cents) that flows between each losing→winning player pair on a won hole. Four pair combinations per 2v2 hole (A↔C, A↔D, B↔C, B↔D), so the team-level hole value = 4 × `basePerHole`. This makes the head-to-head matrix (T6.5) the primary data structure; team totals are derived by summing pair cells. Same convention applies to greenies (T6.12) and sandies.

#### Story T6.1: [new] Engine: 2v2 Best Ball Hole/Round Scoring (pairwise attribution)

As a developer,
I want `apps/tournament-api/src/engine/formats/best-ball-2v2.ts` as a pure function computing per-hole and per-round team money for 2v2 best ball with sandies, parameterized by rule-set config, returning pairwise money attribution in integer cents,
So that the Guyan Game's core math is deterministic, golden-file-testable, float-free, and reusable by the money service (FR-D1, NFR-C1, NFR-C2).

**Depends on:** T3.5 (rule-set config shape — sandies toggle, greenie_carryover, greenie_validation), T5.1 (hole_scores read shape).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/engine/formats/best-ball-2v2.ts`
**When** inspected
**Then** it exports `compute2v2BestBall({ holeScores: HoleScore[], pairings: { teamA: [PlayerId, PlayerId], teamB: [PlayerId, PlayerId] }, config: BestBall2v2Config, course: CourseRevision }): { perHole: HoleResult[], perRound: RoundResult, perPair: PairLedger }` as a pure function with no DB/I/O/env access. Imports `stableford.ts` from `@wolf-cup/engine` (sole shared-engine dependency; enforced by ESLint rule per T1).

**Given** `BestBall2v2Config` type
**When** inspected
**Then** it is `{ sandies: boolean, basePerHoleCents: number, greenieCarryover: boolean, greenieValidation: '2-putt' | 'none', greenieBaseCents: number, sandiesBonusPerHoleCents: number }`. All money fields are **integer cents**. No press/individual-bet fields — those are orthogonal modules (T6.2/T6.3).

**Given** a hole with team-A best-ball net = 3, team-B net = 4, `basePerHoleCents=100` ($1 per pair)
**When** computed
**Then** `perHole[i] = { winner: 'teamA', teamDeltaCents: 400, sandiesApplied: false, greenieAwarded: null }` AND `perPair` accumulates: `{ (A,C): +100, (A,D): +100, (B,C): +100, (B,D): +100 }` (signed to teamA side of each pair). Sum of pair cells = 4 × basePerHoleCents = `teamDeltaCents`.

**Given** a par-3 hole where a team-A player is on in regulation, 2-putts for par, `greenieCarryover=true`, `greenieValidation='2-putt'`
**When** computed
**Then** `perHole[i].greenieAwarded = { team: 'teamA', valueCents: greenieBaseCents, carriedFromHoles: [] }`; pairwise attribution of greenie value follows same 4-pair split as `basePerHole`

**Given** a par-3 where no player hits the green OR the "greenie" player 3-putts with `greenieValidation='2-putt'`
**When** computed
**Then** `perHole[i].greenieAwarded = null`; if `greenieCarryover=true`, the unclaimed value queues for T6.12 carry logic (this story emits the `queued` state; T6.12 owns the carry resolution across holes)

**Given** a hole where `config.sandies=true` and a player in the winning team made par from a bunker
**When** computed
**Then** `perHole[i].sandiesApplied = true`; `sandiesBonusPerHoleCents` is added to that hole's team delta and distributed pairwise per the 4-pair convention

**Given** a tied hole (teams net equal)
**When** computed
**Then** `perHole[i].teamDeltaCents = 0`; no pair cells mutate; hole is contested but no money flows

**Given** `apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts` + `__fixtures__/best-ball-2v2-*.json`
**When** `pnpm -F @tournament/api test` runs
**Then** at least six fixtures pass: (a) straight win round, no sandies, no greenies; (b) round with 3 sandies scattered; (c) round with greenies awarded on every par-3; (d) round with no valid greenies, carryover off; (e) round with handicap strokes shifting net (15-handicap on SI 1–15); (f) tie hole (delta=0). Every fixture asserts: (i) `perPair` cells sum to `perRound.teamTotalCents`; (ii) pair cells are anti-symmetric (`pair[a][b] = -pair[b][a]`); (iii) all values are integers.

**Given** any fixture replayed
**When** the function is called twice with identical input
**Then** the output is byte-for-byte identical (pure / deterministic)

#### Story T6.2: [new] Engine: Press + Auto-Press Trigger Evaluation

As a developer,
I want `apps/tournament-api/src/engine/rules/press.ts` as a pure function evaluating manual presses + auto-press triggers (N-down family) against a match-state snapshot,
So that a press's effect on hole money is computed deterministically and auto-press fires at exactly the right moment per config (FR-D1 press, FR-D5 auto-press silent fire).

**Depends on:** T6.1 (consumes 2v2 per-hole results as input), T3.5 (config `autoPressTriggerAtNDown`, `pressMultiplier`).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/engine/rules/press.ts`
**When** inspected
**Then** it exports `evaluatePresses({ perHoleResults: HoleResult[], manualPresses: ManualPress[], existingPressLog: PressLogEntry[], config: PressConfig, throughHole: 0..18 }): { activePresses: Press[], newlyFired: Press[] }` — pure function. `throughHole` is "the last hole for which ALL 4 foursome members have committed scores" (the hole-complete boundary — see T6.4). `existingPressLog` is the list of already-persisted presses (`team_press_log` rows) passed in so the engine can dedupe against prior fires.

**Given** `PressConfig` type
**When** inspected
**Then** it is `{ autoPressTriggerAtNDown: number | null, pressMultiplier: number }`. When `autoPressTriggerAtNDown` is null, auto-press is disabled for this rule-set. `pressMultiplier` is a plain number (e.g., 2 for 2x); applied to each press segment's pair attribution.

**Given** a match-state where team A is 2-down through hole 4 and `autoPressTriggerAtNDown = 2`, no existing press log for this trigger
**When** evaluated at `throughHole=4`
**Then** `newlyFired` contains exactly one press `{ type: 'auto', trigger: '2-down', team: 'teamA', startHole: 5, multiplier: pressMultiplier }`

**Given** the same match-state AND `existingPressLog` already contains an auto press fired for team A at hole 5
**When** evaluated again (e.g., after a score correction on hole 4)
**Then** `newlyFired` is empty — idempotency via log-dedupe: the engine does NOT re-fire presses that already exist for the same `(team, startHole, trigger_type)` key

**Given** a manual press filed at hole 7 by team B (passed in `manualPresses`)
**When** evaluated at `throughHole=7`
**Then** `activePresses` contains the press with `startHole: 7, type: 'manual', team: 'teamB'`; applies to holes 7–18 (or until next press layers on)

**Given** multiple presses stacked (compound auto-press — team A 2-down triggers one, then another 2-down later fires a second)
**When** evaluated across multiple `throughHole` advances
**Then** each press's delta applies independently and multiplicatively per `pressMultiplier`; returned presses ordered by `startHole` ascending

**Given** a press filed on hole N
**When** `throughHole` advances to N+1 (next hole complete)
**Then** the undo window closes; a press-undo request at `throughHole >= startHole + 1` returns `{ canUndo: false, reason: 'next_hole_complete' }` (undo validation is a pure check; UI gating in T6.7)

**Given** `apps/tournament-api/src/engine/rules/press.test.ts` + `__fixtures__/press-*.json`
**When** tests run
**Then** at least six fixtures pass: (a) no press fires in a close match; (b) single auto-press fires exactly at 2-down; (c) compound auto-press — two stacked; (d) **idempotency: same state evaluated twice → second call returns empty newlyFired** (new gap-fix case); (e) manual press with undo inside window; (f) manual press + auto-press interleaved

#### Story T6.3: [new] Engine + Schema: Cross-Foursome Individual Bets

As a developer,
I want `individual_bets` + `individual_bet_rounds` + `individual_bet_presses` tables AND `apps/tournament-api/src/engine/rules/individual-bets.ts` as a pure function computing per-pair match-play money across any two Event participants regardless of shared foursome, all in integer cents,
So that Rick's cross-foursome match bets with Scottie + Josh compute deterministically and contribute to the head-to-head matrix (FR-D3, FR-D4).

**Depends on:** T5.1 (`hole_scores` read shape), T6.2 (auto-press mechanic for the `match_play_with_auto_press` type).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/db/schema/bets.ts`
**When** inspected
**Then** it defines (all with `tenant_id` + `context_id`):
  - `individual_bets(id PK, event_id FK → events.id, player_a_id FK → players.id, player_b_id FK → players.id, bet_type TEXT NOT NULL CHECK(bet_type IN ('match_play_per_hole','match_play_with_auto_press')), stake_per_hole_cents INTEGER NOT NULL CHECK(stake_per_hole_cents > 0), config_json TEXT NOT NULL, created_by_player_id FK → players.id, created_at, UNIQUE(event_id, player_a_id, player_b_id, bet_type))`
  - `individual_bet_rounds(bet_id FK → individual_bets.id, event_round_id FK → event_rounds.id, PRIMARY KEY(bet_id, event_round_id))` — immutable post-creation in v1
  - `individual_bet_presses(id PK, bet_id FK → individual_bets.id, fired_at_round_id FK → event_rounds.id, fired_at_hole INTEGER NOT NULL CHECK(fired_at_hole BETWEEN 1 AND 18), trigger_type TEXT CHECK(trigger_type IN ('manual','auto')), multiplier REAL NOT NULL, created_at, UNIQUE(bet_id, fired_at_round_id, fired_at_hole, trigger_type))` — the UNIQUE constraint enforces idempotent press logging (gap-fix: duplicate fires rejected at DB layer)

**Given** `apps/tournament-api/src/engine/rules/individual-bets.ts`
**When** inspected
**Then** it exports `computeIndividualBet({ bet: IndividualBet, rounds: Round[], holeScores: HoleScoresByPlayer, presses: Press[], course: CourseRevision[] }): { perHole: BetHoleResult[], perRound: BetRoundResult[], netToPlayerACents: number }` pure function. All money fields integer cents.

**Given** a $5/hole match (`stake_per_hole_cents=500`) between Rick and Josh across 4 rounds (72 holes)
**When** computed against a fixture where Rick wins 40 holes, Josh wins 30, 2 halved
**Then** `netToPlayerACents = 500 * (40 - 30) = 5000` (Rick up $50 on Josh)

**Given** a `match_play_with_auto_press` at `stake_per_hole_cents=500` where `autoPressTriggerAtNDown = 2`
**When** Rick falls 2-down at hole 4, triggering an auto-press at hole 5
**Then** the base match continues at 500 cents/hole AND a new press bet starts at hole 5 at 500 cents/hole (additive, per multiplier config); if Rick is still 2-down overall at hole 7, a second compound press fires; presses run to hole 18 of the current round (presses do NOT carry across rounds v1)

**Given** net handicap strokes
**When** computed
**Then** per-hole comparison uses each player's course handicap applied at SI per standard match-play rules; engine reuses `stableford.ts` from `@wolf-cup/engine` for the net-score calc

**Given** `POST /api/events/:eventId/bets` with body `{ playerAId, playerBId, betType, stakePerHoleCents, applicableRoundIds, config }`
**When** invoked by an Event participant (gated `require-event-participant`)
**Then** creates the `individual_bets` row + N `individual_bet_rounds` rows in one `db.transaction`; audit row; activity `bet.created` with both players tagged; 422 if either player is not in the Event's group membership OR if `stakePerHoleCents <= 0`

**Given** `apps/tournament-api/src/engine/rules/individual-bets.test.ts` + `__fixtures__/individual-bet-*.json`
**When** tests run
**Then** at least four fixtures pass: (a) straight per-hole match across 1 round; (b) 4-round aggregate; (c) auto-press chain within one round (2-down trigger); (d) tie round (net 0)

**Given** `apps/tournament-api/src/routes/bets.integration.test.ts`
**When** run
**Then** bet-creation happy path + duplicate-bet 422 (uniqueness violation) + non-participant 403 + audit row + activity row assertions all pass

#### Story T6.4: [new] Score-Commit Hook: Hole-Complete Press Evaluation + Activity Emission

As a developer,
I want the T5.6 score-commit handler extended to invoke the press engine (T6.2) **only when the current hole becomes complete** (all 4 foursome members have committed a score for that hole), within the same transaction, with idempotent dedupe so score corrections don't re-fire already-logged presses,
So that auto-press triggers fire at the correct moment — never partial-hole — and T8 engagement surfaces get clean, single-shot events (FR-D5, FR-C3).

**Depends on:** T5.6 (score commit route), T6.1 (2v2 per-hole input for press engine), T6.2 (press engine + log-dedupe), T6.3 (individual-bet press engine + individual_bet_presses UNIQUE constraint).

**Acceptance Criteria:**

**Given** the T5.6 score-commit transaction
**When** extended per this story
**Then** after the `holeScores.insert` and BEFORE `emitActivity('score.committed')`, the handler:
  (a) queries `hole_scores` for the committing hole (`hole_number = :n`) + round's foursome membership (via T4.2 `pairing_members`) to determine hole-complete status — all 4 foursome members must have a committed row for hole N
  (b) **if hole not complete (fewer than 4 scores for hole N)**: emit only `score.committed`; press evaluation is SKIPPED this commit (deferred to the commit that completes the hole)
  (c) **if hole complete (all 4 foursome members scored)**: proceed to press evaluation

**Given** the hole-complete condition is met
**When** press evaluation runs
**Then** the handler:
  (a) reads the round's rule-set revision + all committed hole scores through the current hole (via `tx`)
  (b) invokes `compute2v2BestBall(...)` to produce `perHole` up to current hole
  (c) loads `existingPressLog` from `team_press_log` (for team presses) and `individual_bet_presses` (for individual bets involving either foursome player)
  (d) invokes `evaluatePresses({ perHoleResults, manualPresses, existingPressLog, config, throughHole: n })` — the engine dedupes against log per T6.2
  (e) for any press in `newlyFired`: inserts into `team_press_log` (or `individual_bet_presses` for bet-tied presses). **The UNIQUE constraint on `(round_id, team, fired_at_hole, trigger_type)` (team_press_log) and `(bet_id, fired_at_round_id, fired_at_hole, trigger_type)` (individual_bet_presses) is the last-line defense against duplicate fires.** On `UNIQUE` violation, catch + log + skip — do NOT abort the transaction (a duplicate fire is a "should have been deduped upstream" warning, not an error).
  (f) for each successfully inserted press row: `emitActivity(tx, { type: 'press.auto_fired' | 'press.manual_fired', roundId, holeNumber, betOrTeam, from, to, multiplier })`

**Given** `apps/tournament-api/src/db/schema/press.ts`
**When** inspected
**Then** it defines `team_press_log(id PK, round_id FK → rounds.id, team TEXT CHECK(team IN ('teamA','teamB')), fired_at_hole INTEGER NOT NULL CHECK(fired_at_hole BETWEEN 1 AND 18), trigger_type TEXT CHECK(trigger_type IN ('manual','auto')), multiplier REAL NOT NULL, created_at, UNIQUE(round_id, team, fired_at_hole, trigger_type))`

**Given** a score correction (T5.9) on hole N of a round
**When** the correction handler re-runs press evaluation (post-correction recompute)
**Then** the engine's log-dedupe returns empty `newlyFired` for presses already logged; no duplicate activity emitted; no duplicate press rows. Test case explicitly covers "fire press → correct score in same trigger direction → re-eval produces no new press."

**Given** the press evaluation inside the commit transaction
**When** any press-engine call throws (pure-function bug)
**Then** the transaction rolls back; the score commit ALSO fails (422 `{ error: 'press_eval_failed', code: 'press_engine_error', requestId }`); scorer retries. Rationale: fail-loud to catch engine bugs before silently diverging from hand-calc.

**Given** `apps/tournament-api/src/routes/scores.integration.test.ts` (extended from T5.6)
**When** run
**Then** new test cases pass:
  (a) commit 3 of 4 scores for hole N → only `score.committed` activity; no press log rows; no press activity
  (b) commit 4th score for hole N (hole-complete) → `score.committed` + (if trigger conditions met) exactly one `press.auto_fired` + exactly one `team_press_log` row
  (c) idempotency: re-commit identical state (via replay/correction) → no new press rows; no duplicate press activity
  (d) individual-bet press: 2-down trigger on a cross-foursome bet → exactly one `press.auto_fired` with `bet_id` set + exactly one `individual_bet_presses` row
  (e) hole-complete happens via correction (4th score was missing, organizer corrects an upstream score shifting team position to 2-down → press fires on that correction boundary)

#### Story T6.5: [new] Head-to-Head Money Matrix API + UI (integer cents)

As any Event participant,
I want `GET /api/events/:eventId/money` returning the head-to-head money matrix in integer cents across all players (including pairs who never shared a foursome) + a Money page rendering it in `$X.XX` format,
So that at settle-up Josh can see Rick is up $47.00 on Mark with no float-drift concerns (FR-D6, FR-H5, NFR-C1).

**Depends on:** T6.1, T6.2, T6.3, T6.4 (all engine + event data populated).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/services/money.ts`
**When** inspected
**Then** it exports `computeMoneyMatrix(eventId: EventId, viewerPlayerId: PlayerId): MoneyMatrix` — a pure query-service function (reads only; no writes). Shape: `{ players: PlayerRow[], matrix: { [playerA]: { [playerB]: number } }, totals: { [playerId]: number }, computedAt: ISO, visibilityMode: 'open' | 'participant' | 'self_only' }`. **All matrix + totals values are integer cents** (no floats, no rounding at this boundary).

**Given** viewer in an Event with `groups.money_visibility_mode = 'open'` (v1 default)
**When** called
**Then** matrix includes all N×N pairs. Value at `matrix[a][b]` = net cents player A is up on player B across all rounds + all bets + skins (T6.14). Diagonal cells = 0; matrix is anti-symmetric (`matrix[a][b] === -matrix[b][a]`); integer equality, no tolerance needed.

**Given** `GET /api/events/:eventId/money` (gated `require-event-participant`)
**When** invoked
**Then** returns the matrix via `computeMoneyMatrix(eventId, session.userId)`; response is computed-on-read per D1-1 (no cache); `cache-control: no-store` header

**Given** `apps/tournament-web/src/routes/events.$eventId.money.tsx`
**When** rendered
**Then** the page converts cents to `$X.XX` display ONLY at the render boundary via a single helper `formatCents(n: number): string`. Matrix cells show signed dollars (e.g., `+$47.00`, `-$12.50`). Viewer's row visually highlighted. Tapping any cell routes to T6.6 settle-up drill-down for that pair.

**Given** an Event with `money_visibility_mode ∈ ('participant','self_only')` (schema present; not active in v1)
**When** invoked in v1
**Then** the service returns the full matrix regardless; `visibilityMode` field echoes the config value. v1.5 will gate the filter path — stub-commented in `money.ts` with a TODO referencing FR-D9.

**Given** `apps/tournament-api/src/services/money.integration.test.ts`
**When** run
**Then** the audit-row assertion passes (computing the matrix writes NO audit rows); anti-symmetry asserted across a Pinehurst-shaped fixture (every `matrix[a][b] + matrix[b][a] === 0`, exact integer equality); totals equal the sum of the viewer's row; all values are integers

#### Story T6.6: [new] Settle-Up View (pairwise attribution + zero-sum invariant)

As any Event participant,
I want a Settle-Up page that shows each player's net balance in cents and drills down to the pairwise hole-by-hole contributions of team games + individual bets + skins, with an explicit zero-sum invariant asserted,
So that at the hotel lobby on May 10 everyone can audit the math before cash changes hands AND the system rejects any internal inconsistency (FR-D7, FR-H5, NFR-C1).

**Depends on:** T6.1 (pairwise ledger), T6.5 (reuses `computeMoneyMatrix`), T6.14 (skins entries).

**Acceptance Criteria:**

**Given** `GET /api/events/:eventId/settle-up` (gated `require-event-participant`)
**When** invoked
**Then** returns `{ perPlayerNetCents: [{ playerId, playerName, netCents }], perPlayerBreakdown: { [playerId]: { teamGameCents, individualBetCents, skinsCents } }, computedAt }`. All money integer cents.

**Given** `GET /api/events/:eventId/settle-up/pair/:playerA/:playerB`
**When** invoked (gated `require-event-participant`, both players must be event members)
**Then** returns `HoleByHoleContribution[]` = `{ roundId, roundName, holeNumber, source: 'team_game' | 'individual_bet' | 'skins', amountCents: number, signedTo: playerA | playerB, note?: string }` — a line per hole per source that moved money between this pair. **Team-game lines use the T6.1 `perPair` pairwise attribution directly** (one line per pair per hole where the pair flowed money — not an allocated slice of a team-level amount).

**Given** the sum of all `perPlayerNetCents` values across the event
**When** summed
**Then** equals exactly 0 (integer equality; zero-sum invariant). The route asserts this before returning; on violation returns 500 `{ error: 'money_invariant_violated', code: 'settle_up_nonzero_sum', requestId, diagnostic: { sum, playerCount } }` — this is a loud-failure safety net, not a graceful path. Test asserts the invariant holds across the Pinehurst fixture.

**Given** `apps/tournament-web/src/routes/events.$eventId.settle-up.tsx`
**When** rendered
**Then** the page shows: (a) summary table — each player's net (signed `$X.XX`); (b) per-player breakdown card (team / bets / skins) in dollars; (c) drill-down modal on tap of any pair → hole-by-hole list grouped by round, each line showing source + signed amount

**Given** rounds in state `'cancelled'` or `'not_started'`
**When** included in the computation
**Then** they contribute zero cents (T5.8 filter); the settle-up response flags them with `excludedRounds: [{ roundId, state }]`

**Given** `apps/tournament-api/src/routes/settle-up.integration.test.ts`
**When** run
**Then** tests cover: (a) zero-sum invariant across Pinehurst fixture (integer equality); (b) drill-down correctness for a specific pair (hand-calculated, pair cells matching expected); (c) cancelled round excluded; (d) non-participant 403; (e) invariant-violation loud-failure test (inject a synthetic imbalance → assert 500 response with diagnostic)

#### Story T6.7: [new, target-miss tolerable] Manual-Press UI (server-derived hole, one-tap, undoable)

As a scorer,
I want a one-tap "Press" button on the score-entry screen that files a manual press starting from the next hole to play (server-derived from the max hole-complete state), undoable until the next hole becomes complete,
So that Rick's press files without ambiguity about which hole it applies to, without a confirmation dialog, and with a clean undo path (FR-D2).

**Target-miss-tolerable:** Capability must ship for Pinehurst (button exists, files a press server-derived from current state, press applies to money). Aesthetic / animation polish is tolerable to defer post-trip.

**Depends on:** T6.2 (press engine + log-dedupe), T6.4 (commit-hook + UNIQUE constraints on press log).

**Acceptance Criteria:**

**Given** the scorer entry screen with an active round
**When** rendered
**Then** a "Press" button per team (teamA / teamB) is visible below the score inputs; tap fires `POST /api/rounds/:roundId/presses` with body `{ team: 'teamA' | 'teamB' }`. **No `fromHole` field in the request body** — the server derives it. No confirmation dialog.

**Given** `POST /api/rounds/:roundId/presses` (gated `require-scorer-for-round` — the scorer files presses on behalf of the foursome in v1; any-player filing deferred to v1.5)
**When** invoked
**Then** the handler:
  (a) validates round state ∈ `('in_progress', 'complete_editable')` — else 422
  (b) **derives `fromHole` server-side**: `fromHole = (maxCompleteHole | 0) + 1`, where `maxCompleteHole` is the highest hole N where all 4 foursome members have a `hole_scores` row; if no hole is yet complete, `fromHole = 1`. If `maxCompleteHole === 18`, the round is fully scored and presses are rejected: 422 `{ error: 'round_fully_scored', code: 'no_holes_left_to_press', requestId }`
  (c) inserts `team_press_log` with `trigger_type='manual', fired_at_hole=fromHole, multiplier=config.pressMultiplier`. **The T6.4 UNIQUE on `(round_id, team, fired_at_hole, trigger_type)` rejects duplicate manual presses per team per hole** — on violation: 422 `{ error: 'duplicate_press', code: 'press_already_filed_this_hole', requestId, existingPressId }`
  (d) emits `press.manual_fired` activity
  (e) returns 200 `{ pressId, fromHole, canUndoUntilHoleComplete: fromHole }` — undo allowed until hole `fromHole` becomes complete (see below)

**Given** `DELETE /api/rounds/:roundId/presses/:pressId` (gated `require-scorer-for-round`)
**When** invoked
**Then** the handler validates undo-eligibility: `canUndo=true` iff NO hole at-or-after `press.fired_at_hole` is complete (no 4/4 scores on hole `fired_at_hole` or later). On valid: deletes the press row + emits `press.manual_undone` activity. On invalid: 422 `{ error: 'undo_window_closed', code: 'press_hole_complete', requestId, firedAtHole, currentMaxCompleteHole }`

**Given** two manual presses filed on the same hole by the same team (retry race)
**When** the second POST arrives
**Then** 422 via the UNIQUE constraint (per above); first press unaffected

**Given** `apps/tournament-api/src/routes/presses.integration.test.ts`
**When** run
**Then** tests pass: (a) happy-path file — fromHole derived correctly from partial scores; (b) file with all 4 scores on hole 1 already → fromHole=2; (c) file with round fully scored → 422 `round_fully_scored`; (d) happy-path undo before hole-complete; (e) undo after hole-complete → 422 `undo_window_closed`; (f) duplicate file (race) → 422 `duplicate_press`; (g) non-scorer POST → 403

#### Story T6.8: [target-miss tolerable] Bets Page (per-pair live standings)

As a player participating in cross-foursome individual bets,
I want a Bets page showing my live standing in each bet I'm party to,
So that Rick can glance at his phone between holes and see his Scottie auto-press is 1-down 4-up in round 2 (FR-E6).

**Target-miss-tolerable:** The same data is visible via the Money page (T6.5) pair drill-down; dedicated Bets page is nicer UX but not critical-path.

**Depends on:** T6.3, T6.5.

**Visibility:** FR-H6 strict — each participant sees bets they are party to; organizer sees all; spectators see none; **non-party Event participants see NOTHING of other players' bets**. The fact that the money matrix (T6.5) exposes totals `open`-mode-wide is a separate v1 policy choice and does not broaden bet-detail visibility.

**Acceptance Criteria:**

**Given** `GET /api/events/:eventId/bets/mine` (gated `require-event-participant`)
**When** invoked
**Then** returns the bets where session.userId is either `player_a_id` or `player_b_id`; each entry = `{ betId, opponentPlayerId, opponentName, betType, stakePerHoleCents, perRoundStanding: [{ roundId, holesUp, holesRemaining, netCents }], totalNetCents, presses: [{ betPressId, firedAtHole, roundId, triggerType, multiplier }] }`

**Given** an organizer requesting `GET /api/events/:eventId/bets` (no `/mine` suffix)
**When** invoked (gated `require-organizer`)
**Then** returns all bets in the Event

**Given** a non-party Event participant requesting a specific `GET /api/events/:eventId/bets/:betId` for a bet they are NOT a party to
**When** invoked
**Then** 403 `{ error: 'not_party_to_bet', code: 'bet_visibility_restricted', requestId }` — FR-H6 strict scoping per the note above

**Given** `apps/tournament-web/src/routes/events.$eventId.bets.tsx`
**When** rendered
**Then** page shows: (a) a card per bet (opponent, type, stake in `$X.XX`, total net signed to viewer); (b) per-round sub-rows; (c) press history inline. Empty-state: "No bets yet — organizer can add via admin Bets."

**Given** the Money page (T6.5) drill-down
**When** the dedicated Bets page is not yet shipped
**Then** the Money pair drill-down fully surfaces the same hole-by-hole breakdown; no blocker

#### Story T6.9: [new] Hand-Calc Money Fixture + HTTP Roundtrip Test (NFR-C1 gate)

As a developer,
I want one fully hand-calculated Pinehurst-shaped fixture (4 players, 4 rounds, realistic scores, 2v2 best ball + 2 cross-foursome bets + skins + carry-greenies), all money in integer cents, validated at BOTH engine level AND HTTP-roundtrip level,
So that NFR-C1 "head-to-head money matches hand-calculation" is closed end-to-end before the trip (NFR-C1, NFR-C2, money-correctness-failure mitigation).

**Depends on:** T6.1, T6.2, T6.3, T6.5, T6.11, T6.12, T5.6 (scores must be commitable via real route).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.json`
**When** inspected
**Then** the fixture contains: 4 named players (realistic HI distribution, e.g., 8, 12, 14, 22); 4 rounds of 18 holes each with gross scores; 2v2 pairings per round; 2 cross-foursome individual bets (one straight match, one auto-press); skins enabled all 4 rounds with mode `gross`; carry-greenies on, 2-putt validation; **all money values in integer cents**; computed expected output = `{ matrixCents: {...}, totalsCents: {...}, skinsResults: [...], betResults: [...] }` — all values hand-calculated by Josh and pasted with a "verified by {name} on {date}" comment

**Given** `apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.test.ts`
**When** `pnpm -F @tournament/api test` runs
**Then** engine-level test passes: `compute2v2BestBall` + `computeIndividualBet` + `calcSkins` composed against the fixture produce the expected matrix (integer equality, byte-for-byte)

**Given** `apps/tournament-api/src/routes/money.integration.test.ts`
**When** run (file-backed libsql, full API stack)
**Then** the HTTP-roundtrip test: (a) seeds the fixture's course, event, rounds, rule-set, players, pairings, bets, sub-game config via direct DB inserts; (b) commits all hole scores via `POST /api/rounds/:roundId/holes/:n/scores` using the round's designated scorer session (REAL API path, not direct DB); (c) finalizes each round via `POST /api/rounds/:roundId/finalize`; (d) calls `GET /api/events/:eventId/money` and asserts the response matches the fixture's expected `matrixCents` with integer equality

**Given** any drift between engine-level result and HTTP-roundtrip result
**When** detected
**Then** the test fails loudly; the failure is NOT tolerated — this is the NFR-C1 release gate

**Given** a future rule-set config change
**When** the fixture is regenerated
**Then** both engine + HTTP tests must be updated together; a `// REGENERATED YYYY-MM-DD` header notes which config change triggered it

#### Story T6.10: [new] Leaderboard Tie-Break Pure Function + Exhaustive Tests

As a developer,
I want `apps/tournament-api/src/engine/rules/tie-break.ts` as a pure function implementing FR-C5 stroke-play tie-break with exhaustive unit tests covering each break step, AND T5.5's leaderboard service refactored to delegate to this function,
So that there is exactly one tie-break implementation in the codebase (FR-C5).

**Depends on:** None (pure function); T5.5 (consumer to refactor).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/engine/rules/tie-break.ts`
**When** inspected
**Then** it exports `breakTie(rows: Array<{ playerId: PlayerId, grossStrokes: number, grossByHole: Array<number | null> }>, holesToPlay: 9 | 18): Array<{ playerId: PlayerId, rank: number, tiedWith: number }>` — pure function. `grossByHole` length matches `holesToPlay` (9 or 18 entries); `null` = unscored. `holesToPlay` is explicit so the back-9 branch knows which path to take.

**Given** `holesToPlay = 18` AND two rows with identical total gross, differing back-9 totals
**When** evaluated
**Then** the row with lower back-9 (sum of `grossByHole[9..17]`) ranks higher; `tiedWith = 1` for both if still tied after this step

**Given** `holesToPlay = 9` AND two rows with identical total gross
**When** evaluated
**Then** the back-9 step is SKIPPED (no back-9 exists on a 9-hole round); algorithm falls straight to hole-by-hole from `grossByHole[holesToPlay - 1]` backward

**Given** two rows with identical total AND back-9 gross, differing hole-18 gross
**When** evaluated
**Then** the row with lower hole-18 gross ranks higher; continues backward through holes 17, 16, ... until a difference is found

**Given** two rows truly identical across all 18 holes
**When** evaluated
**Then** both rows get the same rank; `tiedWith` reflects the tie size; next row's rank skips accordingly (1, 1, 3 — not 1, 1, 2)

**Given** unscored players (some `grossByHole` entries null)
**When** evaluated
**Then** nulls are treated as "higher than any scored hole" for tie-break (an incomplete round ranks worse than a completed identical-total round); T5.5 already sorts unscored players last — `breakTie` honors that by comparing null > any integer for ordering purposes

**Given** T5.5's `computeLeaderboard` service
**When** this story lands
**Then** the service is edited to invoke `breakTie()` instead of inlining tie-break logic; the inlined block from T5.5's current implementation is deleted. Unit tests from T5.5 continue to pass without modification (black-box behavior preserved).

**Given** `apps/tournament-api/src/engine/rules/tie-break.test.ts`
**When** tests run
**Then** at least six fixtures pass: (a) no tie — pure gross sort; (b) tie broken at back-9; (c) tie broken at hole 18; (d) tie broken at hole 14 (mid hole-by-hole); (e) true tie (identical scorecards); (f) partial scores (one player thru 12, one thru 18 — thru 12 ranks last regardless of gross)

#### Story T6.11: [new] Engine: Skins (3 modes, integer-cents, golden-file tested)

As a developer,
I want `apps/tournament-api/src/engine/formats/skins.ts` as a pure function computing Skins across a round in modes `gross | net | gross_beats_net` with tie-carry, last-hole unclaimed resolution, and integer-cents pot splits,
So that Skins is deterministic, float-free, auditable, and ready for the T6.13 dispatcher + T6.14 UI (FR-D11, FD-11).

**Depends on:** None (pure function); T3.1 `sub_games` + `sub_game_participants` tables (read-shape only, not written here).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/engine/formats/skins.ts`
**When** inspected
**Then** it exports `calcSkins({ holeScores: HoleScoresByPlayer, mode: 'gross' | 'net' | 'gross_beats_net', participants: PlayerId[], buyInPerParticipantCents: number, lastHoleUnclaimedResolution: 'split-among-winners' | 'carry-to-next-round', course: CourseRevision, handicapsByPlayer: { [PlayerId]: number } }): { holeWinners: Array<{ hole: 1..18, winnerId: PlayerId | null, carriedFromHoles: number[], skinValueCents: number }>, carries: Array<{ fromHole: number, toHole: number, valueCents: number }>, potShares: Array<{ playerId: PlayerId, dollarsCents: number }>, totalPotCents: number, remainderAttribution?: { playerId: PlayerId, remainderCents: number } }` pure function.

**Given** `mode='gross'`
**When** a hole has a single outright low-gross score
**Then** that player wins the hole's skin; base per-hole skin value = `buyInPerParticipantCents * participants.count / 18` (integer division); any remainder cents are tracked across holes and attributed at round close to the first skin winner (deterministic remainder rule — no floats, no rounding drift). Ties → skin carries to next hole.

**Given** `mode='net'`
**When** computed
**Then** low-net (gross minus strokes received at the hole per SI + handicap) determines winner; same tie-carry logic

**Given** `mode='gross_beats_net'`
**When** a hole has a unique low-gross winner
**Then** that player wins the hole's skin (gross wins)

**Given** `mode='gross_beats_net'` AND the low-gross position is tied (no unique gross winner)
**When** computed
**Then** **the algorithm falls through to net**: if there is a unique low-net winner, they win the skin; if net is also tied, skin carries to next hole. Josh's call: "gross wins if there is a unique gross winner; otherwise fall through to net."

**Given** a round ending with an unclaimed pot (last hole tied, carries accumulated)
**When** `lastHoleUnclaimedResolution='split-among-winners'`
**Then** unclaimed pot splits among players who won any skin this round (integer-cent division; remainder cents attributed via deterministic rule — round-number-indexed to the earliest-hole winner); if zero winners, splits equally among all participants

**Given** `lastHoleUnclaimedResolution='carry-to-next-round'`
**When** computed at round close
**Then** `potShares` includes a `{ playerId: null, dollarsCents: remainingPotCents, note: 'carried_to_next_round' }` marker; T6.13 dispatcher reads it at next round's skins sub-game open

**Given** `apps/tournament-api/src/engine/formats/skins.test.ts` + `__fixtures__/skins-*.json`
**When** tests run
**Then** at least ten fixtures pass: 3 modes × 3 scenarios — (a) single-winner-per-hole, zero carries; (b) 3+ hole carry chain with eventual winner; (c) last-hole unclaimed with `split-among-winners`. Plus: (d) `gross_beats_net` with gross-unique-winner → gross wins (net winner irrelevant); (e) `gross_beats_net` with gross-tied-but-net-unique → **net winner wins** (the Josh-specified interpretation); (f) `gross_beats_net` with both tied → skin carries. Plus: (g) integer-cent remainder distribution fixture (e.g., pot of $17.03 across 5 participants → exact cent attribution verified).

#### Story T6.12: [new] Engine: Carry-Over Greenies

As a developer,
I want the 2v2 best-ball engine (T6.1) extended with carry-over greenie logic for par-3 holes — `greenie_carryover=true` config param — that rolls unclaimed/unvalidated greenie value to the next par 3, with final par 3 capping at 4× base value, all in integer cents,
So that the Guyan carry-greenie tradition is deterministic (FR-D1 `greenie_carryover`, FD-12).

**Depends on:** T6.1 (best-ball-2v2 base engine).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/engine/formats/best-ball-2v2.ts`
**When** inspected post-T6.12
**Then** `compute2v2BestBall` output's `perHole[i].greenieAwarded` evolves to: `{ team, valueCents, baseValueCents, carriedFromHoles: number[], multiplier: 1 | 2 | 3 | 4 }` where `multiplier = 1 + carriedFromHoles.length`, capped at 4 for the final par 3

**Given** par-3 holes 3, 8, 12, 17 on a course, `greenieBaseCents=200` ($2), `greenieCarryover=true`, `greenieValidation='2-putt'`
**When** hole 3 greenie is unclaimed (no 2-putt) AND hole 8 greenie is claimed by team A with 2-putt
**Then** `perHole[8].greenieAwarded = { team: 'teamA', valueCents: 400, baseValueCents: 200, carriedFromHoles: [3], multiplier: 2 }`; pair-wise attribution follows the standard 4-pair split (T6.1 convention)

**Given** the chain: holes 3, 8, 12 all unclaimed; hole 17 (final par 3) is claimed
**When** computed
**Then** `perHole[17].greenieAwarded = { team: claimingTeam, valueCents: 800, baseValueCents: 200, carriedFromHoles: [3, 8, 12], multiplier: 4 }` — multiplier capped at 4

**Given** hole 17 (final par 3) unclaimed on a chain of all-unclaimed greenies
**When** computed
**Then** the accumulated greenie value is forfeited (no rollover to a non-par-3 hole or subsequent round); `perRound.unclaimedGreenieValueCents = 800` as an informational field; it doesn't contribute to team or pair money

**Given** `apps/tournament-api/src/engine/formats/best-ball-2v2.test.ts` + `__fixtures__/carry-greenies-*.json`
**When** tests run
**Then** at least four fixtures pass: (a) no carryover (carryover=false — baseline behavior unchanged, multiplier always 1); (b) single carry (1 → 2 multiplier); (c) full chain claimed at hole 17 (4× cap); (d) chain-of-unclaimed through hole 17 (value forfeited, `unclaimedGreenieValueCents` populated)

#### Story T6.13: [new] Sub-Game Framework: sub_game_results Schema + Dispatcher + Compute Route (append-only)

As a developer,
I want `sub_game_results` schema (append-only) + `services/sub-games.ts` dispatcher + `POST /api/rounds/:roundId/sub-games/:subGameId/compute` route dispatching by `type`, with v1 dispatching only to `skins`,
So that future sub-game types (ctp, sandies, putting_contest) are additive — no dispatcher rewrites — and score-correction-triggered recomputes preserve history (FR-D10, FR-D12, FD-10/11).

**Depends on:** T3.1 (`sub_games` + `sub_game_participants` exist), T6.11 (skins engine), T5.6 (score commit), T5.8 (finalize auto-compute).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/db/schema/subgames.ts` (extended from T3.1)
**When** inspected
**Then** it defines `sub_game_results(id PK, sub_game_id FK → sub_games.id, computed_at NOT NULL, config_snapshot_json TEXT NOT NULL, results_json TEXT NOT NULL, total_pot_cents INTEGER NOT NULL, created_by_player_id FK → players.id NULLABLE — NULL for system-computed at auto-finalize)`. **Append-only** — multiple rows per `sub_game_id` allowed; latest-by-`computed_at` is the current truth. No UPDATE / DELETE paths in v1.

**Given** `apps/tournament-api/src/services/sub-games.ts`
**When** inspected
**Then** it exports `computeSubGame(subGameId: SubGameId, tx: Transaction): Promise<SubGameResult>` dispatching by `sub_games.type`:
  - `'skins'` → calls `calcSkins(...)` (T6.11), persists `sub_game_results` row, returns it
  - `'ctp' | 'sandies' | 'putting_contest'` → returns 501 `{ error: 'not_implemented', code: 'subgame_type_stub', type, requestId }`
  Dispatcher is a plain switch-with-registry; new types add ONE case.

**Given** `POST /api/rounds/:roundId/sub-games/:subGameId/compute` (gated `require-event-participant`)
**When** invoked for a `skins` sub-game attached to this round
**Then** invokes `computeSubGame(subGameId, tx)` within `db.transaction`; inserts `sub_game_results` row; writes audit `action='subgame.computed'`; emits activity `type='subgame.computed'`; returns 200 with the result

**Given** T5.8 `round.finalize` transition
**When** it runs
**Then** for each `sub_games` row attached to this round, the finalize handler invokes `computeSubGame(subGameId, tx)` as part of the atomic transaction; stub types skip with a logged note (do NOT fail finalization)

**Given** a score correction post-finalize (T5.9) that re-triggers recompute
**When** `computeSubGame` is re-invoked
**Then** inserts a NEW `sub_game_results` row (history preserved); downstream consumers (T6.14 UI) read `ORDER BY computed_at DESC LIMIT 1` for current truth. Result-row count grows over time; v1 tolerates unbounded growth (~1 row per sub-game per correction). Pinehurst expected count: 24 sub-games × ~3 recomputes max = ~72 rows total.

**Given** `apps/tournament-api/src/routes/sub-games.integration.test.ts`
**When** run
**Then** tests cover: (a) compute skins happy path (1 result row, audit, activity); (b) compute ctp 501 stub; (c) idempotent re-compute (N+1 result rows, latest-by-`computed_at` is correct); (d) non-participant 403; (e) finalize auto-compute (finalize transaction inserts result rows for all attached sub-games)

#### Story T6.14: [new] Skins Leaderboard Column + Settle-Up Integration

As any Event participant,
I want the leaderboard to show a "Skins" column per player (pot won through finalized rounds; "—" until finalize) AND the Settle-Up drill-down to include skins as a distinct `source: 'skins'` row with integer-cent amounts,
So that Skins money is visible throughout the Event and rolls into the head-to-head matrix without a separate mental model (FR-D11, FR-D6).

**Depends on:** T5.5 (leaderboard route + UI), T6.6 (settle-up drill-down), T6.11 (skins engine), T6.13 (dispatcher persists results).

**Acceptance Criteria:**

**Given** the `GET /api/events/:eventId/leaderboard` response (T5.5)
**When** extended per this story
**Then** each `LeaderboardRow` gains `skinsCents: number | null` — the running sum of skins pot shares for this player across all FINALIZED rounds' skins sub-games. Value read from the latest `sub_game_results` row per sub-game (per T6.13 append-only convention).

**Given** the leaderboard UI (T5.5 page)
**When** rendered
**Then** a new "Skins" column shows the dollar amount per row via `formatCents(skinsCents)`; for rounds that haven't yet finalized, displays `—` (not `$0.00`) with tooltip "Skins compute on round finalize" — per Josh's v1 safety call to avoid misleading pre-finalize projections. A footer row shows "N skins carried" if any hole's pot is currently carried in the latest finalized result.

**Given** `GET /api/events/:eventId/settle-up/pair/:playerA/:playerB` (T6.6)
**When** extended
**Then** response includes `HoleByHoleContribution` entries with `source: 'skins', amountCents, note: 'skin won hole {N}, round {roundName}'` for every hole where one of the pair won a skin that the other paid into. Skins pot shares route into the head-to-head matrix via the standard "winner gains, buy-in losers lose" attribution per player pair.

**Given** `apps/tournament-api/src/services/leaderboard.integration.test.ts` (extended)
**When** run
**Then** test: seed Pinehurst-shape fixture → finalize round 1 → assert leaderboard rows have `skinsCents` populated from the `sub_game_results` row; assert rounds 2-4 show `skinsCents: null` until finalized; assert settle-up pair drill-down includes `source: 'skins'` entries with integer-cent amounts

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

#### Story T7.1: [new] Event Home Page (countdown + schedule entry)

As any Event participant (including invite-link first-arrivals pre-SSO),
I want an Event home page at `/events/:eventId` showing the countdown to round 1, a "you're in, {name}" greeting, and entry cards into schedule / pairings / leaderboard / course previews,
So that the invite-link first-arrival flow reaches the "you're in, here's the schedule" outcome in ≤3 taps (FR-E1, FR-E3).

**Depends on:** T3.2 (events), T3.6 (invite-link claim flow), T3.1 (event_rounds schedule).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/events.$eventId.tsx`
**When** rendered for an authenticated participant or an invite-link-claimed pre-SSO device
**Then** the page shows (top-to-bottom): (a) hero band with Event name + date range + timezone + countdown to round 1 ("Round 1 starts in 3 days, 4 hours"); (b) "you're in, {firstName}" row with the viewer's pairing for round 1 if known; (c) entry cards — Schedule (T7.2), Leaderboard (T5.5), Pairings (read-only view of T4.2 grid), Course Previews (T7.3), Photo Gallery (T7.4 — hidden if not shipped), Activity Feed (T8.3); (d) admin-only cards (Event settings, Bets, Export) for organizer

**Given** a viewer opening the invite-link for the first time (no `device_bindings` row yet)
**When** the invite-link claim flow (T3.6) completes
**Then** the post-claim redirect lands on `/events/:eventId` — this page renders fully with `player_id` from the device_bindings + transient device cookie; no SSO prompt; total taps from invite-link click to schedule-visible = 3 (tap invite link → tap "That's me" confirmation → land on Event home)

**Given** a viewer who has NOT yet claimed the invite and has no authenticated session
**When** opening `/events/:eventId` directly (e.g., bookmarked)
**Then** the page renders a read-only "You need to claim your invite" card with a button routing to the invite flow; does NOT 403 or require SSO

**Given** the countdown timer
**When** the current time is past round 1's `round_date`
**Then** the countdown card flips to "Round 1 is LIVE" and surfaces a scoring entry if the viewer is the scorer for a foursome, or a "Watch the leaderboard" entry otherwise; after the last round's date, the card flips to "Event complete — Settle-up" (linking to T6.6)

**Given** `apps/tournament-web/src/routes/events.$eventId.test.tsx`
**When** component tests run
**Then** the render path for each of three states (pre-Event, mid-Event with live round, post-Event) is verified; invite-link-first-arrival state renders without SSO dependency

#### Story T7.2: [new] Schedule View

As any Event participant,
I want a Schedule page showing all rounds with course hero image, date + tee time (in the event's timezone), viewer's pairing for each round, and a holes-to-play chip (9 or 18),
So that a player can screenshot the schedule to iMessage and have everything they need for the trip — including whether any day has an Emergency 9 or two 9-hole matches (FR-E3, FR-E7).

**Depends on:** T3.1 (event_rounds + holes_to_play), T4.2 (pairings persisted), T3.1 timezone field.

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/events.$eventId.schedule.tsx`
**When** rendered
**Then** the page shows one card per round in `event_rounds.round_number` order. Each card displays: course name + hero image, round date formatted in the event's IANA timezone via `lib/tz.ts` (NEVER the viewer's device timezone), tee color, tee time if set, **a chip showing "9 holes" or "18 holes" from `event_rounds.holes_to_play`**, and the viewer's pairing for that round (3 other player names + handicap indices)

**Given** two event_rounds sharing the same `round_date` (e.g., 18-hole morning + 9-hole Emergency 9 afternoon)
**When** rendered
**Then** both cards appear consecutively under that date; the schedule groups by date with a single date header spanning both cards

**Given** the viewer's pairing is known for a round (pairings saved per T4.2)
**When** rendered
**Then** the viewer's name is visually highlighted in the pairing row; tap opens the full foursome detail in a modal (or routes to `/events/:eventId/rounds/:roundId/pairings`)

**Given** pairings are NOT yet saved for a round
**When** rendered
**Then** the pairing row shows "Pairings not set yet" placeholder; card still renders without error

**Given** the hero image is missing or fails to load
**When** rendered
**Then** a neutral gradient fallback renders in the hero band; no broken-image icon surfaces

**Given** the page is opened on iOS Safari in a non-installed browser tab
**When** loaded
**Then** it renders without error (FR-E9 / T7.7 browser-tab graceful); no install prompt blocks read access

**Given** `apps/tournament-web/src/routes/events.$eventId.schedule.test.tsx`
**When** component tests run
**Then** render path verified for: all rounds set + pairings complete; missing pairings; missing hero image fallback; timezone formatting (fixture with `timezone='America/New_York'` vs. `'Etc/UTC'`); **multi-round single-date (18+9) rendering**; **9-hole-chip vs 18-hole-chip rendering**

#### Story T7.3: [new] Course Preview (per-hole detail + hero image)

As any Event participant,
I want a Course Preview page per course showing the full 18-hole table (par, yardage per tee, SI) plus the hero image + course name + city/state,
So that Mark can glance at Tobacco Road's par-3 14th before the round (FR-E4).

**Depends on:** T2.1–T2.4 (courses + course_revisions + holes + tees).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/routes/events.$eventId.courses.$courseId.tsx`
**When** rendered for a course referenced by any of this Event's `event_rounds.course_revision_id`
**Then** the page shows: (a) hero image band with course name + city/state + architect (if stored); (b) tee-selector chips (blue/white/red/…) defaulting to the tee the viewer plays in this Event; (c) 18-hole table: hole number, par, yardage at selected tee, SI, optional hole description/tips; (d) Out/In/Total totals row

**Given** the tee selector changes
**When** the viewer taps a different tee
**Then** the yardage column updates; par + SI do not change (per-revision invariants)

**Given** a course with multiple revisions (T2.4 — e.g., tee yardages updated mid-season)
**When** the viewer navigates to the course preview from an event round
**Then** the preview renders the `course_revision_id` pinned on `event_rounds`, NOT the latest course revision (history preservation per FD-8)

**Given** the course has no hero image
**When** rendered
**Then** falls back to a neutral gradient with the course name displayed in display type (same pattern as T7.2)

**Given** a non-Event-participant (no `group_members` row) attempting to access
**When** the route loads
**Then** 403 via `require-event-participant` — course previews are Event-scoped per invite model

**Given** `apps/tournament-web/src/routes/events.$eventId.courses.$courseId.test.tsx`
**When** component tests run
**Then** render paths verified: tee switch updates yardage; pinned revision (not latest) renders; no-hero fallback; Out/In totals match the fixture's expected values

#### Story T7.4: [port, target-miss tolerable] Per-Event Photo Gallery (R2 storage reuse)

As any Event participant,
I want a Photo Gallery tab on the Event home that lets me upload photos from camera or library and view photos uploaded by other participants grouped by round,
So that Pinehurst trip photos collect inside the app alongside scores/money — the same thing Wolf Cup shipped 2026-03-21 (FR-E5, FR-H7).

**Target-miss-tolerable:** low-effort port; permissible to defer if T5/T6 are at risk.

**Depends on:** Wolf Cup's R2 gallery implementation (2026-03-21 commits) — port verbatim via Port Provenance Protocol.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/routes/gallery.ts` + `apps/tournament-api/src/lib/r2-client.ts`
**When** inspected
**Then** each file begins with a provenance header citing Wolf Cup source paths + commit SHA at port time. Format: `/* PORTED from {wolf-cup-path} @ commit {sha} (dated YYYY-MM-DD). R2 bucket shared with Wolf Cup; tournament uses key prefix 'tournament/events/{eventId}/' per arch D5-10. Scope: upload, list, lightbox, multi-file sequential. */`

**Given** `apps/tournament-api/PORTS.md`
**When** inspected
**Then** entries exist for both files citing source paths + SHA + ported-on date + deltas ("key prefix swap; no logic changes")

**Given** Wolf Cup's R2 client code
**When** compared to tournament's copy
**Then** tournament's client targets the SAME R2 bucket but writes under `tournament/events/{eventId}/` prefix. Zero Wolf Cup source files are modified by this story.

**Given** `POST /api/events/:eventId/gallery` with a multipart file upload (gated `require-event-participant`)
**When** invoked
**Then** the file uploads to R2 under the event's prefix; a `gallery_photos(id PK, event_id FK → events.id, round_id FK → rounds.id NULLABLE — auto-linked to the active round if one exists at upload time, uploaded_by_player_id FK → players.id, r2_key TEXT NOT NULL, content_type TEXT, uploaded_at, UNIQUE(r2_key))` row is written; audit log + activity `type='gallery.uploaded'` with `eventId` in payload

**Given** multi-file upload (user selects N photos at once)
**When** submitted
**Then** photos upload sequentially with visible "Uploading 3 of 5..." progress (Wolf Cup 2026-03-22 pattern); one file failure does NOT abort siblings; failures surface per-file in a summary banner

**Given** `GET /api/events/:eventId/gallery` (gated `require-event-participant`)
**When** invoked
**Then** returns photos grouped by round_id (plus an "unassociated" bucket for photos uploaded outside any active round), ordered newest-first; response includes signed R2 URLs for display (not raw bucket URLs — keeps the bucket private)

**Given** `apps/tournament-web/src/routes/events.$eventId.gallery.tsx`
**When** rendered
**Then** the page shows: (a) camera icon FAB for upload; (b) photo grid grouped by round; (c) tap a photo → lightbox with pinch-zoom; (d) organizer only: delete button per photo (FR-H7)

**Given** the photo-delete endpoint `DELETE /api/events/:eventId/gallery/:photoId` (gated `require-organizer`)
**When** invoked
**Then** the photo row is deleted AND the R2 object is deleted; audit `action='gallery.deleted'`; non-organizer callers get 403

**Given** round deletion (T5.8 cancel / or admin-level event deletion)
**When** a round is cancelled, gallery photos linked to that round are NOT auto-deleted
**Then** their `round_id` is nulled (preserved in the event gallery; same pattern as Wolf Cup 2026-04-06 fix — photos outlive rounds)

#### Story T7.5: [new] Raw-State JSON Export (organizer-only)

As an organizer,
I want `GET /api/events/:eventId/export/raw` that downloads a self-contained JSON file of all writable state for this Event,
So that at any point I can archive the Event to disk or hand it to a third party for independent verification of settle-up (NFR-B1).

**Depends on:** All T3/T4/T5/T6 schemas populated.

**Acceptance Criteria:**

**Given** `GET /api/events/:eventId/export/raw` (gated `require-organizer`)
**When** invoked
**Then** the endpoint returns a JSON response with `Content-Type: application/json` + `Content-Disposition: attachment; filename="{eventName}-{YYYYMMDD}.raw.json"`. Body shape: `{ schemaVersion: 1, exportedAt: ISO, event: {...}, eventRounds: [...], rounds: [...], players: [...], groups: [...], groupMembers: [...], roster: [...], invites: [...], ruleSets: [...], ruleSetRevisions: [...], pairings: [...], pairingMembers: [...], holeScores: [...], scoreCorrections: [...], roundStates: [...], scorerAssignments: [...], teamPressLog: [...], individualBets: [...], individualBetRounds: [...], individualBetPresses: [...], subGames: [...], subGameParticipants: [...], subGameResults: [...], moneyMatrix: {...computed}, settleUp: {...computed}, auditLog: [...], activity: [...], galleryPhotos: [...] }`

**Given** the export
**When** inspected
**Then** all money values are INTEGER CENTS (matches T6 discipline); all timestamps are ISO-8601 UTC strings; all foreign keys preserved as-is (referential integrity allows replaying the export into a fresh DB); no R2 image blobs — gallery photos include `r2_key` only (not the image bytes); `eventRounds` entries include `holes_to_play` per the schema

**Given** the export includes `moneyMatrix` and `settleUp` computed sections
**When** a third party recomputes from the raw holeScores + rules + bets
**Then** their independent calculation matches the exported `moneyMatrix.matrixCents` + `settleUp.perPlayerNetCents` (NFR-C1 external-verification path)

**Given** a non-organizer caller
**When** invoked
**Then** 403 via `require-organizer`

**Given** `apps/tournament-api/src/routes/admin/export.integration.test.ts`
**When** run
**Then** tests cover: (a) happy path — populated Pinehurst fixture exports with all expected sections; (b) empty event (pre-scoring) — export still returns valid JSON with empty arrays; (c) non-organizer 403; (d) round-trip invariant — export → parse → re-insert into a fresh DB (test helper) → recompute money matrix → matches exported matrix byte-for-byte

#### Story T7.6: [new] In-App Install Prompt (per-device one-shot, FD-14)

As a player making my first successful mutation from a specific device,
I want the app to surface an in-app install prompt appropriate to my platform,
So that I install the PWA at the moment of my first-commit dopamine hit — and a player who uses two devices gets prompted once per device, not suppressed after the first device (FR-E8, FD-14).

**Depends on:** T5.6 (first successful score commit), T3.6/T3.7 (device_bindings exist), T3.1 (device_bindings schema).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/db/schema/players.ts` (T3.1 device_bindings definition)
**When** extended per this story
**Then** `device_bindings` gains `install_prompt_shown_at TIMESTAMP NULLABLE` via additive migration. **State lives on `device_bindings`, NOT on `players`** — a player using a second device gets prompted fresh on that device (per-device one-shot, per Codex finding). Default NULL; set to `now()` the first time the prompt is shown on this device.

**Given** a player's session commits their first successful mutation on a specific device (first `score.committed` / `gallery.uploaded` / admin-mutation within the scope of that device's `device_bindings` row)
**When** the response returns 200 to the client
**Then** the client checks: (a) PWA not already installed (no `display-mode: standalone` match — see T7.7); (b) the device's `device_bindings.install_prompt_shown_at` is NULL; (c) platform supports prompting (iOS 16+ Safari OR Android Chrome with `beforeinstallprompt` fired). If all three, display the install prompt.

**Given** the client displays the prompt
**When** rendered
**Then** on iOS: animated card showing Share icon + arrow to "Add to Home Screen" instruction; on Android: button calling the stored `beforeinstallprompt` event; dismiss button clears prompt for this session. In both cases, the client issues `POST /api/events/:eventId/devices/me/install-prompt-shown` which stamps `install_prompt_shown_at = now()` on the CURRENT device's `device_bindings` row (keyed via the transient device-id cookie from T3.6). Audit log row `action='install_prompt.shown'` with `eventId`. **No activity row** (install-prompt-shown is audit-only per Codex finding; it lives in `audit_log`, not the activity spine).

**Given** the prompt has been dismissed once on this device AND the app is opened again later
**When** `device_bindings.install_prompt_shown_at` is populated for the current device
**Then** the prompt does NOT re-surface on that device. A player's OTHER device (separate `device_bindings` row) will still prompt fresh on its first mutation.

**Given** the PWA is already installed (detected via `window.matchMedia('(display-mode: standalone)').matches`)
**When** any mutation happens
**Then** the prompt is suppressed regardless of `install_prompt_shown_at` state

**Given** a spectator (non-mutator) who uses the app read-only across the entire Event
**When** they open the app
**Then** the install prompt is NEVER shown — no installs for pure spectators (FD-14 "install at mutation moment")

**Given** invite-link claim flow (T3.6) — a player tapping "That's me" creates a device_binding but is identity setup, not a mutation
**When** the claim completes
**Then** the install prompt does NOT fire on the claim action itself; it fires on the first subsequent mutation (per Josh call 3)

**Given** `apps/tournament-web/src/components/install-prompt.test.tsx`
**When** component tests run
**Then** render paths verified: iOS prompt shape; Android prompt with `beforeinstallprompt` stub; suppressed-when-installed; suppressed-when-already-shown-on-this-device; DIFFERENT device gets fresh prompt (separate device_binding, null install_prompt_shown_at)

#### Story T7.7: [new] Browser-Tab Read-Only Fallback (scorer-gated install-required state)

As a non-installed browser-tab user,
I want read-only surfaces to render without error AND the score-entry route to show an "Install to score" state ONLY if I'm actually the assigned scorer (non-scorers see the standard read-only placeholder instead),
So that the app degrades gracefully without misleading non-scorers into thinking they need to install (FR-E9).

**Depends on:** T5.5 (leaderboard), T7.2 (schedule), T7.3 (course preview), T5.2 (scorer route), T4.2 (scorer_assignments for gating).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/lib/display-mode.ts`
**When** inspected
**Then** it exports `isInstalledPWA(): boolean` via `window.matchMedia('(display-mode: standalone)').matches` (plus iOS fallback `(navigator as any).standalone === true`). Single source of truth for install-detection; consumed by T7.6 + T7.7.

**Given** a non-installed browser tab (isInstalledPWA() === false)
**When** the viewer navigates to leaderboard / standings / pairings / schedule / course preview / money (if organizer) / settle-up (if organizer)
**Then** all these routes render fully without error; no "install required" banner (they are read-only by design)

**Given** a non-installed browser tab AND the viewer IS the assigned scorer for this round/foursome (`session.userId === scorer_assignments.scorer_player_id`)
**When** the viewer navigates to `/rounds/:roundId/score-entry`
**Then** instead of the score entry form, renders an "Install to score" card: "Score entry requires the installed app for offline reliability. On iOS: Share → Add to Home Screen. On Android: tap Install below." Card has inline install-prompt button (reuses T7.6 component) + secondary "View leaderboard instead" link

**Given** a non-installed browser tab AND the viewer is NOT the assigned scorer
**When** they navigate to `/rounds/:roundId/score-entry`
**Then** renders the standard T5.2 read-only placeholder (scorer assignment card showing who IS the scorer, plus a "View leaderboard" CTA). **NO install-required prompt** — they weren't allowed to score anyway. Per Codex Medium finding: the install prompt was misleading when shown to non-scorers.

**Given** the same scorer in an installed PWA
**When** they navigate to the same route
**Then** the score entry UI renders normally; T5.2 behavior unchanged

**Given** a non-installed browser tab opening a URL that doesn't match any known route
**When** handled by the 404 route
**Then** renders the standard 404; does NOT silently redirect or 500

**Given** `apps/tournament-web/src/routes/rounds.$roundId.score-entry.test.tsx`
**When** component tests run
**Then** render paths verified: (a) installed + scorer → score UI; (b) installed + non-scorer → T5.2 read-only placeholder; (c) non-installed + scorer → install-required card with inline install button; (d) non-installed + non-scorer → T5.2 read-only placeholder (NOT install-required — Codex-gated behavior)

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

**Activity-type scope note (post-Codex T8 review):** v1 enum drops `lead.changed`, `bet.flipped`, `install_prompt.shown` — `lead.changed` + `bet.flipped` have no owner story in T5/T6/T7 (deferred to v1.5 when a producer story lands); `install_prompt.shown` is audit-only per Codex finding (player/device-scoped, not event-scoped, doesn't fit activity spine's `event_id NOT NULL` discipline). Final v1 enum: 13 types.

#### Story T8.1: [new] Activity Spine Schema + Emitter + Zod-Validated Payloads + ESLint Gate

As a developer,
I want `activity` table + `services/activity.ts` `emitActivity(tx, event)` transaction helper + `engine/types/activity-events.ts` discriminated union with a common base shape (all variants require `eventId`) + per-type Zod schemas validated BEFORE insert + an ESLint rule gating direct table writes,
So that every downstream engagement surface (T8.2/T8.3/T8.4) reads from a single authoritative event spine with strong typing and no drift (FD-5, FR-C3, D3-2).

**Parallelizable with T5/T6:** no runtime dependency on their outputs.

**Depends on:** None runtime-wise; conceptually informs T5.6/T5.7/T5.8/T5.11/T6.4/T6.7/T6.13/T7.4/T8.4 emission points.

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/db/schema/activity.ts`
**When** inspected
**Then** it defines `activity(id PK, event_id FK → events.id NOT NULL, round_id FK → rounds.id NULLABLE, type TEXT NOT NULL CHECK(type IN ('score.committed','score.corrected','scorer.transferred','round.finalized','round.cancelled','press.auto_fired','press.manual_fired','press.manual_undone','bet.created','rule_set.revised','subgame.computed','gallery.uploaded','award.triggered')), actor_player_id FK → players.id NULLABLE, payload_json TEXT NOT NULL, created_at NOT NULL, INDEX(event_id, created_at DESC, id DESC))`. Carries `tenant_id` + `context_id` via `_columns.ts`. **Final v1 enum: 13 types** (dropped `lead.changed`, `bet.flipped`, `install_prompt.shown` per Codex findings). **Composite index `(event_id, created_at DESC, id DESC)` supports both live polling (T8.2 cursor-after) AND historical backfill (T8.2 cursor-before) efficiently; `id DESC` as tiebreaker makes the cursor stable even when multiple rows share a `created_at` timestamp.**

**Given** `apps/tournament-api/src/engine/types/activity-events.ts`
**When** inspected
**Then** it exports a TypeScript discriminated union `ActivityEvent` with one variant per `type` value. **All variants extend a common `ActivityEventBase` shape that requires `eventId: EventId`** (Codex High finding — `event_id` is NOT NULL in DB, so every event payload must carry it). Base shape: `{ eventId: EventId, roundId?: RoundId, actorPlayerId?: PlayerId }`. Consumer-critical variants (inlined here because T8.2/T8.3/T8.4 depend on these fields):

- `ScoreCommittedEvent = ActivityEventBase & { type: 'score.committed', roundId: RoundId, holeNumber: number, playerId: PlayerId, grossStrokes: number, par: number, toPar: number, isBirdieOrBetter: boolean, scorerPlayerId: PlayerId }` — `par` + `toPar` + `isBirdieOrBetter` are precomputed by the emitting route (T5.6) so consumers don't need to join course data
- `ScoreCorrectedEvent = ActivityEventBase & { type: 'score.corrected', roundId: RoundId, holeNumber: number, playerId: PlayerId, priorGross: number, newGross: number, actorPlayerId: PlayerId }` — inline prior/new values so T8.3 feed can render them without a secondary join
- `PressAutoFiredEvent = ActivityEventBase & { type: 'press.auto_fired', roundId: RoundId, triggerHole: number, team?: 'teamA' | 'teamB', betId?: BetId, trigger: string, multiplier: number }` — either `team` OR `betId` populated (team presses vs. individual-bet presses)
- `PressManualFiredEvent = ActivityEventBase & { type: 'press.manual_fired', roundId: RoundId, fromHole: number, team: 'teamA' | 'teamB', multiplier: number, filedByPlayerId: PlayerId }`
- `PressManualUndoneEvent = ActivityEventBase & { type: 'press.manual_undone', roundId: RoundId, pressId: PressId, undoneByPlayerId: PlayerId }`
- `AwardTriggeredEvent = ActivityEventBase & { type: 'award.triggered', roundId?: RoundId, awardType: 'first_birdie_of_event' | 'first_eagle_of_event', playerId: PlayerId, context: { holeNumber, grossStrokes, par } }` — v1 award types fixed (skins_pot_streak deferred per T8.4 fix)
- Other variants (`scorer.transferred`, `round.finalized`, `round.cancelled`, `bet.created`, `rule_set.revised`, `subgame.computed`, `gallery.uploaded`) specify `eventId` + type-specific IDs only; their full shape is derivable from the emitting story without re-specification here.

The file also exports `activityEventSchemas: Record<Type, ZodSchema>` — one Zod schema per type, matching the TS shape above.

**Given** `apps/tournament-api/src/services/activity.ts`
**When** inspected
**Then** it exports `emitActivity(tx: Transaction, event: ActivityEvent): Promise<void>` as a transaction helper that: (a) looks up `activityEventSchemas[event.type]`; (b) `schema.parse(event)` — throws `ValidationError` if payload doesn't match (loud failure — Codex/D3-2); (c) `tx.insert(activity).values({ event_id: event.eventId, round_id: event.roundId ?? null, type: event.type, actor_player_id: event.actorPlayerId ?? null, payload_json: JSON.stringify(event), created_at: now() })`

**Given** `.eslintrc.json` (or equivalent) in `apps/tournament-api`
**When** inspected
**Then** it contains a `no-restricted-syntax` rule blocking `tx.insert(activity)` calls outside `services/activity.ts`. Rule pattern: matches a CallExpression where the callee is `insert` on an import from `db/schema/activity.ts`. **Part of T8.1 AC, not deferred** (per Codex flag 3). Allowlist: the single `emitActivity` function in `services/activity.ts`.

**Given** a malformed event (e.g., `{ type: 'score.committed', eventId: 'e1', roundId: 'abc', holeNumber: 99 }`)
**When** `emitActivity(tx, event)` is called
**Then** Zod parse throws `ValidationError`; the calling transaction rolls back; nothing is written (fail-loud per D3-2)

**Given** `install_prompt.shown` (Codex High finding)
**When** T7.6 emits it
**Then** it writes to `audit_log` ONLY, not to `activity` — audit events don't require event_id; activity events do. T7.6's route is `POST /api/events/:eventId/devices/me/install-prompt-shown` (event-scoped for auth), but the resulting audit row is player/device-keyed, not part of the activity spine.

**Given** `apps/tournament-api/src/services/activity.integration.test.ts`
**When** run
**Then** tests cover: (a) each of the 13 event types — valid payload inserts correctly with correct column population; (b) invalid payload per type — parse throws, no insert; (c) payload missing `eventId` — parse throws (base-shape enforcement); (d) emitActivity outside a transaction (no tx passed) fails at TS compile time; (e) the ESLint rule test — `tx.insert(activity)` in a file outside `services/activity.ts` fails lint

#### Story T8.2: [new] Activity API + Singleton Feed Provider + Toast/Banner Components

As any Event participant,
I want `GET /api/events/:eventId/activity` supporting BOTH live polling (`?after=<cursor>`) AND historical backfill (`?before=<cursor>`) with an opaque stable cursor, plus a singleton `ActivityFeedProvider` mounted at root that a shared TanStack Query subscription feeds, plus Toast (auto-dismiss 6s) + Banner (persist until ack, storm-collapse 3+/5s) components,
So that live events flow in without duplicate notifications across mounted consumers AND historical backfill works for the T8.3 feed's "Load more" path without dropping burst events (FR-C3, D3-4, Codex Highs 2 + Medium 6).

**Depends on:** T8.1 (activity spine).

**Acceptance Criteria:**

**Given** `GET /api/events/:eventId/activity` (gated `require-event-participant`)
**When** invoked
**Then** accepts either query param (but not both):
  - `?after=<cursor>` → returns activity rows strictly newer than the cursor, ordered `created_at ASC, id ASC` (oldest-first so client can sequentially advance cursor); max 100 rows. Cursor is opaque `base64(JSON.stringify({ createdAt: ISO, id: UUID }))` — stable compound cursor handles same-timestamp rows (Codex High 2).
  - `?before=<cursor>` → returns activity rows strictly older than the cursor, ordered `created_at DESC, id DESC`; max 100 rows.
  - Neither param → returns newest 100 rows, `created_at DESC, id DESC` (initial page load).

**Given** the API response
**When** parsed
**Then** includes `{ rows: ActivityEvent[], nextCursorAfter: string | null, nextCursorBefore: string | null }` — `nextCursorAfter` is the last row's cursor for polling (null if fewer than 100 rows returned); `nextCursorBefore` is the oldest row's cursor for backfill

**Given** the burst-drop scenario: >100 new activities arrive between polls
**When** the client polls with `?after=<previousCursor>`
**Then** the response returns the OLDEST 100 newer-than-cursor rows (ASC ordering); the client advances `previousCursor` to the cursor of row 100 and polls again immediately (loops until fewer than 100 returned). **No events are skipped** — Codex integration test asserts this: seed 250 fresh rows, client polls with the cursor before any were inserted, assert all 250 are eventually consumed across 3 poll cycles.

**Given** `apps/tournament-web/src/providers/activity-feed-provider.tsx`
**When** inspected
**Then** exports `<ActivityFeedProvider eventId={id}>` mounted once at `__root.tsx` level. Uses a single TanStack Query subscription polling `?after=<cursor>` every 5 seconds; exposes the rows + cursor state via React context. **Toast, Banner, and Feed consumers ALL read from this shared provider** — no component instantiates its own poll (Codex Medium 6 — prevents duplicate notifications across mounted consumers).

**Given** `apps/tournament-web/src/hooks/use-activity-feed.ts`
**When** inspected
**Then** exports `useActivityFeed()` and `useActivityStream()` hooks that read from `ActivityFeedProvider` context (NOT from their own queries). Attempting to use outside the provider throws a clear "must be within ActivityFeedProvider" error.

**Given** `apps/tournament-web/src/components/tournament-toast.tsx`
**When** inspected
**Then** subscribes to the provider's stream; renders a headline for qualifying event types (`score.committed` if `isBirdieOrBetter`, `press.auto_fired`, `press.manual_fired`, `award.triggered`); auto-dismisses after 6 seconds; slides in from top on mobile / top-right on desktop. Non-qualifying types ignored at toast surface (still in T8.3 feed).

**Given** `apps/tournament-web/src/components/tournament-banner.tsx`
**When** inspected
**Then** subscribes to the provider's stream; renders a persistent banner for money-affecting event types (`press.auto_fired`, `press.manual_fired`, `rule_set.revised`, `round.finalized`); sticks until user taps dismiss; dismissal state stored in localStorage keyed by `activity.id` to prevent reappearance on page refresh. **Overlap with toast is intentional per Josh call 5** — presses get both immediate-awareness toast AND acknowledge-review banner; `rule_set.revised` + `round.finalized` are banner-only.

**Given** ≥3 banner-eligible events arrive within a 5-second window (offline drain storm)
**When** processed
**Then** individual banners collapse into a single summary banner: "N updates (press ×2, rule-edit ×1) — tap to review" expanding into a modal listing events; dismissing the summary dismisses all N events collectively

**Given** `apps/tournament-web/src/components/tournament-toast.test.tsx` + `tournament-banner.test.tsx` + `apps/tournament-api/src/routes/activity.integration.test.ts`
**When** tests run
**Then** verified: (a) toast auto-dismiss at 6s; (b) banner persistence until dismiss; (c) storm collapse (3 events within 5s → 1 summary); (d) localStorage dismissal survives remount; (e) **burst-drop test — 250 fresh rows consumed across 3 poll cycles with zero skipped events**; (f) same-timestamp cursor stability (rows with identical `created_at` paginate correctly via `id DESC` tiebreaker); (g) **singleton provider — mounting Toast + Banner + Feed simultaneously produces exactly ONE API poll per 5s window, not three**

#### Story T8.3: [new] Player-Home Activity Feed (reverse-chronological, backfill pagination)

As any Event participant,
I want a "What's Happening" feed on the Event home page showing recent activity in reverse-chronological order with a "Load more" button paginating via `?before=<cursor>`,
So that between shots I can glance at the app and see everything that just happened, and scroll back through earlier events without gaps (FR-C3, FD-5 "pull not push").

**Depends on:** T8.1 (activity table), T8.2 (provider + `?before=` endpoint), T7.1 (Event home page to host the feed).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/components/activity-feed.tsx`
**When** inspected
**Then** it consumes the T8.2 `ActivityFeedProvider` (NOT its own poll) and renders a scrollable list; each row shows: (a) icon per event type; (b) headline derived from the payload's inline fields ("Rick scored 4 on hole 11 — birdie!" using `isBirdieOrBetter + grossStrokes + holeNumber`); (c) relative time stamp; (d) tap routes to the relevant surface (score → scorecard; press → money page)

**Given** the feed at initial load
**When** the Event home page (T7.1) mounts it
**Then** shows the newest 20 events from the provider's current state; "Load more" button visible at bottom if more exist

**Given** the "Load more" tap
**When** handled
**Then** fires `GET /api/events/:eventId/activity?before=<oldestVisibleCursor>` via a query imperatively (not through the live-polling subscription); appends returned rows to the feed list; updates the oldest-visible cursor state

**Given** a new event arrives during the user's session (live poll)
**When** the provider's stream emits
**Then** the feed prepends the new row; does NOT re-fetch the historical page

**Given** no activity yet (Event pre-start)
**When** rendered
**Then** empty-state card: "Activity will show here once scoring starts. Round 1 begins {countdown}."

**Given** a banner-eligible event visible in the feed
**When** the viewer scrolls past it
**Then** the feed entry remains visible (feed ≠ banner — feed is persistent historical record)

**Given** score-corrections (T5.9)
**When** they emit `score.corrected` activity with inline `priorGross` + `newGross`
**Then** the feed renders with a "Corrected by {actor}" label showing both prior and new values inline

**Given** `apps/tournament-web/src/components/activity-feed.test.tsx`
**When** tests run
**Then** render paths verified: empty state; 20-event initial; Load-more backfill appending 20 more; new-event-during-session prepend; score-correction inline prior/new rendering; relative time across fixture times

#### Story T8.4: [new] Award Trigger Surfaces (first birdie, first eagle — best-effort)

As a player whose score just triggered a first-of-event award,
I want a brief celebratory animation on my player home when the award fires,
So that the first-birdie-of-the-trip moment gets the dopamine it deserves without a push notification ever being needed (FD-5, FR-C3).

**Scope (post-Codex):** v1 award types are `first_birdie_of_event` + `first_eagle_of_event` ONLY. **`skins_pot_streak` is deferred to v1.5** — the award is not derivable at score-commit time from the currently locked T6 shape (skins results are authoritative only at finalize, no live per-hole skins result exists during scoring). Supporting it would require adding a live interim skins recompute on hole-complete — explicit v1.5 enhancement story.

**Depends on:** T8.1 (activity `award.triggered` type), T8.2 (toast surfacing).

**Acceptance Criteria:**

**Given** `apps/tournament-api/src/services/awards.ts`
**When** inspected
**Then** it exports `evaluateAwards(tx, event: ScoreCommittedEvent): Promise<AwardTriggered[]>` — reads state via `tx`, emits new activity via `emitActivity`. Runs inside the T5.6 score-commit transaction after the 2v2 + press hooks complete. Detects v1 award types:
  - `first_birdie_of_event` — first `score.committed` in this Event where `toPar < 0` (any player, any round)
  - `first_eagle_of_event` — first `score.committed` in this Event where `toPar <= -2` (independent of birdie — an eagle fires its own award even if a prior birdie already fired)

**Given** a qualifying award trigger
**When** detected
**Then** calls `emitActivity(tx, { type: 'award.triggered', eventId, roundId, actorPlayerId, awardType, context: { holeNumber, grossStrokes, par } })`. Idempotency: query `activity WHERE event_id=? AND type='award.triggered' AND json_extract(payload_json, '$.awardType')=?` — if row exists, skip. (v1 award types are event-unique by definition; Pinehurst-scale activity lookup is O(N) but N is small — per Codex flag 7.)

**Given** the awards service throws (pure-function bug in detection)
**When** the score commit runs
**Then** **best-effort posture (per Codex High 3 + Josh call 6)**: the awards block is wrapped in `try / catch` inside the T5.6 transaction. On throw, the error is logged at `level='error'` with full context (eventId, scoreCommittedEvent, stack); no `emitActivity('award.triggered')` is written for that commit; the transaction CONTINUES and the score commit succeeds. Missing a celebratory animation is acceptable; rejecting a legitimate score because the decorative award engine threw is not. (This is a different posture from T6.4 press-engine fail-loud — presses affect money, awards do not.)

**Given** an `award.triggered` activity in the feed
**When** the T8.2 provider's stream emits it AND the affected player opens the app
**Then** a celebratory animation plays on their player home (full-screen overlay for eagles, corner animation for birdies); auto-dismisses after ~4 seconds. Other players see the event as a standard feed/toast item but no full-screen animation.

**Given** `apps/tournament-api/src/services/awards.test.ts`
**When** tests run
**Then** tests cover: (a) first birdie of event fires once + doesn't re-fire on second birdie; (b) first eagle fires independently from first birdie; (c) best-effort: injected throw in detection → score commit still succeeds, no `award.triggered` activity, error logged; (d) idempotency — re-run against same state, zero new activity rows; (e) verify `skins_pot_streak` is NOT detected (v1 scope check — deferred to v1.5)

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

#### Story T9.1: [new] 9-Hole Live Foursome Drill at Guyan

As Josh,
I want a manual drill script + drill-record template for running a 9-hole live foursome test at Guyan (Josh + Jeff + Ben + 1) exercising the full T3→T8 stack before Pinehurst, with the drill's `event_round` configured as a 9-hole round from creation,
So that integration bugs surface under real-world conditions where unit/integration tests can't reach, AND the drill composes legally with T5.8's "fully-scored rounds to finalize" rule by being a legit 9-hole round (NFR-P1, NFR-P2, NFR-R2, meta-integration).

**Depends on:** T3–T8 exits met (or explicitly waived); T3.1 `event_rounds.holes_to_play` schema landed.

**Acceptance Criteria:**

**Given** `reference/drills/drill-9-hole-guyan.md`
**When** inspected
**Then** it's a manual checklist covering:
  1. **Pre-drill setup** — create a fresh Event "Guyan Drill {date}" with 4 players, **1 event_round with `holes_to_play = 9` from creation** (NOT 18 — this is the Codex T9.1/T5.8 conflict fix), 1 rule-set (2v2 best ball, skins on, 1 cross-foursome individual bet Josh↔Jeff)
  2. Invite-link distribution: organizer generates invite, sends via iMessage; verify each opens, claims, sees Event home (T7.1)
  3. Pairings saved (T4.2); PDF exported (T4.3) and screenshot-shared
  4. Round opens; scorer assigned (Jeff); score entry begins at hole 1
  5. **Offline drill** — at hole 3, Jeff enables airplane mode; scores holes 4–6 offline; verify sync chip shows "queued 12" (4 players × 3 holes); disables airplane mode at hole 7; verify all 12 cells sync within 30s (NFR-R2)
  6. **Auto-press drill** — engineer a 2-down state by hole 4; verify auto-press fires at hole 5 (T6.4); banner visible on all devices (T8.2)
  7. Cross-foursome bet: Josh↔Jeff bet runs through 9 holes; verify Bets page (T6.8) updates each hole
  8. Score correction: Josh corrects Ben's hole 6 from 4 to 5; verify audit log row + money recompute (T5.9)
  9. **Round complete at hole 9** — `POST /rounds/:id/complete` succeeds because `pairing_members.count × rounds.holes_to_play = 4 × 9 = 36` cells are all filled (T5.8 missing-cells check respects the 9-hole `holes_to_play`). Finalize via `POST /rounds/:id/finalize`; verify skins auto-compute (T6.13) + money matrix (T6.5) + settle-up (T6.6)
  10. **Tie-break verification** — if two players tied on total gross across 9 holes, verify T6.10 `breakTie(rows, holesToPlay=9)` skips the back-9 step and falls to hole-by-hole from hole 9 backward (9-hole branch)
  11. Post-drill artifact: `reference/drills/drill-9-hole-guyan-{YYYY-MM-DD}.record.md` capturing bugs, fix status, NFR measurements (NFR-P1 hole timing, NFR-P2 leaderboard latency), and go/no-go recommendation

**Given** the drill record template
**When** filled
**Then** it captures: (a) drill date + participants + tournament commit SHA; (b) bugs found (categorized critical/high/medium/low); (c) fix commit links per bug; (d) NFR measurements; (e) go/no-go recommendation for T9.3

**Given** the drill completes without critical or high bugs
**When** recorded
**Then** T9.2 checklist box is marked ✅; otherwise blocked pending fixes

**Note:** This story is a checklist + drill artifact, not code. The automated counterpart lives in T5.10 (409-collision integration test) and T6.9 (hand-calc HTTP roundtrip). Those validate server-side correctness; T9.1 validates real-world device feel, timing, human UX flow on a round that exercises the 9-hole code path end-to-end.

#### Story T9.2: [new] Final Pre-Event Checklist Walkthrough

As Josh,
I want a single pre-event checklist doc that enumerates every release gate (tests, drills, integrations, infra) and records their status with links to supporting artifacts,
So that the go/no-go decision (T9.3) is made against a concrete, auditable artifact (architecture Release Gates).

**Depends on:** T1–T8 exits; T9.1 drill done; T9.4 per-device install done.

**Acceptance Criteria:**

**Given** `reference/drills/pre-event-checklist-pinehurst-2026-05-07.md`
**When** inspected
**Then** it contains sections covering:

**Trip-critical PRD items** (each with ✅/❌/⚠️ status + artifact link):
  - Event creation → artifact: Pinehurst event URL in prod
  - Pairings saved (T4.2) → artifact: exported PDF
  - PDF export functional (T4.3) → artifact: PDF file link
  - Single-scorer flow (T5.6) → artifact: scores.integration.test.ts green
  - Offline sync (T5.10) → artifact: 409-collision CI green + drill record
  - Money correctness (T6.9) → artifact: hand-calc HTTP-roundtrip test green + fixture hash
  - Skins (T6.11) → artifact: 10 fixture tests green
  - Carry-greenies (T6.12) → artifact: 4 fixture tests green
  - SSO + magic-link (T3.7) → artifact: auth integration tests green + staging SSO-outage drill pass
  - GHIN optional (T3.10) → artifact: manual verification of null-GHIN player flow
  - Mid-event edit (T5.11) → artifact: rule-edits integration tests green + freeze-window test
  - **9-hole round support (T3.1 + T5.8 + T6.10 + T9.1)** → artifact: Guyan 9-hole drill record
  - In-app engagement (T8) → artifact: manual verification on iOS + Android + burst-drop test (T8.2) green
  - Install prompt (T7.6) → artifact: per-device install verification (T9.4)

**Medium-confidence drivers:**
  - SSO-outage staging drill → artifact: record + go/no-go
  - Deployment rollback drill → artifact: record + go/no-go

**Technical gates:**
  - Wolf Cup 865+ tests green on main → GitHub Actions run URL
  - Tournament CI suite green → GitHub Actions run URL
  - DNS resolves (`dig tournament.dagle.cloud`) → command output
  - Traefik routing live → curl `https://tournament.dagle.cloud/health` 200
  - Daily backup cron running on VPS → `crontab -l` + recent backup file listing

**Drill artifacts linked:**
  - T9.1 9-hole Guyan drill record
  - T5.10 airplane-mode drill records (per scorer device — T9.4)
  - Deployment rollback drill record

**Given** any checkbox marked ❌ or ⚠️
**When** T9.3 ship/defer decision is considered
**Then** the checklist is the source of truth; ❌ blocks ship unless explicitly waived with written justification; ⚠️ requires a risk statement

**Given** the checklist is updated during pre-event week
**When** changes land
**Then** commits carry a message like `T9.2: update checklist — {gate} status → ✅ after {artifact-link}`; change history via `git log`

#### Story T9.3: [new] Ship / Defer Decision Artifact

As Josh,
I want a dated decision artifact recording either "greenlight Pinehurst May 7" with the T9.2 checklist snapshot OR "defer to next window with punch list",
So that the go/no-go moment is a documented commitment — not implicit, not revisable without another explicit decision (FD-15).

**Depends on:** T9.1 drill complete; T9.2 checklist populated.

**Acceptance Criteria:**

**Given** `reference/drills/ship-decision-pinehurst-2026-05-07.md`
**When** inspected (greenlight variant)
**Then** contains: (a) date of decision + commit SHA; (b) T9.2 checklist snapshot (copy of the file at decision time); (c) explicit waivers for any ❌/⚠️ items with written rationale; (d) go-live plan (who does what on May 7 morning); (e) rollback plan if day-1 critical issue emerges

**Given** the defer variant
**When** inspected
**Then** contains: (a) date + commit SHA; (b) punch list for next window; (c) estimated timeline; (d) risk acknowledgment — Pinehurst proceeds with paper scoring + spreadsheet money (prior-year fallback)

**Given** the decision is documented
**When** committed
**Then** message: `T9.3: {GREENLIGHT|DEFER} decision for Pinehurst 2026-05-07`; repo tagged `pinehurst-2026-{go|defer}`

**Given** post-decision changes to the codebase
**When** they touch trip-critical paths
**Then** decision artifact is NOT retroactively modified; a supplemental `ship-decision-pinehurst-2026-05-07-addendum-{N}.md` documents the change (append-only per NFR-R3 discipline)

#### Story T9.4: [new] Per-Scorer-Device PWA Install Verification

As Josh,
I want a manual drill script run per device that might actually be assigned scorer or receive a scorer handoff during Pinehurst — verifying PWA install + IndexedDB persistence + offline score entry + reconnect sync on THAT specific device,
So that FD-14 PWA-primary posture isn't assumed, it's verified on every device in scorer-eligible scope (post-Codex pass-2 gate; Codex flag 8 scoping).

**Scope clarification (per Codex flag 8):** "every device that might be assigned scorer or receive a handoff" — narrower than "every player's device," broader than a fixed "2 per round × 4 rounds" count. For Pinehurst v1, expected scope = every Pinehurst scorer's primary device + any device plausibly on-the-turn for a handoff (Jeff primary scorer all 4 rounds + Ben as handoff target + any organizer backup = ~3 devices verified). If scorer assignments shift post-drill, the new assignee's device MUST be verified before the round it scores.

**Depends on:** T5.3 (offline queue), T5.4 (shell cache), T7.6 (install prompt).

**Acceptance Criteria:**

**Given** `apps/tournament-web/src/scripts/drill-scorer-install.md`
**When** inspected
**Then** it's a per-device checklist:
  1. Device identification: make/model/OS version (e.g., "iPhone 14 Pro, iOS 17.4")
  2. Install: open tournament URL in Safari (iOS) or Chrome (Android); Add to Home Screen / Install flow; verify app icon
  3. Launch from icon: verify `display-mode: standalone` active (no browser chrome); `isInstalledPWA()` returns true
  4. Cache test: open a test round while online; close app completely; re-open from home icon — verify scorecard renders from cache without network (T5.4)
  5. Offline score test: enable airplane mode; score 3 holes for 4 players (12 cells); verify sync chip "queued 12"
  6. Restart while queued: close app completely; re-open — verify IndexedDB preserved the queue (sync chip still "queued 12"; entries not lost)
  7. Reconnect sync: disable airplane mode; verify sync chip reaches "all synced" within 30s; leaderboard on a second (online) device shows all 12 cells
  8. **Install prompt suppression** — trigger a mutation (score a hole); verify install prompt does NOT appear (device installed; T7.6 per-device suppression via `device_bindings.install_prompt_shown_at`)
  9. Record: `reference/drills/drill-scorer-install-{device-model}-{date}.record.md` — pass/fail per step, tester name, tournament commit SHA, screenshots of sync chip states

**Given** all scorer-eligible devices (per scope clarification above) complete this drill before 2026-05-07
**When** T9.2 pre-event checklist is reviewed
**Then** each device's drill record is linked under "T9.4 per-device install verification"; any device failing steps 4–7 BLOCKS that device from scoring at Pinehurst (fix issue OR transfer scorer role to a verified device via T5.7 handoff)

**Given** a scorer role is reassigned post-drill (e.g., Ben replaces Jeff for round 3 mid-event)
**When** the new assignee's device has NOT completed T9.4 verification
**Then** the reassignment is flagged to the organizer as an unverified-device risk; organizer can proceed (accept risk) or insist on a pre-round T9.4 pass

**Given** a device that passes verification
**When** Pinehurst day arrives
**Then** the drill record is the release-gate evidence that device's offline pathway works end-to-end; no day-of "I hope this works" gamble

**Note:** T9.4 is the device-level counterpart to T5.10's automated 409-collision + drill script. T5.10 validates server-side correctness; T9.4 validates client-side device reality. Both must pass for the offline-sync gate to close.
