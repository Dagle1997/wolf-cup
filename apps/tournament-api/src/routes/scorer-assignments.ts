/**
 * T5-7 scorer-handoff endpoint.
 *
 * Mount: `app.route('/api/rounds', scorerAssignmentsRouter)`. Effective URL:
 * `POST /api/rounds/:roundId/scorer-assignments/transfer`.
 *
 * Atomically reassigns a foursome's scorer from one player to another.
 * Authorization model is per-event: either the CURRENT scorer of the
 * foursome OR the EVENT organizer (`events.organizer_player_id`, NOT
 * the global `players.is_organizer` flag) may transfer.
 *
 * The authoritative auth check + `fromPlayerId` capture both happen
 * INSIDE the transaction (TOCTOU-safe). The scorer-path UPDATE is
 * narrowed with `AND scorer_player_id = :fromPlayerId` so a stale
 * scorer's UPDATE affects 0 rows → 403 rollback. The organizer-path
 * drops that predicate (override semantics).
 *
 * State gate: handoff is rejected on `finalized` and `cancelled`
 * rounds. State is read directly from `round_states.state` (PK invariant
 * — single row per round). When T5-8 ships its `transitionState`
 * service, the state read moves inside the transaction (followup
 * T5-7f) closing the AC-2 → AC-5 race window.
 */

import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  events,
  eventScorerDesignees,
  groupMembers,
  groups,
  pairingMembers,
  pairings,
  rounds,
  scorerAssignments,
} from '../db/schema/index.js';
import { isEligibleScorer, isScorerPolicy } from '../lib/scorer-eligibility.js';
import { getRoundState } from '../services/round-state.js';
import { logger as moduleLogger } from '../lib/log.js';
import { requireSession } from '../middleware/require-session.js';
import {
  AUDIT_ENTITY_TYPES,
  AUDIT_EVENT_TYPES,
  writeAudit,
} from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';

const TENANT_ID = 'guyan';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const scorerTransferBodySchema = z.object({
  foursomeNumber: z.number().int().positive(),
  toPlayerId: z.string().uuid(),
});

export type ScorerTransferBody = z.infer<typeof scorerTransferBodySchema>;

export const scorerAssignmentsRouter = new Hono();

