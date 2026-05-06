/**
 * T8-1 activity-event types + per-variant Zod schemas.
 *
 * Single source of truth for the typed `emitActivity` contract. T8-2
 * (API + provider), T8-3 (player-home feed), and T8-4 (award triggers)
 * all import from here.
 *
 * `event_id NOT NULL` in the DB schema → every variant requires
 * `eventId` via `ActivityEventBase`. ID fields use plain `string` to
 * match existing tournament-api convention; branded ID types are out
 * of scope.
 */

import { z } from 'zod';

// ---- Base shapes ----------------------------------------------------------

export interface ActivityEventBase {
  eventId: string;
  roundId?: string;
  actorPlayerId?: string;
}

// ---- Per-type variants ----------------------------------------------------

export interface ScoreCommittedEvent extends ActivityEventBase {
  type: 'score.committed';
  roundId: string;
  holeNumber: number;
  playerId: string;
  grossStrokes: number;
  par: number;
  toPar: number;
  isBirdieOrBetter: boolean;
  scorerPlayerId: string;
}

export interface ScoreCorrectedEvent extends ActivityEventBase {
  type: 'score.corrected';
  roundId: string;
  holeNumber: number;
  playerId: string;
  priorGross: number;
  newGross: number;
  actorPlayerId: string;
}

export interface ScorerTransferredEvent extends ActivityEventBase {
  type: 'scorer.transferred';
  roundId: string;
  foursomeNumber: number;
  fromPlayerId: string;
  toPlayerId: string;
  actorPlayerId: string;
}

export interface RoundFinalizedEvent extends ActivityEventBase {
  type: 'round.finalized';
  roundId: string;
  actorPlayerId: string;
}

export interface RoundCancelledEvent extends ActivityEventBase {
  type: 'round.cancelled';
  roundId: string;
  actorPlayerId: string;
}

export interface PressAutoFiredEvent extends ActivityEventBase {
  type: 'press.auto_fired';
  roundId: string;
  triggerHole: number;
  team?: 'teamA' | 'teamB';
  betId?: string;
  trigger: string;
  multiplier: number;
}

export interface PressManualFiredEvent extends ActivityEventBase {
  type: 'press.manual_fired';
  roundId: string;
  fromHole: number;
  team: 'teamA' | 'teamB';
  multiplier: number;
  filedByPlayerId: string;
}

export interface PressManualUndoneEvent extends ActivityEventBase {
  type: 'press.manual_undone';
  roundId: string;
  pressId: string;
  undoneByPlayerId: string;
}

export interface BetCreatedEvent extends ActivityEventBase {
  type: 'bet.created';
  betId: string;
  playerAId: string;
  playerBId: string;
  betType: string;
  stakePerHoleCents: number;
  actorPlayerId: string;
}

export interface RuleSetRevisedEvent extends ActivityEventBase {
  type: 'rule_set.revised';
  ruleSetId: string;
  revisionId: string;
  effectiveFromRoundId?: string;
  effectiveFromHole?: number;
  configDiffSummary?: string;
  actorPlayerId: string;
}

export interface SubgameComputedEvent extends ActivityEventBase {
  type: 'subgame.computed';
  roundId: string;
  subGameId: string;
  subGameResultId: string;
  totalPotCents: number;
  actorPlayerId: string;
}

export interface GalleryUploadedEvent extends ActivityEventBase {
  type: 'gallery.uploaded';
  photoId: string;
  actorPlayerId: string;
}

export interface AwardTriggeredEvent extends ActivityEventBase {
  type: 'award.triggered';
  awardType: 'first_birdie_of_event' | 'first_eagle_of_event';
  playerId: string;
  context: {
    holeNumber: number;
    grossStrokes: number;
    par: number;
  };
}

// ---- Discriminated union --------------------------------------------------

