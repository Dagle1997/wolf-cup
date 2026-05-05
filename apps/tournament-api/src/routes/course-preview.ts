/**
 * T7-3 course preview endpoint.
 *
 * Mount: `app.route('/api/events', coursePreviewRouter)`. Effective URL:
 *   GET /api/events/:eventId/courses/:courseId
 *
 * Auth chain: `requireSession` → `requireEventParticipant`. Same
 * no-existence-leak invariant as money/bets/T7-1/T7-2: malformed or
 * unknown :eventId returns 403 from the participant middleware.
 *
 * Multi-revision pinning per FD-8: the pinning round is the LOWEST
 * (round_number ASC, event_rounds.id ASC) row in this event whose
 * course_revision points at :courseId. The response uses that
 * revision's tees + holes + totals. defaultTeeColor is the pinning
 * round's tee_color (null if it doesn't match any course_tees row).
 *
 * Course-not-in-event / unknown courseId / malformed courseId all
 * return 403 not_event_participant — no soft-leak (codex spec M #3+4).
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  courseHoles,
  courseRevisions,
  courseTees,
  courses,
  eventRounds,
} from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';

const TENANT_ID = 'guyan';

export const coursePreviewRouter = new Hono();

coursePreviewRouter.get(
  '/:eventId/courses/:courseId',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId')!;
    const courseId = c.req.param('courseId')!;

    try {
      // Find candidate event_rounds in this event whose course_revision
      // belongs to :courseId. Inner join filters by course_id.
      const candidateRounds = await db
        .select({
          eventRoundId: eventRounds.id,
          roundNumber: eventRounds.roundNumber,
          courseRevisionId: eventRounds.courseRevisionId,
          teeColor: eventRounds.teeColor,
        })
        .from(eventRounds)
        .innerJoin(
          courseRevisions,
          eq(eventRounds.courseRevisionId, courseRevisions.id),
        )
        .where(
          and(
            eq(eventRounds.eventId, eventId),
            eq(courseRevisions.courseId, courseId),
            eq(eventRounds.tenantId, TENANT_ID),
            eq(courseRevisions.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(eventRounds.roundNumber), asc(eventRounds.id));

      if (candidateRounds.length === 0) {
        // Course not referenced by any of this event's rounds (or
        // unknown/malformed courseId). Uniform 403 — no soft-leak.
        return c.json(
          { error: 'forbidden', code: 'not_event_participant', requestId },
          403,
        );
      }

      const pinning = candidateRounds[0]!;

      // Course row.
      const courseRows = await db
        .select({
          id: courses.id,
          name: courses.name,
          clubName: courses.clubName,
        })
        .from(courses)
        .where(and(eq(courses.id, courseId), eq(courses.tenantId, TENANT_ID)))
        .limit(1);
      if (courseRows.length === 0) {
        log.error({
          msg: 'GET /courses/:courseId — course row missing despite join',
          requestId,
          eventId,
          courseId,
        });
        return c.json(
          { error: 'forbidden', code: 'not_event_participant', requestId },
          403,
        );
      }

      // Revision row.
      const revRows = await db
        .select({
          id: courseRevisions.id,
          revisionNumber: courseRevisions.revisionNumber,
          outTotal: courseRevisions.outTotal,
          inTotal: courseRevisions.inTotal,
          courseTotal: courseRevisions.courseTotal,
        })
        .from(courseRevisions)
        .where(
          and(
            eq(courseRevisions.id, pinning.courseRevisionId),
            eq(courseRevisions.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      if (revRows.length === 0) {
        log.error({
          msg: 'GET /courses/:courseId — revision row missing',
          requestId,
          eventId,
          courseId,
          courseRevisionId: pinning.courseRevisionId,
        });
        return c.json(
          { error: 'forbidden', code: 'not_event_participant', requestId },
          403,
        );
      }

      // Tees for this revision; lowercase(teeColor) ASC.
      const teeRows = await db
        .select({
          teeColor: courseTees.teeColor,
          rating: courseTees.rating,
          slope: courseTees.slope,
        })
        .from(courseTees)
        .where(
          and(
            eq(courseTees.courseRevisionId, revRows[0]!.id),
            eq(courseTees.tenantId, TENANT_ID),
          ),
        );
      teeRows.sort((a, b) =>
        a.teeColor.toLowerCase().localeCompare(b.teeColor.toLowerCase()),
      );

      // Holes for this revision; ordered by holeNumber asc.
      const holeRows = await db
        .select({
          holeNumber: courseHoles.holeNumber,
          par: courseHoles.par,
          si: courseHoles.si,
          yardagePerTeeJson: courseHoles.yardagePerTeeJson,
        })
        .from(courseHoles)
        .where(
          and(
            eq(courseHoles.courseRevisionId, revRows[0]!.id),
            eq(courseHoles.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(courseHoles.holeNumber));

      const holes = holeRows.map((h) => {
        let yardageByTee: Record<string, number> = {};
        try {
          const parsed = JSON.parse(h.yardagePerTeeJson);
          if (
            parsed !== null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed)
          ) {
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              if (typeof v === 'number' && Number.isFinite(v)) {
                yardageByTee[k] = v;
              }
            }
          }
        } catch {
          log.warn({
            msg: 'GET /courses/:courseId — yardagePerTeeJson malformed; defaulting to empty',
            requestId,
            eventId,
            courseId,
            holeNumber: h.holeNumber,
          });
          yardageByTee = {};
        }
        return {
          holeNumber: h.holeNumber,
          par: h.par as 3 | 4 | 5,
          si: h.si,
          yardageByTee,
        };
      });

      // defaultTeeColor: pinning round's tee_color IF it matches any of
      // the revision's tees rows (case-insensitive); else null.
      // Defensive null-coalesce on pinning.teeColor — schema declares it
      // notNull but a malformed DB state shouldn't 500 (codex impl L #3).
      const pinningTeeLower = (pinning.teeColor ?? '').toLowerCase();
      const matchingTee =
        pinningTeeLower.length > 0
          ? teeRows.find((t) => t.teeColor.toLowerCase() === pinningTeeLower)
          : undefined;
      const defaultTeeColor = matchingTee !== undefined ? matchingTee.teeColor : null;

      c.header('cache-control', 'no-store');
      return c.json(
        {
          course: courseRows[0]!,
          revision: revRows[0]!,
          tees: teeRows,
          holes,
          defaultTeeColor,
        },
        200,
      );
    } catch (err) {
      log.error({
        msg: 'GET /events/:eventId/courses/:courseId threw',
        requestId,
        eventId,
        courseId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'course_get_failed', requestId },
        500,
      );
    }
  },
);
