# Story 3.2: Scorecard API — per-player per-hole gross / net / relativeStrokes / claims fold

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!--
SOURCING NOTE (director, 2026-06-23): This story is sourced from
`scoreboard-rework-spec.md` (the authoritative Epic-3 "Scoreboard rework" design),
NOT from the create-story `epics_file` (`epics-f1-rules-games.md`). That epics file
has a DIFFERENT, colliding "Epic 3: Teams & the Event Pot" with its own 3.1–3.5
numbering; resolving "3.2" against it yields the wrong story (round-level rule-set
override). The scoreboard Epic-3 stories (3-1..3-5) are tracked in sprint-status.yaml
and specified by scoreboard-rework-spec.md. 3-1 (HoleBadge + grid port) was built the
same way last session.
-->

## Story

As a **Tournament player viewing the during-round board**,
I want **an API that returns one player's round as a per-hole scorecard — gross, net, the handicap strokes they receive, and their greenie/polie/sandie claims**,
so that **the ported HoleBadge/ScorecardGrid (Story 3-1) can be wired to live data in Story 3-4 and render a real round, not a fixture.**

This is **S2 of the scoreboard rework** (see `scoreboard-rework-spec.md` "Suggested story split"). It is **API-only**: a new read endpoint + a pure builder service + tests. It does **NOT** wire any web route (that is 3-4) and does **NOT** compute per-hole money — `moneyNet` is returned as `null` on every hole (the 3-3 seam; the 3-1 component already renders `null` → `—`, never `$0`). 3-2 reuses the existing `deriveCurrentClaims` claim-fold and the engine stroke-allocation helper; it adds no schema and no migration.

## Acceptance Criteria

1. **New endpoint** `GET /api/rounds/:roundId/players/:playerId/scorecard` returns `200 { holes: ScorecardHole[] }`, mounted on the existing `/api/rounds` router family (`app.route('/api/rounds', …)`). Each `ScorecardHole` carries `{ holeNumber, par, grossScore, netScore, relativeStrokes, hasGreenie, hasPolie, hasSandie, moneyNet }`, matching the tournament-web `ScorecardHole` shape authored in 3-1 (`apps/tournament-web/src/types/scorecard.ts`).

2. **One entry per in-play hole.** The response contains exactly the holes the round plays — hole numbers `1..holesToPlay` (from `rounds.holesToPlay` / `event_rounds.holesToPlay`, CHECK ∈ {9,18}) — sourced from `course_holes`, ordered ascending by `holeNumber`. `par` and the stroke index (`si`) come from `course_holes` via the join `round → event_rounds.courseRevisionId → course_holes` (tenant-scoped). If a course-hole row is missing for an in-play hole number, that is a server-side data error (500 / clear error), never a fabricated par.
   - **9-hole rounds = the FRONT nine (holes 1–9).** Evidence: `events.ts:26` + the `event_rounds`/`rounds` schema carry **only** a `holes_to_play` count (CHECK ∈ {9,18}) — there is **no front/back / start-hole / which-nine indicator** anywhere (the `start_hole` column lives on `team_press_log`, unrelated). A back-9 9-hole round is therefore **not representable** in the current data model, so `1..holesToPlay` is correct and unambiguous. If a back/which-nine round type is ever introduced it needs a schema field first — recorded as an explicit **followup**, out of scope for 3-2. Pete Dye (the real consumer) plays 18 (`1..18`).
   - **Course revision:** use `event_rounds.courseRevisionId` for the par/si join. The `round_pin` stores the same `courseRevisionId` (`round-pins.ts`); they must agree. The pin is authoritative only if a future correction re-points the course (Epic 4) — out of scope here; 3-2 reads `event_rounds.courseRevisionId`.

3. **Gross.** `grossScore` is the player's `hole_scores.gross_strokes` for that (round, player, hole) when a row exists, else `null` (unplayed). Never `0` for unplayed.

