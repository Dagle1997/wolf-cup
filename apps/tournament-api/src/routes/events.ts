/**
 * T7-1 events route — minimal event-detail endpoint for home page.
 *
 * Mount: `app.route('/api/events', eventsRouter)`. Effective URL:
 *   GET /api/events/:eventId
 *
 * Auth chain: `requireSession` → `requireEventParticipant`. Malformed
 * or unknown :eventId returns 403 from the participant middleware
 * (no-existence-leak invariant — the SQL predicate evaluates to "not a
 * participant" for both cases).
 *
 * Returns event metadata + rounds list (ordered by round_number) for the
 * Event home page hero/countdown/entry-cards UI. No money, no scores,
 * no bets — those have dedicated routes.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, asc, desc, eq, or, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  eventRounds,
  events,
  gameConfig,
  groupMembers,
  groups,
  players,
  rounds,
  roundStates,
} from '../db/schema/index.js';
import { f1MoneyEnabled } from '../lib/env.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import { isEventOrganizerByEventId } from '../services/index.js';

const TENANT_ID = 'guyan';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const eventsRouter = new Hono();

/**
 * GET /api/events — list events the caller can access. v1 access rule:
 *   - the caller is the event's organizer (events.organizer_player_id), OR
 *   - the caller is a member of any group attached to the event.
 *
 * Used by the home page to route a logged-in user to "their event" without
 * making them paste a UUID into the address bar (mobile UX). Sorted by
 * start_date desc (most-recent first).
 */
