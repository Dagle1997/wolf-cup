/**
 * T5-6 activity-emitter stub. v1 NO-OP.
 *
 * T8 (activity spine epic) replaces ONLY the function body — writes to the
 * activity_events table + emits to the in-app feed. Callers across
 * T5-6 / T5-7 / T5-8 / T5-9 / T6 use the same call signature; T8's
 * change is body-only (no signature break).
 *
 * The minimal v1 contract is intentionally narrow so T8 can ADD optional
 * fields without breaking T5-6+ call sites. If T8 ever needs a REQUIRED
 * new field, that's a coordinated breaking change.
 */

import type { db } from '../db/index.js';

type Db = typeof db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface EmitActivityArgs {
  type: string;
  actorPlayerId: string;
  payload: unknown;
  scope: { eventId?: string; roundId?: string };
}

export async function emitActivity(
  _tx: Tx | Db,
  _args: EmitActivityArgs,
): Promise<void> {
  // No-op v1. T8 will implement the real activity-event write.
}
