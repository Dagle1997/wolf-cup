# T6-8: Bets Page — Per-Pair Live Standings [target-miss tolerable]

## Status

ready-for-dev

## Story

As a player participating in cross-foursome individual bets, I want a dedicated Bets page showing my live standing in each bet I'm party to, so that I can glance between holes and see my bet's running net + press history at a glance (FR-E6).

## v1 Scope

- **Two new GET endpoints** on `betsRouter`:
  - `GET /api/events/:eventId/bets/mine` — list bets where the session player is `playerAId` OR `playerBId`, scoped to the event.
  - `GET /api/events/:eventId/bets/:betId` — single bet detail; viewer must be a bet party.
- **Standings computation** uses the existing `computeIndividualBet` engine (T6-3) per bet, fed with the bet's individual_bet_rounds + individual_bet_presses + cross-round hole_scores. Net is signed to the *viewer* (positive = viewer up, negative = viewer down).
- **New web route** `/events/:eventId/bets` rendering one card per bet with per-round sub-rows + inline press history.

### Out of scope

- **Organizer-aware visibility** (covers BOTH the organizer-wide listing AND organizer-as-non-party `/:betId` access mentioned in the epic AC). Both deferred together as **Followup T6-8a** because they share the same dependency: a new auth predicate `isOrganizerOrParticipant`. The current `requireEventParticipant` middleware only checks `group_members` (`apps/tournament-api/src/middleware/require-event-participant.ts:71-87`), so an organizer who isn't a group member can't reach these routes today. T6-8a will ship `GET /api/events/:eventId/bets` (no `/mine`) AND extend `/:betId` to allow organizer-as-non-party reads, both gated by the new auth predicate. Not needed for the May trip; organizer can audit bets via the Money page's pair matrix.
- Hole-by-hole scrubbing within a bet — Followup T6-8b. v1 surfaces per-round summary only.
- Live polling cadence reuses TanStack Query `refetchInterval: 15_000` matching the leaderboard pattern.

### Visibility model (FR-H6 strict, v1 scope)

