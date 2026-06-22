# Codex Synthesis (Debate Tribunal)

- Generated: 2026-06-22T13:33:05.550Z
- Synthesized sources: codex-review, gemini-review, codex-critique-of-gemini
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-api/src/engine/games/ledger-to-edges.ts, apps/tournament-api/src/services/games-money.ts

## Verdict

**SHIP** — confidence: medium

## Executive summary

Decision: whether Story 2.1a’s 2v2 settle-up change (whole-dollar 1-to-1 lowering in `ledgerToEdges`, plus moving it inside `settleFoursome` try/catch) is safe to ship now. Net consensus is that the functional approach is correct for the current call path and the per-foursome isolation improvement is solid, but a couple of defensive-hardening gaps remain (primarily around silent defaults and an explicit edge-total check). Verdict: ship, with a short list of should-fix hardening items and tests.

## High-confidence findings (consensus)

1. [medium] Defensive hardening: `ledger.perPlayerCents[...] ?? 0` can silently mask missing keys and still pass the reconstruction guard
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts
   - Affirming sources: codex-review, codex-critique-of-gemini
   - Summary: Both edge emission (`const p = ledger.perPlayerCents[a] ?? 0`) and the reconstruction guard (`(ledger.perPlayerCents[m] ?? 0)`) treat missing perPlayerCents entries as 0. If a future bug/regression produces a ledger missing a member key, this can produce no edge and still pass the guard, silently under-settling that foursome.
   - Recommended action: Replace `?? 0` with strict presence checks for the four resolved members (e.g., `hasOwnProperty` + `Number.isInteger`) and throw a targeted error if any is missing/invalid (still contained by `settleFoursome` try/catch). Add a unit test for missing-key → throws.

2. [medium] Defensive hardening: no explicit check that emitted edge total matches `ledger.totalCents`
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts
   - Affirming sources: codex-review, codex-critique-of-gemini
   - Summary: The new reconstruction guard verifies per-player balances, but there is no direct assertion that the aggregate edges correspond to `ledger.totalCents`. If `computeFoursome` ever produced an inconsistent `totalCents`, this could go unnoticed (even if per-player balances reconcile).
   - Recommended action: Add an explicit check `sum(edges.cents) === ledger.totalCents` (or whatever the defined `totalCents` contract is) and throw if it fails. Add a test that corrupt totalCents triggers fail-closed behavior.

3. [low] Correctness/safety improvement: `ledgerToEdges` moved inside `settleFoursome` try/catch for per-foursome isolation
   - File: apps/tournament-api/src/services/games-money.ts
   - Affirming sources: gemini-review, codex-review
   - Summary: Moving `ledgerToEdges(...)` into the `try` ensures its fail-closed errors (e.g. `asymmetric_2v2_ledger`) become per-foursome `unsettleable` results instead of crashing the event-wide compute.
   - Recommended action: Keep as-is; add/adjust a test that forces `ledgerToEdges` to throw and confirms the foursome is returned as `unsettleable` (not an event-wide failure).

## Divergent findings (need resolution)

1. Overall risk / readiness assessment
   - Reviewers disagree on whether the change is effectively flawless vs. having material issues.
   - Positions:
     - **codex-review** (High risk, multiple high-severity gaps): “Overall risk: high. … Loss-less invariant not enforced… teamSplit shape not validated… Missing perPlayerCents entries default to 0 …”
     - **gemini-review** (No findings; exceptionally solid): “No concrete findings. Exceptionally solid, rigorous implementation… The x100 whole-dollar config validation is flawlessly applied…”
     - **codex-critique-of-gemini** (Ship; remaining gaps are defensive-hardening (should-fix, not must-fix) given upstream guarantees): “Verdict: SHIP… directionally right for the current production call path… real but DEFENSIVE-HARDENING gaps remain… Net: ship-able; the hardening items are should-fix not must-fix.”
   - Synthesizer lean: Lean to `codex-critique-of-gemini`: upstream guarantees (teams from `resolveFoursomeTeams`, ledger from `computeFoursome`, and `ledgerToEdges` now inside the per-foursome try/catch) substantially reduce the practical blast radius today, and F1 is not live. The remaining concerns are real but are best treated as should-fix hardening + tests rather than must-fix blockers.

## Dismissed findings

1. “Guard doesn't assert documented within-team symmetry” as a current correctness gap
   - Raised by: codex-review
   - Dismissal reason: disagreed_with_justification
   - Reasoning: The reconstruction guard now enforces that the produced edges reconstruct all four per-player balances; if symmetry assumptions don’t hold, it throws `asymmetric_2v2_ledger` (fail-closed). `codex-critique-of-gemini` explicitly notes this earlier concern is addressed.

2. “teamSplit shape not validated” as a high-severity must-fix for the current call path
   - Raised by: codex-review
   - Dismissal reason: missing_evidence
   - Reasoning: Given the provided context that `teamSplit` comes from `resolveFoursomeTeams` which validates 4 distinct players and distinct slots (else unsettleable), this is not evidenced as a realistic production failure mode today. It can still be added as defensive hardening, but severity downgrades.

3. “×100 tightening may strand persisted configs” as a current blocker
   - Raised by: codex-review
   - Dismissal reason: missing_evidence
   - Reasoning: No evidence was provided that any persisted F1 configs exist that violate the new whole-dollar rule; additionally, the request notes F1 is not live (only the $5 seed config exists). Treat as an operational check (optional) rather than a must-fix.

## Prioritized actions

1. [should_fix] In `ledgerToEdges`, stop using `?? 0` for the four team members’ `perPlayerCents` during both edge emission and reconstruction. Instead, require presence + integer-ness for each member key and throw a clear error if missing/invalid (still safely contained by `settleFoursome`’s try/catch).
2. [should_fix] Add an explicit aggregate invariant check relating emitted edges to `ledger.totalCents` (define/confirm the exact contract for `totalCents`, then assert it; throw on mismatch).
3. [should_fix] Add tests: (1) symmetric 2v2 ledger produces exactly the intended 0–2 edges and reconstructs per-player balances; (2) intentionally asymmetric ledger triggers `asymmetric_2v2_ledger`; (3) missing perPlayer key triggers throw (once hardening is added); (4) `ledgerToEdges` throw inside `settleFoursome` returns `kind: 'unsettleable'` (per-foursome isolation).
4. [optional] Add defensive validation that `teamSplit.teamA.length === 2` and `teamSplit.teamB.length === 2` (and members are non-empty strings) inside `ledgerToEdges`, throwing a targeted error if violated—primarily to protect future call sites beyond `resolveFoursomeTeams`.
5. [optional] Operational check: confirm there are no existing/persisted F1 point-value configs that would now fail whole-dollar validation (if any could exist outside the stated “$5 seed only” assumption).

## Open questions (for human judgment)

- What is the precise contract for `ledger.totalCents` in this engine (e.g., sum of positive per-player nets, sum of edge cents, or something else)? The proposed edge-total assertion depends on that definition.
- Is it guaranteed (by `computeFoursome`) that `ledger.perPlayerCents` always contains all four resolved members as explicit keys? If yes, codify that guarantee in a test; if not, the hardening becomes more important.
- Despite the note that F1 is not live, is there any environment/tenant where historic F1 configs (e.g., 550¢) might already be stored and expected to settle?

## Warnings

None.
