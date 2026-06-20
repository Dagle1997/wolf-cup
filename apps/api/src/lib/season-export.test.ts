// ---------------------------------------------------------------------------
// Season workbook — hole-by-hole detail sheets.
//
// Each finalized round gets a "<date> detail" sheet: one block per foursome,
// players down the left, holes across, with wolf calls and greenie/polie/sandie
// markers. Asserts the detail sheet is emitted with the right content (read back
// via ExcelJS) and that the minimal aggregate sheet is still present.
//
// Private in-memory db (no cache=shared) so it can't leak across fork workers.
// ---------------------------------------------------------------------------

import { vi, describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import ExcelJS from "exceljs";

vi.mock("../db/index.js", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("./../db/schema.js");
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  return { db };
});

import { db } from "../db/index.js";
import { buildSeasonWorkbook } from "./season-export.js";
import { seasons, players, rounds, groups, roundPlayers, holeScores, roundResults, wolfDecisions } from "../db/schema.js";

const now = 1_700_000_000_000;
const R = 800;
const P1 = 7701, P2 = 7702, P3 = 7703, P4 = 7704;
const DATE = "2026-06-19";

/** Flatten a worksheet's cell text into one string per row, for substring asserts. */
function rowTexts(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.eachRow((row) => {
    const vals: string[] = [];
    row.eachCell((cell) => vals.push(String(cell.value ?? "")));
    out.push(vals.join(" | "));
  });
  return out;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations") });
  await db.insert(seasons).values({
    id: 1, name: "2026", year: 2026, startDate: "2026-04-01", endDate: "2026-09-30",
    totalRounds: 20, playoffFormat: "x", harveyLiveEnabled: 1, createdAt: now,
  });
  await db.insert(players).values([
    { id: P1, name: "Josh Stoll", createdAt: now },
    { id: P2, name: "Teddy Roe", createdAt: now },
    { id: P3, name: "Ronnie Adkins", createdAt: now },
    { id: P4, name: "Chris McNeely", createdAt: now },
  ]);
  await db.insert(rounds).values({
    id: R, seasonId: 1, type: "official", status: "finalized", scheduledDate: DATE, tee: "blue", createdAt: now,
  });
  await db.insert(groups).values({ id: 1, roundId: R, groupNumber: 1, battingOrder: JSON.stringify([P1, P2, P3, P4]) });
  await db.insert(roundPlayers).values(
    [P1, P2, P3, P4].map((playerId) => ({ roundId: R, groupId: 1, playerId, handicapIndex: 10, isSub: 0 })),
  );
  // Full 18 holes for each player (gross = 4 everywhere, except P1 hole 1 = 3 → birdie styling).
  const scoreRows = [];
  for (const pid of [P1, P2, P3, P4]) {
    for (let h = 1; h <= 18; h++) {
      scoreRows.push({ roundId: R, groupId: 1, playerId: pid, holeNumber: h, grossScore: pid === P1 && h === 1 ? 3 : 4, createdAt: now, updatedAt: now });
    }
  }
  await db.insert(holeScores).values(scoreRows);
  await db.insert(roundResults).values(
    [P1, P2, P3, P4].map((playerId, i) => ({ roundId: R, playerId, stablefordTotal: 36 - i, moneyTotal: 10 - i * 5, updatedAt: now })),
  );
  // Wolf hole 1: P1 goes alone and gets a greenie.
  await db.insert(wolfDecisions).values({
    roundId: R, groupId: 1, holeNumber: 1, wolfPlayerId: P1, decision: "alone", partnerPlayerId: null,
    bonusesJson: JSON.stringify({ greenies: [P1], polies: [], sandies: [] }), outcome: null, createdAt: now,
  });

  // --- Edge-case round: corrupt battingOrder + bonusesJson + a partial card.
  // The export must NOT crash and must flag the incomplete scorecard.
  const R2 = 801, P5 = 7705, P6 = 7706;
  await db.insert(players).values([
    { id: P5, name: "Partial Pete", createdAt: now },
    { id: P6, name: "Full Fred", createdAt: now },
  ]);
  await db.insert(rounds).values({ id: R2, seasonId: 1, type: "official", status: "finalized", scheduledDate: "2026-06-12", tee: "blue", createdAt: now });
  // battingOrder is valid JSON but NOT an array — must fall back to name sort, not crash.
  await db.insert(groups).values({ id: 2, roundId: R2, groupNumber: 1, battingOrder: '{"oops":true}' });
  await db.insert(roundPlayers).values([
    { roundId: R2, groupId: 2, playerId: P5, handicapIndex: 10, isSub: 0 },
    { roundId: R2, groupId: 2, playerId: P6, handicapIndex: 10, isSub: 0 },
  ]);
  // P5 played only the front 9 (partial); P6 all 18.
  const edgeScores = [];
  for (let h = 1; h <= 9; h++) edgeScores.push({ roundId: R2, groupId: 2, playerId: P5, holeNumber: h, grossScore: 4, createdAt: now, updatedAt: now });
  for (let h = 1; h <= 18; h++) edgeScores.push({ roundId: R2, groupId: 2, playerId: P6, holeNumber: h, grossScore: 4, createdAt: now, updatedAt: now });
  await db.insert(holeScores).values(edgeScores);
  // Corrupt bonusesJson shapes: "null" (parses to null) and greenies as a non-array.
  await db.insert(wolfDecisions).values([
    { roundId: R2, groupId: 2, holeNumber: 5, wolfPlayerId: P5, decision: "alone", partnerPlayerId: null, bonusesJson: "null", outcome: null, createdAt: now },
    { roundId: R2, groupId: 2, holeNumber: 6, wolfPlayerId: P6, decision: "alone", partnerPlayerId: null, bonusesJson: JSON.stringify({ greenies: "nope" }), outcome: null, createdAt: now },
  ]);
});

