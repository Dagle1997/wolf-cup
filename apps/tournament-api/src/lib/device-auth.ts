/**
 * Device-binding auth (B0). The bridge that lets a non-Google player — who
 * claimed their roster slot via a join code / invite link — actually
 * authenticate to the app. requireSession calls this as a fallback when
 * there's no valid Google session cookie.
 *
 * The `tournament_device_id` cookie value IS the device_bindings.id. A valid
 * binding resolves to its player; isOrganizer is read live from `players`
 * (device-bound trip players are normally non-organizers, but we don't assume
 * — same posture as validateSession).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { deviceBindings, players } from '../db/schema/index.js';
import { env } from './env.js';

const TENANT_ID = 'guyan';

export const DEVICE_COOKIE_NAME = 'tournament_device_id';
// 90 days — matches the invite-claim device cookie (routes/invites.ts).
const DEVICE_COOKIE_MAX_AGE_S = 90 * 24 * 60 * 60;

/**
 * Set-Cookie header for the device-id cookie. Mirrors invites.ts's private
 * deviceCookieHeader exactly (HttpOnly + SameSite=Lax + Path=/ + 90-day
 * Max-Age + conditional Secure in prod) so the join-code claim and the
 * invite-link claim produce identical cookies.
 */
export function deviceCookieHeader(value: string): string {
  const parts = [
    `${DEVICE_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${DEVICE_COOKIE_MAX_AGE_S}`,
  ];
  if (env.NODE_ENV === 'production') parts.splice(1, 0, 'Secure');
  return parts.join('; ');
}

export type DeviceAuthResult = { playerId: string; isOrganizer: boolean } | null;

export async function validateDeviceBinding(deviceId: string): Promise<DeviceAuthResult> {
  const rows = await db
    .select({ playerId: deviceBindings.playerId })
    .from(deviceBindings)
    .where(and(eq(deviceBindings.id, deviceId), eq(deviceBindings.tenantId, TENANT_ID)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const playerRows = await db
    .select({ isOrganizer: players.isOrganizer })
    .from(players)
    .where(and(eq(players.id, row.playerId), eq(players.tenantId, TENANT_ID)))
    .limit(1);
  if (playerRows.length === 0) return null; // binding orphaned — treat as unauthenticated

  return { playerId: row.playerId, isOrganizer: playerRows[0]!.isOrganizer };
}
