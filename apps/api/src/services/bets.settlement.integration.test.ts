// ---------------------------------------------------------------------------
// odds_win SETTLEMENT — finalize→settle integration test.
//
// The unit tests (bets.test.ts) prove settleBet in isolation; this exercises the
// REAL money path end-to-end: seed round_results, ride bets `live` while the round
// is active, flip the round to finalized, and assert getBetsBoard settles each
// odds_win bet to the right side + dollars and rolls up the correct settle-up —
// including a vs-THE-HOUSE bet that (by design) makes the player ledger non-zero-sum.
//
// Uses a private in-memory db (no cache=shared) so it can't leak across fork
// workers (see the file::memory cross-file-leak caveat).
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
import { eq } from "drizzle-orm";
import { getBetsBoard } from "./bets.js";
import { seasons, players, rounds, groups, roundPlayers, roundResults, bets } from "../db/schema.js";

const now = 1_700_000_000_000;
const R = 500; // the bet round

// Subjects (in the round, with results). P1 is the SOLE #1 in BOTH metrics.
const P1 = 8101, P2 = 8102, P3 = 8103, P4 = 8104;
// Stakeholders (need not play).
const ALICE = 8201, BOB = 8202, CARL = 8203;

const betOf = (o: Partial<typeof bets.$inferInsert> & { betType: string; subjectAPlayerId: number; sideAPlayerId: number }) => ({
  roundId: R,
  basis: "net" as const,
  amountDollars: 100,
  createdAt: now,
  ...o,
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations") });
  await db.insert(seasons).values({
    id: 1, name: "2026", year: 2026, startDate: "2026-04-01", endDate: "2026-09-30",
    totalRounds: 20, playoffFormat: "x", harveyLiveEnabled: 1, createdAt: now,
  });
  await db.insert(players).values([
    { id: P1, name: "Stoll", createdAt: now },
    { id: P2, name: "Teddy", createdAt: now },
    { id: P3, name: "Ronnie", createdAt: now },
    { id: P4, name: "Madden", createdAt: now },
    { id: ALICE, name: "Alice", createdAt: now },
    { id: BOB, name: "Bob", createdAt: now },
    { id: CARL, name: "Carl", createdAt: now },
  ]);
  // Round starts ACTIVE (bets ride live), tee set so stroke-totals can compute.
  await db.insert(rounds).values({
    id: R, seasonId: 1, type: "official", status: "active", scheduledDate: "2026-06-19", tee: "blue", createdAt: now,
  });
  await db.insert(groups).values({ id: 1, roundId: R, groupNumber: 1 });
  await db.insert(roundPlayers).values(
    [P1, P2, P3, P4].map((playerId) => ({ roundId: R, groupId: 1, playerId, handicapIndex: 10, isSub: 0 })),
  );
  // Results: P1 SOLE #1 in BOTH Stableford AND money → P1 owns all three titles.
  await db.insert(roundResults).values([
    { roundId: R, playerId: P1, stablefordTotal: 40, moneyTotal: 30, updatedAt: now },
    { roundId: R, playerId: P2, stablefordTotal: 30, moneyTotal: 10, updatedAt: now },
    { roundId: R, playerId: P3, stablefordTotal: 25, moneyTotal: -5, updatedAt: now },
    { roundId: R, playerId: P4, stablefordTotal: 20, moneyTotal: -35, updatedAt: now },
  ]);
  await db.insert(bets).values([
    // 1) PEER WIN — Alice backs P1 for a perfect day @ +1650; P1 hits → Alice +1650.
    betOf({ betType: "odds_win", subjectAPlayerId: P1, oddsMarket: "perfect_day", odds: 1650, amountDollars: 100, sideAPlayerId: ALICE, sideBPlayerId: BOB }),
    // 2) PEER LOSS — Alice backs P2 to win money @ +300; P1 wins money → layer Bob +50.
    betOf({ betType: "odds_win", subjectAPlayerId: P2, oddsMarket: "money", odds: 300, amountDollars: 50, sideAPlayerId: ALICE, sideBPlayerId: BOB }),
    // 3) vs THE HOUSE — Carl backs P1 to win Stableford @ +200, no layer; P1 hits → Carl +200, House pays.
    betOf({ betType: "odds_win", subjectAPlayerId: P1, oddsMarket: "stableford", odds: 200, amountDollars: 100, sideAPlayerId: CARL, sideBPlayerId: null }),
  ]);
});

describe("odds_win settlement — finalize→settle (real money path)", () => {
  it("rides LIVE while the round is active (day-winner not yet authoritative)", async () => {
    const board = await getBetsBoard(R);
    expect(board.bets).toHaveLength(3);
    expect(board.bets.every((b) => b.outcome.status === "live")).toBe(true);
    expect(board.settleUp).toHaveLength(0); // nothing settled yet
  });

  it("settles every bet correctly once the round is finalized", async () => {
    await db.update(rounds).set({ status: "finalized" }).where(eq(rounds.id, R));
    const board = await getBetsBoard(R);
    const byBettor = (subjId: number, market: string) =>
      board.bets.find((b) => b.subjectA.id === subjId && b.oddsMarket === market)!;

    // 1) perfect day on P1 → bettor (Alice) collects the +1650 profit.
    const perfect = byBettor(P1, "perfect_day");
    expect(perfect.outcome.status).toBe("settled");
    expect(perfect.outcome.winningSide).toBe("A");
    expect(perfect.outcome.payout).toBe(1650);

    // 2) P2 to win money → MISS (P1 won it) → layer (Bob) collects the $50 stake.
    const money = byBettor(P2, "money");
    expect(money.outcome.winningSide).toBe("B");
    expect(money.outcome.payout).toBe(50);

    // 3) vs The House on P1 Stableford → HIT → Carl +200; sideB is The House (null).
    const house = byBettor(P1, "stableford");
    expect(house.outcome.winningSide).toBe("A");
    expect(house.outcome.payout).toBe(200);
    expect(house.sideB).toBeNull();
  });

  it("rolls up the right settle-up — and the House makes it intentionally non-zero-sum", async () => {
    const board = await getBetsBoard(R);
    const net = new Map(board.settleUp.map((s) => [s.playerId, s.net]));
    expect(net.get(ALICE)).toBe(1650 - 50); // +1600 (won perfect day, lost the money bet)
    expect(net.get(BOB)).toBe(-1650 + 50); // -1600
    expect(net.get(CARL)).toBe(200); // beat the House
    // The House is the book, not a player → never on settle-up.
    expect(net.has(-1)).toBe(false);
    expect(board.settleUp.some((s) => s.name === "The House")).toBe(false);
    // Player ledger sums to the House's loss (+200), NOT zero — by design.
    const sum = board.settleUp.reduce((a, s) => a + s.net, 0);
    expect(sum).toBe(200);
  });
});
