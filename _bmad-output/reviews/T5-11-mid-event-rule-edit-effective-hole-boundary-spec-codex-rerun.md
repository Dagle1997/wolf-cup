# Codex Review

- Generated: 2026-05-02T13:25:55.669Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md

## Summary

Spec updates largely address the previously flagged contradictions (path footprint list, effectiveFromRoundId non-nullability, removal of the setup-endpoint guard, frozenRoundIds type, and test count wording). The main new risk is the chosen v1 “loose” rule-set scope check: it explicitly allows any event organizer to create revisions on any tenant rule set, which can become a cross-event data-integrity/authorization problem unless the runtime revision-selection logic is guaranteed to be event-scoped.

Overall risk: medium

## Findings

1. [high] Loose tenant-only rule-set scope check can allow cross-event edits / unintended global side effects
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:116-125
   - Confidence: medium
   - Why it matters: AC-2(ii) explicitly adopts the v1 “loose check” (rule_set exists in tenant) and acknowledges it “accepts that any organizer can revise any tenant-scoped rule-set in the context of any event they organize” (lines 121–124). That is a real authorization broadening: an organizer of Event A can mutate a rule-set that may be used by Event B (or is a shared template). If downstream rule-evaluation selects “latest revision by ruleSetId” (not proven otherwise in this spec), this becomes cross-event data corruption. Even if evaluation is event-scoped via `context_id`, the spec does not require/verify that reads enforce that scoping, so the safety of the loose check is not demonstrated here.
   - Suggested fix: At minimum, add an explicit requirement (and a test) that the rule engine selects revisions scoped to the event (e.g., by `context_id='event:'+eventId`, or by an event→rule_set_revision pointer). Preferably, implement a real association check in v1 by validating `ruleSetId` matches what the event is configured to use (if such a column exists), or fast-follow with the proposed `event_rule_set_links` (T5-11e) before relying on this endpoint in production. If the loose check remains, document it as a risk acceptance with explicit blast-radius and operational guidance (e.g., rule sets must be per-event, not shared).

2. [medium] Path-footprint section contradicts itself on number of MOD files
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:19-29
   - Confidence: high
   - Why it matters: Section 1 lists 6 files with 4 marked as MOD (app.ts, audit-log.ts, round-state.ts, services/index.ts; lines 22–25), but line 28 says “All three MOD edits are additive.” This kind of contradiction frequently results in missed updates or incorrect review expectations during implementation.
   - Suggested fix: Update line 28 to reflect the correct count (“All four MOD edits are additive…”) or adjust the file list to match the intended count.

3. [medium] Task 5 still instructs implementing only 9 tests, but AC-8 requires 10 (a–j)
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:168-223
   - Confidence: high
   - Why it matters: AC-8 defines 10 required test cases (a–j) and explicitly includes (j) “404 rule-set scope check” (lines 168–182). But Task 5 says “Implement all 9 AC-8 cases (a)–(i)” (lines 217–221), which can lead to the new rule-set scope test (j) being skipped—exactly the area you asked to re-review.
   - Suggested fix: Change Task 5 to require all 10 cases (a–j), or explicitly call out (j) in the task text.

4. [medium] Frozen-round error code is inconsistent within the spec
   - File: _bmad-output/implementation-artifacts/tournament/T5-11-mid-event-rule-edit-effective-hole-boundary.md:62-176
   - Confidence: high
   - Why it matters: Section 5 says the frozen-round rejection returns 422 `frozen_round_in_window` (line 69), but AC-2(iv) specifies 422 with code `rule_edit_would_recompute_finalized_round` (line 128) and AC-8(c) expects the latter (line 174). This is likely to create implementation/test mismatch and client-contract ambiguity.
   - Suggested fix: Pick one code name and use it consistently throughout (recommend using the AC-2/AC-8 code since it’s already specified in multiple places).

## Strengths

- AC-1 now clearly states `effectiveFromRoundId` is required and non-nullable, removing the prior semantic contradiction with T3-5 (line 112).
- Section 5b and AC-8(h) now consistently allow hole-1/first-round edits (lines 75–83, 179–180), resolving the prior guardrail that blocked the only usable path for non-admin organizers.
- AC-2(iv)/Section 5 now clearly states `frozenRoundIds` are `event_rounds.id` values with rationale (lines 69–70, 128–129), which is a concrete client-contract improvement.
- AC-8 test matrix is enumerated and now includes the new rule-set-not-found case (j) (lines 168–182).

## Warnings

None.
