/**
 * games-money.offlow.test.ts — REAL off-the-low money proof (Pete Dye Guyan 2v2).
 *
 * The Story-1.4 golden gate (`games-money.test.ts`) pins every player at CH = 0,
 * so the foursome low is 0 and the allowance/off-the-low step is a NO-OP — those
 * fixtures cannot tell off-low settlement apart from full-CH settlement. This
 * file closes that gap with a foursome whose low man is NON-ZERO, where off-low
 * changes which team wins a hole and therefore the settled cents.
 *
 * The whole point is a regression guard: if `settleFoursome` ever reverts from
 * `applyAllowanceOffLow(...).offLow` back to allocating strokes from the full
 * pinned CH, the asserted ±$15 collapses to ±$5 and these tests FAIL.
 *
 * Scoring model (from the base-flat golden fixture): each hole awards 3 team
 * points (low ball / skin[winner net ≤ par] / team total) + a net-skins bonus;
 * pointValue here is $5/point; fromPlayerId PAYS toPlayerId.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { GameConfig } from '../engine/games/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = OFF');
  return { client, db };
});

const { db, client } = await import('../db/index.js');
const {
  players,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  events,
  eventRounds,
  pairings,
  pairingMembers,
  rounds,
  holeScores,
  gameConfig,
  roundPins,
} = await import('../db/schema/index.js');
const { computeF1EventEdges, computeF1PerPlayerNet } = await import('./games-money.js');
const { computeFoursomeResults } = await import('./money-detail.js');
const { computeTeamStandings } = await import('./team-standings.js');

const TENANT = 'guyan';

// Base config: Guyan 2v2, flat $5/point, net-skins single (matches the golden
// base-flat fixture). The off-low tests vary only `handicapAllowancePct`.
const BASE_CONFIG: GameConfig = {
  scope: 'foursome',
  game: 'guyan-2v2',
  pointValueSchedule: { kind: 'flat', cents: 500 },
  modifiers: [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }],
  lockState: 'locked',
  configVersion: 1,
};

type SeedInput = {
  /** Pinned FULL course handicap per player (the allowance/off-low is applied on read). */
  chByPlayer: Record<string, number>;
  /** Allowance % to freeze into the pin's resolved config (undefined → engine treats as 100). */
  allowancePct?: number;
  /** holeNumber → { playerId → grossStrokes }. */
  grossByHole: Record<number, Record<string, number>>;
  /** holeNumber → par. */
  parByHole: Record<number, number>;
  /** holeNumber → stroke index (controls the allocation directly — no harness formula). */
  siByHole: Record<number, number>;
};

const TEAM_A = ['a1', 'a2'] as const;
const TEAM_B = ['b1', 'b2'] as const;
const ALL = [...TEAM_A, ...TEAM_B];

async function reset() {
  await db.delete(roundPins);
  await db.delete(holeScores);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(gameConfig);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
}

