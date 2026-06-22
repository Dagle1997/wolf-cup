# Codex Critique

- Generated: 2026-06-22T13:30:00.564Z
- Critiquing: gemini-pro-latest
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Evidence files: apps/tournament-api/src/engine/games/ledger-to-edges.ts, apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/engine/games/registry.ts

## Verdict

**SHIP** — overall agreement: partial

## Summary

Gemini’s “no concrete findings / exceptionally solid” verdict is mostly directionally right for the *current* production call path (teamSplit from resolveFoursomeTeams; ledger from computeFoursome; ledgerToEdges executed inside settleFoursome’s try/catch). However, calling it flawless is not defensible: there are a couple of real but *defensive-hardening* gaps Gemini didn’t mention—primarily the silent `?? 0` defaults on `perPlayerCents` (which can mask missing keys) and the lack of any explicit sanity check tying edge sums to a ledger-level total (if such a field exists/has meaning). My earlier “symmetry not asserted” concern is now addressed by the reconstruction guard; the other earlier items downgrade in severity given the upstream guarantees.

## Critiques of prior findings

1. [partial] “No concrete findings were identified… exceptionally solid, rigorous implementation”
   - Reasoning: For the stated Story 2.1a behavior and the shown production wiring, the implementation is solid and fail-closed in the right place. But “no findings” overstates it: `ledger.perPlayerCents[a] ?? 0` (and the guard comparing against `?? 0`) can silently accept a ledger missing keys for a member if both sides are missing/treated as zero. That’s unlikely today if computeFoursome always populates all four, but it’s still a real correctness footgun for future changes/tests.

2. [partial] “Strictly verifying exactness using a fail-closed reconstruction guard”
   - Reasoning: Agree the reconstruction guard is strong: it prevents silently-wrong settlements for non-pairwise ledgers by requiring emitted edges to reproduce all four members’ perPlayerCents. However, it verifies exactness only with respect to `ledger.perPlayerCents` (with `?? 0` fallbacks), not against any independent ledger invariant (e.g., sum-to-zero or `ledger.totalCents`), so it’s not “strictly” maximal.

3. [partial] “Moving ledgerToEdges inside the try/catch scope successfully guarantees per-foursome blast-radius isolation, preventing event-wide crashes.”
   - Reasoning: It improves locality (ledgerToEdges failures become `engine_error` instead of propagating out of settleFoursome). But event-wide isolation already existed because computeF1EventEdges wraps each settleFoursome call in its own try/catch and converts throws into an unsettleable result. So the benefit is real but overstated.

4. [agree] “The x100 whole-dollar config validation is flawlessly applied and subsumes the old even-cents rule.”
   - Reasoning: Given Story 2.1a’s requirement (“no half-dollar in settle-up legs”), requiring multiples of 100 cents is consistent with the new 1-to-1 per-player edges (which are in perPlayerCents units). It also implies internal `value/2` remains integer cents. If there’s concern about backward compatibility for previously-allowed non-$1 increments, that’s a product/migration issue, not an algorithm bug.

## Additional findings (Codex caught, prior reviewer missed)

1. [medium] Missing perPlayerCents keys can be silently treated as 0, and the reconstruction guard won’t catch “missing-but-nonzero” if both sides are absent
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:35-63
   - Confidence: high
   - Why it matters: `const p = ledger.perPlayerCents[a] ?? 0` and later `ledger.perPlayerCents[m] ?? 0` mean absence of required ledger entries can look like a legitimate push. If computeFoursome ever regresses (or a future game reuses ledgerToEdges with a different ledger shape), this can produce under-settlement without tripping the guard.
   - Suggested fix: Fail closed on missing keys for the 4 members: e.g., check `Object.hasOwn(ledger.perPlayerCents, m)` for each member and throw `missing_per_player_cents:${m}` instead of defaulting to 0. Keep `0` only for explicit zeros.

2. [low] No explicit check that edges reconcile to an independent ledger total / sum-to-zero invariant
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:47-63
   - Confidence: medium
   - Why it matters: The guard ensures equality to `perPlayerCents`, but if `perPlayerCents` were internally inconsistent with another ledger field (e.g., `totalCents`) due to a compute bug, ledgerToEdges wouldn’t detect it. In practice, downstream net computation uses edges anyway, so this is mostly an internal consistency check.
   - Suggested fix: Optionally add invariants like: sum of `ledger.perPlayerCents[m]` over members must be 0; and/or if `ledger.totalCents` is defined, assert it matches `sumPositive(perPlayerCents)` (or whatever the Ledger contract defines).

3. [low] ledgerToEdges assumes teamSplit is structurally valid (length 2 arrays, distinct members); relies on upstream resolveFoursomeTeams
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:30-38
   - Confidence: high
   - Why it matters: In current production usage this is safe (resolveFoursomeTeams enforces four distinct players in distinct slots). But ledgerToEdges is exported/pure and could be reused in tests or future call sites; malformed teamSplit would throw via `!` or produce confusing errors.
   - Suggested fix: Add cheap runtime asserts at top: teamA/teamB length 2, all 4 distinct, no overlap; throw a clear `invalid_team_split` error.

## Consensus recommendations

- Ship as-is for Story 2.1a given the guarded reconstruction and upstream team validation; Gemini’s ‘flawless’ wording should be toned down.
- Tighten fail-closed behavior by removing `?? 0` defaults for required perPlayerCents entries (treat missing as an error), which meaningfully reduces future silent mis-settlement risk.
- Optionally add internal consistency asserts (sum-to-zero and/or ledger.totalCents reconciliation) if the Ledger type defines such invariants.
- Optionally add lightweight runtime validation of teamSplit inside ledgerToEdges to keep the function robust if reused outside settleFoursome.

## Warnings

None.
