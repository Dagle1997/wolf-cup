import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function isFriday(dateStr: string): boolean {
  return new Date(dateStr + 'T12:00:00').getDay() === 5;
}

export const createSeasonSchema = z
  .object({
    name: z.string().min(1),
    startDate: z
      .string()
      .regex(dateRegex)
      .refine(isFriday, { message: 'Start date must be a Friday' }),
    endDate: z
      .string()
      .regex(dateRegex)
      .refine(isFriday, { message: 'End date must be a Friday' }),
    playoffFormat: z.string().min(1),
    harveyLiveEnabled: z.boolean().optional().default(true),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: 'Start date must be before or equal to end date',
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

export const toggleWeekSchema = z.object({
  isActive: z.boolean(),
});

export type CreateSeasonBody = z.infer<typeof createSeasonSchema>;
export type UpdateSeasonBody = z.infer<typeof updateSeasonSchema>;
export type ToggleWeekBody = z.infer<typeof toggleWeekSchema>;
