/**
 * Pete Dye Phase 2 — event-level MATCH-PLAY points standings.
 *
 * The separate parallel board promised in `team-standings.ts`: where Phase 1
 * aggregates each 2-man team's cumulative best-ball NET-to-par (the $50/man
 * pot), this board scores the FOURSOME-INTERNAL 2v2 match — the two teams in a
 * foursome (slots 1&2 vs 3&4) play only each other, one matchup per round — and
 * awards match POINTS.
 *
 * Reuses `computeFoursomeResults`, which already gives each foursome's per-hole
 * winner (`winner: 'teamA'|'teamB'|'tie'|null`, lower team best NET wins the
 * hole). No new scoring, no money/pot path touched.
 *
 * Per round, per foursome:
 *   - count holes won by each team over the round's played holes (a hole counts
 *     only once it's fully complete — `winner != null`)
 *   - the team that won MORE holes wins that round's match (equal = halved).
 *     Because every hole is scored in this app, total-holes-won == the final
 *     match standing for a completed round (no early-closeout modelling).
 *   - points: win = 1, halve = 0.5, loss = 0 (the universal match-play
 *     convention; Josh deferred exact values → configurability is a follow-up).
 *   - a foursome contributes to a team's record only once EVERY hole in play is
 *     scored (completedHoles === perHole.length). A round still in progress or
 *     abandoned partway awards no points, so a provisional tally can never flip
 *     the standings, and unscored events return an empty board. (Pete Dye plays
 *     out all 18 — the vs-par pot requires it — so completed matches always
 *     reach the full hole count; early-closeout-without-scoring is out of scope.)
 *
 * Aggregated across every round by the stable 2-man team key (sorted player ids
 * joined — identical to `team-standings.ts`, so the same pair lines up on both
 * boards even as foursomes reshuffle).
 *
 * The 9-hole vs 18-hole "match length" toggle is the existing
 * `event_rounds.holes_to_play` (CHECK IN (9,18)); `computeFoursomeResults`
 * already filters its per-hole list to the holes in play, so this service needs
 * no new schema or config.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { eventRounds } from '../db/schema/index.js';
import { computeFoursomeResults } from './money-detail.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const WIN_POINTS = 1;
const HALVE_POINTS = 0.5;

export type MatchPlayStandingRow = {
  /** Stable team id: the two player ids sorted + joined (same key as team standings). */
  teamKey: string;
  players: Array<{ playerId: string; name: string | null }>;
  matchesPlayed: number;
  won: number;
  halved: number;
  lost: number;
  /** Σ match points: win 1, halve 0.5, loss 0 (may be fractional). */
  points: number;
  holesWon: number;
  holesLost: number;
  holesHalved: number;
  /** holesWon − holesLost (cumulative hole differential, the tiebreak). */
  holesDiff: number;
};

export type MatchPlayStandingsResponse = {
  eventId: string;
  teams: MatchPlayStandingRow[];
};

export async function computeMatchPlayStandings(
  dbOrTx: Db | Tx,
  eventId: string,
  tenantId: string,
): Promise<MatchPlayStandingsResponse> {
  const erRows = await dbOrTx
    .select({ id: eventRounds.id })
    .from(eventRounds)
    .where(and(eq(eventRounds.eventId, eventId), eq(eventRounds.tenantId, tenantId)))
    .orderBy(asc(eventRounds.roundNumber));

  const acc = new Map<string, MatchPlayStandingRow>();

  const ensureRow = (
    players: Array<{ playerId: string; name: string | null }>,
  ): MatchPlayStandingRow => {
    const key = [...players.map((p) => p.playerId)].sort().join('|');
    let row = acc.get(key);
    if (!row) {
      row = {
        teamKey: key,
        players,
        matchesPlayed: 0,
        won: 0,
        halved: 0,
        lost: 0,
        points: 0,
        holesWon: 0,
        holesLost: 0,
        holesHalved: 0,
        holesDiff: 0,
      };
      acc.set(key, row);
    }
    return row;
  };

  for (const er of erRows) {
    const res = await computeFoursomeResults(dbOrTx, er.id, tenantId);
    if (!res) continue; // round not started / no foursomes
    for (const foursome of res.foursomes) {
      let aHoles = 0;
      let bHoles = 0;
      let halvedHoles = 0;
      for (const hole of foursome.perHole) {
        // Only count a fully-complete hole — winner is null until both teams
        // have a best net (the 2v2 engine's complete-cell gate).
        if (hole.winner === null) continue;
        if (hole.winner === 'teamA') aHoles += 1;
        else if (hole.winner === 'teamB') bHoles += 1;
        else halvedHoles += 1;
      }

      const completedHoles = aHoles + bHoles + halvedHoles;
      const totalHoles = foursome.perHole.length; // = the round's holes in play
      // Only score a COMPLETED match: every hole in play must be in. A round
      // still in progress (or abandoned partway) awards NO points, so a
      // provisional tally can never flip the standings later. For a fully-played
      // round, "won more holes" IS the match-play result — who is up after all
      // holes. (Rows are created only here, so an unscored event returns an
      // empty board and the web empty-state shows.)
      if (totalHoles === 0 || completedHoles !== totalHoles) continue;

      const rowA = ensureRow(foursome.teamA);
      const rowB = ensureRow(foursome.teamB);

      rowA.matchesPlayed += 1;
      rowB.matchesPlayed += 1;
      rowA.holesWon += aHoles;
      rowA.holesLost += bHoles;
      rowA.holesHalved += halvedHoles;
      rowB.holesWon += bHoles;
      rowB.holesLost += aHoles;
      rowB.holesHalved += halvedHoles;

      if (aHoles > bHoles) {
        rowA.won += 1;
        rowA.points += WIN_POINTS;
        rowB.lost += 1;
      } else if (bHoles > aHoles) {
        rowB.won += 1;
        rowB.points += WIN_POINTS;
        rowA.lost += 1;
      } else {
        rowA.halved += 1;
        rowB.halved += 1;
        rowA.points += HALVE_POINTS;
        rowB.points += HALVE_POINTS;
      }
    }
  }

  const teams = [...acc.values()]
    .map((r) => ({ ...r, holesDiff: r.holesWon - r.holesLost }))
    // Most points wins; ties broken by cumulative hole differential, then the
    // stable team key so the order is deterministic.
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.holesDiff - a.holesDiff ||
        a.teamKey.localeCompare(b.teamKey),
    );

  return { eventId, teams };
}
