import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const roundStatuses = ['scheduled', 'active', 'finalized', 'cancelled'] as const;

export const createRoundSchema = z.object({
  seasonId: z.number().int().positive(),
  type: z.enum(['official', 'casual']),
  scheduledDate: z.string().regex(dateRegex),
  entryCode: z.string().min(1).optional(),
});

export const updateRoundSchema = z
  .object({
    status: z.enum(roundStatuses).optional(),
    headcount: z.number().int().positive().optional(),
    entryCode: z.string().min(1).optional(),
    scheduledDate: z.string().regex(dateRegex).optional(),
    autoCalculateMoney: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field required',
  });

export const createGroupSchema = z.object({
  groupNumber: z.number().int().positive(),
});

export const addGroupPlayerSchema = z.object({
  playerId: z.number().int().positive(),
  handicapIndex: z.number().min(0).max(54),
});

export const battingOrderSchema = z.object({
  order: z.array(z.number().int().positive()),
});

export const submitHoleScoresSchema = z.object({
  scores: z
    .array(
      z.object({
        playerId: z.number().int().positive(),
        grossScore: z.number().int().min(1).max(20),
      }),
    )
    .length(4),
});

export const wolfDecisionSchema = z.object({
  decision: z.enum(['alone', 'partner', 'blind_wolf']).optional(),
  partnerPlayerId: z.number().int().positive().optional(),
  greenies: z.array(z.number().int().positive()).optional().default([]),
  polies: z.array(z.number().int().positive()).optional().default([]),
});
export type WolfDecisionBody = z.infer<typeof wolfDecisionSchema>;

export const addGuestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  handicapIndex: z.number().min(0).max(54),
});
export type AddGuestBody = z.infer<typeof addGuestSchema>;

export type CreateRoundBody = z.infer<typeof createRoundSchema>;
export type UpdateRoundBody = z.infer<typeof updateRoundSchema>;
export type CreateGroupBody = z.infer<typeof createGroupSchema>;
export type AddGroupPlayerBody = z.infer<typeof addGroupPlayerSchema>;
export type BattingOrderBody = z.infer<typeof battingOrderSchema>;
export type SubmitHoleScoresBody = z.infer<typeof submitHoleScoresSchema>;
