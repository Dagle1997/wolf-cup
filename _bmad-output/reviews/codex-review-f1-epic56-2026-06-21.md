# Codex Review

- Generated: 2026-06-21T18:27:49.696Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/_extract-epic56.md

## Summary

Epic 5 and Epic 6 both contain requirements-level contradictions/gaps that would likely cause either (a) an unintended live routing flip (real-money regression risk) or (b) nondeterministic claim state with two writers. Epic 5’s backfill staging plan conflicts with the locked routing invariant (event is F1 iff an EVENT-level game_config row exists). Epic 6’s self-report claims introduce a second writer without specifying conflict/dedup semantics or a schema that can represent both writers’ intent deterministically. Epic 6’s cross-group edges also risk producer-namespace collision if sourceType isn’t made disjoint.

Ship/hold verdict:
- Epic 5: HOLD (must reconcile staged backfill vs routing invariant; hard gate semantics + rollback mechanics need to be explicit).
- Epic 6: HOLD (must define two-writer claim model + deterministic resolution; must enforce producer namespace disjointness for cross-group; clarify F1-precondition for foursome-level configs).

Overall risk: high

## Findings

1. [critical] Story 5.1 staging/disabled EVENT-level game_config contradicts the locked routing invariant (would flip to F1 immediately)
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:199-212
   - Confidence: high
   - Why it matters: Context states routing is determined solely by the presence of an EVENT-level game_config row (no secondary flag). Story 5.1 AC says backfill must “derive and write an event-level game_config row” (line 209) but also says to write it in a “staged/disabled state … so live money still reads legacy money.ts” (line 210). With the locked invariant, any EVENT-level row creation flips routing immediately, creating an unintended real-money cutover and potential double-count / incorrect settlement exposure.
   - Suggested fix: Pick one consistent mechanism and state it unambiguously in Story 5.1 AC:
- Option A (preserve invariant): backfill must NOT create the EVENT-level game_config row at all; store staged config/pins in separate backfill tables or as ROUND/Foursome-only artifacts that are ignored until cutover creates the EVENT-level row.
- Option B (change invariant): update the routing rule everywhere to “EVENT-level row AND enabled=true” (or similar), then ensure Epic 1–4 routing code and tests are updated accordingly. If the invariant is truly locked, Option A is the only safe interpretation.

2. [high] Story 5.2 doesn’t explicitly make byte-identical diff a CI-hard gate (and could devolve into an operator-only runtime check)
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:213-229
   - Confidence: high
   - Why it matters: Locked context: `services/migration-compare.ts` exists specifically to fail CI on any non-empty diff. Story 5.2 AC says the harness runs “when cutover is attempted” and cutover is “blocked unless the comparison passes” (lines 221–224), but it does not explicitly restate that (1) diffs fail CI (not just block the button) and (2) the comparison is reused verbatim (byte-identical output comparison) as the “HARD gate.” Without this, teams can implement a weaker check (tolerance, partial comparison, or non-CI execution) that violates NFR-M1 and increases real-money regression risk.
   - Suggested fix: Amend Story 5.2 AC to explicitly require:
- The exact Epic 2.8 harness is invoked (same canonical serialization/ordering) and any diff fails CI (not just UI/API).
- Cutover code path must be unable to bypass the harness (e.g., a single shared function used by both CI test and runtime cutover endpoint).

3. [high] Story 5.2 reversibility is underspecified relative to additive-only + routing-by-row-existence (rollback could require destructive deletes or unsafe toggles)
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:213-229
   - Confidence: high
   - Why it matters: Rollback AC says the event “returns to reading legacy money.ts” (line 228) and legacy inputs were never mutated. But given the locked routing rule (EVENT-level row existence), rollback implies either deleting the EVENT-level row (destructive mutation) or adding a new routing switch (changing invariant). The AC also only explicitly calls out producer-disjointness testing on rollback (line 228), not equally on cutover (line 224 mentions disjointness conceptually but not as a required gate). This is a high-risk area for double-counting edges or leaving an event in a mixed state.
   - Suggested fix: Specify the exact rollback mechanism in Story 5.2 AC in a way consistent with the routing invariant and additive-only migrations:
- If rollback is by delete: explicitly allow deletion of the EVENT-level row as a controlled operation and ensure audit log + safety checks, and confirm this doesn’t violate “additive migrations only” intent.
- Preferably: introduce an explicit, audited routing flag (if invariant can change) and require producer-disjointness integration tests to run/validate on BOTH cutover and rollback transitions.

