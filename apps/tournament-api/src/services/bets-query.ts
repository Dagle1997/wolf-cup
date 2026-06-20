/**
 * "The Action" betting — READ / settlement service (Story 1.1b).
 *
 * Read-only. Loads a bet + its sides, feeds each subject's per-hole net (from
 * the canonical netForSegment, P2 — settlement NEVER re-derives net) into the
 * pure engine (settleBet), and returns the derived outcome + SettlementEdge IR.
 *
 * This module is the money_visibility chokepoint (P8): bet-sourced money enters
 * the rest of the app ONLY through computeActionBetEdgesForEvent. money.ts /
 * money-detail.ts call in here; routes never settle a bet themselves.
 *
 * Recompute-on-read (P3/P4): a 'live' bet has no stored outcome — settled /
 * push / provisional are derived here each read. The durable `state` column is
 * the source of truth only for void / unsettleable / finalized (later stories).
 *
 * net-calc-version guard (architecture key-deliverable): each derived outcome
 * is stamped with NET_CALC_VERSION. If a bet has banked under an OLDER version
 * (bets.net_calc_version set + differing), we surface `netCalcVersionMismatch`
 * for organizer review rather than silently re-settling banked money. Nothing
 * banks in Story 1.1, so this is dormant scaffolding that protects Epic-5-or-not.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { db as DbType } from '../db/index.js';
import { bets, betSides, eventRounds, players, rounds } from '../db/schema/index.js';
import {
  netForSegment,
  NET_CALC_VERSION,
  type LeaderboardCtx,
  type NetForSegmentTrust,
} from './leaderboard.js';
import { scopedHolesForScope, type HoleScope } from '../engine/bets/scope.js';
import { settleBet, type SettlementEdge } from '../engine/bets/index.js';
import type { BetDef, H2hInput, SettlementState } from '../engine/bets/types.js';

type Db = typeof DbType;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type BetWithSides = {
  id: string;
  eventId: string;
  eventRoundId: string;
  holeScope: HoleScope;
  betType: string;
  basis: string;
  stakeCents: number;
  /** Durable lifecycle state from the row (live | void | unsettleable | finalized). */
  state: string;
  netCalcVersion: number | null;
  createdByPlayerId: string;
  createdAt: number;
  sides: Array<{ side: 'A' | 'B'; stakeholderPlayerId: string; subjectPlayerId: string }>;
};

export type BetOutcome = {
  /** Derived outcome for a live bet; the durable state for void/finalized/etc. */
  derivedState: SettlementState | 'void' | 'unsettleable' | 'finalized';
  subjectNetTotal: Record<string, number>;
  winnerSubjectId: string | null;
  marginNet: number;
  edges: SettlementEdge[];
  trustBySubject: Record<string, NetForSegmentTrust>;
  netCalcVersion: number;
  netCalcVersionMismatch: boolean;
};

const ctxOf = (txOrDb: Tx | Db, tenantId: string): LeaderboardCtx => ({
  db: txOrDb as Db,
  tenantId,
});

/** Load one bet + its two sides; null if not found in tenant. */
export async function loadBetWithSides(
  txOrDb: Tx | Db,
  betId: string,
  tenantId: string,
): Promise<BetWithSides | null> {
  const row = (
    await txOrDb
      .select()
      .from(bets)
      .where(and(eq(bets.id, betId), eq(bets.tenantId, tenantId)))
      .limit(1)
  )[0];
  if (!row) return null;
  const sideRows = await txOrDb
    .select({
      side: betSides.side,
      stakeholderPlayerId: betSides.stakeholderPlayerId,
      subjectPlayerId: betSides.subjectPlayerId,
    })
    .from(betSides)
    .where(and(eq(betSides.betId, betId), eq(betSides.tenantId, tenantId)))
    .orderBy(asc(betSides.side));
  return {
    id: row.id,
    eventId: row.eventId,
    eventRoundId: row.eventRoundId,
    holeScope: row.holeScope as HoleScope,
    betType: row.betType,
    basis: row.basis,
    stakeCents: row.stakeCents,
    state: row.state,
    netCalcVersion: row.netCalcVersion,
    createdByPlayerId: row.createdByPlayerId,
    createdAt: row.createdAt,
    sides: sideRows.map((s) => ({
      side: s.side as 'A' | 'B',
      stakeholderPlayerId: s.stakeholderPlayerId,
      subjectPlayerId: s.subjectPlayerId,
    })),
  };
}

