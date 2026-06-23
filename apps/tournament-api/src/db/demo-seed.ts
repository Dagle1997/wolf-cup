/**
 * demo-seed.ts — ADDITIVE demo-event seeder for the Tournament app.
 *
 * Builds ONE complete demo event ("Pete Dye — Demo") so the leaderboard,
 * member-guest team standings, AND Guyan 2v2 money all render populated. It
 * drives the REAL app in-process over `app.request(...)` with a REAL minted
 * organizer session — every row is produced by the same production creation
 * paths the app uses (event create, roster add, pairings lock, start round,
 * score POST), so all validation/constraints/FKs are honored.
 *
 * SAFETY — ADDITIVE ONLY. This script NEVER drops/resets/deletes the DB or any
 * existing row (unlike e2e-seed.ts, which drops the file under E2E_RESET). It
 * only bootstraps its own demo organizer + course + course revision (directly,
 * the auth/prereq seed) and creates ONE new event and its children.
 *
 * IDEMPOTENCY — keyed on the well-known event name `Pete Dye — Demo` in the
 * `guyan` tenant. If such an event already exists, the script PRINTS its eventId
 * and EXITS WITHOUT creating anything (no duplicate, no corruption).
 *
 * The demo roster is added as MANUAL (accountless) players with name +
 * handicapIndex 0 — NOT GHIN-bound. GHIN is globally unique in this schema, so
 * binding real GHINs would risk colliding with real prod players and pulling
 * live handicaps; the dataset's gross scores are course-agnostic by design
 * (different course is fine per the product owner). handicapIndex 0 + a tee
 * rated exactly at par makes course handicap 0 → net == gross for the demo.
 *
 * WHY THE LEGACY 2v2 MONEY PATH (not the F1 game_config path):
 *   The money matrix has TWO 2v2 producers (a dual-read switch keyed on whether
 *   the event has an event-level `game_config` row = "F1"). The F1 chokepoint
 *   settles money but, in the current platform, surfaces NO per-hole team net in
 *   `computeFoursomeResults` ("per-hole F1 team net is Epic 4 — not surfaced
 *   here", money-detail.ts) — so `computeTeamStandings` and
 *   `computeMatchPlayStandings`, which both gate on `teamABestNet`, return
 *   ALL-ZERO for an F1 event. The LEGACY path (`compute2v2BestBall`, driven by
 *   the tenant's active rule_set) DOES populate per-hole team net → money +
 *   team-standings + match-play ALL render. So this demo deliberately does NOT
 *   seed an event game_config; it relies on the tenant rule_set for the stake.
 *
 * STAKE / ADDITIVE-SAFETY of the rule_set:
 *   The legacy stake comes from the tenant's most-recent rule_set
 *   (`fetchActive2v2Config`: most-recent by created_at). To stay strictly
 *   additive, this seed creates a $5/hole ("Standard Guyan") rule_set ONLY IF
 *   the tenant has NONE. If a rule_set already exists it is REUSED unchanged —
 *   the seed never overrides a tenant's active money config (which would change
 *   other events' money). On a throwaway local DB (no rule_set) the demo gets
 *   exactly $5/hole; on prod it uses whatever stake the tenant already runs.
 *
 * Invocation — LOCAL TEST (throwaway DB):
 *   DB_PATH=/tmp/tdemo.db NODE_ENV=test AUTH_COOKIE_DOMAIN=localhost \
 *   PUBLIC_APP_URL=http://localhost:5173 GOOGLE_OAUTH_CLIENT_ID=x \
 *   GOOGLE_OAUTH_CLIENT_SECRET=x ANTHROPIC_API_KEY=x \
 *   pnpm --filter @tournament/api exec tsx src/db/demo-seed.ts
 *
 * Invocation — PROD (later, by a human, inside the container):
 *   DB_PATH=/app/data/tournament.db node dist/db/demo-seed.js
 *   (Legacy 2v2 money is exposed unconditionally — it does NOT depend on
 *    TOURNAMENT_F1_MONEY_ENABLED, which only gates the F1 chokepoint this seed
 *    does not use.)
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, './migrations');

const TENANT_ID = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

/** The idempotency marker: a pre-existing event with this name is a no-op. */
const DEMO_EVENT_NAME = 'Pete Dye — Demo';

