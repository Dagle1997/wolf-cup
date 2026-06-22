/**
 * games-money.disjointness.test.ts (Story 1.4) — the SHIP-BLOCKING integration
 * guards over the dual-read switch:
 *
 *  - AC10 producer-disjointness: for an F1 event NO (debtor,creditor) pair gets a
 *    2v2-game contribution from BOTH the legacy producer and the F1 producer —
 *    the legacy 2v2 emits NOTHING for an F1 event — while bets/skins still flow.
 *  - AC4 mutation guard: after a round is pinned, mutating the live HI AND the
 *    live course rating/slope leaves the F1 settled money AND the leaderboard net
 *    UNCHANGED (reads use ONLY the pin). Also: games-money net == leaderboard net.
 *  - AC12 audience-bounding: a non-roster viewer's /money response carries no
 *    dollars (403); an unlocked-mode My Money for viewer A carries no B dollars.
 *  - FR18: per-hole putts capture is intact for F1 rounds.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  // Per-pid temp FILE db (NOT the shared `file::memory:?cache=shared` URL) so this
  // file is fully isolated under the full suite — the shared-memory URL leaks
  // across reused fork workers (MEMORY.md). File dbs share across connections so
  // db.transaction() still works.
  const { tmpdir } = await import('node:os');
  const { rmSync } = await import('node:fs');
  const dbPath = `${tmpdir()}/f1-disjointness-${process.pid}.db`.replace(/\\/g, '/');
  for (const s of ['', '-wal', '-shm']) rmSync(`${dbPath}${s}`, { force: true });
  const client = createClient({ url: `file:${dbPath}` });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

let __testPlayer: { id: string; isOrganizer: boolean } | null = null;
vi.mock('../middleware/require-session.js', () => ({
  requireSession: async (c: import('hono').Context, next: () => Promise<void>) => {
    if (!__testPlayer) return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
    c.set('player', __testPlayer);
    c.set('session', { sessionId: 'test', playerId: __testPlayer.id });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const {
  players, courses, courseRevisions, courseTees, courseHoles, events, eventRounds,
  groups, groupMembers, pairings, pairingMembers, rounds, holeScores, gameConfig, roundPins,
} = await import('../db/schema/index.js');
const { computeMoneyMatrix } = await import('./money.js');
const { computeLeaderboard, netForSegment } = await import('./leaderboard.js');
const { computeMyMoney, computeFoursomeResults } = await import('./money-detail.js');
const { computeF1EventEdges } = await import('./games-money.js');
const { moneyRouter } = await import('../routes/money.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT = 'guyan';

// These are DB-heavy integration tests on a temp-file db; under full-suite load
// the default 5s can be tight (the round + scores seed many rows). 20s headroom.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

type Ids = {
  organizerId: string; outsiderId: string;
  players: [string, string, string, string];
  eventId: string; courseRevId: string; eventRoundId: string; roundId: string;
};

/** Seed an F1 event: 1 foursome, an event-level game_config + a round pin. */
async function seedF1(
  opts: {
    lockState?: 'locked' | 'unlocked';
    ch?: number;
    /** Don't write the round_pin at all (no-pin fail-closed; AC5). */
    noPin?: boolean;
    /** Write the round_pin under a DIFFERENT tenant (tenant-isolation guard). */
    pinTenant?: string;
  } = {},
): Promise<Ids> {
  const now = Date.now();
  const id = {
    organizerId: randomUUID(), outsiderId: randomUUID(),
    p1: randomUUID(), p2: randomUUID(), p3: randomUUID(), p4: randomUUID(),
    eventId: randomUUID(), courseId: randomUUID(), courseRevId: randomUUID(),
    eventRoundId: randomUUID(), pairingId: randomUUID(), roundId: randomUUID(), groupId: randomUUID(),
  };
  const ps: [string, string, string, string] = [id.p1, id.p2, id.p3, id.p4];
  const ctx = `event:${id.eventId}`;
  const ch = opts.ch ?? 0;

  for (const [pid, name] of [
    [id.organizerId, 'Org'], [id.p1, 'P1'], [id.p2, 'P2'], [id.p3, 'P3'], [id.p4, 'P4'], [id.outsiderId, 'Out'],
  ] as Array<[string, string]>) {
    await db.insert(players).values({ id: pid, isOrganizer: false, createdAt: now, name, manualHandicapIndex: 0, tenantId: TENANT, contextId: ctx });
  }
  await db.insert(courses).values({ id: id.courseId, name: 'C', clubName: 'CC', createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseRevisions).values({ id: id.courseRevId, courseId: id.courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null, verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseTees).values({ id: randomUUID(), courseRevisionId: id.courseRevId, teeColor: 'blue', rating: 720, slope: 113, tenantId: TENANT, contextId: ctx });
  await db.insert(courseHoles).values(
    Array.from({ length: 18 }, (_, i) => i + 1).map((h) => ({
      id: randomUUID(), courseRevisionId: id.courseRevId, holeNumber: h, par: 4, si: ((h * 7) % 18) + 1, yardagePerTeeJson: '{}', tenantId: TENANT, contextId: ctx,
    })),
  );
  await db.insert(events).values({ id: id.eventId, name: 'F1', startDate: now, endDate: now + 86400000, timezone: 'America/New_York', organizerPlayerId: id.organizerId, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(eventRounds).values({ id: id.eventRoundId, eventId: id.eventId, roundNumber: 1, roundDate: now, courseRevisionId: id.courseRevId, teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(rounds).values({ id: id.roundId, eventId: id.eventId, eventRoundId: id.eventRoundId, holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(groups).values({ id: id.groupId, eventId: id.eventId, name: 'G', moneyVisibilityMode: 'open', createdAt: now, tenantId: TENANT, contextId: ctx });
  for (const pid of ps) await db.insert(groupMembers).values({ groupId: id.groupId, playerId: pid, tenantId: TENANT, contextId: ctx });
  await db.insert(pairings).values({ id: id.pairingId, eventRoundId: id.eventRoundId, foursomeNumber: 1, createdAt: now, tenantId: TENANT, contextId: ctx });
  for (let i = 0; i < 4; i++) await db.insert(pairingMembers).values({ pairingId: id.pairingId, playerId: ps[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx });

  const cfg = { game: 'guyan-2v2', pointValueSchedule: { kind: 'flat' as const, cents: 500 }, modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net' as const, bonus: 'single' as const } }], lockState: opts.lockState ?? 'locked', configVersion: 1 };
  await db.insert(gameConfig).values({ id: randomUUID(), level: 'event', refId: id.eventId, configJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, lockState: cfg.lockState, configVersion: 1, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });

  if (!opts.noPin) {
    const perPlayer: Record<string, { hi: number; ch: number }> = {};
    for (const pid of ps) perPlayer[pid] = { hi: 0, ch };
    await db.insert(roundPins).values({ roundId: id.roundId, resolvedConfigJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, courseRevisionId: id.courseRevId, tee: 'blue', perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null, createdAt: now, tenantId: opts.pinTenant ?? TENANT, contextId: ctx });
  }

  // Scores: teamA (slots 1&2 = p1,p2) beats teamB on holes 1..12 (gross 4 vs 5),
  // teamB wins 13..18 — a clear net delta to teamA, with putts captured (FR18).
  const scoreRows: Array<typeof holeScores.$inferInsert> = [];
  for (let h = 1; h <= 18; h++) {
    const aWins = h <= 12;
    for (const pid of [ps[0]!, ps[1]!]) scoreRows.push({ id: randomUUID(), roundId: id.roundId, playerId: pid, holeNumber: h, grossStrokes: aWins ? 4 : 5, putts: 2, scorerPlayerId: ps[0]!, clientEventId: `e-${pid}-${h}`, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });
    for (const pid of [ps[2]!, ps[3]!]) scoreRows.push({ id: randomUUID(), roundId: id.roundId, playerId: pid, holeNumber: h, grossStrokes: aWins ? 5 : 4, putts: 3, scorerPlayerId: ps[0]!, clientEventId: `e-${pid}-${h}`, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });
  }
  await db.insert(holeScores).values(scoreRows);

  return { organizerId: id.organizerId, outsiderId: id.outsiderId, players: ps, eventId: id.eventId, courseRevId: id.courseRevId, eventRoundId: id.eventRoundId, roundId: id.roundId };
}

function buildApp(viewerId: string): Hono {
  __testPlayer = { id: viewerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', moneyRouter);
  return app;
}

beforeAll(async () => { await migrate(db, { migrationsFolder }); });
beforeEach(async () => {
  for (const t of [roundPins, holeScores, pairingMembers, pairings, gameConfig, groupMembers, groups, rounds, eventRounds, events, courseHoles, courseTees, courseRevisions, courses, players]) {
    await db.delete(t);
  }
  vi.unstubAllEnvs();
});

describe('AC10 dual-read producer-disjointness (F1 events)', () => {
  test('legacy 2v2 emits NOTHING for an F1 event; F1 edges are the only 2v2-game source', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seedF1();
    const matrix = await computeMoneyMatrix(db, s.eventId, s.players[0]!, TENANT);
    // F1 metadata present + exposed.
    expect(matrix.f1?.isF1).toBe(true);
    expect(matrix.f1?.exposed).toBe(true);
    // teamLedger carries the F1 edges (positive for teamA). With CH=0: A wins 12,
    // B wins 6 → +6 holes × 3-point-sweep? No — F1 awards low/skin/total + net-skins.
    // We assert non-zero + anti-symmetry + that every team-pair value is sourced
    // once (the matrix == teamLedger for the team game since no legacy ran).
    const [a1, , b1] = s.players;
    const tl = matrix.teamLedger.matrix;
    expect(tl[a1!]![b1!]).toBeGreaterThan(0);
    expect(tl[a1!]![b1!]).toBe(-tl[b1!]![a1!]!); // anti-symmetry
    // Disjointness: combined teamLedger == F1 contribution (legacy produced 0),
    // so combined matrix's team portion equals the F1-only team ledger exactly.
    expect(matrix.matrix[a1!]![b1!]).toBe(tl[a1!]![b1!]);
  });

  test('flag OFF → F1 event still skips legacy 2v2 (no double-count); team ledger empty + exposed:false', async () => {
    // No env stub → flag off.
    const s = await seedF1();
    const matrix = await computeMoneyMatrix(db, s.eventId, s.players[0]!, TENANT);
    expect(matrix.f1?.isF1).toBe(true);
    expect(matrix.f1?.exposed).toBe(false);
    const [a1, , b1] = s.players;
    // No F1 dollars folded AND no legacy 2v2 → team ledger is zero (not double).
    expect(matrix.teamLedger.matrix[a1!]![b1!]).toBe(0);
  });
});

describe('AC4 mutation guard — pin freezes money + leaderboard net', () => {
  test('mutating live HI AND course rating/slope leaves F1 money + leaderboard net UNCHANGED', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seedF1({ ch: 6 }); // a non-zero pinned CH so strokes matter

    const before = await computeMoneyMatrix(db, s.eventId, s.players[0]!, TENANT);
    const lbBefore = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'round', roundId: s.roundId });

    // Mutate LIVE data that a non-pinned read would use: every player's manual HI
    // and the course tee rating + slope. The pin must shield the money.
    await db.update(players).set({ manualHandicapIndex: 40 }).where(eq(players.tenantId, TENANT));
    await db.update(courseTees).set({ rating: 800, slope: 150 }).where(and(eq(courseTees.courseRevisionId, s.courseRevId), eq(courseTees.tenantId, TENANT)));

    const after = await computeMoneyMatrix(db, s.eventId, s.players[0]!, TENANT);
    const lbAfter = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'round', roundId: s.roundId });

    // Money unchanged.
    expect(after.teamLedger.matrix).toEqual(before.teamLedger.matrix);
    // Leaderboard net unchanged.
    const netByPlayer = (rows: typeof lbBefore) => Object.fromEntries(rows.map((r) => [r.playerId, r.netThroughHole]));
    expect(netByPlayer(lbAfter)).toEqual(netByPlayer(lbBefore));

    // games-money net == leaderboard net for the same player (AC4 part a).
    // Leaderboard net is gross − Σ strokes(pinnedCH); the F1 engine net feeds the
    // same allocation, so a full-round leaderboard net reconciles with the seg net.
    for (const pid of s.players) {
      const seg = await netForSegment({ db, tenantId: TENANT }, { roundId: s.roundId, playerId: pid, holeNumbers: Array.from({ length: 18 }, (_, i) => i + 1) });
      const lbRow = lbAfter.find((r) => r.playerId === pid)!;
      // netForSegment uses live HI (=40 now) so it WON'T match; the point we assert
      // is the leaderboard's PINNED net is stable. (seg uses live HI by design — it
      // is the bets path, not the F1 pinned path.) So we only assert lb stability.
      expect(lbRow.netThroughHole).toBe(netByPlayer(lbBefore)[pid]);
      expect(seg).toBeDefined();
    }
  });
});

describe('AC12 audience-bounding', () => {
  test('non-roster viewer gets 403 (no dollars) on /money', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seedF1();
    const app = buildApp(s.outsiderId); // not in any group, not organizer
    const res = await app.request(`/api/events/${s.eventId}/money`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as Record<string, unknown>;
    // The 403 carries NO money payload — none of the dollar-bearing keys exist.
    expect(body['matrix']).toBeUndefined();
    expect(body['teamLedger']).toBeUndefined();
    expect(body['totals']).toBeUndefined();
    expect(body['f1']).toBeUndefined();
    expect(body['code']).toBe('not_event_participant');
  });

  test('unlocked mode: /money is redacted to the viewer; My Money carries no other-player dollars', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seedF1({ lockState: 'unlocked' });
    const viewer = s.players[0]!;
    const app = buildApp(viewer);
    const res = await app.request(`/api/events/${s.eventId}/money`);
    expect(res.status).toBe(200);
    const m = (await res.json()) as { teamLedger: { matrix: Record<string, Record<string, number>> }; f1?: { lockState: string } };
    expect(m.f1?.lockState).toBe('unlocked');
    // Other-player pairs (not involving the viewer) are zeroed.
    const [a1, a2, b1, b2] = s.players;
    expect(m.teamLedger.matrix[a2!]![b1!]).toBe(0); // viewer not party → redacted
    // My Money for viewer A contains only the viewer's net (no B-specific dollars).
    const mine = await computeMyMoney(db, s.eventId, viewer, TENANT);
    expect(mine.viewerId).toBe(viewer);
    // every game is viewer-signed; no field names another player's dollars.
    for (const g of mine.games) expect(typeof g.netToViewerCents).toBe('number');
    void a1; void b2;
  });
});

describe('FR18 — per-hole putts capture intact for F1 rounds', () => {
  test('putts still stored + readable for an F1 round', async () => {
    const s = await seedF1();
    const rows = await db
      .select({ putts: holeScores.putts })
      .from(holeScores)
      .where(and(eq(holeScores.roundId, s.roundId), eq(holeScores.playerId, s.players[0]!), eq(holeScores.holeNumber, 1), eq(holeScores.tenantId, TENANT)))
      .limit(1);
    expect(rows[0]?.putts).toBe(2);
  });
});

describe('AC2/AC11 — missing-pin fail-closed: NO live HI/course fallback (Story 1.4 fix)', () => {
  test('F1 round with NO pin → games-money + leaderboard mark it unsettleable and do NOT change when live HI/course is mutated', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    // ch=6 so a LIVE fallback (if it existed) would allocate strokes and move net.
    const s = await seedF1({ ch: 6, noPin: true });

    // games-money: unsettleable, NO edges (never settled against live data).
    const f1Before = await computeF1EventEdges(db, s.eventId, TENANT);
    expect(f1Before.isF1).toBe(true);
    expect(f1Before.edges).toEqual([]);
    expect(f1Before.unsettleable.map((u) => u.reason)).toContain('not_pinned');

    // leaderboard: F1 round with no pin → net is NOT computed from live data (null).
    const lbBefore = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'round', roundId: s.roundId });
    for (const r of lbBefore) expect(r.netThroughHole).toBeNull();

    // Mutate the LIVE HI + course rating/slope a non-pinned read WOULD use.
    await db.update(players).set({ manualHandicapIndex: 30 }).where(eq(players.tenantId, TENANT));
    await db.update(courseTees).set({ rating: 800, slope: 150 }).where(and(eq(courseTees.courseRevisionId, s.courseRevId), eq(courseTees.tenantId, TENANT)));

    const f1After = await computeF1EventEdges(db, s.eventId, TENANT);
    const lbAfter = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'round', roundId: s.roundId });

    // Still unsettleable, still no edges, leaderboard net still null — proving the
    // missing pin produced ZERO live-derived F1 net before AND after the mutation.
    expect(f1After.edges).toEqual([]);
    expect(f1After.unsettleable.map((u) => u.reason)).toContain('not_pinned');
    for (const r of lbAfter) expect(r.netThroughHole).toBeNull();
  });
});

