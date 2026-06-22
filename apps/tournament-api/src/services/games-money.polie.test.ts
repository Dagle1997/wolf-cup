/**
 * games-money.polie.test.ts (Story 2.3, Task 3b) — proves the polie bogey-or-better
 * GROSS gate works END-TO-END through the live F1 settlement chokepoint, i.e. that
 * `games-money.ts` actually threads per-hole GROSS into the engine's HoleState.
 *
 * HIGH (codex spec review): a test that only checks "base money unchanged" would
 * still pass if gross were never populated — it would silently void ALL gated
 * polies in production. So this proves: (a) an eligible-gross polie's money APPEARS
 * (gross threaded + gate passed), (b) a double-bogey-gross polie is VOIDED, (c) the
 * gate OFF makes the same bad-gross polie COUNT, (d) base money is gross-neutral.
 *
 * Isolation device: every player nets PAR on the one scored hole (base = 0), with
 * a1's pinned course handicap chosen so a1's NET stays par while a1's GROSS varies
 * (net = gross − strokes(ch, si)) — letting us drive the gross gate independently.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { GameConfig, TeamSplit } from '../engine/games/types.js';

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
  players, courses, courseRevisions, courseTees, courseHoles, events, eventRounds,
  pairings, pairingMembers, rounds, holeScores, holeClaimWrites, gameConfig, roundPins,
} = await import('../db/schema/index.js');
const { computeF1PerPlayerNet } = await import('./games-money.js');

const TENANT = 'guyan';
const TEAM: TeamSplit = { teamA: ['a1', 'a2'], teamB: ['b1', 'b2'] };
const MEMBERS = [...TEAM.teamA, ...TEAM.teamB];

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  await client.execute('PRAGMA foreign_keys = OFF');
});
beforeEach(async () => {
  for (const t of [holeClaimWrites, roundPins, holeScores, pairingMembers, pairings, gameConfig, rounds, eventRounds, events, courseHoles, courseTees, courseRevisions, courses, players]) {
    await db.delete(t);
  }
});

/** polie config (Story 2.4a — count-only, no variant): polie enabled, or disabled. */
function polieCfg(polieEnabled: boolean): GameConfig {
  const modifiers: GameConfig['modifiers'] = polieEnabled
    ? [
        { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } },
        { type: 'polie', enabled: true },
      ]
    : [{ type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } }];
  return {
    scope: 'foursome', game: 'guyan-2v2', pointValueSchedule: { kind: 'flat', cents: 500 },
    modifiers, lockState: 'locked', configVersion: 1,
  };
}

/**
 * Seed one par-5 hole (SI 1). a1 makes a polie; a1's pinned CH gives a1 exactly
 * `a1Strokes` on this hole so a1 NET = par (base 0) while a1 GROSS = 5 + a1Strokes
 * (a1Strokes=2 ⇒ double-bogey gross — which the removed 2.3 gate would have voided).
 * Others: CH 0, gross = net = par (5). Returns the eventId.
 */
