# Codex Review

- Generated: 2026-06-21T17:28:21.700Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md

## Summary

Epic 2 stories 2.1–2.8 have multiple money-integrity and architecture-alignment gaps that are concrete and test-blocking for a real-money settlement engine. The biggest issues: (1) `hole_claims` uniqueness + LWW semantics are internally inconsistent and would allow duplicate/double-claims; (2) delete-to-remove + LWW seq is underspecified (data-loss / race risk); (3) Story 2.1 includes a “recompute trigger” that conflicts with the locked recompute-on-read architecture; (4) FR2 authoring (enable/disable each modifier + choose variant) is not actually satisfied by the current 2.7 ACs (template picker + pills only); (5) sandie eligibility is specified using net-vs-par, contradicting FR2’s “up-and-down for par vs any score” (gross-based) and likely wrong for Guyan; (6) NFR-C4 adversarial fixtures “all-push” and “plus-handicap” are not owned by any Epic 2 story; (7) Wolf-Cup cross-validation in 2.8 lacks a frozen reference fixture + normalization rules, so “byte-identical” is currently unfalsifiable/fragile.

Ship/hold: HOLD Epic 2 planning until MUST-FIX items are resolved in the stories’ ACs (or split into additional stories) so implementation can be unambiguous and testable.

Overall risk: high

## Findings

1. [critical] `hole_claims` uniqueness/upsert contract is inconsistent → duplicate claim rows / double settlement risk
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:449-451
   - Confidence: high
   - Why it matters: Story 2.1 AC says “upsert is by (round_id, player_id, hole_number, claim_type)” but only specifies UNIQUE “(round_id, player_id, hole_number, claim_type, client_event_id)”. Without a UNIQUE constraint on the cell key (round,player,hole,claim_type), two different client_event_id values can insert two physical rows for the same claim cell. That can double-count the same claim in settlement (real-money over/underpay), and it also makes “upsert by cell” impossible at the DB level (no conflict target). This is exactly the user’s suspected gap and is a concrete data-integrity defect.
   - Suggested fix: In Story 2.1 AC, require TWO uniques like `hole_scores`: (1) UNIQUE (tenant, round_id, player_id, hole_number, claim_type) to support true upsert-by-cell; (2) UNIQUE (tenant, round_id, player_id, hole_number, claim_type, client_event_id) if you truly need per-event dedupe. If the intent is idempotent upsert (not event-sourcing), you likely only need the cell-unique plus storing last client_event_id for debugging; otherwise define how settlement chooses the “winning” row when multiples exist (should be impossible).

2. [critical] Delete-to-remove + LWW monotonic seq is underspecified and likely incompatible (data loss / concurrency correctness)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:450-463
   - Confidence: high
   - Why it matters: Story 2.1 AC simultaneously requires (a) LWW tiebreak via “server-assigned monotonic seq” (line 450) and (b) “remove deletes it” (line 462). If the row is physically deleted, you lose the seq and any ability to resolve out-of-order offline mutations deterministically (NFR-R1/R3) across devices. A later-arriving offline ‘add’ vs ‘delete’ cannot be compared if one side deleted the record. For real-money inputs, this can produce non-deterministic final claim state depending on arrival order, violating NFR-R1 (deterministic reconcile) and NFR-C2 (identical inputs → identical output) at the system level.
   - Suggested fix: Adjust Story 2.1 AC to specify an idempotent tombstone model compatible with LWW: e.g., keep a single row per claim-cell with columns like `state: 'present'|'deleted'`, `server_seq`, `client_event_id`, `updated_at`, and treat “remove” as an upsert that sets `state='deleted'` (or `deleted_at`). If you truly must hard-delete, then LWW must be implemented in a separate durable claims-mutation log keyed by client_event_id with a derived view—much heavier and contradicts “sibling to hole_scores” simplicity.

3. [critical] Story 2.1 “edit claim changes whom it belongs to” cannot be implemented as a single upsert under the proposed key
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:460-463
   - Confidence: high
   - Why it matters: Story 2.1 AC says: “edit the claim (e.g. changes whom it belongs to) … Then an edit upserts the row” (lines 460–462). But the proposed upsert key includes `player_id` (line 450). Changing ownership changes the primary identity, so a single upsert cannot both remove the old owner’s claim and add the new owner’s claim. If implemented naïvely, you’ll end up with two claims for one hole/type (money corruption).
   - Suggested fix: Update Story 2.1 AC: either (a) disallow “change owner” as an edit; require delete + new claim, or (b) define “move claim” as an atomic transaction: delete/tombstone the old cell key and insert/upsert the new cell key with a higher `server_seq`, with clear conflict semantics for offline.

