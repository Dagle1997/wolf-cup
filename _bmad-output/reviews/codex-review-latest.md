# Codex Review

- Generated: 2026-06-21T15:58:42.081Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md

## Summary

The patterns section is strong on the big-ticket safety rails (pure engine, integer cents, golden fixtures, recompute-on-read, single chokepoints). The main risk is that some rules are underspecified where D1–D7 depend on *precise* semantics: (a) what exactly is “pinned config” vs the mutable `game_config` cascade, especially under forward-effective edits, (b) how producer disjointness is mechanically checkable given the simplified SettlementEdge shape, and (c) the dual-read switch and config-row existence rules (preventing “config exists but is ignored” situations). Several MUSTs are currently aspirational unless paired with named CI tests/lints.

Overall risk: high

## Findings

1. [critical] Pinned-config vs live cascade is ambiguous; finalized money could drift if recompute reads mutable `game_config` rows
   - File: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md:159-168
   - Confidence: high
   - Why it matters: D5 says finalized-frozen is guaranteed because recompute-on-read uses immutable pinned inputs (and D4 says config is pinned via FK to immutable `rule_set_revision_id`). But the patterns also emphasize a live cascade resolver (Pattern 7) and don’t explicitly forbid recompute from consulting the current `game_config` rows for scored/finalized rounds. If a mutable event/round/foursome `game_config.config_json` is edited after a round is finalized (or even after scoring starts), a recompute that re-resolves the cascade could change money, violating D5/NFR-C5 (“finalized = reject edits” only helps if the *only* editable thing is the pinned input set). The current text doesn’t explicitly bind “pinned config” to a fully-resolved immutable snapshot/timeline for that round.
   - Suggested fix: Add an explicit rule clarifying the boundary between **resolution time** and **compute time**. Suggested edit (new Pattern or expand 5/7/9/13):
- “For scored rounds, the engine MUST compute from a pinned, immutable config snapshot (or pinned config-timeline) referenced by the round; it MUST NOT re-run cascade resolution against mutable `game_config` rows.”
- Define how forward-effective (`effective_from_hole`) is represented in pinned inputs (e.g., a pinned config timeline: `{holeStart -> rule_set_revision_id/configSnapshotId}`), so recompute is still purely from pinned data.
- If you intend to avoid a new snapshot table (per D2), state the concrete mechanism: e.g., materialize the resolved config into a new immutable `rule_set_revision` at pin-time and pin that revision on the round, or store a `resolved_config_json` snapshot on the round/round_state and hash it.
Also add a CI test: “editing game_config after finalization cannot change recomputed ledger/edges for that round.”

2. [high] SettlementEdge shape in Pattern 4 is too underspecified to enforce D1a producer-disjointness; missing namespacing/source identity guidance
   - File: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md:158-166
   - Confidence: high
   - Why it matters: D1a’s invariant is phrased as “no (debtor, creditor, reason) edge is emitted by two producers” (line 102). Patterns 4 and 11 define edges as `{fromPlayerId,toPlayerId,cents,sourceType}` and say “Producer disjointness” is enforced, but they don’t define:
- what the “reason” dimension is (is it `sourceType`? something else?),
- how `sourceType` is namespaced so producers are provably disjoint (e.g., `f1:guyan`, `legacy:2v2`, `skins`, `betting`),
- whether a `sourceId`/origin key exists (roundId/foursomeId/hole/claim) to support auditing/idempotency, and
- how the invariant is actually computed in tests if multiple edges share same from/to/cents.
Without a stricter contract, agents can emit overlapping or un-auditable edges while still “matching” Pattern 4.
   - Suggested fix: Tighten Pattern 4/11 with a concrete, checkable contract:
- Define `sourceType` as a **producer namespace + domain code** (e.g., `f1.guyan`, `f1.eventPot`, `legacy.moneyTs2v2`, `sub_games.skins`, `betting.action`).
- Add/require a deterministic `sourceId` (or `reasonCode`) field sufficient to compute D1a’s “reason” key and aid audit/debug (e.g., `round:${roundId}:foursome:${foursomeId}:hole:${n}:modifier:${type}`), or explicitly state that `sourceType` is the “reason” and must be unique per producer slice.
- Update Pattern 17’s “producer-disjointness integration test” to specify the exact uniqueness key it checks, e.g. `(from,to,sourceType,sourceId?)`.
This makes D1a enforceable rather than interpretive.

3. [high] Dual-read switch (“F1 iff event-level game_config row exists”) needs guardrails to prevent ignored lower-level config and misrouting
   - File: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md:168-169
   - Confidence: high
   - Why it matters: Pattern 14 says routing is based solely on presence of an event-level `game_config` row. D2 allows `game_config` rows at event/round/foursome levels. Without an explicit rule, it’s possible to create round/foursome overrides for an event that lacks an event-level row; routing would treat it as non-F1 and run legacy `money.ts`, silently ignoring the new config rows (a money-safety footgun and a migration hazard). Conversely, an empty/invalid event-level row could flip routing unintentionally.
This is a consistency hole directly related to D1’s “never both engines” guarantee and D2’s polymorphic table model.
   - Suggested fix: Augment Pattern 14 (and/or add a validation rule under Pattern 7/8):
- “It is invalid to create `game_config` rows at level=round|foursome unless an event-level row exists for that event.” Enforce in service code (and ideally with a DB-level foreign-key-like check via application validation).
- Consider an explicit `enabled`/`mode` field (or `seed_rule_set_revision_id` presence) rather than row existence to avoid accidental flips.
- Add an integration test: creating a round/foursome config without event-level config fails with a specific error code; and routing never uses both engines for the same event.

