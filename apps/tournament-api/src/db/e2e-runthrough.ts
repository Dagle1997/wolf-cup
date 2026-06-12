/**
 * T14-5 full-lifecycle RUN-THROUGH driver (manual, not a test).
 *
 * Builds a realistic event in-process (4-player foursome, real course tees +
 * 18 holes, a rule set, a cross-player bet), scores all 18 holes over REAL
 * HTTP, then DUMPS every read surface (leaderboard, money split, my-money,
 * foursome-results, settle) + exercises the scorer policy + finalizes. The
 * point is to eyeball the OUTPUTS for bugs the structural tests don't assert.
 *
 * Run:
 *   DB_PATH=... E2E_RESET=1 NODE_ENV=test AUTH_COOKIE_DOMAIN=localhost \
 *   PUBLIC_APP_URL=http://localhost:5173 GOOGLE_OAUTH_CLIENT_ID=x \
 *   GOOGLE_OAUTH_CLIENT_SECRET=x ANTHROPIC_API_KEY=x \
 *   node --import tsx src/db/e2e-runthrough.ts
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, './migrations');
const TENANT = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

const log = (...a: unknown[]) => console.log(...a); // eslint-disable-line no-console
const fmt = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;

async function main(): Promise<void> {
  const dbFile = process.env['DB_PATH'];
  if (dbFile && dbFile !== ':memory:') {
    mkdirSync(dirname(dbFile), { recursive: true });
    if (process.env['E2E_RESET'] === '1') for (const s of ['', '-wal', '-shm']) rmSync(`${dbFile}${s}`, { force: true });
  }
  const { db, client } = await import('./index.js');
  const { app } = await import('../app.js');
  const { createSession } = await import('../lib/session.js');
  const S = await import('./schema/index.js');
  await migrate(db, { migrationsFolder });

  const now = Date.now();
  const orgId = randomUUID();
  await db.insert(S.players).values({ id: orgId, isOrganizer: true, createdAt: now, name: 'Organizer', tenantId: TENANT, contextId: CTX });
  const courseId = randomUUID(); const courseRevId = randomUUID();
  await db.insert(S.courses).values({ id: courseId, name: 'Guyan', clubName: 'Guyan GCC', createdAt: now, tenantId: TENANT, contextId: CTX });
  await db.insert(S.courseRevisions).values({ id: courseRevId, courseId, revisionNumber: 1, sourceUrl: null, extractionDate: null, verified: true, outTotal: 36, inTotal: 36, courseTotal: 72, createdAt: now, tenantId: TENANT, contextId: CTX });
  await db.insert(S.courseTees).values({ id: randomUUID(), courseRevisionId: courseRevId, teeColor: 'blue', rating: 720, slope: 113, tenantId: TENANT, contextId: CTX });
  for (let h = 1; h <= 18; h++) await db.insert(S.courseHoles).values({ id: randomUUID(), courseRevisionId: courseRevId, holeNumber: h, par: 4, si: ((h * 7) % 18) + 1, yardagePerTeeJson: '{}', tenantId: TENANT, contextId: CTX });
  const ruleSetId = randomUUID();
  await db.insert(S.ruleSets).values({ id: ruleSetId, name: 'Standard', createdAt: now, tenantId: TENANT, contextId: `library:${TENANT}` });
  await db.insert(S.ruleSetRevisions).values({ id: randomUUID(), ruleSetId, revisionNumber: 1, configJson: JSON.stringify({ basePerHoleCents: 100, sandies: false, sandiesBonusPerHoleCents: 0, greenieCarryover: false, greenieValidation: 'none', greenieBaseCents: 0, autoPressTriggerAtNDown: null, pressMultiplier: 2 }), effectiveFromRoundId: null, effectiveFromHole: 1, createdByPlayerId: orgId, reason: null, createdAt: now, tenantId: TENANT, contextId: `library:${TENANT}` });

  const { sessionId } = await createSession(orgId, { userAgent: 'runthrough', ip: '127.0.0.1' });
  const orgCookie = `tournament_session=${sessionId}`;
  const post = (path: string, body: unknown, cookie = orgCookie, method = 'POST') =>
    app.request(path, { method, headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const get = (path: string, cookie = orgCookie) => app.request(path, { headers: { cookie } });

  const startDate = Date.UTC(2026, 5, 12, 4);
  const ev = await (await post('/api/admin/events', { name: 'Run-through Cup', start_date: startDate, end_date: startDate, timezone: 'America/New_York', rounds: [{ round_date: startDate, course_revision_id: courseRevId, tee_color: 'blue', holes_to_play: 18 }] })).json() as { eventId: string };
  const eventId = ev.eventId;
  const groupId = (await db.select().from(S.groups).where(eq(S.groups.eventId, eventId)))[0]!.id;
  const eventRoundId = (await db.select().from(S.eventRounds).where(eq(S.eventRounds.eventId, eventId)))[0]!.id;
  for (const name of ['Matt', 'Chris', 'Ronnie', 'Ben']) await post(`/api/admin/groups/${groupId}/members`, { mode: 'manual', name, manualHandicapIndex: 0 });
  const members = (await db.select({ id: S.groupMembers.playerId }).from(S.groupMembers).where(eq(S.groupMembers.groupId, groupId))).map((r) => r.id).sort();
  const nameById = new Map((await db.select({ id: S.players.id, name: S.players.name }).from(S.players)).map((p) => [p.id, p.name]));
  // teamA = members[0,1], teamB = members[2,3] (engine UUID sort).
  await post(`/api/admin/events/${eventId}/pairings`, { rounds: [{ eventRoundId, pairings: [{ foursomeNumber: 1, locked: true, memberPlayerIds: members }] }] });

  // Mint scorer session (members[0]) + start.
  const { sessionId: scorerSid } = await createSession(members[0]!, { userAgent: 'rt', ip: '127.0.0.1' });
  const scorerCookie = `tournament_session=${scorerSid}`;
  const startRes = await post(`/api/admin/event-rounds/${eventRoundId}/start`, { scorers: [{ foursomeNumber: 1, scorerPlayerId: members[0] }] });
  const { roundId } = await startRes.json() as { roundId: string };
  log(`\n=== START: event=${eventId.slice(0, 8)} round=${roundId.slice(0, 8)} status=${startRes.status} ===`);

  // Score 18 holes. teamA (members 0,1) plays slightly better: wins holes 1-11, loses 12-18.
  for (let h = 1; h <= 18; h++) {
    const aWins = h <= 11;
    const gross = [aWins ? 4 : 5, aWins ? 5 : 6, aWins ? 5 : 4, aWins ? 6 : 5]; // per member
    for (let i = 0; i < 4; i++) {
      const r = await post(`/api/rounds/${roundId}/holes/${h}/scores`, { playerId: members[i], grossStrokes: gross[i], clientEventId: `rt-${h}-${i}` }, scorerCookie);
      if (r.status >= 300) log(`  !! score hole ${h} p${i} → ${r.status} ${await r.text()}`);
    }
  }
  // A manual press at hole 12 area already passed; file one now (holes remain? all scored → expect 422).
  const pressRes = await post(`/api/rounds/${roundId}/presses`, { team: 'teamA' }, scorerCookie);
  log(`press after full round → ${pressRes.status} ${(await pressRes.text()).slice(0, 80)}`);

  // Cross-player bet: members[0] vs members[2], $1/hole.
  const betRes = await post(`/api/events/${eventId}/bets`, { playerAId: members[0], playerBId: members[2], betType: 'match_play_per_hole', stakePerHoleCents: 100, applicableRoundIds: [eventRoundId], config: {} }, scorerCookie);
  log(`bet create → ${betRes.status}`);

  const show = (label: string) => log(`\n──────── ${label} ────────`);

  // 1. Leaderboard
  show('LEADERBOARD');
  const lb = await (await get(`/api/events/${eventId}/leaderboard`, scorerCookie)).json() as { rows: Array<{ playerId: string; playerName?: string; grossThroughHole?: number; throughHole?: number; netToParThroughHole?: number }> };
  for (const r of lb.rows) log(`  ${(nameById.get(r.playerId) ?? '?').padEnd(8)} through ${r.throughHole ?? '-'} gross ${r.grossThroughHole ?? '-'}`);

  // 2. Money split
  show('MONEY (combined / team / individual)');
  const money = await (await get(`/api/events/${eventId}/money`, scorerCookie)).json() as { players: Array<{ id: string; name: string }>; totals: Record<string, number>; teamLedger: { totals: Record<string, number> }; individualLedger: { totals: Record<string, number> } };
  for (const p of money.players) {
    const c = money.totals[p.id] ?? 0, t = money.teamLedger.totals[p.id] ?? 0, ind = money.individualLedger.totals[p.id] ?? 0;
    const ok = t + ind === c ? 'OK' : `!! ${fmt(t)}+${fmt(ind)}≠${fmt(c)}`;
    log(`  ${(p.name ?? '?').padEnd(8)} combined ${fmt(c).padStart(9)}  team ${fmt(t).padStart(9)}  indiv ${fmt(ind).padStart(9)}  [${ok}]`);
  }

  // 3. My-money for members[0] and members[2]
  for (const m of [members[0]!, members[2]!]) {
    show(`MY MONEY — ${nameById.get(m)}`);
    const mm = await (await get(`/api/events/${eventId}/my-money`, `tournament_session=${(await createSession(m, { userAgent: 'rt', ip: '127.0.0.1' })).sessionId}`)).json() as { totalNetCents: number; games: Array<{ label: string; netToViewerCents: number; perRound: Array<{ perHole: Array<{ moneyToViewerCents: number }> }> }> };
    let gsum = 0;
    for (const g of mm.games) {
      const holeSum = g.perRound.reduce((a, r) => a + r.perHole.reduce((b, h) => b + h.moneyToViewerCents, 0), 0);
      const recon = holeSum === g.netToViewerCents ? 'OK' : `!! holes ${fmt(holeSum)} ≠ net ${fmt(g.netToViewerCents)}`;
      log(`  ${g.label.padEnd(24)} ${fmt(g.netToViewerCents).padStart(9)}  [${recon}]`);
      gsum += g.netToViewerCents;
    }
    log(`  ${'TOTAL'.padEnd(24)} ${fmt(mm.totalNetCents).padStart(9)}  [${gsum === mm.totalNetCents ? 'OK' : `!! games ${fmt(gsum)}`}]`);
  }

  // 4. Foursome results
  show('FOURSOME RESULTS');
  const fr = await (await get(`/api/events/${eventId}/event-rounds/${eventRoundId}/foursome-results`, scorerCookie)).json() as { foursomes: Array<{ foursomeNumber: number; teamA: Array<{ name: string | null }>; teamB: Array<{ name: string | null }>; teamATotalCents: number; perHole: Array<{ holeNumber: number; winner: string | null; moneyTeamACents: number }> }> };
  for (const f of fr.foursomes) {
    const holeSum = f.perHole.reduce((a, h) => a + h.moneyTeamACents, 0);
    const aWins = f.perHole.filter((h) => h.winner === 'teamA').length, bWins = f.perHole.filter((h) => h.winner === 'teamB').length, ties = f.perHole.filter((h) => h.winner === 'tie').length;
    log(`  F${f.foursomeNumber}: ${f.teamA.map((p) => p.name).join('&')} vs ${f.teamB.map((p) => p.name).join('&')}`);
    log(`     holes A:${aWins} B:${bWins} tie:${ties}  teamA total ${fmt(f.teamATotalCents)}  [${holeSum === f.teamATotalCents ? 'OK' : `!! holeSum ${fmt(holeSum)}`}]`);
  }

  // 5. Scorer policy exercise
  show('SCORER POLICY');
  log(`  GET → ${(await (await get(`/api/admin/events/${eventId}/scorer-policy`)).text()).slice(0, 120)}`);
  const putDes = await post(`/api/admin/events/${eventId}/scorer-policy`, { policy: 'designated', designatedPlayerIds: [members[1]] }, orgCookie, 'PUT');
  log(`  PUT designated [Chris-ish] → ${putDes.status}`);
  const putStranger = await post(`/api/admin/events/${eventId}/scorer-policy`, { policy: 'designated', designatedPlayerIds: [randomUUID()] }, orgCookie, 'PUT');
  log(`  PUT designated [stranger] → ${putStranger.status} ${(await putStranger.text()).slice(0, 60)}`);

  // 6. Finalize
  show('LIFECYCLE');
  const comp = await post(`/api/rounds/${roundId}/complete`, {}, orgCookie);
  log(`  complete → ${comp.status} ${comp.status >= 300 ? (await comp.text()).slice(0, 100) : ''}`);
  const fin = await post(`/api/rounds/${roundId}/finalize`, {}, orgCookie);
  log(`  finalize → ${fin.status} ${fin.status >= 300 ? (await fin.text()).slice(0, 100) : ''}`);
  const state = (await db.select().from(S.roundStates).where(eq(S.roundStates.roundId, roundId))).map((r) => r.state);
  log(`  round states: ${state.join(', ')}`);

  log('\n=== RUN-THROUGH COMPLETE ===\n');
  client.close();
}

main().catch((e) => { console.error('RUN-THROUGH FAILED', e); process.exit(1); }); // eslint-disable-line no-console
