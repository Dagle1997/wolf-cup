---
status: SUPERSEDED
superseded_on: 2026-04-14
superseded_by: prd.md (Foundation Decisions FD-1..FD-15) + BMAD architecture workflow (FD-15)
original_status: draft
steps: [step-07-technical-decisions, step-08-out-of-scope, step-09-assumptions-dependencies, step-10-risks-final, step-11-handoff]
drafted: 2026-04-13
---

# ⚠️ SUPERSEDED — DO NOT USE AS REFERENCE

This draft was written 2026-04-13 before the 2026-04-13/14 party-mode review sessions resolved 10 open topics and locked FD-1..FD-15 in `prd.md`. The party decisions reversed or modified many of the calls made here. The file is preserved as a drafting artifact only.

## Reversed / modified by party decisions

- **TD-1 (monorepo rename)** — reversed by FD-1 (no rename).
- **TD-2 (bcrypt auth)** — reversed by FD-4 (SSO + GHIN bind, no passwords v1).
- **TD-6 (strict scorer-auth)** — softened by FD-3 (hole-level soft-lock + audit log).
- **TD-9 (device cookie only, no SSO)** — reversed by FD-4.
- **TD-13 (iOS PWA push with hard cap)** — reversed by FD-5 (no push ever; app creates pull, not push).
- **Step 8 OOS item 5 ("No Skins")** — reversed by FD-11 (Skins in v1 as first sub-game).
- **Step 8 OOS item 14 (SMS/iMessage bridge)** — reinforced by FD-5 (no push/SMS/email ever).
- **Step 9 assumption "PWA install cliff"** — addressed by FD-14 (in-app install prompt + browser-tab graceful).
- **Step 10 Tier 1 Wolf Cup rename risk** — retired (no rename).
- **Step 10 Tier 2 iOS push risk** — retired (no push).
- **Step 11 handoff "do not re-debate" list** — several items reversed (see above).

## What replaces this content in `prd.md`

| Original draft step | Now lives in `prd.md` as |
|---|---|
| Step 7 Technical Decisions | Foundation Decisions section (FD-1..FD-15) |
| Step 8 Out of Scope | Growth Features + Explicitly out of v1 + design-principles section |
| Step 9 Assumptions | Success Criteria + trip-critical scope lock + assumptions embedded in FDs |
| Step 10 Risks | Risks & Mitigations table (with retired entries marked) |
| Step 11 Handoff | FD-15 (full BMAD architecture workflow); `create-architecture` produces the formal Step 7-11 artifacts next |

## Do not merge this draft

Per FD-15, Steps 7-11 formal content is produced by the BMAD architecture workflow, not by extending this PRD. The PRD now contains the locked decisions; the architecture workflow will produce `tournament/architecture.md` with concrete schema, API surface, module layout, and sequencing.

The content below this banner is retained for historical reference only.

---

## ORIGINAL DRAFT CONTENT (OBSOLETE)

Not yet committed to `prd.md`. Pending user review + C approval. All four sections drafted together because they share context and many items cross-reference.

---

## Step 7 — Technical Decisions

Decisions locked for v1 foundation. These are the "we chose X, not Y, because Z" calls that Step 6 epics assume.

### TD-1 — Monorepo rename first, scaffold second

**Decision:** Rename `apps/api` → `apps/wolf-cup-api` and `apps/web` → `apps/wolf-cup-web` before any tournament scaffolding (story T1.1). Run full Wolf Cup test suite + one live-round smoke after rename, in production, before T1.2 starts.

**Why not:** Scaffolding tournament as `apps/tournament-*` next to `apps/api`/`apps/web` would work but leaves a permanent asymmetry (one app is "the app," the other is named). Renaming is a one-time cost that pays off forever in clarity and in search/refactor tooling.

**Risk:** Renaming a live app that ships every week. Mitigated by gating T1.1 exit on green tests + live smoke.

### TD-2 — Tournament owns its own DB and runtime

**Decision:** Tournament has its own `tournament.sqlite` volume, its own Hono process, its own Traefik route (`tournament.dagle.cloud`), its own auth realm (bcrypt + session), and **does not open** the Wolf Cup DB under any circumstance.

