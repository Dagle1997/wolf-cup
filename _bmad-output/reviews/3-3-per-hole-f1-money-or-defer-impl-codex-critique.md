# Codex Critique

- Generated: 2026-06-23T16:05:33.442Z
- Critiquing: gemini-pro-latest
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-api/src/services/scorecard.ts, apps/tournament-api/src/services/games-money.ts

## Verdict

**HOLD** — overall agreement: partial

## Summary

Gemini’s perf concern is directionally valid but overstated as “redundant” given the early exposure gate and the additional foursome-wide data settlement needs. More importantly, Gemini missed a real correctness divergence: scorecard net/par/si are sourced from event_round.courseRevisionId while per-hole money is settled from round_pin.courseRevisionId. If the event round’s course revision is edited post-pin (your B3 path), the UI can show net scores that no longer correspond to the pinned-settlement money.

## Critiques of prior findings

1. [partial] [medium] Redundant foursome settlement and DB queries on read-heavy scorecard route (scorecard.ts:187-199).
   - Reasoning: Yes, calling computeF1PerHoleMoneyForPlayer from a polled scorecard endpoint can be expensive in the F1+locked+flag-on case because it settles a whole foursome (pairingMembers + foursome hole_scores + deriveCurrentClaims for 4 players + computeFoursome). However, the framing as broadly “redundant” is a bit off: (1) computeF1PerHoleMoneyForPlayer has a strong early exposure gate (games-money.ts:547-563) and returns null after relatively few queries for non‑F1 / unlocked / flag-off scenarios, so most polling traffic may short-circuit cheaply; (2) even when exposed, settlement needs foursome-wide scores/claims that buildPlayerScorecard does not fetch. There is still repeated work (round/pin/course holes/claims queries), so an optimization/caching/refactor is warranted, but I’d treat it as a follow-up unless you expect high concurrent polling during locked F1 play.

## Additional findings (Codex caught, prior reviewer missed)

1. [high] Correctness divergence: scorecard net/par/si read event_round.courseRevisionId while money settlement uses pinned round_pin.courseRevisionId
   - File: apps/tournament-api/src/services/scorecard.ts:115-137
   - Confidence: high
   - Why it matters: buildPlayerScorecard computes par/si (and therefore relativeStrokes and netScore) from eventRounds.courseRevisionId (scorecard.ts:115-137), but computeF1PerHoleMoneyForPlayer settles per-hole money from roundPins.courseRevisionId (games-money.ts:574-602). If an admin edits the event round’s course revision after the round was pinned (your B3 edit-round-course-after-pin path), the scorecard’s displayed net/par can change while the money remains pinned to the original revision. That produces an on-screen disagreement between “net” and “moneyNet” for the same holes, undermining the stated invariant in scorecard.ts header comments and risking player disputes.
   - Suggested fix: Source scorecard course holes from the pin when present (select roundPins.courseRevisionId alongside perPlayerHandicapsJson, and use that revision for courseHoles lookups and stroke allocation). Alternatively, detect mismatch (event_round.courseRevisionId !== round_pin.courseRevisionId) and fail-closed for net/money display (e.g., set moneyNet null or netScore null) while surfacing an admin-visible warning.

2. [medium] Doc/comment claims about non-divergence are currently untrue given mixed courseRevisionId sources
   - File: apps/tournament-api/src/services/scorecard.ts:6-16
   - Confidence: high
   - Why it matters: The header asserts the scorecard’s per-hole net “can never diverge from the money engine’s net” and that money “can never diverge from the settled event money,” but the scorecard’s net/par/si inputs are not pinned the same way as money. This increases maintenance risk because future reviewers/operators will assume a safety property the code does not actually enforce.
   - Suggested fix: After aligning revisions (or adding a mismatch guard), update the comment to reflect the enforced invariant; until then, soften/remove the absolute claim.

3. [low] Potential additional post-pin divergence via holesToPlay edits (money uses event_round.holesToPlay; scorecard uses rounds.holesToPlay)
   - File: apps/tournament-api/src/services/scorecard.ts:101-104
   - Confidence: medium
   - Why it matters: Scorecard iterates 1..rounds.holesToPlay (scorecard.ts:101-104, 204-205), while per-hole money filters holes using eventRounds.holesToPlay (games-money.ts:564-572, 599-600). If those can diverge due to edits/migration anomalies, you could get missing/extra holes between money and scorecard surfaces.
   - Suggested fix: Use a single authoritative holesToPlay source (prefer the pinned/event-round value) or add a consistency assertion/guard that fails closed when they disagree.

## Consensus recommendations

- Treat Gemini’s perf item as a follow-up unless telemetry shows high QPS during locked F1 play; the early exposure gate makes many calls cheap, but the locked+enabled case can still be heavy under polling.
- Do not ship without addressing the courseRevisionId mismatch: align scorecard net/par/si with the pinned course revision (or add a mismatch fail-closed guard). This is a real, reachable correctness issue if post-pin course edits are allowed.
- After fixing, update the scorecard.ts header comments so they match the actual enforced invariants.

## Warnings

None.
