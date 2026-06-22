# Codex Review

- Generated: 2026-06-22T13:24:05.986Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-api/src/engine/games/ledger-to-edges.ts, apps/tournament-api/src/engine/games/ledger-to-edges.test.ts, apps/tournament-api/src/engine/games/registry.ts, apps/tournament-api/src/services/games-money.ts, apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-base-flat.json, apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-frontback-segmented.json, apps/tournament-api/src/engine/games/__fixtures__/guyan-2v2-nine-hole-front.json, apps/tournament-api/src/engine/games/__fixtures__/cascade-resolver-lock-gate.json, apps/tournament-api/src/services/game-config-write.test.ts

## Summary

The 1-to-1 lowering is mathematically exact for the intended Guyan-2v2 symmetric ledger *if* `ledger.perPlayerCents` is complete/consistent and `ledger.totalCents` matches that ledger. However, the current implementation does not actually enforce the “loss-less vs totalCents” invariant and has a couple of fail-open behaviors (missing per-player keys / malformed teamSplit) that can silently produce missing/incorrect edges rather than failing closed. The try/catch move in `games-money.ts` looks correct and does isolate the new guard throws per-foursome.

Overall risk: high

## Findings

1. [high] Loss-less invariant not enforced: edges can reconstruct perPlayerCents yet sum(edges) != ledger.totalCents (silent under/over-collection risk)
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:33-63
   - Confidence: high
   - Why it matters: Acceptance criterion (3) explicitly requires `sum(edges) === ledger.totalCents`. The new guard only checks that emitted edges reconstruct the four `perPlayerCents` entries (lines 47–63) but never checks `ledger.totalCents`. If `computeFoursome` (or future engine changes) ever produce an inconsistent `totalCents` (e.g., cross matrix accumulation bug, sign-mixed cross cells, or total computed off a different basis), this function can emit edges that settle a different total amount than the ledger claims—i.e., real-money mismatch without an error.
   - Suggested fix: After building `edges`, compute `const edgeTotal = edges.reduce((s,e)=>s+e.cents,0)` and `if (edgeTotal !== ledger.totalCents) throw new Error(`asymmetric_2v2_ledger_total: edges=${edgeTotal} ledger=${ledger.totalCents}`)`. Add a unit test that would currently pass reconstruction but fails total reconciliation (e.g., symmetric perPlayerCents with deliberately wrong totalCents).

2. [high] teamSplit shape is not validated; malformed inputs can produce edges with undefined playerIds and/or make the reconstruction guard ineffective
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:30-56
   - Confidence: high
   - Why it matters: The implementation assumes exactly 2 players per team (loop `for (let i = 0; i < 2; i++)`, lines 35–45) and uses `const a = teamA[i]!; const b = teamB[i]!;` (lines 36–37). The `!` is TypeScript-only; at runtime `a`/`b` can be `undefined` if `teamSplit` is malformed. That can lead to edges with `fromPlayerId`/`toPlayerId` of `undefined`, and the reconstruction guard can also be polluted because `members = [teamA[0], teamA[1], ...]` (line 50) may contain `undefined` and will treat missing ledger entries as `0` via `?? 0` (line 58). In a real-money system, emitting an edge with an undefined party is catastrophic and should be impossible even under unexpected caller bugs.
   - Suggested fix: Fail fast at the top: verify `teamA.length===2 && teamB.length===2`, all four entries are non-empty strings, and all four are distinct. If not, throw a clear engine error (e.g., `invalid_2v2_team_split`). Also make `members` use the validated non-optional `a0,a1,b0,b1` locals rather than raw indexing.

3. [high] Missing perPlayerCents entries default to 0, which can silently drop required settlement legs
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:38-63
   - Confidence: high
   - Why it matters: `const p = ledger.perPlayerCents[a] ?? 0` (line 38) and the guard comparison `(ledger.perPlayerCents[m] ?? 0)` (line 58) treat “missing key” as “exactly zero”. If the ledger is missing a player key due to an upstream bug, this lowering can emit no edge for that player and still pass the guard (because both sides coalesce to 0). That is a silent failure mode: money that should be exchanged is omitted with no error.
   - Suggested fix: Require presence and integer-ness: for each of the 4 members, assert `Object.prototype.hasOwnProperty.call(ledger.perPlayerCents, id)` and `Number.isInteger(value)`. If absent/non-integer, throw (engine_error). Add a test where `perPlayerCents` omits `a2` but should not be treated as 0.

4. [medium] Fail-closed guard does not assert the documented 2v2 symmetry invariants (within-team equality), so some non-Guyan ledgers could “pass” despite violating the stated assumptions
   - File: apps/tournament-api/src/engine/games/ledger-to-edges.ts:33-63
   - Confidence: medium
   - Why it matters: The header comment states exactness relies on within-team symmetry (`perPlayerCents[a0]==perPlayerCents[a1]` etc.). The current guard only checks that the edges reconstruct `perPlayerCents` (lines 47–63), which will also pass for any ledger where each slot-pair is zero-sum (`b_i == -a_i`) even if `a0 != a1`. That may be fine mathematically (it’s still a valid net settlement), but it contradicts the documented invariant and reduces the guard’s ability to detect “this isn’t the ledger shape we intended for Guyan-2v2.” In real-money systems, detecting shape drift early is valuable.
   - Suggested fix: If the intent is truly “2v2 symmetric Guyan-only”, explicitly assert: `pa0===pa1`, `pb0===pb1`, `pa0===-pb0` (or equivalent), and potentially that `ledger.cross` shape/values match expected symmetry. If the intent is broader (“any per-player vector that is pairwise by slot”), update the doc comment to match reality so future changes don’t rely on a false guarantee.

5. [medium] Point-value tightening to whole-dollar may strand existing persisted configs as unsettleable (behavior change beyond tests)
   - File: apps/tournament-api/src/engine/games/registry.ts:41-55
   - Confidence: medium
   - Why it matters: `validateSchedule` now rejects any value not divisible by 100 (line 53). This is intentional per Story 2.1a, but it means any existing event/round/foursome configs stored with “even but not whole-dollar” values (e.g., 550) will now fail validation and cause settlement to return `unsettleable` (via `computeFoursome` throwing/validation failing, then caught as `engine_error` in `games-money.ts`). That’s acceptable only if product has a migration or guarantees such configs never existed/never will.
   - Suggested fix: If existing data may contain non-$1 increments, consider (a) a one-time migration to round/convert, (b) grandfathering via configVersion bump + conditional validation, or (c) a clearer surfaced reason path (not just `engine_error`) so organizers can fix configs. Add an integration test demonstrating how an existing pinned round with 550c should behave (explicit reason surfaced).

## Strengths

- `games-money.ts` now calls `ledgerToEdges` inside the try/catch, correctly preventing event-wide crashes from the new fail-closed guard (apps/tournament-api/src/services/games-money.ts lines 411–454).
- The reconstruction guard in `ledgerToEdges` will catch many classes of incorrect edge emission (wrong direction, wrong amount, wrong pairing) by re-deriving per-player nets from the emitted edges.
- Tests and goldens were updated to reflect the new 2-edge canonical representation while keeping per-player nets and ledger totals unchanged (fixtures show totals preserved).
- Validation tightening in `registry.ts` is simple and deterministic, and the updated tests in `game-config-write.test.ts` cover the key regression from the old “even” rule to the new “x100” rule.

## Warnings

None.
