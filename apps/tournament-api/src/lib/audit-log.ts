/**
 * T5-6 audit-log helper. Writes to T5-1's `audit_log` table.
 *
 * Callers across T5-6 / T5-7 / T5-8 / T5-9 / T7-6 / T8 MUST use the
 * `AUDIT_EVENT_TYPES` + `AUDIT_ENTITY_TYPES` constants below — string
 * typos would silently fragment the polymorphic audit trail (T5-1 spec
 * Risks acknowledged this footgun).
 *
 * `tenant_id` is set to the module-local TENANT_ID; `context_id` is
 * `audit:<entity_type>` so audit rows can be filtered by entity class
 * via the `(entity_type, entity_id, created_at desc)` index.
 */

import { randomUUID } from 'node:crypto';
import { auditLog } from '../db/schema/index.js';
import type { db } from '../db/index.js';

type Db = typeof db;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const TENANT_ID = 'guyan';

export const AUDIT_EVENT_TYPES = {
  SCORE_COMMITTED: 'score.committed',
  SCORE_CORRECTED: 'score.corrected',
  ROUND_STATE_CHANGED: 'round.state_changed',
  SCORER_TRANSFERRED: 'scorer.transferred',
  ROUND_FINALIZED: 'round.finalized',
  RULE_SET_REVISED: 'rule_set.revised',
  BET_CREATED: 'bet.created',
  SUBGAME_COMPUTED: 'subgame.computed',
  GALLERY_UPLOADED: 'gallery.uploaded',
  GALLERY_DELETED: 'gallery.deleted',
} as const;

export type AuditEventType =
  (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

export const AUDIT_ENTITY_TYPES = {
  HOLE_SCORE: 'hole_score',
  ROUND: 'round',
  SESSION: 'session',
  RULE_SET: 'rule_set',
  BET: 'bet',
  SUBGAME: 'sub_game',
  GALLERY_PHOTO: 'gallery_photo',
} as const;

export type AuditEntityType =
  (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES];

export interface WriteAuditArgs {
  eventType: AuditEventType;
  entityType: AuditEntityType;
  entityId: string;
  actorPlayerId: string | null;
  payload: unknown;
}

export async function writeAudit(
  tx: Tx | Db,
  args: WriteAuditArgs,
): Promise<void> {
  await tx.insert(auditLog).values({
    id: randomUUID(),
    eventType: args.eventType,
    entityType: args.entityType,
    entityId: args.entityId,
    actorPlayerId: args.actorPlayerId,
    payloadJson: JSON.stringify(args.payload),
    createdAt: Date.now(),
    tenantId: TENANT_ID,
    contextId: `audit:${args.entityType}`,
  });
}
