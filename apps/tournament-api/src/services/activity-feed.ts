/**
 * T8-2 activity-feed read service. Encapsulates the SELECT-from-activity
 * query for the GET /api/events/:eventId/activity route.
 *
 * Why this file exists separately from `routes/activity.ts`: T8-1's
 * ESLint gate blocks `import { activity } from '../db/schema/...'` from
 * any non-allowlisted file. This service is added to the allowlist
 * alongside `lib/activity.ts` so the route file can stay clean of
 * direct schema imports. The gate's purpose is to prevent direct
 * INSERT/UPDATE/DELETE — read access through this service is the
 * sanctioned pattern.
 */

import { and, eq, inArray, sql, desc, asc, type SQL } from 'drizzle-orm';
import type { db as Db } from '../db/index.js';
import { activity, players } from '../db/schema/index.js';
import {
  encodeCursor,
  decodeCursor,
  type CursorPosition,
} from './activity-cursor.js';
import {
  activityEventSchemas,
  type ActivityEvent,
  type ActivityType,
} from '../engine/types/activity-events.js';
import type { Logger } from 'pino';

type DbType = typeof Db;
type TxOrDb = Parameters<Parameters<DbType['transaction']>[0]>[0] | DbType;

const PAGE_LIMIT = 100;
const TENANT_ID = 'guyan';

/**
 * Activity payloads store player UUIDs, not names (T8-1 schema). The feed/toast/
 * banner headlines read these. We hydrate display names at READ time (works for
 * ALL past events, no payload migration) by mapping each id field to a sibling
 * `*Name` field the web headline builder prefers. Keys cover every player-id
 * field across the event union.
 */
const PLAYER_ID_TO_NAME_KEY: Record<string, string> = {
  playerId: 'playerName',
  actorPlayerId: 'actorPlayerName',
  scorerPlayerId: 'scorerPlayerName',
  fromPlayerId: 'fromPlayerName',
  toPlayerId: 'toPlayerName',
  playerAId: 'playerAName',
  playerBId: 'playerBName',
};

/**
 * Mutates each row's event in place, adding `*Name` fields resolved from a
 * single batched players lookup. Missing names are simply not added (the
 * headline falls back to the raw id). Best-effort: a lookup failure leaves the
 * rows un-hydrated rather than failing the whole feed read.
 */
async function hydratePlayerNames(
  tx: TxOrDb,
  rows: ActivityRow[],
  log: Logger,
): Promise<void> {
  const ids = new Set<string>();
  for (const r of rows) {
    const ev = r.event as unknown as Record<string, unknown>;
    for (const idKey of Object.keys(PLAYER_ID_TO_NAME_KEY)) {
      const v = ev[idKey];
      if (typeof v === 'string' && v.length > 0) ids.add(v);
    }
  }
  if (ids.size === 0) return;
  let nameById: Map<string, string>;
  try {
    const nameRows = await tx
      .select({ id: players.id, name: players.name })
      .from(players)
      .where(and(inArray(players.id, [...ids]), eq(players.tenantId, TENANT_ID)));
    nameById = new Map(nameRows.map((p) => [p.id, p.name]));
  } catch (err) {
    log.warn({ msg: 'activity_name_hydration_failed', err: String(err) });
    return;
  }
  for (const r of rows) {
    const ev = r.event as unknown as Record<string, unknown>;
    for (const [idKey, nameKey] of Object.entries(PLAYER_ID_TO_NAME_KEY)) {
      const v = ev[idKey];
      if (typeof v === 'string' && nameById.has(v)) ev[nameKey] = nameById.get(v);
    }
  }
}

export type ActivityRow = {
  id: string;
  createdAt: number;
  event: ActivityEvent;
};

export type ActivityResponse = {
  rows: ActivityRow[];
  nextCursorAfter: string | null;
  nextCursorBefore: string | null;
};

export type ActivityQueryMode =
  | { kind: 'initial' }
  | { kind: 'after'; cursor: CursorPosition; rawCursor: string }
  | { kind: 'before'; cursor: CursorPosition; rawCursor: string };

/**
 * Parse the (optional) `?after` / `?before` query params into a typed
 * mode. Throws InvalidCursorError on malformed cursors. Returns 'invalid'
 * code when both params are present (caller maps to 400).
 */
export function parseActivityQueryMode(args: {
  afterParam: string | undefined;
  beforeParam: string | undefined;
}): ActivityQueryMode | { kind: 'both' } {
  if (args.afterParam !== undefined && args.beforeParam !== undefined) {
    return { kind: 'both' };
  }
  if (args.afterParam !== undefined) {
    return {
      kind: 'after',
      cursor: decodeCursor(args.afterParam),
      rawCursor: args.afterParam,
    };
  }
  if (args.beforeParam !== undefined) {
    return {
      kind: 'before',
      cursor: decodeCursor(args.beforeParam),
      rawCursor: args.beforeParam,
    };
  }
  return { kind: 'initial' };
}