eventsRouter.get('/', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const player = c.get('player')!;

  try {
    // Events where caller is in any group_members row.
    const groupEventRows = await db
      .select({ eventId: groups.eventId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(
        and(
          eq(groupMembers.playerId, player.id),
          eq(groupMembers.tenantId, TENANT_ID),
          eq(groups.tenantId, TENANT_ID),
        ),
      );
    const participantEventIds = groupEventRows.map((r) => r.eventId);

    const eventRows = await db
      .select({
        id: events.id,
        name: events.name,
        startDate: events.startDate,
        endDate: events.endDate,
        timezone: events.timezone,
        organizerPlayerId: events.organizerPlayerId,
        cancelledAt: events.cancelledAt,
      })
      .from(events)
      .where(
        and(
          eq(events.tenantId, TENANT_ID),
          // Cancelled events stay visible to their OWN organizer (so they can
          // see the [Cancelled] badge + restore), but are hidden from
          // participants entirely.
          participantEventIds.length > 0
            ? or(
                eq(events.organizerPlayerId, player.id),
                and(
                  inArray(events.id, participantEventIds),
                  isNull(events.cancelledAt),
                ),
              )
            : eq(events.organizerPlayerId, player.id),
        ),
      )
      .orderBy(desc(events.startDate));

    c.header('cache-control', 'no-store');
    return c.json(
      {
        events: eventRows.map((e) => ({
          id: e.id,
          name: e.name,
          startDate: e.startDate,
          endDate: e.endDate,
          timezone: e.timezone,
          isOrganizer: e.organizerPlayerId === player.id,
          cancelledAt: e.cancelledAt,
        })),
      },
      200,
    );
  } catch (err) {
    log.error({
      msg: 'GET /events list threw',
      requestId,
      err: String(err),
    });
    return c.json(
      { error: 'internal', code: 'events_list_failed', requestId },
      500,
    );
  }
});

eventsRouter.get(
  '/:eventId',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId')!;
    const player = c.get('player')!;

    try {
      const eventRows = await db
        .select({
          id: events.id,
          name: events.name,
          startDate: events.startDate,
          endDate: events.endDate,
          timezone: events.timezone,
          cancelledAt: events.cancelledAt,
        })
        .from(events)
        .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
        .limit(1);

      // Defense-in-depth: middleware already returned 403 for unknown
      // eventId, but if a participant row exists for an event that was
      // hard-deleted, the join would still pass. Treat as 403 no-existence-leak.
      if (eventRows.length === 0) {
        return c.json(
          { error: 'forbidden', code: 'not_event_participant', requestId },
          403,
        );
      }

      const roundRows = await db
        .select({
          id: eventRounds.id,
          roundNumber: eventRounds.roundNumber,
          roundDate: eventRounds.roundDate,
          holesToPlay: eventRounds.holesToPlay,
        })
        .from(eventRounds)
        .where(
          and(
            eq(eventRounds.eventId, eventId),
            eq(eventRounds.tenantId, TENANT_ID),
          ),
        )
        .orderBy(asc(eventRounds.roundNumber));

      // Viewer's display name — the session/auth-status payload omits it, so
      // the home greeting fetches it here (falls back to null → "friend" in UI).
      const nameRows = await db
        .select({ name: players.name })
        .from(players)
        .where(and(eq(players.id, player.id), eq(players.tenantId, TENANT_ID)))
        .limit(1);
      const rawName = nameRows[0]?.name?.trim();
      const viewerName = rawName ? rawName : null;

      // Live scoring round (if any) — powers the home "Round N is live →
      // Enter scores" CTA. Only `in_progress` qualifies (complete_editable =
      // scoring done, no CTA). Most-recent by opened/created. `roundId` is the
      // scoring round id consumed by /rounds/:roundId/score-entry.
      const liveRows = await db
        .select({
          roundId: rounds.id,
          eventRoundId: rounds.eventRoundId,
          roundNumber: eventRounds.roundNumber,
        })
        .from(rounds)
        .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
        .innerJoin(roundStates, eq(roundStates.roundId, rounds.id))
        .where(
          and(
            eq(eventRounds.eventId, eventId),
            eq(roundStates.state, 'in_progress'),
            eq(rounds.tenantId, TENANT_ID),
            eq(eventRounds.tenantId, TENANT_ID),
            eq(roundStates.tenantId, TENANT_ID),
          ),
        )
        .orderBy(
          sql`${rounds.openedAt} DESC NULLS LAST`,
          desc(rounds.createdAt),
          desc(rounds.id),
        )
        .limit(1);
      const liveRound = liveRows.length > 0 ? liveRows[0]! : null;

      // moneyEnabled — does this event have an event-level F1 game config that is
      // LOCKED (money/P&L mode) AND is money exposure turned on? Gates the home
      // "Money" hub card (vs the private "My Money" card on a scores-only event).
      const cfgRows = await db
        .select({ lockState: gameConfig.lockState })
        .from(gameConfig)
        .where(
          and(
            eq(gameConfig.level, 'event'),
            eq(gameConfig.refId, eventId),
            eq(gameConfig.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      const moneyEnabled =
        cfgRows.length > 0 && cfgRows[0]!.lockState !== 'unlocked' && f1MoneyEnabled();

      c.header('cache-control', 'no-store');
      return c.json(
        {
          event: eventRows[0]!,
          rounds: roundRows,
          viewerName,
          liveRound,
          moneyEnabled,
        },
        200,
      );
    } catch (err) {
      log.error({
        msg: 'GET /events/:eventId threw',
        requestId,
        eventId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'event_get_failed', requestId },
        500,
      );
    }
  },
);

/**
 * POST /api/events/:eventId/cancel — organizer-scoped soft-cancel.
 * POST /api/events/:eventId/restore — organizer-scoped un-cancel.
 *
 * Auth is EVENT-scoped (not the global `isOrganizer` flag): only the player
 * recorded as `events.organizer_player_id` may cancel/restore THEIR event.
 * This is the multi-organizer model — anyone can create an event and invite
 * others by link/join code; only that creator controls its lifecycle.
 *
 * `isEventOrganizerByEventId` returning false covers both "not the organizer"
 * and "event does not exist" — both map to 403 (no-existence-leak, matching
 * the round-cancel / event-rule-edit precedent). Malformed UUIDs are rejected
 * with 400 before the DB touch.
 *
 * Both endpoints are idempotent: cancelling an already-cancelled event (or
 * restoring an active one) returns 200 with `idempotent: true` and leaves the
 * original `cancelled_at` / `cancelled_by_player_id` untouched.
 *
 * Soft-cancel ONLY flips the two `events` columns — no child rows are touched,
 * so the action is fully reversible. No activity event is emitted (the
 * cancelled_at / cancelled_by_player_id columns ARE the audit trail; adding an
 * `event.cancelled` activity type would require expanding the typed activity
 * union + its DB CHECK — deferred as out of scope for this lifecycle action).
 */
function uuidGuard(eventId: string, requestId: string) {
  if (!UUID_RE.test(eventId)) {
    return {
      error: 'bad_request' as const,
      code: 'invalid_event_id' as const,
      requestId,
    };
  }
  return null;
}

eventsRouter.post('/:eventId/cancel', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const eventId = c.req.param('eventId')!;
  const player = c.get('player')!;

  const badId = uuidGuard(eventId, requestId);
  if (badId) return c.json(badId, 400);

  try {
    const authed = await isEventOrganizerByEventId(
      db,
      eventId,
      player.id,
      TENANT_ID,
    );
    if (!authed) {
      return c.json(
        { error: 'forbidden', code: 'not_event_organizer', requestId },
        403,
      );
    }

    // Read current state (organizer-only past this point) to keep idempotent.
    const rows = await db
      .select({ cancelledAt: events.cancelledAt })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
      .limit(1);
    if (rows[0]?.cancelledAt != null) {
      return c.json({ ok: true, cancelled: true, idempotent: true, requestId }, 200);
    }

    const now = Date.now();
    await db
      .update(events)
      .set({ cancelledAt: now, cancelledByPlayerId: player.id })
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)));

    log.info({ event: 'event_cancelled', eventId, actorPlayerId: player.id });
    return c.json({ ok: true, cancelled: true, idempotent: false, requestId }, 200);
  } catch (err) {
    log.error({ msg: 'POST /events/:eventId/cancel threw', requestId, eventId, err: String(err) });
    return c.json({ error: 'internal', code: 'event_cancel_failed', requestId }, 500);
  }
});

eventsRouter.post('/:eventId/restore', requireSession, async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const eventId = c.req.param('eventId')!;
  const player = c.get('player')!;

  const badId = uuidGuard(eventId, requestId);
  if (badId) return c.json(badId, 400);

  try {
    const authed = await isEventOrganizerByEventId(
      db,
      eventId,
      player.id,
      TENANT_ID,
    );
    if (!authed) {
      return c.json(
        { error: 'forbidden', code: 'not_event_organizer', requestId },
        403,
      );
    }

    const rows = await db
      .select({ cancelledAt: events.cancelledAt })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
      .limit(1);
    if (rows[0]?.cancelledAt == null) {
      return c.json({ ok: true, cancelled: false, idempotent: true, requestId }, 200);
    }

    await db
      .update(events)
      .set({ cancelledAt: null, cancelledByPlayerId: null })
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)));

    log.info({ event: 'event_restored', eventId, actorPlayerId: player.id });
    return c.json({ ok: true, cancelled: false, idempotent: false, requestId }, 200);
  } catch (err) {
    log.error({ msg: 'POST /events/:eventId/restore threw', requestId, eventId, err: String(err) });
    return c.json({ error: 'internal', code: 'event_restore_failed', requestId }, 500);
  }
});