async function seed(input: SeedInput) {
  const now = Date.now();
  const ids = {
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    eventRoundId: randomUUID(),
    pairingId: randomUUID(),
    roundId: randomUUID(),
  };
  const ctx = `event:${ids.eventId}`;

  for (const pid of ALL) {
    await db.insert(players).values({
      id: pid, isOrganizer: false, createdAt: now, name: pid, manualHandicapIndex: 0,
      tenantId: TENANT, contextId: ctx,
    });
  }
  await db.insert(courses).values({ id: ids.courseId, name: 'C', clubName: 'CC', createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null,
    verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT, contextId: ctx,
  });
  await db.insert(courseTees).values({
    id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue', rating: 720, slope: 113,
    tenantId: TENANT, contextId: ctx,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: ids.courseRevId, holeNumber: h,
      par: input.parByHole[h] ?? 4, si: input.siByHole[h] ?? (((h * 7) % 18) + 1),
      yardagePerTeeJson: '{}', tenantId: TENANT, contextId: ctx,
    });
  }
  await db.insert(events).values({
    id: ids.eventId, name: 'F1', startDate: now, endDate: now + 86400000, timezone: 'America/New_York',
    organizerPlayerId: ALL[0]!, createdAt: now, tenantId: TENANT, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId, holesToPlay: 18, createdAt: now,
    tenantId: TENANT, contextId: ctx,
  });
  await db.insert(pairings).values({
    id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1, createdAt: now, tenantId: TENANT, contextId: ctx,
  });
  for (let i = 0; i < ALL.length; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: ALL[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx,
    });
  }

  const cfg: GameConfig = {
    ...BASE_CONFIG,
    ...(input.allowancePct !== undefined ? { handicapAllowancePct: input.allowancePct } : {}),
  };
  await db.insert(gameConfig).values({
    id: randomUUID(), level: 'event', refId: ids.eventId, configJson: JSON.stringify(cfg),
    seedRuleSetRevisionId: null, lockState: 'locked', configVersion: cfg.configVersion,
    createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx,
  });

  // Pin: FULL CH per player + the resolved config (carrying the allowance %).
  const perPlayer: Record<string, { hi: number; ch: number }> = {};
  for (const pid of ALL) perPlayer[pid] = { hi: 0, ch: input.chByPlayer[pid] ?? 0 };
  await db.insert(roundPins).values({
    roundId: ids.roundId,
    resolvedConfigJson: JSON.stringify(cfg),
    seedRuleSetRevisionId: null, courseRevisionId: ids.courseRevId, tee: 'blue',
    perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null,
    createdAt: now, tenantId: TENANT, contextId: ctx,
  });

  for (const [holeStr, byPlayer] of Object.entries(input.grossByHole)) {
    const holeNumber = Number(holeStr);
    for (const pid of ALL) {
      const gross = byPlayer[pid];
      if (gross === undefined) continue;
      await db.insert(holeScores).values({
        id: randomUUID(), roundId: ids.roundId, playerId: pid, holeNumber,
        grossStrokes: gross, putts: 2, scorerPlayerId: ALL[0]!, clientEventId: `e-${pid}-${holeNumber}`,
        createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx,
      });
    }
  }
  return ids;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  await client.execute('PRAGMA foreign_keys = OFF');
});
beforeEach(reset);

describe('settleFoursome plays OFF THE LOW (not full CH)', () => {
  // One par-4 at SI 1. Full CH: a1=4 a2=18 b1=11 b2=27.
  //
  // At SI 1, allocate(CH,1) = 1 for CH∈[1..18], and for CH=27 → base1+extra(27%18=9, 1≤9) = 2.
  //   full-CH strokes: a1=1, a2=1, b1=1, b2=2
  // Off-low: groupLow = min(4,18,11,27) = 4 → offLow = a1:0 a2:14 b1:7 b2:23.
  //   allocate(0,1)=0, allocate(14,1)=1, allocate(7,1)=1, allocate(23,1)=base1+extra(5,1≤5)=2
  //   off-low strokes: a1=0, a2=1, b1=1, b2=2   (ONLY a1 differs: 1 → 0)
  //
  // Gross a1=5 a2=9 b1=5 b2=9 (par 4):
  //   FULL-CH nets: a1=4 a2=8 | b1=4 b2=7 → low TIE(4) → low0 skin0; teamTotal A=12 B=11 → B+1;
  //                 net-skins: both best net 4 = par (no birdie) → 0.  netPointsA = -1  → ±$5.
  //   OFF-LOW nets: a1=5 a2=8 | b1=4 b2=7 → low B(4)<A(5) → B+1; skin winLow 4≤4 → B+1;
  //                 teamTotal A=13 B=11 → B+1; net-skins 0.          netPointsA = -3  → ±$15.
  // Same scores, same pin — off-low moves the money from $5 to $15.
  const scenario = {
    chByPlayer: { a1: 4, a2: 18, b1: 11, b2: 27 },
    grossByHole: { 18: { a1: 5, a2: 9, b1: 5, b2: 9 } },
    parByHole: { 18: 4 },
    siByHole: { 18: 1 },
  };

  test('non-zero foursome low changes the settled cents (B sweeps off-low, ties under full CH)', async () => {
    const ids = await seed({ ...scenario, allowancePct: 100 });

    const { netByPlayer } = await computeF1PerPlayerNet(db, ids.eventId, TENANT);
    // Off-low: B up 3 points → +$15 each; A down $15 each. (Full CH would be ±$5.)
    expect(netByPlayer.get('a1')).toBe(-1500);
    expect(netByPlayer.get('a2')).toBe(-1500);
    expect(netByPlayer.get('b1')).toBe(1500);
    expect(netByPlayer.get('b2')).toBe(1500);

    const res = await computeF1EventEdges(db, ids.eventId, TENANT);
    expect(res.isF1).toBe(true);
    expect(res.unsettleable).toEqual([]);
    const sourceId = `${ids.roundId}:1`;
    const got = [...res.edges].sort((a, b) =>
      a.fromPlayerId < b.fromPlayerId ? -1 : a.fromPlayerId > b.fromPlayerId ? 1 : 0,
    );
    // Losers (A) pay winners (B), slot-paired, full per-player amount.
    expect(got).toEqual([
      { fromPlayerId: 'a1', toPlayerId: 'b1', cents: 1500, sourceType: 'f1_game', sourceId },
      { fromPlayerId: 'a2', toPlayerId: 'b2', cents: 1500, sourceType: 'f1_game', sourceId },
    ]);
  });

  test('absent handicapAllowancePct settles identically to an explicit 100 (back-compat)', async () => {
    const ids = await seed({ ...scenario }); // allowancePct omitted from config + pin
    const { netByPlayer } = await computeF1PerPlayerNet(db, ids.eventId, TENANT);
    expect(netByPlayer.get('a1')).toBe(-1500);
    expect(netByPlayer.get('b1')).toBe(1500);
  });
});

