/**
 * T6-9 — Pinehurst hand-calc money fixture (engine-level).
 *
 * Composes compute2v2BestBall + computeIndividualBet + calcSkins per
 * round, aggregates per-pair money in cents, and asserts the resulting
 * matrix matches the fixture's hand-derived expected matrix.
 *
 * Pending-state pattern (per spec AC-3, AC-6):
 *   - Fixture starts unverified (`expected.verifiedBy: null`).
 *   - Suite is wrapped in describe.skip with reason in the suite title +
 *     a console.warn for CI log visibility.
 *   - When Josh fills in expected.* + sets verifiedBy + verifiedDate
 *     (YYYY-MM-DD), the suite auto-activates.
 *
 * No `vi.mock`, no DB, no I/O. Pure engine composition.
 */

import { describe, expect, test } from 'vitest';
import {
  compute2v2BestBall,
  type BestBall2v2Config,
  type Compute2v2BestBallInput,
  type HoleScoreInput,
  type HoleMetaInput,
} from '../formats/best-ball-2v2.js';
import {
  calcSkins,
  type CalcSkinsInput,
  type LastHoleUnclaimedResolution,
  type SkinsMode,
} from '../formats/skins.js';
import {
  computeIndividualBet,
  type ComputeIndividualBetInput,
  type IndividualBetType,
} from '../rules/individual-bets.js';
import fixture from './pinehurst-hand-calc.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Verification predicate (codex re-run finding #1: strict, total).
// ---------------------------------------------------------------------------

interface PendingExpected {
  verifiedBy: string | null;
  verifiedDate: string | null;
  matrixCents: Record<string, Record<string, number>> | null;
  totalsCents: Record<string, number> | null;
  skinsResults: unknown;
  betResults: unknown;
}

function isVerified(expected: PendingExpected): boolean {
  const v = expected.verifiedBy;
  const d = expected.verifiedDate;
  return (
    typeof v === 'string' &&
    v.trim().length > 0 &&
    typeof d === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(d)
  );
}

function assertFixtureExpectedShape(expected: PendingExpected): void {
  const required = ['matrixCents', 'totalsCents', 'skinsResults', 'betResults'] as const;
  for (const field of required) {
    if (expected[field] === null || expected[field] === undefined) {
      throw new Error(
        `T6-9 fixture verifiedBy is set but expected.${field} is null/undefined; complete the hand-calc before activating the gate.`,
      );
    }
  }
  // Defense-in-depth with isVerified.
  if (typeof expected.verifiedBy !== 'string' || expected.verifiedBy.trim().length === 0) {
    throw new Error('T6-9 fixture: expected.verifiedBy must be a non-empty string.');
  }
  if (typeof expected.verifiedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expected.verifiedDate)) {
    throw new Error('T6-9 fixture: expected.verifiedDate must be YYYY-MM-DD.');
  }
}

// ---------------------------------------------------------------------------
// describe wiring — describe.skip with reason in suite title + console.warn.
// ---------------------------------------------------------------------------

const verified = isVerified(fixture.expected as PendingExpected);
const suiteTitle = verified
  ? 'T6-9 Pinehurst hand-calc money fixture (engine-level)'
  : 'T6-9 Pinehurst hand-calc money fixture (engine-level) [SKIPPED — AWAITING JOSH HAND-CALC VERIFICATION; fill in fixture.expected.* and set verifiedBy + verifiedDate (YYYY-MM-DD)]';
const describeFn = verified ? describe : describe.skip;

// Deliberate exception to "no module-scope side effects": the console.warn
// IS the discovery mechanism (AC-6) — must fire even though the suite is
// skipped, because skipped suite titles are easy to miss in CI scrollback.
// Pure log; touches no DB / global state / module registry. This is the
// ONLY allowed side effect at module scope.
if (!verified) {
  // eslint-disable-next-line no-console
  console.warn(
    '[T6-9] Pinehurst hand-calc fixture is UNVERIFIED; release-gate engine test is SKIPPED. See _bmad-output/implementation-artifacts/tournament/T6-9-hand-calc-money-fixture-http-roundtrip-test.md',
  );
}

