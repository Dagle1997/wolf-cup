/**
 * Side-action bet tracker — settle engine + board builder.
 *
 * Bets auto-settle from the round's scores (pure, recomputed every read — a
 * score correction re-settles automatically). Net is computed the SAME way the
 * leaderboard does it (slope-aware `getHandicapStrokes` off the per-round
 * `round_players.handicap_index` + `round.tee`) — never re-derive net by hand
 * (the recurring `Math.round(HI)` bug family).
 *
 * Side semantics:
 *   h2h        — side A = subject_a wins (LOWER score by basis), side B = subject_b wins; equal = push
 *   over_under — side A = UNDER (subject_a's score < line), side B = OVER (> line); equal = push
 *
 * A bet only DECLARES a winner once every subject has a complete 18; until then
 * it's `live`. v1 is admin-entered; every party is a player_id so per-person
 * identity layers on later with no migration.
 */
import { desc, eq, inArray, or } from "drizzle-orm";
import { getCourseHole, getHandicapStrokes } from "@wolf-cup/engine";
import type { Tee, HoleNumber } from "@wolf-cup/engine";
import { db } from "../db/index.js";
import { bets, rounds, roundPlayers, holeScores, players, roundResults, seasons } from "../db/schema.js";

const DEFAULT_TEE: Tee = "blue";

export type OddsMarket = "stableford" | "money" | "perfect_day";

/**
 * The round's settled "day" — who owns each Line title. A market is owned only by
 * the SOLE leader (a tie = nobody owns it cleanly, mirrors The Line's "no ties"
 * Perfect Day rule). `finalized` gates odds_win settlement: before the round is
 * finalized the day-winner isn't authoritative, so the bet stays `live`.
 */
export type DayMarkets = {
  /** Round is in a terminal scored state (finalized | completed) AND has results. */
  resolved: boolean;
  stablefordWinner: number | null; // sole #1 in Stableford points; null if tied/none
  moneyWinner: number | null; // sole #1 in money; null if tied/none
  perfectDayWinner: number | null; // sole #1 in BOTH
};

/** American-odds PROFIT on a stake, rounded to whole dollars. +odds: stake×odds/100; −odds: stake×100/|odds|. */
export function americanProfit(stake: number, odds: number): number {
  if (odds === 0) return 0;
  return odds > 0
    ? Math.round((stake * odds) / 100)
    : Math.round((stake * 100) / Math.abs(odds));
}

/** A round is in a terminal SCORED state — its day-winner is authoritative. */
export function isTerminalRoundStatus(status: string): boolean {
  return status === "finalized" || status === "completed";
}

/**
 * Resolve each Line title's SOLE winner from round_results (authoritative once the
 * round is terminal). `resolved` is true ONLY when the round is terminal AND results
 * exist — a terminal round with EMPTY results is a data anomaly, so we leave it
 * unresolved (odds_win then fails closed to `live` rather than auto-paying the layer).
 */
export async function computeDayMarkets(
  roundId: number,
  terminal: boolean,
): Promise<DayMarkets> {
  const rows = await db
    .select({
      playerId: roundResults.playerId,
      stableford: roundResults.stablefordTotal,
      money: roundResults.moneyTotal,
    })
    .from(roundResults)
    .where(eq(roundResults.roundId, roundId));

  // Sole leader of `sel`, or null when empty or tied at the top.
  const soleLeader = (sel: (r: (typeof rows)[number]) => number): number | null => {
    if (rows.length === 0) return null;
    let best = -Infinity;
    let leaders: number[] = [];
    for (const r of rows) {
      const v = sel(r);
      if (v > best) {
        best = v;
        leaders = [r.playerId];
      } else if (v === best) {
        leaders.push(r.playerId);
      }
    }
    return leaders.length === 1 ? leaders[0]! : null;
  };

  const stablefordWinner = soleLeader((r) => r.stableford);
  const moneyWinner = soleLeader((r) => r.money);
  const perfectDayWinner =
    stablefordWinner != null && stablefordWinner === moneyWinner ? stablefordWinner : null;

  return { resolved: terminal && rows.length > 0, stablefordWinner, moneyWinner, perfectDayWinner };
}