4. [medium] Story 5.1 doesn’t define how legacy rules are derived/mapped (comparison harness will catch diffs, but backfill needs deterministic, fail-closed mapping rules)
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:199-212
   - Confidence: medium
   - Why it matters: Story 5.1 requires backfill to “derive and write” config/pins that reproduce legacy rules (line 209), but does not specify how to map all legacy rule variants (including any legacy-only toggles like presses being OFF for F1 events per Story 5.2 line 224). If legacy data is incomplete/ambiguous, backfill may guess, creating either (a) a cutover block with no actionable diagnosis or (b) pressure to weaken the byte-identical gate. For real-money migration, the derivation algorithm and its failure modes must be explicit and fail-closed (FR44).
   - Suggested fix: Add explicit AC language: backfill mapping must be deterministic and complete for all supported legacy rule knobs; if required legacy inputs are missing/ambiguous, backfill must fail closed with a surfaced reason (no partial/stale config written). Also clarify how to treat legacy constructs that are intentionally unsupported in F1 (e.g., presses) during comparison/cutover.

5. [high] Story 6.1 allows writing foursome-level game_config but doesn’t state/ensure the event is already F1 (risk: orphan lower-level config or unintended routing flip)
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:237-254
   - Confidence: high
   - Why it matters: Locked context says: reject orphan lower-level config without an event-level row; event is F1 iff it has EVENT-level game_config. Story 6.1 AC only gates on “unlocked event” (line 245) and then writes a foursome-level row (line 247). If the event is not already F1, this either (a) violates the ‘reject orphan’ rule, breaking self-serve, or (b) tempts implementation to create the EVENT-level row implicitly, which would flip routing and violate migration/cutover safety expectations.
   - Suggested fix: Amend Story 6.1 AC preconditions: self-serve config is available only for events that are already F1-routed (EVENT-level game_config exists) AND unlocked. If not F1, refuse with an explanation (or require an organizer migration/cutover flow first).

6. [critical] Story 6.2 introduces a second claim writer but provides no deterministic concurrency/conflict model (schema/uniqueness likely breaks)
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:255-268
   - Confidence: high
   - Why it matters: Context: claims were single-writer (scorer) and a second writer was deferred to Epic 6. Story 6.2 AC now allows self-report (lines 263–266) but does not define what happens when scorer and player both submit a claim for the same (round, player, hole, claim_type), especially offline. The earlier schema description (in extract) indicates upsert by (round,player,hole,claim_type) with idempotency by client_event_id and LWW by server seq—this would cause one writer to overwrite the other nondeterministically, or create non-idempotent oscillation, violating NFR-R3 and risking money differences based solely on arrival order.
   - Suggested fix: Story 6.2 must explicitly define and test a two-writer model, e.g.:
- Store per-writer submissions (include writer_actor_id) and resolve deterministically (e.g., scorer-wins when locked; when unlocked, player-wins for self; or explicit conflict state requiring organizer resolution).
- Define uniqueness/idempotency keys per writer (writer_actor_id + client_event_id) and how edits/removals work without deleting the other writer’s submission.
- Ensure recompute uses the resolved claim state deterministically and is order-independent.

7. [high] Story 6.3 producer namespace is ambiguous (sourceType:'f1_game' would collide with intra-foursome producer; D1a requires disjoint namespaces)
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:269-282
   - Confidence: high
   - Why it matters: D1a requires SettlementEdge producers remain mechanically disjoint to prevent double-counting. Story 6.3 AC says cross-group emits edges with `sourceType: 'f1_game' (or a dedicated cross-group namespace)` (line 279). If intra-foursome F1 edges are also `f1_game`, disjointness becomes unenforceable and the integration test in line 280 may be impossible to implement robustly. This is a direct double-pay risk.
   - Suggested fix: Make the namespace requirement non-optional in AC: cross-group edges MUST use a distinct `sourceType` (e.g., `f1_cross_group`) from intra-foursome F1 edges (e.g., `f1_foursome`). Update the producer-disjointness test requirement to assert disjointness by namespace and by (debtor, creditor, sourceId/reason).

8. [medium] Story 6.3 omits explicit fail-closed semantics on missing per-player results/data (FR44)
   - File: _bmad-output/planning-artifacts/tournament/_extract-epic56.md:269-282
   - Confidence: medium
   - Why it matters: Cross-group settlement depends on “per-player results (net + claims already settled within each foursome)” (line 279). If any required per-player input/result is missing/unsettleable, the system must fail closed (FR44) rather than emitting partial edges or silently dropping players. The AC does not require fail-closed behavior or organizer surfacing for cross-group specifically, even though it’s real money and spans groups.
   - Suggested fix: Add an AC clause: if any required player result is missing/unsettleable, cross-group settlement produces no edges and surfaces an unsettleable reason to the organizer (NFR-O1/FR44). Include a golden/fixture that asserts the fail-closed outcome.

## Strengths

- Story 5.2 explicitly references reuse of the Epic 2 / Story 2.8 comparison harness and requires cutover be blocked unless byte-identical passes (lines 221–224).
- Epic 5 explicitly calls out additive-only migration intent and ‘existing events not opted in are untouched’ (lines 197, 229).
- Story 6.1 correctly leverages the polymorphic `game_config` table and level-parameterized resolver with “no engine change” (line 247).
- Story 6.3 includes explicit requirements for (a) a producer-disjointness integration test (line 280) and (b) a golden asserting exact `SettlementEdge[]` (line 281), aligning with NFR-C1/D1a.

## Warnings

None.
