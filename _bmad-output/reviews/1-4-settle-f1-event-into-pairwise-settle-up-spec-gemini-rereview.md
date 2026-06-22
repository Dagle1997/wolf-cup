# Gemini Review

- Generated: 2026-06-21T22:54:00.032Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md

## Summary

The prior CRITICAL and High findings have been effectively addressed. The unsafe 1.4a/1.4b ship boundary was replaced with a strict, feature-gated build-order invariant that prevents double-counting, crashes, and dollar leaks. Leaderboard divergence and missing-pin edge cases are also properly handled and tested. However, one High-severity logical contradiction remains between the core money-safety invariant (which strictly forbids reading live handicaps on the read path) and a requirement that unlocked handicaps recompute as GHIN changes.

Overall risk: medium

## Findings

1. [high] Contradictory Requirements: Immutable Pinned CH (AC2) vs. Live GHIN Recomputation (AC11)
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:22-34
   - Confidence: high
   - Why it matters: AC2 strictly mandates that every read derives net from the pinned CH and explicitly forbids any read path from evaluating a live HI (`No read path calls... a live HI`), which is properly guarded by the AC4 mutation test. However, AC11 states that an unlocked handicap's net "recomputes as GHIN changes". Because re-pinning an already-started round is explicitly out of scope for this epic (AC5), the only technical way a net could recompute on GHIN changes is to evaluate live HI during the read path. This directly violates the AC2 money-safety invariant. A developer will be forced to either violate the core safety rule (risking live-data drift) or fail to implement the AC11 requirement.
   - Suggested fix: Reconcile AC11 with AC2. If the immutable pin must remain the absolute source of truth for started rounds, update AC11 to clarify that once a round is `in_progress` and pinned, even unlocked handicaps are frozen to the round-start pin for F1 purposes and do NOT automatically recompute as GHIN changes (any updates would require the Epic 4 re-pin feature).

## Strengths

- The 1.4a/1.4b split is correctly reframed as a build-order aid with explicit ship-blocking prerequisites (Tasks 6-8) tightly coupled to a single feature flag, resolving the critical integration danger.
- The dual-read switch and producer-disjointness test elegantly solve the double-count risk without suppressing legitimately coexisting independent bets and skins.
- Audience-bounding (AC12) is explicitly enforced server-side via API redaction, completely eliminating the risk of raw API dollar leakage to non-roster viewers.
- The mutation guard test (AC4) provides a mathematically rigorous defense against accidental live-data drift in settled rounds.
- The per-foursome fail-closed boundary prevents a single missing handicap or incomplete score from blowing up the entire event's settlement.

## Warnings

None.
