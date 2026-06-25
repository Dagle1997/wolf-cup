/**
 * game-config-foursome-write.ts (Epic 6) — the FOURSOME-level game-config writer.
 *
 * Lets an organizer give one foursome its own Guyan rules (which modifiers are on,
 * and optionally a different stake) inside a single event. The foursome row is a
 * FULL GameConfig (the resolver's loadLevelRow validates it as one): it is the
 * EVENT config overlaid with this foursome's modifier choices (+ optional point
 * value). The cascade resolver then merges it over the event config; at round
 * start `pin-round-at-start` freezes the resolved per-foursome config into the
 * pin and `games-money` settles each foursome from it.
 *
 * Identity: a foursome's stable config key is its PAIRING id (refId), resolved
 * from (eventRoundId, foursomeNumber). Upsert on UNIQUE(tenant, level, ref_id) so
 * re-saving REPLACES the foursome's override. `deleteFoursomeGameConfig` clears
 * it (the foursome reverts to the event default).
 *
 * Fail-closed: a non-F1 event (no event-level row) cannot have a foursome override
 * (`no_event_config`); an unknown foursome → `foursome_not_found`; an invalid
 * resolved config is rejected BEFORE any write (parseGameConfig).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { gameConfig, pairings, eventRounds, type GameConfigRow } from '../db/schema/index.js';
import type { GameConfig, Modifier, PointValueSchedule } from '../engine/games/types.js';
import {
  parseGameConfig,
  deriveConfigColumns,
  checkConfigColumnsConsistent,
} from '../engine/games/config-schema.js';
import { writeAudit, AUDIT_EVENT_TYPES, AUDIT_ENTITY_TYPES } from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type FoursomeConfigInput = {
  eventId: string;
  tenantId: string;
  contextId: string;
  eventRoundId: string;
  foursomeNumber: number;
  actorPlayerId: string;
  /** The foursome's FULL modifier set (the rule pills' on/off state). */
  modifiers: Modifier[];
  /**
   * The foursome's stake. REQUIRED — a foursome override captures its complete
   * rules, so there is no implicit "inherit the event stake" snapshot that could
   * later drift from a changed event stake (codex/gemini review). Revert a
   * foursome to the event default via deleteFoursomeGameConfig, not by omitting.
   */
  pointValueSchedule: PointValueSchedule;
  now: number;
};

export type FoursomeConfigResult =
  | { ok: true; row: GameConfigRow; seeded: boolean; config: GameConfig }
  | { ok: false; reason: string };

/**
 * Resolve a foursome's PAIRING id (its stable foursome-config ref) within a round.
 * Joins event_rounds so the eventRound MUST belong to `eventId` — the service
 * enforces cross-event safety itself, not only the calling route (codex review).
 */
