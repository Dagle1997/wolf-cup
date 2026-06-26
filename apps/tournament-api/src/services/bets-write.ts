/**
 * "The Action" betting — WRITE service (Stories 1.1b, 1.4).
 *
 * Owns bet CREATION, EDIT, and VOID. Every write goes through a caller-supplied
 * `tx` so the bet row, its `bet_sides`, the audit row, and the activity row
 * commit (or roll back) atomically (P9 — audit/activity in the same tx as the
 * mutation). The pure settlement math lives in engine/bets/; this module only
 * validates + persists. Reads/settlement live in bets-query.ts (P8 chokepoint).
 *
 * Validation (Story 1.1 ACs / FRs), shared by create + edit via
 * `validateBetParams`:
 *   - betType/basis are OPEN enums (FR20) — validated against the CREATABLE
 *     sets here in code (Zod + this service), NOT a DB CHECK.
 *   - FR50: the two STAKEHOLDERS must differ. (A stakeholder MAY equal their
 *     own subject — the normal self-backing case, golden fixture (a); FR8 only
 *     means stakeholder CAN differ from subject, the open-book case, NOT must.)
 *   - The two SUBJECTS must differ (a player can't be h2h against himself).
 *   - FR9/FR51: every stakeholder and subject is a verified roster member of
 *     the event (group_members). Subjects are the score-dependent side.
 *   - FR49: placement cutoff — reject once any in-scope score exists for a
 *     subject on the bound round (can't bet after that segment has begun),
 *     UNLESS the organizer passes `override` (FR49 admin override, Story 1.4) —
 *     the override is recorded explicitly in the audit row.
 *
 * Story 1.4 lifecycle (P4 — durable `state` is the single source of truth):
 *   - edit: only a 'live' bet is editable; the outcome recomputes on read from
 *     the new config (FR4), so edit just replaces config + sides and writes a
 *     before/after audit + activity in one tx.
 *   - void: only a 'live' bet is voidable; sets state='void' + voided_at/by.
 *     `settleActionBet` already short-circuits 'void' to no edges, so a voided
 *     bet contributes nothing to settle-up and the ledger stays zero-sum
 *     (FR5/FR47/NFR-C4) — audit history is preserved.
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
import { loadBetWithSides } from './bets-query.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const TENANT_ID = 'guyan';

/** Per-bet cap for the PLAYER self-serve path ($1,000). The organizer is uncapped. */
const SELF_SERVE_MAX_STAKE_CENTS = 100_000;

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
  over_under: ['net', 'gross'],
};

// over_under line bounds — any realistic 18-hole total (net or gross).
const OVER_UNDER_LINE_MIN = 1;
const OVER_UNDER_LINE_MAX = 200;

