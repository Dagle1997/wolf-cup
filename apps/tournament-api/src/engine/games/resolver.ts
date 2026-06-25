/**
 * resolver.ts (Story 1.1) — the cascade config resolver.
 *
 * Resolves config for an (event, round, foursome) by deep-merging with
 * precedence Foursome > Round > Event (most-specific level wins): start from
 * the Event config and apply Round, then Foursome on top. Scalars are
 * overridden; the modifiers[] array is merged BY TYPE (a more-specific level's
 * entry for a type replaces the same-type entry; types only present at a
 * broader level are retained) — never concatenated, never wholesale-replaced.
 *
 * Level-parameterized from day one (event|round|foursome) so Epic 6's
 * foursome-level rows compose with no engine change; in Epic 1 only
 * event/round are populated.
 *
 * Lock gate: the event-level lock_state (default 'locked') gates the cascade —
 * when 'locked', lower-level overrides are IGNORED (event config wins outright);
 * when 'unlocked', the cascade merge applies.
 *
 * Fail-closed: an orphan lower-level row with no event-level row, an unknown
 * modifier type, or a too-new config_version yields an unsettleable result
 * (AC20).
 */
import type { GameConfig, Modifier } from './types.js';
import { validateResolvedConfig } from './registry.js';

export type ConfigLevel = 'event' | 'round' | 'foursome';

/** A config row at a given cascade level. The event row must be complete. */
export type LeveledConfigRow = {
  level: ConfigLevel;
  config: Partial<GameConfig>;
};

export type ResolveResult =
  | { ok: true; config: GameConfig }
  | { ok: false; reason: string };

const LEVEL_ORDER: Record<ConfigLevel, number> = { event: 0, round: 1, foursome: 2 };

/** Merge override modifiers into base by type; stable (sorted) order. */
function mergeModifiers(base: readonly Modifier[], override: readonly Modifier[] | undefined): Modifier[] {
  const byType = new Map<string, Modifier>();
  for (const m of base) byType.set(m.type, m);
  if (override) for (const m of override) byType.set(m.type, m);
  return [...byType.values()].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

/**
 * Options for resolveConfig.
 *
 * `applyOverridesWhenLocked` — when true, the cascade merge applies even if the
 * event is `locked`, while the RESOLVED lockState still reflects the event's real
 * value. This exists for the ROUND-PIN path (Epic 6 per-foursome money): the
 * money-safety lock is the immutable pin frozen at round start, NOT the cascade
 * gate, so per-foursome rules must merge INTO the pinned config even for a locked
 * (money-on) event. The default (omitted/false) preserves the original behavior:
 * a locked event ignores all lower-level overrides (organizer preview / runtime
 * reads). Money exposure stays gated by lockState elsewhere — unchanged.
 */
export type ResolveConfigOpts = { applyOverridesWhenLocked?: boolean };

export function resolveConfig(
  rows: readonly LeveledConfigRow[],
  opts?: ResolveConfigOpts,
): ResolveResult {
  // Fail closed on duplicate rows at ANY level — otherwise resolution would be
  // order-dependent (the DB enforces UNIQUE(tenant, level, ref_id), but the
  // engine must not silently pick one). Exactly one applicable row per level.
  for (const lvl of ['event', 'round', 'foursome'] as const) {
    const n = rows.filter((r) => r.level === lvl).length;
    if (lvl === 'event' && n === 0) return { ok: false, reason: 'no_event_level_config' };
    if (n > 1) return { ok: false, reason: `duplicate_${lvl}_level_config` };
  }
  // Fail closed on duplicate modifier types WITHIN any row, BEFORE mergeModifiers
  // would silently last-wins de-dupe them (which would make settlement
  // order-dependent). validateResolvedConfig also rejects duplicates, but the
  // merge runs first, so this pre-merge scan is what actually surfaces them.
  for (const row of rows) {
    const seen = new Set<string>();
    for (const m of row.config.modifiers ?? []) {
      if (seen.has(m.type)) return { ok: false, reason: `duplicate_modifier:${m.type}` };
      seen.add(m.type);
    }
  }

  const event = rows.find((r) => r.level === 'event')!;

  const ec = event.config;
  if (ec.game === undefined || ec.pointValueSchedule === undefined || ec.configVersion === undefined) {
    return { ok: false, reason: 'incomplete_event_level_config' };
  }

  const locked = (ec.lockState ?? 'locked') === 'locked';

  let merged: GameConfig = {
    game: ec.game,
    pointValueSchedule: ec.pointValueSchedule,
    // Normalize (dedupe-by-type + sort) the event base too, so the locked path
    // is not order-dependent on duplicate event modifiers.
    modifiers: mergeModifiers([], ec.modifiers ?? []),
    cap: ec.cap ?? null,
    lockState: locked ? 'locked' : 'unlocked',
    configVersion: ec.configVersion,
    scope: ec.scope,
  };

  // The cascade merge applies when the event is unlocked OR when the caller is
  // resolving FOR THE PIN (applyOverridesWhenLocked) — see ResolveConfigOpts.
  if (!locked || opts?.applyOverridesWhenLocked === true) {
    const moreSpecific = [...rows]
      .filter((r) => r.level !== 'event')
      .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
    for (const row of moreSpecific) {
      const c = row.config;
      merged = {
        ...merged,
        game: c.game ?? merged.game,
        pointValueSchedule: c.pointValueSchedule ?? merged.pointValueSchedule,
        cap: c.cap !== undefined ? c.cap : merged.cap,
        modifiers: mergeModifiers(merged.modifiers, c.modifiers),
        configVersion: Math.max(merged.configVersion, c.configVersion ?? 0),
        scope: c.scope ?? merged.scope,
      };
    }
  }

  // lockState is the event gate, not overridable by lower levels.
  merged.lockState = locked ? 'locked' : 'unlocked';

  const v = validateResolvedConfig(merged);
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, config: merged };
}
