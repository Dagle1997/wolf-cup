# HANDOFF — Tournament F1 "Rules & Games" EPICS & STORIES (resume mid-workflow)

**Last updated:** 2026-06-21 · **Author:** Josh (+ Claude facilitation)
**Purpose:** Resume the BMAD `create-epics-and-stories` workflow in a fresh context **after a Claude Code restart**. Supersedes `HANDOFF-f1-rules-games.md` for the epics phase (that one covered PRD+architecture, both COMPLETE).

---

## TL;DR — where we are

Running **`/bmad-bmm-create-epics-and-stories` scoped to F1**, output = **`_bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md`**.

- **Step 1 (requirements inventory): COMPLETE** — 45 FRs + 27 NFRs + architecture additional-requirements extracted.
- **Step 2 (epic design): COMPLETE + approved** — 6 epics, full FR coverage map. (frontmatter `stepsCompleted: ['step-01-validate-prerequisites','step-02-design-epics']`)
- **Step 3 (story creation): IN PROGRESS** — **Epic 1 fully storied (Stories 1.1–1.4), party-mode-reviewed AND director-reviewed (MINOR-FIXES) with all fixes folded in.** **Epics 2–6 still need story decomposition.**
- **Step 4 (final validation): NOT STARTED.**

## ⚠️ WHY THE RESTART — tooling now available (verify after restart)
This session **added MCP review servers** so the full `/director-review` debate works here (previously only `codex_review.review_code` existed):
- **Added `gemini_review`** server → `D:\wolf-cup\scripts\gemini-review-mcp\` (copied from `D:\Claude\2026`), registered in `D:\wolf-cup\.mcp.json`. Exposes `review_code` + `critique_review` + `synthesize_reviews`.
- **Updated `codex_review`** server (`scripts/codex-review-mcp/server.mjs`) to the newer 2026 build that adds `critique_review` + `synthesize_reviews` (old build backed up as `server.mjs.bak-20260621`).
- **Copied the `/director-review` skill** → `D:\wolf-cup\.claude\commands\director-review.md` (5-step debate: parallel reviews → cross-critique → synthesis).
- **After restart, VERIFY** these tools load: `ToolSearch "select:mcp__gemini_review__review_code,mcp__codex_review__critique_review,mcp__codex_review__synthesize_reviews"`. Josh wants `gemini_review` for **UI reviews later** too.

## TO RESUME — next steps, in order
1. **Re-enter the workflow at Step 3.** Read `_bmad/bmm/workflows/3-solutioning/create-epics-and-stories/steps/step-03-create-stories.md` and continue: decompose **Epics 2 → 3 → 4 → 5 → 6** into dependency-ordered stories with Given/When/Then ACs, matching the house style already set by Epic 1's stories (and the sibling `epics-betting-action.md`). Append under the `# Epics & Stories` section.
2. **At/after Step 3, run the FULL `/director-review`** on the complete story set (now that the real tools load) — Josh's discipline is review-every-step. Then **Step 4 final validation** (`step-04-final-validation.md`).
3. **Hard gate downstream:** golden hand-calc fixtures BEFORE any settlement code (NFR-C1). The Epic 1 / Story 1.1 spec already encodes this.

## LOCKED decisions ratified THIS session (do not re-litigate)
- **Presses OFF for F1 events in MVP** (ratified by Josh 2026-06-21; re-home in Product B).
- **Point value editable in Epic 1** — flat **OR** front/back ($5 front/$10 back). Segment→hole mapping by **course hole number**; 9-hole rounds covered. (FR3 moved E2→E1.)
- **Handicap model:** locking as-of-a-date is **OPTIONAL**; if not locked, default to the **most-recent GHIN handicap**. **Always pin the effective HI + computed CH per player at round-start** (atomic + idempotent) so recompute-on-read is deterministic. **Fail-closed ONLY when a player has NO handicap at all** — "unlocked" is the normal path, NOT fail-closed.
- **Per-round HI + CH provenance:** the round durably stores each player's HI **and** CH; opening a past round shows the handicaps the money was computed off. **Recompute reads the pinned CH — never re-derives it from a live HI** (no `calcCourseHandicap`/`buildTeeByPlayer` on the read path; they run only at the round-start pin).
- **FR10 (lock/unlock toggle) + FR34 (leaderboard money/scores modes + signpost) are Product A → Epic 1** (PRD-untagged). Only the *foursome self-serve edit* unlock enables (FR13/FR14) is Product B/Epic 6.
- **Claim-based modifiers + inline claim capture + `hole_claims` table all ship in Epic 2** (beside the resolvers that consume them). Epic 1's base game is **score-derived** (2v2 low-ball + net-birdie), no claims.
- **Engine consumes per-player NET** (+ par + team split), not gross; allocation is the service layer. Team split fed from the shipped `resolveFoursomeTeams`.
- **`game_config` is ONE polymorphic table** (level ∈ event|round|foursome) — no separate `foursome_game_config` (D2).

