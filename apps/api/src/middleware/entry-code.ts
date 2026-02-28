import type { MiddlewareHandler } from 'hono';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import { rounds } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Validates the weekly entry code for official rounds.
 * Expects:
 *   - `x-entry-code` request header containing the plaintext code
 *   - `roundId` query param identifying the target round
 *
 * Bypass: casual rounds are always allowed through without a code (FR25).
 * Failure: returns 403 INVALID_ENTRY_CODE if code is missing or wrong.
 */
export const entryCodeMiddleware: MiddlewareHandler = async (c, next) => {
  const roundIdParam = c.req.query('roundId') ?? null;

  if (!roundIdParam) {
    return c.json(
      { error: 'Round ID required', code: 'ROUND_ID_REQUIRED' },
      400,
    );
  }

  const roundId = Number(roundIdParam);
  if (!Number.isInteger(roundId) || roundId <= 0) {
    return c.json(
      { error: 'Invalid round ID', code: 'INVALID_ROUND_ID' },
      400,
    );
  }

  let round:
    | { type: string; entryCodeHash: string | null }
    | undefined;
  try {
    round = await db
      .select({ type: rounds.type, entryCodeHash: rounds.entryCodeHash })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .get();
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!round) {
    return c.json({ error: 'Round not found', code: 'ROUND_NOT_FOUND' }, 404);
  }

  // Casual rounds bypass entry code check (FR25)
  if (round.type === 'casual') {
    await next();
    return;
  }

  // Official round: validate entry code
  const providedCode = c.req.header('x-entry-code');
  if (!providedCode || !round.entryCodeHash) {
    return c.json(
      { error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' },
      403,
    );
  }

  let valid = false;
  try {
    valid = await bcrypt.compare(providedCode, round.entryCodeHash);
  } catch {
    return c.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, 500);
  }

  if (!valid) {
    return c.json(
      { error: 'Invalid entry code', code: 'INVALID_ENTRY_CODE' },
      403,
    );
  }

  await next();
};