**Why not:** Shared DB would ease cross-event stats later but couples failure domains. A bug in tournament migration could corrupt Wolf Cup state. Two DBs forever is fine; cross-app identity reconciliation (if it becomes necessary) happens via a future aggregation layer, not shared tables.

### TD-3 — `packages/engine` is the only shared code

**Decision:** Only code that lives in `packages/engine` is allowed to be imported by both apps. `apps/tournament-*` and `apps/wolf-cup-*` do not import each other directly. "Port verbatim" stories (T3.4 GHIN, T5.3 offline queue, T7.4 gallery, etc.) mean **copy the file into tournament's tree**, not add a cross-app import.

**Why not:** Cross-app imports would create a third coupling surface beyond engine + DB schema, making sibling separation meaningless. The copy cost is low; the coupling cost is high.

**Implication:** If a bug is found in ported code (e.g., offline queue), it's fixed in both places independently. This is an accepted cost of isolation.

### TD-4 — SQLite + better-sqlite3 (parity with Wolf Cup)

**Decision:** Drizzle ORM + better-sqlite3 file-backed SQLite, same stack as Wolf Cup. No Postgres, no managed DB, no ORM swap.

**Why not:** Multi-tenancy later (vision-tier) may push toward per-tenant DBs (still SQLite) or a single Postgres with row-level security. Neither matters for v1; both are solvable without rewriting v1 schema.

### TD-5 — Pure TS engine, zero deps, Vitest

**Decision:** `packages/engine` stays pure TypeScript with zero runtime deps. All money/press/bet/tiebreak logic lives in pure functions, tested with Vitest and golden-file fixtures. API and UI consume the engine; neither embeds game logic directly.

**Why:** This is the central correctness lever. Money correctness is THE product (risk register). A pure engine with exhaustive golden fixtures is the only way a solo dev ships money correctness with confidence.

### TD-6 — Single-writer scorer model, enforced at API

**Decision:** Exactly one `scorer_user_id` per `(round_id, group_id)` at any time. The score-mutation endpoint returns 403 unless `session.userId === scorer_assignments[round][group]`. Handoff is a dedicated atomic endpoint (T5.7). Offline queue mutations carry the scorer's user id at enqueue time; server validates on drain.

**Why not:** Wolf Cup's "anyone with entry code writes" pattern is fine when scorecard = social contract (one phone at the table). Tournament with cross-foursome bets breaks that social contract — a wrong writer shifts money across groups. Enforce it.

### TD-7 — DB-layer last-write-wins + audit, not merge engine

**Decision:** Conflict resolution at the DB is `onConflictDoUpdate` on `(round_id, player_id, hole_number)` — last-write-wins, idempotent. Client event IDs on queue entries allow server-side dedup of duplicate mutations, but no three-way merge. The audit log (FR-B8) is the audit trail; there is no "merge UI."

**Why not:** Proper merge engines (CRDTs, three-way UI) are expensive and error-prone in a money app. Single-writer (TD-6) means conflicts are rare; when they occur, audit log surfaces them for human resolution.

### TD-8 — GHIN-as-optional-join-key identity

**Decision:** `players.id` is the eternal local PK; `players.ghin` is nullable unique. Cross-event stat rollups join on GHIN when present. Non-GHIN players don't aggregate. Admin-gated `player_identity_merges` table handles the rare rename/reissue case.

**Why not:** Forcing GHIN would exclude trip guests and new golfers. Using GHIN as PK would break when GHIN changes. Nullable unique + local PK gives both properties.

### TD-9 — Device cookie binds, doesn't authenticate

**Decision:** Invite-link first-arrival → "that's me, I'm Jeff" tap → cookie sets device → player mapping. No password, no magic link, no email. One-tap override to switch. For reads only.

**Why not:** Magic-link flows add email dependency (deliverability risk) and friction for a read-only use case. GHIN being publicly lookup-able means tight auth on reads is security theater. See Foundation Decisions §"Identity confidence is low; money integrity is high."

