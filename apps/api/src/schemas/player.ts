import { z } from 'zod';

export const createPlayerSchema = z.object({
  name: z.string().min(1),
  ghinNumber: z.string().optional(),
});

export type CreatePlayerBody = z.infer<typeof createPlayerSchema>;

export const updatePlayerSchema = z
  .object({
    name: z.string().min(1).optional(),
    ghinNumber: z.string().nullable().optional(),
    isActive: z.literal(0).or(z.literal(1)).optional(),
    handicapIndex: z.number().nullable().optional(),
    status: z.enum(['active', 'sub', 'inactive']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });

export type UpdatePlayerBody = z.infer<typeof updatePlayerSchema>;
