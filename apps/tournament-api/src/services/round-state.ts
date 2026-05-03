/**
 * T5-8 round-lifecycle FSM service.
 *
 * Promoted from T5-6's inline state-transition logic (apps/tournament-api/
 * src/routes/scores.ts:455-540) + T5-6's `computeExpectedCells` helper. The
 * FSM owns the legal transition matrix, the race-safe conditional UPDATE,
 * and the audit-row write. Callers across T5-6 (score commit), T5-7
 * (scorer handoff), T5-8 (lifecycle endpoints), T5-9 (score correction)
 * use this single module.
 *
 * **Service-layer convention (amendment to T5-5 precedent).** T5-5
 * established `services/` as read-only-only. T5-8 introduces the first
 * mutating-but-domain-encapsulated function (`transitionState`). The
 * convention is amended: domain-side-effect-isolating functions are
 * allowed; orphan side-effects without a domain reason are NOT.
 *
 * **SQLite snapshot residual (T5-7f partial closure).** `transitionState`
 * uses a conditional UPDATE narrowed on the current state, which IS
 * race-safe for the FSM transition itself (state column is the same one
 * being read+written). For OTHER writers (e.g., T5-7 scorer-assignments
 * UPDATE) that need a "round must be in writable states" gate, the
 * pattern is to add an `EXISTS (SELECT 1 FROM round_states WHERE ...)`
 * subquery to the WRITE statement so the gate runs at write-time. Under
 * SQLite WAL with default `BEGIN`, this still has a sub-millisecond
 * residual race window (the EXISTS subquery evaluates against the
 * transaction's snapshot, not the latest committed state). True race
 * closure requires `BEGIN IMMEDIATE`, which drizzle-orm does not
 * cleanly expose. Followup T5-8b tracks this.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  events,
  holeScores,
  pairings,
  pairingMembers,
  rounds,
  roundStates,
} from '../db/schema/index.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// Types + error class
// ---------------------------------------------------------------------------

export type RoundState =
  | 'not_started'
  | 'in_progress'
  | 'complete_editable'
  | 'finalized'
  | 'cancelled';

/**
 * Domain error class for state-machine violations and gate rejections.
 *
 * Constructor is positional: `(code, message, status?)`. `status` defaults
 * to 422 (the dominant case for state-machine violations). Routes catch
 * BusinessRuleError and map to:
 *
 *   c.json({ error: 'unprocessable', code: err.code, requestId }, err.status)
 */
export class BusinessRuleError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = 'BusinessRuleError';
    this.code = code;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Legal transition matrix (Section 5 of T5-8 spec)
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS: ReadonlyMap<RoundState, ReadonlySet<RoundState>> =
  new Map([
    ['not_started', new Set<RoundState>(['in_progress', 'cancelled'])],
    [
      'in_progress',
      new Set<RoundState>(['complete_editable', 'cancelled']),
    ],
    [
      'complete_editable',
      new Set<RoundState>(['in_progress', 'finalized', 'cancelled']),
    ],
    ['finalized', new Set<RoundState>([])], // terminal — no transitions out
    ['cancelled', new Set<RoundState>([])], // terminal — no transitions out
  ]);

function isLegalTransition(from: RoundState, to: RoundState): boolean {
  return LEGAL_TRANSITIONS.get(from)?.has(to) ?? false;
}

// ---------------------------------------------------------------------------
// Read primitives
// ---------------------------------------------------------------------------

/**
 * Returns the current state of a round, or null if no `round_states` row
 * exists. Tenant-scoped.
 */