describeFn(suiteTitle, () => {
  // All side-effectful setup lives inside the describe block (codex re-run
  // finding #2). Module scope only does `import fixture` + isVerified eval.

  test('engine matrix matches hand-calculated expected (integer-cents, anti-symmetric, zero-sum)', () => {
    assertFixtureExpectedShape(fixture.expected as PendingExpected);

    const expected = fixture.expected as PendingExpected;
    const playerIds = fixture.players.map((p) => p.id);
    const handicapIndexByPlayer: Record<string, number> = Object.fromEntries(
      fixture.players.map((p) => [p.id, p.handicapIndex]),
    );

    // ── Aggregate per-pair money across all 4 rounds ────────────────────
    const pairLedger: Record<string, Record<string, number>> = {};
    for (const a of playerIds) {
      pairLedger[a] = {};
      for (const b of playerIds) {
        if (a !== b) pairLedger[a][b] = 0;
      }
    }

    function bumpPair(winner: string, loser: string, cents: number): void {
      pairLedger[winner]![loser]! += cents;
      pairLedger[loser]![winner]! -= cents;
    }

    // ── (1) Per-round 2v2 best-ball ────────────────────────────────────
    for (const round of fixture.rounds) {
      const input: Compute2v2BestBallInput = {
        holeScores: round.holeScores as HoleScoreInput[],
        holeMeta: round.holeMeta as HoleMetaInput[],
        pairings: {
          teamA: round.pairings.teamA as [string, string],
          teamB: round.pairings.teamB as [string, string],
        },
        config: fixture.bestBallConfig as BestBall2v2Config,
        course: fixture.course as Compute2v2BestBallInput['course'],
        handicapIndexByPlayer,
      };
      const out = compute2v2BestBall(input);
      // Merge per-pair into ledger.
      for (const [a, byB] of Object.entries(out.perPair)) {
        for (const [b, cents] of Object.entries(byB)) {
          if (cents > 0) {
            // perPair already anti-symmetric; just additively accumulate
            // half (winner perspective) to avoid double-counting.
            pairLedger[a]![b]! += cents;
            pairLedger[b]![a]! -= cents;
          }
        }
      }
    }

    // ── (2) Skins per round (gross mode, even split among 4 players) ───
    for (const round of fixture.rounds) {
      const holeScoresMap = new Map<string, number | null>();
      for (const s of round.holeScores) {
        holeScoresMap.set(`${s.playerId}|${s.holeNumber}`, s.grossStrokes);
      }
      const skinsInput: CalcSkinsInput = {
        holeScores: holeScoresMap,
        mode: fixture.skinsConfig.mode as SkinsMode,
        participants: playerIds,
        buyInPerParticipantCents: fixture.skinsConfig.buyInPerParticipantCents,
        lastHoleUnclaimedResolution: fixture.skinsConfig
          .lastHoleUnclaimedResolution as LastHoleUnclaimedResolution,
        course: fixture.course as CalcSkinsInput['course'],
        handicapsByPlayer: handicapIndexByPlayer,
      };
      const skinsOut = calcSkins(skinsInput);

      // Each player paid 500 buy-in. Net = potShare − buyIn. Pairwise:
      // for each pair (a, b), a's gain over b = trunc((potA - potB) / N).
      //
      // IMPORTANT — this MUST mirror services/money.ts's skins attribution
      // (T6-5a). If you regenerate the production aggregation rule, update
      // here AND in services/money.ts together. Math.trunc is chosen
      // because trunc(-x) === -trunc(x) for integers, preserving
      // anti-symmetry of the pair matrix. Remainder cents from
      // non-divisible (potA−potB) splits are NOT distributed in v1
      // (followup T6-5h) — Josh's hand-calc must also drop the remainder
      // for the matrix to match. Codex re-run #3 medium acknowledged.
      const N = playerIds.length;
      const potByPlayer: Record<string, number> = Object.fromEntries(
        playerIds.map((p) => [p, 0]),
      );
      for (const share of skinsOut.potShares) {
        if (share.playerId !== null) {
          potByPlayer[share.playerId] = (potByPlayer[share.playerId] ?? 0) + share.dollarsCents;
        }
      }
      for (let i = 0; i < playerIds.length; i++) {
        for (let j = i + 1; j < playerIds.length; j++) {
          const a = playerIds[i]!;
          const b = playerIds[j]!;
          const delta = Math.trunc((potByPlayer[a]! - potByPlayer[b]!) / N);
          if (delta !== 0) {
            pairLedger[a]![b]! += delta;
            pairLedger[b]![a]! -= delta;
          }
        }
      }
    }

    // ── (3) Individual bets ────────────────────────────────────────────
    for (const bet of fixture.bets) {
      const applicable = bet.applicableRounds.map((rn) => {
        // For the engine, eventRoundId === roundId in the fixture (1:1 mapping).
        const id = `R${rn}`;
        return {
          roundId: id,
          eventRoundId: id,
          course: fixture.course as ComputeIndividualBetInput['applicableRounds'][number]['course'],
        };
      });
      const holeScoresByCell = new Map<string, { grossStrokes: number; putts: number | null }>();
      for (const round of fixture.rounds) {
        const id = `R${round.roundNumber}`;
        for (const s of round.holeScores) {
          if (s.playerId === bet.playerAId || s.playerId === bet.playerBId) {
            holeScoresByCell.set(`${id}|${s.playerId}|${s.holeNumber}`, {
              grossStrokes: s.grossStrokes,
              putts: s.putts ?? null,
            });
          }
        }
      }
      const betInput: ComputeIndividualBetInput = {
        bet: {
          id: bet.id,
          playerAId: bet.playerAId,
          playerBId: bet.playerBId,
          betType: bet.betType as IndividualBetType,
          stakePerHoleCents: bet.stakePerHoleCents,
          config: bet.config as ComputeIndividualBetInput['bet']['config'],
        },
        applicableRounds: applicable,
        holeScoresByCell,
        pressesByRound: {},
        handicapIndexByPlayer,
      };
      const out = computeIndividualBet(betInput);
      const netToA = out.netToPlayerACents;
      if (netToA !== 0) {
        if (netToA > 0) bumpPair(bet.playerAId, bet.playerBId, netToA);
        else bumpPair(bet.playerBId, bet.playerAId, -netToA);
      }
    }

    // ── (4) Assert anti-symmetry, zero-sum, and equality vs hand-calc ──
    for (const a of playerIds) {
      for (const b of playerIds) {
        if (a !== b) {
          expect(pairLedger[a]![b]).toBe(-(pairLedger[b]![a] ?? 0));
        }
      }
    }
    const totals: Record<string, number> = {};
    for (const a of playerIds) {
      let sum = 0;
      for (const b of playerIds) {
        if (a !== b) sum += pairLedger[a]![b] ?? 0;
      }
      totals[a] = sum;
    }
    const totalSum = Object.values(totals).reduce((s, v) => s + v, 0);
    expect(totalSum).toBe(0);

    // Strict equality vs hand-calc (deep structural; codex re-run finding #3).
    expect(pairLedger).toEqual(expected.matrixCents);
    expect(totals).toEqual(expected.totalsCents);
  });
});
