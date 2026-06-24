/**
 * games-money.ts (Story 1.4) — the SINGLE F1 settlement chokepoint (pattern 16).
 *
 * This is the only place F1 (Guyan 2v2) money is computed for an event. The
 * money matrix, the leaderboard money mode, and the settle-up surfaces ALL read
 * F1 money exclusively through `computeF1EventEdges` — never inline.
 *
 * Money-safety invariant (AC2 — closed over EVERY consumer):
 *   At round-start a pin froze each player's COURSE HANDICAP (computed once from
 *   the effective HI). On read/recompute, this service derives per-hole net from
 *   the PINNED CH via `allocateStrokesFromCourseHandicap`, and reads every
 *   course-dependent input (stroke index, par, hole count) from the PINNED
 *   `course_revision_id`. It NEVER calls `calcCourseHandicap` / `buildTeeByPlayer`
 *   or reads a live HI on this path. A later course/rating/HI edit therefore
 *   cannot move a pinned round's money.
 *
 * Recompute-on-read (D5): there is NO stored money. Every read recomputes from
 * the immutable pinned inputs + the (append-only-corrected) scores.
 *
 * Fail-closed + per-foursome isolation (AC5/AC11): a foursome with a missing or
 * partial/corrupt pin, a missing handicap, or otherwise unsettleable inputs is
 * reported `unsettleable` with a reason and contributes NO edges — without
 * blocking the rest of the event. This service NEVER throws on bad foursome
 * data and NEVER falls back to a live recompute.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  courseHoles,
  eventRounds,
  gameConfig,
  holeScores,
  pairingMembers,
  pairings,
  roundPins,
  rounds,
} from '../db/schema/index.js';
import { allocateStrokesFromCourseHandicap, applyAllowanceOffLow } from '../engine/handicap-strokes.js';
import { computeFoursome } from '../engine/games/compute-foursome.js';
import { ledgerToEdges } from '../engine/games/ledger-to-edges.js';
import type {
  FoursomeInput,
  GameConfig,
  HoleState,
  SettlementEdge,
  TeamSplit,
} from '../engine/games/types.js';
import { parseGameConfig, perPlayerHandicapsSchema } from '../engine/games/config-schema.js';
import { resolveFoursomeTeams } from './foursome-teams.js';
import { deriveCurrentClaims } from './claim-write.js';
import type { HoleClaims, PerHoleMoney } from '../engine/games/types.js';
import { f1MoneyEnabled } from '../lib/env.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A foursome that could not be settled (per-foursome isolation, AC11). */
export type UnsettleableFoursome = {
  foursomeNumber: number;
  /** Machine reason, e.g. 'not_pinned' / 'missing_handicap' / 'corrupt_pin'. */
  reason: string;
  /** Human detail for the "Calculation paused — unsettleable: …" surface. */
  detail: string;
};

export type F1EventEdgesResult = {
  /** Whether the event is an F1 event (event-level game_config row exists). */
  isF1: boolean;
  /** The event-level lock_state ('locked' | 'unlocked'), null when not F1. */
  lockState: 'locked' | 'unlocked' | null;
  /** Settlement edges (sourceType 'f1_game') across every settleable foursome. */
  edges: SettlementEdge[];
  /** Foursomes that could not settle (surfaced; never block the rest). */
  unsettleable: UnsettleableFoursome[];
};

/**
 * Is this event an F1 event? — i.e. does an event-level `game_config` row exist
 * (Story 1.3 classification, pattern 14). This is the dual-read ROUTING key
 * (independent of the money-exposure flag).
 */