4. [medium] LWW + idempotency details for claim/score writes are not precise enough to prevent agent divergence and nondeterminism
   - File: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md:162-163
   - Confidence: medium
   - Why it matters: D6 says each claim row carries `updated_at` / a client sequence and uses LWW; Pattern 8 repeats LWW and mentions `client_event_id` idempotency. However, it does not pin down:
- the exact LWW ordering key (server `updated_at` vs client sequence vs (seq, updated_at) tuple),
- the required uniqueness scope for `client_event_id` (global? per scorer? per device?),
- how deletes are idempotent (FR39) under offline replay.
Because determinism/order-independence is an explicit NFR driver, leaving the tiebreak undefined invites inconsistent implementations across agents and can cause different outcomes when queues replay differently.
   - Suggested fix: Clarify Pattern 8 with explicit, testable rules:
- Define the LWW comparator exactly, e.g. `ORDER BY client_seq DESC, client_updated_at_ms DESC, server_updated_at DESC` (or pick one) and state what happens on ties.
- Define idempotency uniqueness: e.g. `UNIQUE (round_id, scorer_player_id, client_event_id)` and mandate `client_event_id` is a UUIDv4 generated client-side.
- Define delete semantics as an upsert of `is_deleted=1` tombstone vs physical delete, or if physical delete is required, define how replayed deletes behave.
Add a property test ensuring the final claim state is invariant under permutation of the offline event log for a single writer.

5. [medium] Recompute-on-read lacks an explicit transactional snapshot rule; reads can mix versions of scores/claims/config
   - File: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md:159-171
   - Confidence: medium
   - Why it matters: Pattern 5 mandates recompute-on-read; Pattern 8 mandates one-tx writes. But there is no rule that a recompute read must fetch all pinned inputs + scores + claims in a single consistent snapshot/transaction. In SQLite, concurrent writes can interleave such that a multi-query read sees partial updates unless wrapped in a transaction. For money correctness, a leaderboard/settle-up read should not compute from a mixed state (e.g., new claim row but old score rows).
   - Suggested fix: Add a small but concrete rule (extend Pattern 5/16):
- “All recompute reads MUST occur inside a single read transaction (or single SQL statement) that snapshots the round inputs (pinned config/teams/HI/course) + scores + claims.”
- If you already have a recompute service chokepoint (Pattern 16), require it to own the transaction boundary.
Add a concurrency test (can be integration-level) that simulates interleaved writes and asserts recompute output is always from a consistent set.

6. [medium] Unknown/forward-incompatible modifier types and config versions are not covered; risk of silent ignore vs fail-closed
   - File: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md:155-166
   - Confidence: high
   - Why it matters: Patterns 6/7 define a registry and deep-merge resolver, but do not state what happens when config JSON includes an unknown `modifier.type` (FR20-style open-enum extensibility is mentioned earlier in requirements). If different agents choose “ignore unknown” vs “throw error,” you get inconsistent settlement and potentially under/over-payment. For real-money, this must be fail-closed and surfaced clearly.
   - Suggested fix: Add an explicit consistency rule (new Pattern suggested between 6 and 7):
- “Unknown `game.type` / `modifier.type` / config schema version MUST fail closed: engine returns `unsettleable` with `unsupported_*` code; UI surfaces to organizer; no partial settlement.”
- Require a `configSchemaVersion` field and Zod discriminated unions keyed by version/type.
Add golden fixtures that include an unknown modifier to assert the fail-closed behavior.

7. [low] Enforcement section has several non-checkable MUSTs; name the CI tests/lints that make them real
   - File: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md:174-177
   - Confidence: high
   - Why it matters: Patterns 3/17/Enforcement state “hard gates” (fixtures required; no iteration-order; no stored money; producer disjointness; one chokepoint), but only some are tied to concrete tests (Pattern 17). Without naming the exact tests/CI checks, multi-agent work can still drift while believing they complied.
   - Suggested fix: Extend “### Enforcement” with a short list of concrete, existing-or-to-add checks:
- `engine/games/fixtures.runner.test.ts` that enumerates fixtures and fails if any registered game/modifier lacks a fixture.
- `engine/games/*.property.test.ts` must include permutation/order-independence checks for edges.
- `integration/producer-disjointness.test.ts` defines and asserts the D1a uniqueness key.
- A grep/lint-like check is optional, but at least require that *all API routes* call the single recompute service.
This keeps the MUSTs enforceable in CI rather than cultural.

8. [low] “Pin-at-round-start” trigger is underspecified (what exact event starts scoring?), risking inconsistent pin timing across agents
   - File: _bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md:167-168
   - Confidence: medium
   - Why it matters: Pattern 13 says pin when scoring starts, but doesn’t define the precise trigger (first hole score write? first claim write? explicit “start round” action?) or its idempotency behavior. Different agents may pin at different times, causing subtle drift in which locked-HI/team snapshot/config gets frozen.
   - Suggested fix: Define “scoring starts” precisely and make it idempotent:
- e.g., “On the first successful mutation to `hole_scores` OR `hole_claims` for a round, in the same transaction: if `round_state.scoring_started_at` is null, set it and capture all pinned snapshots.”
- Clarify whether a claim-only action counts as starting scoring.
Add an integration test that two concurrent “first writes” result in exactly one snapshot/pin event.

## Strengths

- Patterns align well with the core architectural spine: pure engine (P1), integer cents + determinism focus (P2), recompute-on-read (P5), and a single consumer/chokepoint (P16).
- Explicitly calling out producer disjointness (P11) and requiring a dedicated integration test (P17) is a strong guard against double-count regressions under D1/D1a.
- Clear operational rules that reduce multi-agent divergence: one polymorphic config table + deep-merge (P7), single-writer + offline idempotency (P8/15), and “rule = data + resolver” (P6/18).

## Warnings

None.
