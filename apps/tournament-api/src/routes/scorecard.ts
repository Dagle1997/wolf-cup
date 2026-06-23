/**
 * scorecard.ts (Story 3-2) — read-only per-player scorecard endpoint that feeds
 * the during-round board (Story 3-1 HoleBadge/ScorecardGrid, wired in 3-4).
 *
 * Mount: `app.route('/api/rounds', scorecardRouter)`. Effective URL:
 *   GET /api/rounds/:roundId/players/:playerId/scorecard
 *
 * Chain: requireSession → handler. The handler resolves the round (tenant-
 * scoped, 404 round_not_found), authorizes the CALLER as an event participant
 * (group member) OR the event organizer (inlined require-event-participant
 * semantics — that middleware keys on :eventId, which this round-scoped route
 * lacks), verifies the TARGET player is in the round's pairings (404
 * player_not_in_round), then delegates to buildPlayerScorecard.
 *
 * No money is exposed (moneyNet is null until Story 3-3); read visibility
 * matches the leaderboard (any event participant). When 3-3 adds real money,
 * revisit money audience-bounding for cross-group viewers (NFR-S1).
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  events,
  groupMembers,
  groups,
  pairingMembers,
  pairings,
  rounds,
} from '../db/schema/index.js';
import { requireSession } from '../middleware/require-session.js';
import { buildPlayerScorecard, ScorecardDataError } from '../services/scorecard.js';
import { logger as moduleLogger } from '../lib/log.js';

const TENANT_ID = 'guyan';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const scorecardRouter = new Hono();

scorecardRouter.get(
  '/:roundId/players/:playerId/scorecard',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const player = c.get('player')!;
    const roundId = c.req.param('roundId')!;
    const targetPlayerId = c.req.param('playerId')!;

    // The during-round board (Story 3-4) polls this endpoint for live scores, so
    // a cached response would show stale data; no-store also keeps per-player
    // scoring (and the real moneyNet that Story 3-3 adds) out of shared caches.
    c.header('Cache-Control', 'no-store');

    if (!UUID_RE.test(roundId)) {
      return c.json({ error: 'bad_request', code: 'invalid_round_id', requestId }, 400);
    }
    if (!UUID_RE.test(targetPlayerId)) {
      return c.json({ error: 'bad_request', code: 'invalid_player_id', requestId }, 400);
    }

    // (1) Round existence — uniform 404 for nonexistent / foreign-tenant /
    // standalone (no event pairing). Tenant-scoped.
    const roundRows = await db
      .select({ eventId: rounds.eventId, eventRoundId: rounds.eventRoundId })
      .from(rounds)
      .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
      .limit(1);
    const round = roundRows[0];
    if (round === undefined || round.eventId === null || round.eventRoundId === null) {
      return c.json({ error: 'not_found', code: 'round_not_found', requestId }, 404);
    }

    // (2) Caller authorization: event participant (group member) OR the event's
    // organizer. Inlines require-event-participant.ts (which needs :eventId);
    // both joined tables are tenant-scoped (no cross-tenant leak).
    const memberRows = await db
      .select({ playerId: groupMembers.playerId })
      .from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .where(
        and(
          eq(groups.eventId, round.eventId),
          eq(groupMembers.playerId, player.id),
          eq(groups.tenantId, TENANT_ID),
          eq(groupMembers.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (memberRows.length === 0) {
      const orgRows = await db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.id, round.eventId),
            eq(events.organizerPlayerId, player.id),
            eq(events.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      if (orgRows.length === 0) {
        return c.json(
          { error: 'forbidden', code: 'not_event_participant', requestId },
          403,
        );
      }
    }

    // (3) Target player must be in this round's pairings (tenant-scoped).
    const inRoundRows = await db
      .select({ playerId: pairingMembers.playerId })
      .from(pairingMembers)
      .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
      .where(
        and(
          eq(pairings.eventRoundId, round.eventRoundId),
          eq(pairingMembers.playerId, targetPlayerId),
          eq(pairings.tenantId, TENANT_ID),
          eq(pairingMembers.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (inRoundRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'player_not_in_round', requestId },
        404,
      );
    }

    // (4) Build + return the scorecard.
    try {
      const holes = await buildPlayerScorecard(db, {
        roundId,
        playerId: targetPlayerId,
        tenantId: TENANT_ID,
      });
      return c.json({ holes });
    } catch (err) {
      if (err instanceof ScorecardDataError) {
        const log = c.get('logger') ?? moduleLogger;
        log.error({
          msg: 'scorecard data error',
          requestId,
          roundId,
          targetPlayerId,
          err: String(err),
        });
        return c.json(
          { error: 'internal', code: 'scorecard_data_error', requestId },
          500,
        );
      }
      throw err;
    }
  },
);
