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

type Db = typeof db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The single-writer scorer-gate decision, factored out of the middleware so
 * routes that CAN'T mount `requireScorerForRound` (it requires `:holeNumber`
 * and a score-shaped body) can reuse the EXACT same per-USER gate logic.
 * `routes/claims.ts` (Story 2.1) reuses this so the claim write enforces the
 * same single-writer rule as a score write, with zero duplication.
 *
 * Pure of HTTP: takes a db/tx handle + the resolved ids and returns a decision.
 * The caller maps the decision to its own response shape. Tenant-scoped on
 * every query. `round.eventRoundId` MUST be non-null (v1 always writes both;
 * the caller handles the v1.5 standalone-round shape).
 */
export type ScorerGateDecision =
  | { ok: true; foursomeNumber: number }
  | {
      ok: false;
      code:
        | 'foursome_has_no_scorer'
        | 'player_not_in_any_foursome'
        | 'player_not_in_your_foursome'
        | 'not_scorer_for_this_foursome';
      currentScorerPlayerId?: string;
      currentScorerName?: string | null;
    };

export async function resolveScorerGate(
  txOrDb: Tx | Db,
  args: {
    roundId: string;
    eventRoundId: string;
    targetPlayerId: string;
    callerPlayerId: string;
    tenantId?: string;
  },
): Promise<ScorerGateDecision> {
  const tenantId = args.tenantId ?? TENANT_ID;

  // All scorer_assignments for this round.
  const roundScorers = await txOrDb
    .select({
      foursomeNumber: scorerAssignments.foursomeNumber,
      scorerPlayerId: scorerAssignments.scorerPlayerId,
    })
    .from(scorerAssignments)
    .where(
      and(
        eq(scorerAssignments.roundId, args.roundId),
        eq(scorerAssignments.tenantId, tenantId),
      ),
    );

  // Locate the foursome containing the target player.
  const targetFoursomeRows = await txOrDb
    .select({ foursomeNumber: pairings.foursomeNumber })
    .from(pairingMembers)
    .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
    .where(
      and(
        eq(pairings.eventRoundId, args.eventRoundId),
        eq(pairingMembers.playerId, args.targetPlayerId),
        eq(pairings.tenantId, tenantId),
        eq(pairingMembers.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (targetFoursomeRows.length === 0) {
    return { ok: false, code: 'player_not_in_any_foursome' };
  }
  const targetFoursomeNumber = targetFoursomeRows[0]!.foursomeNumber;
  const targetScorer = roundScorers.find(
    (s) => s.foursomeNumber === targetFoursomeNumber,
  );
  if (!targetScorer) {
    return { ok: false, code: 'foursome_has_no_scorer' };
  }

  // Happy path: caller IS the designated scorer of the target foursome.
  if (targetScorer.scorerPlayerId === args.callerPlayerId) {
    return { ok: true, foursomeNumber: targetFoursomeNumber };
  }

  // Mismatch — resolve the more-specific 403 code + the current scorer's name.
  const scorerNameRows = await txOrDb
    .select({ name: players.name })
    .from(players)
    .where(
      and(
        eq(players.id, targetScorer.scorerPlayerId),
        eq(players.tenantId, tenantId),
      ),
    )
    .limit(1);
  const currentScorerName =
    scorerNameRows.length > 0 ? scorerNameRows[0]!.name : null;
  const isScorerOfAnyOtherFoursome = roundScorers.some(
    (s) => s.scorerPlayerId === args.callerPlayerId,
  );
  return {
    ok: false,
    code: isScorerOfAnyOtherFoursome
      ? 'player_not_in_your_foursome'
      : 'not_scorer_for_this_foursome',
    currentScorerPlayerId: targetScorer.scorerPlayerId,
    currentScorerName,
  };
}

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

  // Steps 6a/6b + decision-tree delegated to the shared resolveScorerGate
  // helper (also reused by routes/claims.ts). Behavior is identical to the
  // prior inline logic; only the response-mapping below is middleware-specific.
  const decision = await resolveScorerGate(db, {
    roundId,
    eventRoundId: round.eventRoundId,
    targetPlayerId: parsed.data.playerId,
    callerPlayerId: player.id,
    tenantId: TENANT_ID,
  });

  if (decision.ok) {
    await next();
    return;
  }

  switch (decision.code) {
    case 'player_not_in_any_foursome':
      return c.json(
        { error: 'not_found', code: 'player_not_in_any_foursome', requestId },
        404,
      );
    case 'foursome_has_no_scorer':
      return c.json(
        { error: 'unprocessable', code: 'foursome_has_no_scorer', requestId },
        422,
      );
    default:
      // 'player_not_in_your_foursome' | 'not_scorer_for_this_foursome'
      return c.json(
        {
          error: 'forbidden',
          code: decision.code,
          currentScorerPlayerId: decision.currentScorerPlayerId,
          currentScorerName: decision.currentScorerName ?? null,
          requestId,
        },
        403,
      );
  }
};