// ---------------------------------------------------------------------------
// Embedded dataset (copied from apps/api/.demo-dataset.json — NOT imported, so
// this script never depends on a Wolf Cup path at runtime). GHINs are recorded
// for provenance only; the seed adds players as manual (non-GHIN) roster rows.
// ---------------------------------------------------------------------------
type DemoPlayer = { name: string; ghin: string; gross: number[]; total: number };

const DEMO_PLAYERS: DemoPlayer[] = [
  { name: 'Ben McGinnis', ghin: '10515542', gross: [5, 5, 4, 5, 5, 3, 4, 7, 5, 4, 7, 3, 6, 5, 3, 4, 4, 5], total: 84 },
  { name: 'Chris McNeely', ghin: '1062316', gross: [6, 5, 6, 5, 5, 3, 4, 6, 4, 4, 6, 5, 4, 6, 4, 5, 5, 7], total: 90 },
  { name: 'Jason Moses', ghin: '6262305', gross: [6, 4, 5, 3, 3, 3, 3, 4, 5, 4, 7, 5, 4, 4, 5, 5, 4, 6], total: 80 },
  { name: 'Jay Patterson', ghin: '1599968', gross: [4, 6, 4, 4, 4, 3, 4, 5, 5, 7, 5, 3, 4, 4, 2, 5, 5, 4], total: 78 },
  { name: 'Jeff Madden', ghin: '1599956', gross: [6, 4, 4, 3, 5, 4, 4, 6, 5, 5, 5, 3, 4, 7, 3, 5, 4, 5], total: 82 },
  { name: 'Josh Stoll', ghin: '1236376', gross: [6, 6, 4, 5, 6, 4, 4, 6, 6, 5, 6, 4, 4, 4, 4, 5, 5, 4], total: 88 },
  { name: 'Kyle Cox', ghin: '2302549', gross: [6, 7, 4, 4, 4, 5, 4, 4, 5, 5, 4, 4, 5, 6, 4, 5, 3, 5], total: 84 },
  { name: 'Matt Jaquint', ghin: '1236373', gross: [6, 5, 4, 5, 4, 3, 3, 6, 4, 5, 5, 4, 5, 7, 3, 7, 7, 5], total: 88 },
  { name: 'Matt White', ghin: '448051', gross: [6, 4, 4, 4, 3, 5, 3, 4, 4, 5, 6, 3, 5, 5, 5, 5, 4, 3], total: 78 },
  { name: 'Ronnie Adkins', ghin: '4294331', gross: [4, 5, 5, 4, 5, 4, 3, 5, 4, 5, 6, 4, 4, 4, 4, 5, 4, 5], total: 80 },
  { name: 'Scott Pierson', ghin: '4294329', gross: [5, 5, 5, 7, 6, 3, 4, 8, 6, 6, 5, 4, 5, 7, 3, 6, 6, 5], total: 96 },
  { name: 'Sean Wilson', ghin: '2049346', gross: [6, 7, 6, 4, 6, 4, 4, 7, 4, 6, 7, 4, 7, 4, 6, 6, 5, 7], total: 100 },
];

/**
 * The member-guest 2-man teams + foursomes. Each foursome = a $5 Standard Guyan
 * 2v2 game; teamA plays teamB. Encoded via slot_number: the four names are
 * passed to the pairings route in slot order [teamA[0], teamA[1], teamB[0],
 * teamB[1]] → slots 1&2 = team A, slots 3&4 = team B (resolveFoursomeTeams).
 */
const FOURSOMES: Array<{ foursomeNumber: number; teamA: [string, string]; teamB: [string, string] }> = [
  { foursomeNumber: 1, teamA: ['Matt White', 'Sean Wilson'], teamB: ['Jay Patterson', 'Scott Pierson'] },
  { foursomeNumber: 2, teamA: ['Jason Moses', 'Chris McNeely'], teamB: ['Ronnie Adkins', 'Matt Jaquint'] },
  { foursomeNumber: 3, teamA: ['Jeff Madden', 'Josh Stoll'], teamB: ['Ben McGinnis', 'Kyle Cox'] },
];

