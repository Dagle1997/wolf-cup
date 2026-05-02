# Codex Review

- Generated: 2026-05-02T12:20:08.007Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/reviews/T5-9-score-correction-endpoint-audit-log-party-review.md, _bmad-output/reviews/T5-9-score-correction-endpoint-audit-log-impl-codex-rerun.md, apps/tournament-api/src/routes/score-corrections.ts, _bmad-output/implementation-artifacts/tournament/T5-9-score-correction-endpoint-audit-log.md

## Summary

Implementation largely matches the spec’s endpoint shape, auth-first/no-existence-leak ordering, state gating via getRoundState, single-tx write sequence (score_corrections insert + hole_scores update + audit + activity), and post-commit breadcrumb only for finalized rounds.

However, there are a couple of concrete spec drifts/risks: (1) the semantics of omitted `putts` differ from the written AC-3 (now preserves existing putts instead of coercing to null), and (2) GET success response includes `requestId` (not stated in AC-6). Also, a small post-commit diagnosability issue remains: `postCommitContext` is assigned after the breadcrumb log, so if logging throws, the catch log loses the context it was meant to capture.

Note: the party review makes several assertions about test coverage and specific test behaviors, but the integration test file contents were not provided here, so those claims cannot be independently verified from the evidence in this review bundle.

Overall risk: low

## Findings

1. [medium] Spec drift: omitted `putts` now preserves existing value, but AC-3 specifies `body.putts ?? null` (omitted clears to null)
   - File: apps/tournament-api/src/routes/score-corrections.ts:282-313
   - Confidence: high
   - Why it matters: The implementation explicitly changes behavior when the client omits `putts`: it preserves the existing DB value (`body.putts === undefined ? cell.putts : body.putts`). The spec’s AC-3(c)/(d) text describes writing `putts: body.putts ?? null`, which would clear putts to NULL when omitted. This is a behavioral contract change that can affect clients and audit semantics, and it means “AC compliance” depends on accepting the deviation (even if it’s arguably the safer behavior).
   - Suggested fix: Either (a) update the spec/AC text to explicitly document the three-case semantics (undefined=preserve, null=clear, number=set), or (b) revert to the documented `?? null` behavior if strict adherence is required. Ensure tests assert the chosen contract so it’s not ambiguous.

2. [low] `postCommitContext` is populated after breadcrumb logging; if `log.info` throws, error logs lose the intended post-commit context
   - File: apps/tournament-api/src/routes/score-corrections.ts:371-418
   - Confidence: high
   - Why it matters: `postCommitContext` is meant to improve diagnosability in the post-commit window (it’s logged in the generic catch at lines 412-418). Right now it’s assigned after the post-commit breadcrumb `log.info(...)`. If the logger throws (sync transport failure, misconfigured serializer, etc.), the catch path will run with `postCommitContext: null`, reducing the value of the post-commit instrumentation.
   - Suggested fix: Assign `postCommitContext = { correctionId: result.correctionId, finalState: result.finalState }` immediately after `result` is available and before any post-commit side effects (before the `if (result.finalState === 'finalized') log.info(...)`).

3. [low] GET success response includes `requestId` (not stated in AC-6 response shape)
   - File: apps/tournament-api/src/routes/score-corrections.ts:478-479
   - Confidence: high
   - Why it matters: AC-6 specifies `GET` returns `200 { items: ScoreCorrection[] }`. The implementation returns `{ items, requestId }`. This is usually backward-compatible for clients that ignore unknown fields, but it is a spec drift and can matter if clients do strict response validation.
   - Suggested fix: Either update AC-6 to include `requestId` on GET success (to match the general “include requestId everywhere” contract), or remove `requestId` from the GET 200 response if you want strict spec conformance.

## Strengths

- Auth is performed inside the transaction before any state/existence reads in both handlers, preserving the no-existence-leak invariant (POST: lines 220-237; GET: lines 448-463).
- POST correction work is done in a single transaction and includes score_corrections insert, hole_scores update, audit log write, and activity emit (lines 302-361).
- Breadcrumb is emitted strictly post-commit and gated on finalized state (lines 371-382), matching the intent to avoid logging for rolled-back transactions.
- Tenant scoping is consistently applied in the queries shown (e.g., lines 96-103, 112-118, 265-270, 469-472).

## Warnings

None.
