import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createSeasonSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().regex(dateRegex),
  endDate: z.string().regex(dateRegex),
  totalRounds: z.number().int().min(1),
  playoffFormat: z.string().min(1),
});

export const updateSeasonSchema = z
  .object({
    name: z.string().min(1).optional(),
    startDate: z.string().regex(dateRegex).optional(),
    endDate: z.string().regex(dateRegex).optional(),
    totalRounds: z.number().int().min(1).optional(),
    playoffFormat: z.string().min(1).optional(),
    harveyLiveEnabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });

export type CreateSeasonBody = z.infer<typeof createSeasonSchema>;
export type UpdateSeasonBody = z.infer<typeof updateSeasonSchema>;
