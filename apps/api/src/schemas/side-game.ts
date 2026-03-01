import { z } from 'zod';

export const createSideGameSchema = z.object({
  name: z.string().min(1),
  format: z.string().min(1),
  scheduledRoundIds: z.array(z.number().int().positive()).optional(),
});

export const updateSideGameSchema = z
  .object({
    name: z.string().min(1).optional(),
    format: z.string().min(1).optional(),
    scheduledRoundIds: z.array(z.number().int().positive()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });

export const createSideGameResultSchema = z
  .object({
    sideGameId: z.number().int().positive(),
    winnerPlayerId: z.number().int().positive().optional(),
    winnerName: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .refine(
    (data) => data.winnerPlayerId !== undefined || data.winnerName !== undefined,
    { message: 'Either winnerPlayerId or winnerName is required' },
  );

export type CreateSideGameBody = z.infer<typeof createSideGameSchema>;
export type UpdateSideGameBody = z.infer<typeof updateSideGameSchema>;
export type CreateSideGameResultBody = z.infer<typeof createSideGameResultSchema>;
