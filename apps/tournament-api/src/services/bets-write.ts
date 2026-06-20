/**
 * "The Action" betting — WRITE service (Story 1.1b).
 *
 * Owns bet CREATION. Every write goes through a caller-supplied `tx` so the
 * bet row, its two `bet_sides`, the audit row, and the activity row commit (or
 * roll back) atomically (P9 — audit/activity in the same tx as the mutation).
 * The pure settlement math lives in engine/bets/; this module only validates +
 * persists. Reads/settlement live in bets-query.ts (P8 chokepoint).
 *
 * Validation (Story 1.1 ACs / FRs):
 *   - betType/basis are OPEN enums (FR20) — validated against the CREATABLE
 *     sets here in code (Zod + this service), NOT a DB CHECK. Story 1.1 ships
 *     h2h + net only; an unknown type/basis is rejected AT CREATION (P6).
 *   - FR50: the two STAKEHOLDERS must differ. (A stakeholder MAY equal their
 *     own subject — the normal self-backing case, golden fixture (a); FR8 only
 *     means stakeholder CAN differ from subject, the open-book case, NOT must.)
 *   - The two SUBJECTS must differ (a player can't be h2h against himself).
 *   - FR9/FR51: every stakeholder and subject is a verified roster member of
 *     the event (group_members). Subjects are the score-dependent side.
 *   - FR49: placement cutoff — reject once any in-scope score exists for a
 *     subject on the bound round (can't bet after that segment has begun).
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import {
  bets,
  betSides,
  eventRounds,
  groupMembers,
  groups,
  holeScores,
  rounds,
} from '../db/schema/index.js';
import { AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES, writeAudit } from '../lib/audit-log.js';
import { emitActivity } from '../lib/activity.js';
import { scopedHolesForScope, type HoleScope } from '../engine/bets/scope.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const TENANT_ID = 'guyan';

/**
 * Bases that can be CREATED per bet type (FR20 open enum, gated in code not a
 * DB CHECK). Story 1.1: h2h+net. Story 1.2: per_hole_match+net/gross. Story 1.3:
 * h2h+gross (FR13). Putts stays invalid for both (match play FR12; h2h putts is
 * the Epic 3/4 putting game, not this type). The engine is basis-agnostic; this
 * map is the creation policy, the source of "unknown type/basis rejected at
 * creation" (P6).
 */
const CREATABLE_BASES_BY_TYPE: Record<string, readonly string[]> = {
  h2h: ['net', 'gross'],
  per_hole_match: ['net', 'gross'],
};

export class BetWriteError extends Error {
  readonly code: string;
  readonly status: 400 | 422;
  constructor(code: string, message: string, status: 400 | 422) {
    super(message);
    this.name = 'BetWriteError';
    this.code = code;
    this.status = status;
  }
}

const sideSchema = z
  .object({
    stakeholderPlayerId: z.string().uuid(),
    subjectPlayerId: z.string().uuid(),
  })
  .strict();

export const actionBetCreateSchema = z
  .object({
    eventRoundId: z.string().uuid(),
    betType: z.string().min(1),
    basis: z.string().min(1),
    holeScope: z.enum(['front', 'back', 'total', 'full18']),
    stakeCents: z.number().int().min(1),
    sideA: sideSchema,
    sideB: sideSchema,
  })
  .strict();

export type ActionBetCreateInput = z.infer<typeof actionBetCreateSchema>;

/**
 * Create one action bet (bet + 2 sides + audit + activity) in a single tx.
 * Throws BetWriteError on a validation failure (the route maps code+status).
 * Returns the new bet id.
 */
