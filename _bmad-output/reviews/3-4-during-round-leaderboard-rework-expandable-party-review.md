# Party-Mode Review — Story 3-4 (Expandable per-player scorecard on the during-round leaderboard)

**Mode:** non-interactive consolidated written review (no open questions to the user).
**Date:** 2026-06-23 · **Verdict:** SHIP (no blocking concerns; two minor a11y polish followups).

## 📊 Analyst (Mary)
Delivers the brochure-critical surface: the live board now opens any player's Wolf-style hole-by-hole card (notation, stroke/greenie/polie/sandie dots, per-hole Net + $). It WIRES already-built pieces (3-1 components, 3-2/3-3 API) rather than reinventing — minimal new surface for maximal user value. **No concern.**

## 🏛️ Architect (Winston)
Clean composition: a small `RowScorecard` child owns the lazy fetch + the cents→dollars adapter; the route owns expand state. The one real seam — the API returns `moneyNet` in CENTS, the grid renders DOLLARS — is handled explicitly (`/100`, null-preserving, whole-dollar invariant documented and true for F1 Guyan). `showMoney` mirrors 3-3's exposure gate (`mode==='money' && moneyEnabled`), so the board's $ is never wider than the leaderboard. The scorecard fetch uses the runtime `round.id` (verified + regression-tested). FD-1/FD-2 clean: tournament-web only, reuses the ported grid (no fork). **No concern.**

## 📋 PM (John)
All 7 ACs met. Scope held: row-level $ + full sortable weekend standings are correctly deferred to 3-5; cross-round expansion noted as a followup. The brochure p4 (Steve's expanded card) is now capturable once the demo event is locked + the flag is on. **No concern.**

## 🧪 QA (Quinn)
Coverage is strong and targeted: expand/collapse/single-open + aria; the **round.id-not-eventRoundId** guard (asserts the fetch URL); cents→dollars across +$5 / -$20 / 0 / — (all on played holes, matching the grid's played-gate); `showMoney` gating in both money mode and `moneyEnabled=false`; lazy no-fetch-until-expanded; inline 404 unavailable without crashing the board; event-scope non-expandable; and the scope-toggle state reset. The negative-money and push-$0 cases (the money-display footguns) are explicitly exercised. **No coverage hole that blocks.**

## 💻 Dev (Amelia)
Tidy diff, reuses primitives, no dead code. Lazy `enabled`-gated fetch avoids fanning out N scorecards during polling; single-open bounds it to one. The two residual codex Lows (aria-controls references a panel that only exists while expanded — a standard disclosure pattern; `panelId` built from a UUID playerId — a valid HTML id) are acceptable as-is. **Ship it.**

## Consolidated outcome
- **Blocking issues:** none.
- **Minor followups (a11y polish, non-blocking):** disclosure-pattern aria-controls semantics; the pre-existing scope-toggle `role=tablist` keyboard semantics (a T5-5 inheritance, not 3-4 code).
- **Recommendation:** SHIP.
