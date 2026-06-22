/**
 * GET /api/events/:eventId/leaderboard?round=<roundId | 'current' | omitted>
 *
 * Cross-group stroke-play leaderboard (T5-5). Gated by `requireSession` +
 * `requireEventParticipant` (T3-8). Recomputes on every read per
 * architecture D1-1 (no cache v1).
 *
 * Scope selection (per spec section 7 + AC-4):
 *   - `?round=<UUID>`            → scope='round' for that round
 *   - `?round=current`           → scope='round' resolved per ordering rule
 *   - param omitted              → scope='event' (aggregates across rounds)
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { and, eq, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { eventRounds, events, gameConfig, rounds, roundStates } from '../db/schema/index.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import { requireEventParticipant } from '../middleware/require-event-participant.js';
import { f1MoneyEnabled } from '../lib/env.js';
import {
  computeLeaderboard,
  type LeaderboardOpts,
  type LeaderboardRow,
} from '../services/leaderboard.js';

const TENANT_ID = 'guyan';

/**
 * F1 leaderboard MODE (Story 1.4, AC8). Resolves whether the event is F1 (an
 * event-level game_config row) and its lock_state → the leaderboard money mode.
 *   - locked   → money / P&L mode
 *   - unlocked → scores-only + private My Money
 * `moneyEnabled` mirrors the TOURNAMENT_F1_MONEY_ENABLED exposure gate; while
 * off, the web surface shows "F1 money not yet enabled" rather than dollars.
 */
type F1LeaderboardMode = {
  isF1: true;
  lockState: 'locked' | 'unlocked';
  mode: 'money' | 'scores_only';
  moneyEnabled: boolean;
} | { isF1: false };

async function resolveF1Mode(eventId: string): Promise<F1LeaderboardMode> {
  const rows = await db
    .select({ lockState: gameConfig.lockState })
    .from(gameConfig)
    .where(
      and(
        eq(gameConfig.level, 'event'),
        eq(gameConfig.refId, eventId),
        eq(gameConfig.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  if (rows.length === 0) return { isF1: false };
  const lockState = rows[0]!.lockState === 'unlocked' ? 'unlocked' : 'locked';
  return {
    isF1: true,
    lockState,
    mode: lockState === 'locked' ? 'money' : 'scores_only',
    moneyEnabled: f1MoneyEnabled(),
  };
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RoundSummary = {
  id: string;
  eventRoundId: string | null;
  name: string;
  status: string | null;
};

type LeaderboardResponse = {
  rows: LeaderboardRow[];
  round: RoundSummary | null;
  scope: 'round' | 'event';
  computedAt: string;
  /** F1 leaderboard money mode (Story 1.4, AC8); omitted for non-F1 events. */
  f1?: { lockState: 'locked' | 'unlocked'; mode: 'money' | 'scores_only'; moneyEnabled: boolean };
};

export const eventsLeaderboardRouter = new Hono();

eventsLeaderboardRouter.get(
  '/:eventId/leaderboard',
  requireSession,
  requireEventParticipant,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const eventId = c.req.param('eventId');
    const roundParam = c.req.query('round');

    if (!eventId) {
      return c.json(
        { error: 'internal', code: 'middleware_misuse_no_event_id', requestId },
        500,
      );
    }

    // Defensive: confirm the event exists. requireEventParticipant has
    // already verified the caller is a member, but doesn't 404 on
    // unknown events (it 403s instead). For trip-day clarity we return
    // 404 here when the event id doesn't resolve.
    const eventRow = await db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.tenantId, TENANT_ID)))
      .limit(1);
    if (eventRow.length === 0) {
      return c.json({ error: 'not_found', code: 'event_not_found', requestId }, 404);
    }

    let opts: LeaderboardOpts;
    let resolvedRound: RoundSummary | null = null;

    if (roundParam === undefined) {
      // No `?round=` param → event scope.
      opts = { scope: 'event' };
    } else if (roundParam === 'current') {
      const currentId = await resolveCurrentRoundId(eventId);
      if (currentId === null) {
        // Event exists but has zero rounds yet. Per spec section 7,
        // return 200 with empty rows + null round.
        const f1Mode = await resolveF1Mode(eventId);
        const response: LeaderboardResponse = {
          rows: [],
          round: null,
          scope: 'round',
          computedAt: new Date().toISOString(),
          ...(f1Mode.isF1
            ? { f1: { lockState: f1Mode.lockState, mode: f1Mode.mode, moneyEnabled: f1Mode.moneyEnabled } }
            : {}),
        };
        return c.json(response, 200);
      }
      opts = { roundId: currentId, scope: 'round' };
      resolvedRound = await fetchRoundSummary(currentId);
    } else {
      if (!UUID_RE.test(roundParam)) {
        return c.json(
          { error: 'bad_request', code: 'invalid_round_id', requestId },
          400,
        );
      }
      // Verify the round belongs to this event before computing.
      const ownership = await db
        .select({ id: rounds.id })
        .from(rounds)
        .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
        .where(
          and(
            eq(rounds.id, roundParam),
            eq(eventRounds.eventId, eventId),
            eq(rounds.tenantId, TENANT_ID),
            eq(eventRounds.tenantId, TENANT_ID),
          ),
        )
        .limit(1);
      if (ownership.length === 0) {
        return c.json(
          { error: 'not_found', code: 'round_not_found', requestId },
          404,
        );
      }
      opts = { roundId: roundParam, scope: 'round' };
      resolvedRound = await fetchRoundSummary(roundParam);
    }

    try {
      const rows = await computeLeaderboard(
        { db, tenantId: TENANT_ID },
        eventId,
        opts,
      );
      const f1Mode = await resolveF1Mode(eventId);
      const response: LeaderboardResponse = {
        rows,
        round: resolvedRound,
        scope: opts.scope,
        computedAt: new Date().toISOString(),
        ...(f1Mode.isF1
          ? { f1: { lockState: f1Mode.lockState, mode: f1Mode.mode, moneyEnabled: f1Mode.moneyEnabled } }
          : {}),
      };
      return c.json(response, 200);
    } catch (err) {
      log.error({ msg: 'computeLeaderboard threw', requestId, err: String(err) });
      return c.json(
        { error: 'internal', code: 'leaderboard_compute_failed', requestId },
        500,
      );
    }
  },
);

