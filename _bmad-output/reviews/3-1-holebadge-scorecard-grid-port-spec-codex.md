# Codex Review

- Generated: 2026-06-22T21:26:47.467Z
- Model: gpt-5.2
- Reasoning effort: high
- Workspace root: D:\wolf-cup
- Reviewed files: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md

## Summary

Spec is largely aligned with FD-1/FD-2 and S1 “presentation-only” scope, but there are a few ambiguities and one key type/contract issue that can force accidental “$0” fabrication and/or make tests non-deterministic. Biggest gaps: money field nullability/absence semantics (AC #6), unplayed-hole rendering contract for the Score row/HoleBadge, and incomplete/ambiguous token mapping (mentions potentially-nonexistent tokens and doesn’t enforce “no shadcn aliases remain”).

Overall risk: medium

## Findings

1. [high] AC #6 “never fabricate $0” conflicts with proposed type `moneyNet: number` (cannot represent missing/unknown money)
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:22-40
   - Confidence: high
   - Why it matters: AC #6 requires the $ row to be fixture-driven and to never invent $0 when money is absent/unknown (a 3-3 dependency). But Task 1 hard-codes `moneyNet: number` (line 39), which forces every hole (including unplayed or “money not available yet”) to have a numeric value. In practice, this invites using `0` as a placeholder, which violates AC #6 and will be hard to unwind when live data arrives in 3-3/3-4.
   - Suggested fix: Change `moneyNet` to `moneyNet?: number | null` (or `number | null`) in `ScorecardHole`, and add explicit rendering rules: if `moneyNet == null`, render em-dash (not $0) and exclude from totals. Add a test case where `showMoney` is true but some holes have `moneyNet: null` to enforce the “no fabricated $0” contract.

2. [medium] Unplayed-hole behavior is split across ACs but the component contract is underspecified (HoleBadge vs grid placeholder vs stroke dots)
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:17-47
   - Confidence: high
   - Why it matters: AC #5 says unplayed cells render an em-dash placeholder, yet still show handicap-stroke dots when `relativeStrokes > 0`. Meanwhile Task 2 defines HoleBadge props as `{ gross, par, ... }` (line 42) and AC #1 defines behavior only for computed `d = gross − par`. It’s unclear whether the Score row uses HoleBadge even when `grossScore` is null, or whether the grid renders its own placeholder and overlays dots. Without a clear contract, devs can implement an interpretation that fails parity or makes tests flaky.
   - Suggested fix: Make the contract explicit in ACs/tasks: either (A) HoleBadge accepts `gross: number | null` and renders ‘—’ plus optional stroke/bonus dots when gross is null, OR (B) ScorecardGrid renders the em-dash cell and renders stroke dots independently of HoleBadge for unplayed holes. Update Task 2 prop types accordingly and add one explicit test that asserts the placeholder+stroke-dot behavior for an unplayed hole in the Score row.

3. [medium] Totals rules are ambiguous (especially Par totals and whether Score totals are shown/summed)
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:20-22
   - Confidence: medium
   - Why it matters: AC #4 requires Out/In/Tot column totals; AC #5 states “Par/Net/$ totals sum only played holes.” Par typically does NOT depend on being played; summing only played holes can produce surprising Out/In par totals when back-9 is unplayed but still displayed. Also, it doesn’t state whether the Score row has Out/In/Tot totals (gross totals), and if so whether those totals sum only played holes or require contiguous play.
   - Suggested fix: Clarify per-row totals rules explicitly:
- Par totals: sum all holes shown in that table (or sum only present holes), regardless of played/unplayed.
- Score (gross) totals: either displayed and sum only played holes, or omitted entirely—state which.
- Net totals: sum only played holes.
- $ totals: sum only holes with `moneyNet != null`.
Add tests asserting the chosen behavior (Par totals are the most likely to cause confusion).

4. [medium] Back-9 rendering rule + fixtures are ambiguous (front-only vs “back-9 unplayed” placeholder coverage)
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:20-41
   - Confidence: high
   - Why it matters: AC #4 says render back-9 table “once any back-9 hole is present.” Task 1 also asks for a “partial-front-9 fixture (back-9 unplayed)” used for unplayed-cell tests (line 40). It’s unclear whether “partial-front-9” means holes 10–18 are absent from the array (so no back-9 table, no unplayed placeholders) or present with null scores (so back-9 table appears but is entirely unplayed). This affects both implementation and test expectations.
   - Suggested fix: Define fixtures and render rules explicitly:
- Provide one fixture with only holes 1–9 to assert “front-only render”.
- Provide a second fixture with holes 1–18 where 10–18 have `grossScore: null` (and `relativeStrokes` possibly set) to assert unplayed placeholders (and to clarify whether an all-unplayed back-9 still renders).
Also specify whether holes should be sorted by `holeNumber` defensively.

5. [medium] Token mapping requirement is not fully deterministic; spec suggests tokens that may not exist and doesn’t enforce “no shadcn aliases remain”
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:23-63
   - Confidence: medium
   - Why it matters: AC #7 correctly flags that tournament-web lacks shadcn semantic aliases, but the mapping section uses non-committal language (“e.g. `--color-surface-sunken` or a low-alpha border tint”, line 62) and only enumerates a subset of possible shadcn classes. This invites inconsistent implementations and risks accidentally leaving unsupported classes in the new components (which will silently render wrong).
   - Suggested fix: Make the mapping table exhaustive + exact:
- List every shadcn semantic class present in the referenced Wolf components and specify the exact tournament token to use.
- Add an AC/test/lint-like check: the new component source must not contain any of these substrings: `text-muted-foreground`, `bg-muted`, `text-destructive`, `border-border`, `bg-foreground` (or whichever set is relevant).
- If a “surface” token is needed, name the exact existing CSS var from tournament-web (avoid speculative tokens).

6. [medium] Testability risk: “assert expected shape/role markers” is underspecified and may force brittle className assertions
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:46-47
   - Confidence: high
   - Why it matters: HoleBadge’s visual variants (circle outline vs filled, nested squares) are hard to assert via accessible queries unless you add explicit semantics. If tests are forced to assert Tailwind class strings, they’ll be fragile (small refactors break tests) and may not reliably detect the correct shape variant.
   - Suggested fix: Add deterministic selectors/semantics:
- Add `aria-label` or `data-testid` for variant (`eagle`, `birdie`, `par`, `bogey`, `double`) and for each dot type (`stroke-dot-1/2`, `greenie`, `polie`, `sandie`).
- Then tests can query by label/testid rather than className snapshots.

7. [low] Boundary/isolation: spec warns not to edit Wolf Cup, but doesn’t explicitly forbid importing from `apps/web/**` (cross-app dependency)
   - File: _bmad-output/implementation-artifacts/tournament/3-1-holebadge-scorecard-grid-port.md:53-68
   - Confidence: medium
   - Why it matters: FD-1/FD-2 isolation is primarily about edits, but an accidental import from `apps/web` into tournament-web would also create an undesirable cross-app coupling and could break builds depending on TS path config. The spec currently emphasizes “read-only” but not “no imports.”
   - Suggested fix: Add an explicit constraint/AC: tournament-web components must not import anything from `apps/web/**` (copy logic only). Optionally add a simple grep check in review/CI for `from "@web/"` or `apps/web` in tournament-web sources.

## Strengths

- Clear FD-1/FD-2 guardrails: explicitly forbids edits to `apps/web/**`, `apps/api/**`, `packages/engine/**` and keeps changes under `apps/tournament-web/**` (lines 65–67).
- Scope is well-contained for S1: no API, no route wiring, no money calculation beyond fixture display (lines 13–14, 65–68).
- Acceptance criteria are mostly test-oriented and enumerate key branches (HoleBadge variants, dot cases, front-only vs front+back, showMoney gating, row omissions) (lines 17–25).
- Calls out the real porting hazard (Tailwind v4 present but no shadcn semantic aliases) and requires adapting to CSS var tokens for light/dark correctness (lines 23–24, 59–63).

## Warnings

None.