describe('settleFoursome stays fail-closed on a corrupt non-integer pinned CH', () => {
  // Regression guard (review finding): the off-low step rounds, so a corrupt
  // non-integer pinned CH must be rejected BEFORE off-low — otherwise Math.round
  // would mask it and settle a corrupt pin instead of failing closed (AC11).
  test('non-integer pinned CH → foursome unsettleable (missing_handicap), no edges', async () => {
    const ids = await seed({
      chByPlayer: { a1: 4, a2: 8.5 /* corrupt */, b1: 11, b2: 18 },
      grossByHole: { 18: { a1: 5, a2: 9, b1: 5, b2: 9 } },
      parByHole: { 18: 4 },
      siByHole: { 18: 1 },
      allowancePct: 100,
    });
    const res = await computeF1EventEdges(db, ids.eventId, TENANT);
    expect(res.isF1).toBe(true);
    expect(res.edges).toEqual([]);
    expect(res.unsettleable).toHaveLength(1);
    expect(res.unsettleable[0]!.reason).toBe('missing_handicap');
  });
});

describe('best-ball standings for an F1 event (full CH × allowance %, no off-low)', () => {
  // One par-4 at SI 1, all four scored. Full CH: a1=4 a2=20 b1=11 b2=27.
  //  @100%: allocate(·,1) = a1:1 a2:2 b1:1 b2:2 → nets a1=4 a2=7 b1=5 b2=7
  //         teamA best = min(4,7)=4 ; teamB best = min(5,7)=5  → teamA's ball wins.
  //  @50%:  allowed = 2,10,6,14 → allocate(·,1) all 1 → nets a1=4 a2=8 b1=5 b2=8
  //         a2's net moves 7→8 (the allowance reached his strokes); bests unchanged.
  const scenario = {
    chByPlayer: { a1: 4, a2: 20, b1: 11, b2: 27 },
    grossByHole: { 18: { a1: 5, a2: 9, b1: 6, b2: 9 } },
    parByHole: { 18: 4 },
    siByHole: { 18: 1 },
  };

  test('F1 foursome-results now surfaces team best-nets = min of teammates allowed-CH nets', async () => {
    const ids = await seed({ ...scenario, allowancePct: 100 });
    const fr = await computeFoursomeResults(db, ids.eventRoundId, TENANT);
    expect(fr).not.toBeNull();
    const hole = fr!.foursomes[0]!.perHole.find((h) => h.holeNumber === 18)!;
    // The bug this fixes: these were hard-null for F1 events.
    expect(hole.teamABestNet).toBe(4);
    expect(hole.teamBBestNet).toBe(5);
    const netOf = (pid: string) => hole.players.find((p) => p.playerId === pid)!.net;
    expect(netOf('a1')).toBe(4);
    expect(netOf('a2')).toBe(7);
    expect(netOf('b1')).toBe(5);
  });

  test('computeTeamStandings ranks teams by cumulative net-to-par (lowest wins)', async () => {
    const ids = await seed({ ...scenario, allowancePct: 100 });
    const standings = await computeTeamStandings(db, ids.eventId, TENANT);
    expect(standings.teams).toHaveLength(2);
    // teamA best ball 4 (toPar 0) beats teamB best ball 5 (toPar +1) on the lone hole.
    expect(standings.teams[0]!.toPar).toBe(0);
    expect(standings.teams[0]!.netTotal).toBe(4);
    expect(standings.teams[1]!.toPar).toBe(1);
    expect(standings.teams[1]!.netTotal).toBe(5);
  });

  test('allowance % reaches the best-ball net (a2 net 7 @100% → 8 @50%)', async () => {
    const at50 = await seed({ ...scenario, allowancePct: 50 });
    const fr = await computeFoursomeResults(db, at50.eventRoundId, TENANT);
    const hole = fr!.foursomes[0]!.perHole.find((h) => h.holeNumber === 18)!;
    expect(hole.players.find((p) => p.playerId === 'a2')!.net).toBe(8);
  });
});

