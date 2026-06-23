/**
 * BROCHURE capture seed (2026-06-23) — a self-contained F1 money scenario for
 * the Pete Dye marketing shots. Direct drizzle inserts (no API orchestration) so
 * we fully control handicaps, the F1 game-config, the round PIN, scores, and
 * greenie/polie/sandie claims — everything the Wolf-style leaderboard + scorecard
 * need to render REAL per-hole money. Runs standalone via tsx against a throwaway
 * file DB (DB_PATH), writes a handoff JSON (BROCHURE_HANDOFF) for the spec.
 *
 * NOT a test fixture; not wired into CI. Run by brochure.config.ts's webServer.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, './migrations');
const TENANT_ID = 'guyan';
const CTX = 'event:brochure';

async function main(): Promise<void> {
  const dbFile = process.env['DB_PATH'];
  if (dbFile && dbFile !== ':memory:') {
    mkdirSync(dirname(dbFile), { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbFile}${suffix}`, { force: true });
  }

  const { db, client } = await import('./index.js');
  const { app: _app } = await import('../app.js'); // ensure env parses
  void _app;
  const { createSession } = await import('../lib/session.js');
  const s = await import('./schema/index.js');
  await migrate(db, { migrationsFolder });

  const now = Date.now();
  const id = () => randomUUID();

  // ── Course (Pete Dye-ish): 18 holes, real-ish pars, blue/"Dye" tee ──
  const courseId = id();
  const courseRevId = id();
  await db.insert(s.courses).values({ id: courseId, name: 'The Pete Dye Course at Pete Dye', clubName: 'Pete Dye', createdAt: now, tenantId: TENANT_ID, contextId: CTX });
  await db.insert(s.courseRevisions).values({ id: courseRevId, courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null, verified: true, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT_ID, contextId: CTX });
  await db.insert(s.courseTees).values({ id: id(), courseRevisionId: courseRevId, teeColor: 'Dye', rating: 740, slope: 138, tenantId: TENANT_ID, contextId: CTX });
  const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  for (let h = 1; h <= 18; h++) {
    await db.insert(s.courseHoles).values({ id: id(), courseRevisionId: courseRevId, holeNumber: h, par: PARS[h - 1]!, si: ((h * 7) % 18) + 1, yardagePerTeeJson: '{}', tenantId: TENANT_ID, contextId: CTX });
  }

  // ── 4 players (the joke crew), each with a handicap so the pin has a CH ──
  const crew = [
    { name: 'Johnny Hotdog', hi: 8, ch: 10 },
    { name: 'Cuban', hi: 12, ch: 15 },
    { name: 'David Miller', hi: 5, ch: 6 },
    { name: 'Shooter McGavin', hi: 15, ch: 18 },
  ];
  const organizerId = id();
  await db.insert(s.players).values({ id: organizerId, isOrganizer: true, createdAt: now, name: 'Organizer', manualHandicapIndex: null, tenantId: TENANT_ID, contextId: CTX });
  const playerIds: string[] = [];
  for (const c of crew) {
    const pid = id();
    playerIds.push(pid);
    await db.insert(s.players).values({ id: pid, isOrganizer: false, createdAt: now, name: c.name, manualHandicapIndex: c.hi, tenantId: TENANT_ID, contextId: CTX });
  }

  // ── Event + round + roster group + pairing (slots 1&2 vs 3&4) ──
  const eventId = id();
  const eventRoundId = id();
  const groupId = id();
  const pairingId = id();
  const roundId = id();
  await db.insert(s.events).values({ id: eventId, name: 'Pete Dye Invitational', startDate: now, endDate: now + 86400000, timezone: 'America/New_York', organizerPlayerId: organizerId, createdAt: now, tenantId: TENANT_ID, contextId: CTX });
  await db.insert(s.eventRounds).values({ id: eventRoundId, eventId, roundNumber: 1, roundDate: now, courseRevisionId: courseRevId, teeColor: 'Dye', holesToPlay: 18, createdAt: now, tenantId: TENANT_ID, contextId: CTX });
  await db.insert(s.groups).values({ id: groupId, eventId, name: 'Roster', createdAt: now, tenantId: TENANT_ID, contextId: CTX });
  for (const pid of playerIds) await db.insert(s.groupMembers).values({ groupId, playerId: pid, tenantId: TENANT_ID, contextId: CTX });
  await db.insert(s.pairings).values({ id: pairingId, eventRoundId, foursomeNumber: 1, createdAt: now, tenantId: TENANT_ID, contextId: CTX });
  for (let i = 0; i < 4; i++) await db.insert(s.pairingMembers).values({ pairingId, playerId: playerIds[i]!, slotNumber: i + 1, tenantId: TENANT_ID, contextId: CTX });

  // ── F1 game-config (Standard Guyan, LOCKED = money mode) ──
  const guyan = {
    scope: 'foursome', game: 'guyan-2v2',
    pointValueSchedule: { kind: 'flat', cents: 500 },
    modifiers: [
      { type: 'net-skins', enabled: true, variant: { basis: 'net', bonus: 'single' } },
      { type: 'greenie', enabled: true, variant: { carryover: true } },
    ],
    lockState: 'locked', configVersion: 1,
  };
  await db.insert(s.gameConfig).values({ id: id(), level: 'event', refId: eventId, configJson: JSON.stringify(guyan), seedRuleSetRevisionId: null, lockState: 'locked', configVersion: 1, createdAt: now, updatedAt: now, tenantId: TENANT_ID, contextId: CTX });

  // ── Round + in_progress state + the PIN (resolved config + per-player CH) ──
  await db.insert(s.rounds).values({ id: roundId, eventId, eventRoundId, holesToPlay: 18, openedAt: now, openedByPlayerId: organizerId, createdAt: now, tenantId: TENANT_ID, contextId: CTX });
  await db.insert(s.roundStates).values({ roundId, state: 'in_progress', enteredAt: now, enteredByPlayerId: organizerId, tenantId: TENANT_ID, contextId: CTX });
  // Designate the viewer (Johnny Hotdog, slot 1) as the foursome's scorer so the
  // score-entry form renders (it gates on a scorer assignment, T5-6/T13-2).
  await db.insert(s.scorerAssignments).values({ roundId, foursomeNumber: 1, scorerPlayerId: playerIds[0]!, assignedAt: now, assignedByPlayerId: organizerId, tenantId: TENANT_ID, contextId: CTX });
  const perPlayerHandicaps: Record<string, { hi: number; ch: number }> = {};
  for (let i = 0; i < 4; i++) perPlayerHandicaps[playerIds[i]!] = { hi: crew[i]!.hi, ch: crew[i]!.ch };
  await db.insert(s.roundPins).values({ roundId, resolvedConfigJson: JSON.stringify(guyan), seedRuleSetRevisionId: null, courseRevisionId: courseRevId, tee: 'Dye', perPlayerHandicapsJson: JSON.stringify(perPlayerHandicaps), teamCompositionJson: null, createdAt: now, tenantId: TENANT_ID, contextId: CTX });

  // ── Front-9 scores (gross), tuned for nice notation + real money swings ──
  // rows: hole -> gross per slot [JH, Cuban, DM, Shooter]
  const SCORES: Array<[number, number, number, number, number]> = [
    [1, 4, 5, 3, 6], [2, 5, 4, 4, 5], [3, 2, 4, 3, 4], [4, 5, 6, 4, 7],
    [5, 4, 4, 3, 5], [6, 3, 5, 4, 6], [7, 3, 3, 2, 4], [8, 6, 5, 5, 7], [9, 4, 4, 4, 5],
  ];
  for (const [hole, ...gs] of SCORES) {
    for (let i = 0; i < 4; i++) {
      await db.insert(s.holeScores).values({ id: id(), roundId, playerId: playerIds[i]!, holeNumber: hole, grossStrokes: gs[i]!, putts: null, scorerPlayerId: playerIds[0]!, clientEventId: `b-${hole}-${i}`, createdAt: now, updatedAt: now, tenantId: TENANT_ID, contextId: CTX });
    }
  }

  // ── A few greenie/polie/sandie claims (append-only log) for the dot flair ──
  const claim = (pid: string, hole: number, claimType: 'greenie' | 'polie' | 'sandie') =>
    db.insert(s.holeClaimWrites).values({ id: id(), roundId, playerId: pid, holeNumber: hole, claimType, op: 'set', scorerPlayerId: playerIds[0]!, clientEventId: `c-${pid}-${hole}-${claimType}`, createdAt: now, tenantId: TENANT_ID, contextId: CTX });
  await claim(playerIds[2]!, 3, 'greenie'); // David Miller greenie on the par-3 3rd
  await claim(playerIds[0]!, 7, 'greenie'); // Johnny Hotdog greenie on the par-3 7th
  await claim(playerIds[0]!, 4, 'sandie');  // Johnny Hotdog sandie on 4
  await claim(playerIds[2]!, 6, 'polie');   // David Miller polie on 6

  // ── Viewer session (a crew member) so the browser can read the board ──
  const { sessionId } = await createSession(playerIds[0]!, { userAgent: 'brochure-seed', ip: '127.0.0.1' });

  const handoff = { eventId, eventRoundId, roundId, viewerSessionId: sessionId, scorerSessionId: sessionId, playerIds, names: crew.map((c) => c.name) };
  const handoffPath = process.env['BROCHURE_HANDOFF'] ?? resolve(process.cwd(), 'brochure-handoff.json');
  writeFileSync(handoffPath, JSON.stringify(handoff, null, 2));
  // eslint-disable-next-line no-console -- standalone script: stdout IS the interface
  console.log(`[brochure-seed] eventId=${eventId} roundId=${roundId} → ${handoffPath}`);
  client.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[brochure-seed] FAILED', err);
  process.exit(1);
});
