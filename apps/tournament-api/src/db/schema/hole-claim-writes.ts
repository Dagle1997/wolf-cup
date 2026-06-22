/**
 * F1 "Rules & Games" Epic 2, Story 2.1 — `hole_claim_writes` APPEND-ONLY log.
 *
 * ⚠️ DESIGN DECISION (Josh-approved 2026-06-21): this is an APPEND-ONLY
 * writes-log, NOT a mutable cell table. Rows are IMMUTABLE — never updated,
 * never hard-deleted. This mirrors the shipped `score_corrections` discipline
 * (scores/claims are never hard-deleted; corrections append).
 *
 * Why append-only: the epic's original "mutable cell + hard-delete-to-remove"
 * design RESURRECTED a removed claim when the original `record` mutation
 * replayed from the at-least-once offline queue (the dedupe row had been
 * deleted, so nothing blocked the re-insert). The append-only log fixes this:
 *   - A write APPENDS a row via `INSERT … ON CONFLICT(client_event_id) DO NOTHING`.
 *   - ONE dedupe UNIQUE on `client_event_id` (global, NOT NULL) → a replay of
 *     ANY write (set OR remove) is a no-op.
 *   - There is NO mutable cell row whose identity changes, so a stale offline
 *     replay can NEVER slip past the dedupe and resurrect a removed claim.
 *   - The CURRENT claim for a cell (round_id, player_id, hole_number,
 *     claim_type) = the write with the HIGHEST server-assigned monotonic order
 *     key (the autoincrement `seq` below — NOT the client `created_at`, which is
 *     clock-skew-prone). op='set' ⇒ active, op='remove' ⇒ absent.
 *   - Edit = a new `set` write. Remove = a `remove` write. Reassign to another
 *     player = `remove` old cell + `set` new cell.
 *
 * `claim_type` ('greenie' | 'polie' | 'sandie') and `op` ('set' | 'remove') are
 * Zod-validated at the write boundary — NOT DB CHECK constraints. (T13-4: a
 * CHECK forces a table REBUILD on later ALTERs; keeping these CHECK-free means
 * adding a claim_type or op never needs a rebuild. Additive `CREATE TABLE` only.)
 *
 * Story 2.1 ships CAPTURE + STORAGE + recompute-fanout ONLY. The resolvers that
 * CONSUME claims (greenie 2.2 / polie 2.3 / sandie 2.4) are out of scope, so a
 * recorded claim is INERT (no money effect) until its resolver ships.
 */

import {
  integer,
  sqliteTable,
  text,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { ecosystemColumns } from './_columns.js';
import { rounds } from './scoring.js';
import { players } from './players.js';

export const holeClaimWrites = sqliteTable(
  'hole_claim_writes',
  {
    /**
     * Server-assigned monotonic order key. The append order (and thus the
     * "latest write per cell" derivation) depends on THIS, never the client
     * `created_at`. It is the table's INTEGER PRIMARY KEY AUTOINCREMENT — the
     * SQLite rowid alias — so the DB assigns each value under the write lock:
     * monotonic, never reused, collision-free even under concurrent writers
     * (no application-side MAX(seq)+1, which could tie two in-flight writes and
     * make "latest" non-deterministic → the resurrection this design forbids).
     * The current-state query sorts by THIS DESC.
     */
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    /** Collision-resistant UUID, unique (was the PK; demoted so seq is the rowid alias). */
    id: text('id').notNull(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    holeNumber: integer('hole_number').notNull(),
    /** 'greenie' | 'polie' | 'sandie' — Zod-validated at the write boundary. */
    claimType: text('claim_type').notNull(),
    /** 'set' | 'remove' — Zod-validated at the write boundary. */
    op: text('op').notNull(),
    scorerPlayerId: text('scorer_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    /** NOT NULL collision-resistant UUID. The dedupe key (the CRITICAL fix). */
    clientEventId: text('client_event_id').notNull(),
    createdAt: integer('created_at').notNull(),
    ...ecosystemColumns(),
  },
  (t) => ({
    // Current-state derivation reads the latest write per cell — index the cell
    // key + seq DESC so the "highest seq per (round,player,hole,claim_type)"
    // query is index-served.
    cellSeqIdx: index('idx_hole_claim_writes_cell_seq').on(
      t.roundId,
      t.playerId,
      t.holeNumber,
      t.claimType,
      t.seq,
    ),
    roundIdx: index('idx_hole_claim_writes_round_id').on(t.roundId),
    // id is no longer the PK (seq is the rowid alias) — keep it unique.
    idUniq: uniqueIndex('uniq_hole_claim_writes_id').on(t.id),
    // THE dedupe UNIQUE — global on client_event_id. A replay of ANY write
    // (set OR remove) is a no-op. There is NO cell-unique constraint (that's
    // what the CRITICAL fix removed): a cell may have many writes over time,
    // and the latest-seq write decides its current state.
    clientEventUniq: uniqueIndex('uniq_hole_claim_writes_client_event_id').on(
      t.clientEventId,
    ),
  }),
);

export type HoleClaimWrite = typeof holeClaimWrites.$inferSelect;
