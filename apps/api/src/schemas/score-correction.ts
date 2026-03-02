import { z } from 'zod';

export const createScoreCorrectionSchema = z
  .object({
    // holeNumber 0 is a sentinel for round-wide corrections (handicapIndex)
    holeNumber: z.number().int().min(0).max(18),
    fieldName: z.enum([
      'grossScore',
      'wolfDecision',
      'wolfPartnerId',
      'greenie',
      'polie',
      'handicapIndex',
    ]),
    playerId: z.number().int().positive().optional(),
    groupId: z.number().int().positive().optional(),
    newValue: z.string().min(1),
  })
  .refine(
    (data) =>
      !['grossScore', 'greenie', 'polie', 'handicapIndex'].includes(data.fieldName) ||
      data.playerId !== undefined,
    { message: 'playerId is required for this correction type' },
  )
  .refine(
    (data) =>
      !['wolfDecision', 'wolfPartnerId', 'greenie', 'polie'].includes(data.fieldName) ||
      data.groupId !== undefined,
    { message: 'groupId is required for wolf/bonus field corrections' },
  )
  .refine(
    (data) => data.fieldName !== 'handicapIndex' || data.holeNumber === 0,
    { message: 'holeNumber must be 0 for handicapIndex corrections' },
  )
  .refine(
    (data) => data.fieldName === 'handicapIndex' || data.holeNumber >= 1,
    { message: 'holeNumber must be 1–18 for non-handicap corrections' },
  );

export type CreateScoreCorrectionBody = z.infer<typeof createScoreCorrectionSchema>;
