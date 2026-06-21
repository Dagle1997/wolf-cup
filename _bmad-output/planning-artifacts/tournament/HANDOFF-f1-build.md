---
title: HANDOFF — Tournament F1 "Rules & Games" → BUILD phase (planning COMPLETE)
updated: 2026-06-21
supersedes: HANDOFF-f1-epics.md (epics phase — now COMPLETE)
status: Planning fully complete (PRD + Architecture + Epics/Stories). Ready to build. Nothing built/deployed.
---

# HANDOFF — Tournament F1 "Rules & Games": planning DONE, build NEXT

Self-sufficient resume doc for a fresh context. Read this first, then the epics file.

## TL;DR
All three planning artifacts are **COMPLETE & adversarially hardened**: PRD, Architecture, and now **Epics & Stories (27 stories, 6 epics)**. The epics doc was committed this session (**`cc11650`**, master, **NOT pushed**). **Next = BUILD**, starting at **Story 1.1 (golden hand-calc fixtures + pure engine)**. The non-negotiable hard gate: **golden fixtures authored + hand-approved BEFORE any settlement code merges** (NFR-C1).

## Canonical files (read in this order)
1. **Epics/stories (the build spec):** `_bmad-output/planning-artifacts/tournament/epics-f1-rules-games.md` — 27 stories, dependency-ordered, every AC in Given/When/Then. `stepsCompleted` = all 4. **This is what you build from.**
2. **Architecture:** `_bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md` (decisions D1–D7, 18 patterns).
3. **PRD:** `_bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md` (FR1–FR45 + NFRs).
4. **Reviews trail (this session):** `_bmad-output/reviews/{codex,gemini,synthesis,codex-rereview}-f1-epic{2,3,4,56}-2026-06-21.md`.

