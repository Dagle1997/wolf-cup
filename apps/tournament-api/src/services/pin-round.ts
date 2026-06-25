/**
 * pin-round.ts (Story 1.2) — the round-pin writer.
 *
 * Writes one IMMUTABLE provenance pin per round, ATOMIC + IDEMPOTENT under the
 * UNIQUE(round_id) constraint (AC11): a second pin for an already-pinned round
 * is a NO-OP returning the existing row unchanged — the new data is ignored
 * (only an Epic 4 correction re-pins). Takes the caller's tx so it composes
 * inside the round-start transaction (Story 1.4).
 *
 * Integrity (impl-review fixes):
 *  - persists the CANONICAL (Zod-parsed) config, not the raw input;
 *  - validates the per-player handicap snapshot (finite numbers) before write;
 *  - copies tenant_id / context_id FROM the round (AC5 provenance) — never
 *    trusts a caller-supplied tenant.
 */
import { eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { roundPins, rounds, type RoundPinRow } from '../db/schema/index.js';
import type { GameConfig } from '../engine/games/types.js';
import {
  parseGameConfig,
  perPlayerHandicapsSchema,
  type PerPlayerHandicaps,
} from '../engine/games/config-schema.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type { PerPlayerHandicaps };

export type PinRoundInput = {
  roundId: string;
  /** The fully-RESOLVED config the round settles under (the round-level default). */
  resolvedConfig: GameConfig;
  /**
   * Per-foursome config overrides (Epic 6 per-foursome money), keyed by foursome
   * number. Present ONLY for foursomes whose rules differ from the round default;
   * every other foursome settles from `resolvedConfig`. Each is validated +
   * canonicalized like the round config. Omitted/empty → no overrides pinned
   * (NULL column), fully backward compatible.
   */
  foursomeConfigs?: Record<number, GameConfig>;
  /** { [playerId]: { hi, ch } } pinned at round-start (AC6). */
  perPlayerHandicaps: PerPlayerHandicaps;
  courseRevisionId: string;
  tee: string;
  seedRuleSetRevisionId?: string | null;
  createdAt: number;
};

export type PinRoundResult = { pinned: boolean; row: RoundPinRow };

export async function pinRound(txOrDb: Tx | Db, input: PinRoundInput): Promise<PinRoundResult> {
  // Fail closed: never pin an unsupported/invalid resolved config.
  const parsed = parseGameConfig(input.resolvedConfig);
  if (!parsed.ok) throw new Error(`pinRound: invalid resolved config (${parsed.reason})`);

  // Fail closed: every per-foursome override must itself be a valid engine config.
  // Canonicalize (store the parsed form, never the raw input) for byte-stability.
  let foursomeConfigsJson: string | null = null;
  if (input.foursomeConfigs && Object.keys(input.foursomeConfigs).length > 0) {
    const canonical: Record<string, GameConfig> = {};
    for (const [foursomeNumber, cfg] of Object.entries(input.foursomeConfigs)) {
      // Keys must be positive-integer foursome numbers — reject a bad key at WRITE
      // time rather than letting it poison the whole pin on read (codex review).
      const n = Number(foursomeNumber);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`pinRound: invalid foursome key '${foursomeNumber}'`);
      }
      const p = parseGameConfig(cfg);
      if (!p.ok) {
        throw new Error(`pinRound: invalid foursome ${foursomeNumber} config (${p.reason})`);
      }
      canonical[String(n)] = p.config;
    }
    foursomeConfigsJson = JSON.stringify(canonical);
  }

  // Fail closed: per-player handicap snapshot must be finite numbers.
  const hcp = perPlayerHandicapsSchema.safeParse(input.perPlayerHandicaps);
  if (!hcp.success) {
    throw new Error(`pinRound: invalid per-player handicaps (${hcp.error.issues[0]?.path.join('.')})`);
  }

  // Fail closed: createdAt must be a finite integer timestamp.
  if (!Number.isInteger(input.createdAt)) {
    throw new Error(`pinRound: createdAt must be an integer (got ${input.createdAt})`);
  }

  // Tenancy provenance (AC5): copy tenant/context FROM the round — never trust a
  // caller value. A pin for a non-existent round is an error.
  const roundRows = await txOrDb
    .select({ tenantId: rounds.tenantId, contextId: rounds.contextId })
    .from(rounds)
    .where(eq(rounds.id, input.roundId))
    .limit(1);
  const round = roundRows[0];
  if (!round) throw new Error(`pinRound: round ${input.roundId} not found`);

  const row = {
    roundId: input.roundId,
    resolvedConfigJson: JSON.stringify(parsed.config), // CANONICAL (parsed), not raw input
    seedRuleSetRevisionId: input.seedRuleSetRevisionId ?? null,
    courseRevisionId: input.courseRevisionId,
    tee: input.tee,
    perPlayerHandicapsJson: JSON.stringify(hcp.data),
    foursomeConfigsJson,
    teamCompositionJson: null,
    createdAt: input.createdAt,
    tenantId: round.tenantId,
    contextId: round.contextId,
  };

  // The UNIQUE(round_id) constraint arbitrates concurrent pins: INSERT ... ON
  // CONFLICT DO NOTHING; .returning() is non-empty only if WE inserted.
  const inserted = await txOrDb.insert(roundPins).values(row).onConflictDoNothing().returning();
  if (inserted.length > 0) return { pinned: true, row: inserted[0]! };

  // Already pinned — return the existing row UNCHANGED (immutable; data ignored).
  const existing = await txOrDb
    .select()
    .from(roundPins)
    .where(eq(roundPins.roundId, input.roundId))
    .limit(1);
  if (!existing[0]) {
    throw new Error(`pinRound: conflict on round ${input.roundId} but no existing pin found`);
  }
  return { pinned: false, row: existing[0] };
}