export class BetWriteError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409 | 422;
  constructor(code: string, message: string, status: 400 | 403 | 404 | 409 | 422) {
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

/** Bet parameters shared by create + edit (Story 1.4 edit is a full replace). */
export const actionBetParamsSchema = z
  .object({
    eventRoundId: z.string().uuid(),
    betType: z.string().min(1),
    basis: z.string().min(1),
    holeScope: z.enum(['front', 'back', 'total', 'full18']),
    stakeCents: z.number().int().min(1),
    // over_under ONLY: the strokes line. Optional at the schema level (other
    // bet types omit it); required + range-checked for over_under in
    // validateBetParams so the error is a clean coded 400, not a Zod shape error.
    line: z.number().int().optional(),
    sideA: sideSchema,
    sideB: sideSchema,
    // Who may SEE this bet on the player-facing board. Optional → 'event_wide'
    // (the default — a public bet). 'stakeholders_only' hides it from everyone
    // but the two stakeholders (+ the organizer, who always sees all).
    visibility: z.enum(['event_wide', 'stakeholders_only']).optional(),
  })
  .strict();

// Back-compat name (Story 1.1 route import) + the edit alias (Story 1.4).
export const actionBetCreateSchema = actionBetParamsSchema;
export const actionBetEditSchema = actionBetParamsSchema;

export type ActionBetCreateInput = z.infer<typeof actionBetParamsSchema>;
export type ActionBetEditInput = ActionBetCreateInput;

/**
 * Validate bet parameters for create OR edit. Throws BetWriteError on the first
 * failure. `allowScoresExist` = the FR49 admin override: when true, the
 * placement cutoff is skipped (the override is audited by the caller).
 */
async function validateBetParams(
  tx: Tx,
  eventId: string,
  input: ActionBetCreateInput,
  opts: { allowScoresExist: boolean },
): Promise<void> {
  // betType/basis open-enum gate (FR20 — rejected at creation, P6).
  const allowedBases = CREATABLE_BASES_BY_TYPE[input.betType];
  if (!allowedBases) {
    throw new BetWriteError('unsupported_bet_type', `bet type ${input.betType} is not creatable`, 400);
  }
  if (!allowedBases.includes(input.basis)) {
    throw new BetWriteError('unsupported_basis', `basis ${input.basis} is not valid for ${input.betType}`, 400);
  }

  // Whole-dollar stakes only (error-proofing, Josh 2026-06-20): no cents. The
  // value is still stored/settled in cents; we just reject fractional dollars.
  if (input.stakeCents % 100 !== 0) {
    throw new BetWriteError('non_whole_dollar_stake', 'stake must be a whole dollar amount (no cents)', 400);
  }

  const stakeholderA = input.sideA.stakeholderPlayerId;
  const subjectA = input.sideA.subjectPlayerId;
  const stakeholderB = input.sideB.stakeholderPlayerId;
  const subjectB = input.sideB.subjectPlayerId;

  // FR50: the two stakeholders (who hold the money) must differ.
  if (stakeholderA === stakeholderB) {
    throw new BetWriteError('same_stakeholder_both_sides', 'a player cannot hold both sides', 400);
  }
  if (input.betType === 'over_under') {
    // over_under is ONE subject + a strokes line: side A backs UNDER, side B
    // backs OVER, both on the SAME subject. The line is required + sane.
    if (subjectA !== subjectB) {
      throw new BetWriteError('over_under_single_subject', 'over/under is one subject on both sides', 400);
    }
    if (
      input.line === undefined ||
      input.line === null ||
      !Number.isInteger(input.line) ||
      input.line < OVER_UNDER_LINE_MIN ||
      input.line > OVER_UNDER_LINE_MAX
    ) {
      throw new BetWriteError(
        'over_under_needs_line',
        `over/under requires an integer line (${OVER_UNDER_LINE_MIN}–${OVER_UNDER_LINE_MAX})`,
        400,
      );
    }
  } else {
    // A player cannot be h2h / per-hole-match against himself.
    if (subjectA === subjectB) {
      throw new BetWriteError('same_subject_both_sides', 'the two subjects must differ', 400);
    }
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
  // already has a score for a subject, betting on that segment is closed —
  // UNLESS the organizer is exercising the admin override (Story 1.4).
  if (!opts.allowScoresExist) {
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
  }
}

/**
 * Create one action bet (bet + 2 sides + audit + activity) in a single tx.
 * Throws BetWriteError on a validation failure (the route maps code+status).
 * `override` = FR49 admin override (create after an in-scope score exists);
 * recorded explicitly in the audit row. Returns the new bet id.
 */
export async function createActionBet(
  tx: Tx,
  args: {
    eventId: string;
    actorPlayerId: string;
    input: ActionBetCreateInput;
    override?: boolean;
    /**
     * Player self-serve guardrail: when true, the actor MUST be one of the two
     * stakeholders. This stops a participant from unilaterally committing only
     * OTHER players' money — they have to have skin in the bet they post. The
     * organizer path leaves this false (they arrange bets between others).
     */
    requireActorIsStakeholder?: boolean;
  },
): Promise<string> {
  const { eventId, actorPlayerId, input } = args;
  const override = args.override ?? false;

  await validateBetParams(tx, eventId, input, { allowScoresExist: override });

  const stakeholderA = input.sideA.stakeholderPlayerId;
  const subjectA = input.sideA.subjectPlayerId;
  const stakeholderB = input.sideB.stakeholderPlayerId;
  const subjectB = input.sideB.subjectPlayerId;

  // Player self-serve guardrails (the organizer path leaves requireActorIsStakeholder
  // false and may arrange any open-book bet between others):
  if (args.requireActorIsStakeholder) {
    // (1) The creator must have skin in the game (one of the two stakeholders) —
    // you can't post a bet you have no money in. Beyond that the open book is
    // OPEN (Josh 2026-06-25): a player MAY back any subject and name any roster
    // member as the other side's backer. The model is trust-based for the trip —
    // a bet goes live immediately; a wrongly-set bet is cancelled (cancelOwnActionBet)
    // or corrected by the organizer, and everything settles in person.
    if (actorPlayerId !== stakeholderA && actorPlayerId !== stakeholderB) {
      throw new BetWriteError(
        'creator_not_a_stakeholder',
        'you must be one of the two stakeholders on a bet you create',
        400,
      );
    }
    // (2) Stake cap (fat-finger / abuse guard). Whole-dollar already enforced.
    if (input.stakeCents > SELF_SERVE_MAX_STAKE_CENTS) {
      throw new BetWriteError(
        'stake_exceeds_self_serve_cap',
        `a bet you post is capped at $${SELF_SERVE_MAX_STAKE_CENTS / 100}`,
        400,
      );
    }
  }

  const visibility = input.visibility ?? 'event_wide';

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
    // line is meaningful only for over_under; null for every other type.
    line: input.betType === 'over_under' ? input.line! : null,
    state: 'live',
    visibility,
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
      // over_under term — recorded so the bet's full terms are recoverable from
      // history for any later dispute (null for non-over_under).
      line: input.betType === 'over_under' ? input.line ?? null : null,
      visibility,
      sideA: { stakeholderPlayerId: stakeholderA, subjectPlayerId: subjectA },
      sideB: { stakeholderPlayerId: stakeholderB, subjectPlayerId: subjectB },
      createdByPlayerId: actorPlayerId,
      override,
    },
  });

  // PRIVACY: the activity feed is an event-wide broadcast (every participant sees
  // it). A 'stakeholders_only' bet must NOT announce its matchup there — emit the
  // creation activity ONLY for an event_wide (public) bet. A private bet still has
  // its full audit row above (organizer-visible), just no public feed entry.
  if (visibility === 'event_wide') {
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
  }

  return betId;
}

