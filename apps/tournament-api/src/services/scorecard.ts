/**
 * scorecard.ts (Story 3-2) — pure read-side builder that assembles one
 * player's round into a per-hole scorecard for the during-round board
 * (Wolf-style HoleBadge/ScorecardGrid, Story 3-1; wired to a route in 3-4).
 *
 * Read-only. No writes, no schema. Reuses the canonical claim fold
 * (`deriveCurrentClaims`) and the canonical stroke-allocation kernel
 * (`allocateStrokesFromCourseHandicap`) so the scorecard's per-hole net can
 * never diverge from the money engine's net (both allocate from the PINNED
 * course handicap; reads never re-derive CH from a live HI).
 *
 * `moneyNet` is ALWAYS null here — per-hole F1 money is the Story 3-3 / Epic-4
 * seam. The builder never fabricates 0/$0; the 3-1 component renders null → "—".
 */
import { and, eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  courseHoles,
  eventRounds,
  holeScores,
  roundPins,
  rounds,
} from '../db/schema/index.js';
import { allocateStrokesFromCourseHandicap } from '../engine/handicap-strokes.js';
import { deriveCurrentClaims } from './claim-write.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * One hole on a player's scorecard. A hand-copied MIRROR of the tournament-web
 * `ScorecardHole` (apps/tournament-web/src/types/scorecard.ts) — NEVER a
 * cross-app import (FD-1/FD-2). The API always emits every field; the web type
 * marks several optional for the component's convenience, which accepts these
 * always-present values. `moneyNet` is always null in Story 3-2 (the 3-3 seam).
 */
export interface ScorecardHole {
  holeNumber: number;
  par: number;
  grossScore: number | null;
  netScore: number | null;
  relativeStrokes: number;
  hasGreenie: boolean;
  hasPolie: boolean;
  hasSandie: boolean;
  moneyNet: number | null;
}

/** Shape of one entry in round_pin.perPlayerHandicapsJson ({ [playerId]: { hi, ch } }). */
interface PerPlayerHandicap {
  hi: number | null;
  ch: number | null;
}

/**
 * Raised when the round/event-round/course data needed to build a scorecard is
 * missing or inconsistent (e.g. a course_holes row absent for an in-play hole).
 * The route maps this to a 500 — it is a server-side data error, never a
 * fabricated par/score.
 */
export class ScorecardDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScorecardDataError';
  }
}

/**
 * Build the per-hole scorecard for (round, player).
 *
 * Contract (Story 3-2 ACs):
 *  - One entry per in-play hole `1..holesToPlay` (9-hole = front nine; the
 *    schema has no front/back indicator). par/si from course_holes. (AC #2)
 *  - grossScore from hole_scores, else null (unplayed). (AC #3)
 *  - relativeStrokes allocated from the PINNED ch via the money engine's
 *    kernel; returned for every hole incl. unplayed. (AC #4)
 *  - netScore = gross − relativeStrokes for played holes; null when unplayed. (AC #5)
 *  - No pin / null ch ⇒ strokes unknown: relativeStrokes 0 AND netScore null
 *    (NOT net=gross), gross still shown. (AC #6)
 *  - hasGreenie/hasPolie/hasSandie from deriveCurrentClaims, always booleans. (AC #7)
 *  - moneyNet always null (3-3 seam). (AC #8)
 *
 * All reads are tenant-scoped. Caller (route) is responsible for auth + the
 * player-in-round check; this builder assumes the round exists (it throws
 * ScorecardDataError otherwise, which should not happen post-auth).
 */