### TD-10 — Money visibility enum lives on Groups, defaults to `open`

**Decision:** `groups.money_visibility` enum column present in v1 schema, defaults to `open`. v1 code paths only handle `open`. v1.5 adds `participant` and `self_only` handlers without migration.

**Why not:** Adding the column later would require migrating existing Groups. The column is free now; the handlers cost something and can wait.

### TD-11 — Course revisions, not course mutations

**Decision:** `courses.id` + `course_revisions.id` with foreign keys from `event_rounds.course_revision_id`. Tee changes / resurfacing = new revision row; old rounds stay pinned to old revision.

**Why not:** In-place updates to course data would silently invalidate historical scoring. Immutable revisions are cheap and make cross-event stats trustworthy years later.

### TD-12 — Append-only structured JSON logs

**Decision:** Observability (NFR-O1) is a JSONL file per day in a known path, plus console output. Organizer-downloadable. No external telemetry service.

**Why not:** Enterprise telemetry (Datadog, Honeycomb) is overkill for a solo-dev hobby app. File logs are grep-able and portable. If v1.5 proves debugging-under-pressure is a real pain, revisit then.

### TD-13 — iOS PWA push with a hard cap; no SMS fallback

**Decision:** Build Web Push + VAPID for iOS PWA. Test on a real iPhone by target-minus-7-days. If it doesn't work reliably, **cut notifications entirely** for that Event cycle. No Twilio, no SMS, no email fallback matrix.

**Why not:** Building a fallback matrix for an optional feature creates hours of work for days of marginal value. Codex's guidance: "believe yourself" when you already wrote that the trip works without push.

### TD-14 — React 19 + TanStack Router/Query + shadcn + Tailwind v4

**Decision:** Same web stack as Wolf Cup. No framework divergence.

**Why:** Port cost is already discounted into story tags; any stack divergence negates the discount.

### TD-15 — Hono + Zod + Drizzle

**Decision:** Same API stack as Wolf Cup. Zod schemas per route, Drizzle for typed queries.

**Why:** Same reason as TD-14. Also: auth middleware, bcrypt, and session cookie patterns are all drop-in ports.

### TD-16 — Engine extraction for shared rules, not shared schema

**Decision:** `packages/engine/src/stableford.ts` (already shared) stays. New: `packages/engine/src/formats/best-ball-2v2.ts`, `packages/engine/src/rules/press.ts`, `packages/engine/src/rules/individual-bets.ts`. DB schemas stay per-app; engine operates on plain data structures passed in by the API layer.

**Why not:** Sharing DB schemas (a `@wolf-cup/schema` package) would couple migrations across apps. Sharing only pure functions is the right level of reuse.

---

## Step 8 — Out of Scope (v1)

Named explicitly so scope creep has to fight a document, not just guess.

### Hard out-of-scope for v1

