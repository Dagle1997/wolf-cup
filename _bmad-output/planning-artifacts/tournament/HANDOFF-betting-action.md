# HANDOFF — Tournament "The Action" Betting

**Last updated:** 2026-06-20 · **Author:** Josh (+ Claude facilitation)
**Purpose:** Resume cleanly in a fresh context. Everything below is persisted to disk.

---

## TL;DR — where we are

Full BMAD planning pipeline for a new Tournament feature: a **player-driven + admin-managed in-event betting surface ("The Action"), no odds/Line/house.** PRD → readiness validation → architecture → epics → **stories → final validation → adversarial hardening are ALL DONE.**

**Resume point:** **IMPLEMENTATION.** The next action is to build **Story 1.1**, whose first artifact is the **golden hand-calc fixtures (the hard gate)**, then the `bets` schema. Planning is complete; there is no more BMAD planning step to re-enter.

---

## Artifacts (all under `_bmad-output/planning-artifacts/tournament/`)

| File | Status |
|---|---|
| `prd-betting-action-line.md` | ✅ COMPLETE — 12-step PRD, codex-hardened, **FR1–FR54** |
| `implementation-readiness-report-betting-2026-06-20.md` | ✅ COMPLETE — adversarial triage, READY verdict |
| `architecture-betting-action.md` | ✅ COMPLETE — 8-step solution design, READY / HIGH confidence |
| `epics-betting-action.md` | ✅ **COMPLETE + adversarially hardened** — 5 epics, **16 stories**, all 4 workflow steps done, final validation passed, 14 findings folded in |
| `HANDOFF-betting-action.md` | this file |

Memory: `project_tournament_action_betting_prd.md` (+ MEMORY.md line).

---

## Scope decision (Pete Dye)

**Must-have for the trip = Epics 1 + 2 + 3** (admin floor + player self-serve open book + Snake). **Epics 4 (segmented/Nassau + putting game) and 5 (finalize hardening) are trim-able.** Build order after Story 1.1: rest of Epic 1 → Epic 2 → Epic 3.

## The 16 stories

- **Epic 1 — The Book Floor (7):** 1.1 walking skeleton (kept WHOLE per Josh; recorded 1.1a/1.1b fallback split if it stalls) · 1.2 per-hole match · 1.3 gross basis · 1.4 edit & void · 1.5 Action board · 1.6 settlement robustness + organizer resolve · 1.7 money-visibility tiers *(trim-able)*.
- **Epic 2 — Player Self-Serve (2):** 2.1 player places own bet (open book) · 2.2 self-void/correct + placement cutoff.
- **Epic 3 — Putts + Snake (4):** 3.1 conditional putts entry · 3.2 Snake setup · 3.3 holder + escalation engine (hard-gate fixtures) · 3.4 Snake settlement + live view.
- **Epic 4 — Segmented & Putting Game (2):** 4.1 Nassau · 4.2 putts-basis h2h + Putting Game.
- **Epic 5 — Finalize Hardening (1):** 5.1 reversible finalize-snapshot. *(lowest priority)*

## Locked product decisions

- **Open book:** subjects ≠ stakeholders. Any verified roster member can back a side, playing or not (the "Kyle" case). **Both sides always required; no house; no free-text outsiders.**
- **The Line / odds / house = OUT.**
- **Trust model (MVP):** player-placed bets go live immediately, no acceptance step. Verified propose→accept handshake = Growth.
- **Bet types — MVP:** per-hole match, h2h (net/gross, +Nassau via front/back/total), putting game (total putts), Snake (group 3-putt). Over/under + multi-round = Growth.
- **Snake rules (LOCKED):** first event value = `start + (putts−3)×increment`; subsequent `+= (putts−2)×increment`; same-hole tie → worst putt takes it, then scorer "last in"; no 3-putt = no payout; holder pays each other participant at round end.
- **Bet access gate keys on ROSTER membership, NOT foursome/playing assignment** (Josh: on the trip = on the roster; want to bet = must be on the roster — the Kyle case passes).
- **Pete Dye 2026 is a standard sequential start (NOT a shotgun);** play-sequence is nonetheless an explicit engine input for future shotgun events.

## Locked architecture decisions

- **New `bets` schema** (`bets`, `bet_sides`, `snake_games`, `snake_participants`, `snake_holder_overrides`) — **never extend `individual_bets`** (P14).
- Canonical **`state` enum** `live | provisional | settled | push | void | unsettleable | finalized` — single source of truth (P4); json/timestamp columns are payloads validated against it.
- **Pure recompute-on-read engine** in `engine/bets/` (no db/Date/random).
- **`netForSegment()`** exported from `leaderboard.ts`, reusing `allocateNetThroughHole` — **settlement NEVER re-derives net** (P2). Validated by a separate net-reconciliation test.
- **Net-calc version** stamped on settled outcomes so a later leaderboard fix can't silently re-settle a banked bet (this guard lives in Story 1.1, independent of trim-able Epic 5).
- **Canonical `SettlementEdge {fromPlayerId,toPlayerId,cents,sourceBetId,sourceType}` IR** (P15) — every bet type (incl. Snake) reduces to it; settle-up nets a flat edge list, bet-type-blind.
- **`money_visibility` chokepoint** in `bets-query.ts` (P8). **Audit + activity in same `tx`** (P9); new activity types registered in the activity Zod union.
- **Reversible finalize-snapshot** freezes `finalized_outcome_json` on finalize; organizer un-finalize→correct→re-finalize (MVP, organizer-driven, never auto).
- **Putts:** reuse `hole_scores.putts` (verified exists, nullable; null = not-entered, never 0); `putting-entry.ts` holds logic, `scores.ts` delegates.
- **`hole_scope` = 4-value enum** `front|back|total|full18`; arbitrary hole sets (FR48 generality) DEFERRED.
- **Nassau = parent + 3 children;** parent is a non-settling container (children only); single stake applies to each segment.
- **One new dependency:** `fast-check` (devDep). **PORTS.md** entry for the putts "least putts" port.

---

## ⛔ HARD GATE before any settlement code

**Author + hand-approve the golden hand-calc fixtures** (per bet type + every Snake edge) — build artifact #1, NOT a scaffold. Fixtures take net-per-hole as a given input (hand-calc), independent of `netForSegment` (which is validated by a separate net-reconciliation test). Also required: the `fast-check` ledger-invariant property test (zero-sum pairs net to zero; Snake holder-out = sum of receipts).

## Constraints (non-negotiable)

- **Tournament paths only** (`apps/tournament-api`, `apps/tournament-web`). Wolf Cup is **read-only port-pattern reference** (FD-1/FD-2).
- Conform to `tournament/architecture.md` (services-layer split, recompute-on-read, activity spine, `money_visibility`, join-code identity) and the betting `architecture-betting-action.md` patterns P1–P16.
- Wolf Cup + existing Tournament suites stay green; CI gates deploy.

---

## To resume — IMPLEMENTATION

Start **Story 1.1** in `epics-betting-action.md`:
1. Author + hand-approve the **golden hand-calc fixtures** for h2h-net (the hard gate).
2. Add the `bets` + `bet_sides` schema (incl. the `state` enum) by migration.
3. Build the pure h2h-net engine → `SettlementEdge[]`, `netForSegment()` export, net-reconciliation test.
4. Wire the minimal admin create endpoint + UI → settle-up integration → audit/activity in one tx.

Each story has full Given/When/Then ACs. The **`tournament-director` skill** can drive the build one story at a time (create-story → review → implement → review → commit → mark done).
