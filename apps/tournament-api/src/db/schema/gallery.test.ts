/**
 * T7-4 gallery_photos schema tests. Covers FK posture (event CASCADE,
 * round SET NULL, player RESTRICT), UNIQUE r2_key, and ecosystem columns.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../migrations');

vi.mock('../index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db };
});

const { db } = await import('../index.js');
const {
  galleryPhotos,
  events,
  eventRounds,
  rounds,
  roundStates,
  players,
  courses,
  courseRevisions,
} = await import('./index.js');

const TENANT = 'guyan';
const CTX_LEAGUE = 'league:guyan-wolf-cup-friday';
const CTX_EVENT = 'event:e-gallery-1';

async function seedFixture() {
  const now = Date.now();

  await db.insert(players).values({
    id: 'p-organizer',
    isOrganizer: true,
    name: 'Org Player',
    createdAt: now,
    tenantId: TENANT,
    contextId: CTX_LEAGUE,
  });
  await db.insert(players).values({
    id: 'p-uploader',
    isOrganizer: false,
    name: 'Uploader Player',
    createdAt: now,
    tenantId: TENANT,
    contextId: CTX_LEAGUE,
  });

  await db.insert(courses).values({
    id: 'c-1',
    name: 'Pine Needles',
    clubName: 'Pine Needles GC',
    createdAt: now,
    tenantId: TENANT,
    contextId: CTX_LEAGUE,
  });
  await db.insert(courseRevisions).values({
    id: 'cr-1',
    courseId: 'c-1',
    revisionNumber: 1,
    outTotal: 36,
    inTotal: 36,
    courseTotal: 72,
    extractionDate: now,
    verified: false,
    createdAt: now,
    tenantId: TENANT,
    contextId: CTX_LEAGUE,
  });

  await db.insert(events).values({
    id: 'e-gallery-1',
    name: 'Gallery Test Event',
    startDate: now,
    endDate: now + 86_400_000,
    timezone: 'America/New_York',
    organizerPlayerId: 'p-organizer',
    createdAt: now,
    tenantId: TENANT,
    contextId: CTX_EVENT,
  });
  await db.insert(eventRounds).values({
    id: 'er-1',
    eventId: 'e-gallery-1',
    roundNumber: 1,
    roundDate: now,
    courseRevisionId: 'cr-1',
    teeColor: 'blue',
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT,
    contextId: CTX_EVENT,
  });
  await db.insert(rounds).values({
    id: 'r-1',
    eventId: 'e-gallery-1',
    eventRoundId: 'er-1',
    holesToPlay: 18,
    createdAt: now,
    tenantId: TENANT,
    contextId: CTX_EVENT,
  });
  await db.insert(roundStates).values({
    roundId: 'r-1',
    state: 'in_progress',
    enteredAt: now,
    enteredByPlayerId: 'p-organizer',
    tenantId: TENANT,
    contextId: CTX_EVENT,
  });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

beforeEach(async () => {
  await db.delete(galleryPhotos);
  await db.delete(roundStates);
  await db.delete(rounds);
  await db.delete(eventRounds);
  await db.delete(events);
  await db.delete(courseRevisions);
  await db.delete(courses);
  await db.delete(players);
  await seedFixture();
});

describe('gallery_photos schema', () => {
  test('insert + read round-trip with all columns', async () => {
    const now = Date.now();
    await db.insert(galleryPhotos).values({
      id: 'g-1',
      eventId: 'e-gallery-1',
      roundId: 'r-1',
      uploadedByPlayerId: 'p-uploader',
      r2Key: 'tournament/events/e-gallery-1/abcdef.jpg',
      contentType: 'image/jpeg',
      uploadedAt: now,
      tenantId: TENANT,
      contextId: CTX_EVENT,
    });

    const rows = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, 'g-1'));
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.eventId).toBe('e-gallery-1');
    expect(row.roundId).toBe('r-1');
    expect(row.uploadedByPlayerId).toBe('p-uploader');
    expect(row.r2Key).toBe('tournament/events/e-gallery-1/abcdef.jpg');
    expect(row.contentType).toBe('image/jpeg');
    expect(row.tenantId).toBe(TENANT);
    expect(row.contextId).toBe(CTX_EVENT);
  });

  test('event delete CASCADES gallery rows', async () => {
    await db.insert(galleryPhotos).values({
      id: 'g-cascade',
      eventId: 'e-gallery-1',
      roundId: 'r-1',
      uploadedByPlayerId: 'p-uploader',
      r2Key: 'tournament/events/e-gallery-1/cascade.jpg',
      contentType: 'image/jpeg',
      uploadedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX_EVENT,
    });

    // Cascade through the event-rounds → rounds → round_states chain too.
    await db.delete(roundStates).where(eq(roundStates.roundId, 'r-1'));
    await db.delete(rounds).where(eq(rounds.id, 'r-1'));
    await db.delete(eventRounds).where(eq(eventRounds.id, 'er-1'));
    await db.delete(events).where(eq(events.id, 'e-gallery-1'));

    const rows = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, 'g-cascade'));
    expect(rows.length).toBe(0);
  });

  test('round delete SETs NULL on round_id (photos preserved)', async () => {
    await db.insert(galleryPhotos).values({
      id: 'g-setnull',
      eventId: 'e-gallery-1',
      roundId: 'r-1',
      uploadedByPlayerId: 'p-uploader',
      r2Key: 'tournament/events/e-gallery-1/setnull.jpg',
      contentType: 'image/jpeg',
      uploadedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX_EVENT,
    });

    await db.delete(roundStates).where(eq(roundStates.roundId, 'r-1'));
    await db.delete(rounds).where(eq(rounds.id, 'r-1'));

    const rows = await db
      .select()
      .from(galleryPhotos)
      .where(eq(galleryPhotos.id, 'g-setnull'));
    expect(rows.length).toBe(1);
    expect(rows[0]!.roundId).toBeNull();
    expect(rows[0]!.eventId).toBe('e-gallery-1');
  });

  test('uploader delete blocked by RESTRICT FK', async () => {
    await db.insert(galleryPhotos).values({
      id: 'g-restrict',
      eventId: 'e-gallery-1',
      roundId: null,
      uploadedByPlayerId: 'p-uploader',
      r2Key: 'tournament/events/e-gallery-1/restrict.jpg',
      contentType: 'image/jpeg',
      uploadedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX_EVENT,
    });

    await expect(
      db.delete(players).where(eq(players.id, 'p-uploader')),
    ).rejects.toThrow();
  });

  test('duplicate r2_key fails UNIQUE constraint', async () => {
    const sharedKey = 'tournament/events/e-gallery-1/dup.jpg';
    await db.insert(galleryPhotos).values({
      id: 'g-dup-1',
      eventId: 'e-gallery-1',
      roundId: null,
      uploadedByPlayerId: 'p-uploader',
      r2Key: sharedKey,
      contentType: 'image/jpeg',
      uploadedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX_EVENT,
    });

    await expect(
      db.insert(galleryPhotos).values({
        id: 'g-dup-2',
        eventId: 'e-gallery-1',
        roundId: null,
        uploadedByPlayerId: 'p-uploader',
        r2Key: sharedKey,
        contentType: 'image/jpeg',
        uploadedAt: Date.now() + 1,
        tenantId: TENANT,
        contextId: CTX_EVENT,
      }),
    ).rejects.toThrow();
  });

  test('round_id NULL is permitted (unassociated upload)', async () => {
    await db.insert(galleryPhotos).values({
      id: 'g-null-round',
      eventId: 'e-gallery-1',
      roundId: null,
      uploadedByPlayerId: 'p-uploader',
      r2Key: 'tournament/events/e-gallery-1/nullround.jpg',
      contentType: 'image/png',
      uploadedAt: Date.now(),
      tenantId: TENANT,
      contextId: CTX_EVENT,
    });
    const rows = await db
      .select()
      .from(galleryPhotos)
      .where(
        and(
          eq(galleryPhotos.id, 'g-null-round'),
          eq(galleryPhotos.eventId, 'e-gallery-1'),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]!.roundId).toBeNull();
  });
});
