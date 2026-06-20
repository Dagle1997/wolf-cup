// ---------------------------------------------------------------------------
// GET /bets[?roundId=N] — round scoping.
//
// The board defaults to the active round but accepts ?roundId=N to view a PAST
// round's bets + results (the history view reached from a past round's scouting
// panel). This proves the route maps the query param to the right round when an
// active round AND a finalized past round each carry a distinct bet — the
// regression that "yesterday's round → The Action shows no bets" guards against.
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

import betsApp from "./bets.js";
import { db } from "../db/index.js";
import { seasons, players, rounds, groups, roundPlayers, roundResults, bets } from "../db/schema.js";

const now = 1_700_000_000_000;
const R_LIVE = 600; // active round
const R_PAST = 601; // finalized past round
const P_LIVE = 9101, P_PAST = 9102, ALICE = 9201, BOB = 9202;

type Board = {
  round: { id: number; status: string; scheduledDate: string } | null;
  bets: Array<{ id: number; subjectA: { id: number; name: string }; outcome: { status: string } }>;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../db/migrations") });
  await db.insert(seasons).values({
    id: 1, name: "2026", year: 2026, startDate: "2026-04-01", endDate: "2026-09-30",
    totalRounds: 20, playoffFormat: "x", harveyLiveEnabled: 1, createdAt: now,
  });
  await db.insert(players).values([
    { id: P_LIVE, name: "Live Subject", createdAt: now },
    { id: P_PAST, name: "Past Subject", createdAt: now },
    { id: ALICE, name: "Alice", createdAt: now },
    { id: BOB, name: "Bob", createdAt: now },
  ]);
  await db.insert(rounds).values([
    { id: R_LIVE, seasonId: 1, type: "official", status: "active", scheduledDate: "2026-06-20", tee: "blue", createdAt: now },
    { id: R_PAST, seasonId: 1, type: "official", status: "finalized", scheduledDate: "2026-06-19", tee: "blue", createdAt: now - 1 },
  ]);
  await db.insert(groups).values([
    { id: 1, roundId: R_LIVE, groupNumber: 1 },
    { id: 2, roundId: R_PAST, groupNumber: 1 },
  ]);
  await db.insert(roundPlayers).values([
    { roundId: R_LIVE, groupId: 1, playerId: P_LIVE, handicapIndex: 10, isSub: 0 },
    { roundId: R_PAST, groupId: 2, playerId: P_PAST, handicapIndex: 10, isSub: 0 },
  ]);
  // Past round results — P_PAST is sole #1 so its odds_win bet settles.
  await db.insert(roundResults).values({ roundId: R_PAST, playerId: P_PAST, stablefordTotal: 40, moneyTotal: 30, updatedAt: now });
  await db.insert(bets).values([
    { roundId: R_LIVE, betType: "odds_win", basis: "net", amountDollars: 100, oddsMarket: "stableford", odds: 200, subjectAPlayerId: P_LIVE, sideAPlayerId: ALICE, sideBPlayerId: BOB, createdAt: now },
    { roundId: R_PAST, betType: "odds_win", basis: "net", amountDollars: 100, oddsMarket: "stableford", odds: 200, subjectAPlayerId: P_PAST, sideAPlayerId: ALICE, sideBPlayerId: BOB, createdAt: now },
  ]);
});

describe("GET /bets — round scoping", () => {
  it("defaults to the active round's bets", async () => {
    const res = await betsApp.request("/bets");
    expect(res.status).toBe(200);
    const board = (await res.json()) as Board;
    expect(board.round?.id).toBe(R_LIVE);
    expect(board.bets).toHaveLength(1);
    expect(board.bets[0]!.subjectA.id).toBe(P_LIVE);
    expect(board.bets[0]!.outcome.status).toBe("live"); // active round → not yet settled
  });

  it("?roundId=N scopes to that past round's bets + settled results", async () => {
    const res = await betsApp.request(`/bets?roundId=${R_PAST}`);
    expect(res.status).toBe(200);
    const board = (await res.json()) as Board;
    expect(board.round?.id).toBe(R_PAST);
    expect(board.round?.status).toBe("finalized");
    expect(board.bets).toHaveLength(1);
    expect(board.bets[0]!.subjectA.id).toBe(P_PAST);
    expect(board.bets[0]!.outcome.status).toBe("settled"); // finalized round → graded
  });

  it("an invalid roundId falls back to the active round (never errors)", async () => {
    for (const bad of ["abc", "0", "-3"]) {
      const res = await betsApp.request(`/bets?roundId=${bad}`);
      expect(res.status).toBe(200);
      const board = (await res.json()) as Board;
      expect(board.round?.id).toBe(R_LIVE);
    }
  });

  it("a valid but non-existent roundId returns an empty board (not the wrong round)", async () => {
    const res = await betsApp.request("/bets?roundId=999999");
    expect(res.status).toBe(200);
    const board = (await res.json()) as Board;
    expect(board.round).toBeNull();
    expect(board.bets).toHaveLength(0);
  });
});
