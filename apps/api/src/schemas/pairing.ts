import { z } from 'zod';

export const suggestGroupsSchema = z.object({
  playerIds: z.array(z.number().int().positive()).min(4),
  pins: z
    .record(z.string(), z.number().int().nonnegative())
    .optional(),
});

export type SuggestGroupsBody = z.infer<typeof suggestGroupsSchema>;
