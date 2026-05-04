/* global process */
// Deterministic Pinehurst hand-calc fixture generator (T6-9).
//
// Run:  node apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc-generator.mjs > apps/tournament-api/src/engine/__fixtures__/pinehurst-hand-calc.json
//
// Inputs are constants below — edit + re-run to regenerate. Scores are tuned
// to produce: ≥1 sandie, ≥1 greenie, ≥1 carry-greenie, ≥1 skin awarded,
// ≥1 skin tie-carry, ≥1 bet hole won/lost per round.
//
// Outputs a fixture JSON with `expected.verifiedBy: null` (pending Josh's
// hand-calc derivation).

const PARS = [4, 5, 4, 4, 5, 3, 4, 3, 4, 4, 5, 4, 4, 5, 3, 4, 3, 4]; // sum 72
const SI   = [5,11,1,9,13,17,3,15,7,6,12,2,10,14,18,4,16,8];

const COURSE = {
  tee: { slope: 113, ratingTimes10: 720, coursePar: 72 },
  holes: PARS.map((par, i) => ({ holeNumber: i + 1, par, strokeIndex: SI[i] })),
};

const PLAYERS = [
  { id: 'P1', name: 'Player 1 (scratch)',  handicapIndex: 0  },
  { id: 'P2', name: 'Player 2 (mid)',      handicapIndex: 8  },
  { id: 'P3', name: 'Player 3 (mid-high)', handicapIndex: 14 },
  { id: 'P4', name: 'Player 4 (high)',     handicapIndex: 22 },
];

// Pairings rotate. R4 revisits R1 (per spec).
const PAIRINGS = [
  { round: 1, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] },
  { round: 2, teamA: ['P1', 'P3'], teamB: ['P2', 'P4'] },
  { round: 3, teamA: ['P1', 'P4'], teamB: ['P2', 'P3'] },
  { round: 4, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] },
];

// Bet 1: P1 vs P4 across all 4 rounds. Bet 2: P2 vs P3 rounds 1+2 only.
// Both straight match-play, NO auto-press (per Josh 2026-05-04).
const BETS = [
  {
    id: 'BET1',
    playerAId: 'P1',
    playerBId: 'P4',
    betType: 'match_play_per_hole',
    stakePerHoleCents: 50,
    config: {},
    applicableRounds: [1, 2, 3, 4],
  },
  {
    id: 'BET2',
    playerAId: 'P2',
    playerBId: 'P3',
    betType: 'match_play_per_hole',
    stakePerHoleCents: 50,
    config: {},
    applicableRounds: [1, 2],
  },
];

// Best-ball config (tournament-wide; all 4 rounds use this).
//
// IMPORTANT — sandies + carry-greenies DISABLED (Followup T6-9d).
// Reason: production GET /money's services/money.ts builds engine input
// from hole_scores rows with no per-hole sandyFromBunker column and
// passes empty holeMeta (no CTP). Until that data flow is built (likely
// piggy-backing on T6-13's sub_games CTP/sandies sub-game types), the
// engine WOULD compute sandies/greenies from fixture flags but the HTTP
// roundtrip would NOT — producing divergence. Disabling here keeps the
// engine + HTTP outputs identical for hand-calc verification. Re-enable
// when production wires the data.
const BEST_BALL_CONFIG = {
  basePerHoleCents: 100,
  sandies: false,
  sandiesBonusPerHoleCents: 0,
  greenieCarryover: false,
  greenieValidation: 'none',
  greenieBaseCents: 0,
};

// Skins: gross mode, 500¢ per-player per-round buy-in.
const SKINS_CONFIG = {
  mode: 'gross',
  buyInPerParticipantCents: 500,
  lastHoleUnclaimedResolution: 'split-among-winners',
};

// ---------------------------------------------------------------------------
// Score generator — deterministic, tuned for plausibility + rule coverage.
// ---------------------------------------------------------------------------
// Per-player base offset from par per hole (negative = under, positive = over).
// 18 entries per row. Player skill profile:
//   P1 (0): mostly par/bogey, a few birdies sprinkled.
//   P2 (8): mostly bogey/double, a few pars, occasional birdie.
//   P3 (14): mostly bogey/double-bogey, pars rare.
//   P4 (22): mostly double-bogey/triple, occasional bogey.
//
// Per-round small permutation so identical patterns don't repeat across
// rounds; this also creates skin-tie-carries vs skin-wins variety.

