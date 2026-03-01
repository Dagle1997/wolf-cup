import { z } from 'zod';

export const createScoreCorrectionSchema = z
  .object({
    holeNumber: z.number().int().min(1).max(18),
    fieldName: z.enum(['grossScore', 'wolfDecision', 'wolfPartnerId']),
    playerId: z.number().int().positive().optional(),
    groupId: z.number().int().positive().optional(),
    newValue: z.string().min(1),
  })
  .refine(
    (data) => data.fieldName !== 'grossScore' || data.playerId !== undefined,
    { message: 'playerId is required for grossScore corrections' },
  )
  .refine(
    (data) =>
      (data.fieldName !== 'wolfDecision' && data.fieldName !== 'wolfPartnerId') ||
      data.groupId !== undefined,
    { message: 'groupId is required for wolf field corrections' },
  );

export type CreateScoreCorrectionBody = z.infer<typeof createScoreCorrectionSchema>;
