/**
 * T6-11 Skins engine — 3 modes, integer-cents, golden-file tested.
 *
 * Modes:
 *   - 'gross': low gross strokes wins each hole's skin.
 *   - 'net': low net (gross − getHandicapStrokes) wins.
 *   - 'gross_beats_net': unique low gross wins; if gross is tied, fall through
 *     to unique low net; if net also tied → carry. Per Josh's interpretation.
 *
 * Tie behavior: tied holes carry their skin value to the next hole.
 *
 * Last-hole unclaimed resolution:
 *   - 'split-among-winners': split remaining pot equally among players who
 *     won at least one skin this round; integer-cent remainder attributed
 *     to the earliest-hole-winning player.
 *   - 'carry-to-next-round': mark with { playerId: null } sentinel for the
 *     dispatcher (T6-13) to consume at next round's open.
 *
 * Integer-cents discipline:
 *   - basePerHoleSkinValue = floor(totalPotCents / 18); remainder cents
 *     accrue holewise and are attributed to the FIRST skin winner of the
 *     round (deterministic; no float drift).
 *   - All pot shares are integer cents.
 *
 * No DB, no I/O, no env, no clock, no crypto, no input mutation.
 */

import {
  calcCourseHandicap,
  allocateStrokesFromCourseHandicap,
  type TeeShape,
} from '../handicap-strokes.js';

export type SkinsMode = 'gross' | 'net' | 'gross_beats_net';
export type LastHoleUnclaimedResolution =
  | 'split-among-winners'
  | 'carry-to-next-round';

export type HoleShape = {
  holeNumber: number;
  par: 3 | 4 | 5;
  strokeIndex: number;
};

export type CourseShape = { tee: TeeShape; holes: HoleShape[] };

/** Key: `${playerId}|${holeNumber}` → grossStrokes (or null = unscored). */
export type HoleScoresByPlayer = Map<string, number | null>;

export type CalcSkinsInput = {
  holeScores: HoleScoresByPlayer;
  mode: SkinsMode;
  participants: string[];
  buyInPerParticipantCents: number;
  lastHoleUnclaimedResolution: LastHoleUnclaimedResolution;
  course: CourseShape;
  handicapsByPlayer: Record<string, number>;
  /**
   * Per-player tee override (mirrors compute2v2BestBall). Only consulted
   * for `net` and `gross_beats_net` modes — `gross` mode never calls
   * getHandicapStrokes. Missing keys (or undefined map) fall back to
   * `course.tee`. Backwards compatible with existing callers that don't
   * pass this field.
   */
  teeByPlayer?: Record<string, TeeShape>;
  /**
   * Handicap allowance percentage applied to each player's full course handicap
   * before stroke allocation: strokes = allocate(round(fullCH × pct/100), si).
   * NO off-the-low (that is the 2v2 game's basis). Absent/undefined → 100 (no
   * reduction), so existing callers + goldens stay byte-identical. Only matters
   * for `net` / `gross_beats_net` modes (gross-mode skins ignores handicaps).
   */
  handicapAllowancePct?: number;
};

export type HoleWinnerResult = {
  hole: number;
  winnerId: string | null;
  carriedFromHoles: number[];
  skinValueCents: number;
};

export type CarryRecord = {
  fromHole: number;
  toHole: number;
  valueCents: number;
};

export type PotShare = {
  playerId: string | null;  // null = carry-to-next-round sentinel
  dollarsCents: number;
  note?: 'carried_to_next_round';
};

export type CalcSkinsOutput = {
  holeWinners: HoleWinnerResult[];
  carries: CarryRecord[];
  potShares: PotShare[];
  totalPotCents: number;
  remainderAttribution?: { playerId: string; remainderCents: number };
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const MODES: ReadonlySet<SkinsMode> = new Set(['gross', 'net', 'gross_beats_net']);
const RESOLUTIONS: ReadonlySet<LastHoleUnclaimedResolution> = new Set([
  'split-among-winners',
  'carry-to-next-round',
]);

function assertNonNegativeInteger(name: string, n: number): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`${name} must be non-negative integer (got ${n})`);
  }
}

// ---------------------------------------------------------------------------
// Per-hole winner determination
// ---------------------------------------------------------------------------

interface ScoredEntry {
  playerId: string;
  gross: number;
  net: number;
}

