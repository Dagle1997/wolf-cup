# Codex Review

- Generated: 2026-04-27T21:04:55.146Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/pairings/suggest.ts, apps/tournament-api/src/engine/pairings/suggest.test.ts

## Summary

Round-1 guards are present and appear to address the reported crash vectors: top-level sizing validation early-returns on non-positive integers / NaN / Infinity / floats (suggest.ts:103-113), and pin validation now rejects non-integer/NaN/Infinity/float/negative/zero/out-of-range rounds/foursomes before indexing (168-178). Tests added cover numRounds=0/NaN and pin.round=NaN/float and assert never-throw + warning emission (suggest.test.ts:253-290). No warning-order drift is evident in the provided code: pin warnings are emitted in input pin-array iteration order (160-204), and pair-not-met warnings are deterministically sorted post-fill (312-334).

Overall risk: medium

## Findings

1. [medium] No validation that roster player IDs are unique; duplicates can silently underfill foursomes
   - File: apps/tournament-api/src/engine/pairings/suggest.ts:115-292
   - Confidence: high
   - Why it matters: The algorithm assumes distinct playerIds per round via `placedThisRound` being a Set keyed by playerId (251-288). If `roster` contains duplicates, later duplicates are treated as the same player and filtered out, which can cause `candidatePool` to empty early and yield `playerIds.length < foursomeSize` without any warning (264-288). This silently produces incomplete foursomes and breaks constraints/pair counting semantics. The interface/docs do not state roster uniqueness is guaranteed.
   - Suggested fix: Add an early validation that `roster` has no duplicates (and possibly non-empty IDs). If duplicates exist, either: (a) return empty grid + warning (consistent with NEVER-throw pattern), or (b) de-duplicate roster explicitly (but that changes semantics). Add a regression test with a duplicated ID to ensure behavior is explicit.

2. [low] New validation branches handle negative/Infinity/float inputs, but tests don’t cover them
   - File: apps/tournament-api/src/engine/pairings/suggest.test.ts:253-290
   - Confidence: high
   - Why it matters: Your new guards should correctly reject negative values, Infinity, and non-integer floats via `Number.isInteger` + `< 1` checks (suggest.ts:103-108, 168-175). However, the new tests only cover numRounds=0/NaN and pin.round=NaN/float (suggest.test.ts:253-290). Gaps here increase the chance of future regression (e.g., someone loosening `Number.isInteger` to `Number.isFinite` inadvertently).
   - Suggested fix: Add small targeted tests for: numRounds=-1, numRounds=Infinity, foursomeSize=0, foursomeSize=1.5; and pins with round=0, round=-1, round=Infinity, foursome=0, foursome=1.5. Assert empty-grid + invalid sizing warning, and dropped-pin + out-of-range warning respectively.

## Strengths

- Top-level sizing validation prevents negative array sizes / NaN arithmetic and preserves NEVER-throw (suggest.ts:99-113).
- Pin validation now blocks NaN/float/Infinity/negative/zero before indexing pinnedSlots, addressing the prior crash and bypass (suggest.ts:168-178).
- Pin processing preserves input order for warnings (single for-of over `pins`) and remains deterministic overall (suggest.ts:160-204; 312-334).
- Canonical 8×4×4 path remains unchanged and still produces the exact golden schedule with no warnings (suggest.ts:127-145; suggest.test.ts:40-90).

## Warnings

None.
