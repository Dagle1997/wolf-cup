/**
 * game-config-write.ts (Story 1.3) — the event-level game-config writer.
 *
 * `seedOrUpdateEventGameConfig` builds the EVENT-LEVEL `game_config` row from
 * the Standard Guyan preset (read from the seeded revision, AC2) overlaid with
 * the organizer's point value + lock state, validates it fail-closed via
 * `parseGameConfig`, derives + asserts the denormalized `lock_state` /
 * `config_version` columns (Story 1.2 helpers), and upserts the row + an audit
 * row + an activity row in ONE transaction (AC3/AC4).
 *
 * Emission rule (AC4): the FIRST write for an event (no prior event-level row)
 * emits `game.config_seeded`; a subsequent write emits `game.config_updated`.
 *
 * Point value / lock deltas (AC8/AC9): a `pointValueSchedule` overlays the
 * preset/existing schedule; a lock-only update PRESERVES the existing schedule
 * (never overwrites it with a default). `config_version` is preserved (the
 * write does not bump the engine config version — that is a config-shape
 * migration concern, not a stake/lock edit).
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { gameConfig, type GameConfigRow } from '../db/schema/index.js';
import type { GameConfig, Modifier, PointValueSchedule } from '../engine/games/types.js';
import {
  parseGameConfig,
  deriveConfigColumns,
  checkConfigColumnsConsistent,
} from '../engine/games/config-schema.js';
import { writeAudit, AUDIT_EVENT_TYPES, AUDIT_ENTITY_TYPES } from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';
import { seedStandardGuyan, STANDARD_GUYAN_BASE_CONFIG } from './standard-guyan-seed.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type SeedOrUpdateInput = {
  eventId: string;
  tenantId: string;
  contextId: string;
  actorPlayerId: string;
  /** Optional point-value delta. Required on the FIRST seed; preserved if omitted. */
  pointValueSchedule?: PointValueSchedule | undefined;
  /** Optional lock delta. Defaults to 'locked' on the first seed if omitted. */
  lockState?: 'locked' | 'unlocked' | undefined;
  /**
   * Optional FULL modifier set (the rule pills: net-skins / greenie / polie / sandie
   * on-off + variants). When provided it REPLACES the modifier list; when omitted the
   * prior row's modifiers (or the preset's) are preserved. Validated via parseGameConfig.
   */
  modifiers?: Modifier[] | undefined;
  now: number;
};

export type SeedOrUpdateResult =
  | { ok: true; row: GameConfigRow; seeded: boolean; config: GameConfig }
  | { ok: false; reason: string };

/**
 * Build + persist the event-level config. ALL writes (preset seed, game_config
 * upsert, audit, activity) ride the caller's `tx` so they commit atomically.
 */
