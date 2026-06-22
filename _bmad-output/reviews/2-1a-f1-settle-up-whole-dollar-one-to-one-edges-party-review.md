# Party-Mode Review — Story 2.1a (F1 settle-up whole-dollar 1-to-1 edges)

Non-interactive consolidated review (analyst / architect / pm / qa / dev). No open questions — written artifact for the director cycle (step 8).

**Subject:** `ledgerToEdges` rewritten from a 4-way `pv/2` cross-split to whole-dollar 1-to-1 (slot-paired winner↔loser) legs; point values tightened to whole-dollar (×100); `ledgerToEdges` moved inside `settleFoursome`'s per-foursome try/catch; fail-closed guards added (`invalid_2v2_team_split`, `incomplete_ledger`, `asymmetric_2v2_ledger`, `ledger_total_mismatch`). Per-player nets + ledger totals byte-identical; only the edge decomposition changed.

---

## 📊 Analyst (Mary)

Meets the business intent precisely: the money owner's mental model is "$X game / $2X layout / I pay Tom, you pay Bill," and the change makes the recorded who-pays-whom match that exactly — each loser pays one winner the full per-player amount, no $2.50/$7.50 half-legs. The whole-dollar point-value rule ("nobody plays $2.50 a point") is a sensible domain constraint that closes the remaining half-dollar source. **No requirements gap.** The only adjacent unmet desire is the 1v1 "Action" bets whole-dollar restriction, correctly logged as a separate story (not bundled). **Verdict: meets AC.**

## 🏛️ Architect (Winston)

The change is correctly scoped to the lowering step (`ledger-to-edges`), leaving the cross-matrix math (`compute-foursome`) and per-player/total contract untouched — so the dual-read settle-up, `money-detail`, and leaderboard (all per-player consumers) are unaffected by construction. The exactness rests on a real, verified invariant (the 2v2 cross matrix is symmetric within a team), and the implementation does NOT merely assume it — the reconstruction guard + `ledger_total_mismatch` make the lowering self-verifying and fail-closed, with throws contained per-foursome by the try/catch move (correct blast-radius isolation, mirroring the AC11 pattern). `ledgerToEdges` is explicitly scoped to the symmetric 2v2 ledger; a future non-2v2 game would get its own lowering. **No architectural concern. Verdict: sound.**

## 📋 PM (John)

Right call to sequence this BEFORE greenie so the greenie golden is authored once against the final edge representation — avoids rework and prevents a half-dollar from ever shipping in F1 money. Scope stayed tight (engine + one chokepoint line move + tests; no schema/route/UI). The ×100 tightening is a deliberate, owner-approved behavior change; since F1 is not live (only the $5 seed config exists), no persisted config is stranded, and a hypothetical bad config fails closed (surfaced as unsettleable) rather than mis-settling — acceptable. **Verdict: ship.**

## 🧪 QA (Quinn)

Coverage is strong: 10 dedicated `ledger-to-edges` unit tests (A-up, B-up, push→empty, the old-half-dollar bug case now whole, loss-less reconstruction, + the four fail-closed throws incl. pathological array-like teamSplit and null perPlayerCents); 3 base goldens rewritten with per-player/total **byte-identical** and the new 2-leg edges; the games-money chokepoint covered by the existing disjointness/AC11 isolation tests (which exercise the throw→unsettleable path); `game-config-write` + the cascade fixture updated for the new reason. Full `@tournament/api` regression: 1261 pass / 2 skip; the lone `lifecycle-full.e2e` timeout is the documented full-suite-load flake (passes in isolation, 1.09s) — not a regression. Typecheck + lint clean. **No coverage hole. Verdict: green.**

## 💻 Dev (Amelia)

Implementation is clean and defensive. Guard ordering is correct (team-split validity → per-player completeness → emit → reconstruction → total reconciliation), so no malformed input reaches edge emission. No new division/rounding (uses `perPlayerCents` directly — integer cents preserved). `let ledger` → local `const` inside the try is correct; all code paths return. The four fixtures and two tests touched by the ×100 change were all updated. Reviewed by codex+gemini (spec ×2, impl + cross-critique + synthesis = SHIP, confirming re-review gemini-clean), with should-fix hardening applied. **Verdict: ready to commit.**

---

## Consensus

**SHIP — no blocking findings, no open questions.** Acceptance criteria met (AC1–AC8). Per-player money and ledger totals unchanged; the only behavioral change is the whole-dollar 1-to-1 edge layout + whole-dollar point-value enforcement, both owner-approved. Recommended (non-blocking) follow-up already logged: 1v1 "Action" bets whole-dollar stakes as its own story.
