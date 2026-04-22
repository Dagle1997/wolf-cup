import { z } from 'zod';

export const createCtpEntrySchema = z.object({
  groupId: z.number().int().positive(),
  holeNumber: z.union([z.literal(6), z.literal(7), z.literal(12), z.literal(15)]),
  winnerPlayerId: z.number().int().positive().nullable(),
});

export type CreateCtpEntryBody = z.infer<typeof createCtpEntrySchema>;
