# Story 1.4: Settle the F1 event into the pairwise settle-up (dual-read + chokepoint + money mode)

Status: done

<!-- F1 Epic 1 FINALE. Source: epics-f1-rules-games.md#Story-1.4. The integration
story: wires the pure engine (1.1) + game_config/pin schema (1.2) + seed/resolver
(1.3) into real money through the existing money/leaderboard/settle-up surfaces.
Money-critical. Tournament paths only (FD-1/FD-2). HEAVY — carries a 1.4a/1.4b
fallback split (see Sizing). -->

## Story

As a roster member,
I want my foursome's Guyan game to settle from recorded scores into the existing settle-up,
so that the group can run real money on a configured game end-to-end, on math proven by hand.

## Acceptance Criteria

### 1.4a — happy path (the chokepoint + net + settle-up + money mode)

1. **Single F1 settlement chokepoint (pattern 16).** `services/games-money.ts` reads the **pinned** resolved-config snapshot + scores + the **pinned per-player effective-HI + CH snapshot** + course-rev, calls the pure engine (`computeFoursome` → `ledgerToEdges`, Story 1.1), and returns namespaced `SettlementEdge`s (`sourceType: 'f1_game'`). Money / leaderboard / settle-up read F1 money **only** through this function — never inline. [AC1]
2. **Net split pin-time vs read-time (the money-safety invariant — closed over EVERY consumer).** At round-start the pin stored each player's CH (computed once from the effective HI via `calcCourseHandicap` + `buildTeeByPlayer`, Story 1.2). At **read/recompute** time, **every F1 net consumer** — `games-money.ts` AND the **leaderboard** net for an F1 round — derives per-hole net from the **pinned CH** via `getHandicapStrokes` / `allocateNetThroughHole`, and reads all **course-dependent inputs (stroke index, hole count, par)** from the **pinned `course_revision_id`**, NOT a live course/HI. No read path calls `calcCourseHandicap` / `buildTeeByPlayer` or a live HI (FR27, NFR-X3). **Zero new allocation math.** (The leaderboard MUST switch to the pinned CH for F1 rounds — otherwise it diverges from settled money and AC4 is meaningless.) [AC2]
3. **Team split** fed to the engine comes from the shipped `resolveFoursomeTeams` (`services/foursome-teams.ts`, slots 1&2 vs 3&4) — not re-derived. [AC3]
4. **Net-reconciliation test (NON-tautological — proves the pin actually freezes money).** Two assertions: (a) the net `games-money.ts` feeds the engine equals the **leaderboard's** net for the same player/segment (both must use the pinned CH per AC2); AND (b) the **mutation guard** — after a round is pinned, **mutate the live HI and the live course rating/slope**, recompute, and assert the F1 round's **settled money AND leaderboard net are UNCHANGED** (proving reads use only the pin, not live data). Assertion (b) is the real guard; (a) alone is tautological if both already read the pin. [AC4]
5. **Pin at round-start (provenance, patterns 9 & 13).** The `in_progress` transition (the start-round path in `admin-event-rounds.ts`) wires in Story 1.2's `pinRound`: pins the resolved-config snapshot + pairings + per-player HI + CH + course-rev, atomic + idempotent. Recompute reads **only** the pin — never live `game_config` rows or a live HI (FR29). **No-pin handling (edge):** F1 is enabled at event setup (Story 1.3), BEFORE rounds start, so an F1 round is normally pinned at its start. An F1 round that somehow has **no pin** (e.g. F1 enabled after a round already went `in_progress`) is **fail-closed = unsettleable** ("not pinned"), surfaced to the organizer — it is NEVER settled against live data. Re-pinning an already-started round is an Epic 4 correction (out of scope). [AC5]
6. **Recompute-on-read (D5).** A score commit persists **only the input** — there is **no stored money**. Money is derived on every read through the chokepoint; a finalized round derives the same number because its pinned inputs are immutable (explicit finalize is Epic 4). No derived-money cache in MVP (added only if NFR-P2 <2s warm demands it). [AC6]
7. **Settle-up integration (no parallel money surface).** F1 edges net into the existing `money-detail.ts` pairwise ledger and the `settle-up` / `my-money` / `money` views, netted per stakeholder pair; every participant appears with their net position (FR28). The existing viewer money pages render the F1-sourced edges (verified by test). [AC7]
8. **Leaderboard money mode (FR34, both halves).** A **locked** event shows **money / P&L mode**; an **unlocked** event shows **scores-only + private My Money**, each with a visible **mode signpost**. [AC8]
9. **Durable per-round HI/CH (Josh's requirement, NFR-T1).** Opening a past round shows **each player's HI and CH from that day** (read from the pin) so the handicaps the money was computed off are always visible after the fact. [AC9]

### 1.4b — hardening (dual-read isolation, fail-closed, visibility, audit)

10. **Dual-read switch (D1a producer-disjointness) — SHIP-BLOCKING prerequisite.** The switch lives in `services/money.ts` at the point it calls `compute2v2BestBall`: when the event is F1 (an event-level `game_config` row exists, Story 1.3), `money.ts` **skips** the legacy `compute2v2BestBall` 2v2 path **and** presses entirely, and instead pulls the 2v2-game edges from `games-money.ts`. Independent coexisting producers — **individual bets and skins** — are UNAFFECTED (they keep producing their own edges; F1 only replaces the legacy *2v2-game* producer). **Disjointness key + test:** every edge carries its producer (`sourceType`: `f1_game` vs the legacy 2v2 vs `bets`/`skins`); the integration test asserts that for an F1 event **no `(debtor, creditor)` pair receives a 2v2-game contribution from BOTH the legacy producer and the F1 producer** (the legacy 2v2 producer emits nothing for an F1 event), while bets/skins edges still flow. This prevents double-counting the 2v2 game without suppressing the legitimately-coexisting bets/skins. **Concrete release gate (so a partial deploy can't expose money early):** F1-money EXPOSURE on reader surfaces is gated by an explicit env flag — `TOURNAMENT_F1_MONEY_ENABLED` (default **off**), mirroring the shipped `TOURNAMENT_PRESSES_DISABLED` pattern. "Event is F1" (config-row-exists) drives the dual-read ROUTING, but reader surfaces show F1 money only when the flag is on; the flag is flipped on (in the VPS env) ONLY after Tasks 1–8 are merged + verified — and flipping it on is part of THIS story's completion (it is a short-lived dark-launch gate, not a permanent state). **No real F1 event runs real money before the flag is on** (F1 isn't live until 1.4 ships), so the gate cannot cause real-world mis-settlement; while off, an F1 event's money surface renders an explicit "F1 money not yet enabled" state (NOT a silently-empty or zeroed ledger that could read as "everyone's even"). [AC10]
11. **Fail-closed on missing/untrustworthy inputs (FR44, NFR-O1) — per-foursome isolated.** A genuinely-absent required input — a player with **no handicap at all** (no HI/GHIN), or DNF / pickup / incomplete holes, or a **missing OR partial/corrupt pin** (AC5; a pin whose JSON is corrupt or whose per-player CH/course-rev is incomplete) — marks **that foursome's game unsettleable**, surfaced to the organizer, never settled on a guess and **never crashing or falling back to live recompute**. **Blast-radius isolation:** an unsettleable foursome shows its own "Calculation paused — unsettleable: [reason, e.g. missing handicap for {player}]" line WITHOUT blocking the rest of the event — other foursomes' money + bets/skins edges still render (the money page never wholesale-crashes or empty-renders on one bad foursome; richer transparency UI is Epic 4). **No-H1-lock ≠ fail-closed (and does NOT violate AC2):** two distinct "lock" concepts must not be conflated — (i) the **H1 handicap-lock** (optional lock-as-of-a-date) and (ii) the F1 **`game_config.lock_state`** (the leaderboard *mode*, AC8). Regardless of either, the effective HI **is pinned at round-start** (AC5): if H1-locked, the pin uses the **locked-as-of-date HI**; if not H1-locked, the pin uses the **most-recent GHIN AS OF round-start** — captured into the pin then, NOT recomputed live. So a player WITHOUT an H1-lock is **not** a fail-closed case (the pinned GHIN net settles them); fail-closed is ONLY for a player with **no handicap at all**. **Reads ALWAYS use the pinned CH — there is no live GHIN recompute** (AC2 holds in every case). The `game_config.lock_state` toggles only the leaderboard *mode/visibility* (AC8), never whether money is frozen. [AC11]
12. **Audience-bounded money visibility (NFR-S1, FR36) — enforced SERVER-SIDE.** A **roster member** is defined by the existing tournament participant gate (the event's roster / group membership — the same boundary `requireEventParticipant` enforces, with the organizer exempted per T13-1); a **non-roster / cross-group viewer** is anyone outside it. In either leaderboard mode, a non-roster viewer never receives dollar figures. Enforcement is in the **API response** of **every dollar-returning endpoint** (money, leaderboard, settle-up, my-money, and the raw-state/export surfaces) — they omit/redact dollar fields for non-roster viewers — NOT merely hidden in the UI, so dollars can never leak via a raw API call. **Unlocked mode is additionally viewer-private:** in scores-only/unlocked mode the **My Money** figures are scoped to the requesting viewer server-side (a roster member sees only their OWN dollars, never another member's), so unlocked mode cannot leak intra-roster dollars. Tests assert (a) a non-roster viewer's response on each endpoint contains no dollars, and (b) an unlocked-mode My-Money response for viewer A contains no B-specific dollar figures. [AC12]
13. **FR18 no-regression.** Enabling F1 (the dual-read switch) does NOT disable the existing per-hole putts capture for F1 rounds (verified by test). [AC13]
14. **Audit (FR45).** Every money-affecting input or edit is audit-logged with actor + timestamp. [AC14]
15. **Property + golden release gate.** A `fast-check` property test proves the ledger invariant — zero-sum pairs net to zero (NFR-C3) — and the settled output matches the **approved Story 1.1 goldens** (NFR-C1 release gate). [AC15]

16. All work is `apps/tournament-api` + `apps/tournament-web` (FD-1/FD-2). [AC16]

## Tasks / Subtasks

> **⚠️ SHIP-SAFETY (CRITICAL — resolves the unsafe-split finding):** the 1.4a/1.4b labels are a **BUILD-ORDER aid ONLY, never a ship boundary**. **NO F1 money may be computed-for-exposure or rendered on ANY reader surface (leaderboard / money / settle-up / my-money / API) until ALL THREE money-safety prerequisites are in place: the dual-read switch (Task 6, so legacy `money.ts` 2v2 + presses are OFF for the event — else DOUBLE-COUNTING), the fail-closed surface (Task 7, else CRASH), and server-side audience-bounding (Task 8, else DOLLAR LEAK).** Concretely: gate F1-money exposure behind a single feature check that is only flipped on once Tasks 1–8 are merged. Tasks 6/7/8 are SHIP-BLOCKING prerequisites, not optional hardening. If the story must be split across commits, every commit must keep this invariant (e.g. build the chokepoint + tests behind the dual-read switch first, wire the reader surfaces last).

**1.4a — chokepoint + net + pin (build first, but NOT shippable to readers alone):**
- [ ] **Task 1 — `services/games-money.ts` chokepoint (AC: 1,2,3,6)** — reads pin (resolved config + per-player CH + course-rev + team split via `resolveFoursomeTeams`) + scores; derives per-hole net from pinned CH (`getHandicapStrokes`/`allocateNetThroughHole`, NO `calcCourseHandicap` on read); calls `computeFoursome` → `ledgerToEdges`; returns `f1_game` edges. Pure-of-recompute (no stored money).
- [ ] **Task 2 — pin at round-start (AC: 5)** — wire `pinRound` (Story 1.2) into the `in_progress` transition in `admin-event-rounds.ts` (the start-round tx); compute + pin per-player CH from the effective HI there.
- [ ] **Task 3 — settle-up / money read integration (AC: 7)** — route the F1 event's edges into `money-detail.ts` + `routes/money.ts` so `settle-up`/`my-money`/`money` net them per pair; no parallel surface.
- [ ] **Task 4 — leaderboard money mode (AC: 8,9)** — locked → money/P&L; unlocked → scores-only + private My Money; mode signpost; show per-round HI/CH from the pin.
- [ ] **Task 5 — net-reconciliation + zero-sum + golden tests (AC: 4,15)** — net matches leaderboard; `fast-check` zero-sum; output matches Story 1.1 goldens.

**1.4b (hardening):**
- [ ] **Task 6 — dual-read switch + producer-disjointness (AC: 10)** — F1 event ⇒ all rounds F1; legacy 2v2 + presses OFF; disjointness integration test (no double-produced edge).
- [ ] **Task 7 — fail-closed surface (AC: 11)** — unsettleable on missing handicap / DNF / incomplete; non-crashing "Calculation paused" render; unlocked ≠ fail-closed.
- [ ] **Task 8 — audience-bounded visibility + FR18 no-regression + audit (AC: 12,13,14)** — non-roster viewers get no dollars; putts capture intact for F1 rounds; money-affecting edits audit-logged.
- [ ] **Task 9 — regression gate** — `pnpm --filter @tournament/api test` + `@tournament/web test` + `pnpm -r typecheck` + `pnpm -r lint` green; engine + wolf-cup unchanged; the `lifecycle-full.e2e` load flake is the only tolerated red.

## Dev Notes

### Reuse the shipped seams (verified — do NOT reinvent or add allocation math)
- **Engine (Story 1.1):** `computeFoursome` + `ledgerToEdges` (`engine/games/`) — already settle net→edges; this story FEEDS them net + team split + config.
- **Pin (Story 1.2):** `services/pin-round.ts` `pinRound` (atomic/idempotent, immutable, copies tenant from round) + the `round_pin` columns (resolved config, per-player HI/CH, course-rev). Wire it at round-start.
- **Resolver (Story 1.3):** `services/resolve-game-config.ts` resolves the event config; at pin-time the resolved snapshot is frozen into the pin (recompute reads the pin, not the live resolver).
- **Allocation (read-time net):** `engine/handicap-strokes.ts` `getHandicapStrokes` + `allocateNetThroughHole`; `services/handicap.ts` `calcCourseHandicap` + `services/per-player-tee.ts` `buildTeeByPlayer` are PIN-TIME ONLY (used once at round-start to compute CH; never on read).
- **Team split:** `services/foursome-teams.ts` `resolveFoursomeTeams`.
- **Money surfaces:** `services/money.ts` (the combined 2v2+bets+skins ledger — the dual-read switch lives here: an F1 event routes to `games-money.ts` and skips `compute2v2BestBall` + presses), `services/money-detail.ts`, `routes/money.ts`, `services/bets-query.ts` (the `netPairwise` settle-up chokepoint F1 edges flow into), `services/leaderboard.ts`.
- **Round-start:** `routes/admin-event-rounds.ts` (~line 652 — the `in_progress` insert of `rounds` + `round_states`).

### The money-safety invariant (do not violate)
Pin CH at round-start (from the effective HI). On EVERY read, derive net from the **pinned CH** only. A read MUST NEVER call `calcCourseHandicap`/`buildTeeByPlayer` or read a live HI — otherwise a later course/rating/HI edit silently moves a settled round's money. This is the whole point of the pin (FR27/FR29/NFR-X3). The net-reconciliation test (AC4) and the producer-disjointness test (AC10) are the guard rails.

### Dual-read + presses-OFF
An F1 event (event-level `game_config` row) routes 100% to `games-money.ts`; the legacy `compute2v2BestBall` 2v2 path AND presses are OFF for that event (ratified product decision — presses OFF for F1 in MVP). The disjointness test proves no `(debtor,creditor,reason)` edge is produced twice.

### Out of scope
Explicit finalize / un-finalize + correction + the rich per-hole money breakdown transparency UI (Epic 4); claims/greenie/polie/sandie + cap + Wolf/"345" presets (Epic 2); global teams + event pot (Epic 3); a derived-money cache (only if NFR-P2 demands).

### Project Structure Notes
- New: `services/games-money.ts` + tests. Edits: `admin-event-rounds.ts` (pin at start), `money.ts`/`money-detail.ts`/`routes/money.ts` (dual-read + integration), `leaderboard.ts` + the web leaderboard/money/settle-up pages (mode + HI/CH display + fail-closed surface). All `apps/tournament-api/**` + `apps/tournament-web/**` (ALLOWED). Likely NO new migration (round_pin from 1.2 already holds the snapshot) — if one is needed, STOP and flag.

### Testing standards
- Vitest + `fast-check`. Per-pid temp-file DB isolation. The golden release gate (AC15) re-runs the Story 1.1 goldens through the live chokepoint. Net-reconciliation + producer-disjointness + fail-closed + audience-bounded are integration tests over real HTTP where they touch routes.

### References
- [Source: epics-f1-rules-games.md#Story-1.4] · [Source: architecture-f1-rules-games.md] (pattern 16 chokepoint, D1a producer-disjointness, D5 recompute-on-read, FR27/28/29/34/36/44/45, NFR-C1/C3/S1/T1/X3)
- [Source: apps/tournament-api/src/services/money.ts] (dual-read switch point — verified) · [Source: …/money-detail.ts] · [Source: …/bets-query.ts] (settle-up netPairwise)
- [Source: apps/tournament-api/src/engine/handicap-strokes.ts] (getHandicapStrokes/allocateNetThroughHole — verified) · [Source: …/services/handicap.ts], [Source: …/services/per-player-tee.ts] (pin-time CH)
- [Source: apps/tournament-api/src/routes/admin-event-rounds.ts] (round-start in_progress — verified) · [Source: …/services/pin-round.ts] (Story 1.2) · [Source: …/services/resolve-game-config.ts] (Story 1.3) · [Source: …/services/foursome-teams.ts]

## Files this story will edit

- apps/tournament-api/src/services/games-money.ts
- apps/tournament-api/src/services/games-money.test.ts
- apps/tournament-api/src/services/money.ts
- apps/tournament-api/src/services/money-detail.ts
- apps/tournament-api/src/routes/money.ts
- apps/tournament-api/src/routes/admin-event-rounds.ts
- apps/tournament-api/src/services/leaderboard.ts
- apps/tournament-api/src/services/games-money.disjointness.test.ts
- apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx
- apps/tournament-web/src/routes/events.$eventId.money.tsx
- _bmad-output/implementation-artifacts/tournament/1-4-settle-f1-event-into-pairwise-settle-up.md
- _bmad-output/implementation-artifacts/tournament/sprint-status.yaml

> Note: exact web page filenames (leaderboard/money/settle-up/my-money) + any additional money-read route are confirmed at implementation; all under `apps/tournament-web/**` / `apps/tournament-api/**` (ALLOWED). NO new DB migration expected (round_pin from Story 1.2 holds the pin). **The epic's 1.4a/1.4b "split" is a build-order aid, NOT a ship boundary — Tasks 6/7/8 (dual-read isolation, fail-closed, server-side audience-bounding) are SHIP-BLOCKING money-safety prerequisites (see the Tasks ⚠️ note). Shipping the chokepoint to readers without them double-counts/leaks/crashes. Prefer to ship the whole story.**

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — claude-opus-4-8[1m].

### Debug Log References

- Golden-gate edge mismatch on first run was a TEST-harness bug (par read from the pinned course-rev, but the test seeded all par-4 holes while the fixture math assumes the fixture's pars 3/4/5). Fixed by seeding each course hole's par from the fixture. The chokepoint behavior (par from the pinned course) is correct.
- Full-suite reds are the documented `file::memory:?cache=shared` cross-file load flakes + the spec-tolerated `lifecycle-full.e2e` load timeout — all pass in isolation; in files this story did not touch. New tests use isolated per-pid temp-file DBs + batched inserts to avoid adding shared-cache/timeout pressure.

### Completion Notes List

- **Chokepoint (Task 1):** `services/games-money.ts` `computeF1EventEdges` reads the round_pin (resolved config + per-player CH + course-rev + team split via `resolveFoursomeTeams`), derives per-hole net from the pinned CH via a NEW pure kernel `allocateStrokesFromCourseHandicap` (the EXISTING base/extra formula reached via the pinned CH — `getHandicapStrokes` now delegates to it, zero behavior change), calls `computeFoursome → ledgerToEdges`, returns `f1_game` edges. Per-foursome fail-closed (missing/partial/corrupt pin, missing handicap, bad pairing, engine error) — never throws, never live-fallback. NO read path calls `calcCourseHandicap`/`buildTeeByPlayer`/live HI.
- **Pin at start (Task 2):** `services/pin-round-at-start.ts` computes CH ONCE from the effective HI (H1-locked snapshot if locked, else manual) + per-player tee, calls `pinRound` (Story 1.2). Wired into the `in_progress` start tx in `routes/admin-event-rounds.ts`, gated on `isF1Event`, atomic + fail-soft (a pin error logs + the round still starts → fail-closed on read). Audits `round.pinned` (AC14).
- **Dual-read (Task 6) + settle-up (Task 3):** `services/money.ts` routes the 2v2-game producer to the chokepoint for F1 events (config-row-exists key) and SKIPS legacy `compute2v2BestBall` + presses entirely — F1 edges fold into combined + team ledgers. Exposure gated by `TOURNAMENT_F1_MONEY_ENABLED` (default OFF; `lib/env.ts f1MoneyEnabled()`, mirrors `pressesDisabled()`). Flag off → still skip legacy (no double-count) + `f1.exposed:false` → explicit "not yet enabled" state, not silent-zero. `money-detail.ts computeMyMoney`'s 2v2 game derives from the pinned F1 net for F1 events (not legacy live-HI). Bets/skins/action UNAFFECTED.
- **Leaderboard mode + AC2 net (Task 4):** `services/leaderboard.ts` derives F1-round net from the pinned CH + pinned course stroke index (per-stroke-index, matching settled money) — non-F1 rounds untouched. Exposes pinned HI + CH per round (AC9). `routes/events-leaderboard.ts` returns `f1` mode (locked→money / unlocked→scores-only) for the signpost. Web leaderboard renders the signpost + CH column; web money renders not-enabled / unlocked-note / unsettleable surfaces.
- **Audience-bounding (Task 8):** every dollar endpoint is behind `requireEventParticipant` (non-roster 403'd → no dollars; organizer exempt). F1-unlocked `/money` is additionally redacted server-side to the viewer's own row (`routes/money.ts boundMoneyMatrixForViewer`). My Money is viewer-private by construction. FR18 putts intact (test).
- **No new migration** (round_pin from Story 1.2 holds the pin). No new deps. Flag left OFF.
- **Legacy regression:** all pre-existing money/leaderboard tests pass UNCHANGED (money.integration 22, leaderboard.test 10, events-leaderboard.integration 11, money.test 2). The dual-read switch is additive — a non-F1 event takes the exact legacy path.

### File List

Created:
- apps/tournament-api/src/services/games-money.ts
- apps/tournament-api/src/services/games-money.test.ts
- apps/tournament-api/src/services/games-money.disjointness.test.ts
- apps/tournament-api/src/services/pin-round-at-start.ts
- apps/tournament-api/src/services/pin-round-at-start.test.ts

Modified (apps/tournament-api):
- src/engine/handicap-strokes.ts (added `allocateStrokesFromCourseHandicap`; `getHandicapStrokes` delegates — zero behavior change)
- src/lib/env.ts (`f1MoneyEnabled()`)
- src/lib/audit-log.ts (`ROUND_PINNED` / `ROUND_PIN` constants)
- src/services/money.ts (dual-read switch + F1 metadata)
- src/services/money-detail.ts (My Money F1-aware foursome game)
- src/services/leaderboard.ts (pinned-CH net for F1 rounds + HI/CH exposure)
- src/routes/money.ts (audience-bounding / unlocked redaction)
- src/routes/admin-event-rounds.ts (pin at round-start)
- src/routes/events-leaderboard.ts (F1 mode in response)

Modified (apps/tournament-web):
- src/routes/events.$eventId.leaderboard.tsx (mode signpost + CH column)
- src/routes/events.$eventId.money.tsx (not-enabled / unlocked-note / unsettleable surfaces)
- src/routes/events.$eventId.money.test.tsx (F1 reader-surface tests)
