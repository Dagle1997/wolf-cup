# T5-6: Score POST + require-scorer-for-round Middleware (single-writer enforcement) [new]

## Status

Ready for Dev

## Story

As a developer,
I want `POST /api/rounds/:roundId/holes/:holeNumber/scores` behind a `require-scorer-for-round` middleware that checks `session.userId === scorer_assignments.scorer_player_id` for the foursome containing the target player,
So that a non-scorer participant physically cannot write scores — even if they construct the request by hand (FR-B10, NFR-S3, FR-H3).

T5-6 is the **server-side enforcement boundary** for FR-B10 (one scorer per foursome). It pairs the middleware (the auth gate) with the score POST endpoint (the actual write path). Together they implement: idempotent dedupe via T5-1's dual-UNIQUE, 409 cell-collision surface for D3-3, audit-log emission for `score.committed`, first-commit state transition `not_started → in_progress`, and auto-transition `in_progress → complete_editable` when all expected cells fill.

T5-6 is invoked second in Josh's Option-A sequencing: T5-3 ✓ → **T5-6 (this)** → T5-2 (UI port).

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

This story touches:

- `apps/tournament-api/src/middleware/require-scorer-for-round.ts` — NEW (~150 lines; mirrors `require-event-participant.ts` pattern + body-parse + 14-path error taxonomy)
- `apps/tournament-api/src/middleware/require-scorer-for-round.test.ts` — NEW (integration tests against stub Hono app)
- `apps/tournament-api/src/routes/scores.ts` — NEW (~280 lines; the POST endpoint + state-transition + audit + activity stub; exports `scorePostBodySchema` + `ScorePostBody` type)
- `apps/tournament-api/src/routes/scores.integration.test.ts` — NEW (full POST integration tests)
- `apps/tournament-api/src/lib/audit-log.ts` — NEW (~60 lines; `writeAudit(tx, ...)` helper that INSERTs into the T5-1 `audit_log` table; exports `AUDIT_EVENT_TYPES` + `AUDIT_ENTITY_TYPES` shared constants)
- `apps/tournament-api/src/lib/audit-log.test.ts` — NEW (unit tests for writeAudit)
- `apps/tournament-api/src/lib/activity.ts` — NEW (~40 lines; `emitActivity(tx, ...)` stub that's a no-op v1; T8 will replace with the activity spine)
- `apps/tournament-api/src/lib/activity.test.ts` — NEW (one test asserting v1 is a no-op + the type-shape contract for T8)
- `apps/tournament-api/src/types/hono.d.ts` — modified (extends ContextVariableMap with optional `scorePostBody?: ScorePostBody`)
- `apps/tournament-api/src/app.ts` — modified (mount `/api/rounds` router with the new scoresRouter)

**Zero SHARED files.** No `package.json` change. No `pnpm-lock.yaml` change.

**Zero FORBIDDEN edits.** No Wolf Cup paths.

### 2. Dependencies + forward references

**Met dependencies:**
- T4-2 ✓ — `pairings` + `pairing_members` (foursome membership lookup)
- T5-1 ✓ — `scorer_assignments`, `hole_scores` (dual-UNIQUE design verified), `round_states`, `rounds`, `audit_log`

**Forward dependencies (T5-6 ships placeholders / inline logic; future stories refactor):**
- **T5-8 `transitionState` service** — T5-6's score handler implements first-commit transition (`not_started → in_progress`) AND auto-complete transition (`in_progress → complete_editable` when all cells filled) **inline** within the score POST transaction. T5-8 will later extract these into the `transitionState(tx, roundId, to, actorPlayerId)` service. T5-6's inline logic will be reused/refactored at that point. Document this expectation in `scores.ts` header comments.
- **T8 `emitActivity`** — T5-6 ships a stub `emitActivity(tx, ...)` in `apps/tournament-api/src/lib/activity.ts` that is a NO-OP at runtime (returns Promise.resolve()) but with a typed signature consumer code can call without modification when T8 wires the real implementation. The stub's test asserts (a) it's a no-op (zero rows written anywhere), (b) the type signature accepts the v1 activity shape `{ type, actorPlayerId, payload, scope }` (so T8 can change the implementation without breaking T5-6's call sites).
- **T5-9 `score_corrections`** — score CORRECTIONS are out of scope for T5-6. The score POST is INSERT-only (cell-create or dedupe). Edits to existing cells go through T5-9's correction endpoint.

### 3. Middleware contract — `require-scorer-for-round`

Per epic AC line 1438-1440. **Body-parse responsibility lives in the middleware** (NOT in the handler) so we don't rely on Hono's body-cache and we have a single source of truth for body validation. The middleware:

1. Reads `session.userId` from `c.get('player').id` (set by `requireSession` upstream — middleware MUST be mounted after `requireSession`). If `c.get('player')` is undefined → 500 `middleware_misuse`.
2. Reads `:roundId` from `c.req.param('roundId')`; if empty → 500 `middleware_misuse_no_round_id`. **Then validates UUID-shape** (any UUID variant, case-insensitive — tournament uses `crypto.randomUUID()` which is v4 but the regex doesn't pin the variant since Drizzle PKs aren't variant-locked): `!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roundId)` → 400 `{ error: 'bad_request', code: 'invalid_round_id', requestId }`.
3. Reads `:holeNumber` from `c.req.param('holeNumber')`; parses as integer; if NaN OR not in [1,18] → 400 `{ error: 'bad_request', code: 'invalid_hole_number', requestId }`.
4. **Parses + Zod-validates the body via `safeParse(scorePostBodySchema)` (the same schema the handler would use; centralized here)**. **Wrap `await c.req.json()` in try/catch** — if the body is missing or malformed JSON (`SyntaxError`), return 400 `{ error: 'bad_request', code: 'invalid_body', requestId, reason: 'malformed_json' }` rather than letting Hono's default error handler emit a 500. Then `scorePostBodySchema.safeParse(...)`. If Zod parse fails → 400 `{ error: 'validation_error', code: 'invalid_body', issues: parsed.error.issues, requestId }`. On success, stores the parsed body via `c.set('scorePostBody', parsed.data)` (typed via `ContextVariableMap` extension in `apps/tournament-api/src/types/hono.d.ts`). The handler reads via `c.get('scorePostBody')` — no second parse, no body-cache reliance.
5. **Round existence check** (BEFORE pairings/scorer lookups so a non-existent roundId returns the precise `round_not_found` code, not `player_not_in_any_foursome`):
   `SELECT id, event_round_id FROM rounds WHERE id = :roundId AND tenant_id = :TENANT_ID`. If 0 rows → 404 `{ error: 'not_found', code: 'round_not_found', requestId }`. Otherwise `round.event_round_id` is captured for the pairings join below.

6. **Two-phase scorer lookup** (computes both states so the middleware can emit the more specific 403 code):
   (a) Fetch ALL scorer_assignments rows for this round: `SELECT round_id, foursome_number, scorer_player_id FROM scorer_assignments WHERE round_id = :roundId AND tenant_id = :TENANT_ID`. Call this `roundScorers`.
   (b) Fetch the foursome containing `body.playerId`: `SELECT pairings.foursome_number FROM pairing_members JOIN pairings ON pairing_members.pairing_id = pairings.id WHERE pairings.event_round_id = :round.event_round_id AND pairing_members.player_id = :body.playerId AND pairings.tenant_id = :TENANT_ID AND pairing_members.tenant_id = :TENANT_ID LIMIT 1`. Call this `targetFoursome`.

   Decision tree:
   - If `targetFoursome` is empty → 404 `{ error: 'not_found', code: 'player_not_in_any_foursome', requestId }`. (Player not in any pairing for this round.)
   - Else find `targetScorer = roundScorers.find(s => s.foursome_number === targetFoursome.foursome_number)`. If `targetScorer` is undefined (no scorer assigned for that specific foursome) → 422 `{ error: 'unprocessable', code: 'foursome_has_no_scorer', requestId }`.
   - Else if `targetScorer.scorer_player_id === session.userId` → `next()`. ✓
   - Else (the session is NOT the scorer of the target foursome). Now check whether the session is a scorer of ANY OTHER foursome in this round:
     - If `roundScorers.some(s => s.scorer_player_id === session.userId)` → 403 `{ error: 'forbidden', code: 'player_not_in_your_foursome', currentScorerPlayerId: targetScorer.scorer_player_id, currentScorerName, requestId }` (session IS scoring some foursome, but not this one).
     - Else → 403 `{ error: 'forbidden', code: 'not_scorer_for_this_foursome', currentScorerPlayerId: targetScorer.scorer_player_id, currentScorerName, requestId }` (session is not a scorer in this round at all).

The two 403 codes give the client UI distinct error states: `player_not_in_your_foursome` lets the UI suggest "you're scoring foursome N; this player is in a different foursome" while `not_scorer_for_this_foursome` lets the UI suggest "you're not the scorer here; ask <currentScorerName> to enter the score."

`currentScorerName` is fetched via a final `SELECT name FROM players WHERE id = :targetScorer.scorer_player_id AND tenant_id = :TENANT_ID` — extra query, but only on the 403 path (not on the happy `next()` path).

### 4. Score POST endpoint — `POST /api/rounds/:roundId/holes/:holeNumber/scores`

Per epic AC line 1442-1453.

**Mount**: `app.route('/api/rounds', scoresRouter)` with `requireSession` then `requireScorerForRound` then the handler. The route shape: `POST /:roundId/holes/:holeNumber/scores`.

**Body shape** (Zod schema lives in `apps/tournament-api/src/routes/scores.ts` as `scorePostBodySchema` and is exported so the middleware can reference it — single source of truth):
```ts
export const scorePostBodySchema = z.object({
  playerId: z.string().uuid(),
  grossStrokes: z.number().int().min(1).max(20),
  putts: z.number().int().min(0).max(15).nullable().optional(),
  clientEventId: z.string().min(1).max(128),
});
export type ScorePostBody = z.infer<typeof scorePostBodySchema>;
```

The middleware imports + uses this schema (per Risk Acceptance §3 step 4); the handler reads the parsed body via `c.get('scorePostBody')`. **No second parse in the handler.**

`apps/tournament-api/src/types/hono.d.ts` extends `ContextVariableMap` to add `scorePostBody?: ScorePostBody` (optional — only set on routes that mount `requireScorerForRound`).

Path params validation: middleware validates `roundId` (UUID-shape regex per §3 step 2) and `holeNumber` (integer 1-18 per §3 step 3) BEFORE body parse. Handler additionally validates `holeNumber <= round.holesToPlay` (defense + 9-hole-round support per Risk Acceptance §6 below).

**Transaction logic — step-list** (the dev implements idiomatically; **every SELECT/INSERT/UPDATE filters on `tenant_id = TENANT_ID` per §10 — the steps below show predicates inline so the requirement is unambiguous**):

1. **Fetch round** (the middleware already returned 404 for nonexistent roundId; this is defense-in-depth + a way to read `round.holesToPlay` + `round.eventRoundId` for downstream steps): `SELECT * FROM rounds WHERE id = :roundId AND tenant_id = :TENANT_ID`. Capture as `round`. If 0 rows → 404 `round_not_found` (defense-in-depth; should never fire in practice).

2. **Validate holeNumber against round.holesToPlay**: if `holeNumber > round.holesToPlay` → 422 `{ error: 'unprocessable', code: 'hole_number_exceeds_holes_to_play', holesToPlay: round.holesToPlay, requestId }`. (Catches 9-hole rounds being asked to score hole 10+.)

3. **Fetch round_states**: `SELECT * FROM round_states WHERE round_id = :roundId AND tenant_id = :TENANT_ID`. Capture as `rs`.
   - If 0 rows → 422 `round_state_missing`. (Pre-T5-8 setup miss; T5-8 will seed; T5-6 tests seed manually.)
   - If `rs.state ∉ ('not_started', 'in_progress', 'complete_editable')` → 422 `round_not_writable` with `currentState: rs.state`.

4. **INSERT hole_score with idempotent dedupe target**:
   ```ts
   const insertId = crypto.randomUUID();
   const now = Date.now();
   const result = await tx.insert(holeScores).values({
     id: insertId,
     roundId,
     playerId: body.playerId,
     holeNumber,
     grossStrokes: body.grossStrokes,
     putts: body.putts ?? null,
     scorerPlayerId: session.userId,
     clientEventId: body.clientEventId,
     createdAt: now,
     updatedAt: now,
     tenantId: TENANT_ID,
     contextId: round.contextId,
   })
   .onConflictDoNothing({
     target: [holeScores.roundId, holeScores.playerId, holeScores.holeNumber, holeScores.clientEventId],
   })
   .returning({ id: holeScores.id });
   ```
   - **Catch SQLite UNIQUE error** (cell-level UNIQUE — different client_event_id at same cell): re-fetch existing row tenant-scoped (`SELECT scorerPlayerId, createdAt, clientEventId FROM hole_scores WHERE round_id = :roundId AND player_id = :body.playerId AND hole_number = :holeNumber AND tenant_id = :TENANT_ID LIMIT 1`); build `conflictingEntry = existing.length > 0 ? {...mapped fields} : null` per §11; return 409 `hole_already_scored`.
   - **Else if `result.length === 0`** → dedupe target hit (same client_event_id replay): return 200 `{ status: 'ok', clientEventId, deduped: true }`. No audit row. No activity.
   - **Else `result.length === 1`** → new cell created; continue to step 5.

5. **Write audit + activity** (new cell only):
   - `writeAudit(tx, { eventType: AUDIT_EVENT_TYPES.SCORE_COMMITTED, entityType: AUDIT_ENTITY_TYPES.HOLE_SCORE, entityId: insertId, actorPlayerId: session.userId, payload: {...} })`.
   - `emitActivity(tx, { type: 'score.committed', actorPlayerId: session.userId, payload: {...}, scope: { eventId: round.eventId, roundId } })`.

6. **First-commit state transition** (only when `rs.state === 'not_started'`):
   - `UPDATE round_states SET state='in_progress', entered_at=:now, entered_by_player_id=:session.userId WHERE round_id=:roundId AND tenant_id=:TENANT_ID`.
   - `UPDATE rounds SET opened_at=:now, opened_by_player_id=:session.userId WHERE id=:roundId AND tenant_id=:TENANT_ID`.
   - `writeAudit(tx, { eventType: AUDIT_EVENT_TYPES.ROUND_STATE_CHANGED, entityType: AUDIT_ENTITY_TYPES.ROUND, entityId: roundId, actorPlayerId: session.userId, payload: { from: 'not_started', to: 'in_progress' } })`.

7. **Auto-complete detection** (when `rs.state === 'not_started'` OR `rs.state === 'in_progress'`):
   - `expected = await computeExpectedCells(tx, round)` — passes the row, NOT the id.
   - Compute `actualCount` per §7's actualCount sketch (tenant-scoped, hole_number ≤ holes_to_play).
   - If `actualCount >= expected` → `UPDATE round_states SET state='complete_editable', entered_at=:now2, entered_by_player_id=:session.userId WHERE round_id=:roundId AND tenant_id=:TENANT_ID` + `writeAudit({...payload: { from: rs.state === 'not_started' ? 'in_progress' : rs.state, to: 'complete_editable' }})`. (The `from` reflects the post-step-6 state for the not_started case.)

8. **Return 201** with `{ status: 'ok', clientEventId, holeScoreId: insertId, deduped: false }`.

**Important contract details:**
- The whole flow is wrapped in `db.transaction(async (tx) => { ... })`. Any thrown exception rolls back all writes (including audit rows).
- Steps 6 + 7 happen within the SAME transaction as the score insert, so a crash mid-transaction leaves no partial state.
- `currentScorerName` lookup on 403 paths (middleware §3 step 6 decision tree): if the `players` row for `targetScorer.scorer_player_id` doesn't exist (referential integrity should prevent this — `scorer_assignments.scorer_player_id` is FK RESTRICT to `players.id` per T5-1, but defense-in-depth), use `currentScorerName: null` rather than throwing.

### 5. `writeAudit` helper

`apps/tournament-api/src/lib/audit-log.ts`:

```ts
export async function writeAudit(
  tx: SQLiteTransaction,
  args: {
    eventType: string;     // e.g. 'score.committed', 'round.state_changed'
    entityType: string;    // e.g. 'hole_score', 'round'
    entityId: string;      // the record id
    actorPlayerId: string | null;  // null for system events
    payload: unknown;      // event-specific data; serialized to JSON
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    id: crypto.randomUUID(),
    eventType: args.eventType,
    entityType: args.entityType,
    entityId: args.entityId,
    actorPlayerId: args.actorPlayerId,
    payloadJson: JSON.stringify(args.payload),
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `audit:${args.entityType}`,
  });
}
```

Plus shared constants for the canonical event_type / entity_type strings (per T5-1 spec Risks — typo-fragmentation guard):

```ts
export const AUDIT_EVENT_TYPES = {
  SCORE_COMMITTED: 'score.committed',
  SCORE_CORRECTED: 'score.corrected',  // T5-9
  ROUND_STATE_CHANGED: 'round.state_changed',
  SCORER_TRANSFERRED: 'scorer.transferred',  // T5-7
  ROUND_FINALIZED: 'round.finalized',  // T5-8
} as const;

export const AUDIT_ENTITY_TYPES = {
  HOLE_SCORE: 'hole_score',
  ROUND: 'round',
  SESSION: 'session',  // T7-6
} as const;
```

T5-6 callers MUST use these constants; T5-7/T5-8/T5-9/T7-6 will extend.

### 6. `emitActivity` stub

`apps/tournament-api/src/lib/activity.ts`:

```ts
/**
 * v1 stub. T8 (activity spine epic) will replace with the real implementation
 * (writes to activity_events table + emits to in-app feed). T5-6+ callers
 * keep using this stub; T8 changes ONLY the function body.
 */
export async function emitActivity(
  _tx: SQLiteTransaction,
  _args: {
    type: string;
    actorPlayerId: string;
    payload: unknown;
    scope: { eventId?: string; roundId?: string };
  },
): Promise<void> {
  // No-op v1. T8 will implement.
}
```

The test asserts: (a) the function returns a resolved promise without writing to any table, (b) the typed signature accepts the v1 score-committed shape.

### 7. `computeExpectedCells` helper (round-scoped, used by auto-complete detection)

Helper signature: `async function computeExpectedCells(tx, round: Round): Promise<number>`. Takes the already-fetched `rounds` row (with `eventRoundId` + `holesToPlay`) so callers don't re-query.

Definition: `expected = (count of distinct player_ids assigned to any pairing for this round's event_round_id) × round.holesToPlay`. **"count of distinct player_ids" = the total roster size for the round across all foursomes**, NOT a per-foursome count. (Epic AC line 1524 uses the phrase "pairing_members.count_for_this_round" which is ambiguous; this spec resolves it to the distinct-roster interpretation.) Implementation:

```ts
const result = await tx
  .select({ count: sql<number>`count(distinct ${pairingMembers.playerId})` })
  .from(pairingMembers)
  .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
  .where(and(
    eq(pairings.eventRoundId, round.eventRoundId!),  // non-null in v1; null only in v1.5 standalone-rounds
    eq(pairings.tenantId, TENANT_ID),
    eq(pairingMembers.tenantId, TENANT_ID),
  ));
return (result[0]?.count ?? 0) * round.holesToPlay;
```

`actualCount` for auto-complete detection: counts hole_scores rows for this round filtered to `hole_number <= round.holesToPlay` (so a 9-hole round only counts holes 1-9 toward completion):

```ts
const actual = await tx
  .select({ count: sql<number>`count(*)` })
  .from(holeScores)
  .where(and(
    eq(holeScores.roundId, round.id),
    eq(holeScores.tenantId, TENANT_ID),
    sql`${holeScores.holeNumber} <= ${round.holesToPlay}`,
  ));
const actualCount = actual[0]?.count ?? 0;
```

If `actualCount >= expectedCount` → auto-transition to `complete_editable`. **(>=, not ==, defensively — if a future bug somehow over-fills, we still transition rather than miss the boundary.)**

This helper lives inline in `scores.ts` v1. T5-8 will likely promote it to `apps/tournament-api/src/services/round-state.ts` when the FSM is extracted.

### 8. Body-parse / middleware ordering — RESOLVED via context-storage

The middleware reads + Zod-parses the body ONCE via `await c.req.json()` + `scorePostBodySchema.safeParse(...)`. On success, it stores the parsed body via `c.set('scorePostBody', parsed.data)`. The handler reads via `c.get('scorePostBody')` — single parse, explicit context flow, no Hono-cache reliance. ContextVariableMap typing extended in `apps/tournament-api/src/types/hono.d.ts`.

### 9. Error code taxonomy (14 distinct paths)

Grouped by precedence (highest-precedence first; the FIRST matching path determines the response):

**Misuse (developer bug):**
| Path | Status | Code | Where |
|---|---|---|---|
| requireSession not ahead of middleware | 500 | `middleware_misuse` | middleware §3 step 1 |
| Route mounted without `:roundId` param | 500 | `middleware_misuse_no_round_id` | middleware §3 step 2 |

**Bad request (client malformed):**
| Path | Status | Code | Where |
|---|---|---|---|
| Invalid roundId UUID | 400 | `invalid_round_id` | middleware §3 step 2 |
| Invalid holeNumber (not integer / not 1-18) | 400 | `invalid_hole_number` | middleware §3 step 3 |
| Invalid body (Zod parse failure) | 400 | `invalid_body` | middleware §3 step 4 |

**Auth (unauthenticated/forbidden):**
| Path | Status | Code | Where |
|---|---|---|---|
| No session | 401 | (requireSession standard) | upstream middleware |
| Session is not scorer of any foursome in this round | 403 | `not_scorer_for_this_foursome` | middleware §3 step 5 (decision-tree leaf) |
| Session is scorer of a different foursome than body.playerId's | 403 | `player_not_in_your_foursome` | middleware §3 step 5 (decision-tree leaf) |

**Lookup failure:**
| Path | Status | Code | Where |
|---|---|---|---|
| body.playerId not in any foursome for this round | 404 | `player_not_in_any_foursome` | middleware §3 step 5 |
| roundId doesn't exist OR foreign tenant | 404 | `round_not_found` | middleware §3 step 5 (primary); handler step 1 (defense-in-depth) |
| Foursome has no scorer assigned (setup error) | 422 | `foursome_has_no_scorer` | middleware §3 step 5 |

**State / business rule:**
| Path | Status | Code | Where |
|---|---|---|---|
| holeNumber > rounds.holes_to_play (e.g., hole 10 in a 9-hole round) | 422 | `hole_number_exceeds_holes_to_play` | handler step 2 |
| round_states row missing | 422 | `round_state_missing` | handler step 3 |
| Round state not writable (`finalized` / `cancelled`) | 422 | `round_not_writable` | handler step 3 |

**Conflict:**
| Path | Status | Code | Where |
|---|---|---|---|
| Different clientEventId at same cell | 409 | `hole_already_scored` | handler step 4 (cell-level UNIQUE catch) |

**Happy:**
| Path | Status | Code | Where |
|---|---|---|---|
| Same clientEventId replay (idempotent) | 200 | `status='ok'`, `deduped: true` | handler step 4 |
| New cell created | 201 | `status='ok'`, `deduped: false` | handler step 8 |

**Precedence ordering (deterministic; tests pin):**
1. requireSession (401 if no session)
2. Misuse 500s (developer bug; checked before lookups)
3. Path-param 400s (cheap to validate; reject bad shapes early)
4. Body 400 (Zod parse)
5. Lookup 404 (player_not_in_any_foursome) → 422 (foursome_has_no_scorer)
6. Auth 403 (the two scorer-mismatch codes)
7. Round state 422s (state_missing → not_writable → hole_number_exceeds_holes_to_play)
8. 409 cell collision
9. 200 deduped / 201 created

### 10. Tenant scoping coverage

EVERY SELECT/INSERT/UPDATE in the middleware + route MUST filter on `tenant_id = TENANT_ID`. Post-T3-7 hardening pattern. Use the **module-local constant** `const TENANT_ID = 'guyan'` in both `scores.ts` and `require-scorer-for-round.ts` — match the existing pattern in `require-event-participant.ts`. Spec uses `TENANT_ID` consistently throughout (any earlier inconsistency where `TENANT` was used is unintentional).

Audit log writes inherit `tenant_id` via `ecosystemColumns()` default + explicit `contextId: 'audit:<entity_type>'`.

### 11. Conflict-path defensive fallback

When the cell-level UNIQUE throws (different clientEventId at same cell), the handler fetches the existing row to populate the `conflictingEntry` payload. **Defensive fallback**: if the SELECT returns 0 rows (theoretically impossible — the UNIQUE only throws when a row exists — but defense-in-depth against IDB-level race conditions), the handler returns 409 with `conflictingEntry: null` rather than throwing. The 409 contract still holds; the client UI handles a null conflictingEntry by re-fetching the round state.

### 11. Wolf Cup port faithfulness

T5-6 is `[new]` per epic — no Wolf Cup analog. Wolf Cup's score POST is at `apps/api/src/routes/rounds/[roundId]/groups/[groupId]/holes/[holeNumber]/scores` (different shape due to groupId, not roundId-only). T5-6 doesn't port; designs fresh. No PORTS.md row.

## Acceptance Criteria

**AC #1 — `require-scorer-for-round.ts` middleware shape**

Given `apps/tournament-api/src/middleware/require-scorer-for-round.ts`
When inspected
Then it exports `requireScorerForRound: MiddlewareHandler` that performs (in order):
- Read `c.get('player')`; if undefined → 500 `middleware_misuse`.
- Read `c.req.param('roundId')`; if empty → 500 `middleware_misuse_no_round_id`. Then validate UUID shape (regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, case-insensitive); if mismatch → 400 `invalid_round_id`.
- Read `c.req.param('holeNumber')`; parse as integer; if NaN OR not in [1,18] → 400 `invalid_hole_number`.
- Parse + Zod-validate the request body via `scorePostBodySchema.safeParse(await c.req.json())`. If parse fails → 400 `invalid_body` with `issues: parsed.error.issues`. On success store via `c.set('scorePostBody', parsed.data)`.
- Lookup `rounds` row by id + tenant. If 0 rows → 404 `round_not_found`. Capture `round.event_round_id` for the next step.
- Two-phase scorer lookup per Risk Acceptance §3 step 6: (a) `roundScorers` (all scorer_assignments for this round), (b) `targetFoursome` (foursome containing `body.playerId` via pairing_members join). Apply the decision tree:
  - `targetFoursome` empty → 404 `player_not_in_any_foursome`.
  - `targetScorer` undefined → 422 `foursome_has_no_scorer`.
  - `targetScorer.scorer_player_id === session.userId` → `c.set('scorePostBody', ...)` already done; call `next()`.
  - Else if `roundScorers.some(s => s.scorer_player_id === session.userId)` → 403 `player_not_in_your_foursome` with `currentScorerPlayerId` + `currentScorerName`.
  - Else → 403 `not_scorer_for_this_foursome` with `currentScorerPlayerId` + `currentScorerName`.
- Tenant-scoped on every SELECT (`rounds.tenant_id`, `pairings.tenant_id`, `pairing_members.tenant_id`, `scorer_assignments.tenant_id`, `players.tenant_id` for the name lookup) using the module-local `TENANT_ID = 'guyan'`.
- All response bodies include `requestId` from `c.get('requestId') ?? randomUUID()` per existing convention.

**AC #2 — `scores.ts` route shape + handler logic**

Given `apps/tournament-api/src/routes/scores.ts`
When inspected
Then it mounts `POST /:roundId/holes/:holeNumber/scores` (relative path; mounted at `/api/rounds`) chained as `requireSession → requireScorerForRound → handler`. Handler uses `db.transaction` for atomic write + audit + state-transition. Body validated via Zod (shape per Risk Acceptance §4). Path params validated (UUID for roundId; integer 1-18 for holeNumber).

**AC #3 — Idempotent dedupe via dual-UNIQUE ON CONFLICT target**

Given a request with body `{ playerId, grossStrokes, putts, clientEventId='evt-X' }` repeated twice
When the handler runs both times
Then the first call returns 201 + new row in hole_scores + audit row written. The SECOND call returns 200 + `{ status: 'ok', clientEventId: 'evt-X', deduped: true }` + NO new row + NO audit row written. Verified via T5-1's `onConflictDoNothing({ target: [round_id, player_id, hole_number, client_event_id] })`.

**AC #4 — Cell collision returns 409 with conflictingEntry payload**

Given an existing row for cell (round, player, hole) with `clientEventId='evt-A'`
When a new request arrives with the same cell but `clientEventId='evt-B'`
Then the cell-level UNIQUE throws SQLITE_CONSTRAINT_UNIQUE; the handler catches, fetches the existing row, returns 409 `{ error: 'conflict', code: 'hole_already_scored', conflictingEntry: { scorer_player_id, created_at, client_event_id }, requestId }`. NO new row inserted; NO audit row written.

**AC #5 — Middleware 403 path distinguishes the two scorer-mismatch codes**

Given a session whose userId is not the scorer of any foursome in the round
When POSTing for some valid playerId in the round
Then 403 `{ code: 'not_scorer_for_this_foursome', currentScorerPlayerId, currentScorerName, requestId }`.

Given a session whose userId IS the scorer of foursome 1 but NOT foursome 2
When POSTing for a playerId in foursome 2
Then 403 `{ code: 'player_not_in_your_foursome', currentScorerPlayerId, currentScorerName, requestId }`.

The two codes are distinct so the client UI can differentiate "you're not a scorer at all" from "you're scoring the wrong group's player."

**AC #6 — First-commit state transition + auto-complete detection**

Given a fresh round with `round_states.state = 'not_started'`
When the first valid score POST commits
Then the same transaction updates `round_states.state = 'in_progress'`, sets `rounds.opened_at` + `rounds.opened_by_player_id`, and writes an audit row `{ eventType: 'round.state_changed', payload: { from: 'not_started', to: 'in_progress' } }`.

Given a round with all-but-one expected cells filled (state = `'in_progress'`)
When the LAST expected cell commits
Then the same transaction transitions `round_states.state = 'complete_editable'` and writes a `round.state_changed` audit row.

**AC #7 — Tests**

Given `apps/tournament-api/src/middleware/require-scorer-for-round.test.ts` + `apps/tournament-api/src/routes/scores.integration.test.ts` + `apps/tournament-api/src/lib/audit-log.test.ts` + `apps/tournament-api/src/lib/activity.test.ts`
When `pnpm -F @tournament/api test` runs
Then a **net +20 or more new passing tests** vs the start-of-story baseline (468 → ≥488). No previously-passing test goes red. typecheck + lint clean.

Test attribution (minimum):

- `require-scorer-for-round.test.ts` (10 tests — one per error-taxonomy path that's middleware-layer):
  1. 500 middleware_misuse when requireSession not ahead.
  2. 500 middleware_misuse_no_round_id when route lacks `:roundId` param.
  3. 400 invalid_round_id when path :roundId fails UUID-shape regex.
  4. 400 invalid_hole_number when :holeNumber is not an integer in [1,18].
  5. 400 invalid_body when Zod parse fails (e.g., body lacks `playerId`).
  6. 404 player_not_in_any_foursome when body.playerId isn't in any pairing for the round.
  7. 422 foursome_has_no_scorer when scorer_assignments row missing.
  8. 403 not_scorer_for_this_foursome when session is not a scorer in any foursome of this round.
  9. 403 player_not_in_your_foursome when session IS scoring foursome 1 but body.playerId is in foursome 2.
  10. next() invoked + `c.get('scorePostBody')` returns the parsed body when session matches the foursome's assigned scorer (happy path; verified via stub handler reading the context).

- `scores.integration.test.ts` (8 tests):
  1. 201 happy path: new cell created; audit row written; activity stub called (no-op verified — zero rows in any table other than hole_scores + audit_log).
  2. 200 deduped: same clientEventId replay; no new row in hole_scores; no audit row.
  3. 409 hole_already_scored: different clientEventId at same cell; conflictingEntry payload populated with scorer_player_id + created_at + client_event_id.
  4. 422 round_not_writable: state = 'finalized' rejects writes.
  5. 422 hole_number_exceeds_holes_to_play: holeNumber=10 in a 9-hole round.
  6. State transition: not_started → in_progress on first commit, with audit row + rounds.opened_at populated.
  7. State transition: in_progress → complete_editable on last-cell commit, with audit row.
  8. Tenant scoping defense-in-depth: foreign-tenant round → 404 round_not_found.

- `audit-log.test.ts` (1 test):
  1. writeAudit inserts a row with all fields populated; payload_json round-trips via JSON.parse; AUDIT_EVENT_TYPES + AUDIT_ENTITY_TYPES constants exported and used.

- `activity.test.ts` (1 test):
  1. emitActivity is a no-op (returns Promise<void>; no IO; no rows written to any table). Type signature accepts the v1 score-committed shape (compile-time check via type-only assertion).

Total: 20 tests. Floor: +20.

**AC #8 — Wolf Cup regression clean**

Given the full regression sweep
When run after T5-6's commits
Then engine 472 / api 507 unchanged; tournament-web 78 unchanged; typecheck + lint clean across all workspaces.

**AC #9 — `app.ts` mount**

Given `apps/tournament-api/src/app.ts`
When inspected
Then it imports `scoresRouter` from `./routes/scores.js` and calls `app.route('/api/rounds', scoresRouter)`. Mount order: AFTER existing `/api/auth`, `/api/courses`, etc. — preserves existing routes' precedence.

**AC #10 — ZERO Wolf Cup edits, ZERO SHARED edits**

Given `git diff --name-only` after T5-6's commits
When the path list is enumerated
Then NO file in `apps/api/`, `apps/web/`, `packages/engine/` is modified. NO `package.json` / `pnpm-lock.yaml` / `docker-compose*.yml` / `.github/**` is modified.

## Tasks

1. Capture start-of-story baseline test counts: `pnpm -F @tournament/api test` → record passing count.
2. Read the existing middleware patterns (`require-event-participant.ts`, `require-organizer.ts`) for tenant-scoping conventions and the `c.get('player')` / `c.get('requestId')` flow.
3. Write `apps/tournament-api/src/lib/audit-log.ts` with `writeAudit` + `AUDIT_EVENT_TYPES` + `AUDIT_ENTITY_TYPES` constants.
4. Write `apps/tournament-api/src/lib/audit-log.test.ts` (1 test).
5. Write `apps/tournament-api/src/lib/activity.ts` with the `emitActivity` no-op stub.
6. Write `apps/tournament-api/src/lib/activity.test.ts` (1 test).
7. Write `apps/tournament-api/src/routes/scores.ts` exporting `scorePostBodySchema` + `ScorePostBody` type FIRST (so the middleware can import the schema). Initial export-only stub; full handler comes in step 10.
8. Modify `apps/tournament-api/src/types/hono.d.ts` to add `scorePostBody?: ScorePostBody` to ContextVariableMap.
9. Write `apps/tournament-api/src/middleware/require-scorer-for-round.ts` per AC #1 (imports schema from scores.ts).
10. Write `apps/tournament-api/src/middleware/require-scorer-for-round.test.ts` per AC #7 (10 tests).
11. Complete `apps/tournament-api/src/routes/scores.ts` handler per AC #2 + AC #3 + AC #4 + AC #6 (handler + state transitions inline + computeExpectedCells helper).
12. Write `apps/tournament-api/src/routes/scores.integration.test.ts` per AC #7 (8 tests).
13. Modify `apps/tournament-api/src/app.ts` to mount `/api/rounds → scoresRouter`.
14. Run `pnpm -F @tournament/api test` — confirm net +20 passing per AC #7. Run `pnpm -r typecheck` + `pnpm -r lint` — confirm clean.
15. Run `pnpm --filter @wolf-cup/engine test` + `pnpm --filter @wolf-cup/api test` — confirm baseline (Wolf Cup regression check per AC #8).

## Test strategy

- **Middleware unit tests** — stub Hono app + mock session via test fixture; assert each error path returns the documented status + code.
- **Integration tests** — full POST against real libsql `:memory:` DB with all migrations applied; seed event/round/pairing/scorer; POST and verify (a) hole_scores rows, (b) round_states transitions, (c) audit_log rows, (d) activity stub called (verify via spy).
- **State transition tests** — assert the DB row updates by querying `round_states` after the POST.
- **Tenant scoping** — assert a foreign-tenant round returns 404 (defensive — middleware would also catch via foursome lookup, but defense-in-depth).

## Followups

- T5-2 (scorer entry UI) calls this endpoint via the T5-3 offline queue with `enqueueMutation({ kind: 'hole_score', url: '/api/rounds/${roundId}/holes/${holeNumber}/scores', body: {...includes clientEventId...}, clientEventId, roundId })`. Will register terminal errors for `'hole_score'` (e.g. `['round_not_writable', 'player_not_in_your_foursome', 'foursome_has_no_scorer']`).
- T5-7 (scorer handoff) writes `scorer_assignments` updates; when stale offline mutations drain post-handoff, they hit T5-6's middleware and 403 with `currentScorerName` so the client UI can route the user to T5-9.
- T5-8 (round lifecycle state machine) refactors T5-6's inline state transition logic into the `transitionState(tx, roundId, to, actorPlayerId)` service. T5-6's call sites change minimally (one-line refactor each).
- T5-9 (score correction endpoint) writes `score_corrections` rows for edits to existing cells. T5-6 stays INSERT-only.
- T8 (activity spine) replaces `emitActivity`'s no-op with the real implementation. T5-6's call sites are unchanged.

## Risks

- **Hono body-cache** — T5-6 relies on `c.req.json()` returning the same parsed body when called from middleware AND from the handler. Hono docs say it caches; **verify at task step 3** before committing the implementation. If the cache doesn't work, the middleware reads + re-attaches via `c.set('parsedBody', ...)` for the handler to re-use. Documented as a single point of integration risk.

- **State-transition logic INLINE in T5-6** — T5-8 owns the full FSM via `transitionState`. T5-6 implements first-commit + auto-complete inline. **Risk: if T5-8 changes the canonical transition rules later, T5-6's inline code needs to match.** Mitigation: T5-6's audit-row payloads use the same `eventType: 'round.state_changed'` shape T5-8 will use; T5-8 just refactors the call site, not the audit contract.

- **`expected_cells` calculation** — `pairing_members.count_for_round × rounds.holes_to_play` — assumes every player in every pairing is expected to score every hole. **Risk**: a 9-hole round (`holes_to_play=9`) needs `actualCount` to be filtered to `hole_number <= 9`. The spec mandates this filter (epic AC line 1524). **Risk: a sub'd-out player who didn't play would block auto-complete.** v1 doesn't model subs at the scoring level; the leaderboard substitution logic is T5-9 territory. Documented as a v1 simplification — in 4-Pinehurst-rounds-no-subs scenarios this is fine; sub handling lands later.

- **`emitActivity` stub forward-compat** — T8 will replace the no-op with a real activity-event write. If T8's signature changes (e.g., adds a required field), T5-6's call sites would break. Mitigation: T5-6's call sites use a minimal payload `{ type, actorPlayerId, payload, scope }` that T8's spec already mandates as the v1 contract. If T8 later adds REQUIRED fields, that's a breaking change that needs a coordinated update — but T8 is incentivized to add OPTIONAL fields only.

- **The state-transition transaction within the score POST is non-trivial** — multiple UPDATEs + INSERTs within one tx. SQLite's tx semantics are atomic-or-rollback, so partial failure isn't a concern; but a slow writer (e.g., 200ms transaction latency) could surface during the trip if scoring volume spikes. v1 acceptance: 4 foursomes × 18 holes = 72 score POSTs over ~4 hours per round = ~18/hour. Negligible.

- **`round_states` row must be seeded BEFORE the first score POST** — T5-1's schema permits round_states.round_id = round.id with no auto-seed. T5-8 (round-open handler) is the seeder. Pre-T5-8, integration tests must seed manually; T5-2 + T5-8 lands together would normally co-establish the seed timing. **For T5-6's tests**: integration test fixtures explicitly INSERT a `round_states` row with `state='not_started'` before each score-POST scenario. Documented in the spec test setup pattern.
