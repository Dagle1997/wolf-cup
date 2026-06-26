/**
 * B0 — non-Google join via per-player code.
 *
 *   POST /api/join                              (public) claim a player by code
 *   GET  /api/admin/events/:eventId/join-codes  (organizer) list/generate codes
 *
 * The public claim binds the code's player to THIS device (device_bindings +
 * tournament_device_id cookie) — the same mechanism the invite link uses — so
 * the player then authenticates app-wide via the requireSession device bridge,
 * no Google needed. Per-player codes mean the claimer is provably that player
 * (needed for self-created side games).
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  deviceBindings,
  events,
  groups,
  groupMembers,
  players,
  playerJoinCodes,
} from '../db/schema/index.js';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { isEventOrganizerByEventId } from '../services/index.js';
import { generateJoinCode, normalizeJoinCode } from '../lib/join-code.js';
import { DEVICE_COOKIE_NAME, deviceCookieHeader } from '../lib/device-auth.js';
import { sessionCookieHeader } from '../lib/session.js';
import { logger as moduleLogger } from '../lib/log.js';

const TENANT_ID = 'guyan';
const CTX = (eventId: string) => `event:${eventId}`;
const DEVICE_INFO_MAX_LEN = 256;

function extractCookie(header: string, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const t = part.trim();
    const eq = t.indexOf('=');
    if (eq > 0 && t.slice(0, eq) === name) {
      const v = t.slice(eq + 1);
      return v.length ? v : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// PUBLIC: POST /api/join  { code }
// ---------------------------------------------------------------------------
export const joinRouter = new Hono();

const JoinSchema = z.object({ code: z.string().min(1).max(64) });

joinRouter.post(
  '/',
  bodyLimit({
    maxSize: 4 * 1024,
    onError: (c) => c.json({ error: 'bad_request', code: 'body_too_large', requestId: c.get('requestId') }, 400),
  }),
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;

    let raw: unknown;
    try { raw = await c.req.json(); } catch { return c.json({ error: 'bad_request', code: 'invalid_body', requestId }, 400); }
    const parsed = JoinSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: 'bad_request', code: 'invalid_body', requestId }, 400);

    const code = normalizeJoinCode(parsed.data.code);
    if (code.length === 0) return c.json({ error: 'bad_request', code: 'invalid_code', requestId }, 400);

    const rows = await db
      .select({ eventId: playerJoinCodes.eventId, playerId: playerJoinCodes.playerId })
      .from(playerJoinCodes)
      .where(and(eq(playerJoinCodes.code, code), eq(playerJoinCodes.tenantId, TENANT_ID)))
      .limit(1);
    if (rows.length === 0) {
      return c.json({ error: 'not_found', code: 'invalid_code', requestId }, 404);
    }
    const { eventId, playerId } = rows[0]!;

    // Refuse joining a cancelled event (mirror invite claim).
    const evtRows = await db
      .select({ name: events.name, cancelledAt: events.cancelledAt })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
      .limit(1);
    if (evtRows.length === 0) return c.json({ error: 'internal', code: 'event_missing', requestId }, 500);
    if (evtRows[0]!.cancelledAt != null) return c.json({ error: 'gone', code: 'event_cancelled', requestId }, 410);

    const playerRows = await db
      .select({ name: players.name })
      .from(players)
      .where(and(eq(players.id, playerId), eq(players.tenantId, TENANT_ID)))
      .limit(1);
    const playerName = playerRows[0]?.name ?? null;

    // Bind this player to the device. Reuse an existing pre-SSO binding on
    // this device (session_id IS NULL) by re-pointing its player; else insert
    // a fresh binding. Mirrors the invite-claim device-binding logic.
    const ua = (c.req.header('user-agent') ?? '').slice(0, DEVICE_INFO_MAX_LEN);
    const now = Date.now();
    const existingCookie = extractCookie(c.req.header('cookie') ?? '', DEVICE_COOKIE_NAME);
    let deviceBindingId: string;
    try {
      let reused = false;
      if (existingCookie) {
        const existing = await db
          .select({ id: deviceBindings.id, sessionId: deviceBindings.sessionId })
          .from(deviceBindings)
          .where(and(eq(deviceBindings.id, existingCookie), eq(deviceBindings.tenantId, TENANT_ID)))
          .limit(1);
        if (existing[0] && existing[0].sessionId === null) {
          await db
            .update(deviceBindings)
            .set({ playerId, deviceInfo: ua, contextId: CTX(eventId) })
            .where(and(eq(deviceBindings.id, existing[0].id), eq(deviceBindings.tenantId, TENANT_ID)));
          deviceBindingId = existing[0].id;
          reused = true;
        }
      }
      if (!reused) {
        deviceBindingId = randomUUID();
        await db.insert(deviceBindings).values({
          id: deviceBindingId,
          playerId,
          sessionId: null,
          deviceInfo: ua,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: CTX(eventId),
        });
      }
    } catch (err) {
      log.error({ event: 'join_claim_failed', requestId, err: String(err) });
      return c.json({ error: 'internal', code: 'join_failed', requestId }, 500);
    }

    c.header('Set-Cookie', deviceCookieHeader(deviceBindingId!), { append: true });
    // Clear any stale Google SESSION cookie so the device binding we just set is
    // the authority. Without this, a player who got bounced into Google and
    // signed in as someone else (e.g. a spouse on a shared phone) would keep
    // that session — and /auth/status checks the session first. A code join is
    // an explicit "I am THIS player on THIS device", so the session must go.
    c.header('Set-Cookie', sessionCookieHeader(null), { append: true });
    log.info({ event: 'join_claimed', eventId, playerId, deviceBindingId: deviceBindingId! });
    return c.json({ eventId, player: { id: playerId, name: playerName }, requestId }, 200);
  },
);

// ---------------------------------------------------------------------------
// ORGANIZER: GET /api/admin/events/:eventId/join-codes
// ---------------------------------------------------------------------------
export const adminJoinCodesRouter = new Hono();

adminJoinCodesRouter.use('/events/:eventId/join-codes', requireSession, requireOrganizer);

adminJoinCodesRouter.get('/events/:eventId/join-codes', async (c) => {
  const requestId = c.get('requestId') ?? randomUUID();
  const log = c.get('logger') ?? moduleLogger;
  const eventId = c.req.param('eventId');
  const player = c.get('player')!;

  if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
    return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
  }

  // Roster: players in any group under this event.
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
      .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.tenantId, TENANT_ID), eq(players.tenantId, TENANT_ID)))
      .orderBy(asc(players.name));
    const seen = new Set<string>();
    for (const m of memberRows) if (!seen.has(m.playerId)) { seen.add(m.playerId); roster.push(m); }
  }

  // Existing codes for this event.
  const existing = await db
    .select({ playerId: playerJoinCodes.playerId, code: playerJoinCodes.code })
    .from(playerJoinCodes)
    .where(and(eq(playerJoinCodes.eventId, eventId), eq(playerJoinCodes.tenantId, TENANT_ID)));
  const codeByPlayer = new Map(existing.map((r) => [r.playerId, r.code]));

  // Generate any missing codes (idempotent; retry on the rare UNIQUE clash).
  const now = Date.now();
  for (const m of roster) {
    if (codeByPlayer.has(m.playerId)) continue;
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const code = generateJoinCode();
      try {
        await db.insert(playerJoinCodes).values({
          eventId,
          playerId: m.playerId,
          code,
          createdAt: now,
          tenantId: TENANT_ID,
          contextId: CTX(eventId),
        });
        codeByPlayer.set(m.playerId, code);
        inserted = true;
      } catch (err) {
        // UNIQUE clash on code OR PK (already created by a concurrent call) →
        // re-read the PK row; if it now exists, use it; else retry a new code.
        const reRead = await db
          .select({ code: playerJoinCodes.code })
          .from(playerJoinCodes)
          .where(and(eq(playerJoinCodes.eventId, eventId), eq(playerJoinCodes.playerId, m.playerId), eq(playerJoinCodes.tenantId, TENANT_ID)))
          .limit(1);
        if (reRead[0]) { codeByPlayer.set(m.playerId, reRead[0].code); inserted = true; }
        else if (attempt === 4) log.error({ event: 'join_code_gen_failed', requestId, playerId: m.playerId, err: String(err) });
      }
    }
  }

  return c.json({
    eventId,
    players: roster.map((m) => ({ playerId: m.playerId, name: m.name, code: codeByPlayer.get(m.playerId) ?? null })),
    requestId,
  });
});