export type ActivityEvent =
  | ScoreCommittedEvent
  | ScoreCorrectedEvent
  | ScorerTransferredEvent
  | RoundFinalizedEvent
  | RoundCancelledEvent
  | PressAutoFiredEvent
  | PressManualFiredEvent
  | PressManualUndoneEvent
  | BetCreatedEvent
  | RuleSetRevisedEvent
  | SubgameComputedEvent
  | GalleryUploadedEvent
  | AwardTriggeredEvent;

export type ActivityType = ActivityEvent['type'];

export const ACTIVITY_TYPES = [
  'score.committed',
  'score.corrected',
  'scorer.transferred',
  'round.finalized',
  'round.cancelled',
  'press.auto_fired',
  'press.manual_fired',
  'press.manual_undone',
  'bet.created',
  'rule_set.revised',
  'subgame.computed',
  'gallery.uploaded',
  'award.triggered',
] as const satisfies readonly ActivityType[];

// ---- Zod schemas ----------------------------------------------------------

const nonEmptyString = z.string().min(1);
const holeNumberSchema = z.number().int().min(1).max(18);
const grossStrokesSchema = z.number().int().min(1).max(20);
const parSchema = z.number().int().min(3).max(5);
const multiplierSchema = z.number().int().min(1).max(8);

// Base fields (eventId required, roundId/actorPlayerId optional). Each
// variant `.extend()`s and `.strict()`s.
const baseFields = {
  eventId: nonEmptyString,
  roundId: nonEmptyString.optional(),
  actorPlayerId: nonEmptyString.optional(),
};

const scoreCommittedSchema = z
  .object({
    ...baseFields,
    type: z.literal('score.committed'),
    roundId: nonEmptyString,
    holeNumber: holeNumberSchema,
    playerId: nonEmptyString,
    grossStrokes: grossStrokesSchema,
    par: parSchema,
    // toPar range: legitimate min is -4 (hole-in-one on par-5 = condor),
    // -3 (albatross/double-eagle), -2 (eagle); max is 17 (gross 20 on
    // par-3). Earlier min(-2) wrongly rejected hole-in-one on par-3
    // (toPar=-2 OK) but also albatross + condor.
    toPar: z.number().int().min(-4).max(17),
    isBirdieOrBetter: z.boolean(),
    scorerPlayerId: nonEmptyString,
  })
  .strict()
  // Cross-field consistency: caller-computed `toPar` must equal
  // `grossStrokes - par`, and `isBirdieOrBetter` must equal `toPar < 0`.
  // Defends against payload drift if a caller (or a future refactor)
  // computes the fields independently and they disagree.
  .refine((d) => d.toPar === d.grossStrokes - d.par, {
    message: 'score.committed: toPar must equal grossStrokes - par',
  })
  .refine((d) => d.isBirdieOrBetter === d.toPar < 0, {
    message: 'score.committed: isBirdieOrBetter must equal (toPar < 0)',
  });

const scoreCorrectedSchema = z
  .object({
    ...baseFields,
    type: z.literal('score.corrected'),
    roundId: nonEmptyString,
    holeNumber: holeNumberSchema,
    playerId: nonEmptyString,
    priorGross: grossStrokesSchema,
    newGross: grossStrokesSchema,
    actorPlayerId: nonEmptyString,
  })
  .strict();

const scorerTransferredSchema = z
  .object({
    ...baseFields,
    type: z.literal('scorer.transferred'),
    roundId: nonEmptyString,
    foursomeNumber: z.number().int().min(1).max(20),
    fromPlayerId: nonEmptyString,
    toPlayerId: nonEmptyString,
    actorPlayerId: nonEmptyString,
  })
  .strict();

const roundFinalizedSchema = z
  .object({
    ...baseFields,
    type: z.literal('round.finalized'),
    roundId: nonEmptyString,
    actorPlayerId: nonEmptyString,
  })
  .strict();

const roundCancelledSchema = z
  .object({
    ...baseFields,
    type: z.literal('round.cancelled'),
    roundId: nonEmptyString,
    actorPlayerId: nonEmptyString,
  })
  .strict();

