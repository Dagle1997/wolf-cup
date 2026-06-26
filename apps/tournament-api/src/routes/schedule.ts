/**
 * T7-2 Schedule endpoint — event schedule with course + viewer's pairing.
 *
 * Mount: `app.route('/api/events', scheduleRouter)`. Effective URL:
 *   GET /api/events/:eventId/schedule
 *
 * Auth chain: `requireSession` → `requireEventParticipant`. Same
 * no-existence-leak invariant as money/bets/T7-1: malformed or unknown
 * :eventId returns 403 from the participant middleware.
 *
 * Per-round shape: course name + tee color + holes-to-play chip +
 * viewer's foursome pairing. Pairing is a discriminated union with
 * three states (no_pairings_set / viewer_not_in_foursome / foursome).
 *
 * v1 trim — only the viewer's own foursome is returned for each round
 * (FR-H6 allows all-foursomes; v1 keeps the wire payload focused).
 * All-foursomes view is followup T7-2c.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  courseRevisions,
  courses,
  eventRounds,
  events,
  pairingMembers,
  pairings,
  players,
  rounds,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import { loadLockedHandicapsByEvent } from '../services/event-handicap-overrides.js';

const TENANT_ID = 'guyan';

export const scheduleRouter = new Hono();

interface PairingMember {
  playerId: string;
  name: string;
  handicapIndex: number;
  isViewer: boolean;
  /** Per-player tee override (T10). null → uses round.teeColor as default. */
  teeColor: string | null;
}

type PairingState =
  | { kind: 'foursome'; foursomeNumber: number; members: PairingMember[] }
  | { kind: 'no_pairings_set' }
  | { kind: 'viewer_not_in_foursome' };