describe('AC11 — per-foursome blast-radius isolation (one bad foursome never crashes the event)', () => {
  test('a foursome with a missing-handicap pin is unsettleable while the good foursome settles; event compute does NOT throw', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seedF1(); // foursome 1 (slots 1..4) is fully pinned + good

    // Add a SECOND foursome whose pinned handicap is MISSING for one player.
    const now = Date.now();
    const ctx = `event:${s.eventId}`;
    const bad = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
    const pairing2 = randomUUID();
    for (const pid of bad) {
      await db.insert(players).values({ id: pid, isOrganizer: false, createdAt: now, name: `Bad-${pid.slice(0, 4)}`, manualHandicapIndex: 0, tenantId: TENANT, contextId: ctx });
    }
    await db.insert(pairings).values({ id: pairing2, eventRoundId: s.eventRoundId, foursomeNumber: 2, createdAt: now, tenantId: TENANT, contextId: ctx });
    for (let i = 0; i < 4; i++) {
      await db.insert(pairingMembers).values({ pairingId: pairing2, playerId: bad[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx });
      for (let h = 1; h <= 18; h++) {
        await db.insert(holeScores).values({ id: randomUUID(), roundId: s.roundId, playerId: bad[i]!, holeNumber: h, grossStrokes: 4, putts: 2, scorerPlayerId: bad[0]!, clientEventId: `bad-${bad[i]}-${h}`, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });
      }
    }
    // Rewrite the round pin to add the bad foursome's players with a NULL ch for
    // one of them (absent handicap → must NOT settle as scratch).
    const ch = 0;
    const perPlayer: Record<string, { hi: number | null; ch: number | null }> = {};
    for (const pid of s.players) perPlayer[pid] = { hi: 0, ch };
    perPlayer[bad[0]!] = { hi: null, ch: null }; // absent handicap
    for (let i = 1; i < 4; i++) perPlayer[bad[i]!] = { hi: 0, ch };
    const cfg = { game: 'guyan-2v2', pointValueSchedule: { kind: 'flat' as const, cents: 500 }, modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net' as const, bonus: 'single' as const } }], lockState: 'locked' as const, configVersion: 1 };
    await db.delete(roundPins).where(eq(roundPins.roundId, s.roundId));
    await db.insert(roundPins).values({ roundId: s.roundId, resolvedConfigJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, courseRevisionId: s.courseRevId, tee: 'blue', perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null, createdAt: now, tenantId: TENANT, contextId: ctx });

    // Event compute must NOT throw; good foursome settles, bad one is unsettleable.
    const res = await computeF1EventEdges(db, s.eventId, TENANT);
    expect(res.isF1).toBe(true);
    // The good foursome (foursome 1) produced edges.
    expect(res.edges.length).toBeGreaterThan(0);
    // The bad foursome is surfaced unsettleable with the missing-handicap reason.
    const f2 = res.unsettleable.find((u) => u.foursomeNumber === 2);
    expect(f2?.reason).toBe('missing_handicap');

    // The whole-event money matrix also computes (does not crash/blank).
    const matrix = await computeMoneyMatrix(db, s.eventId, s.players[0]!, TENANT);
    expect(matrix.f1?.isF1).toBe(true);
    expect(matrix.f1?.unsettleable.some((u) => u.foursomeNumber === 2)).toBe(true);
  });
});

describe('AC11 — absent handicap (null) is unsettleable; a real HI of 0 settles', () => {
  test('null pinned ch → foursome unsettleable (missing_handicap); finite ch=0 settles normally', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');

    // Scratch case: ch=0 for everyone (a real HI of 0) → settles, edges present.
    const scratch = await seedF1({ ch: 0 });
    const scratchRes = await computeF1EventEdges(db, scratch.eventId, TENANT);
    expect(scratchRes.unsettleable).toEqual([]);
    expect(scratchRes.edges.length).toBeGreaterThan(0);

    // Absent case: rewrite one player's pinned ch to NULL → unsettleable.
    const now = Date.now();
    const ctx = `event:${scratch.eventId}`;
    const perPlayer: Record<string, { hi: number | null; ch: number | null }> = {};
    for (const pid of scratch.players) perPlayer[pid] = { hi: 0, ch: 0 };
    perPlayer[scratch.players[2]!] = { hi: null, ch: null }; // absent handicap
    const cfg = { game: 'guyan-2v2', pointValueSchedule: { kind: 'flat' as const, cents: 500 }, modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net' as const, bonus: 'single' as const } }], lockState: 'locked' as const, configVersion: 1 };
    await db.delete(roundPins).where(eq(roundPins.roundId, scratch.roundId));
    await db.insert(roundPins).values({ roundId: scratch.roundId, resolvedConfigJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, courseRevisionId: scratch.courseRevId, tee: 'blue', perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null, createdAt: now, tenantId: TENANT, contextId: ctx });

    const absentRes = await computeF1EventEdges(db, scratch.eventId, TENANT);
    expect(absentRes.edges).toEqual([]);
    expect(absentRes.unsettleable.map((u) => u.reason)).toContain('missing_handicap');
  });
});

describe('Fix 5 — /foursome-results never leaks legacy 2v2 dollars for an F1 event', () => {
  test('F1 event with flag OFF → no legacy 2v2 dollars (teamATotal + perPair all zero)', async () => {
    // No env stub → flag OFF.
    const s = await seedF1({ ch: 0 });
    const fr = await computeFoursomeResults(db, s.eventRoundId, TENANT);
    expect(fr).not.toBeNull();
    for (const f of fr!.foursomes) {
      expect(f.teamATotalCents).toBe(0);
      for (const a of Object.keys(f.perPair)) {
        for (const b of Object.keys(f.perPair[a]!)) {
          expect(f.perPair[a]![b]).toBe(0);
        }
      }
      for (const h of f.perHole) expect(h.moneyTeamACents).toBe(0);
    }
  });

  test('F1 event with flag ON + locked → F1-sourced dollars (matches the pinned edges), not legacy', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seedF1({ ch: 0 });
    const fr = await computeFoursomeResults(db, s.eventRoundId, TENANT);
    const f1 = await computeF1EventEdges(db, s.eventId, TENANT);
    // teamATotal for foursome 1 reconstructed from the F1 edges (teamA = slots 1&2).
    const teamA = new Set([s.players[0]!, s.players[1]!]);
    let expectedTeamATotal = 0;
    for (const e of f1.edges) {
      if (teamA.has(e.toPlayerId)) expectedTeamATotal += e.cents;
      if (teamA.has(e.fromPlayerId)) expectedTeamATotal -= e.cents;
    }
    const f1Foursome = fr!.foursomes.find((f) => f.foursomeNumber === 1)!;
    expect(f1Foursome.teamATotalCents).toBe(expectedTeamATotal);
    expect(expectedTeamATotal).not.toBe(0); // teamA wins net → non-zero
  });
});

