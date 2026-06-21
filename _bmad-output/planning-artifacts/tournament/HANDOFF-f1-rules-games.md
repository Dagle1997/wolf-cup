# HANDOFF — Tournament F1 "Rules & Games" (Guyan real-money engine)

**Last updated:** 2026-06-21 · **Author:** Josh (+ Claude facilitation)
**Purpose:** Resume cleanly in a fresh context. Everything below is on disk + committed to `master`.

---

## TL;DR — where we are

**Planning for F1 is COMPLETE: PRD (12/12) + Architecture (8/8), both committed.** Every step was Party-Mode + Codex (gpt-5.2 high) reviewed; **3 money-safety criticals were caught + fixed** during review. **No F1 code written yet.** Resume point = **epics & stories → golden hand-calc fixtures (hard gate) → build.**

F1 = make the app express a group's real-money golf game. **Greenies/polies/sandies ARE the Guyan game = real cash** (not points, not optional) — the spine under score-entry, leaderboard money, and settle-up. Configurable rule sets cascade Event→Round→Foursome behind a lock toggle.

## Artifacts (read in this order)
1. **PRD:** `_bmad-output/planning-artifacts/tournament/prd-f1-rules-games.md` — 45 FRs (7 areas) + NFRs. The capability contract.
2. **Architecture:** `_bmad-output/planning-artifacts/tournament/architecture-f1-rules-games.md` — decisions D1–D7, 18 patterns + CI gates, file structure, FR→location map, validation = READY.
3. **Backlog:** `_bmad-output/planning-artifacts/tournament/event-setup-ux-backlog.md` — F1 section + the W-series (Wolf-parity in-round UI) + the 2026-06-21 testing items.
4. **Reuse references:** `architecture-betting-action.md` (the shipped SettlementEdge IR to reuse), `brainstorming-session-2026-06-16.md` (the game/modifier model).

## LOCKED architecture decisions (do not re-litigate)
- **D1 — SettlementEdge is the single settlement IR.** `computeFoursome(config, scores+claims) → foursome ledger` that **lowers to edges**; cross-group (B) emits edges directly; the pairwise settle-up is the one consumer (reuse the betting chokepoint). **Per-event dual-read routes EITHER legacy `money.ts` OR the F1 engine — never both.** **D1a producer-ownership matrix:** edges carry namespaced `sourceType` ∈ {f1_game, betting, legacy_2v2, skins} + `sourceId`; producers own disjoint slices (no double-count, invariant-tested).
- **D2 — one polymorphic `game_config(level, ref_id, config_json, seed_rule_set_revision_id?, lock_state?)`** cascade table; **deep-merge, most-specific-wins, lock-gated**; ref validated by level in code; unique (tenant, level, ref_id); config_json Zod-validated; carries a `config_version`.
- **D3 — TWO team concepts:** (a) **intra-foursome 2v2** derived from pairing slots (drives the Guyan game); (b) a dedicated **persistent/global `teams`+`team_members` store** (formation: manual/random/high-low A/B) for member-guest, event pot, cross-group. A global teammate **can** be a foursome-2v2 opponent.
- **D4 — Provenance pinning:** a scored round pins the **RESOLVED config snapshot** (merged cascade — NOT just the seed revision, since overrides are mutable) + seed-rev FK + pairings (append-only) + global-team snapshot + **locked-HI + course-rev/tee**.
- **D5 — Recompute-on-read** over pinned inputs (no stored money); **finalized-frozen = input immutability** (a finalized round recomputes to the same number because its inputs are frozen). Finalize freezes scores/claims.
- **D6 — `hole_claims`** table: upsert by (round, player, hole, claim_type); delete to remove (FR39); `client_event_id` dedup; single-writer scorer; LWW by server seq. **Claims write via the score-entry path** (pattern 15), not a separate screen.
- **D7 — skins (`sub_games`) coexist** as a separate path; F1 doesn't touch skins.
- **Engine** lives at `apps/tournament-api/src/engine/games/` (pure, deps-in, mirrors `engine/bets/`). **Zero new dependencies.** Integer cents, order-independent, golden-fixture-gated.