1. **Round container type.** v1 = Event only. Round is post-v1.
2. **League container type** (Guyan Thursday recurring). Post-v1.
3. **Multi-tenancy / subdomain-per-club.** Single-tenant v1.
4. **Paid tier, licensing, payment processing, billing.** Zero monetization code.
5. **Additional team formats.** v1 = 2v2 best ball only. No Stableford standalone, no Skins, no Wolf, no Nassau, no Sixes, no BBB, no Alternate Shot, no Scramble.
6. **Additional individual-bet types beyond two.** v1 = $/hole match play, and $/hole match play with auto-press. No skins-style individual, no Nassau-nested, no press-on-press chains.
7. **Cross-event stats UI.** Schema foundation in v1; UI surfaces v1.5+. "Alan's Volkswagen game provable" is not a v1 demoable feature.
8. **Player-voting on rules/games.** No in-app democracy v1.
9. **Predictions / pick-em module.** Post-v1.
10. **User-contributed course photos with hole tags.** Post-v1.
11. **Rule marketplace / cross-group sharing.** Post-v1.
12. **USGA/BlueGolf canonical reconciliation** of course data. Manual + PDF-parse-assisted is v1.
13. **NCRDB / Playwright course bootstrap pipeline.** Post-v1.
14. **SMS / iMessage bridge.** No fallback, no opt-in, nothing. Push works or notifications are off.
15. **Email notifications, digest summaries, reminder schedulers.** Not v1.
16. **Full-text search across events / groups / players.** Not v1 (the scale doesn't warrant it).
17. **Cross-app identity reconciliation with Wolf Cup.** Tournament is a separate identity universe. No shared player table, no shared auth.
18. **Offline write conflict resolution UI.** Server-side last-write-wins + audit is the only resolution (TD-7).
19. **Real-time collaborative editing of rule sets.** One editor at a time, last-save-wins.
20. **Accessibility beyond reasonable defaults.** WCAG AA is a nice-to-have, not a gate. The user base is 8 friends.

### "No v1.5" implicit

Not explicitly blocked but de-prioritized below v1.5 candidates already named in Vision:
- Cross-sport library (tennis, bowling)
- Extracted `@wolf-cup/ghin-client` package (v1 copies the file)
- Course data import from Course Rating Database via automation
- AI-generated player avatars

---

## Step 9 — Assumptions & Dependencies

### External dependencies

| Dependency | Use | Failure mode if unavailable | Mitigation |
|---|---|---|---|
| **Anthropic API (vision)** | Scorecard PDF parser (T2.3) | Manual course entry still works (T2.5) | T2.3 is tagged target-miss-tolerable; not on critical path |
| **GHIN.com lookup** | Handicap index auto-populate (T3.4) | Manual HI entry fallback (FR-A6) | Ported Wolf Cup pattern already handles fallback |
| **Cloudflare R2** | Photo gallery storage (T7.4) | Gallery doesn't load, non-critical | Same bucket as Wolf Cup; if R2 is down, Wolf Cup is also down |
| **Traefik (VPS)** | TLS + routing for `tournament.dagle.cloud` | App unreachable | Shared with Wolf Cup; co-incident outages only |
| **Docker / docker-compose** | Runtime | App unreachable | Same ops substrate as Wolf Cup |
| **iOS PWA Web Push** | Notifications (T8) | Notifications silent | Hard cap (TD-13); not a trip blocker |
| **USGA GHIN service** | Handicap lookup | Manual fallback | See above |

### Platform/technical assumptions

- SQLite file-backed DB is sufficient for v1 and v1.5 scale (Wolf Cup has validated this through a full season).
- Node.js 20 is the runtime floor; Node 24 migration is parked (Wolf Cup memory note) and would affect both apps uniformly.
- Pinehurst hotel / Southern Pines area has serviceable cell connectivity in-town, dead on-course in patches — matches Wolf Cup's Guyan mountain course assumptions.
- Players will install the PWA to homescreen on iOS / add to homescreen on Android. If they refuse, browser-tab mode is supported but push is lost.
- Players have smartphones. No paper-card fallback for data entry is contemplated beyond PDF for pairings/schedule.
- Josh is the sole organizer for all v1 events. No v1 test of multi-organizer coordination.

### Business / product assumptions

- 8 players for Pinehurst is representative. Scale to 16 or 24 is a v1.5 concern.
- Money is cash-settled outside the app. App tracks; app does not disburse.
- All players trust each other enough that audit-log-as-deterrent is sufficient; no cryptographic signing of scores.
- Group members are known ahead of trip; no in-trip roster expansion expected (but schema supports it).
- Rule sets are relatively stable within a Group season. Mid-Event rule changes are possible but rare (not optimized-for UX).

### Developer assumptions

- Josh is the only developer. No PRs to review. CI gates exist but human review is self-review.
- Wolf Cup is in a stable state and does not demand parallel feature work during tournament development windows.
- Codex / LLM pair reviews are available for PRD-level sanity checks (as demonstrated this session).

### Explicit non-assumptions

- Do not assume Jason Moses will independently onboard the tournament app. Wolf Cup onboarding is still in progress (memory notes).
- Do not assume any Golf Genius / 18Birdies / Golf GameBook user will switch. v1 target is Josh's circle only.

---

## Step 10 — Risks (Final, Expanded from Foundation Decisions Preview)

Expanded version of the Risks & Mitigations table already in the main PRD. Adding second-order risks surfaced during Steps 7–9.

### Tier 1 — Product-killing if realized

| Risk | Mitigation | Owner |
|---|---|---|
| **Money correctness failure at settle-up** | Pure engine + golden fixtures per rule variant + one end-to-end hand-calc fixture (T6.9) + audit log (FR-B8) + raw-state export for external verification (NFR-B1) | Josh (engine tests are non-negotiable) |
| **Wolf Cup regression during monorepo rename** | Gate T1.1 exit on all 854 tests green + live smoke in prod | Josh |
| **Scorer auth not enforced (Wolf Cup pattern inherited)** | FR-B10 + T5.6 dedicated story + 403 test case required | Josh |

### Tier 2 — Degrades product quality, does not kill

| Risk | Mitigation |
|---|---|
| Offline sync bug | Port Wolf Cup verbatim; airplane-mode drill (T5.10); don't redesign |
| iOS PWA push unreliable | Hard cap at target-minus-7-days; cut rather than patch |
| Pairings optimizer rabbit hole | Ship manual UI (T4.2); optimizer target-miss-tolerable |
| Course OCR time-sink | Manual entry (T2.5) is critical path; parser optional |
| Private money disclosure blocks v1.5 adoption | Visibility modes designed v1, shipped v1.5 |

### Tier 3 — Second-order risks surfaced in Steps 7–9

| Risk | Mitigation |
|---|---|
| **Solo-dev context switch cost (Wolf Cup + Tournament live)** | Commit-tag discipline; avoid Wolf Cup edits during tournament windows unless critical |
| **Ported code bugs diverge across apps** (T3 accepts this cost) | Cross-app bug triage: fix both when discovered; flag in commit |
| **Drizzle migration drift** between apps | Each app has its own `drizzle.config.ts`; migrations never cross apps |
| **Anthropic vision API cost / rate limits** if T2.3 ships | Small blast radius (manual fallback exists); monitor spend during course seeding |
| **Cloudflare R2 egress cost** as photo gallery scales | Same bucket as Wolf Cup; monitor together |
| **Browser cache invalidation** when port verbatim code updates | Use Wolf Cup's version-check refresh banner pattern (commit e0740a5) |
| **iPhone homescreen PWA install refusal** by players | Soft nudge in invite-link flow; don't force; accept reduced push reach |
| **DNS / Traefik config error on tournament.dagle.cloud cutover** | Test on a staging subdomain first; have rollback plan |
| **Organizer forgets to finalize a round** | Lifecycle state (FR-B9) surfaces pending-finalize reminders; no auto-finalize in v1 (too risky) |
| **Wolf Cup's offline queue has an unknown latent bug** that only surfaces under tournament workload | Carry same test suite; accept as shared risk |

### Risks explicitly accepted without mitigation

- Spectator invite-link leakage (content is already socially known within the group)
- Cross-app identity reconciliation (deferred; accept two identity universes)
- GHIN being not-a-secret (accept; treat as identifier not password)
- PDF-based audit fallback when everything else fails (accept; PDF pairings are the last line)

---

## Step 11 — Handoff

### Document status

This PRD is **ready for the Solutioning / Architecture workflow**. It captures:
- Vision, exec summary, classification (Steps 1–2c)
- Success criteria with measurable outcomes (Step 3)
- Four user journeys revealing all v1 capabilities (Step 4)
- 30+ functional requirements and 11+ non-functional requirements (Step 5)
- 9 epics, 53 stories with reuse tags and critical-path tiers (Step 6)
- Trip-critical scope lock (new section)
- Wedge statement and competitive positioning (revised exec summary)
- Foundation Decisions locking schema and identity shape
- Risk register with mitigations
- 16 technical decisions with rationale (Step 7)
- 20 explicit out-of-scope items (Step 8)
- External dependencies and assumptions catalog (Step 9)
- Three-tier risk register (Step 10)

### What the next workflow needs to produce

The BMAD architecture workflow (`create-architecture`) should produce, in order:
1. **Data model** — concrete Drizzle schemas for: `events`, `event_rounds`, `groups`, `group_members`, `players`, `player_identity_merges`, `courses`, `course_revisions`, `course_tees`, `course_holes`, `rule_sets`, `invites`, `device_bindings`, `scorer_assignments`, `hole_scores`, `score_corrections`, `round_states`, `money_ledger`, `individual_bets`, `bet_results`, `notification_log`.
2. **API surface** — Hono route tree: `/events`, `/events/:id/rounds`, `/events/:id/groups`, `/events/:id/invites`, `/rounds/:id/scorer-assign`, `/rounds/:id/groups/:g/holes/:h/scores`, `/rounds/:id/corrections`, `/rounds/:id/finalize`, `/rounds/:id/leaderboard`, `/events/:id/money-matrix`, `/events/:id/settle-up`, `/events/:id/export`, `/players/:id/bets`.
3. **Engine module layout** — `packages/engine/src/formats/best-ball-2v2.ts`, `packages/engine/src/rules/press.ts`, `packages/engine/src/rules/individual-bets.ts`, `packages/engine/src/rules/tie-break.ts`, with a clear pure-function boundary.
4. **Offline queue port spec** — explicit shape diff between Wolf Cup's `QueueEntry` and tournament's equivalent.
5. **Permissions middleware design** — the role matrix (FR-H1–H7) as executable middleware.
6. **Course revision semantics** — how a new revision is minted, what migrates, what stays pinned.
7. **Money visibility implementation note** — how `open` / `participant` / `self_only` branch at the query layer without leaking via joins.
8. **Observability hook points** — where JSONL events are emitted from.
9. **Deployment diff** — docker-compose additions, Traefik labels, volume mounts, startup script changes.
10. **Test strategy** — engine golden fixtures, API integration tests, web E2E coverage for money + scorer handoff + audit log paths.

### What the next workflow should *not* re-debate

These are locked by this PRD and should be inherited, not re-litigated:
- Event-only v1 (not Round, not League)
- 2v2 best ball as the v1 team format
- Two individual-bet types
- GHIN-as-optional-join-key identity model
- Group-level money visibility
- Single-writer scorer enforcement
- Ported code sources (Wolf Cup files named in reviewer note)
- Hard cap on iOS push
- Cross-event stats schema v1, UI v1.5+
- Monorepo rename before scaffold
- React 19 / TanStack / shadcn / Tailwind v4 web stack
- Hono / Drizzle / better-sqlite3 API stack

### Validation checklist before handoff

- [x] Every FR traces to a journey or explicit Codex-surfaced gap
- [x] Every NFR has a testable threshold or qualitative bar
- [x] Every story carries a reuse tag
- [x] Critical path distinguishes trip-critical hard blockers from target-miss tolerable
- [x] Risks have mitigations; accepted risks are named
- [x] Assumptions are explicit, not buried
- [x] Out-of-scope is a numbered list, not implied
- [x] Reviewer note explains Wolf Cup inheritance
- [ ] Codex second-pass review (optional, post-draft)
- [ ] Architecture workflow kickoff

### Open items for Josh before architecture

None that block handoff. Nice-to-have pre-architecture clarifications:
1. **June trip details** — if May 7 slips, what's the next target date and format? (Affects T9 timing calendar only.)
2. **Rule-set naming convention** — "Pinehurst stakes" is Josh's; formal constraint on length / uniqueness? (Minor UI decision.)
3. **Photo gallery R2 bucket sharing** — same bucket as Wolf Cup with an Event-id prefix, or separate bucket for isolation? (Ops decision, not blocking.)

---

## Summary

This completes BMAD PRD Steps 1–11. The document is internally consistent, scope-locked, Wolf-Cup-aware, deadline-honest (foundation-first, Pinehurst is target not deadline), and ready to enter the architecture workflow.

Total length after commit: expected ~850–900 lines. Living document — updates welcome as reality disagrees with the plan.