4. **relativeStrokes from the PINNED course handicap — via the SAME allocation the money engine uses.** When a `round_pin` row exists and carries a numeric `ch` for this player (`perPlayerHandicapsJson[playerId].ch`), `relativeStrokes` = strokes allocated from that **pinned `ch`** and the hole's stroke index, computed with the **same helper the F1/2v2 money path already uses** (`apps/tournament-api/src/engine/handicap-strokes.ts`, as in `engine/formats/best-ball-2v2.ts`) — **not** a new `packages/engine` import, and **not** a re-derivation of CH from live HI. **Consistency invariant:** the per-hole `relativeStrokes`/`netScore` the scorecard returns MUST equal the per-hole net the money engine computes for the same (player, hole), so the board and the money never disagree; any 9-hole-handicap nuance is **inherited** from that shared allocation, not redefined here (this resolves the "9-hole stroke allocation" concern by construction). `relativeStrokes` is returned for **every** in-play hole, **including unplayed ones** (so the grid shows stroke dots on not-yet-played cells, per `scoreboard-rework-spec.md` "Show on unplayed cells too").

5. **net = gross − relativeStrokes** for played holes; `netScore` is `null` when `grossScore` is `null` (unplayed). Net is never negative-fabricated for an unplayed hole.

6. **No-pin / fail-closed fallback returns UNKNOWN net, never a misleading net=gross.** If no `round_pin` row exists, the player has no pin entry, or the pinned `ch` is `null` (the documented fail-closed "unsettleable" case), then strokes are **unknown**: `relativeStrokes = 0` (so **no** stroke dots render — we don't claim a stroke count) **and** `netScore = null` even for played holes (so the grid renders `—` for net, exactly as for an unplayed cell — an honest "net not available", NOT `gross`, which would read as a real net score). `grossScore` still returns the posted gross. This path MUST be covered by a test, MUST NOT throw, and MUST NOT invent strokes or fabricate a net. (Rationale: the during-round board targets F1 events, which pin at start-round; for an un-pinned round we keep the board readable — gross shows — without lying about net. Flagged as a known limitation for the 3-4/Epic-4 money work.)

7. **Claims fold via the existing helper.** `hasGreenie / hasPolie / hasSandie` are derived by **reusing `deriveCurrentClaims`** (`services/claim-write.ts`) with `restrictToPlayerIds: [playerId]` — the append-only `hole_claim_writes` log collapsed to current state per (player, hole, claimType) where the latest `seq`'s `op` wins (`set` present / `remove` absent). 3-2 does **not** write a new fold. **All three flags are non-optional `boolean` in the API response — always emitted explicitly, defaulting to `false` when no current claim exists (never `undefined`/omitted), so clients and tests never disambiguate absent-vs-false.** Claims appear on a hole regardless of whether it has a gross score (a claim can precede the posted score).

8. **moneyNet is always `null` in 3-2.** Per-hole F1 money is Story 3-3 (the Epic-4 per-hole seam). The endpoint returns `moneyNet: null` for every hole and never fabricates `0`/`$0`. A code comment marks this as the 3-3 seam.

9. **Auth + not-found semantics.**
   - `requireSession` gates the route.
   - Round resolution is tenant-scoped: a nonexistent or foreign-tenant `roundId` returns a uniform `404 { code: 'round_not_found' }` (mirror `scores.ts` round-detail).
   - The caller must be able to view the event: an **event participant OR the event organizer** (mirror `require-event-participant.ts` semantics incl. the T13-1 organizer exemption). A signed-in non-participant gets `403`. (Read visibility matches the leaderboard; money is not yet exposed, so no money-audience gating is needed in 3-2 — that becomes relevant when 3-3 adds real `moneyNet`. Note it as a forward concern.)
   - A `playerId` that is not part of the round (no pairing membership for the round) returns `404 { code: 'player_not_in_round' }`.
   - **Every lookup is tenant-scoped** (round, event/participant, pairings, hole_scores, round_pin, course_holes, claims) — not just the round existence check — so no cross-tenant read is possible via any join.

10. **Tests.**
    - **Service unit tests** (pure builder): claims fold (set/remove/re-set latest-wins; multi-type co-occurrence; all-false default emitted explicitly), stroke allocation from pinned `ch` (a player who gets strokes on low-SI holes vs one who doesn't), the no-pin/null-ch fallback (`relativeStrokes 0`, **`netScore null`** for played holes, gross still present), unplayed cells (gross/net null, `relativeStrokes` still present from the pin), and `moneyNet` null on every hole. **Consistency check:** at least one test asserts the builder's per-hole `netScore` equals the net the existing money/best-ball path computes for the same seeded (player, hole) inputs (guards the AC #4 invariant). A missing `course_holes` row for an in-play hole surfaces as a clear error (not a fabricated par).
    - **Route integration tests** (HTTP roundtrip, mirroring `scores.read.test.ts` / `scores.integration.test.ts`): 200 happy path with a seeded pinned round + scores + claims; 404 round_not_found (bad/foreign-tenant round); 403 non-participant; 404 player_not_in_round; 9-hole round returns 9 holes.
    - No regression to existing tournament-api suites; typecheck + lint clean.

11. **Additive only — no schema, no migration, no web changes.** 3-2 adds a route + a service + tests and registers the route in `app.ts`. No new tables/columns, no drizzle migration, no `apps/tournament-web/**` edits. Tournament paths only (FD-1/FD-2).

## Files this story will edit

- apps/tournament-api/src/services/scorecard.ts
- apps/tournament-api/src/services/scorecard.test.ts
- apps/tournament-api/src/routes/scorecard.ts
- apps/tournament-api/src/routes/scorecard.integration.test.ts
- apps/tournament-api/src/app.ts

## Tasks / Subtasks

- [ ] Task 1 — Pure builder service (AC: #2, #3, #4, #5, #6, #7, #8)
  - [ ] `src/services/scorecard.ts`: export `buildPlayerScorecard(dbOrTx, { roundId, playerId, tenantId }): Promise<ScorecardHole[]>` (define a local `ScorecardHole` type matching the web shape — do NOT import from `apps/tournament-web/**`; the two type defs are mirror copies across the app boundary, as 3-1 noted).
  - [ ] Load the round (`rounds`) tenant-scoped → `eventId`, `eventRoundId`, `holesToPlay`. Resolve the course revision via `event_rounds.courseRevisionId`. Load `course_holes` (par, si) for holes `1..holesToPlay`, ordered.
  - [ ] Load `hole_scores` for (round, player) → map by holeNumber → `grossStrokes`.
  - [ ] Load the `round_pin` for the round; parse `perPlayerHandicapsJson`; read `ch` for `playerId` (may be absent/null → fallback per AC #6).
  - [ ] For each in-play hole: let `hasStrokes = (ch != null)`; `relativeStrokes = hasStrokes ? getHandicapStrokes(ch, si) : 0`; `grossScore = scores.get(hole) ?? null`; `netScore = (!hasStrokes || grossScore == null) ? null : grossScore - relativeStrokes` (no pin/ch ⇒ net unknown ⇒ `null`, NOT gross, per AC #6); `moneyNet = null` (3-3 seam — comment it).
  - [ ] Fold claims with `deriveCurrentClaims(dbOrTx, { roundId, tenantId, restrictToPlayerIds: [playerId] })` → set `hasGreenie/hasPolie/hasSandie` by claimType per hole.
- [ ] Task 2 — Route (AC: #1, #9)
  - [ ] `src/routes/scorecard.ts`: a Hono router `scorecardRouter` with `GET /:roundId/players/:playerId/scorecard`, gated by `requireSession`. Resolve round (tenant-scoped) → 404 `round_not_found`. Enforce event participant-or-organizer (mirror `require-event-participant.ts`; reuse its predicate if exported, else inline the same membership+organizer check) → 403 on non-participant. Verify `playerId` is in the round's pairings → 404 `player_not_in_round`. Then `return c.json({ holes: await buildPlayerScorecard(db, {...}) })`.
  - [ ] Register in `src/app.ts`: `app.route('/api/rounds', scorecardRouter)` next to the existing `scoresRouter` mount (L140-141). Confirm path precedence does not shadow `scoresRouter` routes (distinct sub-paths: `/:roundId/players/:playerId/scorecard` vs `/:roundId/holes/...`).
- [ ] Task 3 — Tests (AC: #10)
  - [ ] `src/services/scorecard.test.ts`: unit-test the builder against a seeded in-memory DB (mirror the `scores.integration.test.ts` harness: libsql `file::memory:?cache=shared`, migrate, seed). Cover claims latest-wins, stroke allocation, no-pin fallback, unplayed cells, moneyNet null.
  - [ ] `src/routes/scorecard.integration.test.ts`: HTTP roundtrip via the `scores.read.test.ts` pattern (vi.mock db + require-session `__testPlayer`). Cover 200 happy path, 404 round_not_found, 403 non-participant, 404 player_not_in_round, 9-hole count.
- [ ] Task 4 — Verify (AC: #11)
  - [ ] `pnpm --filter @tournament/api test`, `pnpm -r typecheck`, `pnpm -r lint` clean. Confirm no migration added, no `apps/tournament-web/**` change, no `apps/web`/`apps/api`/`packages/engine` edit. Diff = the 5 declared files only.

## Dev Notes

### Endpoint contract (the 3-1 web shape, server side)
The tournament-web `ScorecardHole` (3-1, `apps/tournament-web/src/types/scorecard.ts`) marks several fields optional for the COMPONENT's convenience: `{ holeNumber, par, grossScore: number|null, netScore: number|null, moneyNet: number|null, hasGreenie?, hasPolie?, hasSandie?, relativeStrokes? }`. The API **response is a strict superset that always emits every field** — `relativeStrokes` is always a `number` (AC #4, present even on unplayed holes; `0` in the no-pin case) and `hasGreenie/hasPolie/hasSandie` are always explicit `boolean`s (AC #7). The optional markers on the web type are compatible with always-present API values (an optional field accepts a present value); the API never omits them. The API mirrors the shape as a hand-copied type, never a cross-app import (FD-1/FD-2). 3-2 returns `moneyNet: null` everywhere; the component renders that as `—`.

### Code surface (evidence-cited reconnaissance, 2026-06-23)
- **Route registration:** `apps/tournament-api/src/app.ts:140-141` — `app.route('/api/rounds', scoresRouter)`. Add `scorecardRouter` the same way.
- **Round-detail GET + auth precedent:** `apps/tournament-api/src/routes/scores.ts:89-189` — tenant-scoped round lookup → uniform `404 round_not_found`; foursome resolution via `pairing_members` with a `scorer_assignments` fallback (T13-3). Use it as the resolve-round + 404 pattern.
- **Participant/organizer gate:** `apps/tournament-api/src/middleware/require-event-participant.ts:48-118` (T13-1 organizer exemption). Reuse the predicate or inline the same check keyed on the resolved `eventId`.
- **holeScores schema:** `apps/tournament-api/src/db/schema/scoring.ts:109-153` — `hole_scores` { round_id, player_id, hole_number, gross_strokes }; unique cell (round, player, hole).
- **round_pins schema:** `apps/tournament-api/src/db/schema/round-pins.ts:20-49` — `per_player_handicaps_json` shape `{ [playerId]: { hi, ch } }` (Zod-validated at write). Written by `services/pin-round-at-start.ts:70-200`. A read example is in `services/games-money.test.ts:170-181`.
- **Stroke allocation (definitive — match the money path):** use the **in-tree tournament-api helper** `apps/tournament-api/src/engine/handicap-strokes.ts` (`getHandicapStrokes`), the exact one `engine/formats/best-ball-2v2.ts` already calls for per-hole net. Do **NOT** add a new import from `packages/engine/**` (that would be a cross-boundary/layering change; the engine `stableford.ts` helper is a read-only reference for the algorithm only). Allocate from the **pinned integer `ch`** (`perPlayerHandicapsJson[playerId].ch`) + the hole `si` — DO NOT re-derive CH from live HI. **Consistency invariant (AC #4):** the resulting per-hole `relativeStrokes`/`netScore` must equal what the F1/2v2 money path computes for the same inputs, so the scorecard and money never disagree; the 9-hole-handicap nuance is whatever that shared helper already does (inherited, not redefined). Confirm the helper's signature in-tree before wiring (it takes a CH/HI + SI [+ optional tee]); pass the pinned CH.
- **Claims fold (REUSE — do not rebuild):** `apps/tournament-api/src/services/claim-write.ts:114-160` — `deriveCurrentClaims(txOrDb, { roundId, tenantId, restrictToPlayerIds? })` returns `CurrentClaim[]` ({ playerId, holeNumber, claimType }) after a latest-`seq`-op-wins fold. `claimType ∈ {greenie,polie,sandie}`. This is the canonical claim state already used by score-entry (`scores.ts:268-275`).
- **par / stroke-index source:** `apps/tournament-api/src/db/schema/courses.ts:125-155` — `course_holes` { hole_number, par, si }. Join chain `round → event_rounds (courseRevisionId) → course_holes` (example at `scores.ts:879-925`).

### Test harness
- `vitest`. Integration pattern: `apps/tournament-api/src/routes/scores.integration.test.ts:1-92` — libsql `file::memory:?cache=shared`, `migrate(...)`, `vi.mock('../db/index.js')`, `vi.mock('../middleware/require-session.js')` injecting `__testPlayer`, and a `seedRound()` helper populating players/courses/eventRounds/pairings/rounds/roundStates/scorerAssignments/holeScores. The read-side companion `scores.read.test.ts` is the closest mirror for a GET endpoint. Add `round_pin` + `hole_claim_writes` rows to the seed to exercise strokes + claims.

### Scope guardrails
- **Tournament-api paths only.** FORBIDDEN: any edit to `apps/web/**`, `apps/api/**`, `packages/engine/**` (read-only reference for `getHandicapStrokes`). No `apps/tournament-web/**` change (wiring is 3-4).
- **No cross-app imports.** Mirror the `ScorecardHole` type locally; never import from `apps/tournament-web/**` or `apps/web/**`.
- **Additive, read-only.** No schema, no migration, no writes. Pure read endpoint + pure builder.
- **moneyNet stays null.** Do not pull any money computation forward — that is 3-3 (Josh: 3-3 builds REAL per-hole F1 money, golden-gated). 3-2 must leave a clean, documented `moneyNet: null` seam so 3-3 fills it without reshaping the response.

### Forward concerns (note, do not build here)
- **Money audience-bounding** (NFR-S1): once 3-3 puts real dollars in `moneyNet`, the participant-level read gate may need to drop money for cross-group/non-roster viewers. Out of scope for 3-2 (money is null); flag for 3-3/3-4.
- **Net basis for legacy (non-F1) rounds:** the no-pin fallback (AC #6) returns `netScore: null` (renders `—`), NOT net=gross — gross still shows. Legacy 2v2 events compute net from live CH, not a pin; surfacing a pinned net for them is out of scope here (the during-round board targets F1, which pins at start-round).
- 3-1 deferred followups that land at this seam: null-net reducer hardening and duplicate/out-of-range holeNumber validation — handle defensively in the builder where cheap.

### References
- [Source: _bmad-output/implementation-artifacts/tournament/scoreboard-rework-spec.md#API — NEW scorecard endpoint] — the endpoint contract (lines 69-83) + AC #3/#4.
- [Source: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md] — the consuming component + the `ScorecardHole` shape and moneyNet null/`—` contract.
- [Source: apps/tournament-api/src/routes/scores.ts:89-189] — round resolve + auth precedent.
- [Source: apps/tournament-api/src/services/claim-write.ts:114-160] — `deriveCurrentClaims` (reused).
- [Source: apps/tournament-api/src/db/schema/round-pins.ts:20-49] — pinned per-player CH source.
- [Source: packages/engine/src/stableford.ts:19-25] — `getHandicapStrokes`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (tournament-director, direct implementation)

### Debug Log References

- New scorecard tests green on first full run: `vitest run src/services/scorecard.test.ts src/routes/scorecard.integration.test.ts` → 19/19 (11 service + 8 route).

### Completion Notes List

- All 11 ACs met. New read-only endpoint `GET /api/rounds/:roundId/players/:playerId/scorecard` → `{ holes: ScorecardHole[] }`; pure builder `buildPlayerScorecard` + route + registration in `app.ts`. No schema, no migration, no web change.
- **relativeStrokes uses `allocateStrokesFromCourseHandicap(pinnedCh, si)`** — the canonical kernel the F1/2v2 money path already uses (cleaner than `getHandicapStrokes`, which re-derives CH from HI+tee). A test asserts `relativeStrokes === allocateStrokesFromCourseHandicap(ch, si)` per hole (AC #4 consistency invariant).
- **No-pin / null-ch fallback returns `netScore: null` (not net=gross)** + `relativeStrokes: 0`; gross still shown (AC #6) — tested for both the missing-pin and null-ch cases.
- **Claims reuse `deriveCurrentClaims`** with `restrictToPlayerIds: [playerId]`; all three flags emitted as explicit booleans (default false); cross-player leak guarded by a test.
- **moneyNet is `null` on every hole** (3-3 seam); a test asserts it's never fabricated.
- **Auth:** `requireSession` + inlined event-participant-or-organizer (group membership OR `events.organizer_player_id`, all tenant-scoped, mirroring `require-event-participant.ts` since this round-scoped route has no `:eventId`) → 403 non-participant; target-not-in-pairings → 404 `player_not_in_round`; round 404/foreign-tenant uniform; 400 on non-UUID params.
- **Missing course_hole for an in-play hole → `ScorecardDataError` → 500** (never a fabricated par); service-tested.
- 9-hole rounds return the front nine (1–9), per the schema's lack of a front/back indicator (AC #2). Tested.
- Tests use a **per-pid temp-file libsql DB** (not `file::memory:?cache=shared`) to avoid the reused-fork cache leak (T14-2 lesson).
- Followups (deferred, not 3-2 defects): money audience-bounding when 3-3 adds real `moneyNet`; course-revision mismatch between `event_rounds` and `round_pin` (currently assumed to agree); back-9 9-hole rounds (need a schema field first).
- **Impl-review (codex+gemini, synthesis SHIP/high) followups** — all theoretical/hardening, none blocking:
  - **Cache-Control: no-store** — DONE (added post-party-review). The party ensemble (gemini) reframed it as a live-board *freshness* requirement (Story 3-4 polls this endpoint; a cached GET would show stale scores), not just money privacy. One-line response header + a test assertion. No longer deferred.
  - **Dual-router reachability test** (mount scorecardRouter alongside scoresRouter and assert the route resolves) — path-shadowing is impossible under Hono's literal segment-count matching (`/:roundId` = 1 segment vs the 4-segment scorecard path), so this is a future-proofing guard only. `optional`.
  - **TOCTOU round-deleted → 500 instead of 404** — only if a round is deleted between the route's existence check and the builder's query; acceptable as 500. `optional` polish.
  - **Non-negative CH validation** — NOT needed: `allocateStrokesFromCourseHandicap` already clamps `ch ≤ 0 → 0` strokes (the engine's documented plus-handicap behavior); a non-negative rejection would wrongly break plus-handicap players. Dismissed.
  - codex M1 (multi-pin non-determinism) is moot: `round_pins` has `unique('uq_round_pin_round_id')` (≤1 pin/round). codex M2 (hard-coded `TENANT_ID='guyan'`) matches the codebase-wide v1 single-tenant convention (`scores.ts`, `require-event-participant.ts`).

### File List

- `apps/tournament-api/src/services/scorecard.ts` (new)
- `apps/tournament-api/src/services/scorecard.test.ts` (new)
- `apps/tournament-api/src/routes/scorecard.ts` (new)
- `apps/tournament-api/src/routes/scorecard.integration.test.ts` (new)
- `apps/tournament-api/src/app.ts` (modified — import + mount)
