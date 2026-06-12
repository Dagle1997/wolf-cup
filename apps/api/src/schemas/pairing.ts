import { z } from 'zod';

export const suggestGroupsSchema = z.object({
  playerIds: z
    .array(z.number().int().positive())
    .min(4)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'playerIds must be unique',
    }),
  pins: z
    .record(z.string(), z.number().int().nonnegative())
    // Pin keys must parse to integers — a non-numeric key would become NaN and
    // inject a phantom player. The engine also guards membership/capacity, but
    // reject malformed input at the boundary too.
    .refine((p) => Object.keys(p).every((k) => Number.isInteger(Number(k))), {
      message: 'pin keys must be integer player ids',
    })
    .optional(),
});

export type SuggestGroupsBody = z.infer<typeof suggestGroupsSchema>;