export type StrokeTotals = {
  gross18: number;
  net18: number;
  holesPlayed: number;
  /** Per-hole gross / net (holeNumber → value) — for per-hole match-play bets. */
  perHoleGross: Map<number, number>;
  perHoleNet: Map<number, number>;
  /**
   * NET is only trustworthy when the round's tee is known AND this player has a
   * round handicap. If either is missing we can compute gross but NOT a
   * defensible net — net bets then stay `live` (fail closed) rather than
   * auto-paying on a guessed handicap. Gross bets are always reliable.
   */
  netReliable: boolean;
};

export type ActiveRound = {
  id: number;
  status: string;
  tee: string | null;
  scheduledDate: string;
};

/**
 * The round the public board is pointed at: an ACTIVE official wins over a
 * future SCHEDULED one; before game day a scheduled official still shows.
 * Mirrors the leaderboard's resolution.
 */
export async function getActiveRound(): Promise<ActiveRound | null> {
  const candidates = await db
    .select({
      id: rounds.id,
      type: rounds.type,
      status: rounds.status,
      tee: rounds.tee,
      scheduledDate: rounds.scheduledDate,
    })
    .from(rounds)
    .where(or(eq(rounds.status, "active"), eq(rounds.status, "scheduled")))
    .orderBy(desc(rounds.id))
    .all();
  const r =
    candidates.find((c) => c.type === "official" && c.status === "active") ??
    candidates.find((c) => c.type === "official") ??
    candidates.find((c) => c.status === "active") ??
    candidates[0] ??
    null;
  return r ? { id: r.id, status: r.status, tee: r.tee, scheduledDate: r.scheduledDate } : null;
}

/** Per-player gross18 / net18 / holesPlayed for a round (leaderboard-identical net). */
export async function computeStrokeTotals(
  roundId: number,
  tee: Tee | null,
): Promise<Map<number, StrokeTotals>> {
  const teeKnown = tee === "black" || tee === "blue" || tee === "white";
  const effTee: Tee = teeKnown ? tee! : DEFAULT_TEE; // compute-with-default but flag net unreliable

  const rp = await db
    .select({ playerId: roundPlayers.playerId, hi: roundPlayers.handicapIndex })
    .from(roundPlayers)
    .where(eq(roundPlayers.roundId, roundId));
  const hiMap = new Map(rp.map((r) => [r.playerId, r.hi]));

  const scores = await db
    .select({
      playerId: holeScores.playerId,
      holeNumber: holeScores.holeNumber,
      grossScore: holeScores.grossScore,
    })
    .from(holeScores)
    .where(eq(holeScores.roundId, roundId));

  const totals = new Map<number, StrokeTotals>();
  for (const s of scores) {
    const hiKnown = hiMap.has(s.playerId);
    const hi = hiMap.get(s.playerId) ?? 0;
    const courseHole = getCourseHole(s.holeNumber as HoleNumber);
    const strokes = getHandicapStrokes(hi, courseHole.strokeIndex, effTee);
    const t =
      totals.get(s.playerId) ??
      ({
        gross18: 0,
        net18: 0,
        holesPlayed: 0,
        perHoleGross: new Map(),
        perHoleNet: new Map(),
        netReliable: teeKnown && hiKnown,
      } as StrokeTotals);
    const net = s.grossScore - strokes;
    t.gross18 += s.grossScore;
    t.net18 += net;
    t.holesPlayed += 1;
    t.perHoleGross.set(s.holeNumber, s.grossScore);
    t.perHoleNet.set(s.holeNumber, net);
    totals.set(s.playerId, t);
  }
  return totals;
}

export type BetRow = typeof bets.$inferSelect;

