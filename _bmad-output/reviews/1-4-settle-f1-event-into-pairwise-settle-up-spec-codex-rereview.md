# Codex Review

- Generated: 2026-06-21T22:52:39.684Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md

## Summary

Most prior CRITICAL/HIGH items are now explicitly addressed in the spec (unsafe 1.4a/1.4b split is called out as non-shippable, dual-read disjointness is specified at the right switch point, consumers are required to use pinned CH + pinned course revision, mutation-guard recon is non-tautological, no-pin rounds fail-closed, per-foursome isolation is required, and audience bounding is server-side with a test).

However, the spec introduces (or leaves) one money-safety contradiction around “unlocked/provisional” behavior vs the pinned-CH invariant, plus two areas that are still underspecified enough to risk accidental dollar leak or partial-deploy double-count. As written, I cannot sign off “safe to implement” until these are clarified, because implementers could reasonably follow AC11 and violate the core pinned-input invariant.

Build-order/ship-safety framing is much improved and prominent, but the gating mechanism needs a concrete definition to be unambiguous in a real deployment pipeline (partial deploy / config toggles).

Overall risk: high

## Findings

1. [high] AC11 “unlocked = provisional recomputes as GHIN changes” contradicts the pinned-CH read-time invariant (silent drift risk)
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:22-35
   - Confidence: high
   - Why it matters: AC2 and the “money-safety invariant” sections require that EVERY F1 net consumer derives net from the pinned CH and that no read path calls calcCourseHandicap/buildTeeByPlayer or reads a live HI (lines 21–22, 70–72). But AC11 states that for “unlocked” the handicap uses the most-recent GHIN default and “recomputes as GHIN changes” (line 34). That implies read-time dependence on live handicap inputs, which would (a) reintroduce silent drift, (b) undermine the AC4 mutation-guard intent, and (c) create ambiguity about what `games-money.ts` is allowed to do for unlocked/private money views.
   - Suggested fix: Decide and state one consistent rule:
- Option A (recommended for money-safety clarity): even for unlocked/private views, F1 uses the pinned effective-HI/CH from round-start; “provisional” refers to un-finalized scores/config only, not GHIN drift. Remove “recomputes as GHIN changes.”
- Option B: allow live-HI recompute ONLY for a strictly private, non-settlement path; then explicitly scope AC2 to locked/settled/shared surfaces and define a separate computation path (and tests) for the unlocked/private view so it can never affect settle-up/locked money or any shared surfaces.

2. [medium] Ship-safety gating is required but underspecified; AC10’s “event is F1 when config row exists” can activate the switch without an explicit release flag
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:33-45
   - Confidence: high
   - Why it matters: The ⚠️ note correctly states no F1 money may be computed-for-exposure or rendered until Tasks 6/7/8 are in (line 44). But AC10 defines the switch condition as “when the event is F1 (an event-level `game_config` row exists)” (line 33). If the only gate is presence of that DB row, then in a partial deploy (or a mis-sequenced config change) an event could flip into the F1 path before audience-bounding/fail-closed/dual-read isolation are deployed everywhere, reintroducing the exact double-count/leak/crash hazards the note is trying to prevent.
   - Suggested fix: Define the “single feature check” concretely and require ALL reader surfaces + the `money.ts` dual-read switch to use it (not just the presence of an event config row). E.g. an env/config feature flag `F1_MONEY_EXPOSURE_ENABLED` that must be true AND the event has F1 config. State that creating the event-level F1 config row is allowed earlier, but money exposure remains off until the flag is enabled in the release that includes Tasks 6/7/8.

3. [medium] Audience-bounded rule (“non-roster / cross-group viewer”) is not precisely defined; risk of implementing the wrong server-side redaction boundary
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:35-36
   - Confidence: medium
   - Why it matters: AC12 correctly mandates server-side omission/redaction of dollar fields (line 35), but the audience definition is ambiguous: “non-roster / cross-group viewer” could mean (a) not in the event roster, (b) not in the same foursome, or (c) not in some other grouping. Ambiguity here is a direct dollar-leak risk because an implementer could redact only for non-authenticated/non-roster users while still leaking cross-foursome dollars (if that’s forbidden), or could over-redact and break intended UX.
   - Suggested fix: Define the exact predicate used by the API: e.g. “viewer must be on the event roster” vs “viewer must be in the same foursome for that round” (or both). Then specify exactly which endpoints/fields are redacted (money totals, per-edge amounts, P&L fields, etc.) and add tests for each relevant viewer role (roster same-foursome, roster other-foursome, non-roster).

4. [low] Producer-disjointness test key may be weaker than the stated invariant (could miss some double-production shapes)
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:33-75
   - Confidence: medium
   - Why it matters: AC10’s disjointness test is described as “no (debtor, creditor) pair receives a 2v2-game contribution from BOTH” (line 33). If a bug causes the legacy producer to emit any edges at all for an F1 event but with a different pairing shape than the F1 edges (or different edge semantics), a strict pair-overlap check could fail to detect that legacy edges are still being included in totals. The spec elsewhere asserts the stronger condition: “the legacy 2v2 producer emits nothing for an F1 event” (line 33) and later mentions `(debtor,creditor,reason)` (line 74).
   - Suggested fix: Strengthen the test to assert that for an F1 event the legacy 2v2-game producer emits zero edges (by `sourceType`), rather than relying only on pair-overlap. Optionally also assert presses edges count is zero. This directly enforces the intended invariant and is harder to accidentally satisfy while still double-counting.

## Strengths

- Explicit ⚠️ ship-safety rule makes the 1.4a/1.4b split clearly non-shippable and names the three prerequisites (dual-read, fail-closed, server-side audience bounding) (line 44).
- AC2 closes the pinned-CH + pinned course-revision invariant over both key consumers (games-money and leaderboard) and forbids live-HI/course reads at recompute (line 22).
- AC4 adds a non-tautological mutation guard (mutate live HI and course rating/slope; assert settled outputs unchanged) which directly tests the pin’s purpose (line 24).
- AC5’s no-pin handling is explicitly fail-closed (unsettleable) rather than “best-effort” settlement from live data (line 25).
- AC10 identifies the concrete dual-read switch point (`services/money.ts` calling `compute2v2BestBall`) and clarifies coexistence with bets/skins producers (line 33).
- AC11 requires per-foursome isolation so one bad foursome can’t crash/blank the entire money response (line 34).
- AC12 requires server-side redaction with a test, not UI-only hiding (line 35).

## Warnings

None.
