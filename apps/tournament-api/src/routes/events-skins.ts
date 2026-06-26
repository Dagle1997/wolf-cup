/**
 * Live Skins board — GET /api/events/:eventId/skins
 *
 * Mount: `app.route('/api/events', eventsSkinsRouter)`.
 *
 * For every skins sub-game on the event's STARTED rounds, computes the pot
 * LIVE (recompute-on-read) and returns: per-hole skin winners (and carries),
 * each participant's net P&L (won − buy-in), and the pot total. Reuses
 * `computeSkinsResult` — the SAME math the finalize path persists — so the
 * live board can never diverge from the banked pot. Scoped strictly to each
 * sub-game's selected participants (non-participants never appear).
 *
 * NOT final: a live pot can move as scores come in / are corrected (the same
 * caveat as the live leaderboard). The board labels itself "live".
 *
 * Auth: requireSession → requireEventParticipant (no-existence-leak; an unknown
 * eventId 403s from the middleware, like schedule/money).
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  eventRounds,
  players,
  rounds,
  subGames,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import { computeSkinsResult } from '../services/sub-games.js';

const TENANT_ID = 'guyan';

export const eventsSkinsRouter = new Hono();

const MODE_LABEL: Record<string, string> = {
  net: 'Net Skins',
  gross: 'Gross Skins',
  gross_beats_net: 'Canadian Skins',
};

eventsSkinsRouter.get(
  '/:eventId/skins',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId')!;

    // All skins sub-games for this event, with their round number, ordered by
    // round then a stable mode order.
    const sgRows = await db
      .select({
        subGameId: subGames.id,
        eventRoundId: subGames.eventRoundId,
        roundNumber: eventRounds.roundNumber,
        type: subGames.type,
      })
      .from(subGames)
      .innerJoin(eventRounds, eq(eventRounds.id, subGames.eventRoundId))
      .where(
        and(
          eq(eventRounds.eventId, eventId),
          eq(subGames.type, 'skins'),
          eq(subGames.tenantId, TENANT_ID),
          eq(eventRounds.tenantId, TENANT_ID),
        ),
      )
      .orderBy(asc(eventRounds.roundNumber));

    // Only rounds that have actually STARTED have a runtime `rounds` row, which
    // computeSkinsResult requires. Skins on an unstarted round are skipped.
    const startedRoundEventRoundIds = new Set(
      (
        await db
          .select({ eventRoundId: rounds.eventRoundId })
          .from(rounds)
          .where(eq(rounds.tenantId, TENANT_ID))
      )
        .map((r) => r.eventRoundId)
        .filter((id): id is string => id !== null),
    );

    type PotOut = {
      eventRoundId: string;
      roundNumber: number;
      mode: string;
      modeLabel: string;
      buyInPerParticipantCents: number;
      totalPotCents: number;
      participants: Array<{ playerId: string; name: string | null }>;
      holeWinners: Array<{
        hole: number;
        winnerId: string | null;
        winnerName: string | null;
        carriedFromHoles: number[];
        skinValueCents: number;
      }>;
      shares: Array<{ playerId: string; name: string | null; wonCents: number; netCents: number }>;
    };

    const pots: PotOut[] = [];
    for (const sg of sgRows) {
      if (!startedRoundEventRoundIds.has(sg.eventRoundId)) continue;
      let bundle;
      try {
        bundle = await computeSkinsResult(db, sg.subGameId, TENANT_ID);
      } catch (err) {
        // One bad pot must never blank the whole board — skip it and log.
        log.warn({ event: 'skins_live_compute_failed', requestId, eventId, subGameId: sg.subGameId, message: (err as Error)?.message ?? null });
        continue;
      }

      // Names for every participant (and any hole winner, which is always a participant).
      const nameById = new Map<string, string | null>();
      if (bundle.participants.length > 0) {
        const nameRows = await db
          .select({ id: players.id, name: players.name })
          .from(players)
          .where(and(inArray(players.id, bundle.participants), eq(players.tenantId, TENANT_ID)));
        for (const n of nameRows) nameById.set(n.id, n.name);
      }

      // potShares is the share each player WON; net P&L = won − their buy-in.
      const wonByPlayer = new Map<string, number>();
      for (const s of bundle.result.potShares) {
        if (s.playerId !== null) wonByPlayer.set(s.playerId, (wonByPlayer.get(s.playerId) ?? 0) + s.dollarsCents);
      }
      const shares = bundle.participants.map((pid) => {
        const won = wonByPlayer.get(pid) ?? 0;
        return { playerId: pid, name: nameById.get(pid) ?? null, wonCents: won, netCents: won - bundle.buyInPerParticipantCents };
      });

      pots.push({
        eventRoundId: sg.eventRoundId,
        roundNumber: sg.roundNumber,
        mode: bundle.mode,
        modeLabel: MODE_LABEL[bundle.mode] ?? bundle.mode,
        buyInPerParticipantCents: bundle.buyInPerParticipantCents,
        totalPotCents: bundle.result.totalPotCents,
        participants: bundle.participants.map((pid) => ({ playerId: pid, name: nameById.get(pid) ?? null })),
        holeWinners: bundle.result.holeWinners.map((h) => ({
          hole: h.hole,
          winnerId: h.winnerId,
          winnerName: h.winnerId !== null ? nameById.get(h.winnerId) ?? null : null,
          carriedFromHoles: h.carriedFromHoles,
          skinValueCents: h.skinValueCents,
        })),
        shares,
      });
    }

    return c.json({ eventId, pots, requestId }, 200);
  },
);