export type BetOutcome = {
  status: "live" | "settled" | "push";
  /** 'A' | 'B' when settled — which SIDE won (side_a / side_b stakeholder). */
  winningSide: "A" | "B" | null;
  /** Dollars the winning side collects from the losing side (0 if live/push). */
  payout: number;
  /** h2h/over_under: subjects' 18 totals under this bet's basis (null until complete). */
  subjectAScore: number | null;
  subjectBScore: number | null;
  /** per_hole only: holes each subject won outright. */
  holesWon: { a: number; b: number } | null;
};

/** Pure: settle one bet against the round's stroke totals (+ day markets for odds_win). */
export function settleBet(
  bet: BetRow,
  totals: Map<number, StrokeTotals>,
  day?: DayMarkets,
): BetOutcome {
  if (bet.betType === "odds_win") {
    const live: BetOutcome = { status: "live", winningSide: null, payout: 0, subjectAScore: null, subjectBScore: null, holesWon: null };
    // Bettor (side A) backs subject_a to WIN a Line market at locked American odds.
    // Authoritative only once the round is terminal WITH results; until then live.
    if (bet.odds == null || bet.oddsMarket == null || !day || !day.resolved) return live;
    // FAIL CLOSED on an unknown market string (data/enum corruption) — never auto-pay.
    const winnerByMarket: Record<string, number | null> = {
      stableford: day.stablefordWinner,
      money: day.moneyWinner,
      perfect_day: day.perfectDayWinner,
    };
    if (!(bet.oddsMarket in winnerByMarket)) return live;
    const winnerId: number | null = winnerByMarket[bet.oddsMarket] ?? null;
    const hit = winnerId != null && winnerId === bet.subjectAPlayerId;
    return hit
      ? { status: "settled", winningSide: "A", payout: americanProfit(bet.amountDollars, bet.odds), subjectAScore: null, subjectBScore: null, holesWon: null } // bettor collects profit
      : { status: "settled", winningSide: "B", payout: bet.amountDollars, subjectAScore: null, subjectBScore: null, holesWon: null }; // layer collects the stake
  }

  const a = totals.get(bet.subjectAPlayerId);
  // NET bets only grade when the net is trustworthy (tee + handicap known);
  // otherwise stay live (fail closed). Gross is always gradeable.
  const scoreFor = (t: StrokeTotals | undefined): number | null =>
    !t || t.holesPlayed < 18 || (bet.basis === "net" && !t.netReliable)
      ? null
      : bet.basis === "gross"
        ? t.gross18
        : t.net18;
  const sa = scoreFor(a);

  if (bet.betType === "over_under") {
    if (sa == null || bet.line == null) {
      return { status: "live", winningSide: null, payout: 0, subjectAScore: sa, subjectBScore: null, holesWon: null };
    }
    if (sa < bet.line) return { status: "settled", winningSide: "A", payout: bet.amountDollars, subjectAScore: sa, subjectBScore: null, holesWon: null }; // under
    if (sa > bet.line) return { status: "settled", winningSide: "B", payout: bet.amountDollars, subjectAScore: sa, subjectBScore: null, holesWon: null }; // over
    return { status: "push", winningSide: null, payout: 0, subjectAScore: sa, subjectBScore: null, holesWon: null };
  }

  const b = bet.subjectBPlayerId != null ? totals.get(bet.subjectBPlayerId) : undefined;

  if (bet.betType === "per_hole") {
    // Match-play: each hole both played, lower (net or gross) wins it. Money =
    // |holesA − holesB| × amountDollars (the per-HOLE stake).
    if (
      !a ||
      !b ||
      a.holesPlayed < 18 ||
      b.holesPlayed < 18 ||
      (bet.basis === "net" && (!a.netReliable || !b.netReliable))
    ) {
      return { status: "live", winningSide: null, payout: 0, subjectAScore: null, subjectBScore: null, holesWon: null };
    }
    const ah = bet.basis === "gross" ? a.perHoleGross : a.perHoleNet;
    const bh = bet.basis === "gross" ? b.perHoleGross : b.perHoleNet;
    let won = 0;
    let lost = 0;
    for (let h = 1; h <= 18; h++) {
      const av = ah.get(h);
      const bv = bh.get(h);
      if (av == null || bv == null) continue;
      if (av < bv) won++;
      else if (av > bv) lost++;
    }
    const netHoles = won - lost;
    const payout = Math.abs(netHoles) * bet.amountDollars;
    const holesWon = { a: won, b: lost };
    if (netHoles > 0) return { status: "settled", winningSide: "A", payout, subjectAScore: null, subjectBScore: null, holesWon };
    if (netHoles < 0) return { status: "settled", winningSide: "B", payout, subjectAScore: null, subjectBScore: null, holesWon };
    return { status: "push", winningSide: null, payout: 0, subjectAScore: null, subjectBScore: null, holesWon };
  }

  // h2h — lower 18 total wins.
  const sb = scoreFor(b);
  if (sa == null || sb == null) {
    return { status: "live", winningSide: null, payout: 0, subjectAScore: sa, subjectBScore: sb, holesWon: null };
  }
  if (sa < sb) return { status: "settled", winningSide: "A", payout: bet.amountDollars, subjectAScore: sa, subjectBScore: sb, holesWon: null }; // A lower wins
  if (sa > sb) return { status: "settled", winningSide: "B", payout: bet.amountDollars, subjectAScore: sa, subjectBScore: sb, holesWon: null };
  return { status: "push", winningSide: null, payout: 0, subjectAScore: sa, subjectBScore: sb, holesWon: null };
}

