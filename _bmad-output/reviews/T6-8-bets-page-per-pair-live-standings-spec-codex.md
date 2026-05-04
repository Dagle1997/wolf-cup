# Codex Review

- Generated: 2026-05-04T20:43:44.365Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md

## Summary

Spec is generally coherent and stays within the allowed path footprint, but it contains a few concrete ambiguities/contradictions that will likely cause implementation bugs—especially around auth-chain ordering vs organizer access, and response shape differences between `/mine` and `/:betId` (organizer case). Engine-input gathering and no-existence-leak behavior also need sharper definition to avoid regressions in FR-H6 / T6-5 invariants.

Overall risk: high

## Findings

1. [critical] Auth-chain contradiction: spec requires `requireEventParticipant` upstream but also requires organizer (non-party) access
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:25-107
   - Confidence: high
   - Why it matters: Lines 27–29 and 104–107 state `requireEventParticipant` is upstream for these endpoints and non-participants should be rejected there. But AC-4 (lines 90–95) requires the event organizer (who may not be an event participant) to be able to fetch bet detail. If the organizer isn’t in the participants list, they’ll be blocked before reaching the bet-party/organizer gate, violating AC-4 and potentially FR-H6 expectations.
   - Suggested fix: Clarify one of: (a) organizer is always also an event participant (explicit invariant), or (b) auth chain becomes `requireSession` + `requireEventOrganizerOrParticipant` for `GET /bets/:betId` (and maybe `/mine` remains participant-only). Document the intended middleware order and add tests covering organizer-not-participant behavior.

2. [high] Response shape is inconsistent/ambiguous for `/api/events/:eventId/bets/:betId` (organizer + non-party perspective)
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:44-95
   - Confidence: high
   - Why it matters: AC-3 says `/:betId` returns “the same single-bet shape” as `/mine` (lines 84–89), but AC-4 adds that the response “includes both `playerAId` + `playerBId`” for organizer viewing (line 94). The `/mine` shape (lines 50–75) does not include those fields. Also fields like `opponentPlayerId/opponentName` are defined from the viewer’s perspective; that’s undefined for a non-party organizer viewer.
   - Suggested fix: Define explicit response DTOs. Options: (1) Always include `playerAId/playerBId/playerAName/playerBName` and optionally include `opponent*` only when viewer is a party; or (2) define a separate organizer shape for `/:betId`. Also explicitly define how `opponent*` behaves for organizer (e.g., omit/null). Update ACs/tests accordingly.

3. [high] No-existence-leak / not-found behavior is underspecified for `/:betId` (unknown betId or bet in another event)
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:96-107
   - Confidence: high
   - Why it matters: AC-6 claims the “no-existence-leak invariant” is preserved (lines 104–107), but the spec doesn’t state what happens when `betId` doesn’t exist or doesn’t belong to `eventId`. If you return different errors for non-existent vs forbidden, participants can probe bet existence across events, violating the invariant.
   - Suggested fix: Specify deterministic behavior for: (a) betId not found, (b) bet exists but belongs to different event, (c) bet exists in event but viewer not authorized. Common patterns: return 404 for all non-owned/non-existent cases after `requireEventParticipant`, or return 403 with a generic code for both. Add an integration test for betId from another event and for random betId.

4. [medium] `holesRemaining`/`holesPlayed` definitions are ambiguous (18 vs variable holesToPlay; partial scoring)
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:59-65
   - Confidence: medium
   - Why it matters: AC-1 defines `holesRemaining` as `18 (or holesToPlay) − holesPlayed` (lines 62–65) but doesn’t define where `holesToPlay` comes from (round config? course? event setting?) or how `holesPlayed` is computed with missing hole scores (e.g., one player posts through 10, the other through 9). This can lead to inconsistent UI and standings computations.
   - Suggested fix: Define `holesToPlay` source (likely event_rounds.holesToPlay or course default). Define `holesPlayed` precisely (e.g., count holes where both A and B have non-null scores) and confirm engine input uses the same rule. Add at least one test with asymmetric scoring progression.

5. [medium] Engine-input assembly expectations are described but not pinned to a single shared contract (risk of divergence vs `services/money.ts`)
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:16-161
   - Confidence: medium
   - Why it matters: The story explicitly warns the “main complexity” is gathering `computeIndividualBet` input and notes `services/money.ts` already does similar assembly (lines 158–160). Without specifying an exact shared helper contract (inputs/outputs) or mandating reuse, this endpoint can easily diverge from Money page computations (different hole score filtering, handicap inputs, press grouping), causing inconsistent standings between pages.
   - Suggested fix: Turn the “cleanest path” into an explicit AC/implementation note: either extract a shared `loadIndividualBetEngineInput(...)` (with defined return type) or document the exact queries/filters to match `services/money.ts`. Add a regression test that compares `/bets/:betId` net to the Money computation for the same bet fixture.

6. [medium] Sign-flip requirement is clear for playerB, but organizer (non-party) sign semantics are under-tested/under-defined
   - File: _bmad-output/implementation-artifacts/tournament/T6-8-bets-page-per-pair-live-standings.md:16-142
   - Confidence: medium
   - Why it matters: AC-4 says organizer perspective defaults to player A (line 94), but AC-10’s sign-flip test only mentions viewer==playerB flipping `engine.netToPlayerACents` (lines 141–142). If the implementation generalizes “viewer perspective” incorrectly (e.g., always flip based on viewerId matching A/B, which won’t match for organizer), you may accidentally return unsigned/zeroed nets or flip unpredictably.
   - Suggested fix: Add an explicit integration assertion for organizer: `netToViewerCents === engine.netToPlayerACents` (playerA perspective) and clarify whether organizer can request alternate perspective (likely out of scope).

## Strengths

- Clear endpoint list and explicit out-of-scope items (lines 13–24), which reduces scope creep.
- FR-H6 visibility intent is explicitly documented (lines 25–30), including a deliberate stricter-than-Money policy.
- AC-10 enumerates concrete integration test cases, including sign-flip coverage and organizer vs participant access paths (lines 131–143).
- Path footprint is explicitly constrained to allowed directories (lines 31–40), avoiding boundary violations.

## Warnings

None.
