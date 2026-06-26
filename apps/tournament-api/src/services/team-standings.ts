/**
 * Event-level 2-man TEAM standings (member-guest "best ball" overall).
 *
 * Reuses `computeFoursomeResults` (which already computes each foursome's two
 * teams hole-by-hole: best net per team + par + per-player gross) and
 * aggregates across every round of the event by the 2-man team (the
 * member-guest pair, stable across rounds even as foursomes reshuffle).
 *
 * Per team we accumulate, over every fully-scored hole:
 *   - team best GROSS  = lower gross of the two teammates (may be a different
 *                        player than the best-net ball)
 *   - team best NET    = `teamXBestNet` from the 2v2 engine (full course
 *                        handicap, slope-aware, off the locked index)
 *   - par
 * and derive `toPar = netTotal - parTotal` (cumulative NET score to par — the
 * default sort Josh asked for; "overall cumulative score").
 *
 * Match-play POINTS (9/18-hole matches, round-robin opponents) is a separate,
 * schedule-dependent sort — NOT computed here (Phase 2).
 *
 * NOTE: a hole only counts once all four foursome members have a score (the
 * 2v2 engine's complete-cell gate). In practice every hole is fully scored;
 * partially-scored holes simply aren't counted yet.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { eventRounds } from '../db/schema/index.js';
import { computeFoursomeResults } from './money-detail.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type TeamStandingRow = {
  /** Stable team id: the two player ids sorted + joined. */
  teamKey: string;
  players: Array<{ playerId: string; name: string | null }>;
  holesPlayed: number;
  grossTotal: number;
  netTotal: number;
  parTotal: number;
  /** Cumulative NET score to par (netTotal − parTotal). Negative = under par. */
  toPar: number;
};

export type TeamStandingsResponse = {
  eventId: string;
  teams: TeamStandingRow[];
};

export async function computeTeamStandings(
  dbOrTx: Db | Tx,
  eventId: string,
  tenantId: string,
): Promise<TeamStandingsResponse> {
  const erRows = await dbOrTx
    .select({ id: eventRounds.id })
    .from(eventRounds)
    .where(and(eq(eventRounds.eventId, eventId), eq(eventRounds.tenantId, tenantId)))
    .orderBy(asc(eventRounds.roundNumber));

  const acc = new Map<string, TeamStandingRow>();

  for (const er of erRows) {
    const res = await computeFoursomeResults(dbOrTx, er.id, tenantId);
    if (!res) continue; // round not started / no foursomes
    for (const foursome of res.foursomes) {
      for (const side of ['teamA', 'teamB'] as const) {
        const teamPlayers = side === 'teamA' ? foursome.teamA : foursome.teamB;
        const ids = teamPlayers.map((p) => p.playerId);
        const key = [...ids].sort().join('|');
        let row = acc.get(key);
        if (!row) {
          row = {
            teamKey: key,
            players: teamPlayers,
            holesPlayed: 0,
            grossTotal: 0,
            netTotal: 0,
            parTotal: 0,
            toPar: 0,
          };
          acc.set(key, row);
        }
        for (const hole of foursome.perHole) {
          // Only count a FULLY complete hole — both teams have a best net.
          // (The 2v2 engine gates bestNet on all four members being scored, so
          // teamA/teamB best-nets already move together; requiring both here
          // makes that invariant self-enforcing rather than relying on the
          // engine, and keeps a team's running total honest if that ever
          // changes.)
          if (hole.teamABestNet == null || hole.teamBBestNet == null) continue;
          const bestNet = side === 'teamA' ? hole.teamABestNet : hole.teamBBestNet;
          const grosses = hole.players
            .filter((p) => ids.includes(p.playerId))
            .map((p) => p.gross)
            .filter((g): g is number => g != null);
          if (grosses.length === 0) continue;
          row.holesPlayed += 1;
          row.netTotal += bestNet;
          row.grossTotal += Math.min(...grosses);
          row.parTotal += hole.par;
        }
      }
    }
  }

  const teams = [...acc.values()]
    .map((r) => ({ ...r, toPar: r.netTotal - r.parTotal }))
    // Default sort: cumulative net to par (lowest wins), then raw net. Teams with
    // ZERO scored holes sort LAST — a no-score team has toPar 0, which would
    // otherwise tie a legitimately even-par team and (via the net-0 tiebreak)
    // rank AHEAD of teams that actually played. An unscored team is last, not even.
    .sort((a, b) => {
      const au = a.holesPlayed === 0 ? 1 : 0;
      const bu = b.holesPlayed === 0 ? 1 : 0;
      if (au !== bu) return au - bu;
      return a.toPar - b.toPar || a.netTotal - b.netTotal;
    });

  return { eventId, teams };
}
