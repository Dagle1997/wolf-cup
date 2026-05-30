---
title: 'In-Round Batting-Order Correction (scorer-accessible, recalc-on-confirm)'
slug: 'in-round-batting-order-correction'
created: '2026-05-29'
updated: '2026-05-30'
status: 'draft'
stepsCompleted: [1, 2]
tech_stack: ['Hono API', 'Drizzle ORM + libsql/SQLite', 'React 19 + TanStack Router/Query', 'Vitest', 'shadcn/ui + Tailwind v4']
files_to_modify:
  - 'apps/api/src/routes/rounds.ts (PUT batting-order: add full-round recompute + conflict detection)'
  - 'apps/web/src/routes/score-entry-hole.tsx (footer "Change batting order" entry point)'
  - 'apps/web/src/routes/ball-draw.tsx (reuse BattingOrderForm dropdowns for the edit flow)'
  - 'packages/engine/src/wolf.ts (WOLF_TABLE — reused for the conflict diff)'
code_patterns:
  - 'wolf assignment DERIVED from order via WOLF_TABLE (engine/wolf.ts:13-18) — not stored per hole'
  - 'money recomputed full-round from current groups.battingOrder (rounds.ts money breakdown ~L80-170), fires on wolf-decision submit + finalization'
  - 'PUT /rounds/:roundId/groups/:groupId/batting-order exists (rounds.ts:754-857), accepts edits on ACTIVE rounds, validates 4 unique in-group players, NO scores-exist guard, recomputes wolf schedule but NOT money'
test_patterns:
  - 'Vitest with file::memory:?cache=shared for API routes'
---

# Tech-Spec: In-Round Batting-Order Correction

**Created:** 2026-05-29 · **Updated:** 2026-05-30 (design decisions from Josh)

## Motivating Incident

2026-05-29, round 47, Group 1: ball draw entered with slots 3 & 4 swapped (stored
`Matt→Scott→Ronnie→Kyle`, actual draw `Matt→Scott→Kyle→Ronnie`), caught after 4 holes. The
app **locks the ball-draw setup screen once scoring starts**, so there was no in-app path —
fixed by a developer via direct DB edit. Expected frequency: **uncommon, ~3–4×/season.**

## Design Decisions (Josh, 2026-05-30)

- **Access: any active scorer in the round** — NOT admin-gated. Rationale: Wolf Cup is a
  small, trusted, closed league ("with just wolf cup people it's safe"). *Scope: Wolf Cup
  only — do NOT port this open-access model to the Tournament app.*
- **Friction: a couple of clicks.** A footer button → the setup dropdowns → Save → an
  explicit confirm ("This recalculates the whole round for this group"). Guards against
  accidental taps; it's a rare, deliberate action.
- **On confirm: full recompute** of money, handicap allocation, and wolf teams across **all
  holes** for that group. "A lot could be impacted."
- **Placement:** a "Change batting order" button at the **bottom of the score-entry screen**.
  Note: today the practice-round "End" button lives there but official rounds may not show a
  footer action (only admin can end) — this button must be added for **official rounds too**,
  visible to the scorer.

## Problem Statement

1. **No in-UI way to correct a batting order once scoring has started** (setup screen locks).
2. **A reorder is not inherently safe.** Wolf assignment is *derived* from the order
   (`WOLF_TABLE`), so changing the order retroactively changes who was wolf on every hole
   assigned to a moved slot. Money + stableford can be recomputed mechanically, BUT a
   **recorded wolf decision (alone/partner) on an already-played hole belongs to whoever was
   wolf then** — if the reorder makes a *different* player the wolf on that played hole, the
   stored decision is orphaned and the recompute can't invent the right one.
3. **Money/stableford don't auto-refresh on an order change** — the recompute fires on
   wolf-decision submit / finalization. The correction must trigger it explicitly.

## Solution

A **scorer-accessible, recalc-on-confirm** batting-order correction:

1. **Entry point:** "Change batting order" button in the score-entry footer (practice + official).
2. **Edit:** reuse the `BattingOrderForm` position dropdowns (manual selection — **not** the
   randomize button). Pre-filled with the current order.