describe('settleFoursome consumes handicapAllowancePct from the pinned config', () => {
  // One par-4 at SI 6. Full CH: a1=4 a2=8 b1=10 b2=20.
  //
  //  @100%: allowed = 4,8,10,20 → low 4 → offLow a1:0 a2:4 b1:6 b2:16
  //         allocate(·,6): a1=0, a2(4→6≤4?no)=0, b1(6→6≤6)=1, b2(16→6≤16)=1
  //  @50%:  allowed = round(2,4,5,10)=2,4,5,10 → low 2 → offLow a1:0 a2:2 b1:3 b2:8
  //         allocate(·,6): a1=0, a2(2)=0, b1(3→6≤3?no)=0, b2(8→6≤8)=1   (ONLY b1 differs: 1→0)
  //
  // Gross a1=6 a2=9 b1=5 b2=9 (par 4):
  //  @100% nets: a1=6 a2=9 | b1=4 b2=8 → low B(4) +1; skin 4≤4 +1; teamTotal A=15 B=12 +1; ns0 → A=-3 → ±$15
  //  @50%  nets: a1=6 a2=9 | b1=5 b2=8 → low B(5) +1; skin 5≤4? NO → 0; teamTotal A=15 B=13 +1; ns0 → A=-2 → ±$10
  // The dropped skin point (b1's net 4→5 crosses par) proves the % is actually read.
  const scenario = {
    chByPlayer: { a1: 4, a2: 8, b1: 10, b2: 20 },
    grossByHole: { 11: { a1: 6, a2: 9, b1: 5, b2: 9 } },
    parByHole: { 11: 4 },
    siByHole: { 11: 6 },
  };

  test('100% vs 50% allowance settles to different cents on the same scores + CH', async () => {
    const at100 = await seed({ ...scenario, allowancePct: 100 });
    const net100 = (await computeF1PerPlayerNet(db, at100.eventId, TENANT)).netByPlayer;
    expect(net100.get('a1')).toBe(-1500);
    expect(net100.get('b1')).toBe(1500);

    await reset();

    const at50 = await seed({ ...scenario, allowancePct: 50 });
    const net50 = (await computeF1PerPlayerNet(db, at50.eventId, TENANT)).netByPlayer;
    expect(net50.get('a1')).toBe(-1000);
    expect(net50.get('b1')).toBe(1000);
  });
});
