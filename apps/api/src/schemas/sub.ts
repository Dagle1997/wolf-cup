import { z } from 'zod';

export const updateSubStatusSchema = z.object({
  isSub: z.boolean(),
});

export type UpdateSubStatusBody = z.infer<typeof updateSubStatusSchema>;
