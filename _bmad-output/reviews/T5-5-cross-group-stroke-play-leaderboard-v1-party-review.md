# T5-5 Party-Mode Review (non-interactive, written)

- Story: T5-5 Cross-Group Stroke-Play Leaderboard (v1)
- Spec: `_bmad-output/implementation-artifacts/tournament/T5-5-cross-group-stroke-play-leaderboard-v1.md`
- Generated: 2026-05-01 (impl-codex rerun PASS / 0H 1M 1L)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)
- Format: written consensus; no open questions to user; tournament-director will codex-review this output as step 9.

---

## Mary (📊 Analyst) — AC compliance + requirements traceability

I traced every AC against the implementation. The treasure here: AC-1 through AC-7 are all materially implemented, with two **deliberate v1 deviations** that are *documented in the spec* — that's the right pattern.

- **AC-1 (service signature):** ✅ `computeLeaderboard(ctx, eventId, opts)` exported at `services/leaderboard.ts:97`. Row shape matches AC-1 exactly: `{ playerId, playerName, handicapIndex, grossThroughHole, netThroughHole, throughHole, rank, tiedWith }`.
- **AC-2 (round-scope sort + no tie-break):** ✅ Sort is `gross asc NULLS LAST, playerId asc` (deterministic secondary). 1224 ranking. Verified by leaderboard.test.ts fixtures (a) all-tied-zero and the ranking-semantics test "1224 ties at top → rank 1,1,3".
- **AC-3 (event-scope aggregation):** ✅ Per-round course handicap → per-round allocation → sum. Verified by fixture (c) across 2 rounds (blue + white tees, different slope/rating).
- **AC-4 (route status codes):** ⚠️ **Partial divergence flagged.** Spec wrote "404 unknown event id"; impl returns 403 because `requireEventParticipant` middleware fires before the handler can check existence. Integration test locks in 403. Impl-codex Medium #1 + my reading agree — followup T5-5f explicitly defers this AC text revision. Privacy-preserving 403 may actually be the right call; the AC just needs to match.
- **AC-5 (page render + polling):** ✅ TanStack Query `refetchInterval: 15_000`, table with rank/player/hcp/thru/gross/net columns, `T-N` rendering when `tiedWith > 1`. **Deliberate v1 deviation:** round selector is a 2-option toggle (Current round / All rounds) instead of a per-round dropdown. Documented in spec Task 8 + followup T5-5d. Pragmatic — no event-rounds list endpoint exists yet.
- **AC-6 (score-commit propagation):** ✅ Integration test "AC-6 fresh-after-commit" inserts a hole_score and re-fetches; row reflects the new gross within the same request cycle. The 15s poll interval brings real-world propagation comfortably under NFR-P2's 30s envelope.
- **AC-7 (test fixtures):** ✅ All 4 required fixtures (a-d) plus 2 ranking-semantics fixtures. Total 6 service tests + 10 route integration tests.

**Requirements clarity:** the spec's Section 7 on `round=current` resolution + Section 5 on slope-aware-but-18-only handicap math were the two ambiguity hotspots. Both are now crystal in the impl. The PK-invariant comment for `round_states` (events-leaderboard.ts:154–171) is a nice piece of forward-defensive documentation — it'll save future-Mary an hour of "wait, what if this is historical?" archaeology.

**Verdict:** AC compliance is solid. The single AC-4/impl divergence is documented and deferred; not blocking.

---

## Winston (🏗 Architect) — services-layer pattern + scalability + boundary

This is the **first service file** in tournament-api, so it doubles as the pattern-establishing artifact for everything T6 will need. I weighed each decision twice.

**Strengths:**
- **Read-only services convention** is correctly enforced. `services/leaderboard.ts` does only SELECTs; no INSERT/UPDATE/DELETE. The barrel `services/index.ts:14–26` documents the read-only convention so the next service author (T6 money-matrix) inherits the rule.
- **Per-round handicap allocation** in `assignRanksAndBuildRows` (leaderboard.ts:254–272) handles the multi-tee case correctly: each round has its own slope/rating → its own course handicap → its own allocated allowance, and only the round-totals are summed. This is the architecturally-correct way; doing it as a flat-event aggregation would have been wrong as soon as round 2 used a different tee color.
- **Tenant scoping is exhaustive after the fix.** The post-codex revision to `fetchRoundSummary` closed the only gap I'd have flagged. Every join now carries `tenant_id = TENANT_ID` on both sides.
- **Defense-in-depth on round-event ownership.** The post-codex addition of the `eventRounds.eventId = eventId` join in `computeLeaderboard` (leaderboard.ts:135–157) means even if a future internal caller (cron job, admin tool) drops the route's ownership check, the service refuses to mix scores. This is exactly the kind of architectural defense I want services to do.