export async function createActionBet(
  tx: Tx,
  args: { eventId: string; actorPlayerId: string; input: ActionBetCreateInput },
): Promise<string> {
  const { eventId, actorPlayerId, input } = args;

  // betType/basis open-enum gate (FR20 — rejected at creation, P6).
  const allowedBases = CREATABLE_BASES_BY_TYPE[input.betType];
  if (!allowedBases) {
    throw new BetWriteError('unsupported_bet_type', `bet type ${input.betType} is not creatable`, 400);
  }
  if (!allowedBases.includes(input.basis)) {
    throw new BetWriteError('unsupported_basis', `basis ${input.basis} is not valid for ${input.betType}`, 400);
  }

  const stakeholderA = input.sideA.stakeholderPlayerId;
  const subjectA = input.sideA.subjectPlayerId;
  const stakeholderB = input.sideB.stakeholderPlayerId;
  const subjectB = input.sideB.subjectPlayerId;

  // FR50: the two stakeholders (who hold the money) must differ.
  if (stakeholderA === stakeholderB) {
    throw new BetWriteError('same_stakeholder_both_sides', 'a player cannot hold both sides', 400);
  }
  // A player cannot be h2h against himself.
  if (subjectA === subjectB) {
    throw new BetWriteError('same_subject_both_sides', 'the two subjects must differ', 400);
  }

  // Round must belong to the event; gives us holesToPlay for scope.
  const erRows = await tx
    .select({ id: eventRounds.id, holesToPlay: eventRounds.holesToPlay })
    .from(eventRounds)
    .where(
      and(
        eq(eventRounds.id, input.eventRoundId),
        eq(eventRounds.eventId, eventId),
        eq(eventRounds.tenantId, TENANT_ID),
      ),
    )
    .limit(1);
  if (erRows.length === 0) {
    throw new BetWriteError('round_not_in_event', 'event round does not belong to this event', 422);
  }
  const holesToPlay = erRows[0]!.holesToPlay;

  const scopedHoles = scopedHolesForScope(input.holeScope as HoleScope, holesToPlay);
  if (scopedHoles.length === 0) {
    throw new BetWriteError('empty_scope', `hole_scope ${input.holeScope} is empty for this round`, 422);
  }

  // FR9 (stakeholders) + FR51 (subjects): all four players are roster members
  // of the event. Subjects are additionally the score-dependent side.
  const distinctPlayers = [...new Set([stakeholderA, subjectA, stakeholderB, subjectB])];
  const memberRows = await tx
    .select({ playerId: groupMembers.playerId })
    .from(groupMembers)
    .innerJoin(groups, eq(groupMembers.groupId, groups.id))
    .where(
      and(
        eq(groups.eventId, eventId),
        inArray(groupMembers.playerId, distinctPlayers),
        eq(groups.tenantId, TENANT_ID),
        eq(groupMembers.tenantId, TENANT_ID),
      ),
    );
  const memberSet = new Set(memberRows.map((r) => r.playerId));
  for (const pid of distinctPlayers) {
    if (!memberSet.has(pid)) {
      throw new BetWriteError('players_not_in_event', 'all stakeholders and subjects must be on the event roster', 422);
    }
  }

  // FR49 placement cutoff: if the bound round is live and any in-scope hole
  // already has a score for a subject, betting on that segment is closed.
  const runtimeRoundRows = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.eventRoundId, input.eventRoundId), eq(rounds.tenantId, TENANT_ID)));
  if (runtimeRoundRows.length > 0) {
    const roundIds = runtimeRoundRows.map((r) => r.id);
    const existing = await tx
      .select({ holeNumber: holeScores.holeNumber })
      .from(holeScores)
      .where(
        and(
          inArray(holeScores.roundId, roundIds),
          inArray(holeScores.playerId, [subjectA, subjectB]),
          inArray(holeScores.holeNumber, scopedHoles),
          eq(holeScores.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new BetWriteError(
        'betting_closed_scores_exist',
        'a score already exists on an in-scope hole; betting is closed for this segment',
        422,
      );
    }
  }

  // Persist: bet + two sides + audit + activity, all in this tx.
  const betId = randomUUID();
  const now = Date.now();
  const ctx = `event:${eventId}`;

  await tx.insert(bets).values({
    id: betId,
    eventId,
    eventRoundId: input.eventRoundId,
    holeScope: input.holeScope,
    betType: input.betType,
    basis: input.basis,
    stakeCents: input.stakeCents,
    state: 'live',
    createdByPlayerId: actorPlayerId,
    createdAt: now,
    tenantId: TENANT_ID,
    contextId: ctx,
  });

  await tx.insert(betSides).values([
    {
      betId,
      side: 'A',
      stakeholderPlayerId: stakeholderA,
      subjectPlayerId: subjectA,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
    {
      betId,
      side: 'B',
      stakeholderPlayerId: stakeholderB,
      subjectPlayerId: subjectB,
      tenantId: TENANT_ID,
      contextId: ctx,
    },
  ]);

  await writeAudit(tx, {
    eventType: AUDIT_EVENT_TYPES.ACTION_BET_CREATED,
    entityType: AUDIT_ENTITY_TYPES.BET,
    entityId: betId,
    actorPlayerId,
    payload: {
      eventId,
      betId,
      eventRoundId: input.eventRoundId,
      betType: input.betType,
      basis: input.basis,
      holeScope: input.holeScope,
      stakeCents: input.stakeCents,
      sideA: { stakeholderPlayerId: stakeholderA, subjectPlayerId: subjectA },
      sideB: { stakeholderPlayerId: stakeholderB, subjectPlayerId: subjectB },
      createdByPlayerId: actorPlayerId,
    },
  });

  await emitActivity(tx, {
    type: 'action_bet.created',
    eventId,
    actorPlayerId,
    betId,
    betType: input.betType,
    basis: input.basis,
    holeScope: input.holeScope,
    stakeCents: input.stakeCents,
    stakeholderAId: stakeholderA,
    subjectAId: subjectA,
    stakeholderBId: stakeholderB,
    subjectBId: subjectB,
  });

  return betId;
}