/**
 * Fetch one page of activity for the given event. Decodes payload_json
 * into the typed `ActivityEvent` discriminated union; rows whose JSON
 * fails Zod parse are filtered OUT of `rows` BUT still count toward
 * cursor advancement (so the next poll's cursor is past the corrupt
 * rows — they aren't re-fetched on every cycle).
 */
export async function getActivityPage(
  tx: TxOrDb,
  eventId: string,
  mode: ActivityQueryMode,
  log: Logger,
): Promise<ActivityResponse> {
  const baseFilter = and(
    eq(activity.eventId, eventId),
    eq(activity.tenantId, TENANT_ID),
  );

  let rangeFilter: SQL | undefined;
  if (mode.kind === 'after') {
    // strict-newer: created_at > X OR (created_at = X AND id > Y)
    rangeFilter = sql`(${activity.createdAt} > ${mode.cursor.createdAt} OR (${activity.createdAt} = ${mode.cursor.createdAt} AND ${activity.id} > ${mode.cursor.id}))`;
  } else if (mode.kind === 'before') {
    rangeFilter = sql`(${activity.createdAt} < ${mode.cursor.createdAt} OR (${activity.createdAt} = ${mode.cursor.createdAt} AND ${activity.id} < ${mode.cursor.id}))`;
  }

  const whereClause = rangeFilter ? and(baseFilter, rangeFilter) : baseFilter;

  // Order: ASC for after-mode (oldest-first so cursor advances forward),
  // DESC for before-mode and initial (newest-first display + backfill).
  const orderClauses =
    mode.kind === 'after'
      ? [asc(activity.createdAt), asc(activity.id)]
      : [desc(activity.createdAt), desc(activity.id)];

  const sqlRows = await tx
    .select({
      id: activity.id,
      createdAt: activity.createdAt,
      type: activity.type,
      payloadJson: activity.payloadJson,
    })
    .from(activity)
    .where(whereClause)
    .orderBy(...orderClauses)
    .limit(PAGE_LIMIT);

  // Decode + filter corrupt rows. Cursor uses PHYSICAL last/first row
  // from the SQL result, NOT the surviving decoded count — guarantees
  // pagination doesn't re-fetch corrupt rows on each cycle.
  const decodedRows: ActivityRow[] = [];
  for (const sqlRow of sqlRows) {
    const schema = activityEventSchemas[sqlRow.type as ActivityType];
    if (schema === undefined) {
      log.warn({
        msg: 'activity_unknown_type_skipped',
        activityId: sqlRow.id,
        type: sqlRow.type,
      });
      continue;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(sqlRow.payloadJson);
    } catch (err) {
      log.warn({
        msg: 'activity_corrupt_json_skipped',
        activityId: sqlRow.id,
        err: String(err),
      });
      continue;
    }
    const parseResult = schema.safeParse(payload);
    if (!parseResult.success) {
      log.warn({
        msg: 'activity_zod_parse_failed_skipped',
        activityId: sqlRow.id,
        err: parseResult.error.issues,
      });
      continue;
    }
    decodedRows.push({
      id: sqlRow.id,
      createdAt: sqlRow.createdAt,
      event: parseResult.data as ActivityEvent,
    });
  }

  // Cursor computation per AC #2 / Critical-2 fix:
  //   - non-empty page: cursor is the newest/oldest PHYSICAL row.
  //   - empty page on after-mode: echo the request cursor (caught up).
  //   - empty page on before-mode: echo the request cursor (no older).
  //   - empty page on initial: both null (never any activity).
  let nextCursorAfter: string | null;
  let nextCursorBefore: string | null;
  if (sqlRows.length > 0) {
    if (mode.kind === 'after') {
      // Result rows are ASC; newest is the LAST row.
      const newest = sqlRows[sqlRows.length - 1]!;
      const oldest = sqlRows[0]!;
      nextCursorAfter = encodeCursor({
        createdAt: newest.createdAt,
        id: newest.id,
      });
      nextCursorBefore = encodeCursor({
        createdAt: oldest.createdAt,
        id: oldest.id,
      });
    } else {
      // before-mode + initial: result rows are DESC; newest is FIRST.
      const newest = sqlRows[0]!;
      const oldest = sqlRows[sqlRows.length - 1]!;
      nextCursorAfter = encodeCursor({
        createdAt: newest.createdAt,
        id: newest.id,
      });
      nextCursorBefore = encodeCursor({
        createdAt: oldest.createdAt,
        id: oldest.id,
      });
    }
  } else if (mode.kind === 'after') {
    // Caught-up signal: echo the request cursor unchanged.
    nextCursorAfter = mode.rawCursor;
    nextCursorBefore = null;
  } else if (mode.kind === 'before') {
    nextCursorAfter = null;
    nextCursorBefore = mode.rawCursor;
  } else {
    nextCursorAfter = null;
    nextCursorBefore = null;
  }

  // Hydrate display names into the event payloads (UUID → name) for the
  // headline surfaces. Mutates decodedRows in place; best-effort.
  await hydratePlayerNames(tx, decodedRows, log);

  return {
    rows: decodedRows,
    nextCursorAfter,
    nextCursorBefore,
  };
}
