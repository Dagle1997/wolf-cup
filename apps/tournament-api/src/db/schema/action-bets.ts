import {
  integer,
  sqliteTable,
  text,
  index,
  primaryKey,
  check,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { ecosystemColumns } from './_columns.js';
import { events, eventRounds } from './events.js';
import { players } from './players.js';

/**
 * "The Action" betting schema (PRD prd-betting-action-line.md, FR1–FR54;
 * architecture-betting-action.md D1).
 *
 * NEW, ADDITIVE domain — it does NOT extend `individual_bets` (P14). The
 * two-player shape of individual_bets cannot hold subjects≠stakeholders,
 * segments, or Snake's N parties, so this is a separate model. The shipped
 * match-play path (`schema/bets.ts` → individual_bets) is untouched.
 *
 * Filename note: the bare table names `bets` / `bet_sides` are free, but the
 * filename `bets.ts` is already taken by individual_bets — so this file is
 * `action-bets.ts`. (The architecture doc assumed `bets.ts`; reality differs.)
 *
 * Story 1.1 creates `bets` + `bet_sides`. Snake tables (snake_games,
 * snake_participants, snake_holder_overrides) are Epic 3 and live in a
 * separate file when built.
 *
 * CHECK policy:
 *   - CLOSED enums (`state`, `hole_scope`, `side`) carry DB CHECKs — safe
 *     because these are CREATE-table constraints, not later ALTER ADD COLUMN
 *     (the rebuild gotcha only bites ALTER-with-CHECK).
 *   - OPEN/additive enums (`bet_type`, `basis`) carry NO DB CHECK — validated
 *     in Zod (FR20 additive-type model: a new type/basis must not require a
 *     migration). Unknown values are rejected at creation in code (P6).
 *
 * Column lifecycle (which story activates each — all created now to avoid
 * repeated migrations against the live app's chain during the Pete Dye
 * sprint; FK columns especially, since adding an FK later forces a SQLite
 * table rebuild):
 *   - core (1.1): id, event_id, event_round_id, hole_scope, bet_type, basis,
 *     stake_cents, state, net_calc_version, created_by_player_id, created_at
 *   - parent_bet_id  → Epic 4 segmentation (nullable self-FK; unused in 1.1)
 *   - voided_at/by   → Story 1.4 void (nullable; unused in 1.1)
 *   - resolution_json → Story 1.6 UNSETTLEABLE resolve (nullable)
 *   - finalized_outcome_json → Epic 5 finalize-snapshot (nullable)
 *
 * `state` is the durable lifecycle position (P4 single source of truth):
 * created 'live'; code transitions it to 'void' / 'unsettleable' / 'finalized'.
 * The derived outcomes ('settled' | 'push' | 'provisional') are computed
 * recompute-on-read for a 'live' bet (P3 — no stored outcome while live);
 * `finalized_outcome_json` is the only frozen outcome (Epic 5).
 *
 * `net_calc_version` stamps the leaderboard net-calc version a banked/settled
 * outcome was computed under, so a later net-calc change cannot silently
 * re-settle it (architecture key-deliverable; surfaced for organizer review
 * on mismatch). Nullable until the bet banks.
 *
 * FK delete posture (mirrors individual_bets):
 *   - event_id → events.id: CASCADE
 *   - event_round_id → event_rounds.id: CASCADE
 *   - parent_bet_id → bets.id: CASCADE (a segmented parent's children go with it)
 *   - created_by/voided_by → players.id: RESTRICT (audit attribution preserved)
 */

export const bets = sqliteTable(
  'bets',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    // Scope binding (FR48): a bet binds to a specific event round + hole_scope.
    eventRoundId: text('event_round_id')
      .notNull()
      .references(() => eventRounds.id, { onDelete: 'cascade' }),
    // Reserved for Epic 4 segmentation (Nassau parent → 3 children). Null = a
    // standalone bet. A segmented PARENT is a non-settling container; only
    // children settle (enforced in the engine, architecture D1).
    parentBetId: text('parent_bet_id').references((): AnySQLiteColumn => bets.id, {
      onDelete: 'cascade',
    }),
    holeScope: text('hole_scope').notNull(),
    betType: text('bet_type').notNull(), // open enum, Zod-validated (FR20)
    basis: text('basis').notNull(), // open enum, Zod-validated (FR20)
    stakeCents: integer('stake_cents').notNull(),
    state: text('state').notNull().default('live'),
    // Leaderboard net-calc version the banked outcome was computed under.
    netCalcVersion: integer('net_calc_version'),
    resolutionJson: text('resolution_json'), // Story 1.6 organizer resolve
    finalizedOutcomeJson: text('finalized_outcome_json'), // Epic 5 finalize
    createdByPlayerId: text('created_by_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at').notNull(),
    voidedAt: integer('voided_at'), // Story 1.4
    voidedByPlayerId: text('voided_by_player_id').references(() => players.id, {
      onDelete: 'restrict',
    }), // Story 1.4
    ...ecosystemColumns(),
  },
  (t) => ({
    eventIdx: index('idx_bets_event_id').on(t.eventId),
    eventRoundIdx: index('idx_bets_event_round_id').on(t.eventRoundId),
    parentIdx: index('idx_bets_parent_bet_id').on(t.parentBetId),
    holeScopeCheck: check(
      'check_bets_hole_scope',
      sql`${t.holeScope} IN ('front', 'back', 'total', 'full18')`,
    ),
    stateCheck: check(
      'check_bets_state',
      sql`${t.state} IN ('live', 'provisional', 'settled', 'push', 'void', 'unsettleable', 'finalized')`,
    ),
    stakePositiveCheck: check(
      'check_bets_stake_positive',
      sql`${t.stakeCents} > 0`,
    ),
  }),
);

export type Bet = typeof bets.$inferSelect;

/**
 * Two rows per 2-party bet. Encodes subjects ≠ stakeholders (FR8):
 *   - stakeholder_player_id = who has the money on this side
 *   - subject_player_id     = whose play this side backs
 * For the open book (FR10, the "Kyle" case) the stakeholder may be any roster
 * member, playing or not, and need not equal the subject.
 *
 * FR50 (the same player cannot be BOTH stakeholders) is a cross-row invariant
 * — enforced in the write path (Zod/route), not expressible as a single-row
 * CHECK.
 */
export const betSides = sqliteTable(
  'bet_sides',
  {
    betId: text('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    side: text('side').notNull(),
    stakeholderPlayerId: text('stakeholder_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    subjectPlayerId: text('subject_player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'restrict' }),
    ...ecosystemColumns(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.betId, t.side] }),
    stakeholderIdx: index('idx_bet_sides_stakeholder').on(t.stakeholderPlayerId),
    subjectIdx: index('idx_bet_sides_subject').on(t.subjectPlayerId),
    sideCheck: check('check_bet_sides_side', sql`${t.side} IN ('A', 'B')`),
  }),
);

export type BetSide = typeof betSides.$inferSelect;
