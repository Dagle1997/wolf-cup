# Codex Review

- Generated: 2026-05-02T12:18:25.924Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/routes/score-corrections.ts, apps/tournament-api/src/routes/score-corrections.integration.test.ts

## Summary

Both prior Medium findings appear addressed in the implementation:
- Breadcrumb log now occurs strictly after `db.transaction(...)` resolves and only when `finalState === 'finalized'` (apps/tournament-api/src/routes/score-corrections.ts:371-383).
- `putts` handling now cleanly distinguishes omitted vs null vs number, preventing accidental clearing when the field is omitted (score-corrections.ts:282-300).

New tests were added and cover the main behavioral edges, but the breadcrumb test still doesn’t actually assert the emitted payload contents despite the stated intent.

Overall risk: low

## Findings

1. [low] Breadcrumb test only checks presence of event, not that payload is correct (requestId/roundId/correctionId), so regressions could slip through
   - File: apps/tournament-api/src/routes/score-corrections.integration.test.ts:340-383
   - Confidence: high
   - Why it matters: The earlier issue was about a specific breadcrumb emission requirement. The current test merely finds *any* `logger.info` call whose first arg has `event === 'correction_post_finalize_pending_t6'` (lines 349-357, 371-379). It would still pass if key fields were missing/incorrect (e.g., wrong `roundId`, missing `correctionId`, missing `requestId`), or if the log schema drifted. This weakens the protection against future regressions.
   - Suggested fix: Strengthen assertions to match the intended payload, e.g.:
- `expect(infoSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'correction_post_finalize_pending_t6', roundId: s.roundId, requestId: expect.any(String), correctionId: body.correctionId }))`
Optionally assert no additional breadcrumb calls and/or that the breadcrumb call happens after the response body contains the correctionId (by comparing to response JSON).

2. [low] `postCommitContext` is populated after the breadcrumb log; if logging throws, the error log loses the context it was meant to capture
   - File: apps/tournament-api/src/routes/score-corrections.ts:371-388
   - Confidence: medium
   - Why it matters: `postCommitContext` is intended to aid debugging for errors after commit (it’s included in the catch log at lines 412-418). Right now it’s assigned only after the `log.info(...)` breadcrumb (lines 374-382 vs 384-387). If `log.info` (or any code between commit and assignment) throws, the catch path logs `postCommitContext: null`, reducing diagnosability exactly in the post-commit window you’re trying to observe.
   - Suggested fix: Move the `postCommitContext = { ... }` assignment to immediately after `result` is available and before any post-commit side effects (before the breadcrumb `log.info`).

## Strengths

- `putts` omission vs null handling is implemented directly and unambiguously (`body.putts === undefined ? cell.putts : body.putts`), preventing the prior data-loss scenario (score-corrections.ts:282-300).
- Breadcrumb emission is now clearly outside the transaction and gated on `finalized`, matching the requirement that rolled-back transactions shouldn’t emit misleading logs (score-corrections.ts:371-383).
- Integration tests cover the three putts cases (omitted/preserved, null/cleared, number/set) and the finalized vs non-finalized breadcrumb behavior.

## Warnings

None.