export async function buildPlayerScorecard(
  dbOrTx: Db | Tx,
  args: { roundId: string; playerId: string; tenantId: string },
): Promise<ScorecardHole[]> {
  const { roundId, playerId, tenantId } = args;

  // Round → eventRoundId + holesToPlay (tenant-scoped).
  const roundRows = await dbOrTx
    .select({ eventRoundId: rounds.eventRoundId, holesToPlay: rounds.holesToPlay })
    .from(rounds)
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, tenantId)))
    .limit(1);
  const round = roundRows[0];
  if (round === undefined) {
    throw new ScorecardDataError(`round not found: ${roundId}`);
  }
  if (round.eventRoundId === null) {
    throw new ScorecardDataError(`round has no event_round (v1.5 standalone): ${roundId}`);
  }

  // event_round → courseRevisionId.
  const erRows = await dbOrTx
    .select({ courseRevisionId: eventRounds.courseRevisionId })
    .from(eventRounds)
    .where(and(eq(eventRounds.id, round.eventRoundId), eq(eventRounds.tenantId, tenantId)))
    .limit(1);
  const courseRevisionId = erRows[0]?.courseRevisionId;
  if (courseRevisionId === undefined) {
    throw new ScorecardDataError(`event_round not found: ${round.eventRoundId}`);
  }

  // course_holes (par, si) for the revision, tenant-scoped.
  const holeRows = await dbOrTx
    .select({ holeNumber: courseHoles.holeNumber, par: courseHoles.par, si: courseHoles.si })
    .from(courseHoles)
    .where(
      and(
        eq(courseHoles.courseRevisionId, courseRevisionId),
        eq(courseHoles.tenantId, tenantId),
      ),
    )
    .orderBy(courseHoles.holeNumber);
  const holeByNumber = new Map<number, { par: number; si: number }>();
  for (const h of holeRows) holeByNumber.set(h.holeNumber, { par: h.par, si: h.si });

  // hole_scores for this player → gross by hole (tenant-scoped).
  const scoreRows = await dbOrTx
    .select({ holeNumber: holeScores.holeNumber, grossStrokes: holeScores.grossStrokes })
    .from(holeScores)
    .where(
      and(
        eq(holeScores.roundId, roundId),
        eq(holeScores.tenantId, tenantId),
        eq(holeScores.playerId, playerId),
      ),
    );
  const grossByHole = new Map<number, number>();
  for (const s of scoreRows) grossByHole.set(s.holeNumber, s.grossStrokes);

  // Pinned course handicap for this player (may be absent / null → fail-closed).
  const pinRows = await dbOrTx
    .select({ perPlayerHandicapsJson: roundPins.perPlayerHandicapsJson })
    .from(roundPins)
    .where(and(eq(roundPins.roundId, roundId), eq(roundPins.tenantId, tenantId)))
    .limit(1);
  let pinnedCh: number | null = null;
  if (pinRows[0] !== undefined) {
    try {
      const parsed = JSON.parse(pinRows[0].perPlayerHandicapsJson) as Record<
        string,
        PerPlayerHandicap
      >;
      const entry = parsed[playerId];
      if (entry !== undefined && typeof entry.ch === 'number' && Number.isInteger(entry.ch)) {
        pinnedCh = entry.ch;
      }
    } catch {
      // Malformed pin JSON → fail-closed (strokes unknown, net null). Never throw.
      pinnedCh = null;
    }
  }
  const hasStrokes = pinnedCh !== null;

  // Current claims for this player (reuse the canonical append-only fold).
  const claims = await deriveCurrentClaims(dbOrTx, {
    roundId,
    tenantId,
    restrictToPlayerIds: [playerId],
  });
  const claimSet = new Set<string>();
  for (const cl of claims) claimSet.add(`${cl.holeNumber}|${cl.claimType}`);

  // Build holes 1..holesToPlay (9-hole rounds = front nine; the schema carries
  // no front/back / which-nine indicator — see events.ts holes_to_play comment).
  const holes: ScorecardHole[] = [];
  for (let n = 1; n <= round.holesToPlay; n++) {
    const courseHole = holeByNumber.get(n);
    if (courseHole === undefined) {
      // A missing course_holes row for an in-play hole is a data error, never a
      // fabricated par. (AC #2 / AC #10)
      throw new ScorecardDataError(
        `missing course_hole for in-play hole ${n} (revision ${courseRevisionId})`,
      );
    }
    const grossScore = grossByHole.get(n) ?? null;
    const relativeStrokes = hasStrokes
      ? allocateStrokesFromCourseHandicap(pinnedCh as number, courseHole.si)
      : 0;
    // No pin/ch ⇒ net unknown ⇒ null (NOT gross). Unplayed ⇒ null. (AC #5/#6)
    const netScore =
      !hasStrokes || grossScore === null ? null : grossScore - relativeStrokes;
    holes.push({
      holeNumber: n,
      par: courseHole.par,
      grossScore,
      netScore,
      relativeStrokes,
      hasGreenie: claimSet.has(`${n}|greenie`),
      hasPolie: claimSet.has(`${n}|polie`),
      hasSandie: claimSet.has(`${n}|sandie`),
      // Story 3-3 / Epic-4 seam: per-hole F1 money. NEVER fabricate 0/$0 here.
      moneyNet: null,
    });
  }
  return holes;
}