/**
 * Edit one action bet's parameters (full replace of config + sides) in a single
 * tx (Story 1.4). The outcome recomputes on read from the new config (FR4), so
 * this only re-validates, replaces the row + sides, and writes a before/after
 * audit + activity.
 *
 * POLICY (Josh 2026-06-20): the organizer may correct ANY parameter at ANY time
 * — even after scoring has started — because every edit is captured in the
 * before/after audit row and the web UI requires an explicit warning +
 * confirmation. So the placement cutoff does NOT gate edits (`allowScoresExist`
 * is always true here); it still gates *new* bet creation (FR49). Only a 'live'
 * bet is editable; a terminal bet (void / finalized / unsettleable) → 409.
 */
export async function editActionBet(
  tx: Tx,
  args: { eventId: string; actorPlayerId: string; betId: string; input: ActionBetEditInput },
): Promise<void> {
  const { eventId, actorPlayerId, betId, input } = args;

  const before = await loadBetWithSides(tx, betId, TENANT_ID);
  if (!before || before.eventId !== eventId) {
    throw new BetWriteError('bet_not_found', 'bet not found in this event', 404);
  }
  if (before.state !== 'live') {
    throw new BetWriteError('cannot_edit_terminal', `a ${before.state} bet cannot be edited`, 409);
  }

  // Admin may correct anytime — the audit + UI confirmation are the safety net.
  await validateBetParams(tx, eventId, input, { allowScoresExist: true });

  const stakeholderA = input.sideA.stakeholderPlayerId;
  const subjectA = input.sideA.subjectPlayerId;
  const stakeholderB = input.sideB.stakeholderPlayerId;
  const subjectB = input.sideB.subjectPlayerId;
  const ctx = `event:${eventId}`;

  // Only overwrite visibility when the edit explicitly carries it (back-compat:
  // an edit that omits it leaves the stored value untouched).
  const visibilitySet = input.visibility !== undefined ? { visibility: input.visibility } : {};
  await tx
    .update(bets)
    .set({
      eventRoundId: input.eventRoundId,
      holeScope: input.holeScope,
      betType: input.betType,
      basis: input.basis,
      stakeCents: input.stakeCents,
      // Re-derive line on every edit so a type change (over_under ⇄ other)
      // never leaves a stale line behind.
      line: input.betType === 'over_under' ? input.line! : null,
      ...visibilitySet,
    })
    .where(and(eq(bets.id, betId), eq(bets.tenantId, TENANT_ID)));

  // Replace both sides (the edit may move stakeholders/subjects).
  await tx.delete(betSides).where(and(eq(betSides.betId, betId), eq(betSides.tenantId, TENANT_ID)));
  await tx.insert(betSides).values([
    { betId, side: 'A', stakeholderPlayerId: stakeholderA, subjectPlayerId: subjectA, tenantId: TENANT_ID, contextId: ctx },
    { betId, side: 'B', stakeholderPlayerId: stakeholderB, subjectPlayerId: subjectB, tenantId: TENANT_ID, contextId: ctx },
  ]);

  const sideOf = (s: 'A' | 'B') => before.sides.find((x) => x.side === s) ?? null;
  await writeAudit(tx, {
    eventType: AUDIT_EVENT_TYPES.ACTION_BET_EDITED,
    entityType: AUDIT_ENTITY_TYPES.BET,
    entityId: betId,
    actorPlayerId,
    payload: {
      eventId,
      betId,
      before: {
        eventRoundId: before.eventRoundId,
        betType: before.betType,
        basis: before.basis,
        holeScope: before.holeScope,
        stakeCents: before.stakeCents,
        line: before.line,
        visibility: before.visibility,
        sideA: sideOf('A')
          ? { stakeholderPlayerId: sideOf('A')!.stakeholderPlayerId, subjectPlayerId: sideOf('A')!.subjectPlayerId }
          : null,
        sideB: sideOf('B')
          ? { stakeholderPlayerId: sideOf('B')!.stakeholderPlayerId, subjectPlayerId: sideOf('B')!.subjectPlayerId }
          : null,
      },
      after: {
        eventRoundId: input.eventRoundId,
        betType: input.betType,
        basis: input.basis,
        holeScope: input.holeScope,
        stakeCents: input.stakeCents,
        line: input.betType === 'over_under' ? input.line ?? null : null,
        visibility: input.visibility ?? before.visibility,
        sideA: { stakeholderPlayerId: stakeholderA, subjectPlayerId: subjectA },
        sideB: { stakeholderPlayerId: stakeholderB, subjectPlayerId: subjectB },
      },
    },
  });

  // Privacy: only announce an edit on the event-wide feed when the bet is (or
  // becomes) public; a stakeholders_only bet's edit stays off the feed.
  if ((input.visibility ?? before.visibility) === 'event_wide') {
    await emitActivity(tx, {
      type: 'action_bet.edited',
      eventId,
      actorPlayerId,
      betId,
    });
  }
}

