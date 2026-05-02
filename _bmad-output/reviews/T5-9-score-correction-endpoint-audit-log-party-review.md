# T5-9 Party-Mode Review (non-interactive, written)

- Story: T5-9 Score Correction Endpoint + Audit Log [port]
- Spec: `_bmad-output/implementation-artifacts/tournament/T5-9-score-correction-endpoint-audit-log.md`
- Generated: 2026-05-02 (impl-codex-rerun returned 0H 0M 2L; both non-blocking)
- Convened: Mary (📊 Analyst), Winston (🏗 Architect), John (📋 PM), Quinn (🧪 QA), Amelia (💻 Dev)
- Format: written consensus; no open questions; tournament-director will codex-review this output as step 9.

---

## Mary (📊 Analyst) — AC compliance

8 ACs traced. Solid compliance.

- **AC-1 (endpoint shape + Zod):** ✅ Path UUID validation for roundId + playerId; integer 1–18 for holeNumber; Zod body for grossStrokes (1-20) + putts (0-15 nullable optional) + reason (max 500).
- **AC-2 (auth FIRST + no-existence-leak):** ✅ Both POST and GET run auth in-tx before state/existence reads. Tests (p) and (q) lock in 403 on nonexistent rounds.
- **AC-3 (existence + insert + UPDATE + audit + activity):** ✅ All five steps in single tx.
- **AC-4 (T6 stub post-commit breadcrumb):** ✅ Breadcrumb emits AFTER `db.transaction` resolves successfully (verified by new test). Non-finalized correction does NOT emit (verified by new test).
- **AC-5 (200 response shape):** ✅ `{ ok, correctionId, prior, new, requestId }`.
- **AC-6 (GET no-existence-leak):** ✅ Auth before SELECT; nonexistent roundId returns 403.
- **AC-7 (audit + activity contract):** ✅ One audit_log row per correction + one score_corrections row.
- **AC-8 (test coverage):** ✅ All 17 cases (a-q) plus 5 added (breadcrumb x2, putts x3) = 22 net new tests.

**v1 deviation noted:** putts preservation semantics (omitted vs null vs number) — added during impl-codex round to prevent silent data loss. Documented in handler code comments.

---

## Winston (🏗 Architect) — boundary + auth + state

- **Auth-leak resistance** is correctly implemented in both endpoints. Auth predicate evaluates against the rounds + events + scorer_assignments tables; nonexistent rounds → false → 403. No 404 path leaks existence.
- **Per-event organizer call site** correctly passes `session.userId` (not URL `:playerId`) to `isEventOrganizer`. The spec's CRITICAL warning callout was load-bearing; impl honors it.
- **Append-only score_corrections** preserved: handler INSERTs only; no UPDATE/DELETE on that table.
- **State gate via T5-8** centralizes the FSM check; reuses `getRoundState` cleanly.
- **Tenant scoping** exhaustive: 4 joins in the auth helpers, all tenant-filtered.
- **Race residual** (UPDATE on hole_scores during a concurrent /finalize): same as T5-7/T5-8; documented under T5-8b's BEGIN IMMEDIATE umbrella. T5-9 EXPLICITLY allows finalized writes (the entire point of the endpoint), so the EXISTS-state-gating pattern from T5-7 doesn't apply here.

**Boundary check:** zero edits to apps/api/**, apps/web/**, packages/engine/**.

---

## John (📋 PM) — user value

Mark + Jeff at the bar reviewing round 2 scores. Mark says "wait, hole 11 was a 5, not 4". Jeff (the scorer of Mark's foursome) opens... well, no UI yet — Followup T5-9c. For v1 trip-day, Jeff would use curl from his laptop:

```
curl -X POST .../api/rounds/<id>/scores/<mark>/11/correct \
  -d '{"grossStrokes":5,"reason":"mistyped at the turn"}'
```

Returns 200. Score updated. Audit trail captured.

**Trip-day v1 readiness:** acceptable. The endpoint exists; UI lands in v1.5. Organizer can recover from any miskey.

**v1 limitations to flag:** no UI, no T6 recompute (pre-T6), no FR-D9 visibility filtering on GET (pre-money-posture).

---

## Quinn (🧪 QA) — coverage

- 17 AC test cases (a-q) + 5 added (breadcrumb x2, putts x3) = 22 net new.
- Auth-leak regressions (p, q) explicitly cover the spec's no-existence-leak invariant.
- Putts preservation tests (3 cases) lock in the data-loss prevention.
- Breadcrumb tests use vi.spyOn(logger, 'info') — verifies post-commit emission.

**Holes:** breadcrumb test asserts presence but not payload contents (impl-codex-rerun Low #1). Easy v1.5 tightening; not blocking.

622/622 tournament-api passing. Engine + wolf-cup api + tournament-web all green.

---

## Amelia (💻 Dev) — code quality

- `routes/score-corrections.ts`: 408 LOC. Two handlers + two auth helpers. Single tx per request. Clear sequence comments (i)-(vii) per AC.
- `routes/score-corrections.integration.test.ts`: 460 LOC. 22 tests across 2 describes.
- `app.ts`: +12 lines (import + mount + comment block).

Provenance header cites Wolf Cup `279a3538`. PORTS.md entry would be a v1.5 polish (no PORTS.md exists in tournament repo today; could add as part of T5-9c admin-tooling).

`pnpm -r typecheck` ✅. `pnpm -r lint` ✅. No dead code. No new dependencies.

---

## Consolidated recommendations

| # | Recommendation | Severity | Status |
|---|---|---|---|
| 1 | Fix putts data loss (omitted → preserved) | Medium | ✅ APPLIED iteration 2 |
| 2 | Add breadcrumb test | Medium | ✅ APPLIED iteration 2 |
| 3 | Tighten breadcrumb test to assert payload contents | Low | v1.5 polish |
| 4 | Move postCommitContext capture before logging | Low | v1.5 polish |
| 5 | UI for corrections (T5-9c) | — | v1.5 |
| 6 | T6 recompute hook (T5-9a) | — | when T6 ships |
| 7 | FR-D9 visibility filtering on GET (T5-9b) | — | when money lands |
| 8 | Bulk correction endpoint (T5-9d) | — | v1.5 |
| 9 | PORTS.md provenance index | — | v1.5 with T5-9c |

**Verdict:** Recommend → done. AC compliance solid; trip-ready as API; UI is the v1.5 layer.

No open questions for the user.
