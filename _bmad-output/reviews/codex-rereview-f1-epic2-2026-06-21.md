# Codex Review

- Generated: 2026-06-21T17:39:15.893Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

Per required-item confirmation (Epic 2 stories 2.1–2.8, ~lines 433–624):

1) CONFIRMED — Story 2.1 AC: `hole_claims` has BOTH uniques (cell UNIQUE `(round_id, player_id, hole_number, claim_type)` + dedupe UNIQUE with `client_event_id`) and states the upsert conflict-target is the cell key; monotonic-seq/LWW explicitly dropped. (Story 2.1, AC at lines 450–451)

2) CONFIRMED — Story 2.1 removes “recompute trigger” language and re-frames obligation as durable persistence so next read reflects it; explicitly says “there is none to fire.” (Story 2.1, AC at lines 468–469)

3) CONFIRMED — Story 2.1 explicitly discloses the closed offline-queue edits (both `MutationKind` union + `VALID_KINDS_INTERNAL`) AND calls for a new server route/handler `routes/claims.ts`. (Story 2.1, AC at lines 456–457)

4) CONFIRMED — Story 2.1 explicitly owns extending engine `holeState` to include `claims` + explicit `holeNumber`/ordinal; preserves resolver purity by populating claims at service layer. (Story 2.1, AC at lines 461–463)

5) CONFIRMED — Story 2.1: reassign-to-another-player is delete+insert; finalized refusal is explicitly testable; inert(enabled:false→zero edges) vs fail-closed(unknown type) is explicitly testable. (Story 2.1, AC at lines 467–470)

6) CONFIRMED — Story 2.4 sandie basis is GROSS and includes a par-vs-any divergence hole. (Story 2.4, AC at lines 531–533)

7) CONFIRMED — Story 2.5 generalizes in place (keeps modifier type `net-birdie`), bumps `config_version` with explicit backward-compat default to `{net,single}`, re-runs Epic-1 golden byte-identically, and homes plus-handicap adversarial. (Story 2.5, AC at lines 547–551)

8) CONFIRMED — Story 2.2 wording tightened to “invariant to input/iteration order for a fixed hole sequence” (sorted by ordinal), adds fast-check carryover conservation property, and multi-hole accumulation golden. (Story 2.2, AC at lines 490, 495–497)

9) CONFIRMED — Story 2.3 explicitly homes the all-push adversarial as empty/zero edges. (Story 2.3, AC at lines 510–515)

10) PARTIAL — Story 2.6 includes named remainder rule (lowest-playerId-first), explicit cap collapse to single payee edge, multi-modifier-under-cap + no-cap composition goldens, and a cap-never-exceeds property that covers every cap-declaring game/modifier. However, it asserts this remainder rule is “the same … used in Story 1.1,” but Story 1.1’s remainder rule is not named that way in its AC, creating a doc-level inconsistency/dangling reference. (Story 2.6, AC at lines 568–569 vs Story 1.1 at line 265)

11) CONFIRMED — Story 2.7 covers FR2 per-modifier enable/disable + variant authoring writing to event-level `game_config` (interactive pills), preset persistence explicitly reuses `rule_sets` + `rule_set_revisions` (zero migration), pills render from same resolved-config the engine settles from (testable), save affordance discoverable + no reload, and custom-preset-unknown-variant handled. (Story 2.7, AC at lines 582–588, 589–599)

12) PARTIAL — Story 2.8 includes frozen checked-in reference fixture, canonical normalization, non-empty diff fails CI, and explicitly says harness mechanism lands green independently of Wolf-Cup reconciliation. But it also states the Wolf-Cup cross-validation comparison passes in CI, which contradicts the “not blocked” requirement if a genuine discrepancy is found. (Story 2.8, AC at lines 615–623)

NEW inconsistencies introduced by the edits (actionable): see Findings.

