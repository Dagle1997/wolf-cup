# Director-Review Synthesis — F1 "Rules & Games" Epics (2026-06-21)

**Artifact:** `_bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md` (epic structure + Epic 1 stories 1.1–1.4)
**Ensemble:** Codex (gpt-5.2 high) + Gemini (pro, xhigh) initial reviews → cross-critique → this synthesis.
**Toolchain note:** run with the *adapted* toolchain (codex_review.review_code + gemini_general for review; codex_general + gemini_general for cross-critique) because `gemini_review` and codex `critique_review`/`synthesize_reviews` weren't yet loaded this session. Both servers are now installed; the full purpose-built debate is available after a Claude Code restart.

## Unified Verdict: **MINOR-FIXES — but must-fix BEFORE any story implementation**

No code exists yet, so every finding is a *document* fix. They're concrete and fast. The reason this isn't a clean "SHIP" is that several are **fidelity-breaking contradictions** vs the locked PRD/architecture that would cause a dev agent to build the wrong scope, wrong data model, or a silent money-drift bug. Fix them in the epics doc, then proceed. Confidence: HIGH (both models + both critiques converged).

## High-confidence findings (reviewers + critiques agreed)

### MUST-FIX (fidelity / money-safety)
1. **calcCourseHandicap re-derivation on read (money landmine).** Story 1.4's net AC imports `calcCourseHandicap`/`buildTeeByPlayer` "off the effective HI" — that *re-derives* CH on every read, contradicting Story 1.2's pinned-CH rule. If a course rating/slope edits later, finalized money silently drifts. **Fix:** recompute reads the **pinned CH** (`getHandicapStrokes(pinnedCH, …)`); `calcCourseHandicap`/`buildTeeByPlayer` run **only** in the round-start pin path, never in recompute-on-read. *(Codex#4, Gemini#1 — both AGREE.)*
2. **"locked-HI" terminology in Story 1.4.** First AC still says reads "…scores + locked-HI + course-rev" — contradicts the effective-HI (locked OR most-recent GHIN) model; a dev would query the locked table and unlocked players would falsely fail-closed. **Fix:** "pinned **effective-HI + CH** snapshot." *(Codex#3, Gemini#2 — both AGREE.)*
3. **FR10 + FR34 mis-phased to Product B.** PRD leaves FR10 (lock/unlock toggle) and FR34 (money-mode-locked / scores-only-unlocked + signpost) **untagged = Product A**; only FR13/FR14 are tagged (B). **Fix:** FR10 → **E1** (the `lock_state` field already exists; the toggle is organizer-facing Product A); FR34 (both modes + signpost) → **E1**. Keep FR13/FR14 (foursome self-serve edit) in E6. Update coverage map + epic lines. *(Codex#1 CRITICAL, Gemini-critique AGREE.)*
4. **`foursome_game_config` contradicts D2.** Epic 6 names a separate table; D2 mandates ONE polymorphic `game_config` with `level ∈ {event,round,foursome}`. **Fix:** "foursome-**level** `game_config` rows." *(Codex#2, Gemini-critique AGREE.)*
5. **Engine input ambiguity (scores vs net).** Story 1.1 says "per-player scores"; the engine actually consumes per-player **net** (+ par + team split). Gross→net allocation is the service layer (1.4). **Fix:** say "net" explicitly. *(Codex#5, Gemini#5 — AGREE.)*
6. **Round-start pin must be atomic + idempotent (net-new, Codex-critique).** Resolved config + per-player effective-HI + CH + course-rev must be created in **one tx under a unique `round_id` pin** — a PWA retry or second device must not split-brain the snapshot. **Fix:** add to 1.2/1.4 (NFR-D2/R3).

### SHOULD-FIX (correctness clarity)
7. **Goldens assert exact `SettlementEdge[]`, not just totals** — 1.1 asserts per-hole contributions + ledger; the exact `{from,to,cents}` edge array is asserted (1.1 or 1.4) so `ledger-to-edges` rounding/wrong-payee bugs can't slip. *(Gemini#3; Codex-critique PARTIAL.)*
8. **Name the base-Guyan tie/push rule (FR42).** 1.1's fixture must state the explicit tie handling (hole halved → no point / push) — "tie" is otherwise an ambiguous rules hole. *(Gemini#7; Codex-critique AGREE.)*
9. **Minimal non-crashing "unsettleable" surface in E1.** 1.4 surfaces fail-closed but the rich UI is E4; add a minimal "calculation paused — unsettleable: [reason]" state so settle-up doesn't crash/empty-render. Don't conflate missing-score with no-handicap. *(Gemini#4; Codex-critique PARTIAL.)*
10. **Zod forces `modifiers: []` in E1.** 1.2 validates a modifier list but modifiers arrive in E2 — force empty + reject unknown types in E1 so an unsupported config can't silently compute. *(Gemini#5; Codex-critique PARTIAL.)*
11. **FR18 putts no-regression.** Add an E1 AC that the dual-read switch doesn't disable existing putt capture for F1 rounds; list FR18 in E1 as covered-by-no-regression. *(Gemini#6; Codex-critique PARTIAL.)*
12. **Resolver is level-parameterized from day one (Gemini-critique).** Ensure the cascade resolver filters `game_config` by `level` in 1.1/1.3 so adding foursome-level rows in E6 doesn't break it. *(Minor — recompute reads the pinned snapshot, so finalized rounds are unaffected; this is about the live resolver.)*

## Divergent → resolved
- **"Only Epic 1 is storied" (Codex#7 HIGH).** DISMISSED as a defect — we are mid-workflow; Epics 2–6 decomposition is the scheduled next step (Gemini-critique DISAGREE with Codex). *Doc-hygiene:* soften the Overview's "complete epic and story breakdown" to reflect WIP until 2–6 are written.
- **"Presses-OFF is an open item" (Codex#8 LOW).** DISMISSED — Josh ratified presses-OFF this session (Gemini-critique DISAGREE). *Trivial:* annotate "(ratified 2026-06-21)."
- **FR3 9-hole / play-sequence semantics (Codex#6 MEDIUM / Gemini THEORETICAL).** Keep as a minor clarification: 1.1 notes segment→hole mapping uses **course hole number** and handles 9-hole rounds (per PRD FR3).

## Optional / guardrails
- Fence FR13/FR14 out of E2 explicitly (Gemini-critique) so modifier work doesn't drift into player self-serve.

## Prioritized action list
- **must_fix_before_implementation:** 1, 2, 3, 4, 5, 6
- **should_fix:** 7, 8, 9, 10, 11, 12
- **optional/doc-hygiene:** soften "complete" wording; presses-OFF annotation; FR3 9-hole note; FR13/14 fence note