export type BoardBet = {
  id: number;
  betType: "h2h" | "over_under" | "per_hole" | "odds_win";
  basis: "net" | "gross";
  amountDollars: number;
  line: number | null;
  oddsMarket: OddsMarket | null;
  odds: number | null;
  note: string | null;
  subjectA: { id: number; name: string };
  subjectB: { id: number; name: string } | null;
  sideA: { id: number; name: string }; // backs side A (odds_win: the bettor)
  sideB: { id: number; name: string } | null; // backs side B (odds_win: the layer); null = The House
  outcome: BetOutcome;
};

/** One actionable payment: `from` pays `to` `amount`. */
export type SettleUpEntry = {
  fromPlayerId: number;
  fromName: string;
  toPlayerId: number;
  toName: string;
  amount: number; // > 0
};

export type BetsBoard = {
  round: { id: number; status: string; scheduledDate: string } | null;
  bets: BoardBet[];
  /**
   * Who pays whom, netted PAIRWISE — only bets between the SAME two stakeholders
   * net against each other. A player who is up vs one person and down vs another
   * shows BOTH payments (netting across different payees would hide real money
   * owed). Settled player-vs-player bets only; The House (null side) is the book,
   * not a player, so its bets are left off.
   */
  settleUp: SettleUpEntry[];
};