scorerAssignmentsRouter.post(
  '/:roundId/scorer-assignments/transfer',
  requireSession,
  async (c) => {
    const requestId = c.get('requestId') ?? randomUUID();
    const log = c.get('logger') ?? moduleLogger;
    const player = c.get('player')!;
    const roundId = c.req.param('roundId')!;

    // ── AC-1: roundId UUID validation ────────────────────────────────
    if (!UUID_RE.test(roundId)) {
      return c.json(
        { error: 'bad_request', code: 'invalid_round_id', requestId },
        400,
      );
    }

    // ── AC-1: body parse + Zod validation ────────────────────────────
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_body',
          reason: 'malformed_json',
          requestId,
        },
        400,
      );
    }
    const parsed = scorerTransferBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: 'validation_error',
          code: 'invalid_body',
          issues: parsed.error.issues,
          requestId,
        },
        400,
      );
    }
    const { foursomeNumber, toPlayerId } = parsed.data;

    // ── AC-2: round existence (tenant-scoped) ────────────────────────
    const roundRows = await db
      .select({
        id: rounds.id,
        eventId: rounds.eventId,
        eventRoundId: rounds.eventRoundId,
      })
      .from(rounds)
      .where(and(eq(rounds.id, roundId), eq(rounds.tenantId, TENANT_ID)))
      .limit(1);
    if (roundRows.length === 0) {
      return c.json(
        { error: 'not_found', code: 'round_not_found', requestId },
        404,
      );
    }
    const round = roundRows[0]!;
    if (round.eventRoundId === null || round.eventId === null) {
      // v1.5 standalone-round shape; v1 never writes nulls. Treat as a
      // round without pairings (handoff target undefined) — 422 setup-error
      // mirrors T5-6's foursome_has_no_scorer posture.
      return c.json(
        {
          error: 'unprocessable',
          code: 'foursome_has_no_scorer',
          requestId,
        },
        422,
      );
    }

    // ── State gate is now read INSIDE the transaction (T5-8 refactor).
    // Closes T5-7d (state-machine integration) + partially closes T5-7f
    // (race window). Full closure requires BEGIN IMMEDIATE; documented
    // as v1 residual + tracked in T5-8b. ────────────────────────────

    // ── Begin authoritative transaction (AC-2 → AC-5) ───────────────
    try {
      const result = await db.transaction(async (tx) => {
        // AC-2: in-tx state read via T5-8 service.
        const state = await getRoundState(tx, roundId, TENANT_ID);
        if (state === null) {
          return {
            kind: 'error' as const,
            status: 422 as const,
            body: {
              error: 'unprocessable',
              code: 'round_state_missing',
              requestId,
            },
          };
        }
        if (state === 'finalized') {
          return {
            kind: 'error' as const,
            status: 422 as const,
            body: {
              error: 'unprocessable',
              code: 'round_finalized',
              requestId,
            },
          };
        }
        if (state === 'cancelled') {
          return {
            kind: 'error' as const,
            status: 422 as const,
            body: {
              error: 'unprocessable',
              code: 'round_cancelled',
              requestId,
            },
          };
        }

        // AC-3 (i): in-tx SELECT current scorer → fromPlayerId.
        const scorerRows = await tx
          .select({
            scorerPlayerId: scorerAssignments.scorerPlayerId,
          })
          .from(scorerAssignments)
          .where(
            and(
              eq(scorerAssignments.roundId, roundId),
              eq(scorerAssignments.foursomeNumber, foursomeNumber),
              eq(scorerAssignments.tenantId, TENANT_ID),
            ),
          )
          .limit(1);
        if (scorerRows.length === 0) {
          return {
            kind: 'error' as const,
            status: 422 as const,
            body: {
              error: 'unprocessable',
              code: 'foursome_has_no_scorer',
              requestId,
            },
          };
        }
        const fromPlayerId = scorerRows[0]!.scorerPlayerId;

        // AC-3 (ii): in-tx SELECT event organizer (+ T13-4 scorer policy).
        const orgRows = await tx
          .select({
            organizerPlayerId: events.organizerPlayerId,
            scorerPolicy: events.scorerPolicy,
          })
          .from(events)
          .where(
            and(eq(events.id, round.eventId!), eq(events.tenantId, TENANT_ID)),
          )
          .limit(1);
        if (orgRows.length === 0) {
          // Defense: rounds.event_id is FK with onDelete cascade; reaching
          // here implies a referential-integrity break. 500 not 404.
          log.error({
            msg: 'scorer-handoff: rounds.event_id has no events row',
            requestId,
            roundId,
            eventId: round.eventId,
          });
          return {
            kind: 'error' as const,
            status: 500 as const,
            body: {
              error: 'internal',
              code: 'event_not_resolvable',
              requestId,
            },
          };
        }
        const organizerPlayerId = orgRows[0]!.organizerPlayerId;
        const policy = isScorerPolicy(orgRows[0]!.scorerPolicy)
          ? orgRows[0]!.scorerPolicy
          : 'foursome';

        // T13-4: gather the foursome's members + (per policy) the designee pool
        // and the event participant set — to evaluate scorer eligibility.
        const foursomeMemberRows = await tx
          .select({ playerId: pairingMembers.playerId })
          .from(pairingMembers)
          .innerJoin(pairings, eq(pairingMembers.pairingId, pairings.id))
          .where(
            and(
              eq(pairings.eventRoundId, round.eventRoundId!),
              eq(pairings.foursomeNumber, foursomeNumber),
              eq(pairings.tenantId, TENANT_ID),
              eq(pairingMembers.tenantId, TENANT_ID),
            ),
          );
        const foursomeMemberIds = new Set(foursomeMemberRows.map((r) => r.playerId));

        const designatedIds = new Set<string>();
        if (policy === 'designated') {
          const rows = await tx
            .select({ playerId: eventScorerDesignees.playerId })
            .from(eventScorerDesignees)
            .where(
              and(
                eq(eventScorerDesignees.eventId, round.eventId!),
                eq(eventScorerDesignees.tenantId, TENANT_ID),
              ),
            );
          for (const r of rows) designatedIds.add(r.playerId);
        }
        const participantIds = new Set<string>();
        if (policy === 'open') {
          const rows = await tx
            .select({ playerId: groupMembers.playerId })
            .from(groupMembers)
            .innerJoin(groups, eq(groupMembers.groupId, groups.id))
            .where(
              and(
                eq(groups.eventId, round.eventId!),
                eq(groups.tenantId, TENANT_ID),
                eq(groupMembers.tenantId, TENANT_ID),
              ),
            );
          for (const r of rows) participantIds.add(r.playerId);
        }

        const eligibilityFor = (candidateId: string): boolean =>
          isEligibleScorer({
            policy,
            designatedIds,
            foursomeMemberIds,
            organizerPlayerId,
            candidateId,
            candidateIsParticipant:
              participantIds.has(candidateId) || foursomeMemberIds.has(candidateId),
          });

        // AC-3 (iii) + T13-4: re-check authorization at write-time. The current
        // scorer or the organizer may hand off; an eligible player may also
        // CLAIM the role for THEMSELVES ("I'll score" one-tap handoff).
        const isCurrentScorer = fromPlayerId === player.id;
        const isEventOrganizer = organizerPlayerId === player.id;
        const isSelfClaim = toPlayerId === player.id && eligibilityFor(player.id);
        if (!isCurrentScorer && !isEventOrganizer && !isSelfClaim) {
          return {
            kind: 'error' as const,
            status: 403 as const,
            body: {
              error: 'forbidden',
              code: 'not_authorized_for_handoff',
              requestId,
            },
          };
        }

        // AC-4 + T13-4: the assignee must be an ELIGIBLE scorer under the policy
        // (was foursome-member-only). Keeps the 422 assignee code.
        if (!eligibilityFor(toPlayerId)) {
          return {
            kind: 'error' as const,
            status: 422 as const,
            body: {
              error: 'invalid_assignee',
              code: 'assignee_not_in_foursome',
              requestId,
            },
          };
        }

        // AC-5: TOCTOU-narrowed UPDATE.
        // App-time `assignedAt` (single source of truth — used in UPDATE,
        // audit JSON, and response per spec Risks/Followups Low #2).
        const assignedAt = Date.now();

        const updateBuilder = tx
          .update(scorerAssignments)
          .set({
            scorerPlayerId: toPlayerId,
            assignedAt,
            assignedByPlayerId: player.id,
          });

        // **Path selection:** organizer-path takes precedence when both
        // applies (caller is BOTH event organizer AND current scorer of
        // the foursome — possible in small leagues where the organizer
        // is playing). The organizer-path drops the TOCTOU narrowing
        // predicate so a concurrent transfer can't deny the organizer
        // their override authority. Scorer-path (narrowed) is used only
        // when the caller's authorization comes purely from being the
        // current scorer.
        // T5-8 state-gating: add an EXISTS predicate so the WRITE itself
        // re-checks state at commit-time. If a concurrent /finalize or
        // /cancel committed before this transaction's BEGIN, the EXISTS
        // sees the new state and the UPDATE returns 0 rows. (Within-snapshot
        // race window remains; followup T5-8b tracks BEGIN IMMEDIATE for
        // full closure.)
        const writableStateExists = sql`EXISTS (
          SELECT 1 FROM round_states
          WHERE round_states.round_id = ${scorerAssignments.roundId}
            AND round_states.tenant_id = ${TENANT_ID}
            AND round_states.state NOT IN ('finalized', 'cancelled')
        )`;
        const useOrganizerPath = isEventOrganizer;
        const updateResult = await (useOrganizerPath
          ? updateBuilder
              .where(
                and(
                  eq(scorerAssignments.roundId, roundId),
                  eq(scorerAssignments.foursomeNumber, foursomeNumber),
                  eq(scorerAssignments.tenantId, TENANT_ID),
                  writableStateExists,
                ),
              )
              .returning({ rowId: scorerAssignments.scorerPlayerId })
          : updateBuilder
              .where(
                and(
                  eq(scorerAssignments.roundId, roundId),
                  eq(scorerAssignments.foursomeNumber, foursomeNumber),
                  eq(scorerAssignments.scorerPlayerId, fromPlayerId),
                  eq(scorerAssignments.tenantId, TENANT_ID),
                  writableStateExists,
                ),
              )
              .returning({ rowId: scorerAssignments.scorerPlayerId }));

        if (updateResult.length === 0) {
          // 0 rows → either: (a) state flipped to finalized/cancelled, or
          // (b) scorer-path: concurrent transfer changed scorer_player_id.
          // Re-read state to disambiguate.
          const nowState = await getRoundState(tx, roundId, TENANT_ID);
          if (nowState === 'finalized') {
            return {
              kind: 'error' as const,
              status: 422 as const,
              body: {
                error: 'unprocessable',
                code: 'round_finalized',
                requestId,
              },
            };
          }
          if (nowState === 'cancelled') {
            return {
              kind: 'error' as const,
              status: 422 as const,
              body: {
                error: 'unprocessable',
                code: 'round_cancelled',
                requestId,
              },
            };
          }
          // State is still writable — must be the scorer-path TOCTOU case.
          if (!useOrganizerPath) {
            return {
              kind: 'error' as const,
              status: 403 as const,
              body: {
                error: 'forbidden',
                code: 'not_authorized_for_handoff',
                requestId,
              },
            };
          }
          return {
            kind: 'error' as const,
            status: 422 as const,
            body: {
              error: 'unprocessable',
              code: 'foursome_has_no_scorer',
              requestId,
            },
          };
        }

        // AC-5 (c): audit row.
        await writeAudit(tx, {
          eventType: AUDIT_EVENT_TYPES.SCORER_TRANSFERRED,
          entityType: AUDIT_ENTITY_TYPES.ROUND,
          entityId: roundId,
          actorPlayerId: player.id,
          payload: {
            foursomeNumber,
            fromPlayerId,
            toPlayerId,
            assignedAt,
          },
        });

        // AC-5 (d): activity emit (T8-1 typed). round.eventId is
        // guaranteed non-null at this point — line 123 returns 422 if
        // eventId is null before the transaction.
        await emitActivity(tx, {
          type: 'scorer.transferred',
          eventId: round.eventId!,
          roundId,
          actorPlayerId: player.id,
          foursomeNumber,
          fromPlayerId,
          toPlayerId,
        });

        return {
          kind: 'ok' as const,
          fromPlayerId,
          assignedAt,
        };
      });

      if (result.kind === 'error') {
        return c.json(result.body, result.status);
      }

      return c.json(
        {
          ok: true,
          foursomeNumber,
          fromPlayerId: result.fromPlayerId,
          toPlayerId,
          assignedAt: result.assignedAt,
          requestId,
        },
        200,
      );
    } catch (err) {
      log.error({
        msg: 'scorer-handoff transaction threw',
        requestId,
        roundId,
        err: String(err),
      });
      return c.json(
        { error: 'internal', code: 'transfer_failed', requestId },
        500,
      );
    }
  },
);