/**
 * Resolves the `round=current` semantics:
 *   1. Most-recent in_progress round for the event
 *   2. else most-recent complete_editable
 *   3. else most-recent any state
 *   4. else null (event has zero rounds)
 *
 * "Most recent" = `ORDER BY rounds.opened_at DESC NULLS LAST,
 * rounds.created_at DESC, rounds.id DESC`. Deterministic.
 *
 * **Schema invariant relied on here:** `round_states.round_id` is a
 * PRIMARY KEY (apps/tournament-api/src/db/schema/scoring.ts:198), so
 * there is at most ONE row per round — the current lifecycle state.
 * History goes to `audit_log`. The state-preference branches below
 * therefore filter on the single current row; no "latest by entered_at"
 * subquery is needed. If a future migration ever converts
 * `round_states` to an append-only history shape, this function and
 * `fetchRoundSummary` below MUST switch to a "MAX(entered_at) per round"
 * subquery to avoid matching stale states.
 */
async function resolveCurrentRoundId(eventId: string): Promise<string | null> {
  // Single query: pick by state preference using a CASE-based ordering key
  // (in_progress=0, complete_editable=1, anything else=2; nulls=3).
  // Simpler: do three sequential queries for clarity.
  for (const state of ['in_progress', 'complete_editable']) {
    const row = await db
      .select({ id: rounds.id })
      .from(rounds)
      .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
      .innerJoin(roundStates, eq(roundStates.roundId, rounds.id))
      .where(
        and(
          eq(eventRounds.eventId, eventId),
          eq(roundStates.state, state),
          eq(rounds.tenantId, TENANT_ID),
          eq(eventRounds.tenantId, TENANT_ID),
          eq(roundStates.tenantId, TENANT_ID),
        ),
      )
      .orderBy(
        sql`${rounds.openedAt} DESC NULLS LAST`,
        desc(rounds.createdAt),
        desc(rounds.id),
      )
      .limit(1);
    if (row.length > 0) return row[0]!.id;
  }
  // Fallback: most recent of any state.
  const fallback = await db
    .select({ id: rounds.id })
    .from(rounds)
    .innerJoin(eventRounds, eq(eventRounds.id, rounds.eventRoundId))
    .where(
      and(
        eq(eventRounds.eventId, eventId),
        eq(rounds.tenantId, TENANT_ID),
        eq(eventRounds.tenantId, TENANT_ID),
      ),
    )
    .orderBy(
      sql`${rounds.openedAt} DESC NULLS LAST`,
      desc(rounds.createdAt),
      desc(rounds.id),
    )
    .limit(1);
  return fallback.length > 0 ? fallback[0]!.id : null;
}

async function fetchRoundSummary(roundId: string): Promise<RoundSummary | null> {
  // Tenant-scoped on every joined table (defense-in-depth: even though
  // round-id collisions across tenants are unlikely with UUIDs, the
  // services-layer convention requires explicit `tenant_id` filters on
  // every join).
  const row = await db
    .select({
      id: rounds.id,
      eventRoundId: rounds.eventRoundId,
      roundNumber: eventRounds.roundNumber,
      state: roundStates.state,
    })
    .from(rounds)
    .leftJoin(
      eventRounds,
      and(
        eq(eventRounds.id, rounds.eventRoundId),
        eq(eventRounds.tenantId, TENANT_ID),
      ),
    )
    .leftJoin(
      roundStates,
      and(
        eq(roundStates.roundId, rounds.id),
        eq(roundStates.tenantId, TENANT_ID),
      ),
    )
    .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
    .limit(1);
  if (row.length === 0) return null;
  const r = row[0]!;
  return {
    id: r.id,
    eventRoundId: r.eventRoundId,
    name: r.roundNumber ? `Round ${r.roundNumber}` : 'Round',
    status: r.state,
  };
}