- `bets/mine`: session player must be `playerAId` OR `playerBId` of returned bets. Scoped per `requireEventParticipant` (group-member check). Bets where the player is NOT a party are silently filtered (no 403 — they just don't appear in the list).
- `bets/:betId`: **403** `not_party_to_bet` when session is an event participant but NOT a bet party. Spectators / non-participants → 403 `not_event_participant` (handled upstream by `requireEventParticipant`). **No-existence-leak invariant** (mirroring T6-5): unknown `betId` OR a `betId` belonging to a different event also returns 403 `not_party_to_bet` — NEVER 404 — so a probing attacker cannot enumerate existing bet IDs.
- The fact that the Money matrix exposes totals event-wide in `open` visibility mode does NOT broaden bet-detail visibility. Bets are stricter by design.

## Path footprint — ALLOWED only

```
apps/tournament-api/src/routes/bets.ts                         [MODIFIED]
apps/tournament-api/src/routes/bets.integration.test.ts        [MODIFIED]
apps/tournament-web/src/routes/events.$eventId.bets.tsx        [NEW]
apps/tournament-web/src/routes/events.$eventId.bets.test.tsx   [NEW]
```

2 MODIFIED + 2 NEW files, all under `apps/tournament-api/` or `apps/tournament-web/`. Zero SHARED, zero FORBIDDEN.

## Acceptance Criteria

**AC-1 — `GET /api/events/:eventId/bets/mine` happy path.**

**Given** session player is party to ≥1 bet in the event
**When** `GET /api/events/:eventId/bets/mine` is called
**Then** returns 200 with body shape:

```ts
{
  bets: Array<{
    betId: string;                    // individualBets.id
    opponentPlayerId: string;         // the other party from viewer's perspective
    opponentName: string;
    betType: 'match_play_per_hole' | 'match_play_with_auto_press';
    stakePerHoleCents: number;        // integer cents
    applicableRoundIds: string[];     // event_rounds.id (rounds the bet covers)
    perRoundStanding: Array<{
      eventRoundId: string;
      roundNumber: number;
      holesPlayed: number;            // count of distinct hole_scores rows where BOTH viewer + opponent have scored, AND holeNumber ≤ round.holesToPlay (cap is implicit — hole_scores can't exist beyond holesToPlay — but stated explicitly to defend against schema drift)
      holesRemaining: number;         // round.holesToPlay − holesPlayed (uses the per-round holesToPlay, NOT a flat 18 — supports 9-hole rounds; clamps at 0 if holesPlayed somehow exceeds holesToPlay)
      netToViewerCents: number;       // signed to viewer; opponent = -1 ×
    }>;
    totalNetToViewerCents: number;    // sum across all applicable rounds
    presses: Array<{
      betPressId: string;
      eventRoundId: string;
      firedAtHole: number;
      triggerType: 'auto' | 'manual';
      multiplier: number;
    }>;
  }>;
}
```

**AC-2 — `GET /api/events/:eventId/bets/mine` empty.**

**Given** session player is in the event but party to 0 bets
**When** `GET /api/events/:eventId/bets/mine` is called
**Then** returns 200 `{ bets: [] }`.

**AC-3 — `GET /api/events/:eventId/bets/:betId` happy path (party).**

**Given** session player is `playerAId` OR `playerBId` of the bet
**When** invoked
**Then** returns 200 with the same single-bet shape (unwrapped from the array).

**AC-4 — `GET /api/events/:eventId/bets/:betId` 403 (non-party event participant).**

**Given** session player is an event participant but NOT a bet party
**When** invoked
**Then** returns 403 `{ error: 'forbidden', code: 'not_party_to_bet', requestId }`.

**AC-5 — `GET /api/events/:eventId/bets/:betId` no-existence-leak.**

The handler distinguishes ONE syntactic check from all semantic checks:

  - **Syntactic:** if `betId` does not match the UUID regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`, return **400** `{ error: 'bad_request', code: 'invalid_bet_id_format', requestId }`. This is observable — but it leaks NOTHING about which UUIDs exist (the check is purely string-shape).
  - **Semantic (everything else):** if `betId` is well-formed UUID but (a) does not exist in any event, OR (b) exists in a DIFFERENT event than the URL's `:eventId`, OR (c) exists in this event but viewer is not a party — return **403** `{ error: 'forbidden', code: 'not_party_to_bet', requestId }`. Identical response shape across all three cases — no 404, no distinguishing fields. An attacker iterating well-formed random UUIDs cannot tell "bet does not exist" from "bet in another event" from "bet I'm not party to."

Mirrors T6-5's no-existence-leak invariant.

**AC-6 — Auth chain identical to T6-5.**

**Given** anonymous OR non-event-participant
**When** any of these endpoints is called
**Then** the upstream `requireSession` + `requireEventParticipant` chain returns 401 / 403 (no-existence-leak invariant preserved).

**AC-7 — Web page renders.**

**Given** session player has bets
**When** the route `/events/:eventId/bets` loads
**Then** the page renders:
  - Heading "Bets".
  - One card per bet (opponent name, type, stake `$X.XX`, total net signed to viewer with `+`/`−` prefix and color cue).
  - Per-round sub-rows: `Round N — through hole {holesPlayed} of {holesToPlay} — net $X.XX` (uses each round's `holesToPlay` so 9-hole rounds render correctly; not hard-coded to 18).
  - Press history inline (one line per press: `Round N hole H — auto/manual press, ×N multiplier`).
  - Empty state: "No bets yet — organizer can add via admin." (when `bets.length === 0`).

**AC-8 — Auth chain mirrors T6-5.**

**Given** anonymous → redirect `window.location.assign('/api/auth/google')`
**Given** 403 → inline forbidden card "You aren't a participant in this event."
**Given** 200 → render.

**AC-9 — Polling.**

**Given** the page is open
**When** 15s elapses
**Then** TanStack Query refetches `bets/mine` (matches the leaderboard cadence).

**AC-10 — Tests.**

**Given** the integration test file
**When** run
**Then** at minimum:
  - `bets/mine` happy path (2 bets, viewer party to both).
  - `bets/mine` empty (viewer party to 0).
  - `bets/:betId` 200 as party.
  - `bets/:betId` 403 as non-party event participant.
  - `bets/:betId` 403 for unknown betId (no-existence-leak per AC-5).
  - `bets/:betId` 403 for betId belonging to a different event (no-existence-leak per AC-5).
  - Sign-flip correctness: when viewer is `playerBId`, `netToViewerCents === −1 × engine.netToPlayerACents`. Tested explicitly with both perspectives on the same bet in two separate sessions.

The web smoke test renders 1 bet and asserts the opponent name + total net + per-round row appear.

## Followups

- **T6-8a (organizer-wide bet list):** `GET /api/events/:eventId/bets` (no `/mine`) returning all bets in the event. Out of scope here because the May trip's organizer (Josh) can audit bets via the Money page or by fetching individual `bets/:betId`.
- **T6-8b (hole-by-hole scrub):** drill-down within a bet card showing each hole's net + press effect.
- **T6-8c (settle-up integration):** show the Bets page link inline in the Settle-Up page (T6-6) per pair.
- **T6-8d (engine-input dedupe):** consolidate the `services/money.ts` + `routes/bets.ts` inline assembly of `ComputeIndividualBetInput` into a shared helper (e.g., `services/bets.ts#loadIndividualBetEngineInput`). Deferred from v1 to avoid money-matrix regression risk; plan to ship alongside T6-8a when the third call site (organizer-wide listing) lands.
- **T6-8e (read-path triggered-press materialization):** when bet type is `match_play_with_auto_press` and the engine returns `triggeredPresses.length > 0` on a read call, the response's `totalNet` includes those presses' effect but the `presses` array (read from DB) does not. Either (a) write the new presses on the read path (read-after-write consistency), or (b) recompute net from persisted-only press state. v1 logs a comment but does not act because the May trip uses straight match-play only. Surfaces in v1.5 if auto-press use returns.
- **T6-8f (query-batching for /bets/mine):** the v1 implementation issues N+1 queries per bet (per applicable round → eventRound + runtime + tee + courseRev + holes + scores). Acceptable for the May trip's small bet count, but a large event with many bets + rounds will be slow. Consolidate via JOIN-aware composite query when needed.

## Codex review notes

Codex round 1 against the spec returned 1 critical (auth-chain contradiction), 2 H, 3 M. All addressed:

- **Critical (organizer access vs requireEventParticipant)** — resolved by removing organizer-as-non-party access from v1; folded into Followup T6-8a along with the wider organizer listing endpoint, since both share the same auth-predicate dependency.
- **High (response shape ambiguity for organizer)** — eliminated by removing the organizer case.
- **High (no-existence-leak underspecified)** — added explicit AC-5 covering malformed UUID (400 + uniform shape), unknown betId (403), wrong-event betId (403), non-party (403). All semantic 403s use identical body.
- **Medium (holesPlayed/holesRemaining ambiguity)** — pinned to "BOTH parties scored" + "uses round.holesToPlay, not flat 18".
- **Medium (engine-input divergence risk)** — pinned to inline-duplicate of services/money.ts pattern + FOLLOWUP T6-8d for v1.5 dedupe.
- **Medium (organizer sign semantics)** — eliminated by removing organizer case.

Codex round 2 returned 1 H, 2 M, 1 L (all minor refinements):

- **High round-2 (UUID 400 vs 403 ambiguity)** — pinned syntactic regex check to 400 invalid_bet_id_format; all semantic checks return uniform 403 not_party_to_bet (AC-5 rewritten with the syntactic/semantic distinction explicit).
- **Medium round-2 (followups contradicts visibility model)** — clarified T6-8a covers BOTH the listing endpoint AND organizer-as-non-party `/:betId` access; they share an auth-predicate dependency.
- **Medium round-2 (UI copy "of 18")** — UI now uses `{round.holesToPlay}` per AC-7.
- **Low round-2 (holesPlayed cap)** — pinned to explicit "AND holeNumber ≤ round.holesToPlay" + "clamps at 0" in the type definition.

Per autonomous-progress mandate (option 2): all round-2 findings were minor refinements, not architectural pivots — applied inline and proceeding to implementation without a third codex round on the spec.

## Files this story will edit

- apps/tournament-api/src/routes/bets.ts
- apps/tournament-api/src/routes/bets.integration.test.ts
- apps/tournament-web/src/routes/events.$eventId.bets.tsx
- apps/tournament-web/src/routes/events.$eventId.bets.test.tsx

## Risks / Followups

- **Engine input gathering complexity.** `computeIndividualBet` needs `holeScoresByCell` (Map keyed `${roundId}|${playerId}|${holeNumber}`) + `pressesByRound` (Record keyed by `eventRoundId`) + `handicapIndexByPlayer`. `services/money.ts` already has this assembly logic inline.
  - **Implementation contract for v1:** the bets routes compute this input INLINE in their handler functions, mirroring `services/money.ts`'s exact assembly pattern verbatim (same column selection, same key-shape, same handicapIndexByPlayer source = `players.manualHandicapIndex`). A `// FOLLOWUP T6-8d: dedupe with services/money.ts` comment marks both call sites.
  - **Why not extract a helper now:** services/money.ts is intricate (T6-5 + T6-5a integration); a refactor risks regression in already-shipped money-matrix correctness for a target-miss-tolerable story. T6-8d defers the dedupe to a focused refactor story when the v1.5 organizer-listing endpoint (T6-8a) ships and there'd be 3+ call sites.
- **Sign-flip bug surface.** The most likely bug class: forgetting to flip the sign when viewer === playerB. AC-10 names this explicitly; the integration test covers both directions on the same bet.
