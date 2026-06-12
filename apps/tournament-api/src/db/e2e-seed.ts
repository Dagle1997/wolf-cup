/**
 * E2E fixture seeder for the tournament-web Playwright suite (T14-1).
 *
 * Runs STANDALONE via tsx against a throwaway FILE db (DB_PATH). It drives the
 * REAL app in-process over HTTP with a REAL minted session — so every fixture
 * row is produced by the same production creation paths the app uses (event
 * creation, roster add, pairings lock), not by hand-rolled inserts that could
 * drift from the schema. Only the organizer player + course revision + the
 * organizer's session are bootstrapped directly (the auth/prereq seed).
 *
 * Mirrors the request shapes proven in `routes/onboarding-lifecycle.e2e.test.ts`,
 * except auth is a real `tournament_session` cookie (no `__testPlayer` mock) so
 * the cookie can be reused by Playwright's browser context.
 *
 * Invocation (from tournament-web global-setup, or by hand):
 *   DB_PATH=/tmp/e2e.db E2E_HANDOFF=/tmp/e2e-handoff.json \
 *   NODE_ENV=test AUTH_COOKIE_DOMAIN=localhost PUBLIC_APP_URL=http://localhost:5173 \
 *   GOOGLE_OAUTH_CLIENT_ID=x GOOGLE_OAUTH_CLIENT_SECRET=x ANTHROPIC_API_KEY=x \
 *   pnpm --filter @tournament/api exec tsx src/db/e2e-seed.ts
 *
 * Writes a handoff JSON ({ eventId, eventRoundId, groupId, organizerId,
 * sessionId, inviteToken, memberIds }) consumed by the specs.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, './migrations');

const TENANT_ID = 'guyan';
const CTX = 'league:guyan-wolf-cup-friday';

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

async function main(): Promise<void> {
  // Fresh fixture each run: drop the prior db file (+ wal/shm sidecars) so the
  // seed never accumulates duplicate events across runs. Gated on E2E_RESET so
  // this destructive step only fires for the e2e harness, never by accident.
  // MUST run BEFORE importing ./index.js (which opens the file at import time).
  const dbFile = process.env['DB_PATH'];
  if (dbFile && dbFile !== ':memory:') {
    // Ensure the temp dir exists before libsql (in ./index.js) opens the file.
    mkdirSync(dirname(dbFile), { recursive: true });
    if (process.env['E2E_RESET'] === '1') {
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(`${dbFile}${suffix}`, { force: true });
      }
    }
  }

  // Import AFTER the reset + AFTER this module loads so env.ts parses the
  // placeholder env the caller supplied (env.ts parses process.env at import).
  const { db, client } = await import('./index.js');
  const { app } = await import('../app.js');
  const { createSession } = await import('../lib/session.js');
  const {
    players,
    courses,
    courseRevisions,
    eventRounds,
    groups,
    invites,
    groupMembers,
  } = await import('./schema/index.js');

  await migrate(db, { migrationsFolder });

  const now = Date.now();

  // --- Bootstrap: organizer player + course revision (NOT under test) ---
  const organizerId = randomUUID();
  await db.insert(players).values({
    id: organizerId,
    isOrganizer: true,
    createdAt: now,
    name: 'E2E Organizer',
    tenantId: TENANT_ID,
    contextId: CTX,
  });

  const courseId = randomUUID();
  const courseRevId = randomUUID();
  await db.insert(courses).values({
    id: courseId,
    name: 'Guyan Golf & Country Club',
    clubName: 'Guyan',
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

  // --- Real organizer session (the cookie the browser will reuse) ---
  const { sessionId } = await createSession(organizerId, {
    userAgent: 'e2e-seed',
    ip: '127.0.0.1',
  });
  const cookie = `tournament_session=${sessionId}`;

  // --- Create event via the REAL admin route ---
  const startDate = Date.UTC(2026, 5, 12, 4);
  const createRes = await postJson(
    app,
    '/api/admin/events',
    {
      name: 'E2E Cup',
      start_date: startDate,
      end_date: startDate,
      timezone: 'America/New_York',
      rounds: [
        {
          round_date: startDate,
          course_revision_id: courseRevId,
          tee_color: 'blue',
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

  const groupId = (await db.select().from(groups).where(eq(groups.eventId, eventId)))[0]!.id;
  const eventRoundId = (
    await db.select().from(eventRounds).where(eq(eventRounds.eventId, eventId))
  )[0]!.id;
  const inviteToken = (await db.select().from(invites).where(eq(invites.eventId, eventId)))[0]!
    .token;

  // --- Add 3 accountless manual members (foursome 1 with the organizer) ---
  const memberNames = ['Matt Jaquint', 'Chris McNeely', 'Ronnie Adkins'];
  for (const name of memberNames) {
    const res = await postJson(
      app,
      `/api/admin/groups/${groupId}/members`,
      { mode: 'manual', name },
      cookie,
    );
    if (![200, 201].includes(res.status)) {
      throw new Error(`member add failed: ${res.status} ${await res.text()}`);
    }
  }
  const memberRows = await db
    .select({ playerId: groupMembers.playerId, name: players.name })
    .from(groupMembers)
    .innerJoin(players, eq(groupMembers.playerId, players.id))
    .where(eq(groupMembers.groupId, groupId));
  const memberIds = memberRows
    .filter((m) => memberNames.includes(m.name ?? ''))
    .map((m) => m.playerId);

  // --- Lock one foursome (the 3 members) via the REAL pairings route ---
  const pairRes = await postJson(
    app,
    `/api/admin/events/${eventId}/pairings`,
    {
      rounds: [
        {
          eventRoundId,
          pairings: [{ foursomeNumber: 1, locked: true, memberPlayerIds: memberIds }],
        },
      ],
    },
    cookie,
  );
  if (pairRes.status >= 300) {
    throw new Error(`pairings lock failed: ${pairRes.status} ${await pairRes.text()}`);
  }

  // Mint a session for one foursome MEMBER — the realistic scoring path is a
  // logged-in member scoring for the group (the 3 accountless players have no
  // session). The start-round spec designates this member as scorer; the
  // score-entry spec drives the round as them. (NB: the organizer-as-scorer
  // path that T13-2's start endpoint also allows is NOT scorable here —
  // scores.ts resolves the foursome by pairing membership only, so a non-member
  // organizer-scorer 404s at score-entry. Logged as an E2E-surfaced finding.)
  const scorerPlayerId = memberIds[0]!;
  const { sessionId: scorerSessionId } = await createSession(scorerPlayerId, {
    userAgent: 'e2e-seed',
    ip: '127.0.0.1',
  });

  const handoff = {
    eventId,
    eventRoundId,
    groupId,
    organizerId,
    sessionId,
    scorerPlayerId,
    scorerSessionId,
    inviteToken,
    memberIds,
    memberNames,
  };

  const handoffPath = process.env['E2E_HANDOFF'] ?? resolve(process.cwd(), 'e2e-handoff.json');
  writeFileSync(handoffPath, JSON.stringify(handoff, null, 2));
  // eslint-disable-next-line no-console -- standalone script: stdout IS the interface
  console.log(`[e2e-seed] wrote ${handoffPath}`);
  // eslint-disable-next-line no-console
  console.log(`[e2e-seed] eventId=${eventId} session=${sessionId.slice(0, 8)}…`);

  client.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console -- standalone script
  console.error('[e2e-seed] FAILED', err);
  process.exit(1);
});
