# T6-3: Engine + Schema — Cross-Foursome Individual Bets [new]

## Status

Done

## Story

As a developer,
I want `individual_bets` + `individual_bet_rounds` + `individual_bet_presses` tables AND `apps/tournament-api/src/engine/rules/individual-bets.ts` as a pure function computing per-pair match-play money across any two Event participants regardless of shared foursome (all in integer cents) AND `POST /api/events/:eventId/bets` route to create the bet with audit + activity emission,
So that Rick's cross-foursome match bets with Scottie + Josh compute deterministically and contribute to the head-to-head matrix (FR-D3, FR-D4).

T6-3 is the THIRD story in epic T6 and the FIRST schema-touching story. It introduces the `bets` schema family + the per-pair match-play engine + the bet-creation HTTP endpoint with the full transactional contract (auth → validation → insert → audit → activity).

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/db/schema/bets.ts                                       [NEW]
apps/tournament-api/src/db/schema/index.ts                                      [MOD: 3 re-exports added]
apps/tournament-api/src/db/migrations/0005_individual_bets.sql                  [NEW: drizzle-kit generated]
apps/tournament-api/src/db/migrations/meta/0005_snapshot.json                   [NEW: drizzle-kit generated]
apps/tournament-api/src/db/migrations/meta/_journal.json                        [MOD: drizzle-kit appends 0005 entry]
apps/tournament-api/src/lib/audit-log.ts                                        [MOD: BET_CREATED + BET constants]
apps/tournament-api/src/engine/rules/individual-bets.ts                         [NEW]
apps/tournament-api/src/engine/rules/individual-bets.test.ts                    [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-a-per-hole-1-round.json     [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-b-4-round-aggregate.json    [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-c-auto-press-chain.json     [NEW]
apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-d-tie-round.json            [NEW]
apps/tournament-api/src/routes/bets.ts                                          [NEW]
apps/tournament-api/src/routes/bets.integration.test.ts                         [NEW]
apps/tournament-api/src/app.ts                                                  [MOD: mount betsRouter]
```

15 files total — 12 NEW + 3 additive MOD. All paths under `apps/tournament-api/**`. Zero SHARED, zero FORBIDDEN.

**The 3 generated migration artifacts** (`0005_individual_bets.sql` + `meta/0005_snapshot.json` + `meta/_journal.json` append) are produced by `pnpm --filter @tournament/api db:generate` against the new `bets.ts` schema. They are tracked in git per established T2-1/T3-1 precedent. The `_journal.json` MOD is an entry append (additive); `0005_snapshot.json` is a new file.

### 2. No engine import boundary tension this story

T6-3's individual-bets engine needs per-hole net-score computation. The required helper `getHandicapStrokes` ALREADY lives at `apps/tournament-api/src/engine/handicap-strokes.ts` (shipped by T6-1). T6-3 just imports it. **No new inline-port event** — Winston's "next-trigger" condition stays at 2 events (T5-5 calcCourseHandicap, T6-1 getHandicapStrokes); Followup T6-1a stays at the same priority. The `engine/rules/individual-bets.ts` file imports ONLY `../handicap-strokes.js` (intra-engine, type+function) — no `@wolf-cup/engine`, no engine→services.

### 3. Press logic — DUPLICATE not GENERALIZED (load-bearing v1 decision)

T6-2 shipped `evaluatePresses` for 2v2 team presses. T6-3 needs auto-press for 1v1 individual bets. Two options:

- **(A) Re-implement inline.** Individual-bet presses are simpler than 2v2 — single base match per round, no nested 2v2 best-ball comparison, signed delta walks per-hole net-score wins. Fewer corner cases. v1 ships its own narrowed logic.
- **(B) Generalize T6-2's `evaluatePresses` to accept per-hole-winner arrays** instead of HoleResult[]. Makes T6-2 less specific to 2v2; refactor risk with no immediate win.

**v1 ships (A).** The duplication is small (~40 LOC) and the contracts differ enough (per-hole-winner derivation, no nested-match recursion within a single round, presses don't cross rounds) that generalizing now would force premature abstraction. Followup T6-3a tracks consolidation when a third press-evaluator surface emerges.

The same key architectural primitives carry over from T6-2:
- Per-hole signed delta walked per round (positive = playerA leads).
- Auto-press fires at first |signedDelta| === N for the down player; startHole = triggerHole + 1.
- Trigger at hole 18 → no fire (no remaining holes).
- Compound presses within a round (a press's nested segment can spawn another).
- **Persisted multiplier** on `individual_bet_presses` row at fire-time per T6-2 precedent (T5-11 mid-event-edit resilience).
- canUndo OUT OF SCOPE for T6-3 — bet presses fire automatically; manual press flow on individual bets is v1.5 (T6-3b).

### 4. T6-3 is engine + schema + bet-creation route ONLY; press FIRING is T6-3 OR T6-4?

The epic AC has T6-3 covering `match_play_with_auto_press` semantics. **Decision (load-bearing for the gate):** T6-3 ships the engine that COMPUTES per-pair money INCLUDING auto-press effect; the route that PERSISTS press-fire rows on score commit lives in T6-4 (score-commit hook). v1 of T6-3:

- Engine accepts `presses: PressFireRow[]` as input (caller passes already-fired rows). Engine consumes them; doesn't fire new ones during compute.
- Engine ALSO returns `triggeredPresses: PressFireRow[]` — the auto-presses it would have fired given the match state. Caller (T6-4) compares against persisted rows + writes new ones; this is the same idempotent dedupe pattern as T6-2.
- v1 fixtures pass already-fired press rows in the input; tests assert both per-hole money AND the triggeredPresses output.

This keeps T6-3 PURE (no DB writes for press persistence) while exposing the trigger detection. T6-4 wires it.

### 5. Schema decisions

Per epic AC line 1799-1804:

```sql
CREATE TABLE individual_bets (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_a_id     TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  player_b_id     TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  bet_type        TEXT NOT NULL CHECK (bet_type IN ('match_play_per_hole','match_play_with_auto_press')),
  stake_per_hole_cents INTEGER NOT NULL CHECK (stake_per_hole_cents > 0),
  config_json     TEXT NOT NULL,
  created_by_player_id TEXT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  created_at      INTEGER NOT NULL,
  tenant_id       TEXT NOT NULL DEFAULT 'guyan',
  context_id      TEXT NOT NULL,
  UNIQUE (event_id, player_a_id, player_b_id, bet_type)
);

CREATE TABLE individual_bet_rounds (
  bet_id          TEXT NOT NULL REFERENCES individual_bets(id) ON DELETE CASCADE,
  event_round_id  TEXT NOT NULL REFERENCES event_rounds(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL DEFAULT 'guyan',
  context_id      TEXT NOT NULL,
  PRIMARY KEY (bet_id, event_round_id)
);

CREATE TABLE individual_bet_presses (
  id              TEXT PRIMARY KEY,
  bet_id          TEXT NOT NULL REFERENCES individual_bets(id) ON DELETE CASCADE,
  fired_at_round_id TEXT NOT NULL REFERENCES event_rounds(id) ON DELETE CASCADE,
  fired_at_hole   INTEGER NOT NULL CHECK (fired_at_hole BETWEEN 1 AND 18),
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('manual','auto')),
  multiplier      INTEGER NOT NULL CHECK (multiplier >= 1),  -- T6-2 precedent: integer cents-multiplier
  fired_at        INTEGER NOT NULL,
  tenant_id       TEXT NOT NULL DEFAULT 'guyan',
  context_id      TEXT NOT NULL,
  UNIQUE (bet_id, fired_at_round_id, fired_at_hole, trigger_type)
);
```

**Notes:**
- `individual_bets.player_a_id` and `player_b_id` are NOT ordered semantically — Rick↔Josh and Josh↔Rick are the SAME bet. The UNIQUE constraint enforces uniqueness on the ordered `(player_a_id, player_b_id)` tuple; **caller normalizes** to canonical order (alphabetical by playerId string) BEFORE insert. The route handler enforces this. Followup T6-3c tracks if the schema needs a CHECK constraint to enforce alphabetical ordering at the DB layer.
- `individual_bet_presses.multiplier` is INTEGER per epic-T6 integer-cents discipline (epic line 1697). The epic AC mentions `multiplier REAL` — overridden to INTEGER for consistency with `team_press_log` (T6-4 will create that with INTEGER per T6-2 contract).
- `created_by_player_id` references the player who FILED the bet (must be one of A or B, OR the event organizer per Followup T6-3d).
- All three tables tenant-scoped per FD-6 ecosystem.

### 6. Route — `POST /api/events/:eventId/bets` semantics

**Auth:** `requireSession` → `requireEventParticipant` (T3-8 middleware).

**Body:**
```json
{
  "playerAId": "uuid",
  "playerBId": "uuid",
  "betType": "match_play_per_hole" | "match_play_with_auto_press",
  "stakePerHoleCents": 500,
  "applicableRoundIds": ["uuid", ...],
  "config": { "autoPressTriggerAtNDown": 2, "pressMultiplier": 2 }  // optional; required for match_play_with_auto_press
}
```

**Validation order (codex spec H#1 fix):**

The middleware chain `requireSession` → `requireEventParticipant` runs BEFORE the route handler. Notable behavior:
- `requireEventParticipant` queries `group_members` for `(eventId, callerId)`. **Malformed `:eventId` UUIDs return 403** (the DB query returns no rows; the middleware does NOT distinguish "malformed" from "valid-but-not-a-participant"). This is INTENDED — preserves the no-existence-leak invariant (a stranger can't enumerate which eventIds exist).
- Body Zod parsing happens at the FIRST line of the route handler, after middleware.

So the actual order is:
1. `requireSession` → 401 if unauthenticated.
2. `requireEventParticipant` → 403 `not_event_participant` (covers both "not in event" AND "malformed/nonexistent eventId").
3. Body Zod parse → 400 `invalid_body` / `malformed_json`.
4. `db.transaction`:
   - (i) Verify `playerAId !== playerBId` → 400 `self_bet_not_allowed` (a player can't bet against themself). Reject BEFORE the canonical normalize.
   - (ii) Verify both `playerAId` and `playerBId` are participants of `:eventId` via group_members lookup. 422 `players_not_in_event` if either fails. (NOT 403 — caller IS authorized via requireEventParticipant; this is a business rule on the bet's PARTICIPANTS.)
   - (iii) Normalize `(playerAId, playerBId)` to canonical alphabetical order.
   - (iii) Verify `applicableRoundIds` all reference event_rounds belonging to this event. 422 `round_not_in_event` if any miss.
   - (iv) For `match_play_with_auto_press`: validate `config.autoPressTriggerAtNDown` is positive integer ≤ 18 AND `config.pressMultiplier` is positive integer. 400 `invalid_config` on miss. For `match_play_per_hole`: config must be `{}` or absent.
   - (v) INSERT `individual_bets` row. UNIQUE constraint may fire → catch + return 422 `duplicate_bet`.
   - (vi) INSERT N rows in `individual_bet_rounds` (one per applicable round).
   - (vii) writeAudit `BET_CREATED` with full payload.
   - (viii) emitActivity `'bet.created'` scoped `{ eventId, betId }`.
4. Return 200 `{ ok: true, betId, requestId }`.

### 7. Audit + activity additions

`audit-log.ts` MOD:
- `AUDIT_EVENT_TYPES.BET_CREATED = 'bet.created'`
- `AUDIT_ENTITY_TYPES.BET = 'bet'`

Both additive; no existing call sites change.

### 8. Pure function contract for `computeIndividualBet`

Inputs:
- `bet: { id, playerAId, playerBId, betType, stakePerHoleCents, config }`
- `applicableRounds: { roundId, eventRoundId, course: { tee, holes } }[]`  — runtime rounds the bet applies to
- `holeScoresByCell: Map<roundId|playerId|holeNumber, HoleScoreShape>`  — caller pre-builds this index from hole_scores rows
- `pressesByRound: Record<eventRoundId, PressFireRow[]>`  — already-fired press rows from individual_bet_presses, indexed by round
- `handicapIndexByPlayer: Record<playerId, number>` — for getHandicapStrokes

Outputs:
- `perRound: BetRoundResult[]` — one entry per applicableRound with per-hole detail
- `triggeredPresses: PressFireRow[]` — for `match_play_with_auto_press`: the press fires the engine WOULD HAVE generated given match state; caller compares + persists (same idempotent dedupe pattern as T6-2)
- `netToPlayerACents: number` — signed; positive = A leads across all rounds

Per AC-3: 4-round match, A wins 40 holes, B wins 30, 2 halved → netToPlayerACents = `500 * (40 - 30) = 5000`. (Halved holes contribute zero. Press effects layer ADDITIVE on top of base.)

### 9. Edge cases — pinned

- **Halved hole** (net A == net B): contributes 0 cents. No press contribution either.
- **Either player has no hole_scores row for a hole:** SKIP that hole (consistent with T6-1 AC-2 missing-cell skip pattern). **Press-trigger note (codex spec rerun L#4):** the signed-delta walk visits ONLY scored holes; a press triggers at the first SCORED hole reaching ±N. If hole 3 is unscored but hole 4 is scored, the walk goes 1→2→4 (skipping 3). This means a press could fire later than it would have with full data — acceptable v1, since the round's score-commit hook (T6-4) only invokes the engine when a hole IS committed, and partial rounds are evaluated on each commit. Followup T6-3f tracks if observed misalignment ever matters.
- **Bet applies to round X but no `rounds` row exists yet** (round not opened): the runtime round can't be evaluated; SKIP.
- **Plus-handicap player:** strokes clamp to 0 per T6-1 AC-13(vii) — getHandicapStrokes already handles this.
- **Presses don't carry across rounds:** each round computes its own match-state from hole 1; presses in round N do NOT continue into round N+1. Per epic AC line 1816.

### 9b. Round identifier duality — `roundId` vs `eventRoundId`

T6-3 uses both round identifiers; conflating them would cause real persistence bugs. Mapping:

| Identifier | Source table | Used for | Engine input field |
|---|---|---|---|
| `eventRoundId` | `event_rounds.id` (T3-1) | Scheduled-round identity; FKs from `individual_bet_rounds.event_round_id`, `individual_bet_presses.fired_at_round_id` | `applicableRounds[i].eventRoundId`; `pressesByRound` keys; `PressFireRow.firedAtRoundId` |
| `roundId` | `rounds.id` (T5-1) | Runtime-scoring identity; FK from `hole_scores.round_id` | `applicableRounds[i].roundId`; `holeScoresByCell` keys |

**Rule:** PRESS persistence is keyed off `eventRoundId` (stable across the bet's lifecycle); HOLE-SCORE lookup is keyed off `roundId` (which scoring instance was actually played). The engine's per-round loop walks `applicableRounds` and uses the appropriate identifier at each touch point.

### 10. Pure function guarantees

- No DB, no I/O, no env, no clock, no crypto, no input mutation.
- Determinism: byte-for-byte stable across repeated calls.
- Defensive validation at the boundary: integer-cents check on `stake_per_hole_cents`, multiplier; enum check on bet_type.

## Acceptance Criteria

(Derived from epics-phase1.md T6.3 lines 1789–1832.)

**AC-1 — Schema migration + drizzle schema file.**
**Given** `apps/tournament-api/src/db/schema/bets.ts`
**When** inspected
**Then** it defines three drizzle-orm tables matching Section 5 SQL with proper FK refs, CHECK constraints, UNIQUE constraints, and ecosystemColumns(). The migration file `0005_individual_bets.sql` is generated via `pnpm --filter @tournament/api db:generate` and committed alongside.

**AC-2 — Schema barrel re-exports.**
**Given** `apps/tournament-api/src/db/schema/index.ts`
**When** inspected
**Then** it re-exports `individualBets`, `individualBetRounds`, `individualBetPresses` types + table objects. Additive only.

**AC-3 — Audit + entity constants.**
**Given** `apps/tournament-api/src/lib/audit-log.ts`
**When** inspected
**Then** `AUDIT_EVENT_TYPES.BET_CREATED = 'bet.created'` and `AUDIT_ENTITY_TYPES.BET = 'bet'` are added. Additive.

**AC-4 — Engine pure function shape.**
**Given** `apps/tournament-api/src/engine/rules/individual-bets.ts`
**When** inspected
**Then** it exports `computeIndividualBet(input)` AND every type referenced. Pure function — no DB, no I/O, no env, no clock, no crypto, no mutation. Imports ONLY from `../handicap-strokes.js` (no @wolf-cup/engine).

```ts
export type IndividualBetType = 'match_play_per_hole' | 'match_play_with_auto_press';

export type IndividualBetConfig =
  | { /* empty for match_play_per_hole */ }
  | { autoPressTriggerAtNDown: number; pressMultiplier: number; /* match_play_with_auto_press */ };

export type ComputeIndividualBetInput = {
  bet: { id: string; playerAId: string; playerBId: string; betType: IndividualBetType; stakePerHoleCents: number; config: IndividualBetConfig };
  applicableRounds: Array<{ roundId: string; eventRoundId: string; course: { tee: TeeShape; holes: HoleShape[] } }>;
  holeScoresByCell: Map<string, { grossStrokes: number; putts: number | null }>;  // key: `${roundId}|${playerId}|${holeNumber}`
  pressesByRound: Record<string, PressFireRow[]>;  // keyed by eventRoundId
  handicapIndexByPlayer: Record<string, number>;
};

/**
 * Press fire-row shape (engine domain). Field names follow the DB
 * column convention WHERE APPLICABLE so the caller's mapping into
 * `individual_bet_presses` rows is trivial:
 *   - `firedAtRoundId` ↔ `fired_at_round_id`
 *   - `firedAtHole` ↔ `fired_at_hole`
 *   - `triggerType` ↔ `trigger_type`
 *   - `multiplier` ↔ `multiplier`
 *   - `id` ↔ `id`
 * The DB columns NOT carried in this engine type — `bet_id`, `fired_at`
 * (timestamp), `tenant_id`, `context_id` — are stamped by the route
 * layer (T6-4) at persist time. The `trigger` field is engine-only
 * (descriptive label like '2-down'); it does NOT correspond to a DB
 * column, just adds context to the engine output for debug/UI.
 *
 * `firedAtRoundId` is the SCHEDULED `event_rounds.id`, not the runtime
 * `rounds.id` — matches the schema's FK target and is stable across
 * the bet's lifecycle.
 *
 * NOTE: T6-2's team-press domain uses `startHole` + `team` (different
 * surface, different table). The two domains diverge intentionally;
 * each is internally consistent. Followup T6-3a may consolidate.
 */
export type PressFireRow = {
  // `id` is OPTIONAL on engine output — the caller (T6-4) generates UUIDs
  // when persisting newly-fired rows. Carried-forward rows retain their id.
  id?: string;
  firedAtRoundId: string;        // event_rounds.id (scheduled identifier)
  firedAtHole: number;           // 1..18
  multiplier: number;            // positive integer; persisted at fire-time
  triggerType: 'auto' | 'manual';
  trigger?: string;              // engine-only descriptive label (e.g., '2-down'); not a DB column
};

export type BetHoleResult = {
  holeNumber: number;
  par: 3 | 4 | 5;
  netA: number;
  netB: number;
  winner: 'playerA' | 'playerB' | 'halved';
  baseDeltaCents: number;        // signed; positive = A wins this hole
  pressDeltaCents: number;       // signed; press contribution for this hole
};

export type BetRoundResult = {
  roundId: string;
  eventRoundId: string;
  perHole: BetHoleResult[];
  netToPlayerACents: number;     // signed; sum of perHole base + press deltas
  triggeredPresses: PressFireRow[];  // press fires this round would emit (match_play_with_auto_press only)
};

export type ComputeIndividualBetOutput = {
  perRound: BetRoundResult[];
  netToPlayerACents: number;     // sum across all applicableRounds
  triggeredPresses: PressFireRow[];  // flattened across all rounds
};
```

**AC-5 — Boundary validation (fast-fail).**
**Given** invalid inputs to `computeIndividualBet`
**When** called
**Then** throws synchronously:
- `bet.stakePerHoleCents` not a positive integer → `RangeError`.
- `bet.betType` not in enum → `RangeError`.
- For `match_play_with_auto_press`: `config.autoPressTriggerAtNDown` not positive integer ≤ 18 OR `config.pressMultiplier` not positive integer → `RangeError`.
- Any `pressesByRound[k][i].multiplier` not positive integer → `RangeError`.
- **`pressesByRound` key consistency invariant (codex spec rerun-2 M#2):** for every key `K` in `pressesByRound` and every `PressFireRow p` in `pressesByRound[K]`, `p.firedAtRoundId === K`. Mismatch → `Error('press_fire_row_round_mismatch')`. The route layer (T6-4) writes presses into the indexed structure consistently; this throws on a caller-side mistake.
- Duplicate `applicableRounds` entries (same `eventRoundId` OR same `roundId`) → `Error`.

**AC-6 — Per-hole net comparison + base delta.**
**Given** a played hole where playerA's net (gross − getHandicapStrokes) = 4, playerB's net = 5, `stakePerHoleCents = 500`
**When** computed
**Then** `perHole[i] = { ..., winner: 'playerA', baseDeltaCents: 500, pressDeltaCents: 0 }`. Halved holes return `winner: 'halved'` and 0 deltas. Missing cells (either player) skip the hole.

**AC-7 — Net aggregate matches epic example.**
**Given** a $5/hole match (`stakePerHoleCents = 500`) across 4 rounds where playerA wins 40 holes, playerB wins 30, 2 halved
**When** computed
**Then** `output.netToPlayerACents = 500 × (40 − 30) = 5000`. Press effects layer ADDITIVE on top.

**AC-8 — Auto-press chain (in-round only).**
**Given** `bet.betType = 'match_play_with_auto_press'`, `config.autoPressTriggerAtNDown = 2`, `config.pressMultiplier = 2`, a round where playerA falls 2-down at hole 4 (no presses pre-fired in `pressesByRound`)
**When** computed
**Then** `output.perRound[0].triggeredPresses` contains one press: `{ firedAtRoundId: <round1.eventRoundId>, firedAtHole: 5, multiplier: 2, triggerType: 'auto', trigger: '2-down' }`. Press's contribution to that round's `netToPlayerACents` includes the additive press effect on holes 5–18. Compound presses (within the same round's nested match) fire by the same fixed-point algorithm as T6-2.

**AC-8b — Trigger at hole 18 → no press fires (no remaining holes).**
**Given** a `match_play_with_auto_press` round where playerA first reaches 2-down at hole 18
**When** computed
**Then** `triggeredPresses` is empty for that round (would-be `firedAtHole = 19` is suppressed). Mirrors T6-2 AC-11.

**AC-9 — Presses don't carry across rounds.**
**Given** a 2-round bet where round 1 fires an auto-press at hole 5 of round 1
**When** computing round 2
**Then** round 2's match-state starts fresh at hole 1 with no pressed-segment from round 1. Triggers in round 2 are evaluated independently.

**AC-10 — Pure / deterministic.**
**Given** identical input passed twice
**When** the function is called twice
**Then** outputs are deep-equal AND inputs are not mutated (verified via `structuredClone`).

**AC-11 — Four golden engine fixtures pass.**
**Given** `apps/tournament-api/src/engine/rules/individual-bets.test.ts` + `__fixtures__/individual-bet-{a..d}.json`
**When** tests run
**Then** at least four fixtures pass:
- (a) **Straight per-hole match across 1 round:** `match_play_per_hole`, A wins 6/9 holes, B wins 3, no halves → `netToPlayerACents = 500 × (6 − 3) = 1500`.
- (b) **4-round aggregate:** A wins 40, B wins 30, 2 halved → `5000`.
- (c) **Auto-press chain within one round (2-down trigger):** verifies AC-8.
- (d) **Tie round (net 0):** A wins 4, B wins 4, 1 halved → `netToPlayerACents = 0`. Each hole contributes its base delta; the round nets zero.

**AC-12 — `POST /api/events/:eventId/bets` route.**
**Given** the route handler at `apps/tournament-api/src/routes/bets.ts`
**When** invoked
**Then** the handler:
- Gates: `requireSession` → `requireEventParticipant`. Malformed/nonexistent `:eventId` → 403 from middleware (no-existence-leak).
- Body Zod parses → 400 `invalid_body` / `malformed_json` on failure.
- Inside `db.transaction`:
  - (i) Verifies `playerAId !== playerBId` → 400 `self_bet_not_allowed`.
  - (ii) Verifies both `playerAId` and `playerBId` in event's group_members → 422 `players_not_in_event` on miss.
  - (iii) Normalizes the player ID pair to alphabetical canonical order.
  - (iv) Verifies `applicableRoundIds` has NO duplicates → 400 `duplicate_applicable_round_ids` on duplicate. (Inserting duplicates would violate the `(bet_id, event_round_id)` PK on `individual_bet_rounds`.) Then verifies all `applicableRoundIds` belong to this event → 422 `round_not_in_event` on any miss.
  - (v) Validates `config` shape against `betType` → 400 `invalid_config`.
  - (vi) INSERTs `individual_bets` row; UNIQUE constraint catch → 422 `duplicate_bet`.
  - (vii) INSERTs N rows in `individual_bet_rounds`.
  - (viii) writeAudit `BET_CREATED` with `{ eventId, betId, playerAId, playerBId, betType, stakePerHoleCents, applicableRoundIds, config, createdByPlayerId }`.
  - (ix) emitActivity `'bet.created'` scope `{ eventId }` payload `{ betId, playerAId, playerBId, betType, stakePerHoleCents }`.
- Returns 200 `{ ok: true, betId, requestId }`.

**AC-13 — Integration tests.**
**Given** `apps/tournament-api/src/routes/bets.integration.test.ts`
**When** run
**Then** the following cases pass:
- (i) Happy path: organizer creates a $5/hole match for two participants → 200 + audit row + activity emitted (NO-OP body) + canonical-order verified in DB.
- (ii) Duplicate bet (same A↔B + bet_type): second request → 422 `duplicate_bet`.
- (iii) Non-participant requester (caller is in a different event) → 403 `not_event_participant`.
- (iv) `playerAId` not in event → 422 `players_not_in_event`.
- (v) `applicableRoundIds` references a round in a different event → 422 `round_not_in_event`.
- (vi) `stakePerHoleCents = 0` → 400 `invalid_body` (Zod range).
- (vii) `betType = 'match_play_with_auto_press'` without config → 400 `invalid_config`.
- (viii) Audit row written; activity emit invoked; canonical alphabetical ordering of `(player_a_id, player_b_id)` in DB.
- (ix) `playerAId === playerBId` → 400 `self_bet_not_allowed`.
- (x) Duplicate entries in `applicableRoundIds` → 400 `duplicate_applicable_round_ids`.
- (xi) Malformed `:eventId` (non-UUID OR nonexistent UUID) → 403 `not_event_participant` (verifies the no-existence-leak invariant from `requireEventParticipant`).

## Tasks / Subtasks

- [ ] **Task 1: Create `apps/tournament-api/src/db/schema/bets.ts`.** Three tables per Section 5. ecosystemColumns(), CHECK constraints, FK with explicit onDelete, UNIQUE constraints.

- [ ] **Task 2: Re-export from `apps/tournament-api/src/db/schema/index.ts`.** Additive — `individualBets`, `individualBetRounds`, `individualBetPresses` + types.

- [ ] **Task 3: Generate migration.** `pnpm --filter @tournament/api db:generate`. Commit `0005_individual_bets.sql` + `meta/0005_snapshot.json` + `meta/_journal.json` MOD.

- [ ] **Task 4: Add `BET_CREATED` + `BET` constants to `audit-log.ts`.** Additive.

- [ ] **Task 5: Create `apps/tournament-api/src/engine/rules/individual-bets.ts`.** Pure function `computeIndividualBet`. Per-round iteration; per-hole net comparison; press fixed-point evaluation per AC-8; NO @wolf-cup/engine import.

- [ ] **Task 6: Create `apps/tournament-api/src/engine/rules/individual-bets.test.ts` + 4 fixtures.** Per AC-11 + AC-10 determinism + AC-5 boundary tests.

- [ ] **Task 7: Create `apps/tournament-api/src/routes/bets.ts`.** POST handler per AC-12. Auth-FIRST in-tx; transactional INSERT + audit + activity.

- [ ] **Task 8: Create `apps/tournament-api/src/routes/bets.integration.test.ts`.** All AC-13 cases.

- [ ] **Task 9: Mount router in `apps/tournament-api/src/app.ts`.**

- [ ] **Task 10: Regression test pass.** All workspace test/typecheck/lint green; T5-5 + T6-1 + T6-2 unaffected.

## Dev Notes

### Project Structure Notes

- **Bets schema is a NEW file** (`bets.ts`); NOT colocated with rules.ts (rule-set config) or pairings.ts (foursome pairings) since the bet domain is orthogonal. T6-3 introduces `bets/` lineage; T6-4..T6-9 extend.
- **`event_round_id` FK on `individual_bet_rounds`** is the SCHEDULED round identifier (T3-1 entity). The runtime `rounds` row may not exist when the bet is created (bet filed during event-creation wizard before any round opens). Engine consumes `runtime rounds` separately via `applicableRounds` input.
- **Press persistence** lives in `individual_bet_presses` (T6-3 schema) but T6-3 does NOT WRITE to it from the route. T6-4 (score-commit hook) is the writer. T6-3's engine RETURNS `triggeredPresses` for the caller to persist.
- **Drizzle migration generation** is deterministic — same schema input produces same SQL output. Do not hand-edit the generated SQL; if a tweak is needed, modify the schema TS and re-generate.

### Money discipline (T6-3 contribution)

- All money fields INTEGER CENTS at every layer.
- `stake_per_hole_cents`, `multiplier` enforced INTEGER at engine boundary + DB CHECK.
- Per-hole base delta = `stakePerHoleCents` (signed by winner).
- Press delta on a pressed hole = `stakePerHoleCents × multiplier` (signed by that press's segment winner).
- No division ops in T6-3.

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1789–1832 (T6.3)
- T6-2 press precedent: `apps/tournament-api/src/engine/rules/press.ts` (multiplier persistence pattern)
- T6-1 handicap-strokes (consumed): `apps/tournament-api/src/engine/handicap-strokes.ts`
- T3-8 requireEventParticipant middleware: `apps/tournament-api/src/middleware/require-event-participant.ts`
- T5-9 score-corrections route precedent (auth-FIRST + audit + activity in-tx pattern): `apps/tournament-api/src/routes/score-corrections.ts`
- Architecture engine boundary: `_bmad-output/planning-artifacts/tournament/architecture.md` line 467 (D1-1)

### Risks / Followups

- **Followup T6-3a: Consolidate press evaluation between T6-2 (team) and T6-3 (individual).** v1 ships with two implementations. If a third press-evaluator surface emerges (e.g., skins-with-press), extract a shared helper. Drift-monitor: if T6-2's algorithm gets a bug fix, T6-3's mirror needs the same fix.
- **Followup T6-3b: Manual press flow on individual bets.** v1 fires only auto-presses (deterministic). UI for filing a manual press on a bet is v1.5+.
- **Followup T6-3c: DB-level CHECK on canonical alphabetical ordering of `(player_a_id, player_b_id)`.** v1 enforces in route handler; defensive belt-and-suspenders at DB layer can be added without schema break.
- **Followup T6-3d: `created_by_player_id` permission check.** v1 trusts requireEventParticipant + the body's playerAId/playerBId match. Stricter check would require created_by ∈ {playerAId, playerBId, organizerPlayerId}.
- **Followup T6-3e: Bet revocation / cancellation.** v1 has no DELETE flow. If a bet is filed in error, the event organizer's only recourse is direct DB edit. v1.5+ ships `DELETE /api/events/:eventId/bets/:betId` with audit.
- **Risk: race on simultaneous duplicate-bet creation.** UNIQUE constraint catches at INSERT time; route returns 422 `duplicate_bet`. Acceptable.
- **Risk: schema drift if drizzle-kit generates differently across CI environments.** T2-1 + T3-1 + T5-1 set the precedent of committing generated SQL; CI doesn't regenerate. Same posture here.

## Files this story will edit

- apps/tournament-api/src/db/schema/bets.ts
- apps/tournament-api/src/db/schema/index.ts
- apps/tournament-api/src/db/migrations/0005_individual_bets.sql
- apps/tournament-api/src/db/migrations/meta/0005_snapshot.json
- apps/tournament-api/src/db/migrations/meta/_journal.json
- apps/tournament-api/src/lib/audit-log.ts
- apps/tournament-api/src/engine/rules/individual-bets.ts
- apps/tournament-api/src/engine/rules/individual-bets.test.ts
- apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-a-per-hole-1-round.json
- apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-b-4-round-aggregate.json
- apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-c-auto-press-chain.json
- apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-d-tie-round.json
- apps/tournament-api/src/routes/bets.ts
- apps/tournament-api/src/routes/bets.integration.test.ts
- apps/tournament-api/src/app.ts

Additional files MAY be added during implementation only under `apps/tournament-api/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director driving dev-story per workflow-tournament.yaml).

### Debug Log References

- Spec codex: 4 rounds (2H+2M → 1H+2M+1L → 2M+1L → 2M+1L → final 1M+1L applied). Validation order vs middleware (no-existence-leak), naming alignment, round identity, self-bet, dup roundIds, key consistency invariant — all addressed.
- Impl codex: 1H+2M applied (hard-coded 18 holes → maxHole; route validation order → config moved inside tx). 1M (DB-level CHECK for canonical/self-bet) deferred to T6-3c per spec followup.
- Impl codex rerun: 1M+1L applied (config null bypass → strict empty-object check; engine comment alignment).
- Party codex: 3M+1L; 2M applied (test count nit, malformed-vs-nonexistent eventId clarification, file header comment); 1M (boundary count) clarified via sum-verified breakdown; 1L (review-context drift) acceptable.

### Completion Notes List

- 15 ALLOWED files (12 NEW + 3 additive MOD: schema/index.ts, audit-log.ts, app.ts). Zero SHARED, zero FORBIDDEN.
- 30 new tests (18 engine + 12 integration). tournament-api 687 → 717 (+30). Engine 472 + wolf-cup api 516 unaffected.
- Migration 0005_individual_bets generated via drizzle-kit; meta/_journal.json appended; 3 tables (individual_bets, individual_bet_rounds, individual_bet_presses).
- pnpm -r typecheck + lint clean.
- Architectural decision A approved at gate: duplicate-not-generalize press logic (T6-3a tracks consolidation if 3rd surface emerges); persisted multiplier on individual_bet_presses (T5-11 mid-event-edit resilient); engine + schema + route ship together.
- T6-4 score-commit hook will consume `triggeredPresses` from this engine and persist into individual_bet_presses with idempotent UNIQUE dedupe.

### File List

- apps/tournament-api/src/db/schema/bets.ts (NEW)
- apps/tournament-api/src/db/schema/index.ts (MOD: 3 re-exports)
- apps/tournament-api/src/db/migrations/0005_individual_bets.sql (NEW: drizzle-kit generated)
- apps/tournament-api/src/db/migrations/meta/0005_snapshot.json (NEW: drizzle-kit generated)
- apps/tournament-api/src/db/migrations/meta/_journal.json (MOD: 0005 entry appended; tag renamed)
- apps/tournament-api/src/lib/audit-log.ts (MOD: BET_CREATED + BET constants)
- apps/tournament-api/src/engine/rules/individual-bets.ts (NEW)
- apps/tournament-api/src/engine/rules/individual-bets.test.ts (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-a-per-hole-1-round.json (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-b-4-round-aggregate.json (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-c-auto-press-chain.json (NEW)
- apps/tournament-api/src/engine/rules/__fixtures__/individual-bet-d-tie-round.json (NEW)
- apps/tournament-api/src/routes/bets.ts (NEW)
- apps/tournament-api/src/routes/bets.integration.test.ts (NEW)
- apps/tournament-api/src/app.ts (MOD: mount betsRouter)