/**
 * Void one action bet in a single tx (Story 1.4). Sets state='void' +
 * voided_at/by; `settleActionBet` already short-circuits 'void' to no edges, so
 * the bet stops contributing to settle-up while its audit history is preserved
 * (FR5) and the ledger stays zero-sum (FR47/NFR-C4). Only a 'live' bet is
 * voidable; a terminal bet is rejected (409).
 */
export async function voidActionBet(
  tx: Tx,
  args: { eventId: string; actorPlayerId: string; betId: string },
): Promise<void> {
  const { eventId, actorPlayerId, betId } = args;

  const before = await loadBetWithSides(tx, betId, TENANT_ID);
  if (!before || before.eventId !== eventId) {
    throw new BetWriteError('bet_not_found', 'bet not found in this event', 404);
  }
  if (before.state !== 'live') {
    throw new BetWriteError('cannot_void_terminal', `a ${before.state} bet cannot be voided`, 409);
  }

  const now = Date.now();
  await tx
    .update(bets)
    .set({ state: 'void', voidedAt: now, voidedByPlayerId: actorPlayerId })
    .where(and(eq(bets.id, betId), eq(bets.tenantId, TENANT_ID), eq(bets.state, 'live')));

  await writeAudit(tx, {
    eventType: AUDIT_EVENT_TYPES.ACTION_BET_VOIDED,
    entityType: AUDIT_ENTITY_TYPES.BET,
    entityId: betId,
    actorPlayerId,
    payload: {
      eventId,
      betId,
      previousState: before.state,
      sides: before.sides.map((s) => ({
        side: s.side,
        stakeholderPlayerId: s.stakeholderPlayerId,
        subjectPlayerId: s.subjectPlayerId,
      })),
    },
  });

  // Privacy: a private bet's void stays off the event-wide feed (consistent with
  // the create + player-cancel rule). The audit row above is kept regardless.
  if (before.visibility === 'event_wide') {
    await emitActivity(tx, {
      type: 'action_bet.voided',
      eventId,
      actorPlayerId,
      betId,
    });
  }
}