function uniqueLowestBy(
  entries: ScoredEntry[],
  fieldGetter: (e: ScoredEntry) => number,
): string | null {
  if (entries.length === 0) return null;
  let lowest = Infinity;
  let winner: string | null = null;
  let isUnique = true;
  for (const e of entries) {
    const v = fieldGetter(e);
    if (v < lowest) {
      lowest = v;
      winner = e.playerId;
      isUnique = true;
    } else if (v === lowest) {
      isUnique = false;
    }
  }
  return isUnique ? winner : null;
}

function determineHoleWinner(
  scoredEntries: ScoredEntry[],
  mode: SkinsMode,
): string | null {
  if (scoredEntries.length === 0) return null;
  if (mode === 'gross') {
    return uniqueLowestBy(scoredEntries, (e) => e.gross);
  }
  if (mode === 'net') {
    return uniqueLowestBy(scoredEntries, (e) => e.net);
  }
  // 'gross_beats_net': unique gross wins; else fall through to unique net.
  const grossWinner = uniqueLowestBy(scoredEntries, (e) => e.gross);
  if (grossWinner !== null) return grossWinner;
  return uniqueLowestBy(scoredEntries, (e) => e.net);
}

// ---------------------------------------------------------------------------
// calcSkins — main entry
// ---------------------------------------------------------------------------