export async function isF1Event(
  txOrDb: Tx | Db,
  eventId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await txOrDb
    .select({ id: gameConfig.id })
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'event'),
        eq(gameConfig.refId, eventId),
        eq(gameConfig.tenantId, tenantId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Parsed shape of a round_pin row's JSON columns. */
type ParsedPin = {
  config: GameConfig;
  /** { hi, ch } per player; `ch: null` = absent handicap (fail-closed on read). */
  perPlayerHandicaps: Record<string, { hi: number | null; ch: number | null }>;
  courseRevisionId: string;
  tee: string;
};

/** Parse a round_pin row's JSON fail-closed (corrupt → null). */
function parsePin(row: {
  resolvedConfigJson: string;
  perPlayerHandicapsJson: string;
  courseRevisionId: string;
  tee: string;
}): ParsedPin | null {
  let rawConfig: unknown;
  let rawHcp: unknown;
  try {
    rawConfig = JSON.parse(row.resolvedConfigJson);
    rawHcp = JSON.parse(row.perPlayerHandicapsJson);
  } catch {
    return null;
  }
  const cfg = parseGameConfig(rawConfig);
  if (!cfg.ok) return null;
  const hcp = perPlayerHandicapsSchema.safeParse(rawHcp);
  if (!hcp.success) return null;
  return {
    config: cfg.config,
    perPlayerHandicaps: hcp.data,
    courseRevisionId: row.courseRevisionId,
    tee: row.tee,
  };
}

/**
 * Compute the F1 `f1_game` SettlementEdges for one event, across every round +
 * foursome, settling each foursome ONLY from its pinned inputs. Fail-closed per
 * foursome. The `sourceId` of each edge is `${roundId}:${foursomeNumber}` so the
 * dual-read disjointness test can attribute every edge to its producer.
 *
 * Read-only; tenant-scoped on every query. Never throws on bad foursome data.
 */
export async function computeF1EventEdges(
  txOrDb: Tx | Db,
  eventId: string,
  tenantId: string,
): Promise<F1EventEdgesResult> {
  // ── (0) Event-level classification + lock state (the routing key). ──
  const eventCfgRows = await txOrDb
    .select({ configJson: gameConfig.configJson, lockState: gameConfig.lockState })
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'event'),
        eq(gameConfig.refId, eventId),
        eq(gameConfig.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (eventCfgRows.length === 0) {
    return { isF1: false, lockState: null, edges: [], unsettleable: [] };
  }
  const lockState =
    eventCfgRows[0]!.lockState === 'locked' || eventCfgRows[0]!.lockState === 'unlocked'
      ? (eventCfgRows[0]!.lockState as 'locked' | 'unlocked')
      : 'locked';

  const edges: SettlementEdge[] = [];
  const unsettleable: UnsettleableFoursome[] = [];

  // ── (1) All event rounds (their pinned course-rev gives stroke index/par). ──
  const eventRoundRows = await txOrDb
    .select({ id: eventRounds.id, holesToPlay: eventRounds.holesToPlay })
    .from(eventRounds)
    .where(and(eq(eventRounds.eventId, eventId), eq(eventRounds.tenantId, tenantId)));

  for (const er of eventRoundRows) {
    // Deterministic runtime-round pick (same ordering as money.ts / money-detail).
    const runtimeRoundRows = await txOrDb
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(eq(rounds.eventRoundId, er.id), eq(rounds.tenantId, tenantId)))
      .orderBy(asc(rounds.createdAt), asc(rounds.id))
      .limit(1);
    if (runtimeRoundRows.length === 0) continue; // round not started → nothing to settle
    const roundId = runtimeRoundRows[0]!.id;

    // The pin (Story 1.2). Settlement reads ONLY the pin — never live config/HI.
    const pinRows = await txOrDb
      .select({
        resolvedConfigJson: roundPins.resolvedConfigJson,
        perPlayerHandicapsJson: roundPins.perPlayerHandicapsJson,
        courseRevisionId: roundPins.courseRevisionId,
        tee: roundPins.tee,
      })
      .from(roundPins)
      .where(and(eq(roundPins.roundId, roundId), eq(roundPins.tenantId, tenantId)))
      .limit(1);

    // Pairings (foursomes) for this round.
    const pairingRows = await txOrDb
      .select({ id: pairings.id, foursomeNumber: pairings.foursomeNumber })
      .from(pairings)
      .where(and(eq(pairings.eventRoundId, er.id), eq(pairings.tenantId, tenantId)))
      .orderBy(asc(pairings.foursomeNumber));

    // No pin on a started F1 round → EVERY foursome of it is fail-closed (AC5):
    // F1 is enabled at setup before rounds start, so a started-but-unpinned round
    // is an anomaly (e.g. F1 enabled after start). Never settle against live data.
    if (pinRows.length === 0) {
      for (const p of pairingRows) {
        unsettleable.push({
          foursomeNumber: p.foursomeNumber,
          reason: 'not_pinned',
          detail: 'round not pinned at start',
        });
      }
      continue;
    }
    const pin = parsePin(pinRows[0]!);
    if (!pin) {
      for (const p of pairingRows) {
        unsettleable.push({
          foursomeNumber: p.foursomeNumber,
          reason: 'corrupt_pin',
          detail: 'round pin is corrupt or incomplete',
        });
      }
      continue;
    }

    // Course holes from the PINNED course revision (stroke index + par + count).
    const holeRows = await txOrDb
      .select({ holeNumber: courseHoles.holeNumber, par: courseHoles.par, si: courseHoles.si })
      .from(courseHoles)
      .where(
        and(
          eq(courseHoles.courseRevisionId, pin.courseRevisionId),
          eq(courseHoles.tenantId, tenantId),
        ),
      )
      .orderBy(asc(courseHoles.holeNumber));
    // Respect holes_to_play (9 vs 18), matching money.ts.
    const holesInPlay = holeRows.filter((h) => h.holeNumber <= er.holesToPlay);
    const siByHole = new Map(holesInPlay.map((h) => [h.holeNumber, h.si]));
    const parByHole = new Map(holesInPlay.map((h) => [h.holeNumber, h.par]));

    if (holesInPlay.length === 0) {
      // Pinned course-rev has no holes for this round → unsettleable, not a crash.
      for (const p of pairingRows) {
        unsettleable.push({
          foursomeNumber: p.foursomeNumber,
          reason: 'no_course_data',
          detail: 'pinned course revision has no holes',
        });
      }
      continue;
    }

    for (const pairing of pairingRows) {
      // Per-foursome blast-radius isolation (AC11): a thrown error settling one
      // foursome (allocation throw, engine throw, or an unexpected query error)
      // must mark ONLY that foursome unsettleable and let every other foursome +
      // bets/skins still compute. The event money compute NEVER wholesale-crashes
      // on one bad foursome.
      let result: SettleFoursomeResult;
      try {
        result = await settleFoursome(
          txOrDb,
          {
            roundId,
            pairingId: pairing.id,
            foursomeNumber: pairing.foursomeNumber,
            pin,
            siByHole,
            parByHole,
          },
          tenantId,
        );
      } catch (err) {
        result = {
          kind: 'unsettleable',
          reason: 'compute_error',
          detail: err instanceof Error ? err.message : 'foursome compute error',
        };
      }
      if (result.kind === 'unsettleable') {
        unsettleable.push({
          foursomeNumber: pairing.foursomeNumber,
          reason: result.reason,
          detail: result.detail,
        });
      } else {
        edges.push(...result.edges);
      }
    }
  }

  return { isF1: true, lockState, edges, unsettleable };
}

