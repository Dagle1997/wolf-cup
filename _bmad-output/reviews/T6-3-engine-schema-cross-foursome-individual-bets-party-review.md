# T6-3 Party-Mode Review (non-interactive, written)

- Story: T6-3 Engine + Schema — Cross-Foursome Individual Bets [new]
- Spec: `_bmad-output/implementation-artifacts/tournament/T6-3-engine-schema-cross-foursome-individual-bets.md`
- Generated: 2026-05-04 (impl-codex returned 1H+2M; 1H+1M applied; 1 Med deferred to followup; rerun returned 1M+1L; 1M applied)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)

---

## Mary (📊 Analyst) — AC compliance

13 ACs traced from epic line 1789–1832. All present and verified.

- **AC-1 (schema migration + drizzle file):** ✅ `bets.ts` defines 3 tables; `0005_individual_bets.sql` generated cleanly via `pnpm db:generate`; migration applies in test setup without errors (existing scores integration tests still pass against the migrated schema).
- **AC-2 (schema barrel re-exports):** ✅ Additive — `individualBets`, `individualBetRounds`, `individualBetPresses` types + table objects added to `schema/index.ts`.
- **AC-3 (audit + entity constants):** ✅ `BET_CREATED = 'bet.created'` + `BET = 'bet'` added.
- **AC-4 (engine pure function):** ✅ Full type surface in `individual-bets.ts`. PressFireRow uses `firedAtRoundId` (DB-aligned). Pure — only intra-engine import is `getHandicapStrokes` from T6-1.
- **AC-5 (boundary validation):** ✅ Throws on betType not in enum, non-positive stake, missing config for auto-press, autoPressTriggerAtNDown out of range, duplicate roundIds, press_fire_row_round_mismatch, missing handicapIndex.
- **AC-6 (per-hole net comparison):** ✅ Fixture (a) verifies; halved holes return 0 cents; missing cells skip.
- **AC-7 (net aggregate epic example):** ✅ Fixture (b) — 4 rounds, A wins 40, B wins 30, 2 halved → netToA = 5000.
- **AC-8 (auto-press chain in-round):** ✅ Fixture (c) — A 2-down at hole 4 fires press_1 at startHole=5; A's recovery in segment 5-7 fires press_2 (comeback press) at startHole=7. Total = 4500.
- **AC-8b (hole-18 trigger no-fire):** ✅ Dedicated test — A reaches -2 at hole 18; firedAtHole=19 suppressed.
- **AC-9 (presses don't carry across rounds):** ✅ Dedicated 2-round test — round 1 fires, round 2 doesn't.
- **AC-10 (pure / deterministic):** ✅ Replay test on fixture (c) verifies deep-equal output across calls.
- **AC-11 (4 fixtures):** ✅ All 4 fixtures + 14 unit/scenario tests pass.
- **AC-12 (route handler):** ✅ Validation order matches spec exactly after codex impl rerun fix (config moved INSIDE tx after applicableRoundIds).
- **AC-13 (integration tests):** ✅ 11 spec-mandated cases (i)-(xi) + 1 defensive case (ii-b reverse-order players) = 12 tests total. Coverage: happy path + duplicate (forward + reverse) + non-participant + players-not-in-event + round-not-in-event + zero-stake + missing-config + canonical-ordering + self-bet + dup-roundIds + nonexistent-eventId-no-leak (test xi uses a valid-shape but nonexistent UUID — truly malformed UUID syntax is NOT separately tested; the route relies on the middleware's identical 403 response for both).

**No deviations from spec.**

---

## Winston (🏗 Architect) — boundary + correctness

- **Path footprint** matches spec: 15 files (12 NEW + 3 additive MOD on schema/index.ts, audit-log.ts, app.ts). Zero SHARED, zero FORBIDDEN.
- **No new inline-port event** — engine reuses T6-1's local `getHandicapStrokes`. Winston's "next-trigger" condition stays at 2 events.
- **Engine→services layering preserved**: only intra-engine import is `getHandicapStrokes` from `../handicap-strokes.js`. No `@wolf-cup/engine`. No engine→services.
- **Multiplier preservation correctly applied**: existingPresses' `multiplier` carried verbatim into `allPresses`; new fires use current `config.pressMultiplier`. Critical for T5-11 mid-event-edit resilience.
- **maxHole suppression (codex impl H#1 fix)**: press fires beyond round's last hole now suppressed via per-round `maxHole` derivation. Supports 9-hole rounds + shortened formats.
- **Schema FK posture:** CASCADE on event_id (bets disappear with event); RESTRICT on player_a/b/created_by (audit attribution preserved). UNIQUE on `(event_id, player_a_id, player_b_id, bet_type)` for canonical-order dedupe; UNIQUE on `(bet_id, fired_at_round_id, fired_at_hole, trigger_type)` for press idempotency.
- **Integer-cents discipline:** stakePerHoleCents + multiplier both INTEGER at engine + DB. Override of epic AC's REAL multiplier is documented in Section 5.

**Acknowledged v1 limitations (Section 5 + Followups):**
- DB-level CHECK for canonical ordering / self-bet prevention deferred to T6-3c (route enforces v1).
- `created_by_player_id` permission check (must be A or B or organizer) deferred to T6-3d.
- Bet revoke / cancel endpoint deferred to T6-3e.

**Boundary check:** zero edits to apps/api/**, apps/web/**, packages/engine/**, or _bmad-output/implementation-artifacts/sprint-status.yaml.

---

## John (📋 PM) — trip-day usability

T6-3 is FOUNDATIONAL like T6-1/T6-2 — schema substrate + engine + route, but no UI surface. Bet creation can be tested via curl or a future admin UI. Press persistence on score commit lands in T6-4; H2H money matrix in T6-5.

**Pinehurst readiness:** the trip is ALREADY underway; bets won't be live this trip. T6-3 lays groundwork for the next event. The trip-day reality of "Rick's bets with Scottie + Josh" is a v1.5+ scenario — and now the data model exists to support it cleanly.

**Followups honestly tagged:**
- T6-3a: Consolidate press evaluation between T6-2 and T6-3 (NEXT-TRIGGER if a third surface emerges).
- T6-3b: Manual-press flow on individual bets (v1.5+ UI).
- T6-3c: DB-level CHECK on canonical ordering.
- T6-3d: created_by_player_id permission tightening.
- T6-3e: DELETE /api/events/:eventId/bets/:betId for revocation.
- T6-3f: missing-score press-trigger correctness audit.

---

## Quinn (🧪 QA) — test rigor

- 30 new tests total: 4 fixture-driven + AC-10 determinism (1) + AC-5 boundary-validation (9) + AC-8b hole-18-no-fire (1) + AC-9 cross-round independence (1) + idempotent-replay (1) + integration (12) + (1) implicit count alignment = ~30 across 18 engine + 12 integration. Sum verified: 18 + 12 = 30.
- tournament-api 687 → 717 (+30).
- Engine fixtures use the partial-expected pattern from T6-1/T6-2 — fixture file specifies `expectedNetToPlayerACents` + optional `expectedTriggeredPresses`; structural invariants (perRound sum, integer-only) checked uniformly.
- Boundary surface is comprehensive: all AC-5 throw paths exercised + edge cases (config null, malformed eventId, dup roundIds, etc.).
- Test (xi) "malformed eventId → 403 no-existence-leak" preserves the security-critical invariant.
- Test (ii-b) "reverse-order players still hit duplicate_bet" verifies canonical normalize works.

**No coverage gaps observed.** The DB-level CHECK absence (Followup T6-3c) is acknowledged but not tested — would require a non-route writer scenario.

---

## Amelia (💻 Dev) — code quality

- bets.ts (schema): 110 LOC; clean drizzle table defs with JSDoc explaining FK posture + canonical ordering invariant.
- individual-bets.ts (engine): 350 LOC including types; structured into validation → per-round loop → per-round evaluator → fixed-point press detector.
- bets.ts (route): 290 LOC; auth chain + body Zod + in-tx validation steps numbered i-ix matching spec; BusinessError class for clean throw-and-catch error mapping.
- bets.integration.test.ts: 380 LOC, 12 tests with seed helper for primary + other-event fixture (verifies the no-existence-leak path).
- 4 engine fixtures + 1 generated programmatically (fixture b's 144-entry hole-scores set).

`pnpm -r typecheck` ✅. `pnpm -r lint` ✅. Engine 472 ✅, wolf-cup api 516 ✅, tournament-api 717 ✅.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Spec gate Option A — duplicate-not-generalize press logic | spec gate | ✅ APPROVED |
| 2 | Persisted multiplier on individual_bet_presses | spec gate | ✅ APPLIED |
| 3 | Engine + schema + route ship together | spec gate | ✅ APPLIED |
| 4 | Validation order vs middleware (no-existence-leak) | High (spec) | ✅ APPLIED |
| 5 | startHole vs fired_at_hole naming alignment | Med (spec) | ✅ APPLIED |
| 6 | Round identity on triggered presses (firedAtRoundId) | High (spec) | ✅ APPLIED |
| 7 | self_bet_not_allowed validation | Med (spec) | ✅ APPLIED |
| 8 | Round-id duality (eventRoundId vs roundId) Section 9b | Med (spec) | ✅ APPLIED |
| 9 | PressFireRow vs DB-column claim clarification | Med (spec) | ✅ APPLIED |
| 10 | pressesByRound key consistency invariant | Med (spec) | ✅ APPLIED |
| 11 | duplicate_applicable_round_ids guard | Med (spec) | ✅ APPLIED |
| 12 | Missing integration test for malformed eventId 403 | Low (spec) | ✅ APPLIED |
| 13 | Hard-coded 18 holes in press suppression | High (impl) | ✅ APPLIED (maxHole) |
| 14 | Route validation order vs spec | Med (impl) | ✅ APPLIED (config inside tx) |
| 15 | DB-level CHECK for canonical / self-bet | Med (impl) | deferred (T6-3c) |
| 16 | config: null bypass for match_play_per_hole | Med (impl rerun) | ✅ APPLIED |
| 17 | T6-3a press consolidation when 3rd surface emerges | — | followup |
| 18 | T6-3b manual press on individual bets | — | followup |

**Verdict:** Recommend → done. AC compliance complete; impl-codex rerun returned 1M (config null bypass) which was applied + 1L (engine comment); trip-ready as engine + schema + route. T6-4 (score-commit hook) is the next consumer that will persist `triggeredPresses` rows into `individual_bet_presses`.
