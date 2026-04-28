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
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { db } from '../db/index.js';
import {
  events,
  eventRounds,
  invites,
  groups,
  groupMembers,
  pairings,
  pairingMembers,
  players,
  courseRevisions,
} from '../db/schema/index.js';
import { suggestPairings } from '../engine/pairings/suggest.js';

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

// =====================================================================
// T4-2: pairings UI + persistence
// =====================================================================

const PAIRINGS_BODY_LIMIT_BYTES = 16 * 1024;
const FOURSOME_SIZE = 4;

const SaveMemberSchema = z.array(z.string().min(1)).min(1).max(FOURSOME_SIZE);

const SavePairingSchema = z.object({
  foursomeNumber: z.number().int().min(1),
  locked: z.boolean(),
  memberPlayerIds: SaveMemberSchema,
});

const SavePairingsRequestSchema = z.object({
  rounds: z
    .array(
      z.object({
        eventRoundId: z.string().min(1),
        pairings: z.array(SavePairingSchema),
      }),
    )
    .min(1),
});

const SuggestRequestSchema = z.object({
  numRounds: z.number().int().min(1),
  foursomesPerRound: z.number().int().min(1),
  pins: z
    .array(
      z.object({
        round: z.number().int().min(1),
        foursome: z.number().int().min(1),
        playerId: z.string().min(1),
      }),
    )
    .default([]),
  lockedRounds: z.array(z.number().int().min(1)).default([]),
});

/**
 * GET /api/admin/events/:eventId/pairings — fetch all pairings + members
 * for the event, grouped by event_round, with the event's roster.
 */
