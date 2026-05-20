/**
 * T6-7 manual press routes.
 *
 * Mount: app.route('/api/rounds', pressesRouter). Effective URLs:
 *   POST   /api/rounds/:roundId/presses        — file a manual press
 *   DELETE /api/rounds/:roundId/presses/:pressId — undo within window
 *
 * Auth: requireSession + handler-internal scorer-of-this-round check
 * (mirrors T5-7 scorer-handoff pattern; require-scorer-for-round
 * middleware can't be reused because it requires :holeNumber).
 *
 * **Server-derived fromHole** (per epic AC line 1970): the route does
 * NOT accept fromHole in the body. It derives fromHole = (max-hole-
 * complete | 0) + 1 from hole_scores. The fromHole derivation also yields
 * the caller's foursomeNumber (T10-1: returned by computeMaxCompleteHole
 * as non-null; threaded into the team_press_log INSERT). If max-hole-
 * complete === 18 → round fully scored; reject 422 no_holes_left_to_press.
 *
 * **UNIQUE constraint dedupe** (T10-1 schema, migration 0012): UNIQUE on
 * (round_id, foursome_number, team, start_hole, trigger_type) catches
 * duplicate manual presses WITHIN THE SAME FOURSOME → 422
 * press_already_filed_this_hole. Pre-T10-1 (migration 0006) the UNIQUE
 * was foursome-blind and cross-collided between foursomes; that bug was
 * masked in production by TOURNAMENT_PRESSES_DISABLED while T10-1
 * shipped the schema fix.
 *
 * **DELETE foursome-scoping** (T10-1 security fix): the undo path scopes
 * the press-row lookup by the caller's foursomeNumber so a scorer in
 * foursome 1 cannot DELETE a sibling foursome's press by guessing the
 * UUID. The kill switch remains in place as an operational override.
 *
 * **Undo eligibility:** canUndo iff NO hole at-or-after press.startHole
 * is complete. I.e., once any hole >= startHole has 4/4 scores, undo
 * window has closed.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  holeScores,
  pairingMembers,
  pairings,
  rounds,
  ruleSetRevisions,
  ruleSets,
  scorerAssignments,
  teamPressLog,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { pressesDisabled } from '../lib/env.js';
import { requireSession } from '../middleware/require-session.js';
import { emitActivity } from '../lib/activity.js';
import {
  BusinessRuleError,
  getRoundState,
} from '../services/round-state.js';

const TENANT_ID = 'guyan';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SQLITE_UNIQUE_RAW_CODE = 2067;

function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const cause = (err as { cause?: unknown }).cause;
  const sources = [err as Record<string, unknown>];
  if (cause && typeof cause === 'object') sources.push(cause as Record<string, unknown>);
  for (const src of sources) {
    if (
      src['code'] === 'SQLITE_CONSTRAINT_UNIQUE' ||
      src['extendedCode'] === 'SQLITE_CONSTRAINT_UNIQUE' ||
      src['code'] === SQLITE_UNIQUE_RAW_CODE ||
      src['extendedCode'] === SQLITE_UNIQUE_RAW_CODE ||
      src['rawCode'] === SQLITE_UNIQUE_RAW_CODE
    ) {
      return true;
    }
  }
  return false;
}

const pressBodySchema = z.object({
  team: z.enum(['teamA', 'teamB']),
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Returns true if `callerId` is an assigned scorer for this round
 * (any foursome). v1 spec: scorer files press on behalf of the foursome.
 */