// ---------------------------------------------------------------------------
// Course: Pete Dye Golf Club holes (par + stroke index) from the verified GHIN
// scorecard. The "Dye" tee (rating 71.3 → ratingTimes10 713, slope 130) is the
// tee the group plays. Bootstrapped directly (the auth/prereq seed) so the demo
// never depends on the prod course library carrying a valid tee.
// ---------------------------------------------------------------------------
const PETE_DYE_HOLES: Array<{ hole: number; par: number; si: number }> = [
  { hole: 1, par: 4, si: 7 }, { hole: 2, par: 4, si: 1 }, { hole: 3, par: 4, si: 15 },
  { hole: 4, par: 3, si: 13 }, { hole: 5, par: 5, si: 3 }, { hole: 6, par: 4, si: 11 },
  { hole: 7, par: 3, si: 17 }, { hole: 8, par: 5, si: 9 }, { hole: 9, par: 4, si: 5 },
  { hole: 10, par: 4, si: 4 }, { hole: 11, par: 5, si: 12 }, { hole: 12, par: 4, si: 16 },
  { hole: 13, par: 3, si: 18 }, { hole: 14, par: 4, si: 6 }, { hole: 15, par: 5, si: 8 },
  { hole: 16, par: 3, si: 14 }, { hole: 17, par: 4, si: 10 }, { hole: 18, par: 4, si: 2 },
];
// Rating is set to 720 (=72.0, exactly course par) so the round-start pin
// computes course handicap 0 for a handicapIndex-0 player (CH = round(0 ×
// slope/113 + (rating/10 − par)) = round(72.0 − 72) = 0) → net == gross exactly,
// as the demo intends. (The real Dye-tee rating is 71.3; using it would pin
// CH −1 and show net one stroke under gross.) Slope is irrelevant at HI 0.
const DYE_TEE = { teeColor: 'Dye', ratingTimes10: 720, slope: 130 };