## NEW scope folded in THIS session — Epic 2 (story it out on resume)
**Wolf Cup variant as a Rules template + cross-validation golden (Josh's idea):**
- The Wolf-Cup preset = the **exact shipped Wolf Cup ruleset**: **double birdie bonus ON, birdie = natural/gross, greenie carryover OFF, sandie = up-and-down for ANY score**, etc.
- **Cross-validation golden:** the F1 engine configured with the Wolf-Cup template, fed the same scores as a real Wolf Cup round, must **reproduce the money the shipped Wolf Cup app produces**. `apps/api` Wolf Cup money rules are **READ-ONLY reference** (FD-1/FD-2) — cross-check output, do NOT import code. Strongest proof of the "same engine, different variant data" thesis. *(When building: extract the exact levers from Wolf Cup `apps/api` money rules to author the fixture.)*
- **Rules Page template picker with LIVE PILLS:** pick a built-in template (Standard Guyan / Wolf-Cup / "345") **or a saved custom one**; on selection the **modifier/variant pills below update live** so the organizer **visually verifies** the rules before play (recognition-not-recall). Organizer can **create + save their own template** (FR6 → FR7).
- **Birdie modifier generalized** to variants **`{net | gross(natural)} × {single | double bonus}`** (E1 ships net/single; E2 adds gross/natural + double — data + one resolver, NFR-X1).

## DIRECTOR-REVIEW (this session) — applied
Verdict **MINOR-FIXES** (Codex gpt-5.2 + Gemini pro, cross-critiqued). All 6 must-fix + 6 should-fix folded into Epic 1 / coverage map / Epic 6. Full findings + critique stances: **`_bmad-output/reviews/synthesis-f1-epics-2026-06-21.md`** (+ `codex-review-f1-epics-2026-06-21.md`). Key fixes applied: pinned-CH-on-read (silent-drift bug), effective-HI terminology, FR10/FR34→Product A, foursome-level rows (D2), engine-consumes-net, atomic pin, exact-SettlementEdge goldens, named tie rule, non-crashing unsettleable surface, empty-modifiers Zod in E1, FR18 no-regression, level-parameterized resolver.

## Epic structure (approved) — for quick reference
- **E1 Rule-Set Spine** (walking skeleton + foundation): seed Standard Guyan, cascade resolves (locked→zero-tap), base 2v2 low-ball + net-birdie settles via pure engine → SettlementEdge → dual-read switch → `games-money.ts` chokepoint → existing pairwise settle-up. Carries goldens/engine/`game_config` schema/pin storage/property tests. Stories 1.1 (fixtures+engine), 1.2 (schema+pin), 1.3 (seed+toggle+point-value), 1.4 (settle+modes). **DONE.**
- **E2 Full Game Vocabulary**: claim capture + `hole_claims`; greenie(carryover)/polie/sandie + variants; birdie variants; cap ("345"); **Wolf-Cup cross-validation golden + template picker UX**; comparison harness. **TO STORY.**
- **E3 Teams & Event Pot**: form teams (manual/random/high-low A/B); event pot; global-team snapshot added to pin. **TO STORY.**
- **E4 Correct/Finalize/Trust**: correction, forward-effective, finalize/un-finalize, finalized-frozen, diff banner, per-hole breakdown, rules summary, handicap-lock reminder (link to shipped H1). **TO STORY.**
- **E5 Migration & Cutover** (highest data-risk, last): backfill gated by E2 harness. **TO STORY.**
- **E6 Per-Foursome Self-Serve & Cross-Group** (Product B): foursome-level config (locks on round start), player "Adjust Guyan Game Rules" UI, cross-group SettlementEdges, self-reported claims. **TO STORY.**

## Constraints (non-negotiable)
- **Tournament paths only** (`apps/tournament-api`, `apps/tournament-web`); Wolf Cup (`apps/api`,`apps/web`) is READ-ONLY reference (FD-1/FD-2).
- Reuse: SettlementEdge IR, slope-aware allocation, `resolveFoursomeTeams`, post-score-commit recompute, `writeAudit`/`emitActivity`, offline queue, design primitives. **Zero new dependencies.**
- Real money → golden fixtures before settlement code; integer cents; recompute-on-read; pure engine; one-tx audit+activity; producer-disjointness; CI green.

## Git / file state (UNCOMMITTED — docs + local config only; nothing pushed, nothing deployed)
- `_bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md` (the work product — Step 1+2 done, Epic 1 storied)
- `_bmad-output/reviews/{codex-review,synthesis}-f1-epics-2026-06-21.md`
- `.mcp.json` (+`gemini_review`), `scripts/gemini-review-mcp/` (new), `scripts/codex-review-mcp/server.mjs` (updated, `.bak` kept), `.claude/commands/director-review.md` (new)
- Nothing committed yet this session. No code written (planning only).