async function isScorerForRound(
  tx: Tx,
  roundId: string,
  callerId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ scorerPlayerId: scorerAssignments.scorerPlayerId })
    .from(scorerAssignments)
    .where(
      and(
        eq(scorerAssignments.roundId, roundId),
        eq(scorerAssignments.scorerPlayerId, callerId),
        eq(scorerAssignments.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Compute the highest hole number where ALL 4 foursome members for a given
 * scorer-assigned foursome have committed scores. Returns `{maxComplete: 0}`
 * if no holes complete; `maxComplete: 18` if entire round is scored.
 *
 * Returns the scorer's `foursomeNumber` alongside `maxComplete` so callers
 * (the POST handler) can use it for the team_press_log INSERT without
 * re-querying scorer_assignments (T10-1). The field is NOT nullable: if
 * the scorer-assignment lookup misses, this throws BusinessRuleError
 * `scorer_assignment_missing` (422). The POST handler runs
 * `isScorerForRound` first (which itself queries scorer_assignments), so
 * the assignment row is guaranteed to exist when this helper runs absent
 * a TOCTOU race (concurrent scorer-handoff between the two queries).
 * Returning a non-null foursomeNumber + throwing on miss prevents the
 * caller from passing NULL to the team_press_log INSERT (which would hit
 * the NOT NULL constraint with an opaque SQL error instead).
 */
async function computeMaxCompleteHole(
  tx: Tx,
  roundId: string,
  scorerPlayerId: string,
): Promise<{ maxComplete: number; foursomeNumber: number }> {
  // Find the foursome the scorer is assigned to.
  const assignmentRows = await tx
    .select({ foursomeNumber: scorerAssignments.foursomeNumber })
    .from(scorerAssignments)
    .where(
      and(
        eq(scorerAssignments.roundId, roundId),
        eq(scorerAssignments.scorerPlayerId, scorerPlayerId),
        eq(scorerAssignments.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  if (assignmentRows.length === 0) {
    throw new BusinessRuleError(
      'scorer_assignment_missing',
      'no scorer_assignments row for this caller/round (TOCTOU race with handoff?)',
      422,
    );
  }
  const foursomeNumber = assignmentRows[0]!.foursomeNumber;

  // Find foursome members.
  const memberRows = await tx
    .select({ playerId: pairingMembers.playerId })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairings.id, pairingMembers.pairingId))
    .innerJoin(rounds, eq(rounds.eventRoundId, pairings.eventRoundId))
    .where(
      and(
        eq(rounds.id, roundId),
        eq(pairings.foursomeNumber, foursomeNumber),
        eq(pairings.tenantId, TENANT_ID),
        eq(pairingMembers.tenantId, TENANT_ID),
        eq(rounds.tenantId, TENANT_ID),
      ),
    );
  const expectedMembers = memberRows.map((m) => m.playerId);
  if (expectedMembers.length !== 4) {
    // Defense-in-depth: the foursome exists per the assignment lookup above,
    // but a malformed pairing (member count != 4) is treated as "no holes
    // complete." Return foursomeNumber for caller bookkeeping.
    return { maxComplete: 0, foursomeNumber };
  }

  // For each hole 1..18, count members scored. Take max where count === 4.
  const scoredRows = await tx
    .select({
      holeNumber: holeScores.holeNumber,
      count: sql<number>`count(distinct ${holeScores.playerId})`,
    })
    .from(holeScores)
    .where(
      and(
        eq(holeScores.roundId, roundId),
        inArray(holeScores.playerId, expectedMembers),
        eq(holeScores.tenantId, TENANT_ID),
      ),
    )
    .groupBy(holeScores.holeNumber);

  let maxComplete = 0;
  for (const r of scoredRows) {
    if (r.count === 4 && r.holeNumber > maxComplete) {
      maxComplete = r.holeNumber;
    }
  }
  return { maxComplete, foursomeNumber };
}

/**
 * Default press multiplier from active rule-set. v1 simple lookup.
 */
async function fetchPressMultiplier(tx: Tx | typeof db): Promise<number> {
  const ruleSetRows = await tx
    .select({ id: ruleSets.id })
    .from(ruleSets)
    .where(eq(ruleSets.tenantId, TENANT_ID))
    .limit(1);
  if (ruleSetRows.length === 0) return 2;  // safe default
  const revRows = await tx
    .select({ configJson: ruleSetRevisions.configJson })
    .from(ruleSetRevisions)
    .where(
      and(
        eq(ruleSetRevisions.ruleSetId, ruleSetRows[0]!.id),
        eq(ruleSetRevisions.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  if (revRows.length === 0) return 2;
  try {
    const cfg = JSON.parse(revRows[0]!.configJson) as Record<string, unknown>;
    if (typeof cfg['pressMultiplier'] === 'number' && Number.isInteger(cfg['pressMultiplier'])) {
      return cfg['pressMultiplier'] as number;
    }
  } catch {
    /* fall through */
  }
  return 2;
}

export const pressesRouter = new Hono();

// ---------------------------------------------------------------------------
// POST /:roundId/presses — file a manual press
// ---------------------------------------------------------------------------
pressesRouter.post('/:roundId/presses', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const player = c.get('player')!;
  const roundId = c.req.param('roundId');

  // Operational kill switch (see lib/env.ts:pressesDisabled). Same gate is
  // on the auto-press orchestrator. The original T6-4 reason (foursome-blind
  // UNIQUE on team_press_log) was resolved by T10-1's migration 0012; the
  // switch is retained as an emergency override if presses misbehave in
  // production for any future reason. Short-circuits BEFORE any DB write.
  if (pressesDisabled()) {
    return c.json(
      { error: 'feature_disabled', code: 'presses_disabled', requestId },
      422,
    );
  }

  if (!roundId || !UUID_RE.test(roundId)) {
    return c.json({ error: 'bad_request', code: 'invalid_round_id', requestId }, 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request', code: 'malformed_json', requestId }, 400);
  }
  const parsed = pressBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: 'validation_error', code: 'invalid_body', issues: parsed.error.issues, requestId },
      400,
    );
  }
  const body = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      // (1) Auth: scorer-of-this-round.
      const isScorer = await isScorerForRound(tx, roundId, player.id);
      if (!isScorer) {
        throw new BusinessRuleError('not_scorer_for_round', 'caller is not a scorer for this round', 403);
      }

      // (2) Round state gate (in_progress | complete_editable).
      const state = await getRoundState(tx, roundId, TENANT_ID);
      if (state === null) {
        throw new BusinessRuleError('round_state_missing', 'no round_states row', 422);
      }
      if (state !== 'in_progress' && state !== 'complete_editable') {
        throw new BusinessRuleError(
          'round_not_writable',
          `round state is '${state}'; presses require in_progress or complete_editable`,
          422,
        );
      }

      // (3) Server-derived fromHole + foursome (T10-1: foursomeNumber must
      // be threaded into the team_press_log INSERT for foursome-scoped UNIQUE).
      const { maxComplete, foursomeNumber } = await computeMaxCompleteHole(
        tx,
        roundId,
        player.id,
      );
      const fromHole = maxComplete + 1;
      if (fromHole > 18) {
        throw new BusinessRuleError('no_holes_left_to_press', 'round fully scored', 422);
      }

      // (4) Multiplier from active rule-set.
      const multiplier = await fetchPressMultiplier(tx);

      // (5) Round context for activity scope.
      const roundRows = await tx
        .select({ id: rounds.id, eventId: rounds.eventId, contextId: rounds.contextId })
        .from(rounds)
        .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
        .limit(1);
      if (roundRows.length === 0) {
        throw new BusinessRuleError('round_not_found', 'rounds row missing', 404);
      }
      const round = roundRows[0]!;

      // (6) INSERT team_press_log; UNIQUE catch.
      const pressId = randomUUID();
      const now = Date.now();
      try {
        await tx.insert(teamPressLog).values({
          id: pressId,
          roundId,
          team: body.team,
          startHole: fromHole,
          triggerType: 'manual',
          trigger: null,
          foursomeNumber,
          multiplier,
          firedAt: now,
          firedByPlayerId: player.id,
          tenantId: TENANT_ID,
          contextId: round.contextId,
        });
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          throw new BusinessRuleError(
            'press_already_filed_this_hole',
            `manual press already filed for ${body.team} on hole ${fromHole}`,
            422,
          );
        }
        throw err;
      }

      // (7) Activity emit.
      if (round.eventId !== null) {
        await emitActivity(tx, {
          type: 'press.manual_fired',
          eventId: round.eventId,
          roundId,
          actorPlayerId: player.id,
          fromHole,
          team: body.team,
          multiplier,
          filedByPlayerId: player.id,
        });
      }

      return { pressId, fromHole };
    });

    return c.json(
      {
        ok: true,
        pressId: result.pressId,
        fromHole: result.fromHole,
        canUndoUntilHoleComplete: result.fromHole,
        requestId,
      },
      200,
    );
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      const errorLabel =
        err.status === 403 ? 'forbidden' : err.status === 404 ? 'not_found' : 'unprocessable';
      return c.json({ error: errorLabel, code: err.code, requestId }, err.status as 403 | 404 | 422);
    }
    log.error({ msg: 'POST /presses threw', requestId, roundId, err: String(err) });
    return c.json({ error: 'internal', code: 'press_file_failed', requestId }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /:roundId/presses/:pressId — undo within window
// ---------------------------------------------------------------------------
pressesRouter.delete('/:roundId/presses/:pressId', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const player = c.get('player')!;
  const roundId = c.req.param('roundId');
  const pressId = c.req.param('pressId');

  // Operational kill switch (see lib/env.ts:pressesDisabled). Same gate as POST.
  if (pressesDisabled()) {
    return c.json(
      { error: 'feature_disabled', code: 'presses_disabled', requestId },
      422,
    );
  }

  if (!roundId || !UUID_RE.test(roundId)) {
    return c.json({ error: 'bad_request', code: 'invalid_round_id', requestId }, 400);
  }
  if (!pressId || !UUID_RE.test(pressId)) {
    return c.json({ error: 'bad_request', code: 'invalid_press_id', requestId }, 400);
  }

  try {
    await db.transaction(async (tx) => {
      const isScorer = await isScorerForRound(tx, roundId, player.id);
      if (!isScorer) {
        throw new BusinessRuleError('not_scorer_for_round', 'caller is not a scorer for this round', 403);
      }

      // T10-1: Resolve the caller's foursome BEFORE the press-row lookup so
      // we can filter by it (preventing cross-foursome undo). Pre-T10-1 the
      // press-row lookup ran first and was foursome-blind — a scorer in
      // foursome 1 with knowledge of (or a guess at) a press UUID from
      // foursome 2 could DELETE foursome 2's manual press.
      const assignmentRows = await tx
        .select({ foursomeNumber: scorerAssignments.foursomeNumber })
        .from(scorerAssignments)
        .where(
          and(
            eq(scorerAssignments.roundId, roundId),
            eq(scorerAssignments.scorerPlayerId, player.id),
            eq(scorerAssignments.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      const foursomeNumber = assignmentRows[0]?.foursomeNumber;
      if (foursomeNumber === undefined) {
        throw new BusinessRuleError('not_scorer_for_round', 'no scorer assignment', 403);
      }

      // Find the press row — scoped to caller's foursome (T10-1).
      const pressRows = await tx
        .select({
          id: teamPressLog.id,
          startHole: teamPressLog.startHole,
          triggerType: teamPressLog.triggerType,
        })
        .from(teamPressLog)
        .where(
          and(
            eq(teamPressLog.id, pressId),
            eq(teamPressLog.roundId, roundId),
            eq(teamPressLog.foursomeNumber, foursomeNumber),
            eq(teamPressLog.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      if (pressRows.length === 0) {
        // 404 covers both "press doesn't exist" and "press exists but belongs
        // to a different foursome" — caller cannot distinguish, which is the
        // correct security posture (don't leak existence of sibling-foursome
        // press rows).
        throw new BusinessRuleError('press_not_found', 'press row not found', 404);
      }
      const press = pressRows[0]!;
      if (press.triggerType !== 'manual') {
        throw new BusinessRuleError('cannot_undo_auto_press', 'only manual presses are undoable', 422);
      }

      // Undo eligibility: NO hole at-or-after press.startHole has 4/4 scores.
      // Use the foursomeNumber already resolved above (was redundantly
      // re-queried pre-T10-1).
      const memberRows = await tx
        .select({ playerId: pairingMembers.playerId })
        .from(pairingMembers)
        .innerJoin(pairings, eq(pairings.id, pairingMembers.pairingId))
        .innerJoin(rounds, eq(rounds.eventRoundId, pairings.eventRoundId))
        .where(
          and(
            eq(rounds.id, roundId),
            eq(pairings.foursomeNumber, foursomeNumber),
            eq(pairings.tenantId, TENANT_ID),
            eq(pairingMembers.tenantId, TENANT_ID),
            eq(rounds.tenantId, TENANT_ID),
          ),
        );
      const expectedMembers = memberRows.map((m) => m.playerId);

      // Count distinct players scored at-or-after press.startHole.
      const scoredAtOrAfter = await tx
        .select({
          holeNumber: holeScores.holeNumber,
          count: sql<number>`count(distinct ${holeScores.playerId})`,
        })
        .from(holeScores)
        .where(
          and(
            eq(holeScores.roundId, roundId),
            gte(holeScores.holeNumber, press.startHole),
            inArray(holeScores.playerId, expectedMembers),
            eq(holeScores.tenantId, TENANT_ID),
          ),
        )
        .groupBy(holeScores.holeNumber);
      const anyComplete = scoredAtOrAfter.some((r) => r.count === 4);
      if (anyComplete) {
        throw new BusinessRuleError(
          'press_hole_complete',
          'undo window closed — a hole at-or-after the pressed hole is complete',
          422,
        );
      }

      // Delete the press row.
      await tx
        .delete(teamPressLog)
        .where(
          and(
            eq(teamPressLog.id, pressId),
            eq(teamPressLog.tenantId, TENANT_ID),
          ),
        );

      // Round context for activity.
      const roundRows = await tx
        .select({ eventId: rounds.eventId })
        .from(rounds)
        .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
        .limit(1);
      const roundEventId = roundRows[0]?.eventId ?? null;
      if (roundEventId !== null) {
        await emitActivity(tx, {
          type: 'press.manual_undone',
          eventId: roundEventId,
          roundId,
          actorPlayerId: player.id,
          pressId,
          undoneByPlayerId: player.id,
        });
      }
    });

    return c.json({ ok: true, requestId }, 200);
  } catch (err) {
    if (err instanceof BusinessRuleError) {
      const errorLabel =
        err.status === 403 ? 'forbidden' : err.status === 404 ? 'not_found' : 'unprocessable';
      return c.json({ error: errorLabel, code: err.code, requestId }, err.status as 403 | 404 | 422);
    }
    log.error({ msg: 'DELETE /presses threw', requestId, roundId, pressId, err: String(err) });
    return c.json({ error: 'internal', code: 'press_undo_failed', requestId }, 500);
  }
});
