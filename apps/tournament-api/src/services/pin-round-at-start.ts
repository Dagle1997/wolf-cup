/**
 * pin-round-at-start.ts (Story 1.4, Task 2) — compute + write the F1 round pin
 * at the round's `in_progress` (start) transition.
 *
 * This is the ONLY place per-player course handicap (CH) is computed from a live
 * HI for an F1 round. It runs ONCE, at round-start, inside the start transaction,
 * and freezes the result into the immutable `round_pin` (Story 1.2). Every later
 * money/leaderboard READ derives net from the pinned CH — never recomputing CH
 * from a live HI (the money-safety invariant, AC2).
 *
 * Effective HI at pin-time (AC11): if the event's handicaps are H1-locked, the
 * locked-as-of-date snapshot index is used; otherwise the player's most-recent
 * stored manual index (the same overlay money.ts/leaderboard.ts use). A player
 * with NO handicap at all (absent — no HI/GHIN) is pinned with hi=null/ch=null
 * (NOT 0): the read path's fail-closed gate keys on the `null` ch and marks that
 * foursome `missing_handicap` (unsettleable), so an absent handicap is NEVER
 * silently settled as a scratch (a real HI of 0 IS a finite scratch and settles
 * normally). In practice F1 rosters carry handicaps; the no-handicap fail-closed
 * surface is the safety net.
 *
 * NON-F1 events: no pin is written (the caller skips this for non-F1 events), so
 * legacy behavior is unchanged.
 *
 * Fail-soft at start: pinning must NEVER block a round from starting. The caller
 * wraps this so a pin failure is logged but the round still starts; an F1 round
 * that ends up unpinned is fail-closed (unsettleable) on read, never settled
 * against live data.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  courseRevisions,
  courseTees,
  events,
  eventRounds,
  pairingMembers,
  pairings,
  players,
} from '../db/schema/index.js';
import { calcCourseHandicap } from './handicap.js';
import { buildTeeByPlayer } from './per-player-tee.js';
import { loadLockedHandicapsByEvent } from './event-handicap-overrides.js';
import { resolveEventGameConfig } from './resolve-game-config.js';
import { pinRound, type PerPlayerHandicaps } from './pin-round.js';
import { writeAudit, AUDIT_EVENT_TYPES, AUDIT_ENTITY_TYPES } from '../lib/audit-log.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type PinRoundAtStartInput = {
  roundId: string;
  eventRoundId: string;
  eventId: string;
  tenantId: string;
  createdAt: number;
  /** The acting organizer (audit attribution, AC14). */
  actorPlayerId: string;
};

export type PinRoundAtStartResult =
  | { ok: true; pinned: boolean }
  | { ok: false; reason: string };

/**
 * Compute the F1 round pin from live inputs (resolved event config + per-player
 * effective HI → CH + course-rev/tee) and write it. Composes inside the caller's
 * start transaction. Returns a result rather than throwing for a *config*
 * problem; only an unexpected error propagates (the route catches + logs it so
 * the round still starts).
 */