/**
 * Settle one loaded bet (recompute-on-read). For a durable terminal state
 * (void/finalized/unsettleable) returns that state with no edges — banked
 * money / finalize snapshots are later stories. For a 'live' bet, resolves the
 * scoring round, pulls each subject's per-hole net, and runs the pure engine.
 */
export async function settleActionBet(
  txOrDb: Tx | Db,
  bet: BetWithSides,
  tenantId: string,
): Promise<BetOutcome> {
  const empty: BetOutcome = {
    derivedState: 'provisional',
    subjectNetTotal: {},
    winnerSubjectId: null,
    marginNet: 0,
    edges: [],
    trustBySubject: {},
    netCalcVersion: NET_CALC_VERSION,
    netCalcVersionMismatch: false,
  };

  // Durable terminal states short-circuit (no recompute; no edges in 1.1).
  if (bet.state === 'void' || bet.state === 'finalized' || bet.state === 'unsettleable') {
    return { ...empty, derivedState: bet.state };
  }

  // Resolve the round's holesToPlay (for scope) + the scoring round id.
  const erRows = await txOrDb
    .select({ holesToPlay: eventRounds.holesToPlay })
    .from(eventRounds)
    .where(and(eq(eventRounds.id, bet.eventRoundId), eq(eventRounds.tenantId, tenantId)))
    .limit(1);
  if (erRows.length === 0) return empty;
  const holesToPlay = erRows[0]!.holesToPlay;
  const scopedHoles = scopedHolesForScope(bet.holeScope, holesToPlay);
  if (scopedHoles.length === 0) return empty;

  // Deterministic round pick (matches money.ts/money-detail.ts ordering).
  const runtimeRoundRows = await txOrDb
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.eventRoundId, bet.eventRoundId), eq(rounds.tenantId, tenantId)))
    .orderBy(asc(rounds.createdAt), asc(rounds.id))
    .limit(1);
  if (runtimeRoundRows.length === 0) return empty; // round not started → provisional
  const roundId = runtimeRoundRows[0]!.id;

  const ctx = ctxOf(txOrDb, tenantId);
  // netForSegment is the single canonical source (P2); it returns BOTH net and
  // gross per hole. A 'gross' bet compares gross strokes, otherwise net. (Note:
  // netForSegment fails closed without an HI even for gross — a known
  // limitation; every event player has an HI in practice. Putts never reaches
  // here — the dispatch rejects it as unsupported.)
  const useGross = bet.basis === 'gross';
  const netPerHoleBySubject: Record<string, Array<number | null>> = {};
  const trustBySubject: Record<string, NetForSegmentTrust> = {};
  const subjectIds = [...new Set(bet.sides.map((s) => s.subjectPlayerId))];
  for (const subjectId of subjectIds) {
    const seg = await netForSegment(ctx, { roundId, playerId: subjectId, holeNumbers: scopedHoles });
    trustBySubject[subjectId] = seg.trust;
    // Align to scopedHoles ascending (netForSegment returns hole-ascending).
    const valueByHole = new Map(seg.perHole.map((p) => [p.holeNumber, useGross ? p.gross : p.net]));
    netPerHoleBySubject[subjectId] = scopedHoles.map((h) => valueByHole.get(h) ?? null);
  }

  const betDef: BetDef = {
    id: bet.id,
    betType: bet.betType,
    basis: bet.basis,
    holeScope: bet.holeScope,
    stakeCents: bet.stakeCents,
    scopedHoles,
    sides: bet.sides.map((s) => ({
      side: s.side,
      stakeholderPlayerId: s.stakeholderPlayerId,
      subjectPlayerId: s.subjectPlayerId,
    })),
  };
  const input: H2hInput = { bet: betDef, netPerHoleBySubject };
  const outcome = settleBet(input);

  return {
    derivedState: outcome.state,
    subjectNetTotal: outcome.subjectNetTotal,
    winnerSubjectId: outcome.result.winnerSubjectId,
    marginNet: outcome.result.marginNet,
    edges: outcome.edges,
    trustBySubject,
    netCalcVersion: NET_CALC_VERSION,
    netCalcVersionMismatch:
      bet.netCalcVersion !== null && bet.netCalcVersion !== NET_CALC_VERSION,
  };
}