export async function seedOrUpdateEventGameConfig(
  tx: Tx,
  input: SeedOrUpdateInput,
): Promise<SeedOrUpdateResult> {
  // Existing event-level row (drives seed-vs-update + schedule preservation).
  const existingRows = await tx
    .select()
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'event'),
        eq(gameConfig.refId, input.eventId),
        eq(gameConfig.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  const existing = existingRows[0] ?? null;
  const isFirstWrite = existing === null;

  // First seed MUST supply a point value (no schedule to preserve yet).
  if (isFirstWrite && input.pointValueSchedule === undefined) {
    return { ok: false, reason: 'point_value_required_on_seed' };
  }

  // ---- Validate FIRST, fail closed, BEFORE any write/side-effect ----------
  // Build the candidate from the preset BASE CONSTANT (the value the seed
  // persists, AC2) overlaid with the prior row's schedule/lock (preservation)
  // and this call's deltas. We validate the config + denormalized columns
  // BEFORE seeding the preset or writing any row/audit/activity, so a doomed
  // (invalid) write produces ZERO side effects — the preset is only seeded once
  // the config is known good.
  const parsedBase = parseGameConfig(STANDARD_GUYAN_BASE_CONFIG);
  if (!parsedBase.ok) return { ok: false, reason: `preset_base_invalid:${parsedBase.reason}` };
  const baseConfig = parsedBase.config;

  let priorConfig: GameConfig | null = null;
  if (existing) {
    let priorRaw: unknown;
    try {
      priorRaw = JSON.parse(existing.configJson);
    } catch {
      // A corrupt existing row should fail the write cleanly, not crash with a
      // raw SyntaxError 500.
      throw new Error('game-config-write: existing config_json is corrupt');
    }
    const parsedPrior = parseGameConfig(priorRaw);
    if (!parsedPrior.ok) return { ok: false, reason: `existing_config_invalid:${parsedPrior.reason}` };
    priorConfig = parsedPrior.config;
  }

  const pointValueSchedule: PointValueSchedule =
    input.pointValueSchedule ??
    priorConfig?.pointValueSchedule ??
    baseConfig.pointValueSchedule;

  const lockState: 'locked' | 'unlocked' =
    input.lockState ?? priorConfig?.lockState ?? baseConfig.lockState ?? 'locked';

  // Rule pills: an explicit modifier set REPLACES the list; otherwise preserve the
  // prior row's (or the preset's all-on default). parseGameConfig below validates it.
  const modifiers: Modifier[] =
    input.modifiers ?? priorConfig?.modifiers ?? baseConfig.modifiers;

  const candidate: GameConfig = {
    ...baseConfig,
    pointValueSchedule,
    lockState,
    modifiers,
    // configVersion is preserved from the prior row if present (engine-version
    // bumps are not a stake/lock edit); otherwise the preset's.
    configVersion: priorConfig?.configVersion ?? baseConfig.configVersion,
  };

  // Fail closed: validate the resolved event config before any write.
  const parsed = parseGameConfig(candidate);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const config = parsed.config;

  // Derive + assert the denormalized columns can never diverge from config_json.
  const columns = deriveConfigColumns(config);
  const consistency = checkConfigColumnsConsistent(
    { lockState: columns.lockState, configVersion: columns.configVersion },
    config,
  );
  if (!consistency.ok) return { ok: false, reason: consistency.reason };

  // ---- Config is known good → NOW seed the preset + write rows ------------
  // Seed (or reuse) the Standard Guyan preset — provenance for the row below.
  // Deferred to here so an invalid config never leaves a seeded preset behind.
  const preset = await seedStandardGuyan(tx, {
    tenantId: input.tenantId,
    contextId: input.contextId,
    createdByPlayerId: input.actorPlayerId,
    now: input.now,
  });

  const rowId = existing?.id ?? randomUUID();
  const configJson = JSON.stringify(config);

  // UPSERT on the (tenant_id, level, ref_id) unique. This makes two concurrent
  // first PUTs for the same event safe: the loser of the INSERT race (or a
  // repeat write) UPDATES the existing row rather than throwing a raw UNIQUE
  // constraint error (→ 500). On a conflict the existing row's `id`/`created_at`
  // are kept (we never overwrite them in the `set`), so the winner's row wins;
  // we re-select by the unique key below, not by `rowId`, since on a lost race
  // `rowId` is the candidate id that was discarded by onConflictDoUpdate.
  await tx
    .insert(gameConfig)
    .values({
      id: rowId,
      level: 'event',
      refId: input.eventId,
      configJson,
      seedRuleSetRevisionId: preset.revisionId,
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
        seedRuleSetRevisionId: preset.revisionId,
        lockState: columns.lockState,
        configVersion: columns.configVersion,
        updatedAt: input.now,
      },
    });

  // Re-select by the UNIQUE key (not the candidate id) so a lost INSERT race
  // still returns the surviving row.
  const row = (
    await tx
      .select()
      .from(gameConfig)
      .where(
        and(
          eq(gameConfig.level, 'event'),
          eq(gameConfig.refId, input.eventId),
          eq(gameConfig.tenantId, input.tenantId),
        ),
      )
      .limit(1)
  )[0]!;

  // Audit (full before/after) + activity (lightweight feed event), in-tx.
  await writeAudit(tx, {
    eventType: isFirstWrite
      ? AUDIT_EVENT_TYPES.GAME_CONFIG_SEEDED
      : AUDIT_EVENT_TYPES.GAME_CONFIG_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.GAME_CONFIG,
    // Use the surviving row's id (a lost INSERT race discards the candidate
    // `rowId`), so the audit always references the real game_config row.
    entityId: row.id,
    actorPlayerId: input.actorPlayerId,
    payload: {
      eventId: input.eventId,
      seedRuleSetRevisionId: preset.revisionId,
      before: priorConfig,
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