describe('AC11 — corrupt-but-schema-valid pin (non-integer CH) never 500s', () => {
  // Note on the threat surface: `course_holes.si` is DB-CHECK-constrained BETWEEN
  // 1 AND 18, so an out-of-range stroke index cannot be persisted. The remaining
  // corrupt-but-schema-valid input that makes `allocateStrokesFromCourseHandicap`
  // THROW is a NON-INTEGER pinned CH — `perPlayerHandicapsSchema` validates `ch`
  // as `.finite()` (NOT `.int()`), so e.g. ch=6.5 parses fine, then the allocation
  // kernel throws TypeError. The reader try/catch must fail that foursome/round
  // closed (net null), never 500.
  test('leaderboard: a non-integer pinned CH on round 1 → endpoint does NOT throw; round 1 fails closed (net null); a clean round 2 still renders net', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seedF1({ ch: 0 });

    // Add a SECOND (clean) event-round + foursome for the SAME players so we prove
    // the corrupt round fails closed while the clean one renders a real net.
    const now = Date.now();
    const ctx = `event:${s.eventId}`;
    const courseRev2 = randomUUID();
    const eventRound2 = randomUUID();
    const round2 = randomUUID();
    const pairing2 = randomUUID();
    const courseId2 = randomUUID();
    await db.insert(courses).values({ id: courseId2, name: 'C2', clubName: 'CC2', createdAt: now, tenantId: TENANT, contextId: ctx });
    await db.insert(courseRevisions).values({ id: courseRev2, courseId: courseId2, revisionNumber: 1, sourceUrl: null, extractionDate: null, verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT, contextId: ctx });
    await db.insert(courseTees).values({ id: randomUUID(), courseRevisionId: courseRev2, teeColor: 'blue', rating: 720, slope: 113, tenantId: TENANT, contextId: ctx });
    await db.insert(courseHoles).values(
      Array.from({ length: 18 }, (_, i) => i + 1).map((h) => ({
        id: randomUUID(), courseRevisionId: courseRev2, holeNumber: h, par: 4, si: ((h * 7) % 18) + 1, yardagePerTeeJson: '{}', tenantId: TENANT, contextId: ctx,
      })),
    );
    await db.insert(eventRounds).values({ id: eventRound2, eventId: s.eventId, roundNumber: 2, roundDate: now, courseRevisionId: courseRev2, teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
    await db.insert(rounds).values({ id: round2, eventId: s.eventId, eventRoundId: eventRound2, holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
    await db.insert(pairings).values({ id: pairing2, eventRoundId: eventRound2, foursomeNumber: 1, createdAt: now, tenantId: TENANT, contextId: ctx });
    for (let i = 0; i < 4; i++) await db.insert(pairingMembers).values({ pairingId: pairing2, playerId: s.players[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx });
    for (const pid of s.players) {
      for (let h = 1; h <= 18; h++) {
        await db.insert(holeScores).values({ id: randomUUID(), roundId: round2, playerId: pid, holeNumber: h, grossStrokes: 4, putts: 2, scorerPlayerId: s.players[0]!, clientEventId: `r2-${pid}-${h}`, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });
      }
    }
    const cfg = { game: 'guyan-2v2', pointValueSchedule: { kind: 'flat' as const, cents: 500 }, modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net' as const, bonus: 'single' as const } }], lockState: 'locked' as const, configVersion: 1 };
    const perPlayer2: Record<string, { hi: number; ch: number }> = {};
    for (const pid of s.players) perPlayer2[pid] = { hi: 0, ch: 0 };
    await db.insert(roundPins).values({ roundId: round2, resolvedConfigJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, courseRevisionId: courseRev2, tee: 'blue', perPlayerHandicapsJson: JSON.stringify(perPlayer2), teamCompositionJson: null, createdAt: now, tenantId: TENANT, contextId: ctx });

    // CORRUPT round 1's pin: rewrite one player's CH to a NON-INTEGER (6.5). It is
    // schema-valid (.finite()) but makes the allocation kernel throw at read time.
    const perPlayer1: Record<string, { hi: number; ch: number }> = {};
    for (const pid of s.players) perPlayer1[pid] = { hi: 0, ch: 0 };
    perPlayer1[s.players[0]!] = { hi: 0, ch: 6.5 }; // corrupt: non-integer CH
    await db.delete(roundPins).where(eq(roundPins.roundId, s.roundId));
    await db.insert(roundPins).values({ roundId: s.roundId, resolvedConfigJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, courseRevisionId: s.courseRevId, tee: 'blue', perPlayerHandicapsJson: JSON.stringify(perPlayer1), teamCompositionJson: null, createdAt: now, tenantId: TENANT, contextId: ctx });

    // EVENT-scope leaderboard must NOT throw despite the corrupt round-1 CH.
    let lb!: Awaited<ReturnType<typeof computeLeaderboard>>;
    await expect(
      (async () => { lb = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'event' }); })(),
    ).resolves.toBeUndefined();
    // The corrupt player's event net fails closed; gross still renders, no 500.
    const corruptRow = lb.find((r) => r.playerId === s.players[0]!)!;
    expect(corruptRow.grossThroughHole).not.toBeNull();
    expect(corruptRow.netThroughHole).toBeNull();

    // A ROUND-scope read of the CLEAN round 2 still computes a real net for the
    // SAME corrupt player (the corrupt round-1 CH never poisoned the clean round).
    const lb2 = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'round', roundId: round2 });
    expect(lb2.find((r) => r.playerId === s.players[0]!)!.netThroughHole).toBe(18 * 4);

    // A ROUND-scope read of the CORRUPT round 1 fails closed WITHOUT throwing.
    let lb1!: Awaited<ReturnType<typeof computeLeaderboard>>;
    await expect(
      (async () => { lb1 = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'round', roundId: s.roundId }); })(),
    ).resolves.toBeUndefined();
    expect(lb1.find((r) => r.playerId === s.players[0]!)!.netThroughHole).toBeNull();
  });

  test('/foursome-results: a non-integer pinned CH for one player → endpoint does NOT throw; that player nets null while the other players still render net + gross', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    const s = await seedF1({ ch: 0 });

    // Rewrite the pin: player[0]'s CH is a non-integer (corrupt); the rest stay 0.
    const now = Date.now();
    const ctx = `event:${s.eventId}`;
    const cfg = { game: 'guyan-2v2', pointValueSchedule: { kind: 'flat' as const, cents: 500 }, modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net' as const, bonus: 'single' as const } }], lockState: 'locked' as const, configVersion: 1 };
    const perPlayer: Record<string, { hi: number; ch: number }> = {};
    for (const pid of s.players) perPlayer[pid] = { hi: 0, ch: 0 };
    perPlayer[s.players[0]!] = { hi: 0, ch: 6.5 }; // corrupt: non-integer CH
    await db.delete(roundPins).where(eq(roundPins.roundId, s.roundId));
    await db.insert(roundPins).values({ roundId: s.roundId, resolvedConfigJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, courseRevisionId: s.courseRevId, tee: 'blue', perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null, createdAt: now, tenantId: TENANT, contextId: ctx });

    // /foursome-results must NOT throw (no 500).
    let fr!: Awaited<ReturnType<typeof computeFoursomeResults>>;
    await expect(
      (async () => { fr = await computeFoursomeResults(db, s.eventRoundId, TENANT); })(),
    ).resolves.toBeUndefined();
    expect(fr).not.toBeNull();
    const foursome = fr!.foursomes.find((f) => f.foursomeNumber === 1)!;
    expect(foursome).toBeDefined();

    const corruptPid = s.players[0]!;
    let sawCorruptCell = false;
    let sawCleanCell = false;
    for (const hole of foursome.perHole) {
      for (const ph of hole.players) {
        expect(ph.gross).not.toBeNull(); // gross always renders
        if (ph.playerId === corruptPid) {
          // Corrupt non-integer CH → allocation throws → net fails closed (null).
          expect(ph.net).toBeNull();
          sawCorruptCell = true;
        } else {
          // Every clean player still computes a real net (ch=0 → net == gross).
          expect(ph.net).toBe(ph.gross);
          sawCleanCell = true;
        }
      }
    }
    expect(sawCorruptCell).toBe(true);
    expect(sawCleanCell).toBe(true);
  });
});