export function calcSkins(input: CalcSkinsInput): CalcSkinsOutput {
  const {
    holeScores,
    mode,
    participants,
    buyInPerParticipantCents,
    lastHoleUnclaimedResolution,
    course,
    handicapsByPlayer,
    teeByPlayer,
    handicapAllowancePct,
  } = input;
  const allowancePct = handicapAllowancePct ?? 100;

  // Boundary validation.
  if (!MODES.has(mode)) {
    throw new RangeError(`mode must be in enum (got ${String(mode)})`);
  }
  if (!RESOLUTIONS.has(lastHoleUnclaimedResolution)) {
    throw new RangeError(
      `lastHoleUnclaimedResolution must be in enum (got ${String(lastHoleUnclaimedResolution)})`,
    );
  }
  assertNonNegativeInteger('buyInPerParticipantCents', buyInPerParticipantCents);
  if (participants.length === 0) {
    return {
      holeWinners: [],
      carries: [],
      potShares: [],
      totalPotCents: 0,
    };
  }
  for (const pid of participants) {
    if (handicapsByPlayer[pid] === undefined) {
      throw new Error(`calcSkins: missing handicap for participant ${pid}`);
    }
  }

  const totalPotCents = buyInPerParticipantCents * participants.length;
  const holesPlayed = course.holes.length;
  const basePerHole = Math.floor(totalPotCents / holesPlayed);
  // Remainder cents accrue across holes (added to first skin winner of the round).
  const remainderCents = totalPotCents - basePerHole * holesPlayed;

  const holeWinners: HoleWinnerResult[] = [];
  const carries: CarryRecord[] = [];

  // Walk holes in course order.
  let carryValue = 0;       // accumulated carry from prior tied holes
  const carriedFromHoles: number[] = [];

  for (const hole of course.holes) {
    // Compute scored entries for this hole.
    const scoredEntries: ScoredEntry[] = [];
    for (const pid of participants) {
      const gross = holeScores.get(`${pid}|${hole.holeNumber}`);
      if (gross === undefined || gross === null) continue;
      // Full course handicap → apply the allowance % (round half-up) → allocate
      // per hole. At 100% this equals the prior getHandicapStrokes(hi, si, tee).
      const tee = teeByPlayer?.[pid] ?? course.tee;
      const fullCh = calcCourseHandicap({ handicapIndex: handicapsByPlayer[pid] ?? 0, ...tee });
      const allowedCh = Math.round((fullCh * allowancePct) / 100);
      const strokes = allocateStrokesFromCourseHandicap(allowedCh, hole.strokeIndex);
      const net = gross - strokes;
      scoredEntries.push({ playerId: pid, gross, net });
    }

    const winner = determineHoleWinner(scoredEntries, mode);
    const skinValueCents = basePerHole + carryValue;

    if (winner !== null) {
      holeWinners.push({
        hole: hole.holeNumber,
        winnerId: winner,
        carriedFromHoles: [...carriedFromHoles],
        skinValueCents,
      });
      carryValue = 0;
      carriedFromHoles.length = 0;
    } else {
      // Tied or no eligible scorers — push null winner; carry forward.
      holeWinners.push({
        hole: hole.holeNumber,
        winnerId: null,
        carriedFromHoles: [...carriedFromHoles],
        skinValueCents,
      });
      carryValue += basePerHole;
      carriedFromHoles.push(hole.holeNumber);
    }
  }

  // Track inter-hole carries for output.
  for (let i = 0; i < holeWinners.length; i++) {
    const hw = holeWinners[i]!;
    if (hw.winnerId === null && i + 1 < holeWinners.length) {
      carries.push({
        fromHole: hw.hole,
        toHole: holeWinners[i + 1]!.hole,
        valueCents: basePerHole,
      });
    }
  }

  // Aggregate pot shares.
  const wonByPlayer = new Map<string, number>();
  let firstWinnerId: string | null = null;
  let firstWinnerHole: number = Infinity;
  let totalAwarded = 0;
  for (const hw of holeWinners) {
    if (hw.winnerId !== null) {
      const prior = wonByPlayer.get(hw.winnerId) ?? 0;
      wonByPlayer.set(hw.winnerId, prior + hw.skinValueCents);
      totalAwarded += hw.skinValueCents;
      if (hw.hole < firstWinnerHole) {
        firstWinnerHole = hw.hole;
        firstWinnerId = hw.winnerId;
      }
    }
  }

  // Apply per-hole-base remainder to first winner (deterministic rule).
  let remainderAttribution: CalcSkinsOutput['remainderAttribution'];
  if (remainderCents > 0 && firstWinnerId !== null) {
    wonByPlayer.set(
      firstWinnerId,
      (wonByPlayer.get(firstWinnerId) ?? 0) + remainderCents,
    );
    totalAwarded += remainderCents;
    remainderAttribution = { playerId: firstWinnerId, remainderCents };
  }

  // Handle last-hole unclaimed pot.
  const unclaimedAfterRound = totalPotCents - totalAwarded;
  if (unclaimedAfterRound > 0) {
    if (lastHoleUnclaimedResolution === 'carry-to-next-round') {
      // Add a sentinel pot share.
      const potShares: PotShare[] = Array.from(wonByPlayer.entries()).map(
        ([playerId, dollarsCents]) => ({ playerId, dollarsCents }),
      );
      potShares.push({
        playerId: null,
        dollarsCents: unclaimedAfterRound,
        note: 'carried_to_next_round',
      });
      return { holeWinners, carries, potShares, totalPotCents, ...(remainderAttribution ? { remainderAttribution } : {}) };
    }
    // 'split-among-winners': divide unclaimed equally among winners; remainder
    // to the earliest-hole winner. If zero winners, split equally among ALL
    // participants.
    if (wonByPlayer.size > 0) {
      const winnerIds = Array.from(wonByPlayer.keys());
      const splitShare = Math.floor(unclaimedAfterRound / winnerIds.length);
      const splitRemainder = unclaimedAfterRound - splitShare * winnerIds.length;
      for (const wid of winnerIds) {
        wonByPlayer.set(wid, (wonByPlayer.get(wid) ?? 0) + splitShare);
      }
      if (splitRemainder > 0 && firstWinnerId !== null) {
        wonByPlayer.set(
          firstWinnerId,
          (wonByPlayer.get(firstWinnerId) ?? 0) + splitRemainder,
        );
      }
    } else {
      // No winners at all — split equally among all participants.
      const splitShare = Math.floor(unclaimedAfterRound / participants.length);
      const splitRemainder =
        unclaimedAfterRound - splitShare * participants.length;
      for (const pid of participants) {
        wonByPlayer.set(pid, (wonByPlayer.get(pid) ?? 0) + splitShare);
      }
      if (splitRemainder > 0) {
        // Deterministic: attribute to the alphabetically-first participant.
        const sorted = [...participants].sort();
        const firstPid = sorted[0]!;
        wonByPlayer.set(firstPid, (wonByPlayer.get(firstPid) ?? 0) + splitRemainder);
      }
    }
  }

  const potShares: PotShare[] = Array.from(wonByPlayer.entries()).map(
    ([playerId, dollarsCents]) => ({ playerId, dollarsCents }),
  );

  return {
    holeWinners,
    carries,
    potShares,
    totalPotCents,
    ...(remainderAttribution ? { remainderAttribution } : {}),
  };
}
