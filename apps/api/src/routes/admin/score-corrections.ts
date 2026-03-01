import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  rounds,
  players,
  holeScores,
  wolfDecisions,
  scoreCorrections,
} from '../../db/schema.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.js';
import { createScoreCorrectionSchema } from '../../schemas/score-correction.js';
import type { Variables } from '../../types.js';

const app = new Hono<{ Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST /rounds/:roundId/corrections
// ---------------------------------------------------------------------------

app.post('/rounds/:roundId/corrections', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'VALIDATION_ERROR' }, 400);
  }

  // Validate body
  const body = await c.req.json().catch(() => null);
  const result = createScoreCorrectionSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation error', code: 'VALIDATION_ERROR', issues: result.error.issues },
      400,
    );
  }

  // Check round exists
  const round = await db
    .select({ id: rounds.id, status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();
  if (!round) {
    return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  }

  // Check round is finalized
  if (round.status !== 'finalized') {
    return c.json({ error: 'Round is not finalized', code: 'ROUND_NOT_FINALIZED' }, 422);
  }

  const { holeNumber, fieldName, playerId, groupId, newValue } = result.data;
  const adminUserId = c.get('adminId' as never) as number;

  let oldValue: string;

  if (fieldName === 'grossScore') {
    // Read current gross score
    const row = await db
      .select({ grossScore: holeScores.grossScore, id: holeScores.id })
      .from(holeScores)
      .where(
        and(
          eq(holeScores.roundId, roundId),
          eq(holeScores.playerId, playerId!),
          eq(holeScores.holeNumber, holeNumber),
        ),
      )
      .get();
    if (!row) {
      return c.json({ error: 'Score not found', code: 'NOT_FOUND' }, 404);
    }

    // Validate new value — use Number() so "4abc" is rejected (parseInt would silently parse it as 4)
    const parsed = Number(newValue);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      return c.json(
        {
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          issues: [{ message: 'grossScore must be an integer 1–20' }],
        },
        400,
      );
    }

    oldValue = String(row.grossScore);

    // Update hole_scores
    await db
      .update(holeScores)
      .set({ grossScore: parsed, updatedAt: Date.now() })
      .where(eq(holeScores.id, row.id));
  } else if (fieldName === 'wolfDecision') {
    // Read current wolf decision
    const row = await db
      .select({ decision: wolfDecisions.decision, id: wolfDecisions.id })
      .from(wolfDecisions)
      .where(
        and(
          eq(wolfDecisions.roundId, roundId),
          eq(wolfDecisions.groupId, groupId!),
          eq(wolfDecisions.holeNumber, holeNumber),
        ),
      )
      .get();
    if (!row) {
      return c.json({ error: 'Wolf decision not found', code: 'NOT_FOUND' }, 404);
    }

    // Validate new value
    const validDecisions = ['alone', 'partner', 'blind_wolf'];
    if (!validDecisions.includes(newValue)) {
      return c.json(
        {
          error: 'Validation error',
          code: 'VALIDATION_ERROR',
          issues: [{ message: 'wolfDecision must be alone, partner, or blind_wolf' }],
        },
        400,
      );
    }

    oldValue = row.decision ?? '';

    // Update wolf_decisions
    await db
      .update(wolfDecisions)
      .set({ decision: newValue })
      .where(eq(wolfDecisions.id, row.id));
  } else {
    // wolfPartnerId
    const row = await db
      .select({ partnerPlayerId: wolfDecisions.partnerPlayerId, id: wolfDecisions.id })
      .from(wolfDecisions)
      .where(
        and(
          eq(wolfDecisions.roundId, roundId),
          eq(wolfDecisions.groupId, groupId!),
          eq(wolfDecisions.holeNumber, holeNumber),
        ),
      )
      .get();
    if (!row) {
      return c.json({ error: 'Wolf decision not found', code: 'NOT_FOUND' }, 404);
    }

    // Validate new value: stringified positive int or 'null'
    let newPartnerId: number | null;
    if (newValue === 'null') {
      newPartnerId = null;
    } else {
      // Use Number() so "42abc" is rejected (parseInt would silently parse it as 42)
      const parsed = Number(newValue);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return c.json(
          {
            error: 'Validation error',
            code: 'VALIDATION_ERROR',
            issues: [{ message: 'wolfPartnerId must be a positive integer or null' }],
          },
          400,
        );
      }
      // Verify player exists
      const playerRow = await db
        .select({ id: players.id })
        .from(players)
        .where(eq(players.id, parsed))
        .get();
      if (!playerRow) {
        return c.json({ error: 'Player not found', code: 'NOT_FOUND' }, 404);
      }
      newPartnerId = parsed;
    }

    oldValue = row.partnerPlayerId !== null ? String(row.partnerPlayerId) : 'null';

    // Update wolf_decisions
    await db
      .update(wolfDecisions)
      .set({ partnerPlayerId: newPartnerId })
      .where(eq(wolfDecisions.id, row.id));
  }

  // Insert audit log
  const [correction] = await db
    .insert(scoreCorrections)
    .values({
      adminUserId,
      roundId,
      holeNumber,
      playerId: playerId ?? null,
      fieldName,
      oldValue,
      newValue,
      correctedAt: Date.now(),
    })
    .returning();

  return c.json({ correction }, 201);
});

// ---------------------------------------------------------------------------
// GET /rounds/:roundId/corrections
// ---------------------------------------------------------------------------

app.get('/rounds/:roundId/corrections', adminAuthMiddleware, async (c) => {
  const roundId = Number(c.req.param('roundId'));
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json({ error: 'Invalid round ID', code: 'VALIDATION_ERROR' }, 400);
  }

  // Check round exists
  const round = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .get();
  if (!round) {
    return c.json({ error: 'Round not found', code: 'NOT_FOUND' }, 404);
  }

  const items = await db
    .select()
    .from(scoreCorrections)
    .where(eq(scoreCorrections.roundId, roundId))
    .orderBy(desc(scoreCorrections.correctedAt));

  return c.json({ items }, 200);
});

export default app;