type SettleFoursomeArgs = {
  roundId: string;
  pairingId: string;
  foursomeNumber: number;
  pin: ParsedPin;
  siByHole: Map<number, number>;
  parByHole: Map<number, number>;
};

type SettleFoursomeResult =
  | { kind: 'ok'; edges: SettlementEdge[]; perHole: PerHoleMoney[] }
  | { kind: 'unsettleable'; reason: string; detail: string };

/**
 * Settle ONE foursome from its pinned inputs. Pure-of-recompute: derives per-hole
 * net from the pinned CH (`allocateStrokesFromCourseHandicap`) — never a live HI.
 */
async function settleFoursome(
  txOrDb: Tx | Db,
  args: SettleFoursomeArgs,
  tenantId: string,
): Promise<SettleFoursomeResult> {
  const { roundId, pairingId, foursomeNumber, pin, siByHole, parByHole } = args;

  // Team split from the organizer's slot order (slots 1&2 vs 3&4), never alpha.
  const memberRows = await txOrDb
    .select({ playerId: pairingMembers.playerId, slotNumber: pairingMembers.slotNumber })
    .from(pairingMembers)
    .where(
      and(eq(pairingMembers.pairingId, pairingId), eq(pairingMembers.tenantId, tenantId)),
    );
  const teams = resolveFoursomeTeams(memberRows);
  if (!teams) {
    return {
      kind: 'unsettleable',
      reason: 'bad_pairing',
      detail: 'foursome does not have four distinct players in distinct slots',
    };
  }
  const { teamA, teamB, ordered } = teams;
  const teamSplit: TeamSplit = { teamA: [teamA[0], teamA[1]], teamB: [teamB[0], teamB[1]] };

  // Every member must have an INTEGER pinned CH (fail-closed on missing/corrupt
  // handicap, AC11). A `null`/absent ch means the player had NO handicap at all at
  // pin-time; a non-integer ch is a corrupt pin. Either way that foursome is
  // unsettleable, NEVER silently settled. A finite integer 0 (legit scratch)
  // passes and settles normally.
  //
  // The `Number.isInteger` check is load-bearing for the off-the-low step below:
  // `applyAllowanceOffLow` rounds (`Math.round`) so it would otherwise SWALLOW a
  // corrupt non-integer CH into an integer and settle it — defeating the
  // corrupt-pin guard that `allocateStrokesFromCourseHandicap` (which throws on a
  // non-integer CH) used to enforce. Reject it here, before off-low.
  const chByPlayer = new Map<string, number>();
  for (const playerId of ordered) {
    const h = pin.perPlayerHandicaps[playerId];
    if (h === undefined || h.ch === null || !Number.isInteger(h.ch)) {
      return {
        kind: 'unsettleable',
        reason: 'missing_handicap',
        detail: `missing or non-integer handicap for player ${playerId}`,
      };
    }
    chByPlayer.set(playerId, h.ch);
  }

  // Apply the handicap allowance % (frozen in the pin's resolved config; absent
  // → 100), THEN play OFF THE LOW of this foursome: the lowest allowed CH plays
  // to scratch and everyone else allocates `allowedCH − foursomeLow` strokes.
  // This is the Pete Dye Guyan 2v2 money basis — NOT each player's full CH.
  const allowancePct = pin.config.handicapAllowancePct ?? 100;
  const { offLow: offLowByPlayer } = applyAllowanceOffLow(chByPlayer, allowancePct);

  // Scores for this foursome in this round.
  const scoreRows = await txOrDb
    .select({
      playerId: holeScores.playerId,
      holeNumber: holeScores.holeNumber,
      grossStrokes: holeScores.grossStrokes,
    })
    .from(holeScores)
    .where(
      and(
        eq(holeScores.roundId, roundId),
        inArray(holeScores.playerId, [...ordered]),
        eq(holeScores.tenantId, tenantId),
      ),
    );

  // Build per-hole NET per player from the PINNED CH + PINNED course stroke index.
  // net = gross − allocateStrokesFromCourseHandicap(pinnedCH, strokeIndex).
  // A hole missing a member's score is left incomplete; the engine's complete-cell
  // gate skips it (a partial round settles only its complete holes).
  //
  // Per-foursome fail-closed isolation (AC11): `allocateStrokesFromCourseHandicap`
  // THROWS on a non-integer CH or an out-of-range stroke index (corrupt pin /
  // course data). Wrap the net build AND the engine call so a throw marks ONLY
  // this foursome unsettleable — it can NEVER crash the event-wide compute or
  // blank the other foursomes / bets / skins.
  // Current claims for THIS foursome's players (Story 2.1) — derived from the
  // append-only hole_claim_writes log (latest-`set`-write-per-cell). Scoped to
  // the foursome's players (FR23 isolation); the engine never reads the DB.
  // Story 2.1 only POPULATES holeState.claims; the resolvers that consume them
  // (greenie/polie/sandie) ship in 2.2-2.4, so claims are INERT here.
  const claims = await deriveCurrentClaims(txOrDb, {
    roundId,
    tenantId,
    restrictToPlayerIds: [...ordered],
  });
  // playerId -> hole -> HoleClaims
  const claimsByPlayerHole = new Map<string, Map<number, HoleClaims>>();
  for (const cl of claims) {
    let byHole = claimsByPlayerHole.get(cl.playerId);
    if (byHole === undefined) {
      byHole = new Map<number, HoleClaims>();
      claimsByPlayerHole.set(cl.playerId, byHole);
    }
    const hc = byHole.get(cl.holeNumber) ?? {};
    hc[cl.claimType] = true;
    byHole.set(cl.holeNumber, hc);
  }

  try {
    const netByHole = new Map<number, Record<string, number>>();
    // GROSS per hole (Story 2.3) — sourced DIRECTLY from the scorer's entered
    // strokes, NOT reconstructed from net (net is relative/off-the-low and not
    // invertible). Read ONLY by the polie bogey-or-better gate; base game +
    // greenie ignore it (base-money-neutral).
    const grossByHole = new Map<number, Record<string, number>>();
    for (const s of scoreRows) {
      const si = siByHole.get(s.holeNumber);
      if (si === undefined) continue; // hole outside holes-in-play (e.g. >holesToPlay)
      const offLow = offLowByPlayer.get(s.playerId);
      if (offLow === undefined) continue; // not a settling member (guarded above)
      const strokes = allocateStrokesFromCourseHandicap(offLow, si);
      const net = s.grossStrokes - strokes;
      const cell = netByHole.get(s.holeNumber) ?? {};
      cell[s.playerId] = net;
      netByHole.set(s.holeNumber, cell);
      const grossCell = grossByHole.get(s.holeNumber) ?? {};
      grossCell[s.playerId] = s.grossStrokes;
      grossByHole.set(s.holeNumber, grossCell);
    }

    // DENSE holes (Story 2.2, AC8): emit a row for EVERY in-play hole — the
    // in-play set is exactly the keys of `siByHole` (the stroke-index map derived
    // from the pinned course revision filtered to holes_to_play, so 9-hole and
    // other partial formats are handled with no new definition). An unplayed or
    // partially-scored hole carries whatever net cells exist (possibly empty), so
    // it appears as a PRESENT-BUT-INCOMPLETE row. Two consumers rely on this:
    //   - base game: the complete-cell gate already skips incomplete holes, so
    //     base money is UNCHANGED vs the prior sparse (netByHole-only) build;
    //   - greenie fold (2.2): its barrier must SEE an unplayed-par-3 gap to defer
    //     later greenies rather than silently bridge the carry across it.
    const holes: HoleState[] = [];
    for (const holeNumber of siByHole.keys()) {
      const net = netByHole.get(holeNumber) ?? {};
      // Attach this hole's per-player claims (Story 2.1). Empty when none.
      const holeClaims: Record<string, HoleClaims> = {};
      for (const playerId of ordered) {
        const hc = claimsByPlayerHole.get(playerId)?.get(holeNumber);
        if (hc !== undefined) holeClaims[playerId] = hc;
      }
      const gross = grossByHole.get(holeNumber) ?? {};
      holes.push({ holeNumber, par: parByHole.get(holeNumber) ?? 0, net, gross, claims: holeClaims });
    }

    const foursomeInput: FoursomeInput = { teamSplit, holes };
    const ledger = computeFoursome(pin.config, foursomeInput);
    // ledgerToEdges lives INSIDE the try (Story 2.1a): its fail-closed
    // `asymmetric_2v2_ledger` guard must surface as a per-foursome unsettleable,
    // never an uncaught event-wide crash.
    const sourceId = `${roundId}:${foursomeNumber}`;
    // perHole (Story 3-3): the additive per-hole money decomposition computeFoursome
    // always populates. Carried alongside edges so the per-hole money surface
    // settles through the EXACT same pinned path as the round-level edges (the
    // existing caller computeF1EventEdges reads only `.edges` and ignores this).
    return {
      kind: 'ok',
      edges: ledgerToEdges(ledger, teamSplit, { sourceId }),
      perHole: ledger.perHole ?? [],
    };
  } catch (err) {
    // Allocation throws (corrupt CH / bad stroke index) OR the engine fails closed
    // on an unsupported/invalid resolved config or a structural anomaly (e.g.
    // duplicate hole, non-whole-dollar point value, asymmetric 2v2 ledger).
    // Surface it as unsettleable for THIS foursome — never crash the event-wide
    // compute.
    return {
      kind: 'unsettleable',
      reason: 'engine_error',
      detail: err instanceof Error ? err.message : 'engine error',
    };
  }
}

