# Gemini Review

- Generated: 2026-06-21T17:54:36.542Z
- Model: gemini-pro-latest
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

Epic 3 contains critical architectural and sequencing gaps. The Event Pot (Story 3.3) lacks a stake/buy-in field to derive cents, crosses the per-foursome engine boundary without defining a cross-round read path, and is sequenced after settlement logic, risking provenance. Team formation (Story 3.1) lacks schema definition, tiebreakers, and persist-once guarantees for random generation.

Overall risk: high

## Findings

1. [critical] Story 3.3: Event Pot cannot derive money without a stake/buy-in, and cross-round reads break the engine scope
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:671-687
   - Confidence: high
   - Why it matters: The 'winner-take-all' pot implies a total cash value, but E1/E2 `game_config` only defines flat points or caps, lacking a `buy_in` or `stake` field. Without it, the engine cannot compute `SettlementEdge` cents. Furthermore, the engine is explicitly built per-foursome/per-hole (FR23/E1); aggregating across rounds requires an undefined cross-round read path, risking reinventing or colliding with the shipped `computeTeamStandings`.
   - Suggested fix: Add a `stake` or `buy_in` field to `game_config`. Explicitly define whether `team-pot.ts` reads the already-shipped `computeTeamStandings` aggregation or how it performs cross-round reads. Confirm if the pot has its own cap.

2. [high] Story 3.4 must precede 3.3, and team pin must be BY VALUE
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:688-701
   - Confidence: high
   - Why it matters: Story 3.3 settles the pot money, but Story 3.4 adds the provenance pin for global teams. If built in this order, 3.3 will settle reading live team tables, violating immutability. Additionally, if the pin stores FKs to live teams instead of composition BY VALUE (a snapshot array of playerIds), editing a team later will silently mutate past finalized money.
   - Suggested fix: Reorder Epic 3 so Story 3.4 (pin) comes before Story 3.3 (settlement). Explicitly specify that the snapshot stores the post-override team composition by value, not by FK reference.

3. [high] Story 3.1: Missing schema definitions, random persist-once guarantees, and A/B tiebreakers
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:633-655
   - Confidence: high
   - Why it matters: The `teams`/`team_members` schema lacks columns/uniques (e.g., 2-man vs N-man, one-team-per-player constraints). 'Random' formation must explicitly persist to the DB; if it re-rolls on read, money drifts. High-low A/B lacks a deterministic tiebreaker for identical effective HIs. Finally, AC claims dependent games recompute, but in 3.1's scope, no games depend on global teams yet.
   - Suggested fix: Define specific schema uniques. State that random outputs write to the DB and never re-roll on read. Add an explicit tiebreak rule (e.g., alphabetical by name or ID) for A/B HI collisions. Reconcile storage with the shipped `teamKey` (sorted playerIds).

4. [medium] Story 3.3: Missing actual tie/split rule name and DNF/incomplete hole fail-closed definition
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:671-687
   - Confidence: high
   - Why it matters: The AC states 'with the tie/split rule named - FR42' but fails to actually name the rule in the spec (e.g., is the pot split equally? Does it carry over?). It also fails to specify how incomplete holes or DNF states handle fail-closed when aggregated across a multi-round pot.
   - Suggested fix: Provide the exact name and behavior of the tie/split rule (e.g., evenly divide remainder). Explicitly state that an incomplete or DNF player marks the entire cross-round team entry unsettleable.

5. [medium] Story 3.2: Ambiguity on team membership override vs rule override, and missing UI route
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:656-669
   - Confidence: medium
   - Why it matters: The story title mentions 'team game', but it is unclear if this permits overriding team *membership* for a specific round, or just the config rule. There is also no mention of what UI page/route the organizer uses to accomplish this override.
   - Suggested fix: Clarify if round overrides permit creating a round-specific team composition or if it only overrides the `game_config`. Specify the admin route/page.

## Strengths

- Retains explicit focus on maintaining foursome isolation in the engine (FR23).
- Properly leverages the existing cascade resolver to implement round overrides without engine logic changes.
- Ensures cross-team pot computes through the single `games-money.ts` chokepoint to avoid duplicate settlement logic.

## Warnings

None.
