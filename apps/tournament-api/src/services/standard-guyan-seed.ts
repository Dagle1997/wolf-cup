/**
 * standard-guyan-seed.ts (Story 1.3) — the idempotent "Standard Guyan" preset.
 *
 * The preset is a SINGLE DB-seeded source of truth (AC2): a `rule_set` +
 * `rule_set_revision` whose revision `config_json` carries the canonical
 * `guyan-2v2` base config (the shape Story 1.1's golden settles — low ball +
 * skin + team total + the net-skins bonus). The game-config write service READS
 * this seeded revision's config and overlays only the organizer's point value;
 * it never hardcodes the base inline.
 *
 * Idempotency (AC2): the rule_set + baseline revision rows use DETERMINISTIC
 * primary-key ids derived from the tenant + a stable slug. Insert is
 * `.onConflictDoNothing()` then re-SELECT, so a concurrent double-seed conflicts
 * on the PRIMARY KEY (a no-op) and both callers read the SAME row — there is no
 * unique constraint on `rule_sets.name`, so a name-only find-or-create would
 * race two duplicate rule_sets. A re-run returns the existing rule_set + its
 * baseline revision unchanged — no cross-tenant duplication, no second revision.
 *
 * The literal base object lives here as a code CONSTANT used to POPULATE the
 * revision; the revision row is what the write path reads (AC2).
 */
import { eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { ruleSets, ruleSetRevisions } from '../db/schema/index.js';
import type { GameConfig } from '../engine/games/types.js';
import { parseGameConfig } from '../engine/games/config-schema.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Stable per-tenant key (the rule_set name) the seed finds-or-creates by. */
export const STANDARD_GUYAN_NAME = 'Standard Guyan';

/** Deterministic per-tenant primary-key id for the Standard Guyan rule_set. */
export const standardGuyanRuleSetId = (tenantId: string): string =>
  `rs-standard-guyan-${tenantId}`;

/** Deterministic per-tenant primary-key id for its baseline (v1) revision. */
export const standardGuyanRevisionId = (tenantId: string): string =>
  `rsr-standard-guyan-${tenantId}-v1`;

/**
 * The canonical `guyan-2v2` base config (AC2). Point value is a PLACEHOLDER the
 * write path overlays with the organizer's chosen schedule — the base carries
 * the game + modifier shape + lock default, not the stake. Matches
 * `engine/games/__fixtures__/guyan-2v2-base-flat.json` (config block).
 */
export const STANDARD_GUYAN_BASE_CONFIG: GameConfig = {
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  // Standard Guyan = Net Skins + Greenies + Polies + Sandies (Josh 2026-06-25), all
  // ON by default. Greenie/polie/sandie are pure player-CLAIM count modifiers — with
  // no claims they contribute 0, so enabling them is money-neutral until a player taps
  // G/P/S. The organizer can flip any of them OFF on the game-config screen (rule pills),
  // which also hides its claim button on score entry. net-skins basis stays 'net'
  // (gross-basis for the birdie/eagle bonus is a future engine add).
  modifiers: [
    { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } },
    { type: 'greenie', enabled: true, variant: { carryover: true } },
    { type: 'polie', enabled: true },
    { type: 'sandie', enabled: true },
  ],
  lockState: 'locked',
  configVersion: 1,
};

export type StandardGuyanSeedResult = {
  ruleSetId: string;
  revisionId: string;
  /** The base config carried by the seeded revision (parsed/canonical). */
  baseConfig: GameConfig;
  /** True if THIS call created the rule_set (false = reused an existing one). */
  created: boolean;
};

/**
 * Find-or-create the tenant's "Standard Guyan" preset. Returns the rule_set +
 * its baseline (revision 1) revision id and the base config it carries. The
 * caller supplies `createdByPlayerId` (the acting organizer) for the
 * RESTRICT-FK attribution on a first-time create; it is ignored on reuse.
 *
 * Composes inside the caller's tx so the seed + the event-config write commit
 * atomically (the write service calls this first).
 */
export async function seedStandardGuyan(
  txOrDb: Tx | Db,
  args: { tenantId: string; contextId: string; createdByPlayerId: string; now: number },
): Promise<StandardGuyanSeedResult> {
  // Fail closed: the constant must itself be a valid engine config.
  const parsedBase = parseGameConfig(STANDARD_GUYAN_BASE_CONFIG);
  if (!parsedBase.ok) {
    throw new Error(`seedStandardGuyan: invalid base config (${parsedBase.reason})`);
  }

  // Deterministic ids: a concurrent double-seed conflicts on the PRIMARY KEY
  // (no-op) and both callers re-SELECT the same row — no duplicate rule_set.
  const ruleSetId = standardGuyanRuleSetId(args.tenantId);
  const revisionId = standardGuyanRevisionId(args.tenantId);

  // Was this row already present before THIS call? (drives the `created` flag.)
  const before = await txOrDb
    .select({ id: ruleSets.id })
    .from(ruleSets)
    .where(eq(ruleSets.id, ruleSetId))
    .limit(1);
  const created = before[0] === undefined;

  // insert-on-conflict-do-nothing → a racing second insert is a silent no-op.
  await txOrDb
    .insert(ruleSets)
    .values({
      id: ruleSetId,
      name: STANDARD_GUYAN_NAME,
      createdAt: args.now,
      tenantId: args.tenantId,
      contextId: args.contextId,
    })
    .onConflictDoNothing();
  await txOrDb
    .insert(ruleSetRevisions)
    .values({
      id: revisionId,
      ruleSetId,
      revisionNumber: 1,
      // Persist the CANONICAL (parsed) base — never the raw constant.
      configJson: JSON.stringify(parsedBase.config),
      effectiveFromRoundId: null,
      effectiveFromHole: 1,
      createdByPlayerId: args.createdByPlayerId,
      reason: 'seed:standard-guyan',
      createdAt: args.now,
      tenantId: args.tenantId,
      contextId: args.contextId,
    })
    .onConflictDoNothing();

  // Re-SELECT the baseline revision's config (AC2: read the seeded revision, do
  // not re-derive from the constant downstream) — the row both callers share.
  const rev = await txOrDb
    .select({ id: ruleSetRevisions.id, configJson: ruleSetRevisions.configJson })
    .from(ruleSetRevisions)
    .where(eq(ruleSetRevisions.id, revisionId))
    .limit(1);
  if (!rev[0]) {
    throw new Error(`seedStandardGuyan: rule_set ${ruleSetId} has no baseline revision`);
  }
  let revRaw: unknown;
  try {
    revRaw = JSON.parse(rev[0].configJson);
  } catch {
    // A corrupt seeded revision should fail cleanly, not crash with a raw
    // SyntaxError 500.
    throw new Error(`seedStandardGuyan: seeded revision ${revisionId} config_json is corrupt`);
  }
  const parsed = parseGameConfig(revRaw);
  if (!parsed.ok) {
    throw new Error(`seedStandardGuyan: seeded revision config invalid (${parsed.reason})`);
  }

  return { ruleSetId, revisionId: rev[0].id, baseConfig: parsed.config, created };
}