/** Build the full board for a round (defaults to the active round). */
export async function getBetsBoard(roundId?: number): Promise<BetsBoard> {
  let round: { id: number; status: string; tee: string | null; scheduledDate: string } | null;
  if (roundId != null) {
    const r = (
      await db
        .select({ id: rounds.id, status: rounds.status, tee: rounds.tee, scheduledDate: rounds.scheduledDate })
        .from(rounds)
        .where(eq(rounds.id, roundId))
        .limit(1)
    )[0];
    round = r ?? null;
  } else {
    round = await getActiveRound();
  }
  if (!round) return { round: null, bets: [], settleUp: [] };

  const betRows = await db.select().from(bets).where(eq(bets.roundId, round.id)).orderBy(bets.id);
  if (betRows.length === 0) {
    return { round: { id: round.id, status: round.status, scheduledDate: round.scheduledDate }, bets: [], settleUp: [] };
  }

  // Names for every player referenced by any bet.
  const ids = new Set<number>();
  for (const b of betRows) {
    ids.add(b.subjectAPlayerId);
    if (b.subjectBPlayerId != null) ids.add(b.subjectBPlayerId);
    ids.add(b.sideAPlayerId);
    if (b.sideBPlayerId != null) ids.add(b.sideBPlayerId); // null = The House (no player)
  }
  const nameRows = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(inArray(players.id, [...ids]));
  const nameOf = new Map(nameRows.map((p) => [p.id, p.name]));
  const who = (id: number) => ({ id, name: nameOf.get(id) ?? `#${id}` });

  const totals = await computeStrokeTotals(round.id, round.tee as Tee | null);
  const day = await computeDayMarkets(round.id, isTerminalRoundStatus(round.status));

  const board: BoardBet[] = [];
  // Pairwise nets, keyed by the unordered stakeholder pair. `net` is signed from
  // lowId's perspective: net > 0 ⇒ highId owes lowId; net < 0 ⇒ lowId owes highId.
  const pairNet = new Map<string, { lowId: number; highId: number; net: number }>();
  for (const b of betRows) {
    const outcome = settleBet(b, totals, day);
    if (outcome.status === "settled") {
      const winnerId = outcome.winningSide === "A" ? b.sideAPlayerId : b.sideBPlayerId;
      const loserId = outcome.winningSide === "A" ? b.sideBPlayerId : b.sideAPlayerId;
      // Only player-vs-player bets settle pairwise. A null side is The House
      // (odds_win vs the book) — not a player, so it's left off the settle-up.
      if (winnerId != null && loserId != null) {
        const lowId = Math.min(winnerId, loserId);
        const highId = Math.max(winnerId, loserId);
        const key = `${lowId}-${highId}`;
        const entry = pairNet.get(key) ?? { lowId, highId, net: 0 };
        // Winner collects `payout` from loser; record it in lowId's sign.
        entry.net += winnerId === lowId ? outcome.payout : -outcome.payout;
        pairNet.set(key, entry);
      }
    }
    board.push({
      id: b.id,
      betType: b.betType as "h2h" | "over_under" | "per_hole" | "odds_win",
      basis: b.basis as "net" | "gross",
      amountDollars: b.amountDollars,
      line: b.line,
      oddsMarket: b.oddsMarket as OddsMarket | null,
      odds: b.odds,
      note: b.note,
      subjectA: who(b.subjectAPlayerId),
      subjectB: b.subjectBPlayerId != null ? who(b.subjectBPlayerId) : null,
      sideA: who(b.sideAPlayerId),
      sideB: b.sideBPlayerId != null ? who(b.sideBPlayerId) : null,
      outcome,
    });
  }

  // Resolve each pair's net into a directional payment (loser → winner).
  const nameOrId = (id: number) => nameOf.get(id) ?? `#${id}`;
  const settleUp: SettleUpEntry[] = [];
  for (const { lowId, highId, net: n } of pairNet.values()) {
    if (n === 0) continue; // even pair — nobody owes anybody
    const toId = n > 0 ? lowId : highId; // receiver
    const fromId = n > 0 ? highId : lowId; // payer
    settleUp.push({
      fromPlayerId: fromId,
      fromName: nameOrId(fromId),
      toPlayerId: toId,
      toName: nameOrId(toId),
      amount: Math.abs(n),
    });
  }
  settleUp.sort((a, b) => b.amount - a.amount || a.fromName.localeCompare(b.fromName));

  return { round: { id: round.id, status: round.status, scheduledDate: round.scheduledDate }, bets: board, settleUp };
}

export type SeasonBetHistory = {
  season: { id: number; name: string } | null;
  /** Per-person season net (+ up / − down), settled bets only, sorted by net desc. */
  people: Array<{ playerId: number; name: string; net: number }>;
  /** Bets that haven't settled yet (rounds in progress, or a net bet that can't grade). */
  pendingCount: number;
};