/**
 * Per-player F1 net cents across the whole event, derived from the F1 edges
 * (the SAME pinned settlement the money matrix uses). Positive = player is up.
 * Used by the My Money board's 2v2 "foursome" game for F1 events so it matches
 * the settled money exactly (no live-HI recompute). Returns an empty result for
 * non-F1 events.
 */
export async function computeF1PerPlayerNet(
  txOrDb: Tx | Db,
  eventId: string,
  tenantId: string,
): Promise<{ isF1: boolean; lockState: 'locked' | 'unlocked' | null; netByPlayer: Map<string, number> }> {
  const res = await computeF1EventEdges(txOrDb, eventId, tenantId);
  const netByPlayer = new Map<string, number>();
  for (const e of res.edges) {
    netByPlayer.set(e.toPlayerId, (netByPlayer.get(e.toPlayerId) ?? 0) + e.cents);
    netByPlayer.set(e.fromPlayerId, (netByPlayer.get(e.fromPlayerId) ?? 0) - e.cents);
  }
  return { isF1: res.isF1, lockState: res.lockState, netByPlayer };
}

/**
 * Per-hole F1 money for ONE player's foursome in ONE round (Story 3-3) — the
 * scorecard `moneyNet` source. Settles ONLY through the pinned chokepoint
 * (`settleFoursome` → `computeFoursome`), so the per-hole money can never diverge
 * from the round-level F1 settlement (`computeF1EventEdges`). Values are
 * PLAYER-SIGNED cents (positive = the player's team won that hole's money).
 *
 * The returned map has ONE entry per SETTLED hole (1:1 with the engine's per-hole
 * rows), INCLUDING an explicit `0` for a settled push; it OMITS unsettled /
 * not-yet-scored holes — so a consumer's `map.has(n)` distinguishes a settled
 * "$0" from "not settled" (the scorecard renders the former as $0, the latter as
 * "—"). Recompute-on-read from the PINNED inputs (AC2 money-safety invariant): a
 * later course/rating/HI edit cannot move a pinned round's per-hole money.
 *
 * Returns `null` (NOT an empty map, NOT zeros) when money must not be shown:
 *   - the event is not an F1 event;
 *   - money is not exposed (`!f1MoneyEnabled()` OR the event is `unlocked` —
 *     scores-only, mirroring the leaderboard/foursome-results exposure gate);
 *   - the round is missing / not pinned;
 *   - the player is not in any foursome of the round;
 *   - the player's foursome is unsettleable (fail-closed: missing/corrupt pin,
 *     missing handicap, engine throw).
 * Tenant-scoped on every query; never throws (mirrors the chokepoint isolation).
 */
