# Story 3-1 — Multi-Perspective Review (party-mode equivalent)

**Story:** 3-1-holebadge-scorecard-grid-port · **Date:** 2026-06-22 · **Verdict:** SHIP (no open questions)

> Per the user's ultracode reshaping of this cycle, the canonical party-mode review was fulfilled by the **4-lens Claude review fan-out** (`story-3-1-review-fanout`, run `wf_969daa6a-311`) run in parallel with the Codex impl review + re-review. The lenses map onto the BMAD party roles and are adversarial (they verified each Codex finding and hunted net-new). This document synthesizes them.

## Perspectives

### Dev / Architect (port-fidelity lens) — MINOR-FIXES → resolved
- HoleBadge notation branches (eagle/birdie/par/bogey/double on `d = gross − par`) match the Wolf reference exactly; bonus dots co-occur; played/unplayed Score handling correct; back-9 table correctly gated on a played hole > 9.
- The two Codex Mediums were adjudicated **faithful-port / defensive-only**, not defects: the `$0`-vs-`0` zero-total format was byte-identical to Wolf (now improved to consistent `0`); the null-net reducer is unreachable under the type invariant + fixtures (deferred to the 3-2 API seam).

### UX (token / visual-parity lens) — PASS
- Zero shadcn semantic aliases remain in the two components; every `var(--color-*)` token referenced exists in `index.css` and flips correctly in `.dark`; badge keeps the real Tailwind palette colors. No token defects.

### QA (test-coverage lens) — MINOR-FIXES → resolved
- Flagged the AC #4 totals (Par/Net/In) + per-hole `0` + rendered dot-count gaps. **All folded in:** +11 tests now pin Par/Net/In totals, the `moneyNet===0 → "0"` path, a non-null zero-sum total, and rendered stroke/bonus dot counts via inert `data-testid` hooks. 404 tests pass.

### PM / Analyst (boundary + completeness lens) — PASS
- No cross-app imports; all six files under `apps/tournament-web/**`; `ScorecardHole` is the correct tournament subset. Completeness critic surfaced three **faithful-to-Wolf, out-of-scope** items recorded as followups (below).

## Followups (deferred — not 3-1 defects)
1. **Null-net reducer hardening (3-2/3-3):** when real API data arrives, enforce `netScore` non-null whenever played (or sum `netScore` only where non-null) so a played-but-null-net hole can't desync the Net total from its `—` cell. Latent only; unreachable in 3-1's fixture-only scope.
2. **Badge accessibility (future a11y story):** the notation + dots are conveyed by color/shape only (faithful to Wolf); a screen reader hears just the gross number. Add an `aria-label` in a future a11y pass.
3. **Duplicate / out-of-range holeNumber (3-2 API seam):** the `holeMap` last-wins on duplicate holeNumbers and tolerates non-1..18 input without validation. Guarantee unique 1..18 upstream when wiring real data.

## Reviews referenced
- `3-1-holebadge-scorecard-grid-port-impl-codex.md` (impl, 0 High / 2 Med / 1 Low)
- `3-1-holebadge-scorecard-grid-port-impl-codex-rereview.md` (post-fix, PASS)
- 4-lens Claude fan-out (run `wf_969daa6a-311`): verdicts MINOR-FIXES / PASS / MINOR-FIXES / PASS, 0 High
