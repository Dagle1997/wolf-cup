/**
 * T8-1 typed activity emitter. Replaces the T5-6 stub body per the
 * stub's documented "coordinated breaking change" contract.
 *
 * Contract:
 *   - `event` is a typed `ActivityEvent` from
 *     `engine/types/activity-events.ts` (discriminated union).
 *   - `eventId` is REQUIRED on every variant — matches the DB
 *     `event_id NOT NULL` constraint.
 *   - The matching Zod schema's `.parse()` runs BEFORE insert. A failed
 *     parse throws ZodError → calling transaction rolls back (loud-fail
 *     per D3-2). Unknown keys are REJECTED by `.strict()`, not stripped.
 *   - The PARSED result (not the input event) is what gets persisted —
 *     defends against any future relaxation of `.strict()` to
 *     `.passthrough()` by ensuring the persisted JSON only ever
 *     contains schema-declared fields.
 *
 * Callers MUST pass a `Tx` (transaction handle) so a Zod parse failure
 * rolls back any sibling writes. The signature accepts `Tx | Db` for
 * convenience but production code paths always pass `tx` from a
 * `db.transaction(async (tx) => { ... })` callback. v1.5 polish would
 * brand `Tx` so the type system enforces this.
 *
 * Direct writes to the `activity` table outside this file are blocked
 * by an ESLint `no-restricted-syntax` rule + `no-restricted-imports`
 * defense-in-depth in `apps/tournament-api/eslint.config.js`.
 */

import { randomUUID } from 'node:crypto';
import { activity } from '../db/schema/index.js';
import type { db } from '../db/index.js';
import {
  activityEventSchemas,
  type ActivityEvent,
} from '../engine/types/activity-events.js';

type Db = typeof db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const TENANT_ID = 'guyan';

export async function emitActivity(
  tx: Tx | Db,
  event: ActivityEvent,
): Promise<void> {
  const schema = activityEventSchemas[event.type];
  // With `.strict()` schemas, unknown keys throw ZodError BEFORE this
  // line (Zod's strict mode FAILS on unknown keys; it does NOT silently
  // strip them). Using `parsed` for both column population AND the JSON
  // serialization defends against any future relaxation of `.strict()`
  // to `.passthrough()` by guaranteeing the persisted payload only ever
  // contains schema-declared fields.
  const parsed = schema.parse(event) as ActivityEvent;

  await tx.insert(activity).values({
    id: randomUUID(),
    eventId: parsed.eventId,
    roundId: parsed.roundId ?? null,
    type: parsed.type,
    actorPlayerId: parsed.actorPlayerId ?? null,
    payloadJson: JSON.stringify(parsed),
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `activity:${parsed.eventId}`,
  });
}