adminEventsRouter.get(
  '/events/:eventId/pairings',
  requireSession,
  requireOrganizer,
  async (c) => {
    const requestId = c.get('requestId');
    const eventId = c.req.param('eventId');

    const eventRows = await db
      .select({ id: events.id, name: events.name })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)));
    if (eventRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'event_not_found', requestId },
        404,
      );
    }
    const event = eventRows[0]!;

    // Event rounds (in round_number ASC).
    const erRows = await db
      .select({
        id: eventRounds.id,
        roundNumber: eventRounds.roundNumber,
        roundDate: eventRounds.roundDate,
      })
      .from(eventRounds)
      .where(
        and(
          eq(eventRounds.eventId, eventId),
          eq(eventRounds.tenantId, TENANT_ID),
        ),
      )
      .orderBy(asc(eventRounds.roundNumber));

    // Roster: dedupe across groups under this event.
    const groupRows = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.eventId, eventId), eq(groups.tenantId, TENANT_ID)));
    const groupIds = groupRows.map((g) => g.id);
    const roster: Array<{ playerId: string; name: string }> = [];
    if (groupIds.length > 0) {
      const memberRows = await db
        .select({ playerId: players.id, name: players.name })
        .from(groupMembers)
        .innerJoin(players, eq(groupMembers.playerId, players.id))
        .where(
          and(
            inArray(groupMembers.groupId, groupIds),
            eq(groupMembers.tenantId, TENANT_ID),
            eq(players.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(players.name));
      const seen = new Set<string>();
      for (const row of memberRows) {
        if (!seen.has(row.playerId)) {
          seen.add(row.playerId);
          roster.push(row);
        }
      }
    }

    // Pairings + members for each event_round.
    const out: Array<{
      eventRoundId: string;
      roundNumber: number;
      roundDate: number;
      pairings: Array<{
        id: string;
        foursomeNumber: number;
        locked: boolean;
        members: Array<{ playerId: string; name: string; slotNumber: number }>;
      }>;
    }> = [];
    for (const er of erRows) {
      const pRows = await db
        .select({
          id: pairings.id,
          foursomeNumber: pairings.foursomeNumber,
          locked: pairings.locked,
        })
        .from(pairings)
        .where(
          and(
            eq(pairings.eventRoundId, er.id),
            eq(pairings.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(pairings.foursomeNumber));

      const pairingsOut: Array<{
        id: string;
        foursomeNumber: number;
        locked: boolean;
        members: Array<{ playerId: string; name: string; slotNumber: number }>;
      }> = [];
      for (const p of pRows) {
        const memberRows = await db
          .select({
            playerId: pairingMembers.playerId,
            slotNumber: pairingMembers.slotNumber,
            name: players.name,
          })
          .from(pairingMembers)
          .innerJoin(players, eq(pairingMembers.playerId, players.id))
          .where(
            and(
              eq(pairingMembers.pairingId, p.id),
              eq(pairingMembers.tenantId, TENANT_ID),
              eq(players.tenantId, TENANT_ID),
            ),
          )
          .orderBy(asc(pairingMembers.slotNumber));
        pairingsOut.push({
          id: p.id,
          foursomeNumber: p.foursomeNumber,
          locked: p.locked,
          members: memberRows,
        });
      }

      out.push({
        eventRoundId: er.id,
        roundNumber: er.roundNumber,
        roundDate: er.roundDate,
        pairings: pairingsOut,
      });
    }

    return c.json({
      event: { id: event.id, name: event.name },
      rounds: out,
      roster,
      requestId,
    });
  },
);

/**
 * POST /api/admin/events/:eventId/pairings — upsert all pairings for the
 * event in a single transaction. DELETE-then-INSERT semantics.
 *
 * Error precedence (deterministic, first match wins):
 *   1. body_too_large (400) — bodyLimit middleware
 *   2. invalid_body (400) — Zod
 *   3. event_not_found (404)
 *   4. unknown_event_round (400)
 *   5. duplicate_player_in_foursome (400)
 *   6. unknown_player (400)
 *   7. player_in_multiple_pairings_per_round (422)
 */
adminEventsRouter.post(
  '/events/:eventId/pairings',
  requireSession,
  requireOrganizer,
  bodyLimit({
    maxSize: PAIRINGS_BODY_LIMIT_BYTES,
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
    const eventId = c.req.param('eventId');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }
    const parsed = SavePairingsRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parsed.error.issues,
        },
        400,
      );
    }
    const body = parsed.data;

    // Step 3: event existence + tenant.
    const eventRows = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)));
    if (eventRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'event_not_found', requestId },
        404,
      );
    }

    // Step 4a: detect duplicate eventRoundId entries (would cause UNIQUE
    // collision at INSERT time → 500). Reject upfront with clean 400.
    const seenRoundIds = new Set<string>();
    for (const round of body.rounds) {
      if (seenRoundIds.has(round.eventRoundId)) {
        return c.json(
          {
            error: 'bad_request',
            code: 'duplicate_event_round',
            requestId,
            eventRoundId: round.eventRoundId,
          },
          400,
        );
      }
      seenRoundIds.add(round.eventRoundId);
      // Also detect duplicate foursomeNumber within a single round.
      const seenFoursomes = new Set<number>();
      for (const p of round.pairings) {
        if (seenFoursomes.has(p.foursomeNumber)) {
          return c.json(
            {
              error: 'bad_request',
              code: 'duplicate_foursome_number',
              requestId,
              eventRoundId: round.eventRoundId,
              foursomeNumber: p.foursomeNumber,
            },
            400,
          );
        }
        seenFoursomes.add(p.foursomeNumber);
      }
    }

    // Step 4b: validate eventRoundIds belong to this event.
    const erRows = await db
      .select({ id: eventRounds.id, roundNumber: eventRounds.roundNumber })
      .from(eventRounds)
      .where(
        and(
          eq(eventRounds.eventId, eventId),
          eq(eventRounds.tenantId, TENANT_ID),
        ),
      );
    const validRoundIds = new Set(erRows.map((r) => r.id));
    const roundIdToNumber = new Map(erRows.map((r) => [r.id, r.roundNumber]));
    for (const round of body.rounds) {
      if (!validRoundIds.has(round.eventRoundId)) {
        return c.json(
          {
            error: 'bad_request',
            code: 'unknown_event_round',
            requestId,
            eventRoundId: round.eventRoundId,
          },
          400,
        );
      }
    }

    // Step 5: duplicate_player_in_foursome — within a single memberPlayerIds.
    for (const round of body.rounds) {
      for (const p of round.pairings) {
        const seen = new Set<string>();
        for (const playerId of p.memberPlayerIds) {
          if (seen.has(playerId)) {
            return c.json(
              {
                error: 'bad_request',
                code: 'duplicate_player_in_foursome',
                requestId,
                conflicts: [
                  {
                    eventRoundId: round.eventRoundId,
                    foursomeNumber: p.foursomeNumber,
                    playerId,
                  },
                ],
              },
              400,
            );
          }
          seen.add(playerId);
        }
      }
    }

    // Step 6: unknown_player — collect all distinct playerIds and check
    // they're in this event's group_members.
    const allPlayers = new Set<string>();
    for (const round of body.rounds) {
      for (const p of round.pairings) {
        for (const playerId of p.memberPlayerIds) {
          allPlayers.add(playerId);
        }
      }
    }
    if (allPlayers.size > 0) {
      const groupRows = await db
        .select({ id: groups.id })
        .from(groups)
        .where(
          and(eq(groups.eventId, eventId), eq(groups.tenantId, TENANT_ID)),
        );
      const groupIds = groupRows.map((g) => g.id);
      let validIds: Set<string>;
      if (groupIds.length === 0) {
        validIds = new Set();
      } else {
        const validRows = await db
          .select({ playerId: groupMembers.playerId })
          .from(groupMembers)
          .where(
            and(
              inArray(groupMembers.groupId, groupIds),
              inArray(groupMembers.playerId, [...allPlayers]),
              eq(groupMembers.tenantId, TENANT_ID),
            ),
          );
        validIds = new Set(validRows.map((r) => r.playerId));
      }
      for (const playerId of allPlayers) {
        if (!validIds.has(playerId)) {
          return c.json(
            {
              error: 'bad_request',
              code: 'unknown_player',
              requestId,
              playerId,
            },
            400,
          );
        }
      }
    }

    // Step 7: cross-pairing player uniqueness per round.
    const conflicts: Array<{
      playerId: string;
      eventRoundId: string;
      foursomeNumbers: number[];
    }> = [];
    for (const round of body.rounds) {
      const playerToFoursomes = new Map<string, Set<number>>();
      for (const p of round.pairings) {
        for (const playerId of p.memberPlayerIds) {
          let set = playerToFoursomes.get(playerId);
          if (!set) {
            set = new Set<number>();
            playerToFoursomes.set(playerId, set);
          }
          set.add(p.foursomeNumber);
        }
      }
      for (const [playerId, foursomes] of playerToFoursomes) {
        if (foursomes.size > 1) {
          conflicts.push({
            playerId,
            eventRoundId: round.eventRoundId,
            foursomeNumbers: [...foursomes].sort((a, b) => a - b),
          });
        }
      }
    }
    if (conflicts.length > 0) {
      // Sort lexicographically by (eventRoundId, playerId) for determinism.
      conflicts.sort((a, b) => {
        if (a.eventRoundId < b.eventRoundId) return -1;
        if (a.eventRoundId > b.eventRoundId) return 1;
        if (a.playerId < b.playerId) return -1;
        if (a.playerId > b.playerId) return 1;
        return 0;
      });
      return c.json(
        {
          error: 'duplicate_player',
          code: 'player_in_multiple_pairings_per_round',
          requestId,
          conflicts,
        },
        422,
      );
    }

    // Upsert in a transaction.
    let pairingCount = 0;
    let memberCount = 0;
    const now = Date.now();
    const expectedContextId = `event:${eventId}`;
    try {
      await db.transaction(async (tx) => {
        // Delete existing pairings ONLY for event_rounds in the request body
        // (not all rounds in the event). Round-1 party-codex catch: deleting
        // all rounds would wipe unsent rounds' pairings → silent data loss
        // for partial-payload clients. The "client replays locked rows"
        // contract means clients send rounds they want to UPDATE; rounds
        // they don't send stay untouched.
        const bodyRoundIds = body.rounds.map((r) => r.eventRoundId);
        if (bodyRoundIds.length > 0) {
          await tx
            .delete(pairings)
            .where(
              and(
                inArray(pairings.eventRoundId, bodyRoundIds),
                eq(pairings.tenantId, TENANT_ID),
              ),
            );
        }
        // Insert new pairings + members.
        for (const round of body.rounds) {
          for (const p of round.pairings) {
            const pairingId = randomUUID();
            await tx.insert(pairings).values({
              id: pairingId,
              eventRoundId: round.eventRoundId,
              foursomeNumber: p.foursomeNumber,
              locked: p.locked,
              createdAt: now,
              tenantId: TENANT_ID,
              contextId: expectedContextId,
            });
            pairingCount += 1;
            for (let i = 0; i < p.memberPlayerIds.length; i++) {
              const playerId = p.memberPlayerIds[i]!;
              await tx.insert(pairingMembers).values({
                pairingId,
                playerId,
                slotNumber: i + 1,
                tenantId: TENANT_ID,
                contextId: expectedContextId,
              });
              memberCount += 1;
            }
          }
        }
      });
    } catch (err) {
      const e = err as { message?: unknown; cause?: unknown } | null;
      log.error({
        event: 'pairings_upsert_failed',
        eventId,
        message: e?.message ?? null,
        cause: e?.cause ? String(e.cause) : null,
      });
      return c.json(
        { error: 'internal', code: 'upsert_failed', requestId },
        500,
      );
    }

    log.info({
      event: 'pairings_upserted',
      eventId,
      pairingCount,
      memberCount,
    });

    // Quiet unused-warning on roundIdToNumber; reserved for future logging.
    void roundIdToNumber;

    return c.json({ pairingCount, memberCount, requestId });
  },
);

