import { z } from 'zod';

export const createHistoricalSeasonSchema = z.object({
  year: z.number().int().min(2014).max(2100),
  name: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalRounds: z.number().int().min(0).default(0),
  playoffFormat: z.string().default('top8'),
  championPlayerId: z.number().int().positive().optional(),
});

export const setChampionSchema = z.object({
  championPlayerId: z.number().int().positive().nullable(),
});

export const upsertStandingsSchema = z.object({
  standings: z
    .array(
      z.object({
        playerId: z.number().int().positive(),
        rank: z.number().int().positive(),
        points: z.number().optional(),
      }),
    )
    .min(1),
});