4. [critical] Story 2.1 requires a “recompute trigger” that contradicts locked recompute-on-read architecture (phantom/unfalsifiable AC)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:460-463
   - Confidence: high
   - Why it matters: Story 2.1 AC: claim edit/remove is “an audited one-tx write that fans out a recompute … recompute trigger fires on claim changes too” (line 462). Locked decision says money is recompute-on-read with NO recompute trigger / no stored money. As written, this AC is either impossible (no trigger system) or untestable (what does “fans out” mean if reads always recompute anyway?). For a brownfield real-money system, ambiguity here causes implementation drift and missing tests.
   - Suggested fix: Rewrite the AC in testable recompute-on-read terms: e.g., “After a claim write commits, subsequent reads via `services/games-money.ts` reflect the claim change (and no derived money is persisted). If any cache exists, it must be safely invalidated.” If you actually intend a cache invalidation event, explicitly name the cache and verify behavior; otherwise remove “trigger” language.

5. [high] FR2 (enable/disable each modifier + choose variant) is not satisfied by Story 2.7 ACs (template picker + pills only)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:559-580
   - Confidence: high
   - Why it matters: Requirements Inventory FR2 requires: “organizer can enable/disable each modifier … and choose its variant.” Story 2.7 ACs only guarantee: pick a template and see “modifier/variant pills update live” (lines 567–571). There is no organizer authoring control to toggle greenie/polie/sandie/birdie on/off or to choose variants directly (beyond selecting a whole template). That is a concrete coverage gap against FR2 in the charter for Epic 2, and it blocks “data + one resolver” extensibility (NFR-X1) because organizers can’t author the data in the first place.
   - Suggested fix: Amend Story 2.7 ACs (or add a new story) to explicitly include organizer controls to: toggle each modifier enabled/disabled, and select each variant (greenie carryover on/off; sandie par_only/any_score; birdie basis net/gross + bonus single/double; polie variant), and persist them to `game_config`. Keep template selection as a starting point, but FR2 requires post-template edits.

6. [high] Story 2.7 “save preset” persistence is undefined given current schema scope (risk: hidden new table or impossible feature)
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:572-576
   - Confidence: high
   - Why it matters: Story 2.7 AC says saved presets are “stored as a reusable, selectable preset … appears in the template picker for future events” (lines 572–575). In the locked architecture summary for Tournament F1 here, only `game_config` + round pins + (later) teams + `hole_claims` are explicitly introduced; there is no defined presets library table/API in this file’s scope. An event-level `game_config` row cannot serve as a global preset across events. This becomes hidden work on storage, migration, and routing, and is not falsifiable as-is.
   - Suggested fix: Update Story 2.7 AC to specify the exact persistence mechanism within Tournament brownfield constraints: e.g., a new additive `rule_set_presets` table keyed by tenant with `name`, `config_json`, `config_version`, `created_by`, etc.; or reuse an existing Tournament table (if it exists) by naming it. Also specify whether presets are tenant-scoped, organizer-scoped, or global built-ins.

7. [high] Sandi(e) resolver spec uses net-vs-par, contradicting FR2’s gross up-and-down variants and Wolf-Cup description
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:519-522
   - Confidence: high
   - Why it matters: Story 2.4 AC: resolver “pays per the variant on the recorded claim + that player's net-vs-par for the hole” (line 521). But FR2 defines sandie variants as “up-and-down for par vs any score” (i.e., gross score vs par; it’s not a handicap-based modifier). Also earlier Epic 2 description states Wolf-Cup sandie = “up-and-down for ANY score” (line 203), which should not depend on net-vs-par at all. Using net-vs-par will mis-settle money in real play (especially with plus handicaps / stroke allocations), and would make Wolf-Cup cross-validation fail or force incorrect fixtures.
   - Suggested fix: Rewrite Story 2.4 AC to base sandie eligibility on gross score vs par when variant is `par_only`, and to ignore score entirely when `any_score` (pay whenever claim recorded). If you truly intend a net-based sandie (nonstandard), that must be explicitly added as a third variant and reflected in FR2 + templates; otherwise this is a spec bug.

8. [high] Birdie generalization lacks explicit backward-compat strategy for pinned config_version and Epic 1 golden non-regression
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:531-539
   - Confidence: high
   - Why it matters: Story 2.5 requires generalizing net-birdie into a variant shape and says Epic 1 config maps onto `{basis:'net', bonus:'single'}` “with no change to the Epic 1 golden” (line 537). But Epic-wide “registry discipline” says “config_version bump where shape changes; unknown/too-new fails closed” (line 437). Without an explicit plan for reading old pinned configs (v1) and new configs (v2) simultaneously, you risk fail-closed on already-pinned rounds or forced migration of pinned snapshots (which is high-risk and contradicts pinned determinism).
   - Suggested fix: Amend Story 2.5 AC: explicitly state the engine must support both the old and new config_version(s) for birdie/net-birdie for already-pinned rounds, and add a regression test that re-runs the exact Epic 1 fixture JSON unchanged and passes byte-identically. If you bump `config_version`, specify how old versions are decoded (e.g., Zod discriminated union by version).

