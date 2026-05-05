/**
 * T7-5 export service unit tests. Covers the pure helpers
 * (eventNameSlug, exportYmd, exportFilename) plus a small
 * shape-check on buildEventExport against an unknown event id.
 */

import { beforeAll, describe, expect, test, vi } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsFolder = resolve(__dirname, '../db/migrations');

vi.mock('../db/index.js', async () => {
  const client = createClient({ url: ':memory:' });
  const dbInstance = drizzle(client);
  await client.execute('PRAGMA foreign_keys = ON');
  return { client, db: dbInstance };
});

const { db } = await import('../db/index.js');
const { buildEventExport, eventNameSlug, exportYmd, exportFilename } = await import('./export.js');

beforeAll(async () => {
  await migrate(db, { migrationsFolder });
});

describe('eventNameSlug', () => {
  test('lowercases + hyphenates ASCII', () => {
    expect(eventNameSlug('Pinehurst 2026')).toBe('pinehurst-2026');
  });

  test('collapses runs of non-alphanumerics into one hyphen', () => {
    expect(eventNameSlug('A!@#B   C')).toBe('a-b-c');
  });

  test('strips leading + trailing hyphens', () => {
    expect(eventNameSlug('  hello  ')).toBe('hello');
  });

  test('truncates to 60 chars and removes trailing hyphen', () => {
    const long = 'long-name-' + 'x'.repeat(80);
    const slug = eventNameSlug(long);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  test('falls back to "event" for empty/all-non-alphanumeric inputs', () => {
    expect(eventNameSlug('')).toBe('event');
    expect(eventNameSlug('   ')).toBe('event');
    expect(eventNameSlug('!@#$%^')).toBe('event');
  });
});

describe('exportYmd', () => {
  test('formats today in event timezone — YYYYMMDD with no separators', () => {
    // Pin "now" to 2026-05-08 04:00 UTC = 2026-05-08 00:00 New York.
    const fixed = Date.UTC(2026, 4, 8, 4);
    expect(exportYmd('America/New_York', fixed)).toBe('20260508');
  });

  test('honours timezone — 18:00 UTC May 7 is May 8 in Auckland', () => {
    const fixed = Date.UTC(2026, 4, 7, 18); // Auckland is UTC+12 → May 8 06:00 NZST
    expect(exportYmd('Pacific/Auckland', fixed)).toBe('20260508');
    expect(exportYmd('America/New_York', fixed)).toBe('20260507');
  });
});

describe('exportFilename', () => {
  test('combines slug + ymd + .raw.json suffix', () => {
    const fixed = Date.UTC(2026, 4, 8, 4);
    expect(exportFilename('Pinehurst 2026', 'America/New_York', fixed)).toBe(
      'pinehurst-2026-20260508.raw.json',
    );
  });

  test('empty event name → event-{ymd}.raw.json', () => {
    const fixed = Date.UTC(2026, 4, 8, 4);
    expect(exportFilename('   ', 'America/New_York', fixed)).toBe(
      'event-20260508.raw.json',
    );
  });
});

describe('buildEventExport', () => {
  test('returns null for unknown event id', async () => {
    const result = await buildEventExport(db, 'definitely-not-a-real-event', 'guyan');
    expect(result).toBeNull();
  });
});