## TO RESUME — next steps, in order
1. **Epics & stories** — run `/bmad-bmm-create-epics-and-stories` (or the tournament-director) scoped to F1, decomposing the 45 FRs into the **risk-sequenced build order** below. **Story unit = one modifier/game type = one pure resolver + one golden fixture + one story** (pattern 18).
2. **Golden hand-calc fixtures (HARD GATE — first artifact, before any settlement code):** `engine/games/__fixtures__/*.json` for the four mechanics — **Standard Guyan · Wolf Cup variant · Madden's "345" cap ($3/pt, $45 max) · segmented ($5 front/$10 back)** — plus adversarial (greenie carryover→non-par-3, cap-on-boundary, all-push, plus-handicap, segment boundary). Hand-calc the expected money; the engine matches them.
3. **Build, risk-sequenced (Product A):**
   1. Engine `src/engine/games/` (game shape + modifier/game registry + `computeFoursome` + cascade resolver) — golden-gated, no live data.
   2. Schema — `game_config` + `hole_claims` + `teams`/`team_members` + pinning (resolved-config snapshot, global-team snapshot); additive migration.
   3. Admin seed + lock (kills the dead "No rule set" card).
   4. Score + claim capture UI (inline, score-entry path) + recompute-on-read via the single `services/games-money.ts` chokepoint.
   5. Additive dual-read migration + byte-identical money-comparison harness.
   6. Leaderboard mode + per-hole breakdown (also closes W2 leaderboard drill-down).
   7. Team-formation UI.
   - **Product B (after):** per-foursome unlock + cross-group edges.

## OPEN ITEMS
- **Presses for F1 events (Josh to confirm):** presses ride the legacy 2v2; **MVP = presses OFF for F1 events**, re-home in Product B. Flag if you want them solved now.
- **Build-time verifications (not blockers):** confirm `@libsql/client` + Drizzle **single-transaction atomicity** for multi-row money writes (NFR-D2); confirm drizzle-kit additive dual-read migration shape.
- **Docs not yet impacting prod:** F1 is planning only; nothing deployed for F1.

## Git state
- **`master`** carries everything; pushed to `origin/master`. F1 planning commits: `958f58c` (backlog F1-spine), `9069e5a` (PRD complete), `f5561b9` (architecture complete), + this handoff.
- **Also shipped THIS session (code, pushed + DEPLOYED to prod `tournament.dagle.cloud`):** betting Epic 1 (Stories 1.1–1.4 "The Action"), the betting-UI cohesion pass (Button/Card/FormField primitives), event-setup UX quick wins (admin reorder, landing cancelled/past filter, version banner, roster search), and the photo-gallery streamline (camera/library + trip-vs-round). See [[project_tournament_betting_deployed_2026_06_21]].
- **3 untracked files are NOT part of this work — do not commit:** `_bmad-output/scouting-group-aware-money-proposal.md`, `apps/tournament-web/e2e/screenshots.spec.ts`, `reference/Wolf-Cup Updates 6-1-2026.pdf`.

## Constraints (non-negotiable)
- **Tournament paths only** (`apps/tournament-api`, `apps/tournament-web`); Wolf Cup is read-only reference (FD-1/FD-2).
- **Reuse, don't reinvent:** SettlementEdge IR, slope-aware handicap allocation (`getHandicapStrokes`/`allocateNetThroughHole`/`calcCourseHandicap`/`buildTeeByPlayer`), post-score-commit recompute, `writeAudit`/`emitActivity` tx helpers, offline queue, design primitives.
- **Real money → discipline:** golden fixtures before settlement code; integer cents; recompute-on-read; pure engine; one-tx audit+activity; producer-disjointness; CI green (tournament + engine + wolf-cup suites).