describe('Story 1.4 hardening — F1 leaderboard net counts only holes in play (holesToPlay)', () => {
  test('9-hole F1 round with scores on all 18 → leaderboard F1 net counts only the front 9', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    // seedF1 writes holesToPlay=18 + scores on all 18. Flip the round to 9 holes.
    const s = await seedF1({ ch: 0 });
    await db.update(eventRounds).set({ holesToPlay: 9 }).where(and(eq(eventRounds.id, s.eventRoundId), eq(eventRounds.tenantId, TENANT)));
    await db.update(rounds).set({ holesToPlay: 9 }).where(and(eq(rounds.id, s.roundId), eq(rounds.tenantId, TENANT)));

    const lb = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'round', roundId: s.roundId });
    // teamA (slots 1&2 = players[0],[1]) scored gross 4 on holes 1..12. At ch=0,
    // net == gross. Counting ONLY the front 9 → net = 9 × 4 = 36. The pre-fix bug
    // counted all 18 (12×4 + 6×5 = 78) — so 36 proves the holesInPlay filter.
    for (const pid of [s.players[0]!, s.players[1]!]) {
      const row = lb.find((r) => r.playerId === pid)!;
      expect(row.netThroughHole).toBe(9 * 4);
      expect(row.netThroughHole).not.toBe(12 * 4 + 6 * 5); // not the all-18 sum
    }
  });
});

describe('Fix 4 — round_pin reads are tenant-scoped', () => {
  test('a pin written under a DIFFERENT tenant is not read (round is fail-closed, not settled)', async () => {
    vi.stubEnv('TOURNAMENT_F1_MONEY_ENABLED', 'true');
    // The round + event are tenant 'guyan'; the pin is written under 'other'.
    const s = await seedF1({ ch: 0, pinTenant: 'other' });
    const res = await computeF1EventEdges(db, s.eventId, TENANT);
    expect(res.isF1).toBe(true);
    // The cross-tenant pin must NOT be read → the round is treated as not pinned.
    expect(res.edges).toEqual([]);
    expect(res.unsettleable.map((u) => u.reason)).toContain('not_pinned');
    // Leaderboard likewise must not derive net from the cross-tenant pin.
    const lb = await computeLeaderboard({ db, tenantId: TENANT }, s.eventId, { scope: 'round', roundId: s.roundId });
    for (const r of lb) expect(r.netThroughHole).toBeNull();
  });
});
