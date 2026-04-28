/**
 * T5-6 require-scorer-for-round middleware. Single-writer enforcement.
 *
 * MUST be mounted AFTER `requireSession` (reads `c.get('player')`) and on
 * a route parameterized with `:roundId` and `:holeNumber`.
 *
 * Responsibilities:
 *   - Misuse 500s (developer bugs)
 *   - 400 path-param + body validation (Zod parse via `scorePostBodySchema`)
 *   - 404 round_not_found (tenant-scoped existence check)
 *   - Two-phase scorer lookup (roundScorers + targetFoursome)
 *   - Decision tree → 404 / 422 / 403 / next()
 *   - Stores parsed body via `c.set('scorePostBody', ...)` for the handler
 *
 * 14-path error taxonomy in T5-6 spec §9.
 */

import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  pairingMembers,
  pairings,
  players,
  rounds,
  scorerAssignments,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { scorePostBodySchema } from '../routes/scores.js';

const TENANT_ID = 'guyan';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requireScorerForRound: MiddlewareHandler = async (c, next) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;

  // Step 1: requireSession must be ahead of us in the chain.
  const player = c.get('player');
  if (!player) {
    log.error({
      msg: 'requireScorerForRound invoked without requireSession ahead of it',
      requestId,
    });
    return c.json(
      { error: 'internal', code: 'middleware_misuse', requestId },
      500,
    );
  }

  // Step 2: :roundId must be present + valid UUID-shape.
  const roundId = c.req.param('roundId');
  if (!roundId) {
    log.error({
      msg: 'requireScorerForRound mounted on route without :roundId',
      requestId,
    });
    return c.json(
      {
        error: 'internal',
        code: 'middleware_misuse_no_round_id',
        requestId,
      },
      500,
    );
  }
  if (!UUID_RE.test(roundId)) {
    return c.json(
      { error: 'bad_request', code: 'invalid_round_id', requestId },
      400,
    );
  }

  // Step 3: :holeNumber must be a parseable integer in [1,18].
  const rawHole = c.req.param('holeNumber');
  const holeNumber = Number(rawHole);
  if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
    return c.json(
      { error: 'bad_request', code: 'invalid_hole_number', requestId },
      400,
    );
  }

  // Step 4: parse + Zod-validate the body.
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json(
      {
        error: 'bad_request',
        code: 'invalid_body',
        reason: 'malformed_json',
        requestId,
      },
      400,
    );
  }
  const parsed = scorePostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: 'validation_error',
        code: 'invalid_body',
        issues: parsed.error.issues,
        requestId,
      },
      400,
    );
  }
  c.set('scorePostBody', parsed.data);

  // Step 5: round existence (and tenant-scoped) — primary 404 path.
  const roundRows = await db
    .select({ id: rounds.id, eventRoundId: rounds.eventRoundId })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
    .limit(1);
  if (roundRows.length === 0) {
    return c.json(
      { error: 'not_found', code: 'round_not_found', requestId },
      404,
    );
  }
  const round = roundRows[0]!;

  if (round.eventRoundId === null) {
    // v1.5 standalone-round shape; v1 never writes nulls. Treat as round
    // without pairings (can't enforce scorer gate). 422 for setup error.
    return c.json(
      {
        error: 'unprocessable',
        code: 'foursome_has_no_scorer',
        requestId,
      },
      422,
    );
  }

  // Step 6a: fetch ALL scorer_assignments for this round.
  const roundScorers = await db
    .select({
      foursomeNumber: scorerAssignments.foursomeNumber,
      scorerPlayerId: scorerAssignments.scorerPlayerId,
    })
    .from(scorerAssignments)
    .where(
      and(
        eq(scorerAssignments.roundId, roundId),
        eq(scorerAssignments.tenantId, TENANT_ID),
      ),
    );

  // Step 6b: locate the foursome containing body.playerId.
  const targetFoursomeRows = await db
    .select({ foursomeNumber: pairings.foursomeNumber })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .where(
      and(
        eq(pairings.eventRoundId, round.eventRoundId),
        eq(pairingMembers.playerId, parsed.data.playerId),
        eq(pairings.tenantId, TENANT_ID),
        eq(pairingMembers.tenantId, TENANT_ID),
      ),
    )
    .limit(1);

  if (targetFoursomeRows.length === 0) {
    return c.json(
      {
        error: 'not_found',
        code: 'player_not_in_any_foursome',
        requestId,
      },
      404,
    );
  }

  const targetFoursomeNumber = targetFoursomeRows[0]!.foursomeNumber;
  const targetScorer = roundScorers.find(
    (s) => s.foursomeNumber === targetFoursomeNumber,
  );

  if (!targetScorer) {
    return c.json(
      {
        error: 'unprocessable',
        code: 'foursome_has_no_scorer',
        requestId,
      },
      422,
    );
  }

  // Happy path.
  if (targetScorer.scorerPlayerId === player.id) {
    await next();
    return;
  }

  // Mismatch: pick the more specific 403 code.
  // currentScorerName lookup (only on 403 path).
  const scorerNameRows = await db
    .select({ name: players.name })
    .from(players)
    .where(
      and(
        eq(players.id, targetScorer.scorerPlayerId),
        eq(players.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  const currentScorerName =
    scorerNameRows.length > 0 ? scorerNameRows[0]!.name : null;

  const isScorerOfAnyOtherFoursome = roundScorers.some(
    (s) => s.scorerPlayerId === player.id,
  );
  const code = isScorerOfAnyOtherFoursome
    ? 'player_not_in_your_foursome'
    : 'not_scorer_for_this_foursome';

  return c.json(
    {
      error: 'forbidden',
      code,
      currentScorerPlayerId: targetScorer.scorerPlayerId,
      currentScorerName,
      requestId,
    },
    403,
  );
};
