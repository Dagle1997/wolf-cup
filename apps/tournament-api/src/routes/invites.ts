/**
 * T3-6 invite-link first-arrival flow (anonymous, no SSO).
 *
 *   GET    /api/invites/:token            — validate token + return event + roster
 *   POST   /api/invites/:token/claim      — claim a player_id on this device
 *
 * **No auth gate on either endpoint** — the entire point of FR-E1 (revised
 * 2026-04-18) is "first-arrival friction is zero." The token IS the auth.
 *
 * Player identity comes from the name-tap action (POST body), NOT from the
 * invite token. Per T3-1 schema, `invites` is event-scoped only (no
 * `invited_player_id` column); per-player invite share-targeting is a v1.5+
 * feature.
 *
 * On claim, a `device_bindings` row is inserted with `session_id = NULL`
 * (per T3-1 NULLABLE column — load-bearing for T3-7 post-SSO rebind).
 *
 * Cookie semantics:
 *   - Value = `device_bindings.id` (UUID).
 *   - HttpOnly + SameSite=Lax + Path=/ + Max-Age=7776000 (90 days) + no
 *     Domain (host-only). Secure conditionally appended in production
 *     (matches session.ts:181-193 pattern).
 *   - Set on INSERT branch + UPDATE branch of POST /:token/claim. Refreshing
 *     Max-Age on UPDATE keeps active devices' bindings alive longer.
 *   - Cross-event protection: if the cookie's existing row's context_id
 *     belongs to a DIFFERENT event, falls through to INSERT a NEW row.
 *
 * **No SSO** — does NOT call validateSession, does NOT issue session
 * cookies, does NOT redirect to /api/auth/google. SSO is deferred to
 * T3-7 (post-SSO rebind) and triggers only on the first MUTATION (T5/T7).
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { env } from '../lib/env.js';
import { db } from '../db/index.js';
import {
  invites,
  events,
  groups,
  groupMembers,
  players,
  deviceBindings,
} from '../db/schema/index.js';

const SAVE_BODY_LIMIT_BYTES = 8 * 1024;
// Exported so the auth router (T3-7 post-SSO consolidation + that-is-not-me)
// can scope its device_bindings reads/writes to the same tenant constant.
// FD-6 plan calls for a tenant resolver; until that lands, exporting the
// constant is the right tradeoff vs duplicating the literal.
export const TENANT_ID = 'guyan';
export const DEVICE_COOKIE_NAME = 'tournament_device_id';
// 90 days. Long enough for a Pinehurst-trip arc; short enough that lost
// devices auto-clear within a quarter.
const DEVICE_COOKIE_MAX_AGE_S = 90 * 24 * 60 * 60;
// Truncation cap for the User-Agent stored in device_bindings.device_info.
// 256 chars covers the longest realistic UA + leaves headroom.
const DEVICE_INFO_MAX_LEN = 256;

const ClaimRequestSchema = z.object({
  playerId: z.string().min(1),
});

/**
 * Builds the Set-Cookie header for the device-id cookie. Mirrors the
 * sessionCookieHeader pattern in session.ts:177-197 but with different
 * defaults: SameSite=Lax (top-level navigation from messaging apps),
 * no Domain (host-only), 90-day Max-Age. Secure conditionally appended
 * in production.
 */
function deviceCookieHeader(value: string): string {
  const parts = [
    `${DEVICE_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${DEVICE_COOKIE_MAX_AGE_S}`,
  ];
  if (env.NODE_ENV === 'production') {
    parts.splice(1, 0, 'Secure');
  }
  return parts.join('; ');
}

/**
 * Sibling of `deviceCookieHeader`. Emits a Set-Cookie that clears the
 * device-id cookie by setting `Max-Age=0` while mirroring every other
 * attribute (HttpOnly + SameSite=Lax + Path=/ + conditional Secure in
 * production). Browsers ignore Set-Cookie for "clear" intent if the
 * attributes (especially Path / Secure) don't match the original — so this
 * helper exists colocated with the setter to keep the two in sync.
 *
 * Used by T3-7's `POST /api/auth/that-is-not-me` to wipe the device cookie
 * alongside the session cookie. NOT used by the rebind/consolidation path
 * (which leaves the device cookie unchanged because the binding row is
 * updated in place).
 */