/**
 * POST /api/admin/events/:eventId/pairings/suggest — wire-up to T4-1's
 * suggestPairings engine. Honors lockedRounds via post-suggest replacement
 * with currently-persisted pairings.
 */
adminEventsRouter.post(
  '/events/:eventId/pairings/suggest',
  requireSession,
  requireOrganizer,
  bodyLimit({
    maxSize: PAIRINGS_BODY_LIMIT_BYTES,
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
    const eventId = c.req.param('eventId');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }
    const parsed = SuggestRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          requestId,
          issues: parsed.error.issues,
        },
        400,
      );
    }
    const body = parsed.data;

    const eventRows = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)));
    if (eventRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'event_not_found', requestId },
        404,
      );
    }

    // Fetch event roster.
    const groupRows = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.eventId, eventId), eq(groups.tenantId, TENANT_ID)));
    const groupIds = groupRows.map((g) => g.id);
    const roster: string[] = [];
    if (groupIds.length > 0) {
      const memberRows = await db
        .select({ playerId: players.id, name: players.name })
        .from(groupMembers)
        .innerJoin(players, eq(groupMembers.playerId, players.id))
        .where(
          and(
            inArray(groupMembers.groupId, groupIds),
            eq(groupMembers.tenantId, TENANT_ID),
            eq(players.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(players.name));
      const seen = new Set<string>();
      for (const row of memberRows) {
        if (!seen.has(row.playerId)) {
          seen.add(row.playerId);
          roster.push(row.playerId);
        }
      }
    }

    // Validate foursomesPerRound matches the engine's roster-derived value.
    // Round-1 party-codex catch: spec accepts foursomesPerRound but the
    // engine derives it internally as floor(roster.length / foursomeSize).
    // Mismatch → reject with 400 rather than silently producing a grid
    // with a different layout than the UI requested.
    const expectedFoursomesPerRound = Math.floor(roster.length / FOURSOME_SIZE);
    if (body.foursomesPerRound !== expectedFoursomesPerRound) {
      return c.json(
        {
          error: 'bad_request',
          code: 'foursomes_per_round_mismatch',
          requestId,
          requested: body.foursomesPerRound,
          expected: expectedFoursomesPerRound,
          rosterSize: roster.length,
          foursomeSize: FOURSOME_SIZE,
        },
        400,
      );
    }

    const result = suggestPairings({
      roster,
      numRounds: body.numRounds,
      foursomeSize: FOURSOME_SIZE,
      constraint: 'everyone-once',
      pins: body.pins,
    });
    const warnings = [...result.warnings];

    // lockedRounds post-suggest replacement.
    if (body.lockedRounds.length > 0) {
      // Resolve round_number → event_round_id for this event.
      const erRows = await db
        .select({ id: eventRounds.id, roundNumber: eventRounds.roundNumber })
        .from(eventRounds)
        .where(
          and(
            eq(eventRounds.eventId, eventId),
            eq(eventRounds.tenantId, TENANT_ID),
          ),
        );
      const numberToErId = new Map(
        erRows.map((r) => [r.roundNumber, r.id] as [number, string]),
      );
      for (const lockedRoundNumber of body.lockedRounds) {
        const erId = numberToErId.get(lockedRoundNumber);
        if (!erId) {
          warnings.push(
            `locked round ${lockedRoundNumber} does not exist for this event`,
          );
          continue;
        }
        // Fetch persisted pairings + members for this round.
        const pRows = await db
          .select({
            id: pairings.id,
            foursomeNumber: pairings.foursomeNumber,
          })
          .from(pairings)
          .where(
            and(
              eq(pairings.eventRoundId, erId),
              eq(pairings.tenantId, TENANT_ID),
            ),
          )
          .orderBy(asc(pairings.foursomeNumber));
        if (pRows.length === 0) {
          warnings.push(
            `locked round ${lockedRoundNumber} has no persisted pairings — engine output kept as-is`,
          );
          continue;
        }
        const persistedFoursomes: Array<{ foursome: number; playerIds: string[] }> =
          [];
        for (const p of pRows) {
          const memRows = await db
            .select({
              playerId: pairingMembers.playerId,
              slotNumber: pairingMembers.slotNumber,
            })
            .from(pairingMembers)
            .where(
              and(
                eq(pairingMembers.pairingId, p.id),
                eq(pairingMembers.tenantId, TENANT_ID),
              ),
            )
            .orderBy(asc(pairingMembers.slotNumber));
          persistedFoursomes.push({
            foursome: p.foursomeNumber,
            playerIds: memRows.map((m) => m.playerId),
          });
        }
        // Replace the engine's round with persisted pairings.
        const idx = lockedRoundNumber - 1;
        if (idx >= 0 && idx < result.grid.rounds.length) {
          result.grid.rounds[idx] = {
            round: lockedRoundNumber,
            foursomes: persistedFoursomes,
          };
        }
      }
    }

    return c.json({
      grid: result.grid,
      warnings,
      requestId,
    });
  },
);
