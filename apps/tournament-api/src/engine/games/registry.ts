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

// Story 1.1 net-skins; 2.2 greenie; 2.3 polie; 2.4 sandie.
registerModifier('net-skins');
registerModifier('greenie');
registerModifier('polie');
registerModifier('sandie');

export type Validation = { ok: true } | { ok: false; reason: string };

/**
 * Validate a point-value schedule: every value must be a positive, WHOLE-DOLLAR
 * integer-cents amount (a multiple of 100 cents). Story 2.1a: whole-dollar is
 * required so no half-dollar can ever appear in a settle-up leg ("nobody plays
 * $2.50 a point" — Josh 2026-06-22). ×100 subsumes the prior "even" rule, so the
 * 2v2 cross matrix's internal `value/2` cells stay integer cents. Returns a
 * reason on rejection, else null.
 */
function validateSchedule(s: PointValueSchedule): string | null {
  const vals = s.kind === 'flat' ? [s.cents] : [s.frontCents, s.backCents];
  for (const v of vals) {
    if (!Number.isInteger(v) || v <= 0) return `invalid_point_value:${v}`;
    if (v % 100 !== 0) return `point_value_not_whole_dollar:${v}`;
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
    // `enabled` decides active/inactive for EVERY modifier (the *Active helpers
    // read it), so it is as load-bearing as `type`. A non-boolean reaching
    // computeFoursome directly (bypassing Zod) would flip a modifier on/off by JS
    // truthiness and move money — fail closed. (Same direct-caller threat model as
    // the variant-shape / carryover-type guards below.)
    if (typeof m.enabled !== 'boolean') {
      return { ok: false, reason: `invalid_modifier_enabled:${m.type}` };
    }
    // Fail closed on a malformed (non-object) variant for an ENABLED modifier.
    // The TS type + Zod schema both guarantee an object, but computeFoursome's
    // guard must also protect a direct caller passing UNVALIDATED JSON: a
    // string/boolean/null/array variant would otherwise read as "absent" (optional
    // chaining → undefined) and silently DEFAULT every lever — the exact
    // mis-settlement the carryover-type check below also guards. Disabled
    // modifiers stay inert (variant unconstrained).
    if (
      m.enabled &&
      m.variant !== undefined &&
      (typeof m.variant !== 'object' || m.variant === null || Array.isArray(m.variant))
    ) {
      return { ok: false, reason: `invalid_variant_shape:${m.type}` };
    }
    // Per-modifier variant allowlist (FR44, AC11). Since `variant` keys are
    // shared across modifiers (ModifierVariant), a key meaningful for ONE
    // modifier MUST NOT be silently ignored on ANOTHER in a money engine — a
    // misplaced lever fails closed. Disabled modifiers are inert (variant
    // unconstrained); only ENABLED modifiers are checked.
    if (m.type === 'net-skins' && m.enabled) {
      // Story 1.1 supports only the NET, SINGLE net-skins variant. An ENABLED
      // gross/double variant must FAIL CLOSED — never silently disable or treat
      // double as single (would compute the wrong money).
      const basis = m.variant?.basis ?? 'net';
      const bonus = m.variant?.bonus ?? 'single';
      if (basis !== 'net' || bonus !== 'single') {
        return { ok: false, reason: `unsupported_net_skins_variant:${basis}/${bonus}` };
      }
      // carryover is a GREENIE-only lever (Story 2.2) — reject it on net-skins.
      if (m.variant?.carryover !== undefined) {
        return { ok: false, reason: `unsupported_net_skins_variant:carryover` };
      }
    }
    // Story 2.2: greenie's ONLY lever is `carryover` (FR2). An enabled greenie
    // carrying a net-skins lever (basis/bonus) is a malformed config → fail
    // closed rather than silently ignore the stray key on a money modifier.
    if (m.type === 'greenie' && m.enabled) {
      if (m.variant?.basis !== undefined) {
        return { ok: false, reason: `unsupported_greenie_variant:basis=${m.variant.basis}` };
      }
      if (m.variant?.bonus !== undefined) {
        return { ok: false, reason: `unsupported_greenie_variant:bonus=${m.variant.bonus}` };
      }
      // Type-check greenie's ONLY lever. computeFoursome relies on this guard for
      // ANY direct caller (bypassing Zod); greenieCarryover's `?? true` would
      // mis-interpret a non-boolean (e.g. "false"/0/null) via JS truthiness and
      // compute the wrong money. Fail closed instead.
      if (m.variant?.carryover !== undefined && typeof m.variant.carryover !== 'boolean') {
        return { ok: false, reason: `unsupported_greenie_variant:carryover_type` };
      }
    }
    // Stories 2.4/2.4a: sandie AND polie are PURE COUNT modifiers with NO lever
    // (FR16 — no engine-enforced eligibility gate). An enabled sandie/polie
    // carrying ANY variant key (known OR unknown) is a misconfig → fail closed
    // (stricter than greenie/net-skins, which allow-list their known keys, because
    // sandie/polie have zero valid keys). Absent or empty `variant:{}` passes (the
    // shared shape guard above already accepts an empty object).
    if ((m.type === 'sandie' || m.type === 'polie') && m.enabled && m.variant !== undefined) {
      const keys = Object.keys(m.variant);
      if (keys.length > 0) {
        return { ok: false, reason: `unsupported_${m.type}_variant:${keys[0]}` };
      }
    }
  }
  return { ok: true };
}
