/**
 * T8-4 awards service. Detects first-birdie-of-event +
 * first-eagle-of-event awards at score-commit time and emits typed
 * `award.triggered` activity rows.
 *
 * Best-effort posture: the route caller (scores.ts) wraps invocations
 * in try/catch and SWALLOWS errors so a buggy detection NEVER rejects
 * a legitimate score commit. This file's responsibility is to emit
 * cleanly OR throw loudly — the route owns the swallow.
 *
 * Idempotency via SELECT-then-INSERT against the activity table. NOT
 * concurrency-safe under simultaneous score-commits on different
 * holes; rare-edge-case at Pinehurst-scale, accepted v1 — see story
 * spec risk-acceptance section.
 *
 * Scoped to `lib/activity.ts` + `services/activity-feed.ts` allowlist
 * tier in eslint.config.js: needs the `activity` schema import for
 * the SELECT, write-gate stays armed (only emitActivity is the
 * legitimate writer).
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { activity } from '../db/schema/index.js';
import type { db as Db } from '../db/index.js';
import { emitActivity } from '../lib/activity.js';
import type {
  ScoreCommittedEvent,
  AwardTriggeredEvent,
} from '../engine/types/activity-events.js';

type DbType = typeof Db;
type Tx = Parameters<Parameters<DbType['transaction']>[0]>[0];

const TENANT_ID = 'guyan';

type AwardType = 'first_birdie_of_event' | 'first_eagle_of_event';

export async function evaluateAwards(
  tx: Tx,
  event: ScoreCommittedEvent,
  log: Logger,
): Promise<void> {
  // Cheap pre-check: skip if not sub-par. Saves the idempotency query
  // for the 90%+ of normal commits. Gate on toPar directly per the
  // epic's award definition (line 2698) — `isBirdieOrBetter` is
  // computed from toPar so they should agree, but toPar is the SoT.
  if (event.toPar >= 0) return;

  const candidates: AwardType[] = ['first_birdie_of_event'];
  if (event.toPar <= -2) {
    candidates.push('first_eagle_of_event');
  }

  for (const awardType of candidates) {
    // Idempotency: query existing award.triggered activity for this
    // event + awardType. Concurrency-naive — see story risk acceptance.
    const existing = await tx
      .select({ id: activity.id })
      .from(activity)
      .where(
        and(
          eq(activity.eventId, event.eventId),
          eq(activity.tenantId, TENANT_ID),
          eq(activity.type, 'award.triggered'),
          sql`json_extract(${activity.payloadJson}, '$.awardType') = ${awardType}`,
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      log.debug({
        msg: 'awards_idempotent_skip',
        eventId: event.eventId,
        awardType,
        playerId: event.playerId,
      });
      continue;
    }

    const awardEvent: AwardTriggeredEvent = {
      type: 'award.triggered',
      eventId: event.eventId,
      roundId: event.roundId,
      awardType,
      playerId: event.playerId,
      context: {
        holeNumber: event.holeNumber,
        grossStrokes: event.grossStrokes,
        par: event.par,
      },
    };
    await emitActivity(tx, awardEvent);
    log.info({
      msg: 'awards_emitted',
      eventId: event.eventId,
      roundId: event.roundId,
      awardType,
      playerId: event.playerId,
      holeNumber: event.holeNumber,
    });
  }
}