**Concerns / future-proofing:**
- **No cache, recompute on every read.** Architecture D1-1 says "no cache v1." For 4 Pinehurst rounds × 8–32 participants × 18 holes the SELECT is trivial. As soon as Wolf Cup-scale event sizes (60+ players, all-day events) hit, recompute-per-poll-per-client will burn DB time. The followup `round_computations` cache + write-invalidate path is in Risks/Followups; that's the right path when (not if) it becomes load-bearing.
- **`allocateNetThroughHole` 18-hole hard-code.** Codex Medium #5 surfaced this; spec section 5 + new Followup T5-5c amendment now own it explicitly. Pinehurst trip is all 18-hole, so v1 is safe. The followup story has a clear migration path (thread `holesToPlay` from the round-context query). I'd accept v1.
- **The 3-query fallback in `resolveCurrentRoundId`.** Sequential `for` loop with awaited queries (events-leaderboard.ts:179–202). For 1 event that's 3 round-trips worst case; trivial. A single CASE-based ordering query would be more elegant, but premature here. The dev-record note already calls this out as a "v1.5 perf followup if real data shows it." Right call.

**Boundary check:** zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`. Tournament owns its own copy of the USGA formula in `services/handicap.ts` per FD-1/FD-2. Header comment cross-references Wolf Cup's `packages/engine/src/course.ts:14` so the lineage is traceable without import coupling. Clean separation.

**Verdict:** architecturally sound. The pattern this story establishes for services/ is solid — T6 should mirror it.

---

## John (📋 PM) — user value + Pinehurst readiness

I keep asking "WHY?" — and each "why" lands on Mark watching from the clubhouse without bothering Jeff. That's the user we're shipping for. Let me grade against what *Mark* sees.

- **Mark opens `/events/{id}/leaderboard` from the clubhouse.** ✅ Auth loader redirects him to Google OAuth if not signed in, then back. He's a participant (FR-C1), middleware lets him through.
- **He sees the field ranked across all groups.** ✅ Cross-group is the whole point of T5-5; the service ignores `group_id` for ranking and treats all event participants as one field. Group context is preserved in the underlying data but not the leaderboard rendering.
- **He picks current round vs. all rounds.** ⚠ I would have liked a per-round dropdown (Round 1 / Round 2 / Round 3 / Round 4 / All rounds) for the trip — Mark might want to see "how was today vs. how was Day 1?" The 2-option toggle covers the dominant case (current vs. trip-aggregate) but loses the per-round flexibility for the trip. Followup T5-5d is the right deferral for v1, and the per-day reflexive use case can be served by `?round=<UUID>` directly if Mark gets fancy with URLs. **Not blocking;** Mark can still see what he needs.
- **It updates within 30s.** ✅ NFR-P2 envelope met by 15s polling. Mark's tab refreshes mid-conversation; he sees Jeff's last birdie before Jeff finishes texting it.
- **What happens when scores haven't started yet?** ✅ "No scores yet." empty state covers this. Edge case caught.
- **What happens when there's no round at all (round=current, zero rounds in event)?** ✅ "No rounds yet." message. Codex Low #2 noted that "No participants yet." also fires in this case — that's a tiny UI mismatch (rows are empty BECAUSE no rounds, not because no participants), worth a one-line tweak in v1.5 polish but not material for trip readiness.

**Pinehurst readiness check (most important):**
- All 4 trip rounds are 18-hole → `allocateNetThroughHole` 18-hole hard-code is fine.
- All 4 use Pinehurst-area courses → seeded course revisions exist (per memory: 5 courses including No. 2, Mid Pines, Pine Needles, Talamore, Tobacco Road).
- Scope toggle covers the daily and trip aggregate views. ✅
- 15s polling = comfortable propagation under bad clubhouse wifi.

**Validate the assumption:** ship this; observe what Mark actually clicks during the trip; iterate from real behavior, not anticipated behavior.

**Verdict:** ships value Day 1. v1.5 polish (per-round dropdown, "Last updated Ns ago" timestamp, sticky header) follows.

---

## Quinn (🧪 QA) — coverage + edge cases + soak readiness

Practical test plan check. Test count is healthy: 6 service tests + 10 route integration tests + 13 handicap unit tests = 29 net new tests. Coverage hits the load-bearing paths.

**Service-level coverage (leaderboard.test.ts):**
- ✅ Fixture (a) all-tied-zero — 8 participants, deterministic playerId-asc order.
- ✅ Fixture (b) mid-round mixed-thru — 4 participants with gross 16/17/18/38 + thru 4/4/4/9.
- ✅ Fixture (c) event-scope across 2 rounds — different tee colors per round (blue + white, different slope/rating).
- ✅ Fixture (d) null handicap_index — gross-based rank works, net=null.
- ✅ 1224 ranking — tied first → 1,1,3 not 1,1,2.
- ✅ Mixed scored + unscored — scored players get 1..N, unscored share rank N+1.

**Route-level coverage (events-leaderboard.integration.test.ts):**
- ✅ 200 happy path with rows.
- ✅ 403 non-participant.
- ✅ 400 bad UUID.
- ✅ 403 unknown-event-id (locked-in behavior; deviates from spec AC-4 wording — followup T5-5f).
- ✅ 404 cross-event round (round in event A queried under event B → `round_not_found`).
- ✅ round=current resolution: in_progress branch.
- ✅ round=current resolution: complete_editable fallback.
- ✅ round=current resolution: any-state fallback.
- ✅ round=current resolution: zero rounds → 200 + null round + empty rows.
- ✅ omitted round → scope=event aggregation.
- ✅ AC-6 fresh-after-commit propagation.

**Holes I would normally flag but accept here:**
- **No web-side test for the LeaderboardPage component.** Spec Task 8 doesn't require one; existing tournament-web pages are tested mostly at the form/wizard level. The component is small (renders table + toggle). I'd add a smoke test at v1.5 that mocks fetch + asserts T-N rendering when tiedWith > 1; not blocking for v1.
- **No load test.** The "no cache, recompute every read" architecture is fine for trip scale; if 32 participants × 4 days × 15s polling = ~85 reads/min/event peak, that's nothing. Soak-test if usage grows.
- **No 9-hole fixture.** Correctly omitted because v1 is 18-hole-only and the impl-codex Medium #5 trade-off is explicitly accepted in the spec. T5-5c will own it.

**Test reliability:**
- The integration test's `seedEventWithRounds` correctly de-duplicates course/club names per call (UUID prefix) so the cross-event 404 test doesn't trip the (tenant_id, club_name, name) UNIQUE. That bug was caught + fixed in iteration 2 — solid.
- handicap.ts signed-zero normalization (`return result === 0 ? 0 : result`) deserves a callout: a `Math.round(-0.5) → -0` bit Quinn yesterday. Now `Object.is(0, courseHandicap)` is stable in tests.

**Verdict:** coverage is fit for trip readiness. Ship it.

---

## Amelia (💻 Dev) — code quality + maintainability

`apps/tournament-api/src/services/leaderboard.ts:97` `computeLeaderboard`. Reads cleanly. AC-1 mapped 1:1.

Notes by file:

- `services/handicap.ts` — 86 lines. Pure functions, throws on bad input, signed-zero normalization. No DB. ✅
- `services/leaderboard.ts` — 359 lines after fixes. Single async function plus `assignRanksAndBuildRows` helper. Tenant filter on every join: ✅ (4 joins, 4 filters).
- `services/index.ts` — barrel only. ✅
- `routes/events-leaderboard.ts` — 240 lines. UUID validation, ownership join, scope dispatch, error mapping, schema-invariant comment block. Defensive ✅.
- `routes/events-leaderboard.integration.test.ts` — 393 lines. Self-contained seed helper.
- `services/leaderboard.test.ts` — 489 lines. Self-contained seed helper. Mirrors integration-test pattern, separate db mock instance.
- `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx` — 245 lines. Auth loader → query hook → render. No state spaghetti.
- `app.ts` diff: +6 lines. Mount declaration with explanatory block comment.

**One nit:** the `import { useState } from 'react';` in `events.$eventId.leaderboard.tsx:127` lands mid-file rather than at the top. Convention is top-of-file but it's not a lint error here. Defer to v1.5 polish.

**No dead code.** Ran `pnpm -r lint` clean after removing the unused `TENANT_ID` from `services/leaderboard.ts` (the service uses `ctx.tenantId`; the route owns the constant).

**No skipped tests.** `537/537` tournament-api after fixes. 100% pass.

`pnpm -r typecheck` ✅. `pnpm -r lint` ✅.

**Verdict:** ready for review.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Apply impl-codex High #1 (cross-event ownership defense in service) | High | ✅ APPLIED iteration 2 |
| 2 | Apply impl-codex High #2 (PK-invariant note for round_states) | High | ✅ APPLIED iteration 2 |
| 3 | Apply impl-codex Medium #4 (tenant scoping in fetchRoundSummary) | Medium | ✅ APPLIED iteration 2 |
| 4 | Document AC-4 / impl divergence (403 vs 404 unknown event) | Medium | ✅ Followup T5-5f |
| 5 | Document 18-hole hard-code limitation | Medium | ✅ Followup T5-5c amended |
| 6 | "No participants yet." fires for zero-rounds case (small UI mismatch) | Low | Note for v1.5 polish; not blocking |
| 7 | Per-round dropdown (vs 2-option toggle) | Low | Followup T5-5d |
| 8 | Web-side component test for LeaderboardPage | Low | v1.5 |
| 9 | Promote inlined fetchers to lib/api.ts | Low | Followup T5-5e |
| 10 | `useState` import position | Trivial | Defer |

**Overall verdict:** Recommend → done. AC compliance solid; architectural pattern correctly establishes the services-layer convention for T6+; coverage fit for purpose; Pinehurst trip-ready.

No open questions for the user.