scheduleRouter.get(
  '/:eventId/schedule',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const eventId = c.req.param('eventId')!;

    try {
      // Event row.
      const eventRows = await db
        .select({
          id: events.id,
          name: events.name,
          timezone: events.timezone,
        })
        .from(events)
        .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
        .limit(1);
      if (eventRows.length === 0) {
        // Defense-in-depth (middleware should have 403'd; if a race
        // hard-deletes the event, mirror that response shape).
        return c.json(
          { error: 'forbidden', code: 'not_event_participant', requestId },
          403,
        );
      }

      // When the event's handicaps are LOCKED, the snapshot index — not the
      // player's manual index — is what every round plays off (and what the
      // leaderboard/money show). The schedule must show the SAME number, or
      // GHIN-sourced players (manual index null) render a misleading 0.0.
      // Empty map for an unlocked event → falls back to the manual index.
      const lockedHandicaps = await loadLockedHandicapsByEvent(db, eventId, TENANT_ID);

      // Event rounds (ordered by round_number asc).
      const roundRows = await db
        .select({
          id: eventRounds.id,
          roundNumber: eventRounds.roundNumber,
          roundDate: eventRounds.roundDate,
          holesToPlay: eventRounds.holesToPlay,
          teeColor: eventRounds.teeColor,
          courseRevisionId: eventRounds.courseRevisionId,
        })
        .from(eventRounds)
        .where(
          and(
            eq(eventRounds.eventId, eventId),
            eq(eventRounds.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(eventRounds.roundNumber));

      // Per-round: course + viewer's pairing (3-state discriminated).
      const roundsOut: Array<{
        id: string;
        runtimeRoundId: string | null;
        roundNumber: number;
        roundDate: number;
        holesToPlay: 9 | 18;
        teeColor: string;
        course: { id: string; name: string; clubName: string };
        pairing: PairingState;
      }> = [];

      for (const r of roundRows) {
        // Runtime rounds row id (separate from event_round_id). Score-entry
        // and other live-round pages use rounds.id, not event_rounds.id.
        // null until /api/admin/event-rounds/:eventRoundId/start has run.
        const runtimeRoundRows = await db
          .select({ id: rounds.id })
          .from(rounds)
          .where(
            and(
              eq(rounds.eventRoundId, r.id),
              eq(rounds.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        const runtimeRoundId = runtimeRoundRows[0]?.id ?? null;

        // Course via revision.
        const revRows = await db
          .select({ courseId: courseRevisions.courseId })
          .from(courseRevisions)
          .where(
            and(
              eq(courseRevisions.id, r.courseRevisionId),
              eq(courseRevisions.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        if (revRows.length === 0) {
          // Orphaned round — log + skip rather than 500 the whole response.
          // Codex impl finding HIGH #2: surfacing instead of silent skip.
          log.warn({
            msg: 'GET /schedule — orphaned round (course_revision missing); skipping',
            requestId,
            eventId,
            roundId: r.id,
            courseRevisionId: r.courseRevisionId,
          });
          continue;
        }
        const courseRows = await db
          .select({
            id: courses.id,
            name: courses.name,
            clubName: courses.clubName,
          })
          .from(courses)
          .where(
            and(
              eq(courses.id, revRows[0]!.courseId),
              eq(courses.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        if (courseRows.length === 0) {
          log.warn({
            msg: 'GET /schedule — orphaned round (course missing); skipping',
            requestId,
            eventId,
            roundId: r.id,
            courseId: revRows[0]!.courseId,
          });
          continue;
        }

        // Viewer's foursome (if any).
        const memberRow = await db
          .select({
            pairingId: pairingMembers.pairingId,
          })
          .from(pairingMembers)
          .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
          .where(
            and(
              eq(pairings.eventRoundId, r.id),
              eq(pairingMembers.playerId, player.id),
              eq(pairings.tenantId, TENANT_ID),
              eq(pairingMembers.tenantId, TENANT_ID),
            ),
          )
          .limit(1);

        let pairingState: PairingState;
        if (memberRow.length === 1) {
          // Viewer is in a foursome — load all 4 members.
          const myPairingId = memberRow[0]!.pairingId;
          const pairingMeta = await db
            .select({ foursomeNumber: pairings.foursomeNumber })
            .from(pairings)
            .where(
              and(
                eq(pairings.id, myPairingId),
                eq(pairings.tenantId, TENANT_ID),
              ),
            )
            .limit(1);
          const memberRows = await db
            .select({
              playerId: pairingMembers.playerId,
              slotNumber: pairingMembers.slotNumber,
              teeColor: pairingMembers.teeColor,
              name: players.name,
              manualHandicapIndex: players.manualHandicapIndex,
            })
            .from(pairingMembers)
            .innerJoin(players, eq(pairingMembers.playerId, players.id))
            .where(
              and(
                eq(pairingMembers.pairingId, myPairingId),
                eq(pairingMembers.tenantId, TENANT_ID),
                eq(players.tenantId, TENANT_ID),
              ),
            )
            .orderBy(asc(pairingMembers.slotNumber));
          pairingState = {
            kind: 'foursome',
            foursomeNumber: pairingMeta[0]?.foursomeNumber ?? 1,
            members: memberRows.map((m) => ({
              playerId: m.playerId,
              name: m.name,
              // Locked snapshot overrides the manual index (even when locked to
              // null), mirroring leaderboard.ts; ?? 0 only for the display type.
              handicapIndex:
                (lockedHandicaps.has(m.playerId)
                  ? lockedHandicaps.get(m.playerId)
                  : m.manualHandicapIndex) ?? 0,
              isViewer: m.playerId === player.id,
              teeColor: m.teeColor,
            })),
          };
        } else {
          // Viewer not in a foursome. Distinguish:
          //   - no pairings rows for this round → 'no_pairings_set'
          //   - pairings exist but viewer not a member → 'viewer_not_in_foursome'
          const anyPairingRows = await db
            .select({ id: pairings.id })
            .from(pairings)
            .where(
              and(
                eq(pairings.eventRoundId, r.id),
                eq(pairings.tenantId, TENANT_ID),
              ),
            )
            .limit(1);
          pairingState =
            anyPairingRows.length === 0
              ? { kind: 'no_pairings_set' }
              : { kind: 'viewer_not_in_foursome' };
        }

        // Defense-in-depth holesToPlay sanity check (codex impl finding M #4).
        // Schema doesn't constrain to {9,18}; surface anomalies via log.
        if (r.holesToPlay !== 9 && r.holesToPlay !== 18) {
          log.warn({
            msg: 'GET /schedule — round has unexpected holesToPlay value',
            requestId,
            eventId,
            roundId: r.id,
            holesToPlay: r.holesToPlay,
          });
        }
        roundsOut.push({
          id: r.id,
          runtimeRoundId,
          roundNumber: r.roundNumber,
          roundDate: r.roundDate,
          holesToPlay: r.holesToPlay as 9 | 18,
          teeColor: r.teeColor,
          course: {
            id: courseRows[0]!.id,
            name: courseRows[0]!.name,
            clubName: courseRows[0]!.clubName,
          },
          pairing: pairingState,
        });
      }

      c.header('cache-control', 'no-store');
      return c.json(
        {
          event: eventRows[0]!,
          rounds: roundsOut,
        },
        200,
      );
    } catch (err) {
      log.error({
        msg: 'GET /events/:eventId/schedule threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'schedule_get_failed', requestId },
        500,
      );
    }
  },
);
