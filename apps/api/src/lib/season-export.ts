// ---------------------------------------------------------------------------
// Season → XLSX export for disaster-recovery mirror.
// ---------------------------------------------------------------------------
//
// Purpose: if the app ever catastrophically loses data and R2 backups are
// unavailable for some reason, the weekly xlsx is enough to reconstruct every
// finalized round: player name, gross score, stableford points, money.
// Intentionally minimal — no ranks, no side games, no Harvey. Those are all
// derivable from the primitives.
// ---------------------------------------------------------------------------

import ExcelJS from 'exceljs';
import { and, eq, inArray, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  seasons,
  rounds,
  roundResults,
  holeScores,
  roundPlayers,
  players,
} from '../db/schema.js';
import { calcCourseHandicap } from '@wolf-cup/engine';
import type { Tee } from '@wolf-cup/engine';

const VALID_TEES = new Set<string>(['black', 'blue', 'white']);

export interface SeasonExport {
  buffer: Buffer;
  filename: string;
}

export async function buildSeasonWorkbook(year?: number): Promise<SeasonExport> {
  const season = year
    ? await db.select().from(seasons).where(eq(seasons.year, year)).get()
    : await db.select().from(seasons).orderBy(asc(seasons.year)).all().then((rows) => rows.at(-1));

  if (!season) {
    throw new Error(year ? `Season ${year} not found` : 'No seasons exist');
  }

  const finalizedRounds = await db
    .select({
      id: rounds.id,
      scheduledDate: rounds.scheduledDate,
      tee: rounds.tee,
    })
    .from(rounds)
    .where(and(eq(rounds.seasonId, season.id), eq(rounds.status, 'finalized')))
    .orderBy(asc(rounds.scheduledDate))
    .all();

  const roundIds = finalizedRounds.map((r) => r.id);
  const teeByRound = new Map<number, string | null>(finalizedRounds.map((r) => [r.id, r.tee]));

  const allResults = roundIds.length
    ? await db
        .select({
          roundId: roundResults.roundId,
          playerId: roundResults.playerId,
          stableford: roundResults.stablefordTotal,
          money: roundResults.moneyTotal,
          playerName: players.name,
          isSub: roundPlayers.isSub,
          handicapIndex: roundPlayers.handicapIndex,
        })
        .from(roundResults)
        .innerJoin(players, eq(roundResults.playerId, players.id))
        .leftJoin(
          roundPlayers,
          and(
            eq(roundPlayers.roundId, roundResults.roundId),
            eq(roundPlayers.playerId, roundResults.playerId),
          ),
        )
        .where(inArray(roundResults.roundId, roundIds))
        .all()
    : [];

  const allHoleScores = roundIds.length
    ? await db
        .select({
          roundId: holeScores.roundId,
          playerId: holeScores.playerId,
          gross: holeScores.grossScore,
        })
        .from(holeScores)
        .where(inArray(holeScores.roundId, roundIds))
        .all()
    : [];

  const grossByRoundPlayer = new Map<string, number>();
  for (const hs of allHoleScores) {
    const k = `${hs.roundId}:${hs.playerId}`;
    grossByRoundPlayer.set(k, (grossByRoundPlayer.get(k) ?? 0) + hs.gross);
  }

  const resultsByRound = new Map<number, typeof allResults>();
  for (const r of allResults) {
    const list = resultsByRound.get(r.roundId);
    if (list) list.push(r);
    else resultsByRound.set(r.roundId, [r]);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wolf Cup';
  wb.created = new Date();

  if (finalizedRounds.length === 0) {
    const info = wb.addWorksheet('No finalized rounds');
    info.addRow([`Season ${season.year} has no finalized rounds yet.`]);
  }

  for (const round of finalizedRounds) {
    const sheet = wb.addWorksheet(round.scheduledDate);
    sheet.columns = [
      { header: 'Player', key: 'name', width: 24 },
      { header: 'HI', key: 'hi', width: 8 },
      { header: 'Course HCP', key: 'ch', width: 12 },
      { header: 'Gross Score', key: 'gross', width: 12 },
      { header: 'Stableford', key: 'stableford', width: 12 },
      { header: 'Money', key: 'money', width: 10 },
      { header: 'Sub', key: 'sub', width: 6 },
    ];
    sheet.getRow(1).font = { bold: true };

    const rows = (resultsByRound.get(round.id) ?? [])
      .slice()
      .sort((a, b) => b.stableford - a.stableford);

    const tee = teeByRound.get(round.id);
    const teeIsValid = tee != null && VALID_TEES.has(tee);

    for (const r of rows) {
      const ch = teeIsValid && r.handicapIndex != null
        ? calcCourseHandicap(r.handicapIndex, tee as Tee)
        : null;
      sheet.addRow({
        name: r.playerName,
        hi: r.handicapIndex ?? null,
        ch,
        gross: grossByRoundPlayer.get(`${round.id}:${r.playerId}`) ?? null,
        stableford: r.stableford,
        money: r.money,
        sub: r.isSub === 1 ? 'Y' : '',
      });
    }

    sheet.getColumn('money').numFmt = '$#,##0;[Red]-$#,##0';
    sheet.getColumn('hi').numFmt = '0.0';
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    filename: `wolf-cup-${season.year}-season.xlsx`,
  };
}