## What happened this session (epics phase)
Drafted Epics 2–6 (Epic 1 was already storied), then ran an **automated per-epic gate** (Josh's design): **5-persona party** (PM/Architect/Dev/QA/UX subagents) → **director ensemble** (`codex_review` + `gemini_review` `review_code`, high) → **fold must-fixes** → **codex re-review confirm** → **pause at golden-bearing epics for Josh**. Every epic returned **HOLD** with 8–13 real must-fixes (the party code-verified against shipped `hole_scores`/`offline-queue`/`money.ts`/`team-standings.ts`); each re-review caught 3–4 self-introduced inconsistencies from the fold. Step 4 final validation passed (all 45 FRs mapped, additive-DB-when-needed, dependency-clean).

## RATIFIED decisions (Josh, 2026-06-21 — DO NOT re-litigate)
- **Greenie** = **binary yes/no claim** ("hit green + two-putt" is NOT automatable → scorer just marks it, accepted-as-entered per FR16). Only config lever = **carryover on/off**. Carryover is **par-3s only**, rolls to the **next par-3** (skips non-par-3 holes), **accumulates** (2 unclaimed → 3rd par-3 worth 3 pts).
- **Sandie** = **GROSS** up-and-down; variant `{par_or_better (default) | any_score}` (Wolf's any-score is the unusual one).
- **Birdie** generalized IN PLACE (keep modifier `type` = `net-birdie`): `{basis:net|gross} × {bonus:single|double}`; `config_version` bump + legacy→`{net,single}` default; **byte-identical re-run of the Epic-1 golden** is the regression gate.
- **Cap "345"** = **per-game-instance**, binds the **2v2 game ONLY** ($45) — NOT a player's other games (1v1/event-pot); never a cross-game aggregate.
- **FR2 authoring** = **event-level in E2** (Story 2.7 pills are interactive toggles writing event-level `game_config`); per-foursome self-serve stays E6.
- **Event pot** = **per-player buy-in, winner-take-all, 2-man teams (MVP)**; **reuses the shipped `computeTeamStandings`/`computeFoursomeResults`** for cross-round aggregation (the F1 per-foursome engine can't aggregate across rounds); aggregation in the **service layer**, resolver stays pure; producer-disjoint from the 2v2; reads the **pinned** snapshot. E3 story order: **3.3 pin-by-value BEFORE 3.4 pot**.
- **Story 3.5** (Josh-added) = buy-in payment tracker (paid/unpaid checklist, **operational-only, no settlement coupling**) + **pot-total-at-stake on the leaderboard** for excitement; paid status is organizer+player-private (no public shame list), aggregate `N/M` shown.
- **Forward-effective (FR31, Story 4.3) = DEFERRED to post-MVP** — no real use case with a locked-in game; front-$5/back-$10 is a **setup-time** `pointValue-schedule` (Story 1.1), Nassau is **betting** ("The Action"); **correction (4.2) + audit log covers error-fixing**.
- **Finalize** = additive `ADD COLUMN` on `rounds` (Zod, not CHECK — T13-4); one canonical **`assertNotFinalized(roundId,tx)`** predicate every round-scoped write path calls; **refusal scoped to round-re-pinning edits only** — global team/event-config edits stay ALLOWED (inert on the by-value pin). Correction captures pre-edges **in-tx** for the diff (recompute-on-read has no stored "before").
- **Migration routing** = additive **`cutover_state`** column on `game_config` (`native`|`staged`|`active`); router check is **row-exists AND `cutover_state ∈ {native, active}`** (amends the Story 1.3 "sole check"). Backfill writes `staged`; cutover flips to `active`. Backfill **fail-closes on presses** (presses-bearing legacy events can't be byte-identical under presses-OFF F1).
- **Self-report claims (E6)** = **idempotent upsert on the existing cell-unique** (2.1 NOT amended): claim identity = the FACT, writer = provenance; scorer-already-marked → no-op, unmarked → insert.
- **Cross-group (E6)** = dedicated **`sourceType: 'f1_cross_group'`** (NOT shared `f1_game`); reads **finalized** per-player results (no input double-consumption); producer-disjointness keys on `(debtor,creditor,sourceType,sourceId)`.
- **Presses OFF for F1 events in MVP — RATIFIED.**

## Epic / story map (build order)
- **E1 Rule-Set Spine** (walking skeleton): **1.1** golden fixtures + pure engine (base 2v2 low-ball + net-birdie) · **1.2** `game_config` + provenance-pin schema · **1.3** seed Standard Guyan + lock toggle + point-value · **1.4** settle into pairwise settle-up (dual-read + chokepoint + money mode). *1.1 & 1.4 carry fallback split notes (1.1a/b, 1.4a/b) if they stall.*
- **E2 Full Vocabulary:** 2.1 claims (`hole_claims` + inline capture) · 2.2 greenie · 2.3 polie · 2.4 sandie · 2.5 birdie variants · 2.6 cap · 2.7 template picker + FR2 authoring · 2.8 comparison harness + Wolf-Cup cross-validation golden.
- **E3 Teams & Pot:** 3.1 teams + formation · 3.2 round override · 3.3 pin-by-value · 3.4 event pot · 3.5 buy-in tracker.
- **E4 Correct/Finalize/Trust:** 4.1 finalize/un-finalize · 4.2 correction + diff · **4.3 DEFERRED** · 4.4 per-hole breakdown · 4.5 rules summary + lock reminder.
- **E5 Migration** (last; possibly speculative — see Open): 5.1 backfill · 5.2 cutover gate.
- **E6 Product B** (Growth): 6.1 foursome self-serve · 6.2 self-report claims · 6.3 cross-group (golden-bearing).

## Build constraints (non-negotiable)
- **Tournament paths ONLY** (`apps/tournament-api`, `apps/tournament-web`); Wolf Cup (`apps/api`, `apps/web`) is **READ-ONLY reference** (FD-1/FD-2). The Wolf-Cup cross-validation golden cross-checks **output** (a frozen checked-in fixture) — never imports Wolf Cup code.
- **Golden hand-calc fixtures FIRST** (NFR-C1, CI-enforced). Integer cents, pure functions, order-independent (stable sorts). One modifier/game = one resolver + one golden + one story (pattern 18).
- **Additive migrations only** (`CREATE TABLE`/`ADD COLUMN`, statement-breakpoints, `ecosystemColumns()`, **no CHECK-driven rebuilds** — T13-4); enums validated in Zod.
- **Reuse the shipped seams:** SettlementEdge IR + betting chokepoint, slope-aware allocation (`getHandicapStrokes`/`allocateNetThroughHole`/`calcCourseHandicap`/`buildTeeByPlayer`), `resolveFoursomeTeams`, `computeTeamStandings`/`computeFoursomeResults`, post-score-commit recompute, `writeAudit`/`emitActivity`, the offline queue, design primitives + `ScrollableTable`. **Zero new dependencies** (`fast-check` already present).
- **Pin model:** pin the **resolved-config snapshot + per-player effective-HI & computed CH + course-rev + pairings + team composition** at the round's `in_progress` transition (atomic + idempotent); recompute reads the **pinned CH**, never re-derives from a live HI. Money = recompute-on-read (no stored money).

## How to run the build (recommended)
- Use the **`tournament-director`** skill / "run tournament director" — it runs one BMAD story cycle (create-story → codex-review spec → implement → codex-review impl → party review → commit → mark done) and picks the next backlog story. Start it on **Story 1.1**.
- Or invoke `/bmad-bmm-create-story` for 1.1, then `/bmad-bmm-dev-story`.
- The session-tested **gate pipeline** (party subagents + `codex_review`/`gemini_review` ensemble + fold + re-review) is available if you want the same rigor on the build diffs.

## Tooling notes
- Review MCP servers verified working this session: `codex_review` + `gemini_review` (`review_code` / `critique_review` / `synthesize_reviews`). After any restart, re-confirm they load via `ToolSearch "select:mcp__gemini_review__review_code,mcp__codex_review__review_code"`.
- **GOTCHA:** the epics file is **>100KB** → the director MCP truncates at `max_chars_per_file: 100000`. To review a later section, **extract it to a temp file** (e.g. `sed -n '1,188p' + the target epic`) and point the reviewer at that. Cross-critique stages were skipped each epic (codex+gemini never disagreed materially).
- `.mcp.json`, `scripts/gemini-review-mcp/`, `scripts/codex-review-mcp/server.mjs` are this session's tooling changes — **uncommitted**, in the shared working tree.

## Git / file state
- **Committed `cc11650` (master, NOT pushed):** `epics-f1-rules-games.md`, `HANDOFF-f1-epics.md`, + 15 `*f1-epic*` review files (17 files, 2204 insertions). Planning-only — **no app code, nothing deployed.**
- **Shared working tree — another instance has uncommitted changes** (`.mcp.json`, `scripts/codex-review-mcp/server.mjs` modified; `scripts/gemini-review-mcp/`, `apps/tournament-web/e2e/screenshots.spec.ts`, `_bmad-output/scouting-group-aware-money-proposal.md`, the Pete Dye PDF, the `.bak` untracked). **When you commit, stage F1 paths EXPLICITLY — never `git add -A`.**
- This handoff (`HANDOFF-f1-build.md`) committed alongside (see the follow-up commit).

## Open / non-blocking (flag to Josh at build time)
1. **Epic 5 may be speculative** — Tournament has run **no real-money rounds yet**, so there may be no legacy event to migrate. E5 is sequenced last and is pure insurance; consider dropping it from MVP if no legacy event materializes.
2. **Epic 6 / Story 6.3** cross-group `SettlementEdge[]` golden is a **build-time hand-calc Josh signs off** (Product B — not near-term).
3. **Golden-bearing stories** (hand-calc math Josh approves at build): 1.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 3.4, 6.3.

## Memory pointers
- [[project_tournament_f1_epics_in_progress]] (now marked COMPLETE — gate progress + ratified decisions)
- [[project_tournament_f1_planning_complete_2026_06_21]] (PRD + architecture)
