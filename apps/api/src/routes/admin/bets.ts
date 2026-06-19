/**
 * Admin bet management — create / delete this week's side-action bets.
 *
 * v1: only an admin (session cookie) can set bets. Every party is a player_id
 * so per-person identity layers on later with no migration. Outcomes are NOT
 * stored — they recompute from scores (see services/bets.ts).
 *
 *   GET    /api/admin/bets        — board + the active round's player roster (picker)
 *   POST   /api/admin/bets        — create a bet
 *   DELETE /api/admin/bets/:id    — remove a bet
 */
import { Hono } from "hono";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bets, roundPlayers, players } from "../../db/schema.js";
import { adminAuthMiddleware } from "../../middleware/admin-auth.js";
import type { Variables } from "../../types.js";
import { getActiveRound, getBetsBoard } from "../../services/bets.js";
import { lookupMarketOdds, computeRoundOddsLine } from "../../lib/odds-line.js";

const app = new Hono<{ Variables: Variables }>();

const createBetSchema = z.object({
  roundId: z.number().int().optional(), // default = active round
  betType: z.enum(["h2h", "over_under", "per_hole", "odds_win"]),
  basis: z.enum(["net", "gross"]).default("net"),
  amountDollars: z.number().int().positive(),
  subjectAPlayerId: z.number().int().positive(),
  subjectBPlayerId: z.number().int().positive().nullable().optional(),
  line: z.number().int().nullable().optional(),
  // odds_win only: the market. The PRICE is pulled from The Line server-side (never
  // client-supplied) so the locked odds always match the generated line.
  oddsMarket: z.enum(["stableford", "money", "perfect_day"]).optional(),
  sideAPlayerId: z.number().int().positive(),
  // sideB is the layer. Optional/null ONLY for odds_win = bet vs The House (no
  // second player); required for h2h / over_under / per_hole.
  sideBPlayerId: z.number().int().positive().nullable().optional(),
  note: z.string().max(200).optional(),
});

// GET — the board + the active round's roster (for the add-bet picker).
app.get("/bets", adminAuthMiddleware, async (c) => {
  const board = await getBetsBoard();
  const round = await getActiveRound();
  // roster = the round's players (valid SUBJECTS — they need scores to settle).
  let roster: Array<{ id: number; name: string }> = [];
  if (round) {
    roster = await db
      .select({ id: players.id, name: players.name })
      .from(roundPlayers)
      .innerJoin(players, eq(players.id, roundPlayers.playerId))
      .where(eq(roundPlayers.roundId, round.id))
      .orderBy(players.name);
  }
  // allPlayers = every active league member (valid STAKEHOLDERS — a better like
  // Kyle who isn't playing this week can still back a side).
  const allPlayers = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(eq(players.isActive, 1))
    .orderBy(players.name);

  // The current Line price per player per market — so the odds_win form can SHOW
  // the locked odds (read-only; the POST re-derives the same value server-side).
  let oddsLines: Array<{ playerId: number; stableford: number | null; money: number | null; perfectDay: number | null }> = [];
  if (round) {
    const res = await computeRoundOddsLine(round.id);
    if (res && !res.odds.gated) {
      oddsLines = res.odds.lines.map((l) => ({
        playerId: l.playerId,
        stableford: l.outcomes.stableford.american,
        money: l.outcomes.money.american,
        perfectDay: l.outcomes.perfectDay.american,
      }));
    }
  }
  return c.json({ ...board, roster, allPlayers, oddsLines });
});