async function postJson(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  path: string,
  body: unknown,
  cookie: string,
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

function log(msg: string): void {
  // eslint-disable-next-line no-console -- standalone script: stdout IS the interface
  console.log(`[demo-seed] ${msg}`);
}

async function main(): Promise<void> {
  // Ensure the DB_PATH directory exists before libsql (in ./index.js) opens the
  // file. NOTE: we do NOT delete anything — additive only.
  const dbFile = process.env['DB_PATH'];
  if (dbFile && dbFile !== ':memory:') {
    mkdirSync(dirname(dbFile), { recursive: true });
  }

  const { db, client } = await import('./index.js');
  const { app } = await import('../app.js');
  const { createSession } = await import('../lib/session.js');
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
    ruleSets,
    ruleSetRevisions,
  } = await import('./schema/index.js');

  // Migrate is idempotent (drizzle tracks applied migrations); safe on prod.
  await migrate(db, { migrationsFolder });

  const now = Date.now();

  // ── Idempotency gate: a pre-existing demo event is a no-op. ──
  const existing = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.name, DEMO_EVENT_NAME), eq(events.tenantId, TENANT_ID)))
    .limit(1);
  if (existing[0]) {
    log(`demo event already exists: eventId=${existing[0].id} — no-op (additive, no duplicate).`);
    client.close();
    return;
  }

  // ── Bootstrap: demo organizer + course revision + tee + 18 holes. ──
  // These are the auth/prereq seed (not under the app's creation paths); they
  // are uniquely-id'd new rows, never touching existing data.
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: now,
    name: 'Demo Organizer',
    tenantId: TENANT_ID,
    contextId: CTX,
  });

  const courseId = randomUUID();
  const courseRevId = randomUUID();
  await db.insert(courses).values({
    id: courseId,
    name: 'Pete Dye Golf Club (Demo)',
    clubName: 'Pete Dye',
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(courseRevisions).values({
    id: courseRevId,
    courseId,
    revisionNumber: 1,
    sourceUrl: null,
    extractionDate: null,
    verified: true,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  await db.insert(courseTees).values({
    id: randomUUID(),
    courseRevisionId: courseRevId,
    teeColor: DYE_TEE.teeColor,
    rating: DYE_TEE.ratingTimes10,
    slope: DYE_TEE.slope,
    tenantId: TENANT_ID,
    contextId: CTX,
  });
  for (const h of PETE_DYE_HOLES) {
    await db.insert(courseHoles).values({
      id: randomUUID(),
      courseRevisionId: courseRevId,
      holeNumber: h.hole,
      par: h.par,
      si: h.si,
      yardagePerTeeJson: '{}',
      tenantId: TENANT_ID,
      contextId: CTX,
    });
  }
  log(`bootstrapped course revision ${courseRevId} (tee=${DYE_TEE.teeColor})`);

  // ── Real organizer session (the cookie every app.request uses). ──
  const { sessionId } = await createSession(organizerId, {
    userAgent: 'demo-seed',
    ip: '127.0.0.1',
  });
  const cookie = `tournament_session=${sessionId}`;

  // ── Create the event via the REAL admin route. Single 18-hole round. ──
  const startDate = Date.UTC(2026, 5, 26, 12); // Jun 26 2026
  const createRes = await postJson(
    app,
    '/api/admin/events',
    {
      name: DEMO_EVENT_NAME,
      start_date: startDate,
      end_date: startDate,
      timezone: 'America/New_York',
      rounds: [
        {
          round_date: startDate,
          course_revision_id: courseRevId,
          tee_color: DYE_TEE.teeColor,
          holes_to_play: 18,
        },
      ],
    },
    cookie,
  );
  if (createRes.status !== 201) {
    throw new Error(`event create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const { eventId } = (await createRes.json()) as { eventId: string };
  log(`created event ${eventId}`);

  const groupId = (await db.select().from(groups).where(eq(groups.eventId, eventId)))[0]!.id;
  const eventRoundId = (
    await db.select().from(eventRounds).where(eq(eventRounds.eventId, eventId))
  )[0]!.id;

  // ── Add the 12 manual roster members (name + handicapIndex 0). ──
  for (const p of DEMO_PLAYERS) {
    const res = await postJson(
      app,
      `/api/admin/groups/${groupId}/members`,
      { mode: 'manual', name: p.name, manualHandicapIndex: 0 },
      cookie,
    );
    if (![200, 201].includes(res.status)) {
      throw new Error(`member add failed (${p.name}): ${res.status} ${await res.text()}`);
    }
  }

  // Resolve the playerId for each name (this event's group members). A manual
  // add always creates a NEW player row (no GHIN), so the name is unique within
  // this fresh group.
  const memberRows = await db
    .select({ playerId: groupMembers.playerId, name: players.name })
    .from(groupMembers)
    .innerJoin(players, eq(groupMembers.playerId, players.id))
    .where(eq(groupMembers.groupId, groupId));
  const idByName = new Map<string, string>();
  for (const m of memberRows) idByName.set(m.name ?? '', m.playerId);
  const nameToId = (name: string): string => {
    const id = idByName.get(name);
    if (!id) throw new Error(`roster member not found after add: ${name}`);
    return id;
  };
  log(`added ${memberRows.length} roster members`);

  // ── Lock 3 foursomes via the REAL pairings route. memberPlayerIds order
  //    is the slot order: [teamA0, teamA1, teamB0, teamB1]. ──
  const pairings = FOURSOMES.map((f) => ({
    foursomeNumber: f.foursomeNumber,
    locked: true,
    memberPlayerIds: [
      nameToId(f.teamA[0]),
      nameToId(f.teamA[1]),
      nameToId(f.teamB[0]),
      nameToId(f.teamB[1]),
    ],
  }));
  const pairRes = await postJson(
    app,
    `/api/admin/events/${eventId}/pairings`,
    { rounds: [{ eventRoundId, pairings }] },
    cookie,
  );
  if (pairRes.status >= 300) {
    throw new Error(`pairings lock failed: ${pairRes.status} ${await pairRes.text()}`);
  }
  log(`locked ${pairings.length} foursomes`);

  // ── Ensure a tenant rule_set exists so the LEGACY 2v2 money producer has a
  //    stake. ADDITIVE-SAFE: seed a $5/hole ("Standard Guyan") rule_set ONLY IF
  //    the tenant has none — never override an existing active config (which
  //    `fetchActive2v2Config` reads most-recent-first; overriding would change
  //    other events' money). NOTE: we deliberately do NOT seed an event-level
  //    game_config — that would route money to the F1 chokepoint, which leaves
  //    team-standings + match-play empty (Epic 4 gap; see header). ──
  const existingRuleSets = await db
    .select({ id: ruleSets.id })
    .from(ruleSets)
    .where(eq(ruleSets.tenantId, TENANT_ID))
    .limit(1);
  if (existingRuleSets.length === 0) {
    const ruleSetId = randomUUID();
    await db.insert(ruleSets).values({
      id: ruleSetId,
      name: 'Standard Guyan (Demo)',
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `library:${TENANT_ID}`,
    });
    await db.insert(ruleSetRevisions).values({
      id: randomUUID(),
      ruleSetId,
      revisionNumber: 1,
      configJson: JSON.stringify({
        basePerHoleCents: 500, // $5/hole
        sandies: false,
        sandiesBonusPerHoleCents: 0,
        greenieCarryover: false,
        greenieValidation: 'none',
        greenieBaseCents: 0,
        autoPressTriggerAtNDown: null,
        pressMultiplier: 2,
      }),
      effectiveFromRoundId: null,
      effectiveFromHole: 1,
      createdByPlayerId: organizerId,
      reason: 'seed:demo-standard-guyan',
      createdAt: now,
      tenantId: TENANT_ID,
      contextId: `library:${TENANT_ID}`,
    });
    log('seeded $5/hole tenant rule_set (none existed)');
  } else {
    log('tenant rule_set already exists — reusing it (additive; stake unchanged)');
  }

  // ── Start the round. The scorer for each foursome is its slot-1 member
  //    (a foursome member → satisfies requireScorerForRound on the score POST). ──
  const scorers = FOURSOMES.map((f) => ({
    foursomeNumber: f.foursomeNumber,
    scorerPlayerId: nameToId(f.teamA[0]),
  }));
  const startRes = await postJson(
    app,
    `/api/admin/event-rounds/${eventRoundId}/start`,
    { scorers },
    cookie,
  );
  if (startRes.status !== 201) {
    throw new Error(`start round failed: ${startRes.status} ${await startRes.text()}`);
  }
  const { roundId } = (await startRes.json()) as { roundId: string };
  log(`started round ${roundId}`);

  // ── Post 18 holes × 12 players = 216 scores. Each foursome's scorer (a
  //    member) posts for all four of that foursome's players. ──
  const memberSessions = new Map<string, string>(); // scorerPlayerId → cookie
  for (const f of FOURSOMES) {
    const scorerId = nameToId(f.teamA[0]);
    const { sessionId: sid } = await createSession(scorerId, {
      userAgent: 'demo-seed',
      ip: '127.0.0.1',
    });
    memberSessions.set(scorerId, `tournament_session=${sid}`);
  }

  const grossByName = new Map<string, number[]>();
  for (const p of DEMO_PLAYERS) grossByName.set(p.name, p.gross);

  let cells = 0;
  for (const f of FOURSOMES) {
    const scorerId = nameToId(f.teamA[0]);
    const scorerCookie = memberSessions.get(scorerId)!;
    const foursomeNames = [f.teamA[0], f.teamA[1], f.teamB[0], f.teamB[1]];
    for (const name of foursomeNames) {
      const playerId = nameToId(name);
      const gross = grossByName.get(name)!;
      for (let hole = 1; hole <= 18; hole++) {
        const res = await postJson(
          app,
          `/api/rounds/${roundId}/holes/${hole}/scores`,
          {
            playerId,
            grossStrokes: gross[hole - 1],
            clientEventId: `demo-${playerId}-h${hole}`,
          },
          scorerCookie,
        );
        if (![200, 201].includes(res.status)) {
          throw new Error(
            `score POST failed (${name} hole ${hole}): ${res.status} ${await res.text()}`,
          );
        }
        cells += 1;
      }
    }
  }
  log(`posted ${cells} hole scores (18 holes × 12 players)`);

  log(`DONE. eventId=${eventId} roundId=${roundId} organizer=${organizerId}`);
  log(`event name: "${DEMO_EVENT_NAME}" (re-running this script is a no-op).`);

  client.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- standalone script
  console.error('[demo-seed] FAILED', err);
  process.exit(1);
});