async function findPairingId(
  tx: Tx,
  input: { eventId: string; eventRoundId: string; foursomeNumber: number; tenantId: string },
): Promise<string | null> {
  const rows = await tx
    .select({ id: pairings.id })
    .from(pairings)
    .innerJoin(eventRounds, eq(eventRounds.id, pairings.eventRoundId))
    .where(
      and(
        eq(pairings.eventRoundId, input.eventRoundId),
        eq(pairings.foursomeNumber, input.foursomeNumber),
        eq(pairings.tenantId, input.tenantId),
        eq(eventRounds.eventId, input.eventId),
        eq(eventRounds.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Read + parse the event-level config (the base the foursome overrides). */
async function loadEventConfig(
  tx: Tx,
  eventId: string,
  tenantId: string,
): Promise<GameConfig | null> {
  const rows = await tx
    .select({ configJson: gameConfig.configJson })
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'event'),
        eq(gameConfig.refId, eventId),
        eq(gameConfig.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!rows[0]) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(rows[0].configJson);
  } catch {
    return null;
  }
  const parsed = parseGameConfig(raw);
  return parsed.ok ? parsed.config : null;
}

export async function seedOrUpdateFoursomeGameConfig(
  tx: Tx,
  input: FoursomeConfigInput,
): Promise<FoursomeConfigResult> {
  const pairingId = await findPairingId(tx, input);
  if (pairingId === null) return { ok: false, reason: 'foursome_not_found' };

  const eventConfig = await loadEventConfig(tx, input.eventId, input.tenantId);
  if (eventConfig === null) return { ok: false, reason: 'no_event_config' };

  // The foursome config = the event base with THIS foursome's modifiers (and an
  // optional stake override) applied. Every other field (game, cap, lockState,
  // configVersion, scope, allowance) inherits the event — the allowance % is the
  // event's source of truth and is re-frozen per foursome at pin time anyway.
  const candidate: GameConfig = {
    ...eventConfig,
    modifiers: input.modifiers,
    pointValueSchedule: input.pointValueSchedule,
  };

  const parsed = parseGameConfig(candidate);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const config = parsed.config;

  const columns = deriveConfigColumns(config);
  const consistency = checkConfigColumnsConsistent(
    { lockState: columns.lockState, configVersion: columns.configVersion },
    config,
  );
  if (!consistency.ok) return { ok: false, reason: consistency.reason };

  const existing = await tx
    .select({ id: gameConfig.id, configJson: gameConfig.configJson })
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'foursome'),
        eq(gameConfig.refId, pairingId),
        eq(gameConfig.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  const isFirstWrite = existing[0] === undefined;
  let before: GameConfig | null = null;
  if (existing[0]) {
    try {
      const p = parseGameConfig(JSON.parse(existing[0].configJson));
      if (p.ok) before = p.config;
    } catch {
      before = null;
    }
  }

  const rowId = existing[0]?.id ?? randomUUID();
  const configJson = JSON.stringify(config);

  await tx
    .insert(gameConfig)
    .values({
      id: rowId,
      level: 'foursome',
      refId: pairingId,
      configJson,
      seedRuleSetRevisionId: null,
      lockState: columns.lockState,
      configVersion: columns.configVersion,
      createdAt: input.now,
      updatedAt: input.now,
      tenantId: input.tenantId,
      contextId: input.contextId,
    })
    .onConflictDoUpdate({
      target: [gameConfig.tenantId, gameConfig.level, gameConfig.refId],
      set: {
        configJson,
        lockState: columns.lockState,
        configVersion: columns.configVersion,
        updatedAt: input.now,
      },
    });

  const row = (
    await tx
      .select()
      .from(gameConfig)
      .where(
        and(
          eq(gameConfig.level, 'foursome'),
          eq(gameConfig.refId, pairingId),
          eq(gameConfig.tenantId, input.tenantId),
        ),
      )
      .limit(1)
  )[0]!;

  await writeAudit(tx, {
    eventType: isFirstWrite ? AUDIT_EVENT_TYPES.GAME_CONFIG_SEEDED : AUDIT_EVENT_TYPES.GAME_CONFIG_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.GAME_CONFIG,
    entityId: row.id,
    actorPlayerId: input.actorPlayerId,
    payload: {
      eventId: input.eventId,
      level: 'foursome',
      foursomeNumber: input.foursomeNumber,
      pairingId,
      before,
      after: config,
    },
  });
  await emitActivity(tx, {
    type: isFirstWrite ? 'game.config_seeded' : 'game.config_updated',
    eventId: input.eventId,
    actorPlayerId: input.actorPlayerId,
  });

  return { ok: true, row, seeded: isFirstWrite, config };
}

export type DeleteFoursomeConfigResult = { ok: true; deleted: boolean } | { ok: false; reason: string };

/** Clear a foursome's override → it reverts to the event default at next pin. */
export async function deleteFoursomeGameConfig(
  tx: Tx,
  input: { eventId: string; tenantId: string; eventRoundId: string; foursomeNumber: number; actorPlayerId: string },
): Promise<DeleteFoursomeConfigResult> {
  const pairingId = await findPairingId(tx, input);
  if (pairingId === null) return { ok: false, reason: 'foursome_not_found' };

  const existing = await tx
    .select({ id: gameConfig.id })
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'foursome'),
        eq(gameConfig.refId, pairingId),
        eq(gameConfig.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  if (existing[0] === undefined) return { ok: true, deleted: false };

  await tx
    .delete(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'foursome'),
        eq(gameConfig.refId, pairingId),
        eq(gameConfig.tenantId, input.tenantId),
      ),
    );
  await writeAudit(tx, {
    eventType: AUDIT_EVENT_TYPES.GAME_CONFIG_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.GAME_CONFIG,
    entityId: existing[0].id,
    actorPlayerId: input.actorPlayerId,
    payload: { eventId: input.eventId, level: 'foursome', foursomeNumber: input.foursomeNumber, pairingId, cleared: true },
  });
  return { ok: true, deleted: true };
}