export async function computeF1PerHoleMoneyForPlayer(
  txOrDb: Tx | Db,
  args: { roundId: string; playerId: string; tenantId: string },
): Promise<Map<number, number> | null> {
  const { roundId, playerId, tenantId } = args;

  // (1) Round → eventId + eventRoundId (tenant-scoped).
  const roundRows = await txOrDb
    .select({ eventId: rounds.eventId, eventRoundId: rounds.eventRoundId })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, tenantId)))
    .limit(1);
  if (roundRows.length === 0) return null;
  const { eventId, eventRoundId } = roundRows[0]!;
  if (eventId === null || eventRoundId === null) return null; // v1.5 standalone round

  // (2) Exposure gate — mirror the leaderboard/foursome-results: an F1 event in
  // LOCKED money mode + the env flag on. Otherwise scores-only → null.
  const eventCfgRows = await txOrDb
    .select({ lockState: gameConfig.lockState })
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'event'),
        eq(gameConfig.refId, eventId),
        eq(gameConfig.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (eventCfgRows.length === 0) return null; // not an F1 event
  const lockState = eventCfgRows[0]!.lockState === 'unlocked' ? 'unlocked' : 'locked';
  if (!f1MoneyEnabled() || lockState !== 'locked') return null;

  // (3) Event round → holesToPlay (in-play filter, 9 vs 18).
  const erRows = await txOrDb
    .select({ holesToPlay: eventRounds.holesToPlay })
    .from(eventRounds)
    .where(and(eq(eventRounds.id, eventRoundId), eq(eventRounds.tenantId, tenantId)))
    .limit(1);
  if (erRows.length === 0) return null;
  const holesToPlay = erRows[0]!.holesToPlay;

  // (4) The pin (settlement reads ONLY the pin). Missing/corrupt → fail-closed null.
  const pinRows = await txOrDb
    .select({
      resolvedConfigJson: roundPins.resolvedConfigJson,
      perPlayerHandicapsJson: roundPins.perPlayerHandicapsJson,
      courseRevisionId: roundPins.courseRevisionId,
      tee: roundPins.tee,
    })
    .from(roundPins)
    .where(and(eq(roundPins.roundId, roundId), eq(roundPins.tenantId, tenantId)))
    .limit(1);
  if (pinRows.length === 0) return null;
  const pin = parsePin(pinRows[0]!);
  if (!pin) return null;

  // (5) Course holes from the PINNED course revision → si/par maps (in-play only).
  const holeRows = await txOrDb
    .select({ holeNumber: courseHoles.holeNumber, par: courseHoles.par, si: courseHoles.si })
    .from(courseHoles)
    .where(
      and(
        eq(courseHoles.courseRevisionId, pin.courseRevisionId),
        eq(courseHoles.tenantId, tenantId),
      ),
    )
    .orderBy(asc(courseHoles.holeNumber));
  const holesInPlay = holeRows.filter((h) => h.holeNumber <= holesToPlay);
  if (holesInPlay.length === 0) return null;
  const siByHole = new Map(holesInPlay.map((h) => [h.holeNumber, h.si]));
  const parByHole = new Map(holesInPlay.map((h) => [h.holeNumber, h.par]));

  // (6) The player's foursome (pairing) in this event round.
  const pairingRows = await txOrDb
    .select({ id: pairings.id, foursomeNumber: pairings.foursomeNumber })
    .from(pairings)
    .innerJoin(pairingMembers, eq(pairingMembers.pairingId, pairings.id))
    .where(
      and(
        eq(pairings.eventRoundId, eventRoundId),
        eq(pairings.tenantId, tenantId),
        eq(pairingMembers.playerId, playerId),
        eq(pairingMembers.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (pairingRows.length === 0) return null; // player not in any foursome of the round
  const { id: pairingId, foursomeNumber } = pairingRows[0]!;

  // (7) Settle THIS foursome through the pinned chokepoint. settleFoursome never
  // throws on bad foursome data (returns unsettleable); the try is belt-and-braces.
  let result: SettleFoursomeResult;
  try {
    result = await settleFoursome(
      txOrDb,
      { roundId, pairingId, foursomeNumber, pin, siByHole, parByHole },
      tenantId,
    );
  } catch {
    return null;
  }
  if (result.kind !== 'ok') return null; // unsettleable foursome → fail-closed

  // (8) Player-signed per-hole map: one entry per settled hole (incl. explicit 0).
  const map = new Map<number, number>();
  for (const h of result.perHole) {
    const cents = h.perPlayerCents[playerId];
    if (cents !== undefined) map.set(h.holeNumber, cents);
  }
  return map;
}
