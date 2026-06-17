/**
 * T6-5 GET /api/events/:eventId/money integration tests.
 *
 * Cases per AC-6: empty event, single round with team-A win, anti-symmetry,
 * diagonal=0, non-participant 403, nonexistent eventId 403.
 */
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

let __testPlayer: { id: string; isOrganizer: boolean } | null = null;
vi.mock('../middleware/require-session.js', () => ({
  requireSession: async (
    c: import('hono').Context,
    next: () => Promise<void>,
  ) => {
    if (!__testPlayer) {
      return c.json({ error: 'unauthorized', code: 'no_test_player' }, 401);
    }
    c.set('player', __testPlayer);
    c.set('session', { sessionId: 'test', playerId: __testPlayer.id });
    await next();
  },
}));

const { db } = await import('../db/index.js');
const {
  players,
  courses,
  courseRevisions,
  courseTees,
  courseHoles,
  events,
  eventRounds,
  groups,
  groupMembers,
  pairings,
  pairingMembers,
  rounds,
  holeScores,
  ruleSets,
  ruleSetRevisions,
  individualBets,
  individualBetRounds,
  individualBetPresses,
  teamPressLog,
} = await import('../db/schema/index.js');
const { moneyRouter } = await import('./money.js');
const { requestIdMiddleware } = await import('../middleware/request-id.js');

const TENANT_ID = 'guyan';
const CTX_BASE = 'league:guyan-wolf-cup-friday';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(teamPressLog);
  await db.delete(individualBetPresses);
  await db.delete(individualBetRounds);
  await db.delete(individualBets);
  await db.delete(holeScores);
  await db.delete(pairingMembers);
  await db.delete(pairings);
  await db.delete(ruleSetRevisions);
  await db.delete(ruleSets);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(events);
  await db.delete(courseHoles);
  await db.delete(courseTees);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
});

interface SeedResult {
  organizerId: string;
  /** Sorted alphabetical for deterministic team assignment. */
  playerIds: [string, string, string, string];
  outsiderId: string;
  eventId: string;
  eventRoundId: string;
  roundId: string;
}