/**
 * Season-long betting record: each person's NET across every settled bet in the
 * CURRENT season. Outcomes are recomputed from each round's scores (never stored),
 * so a correction or a later finalize flows in automatically — same as the live
 * board. The House (null side B) is the book, not a player, so it's left off.
 * Only TERMINAL rounds (finalized | completed) contribute; bets on live rounds —
 * and any that can't grade yet (e.g. a net bet with an unknown tee/HI) — are counted
 * as pending, never as a $0 result.
 */
export async function getSeasonBetHistory(): Promise<SeasonBetHistory> {
  // Current season = latest startDate (mirrors standings).
  const season =
    (await db.select({ id: seasons.id, name: seasons.name }).from(seasons).orderBy(desc(seasons.startDate)).limit(1))[0] ??
    null;
  if (!season) return { season: null, people: [], pendingCount: 0 };

  const seasonRounds = await db
    .select({ id: rounds.id, status: rounds.status, tee: rounds.tee })
    .from(rounds)
    .where(eq(rounds.seasonId, season.id));
  if (seasonRounds.length === 0) return { season, people: [], pendingCount: 0 };

  const roundById = new Map(seasonRounds.map((r) => [r.id, r]));
  const allBets = await db
    .select()
    .from(bets)
    .where(inArray(bets.roundId, [...roundById.keys()]));
  if (allBets.length === 0) return { season, people: [], pendingCount: 0 };

  // Group bets by round so each round is settled once.
  const byRound = new Map<number, BetRow[]>();
  for (const b of allBets) {
    const list = byRound.get(b.roundId);
    if (list) list.push(b);
    else byRound.set(b.roundId, [b]);
  }

  const net = new Map<number, number>();
  let pendingCount = 0;

  for (const [roundId, roundBets] of byRound) {
    const round = roundById.get(roundId)!;
    if (!isTerminalRoundStatus(round.status)) {
      pendingCount += roundBets.length; // round still in progress
      continue;
    }
    // settleBet reads stroke totals only for non-odds_win bets and day markets
    // only for odds_win bets — compute each only when this round actually needs
    // it (a round of pure odds_win bets touches no holeScores, and vice-versa).
    const needsTotals = roundBets.some((b) => b.betType !== "odds_win");
    const needsDay = roundBets.some((b) => b.betType === "odds_win");
    const totals = needsTotals
      ? await computeStrokeTotals(roundId, round.tee as Tee | null)
      : new Map<number, StrokeTotals>();
    const day = needsDay ? await computeDayMarkets(roundId, true) : undefined;
    for (const b of roundBets) {
      const o = settleBet(b, totals, day);
      if (o.status === "live") {
        pendingCount += 1; // terminal round but still ungradeable (e.g. net bet, unknown tee/HI)
        continue;
      }
      if (o.status === "push") continue; // resolved, no money moved — matches the live board's settle-up
      // Only money-moving participants register (lazily), exactly like getBetsBoard's settleUp:
      // a push-only stakeholder never appears, and a null side (The House) is left off.
      const winnerId = o.winningSide === "A" ? b.sideAPlayerId : b.sideBPlayerId;
      const loserId = o.winningSide === "A" ? b.sideBPlayerId : b.sideAPlayerId;
      if (winnerId != null) net.set(winnerId, (net.get(winnerId) ?? 0) + o.payout);
      if (loserId != null) net.set(loserId, (net.get(loserId) ?? 0) - o.payout);
    }
  }

  const ids = [...net.keys()];
  const nameRows = ids.length
    ? await db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, ids))
    : [];
  const nameOf = new Map(nameRows.map((p) => [p.id, p.name]));
  const people = ids
    .map((id) => ({ playerId: id, name: nameOf.get(id) ?? `#${id}`, net: net.get(id)! }))
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));

  return { season, people, pendingCount };
}
