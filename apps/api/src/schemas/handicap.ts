import { z } from 'zod';

export const updateHandicapSchema = z.object({
  handicapIndex: z.number().min(0).max(54),
});

export type UpdateHandicapBody = z.infer<typeof updateHandicapSchema>;