export async function pinRoundAtStart(
  tx: Tx | Db,
  input: PinRoundAtStartInput,
): Promise<PinRoundAtStartResult> {
  const { roundId, eventRoundId, eventId, tenantId, createdAt } = input;

  // ── (1) Resolve the EVENT-level config to freeze into the pin. ──
  // Resolve at event scope (the round/foursome rows don't exist for Epic 1;
  // resolveEventGameConfig validates the event-level row + returns the resolved
  // config). A non-F1 event surfaces no_event_level_config → caller shouldn't
  // have called us, but we treat it as a no-op-skip rather than an error.
  const resolved = await resolveEventGameConfig(tx, { eventId, tenantId });
  if (!resolved.ok) {
    return { ok: false, reason: `config:${resolved.reason}` };
  }
  const resolvedConfig = resolved.config;

  // ── (1b) Freeze the event's handicap allowance % into the pinned config. ──
  // The organizer sets this on the handicaps-lock screen → events.handicap_allowance_pct.
  // It is the SOURCE OF TRUTH (overrides any value carried in the event-level
  // game_config). Frozen here, the read path (settleFoursome) takes the % from the
  // immutable pin — a later edit to the event can never retroactively move money.
  // A null column leaves resolvedConfig untouched (engine treats absent as 100).
  const evtRows = await tx
    .select({ allowancePct: events.handicapAllowancePct })
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.tenantId, tenantId)))
    .limit(1);
  const eventAllowancePct = evtRows[0]?.allowancePct ?? null;
  // The events column is the ABSOLUTE source of truth: a valid value is frozen
  // in; a null OR corrupt/out-of-range value CLEARS any pct that may have been
  // carried in from the event-level game_config, so the engine default (100)
  // applies. Validating here (integer, within the config schema's [1,200] bound)
  // also guarantees we never freeze a value that would fail the pin's config
  // parse on read and poison the round into a permanent corrupt_pin.
  if (
    eventAllowancePct !== null &&
    Number.isInteger(eventAllowancePct) &&
    eventAllowancePct >= 1 &&
    eventAllowancePct <= 200
  ) {
    resolvedConfig.handicapAllowancePct = eventAllowancePct;
  } else {
    delete resolvedConfig.handicapAllowancePct;
  }

  // ── (2) Course revision + tee for this event round (the default tee). ──
  const erRows = await tx
    .select({ courseRevisionId: eventRounds.courseRevisionId, teeColor: eventRounds.teeColor })
    .from(eventRounds)
    .where(and(eq(eventRounds.id, eventRoundId), eq(eventRounds.tenantId, tenantId)))
    .limit(1);
  if (erRows.length === 0) return { ok: false, reason: 'event_round_not_found' };
  const { courseRevisionId, teeColor } = erRows[0]!;

  const teeRows = await tx
    .select({ slope: courseTees.slope, rating: courseTees.rating })
    .from(courseTees)
    .where(
      and(
        eq(courseTees.courseRevisionId, courseRevisionId),
        eq(courseTees.teeColor, teeColor),
        eq(courseTees.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (teeRows.length === 0) return { ok: false, reason: 'tee_not_found' };
  const revRows = await tx
    .select({ coursePar: courseRevisions.courseTotal })
    .from(courseRevisions)
    .where(and(eq(courseRevisions.id, courseRevisionId), eq(courseRevisions.tenantId, tenantId)))
    .limit(1);
  if (revRows.length === 0) return { ok: false, reason: 'course_revision_not_found' };
  const defaultTee = {
    slope: teeRows[0]!.slope,
    ratingTimes10: teeRows[0]!.rating,
    coursePar: revRows[0]!.coursePar,
  };

  // ── (3) Roster of this round's foursomes + effective HI per player. ──
  const pairingRows = await tx
    .select({ id: pairings.id })
    .from(pairings)
    .where(and(eq(pairings.eventRoundId, eventRoundId), eq(pairings.tenantId, tenantId)));
  if (pairingRows.length === 0) return { ok: false, reason: 'no_pairings' };
  const pairingIds = pairingRows.map((p) => p.id);

  const memberRows = await tx
    .select({ playerId: pairingMembers.playerId })
    .from(pairingMembers)
    .where(
      and(inArray(pairingMembers.pairingId, pairingIds), eq(pairingMembers.tenantId, tenantId)),
    );
  const playerIds = Array.from(new Set(memberRows.map((m) => m.playerId)));
  if (playerIds.length === 0) return { ok: false, reason: 'no_members' };

  // Live/manual HI per player, overlaid with the H1 locked snapshot if locked.
  const playerRows = await tx
    .select({ id: players.id, hi: players.manualHandicapIndex })
    .from(players)
    .where(and(inArray(players.id, playerIds), eq(players.tenantId, tenantId)));
  const hiByPlayer = new Map<string, number | null>();
  for (const p of playerRows) hiByPlayer.set(p.id, p.hi ?? null);
  const locked = await loadLockedHandicapsByEvent(tx, eventId, tenantId);
  for (const [playerId, hi] of locked) hiByPlayer.set(playerId, hi);

  // Per-player tee overrides (Judd-on-forward-tee). Empty map → default tee.
  const teeByPlayer = await buildTeeByPlayer(tx, roundId, tenantId);

  // ── (4) Compute CH per player ONCE from the effective HI + tee. ──
  const perPlayerHandicaps: PerPlayerHandicaps = {};
  for (const playerId of playerIds) {
    const hi = hiByPlayer.get(playerId) ?? null;
    const tee = teeByPlayer[playerId] ?? defaultTee;
    // A player with NO handicap at all (absent) is pinned hi=null/ch=null so the
    // read-path fail-closed gate can distinguish "absent" from "legit scratch
    // (HI 0)". An absent handicap makes that foursome unsettleable on read; it is
    // NEVER silently settled as a scratch (Story 1.4 fix). A real HI (including a
    // finite 0) computes a finite CH and settles normally.
    if (hi === null) {
      perPlayerHandicaps[playerId] = { hi: null, ch: null };
      continue;
    }
    let ch: number;
    try {
      ch = calcCourseHandicap({ handicapIndex: hi, ...tee });
    } catch {
      // Non-finite/non-positive tee data → fail the pin (the start path catches
      // and logs; the round still starts and is fail-closed on read).
      return { ok: false, reason: `ch_compute_failed:${playerId}` };
    }
    perPlayerHandicaps[playerId] = { hi, ch };
  }

  // ── (5) Write the immutable pin (atomic + idempotent under UNIQUE). ──
  const res = await pinRound(tx, {
    roundId,
    resolvedConfig,
    perPlayerHandicaps,
    courseRevisionId,
    tee: teeColor,
    seedRuleSetRevisionId: null,
    createdAt,
  });

  // Audit the money-affecting input ONLY when this call actually wrote the pin
  // (AC14) — a no-op re-pin (already pinned) is not a new money-affecting input.
  if (res.pinned) {
    await writeAudit(tx, {
      eventType: AUDIT_EVENT_TYPES.ROUND_PINNED,
      entityType: AUDIT_ENTITY_TYPES.ROUND_PIN,
      entityId: roundId,
      actorPlayerId: input.actorPlayerId,
      payload: {
        eventId,
        eventRoundId,
        courseRevisionId,
        tee: teeColor,
        resolvedConfig,
        perPlayerHandicaps,
      },
    });
  }

  return { ok: true, pinned: res.pinned };
}
