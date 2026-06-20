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
  groups,
  wolfDecisions,
} from '../db/schema.js';
import { calcCourseHandicap, getCourseHole } from '@wolf-cup/engine';
import type { Tee, HoleNumber } from '@wolf-cup/engine';

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
          groupId: holeScores.groupId,
          playerId: holeScores.playerId,
          holeNumber: holeScores.holeNumber,
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

  // -------------------------------------------------------------------------
  // Hole-by-hole detail data — for the per-group "what happened" sheets.
  // Groups, batting order, per-hole gross, and wolf decisions / bonuses, all
  // keyed for a per-foursome layout.
  // -------------------------------------------------------------------------
  const allGroups = roundIds.length
    ? await db
        .select({ id: groups.id, roundId: groups.roundId, groupNumber: groups.groupNumber, battingOrder: groups.battingOrder })
        .from(groups)
        .where(inArray(groups.roundId, roundIds))
        .all()
    : [];
  const allMembers = roundIds.length
    ? await db
        .select({ roundId: roundPlayers.roundId, groupId: roundPlayers.groupId, playerId: roundPlayers.playerId, handicapIndex: roundPlayers.handicapIndex, isSub: roundPlayers.isSub })
        .from(roundPlayers)
        .where(inArray(roundPlayers.roundId, roundIds))
        .all()
    : [];
  const allWolf = roundIds.length
    ? await db
        .select({ roundId: wolfDecisions.roundId, groupId: wolfDecisions.groupId, holeNumber: wolfDecisions.holeNumber, wolfPlayerId: wolfDecisions.wolfPlayerId, decision: wolfDecisions.decision, partnerPlayerId: wolfDecisions.partnerPlayerId, bonusesJson: wolfDecisions.bonusesJson })
        .from(wolfDecisions)
        .where(inArray(wolfDecisions.roundId, roundIds))
        .all()
    : [];

  // id → name for every member, wolf, and partner referenced.
  const nameIds = new Set<number>();
  for (const m of allMembers) nameIds.add(m.playerId);
  for (const w of allWolf) {
    if (w.wolfPlayerId) nameIds.add(w.wolfPlayerId);
    if (w.partnerPlayerId) nameIds.add(w.partnerPlayerId);
  }
  const nameRows = nameIds.size
    ? await db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, [...nameIds])).all()
    : [];
  const nameById = new Map(nameRows.map((p) => [p.id, p.name]));

  const groupsByRound = new Map<number, typeof allGroups>();
  for (const g of allGroups) {
    const list = groupsByRound.get(g.roundId);
    if (list) list.push(g);
    else groupsByRound.set(g.roundId, [g]);
  }
  const membersByGroup = new Map<number, typeof allMembers>();
  for (const m of allMembers) {
    const list = membersByGroup.get(m.groupId);
    if (list) list.push(m);
    else membersByGroup.set(m.groupId, [m]);
  }
  // groupId → playerId → holeNumber → gross
  const scoresByGroup = new Map<number, Map<number, Map<number, number>>>();
  for (const hs of allHoleScores) {
    let byPlayer = scoresByGroup.get(hs.groupId);
    if (!byPlayer) { byPlayer = new Map(); scoresByGroup.set(hs.groupId, byPlayer); }
    let byHole = byPlayer.get(hs.playerId);
    if (!byHole) { byHole = new Map(); byPlayer.set(hs.playerId, byHole); }
    byHole.set(hs.holeNumber, hs.gross);
  }
  // groupId → holeNumber → wolf decision row
  const wolfByGroup = new Map<number, Map<number, (typeof allWolf)[number]>>();
  for (const w of allWolf) {
    let byHole = wolfByGroup.get(w.groupId);
    if (!byHole) { byHole = new Map(); wolfByGroup.set(w.groupId, byHole); }
    byHole.set(w.holeNumber, w);
  }
  const resultByRoundPlayer = new Map<string, { stableford: number; money: number }>();
  for (const r of allResults) resultByRoundPlayer.set(`${r.roundId}:${r.playerId}`, { stableford: r.stableford, money: r.money });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wolf Cup';
  wb.created = new Date();

  // ---- Detail-sheet helpers (close over the maps above) -------------------
  const HOLES = Array.from({ length: 18 }, (_, i) => i + 1);
  const PARS = HOLES.map((h) => getCourseHole(h as HoleNumber).par);
  const TOTAL_PAR = PARS.reduce((a, b) => a + b, 0);

  const shortName = (id: number | null | undefined): string => {
    if (id == null) return '';
    const n = nameById.get(id);
    if (!n) return `#${id}`;
    const parts = n.trim().split(/\s+/);
    return parts[parts.length - 1] ?? n;
  };
  const bonusColor = (bonuses: string[]): string =>
    bonuses.includes('Greenie') ? 'FFD7F0D0' : bonuses.includes('Polie') ? 'FFFFF0C0' : 'FFFFE0B0';
  // Defensive coercion: a bonusesJson field may be missing, null, or the wrong
  // shape (legacy / corrupt rows). Always return a clean number[] so the export
  // can never crash on `null.greenies` or iterating a non-array.
  const toIdArray = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
  const parseBonusRec = (json: string | null | undefined): { greenies: number[]; polies: number[]; sandies: number[] } | null => {
    if (!json) return null;
    let b: unknown;
    try { b = JSON.parse(json); } catch { return null; }
    if (b == null || typeof b !== 'object') return null;
    const rec = b as Record<string, unknown>;
    return { greenies: toIdArray(rec['greenies']), polies: toIdArray(rec['polies']), sandies: toIdArray(rec['sandies']) };
  };
  const buildBonusSummary = (groupId: number): string => {
    const wbh = wolfByGroup.get(groupId);
    if (!wbh) return '';
    const greenies: string[] = [], polies: string[] = [], sandies: string[] = [];
    for (const [hole, w] of [...wbh.entries()].sort((a, b) => a[0] - b[0])) {
      const b = parseBonusRec(w.bonusesJson);
      if (!b) continue;
      for (const id of b.greenies) greenies.push(`H${hole} ${shortName(id)}`);
      for (const id of b.polies) polies.push(`H${hole} ${shortName(id)}`);
      for (const id of b.sandies) sandies.push(`H${hole} ${shortName(id)}`);
    }
    const parts: string[] = [];
    if (greenies.length) parts.push(`Greenies: ${greenies.join(', ')}`);
    if (polies.length) parts.push(`Polies: ${polies.join(', ')}`);
    if (sandies.length) parts.push(`Sandies: ${sandies.join(', ')}`);
    return parts.join('   ·   ');
  };

  // One per-round sheet: each foursome as a block — players down the left,
  // holes across, with wolf calls and greenie/polie/sandie markers. This is the
  // "see exactly what happened hole by hole" view (the aggregate sheet stays the
  // minimal disaster-recovery mirror).
  function addDetailSheet(round: { id: number; scheduledDate: string }): void {
    const groupsForRound = (groupsByRound.get(round.id) ?? []).slice().sort((a, b) => a.groupNumber - b.groupNumber);
    if (groupsForRound.length === 0) return;
    const sheet = wb.addWorksheet(`${round.scheduledDate} detail`);
    sheet.getColumn(1).width = 18;
    for (let c = 2; c <= 19; c++) sheet.getColumn(c).width = 4.5;
    sheet.getColumn(20).width = 7; // Tot
    sheet.getColumn(21).width = 7; // Stbl
    sheet.getColumn(22).width = 9; // $

    const centerHoles = (row: ExcelJS.Row) => {
      row.getCell(1).alignment = { horizontal: 'left' };
      for (let c = 2; c <= 22; c++) row.getCell(c).alignment = { horizontal: 'center' };
    };

    for (const g of groupsForRound) {
      // Validate it's actually a number[] — valid-but-wrong-shape JSON must not crash export.
      let order: number[] = [];
      try {
        const parsed: unknown = g.battingOrder ? JSON.parse(g.battingOrder) : [];
        if (Array.isArray(parsed)) order = parsed.filter((x): x is number => typeof x === 'number');
      } catch { order = []; }
      const members = (membersByGroup.get(g.id) ?? []).slice().sort((a, b) => {
        const ia = order.indexOf(a.playerId), ib = order.indexOf(b.playerId);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return (nameById.get(a.playerId) ?? '').localeCompare(nameById.get(b.playerId) ?? '');
      });

      const titleRow = sheet.addRow([`Group ${g.groupNumber}`]);
      titleRow.font = { bold: true, size: 12 };

      const header = sheet.addRow(['Hole', ...HOLES, 'Tot', 'Stbl', '$']);
      header.font = { bold: true };
      centerHoles(header);

      const parRow = sheet.addRow(['Par', ...PARS, TOTAL_PAR, '', '']);
      parRow.font = { color: { argb: 'FF808080' } };
      centerHoles(parRow);

      const wolfByHole = wolfByGroup.get(g.id) ?? new Map<number, (typeof allWolf)[number]>();
      const scoresForGroup = scoresByGroup.get(g.id) ?? new Map<number, Map<number, number>>();

      // Pre-parse each hole's bonuses ONCE per group (not per player-hole cell),
      // via the shape-safe parser so corrupt JSON can't crash the export.
      const bonusByHole = new Map<number, { greenies: Set<number>; polies: Set<number>; sandies: Set<number> }>();
      for (const [hole, w] of wolfByHole.entries()) {
        const b = parseBonusRec(w.bonusesJson);
        if (!b) continue;
        bonusByHole.set(hole, {
          greenies: new Set(b.greenies),
          polies: new Set(b.polies),
          sandies: new Set(b.sandies),
        });
      }
      const bonusesFor = (hole: number, playerId: number): string[] => {
        const b = bonusByHole.get(hole);
        if (!b) return [];
        const out: string[] = [];
        if (b.greenies.has(playerId)) out.push('Greenie');
        if (b.polies.has(playerId)) out.push('Polie');
        if (b.sandies.has(playerId)) out.push('Sandie');
        return out;
      };

      for (const m of members) {
        const byHole = scoresForGroup.get(m.playerId) ?? new Map<number, number>();
        const grosses = HOLES.map((h) => byHole.get(h) ?? null);
        const playedCount = grosses.filter((v) => v != null).length;
        const totGross = grosses.reduce<number>((a, v) => a + (v ?? 0), 0);
        // Only a full 18 shows a clean total; a partial card is flagged so the
        // sum-of-played isn't mistaken for a complete round.
        const totCell = playedCount === 0 ? '' : playedCount === 18 ? totGross : `${totGross} (${playedCount})`;
        const res = resultByRoundPlayer.get(`${round.id}:${m.playerId}`);
        const label = `${nameById.get(m.playerId) ?? `#${m.playerId}`}${m.isSub === 1 ? ' (sub)' : ''}`;
        const row = sheet.addRow([
          label,
          ...grosses.map((v) => v ?? ''),
          totCell,
          res?.stableford ?? '',
          res?.money ?? '',
        ]);
        centerHoles(row);
        for (let i = 0; i < 18; i++) {
          const gross = grosses[i];
          if (gross == null) continue;
          const cell = row.getCell(2 + i);
          const par = PARS[i]!;
          if (gross <= par - 1) cell.font = { bold: true, color: { argb: gross <= par - 2 ? 'FF9C0006' : 'FFC00000' } };
          const bonuses = bonusesFor(i + 1, m.playerId);
          if (bonuses.length) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bonusColor(bonuses) } };
            cell.note = bonuses.join(', ');
          }
        }
        row.getCell(22).numFmt = '$#,##0;[Red]-$#,##0';
      }

      const wolfCells = HOLES.map((h) => {
        const w = wolfByHole.get(h);
        if (!w || !w.decision) return '';
        const wolf = shortName(w.wolfPlayerId);
        if (w.decision === 'alone') return `${wolf} solo`;
        if (w.decision === 'blind_wolf') return `${wolf} blind`;
        if (w.decision === 'partner') return `${wolf}+${shortName(w.partnerPlayerId)}`;
        return wolf;
      });
      const wolfRow = sheet.addRow(['Wolf', ...wolfCells, '', '', '']);
      wolfRow.font = { italic: true, size: 9, color: { argb: 'FF7F6000' } };
      centerHoles(wolfRow);

      const summary = buildBonusSummary(g.id);
      if (summary) {
        const sRow = sheet.addRow([summary]);
        sRow.font = { size: 9, color: { argb: 'FF606060' } };
        sheet.mergeCells(sRow.number, 1, sRow.number, 22);
      }

      sheet.addRow([]); // spacer between groups
    }
  }

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

    // Hole-by-hole per-group detail sheet, right after this round's aggregate.
    addDetailSheet(round);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(arrayBuffer as ArrayBuffer),
    filename: `wolf-cup-${season.year}-season.xlsx`,
  };
}
