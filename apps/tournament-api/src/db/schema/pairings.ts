import { integer, sqliteTable, text, index, primaryKey, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { eventRounds } from './events.js';
import { players } from './players.js';

/**
 * Pairings + pairing_members schema (T4-2, FD-6).
 *
 * **One row per (event_round_id, foursome_number).** A `pairing` represents
 * one foursome (or N-some, where N is the foursome size set by the
 * organizer at the UI layer; v1 typically 4). Multiple pairings per round
 * are differentiated by `foursome_number` (1-indexed; UNIQUE per round).
 *
 * **`pairing_members` is a join table.** One row per (pairing_id, player_id),
 * with `slot_number` preserving the cell order the organizer set in the UI
 * (1-indexed). This lets future T5 scoring iterate the foursome's players
 * in a deterministic order matching the organizer's intent.
 *
 * **`locked` flag** is preserved as-is on upsert (T4-2 server has NO
 * locked-row preservation logic; the client replays locked rows verbatim
 * in every save). Used downstream by T4-2's `POST /pairings/suggest` route
 * to know which round indices to skip when regenerating.
 *
 * **FK delete posture:**
 *   - `pairings.event_round_id → event_rounds.id`: **CASCADE**. Pairings
 *     are round-scoped; deleting a round must delete its pairings.
 *   - `pairing_members.pairing_id → pairings.id`: **CASCADE**.
 *   - `pairing_members.player_id → players.id`: **RESTRICT**. Players are
 *     shared infrastructure; preventing player deletion when they're in
 *     active pairings forces explicit cleanup first.
 *
 * **Cross-pairing player-uniqueness per round** is NOT enforceable at the
 * SQL constraint level (would require a partial UNIQUE across pairings
 * sharing an event_round_id). Application-level pre-flight in the POST
 * handler checks for and rejects this with `422 player_in_multiple_pairings_per_round`.
 *
 * **Tenant scoping:** both tables carry `tenant_id` + `context_id` via
 * `ecosystemColumns()`. v1 single-tenant 'guyan'; T4-2 routes filter on
 * `tenant_id = TENANT_ID` in every SELECT/UPDATE/DELETE per the post-T3-9
 * hardening pattern.
 */
export const pairings = sqliteTable(
  'pairings',
  {
    id: text('id').primaryKey(),
    eventRoundId: text('event_round_id')
      .notNull()
      .references(() => eventRounds.id, { onDelete: 'cascade' }),
    foursomeNumber: integer('foursome_number').notNull(),
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    eventRoundIdx: index('idx_pairings_event_round_id').on(t.eventRoundId),
    eventRoundFoursomeUniq: uniqueIndex('uniq_pairings_event_round_foursome').on(
      t.eventRoundId,
      t.foursomeNumber,
    ),
    foursomeNumberCheck: check(
      'check_pairings_foursome_number_positive',
      sql`${t.foursomeNumber} >= 1`,
    ),
  }),
);

export type Pairing = typeof pairings.$inferSelect;

export const pairingMembers = sqliteTable(
  'pairing_members',
  {
    pairingId: text('pairing_id')
      .notNull()
      .references(() => pairings.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    slotNumber: integer('slot_number').notNull(),
    /**
     * Per-player tee override. NULL → use the round's `event_rounds.tee_color`
     * as the effective tee. Non-null → this member plays a different tee
     * than the round default for this round (e.g., Judd plays forward while
     * the rest of the foursome plays white). Used by the engine's per-player
     * `getHandicapStrokes` calls so course handicap is computed against the
     * actual tee each player is hitting from. Validated in the pairings API
     * against the course's available `course_tees.tee_color` set.
     */
    teeColor: text('tee_color'),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.pairingId, t.playerId] }),
    playerIdx: index('idx_pairing_members_player_id').on(t.playerId),
    pairingSlotUniq: uniqueIndex('uniq_pairing_members_pairing_slot').on(
      t.pairingId,
      t.slotNumber,
    ),
    slotNumberCheck: check(
      'check_pairing_members_slot_number_positive',
      sql`${t.slotNumber} >= 1`,
    ),
  }),
);

export type PairingMember = typeof pairingMembers.$inferSelect;