const pressAutoFiredSchema = z
  .object({
    ...baseFields,
    type: z.literal('press.auto_fired'),
    roundId: nonEmptyString,
    triggerHole: holeNumberSchema,
    team: z.enum(['teamA', 'teamB']).optional(),
    betId: nonEmptyString.optional(),
    trigger: nonEmptyString,
    multiplier: multiplierSchema,
  })
  .strict()
  .refine(
    (d) => (d.team === undefined) !== (d.betId === undefined),
    { message: 'press.auto_fired requires exactly one of team or betId' },
  );

const pressManualFiredSchema = z
  .object({
    ...baseFields,
    type: z.literal('press.manual_fired'),
    roundId: nonEmptyString,
    fromHole: holeNumberSchema,
    team: z.enum(['teamA', 'teamB']),
    multiplier: multiplierSchema,
    filedByPlayerId: nonEmptyString,
  })
  .strict();

const pressManualUndoneSchema = z
  .object({
    ...baseFields,
    type: z.literal('press.manual_undone'),
    roundId: nonEmptyString,
    pressId: nonEmptyString,
    undoneByPlayerId: nonEmptyString,
  })
  .strict();

const betCreatedSchema = z
  .object({
    ...baseFields,
    type: z.literal('bet.created'),
    betId: nonEmptyString,
    playerAId: nonEmptyString,
    playerBId: nonEmptyString,
    betType: nonEmptyString,
    stakePerHoleCents: z.number().int().min(1),
    actorPlayerId: nonEmptyString,
  })
  .strict();

const ruleSetRevisedSchema = z
  .object({
    ...baseFields,
    type: z.literal('rule_set.revised'),
    ruleSetId: nonEmptyString,
    revisionId: nonEmptyString,
    effectiveFromRoundId: nonEmptyString.optional(),
    // 1..19 — 19 is the between-rounds boundary marker (after hole 18,
    // before round N+1). Wider range than in-round hole numbers (1-18).
    effectiveFromHole: z.number().int().min(1).max(19).optional(),
    configDiffSummary: z.string().optional(),
    actorPlayerId: nonEmptyString,
  })
  .strict();

const subgameComputedSchema = z
  .object({
    ...baseFields,
    type: z.literal('subgame.computed'),
    roundId: nonEmptyString,
    subGameId: nonEmptyString,
    subGameResultId: nonEmptyString,
    totalPotCents: z.number().int().min(0),
    actorPlayerId: nonEmptyString,
  })
  .strict();

const galleryUploadedSchema = z
  .object({
    ...baseFields,
    type: z.literal('gallery.uploaded'),
    photoId: nonEmptyString,
    actorPlayerId: nonEmptyString,
  })
  .strict();

const awardTriggeredSchema = z
  .object({
    ...baseFields,
    type: z.literal('award.triggered'),
    awardType: z.enum(['first_birdie_of_event', 'first_eagle_of_event']),
    playerId: nonEmptyString,
    context: z
      .object({
        holeNumber: holeNumberSchema,
        grossStrokes: grossStrokesSchema,
        par: parSchema,
      })
      .strict(),
  })
  .strict();

export const activityEventSchemas = {
  'score.committed': scoreCommittedSchema,
  'score.corrected': scoreCorrectedSchema,
  'scorer.transferred': scorerTransferredSchema,
  'round.finalized': roundFinalizedSchema,
  'round.cancelled': roundCancelledSchema,
  'press.auto_fired': pressAutoFiredSchema,
  'press.manual_fired': pressManualFiredSchema,
  'press.manual_undone': pressManualUndoneSchema,
  'bet.created': betCreatedSchema,
  'rule_set.revised': ruleSetRevisedSchema,
  'subgame.computed': subgameComputedSchema,
  'gallery.uploaded': galleryUploadedSchema,
  'award.triggered': awardTriggeredSchema,
} as const satisfies Record<ActivityType, z.ZodSchema>;
