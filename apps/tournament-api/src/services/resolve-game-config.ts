/**
 * resolve-game-config.ts (Story 1.3) — the cascade-resolver service.
 *
 * A thin loader around the engine's `resolveConfig` (Story 1.1). Given an
 * (event, round?, foursome?) it loads ONLY the matching-level `game_config`
 * rows and returns the engine-resolved config.
 *
 * SECURITY — hierarchy validation FIRST (AC5/AC6, prevents cross-event leak):
 * before loading ANY config, the service verifies the supplied `roundId`
 * belongs to `eventId` (the scoring round is for that event) and that
 * `foursomeNumber` is a foursome of that round's pairings — and ALL are in the
 * caller's tenant. A `roundId`/`foursomeNumber` not under `eventId` is REJECTED
 * (`{ ok: false, reason }` with a `hierarchy:*` reason), never silently
 * resolved against another event's rows.
 *
 * F1 classification (pattern 14): an event with an event-level row is an F1
 * event. An orphan round/foursome row with NO event-level row surfaces the
 * engine's `no_event_level_config` reason — unsettleable, never a 500.
 */
import { and, eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { gameConfig, rounds, pairings } from '../db/schema/index.js';
import type { GameConfig } from '../engine/games/types.js';
import { resolveConfig, type LeveledConfigRow } from '../engine/games/resolver.js';
import { parseGameConfig } from '../engine/games/config-schema.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type ResolveGameConfigInput = {
  eventId: string;
  tenantId: string;
  roundId?: string | undefined;
  foursomeNumber?: number | undefined;
};

export type ResolveGameConfigResult =
  | { ok: true; config: GameConfig }
  // `kind:'hierarchy'` → a 404 at the route (the round/foursome isn't under the
  // event); `kind:'unsettleable'` → a 200 { ok:false, reason } (orphan/unseeded
  // /unsupported/corrupt config surfaced from the engine or a fail-closed read,
  // never a 500).
  | { ok: false; kind: 'hierarchy' | 'unsettleable'; reason: string };

/**
 * Validate the (event, round?, foursome?) hierarchy, then load + resolve.
 */
export async function resolveEventGameConfig(
  txOrDb: Tx | Db,
  input: ResolveGameConfigInput,
): Promise<ResolveGameConfigResult> {
  const { eventId, tenantId } = input;

  // foursomeNumber requires roundId (a foursome only has meaning within a round).
  if (input.foursomeNumber !== undefined && input.roundId === undefined) {
    return { ok: false, kind: 'hierarchy', reason: 'foursome_requires_round' };
  }

  // ---- Hierarchy validation (BEFORE loading any config) -------------------
  let eventRoundId: string | null = null;
  if (input.roundId !== undefined) {
    const roundRows = await txOrDb
      .select({ id: rounds.id, eventId: rounds.eventId, eventRoundId: rounds.eventRoundId })
      .from(rounds)
      .where(and(eq(rounds.id, input.roundId), eq(rounds.tenantId, tenantId)))
      .limit(1);
    const round = roundRows[0];
    // Round must exist, be in-tenant, AND belong to THIS event (no cross-event).
    if (!round || round.eventId !== eventId) {
      return { ok: false, kind: 'hierarchy', reason: 'round_not_in_event' };
    }
    eventRoundId = round.eventRoundId;

    if (input.foursomeNumber !== undefined) {
      // The round's pairings live under its event_round (the setup-time round).
      if (eventRoundId === null) {
        return { ok: false, kind: 'hierarchy', reason: 'round_has_no_pairings' };
      }
      const pairingRows = await txOrDb
        .select({ id: pairings.id })
        .from(pairings)
        .where(
          and(
            eq(pairings.eventRoundId, eventRoundId),
            eq(pairings.foursomeNumber, input.foursomeNumber),
            eq(pairings.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!pairingRows[0]) {
        return { ok: false, kind: 'hierarchy', reason: 'foursome_not_in_round' };
      }
    }
  }

  // ---- Load ONLY the validated level rows ---------------------------------
  const leveled: LeveledConfigRow[] = [];

  const eventRow = await loadLevelRow(txOrDb, 'event', eventId, tenantId);
  if (eventRow === 'corrupt') return { ok: false, kind: 'unsettleable', reason: 'corrupt_config' };
  if (eventRow) leveled.push(eventRow);

  if (input.roundId !== undefined) {
    const roundRow = await loadLevelRow(txOrDb, 'round', input.roundId, tenantId);
    if (roundRow === 'corrupt') return { ok: false, kind: 'unsettleable', reason: 'corrupt_config' };
    if (roundRow) leveled.push(roundRow);
  }
  if (input.foursomeNumber !== undefined && eventRoundId !== null) {
    // Foursome-level ref_id is the pairing id (the stable foursome identity).
    const pairingRow = (
      await txOrDb
        .select({ id: pairings.id })
        .from(pairings)
        .where(
          and(
            eq(pairings.eventRoundId, eventRoundId),
            eq(pairings.foursomeNumber, input.foursomeNumber),
            eq(pairings.tenantId, tenantId),
          ),
        )
        .limit(1)
    )[0];
    if (pairingRow) {
      const foursomeRow = await loadLevelRow(txOrDb, 'foursome', pairingRow.id, tenantId);
      if (foursomeRow === 'corrupt') {
        return { ok: false, kind: 'unsettleable', reason: 'corrupt_config' };
      }
      if (foursomeRow) leveled.push(foursomeRow);
    }
  }

  const resolved = resolveConfig(leveled);
  if (!resolved.ok) {
    return { ok: false, kind: 'unsettleable', reason: resolved.reason };
  }
  return { ok: true, config: resolved.config };
}

/**
 * Load + parse one level's row.
 *   - `null`       → no row at this level (the engine's fail-closed surfaces).
 *   - `'corrupt'`  → a row exists but its `config_json` is non-JSON or fails
 *                    schema parse → caller returns a fail-closed `corrupt_config`
 *                    (never a 500 from an unguarded JSON.parse).
 *   - otherwise    → the parsed leveled config.
 * (Most-specific-wins de-dup is handled by the engine resolver.)
 */
async function loadLevelRow(
  txOrDb: Tx | Db,
  level: 'event' | 'round' | 'foursome',
  refId: string,
  tenantId: string,
): Promise<LeveledConfigRow | null | 'corrupt'> {
  const rows = await txOrDb
    .select({ configJson: gameConfig.configJson })
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, level),
        eq(gameConfig.refId, refId),
        eq(gameConfig.tenantId, tenantId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Guard the parse: a corrupt/non-JSON config_json must NOT throw a 500 —
  // surface it fail-closed as 'corrupt' (read contract: corrupt_config).
  let raw: unknown;
  try {
    raw = JSON.parse(row.configJson);
  } catch {
    return 'corrupt';
  }
  const parsed = parseGameConfig(raw);
  if (!parsed.ok) return 'corrupt';
  return { level, config: parsed.config };
}
