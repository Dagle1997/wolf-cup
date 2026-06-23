/**
 * T8-2 GET /api/events/:eventId/activity integration tests.
 *
 * Covers cursor pagination semantics (after / before / initial),
 * burst-drop invariant (250-row catch-up across exactly 3 cycles with
 * zero skips/duplicates), same-timestamp cursor stability via id
 * tiebreaker, malformed-cursor 400s, mutually-exclusive 400s, corrupt-
 * row defense (skipped from `rows` but cursor still advances past),
 * and cross-event isolation.
 *
 * Uses the `file::memory:?cache=shared` URL pattern documented in
 * `~/.claude/projects/D--wolf-cup/memory/feedback_libsql_memory_shared_cache.md`
 * so transactions opened by drizzle see the migrated schema.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: 'file::memory:?cache=shared' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

// Stub session middleware so we can control which player the request appears
// to come from without standing up arctic + cookies.
vi.mock('../middleware/require-session.js', async () => {
  const seenSessions = new Map<string, { playerId: string; isOrganizer: boolean }>();
  const requireSession = async (c: { req: { header: (n: string) => string | undefined }; set: (k: string, v: unknown) => void; json: (b: unknown, s: number) => unknown }, next: () => Promise<void>) => {
    const playerId = c.req.header('x-test-player-id');
    if (!playerId) {
      return c.json({ error: 'unauthenticated', code: 'no_session' }, 401);
    }
    const session = seenSessions.get(playerId) ?? { playerId, isOrganizer: false };
    c.set('player', { id: playerId, isOrganizer: session.isOrganizer, name: 'Test' });
    c.set('session', { playerId, sessionId: 'sess-' + playerId });
    await next();
    return undefined;
  };
  const _registerSession = (playerId: string, isOrganizer: boolean) =>
    seenSessions.set(playerId, { playerId, isOrganizer });
  return { requireSession, _registerSession };
});

const { db } = await import('../db/index.js');
const {
  activity,
  events,
  eventRounds,
  rounds,
  players,
  groups,
  groupMembers,
  courses,
  courseRevisions,
} = await import('../db/schema/index.js');
const { app } = await import('../app.js');

const TENANT = 'guyan';
const EVENT_A = 'evt-a-test-0001';
const EVENT_B = 'evt-b-test-0001';
const EVENT_ROUND_A = 'erd-a-test-0001';
const ROUND_A = 'rnd-a-test-0001';
const COURSE_A = 'crs-a-test-0001';
const COURSE_REVISION_A = 'crv-a-test-0001';
const ORG_A = 'plr-org-a';
const PARTICIPANT_A = 'plr-part-a';
const OUTSIDER = 'plr-outsider';
const GROUP_A = 'grp-a-test-0001';

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
  // Seed the FK chain for two events so cross-event isolation is testable.
  for (const [eventId, orgId, courseId, crvId, erdId, roundId, groupId] of [
    [EVENT_A, ORG_A, COURSE_A, COURSE_REVISION_A, EVENT_ROUND_A, ROUND_A, GROUP_A],
    [EVENT_B, 'plr-org-b', 'crs-b', 'crv-b', 'erd-b', 'rnd-b', 'grp-b'],
  ] as const) {
    await db.insert(players).values({
      id: orgId,
      name: 'Org',
      isOrganizer: true,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: 'players:test',
    });
    await db.insert(events).values({
      id: eventId,
      name: 'Test Event',
      startDate: Date.now(),
      endDate: Date.now() + 86_400_000,
      timezone: 'UTC',
      organizerPlayerId: orgId,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: `event:${eventId}`,
    });
    await db.insert(courses).values({
      id: courseId,
      name: `Test Course ${eventId}`,
      clubName: 'Test Club',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: `library:${TENANT}`,
    });
    await db.insert(courseRevisions).values({
      id: crvId,
      courseId,
      revisionNumber: 1,
      outTotal: 36,
      inTotal: 36,
      courseTotal: 72,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: `library:${TENANT}`,
    });
    await db.insert(eventRounds).values({
      id: erdId,
      eventId,
      roundNumber: 1,
      roundDate: Date.now(),
      courseRevisionId: crvId,
      teeColor: 'blue',
      holesToPlay: 18,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: `event:${eventId}`,
    });
    await db.insert(rounds).values({
      id: roundId,
      eventId,
      eventRoundId: erdId,
      holesToPlay: 18,
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: `round:${roundId}`,
    });
    await db.insert(groups).values({
      id: groupId,
      eventId,
      name: 'G',
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: `event:${eventId}`,
    });
  }
  // Add a participant in EVENT_A.
  await db.insert(players).values({
    id: PARTICIPANT_A,
    name: 'Participant A',
    isOrganizer: false,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'players:test',
  });
  await db.insert(players).values({
    id: OUTSIDER,
    name: 'Outsider',
    isOrganizer: false,
    createdAt: Date.now(),
    tenantId: TENANT,
    contextId: 'players:test',
  });
  await db.insert(groupMembers).values([
    {
      groupId: GROUP_A,
      playerId: PARTICIPANT_A,
      tenantId: TENANT,
      contextId: `event:${EVENT_A}`,
    },
    // Organizer also added as a group member — requireEventParticipant
    // checks group_members, not events.organizer_player_id, so orgs
    // who organize but aren't in a group would 403. In practice every
    // organizer is also in a foursome on trip day.
    {
      groupId: GROUP_A,
      playerId: ORG_A,
      tenantId: TENANT,
      contextId: `event:${EVENT_A}`,
    },
  ]);
});

afterAll(async () => {
  // libsql in-memory db torn down per-file by vitest.
});

beforeEach(async () => {
  await db.delete(activity);
});

// ---- Helpers --------------------------------------------------------------

type CursorObj = { createdAt: number; id: string };
function decodeCursor(s: string): CursorObj {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as CursorObj;
}
function encodeCursor(o: CursorObj): string {
  return Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
}

function makeUuidLike(seedHex: string): string {
  // Build a deterministic UUID-ish string from a 12-hex seed. The route's
  // cursor decoder requires UUID format, but `activity.id` itself is just
  // text — so we use a UUID-like shape so cursors round-trip.
  const padded = seedHex.padStart(12, '0');
  return `00000000-0000-4000-8000-${padded}`;
}

let seedSerial = 0;
async function seedActivity(opts: {
  eventId: string;
  count: number;
  startCreatedAt?: number;
  stepMs?: number;
  sameTimestamp?: boolean;
}): Promise<{ ids: string[]; createdAts: number[] }> {
  const ids: string[] = [];
  const createdAts: number[] = [];
  const start = opts.startCreatedAt ?? Date.now();
  const step = opts.stepMs ?? 10;
  for (let i = 0; i < opts.count; i++) {
    seedSerial++;
    const id = makeUuidLike(seedSerial.toString(16));
    const createdAt = opts.sameTimestamp ? start : start + i * step;
    ids.push(id);
    createdAts.push(createdAt);
    await db.insert(activity).values({
      id,
      eventId: opts.eventId,
      roundId: null,
      type: 'gallery.uploaded', // simple variant — only needs eventId + photoId + actorPlayerId
      actorPlayerId: ORG_A,
      payloadJson: JSON.stringify({
        type: 'gallery.uploaded',
        eventId: opts.eventId,
        actorPlayerId: ORG_A,
        photoId: 'ph-' + i,
      }),
      createdAt,
      tenantId: TENANT,
      contextId: `activity:${opts.eventId}`,
    });
  }
  return { ids, createdAts };
}

async function getFeed(
  url: string,
  asPlayerId: string,
): Promise<{ status: number; body: unknown }> {
  const res = await app.request(url, {
    method: 'GET',
    headers: { 'x-test-player-id': asPlayerId },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ---- Tests ----------------------------------------------------------------

describe('GET /api/events/:eventId/activity — auth', () => {
  test('401 when no x-test-player-id header (no session)', async () => {
    const res = await app.request(`/api/events/${EVENT_A}/activity`, {
      method: 'GET',
    });
    expect(res.status).toBe(401);
  });

  test('403 when caller has session but is not an event participant', async () => {
    const { status, body } = await getFeed(
      `/api/events/${EVENT_A}/activity`,
      OUTSIDER,
    );
    expect(status).toBe(403);
    expect((body as { code?: string }).code).toBeDefined();
  });

  test('200 for organizer of the event', async () => {
    const { status } = await getFeed(`/api/events/${EVENT_A}/activity`, ORG_A);
    expect(status).toBe(200);
  });

  test('200 for non-organizer participant of the event', async () => {
    const { status } = await getFeed(
      `/api/events/${EVENT_A}/activity`,
      PARTICIPANT_A,
    );
    expect(status).toBe(200);
  });

  test('403 when eventId does not exist (no-existence-leak via requireEventParticipant)', async () => {
    // requireEventParticipant 403s before the route's defensive 404
    // check would fire — that's the no-existence-leak invariant. The
    // route file's 404 branch is therefore effectively unreachable
    // for normal traffic; it's kept as defensive parity with
    // events-leaderboard.ts (codex impl-codex round-1 High #2).
    const { status } = await getFeed(
      `/api/events/evt-does-not-exist/activity`,
      ORG_A,
    );
    expect(status).toBe(403);
  });
});

describe('GET /api/events/:eventId/activity — cursor pagination', () => {
  test('initial page (no params) — small dataset returns DESC with usable cursors', async () => {
    await seedActivity({ eventId: EVENT_A, count: 25 });
    const { status, body } = await getFeed(
      `/api/events/${EVENT_A}/activity`,
      ORG_A,
    );
    expect(status).toBe(200);
    const resp = body as {
      rows: Array<{ id: string; createdAt: number; event: { type: string } }>;
      nextCursorAfter: string | null;
      nextCursorBefore: string | null;
    };
    expect(resp.rows).toHaveLength(25);
    // DESC: first row is newest.
    for (let i = 0; i < resp.rows.length - 1; i++) {
      expect(resp.rows[i]!.createdAt).toBeGreaterThanOrEqual(
        resp.rows[i + 1]!.createdAt,
      );
    }
    // Cursors set on non-empty page (codex-corrected semantics — NOT null when <100).
    expect(resp.nextCursorAfter).not.toBeNull();
    expect(resp.nextCursorBefore).not.toBeNull();
    const afterPos = decodeCursor(resp.nextCursorAfter!);
    expect(afterPos.id).toBe(resp.rows[0]!.id); // newest = nextCursorAfter
    const beforePos = decodeCursor(resp.nextCursorBefore!);
    expect(beforePos.id).toBe(resp.rows[resp.rows.length - 1]!.id); // oldest
  });

  test('initial page (no params) — empty event returns both cursors null', async () => {
    const { status, body } = await getFeed(
      `/api/events/${EVENT_A}/activity`,
      ORG_A,
    );
    expect(status).toBe(200);
    const resp = body as {
      rows: unknown[];
      nextCursorAfter: string | null;
      nextCursorBefore: string | null;
    };
    expect(resp.rows).toHaveLength(0);
    expect(resp.nextCursorAfter).toBeNull();
    expect(resp.nextCursorBefore).toBeNull();
  });

  test('initial page caps at 100 even with 250 rows', async () => {
    await seedActivity({ eventId: EVENT_A, count: 250 });
    const { body } = await getFeed(`/api/events/${EVENT_A}/activity`, ORG_A);
    const resp = body as { rows: unknown[]; nextCursorAfter: string };
    expect(resp.rows).toHaveLength(100);
    expect(resp.nextCursorAfter).not.toBeNull();
  });

  test('?after= ASC ordering, strictly newer than cursor', async () => {
    const seeded = await seedActivity({
      eventId: EVENT_A,
      count: 25,
      startCreatedAt: 1_000_000_000_000,
      stepMs: 10,
    });
    // Cursor before row 0.
    const cursor = encodeCursor({
      createdAt: seeded.createdAts[0]! - 1,
      id: '00000000-0000-4000-8000-000000000000',
    });
    const { body } = await getFeed(
      `/api/events/${EVENT_A}/activity?after=${cursor}`,
      ORG_A,
    );
    const resp = body as {
      rows: Array<{ id: string; createdAt: number }>;
      nextCursorAfter: string;
    };
    expect(resp.rows).toHaveLength(25);
    // ASC.
    for (let i = 0; i < resp.rows.length - 1; i++) {
      expect(resp.rows[i]!.createdAt).toBeLessThanOrEqual(
        resp.rows[i + 1]!.createdAt,
      );
    }
    // nextCursorAfter is the LAST (newest in ASC) row.
    const decodedAfter = decodeCursor(resp.nextCursorAfter);
    expect(decodedAfter.id).toBe(resp.rows[resp.rows.length - 1]!.id);
  });

  test('?after= caught-up: empty response echoes the request cursor', async () => {
    const seeded = await seedActivity({ eventId: EVENT_A, count: 5 });
    // Cursor at the very end (after the newest row).
    const cursor = encodeCursor({
      createdAt: seeded.createdAts[seeded.createdAts.length - 1]!,
      id: seeded.ids[seeded.ids.length - 1]!,
    });
    const { body } = await getFeed(
      `/api/events/${EVENT_A}/activity?after=${cursor}`,
      ORG_A,
    );
    const resp = body as {
      rows: unknown[];
      nextCursorAfter: string | null;
    };
    expect(resp.rows).toHaveLength(0);
    // Server echoed the request cursor — client recognizes "caught up"
    // via cursor equality.
    expect(resp.nextCursorAfter).toBe(cursor);
  });

  test('burst-drop: 250 rows consumed across 3 cycles in strictly ASC order with zero duplicates', async () => {
    const seeded = await seedActivity({ eventId: EVENT_A, count: 250 });
    let cursor = encodeCursor({
      createdAt: seeded.createdAts[0]! - 1,
      id: '00000000-0000-4000-8000-000000000000',
    });
    const consumedIds: string[] = [];
    let cycles = 0;
    for (let i = 0; i < 5; i++) {
      cycles++;
      const { body } = await getFeed(
        `/api/events/${EVENT_A}/activity?after=${cursor}`,
        ORG_A,
      );
      const resp = body as {
        rows: Array<{ id: string; createdAt: number }>;
        nextCursorAfter: string | null;
      };
      for (const row of resp.rows) consumedIds.push(row.id);
      // Caught-up signal: cursor did not advance.
      if (resp.nextCursorAfter === cursor || resp.nextCursorAfter === null) break;
      cursor = resp.nextCursorAfter;
      // Server-page-size signal: <100 means we're done after this read.
      if (resp.rows.length < 100) break;
    }
    expect(cycles).toBe(3); // exactly 100 + 100 + 50
    expect(consumedIds).toHaveLength(250);
    // Strictly ASC order = consumed matches seeded sequence.
    expect(consumedIds).toEqual(seeded.ids);
    // Zero duplicates.
    expect(new Set(consumedIds).size).toBe(250);
  });

  test('same-timestamp cursor stability — id ASC tiebreaker', async () => {
    const seeded = await seedActivity({
      eventId: EVENT_A,
      count: 5,
      startCreatedAt: 1_000_000_000_000,
      sameTimestamp: true,
    });
    const cursor = encodeCursor({
      createdAt: seeded.createdAts[0]!,
      id: '00000000-0000-4000-8000-000000000000', // before all seeded ids
    });
    const { body } = await getFeed(
      `/api/events/${EVENT_A}/activity?after=${cursor}`,
      ORG_A,
    );
    const resp = body as { rows: Array<{ id: string }> };
    expect(resp.rows).toHaveLength(5);
    // id ASC tiebreaker: ids should be in increasing lexicographic order.
    for (let i = 0; i < resp.rows.length - 1; i++) {
      expect(resp.rows[i]!.id < resp.rows[i + 1]!.id).toBe(true);
    }
    // Same set as seeded (all 5).
    expect(new Set(resp.rows.map((r) => r.id))).toEqual(new Set(seeded.ids));
  });

  test('?before= DESC ordering, strictly older than cursor', async () => {
    const seeded = await seedActivity({ eventId: EVENT_A, count: 25 });
    const cursor = encodeCursor({
      createdAt: seeded.createdAts[seeded.createdAts.length - 1]! + 1,
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', // after all
    });
    const { body } = await getFeed(
      `/api/events/${EVENT_A}/activity?before=${cursor}`,
      ORG_A,
    );
    const resp = body as {
      rows: Array<{ id: string; createdAt: number }>;
    };
    expect(resp.rows).toHaveLength(25);
    // DESC.
    for (let i = 0; i < resp.rows.length - 1; i++) {
      expect(resp.rows[i]!.createdAt).toBeGreaterThanOrEqual(
        resp.rows[i + 1]!.createdAt,
      );
    }
  });
});

describe('GET /api/events/:eventId/activity — bad request', () => {
  test('400 cursor_params_mutually_exclusive when both ?after and ?before present', async () => {
    const someCursor = encodeCursor({
      createdAt: 0,
      id: '00000000-0000-4000-8000-000000000000',
    });
    const { status, body } = await getFeed(
      `/api/events/${EVENT_A}/activity?after=${someCursor}&before=${someCursor}`,
      ORG_A,
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('cursor_params_mutually_exclusive');
  });

  test('400 invalid_cursor on non-base64', async () => {
    const { status, body } = await getFeed(
      `/api/events/${EVENT_A}/activity?after=!!!not-base64!!!`,
      ORG_A,
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('invalid_cursor');
  });

  test('400 invalid_cursor on missing id', async () => {
    const bad = Buffer.from(
      JSON.stringify({ createdAt: 1000 }),
      'utf8',
    ).toString('base64url');
    const { status, body } = await getFeed(
      `/api/events/${EVENT_A}/activity?after=${bad}`,
      ORG_A,
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('invalid_cursor');
  });
});

describe('GET /api/events/:eventId/activity — corrupt-row defense', () => {
  test('rows with corrupt JSON are filtered from response, cursor advances past them', async () => {
    // Seed 5 valid rows then 1 row with corrupt JSON, then 5 more.
    await seedActivity({
      eventId: EVENT_A,
      count: 5,
      startCreatedAt: 1_000_000,
      stepMs: 10,
    });
    // Corrupt row at createdAt 1_000_050 (between seeded #4 and what would be #5)
    await db.insert(activity).values({
      id: makeUuidLike('aaaa'),
      eventId: EVENT_A,
      roundId: null,
      type: 'gallery.uploaded',
      actorPlayerId: ORG_A,
      payloadJson: '{not valid json',
      createdAt: 1_000_050,
      tenantId: TENANT,
      contextId: `activity:${EVENT_A}`,
    });
    await seedActivity({
      eventId: EVENT_A,
      count: 5,
      startCreatedAt: 1_000_100,
      stepMs: 10,
    });

    const cursor = encodeCursor({
      createdAt: 999_999,
      id: '00000000-0000-4000-8000-000000000000',
    });
    const { body } = await getFeed(
      `/api/events/${EVENT_A}/activity?after=${cursor}`,
      ORG_A,
    );
    const resp = body as {
      rows: Array<{ id: string }>;
      nextCursorAfter: string;
    };
    // 10 valid rows survived; 1 corrupt was skipped.
    expect(resp.rows).toHaveLength(10);
    // Cursor advanced PAST the corrupt row (otherwise next poll would
    // re-fetch it forever). The cursor's createdAt should be at or
    // beyond 1_000_140 (the newest valid row's createdAt).
    const decoded = decodeCursor(resp.nextCursorAfter);
    expect(decoded.createdAt).toBeGreaterThanOrEqual(1_000_100);
  });
});

describe('GET /api/events/:eventId/activity — cross-event isolation', () => {
  test('event A returns only its own rows, not event B rows', async () => {
    await seedActivity({ eventId: EVENT_A, count: 10 });
    await seedActivity({ eventId: EVENT_B, count: 10 });
    const { body } = await getFeed(`/api/events/${EVENT_A}/activity`, ORG_A);
    const resp = body as {
      rows: Array<{ id: string; event: { eventId: string } }>;
    };
    expect(resp.rows).toHaveLength(10);
    for (const row of resp.rows) {
      expect(row.event.eventId).toBe(EVENT_A);
    }
    // Sanity: the activity table actually has 20 rows total.
    const allRows = await db
      .select({ id: activity.id })
      .from(activity)
      .where(eq(activity.tenantId, TENANT));
    expect(allRows).toHaveLength(20);
  });
});

describe('GET /api/events/:eventId/activity — player-name hydration', () => {
  test('score.committed event is augmented with the player display name', async () => {
    await db.insert(activity).values({
      id: makeUuidLike('aaa111'),
      eventId: EVENT_A,
      roundId: ROUND_A,
      type: 'score.committed',
      actorPlayerId: ORG_A,
      payloadJson: JSON.stringify({
        type: 'score.committed',
        eventId: EVENT_A,
        roundId: ROUND_A,
        actorPlayerId: ORG_A,
        playerId: PARTICIPANT_A,
        holeNumber: 1,
        grossStrokes: 3,
        par: 4,
        toPar: -1,
        isBirdieOrBetter: true,
        scorerPlayerId: ORG_A,
      }),
      createdAt: Date.now(),
      tenantId: TENANT,
      contextId: `activity:${EVENT_A}`,
    });
    const { body } = await getFeed(`/api/events/${EVENT_A}/activity`, ORG_A);
    const resp = body as {
      rows: Array<{ event: Record<string, unknown> }>;
    };
    expect(resp.rows).toHaveLength(1);
    const ev = resp.rows[0]!.event;
    // The raw ids survive AND the resolved names are injected as siblings.
    expect(ev['playerId']).toBe(PARTICIPANT_A);
    expect(ev['playerName']).toBe('Participant A');
    expect(ev['actorPlayerName']).toBe('Org');
  });
});