/**
 * THE P8 CHOKEPOINT. All settled SettlementEdges for an event's action bets.
 * money.ts / money-detail.ts fold these into the pairwise ledger so bets share
 * the ONE money surface (no parallel ledger). Only live bets that derive to
 * 'settled' contribute edges; push / provisional / void / finalized contribute
 * nothing (FR26/FR39).
 */
export async function computeActionBetEdgesForEvent(
  txOrDb: Tx | Db,
  eventId: string,
  tenantId: string,
): Promise<SettlementEdge[]> {
  const betRows = await txOrDb
    .select({ id: bets.id })
    .from(bets)
    .where(and(eq(bets.eventId, eventId), eq(bets.tenantId, tenantId)))
    .orderBy(asc(bets.createdAt), asc(bets.id));
  const edges: SettlementEdge[] = [];
  for (const r of betRows) {
    const bet = await loadBetWithSides(txOrDb, r.id, tenantId);
    if (!bet) continue;
    const outcome = await settleActionBet(txOrDb, bet, tenantId);
    edges.push(...outcome.edges);
  }
  return edges;
}

// ── Admin presentation (route GET) ────────────────────────────────────────

export type BetViewSide = {
  side: 'A' | 'B';
  stakeholderPlayerId: string;
  stakeholderName: string | null;
  subjectPlayerId: string;
  subjectName: string | null;
  subjectNetTotal: number | null;
};

export type BetView = {
  betId: string;
  eventRoundId: string;
  betType: string;
  basis: string;
  holeScope: HoleScope;
  stakeCents: number;
  /** Durable state, or the derived outcome when live. */
  state: BetOutcome['derivedState'];
  winnerSubjectId: string | null;
  marginNet: number;
  sides: BetViewSide[];
  trustBySubject: Record<string, NetForSegmentTrust>;
  netCalcVersionMismatch: boolean;
};

async function toBetView(
  txOrDb: Tx | Db,
  bet: BetWithSides,
  tenantId: string,
): Promise<BetView> {
  const outcome = await settleActionBet(txOrDb, bet, tenantId);
  const playerIds = [
    ...new Set(bet.sides.flatMap((s) => [s.stakeholderPlayerId, s.subjectPlayerId])),
  ];
  const nameRows = await txOrDb
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(and(inArray(players.id, playerIds), eq(players.tenantId, tenantId)));
  const nameById = new Map(nameRows.map((p) => [p.id, p.name]));
  return {
    betId: bet.id,
    eventRoundId: bet.eventRoundId,
    betType: bet.betType,
    basis: bet.basis,
    holeScope: bet.holeScope,
    stakeCents: bet.stakeCents,
    state: bet.state === 'live' ? outcome.derivedState : (bet.state as BetOutcome['derivedState']),
    winnerSubjectId: outcome.winnerSubjectId,
    marginNet: outcome.marginNet,
    sides: bet.sides.map((s) => ({
      side: s.side,
      stakeholderPlayerId: s.stakeholderPlayerId,
      stakeholderName: nameById.get(s.stakeholderPlayerId) ?? null,
      subjectPlayerId: s.subjectPlayerId,
      subjectName: nameById.get(s.subjectPlayerId) ?? null,
      subjectNetTotal: outcome.subjectNetTotal[s.subjectPlayerId] ?? null,
    })),
    trustBySubject: outcome.trustBySubject,
    netCalcVersionMismatch: outcome.netCalcVersionMismatch,
  };
}

/** All action bets for an event, each with derived state + sides (admin list). */
export async function listBetsForEvent(
  txOrDb: Tx | Db,
  eventId: string,
  tenantId: string,
): Promise<BetView[]> {
  const betRows = await txOrDb
    .select({ id: bets.id })
    .from(bets)
    .where(and(eq(bets.eventId, eventId), eq(bets.tenantId, tenantId)))
    .orderBy(asc(bets.createdAt), asc(bets.id));
  const out: BetView[] = [];
  for (const r of betRows) {
    const bet = await loadBetWithSides(txOrDb, r.id, tenantId);
    if (bet) out.push(await toBetView(txOrDb, bet, tenantId));
  }
  return out;
}

/** One action bet view; null if not found or not in this event. */
export async function getActionBetView(
  txOrDb: Tx | Db,
  eventId: string,
  betId: string,
  tenantId: string,
): Promise<BetView | null> {
  const bet = await loadBetWithSides(txOrDb, betId, tenantId);
  if (!bet || bet.eventId !== eventId) return null;
  return toBetView(txOrDb, bet, tenantId);
}
