# Codex Review

- Generated: 2026-06-21T22:56:47.615Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md

## Summary

AC2↔AC11 contradiction appears resolved in this spec: AC2 explicitly forbids any read-time `calcCourseHandicap`/`buildTeeByPlayer` or live HI/GHIN use, and AC11 now states the effective HI/CH is always captured at round-start and never recomputed live. The remaining risks are around (a) incomplete server-side enforcement of “unlocked = private My Money” beyond the non-roster boundary, (b) ensuring *all* dollar-returning endpoints are covered by the redaction rule, (c) rollout gating that can cause temporarily-missing game money (leading to real-world mis-settlement), and (d) handling partial/invalid pins without crashing or falling back to live recompute.

Overall risk: medium

## Findings

1. [medium] Unlocked-mode “private My Money” is not explicitly enforced server-side (intra-roster dollar leak risk)
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:28-35
   - Confidence: high
   - Why it matters: AC8 states that an unlocked event is “scores-only + private My Money” (line 28), but AC12’s server-side enforcement is framed only in terms of roster vs non-roster (lines 35) and does not explicitly require that, when unlocked, roster members cannot fetch other players’ dollar figures via API. If the UI hides money but the API still returns full money objects to any roster member, that’s a real dollar-visibility leak relative to the spec’s stated mode semantics.
   - Suggested fix: Add an explicit requirement (and test) that when `game_config.lock_state` indicates “unlocked/scores-only”, money endpoints return only the requesting user’s dollars (plus organizer override), not full-event P&L—even for roster members. Ensure enforcement is server-side, not just UI.

2. [medium] Audience-bounded redaction scope is underspecified (risk: dollars leak via a non-covered endpoint)
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:27-35
   - Confidence: medium
   - Why it matters: The story has multiple money surfaces/routes (“settle-up / my-money / money” and money-detail integration, lines 27 and 49–50), but AC12 describes enforcement as “the money/leaderboard endpoints omit/redact dollar fields” (line 35). If any auxiliary route (e.g., money-detail, settle-up, my-money, export-like endpoints) is not covered by the same server-side redaction, a non-roster (or otherwise unauthorized) viewer could still retrieve dollars via a raw API call—exactly what AC12 is trying to prevent.
   - Suggested fix: Enumerate the specific API routes that must redact/omit dollars and require a shared server-side guard applied at the serialization layer (so every endpoint returning money figures is covered). Add a test that probes each relevant endpoint for non-roster access and asserts no dollar fields are present.

3. [medium] Release gate can yield temporarily-missing game money (risk: real-world mis-settlement before flag flip)
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:33-34
   - Confidence: medium
   - Why it matters: AC10 intentionally separates routing (config-row-exists) from exposure (env flag) (line 33). As written, once an event has the F1 config row, `money.ts` will skip the legacy 2v2 producer and presses, but if `TOURNAMENT_F1_MONEY_ENABLED` is still off, reader surfaces will show no F1 game dollars. That can produce materially incomplete totals for an event that is otherwise actively being settled (e.g., bets/skins still visible), and then totals will “jump” when the flag is enabled—creating a plausible mis-payment/double-payment scenario in the real world even if the engine math is correct.
   - Suggested fix: Tighten the rollout invariant: either (a) gate the *routing* switch as well (so legacy 2v2 remains until the flag is on), or (b) prevent/disable creation of the F1 config row in prod until the flag is on, or (c) when flag is off, return an explicit “F1 money disabled” status that blocks settlement workflows so users can’t settle partial totals.

4. [medium] Fail-closed should explicitly cover partial/invalid pin payloads (avoid crash or live fallback)
   - File: _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md:21-35
   - Confidence: medium
   - Why it matters: AC5/AC11 cover “missing pin” and “no handicap at all” (lines 25 and 34), but the spec doesn’t explicitly state what happens if a pin exists yet is incomplete/corrupt (e.g., missing per-player CH, missing `course_revision_id`, or mismatched roster entries). Without an explicit rule, implementations often either crash (breaking the ‘blast-radius isolation’ promise) or attempt a live recompute as a fallback (violating the pinned-money invariant).
   - Suggested fix: Define ‘untrustworthy inputs’ to include any missing pinned fields required for net (pinned CH per player, pinned course revision, pinned resolved-config snapshot, etc.) and require the same per-foursome unsettleable behavior—never recompute from live data. Add an integration test with a deliberately malformed/partial pin to assert: no crash, no live recompute, and a clear organizer-facing reason.

## Strengths

- AC2 and AC11 now align on the pinned-at-round-start invariant and explicitly prohibit live HI/GHIN/course-based recompute at read-time (lines 22 and 34).
- AC4(b) mutation-guard test is a strong, non-tautological check against silent drift from live HI/course edits (line 24).
- AC10’s producer-disjointness + explicit `sourceType` requirement directly targets money double-counting (line 33).
- AC11’s per-foursome fail-closed + blast-radius isolation requirement addresses crash containment for money pages (line 34).

## Warnings

None.
