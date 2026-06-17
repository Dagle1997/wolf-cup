/**
 * T6-5 GET /api/events/:eventId/money — head-to-head money matrix.
 *
 * Auth chain: requireSession → requireEventParticipant.
 * Malformed/nonexistent eventId returns 403 from middleware (no-existence-leak).
 *
 * Calls services/money.ts computeMoneyMatrix; returns the MoneyMatrix payload.
 * Sets cache-control: no-store header per spec AC-5.
 *
 * Read-only: no audit, no activity, no DB writes.
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { eventRounds } from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import { computeMoneyMatrix } from '../services/money.js';
import { computeFoursomeResults, computeMyMoney } from '../services/money-detail.js';
import { computeTeamStandings } from '../services/team-standings.js';

const TENANT_ID = 'guyan';

export const moneyRouter = new Hono();

moneyRouter.get(
  '/:eventId/money',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId');

    try {
      const matrix = await computeMoneyMatrix(db, eventId, player.id, TENANT_ID);
      c.header('cache-control', 'no-store');
      return c.json(matrix, 200);
    } catch (err) {
      log.error({
        msg: 'GET /money threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'money_compute_failed', requestId },
        500,
      );
    }
  },
);

// T13-5: the viewer's entire event P&L, decomposed by game (2-ball foursome
// match + each individual side bet), every value viewer-signed. Powers the
// "My Money" board.
moneyRouter.get(
  '/:eventId/my-money',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId');
    try {
      const result = await computeMyMoney(db, eventId, player.id, TENANT_ID);
      c.header('cache-control', 'no-store');
      return c.json(result, 200);
    } catch (err) {
      log.error({ msg: 'GET /my-money threw', requestId, eventId, err: String(err) });
      return c.json({ error: 'internal', code: 'my_money_failed', requestId }, 500);
    }
  },
);

// T13-5: per-foursome 2v2 team results (hole by hole) for one event round —
// the "Foursome results" view reached from the leaderboard at round-end.
moneyRouter.get(
  '/:eventId/event-rounds/:eventRoundId/foursome-results',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId');
    const eventRoundId = c.req.param('eventRoundId');

    // Event-scope guard: the event_round must belong to THIS event (a
    // participant of event X must not read event Y's round via its id).
    const erRows = await db
      .select({ id: eventRounds.id })
      .from(eventRounds)
      .where(
        and(
          eq(eventRounds.id, eventRoundId),
          eq(eventRounds.eventId, eventId),
          eq(eventRounds.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (erRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'event_round_not_found', requestId },
        404,
      );
    }

    try {
      const results = await computeFoursomeResults(db, eventRoundId, TENANT_ID);
      c.header('cache-control', 'no-store');
      return c.json(results, 200);
    } catch (err) {
      log.error({
        msg: 'GET /foursome-results threw',
        requestId,
        eventId,
        eventRoundId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'foursome_results_failed', requestId },
        500,
      );
    }
  },
);

// Event-level 2-man TEAM standings (member-guest "best ball" overall):
// each team's cumulative best-ball gross / net / net-to-par across all rounds,
// sorted by net-to-par. Match-play points (schedule-dependent) is Phase 2.
moneyRouter.get(
  '/:eventId/team-standings',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId');
    try {
      const standings = await computeTeamStandings(db, eventId, TENANT_ID);
      c.header('cache-control', 'no-store');
      return c.json(standings, 200);
    } catch (err) {
      log.error({ msg: 'GET /team-standings threw', requestId, eventId, err: String(err) });
      return c.json(
        { error: 'internal', code: 'team_standings_failed', requestId },
        500,
      );
    }
  },
);
