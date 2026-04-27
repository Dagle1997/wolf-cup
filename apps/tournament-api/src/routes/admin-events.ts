/**
 * T3-2 admin-events router. Single route: POST /api/admin/events.
 *
 * Creates an Event with N rounds + 1 invite link + 1 default Group in a
 * single drizzle transaction. Mirrors the admin-courses save endpoint's
 * pattern (Zod parse → pre-flight existence checks → transactional persist
 * → 201/400/500 response shapes).
 *
 * Middleware chain (route-level):
 *   requireSession → requireOrganizer → bodyLimit(16 KB) → handler
 *
 * CSRF protection is applied globally in app.ts:25 (T1-6a's csrf({ origin })
 * mount); this route inherits it without re-mounting.
 *
 * Differences vs admin-courses save (T2-5):
 *   - No 409 carveout: events have no UNIQUE on (name, ...). The only
 *     UNIQUEs in this transaction are dev-bug or astronomically unlikely
 *     (event_rounds composite + invites.token), so they bubble as 500.
 *   - Pre-flight `course_revision_id` existence check converts otherwise-500
 *     FK violations into clean 400 unknown_course_revision responses.
 *   - Invite token entropy: crypto.randomBytes(32).toString('base64url')
 *     mirrors the sessions cookie pattern.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { inArray } from 'drizzle-orm';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { db } from '../db/index.js';
import {
  events,
  eventRounds,
  invites,
  groups,
  courseRevisions,
} from '../db/schema/index.js';

const SAVE_BODY_LIMIT_BYTES = 16 * 1024;
const TENANT_ID = 'guyan';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * IANA timezone validator. Engine-deferred validation: not all engines
 * throw at construct time; calling .format() exercises the timeZone. Copied
 * locally (NOT shared via a util module) to keep T3-2 free of SHARED edits;
 * the client wizard has its own copy.
 */
function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

const CreateEventRequestSchema = z
  .object({
    name: z.string().trim().min(1),
    start_date: z.number().int().positive(),
    end_date: z.number().int().positive(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .refine((tz) => isValidIanaTimezone(tz), {
        message: 'timezone must be a valid IANA tz string',
      }),
    rounds: z
      .array(
        z.object({
          round_date: z.number().int().positive(),
          course_revision_id: z.string().min(1),
          tee_color: z.string().trim().min(1),
          holes_to_play: z.union([z.literal(9), z.literal(18)]),
        }),
      )
      .min(1)
      .max(20),
  })
  .refine((data) => data.end_date >= data.start_date, {
    path: ['end_date'],
    message: 'end_date must be on or after start_date',
  })
  .refine(
    (data) =>
      data.rounds.every(
        (r) => r.round_date >= data.start_date && r.round_date <= data.end_date,
      ),
    {
      path: ['rounds'],
      message: 'each round_date must be within [start_date, end_date]',
    },
  );

export const adminEventsRouter = new Hono();

adminEventsRouter.post(
  '/events',
  requireSession,
  requireOrganizer,
  bodyLimit({
    maxSize: SAVE_BODY_LIMIT_BYTES,
    onError: (c) => {
      const requestId = c.get('requestId');
      return c.json(
        { error: 'bad_request', code: 'body_too_large', requestId },
        400,
      );
    },
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const player = c.get('player');

    if (!player) {
      // requireSession + requireOrganizer should make this unreachable;
      // defense-in-depth so a future middleware ordering bug is loud.
      return c.json(
        { error: 'internal', code: 'middleware_misuse', requestId },
        500,
      );
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    const parseResult = CreateEventRequestSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parseResult.error.issues,
        },
        400,
      );
    }
    const body = parseResult.data;

    // Pre-flight: every course_revision_id must exist. Converts otherwise-
    // 500 FK violations into a clean 400 unknown_course_revision response.
    // Wrapped in try/catch so a DB connection blip during the SELECT
    // returns the standard create_failed 500 shape instead of crashing
    // into Hono's default error handler.
    const requestedRevisionIds = Array.from(
      new Set(body.rounds.map((r) => r.course_revision_id)),
    );
    let existingIds: Set<string>;
    try {
      const existingRevisions = await db
        .select({ id: courseRevisions.id })
        .from(courseRevisions)
        .where(inArray(courseRevisions.id, requestedRevisionIds));
      existingIds = new Set(existingRevisions.map((r) => r.id));
    } catch (err) {
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'admin_event_create_failed',
        eventName: body.name,
        stage: 'preflight_course_revision_check',
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json(
        { error: 'internal', code: 'create_failed', requestId },
        500,
      );
    }
    const missingIds = requestedRevisionIds.filter((id) => !existingIds.has(id));
    if (missingIds.length > 0) {
      return c.json(
        {
          error: 'bad_request',
          code: 'unknown_course_revision',
          requestId,
          missing: missingIds,
        },
        400,
      );
    }

    const eventId = randomUUID();
    const contextId = `event:${eventId}`;
    const inviteToken = randomBytes(32).toString('base64url');
    const now = Date.now();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(events).values({
          id: eventId,
          name: body.name,
          startDate: body.start_date,
          endDate: body.end_date,
          timezone: body.timezone,
          organizerPlayerId: player.id,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId,
        });

        await tx.insert(eventRounds).values(
          body.rounds.map((round, idx) => ({
            id: randomUUID(),
            eventId,
            roundNumber: idx + 1,
            roundDate: round.round_date,
            courseRevisionId: round.course_revision_id,
            teeColor: round.tee_color,
            holesToPlay: round.holes_to_play,
            createdAt: now,
            tenantId: TENANT_ID,
            contextId,
          })),
        );

        await tx.insert(invites).values({
          id: randomUUID(),
          eventId,
          token: inviteToken,
          expiresAt: now + INVITE_TTL_MS,
          createdByPlayerId: player.id,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId,
        });

        await tx.insert(groups).values({
          id: randomUUID(),
          eventId,
          name: `${body.name} Crew`,
          moneyVisibilityMode: 'open',
          createdAt: now,
          tenantId: TENANT_ID,
          contextId,
        });
      });
    } catch (err) {
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'admin_event_create_failed',
        eventName: body.name,
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json(
        { error: 'internal', code: 'create_failed', requestId },
        500,
      );
    }

    log.info({
      event: 'admin_event_created',
      eventId,
      eventName: body.name,
      roundCount: body.rounds.length,
    });

    return c.json({ eventId, inviteToken, requestId }, 201);
  },
);