export function deviceCookieClearHeader(): string {
  const parts = [
    `${DEVICE_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ];
  if (env.NODE_ENV === 'production') {
    parts.splice(1, 0, 'Secure');
  }
  return parts.join('; ');
}

/**
 * Cookie extractor — mirrors the private helper in middleware/require-session.ts
 * + auth.ts. Intentionally duplicated (10 lines) per the project's "no
 * refactor beyond the task" rule.
 */
function extractCookie(header: string, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    return value.length === 0 ? null : value;
  }
  return null;
}

export const inviteRouter = new Hono();

// ---------------------------------------------------------------------------
// GET /:token — validate + return event + roster
// ---------------------------------------------------------------------------
inviteRouter.get('/:token', async (c) => {
  const requestId = c.get('requestId');
  const token = c.req.param('token');

  const inviteRows = await db.select().from(invites).where(eq(invites.token, token));
  if (inviteRows.length === 0) {
    return c.json({ error: 'not_found', code: 'invite_not_found', requestId }, 404);
  }
  const invite = inviteRows[0]!;

  if (invite.expiresAt <= Date.now()) {
    return c.json({ error: 'gone', code: 'invite_expired', requestId }, 410);
  }

  // Fetch event details.
  const eventRows = await db.select().from(events).where(eq(events.id, invite.eventId));
  if (eventRows.length === 0) {
    // Pathological — invite references missing event. Should be unreachable
    // because invites.event_id is FK ON DELETE CASCADE per T3-1.
    return c.json(
      { error: 'internal', code: 'invite_event_missing', requestId },
      500,
    );
  }
  const event = eventRows[0]!;

  // Roster: players in any group under this event. Deduplicate by playerId.
  const groupRows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.eventId, event.id));
  const groupIds = groupRows.map((g) => g.id);

  const roster: Array<{ playerId: string; name: string }> = [];
  if (groupIds.length > 0) {
    const memberRows = await db
      .select({ playerId: players.id, name: players.name })
      .from(groupMembers)
      .innerJoin(players, eq(groupMembers.playerId, players.id))
      .where(inArray(groupMembers.groupId, groupIds))
      .orderBy(asc(players.name));
    // Dedupe by playerId — a player may appear in multiple groups.
    const seen = new Set<string>();
    for (const row of memberRows) {
      if (!seen.has(row.playerId)) {
        seen.add(row.playerId);
        roster.push(row);
      }
    }
  }

  return c.json({
    event: {
      id: event.id,
      name: event.name,
      startDate: event.startDate,
      endDate: event.endDate,
      timezone: event.timezone,
    },
    roster,
    requestId,
  });
});

// ---------------------------------------------------------------------------
// POST /:token/claim — claim a player_id on this device
// ---------------------------------------------------------------------------
inviteRouter.post(
  '/:token/claim',
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
    const token = c.req.param('token');

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(
        { error: 'bad_request', code: 'invalid_body', requestId, issues: [] },
        400,
      );
    }

    const parseResult = ClaimRequestSchema.safeParse(raw);
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
    const { playerId } = parseResult.data;

    // Validate token (same as GET).
    const inviteRows = await db.select().from(invites).where(eq(invites.token, token));
    if (inviteRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'invite_not_found', requestId },
        404,
      );
    }
    const invite = inviteRows[0]!;
    if (invite.expiresAt <= Date.now()) {
      return c.json({ error: 'gone', code: 'invite_expired', requestId }, 410);
    }

    // Fetch event details (needed for the response shape).
    const eventRows = await db
      .select({ id: events.id, name: events.name })
      .from(events)
      .where(eq(events.id, invite.eventId));
    if (eventRows.length === 0) {
      // Pathological — invite references missing event (FK CASCADE should
      // prevent this).
      return c.json(
        { error: 'internal', code: 'invite_event_missing', requestId },
        500,
      );
    }
    const event = eventRows[0]!;

    // Validate playerId is in the event's group_members (cross-table SELECT).
    const groupRows = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.eventId, invite.eventId));
    const groupIds = groupRows.map((g) => g.id);
    if (groupIds.length === 0) {
      return c.json(
        { error: 'bad_request', code: 'player_not_in_event', requestId },
        400,
      );
    }
    const memberRows = await db
      .select({ playerId: groupMembers.playerId })
      .from(groupMembers)
      .where(
        and(
          inArray(groupMembers.groupId, groupIds),
          eq(groupMembers.playerId, playerId),
        ),
      );
    if (memberRows.length === 0) {
      return c.json(
        { error: 'bad_request', code: 'player_not_in_event', requestId },
        400,
      );
    }

    // Fetch player details for the response.
    const playerRows = await db.select().from(players).where(eq(players.id, playerId));
    if (playerRows.length === 0) {
      // Should be unreachable given the group_members JOIN above, but
      // defensive (race / FK quirk).
      return c.json(
        { error: 'bad_request', code: 'player_not_in_event', requestId },
        400,
      );
    }
    const player = playerRows[0]!;

    // Compute device_info from User-Agent (UA-only, no IP for v1).
    const deviceInfo = (c.req.header('user-agent') ?? '').slice(0, DEVICE_INFO_MAX_LEN);

    // Read the device cookie. UPDATE if existing row matches THIS event;
    // else INSERT new row + set cookie.
    const cookieHeader = c.req.header('cookie') ?? '';
    const cookieValue = extractCookie(cookieHeader, DEVICE_COOKIE_NAME);
    const expectedContextId = `event:${invite.eventId}`;

    let updated = false;
    let deviceBindingId: string;

    if (cookieValue) {
      // T3-6 cross-event protection + T3-7 cross-tenant + post-consolidation
      // protection. Branch into UPDATE only when the existing row is in the
      // current tenant, the current event, AND has not yet been consolidated
      // by SSO (session_id IS NULL). Anything else falls through to INSERT
      // a fresh row + new cookie, preserving the consolidated row intact.
      // (Caught by T3-7 party-codex Med: a re-claim of a consolidated cookie
      // would otherwise leave session_id and player_id referencing different
      // players.)
      const existingRows = await db
        .select()
        .from(deviceBindings)
        .where(
          and(
            eq(deviceBindings.id, cookieValue),
            eq(deviceBindings.tenantId, TENANT_ID),
          ),
        );
      const existing = existingRows[0];
      if (
        existing !== undefined &&
        existing.contextId === expectedContextId &&
        existing.sessionId === null
      ) {
        // UPDATE in place. Preserve created_at; refresh player_id + device_info.
        await db
          .update(deviceBindings)
          .set({ playerId, deviceInfo })
          .where(
            and(
              eq(deviceBindings.id, cookieValue),
              eq(deviceBindings.tenantId, TENANT_ID),
            ),
          );
        deviceBindingId = cookieValue;
        updated = true;
      } else {
        deviceBindingId = randomUUID();
      }
    } else {
      deviceBindingId = randomUUID();
    }

    if (!updated) {
      // INSERT new row scoped to this event.
      try {
        await db.insert(deviceBindings).values({
          id: deviceBindingId,
          playerId,
          sessionId: null,
          deviceInfo,
          createdAt: Date.now(),
          tenantId: TENANT_ID,
          contextId: expectedContextId,
        });
      } catch (err) {
        const e = err as { message?: unknown; cause?: unknown } | null;
        log.error({
          event: 'invite_claim_insert_failed',
          token,
          playerId,
          message: e?.message ?? null,
          cause: e?.cause ? String(e.cause) : null,
        });
        return c.json(
          { error: 'internal', code: 'claim_failed', requestId },
          500,
        );
      }
    }

    // Set the device cookie on BOTH branches (refresh on UPDATE; new on INSERT).
    c.header('Set-Cookie', deviceCookieHeader(deviceBindingId), { append: true });

    log.info({
      event: 'invite_claimed',
      token,
      playerId,
      eventId: invite.eventId,
      deviceBindingId,
      branch: updated ? 'update' : 'insert',
    });

    return c.json(
      {
        player: { id: player.id, name: player.name },
        event: { id: event.id, name: event.name },
        deviceBindingId,
        requestId,
      },
      updated ? 200 : 201,
    );
  },
);