3. **Confirm + conflict check:** on Save, the API computes which holes' wolf identity changes
   (diff via `WOLF_TABLE`) and intersects with holes that have **any recorded evidence — a
   score OR a wolf decision** (NOT just "fully scored wolf holes" — codex F1):
   - **Clean** (no evidenced hole's wolf changes — the common early-catch case, e.g. today): show
     "Recalculate the round?" → confirm → apply + full recompute. Seamless.
   - **Conflicting** (an evidenced hole's wolf would change): the confirm dialog **names the
     affected holes**, and on confirm the **order-dependent parts** of those holes' decisions
     are reset — the wolf call (`decision`, incl. `blind_wolf`), `partnerPlayerId`, and the
     derived `outcome` (codex F2) — while **order-independent bonuses are PRESERVED**
     (greenies/polies/sandies are keyed to players, not slots — codex F6). The scorer re-enters
     the wolf call for those holes; money recomputes after.
4. **Recompute scope on apply (single transaction):**
   - **Money** — full-round breakdown from the new order (existing path).
   - **Stableford** — re-tally per player (order-independent, but re-run for consistency).
   - **Wolf teams/outcomes** — re-derived per hole from new order + (surviving) decisions.
   - **Handicap** — note: course-handicap strokes are per-player (tee + HI), *order-independent*;
     they're simply re-applied by the recompute. Listed for completeness — nothing order-specific.

## Context for Development (verified 2026-05-29/30)

| Aspect | Location | Note |
| ------ | -------- | ---- |
| Wolf assignment derived from order | `packages/engine/src/wolf.ts:13-18` | s1→{2,6,9,14}, s2→{4,7,10,16}, s3→{5,11,12,17}, s4→{8,13,15,18}; holes 1,3 skins |
| Batting-order save endpoint | `apps/api/src/routes/rounds.ts:754-857` | active rounds OK; validates 4 unique in-group; NO scores guard; recomputes wolf schedule not money |
| Money breakdown (full-round, reads current order) | `rounds.ts` money fn (~80-170) | the recompute to call on apply |
| Stableford recompute | `rounds.ts:1064-1085` | per-player tally |
| Score-entry footer / practice "End" | `apps/web/src/routes/score-entry-hole.tsx` | where the button goes |

## Implementation Plan (Tasks)

- [ ] **Task 1 — Conflict-diff helper (engine, pure + tested).** `(oldOrder, newOrder, scoredHoles) → { changedHoles, conflictingPlayedHoles }` via `WOLF_TABLE`. Test the 3↔4 swap with holes 1–4 played → `conflictingPlayedHoles = []`.
- [ ] **Task 2 — Endpoint: recompute + conflict surfacing.** Extend `PUT …/batting-order`: accept `confirm`/`force` + a group `version`/`updatedAt` (F8 optimistic lock). Return the conflict set (409 if conflicting & not forced). On apply, in **ONE `db.transaction`** (F3 — refactor the money helper to take a `tx`): save order, **reject any `tee` change** (F7), reset order-dependent fields (`decision`/`partnerPlayerId`/`outcome`) on conflicting evidenced holes while preserving bonuses (F2/F6), validate surviving `partnerPlayerId`s resolve in the new order (F5), run full money+stableford+wolf-outcome recompute writing authoritative (overwritten) money (F9), and **assert each group nets to $0 or roll back** (F9). Scorer-callable (entry-code auth, no admin gate). `blind_wolf` treated as order-dependent (F4).
- [ ] **Task 3 — Score-entry footer button + flow.** Add "Change batting order" to the footer (practice + official). Opens the dropdown editor (current order pre-filled), Save → confirm dialog (names affected holes if any) → call Task 2 → invalidate round/leaderboard queries so the corrected rotation shows.
- [ ] **Task 4 — Tests.** Clean reorder recomputes money, stays zero-sum; conflicting reorder lists holes, clears their decisions, recomputes after re-entry; scorer (entry-code) access works; randomize button NOT used in the edit flow.

## Acceptance Criteria

- **AC1** Given an active round with holes scored, when a scorer reorders only slots whose wolf holes are all unplayed and confirms, then the order saves, the round recomputes, and the group's money stays zero-sum — no re-entry needed.
- **AC2** Given a reorder that would change the wolf on an already-played hole, when the scorer confirms, then those holes are named, their wolf decisions are cleared, the scorer is routed to re-enter them, and money recomputes afterward.
- **AC3** Given the score-entry screen on an official round, when a scorer scrolls to the footer, then a "Change batting order" button is present (it is not admin-only).
- **AC4** Given the edit flow, when the scorer changes the order, then they set positions via the dropdowns and an explicit confirm — a single accidental tap cannot rewrite the round.
- **AC5** Given a saved correction, when the leaderboard/score screen refetches, then the corrected wolf rotation + money appear for all holes.

## Open Questions (resolved)

- ~~Admin vs scorer access~~ → **scorer** (Josh, Wolf-Cup-only/trusted).
- ~~Reconciliation policy~~ → **clear conflicting holes' wolf decisions + re-enter** (don't auto-re-point a human call).

## Codex Review — Design Hardening (2026-05-30, gpt-5.2 high)

Pre-build review (`_bmad-output/reviews/codex-review-latest.md`). 9 findings (4 High, 5 Med).
Build MUST satisfy each:

| # | Sev | Finding | Resolution / guard |
|---|-----|---------|--------------------|
| F1 | High | "Conflict" defined only as already-*scored* wolf holes | Define conflict over holes with **a score OR a wolf decision** (folded into Solution §3). |
| F2 | High | Clearing a decision leaves a **stale derived `outcome`** → recompute skips the hole, stale result shows | When resetting a conflicting hole, clear `outcome` (and any derived field) too, not just `decision`. |
| F3 | High | Money recompute helper uses the **global `db`** → escapes any transaction | Refactor the recompute to accept a `tx` handle; the entire save+clear+recompute runs in ONE `db.transaction`. No partial-commit window. |
| F4 | High | `blind_wolf` is **order-sensitive implicitly** | Treat `blind_wolf` as order-dependent in the conflict diff (reset like a normal wolf call on a conflicting hole); add a test. |
| F5 | Med | `partnerPlayerId` not in new order → `indexOf → -1` silent corruption | Validate every surviving decision's `partnerPlayerId` resolves in the new order; reject/flag if not. |
| F6 | Med | Blunt row-clear loses **order-independent bonuses** | Reset only `decision`/`partnerPlayerId`/`outcome`; preserve greenies/polies/sandies (folded into §3). |
| F7 | Med | Same endpoint **accepts `tee` edits** → could rewrite handicaps mid-round | The correction path must **ignore/reject `tee`** — batting order only. |
| F8 | Med | **No optimistic lock** vs concurrent score/decision submits | Add a version/`updatedAt` check on the group; reject stale writes and have the client refetch + retry. |
| F9 | Med | Money totals must be **explicitly overwritten**, not added | Recompute writes authoritative per-player money (upsert/overwrite), and assert **group nets to $0** post-apply (fail the tx otherwise). |

## Implementation status (2026-05-30) — BUILT, codex-reviewed (2 rounds), NOT yet pushed

- **engine** `wolfHoleChanges()` + 5 tests (481 engine tests pass).
- **api** `recalculateMoney` made tx-capable; new `PUT …/batting-order/correct` — all order-dependent
  checks (corrupt-guard, same-4 membership, optimistic lock, conflict detection) run INSIDE one
  `db.transaction` against a fresh read and return the result from the tx (no post-commit recompute);
  5 integration tests (clean / conflict+blind_wolf+bonus-preserve+outcome-clear / stale / no-op /
  roster-reject). Full api suite **522 pass**, web typecheck clean.
- **web** `BattingOrderCorrectionDialog` + footer button on score entry (both round types).
- **Codex implementation review: 2 rounds, all findings fixed.** R1 (6): atomicity, outcome-clear,
  tx-escape, blind_wolf, partner -1, bonuses, tee-edit, lock, money-overwrite. R2 (4): unguarded
  outside parse removed, `corrupt` sentinel mapped, id-type normalization, fromOrder shape. High in
  both rounds resolved.
- **Accepted residual (documented, not fixed):** the SEPARATE wolf-decision-submit handler still
  recomputes+persists money on the global `db` (not a tx), so a decision submit racing a just-committed
  correction could write stale-order money. Window is ~tens of ms and requires two people writing to
  the SAME group simultaneously; the next decision-submit or finalization recomputes correctly. Judged
  acceptable for a trusted 4-person league at ~3–4 corrections/season. Fixing it = make the
  wolf-decision-submit path transactional too (separate, larger change).

## Notes
- Root-cause overlap: the deployed Fisher-Yates fix ([[project_balldraw_biased_shuffle_2026_05_29]]) cuts down *bad random draws*, but human mis-entry still happens — this correction path is still needed.
- A post-apply **zero-sum assertion** (F9) is the cheap safety net — if any reorder path ever leaves money unbalanced, the transaction rolls back rather than shipping corrupt scoring.
- **Deploy posture:** committed on a feature branch; push + deploy after the next round (per Josh), same as the shuffle fix.