9. [high] NFR-C4 adversarial fixtures ‘all-push hole’ and ‘plus-handicap’ are not owned by any Epic 2 story
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:471-557
   - Confidence: high
   - Why it matters: NFR-C4 lists adversarial fixtures: “all-push hole” and “plus-handicap”. In Epic 2 stories: 2.2 covers carryover→non-par-3; 2.6 covers cap-on-boundary; but none of 2.1–2.6 explicitly owns ‘all-push’ or ‘plus-handicap’ as a required golden/adversarial. This is a concrete test-plan hole: those cases are money-safety-critical and will otherwise be ‘we’ll remember later’—which is exactly how real-money regressions ship.
   - Suggested fix: Assign these adversarial fixtures explicitly to a story with AC language (best: attach ‘all-push’ to 2.5 or base-game regression suite, and ‘plus-handicap’ to the birdie/net detection + net allocation integration). If they truly belong to Epic 1, update the Epic 2 charter text to remove them from Epic 2’s NFRs; right now they are promised but unplanned.

10. [high] Wolf-Cup cross-validation is underspecified: no frozen reference fixture + no normalization rules for “byte-identical” SettlementEdge[]
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:593-602
   - Confidence: high
   - Why it matters: Story 2.8 AC requires F1 engine to “reproduce the money the shipped Wolf Cup app produces — asserted on exact SettlementEdge[]” (line 595) while also saying Wolf Cup code is read-only and not imported (line 596). As written, it does not define: (1) how Wolf Cup output is obtained in CI without calling live Wolf Cup services/UI; (2) how Wolf Cup’s money representation is converted into SettlementEdge[] (canonical netting, sorting, sourceId/sourceType); (3) whether a non-empty diff fails CI (it merely says “passes in CI”). This makes the cross-validation gate fragile or unfalsifiable.
   - Suggested fix: Amend Story 2.8 AC to require a checked-in, frozen reference dataset (inputs + expected normalized SettlementEdge[]), generated once from Wolf Cup and committed. Define a canonical normalization: stable sort by (fromPlayerId,toPlayerId,cents,sourceType,sourceId) and explicit netting rules (or forbid netting). Explicitly require CI to fail on any diff and to output a structured diff artifact.

11. [medium] Story 2.2 stateful carryover needs explicit hole ordering input in engine types to remain deterministic and order-independent
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:483-487
   - Confidence: high
   - Why it matters: Story 2.2 AC says greenie is “stateful across holes” and “order-independent given hole order” (line 486). Epic 1’s `holeState` definition earlier is par + per-player net + team split; it does not explicitly include `hole_number`/ordinal in the engine signature. For a stateful modifier, you must define the sequencing key the pure engine uses (course hole number vs play sequence vs 9-hole loops), otherwise different input iteration orders can change carryover outcome (violating NFR-C6).
   - Suggested fix: Update Story 2.2 AC (and/or Story 2.1) to require `holeState` include an explicit `holeNumber` or `playOrdinal`, and require `compute-foursome` to process holes in a stable sort by that key before applying stateful reductions. Add a property test: permuting input hole array order yields identical output when holeNumber fields are the same.

12. [medium] Cap story lacks explicit, testable cap-resolution algorithm details (FR4) beyond “per 345”
   - File: _bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md:553-557
   - Confidence: medium
   - Why it matters: Story 2.6 AC states: “cap-resolution rule … per ‘345’ … applied deterministically; remainder pennies allocate by fixed rule” (lines 553–556). FR4 requires both the cap and “how a capped payout resolves.” Right now the algorithm is not specified (scale down? truncate winners? single payee? per-team?). Without explicit rules, fixtures become the only spec, which is risky for maintenance and cross-validation; also NFR-C7 demands explicit remainder-penny allocation, but no rule is named here.
   - Suggested fix: In Story 2.6 AC, explicitly define the cap application algorithm in words (even if also captured by golden): e.g., cap applies to absolute team-vs-team settlement for the round; when uncapped exceeds cap, scale all edges proportionally and allocate remainder pennies by [named rule] (e.g., deterministic playerId order). Add at least one fixture where proportional scaling + remainder occurs.

## Strengths

- Each modifier story (2.2–2.6) correctly reiterates NFR-C1: fixture-first, asserting exact SettlementEdge[] before resolver code merges.
- Variants are generally fail-closed (unknown variant → unsettleable) in 2.2–2.5, aligning with FR44 / registry discipline.
- Story 2.7 sequences after 2.2–2.6 to avoid forward dependency for built-in templates, which is explicitly called out (lines 577–580).

## Warnings

None.
