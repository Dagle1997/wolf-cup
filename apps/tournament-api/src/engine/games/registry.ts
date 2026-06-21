/**
 * registry.ts (Story 1.1) — the known-game / known-modifier registry and the
 * fail-closed config validator (AC20, FR44, pattern 6). An unknown modifier
 * type or a config_version newer than the engine supports is REJECTED
 * (unsettleable + surfaced), never silently ignored.
 *
 * Modifier types are registered (register/has/list) so adding a modifier in a
 * later epic is one registration; application order is the sorted type list
 * (stable, deterministic).
 */
import type { GameConfig, PointValueSchedule } from './types.js';

/** The highest config_version this engine build understands. */
export const ENGINE_CONFIG_VERSION = 1;

/** Base games this engine can settle (Story 1.1: only the Guyan 2v2). */
const KNOWN_GAMES = new Set<string>(['guyan-2v2']);

const modifierRegistry = new Set<string>();

/** Register a modifier type as supported by this engine build. */
export function registerModifier(type: string): void {
  modifierRegistry.add(type);
}

/** Is this modifier type registered? */
export function hasModifier(type: string): boolean {
  return modifierRegistry.has(type);
}

/** Registered modifier types in stable (sorted) application order. */
export function registeredModifierTypes(): string[] {
  return [...modifierRegistry].sort();
}

// Story 1.1 registers exactly one modifier.
registerModifier('net-skins');

export type Validation = { ok: true } | { ok: false; reason: string };

/**
 * Validate a point-value schedule: every value must be a positive, EVEN
 * integer-cents amount. Even is required because a 2v2 team point splits into
 * 4 cross-team edges of `value/2` (whole-dollar point values, a multiple of
 * 100 cents, are always even). Returns a reason on rejection, else null.
 */
function validateSchedule(s: PointValueSchedule): string | null {
  const vals = s.kind === 'flat' ? [s.cents] : [s.frontCents, s.backCents];
  for (const v of vals) {
    if (!Number.isInteger(v) || v <= 0) return `invalid_point_value:${v}`;
    if (v % 2 !== 0) return `point_value_not_even:${v}`;
  }
  return null;
}

/**
 * Fail-closed validation of a resolved config (AC20, FR44, pattern 6). Returns
 * a reason on rejection so the caller can surface "unsettleable" rather than
 * compute on an unsupported config. computeFoursome assumes a config that has
 * passed this check (resolveConfig runs it; the production path never settles
 * an unvalidated config).
 */
export function validateResolvedConfig(config: GameConfig): Validation {
  if (!Number.isInteger(config.configVersion) || config.configVersion < 1) {
    return { ok: false, reason: `invalid_config_version:${config.configVersion}` };
  }
  if (config.configVersion > ENGINE_CONFIG_VERSION) {
    return { ok: false, reason: `config_version_too_new:${config.configVersion}` };
  }
  if (!KNOWN_GAMES.has(config.game)) {
    return { ok: false, reason: `unknown_game:${config.game}` };
  }
  const scheduleErr = validateSchedule(config.pointValueSchedule);
  if (scheduleErr) return { ok: false, reason: scheduleErr };
  const seenTypes = new Set<string>();
  for (const m of config.modifiers) {
    // Duplicate modifier types make the active entry order-dependent — reject.
    if (seenTypes.has(m.type)) {
      return { ok: false, reason: `duplicate_modifier:${m.type}` };
    }
    seenTypes.add(m.type);
    if (!hasModifier(m.type)) {
      return { ok: false, reason: `unknown_modifier:${m.type}` };
    }
    // Story 1.1 supports only the NET, SINGLE net-skins variant. An ENABLED
    // gross/double variant must FAIL CLOSED — never silently disable or treat
    // double as single (would compute the wrong money). Disabled modifiers are
    // inert, so their variant is not constrained.
    if (m.type === 'net-skins' && m.enabled) {
      const basis = m.variant?.basis ?? 'net';
      const bonus = m.variant?.bonus ?? 'single';
      if (basis !== 'net' || bonus !== 'single') {
        return { ok: false, reason: `unsupported_net_skins_variant:${basis}/${bonus}` };
      }
    }
  }
  return { ok: true };
}
