# Codex Review

- Generated: 2026-05-02T13:22:42.458Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md

## Summary

Spec is largely implementable and aligns with prior stories (auth-first in-tx, freeze-window, audit+activity, post-commit breadcrumb), but there are several concrete inconsistencies that will cause mismatched behavior/tests and at least one major missing validation: tying `ruleSetId` to the `eventId` (and tenant) before inserting a revision. The path allowlist/footprint is also internally contradictory.

Overall risk: high

## Findings

1. [high] Missing validation that :ruleSetId belongs to :eventId (and tenant) before allowing organizer to create a revision
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:54-125
   - Confidence: high
   - Why it matters: The spec defines auth as “per-event organizer” (lines 54-58, 106-115) but never requires that the `ruleSetId` in the URL is the rule set actually used by that event. As written, an organizer of Event A could potentially create revisions on an unrelated rule set ID (or a rule set used by Event B) as long as they pass the Event A organizer check and boundary checks. Depending on DB constraints, this is either (a) an authorization bug (cross-event edit) or (b) a 500 from FK violation when inserting `rule_set_revisions` (line 121), which would violate the endpoint contract/tests.
   - Suggested fix: Inside the transaction (after auth-first), fetch the event’s rule-set relationship (e.g., `events.rule_set_id` or event↔rule_set join table—whatever the schema uses) with `tenant_id` scoping, and require it matches `:ruleSetId`. If event has no such linkage today, add an explicit existence/ownership check on `rule_sets` + mapping table and return a deterministic 403/422 code. Add a test for mismatched `eventId`/`ruleSetId` (not currently listed).

2. [high] Path footprint/allowlist is self-contradictory (4 files vs 6 files; services changes listed later but not in initial allowlist)
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:17-244
   - Confidence: high
   - Why it matters: The story says “6 ALLOWED files (3 new + 3 mod)” in the review request, but Section 1 lists only 4 files (lines 19-24). Later, Tasks/File list includes `services/round-state.ts` and `services/index.ts` (lines 176-181, 236-244), which would be out-of-allowlist if enforced. This is the kind of process-footprint mismatch that causes blocked merges or retroactive scope debates.
   - Suggested fix: Make the allowlist single-source-of-truth: update Section 1 to include all intended files (including `services/round-state.ts` and `services/index.ts`) and ensure the “3 new + 3 mod” count matches the actual plan. If the intent is truly 6 files, list all 6 explicitly in the allowlist block.

3. [medium] Spec contradicts itself about whether effectiveFromRoundId can be null (but Zod schema requires UUID)
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:97-105
   - Confidence: high
   - Why it matters: Section 5 claims a rejection case for `effectiveFromRoundId is null AND effectiveFromHole = 1` (line 73), but AC-1 defines `effectiveFromRoundId` as required UUID in both contract and Zod schema (lines 98, 102). If implemented as-written, the “null” branch is unreachable; if implemented to allow null, the schema/AC-1 and tests must change.
   - Suggested fix: Pick one: (A) keep `effectiveFromRoundId` required and delete the “null” discussion, or (B) allow null in schema (`z.string().uuid().nullable()` or optional + refine) and explicitly define the intended behavior for null beyond the setup-shaped rejection.

4. [medium] Error/status-code naming inconsistencies will cause handler/test mismatch (400 vs 422; code string mismatches; heading typos)
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:60-167
   - Confidence: high
   - Why it matters: Examples: Section 5 says return 422 `frozen_round_in_window` (line 67) but AC-2 requires 422 code `rule_edit_would_recompute_finalized_round` (line 114). The test list item (h) heading says “422 use_setup_endpoint” but the expected response is “400 use_setup_endpoint” (line 165). Task 3 mentions `malformed_json` (line 190) but AC-1 only defines `invalid_body` with `issues` (lines 101-104). These inconsistencies are likely to create brittle tests or ambiguous implementation decisions.
   - Suggested fix: Normalize: define a single canonical set of `{status, error, code, shape}` for each failure mode, then ensure AC-2/AC-8/Tasks all match. If you want both `invalid_body` and `malformed_json`, define both explicitly in AC-1 (including shapes).

5. [medium] Frozen-round window ‘frozenRoundIds’ identifier type is ambiguous (event_rounds.id vs rounds.id)
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:62-115
   - Confidence: high
   - Why it matters: The freeze-window check is described as enumerating `event_rounds` then mapping to `rounds.id` and reading `round_states` (lines 64-68, 114-115). But the error payload calls the field `frozenRoundIds` and alternates between “frozen round IDs” (line 67) and explicitly `[<eventRoundId>, ...]` (line 114). Clients/tests will need consistency, and implementers need clarity on whether to return event_round IDs or runtime round IDs.
   - Suggested fix: Decide and document: return `eventRoundIds` (recommended since boundary uses event_round IDs and they exist even if `rounds` row doesn’t) or return runtime `roundIds`. Rename the field accordingly (`frozenEventRoundIds` vs `frozenRoundIds`) and align AC-2 + tests.

6. [medium] `use_setup_endpoint` guard may block the only way for an organizer (non-admin) to correct a start-of-event misconfig
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:104-105
   - Confidence: medium
   - Why it matters: AC-1 mandates rejecting a boundary at the first round + hole 1 with `use_setup_endpoint` (lines 104-105). But T3-5 endpoint is `/api/admin/...` (lines 28-36), which may not be available to a per-event organizer who is not a global admin. That creates a UX dead-end for a real scenario: fixing a misconfig discovered after tee-off but before any rounds are finalized (when recompute would otherwise be allowed).
   - Suggested fix: Consider relaxing the guard to only reject when the event is truly in “setup” state (e.g., no rounds opened / no scores exist / event not started) or when caller is an admin and you want to funnel them to admin endpoint. Alternatively, allow it but keep it event-scoped, since freeze-window guard already protects finalized rounds.

7. [low] AC-8 summary line says “4 scenarios + 4 added” but list includes 5 added tests (a–i = 9 total)
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:154-167
   - Confidence: high
   - Why it matters: This is minor, but it’s the kind of mismatch that can cause scope arguments during review: line 154 says “4 scenarios … + 4 added” but then enumerates 9 cases (a–i), which is 4 epic + 5 added.
   - Suggested fix: Update AC-8 wording to “4 scenarios per epic AC + 5 added = 9 total” (or adjust the list).

## Strengths

- Auth-first inside the transaction with a deliberate no-existence-leak behavior is clearly specified (lines 54-60, 106-111).
- Freeze-window definition is explicit and based on `event_rounds.round_number` rather than timestamps (lines 62-68, 215-216).
- Post-commit breadcrumb is explicitly kept out of the transaction (lines 75-88, 131-142), matching the stated T6 deferral.
- Test plan includes both positive and negative cases and explicitly calls out an auth-leak regression and breadcrumb spy (lines 158-166).

## Warnings

None.