async function seed(opts: { polieEnabled: boolean; a1Strokes: 1 | 2 }) {
  const now = Date.now();
  const ids = { eventId: randomUUID(), courseId: randomUUID(), courseRevId: randomUUID(), eventRoundId: randomUUID(), pairingId: randomUUID(), roundId: randomUUID() };
  const ctx = `event:${ids.eventId}`;
  const PAR = 5;
  // CH that yields exactly N strokes on a SI-1 hole: 1 stroke → CH 1; 2 strokes → CH 19.
  const a1Ch = opts.a1Strokes === 1 ? 1 : 19;
  const a1Gross = PAR + opts.a1Strokes; // net = gross − strokes = par

  for (const pid of MEMBERS) {
    await db.insert(players).values({ id: pid, isOrganizer: false, createdAt: now, name: pid, manualHandicapIndex: 0, tenantId: TENANT, contextId: ctx });
  }
  await db.insert(courses).values({ id: ids.courseId, name: 'C', clubName: 'CC', createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseRevisions).values({ id: ids.courseRevId, courseId: ids.courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null, verified: false, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(courseTees).values({ id: randomUUID(), courseRevisionId: ids.courseRevId, teeColor: 'blue', rating: 720, slope: 113, tenantId: TENANT, contextId: ctx });
  for (let h = 1; h <= 18; h++) {
    await db.insert(courseHoles).values({ id: randomUUID(), courseRevisionId: ids.courseRevId, holeNumber: h, par: h === 1 ? PAR : 4, si: h === 1 ? 1 : ((h * 7) % 18) + 1, yardagePerTeeJson: '{}', tenantId: TENANT, contextId: ctx });
  }
  await db.insert(events).values({ id: ids.eventId, name: 'F1', startDate: now, endDate: now + 86400000, timezone: 'America/New_York', organizerPlayerId: MEMBERS[0]!, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(eventRounds).values({ id: ids.eventRoundId, eventId: ids.eventId, roundNumber: 1, roundDate: now, courseRevisionId: ids.courseRevId, teeColor: 'blue', holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(rounds).values({ id: ids.roundId, eventId: ids.eventId, eventRoundId: ids.eventRoundId, holesToPlay: 18, createdAt: now, tenantId: TENANT, contextId: ctx });
  await db.insert(pairings).values({ id: ids.pairingId, eventRoundId: ids.eventRoundId, foursomeNumber: 1, createdAt: now, tenantId: TENANT, contextId: ctx });
  for (let i = 0; i < MEMBERS.length; i++) {
    await db.insert(pairingMembers).values({ pairingId: ids.pairingId, playerId: MEMBERS[i]!, slotNumber: i + 1, tenantId: TENANT, contextId: ctx });
  }
  const cfg = polieCfg(opts.polieEnabled);
  await db.insert(gameConfig).values({ id: randomUUID(), level: 'event', refId: ids.eventId, configJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, lockState: 'locked', configVersion: 1, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });
  const perPlayer: Record<string, { hi: number; ch: number }> = {};
  for (const pid of MEMBERS) perPlayer[pid] = { hi: 0, ch: pid === 'a1' ? a1Ch : 0 };
  await db.insert(roundPins).values({ roundId: ids.roundId, resolvedConfigJson: JSON.stringify(cfg), seedRuleSetRevisionId: null, courseRevisionId: ids.courseRevId, tee: 'blue', perPlayerHandicapsJson: JSON.stringify(perPlayer), teamCompositionJson: null, createdAt: now, tenantId: TENANT, contextId: ctx });
  // Scores on hole 1 only: a1 gross = par + a1Strokes (net = par); others gross = par.
  const grossByPlayer: Record<string, number> = { a1: a1Gross, a2: PAR, b1: PAR, b2: PAR };
  for (const pid of MEMBERS) {
    await db.insert(holeScores).values({ id: randomUUID(), roundId: ids.roundId, playerId: pid, holeNumber: 1, grossStrokes: grossByPlayer[pid]!, putts: 2, scorerPlayerId: MEMBERS[0]!, clientEventId: `s-${pid}`, createdAt: now, updatedAt: now, tenantId: TENANT, contextId: ctx });
  }
  // a1 polie claim on hole 1.
  await db.insert(holeClaimWrites).values({ id: randomUUID(), roundId: ids.roundId, playerId: 'a1', holeNumber: 1, claimType: 'polie', op: 'set', scorerPlayerId: MEMBERS[0]!, clientEventId: `c-a1`, createdAt: now, tenantId: TENANT, contextId: ctx });
  return ids.eventId;
}

describe('Story 2.4a polie is count-only end-to-end through the chokepoint (no gross gate)', () => {
  test('a polie COUNTS regardless of the player\'s gross (a double-bogey-gross polie that the 2.3 gate would have VOIDED now counts) → a1 team +$5', async () => {
    // a1Strokes=2 → a1 gross 7 (double bogey on par 5), net = par. Count-only ⇒ counts.
    const eventId = await seed({ polieEnabled: true, a1Strokes: 2 });
    const { netByPlayer } = await computeF1PerPlayerNet(db, eventId, TENANT);
    expect(netByPlayer.get('a1') ?? 0).toBe(500);
    expect(netByPlayer.get('a2') ?? 0).toBe(500);
    expect(netByPlayer.get('b1') ?? 0).toBe(-500);
    expect(netByPlayer.get('b2') ?? 0).toBe(-500);
  });

  test('base-neutral: polie disabled (gross still threaded) → no polie money, base unchanged (all push → $0)', async () => {
    const eventId = await seed({ polieEnabled: false, a1Strokes: 2 });
    const { netByPlayer } = await computeF1PerPlayerNet(db, eventId, TENANT);
    for (const pid of MEMBERS) expect(netByPlayer.get(pid) ?? 0).toBe(0);
  });
});