export async function getRoundState(
  txOrDb: Tx | Db,
  roundId: string,
  tenantId: string,
): Promise<RoundState | null> {
  const rows = await txOrDb
    .select({ state: roundStates.state })
    .from(roundStates)
    .where(
      and(
        eq(roundStates.roundId, roundId),
        eq(roundStates.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0]!.state as RoundState;
}

/**
 * Returns true if `playerId` is the per-event organizer of the event
 * containing `roundId`. Tenant-scoped on both rounds and events.
 *
 * NOTE: this is the per-event check (events.organizer_player_id), NOT the
 * global players.is_organizer flag. T5-7's auth model.
 */
export async function isEventOrganizer(
  txOrDb: Tx | Db,
  roundId: string,
  playerId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await txOrDb
    .select({ id: events.id })
    .from(events)
    .innerJoin(rounds, eq(rounds.eventId, events.id))
    .where(
      and(
        eq(rounds.id, roundId),
        eq(events.organizerPlayerId, playerId),
        eq(rounds.tenantId, tenantId),
        eq(events.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Sibling helper for callers that have eventId in scope (T5-11). The
 * existing isEventOrganizer takes roundId because T5-7/T5-8 endpoints
 * are mounted under /api/rounds; T5-11 mounts under /api/events. Same
 * underlying check (events.organizer_player_id == :playerId), tenant-
 * scoped. Nonexistent event → returns false (the no-existence-leak
 * invariant is enforced at the route layer by mapping false → 403).
 */
export async function isEventOrganizerByEventId(
  txOrDb: Tx | Db,
  eventId: string,
  playerId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await txOrDb
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.organizerPlayerId, playerId),
        eq(events.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Cell-counting helpers (promoted from T5-6 scores.ts:576-594)
// ---------------------------------------------------------------------------

/**
 * Expected cell count = distinct foursome-member count × holes_to_play.
 * Used by T5-6's auto-complete detection (count-only) and indirectly by
 * T5-8's /complete + /finalize handlers (which use the enumerated
 * `computeMissingCells` helper instead, but share the underlying join).
 *
 * `eventRoundId === null` (v1.5 standalone-round shape) → 0 (never
 * auto-completes; v1 always writes non-null).
 */
export async function computeExpectedCells(
  txOrDb: Tx | Db,
  round: { eventRoundId: string | null; holesToPlay: number },
  tenantId: string,
): Promise<number> {
  if (round.eventRoundId === null) return 0;
  const result = await txOrDb
    .select({
      count: sql<number>`count(distinct ${pairingMembers.playerId})`,
    })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .where(
      and(
        eq(pairings.eventRoundId, round.eventRoundId),
        eq(pairings.tenantId, tenantId),
        eq(pairingMembers.tenantId, tenantId),
      ),
    );
  const distinctPlayerCount = result[0]?.count ?? 0;
  return distinctPlayerCount * round.holesToPlay;
}

/**
 * Enumerated missing-cells helper. Returns the (playerId, holeNumber)
 * pairs that are blank for `roundId` plus expected/actual counts.
 *
 * Algorithm:
 *   1. Build expected: distinct foursome members × holes [1..holesToPlay].
 *   2. Build actual: SELECT (player_id, hole_number) FROM hole_scores
 *      filtered by roundId + holesToPlay scope.
 *   3. Set difference (expected − actual). Sort by (playerId, holeNumber).
 *
 * Tenant-scoped on every joined table. Stable ordering for deterministic
 * tests + UI display.
 */
export async function computeMissingCells(
  txOrDb: Tx | Db,
  roundId: string,
  round: { eventRoundId: string | null; holesToPlay: number },
  tenantId: string,
): Promise<{
  expectedCount: number;
  actualCount: number;
  missingCells: Array<{ playerId: string; holeNumber: number }>;
}> {
  if (round.eventRoundId === null) {
    return { expectedCount: 0, actualCount: 0, missingCells: [] };
  }

  // 1. Expected players (distinct foursome members for this event_round).
  const memberRows = await txOrDb
    .select({ playerId: pairingMembers.playerId })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .where(
      and(
        eq(pairings.eventRoundId, round.eventRoundId),
        eq(pairings.tenantId, tenantId),
        eq(pairingMembers.tenantId, tenantId),
      ),
    );
  const playerIds = Array.from(
    new Set(memberRows.map((r) => r.playerId)),
  ).sort();
  const holeNumbers = Array.from(
    { length: round.holesToPlay },
    (_, i) => i + 1,
  );
  const expectedCount = playerIds.length * round.holesToPlay;

  // 2. Actual cells.
  const actualRows = playerIds.length === 0
    ? []
    : await txOrDb
        .select({
          playerId: holeScores.playerId,
          holeNumber: holeScores.holeNumber,
        })
        .from(holeScores)
        .where(
          and(
            eq(holeScores.roundId, roundId),
            eq(holeScores.tenantId, tenantId),
            inArray(holeScores.playerId, playerIds),
            sql`${holeScores.holeNumber} <= ${round.holesToPlay}`,
          ),
        );
  const actualKeys = new Set(
    actualRows.map((r) => `${r.playerId}|${r.holeNumber}`),
  );

  // 3. Set difference; sorted by (playerId, holeNumber).
  const missingCells: Array<{ playerId: string; holeNumber: number }> = [];
  for (const playerId of playerIds) {
    for (const holeNumber of holeNumbers) {
      if (!actualKeys.has(`${playerId}|${holeNumber}`)) {
        missingCells.push({ playerId, holeNumber });
      }
    }
  }

  return {
    expectedCount,
    actualCount: actualRows.length,
    missingCells,
  };
}

// ---------------------------------------------------------------------------
// transitionState — the FSM's single mutating function
// ---------------------------------------------------------------------------

/**
 * Atomically transitions a round's state per the legal matrix.
 *
 * Sequence:
 *   1. SELECT current state (tenant-scoped). Throws round_state_missing if absent.
 *   2. If current === to: idempotent return (no UPDATE, no audit).
 *   3. If (current, to) NOT in LEGAL_TRANSITIONS: throws illegal_state_transition.
 *   4. Conditional UPDATE narrowed on `state = :current`. Race-safe: if
 *      another tx flipped the state between step 1 and step 4, the
 *      UPDATE affects 0 rows.
 *   5. On 0 rows updated: re-read; if new state === to, return idempotent
 *      (concurrent transition raced and won the same target); else throw
 *      illegal_state_transition with the new current state in the message.
 *   6. Side effect: `not_started → in_progress` ALSO updates rounds.opened_at
 *      and rounds.opened_by_player_id (only if opened_at IS NULL).
 *   7. writeAudit with eventType ROUND_STATE_CHANGED, payload { from, to }.
 *   8. Returns { from, to }.
 *
 * Throws BusinessRuleError (code: 'round_state_missing' | 'illegal_state_transition').
 */
export async function transitionState(
  tx: Tx,
  roundId: string,
  to: RoundState,
  actorPlayerId: string,
  tenantId: string,
): Promise<{ from: RoundState; to: RoundState }> {
  // Step 1: read current state.
  const current = await getRoundState(tx, roundId, tenantId);
  if (current === null) {
    throw new BusinessRuleError(
      'round_state_missing',
      `no round_states row for round ${roundId}`,
      422,
    );
  }

  // Step 2: idempotent on already-target state.
  if (current === to) {
    return { from: current, to };
  }

  // Step 3: matrix gate.
  if (!isLegalTransition(current, to)) {
    throw new BusinessRuleError(
      'illegal_state_transition',
      `cannot transition ${current} → ${to}`,
      422,
    );
  }

  // Step 4: race-safe conditional UPDATE.
  const now = Date.now();
  const updated = await tx
    .update(roundStates)
    .set({
      state: to,
      enteredAt: now,
      enteredByPlayerId: actorPlayerId,
    })
    .where(
      and(
        eq(roundStates.roundId, roundId),
        eq(roundStates.state, current),
        eq(roundStates.tenantId, tenantId),
      ),
    )
    .returning({ roundId: roundStates.roundId });

  if (updated.length === 0) {
    // Step 5: re-read; concurrent transition won.
    const newCurrent = await getRoundState(tx, roundId, tenantId);
    if (newCurrent === to) {
      // Idempotent — another writer reached the same target first.
      return { from: current, to };
    }
    throw new BusinessRuleError(
      'illegal_state_transition',
      `concurrent transition raced to ${newCurrent ?? 'unknown'}`,
      422,
    );
  }

  // Step 6: rounds.opened_at side effect for not_started → in_progress.
  if (current === 'not_started' && to === 'in_progress') {
    await tx
      .update(rounds)
      .set({ openedAt: now, openedByPlayerId: actorPlayerId })
      .where(
        and(
          eq(rounds.id, roundId),
          eq(rounds.tenantId, tenantId),
          // Only if opened_at IS NULL (first-open semantics; idempotent
          // re-call wouldn't reach this path because step 2 returns early).
          sql`${rounds.openedAt} IS NULL`,
        ),
      );
  }

  // Step 7: audit trail.
  await writeAudit(tx, {
    eventType: AUDIT_EVENT_TYPES.ROUND_STATE_CHANGED,
    entityType: AUDIT_ENTITY_TYPES.ROUND,
    entityId: roundId,
    actorPlayerId,
    payload: { from: current, to },
  });

  // Step 8: return the transition record.
  return { from: current, to };
}

/**
 * Convenience: lookup the rounds row's eventId, eventRoundId, holesToPlay.
 * Used by /complete + /finalize handlers before calling computeMissingCells.
 * Tenant-scoped. Returns null if not found.
 */
export async function getRoundContext(
  txOrDb: Tx | Db,
  roundId: string,
  tenantId: string,
): Promise<{
  id: string;
  eventId: string | null;
  eventRoundId: string | null;
  holesToPlay: number;
} | null> {
  const rows = await txOrDb
    .select({
      id: rounds.id,
      eventId: rounds.eventId,
      eventRoundId: rounds.eventRoundId,
      holesToPlay: rounds.holesToPlay,
    })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, tenantId)))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0]!;
}

