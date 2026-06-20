// ---------------------------------------------------------------------------
// Admin bets — round selection + add/delete gating.
//
// The round selector lets an admin manage ANY round's bets (e.g. delete test
// bets after a round finalizes). Adding a bet is gated to OPEN (active/scheduled)
// rounds server-side so a bet can't auto-settle into a closed round's money;
// deletion (by id) stays allowed on any round.
//
// Private in-memory db (no cache=shared) so it can't leak across fork workers.
// ---------------------------------------------------------------------------

import { vi, describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";

vi.mock("../../db/index.js", async () => {
  const { createClient } = await import("@libsql/client");
  const { drizzle } = await import("drizzle-orm/libsql");
  const schema = await import("../../db/schema.js");
  const client = createClient({ url: ":memory:" });
  const db = drizzle(client, { schema });
  return { db };
});

import betsAdminApp from "./bets.js";
import { db } from "../../db/index.js";
import { eq } from "drizzle-orm";
import bcrypt from "bcrypt";
import { admins, sessions, seasons, players, rounds, groups, roundPlayers, bets } from "../../db/schema.js";

const now = 1_700_000_000_000;
const RA = 700; // active round
const RF = 701; // finalized round
const P1 = 9501, P2 = 9502;
const SESSION = "test-session-admin-bets";

type AdminBoard = {
  round: { id: number; status: string } | null;
  bets: Array<{ id: number; subjectA: { id: number } }>;
  roster: Array<{ id: number; name: string }>;
  rounds: Array<{ id: number; status: string; scheduledDate: string }>;
};

const auth = () => ({ Cookie: `session=${SESSION}`, "Content-Type": "application/json" });

const h2h = (roundId?: number) => ({
  betType: "h2h" as const,
  basis: "gross" as const,
  amountDollars: 10,
  subjectAPlayerId: P1,
  subjectBPlayerId: P2,
  sideAPlayerId: P1,
  sideBPlayerId: P2,
  ...(roundId != null ? { roundId } : {}),
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: resolve(dirname(fileURLToPath(import.meta.url)), "../../db/migrations") });
  const hash = await bcrypt.hash("test", 4);
  const [admin] = await db.insert(admins).values({ username: "admin", passwordHash: hash, createdAt: now }).returning({ id: admins.id });
  // Session expiry is checked against the real clock — use Date.now(), not the fixture `now`.
  await db.insert(sessions).values({ id: SESSION, adminId: admin!.id, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000 });
  await db.insert(seasons).values({
    id: 1, name: "2026", year: 2026, startDate: "2026-04-01", endDate: "2026-09-30",
    totalRounds: 20, playoffFormat: "x", harveyLiveEnabled: 1, createdAt: now,
  });
  await db.insert(players).values([
    { id: P1, name: "Stoll", isActive: 1, createdAt: now },
    { id: P2, name: "Teddy", isActive: 1, createdAt: now },
  ]);
  await db.insert(rounds).values([
    { id: RA, seasonId: 1, type: "official", status: "active", scheduledDate: "2026-06-26", tee: "blue", createdAt: now },
    { id: RF, seasonId: 1, type: "official", status: "finalized", scheduledDate: "2026-06-19", tee: "blue", createdAt: now - 1 },
  ]);
  await db.insert(groups).values([
    { id: 1, roundId: RA, groupNumber: 1 },
    { id: 2, roundId: RF, groupNumber: 1 },
  ]);
  await db.insert(roundPlayers).values([
    { roundId: RA, groupId: 1, playerId: P1, handicapIndex: 10, isSub: 0 },
    { roundId: RA, groupId: 1, playerId: P2, handicapIndex: 12, isSub: 0 },
    { roundId: RF, groupId: 2, playerId: P1, handicapIndex: 10, isSub: 0 },
    { roundId: RF, groupId: 2, playerId: P2, handicapIndex: 12, isSub: 0 },
  ]);
});

describe("admin GET /bets — round selection", () => {
  it("defaults to the active round and returns the full rounds list", async () => {
    const res = await betsAdminApp.request("/bets", { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminBoard;
    expect(body.round?.id).toBe(RA);
    expect(body.rounds.map((r) => r.id).sort()).toEqual([RA, RF]);
    expect(body.roster.map((p) => p.id).sort()).toEqual([P1, P2]);
  });

  it("?roundId=N scopes to a past (finalized) round", async () => {
    const res = await betsAdminApp.request(`/bets?roundId=${RF}`, { headers: auth() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdminBoard;
    expect(body.round?.id).toBe(RF);
    expect(body.round?.status).toBe("finalized");
  });

  it("requires auth", async () => {
    const res = await betsAdminApp.request("/bets");
    expect(res.status).toBe(401);
  });
});

describe("admin POST /bets — open-round gate", () => {
  let createdId: number;

  it("creates a bet on the active round", async () => {
    const res = await betsAdminApp.request("/bets", { method: "POST", headers: auth(), body: JSON.stringify(h2h()) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number };
    expect(body.id).toBeGreaterThan(0);
    createdId = body.id;
  });

  it("refuses to add a bet to a finalized round (422 round_not_open)", async () => {
    const res = await betsAdminApp.request("/bets", { method: "POST", headers: auth(), body: JSON.stringify(h2h(RF)) });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("round_not_open");
    // Nothing was written to the finalized round.
    const rfBets = await db.select().from(bets).where(eq(bets.roundId, RF));
    expect(rfBets).toHaveLength(0);
  });

  it("deletes a bet by id regardless of round state", async () => {
    const res = await betsAdminApp.request(`/bets/${createdId}`, { method: "DELETE", headers: auth() });
    expect(res.status).toBe(200);
    const remaining = await db.select().from(bets).where(eq(bets.id, createdId));
    expect(remaining).toHaveLength(0);
  });
});