// POST — create a bet.
app.post("/bets", adminAuthMiddleware, async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createBetSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  }
  const d = parsed.data;

  let roundId = d.roundId;
  if (roundId == null) {
    const ar = await getActiveRound();
    if (!ar) return c.json({ error: "no_active_round" }, 422);
    roundId = ar.id;
  }

  if (d.betType === "h2h" || d.betType === "per_hole") {
    if (d.subjectBPlayerId == null) return c.json({ error: "needs_two_subjects" }, 400);
    if (d.subjectAPlayerId === d.subjectBPlayerId) return c.json({ error: "subjects_must_differ" }, 400);
  } else if (d.betType === "over_under") {
    if (d.line == null) return c.json({ error: "over_under_needs_line" }, 400);
  } else {
    // odds_win — one subject (the player bet to win) + a market. Price comes from
    // The Line below (after we know roundId), not from the client.
    if (d.oddsMarket == null) return c.json({ error: "odds_win_needs_market" }, 400);
  }
  // The layer (side B) is required for every type EXCEPT odds_win, where a null
  // layer means the bet is vs The House (the book) — no second player.
  if (d.betType !== "odds_win" && d.sideBPlayerId == null) {
    return c.json({ error: "needs_layer" }, 400);
  }
  if (d.sideBPlayerId != null && d.sideAPlayerId === d.sideBPlayerId) {
    return c.json({ error: "stakeholders_must_differ" }, 400);
  }

  // Subjects must be IN the round (they need scores to settle); stakeholders
  // must be real players (a non-playing better like Kyle is fine). Don't trust
  // the client to send valid/roster ids.
  const subjectIds = [d.subjectAPlayerId];
  // Only h2h/per_hole have a second subject; ignore any stray subjectBPlayerId on
  // over_under/odds_win so it can't wrongly trip the roster check.
  if ((d.betType === "h2h" || d.betType === "per_hole") && d.subjectBPlayerId != null) {
    subjectIds.push(d.subjectBPlayerId);
  }
  const rosterRows = await db
    .select({ playerId: roundPlayers.playerId })
    .from(roundPlayers)
    .where(eq(roundPlayers.roundId, roundId));
  const rosterIds = new Set(rosterRows.map((r) => r.playerId));
  if (subjectIds.some((id) => !rosterIds.has(id))) {
    return c.json({ error: "subject_not_in_round" }, 400);
  }
  // Validate only the present stakeholders (a null side B = The House, not a player).
  const stakeIds = [d.sideAPlayerId, ...(d.sideBPlayerId != null ? [d.sideBPlayerId] : [])];
  const realRows = await db
    .select({ id: players.id })
    .from(players)
    .where(inArray(players.id, stakeIds));
  if (new Set(realRows.map((r) => r.id)).size !== new Set(stakeIds).size) {
    return c.json({ error: "stakeholder_not_a_player" }, 400);
  }

  // odds_win: LOCK the price from The Line right now (never trust a client value).
  // No priceable line for this player (gated / under-sampled) → refuse to book.
  let lockedOdds: number | null = null;
  if (d.betType === "odds_win") {
    lockedOdds = await lookupMarketOdds(roundId, d.subjectAPlayerId, d.oddsMarket!);
    if (lockedOdds == null) return c.json({ error: "no_line_for_player" }, 422);
  }

  const adminId = c.get("adminId");
  const [row] = await db
    .insert(bets)
    .values({
      roundId,
      betType: d.betType,
      basis: d.basis,
      amountDollars: d.amountDollars,
      subjectAPlayerId: d.subjectAPlayerId,
      subjectBPlayerId: d.betType === "h2h" || d.betType === "per_hole" ? d.subjectBPlayerId! : null,
      line: d.betType === "over_under" ? d.line! : null,
      oddsMarket: d.betType === "odds_win" ? d.oddsMarket! : null,
      odds: lockedOdds,
      sideAPlayerId: d.sideAPlayerId,
      sideBPlayerId: d.sideBPlayerId ?? null, // null = The House (odds_win vs the book)
      note: d.note ?? null,
      createdByAdminId: adminId,
      createdAt: Date.now(),
    })
    .returning({ id: bets.id });

  return c.json({ id: row!.id }, 201);
});

// DELETE — remove a bet.
app.delete("/bets/:id", adminAuthMiddleware, async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid_id" }, 400);
  await db.delete(bets).where(eq(bets.id, id));
  return c.json({ ok: true });
});

export default app;