describe("buildSeasonWorkbook — hole-by-hole detail sheet", () => {
  it("emits a '<date> detail' sheet alongside the aggregate sheet", async () => {
    const { buffer } = await buildSeasonWorkbook(2026);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    // Both sheets present: the minimal aggregate (DR mirror) and the new detail.
    expect(wb.getWorksheet(DATE)).toBeDefined();
    const detail = wb.getWorksheet(`${DATE} detail`);
    expect(detail).toBeDefined();

    const texts = rowTexts(detail!).join("\n");
    expect(texts).toContain("Group 1");
    expect(texts).toContain("Josh Stoll");      // player down the left
    expect(texts).toContain("Stoll solo");        // wolf call on hole 1
    expect(texts).toContain("Greenies: H1 Stoll"); // bonus summary line
  });

  it("marks the bonus cell with a note + fill on the right player/hole", async () => {
    const { buffer } = await buildSeasonWorkbook(2026);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const detail = wb.getWorksheet(`${DATE} detail`)!;

    // Find Josh Stoll's row, then his hole-1 cell (column 2).
    let stollRowNum = -1;
    detail.eachRow((row, n) => {
      if (String(row.getCell(1).value ?? "").startsWith("Josh Stoll")) stollRowNum = n;
    });
    expect(stollRowNum).toBeGreaterThan(0);
    const hole1 = detail.getCell(stollRowNum, 2);
    expect(hole1.value).toBe(3); // birdie gross
    // ExcelJS may round-trip a note as a string OR a rich-text object — stringify to be robust.
    expect(JSON.stringify(hole1.note ?? "")).toContain("Greenie");
    expect(hole1.fill?.type).toBe("pattern");
  });

  it("survives corrupt battingOrder / bonusesJson and flags a partial scorecard", async () => {
    // Must not throw despite battingOrder='{"oops":true}' and bonusesJson='null'.
    const { buffer } = await buildSeasonWorkbook(2026);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const detail = wb.getWorksheet("2026-06-12 detail");
    expect(detail).toBeDefined();

    // Partial Pete played 9 holes → his Tot cell is flagged "(9)".
    let peteRowNum = -1;
    detail!.eachRow((row, n) => {
      if (String(row.getCell(1).value ?? "").startsWith("Partial Pete")) peteRowNum = n;
    });
    expect(peteRowNum).toBeGreaterThan(0);
    expect(String(detail!.getCell(peteRowNum, 20).value ?? "")).toContain("(9)");
  });
});
