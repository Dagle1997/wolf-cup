# T10-3 Party-Mode Review — Handoff-Flake Structural Diagnosis

Single non-interactive written review (analyst, architect, pm, qa, dev). No open
questions — see "Verdict."

**Subject:** T10-3 concluded as a diagnosis with NO code fix. All three structural
flake hypotheses were refuted/eliminated; `retry: 1` was retained by explicit user
decision; the only diff is a rewritten inline comment in
`round-lifecycle.integration.test.ts` documenting the diagnosis.

---

## Analyst

The story's premise was "a structural race exists; fix it and remove the retry." The
diagnosis disproved the premise. The evidence chain is complete for the hypotheses
that were on the table:
- Contamination: a purpose-built 4-mode probe is direct, reproducible empirical
  evidence (not argument). The discriminating result (distinct pids per file under
  the default pool, even at maxForks=1) is exactly the fact that settles it.
- Global race: refuted by a grep-checkable invariant (no `test.concurrent`).
- Handler window: refuted deductively from the sequential, single-connection control
  flow — appropriately labeled "deductive," not "observed," in the final comment.

One unexamined-hypothesis check: could the 500 be a Vitest *threads*-pool artifact?
No — the repo sets no `pool`, and the probe ran under the actual default. Could it be
an `app.request()`/Hono transient? Possible but that collapses into the same
"environmental transient" class the comment already names as inference. No material
gap.

## Architect

The technical claims are correct: libsql `cache=shared` in-memory DBs are
process-scoped; Vitest's default `forks`+`isolate:true` isolates by fresh process per
file; the handler's only two 500 paths are `event_not_resolvable` (state-not-finalized
precondition) and the `transfer_failed` catch. The decision NOT to apply the
by-construction hardening (unique per-file DB URL) is architecturally correct here:
applying it would imply a cause that the evidence refutes, and would touch a
cross-cutting test convention (49 files) for no demonstrated benefit. Deferring any
broad test-isolation change to a real followup (if ever needed) is the right call.

## PM

The story delivers value even without a code fix: it converts "unknown flake masked by
a retry" into "characterized non-structural transient with a justified, documented
mitigation." That is a legitimate close. The deviation from AC-3 ("remove retry") is
explicitly owned by the user's disposition decision and recorded in the story file, so
the audit trail is intact. Scope did not creep — the 48 sibling files were correctly
left untouched.

## QA

The critical QA question: is it safe to keep `retry: 1`? Yes — and notably the diagnosis
did NOT remove the retry on the strength of an unproven fix (which would have been the
dangerous move). The comment is honest that the precise firing path of the one-off 500
was never captured, so the cause is inference, not proof. The escalation trigger is
well-specified: a BOTH-iteration (deterministic) failure or a production 500 in the
post-finalize→handoff window reopens the diagnosis, ideally capturing `body.code` + the
server error string. Residual risk (a sub-50%-rate real bug could still hide under
retry) is the same risk T10-2 already accepted and is now better-documented. Regression
is clean (tournament-api 965✓+2 skipped = baseline; engine 472✓, wolf-cup-api 517✓,
tournament-web 325✓; typecheck + lint clean).

## Dev

The comment is accurate, scoped, and maintainable; it separates empirical from deductive
refutation and avoids overclaiming after the impl-codex tightening. The line-number
references (`scorer-assignments.ts:443`/`:227`) carry the usual rot risk but match the
codebase's existing comment convention. Throwaway probe files were removed before commit.
No production code touched.

---

## Verdict

**PASS — no open questions, no required changes.** The story meets its (revised)
intent: a complete, evidence-backed diagnosis with a justified mitigation-retention
decision. Proceed to commit with status `done`. The only residual is inherent and
already documented: the exact cause of the single historical 500 is unproven (its error
path was not captured), and `retry: 1` is a mitigation, not a structural fix — both
explicitly acknowledged in the inline comment and the story's Completion Notes, with a
clear reopen trigger.