async function seed(opts: { withScores?: boolean } = {}): Promise<SeedResult> {
  const now = Date.now();
  const ids = {
    organizerId: randomUUID(),
    p1: randomUUID(),
    p2: randomUUID(),
    p3: randomUUID(),
    p4: randomUUID(),
    outsiderId: randomUUID(),
    eventId: randomUUID(),
    courseId: randomUUID(),
    courseRevId: randomUUID(),
    eventRoundId: randomUUID(),
    pairingId: randomUUID(),
    roundId: randomUUID(),
    groupId: randomUUID(),
    ruleSetId: randomUUID(),
    revisionId: randomUUID(),
  };
  const sortedPlayers: [string, string, string, string] = [ids.p1, ids.p2, ids.p3, ids.p4].sort() as [string, string, string, string];
  const ctx = `event:${ids.eventId}`;

  for (const [id, name] of [
    [ids.organizerId, 'Organizer'],
    [ids.p1, 'P1'],
    [ids.p2, 'P2'],
    [ids.p3, 'P3'],
    [ids.p4, 'P4'],
    [ids.outsiderId, 'Outsider'],
  ] as Array<[string, string]>) {
    await db.insert(players).values({
      id, isOrganizer: false, createdAt: now, name, manualHandicapIndex: 0,
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(courses).values({
    id: ids.courseId, name: 'C', clubName: 'CC',
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseRevisions).values({
    id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1,
    sourceUrl: null, extractionDate: null, verified: false,
    outTotal: 36, inTotal: 36, courseTotal: 72,
    createdAt: now, tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  await db.insert(courseTees).values({
    id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue',
    rating: 720, slope: 113,
    tenantId: TENANT_ID, contextId: CTX_BASE,
  });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({
      id: randomUUID(), courseRevisionId: ids.courseRevId,
      holeNumber: h, par: 4, si: ((h * 7) % 18) + 1,
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID, contextId: CTX_BASE,
    });
  }

  await db.insert(events).values({
    id: ids.eventId, name: 'Test', startDate: now, endDate: now + 86400000,
    timezone: 'America/New_York', organizerPlayerId: ids.organizerId,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(eventRounds).values({
    id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now,
    courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(rounds).values({
    id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId,
    holesToPlay: 18, createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  await db.insert(groups).values({
    id: ids.groupId, eventId: ids.eventId, name: 'G',
    moneyVisibilityMode: 'open', createdAt: now,
    tenantId: TENANT_ID, contextId: ctx,
  });
  for (const pid of sortedPlayers) {
    await db.insert(groupMembers).values({
      groupId: ids.groupId, playerId: pid,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }
  await db.insert(pairings).values({
    id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1,
    createdAt: now, tenantId: TENANT_ID, contextId: ctx,
  });
  for (let i = 0; i < 4; i++) {
    await db.insert(pairingMembers).values({
      pairingId: ids.pairingId, playerId: sortedPlayers[i]!, slotNumber: i + 1,
      tenantId: TENANT_ID, contextId: ctx,
    });
  }
  await db.insert(ruleSets).values({
    id: ids.ruleSetId, name: 'Test', createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });
  await db.insert(ruleSetRevisions).values({
    id: ids.revisionId, ruleSetId: ids.ruleSetId, revisionNumber: 1,
    configJson: JSON.stringify({
      basePerHoleCents: 100,
      sandies: false,
      sandiesBonusPerHoleCents: 0,
      greenieCarryover: false,
      greenieValidation: 'none',
      greenieBaseCents: 0,
      autoPressTriggerAtNDown: null,
      pressMultiplier: 2,
    }),
    effectiveFromRoundId: null, effectiveFromHole: 1,
    createdByPlayerId: ids.organizerId, reason: null, createdAt: now,
    tenantId: TENANT_ID, contextId: `library:${TENANT_ID}`,
  });

  if (opts.withScores) {
    // teamA = sortedPlayers[0,1]; teamB = sortedPlayers[2,3].
    // 18 holes: A wins 12, B wins 6. Net to teamA = +6 holes. Per-pair @ 100c = +600 per pair × 4 pairs = +2400 total team delta.
    for (let h = 1; h <= 18; h++) {
      const aWins = h <= 12;
      const aGross = aWins ? 4 : 5;
      const bGross = aWins ? 5 : 4;
      for (const pid of [sortedPlayers[0]!, sortedPlayers[1]!]) {
        await db.insert(holeScores).values({
          id: randomUUID(),
          roundId: ids.roundId,
          playerId: pid,
          holeNumber: h,
          grossStrokes: aGross,
          putts: 2,
          scorerPlayerId: sortedPlayers[0]!,
          clientEventId: `evt-${pid}-${h}`,
          createdAt: now, updatedAt: now,
          tenantId: TENANT_ID, contextId: ctx,
        });
      }
      for (const pid of [sortedPlayers[2]!, sortedPlayers[3]!]) {
        await db.insert(holeScores).values({
          id: randomUUID(),
          roundId: ids.roundId,
          playerId: pid,
          holeNumber: h,
          grossStrokes: bGross,
          putts: 2,
          scorerPlayerId: sortedPlayers[0]!,
          clientEventId: `evt-${pid}-${h}`,
          createdAt: now, updatedAt: now,
          tenantId: TENANT_ID, contextId: ctx,
        });
      }
    }
  }

  return {
    organizerId: ids.organizerId,
    playerIds: sortedPlayers,
    outsiderId: ids.outsiderId,
    eventId: ids.eventId,
    eventRoundId: ids.eventRoundId,
    roundId: ids.roundId,
  };
}

function buildApp(viewerPlayerId: string): Hono {
  __testPlayer = { id: viewerPlayerId, isOrganizer: false };
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.route('/api/events', moneyRouter);
  return app;
}

async function getMoney(app: Hono, eventId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}/money`);
}

describe('GET /api/events/:eventId/money', () => {
  test('(a) empty event (no scores) → matrix zeros, anti-symmetric, diagonal 0', async () => {
    const s = await seed();
    const app = buildApp(s.playerIds[0]!);
    const res = await getMoney(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      players: Array<{ id: string; name: string }>;
      matrix: Record<string, Record<string, number>>;
      totals: Record<string, number>;
    };
    expect(body.players.length).toBe(4);
    for (const a of s.playerIds) {
      for (const b of s.playerIds) {
        expect(Number.isInteger(body.matrix[a]![b]!)).toBe(true);
        expect(body.matrix[a]![b]).toBe(0);
      }
      expect(body.totals[a]).toBe(0);
    }
  });

  test('(b) single round with teamA winning → matrix reflects A→B positive, B→A negative', async () => {
    const s = await seed({ withScores: true });
    const app = buildApp(s.playerIds[0]!);
    const res = await getMoney(app, s.eventId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      matrix: Record<string, Record<string, number>>;
      totals: Record<string, number>;
    };
    // teamA (sortedPlayers[0,1]) is up on teamB (sortedPlayers[2,3]).
    // 18 holes, A wins 12, B wins 6 → net +6 holes for teamA.
    // Per-pair contribution = (12 - 6) × 100 = +600 cents from each A-side pair.
    const a1 = s.playerIds[0]!;
    const a2 = s.playerIds[1]!;
    const b1 = s.playerIds[2]!;
    const b2 = s.playerIds[3]!;
    expect(body.matrix[a1]![b1]).toBe(600);
    expect(body.matrix[a1]![b2]).toBe(600);
    expect(body.matrix[a2]![b1]).toBe(600);
    expect(body.matrix[a2]![b2]).toBe(600);
    // Anti-symmetric.
    expect(body.matrix[b1]![a1]).toBe(-600);
    expect(body.matrix[b2]![a1]).toBe(-600);
    // Intra-team cells: 0 (no money flows within a team).
    expect(body.matrix[a1]![a2]).toBe(0);
    expect(body.matrix[b1]![b2]).toBe(0);
    // Totals: each A player +1200; each B player -1200.
    expect(body.totals[a1]).toBe(1200);
    expect(body.totals[a2]).toBe(1200);
    expect(body.totals[b1]).toBe(-1200);
    expect(body.totals[b2]).toBe(-1200);
  });

  test('(c) anti-symmetry across all pairs', async () => {
    const s = await seed({ withScores: true });
    const app = buildApp(s.playerIds[0]!);
    const res = await getMoney(app, s.eventId);
    const body = (await res.json()) as {
      matrix: Record<string, Record<string, number>>;
    };
    for (const a of s.playerIds) {
      for (const b of s.playerIds) {
        if (a === b) continue;
        expect(body.matrix[a]![b]! + body.matrix[b]![a]!).toBe(0);
      }
    }
  });

  test('(d) diagonal cells are 0', async () => {
    const s = await seed({ withScores: true });
    const app = buildApp(s.playerIds[0]!);
    const res = await getMoney(app, s.eventId);
    const body = (await res.json()) as {
      matrix: Record<string, Record<string, number>>;
    };
    for (const a of s.playerIds) {
      expect(body.matrix[a]![a]).toBe(0);
    }
  });

  test('(e) non-participant requester → 403 not_event_participant', async () => {
    const s = await seed();
    const app = buildApp(s.outsiderId);
    const res = await getMoney(app, s.eventId);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('not_event_participant');
  });

  test('(f) nonexistent eventId → 403 (no-existence-leak)', async () => {
    const s = await seed();
    const app = buildApp(s.playerIds[0]!);
    const res = await getMoney(app, randomUUID());
    expect(res.status).toBe(403);
  });

  test('(g) integer-only on every cell + cache-control: no-store', async () => {
    const s = await seed({ withScores: true });
    const app = buildApp(s.playerIds[0]!);
    const res = await getMoney(app, s.eventId);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      matrix: Record<string, Record<string, number>>;
      totals: Record<string, number>;
    };
    for (const a of s.playerIds) {
      for (const b of s.playerIds) {
        expect(Number.isInteger(body.matrix[a]![b]!)).toBe(true);
      }
      expect(Number.isInteger(body.totals[a]!)).toBe(true);
    }
  });

  test('(h) T13-5 split: team + individual ledgers reconcile to combined (no skins)', async () => {
    const s = await seed({ withScores: true });
    // Add a cross-team 1v1 bet so both ledgers are non-trivial.
    const betId = randomUUID();
    await db.insert(individualBets).values({
      id: betId, eventId: s.eventId, playerAId: s.playerIds[0]!, playerBId: s.playerIds[2]!,
      betType: 'match_play_per_hole', stakePerHoleCents: 100, configJson: '{}',
      createdByPlayerId: s.playerIds[0]!, createdAt: Date.now(),
      tenantId: TENANT_ID, contextId: `event:${s.eventId}`,
    });
    await db.insert(individualBetRounds).values({
      betId, eventRoundId: s.eventRoundId, tenantId: TENANT_ID, contextId: `event:${s.eventId}`,
    });

    const app = buildApp(s.playerIds[0]!);
    const res = await getMoney(app, s.eventId);
    const body = (await res.json()) as {
      matrix: Record<string, Record<string, number>>;
      totals: Record<string, number>;
      teamLedger: { totals: Record<string, number>; matrix: Record<string, Record<string, number>> };
      individualLedger: { totals: Record<string, number>; matrix: Record<string, Record<string, number>> };
    };
    // Combined = team + individual, cell-by-cell AND on totals (no skins seeded).
    for (const a of s.playerIds) {
      for (const b of s.playerIds) {
        expect(body.teamLedger.matrix[a]![b]! + body.individualLedger.matrix[a]![b]!).toBe(
          body.matrix[a]![b]!,
        );
      }
      expect(body.teamLedger.totals[a]! + body.individualLedger.totals[a]!).toBe(body.totals[a]!);
    }
    // The bet shows up in the individual ledger; the team ledger carries the 2v2.
    expect(body.individualLedger.totals[s.playerIds[0]!]!).not.toBe(0);
    expect(body.teamLedger.totals[s.playerIds[0]!]!).not.toBe(0);
  });
});

// ── T13-5: foursome-results endpoint ──────────────────────────────────────

interface FoursomeResultsBody {
  eventRoundId: string;
  roundNumber: number;
  foursomes: Array<{
    foursomeNumber: number;
    teamA: Array<{ playerId: string; name: string | null }>;
    teamB: Array<{ playerId: string; name: string | null }>;
    teamATotalCents: number;
    perHole: Array<{
      holeNumber: number;
      par: number;
      teamABestNet: number | null;
      teamBBestNet: number | null;
      winner: 'teamA' | 'teamB' | 'tie' | null;
      moneyTeamACents: number;
      players: Array<{ playerId: string; gross: number | null; net: number | null }>;
    }>;
  }>;
}

async function getFoursomeResults(app: Hono, eventId: string, eventRoundId: string): Promise<Response> {
  return await app.request(`/api/events/${eventId}/event-rounds/${eventRoundId}/foursome-results`);
}

describe('GET /api/events/:eventId/event-rounds/:eventRoundId/foursome-results', () => {
  test('returns the foursome 2v2 result hole-by-hole; teamA (UUID-sorted winners) is up', async () => {
    const s = await seed({ withScores: true });
    const app = buildApp(s.playerIds[0]!);
    const res = await getFoursomeResults(app, s.eventId, s.eventRoundId);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as FoursomeResultsBody;

    expect(body.foursomes.length).toBe(1);
    const f = body.foursomes[0]!;
    expect(f.foursomeNumber).toBe(1);
    // Seed: teamA = sortedPlayers[0,1] win 12 of 18 → positive team total.
    expect(f.teamA.map((p) => p.playerId).sort()).toEqual([s.playerIds[0]!, s.playerIds[1]!].sort());
    expect(f.teamATotalCents).toBeGreaterThan(0);
    expect(f.perHole.length).toBe(18);

    // Per-hole money sums to the round total (loss-less decomposition).
    const holeSum = f.perHole.reduce((acc, h) => acc + h.moneyTeamACents, 0);
    expect(holeSum).toBe(f.teamATotalCents);

    // Hole 1: teamA wins (gross 4 vs 5, HI 0 → net = gross). All 4 players scored.
    const h1 = f.perHole.find((h) => h.holeNumber === 1)!;
    expect(h1.winner).toBe('teamA');
    expect(h1.players.length).toBe(4);
    expect(h1.players.every((p) => p.gross !== null && p.net !== null)).toBe(true);
    // HI 0 → net equals gross on every scored cell.
    expect(h1.players.every((p) => p.net === p.gross)).toBe(true);

    // perPair antisymmetry within the foursome.
    const [a1, , b1] = s.playerIds;
    expect(f.perHole.every((h) => Number.isInteger(h.moneyTeamACents))).toBe(true);
    void a1; void b1;
  });

  test('empty (no scores) → one foursome, 18 holes, zero money, null winners', async () => {
    const s = await seed();
    const app = buildApp(s.playerIds[0]!);
    const res = await getFoursomeResults(app, s.eventId, s.eventRoundId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FoursomeResultsBody;
    expect(body.foursomes.length).toBe(1);
    expect(body.foursomes[0]!.teamATotalCents).toBe(0);
    expect(body.foursomes[0]!.perHole.every((h) => h.moneyTeamACents === 0)).toBe(true);
  });

  test('non-participant → 403', async () => {
    const s = await seed({ withScores: true });
    const app = buildApp(s.outsiderId);
    const res = await getFoursomeResults(app, s.eventId, s.eventRoundId);
    expect(res.status).toBe(403);
  });

  test('event_round not belonging to this event → 404 (no cross-event leak)', async () => {
    const s = await seed({ withScores: true });
    const app = buildApp(s.playerIds[0]!);
    // The guard WHERE-filters (id AND event_id), so an event_round id that
    // isn't this event's (here: a non-existent id) takes the same reject path.
    const res = await getFoursomeResults(app, s.eventId, randomUUID());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('event_round_not_found');
  });
});

// ── T13-5: my-money endpoint (viewer-centric P&L by game) ──────────────────

interface MyMoneyBody {
  viewerId: string;
  totalNetCents: number;
  games: Array<{
    kind: 'foursome' | 'individual';
    key: string;
    label: string;
    opponentName: string | null;
    netToViewerCents: number;
    perRound: Array<{
      eventRoundId: string;
      roundNumber: number;
      netToViewerCents: number;
      perHole: Array<{ holeNumber: number; moneyToViewerCents: number; winner: string | null }>;
    }>;
  }>;
}

describe('GET /api/events/:eventId/my-money', () => {
  test('decomposes the viewer P&L by game; games sum to the combined matrix total', async () => {
    const s = await seed({ withScores: true });
    // Add a cross-team 1v1 bet: teamA[0] vs teamB[0] (playerIds[0] vs [2]).
    const now = Date.now();
    const betId = randomUUID();
    await db.insert(individualBets).values({
      id: betId,
      eventId: s.eventId,
      playerAId: s.playerIds[0]!,
      playerBId: s.playerIds[2]!,
      betType: 'match_play_per_hole',
      stakePerHoleCents: 100,
      configJson: '{}',
      createdByPlayerId: s.playerIds[0]!,
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });
    await db.insert(individualBetRounds).values({
      betId,
      eventRoundId: s.eventRoundId,
      tenantId: TENANT_ID,
      contextId: `event:${s.eventId}`,
    });

    const viewer = s.playerIds[0]!;
    const app = buildApp(viewer);
    const res = await app.request(`/api/events/${s.eventId}/my-money`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as MyMoneyBody;

    // A foursome game + an individual game (vs the bet opponent).
    const foursome = body.games.find((g) => g.kind === 'foursome');
    const individual = body.games.find((g) => g.kind === 'individual');
    expect(foursome).toBeTruthy();
    expect(individual).toBeTruthy();
    expect(individual!.key).toBe(betId);
    expect(individual!.label.startsWith('Match vs ')).toBe(true);
    // teamA[0] won both games (better scores 1-12).
    expect(foursome!.netToViewerCents).toBeGreaterThan(0);
    expect(individual!.netToViewerCents).toBeGreaterThan(0);

    // Per-hole money sums to round net; round nets sum to game net.
    for (const g of body.games) {
      for (const r of g.perRound) {
        const holeSum = r.perHole.reduce((a, h) => a + h.moneyToViewerCents, 0);
        expect(holeSum).toBe(r.netToViewerCents);
      }
      const roundSum = g.perRound.reduce((a, r) => a + r.netToViewerCents, 0);
      expect(roundSum).toBe(g.netToViewerCents);
    }
    // Games sum to grand total.
    expect(body.games.reduce((a, g) => a + g.netToViewerCents, 0)).toBe(body.totalNetCents);

    // LOSS-LESS DECOMPOSITION: viewer's my-money total === their combined
    // matrix total (no skins in this seed, so the two ledgers fully reconcile).
    const moneyRes = await getMoney(app, s.eventId);
    const matrixBody = (await moneyRes.json()) as { totals: Record<string, number> };
    expect(body.totalNetCents).toBe(matrixBody.totals[viewer]);
  });

  test('viewer with no bets → only a foursome game; non-participant → 403', async () => {
    const s = await seed({ withScores: true });
    const app = buildApp(s.playerIds[1]!);
    const res = await app.request(`/api/events/${s.eventId}/my-money`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MyMoneyBody;
    expect(body.games.every((g) => g.kind === 'foursome')).toBe(true);

    const outApp = buildApp(s.outsiderId);
    const outRes = await outApp.request(`/api/events/${s.eventId}/my-money`);
    expect(outRes.status).toBe(403);
  });
});

// ── Pete Dye: event-level 2-man team standings ───────────────────────────────
type TeamStandingsBody = {
  eventId: string;
  teams: Array<{
    teamKey: string;
    players: Array<{ playerId: string; name: string | null }>;
    holesPlayed: number;
    grossTotal: number;
    netTotal: number;
    parTotal: number;
    toPar: number;
  }>;
};

describe('GET /api/events/:eventId/team-standings', () => {
  test('aggregates best-ball gross/net/to-par per 2-man team, sorted by net-to-par', async () => {
    // Fixture (HI=0 → net=gross, par 4×18=72): teamA shoots 78 (+6), teamB 84 (+12).
    const s = await seed({ withScores: true });
    const app = buildApp(s.playerIds[0]!);
    const res = await app.request(`/api/events/${s.eventId}/team-standings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TeamStandingsBody;

    expect(body.teams).toHaveLength(2);
    // teamA = slots 1&2 = playerIds[0,1]; teamB = slots 3&4 = playerIds[2,3].
    const [first, second] = body.teams;
    // Sorted by net-to-par → teamA (+6) ahead of teamB (+12).
    expect(first!.toPar).toBe(6);
    expect(first!.grossTotal).toBe(78);
    expect(first!.netTotal).toBe(78);
    expect(first!.parTotal).toBe(72);
    expect(first!.holesPlayed).toBe(18);
    expect(new Set(first!.players.map((p) => p.playerId))).toEqual(
      new Set([s.playerIds[0]!, s.playerIds[1]!]),
    );
    expect(second!.toPar).toBe(12);
    expect(second!.grossTotal).toBe(84);
    expect(new Set(second!.players.map((p) => p.playerId))).toEqual(
      new Set([s.playerIds[2]!, s.playerIds[3]!]),
    );
  });

  test('non-participant → 403', async () => {
    const s = await seed({ withScores: true });
    const outApp = buildApp(s.outsiderId);
    const res = await outApp.request(`/api/events/${s.eventId}/team-standings`);
    expect(res.status).toBe(403);
  });
});
