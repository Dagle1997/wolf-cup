# Codex Review

- Generated: 2026-04-27T19:13:27.820Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md

## Summary

Round-2 fixes hold: spec consistently states v1 backend rejects ctp/sandies/putting_contest (400 sub_game_type_not_enabled) and AC #7 now explicitly asserts resave-to-empty drops prior participants (5 → 0) while keeping 1 sub_games row. Two remaining internal-consistency issues: (1) test-count minimums conflict (AC vs Tasks), and (2) the “stuck inert config” rationale conflicts with the UI/POST semantics as written (UI does render disabled sections; upsert could still clear inert rows).

Overall risk: low

## Findings

1. [medium] Conflicting minimum test counts for backend test file (AC #7 vs Tasks)
   - File: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md:150-225
   - Confidence: high
   - Why it matters: AC #7 requires “at least 12 tests” (and enumerates more), but Task 4 says “at least 10 tests”. This is an internal spec contradiction that can cause implementation to under-deliver relative to the acceptance gate.
   - Suggested fix: Align Task 4 with AC #7 (e.g., change Task 4 to “at least 12 tests” or adjust AC #7 if 10 is truly acceptable).

2. [low] Risk §5 rationale about ‘UI never renders editable controls’ conflicts with AC #5 UI behavior and upsert clearing semantics
   - File: _bmad-output/implementation-artifacts/tournament/T3-9-sub-game-opt-in-ui-on-round-setup.md:42-145
   - Confidence: medium
   - Why it matters: Risk §5 claims a smuggled-in ctp/sandies/putting_contest row would be “stuck” because “the UI never renders editable controls for that type.” But AC #5 explicitly renders sections for all 4 types (disabled), and AC #3’s delete-then-insert upsert could still clear inert rows if the client submits only enabled types (or empty subGames). The mismatch weakens the justification and could confuse the intended client payload behavior (submit only skins vs always include all 4).
   - Suggested fix: Clarify one of: (a) UI submits ONLY enabled types (skins) and thus can still clear inert rows via upsert; or (b) UI always submits all 4 types—then the ‘stuck’ rationale applies and you may need a backend clearing mechanism that doesn’t require including disabled types.

## Strengths

- No remaining contradiction found regarding v1 rejecting non-skins: Story (line 9-11), Risk §5 (lines 42-47), AC #3 precedence step 3 (lines 114-121), AC #7 test (lines 162-164), and Dev Notes (lines 240-241) all match.
- Resave-to-empty is now explicitly asserted in AC #7 with a concrete prior-populated save (5 participants) and a post-resave DB state check (1 sub_games, 0 participants).

## Warnings

None.
