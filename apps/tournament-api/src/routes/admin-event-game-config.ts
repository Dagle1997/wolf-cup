/**
 * F1 game-config router (organizer-scoped, event-scoped) — Story 1.3.
 *
 *   GET  /api/admin/events/:eventId/game-config      — { config: row | null }
 *   PUT  /api/admin/events/:eventId/game-config      — seed/update event default
 *   GET  /api/admin/events/:eventId/resolved-config  — cascade-resolved config
 *
 * Mirrors `admin-event-handicaps.ts` for the auth gate: requireSession +
 * requireOrganizer (mounted as middleware) + the event-scoped
 * isEventOrganizerByEventId check in each handler (false → 403, covering both
 * "not the organizer" and "no such event" — no-existence-leak).
 *
 * Money/config is organizer-only here; nothing is exposed publicly.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireOrganizer } from '../middleware/require-organizer.js';
import { requireSession } from '../middleware/require-session.js';
import { db } from '../db/index.js';
import { gameConfig } from '../db/schema/index.js';
import { isEventOrganizerByEventId } from '../services/index.js';
import { seedOrUpdateEventGameConfig } from '../services/game-config-write.js';
import { resolveEventGameConfig } from '../services/resolve-game-config.js';
import { modifierSchema } from '../engine/games/config-schema.js';
import type { Modifier } from '../engine/games/types.js';

export const adminEventGameConfigRouter = new Hono();
const TENANT_ID = 'guyan';
const CONTEXT = (eventId: string) => `event:${eventId}`;
const BODY_LIMIT = 8 * 1024;

adminEventGameConfigRouter.use('/events/:eventId/game-config', requireSession, requireOrganizer);
adminEventGameConfigRouter.use('/events/:eventId/resolved-config', requireSession, requireOrganizer);

const pointValueScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flat'), cents: z.number().int() }).strict(),
  z
    .object({ kind: z.literal('front-back'), frontCents: z.number().int(), backCents: z.number().int() })
    .strict(),
]);

// Both fields optional: a lock-only PUT omits pointValueSchedule (preserved by
// the write service); the first seed requires it (enforced in the service →
// point_value_required_on_seed).
const putBodySchema = z
  .object({
    pointValueSchedule: pointValueScheduleSchema.optional(),
    lockState: z.enum(['locked', 'unlocked']).optional(),
    // Rule pills (net-skins / greenie / polie / sandie on-off + variants). Full set
    // when present; omitted → preserved by the write service.
    modifiers: z.array(modifierSchema).optional(),
  })
  .strict();

// GET — the event-level game_config row (null = unseeded).
adminEventGameConfigRouter.get('/events/:eventId/game-config', async (c) => {
  const requestId = c.get('requestId');
  const eventId = c.req.param('eventId');
  const player = c.get('player')!;

  if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
    return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
  }

  const rows = await db
    .select()
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'event'),
        eq(gameConfig.refId, eventId),
        eq(gameConfig.tenantId, TENANT_ID),
      ),
    )
    .limit(1);

  return c.json({ config: rows[0] ?? null, requestId }, 200);
});

// PUT — seed or update the event default (point value and/or lock state).
adminEventGameConfigRouter.put(
  '/events/:eventId/game-config',
  bodyLimit({
    maxSize: BODY_LIMIT,
    onError: (c) => c.json({ error: 'bad_request', code: 'body_too_large', requestId: c.get('requestId') }, 400),
  }),
  async (c) => {
    const requestId = c.get('requestId');
    const log = c.get('logger');
    const eventId = c.req.param('eventId');
    const player = c.get('player')!;

    if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
      return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'bad_request', code: 'invalid_body', requestId }, 400);
    }
    const parsed = putBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'bad_request', code: 'invalid_body', reason: parsed.error.issues[0]?.message, requestId }, 400);
    }

    const now = Date.now();
    let result: Awaited<ReturnType<typeof seedOrUpdateEventGameConfig>>;
    try {
      result = await db.transaction((tx) =>
        seedOrUpdateEventGameConfig(tx, {
          eventId,
          tenantId: TENANT_ID,
          contextId: CONTEXT(eventId),
          actorPlayerId: player.id,
          pointValueSchedule: parsed.data.pointValueSchedule,
          // Zod-inferred modifier type widens `variant` to include explicit
          // undefined; the write service re-validates via parseGameConfig, so the
          // cast to the engine Modifier[] here is safe.
          modifiers: parsed.data.modifiers as Modifier[] | undefined,
          lockState: parsed.data.lockState,
          now,
        }),
      );
    } catch (err) {
      log?.error({ msg: 'game-config write failed', requestId, eventId, err: String(err) });
      return c.json({ error: 'internal', code: 'write_failed', requestId }, 500);
    }

    if (!result.ok) {
      // Fail-closed validation errors are a 400 (bad request), not a 500.
      return c.json({ error: 'bad_request', code: 'invalid_config', reason: result.reason, requestId }, 400);
    }

    log?.info({
      event: result.seeded ? 'game_config_seeded' : 'game_config_updated',
      eventId,
      actorPlayerId: player.id,
    });
    return c.json({ config: result.row, requestId }, 200);
  },
);

// GET — the cascade-resolved config for an (event, round?, foursome?).
adminEventGameConfigRouter.get('/events/:eventId/resolved-config', async (c) => {
  const requestId = c.get('requestId');
  const eventId = c.req.param('eventId');
  const player = c.get('player')!;

  if (!(await isEventOrganizerByEventId(db, eventId, player.id, TENANT_ID))) {
    return c.json({ error: 'forbidden', code: 'not_event_organizer', requestId }, 403);
  }

  const roundIdRaw = c.req.query('roundId');
  const foursomeRaw = c.req.query('foursomeNumber');

  // foursomeNumber requires roundId.
  if (foursomeRaw !== undefined && roundIdRaw === undefined) {
    return c.json({ error: 'bad_request', code: 'foursome_requires_round', requestId }, 400);
  }
  let foursomeNumber: number | undefined;
  if (foursomeRaw !== undefined) {
    const n = Number(foursomeRaw);
    if (!Number.isInteger(n) || n < 1) {
      return c.json({ error: 'bad_request', code: 'invalid_foursome_number', requestId }, 400);
    }
    foursomeNumber = n;
  }

  const result = await resolveEventGameConfig(db, {
    eventId,
    tenantId: TENANT_ID,
    roundId: roundIdRaw,
    foursomeNumber,
  });

  if (result.ok) {
    return c.json({ ok: true, config: result.config, requestId }, 200);
  }
  // Hierarchy mismatch → 404 (round/foursome not under this event). Engine
  // unsettleable/orphan/unseeded → 200 { ok:false, reason } (NOT a 500).
  if (result.kind === 'hierarchy') {
    return c.json({ error: 'not_found', code: result.reason, requestId }, 404);
  }
  return c.json({ ok: false, reason: result.reason, requestId }, 200);
});