const ROUND_OFFSETS = {
  // Round 1 — P1 hot start (birdies on holes 1, 6, 13), P2 steady, P3 wobbly,
  // P4 has bunker save on hole 4 (sandie), greenie chain seeded on hole 6.
  1: {
    P1: [-1, 0, 0, 0, 0,-1, 0, 0, 0, 0, 0, 0,-1, 0, 0, 0, 0, 0],
    P2: [ 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1],
    P3: [ 1, 2, 1, 2, 1, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 2],
    P4: [ 2, 1, 3, 0, 2, 2, 2, 1, 3, 2, 2, 2, 3, 2, 1, 2, 2, 3],
  },
  // Round 2 — P1 still solid, P3 birdies hole 3, P4 birdies the par 5 hole 11
  // (skin tie-break exercise), greenie hole 6 unclaimed (carries to hole 8).
  2: {
    P1: [ 0, 0, 0, 0, 0, 0, 0, 0,-1, 0, 0, 0, 0, 0, 0, 0,-1, 0],
    P2: [ 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1],
    P3: [ 1, 1,-1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 1, 1, 2, 1, 1, 2],
    P4: [ 2, 2, 2, 2, 2, 2, 2, 1,-1, 2, 0, 2, 2, 2, 2, 2, 2, 3],
  },
  // Round 3 — Multiple skin ties → carry chain. P2/P3 both birdie hole 13.
  // Sandie on hole 16 by P4 (up-and-down).
  3: {
    P1: [ 0, 0, 0, 0,-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    P2: [ 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1,-1, 1, 1, 1, 1, 1],
    P3: [ 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1, 2,-1, 1, 1, 1, 1, 2],
    P4: [ 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 1, 0, 2, 2],
  },
  // Round 4 — Last-hole unclaimed skin scenario: hole 18 carries with no
  // winner → split-among-winners triggers. Carry-greenie chain hits cap at 4.
  4: {
    P1: [ 0, 0,-1, 0, 0, 0, 0, 0, 0, 0,-1, 0, 0, 0, 0, 0, 0, 0],
    P2: [ 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    P3: [ 1, 2, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1],
    P4: [ 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2],
  },
};

// CTP_BY_ROUND + SANDIES_BY_ROUND were retained when sandies/greenies
// were initially enabled. Both were dropped at impl-codex round 1 because
// production services/money.ts doesn't plumb sandyFromBunker/CTP into
// engine input (Followup T6-9d). Removing the data structures entirely
// to avoid confusion (codex re-run #4 LOW).

// Putts — flat 2 putts everywhere except where a 1-putt or 3-putt is
// noteworthy for the rule annotations. Greenies require ≤2 putts.
function puttsForCell(_roundNumber, _playerId, _holeNumber) {
  // Default 2 putts everywhere; tune specific cells if needed.
  return 2;
}

function grossFor(roundNumber, playerId, holeNumber) {
  const offset = ROUND_OFFSETS[roundNumber][playerId][holeNumber - 1];
  return PARS[holeNumber - 1] + offset;
}

// ---------------------------------------------------------------------------
// __meta.scoreIntentByHole — annotates rule-exercising holes for the reader
// (and Josh during hand-calc).
// ---------------------------------------------------------------------------
// NOTE: with sandies + carry-greenies disabled (T6-9d followup), only the
// skin / bet / 2v2-best-ball annotations are load-bearing. The sandies and
// CTP fields ARE retained on score rows + holeMeta because (a) the engine
// types accept them, and (b) when T6-9d ships and re-enables the rules,
// the same fixture serves as the test bed without further re-derivation
// of scores — only `expected.*` will need re-verification.
const SCORE_INTENT = [
  { round: 1, hole: 1,  kind: 'skin',           note: 'P1 birdie (3) on par 4; sole sub-par → gross-mode skin to P1' },
  { round: 1, hole: 6,  kind: 'best-ball-low',  note: 'P1 birdie (2) on par 3; team A advantage' },
  { round: 1, hole: 13, kind: 'skin',           note: 'P1 birdie (3) on par 4; potential skin' },
  { round: 2, hole: 9,  kind: 'skin',           note: 'P1 birdie (3) on par 4' },
  { round: 2, hole: 11, kind: 'skin-tie',       note: 'P1 par + P4 birdie on par 5 → P4 has lowest gross, but check vs others' },
  { round: 2, hole: 17, kind: 'skin',           note: 'P1 birdie (2) on par 3' },
  { round: 3, hole: 5,  kind: 'skin',           note: 'P1 birdie (4) on par 5' },
  { round: 3, hole: 13, kind: 'skin-tie-carry', note: 'P2 birdie + P3 birdie on par 4 → tie; skin carries to hole 14' },
  { round: 4, hole: 3,  kind: 'skin',           note: 'P1 birdie (3) on par 4' },
  { round: 4, hole: 11, kind: 'skin',           note: 'P1 birdie (4) + P4 birdie (4) on par 5 — both 4s; tie-carry' },
  // Bet annotations:
  { round: 1, hole: 3,  kind: 'bet1-stroke',    note: 'P4 receives 2 strokes (CH 22, SI 1); affects P1 vs P4 net comparison' },
  { round: 2, hole: 3,  kind: 'bet1+bet2',      note: 'P3 receives stroke (CH 14, SI 1); affects both bets' },
];

// ---------------------------------------------------------------------------
// Build fixture JSON.
// ---------------------------------------------------------------------------

const rounds = PAIRINGS.map((pairing) => {
  const holeScores = [];
  for (let h = 1; h <= 18; h++) {
    for (const player of PLAYERS) {
      holeScores.push({
        playerId: player.id,
        holeNumber: h,
        grossStrokes: grossFor(pairing.round, player.id, h),
        putts: puttsForCell(pairing.round, player.id, h),
      });
    }
  }
  // holeMeta intentionally empty — see Followup T6-9d.
  const holeMeta = [];
  return {
    roundNumber: pairing.round,
    pairings: { teamA: pairing.teamA, teamB: pairing.teamB },
    holeScores,
    holeMeta,
  };
});

const fixture = {
  __meta: {
    storyKey: 'T6-9',
    regenerated: null,
    scoreNotes: 'Deterministically generated by pinehurst-hand-calc-generator.mjs. Scores tuned for plausibility + rule coverage. Re-generate by editing constants in the .mjs file and re-running it.',
    scoreIntentByHole: SCORE_INTENT,
  },
  course: COURSE,
  players: PLAYERS,
  rounds,
  bets: BETS,
  bestBallConfig: BEST_BALL_CONFIG,
  skinsConfig: SKINS_CONFIG,
  expected: {
    verifiedBy: null,
    verifiedDate: null,
    matrixCents: null,
    totalsCents: null,
    skinsResults: null,
    betResults: null,
    _handCalcWorksheet: 'TODO: walk per-round per-rule contributions; sum into matrixCents; verify zero-sum; sign verifiedBy + verifiedDate (YYYY-MM-DD).',
  },
};

process.stdout.write(JSON.stringify(fixture, null, 2));