Verdict: HOLD for Epic 2 proceeding to build-story decomposition until the two PARTIAL items (10, 12) are reconciled into non-contradictory, testable ACs (and the upsert-vs-409 clarity issue below is addressed).

Overall risk: medium

## Findings

1. [medium] Story 2.6 claims remainder allocation matches Story 1.1, but Story 1.1 does not define the named rule (dangling/inconsistent AC)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:562-570
   - Confidence: high
   - Why it matters: Story 2.6 makes the remainder rule testable by naming it (“lowest-playerId-first”) and claims it matches Story 1.1. But Story 1.1 only says “fixed, total-conserving rule” without specifying which one. This creates ambiguity for implementers and reviewers: either the rule differs between cap splits and base splits (violating NFR-C7’s determinism consistency goal), or the doc is internally inconsistent.
   - Suggested fix: Either (a) update Story 1.1 AC (line ~265) to explicitly name the remainder rule as “lowest-playerId-first” (or whatever the intended canonical rule is), or (b) remove the “same as Story 1.1” claim and instead define a single shared utility + test that both paths use it.

2. [high] Story 2.8 contradicts itself: harness should land green even if Wolf-Cup reconciliation fails, but AC also requires the cross-validation to pass in CI
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:618-623
   - Confidence: high
   - Why it matters: AC line 622 requires the harness plumbing to land green independently of whether Wolf-Cup cross-validation succeeds (so Epic 5 cutover tooling isn’t blocked by a real discrepancy). Line 623 then requires the Wolf-Cup cross-validation comparison to pass in CI, which would block the merge precisely when there is a genuine discrepancy. This is a release-gating contradiction that will cause CI-policy confusion and likely rework late in the epic.
   - Suggested fix: Split into two explicit CI checks: (1) harness mechanism test(s) that must pass (always green), and (2) Wolf-Cup cross-validation that is either (a) required to pass to merge (remove the “not blocked” claim), or (b) allowed to be quarantined/non-blocking with a clear policy (e.g., separate workflow, allowed-failure job, or feature-flagged assertion). Make the intended gate explicit in the AC.

3. [medium] Story 2.1 AC mixes “upsert conflict-targets the cell key” with “second device … is rejected → 409,” which may be mutually incompatible without extra server-side checks
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:448-452
   - Confidence: medium
   - Why it matters: The AC says the write is an upsert targeting the cell-level unique key (which typically turns uniqueness conflicts into update/no-op), but also asserts a second device with a different `client_event_id` hits the cell unique and is rejected with 409. As written, both behaviors cannot be guaranteed unless you add an explicit server-side guard (e.g., reject when an existing row’s `client_event_id` differs, or when scorer differs) instead of a generic upsert.
   - Suggested fix: Clarify the intended write semantics in the AC: either (a) use INSERT + catch unique-violation to return 409 for a different `client_event_id` (while separately supporting true idempotent retry), or (b) keep upsert but add an explicit conditional that only allows update/no-op when the existing row matches the same scorer and/or `client_event_id`, otherwise return 409. Make the 409 condition explicitly testable.

## Strengths

- Story 2.1 now explicitly captures the two-unique requirement, drops LWW/monotonic-seq, and assigns ownership for `holeState` claims + hole ordinal (clear dependency ordering for 2.2–2.4).
- Carryover order-independence wording in 2.2 is now precise (input-order invariant for a fixed hole sequence sorted by ordinal) and includes both golden coverage and a fast-check conservation property.
- Birdie generalization in 2.5 is correctly constrained to an in-place evolution (keep `type: 'net-birdie'`) with config-version backward compatibility and an explicit byte-identical rerun of the Epic-1 golden (strong money-safety).
- 2.7’s “pills render from resolved-config endpoint” AC makes “what is shown is what settles” falsifiable rather than aspirational, and preset persistence reuses existing tables with zero migration.
- 2.8’s normalization + non-empty diff fails CI requirement is crisp and testable, and the frozen fixture requirement avoids runtime coupling to Wolf Cup.

## Warnings

None.
