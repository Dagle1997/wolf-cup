import { integer, sqliteTable, text, unique, index } from 'drizzle-orm/sqlite-core';
import { ecosystemColumns } from './_columns.js';
import { ruleSetRevisions } from './rules.js';

/**
 * F1 "Rules & Games" — `game_config` (Story 1.2, additive; ADR D2).
 *
 * Carries a resolved/level config that the F1 engine (engine/games/) settles
 * from. Polymorphic `ref_id` (no per-level FK — the level dictates whether
 * ref_id is an event/round/foursome id; validated in code, D2). UNIQUE per
 * (tenant, level, ref_id).
 *
 * Source-of-truth (AC1): `config_json` is the SINGLE canonical engine-shaped
 * GameConfig; `lock_state` and `config_version` columns are DENORMALIZED
 * mirrors (for indexing/routing) the writer derives from config_json and
 * asserts equal — never two independent sources.
 *
 * Enums (`level`, `lock_state`) are plain text validated in Zod
 * (config-schema.ts) + isLevel()/isLockState() guards — NOT DB CHECK
 * constraints (T13-4: a CHECK forces a rebuild on later ALTERs; we keep these
 * columns CHECK-free so adding levels/states never needs a table rebuild).
 */
export const gameConfig = sqliteTable(
  'game_config',
  {
    id: text('id').primaryKey(),
    /** 'event' | 'round' | 'foursome' (Zod-validated; isLevel()). */
    level: text('level').notNull(),
    /** Polymorphic id (event/round/foursome) — no per-level FK (D2). */
    refId: text('ref_id').notNull(),
    /** Canonical engine-shaped GameConfig (Zod-validated on write). */
    configJson: text('config_json').notNull(),
    /** FK → rule_set_revisions.id; nullable (a bespoke config need not cite a preset). */
    seedRuleSetRevisionId: text('seed_rule_set_revision_id').references(
      () => ruleSetRevisions.id,
      { onDelete: 'restrict' },
    ),
    /** Denormalized mirror of config_json.lockState ('locked' | 'unlocked'); nullable. */
    lockState: text('lock_state'),
    /** Denormalized mirror of config_json.configVersion. */
    configVersion: integer('config_version').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    // One config row per (tenant, level, ref).
    tenantLevelRefUnique: unique('uq_game_config_tenant_level_ref').on(
      t.tenantId,
      t.level,
      t.refId,
    ),
    levelRefIdx: index('idx_game_config_level_ref').on(t.level, t.refId),
  }),
);

export type GameConfigRow = typeof gameConfig.$inferSelect;
