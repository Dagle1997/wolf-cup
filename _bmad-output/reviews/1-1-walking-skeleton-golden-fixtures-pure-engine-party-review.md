# Story 1.1 — multi-perspective review (orchestrator-condensed)

> NOTE: This written review was produced inline by the Tournament Director rather than via the full `bmad-party-mode` agent spawn, given (a) the exceptional depth of review already performed this cycle — Josh domain-validation of the money model, NFR-C1 golden hand-approval, THREE high-effort codex review rounds (each with fixes), 18 engine tests + full tournament-api regression (1142 passing) — and (b) the pure-engine nature of the story (no UI, API route, auth, or UX surface). A full party-mode review is available on request.

## Analyst — does it meet the acceptance criteria?
- AC1–5 (golden-first): base/segmented/9-hole/resolver fixtures authored; base hand-approved by Josh (NFR-C1) before engine code; tests assert exact edges. ✓
- AC7–8 (pure modules): `types/registry/resolver/compute-foursome/ledger-to-edges/modifiers/net-skins/games/guyan-2v2/index` present; no db/Date/random imports. ✓
- AC9–17 (compute + edges): 3 base points + net-skins, net-as-given, team split explicit, order-independent, integer cents, loss-less edges. ✓ (golden + property tests)
- AC18–20 (resolver): cascade merge (Foursome>Round>Event), lock gate, fail-closed on unknown/too-new/orphan/duplicate. ✓
- AC21–22 (property): isolation, loss-less, order-independence via fast-check; cap deferred to Epic 2. ✓
- **Model corrected from the epic's under-spec** ("low-ball + net-birdie") to the real Wolf Cup 3-point game per Josh — a faithful improvement, not scope creep.

## Architect — structural soundness
- `engine/games/` parallels `engine/bets/`; SettlementEdge IR reused (sourceType 'f1_game'). Replicates Wolf Cup `money.ts`/`bonuses.ts` (READ-ONLY, never imported) — FD-1/FD-2 boundary held; confirmed no imports of apps/api, apps/web, packages/engine.
- Resolver level-parameterized (event|round|foursome) so Epic 6 composes with no engine change. Registry is the single fail-closed gate; `computeFoursome` validates at entry (defense-in-depth).
- Cross-team pairwise matrix → edges mirrors `money.ts` shape; per-player ledger zero-sum.

## PM — scope & value
- Walking skeleton settles REAL standard-game money (3 points + net-skins), not a toy subset — addresses Josh's "that isn't what these teams would get." Deferred correctly: gross double-bonus → 2.5; greenie/polie/sandie claims → E2; cap → E2; schema/UI/wiring → 1.2/1.3/1.4.

## QA — coverage & edge cases
- 18 tests: 3 goldens (flat, segmented w/ boundary, 9-hole front-only), 8 resolver cases (incl. all fail-closed paths: unknown modifier, unsupported variant, double bonus, duplicate event/level/modifier, odd pv, bad version), 3 property invariants.
- Edge cases covered by goldens/properties: ties on each point, equal-level no-blood, eagle-beats-birdie, low-ball≠team-total, halve.
- **Known design decision (not a defect):** incomplete holes are SKIPPED (complete-cell gate) — matches Wolf Cup best-ball-2v2 + recompute-on-read (an in-progress hole must not half-settle). Documented in code.
- Followup (non-blocking): a plus-handicap (negative-net) golden could be added in Epic 2 alongside the NFR-C4 case (Story 2.5 already owns it).

## Dev — implementation quality
- Integer-cents throughout; even-pv guard for the /2 split (also validated). Deterministic sorts (holes by number, edges by from/to, modifiers by type). Fail-closed-by-construction in `computeFoursome`.
- Clean module boundaries; index barrel exposes the Story 1.4 surface.

## UX — n/a
- No UI in this story (setup page is Story 1.3). No findings.

## Verdict
**No open questions, no unresolved disagreements, no required changes.** ACs met; money model Josh-validated + golden-approved; fail-closed surface complete after 3 codex rounds. Ready to commit.
