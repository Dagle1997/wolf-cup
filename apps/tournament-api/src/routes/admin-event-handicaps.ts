/**
 * Handicap-lock router (organizer-scoped, event-scoped).
 *
 *   GET  /api/admin/events/:eventId/handicaps        — roster + today's HI +
 *                                                       locked HI + lock date
 *   POST /api/admin/events/:eventId/handicaps/lock   — { lockDate } snapshot
 *   POST /api/admin/events/:eventId/handicaps/unlock — clear the lock
 *
 * "Lock as of a date" freezes each roster player's handicap index to the
 * value effective on/before the cutoff (pulled from GHIN's dated revision
 * history; non-GHIN players use their stored manual index). The snapshot in
 * `event_handicaps` is what scoring/leaderboard reads for EVERY round of the
 * event, so a hot streak right before/during the trip can't move strokes.
 *
 * Auth is EVENT-scoped via isEventOrganizerByEventId (the multi-organizer
 * model) — `false` → 403, covering both "not the organizer" and "no such
 * event" (no-existence-leak).
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { db } from '../db/index.js';
import {
  events,
  eventHandicaps,
  groups,
  groupMembers,
  players,
} from '../db/schema/index.js';
import { isEventOrganizerByEventId } from '../services/index.js';
import { ghinClient } from '../lib/ghin-client.js';
import { pickAsOfRevision, isIsoDate } from '../lib/handicap-lock.js';

export const adminEventHandicapsRouter = new Hono();
const TENANT_ID = 'guyan';
const LIBRARY_CTX = (eventId: string) => `event:${eventId}`;
const BODY_LIMIT = 8 * 1024;

adminEventHandicapsRouter.use('/events/:eventId/handicaps', requireSession, requireOrganizer);
adminEventHandicapsRouter.use('/events/:eventId/handicaps/*', requireSession, requireOrganizer);

async function loadRoster(eventId: string) {
  const groupRows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.eventId, eventId), eq(groups.tenantId, TENANT_ID)));
  const groupIds = groupRows.map((g) => g.id);
  if (groupIds.length === 0) return [] as Array<{ playerId: string; name: string; ghin: string | null; manualHandicapIndex: number | null }>;
  const rows = await db
    .select({
      playerId: players.id,
      name: players.name,
      ghin: players.ghin,
      manualHandicapIndex: players.manualHandicapIndex,
    })
    .from(groupMembers)
    .innerJoin(players, eq(groupMembers.playerId, players.id))
    .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.tenantId, TENANT_ID), eq(players.tenantId, TENANT_ID)))
    .orderBy(asc(players.name));
  const seen = new Set<string>();
  const out: Array<{ playerId: string; name: string; ghin: string | null; manualHandicapIndex: number | null }> = [];
  for (const r of rows) {
    if (!seen.has(r.playerId)) { seen.add(r.playerId); out.push(r); }
    }
  return out;
}

// GET — roster with today's HI (live) + locked HI (snapshot) + lock date.
adminEventHandicapsRouter.get('/events/:eventId/handicaps', async (c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');
  const eventId = c.req.param('eventId');
  const player = c.get('player')!;

  if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
    return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
  }

  const evt = (await db.select({ lockDate: events.handicapLockDate }).from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID))).limit(1))[0];

  const roster = await loadRoster(eventId);
  const lockedRows = await db.select().from(eventHandicaps)
    .where(and(eq(eventHandicaps.eventId, eventId), eq(eventHandicaps.tenantId, TENANT_ID)));
  const lockedByPlayer = new Map(lockedRows.map((r) => [r.playerId, r]));

  // Today's HI — live GHIN for players with a GHIN number; manual otherwise.
  // Tolerate per-player GHIN failures (null) so one bad number never blanks
  // the whole table.
  const currentByPlayer = new Map<string, number | null>();
  await Promise.all(
    roster.map(async (p) => {
      if (p.ghin && ghinClient) {
        try {
          const { handicapIndex } = await ghinClient.getHandicap(Number(p.ghin));
          currentByPlayer.set(p.playerId, handicapIndex);
        } catch (err) {
          log?.warn({ msg: 'ghin current HI failed', requestId, playerId: p.playerId });
          currentByPlayer.set(p.playerId, null);
        }
      } else {
        currentByPlayer.set(p.playerId, p.manualHandicapIndex ?? null);
      }
    }),
  );

  return c.json({
    eventId,
    lockDate: evt?.lockDate ?? null,
    ghinConfigured: ghinClient != null,
    players: roster.map((p) => {
      const locked = lockedByPlayer.get(p.playerId);
      return {
        playerId: p.playerId,
        name: p.name,
        ghin: p.ghin,
        hasGhin: p.ghin != null,
        currentHandicapIndex: currentByPlayer.get(p.playerId) ?? null,
        lockedHandicapIndex: locked?.handicapIndex ?? null,
        lockedSource: locked?.source ?? null,
        lockedAsOf: locked?.ghinValueDate ?? null,
      };
    }),
    requestId,
  });
});

// POST /lock — snapshot each roster player's HI as of the cutoff date.
adminEventHandicapsRouter.post(
  '/events/:eventId/handicaps/lock',
  bodyLimit({ maxSize: BODY_LIMIT, onError: (c) => c.json({ error: 'bad_request', code: 'body_too_large', requestId: c.get('requestId') }, 400) }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const eventId = c.req.param('eventId');
    const player = c.get('player')!;

    if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
      return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
    }

    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'bad_request', code: 'invalid_body', requestId }, 400); }
    const lockDate = (raw as { lockDate?: unknown })?.lockDate;
    if (!isIsoDate(lockDate)) {
      return c.json({ error: 'bad_request', code: 'invalid_lock_date', requestId }, 400);
    }
    const cutoffMs = Date.parse(`${lockDate}T00:00:00.000Z`);
    if (!Number.isFinite(cutoffMs)) {
      return c.json({ error: 'bad_request', code: 'invalid_lock_date', requestId }, 400);
    }

    const roster = await loadRoster(eventId);
    if (roster.length === 0) {
      return c.json({ error: 'unprocessable', code: 'empty_roster', requestId }, 422);
    }

    // History window: 400 days back from the cutoff (covers WHS revisions for
    // a year). date_begin/date_end are YYYY-MM-DD.
    const dateEnd = lockDate;
    const dateBegin = new Date(cutoffMs - 400 * 86_400_000).toISOString().slice(0, 10);

    type Resolved = { playerId: string; value: number | null; source: 'ghin' | 'manual'; ghinValueDate: string | null };
    const resolved: Resolved[] = await Promise.all(
      roster.map(async (p): Promise<Resolved> => {
        if (p.ghin && ghinClient) {
          try {
            const history = await ghinClient.getHandicapHistory(p.ghin, dateBegin, dateEnd);
            const rev = pickAsOfRevision(history, lockDate);
            if (rev) return { playerId: p.playerId, value: rev.value, source: 'ghin', ghinValueDate: rev.revisionDate.slice(0, 10) };
            // No revision on/before the cutoff — fall back to manual if any.
            return { playerId: p.playerId, value: p.manualHandicapIndex ?? null, source: 'manual', ghinValueDate: null };
          } catch (err) {
            log?.warn({ msg: 'ghin history failed during lock', requestId, playerId: p.playerId });
            return { playerId: p.playerId, value: p.manualHandicapIndex ?? null, source: 'manual', ghinValueDate: null };
          }
        }
        return { playerId: p.playerId, value: p.manualHandicapIndex ?? null, source: 'manual', ghinValueDate: null };
      }),
    );

    const now = Date.now();
    try {
      await db.transaction(async (tx) => {
        await tx.delete(eventHandicaps).where(and(eq(eventHandicaps.eventId, eventId), eq(eventHandicaps.tenantId, TENANT_ID)));
        for (const r of resolved) {
          await tx.insert(eventHandicaps).values({
            eventId,
            playerId: r.playerId,
            handicapIndex: r.value,
            source: r.source,
            asOfDate: cutoffMs,
            ghinValueDate: r.ghinValueDate,
            capturedAt: now,
            tenantId: TENANT_ID,
            contextId: LIBRARY_CTX(eventId),
          });
        }
        await tx.update(events).set({ handicapLockDate: cutoffMs })
          .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)));
      });
    } catch (err) {
      log?.error({ msg: 'handicap lock failed', requestId, eventId, err: String(err) });
      return c.json({ error: 'internal', code: 'lock_failed', requestId }, 500);
    }

    log?.info({ event: 'handicaps_locked', eventId, lockDate, count: resolved.length, actorPlayerId: player.id });
    return c.json({
      ok: true,
      lockDate: cutoffMs,
      locked: resolved.map((r) => ({ playerId: r.playerId, handicapIndex: r.value, source: r.source, asOf: r.ghinValueDate })),
      requestId,
    }, 200);
  },
);

// POST /unlock — clear the snapshot + lock date (scoring reverts to manual HI).
adminEventHandicapsRouter.post('/events/:eventId/handicaps/unlock', async (c) => {
  const requestId = c.get('requestId');
  const log = c.get('logger');
  const eventId = c.req.param('eventId');
  const player = c.get('player')!;

  if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
    return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
  }
  try {
    await db.transaction(async (tx) => {
      await tx.delete(eventHandicaps).where(and(eq(eventHandicaps.eventId, eventId), eq(eventHandicaps.tenantId, TENANT_ID)));
      await tx.update(events).set({ handicapLockDate: null })
        .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)));
    });
  } catch (err) {
    log?.error({ msg: 'handicap unlock failed', requestId, eventId, err: String(err) });
    return c.json({ error: 'internal', code: 'unlock_failed', requestId }, 500);
  }
  log?.info({ event: 'handicaps_unlocked', eventId, actorPlayerId: player.id });
  return c.json({ ok: true, lockDate: null, requestId }, 200);
});
