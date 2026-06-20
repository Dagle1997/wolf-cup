// ---------------------------------------------------------------------------
// PAIRWISE settle-up — the "Kyle" scenario.
//
// Settlement is per-counterparty: a player who WINS vs one person and LOSES the
// same amount vs another is NOT settled — they owe one person and are owed by
// another. Netting everything into a single per-person number (the old bug) hid
// Kyle entirely (his +$ and −$ cancelled to $0). getBetsBoard.settleUp must
// surface BOTH payments and only net bets between the SAME two stakeholders.
//
// Private in-memory db (no cache=shared) so it can't leak across fork workers.
// ---------------------------------------------------------------------------

import { vi, describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";

vi.mock("../db/index.js", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("../db/schema.js");
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  return { db };
});

import { db } from "../db/index.js";
import { getBetsBoard } from "./bets.js";
import { seasons, players, rounds, groups, roundPlayers, roundResults, bets } from "../db/schema.js";

const now = 1_700_000_000_000;
const RR = 550;
// Stakeholders (the people who settle up).
const JOSH = 8301, KYLE = 8302, JAQUINT = 8303;
// Subjects in the round. PY is sole #1 in both markets, so any odds_win backing
// PX MISSES → the layer collects the stake.
const PX = 8304, PY = 8305;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations") });
  await db.insert(seasons).values({
    id: 1, name: "2026", year: 2026, startDate: "2026-04-01", endDate: "2026-09-30",
    totalRounds: 20, playoffFormat: "x", harveyLiveEnabled: 1, createdAt: now,
  });
  await db.insert(players).values([
    { id: JOSH, name: "Josh", createdAt: now },
    { id: KYLE, name: "Kyle", createdAt: now },
    { id: JAQUINT, name: "Jaquint", createdAt: now },
    { id: PX, name: "Px", createdAt: now },
    { id: PY, name: "Py", createdAt: now },
  ]);
  await db.insert(rounds).values({
    id: RR, seasonId: 1, type: "official", status: "finalized", scheduledDate: "2026-06-19", tee: "blue", createdAt: now,
  });
  await db.insert(groups).values({ id: 1, roundId: RR, groupNumber: 1 });
  await db.insert(roundPlayers).values(
    [PX, PY].map((playerId) => ({ roundId: RR, groupId: 1, playerId, handicapIndex: 10, isSub: 0 })),
  );
  // PY sole #1 in BOTH → odds_win backing PX always misses → layer wins the stake.
  await db.insert(roundResults).values([
    { roundId: RR, playerId: PY, stablefordTotal: 40, moneyTotal: 30, updatedAt: now },
    { roundId: RR, playerId: PX, stablefordTotal: 20, moneyTotal: 10, updatedAt: now },
  ]);
  await db.insert(bets).values([
    // Josh backs PX to win MONEY → miss → layer KYLE collects $50 from Josh.
    { roundId: RR, betType: "odds_win", basis: "net", amountDollars: 50, oddsMarket: "money", odds: 200, subjectAPlayerId: PX, sideAPlayerId: JOSH, sideBPlayerId: KYLE, createdAt: now },
    // Kyle backs PX to win STABLEFORD → miss → layer JAQUINT collects $50 from Kyle.
    { roundId: RR, betType: "odds_win", basis: "net", amountDollars: 50, oddsMarket: "stableford", odds: 200, subjectAPlayerId: PX, sideAPlayerId: KYLE, sideBPlayerId: JAQUINT, createdAt: now },
    // Jaquint backs PX to win MONEY vs The House (no layer) → miss → Jaquint pays The House $100.
    { roundId: RR, betType: "odds_win", basis: "net", amountDollars: 100, oddsMarket: "money", odds: 200, subjectAPlayerId: PX, sideAPlayerId: JAQUINT, sideBPlayerId: null, createdAt: now },
  ]);
});

describe("getBetsBoard.settleUp — pairwise (per counterparty)", () => {
  it("Kyle owes Jaquint AND is owed by Josh — both surface, he is NOT netted to zero", async () => {
    const board = await getBetsBoard(RR);
    expect(board.round?.status).toBe("finalized");
    // Josh→Kyle, Kyle→Jaquint, Jaquint→House — three distinct pairwise payments.
    expect(board.settleUp).toHaveLength(3);

    const joshToKyle = board.settleUp.find((s) => s.fromPlayerId === JOSH && s.toPlayerId === KYLE);
    const kyleToJaquint = board.settleUp.find((s) => s.fromPlayerId === KYLE && s.toPlayerId === JAQUINT);

    expect(joshToKyle).toBeDefined();
    expect(joshToKyle!.amount).toBe(50);
    expect(joshToKyle!.fromName).toBe("Josh");
    expect(joshToKyle!.toName).toBe("Kyle");

    expect(kyleToJaquint).toBeDefined();
    expect(kyleToJaquint!.amount).toBe(50);

    // The regression guard: Kyle appears as BOTH a payee and a payer.
    expect(board.settleUp.some((s) => s.toPlayerId === KYLE)).toBe(true);
    expect(board.settleUp.some((s) => s.fromPlayerId === KYLE)).toBe(true);
  });

  it("a bettor who loses to the book pays The House (player → House direction)", async () => {
    const board = await getBetsBoard(RR);
    const toHouse = board.settleUp.find((s) => s.toPlayerId === -1);
    expect(toHouse).toBeDefined();
    expect(toHouse!.fromPlayerId).toBe(JAQUINT);
    expect(toHouse!.toName).toBe("The House");
    expect(toHouse!.amount).toBe(100);
  });
});
