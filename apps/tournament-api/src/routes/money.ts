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
import { computeMoneyMatrix, type MoneyMatrix } from '../services/money.js';
import { computeFoursomeResults, computeMyMoney } from '../services/money-detail.js';
import { computeTeamStandings } from '../services/team-standings.js';
import { computeMatchPlayStandings } from '../services/match-play-standings.js';

const TENANT_ID = 'guyan';

/**
 * Audience-bound the money matrix for the requesting viewer (Story 1.4, AC8/AC12).
 *
 * - NON-F1 events, and F1 events in LOCKED mode: returned UNCHANGED (the
 *   participant gate already excludes non-roster viewers; locked = money/P&L
 *   mode shows the full N×N matrix, today's behavior — ZERO regression).
 * - F1 events in UNLOCKED mode (scores-only): the cross-player matrix is redacted
 *   to the viewer's OWN row + column + total only; every other pair's dollars are
 *   zeroed server-side so the open matrix cannot leak intra-roster dollars. My
 *   Money (`/my-money`) remains the viewer-private money surface in this mode.
 */
function boundMoneyMatrixForViewer(matrix: MoneyMatrix, viewerId: string): MoneyMatrix {
  if (!matrix.f1 || matrix.f1.lockState !== 'unlocked') return matrix;

  const redactLedger = (ledger: { matrix: Record<string, Record<string, number>>; totals: Record<string, number> }) => {
    const out: Record<string, Record<string, number>> = {};
    for (const a of Object.keys(ledger.matrix)) {
      out[a] = {};
      for (const b of Object.keys(ledger.matrix[a]!)) {
        // Keep only the cells the viewer is party to; zero the rest.
        out[a]![b] = a === viewerId || b === viewerId ? (ledger.matrix[a]![b] ?? 0) : 0;
      }
    }
    const totals: Record<string, number> = {};
    for (const a of Object.keys(ledger.totals)) {
      totals[a] = a === viewerId ? (ledger.totals[a] ?? 0) : 0;
    }
    return { matrix: out, totals };
  };

  const combined = redactLedger({ matrix: matrix.matrix, totals: matrix.totals });
  return {
    ...matrix,
    matrix: combined.matrix,
    totals: combined.totals,
    teamLedger: redactLedger(matrix.teamLedger),
    individualLedger: redactLedger(matrix.individualLedger),
    actionLedger: redactLedger(matrix.actionLedger),
  };
}

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
      // Audience-bounding / F1 money MODE (Story 1.4, AC8/AC12). Non-roster
      // viewers never reach here (requireEventParticipant 403s them, organizer
      // exempt). For an F1 event in UNLOCKED mode the full cross-player matrix is
      // scores-only — redact every other player's dollars to the viewer's own
      // row server-side, so the open matrix can't leak intra-roster dollars via
      // a raw API call; My Money stays the viewer-private money surface.
      const bounded = boundMoneyMatrixForViewer(matrix, player.id);
      return c.json(bounded, 200);
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

// Event-level MATCH-PLAY points (Pete Dye Phase 2): the foursome-internal 2v2
// match (slots 1&2 vs 3&4) scored per round → win/halve/loss points aggregated
// per 2-man team. A SEPARATE parallel board from /team-standings (which decides
// the pot); both are shown independently.
moneyRouter.get(
  '/:eventId/match-play-standings',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId');
    try {
      const standings = await computeMatchPlayStandings(db, eventId, TENANT_ID);
      c.header('cache-control', 'no-store');
      return c.json(standings, 200);
    } catch (err) {
      log.error({ msg: 'GET /match-play-standings threw', requestId, eventId, err: String(err) });
      return c.json(
        { error: 'internal', code: 'match_play_standings_failed', requestId },
        500,
      );
    }
  },
);