/**
 * PLAYER self-serve cancel of their OWN action bet (Josh 2026-06-25). A
 * stakeholder on the bet may pull it while it is still 'live' AND before any
 * in-scope hole has been scored — once scoring has started the bet is in play
 * and can't be welched (same placement cutoff as creation, FR49). Mechanically
 * a void (state='void' → settleActionBet emits no edges), so it drops out of
 * settle-up with its audit preserved. The organizer's voidActionBet is the
 * unconditional admin counterpart; this is the participant-scoped, gated path.
 */
export async function cancelOwnActionBet(
  tx: Tx,
  args: { eventId: string; actorPlayerId: string; betId: string },
): Promise<void> {
  const { eventId, actorPlayerId, betId } = args;

  const bet = await loadBetWithSides(tx, betId, TENANT_ID);
  if (!bet || bet.eventId !== eventId) {
    throw new BetWriteError('bet_not_found', 'bet not found in this event', 404);
  }
  if (bet.state !== 'live') {
    throw new BetWriteError('cannot_cancel_terminal', `a ${bet.state} bet cannot be cancelled`, 409);
  }
  // Only a STAKEHOLDER on the bet may cancel it (you have money in it).
  if (!bet.sides.some((s) => s.stakeholderPlayerId === actorPlayerId)) {
    throw new BetWriteError('not_a_stakeholder', 'only a stakeholder on the bet can cancel it', 403);
  }

  // Placement cutoff: once an in-scope hole is scored, the bet is live-in-play —
  // no pulling it then. Mirrors validateBetParams' FR49 gate.
  const erRows = await tx
    .select({ holesToPlay: eventRounds.holesToPlay })
    .from(eventRounds)
    .where(and(eq(eventRounds.id, bet.eventRoundId), eq(eventRounds.tenantId, TENANT_ID)))
    .limit(1);
  // Fail closed: without the event round we can't determine the in-play cutoff,
  // so don't allow the cancel (rather than defaulting holesToPlay + maybe pulling
  // an in-play bet).
  if (erRows.length === 0) {
    throw new BetWriteError('bet_not_found', 'bet event round not found', 404);
  }
  const holesToPlay = erRows[0]!.holesToPlay;
  const scopedHoles = scopedHolesForScope(bet.holeScope, holesToPlay);
  const subjectIds = [...new Set(bet.sides.map((s) => s.subjectPlayerId))];
  const runtimeRoundRows = await tx
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.eventRoundId, bet.eventRoundId), eq(rounds.tenantId, TENANT_ID)));
  if (runtimeRoundRows.length > 0 && scopedHoles.length > 0 && subjectIds.length > 0) {
    const existing = await tx
      .select({ holeNumber: holeScores.holeNumber })
      .from(holeScores)
      .where(
        and(
          inArray(holeScores.roundId, runtimeRoundRows.map((r) => r.id)),
          inArray(holeScores.playerId, subjectIds),
          inArray(holeScores.holeNumber, scopedHoles),
          eq(holeScores.tenantId, TENANT_ID),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new BetWriteError(
        'betting_closed_scores_exist',
        'scoring has started on this bet — it can no longer be cancelled',
        422,
      );
    }
  }

  const now = Date.now();
  // `eq(state,'live')` makes the void atomic vs a concurrent cancel/void — only a
  // still-live bet flips (no double-void, no racing a terminal transition).
  await tx
    .update(bets)
    .set({ state: 'void', voidedAt: now, voidedByPlayerId: actorPlayerId })
    .where(and(eq(bets.id, betId), eq(bets.tenantId, TENANT_ID), eq(bets.state, 'live')));

  await writeAudit(tx, {
    eventType: AUDIT_EVENT_TYPES.ACTION_BET_VOIDED,
    entityType: AUDIT_ENTITY_TYPES.BET,
    entityId: betId,
    actorPlayerId,
    payload: {
      eventId,
      betId,
      previousState: bet.state,
      cancelledBy: 'stakeholder',
      sides: bet.sides.map((s) => ({
        side: s.side,
        stakeholderPlayerId: s.stakeholderPlayerId,
        subjectPlayerId: s.subjectPlayerId,
      })),
    },
  });

  // Privacy: keep a private bet's cancel off the event-wide feed (consistent with
  // the create-privacy rule). A public bet's cancel may be announced.
  if (bet.visibility === 'event_wide') {
    await emitActivity(tx, { type: 'action_bet.voided', eventId, actorPlayerId, betId });
  }
}
