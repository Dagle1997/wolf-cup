/**
 * config-schema.ts (Story 1.2) — the write-time validation for `game_config`.
 *
 * STRUCTURAL validation (Zod) of the engine-shaped GameConfig, composed with
 * the engine's SEMANTIC validation (validateResolvedConfig from registry.ts).
 * Both the DB write path and the Zod↔engine drift test go through
 * parseGameConfig, so they cannot diverge (AC3). Pure — no db/Date/random.
 */
import { z } from 'zod';
import type { GameConfig } from './types.js';
import { validateResolvedConfig } from './registry.js';

const pointValueScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flat'), cents: z.number().int() }).strict(),
  z.object({ kind: z.literal('front-back'), frontCents: z.number().int(), backCents: z.number().int() }).strict(),
]);

const modifierSchema = z
  .object({
    type: z.string(),
    enabled: z.boolean(),
    variant: z
      .object({ basis: z.enum(['net', 'gross']), bonus: z.enum(['single', 'double']) })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Structural shape of a GameConfig (engine types.ts). `.strict()` REJECTS
 * unknown keys (rather than silently stripping them) so a non-canonical
 * config_json fails closed instead of being persisted. Semantic rules live in
 * validateResolvedConfig.
 */
export const gameConfigSchema = z
  .object({
    scope: z.string().optional(),
    game: z.string(),
    pointValueSchedule: pointValueScheduleSchema,
    modifiers: z.array(modifierSchema),
    cap: z.number().int().nullable().optional(),
    lockState: z.enum(['locked', 'unlocked']).optional(),
    configVersion: z.number().int(),
  })
  .strict();

/**
 * Per-player handicap snapshot ({ [playerId]: { hi, ch } }) stored on the
 * round pin. `.finite()` rejects NaN/Infinity so a bad snapshot can never
 * break recompute determinism downstream.
 */
export const perPlayerHandicapsSchema = z.record(
  z.string().min(1),
  z.object({ hi: z.number().finite(), ch: z.number().finite() }).strict(),
);

export type PerPlayerHandicaps = z.infer<typeof perPlayerHandicapsSchema>;

export type ParseResult = { ok: true; config: GameConfig } | { ok: false; reason: string };

/**
 * Validate a raw `config_json` value: Zod structure THEN engine semantics
 * (known game / registered modifiers / version ≤ engine / even positive point
 * value). Returns the typed config or a fail-closed reason. Used on write AND
 * as the basis of the drift test.
 */
export function parseGameConfig(raw: unknown): ParseResult {
  const parsed = gameConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `zod:${issue?.path.join('.') || '<root>'}:${issue?.code}` };
  }
  const config = parsed.data as GameConfig;
  const sem = validateResolvedConfig(config);
  if (!sem.ok) return { ok: false, reason: sem.reason };
  return { ok: true, config };
}

const LEVELS = new Set(['event', 'round', 'foursome']);
const LOCK_STATES = new Set(['locked', 'unlocked']);

export function isLevel(v: string): v is 'event' | 'round' | 'foursome' {
  return LEVELS.has(v);
}
export function isLockState(v: string): v is 'locked' | 'unlocked' {
  return LOCK_STATES.has(v);
}

/** The denormalized column values a game_config row must carry, derived FROM config_json (AC1). */
export function deriveConfigColumns(config: GameConfig): {
  lockState: 'locked' | 'unlocked' | null;
  configVersion: number;
} {
  return { lockState: config.lockState ?? null, configVersion: config.configVersion };
}

/**
 * AC1 consistency check: the row's denormalized columns MUST equal the values
 * derived from config_json. Returns a fail reason on mismatch — the write path
 * rejects, so the two can never become independent sources of truth.
 */
export function checkConfigColumnsConsistent(
  columns: { lockState: string | null; configVersion: number },
  config: GameConfig,
): { ok: true } | { ok: false; reason: string } {
  const expected = deriveConfigColumns(config);
  if ((columns.lockState ?? null) !== expected.lockState) {
    return { ok: false, reason: `lock_state_mismatch:column=${columns.lockState}:json=${expected.lockState}` };
  }
  if (columns.configVersion !== expected.configVersion) {
    return { ok: false, reason: `config_version_mismatch:column=${columns.configVersion}:json=${expected.configVersion}` };
  }
  return { ok: true };
}
