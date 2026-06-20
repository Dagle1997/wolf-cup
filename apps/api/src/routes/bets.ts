/**
 * Public bet board — GET /api/bets[?roundId=N].
 *
 * Returns a round's side-action bets with live outcomes (auto-settled from
 * scores) + a per-stakeholder settle-up. Defaults to the active round; pass
 * `?roundId=N` to view a past round's bets + results (drives the history view
 * reached from a past round's scouting panel). Read-only, public: everyone can
 * see the action on the board.
 */
import { Hono } from "hono";
import { getBetsBoard, getSeasonBetHistory } from "../services/bets.js";

const app = new Hono();

app.get("/bets", async (c) => {
  const raw = c.req.query("roundId");
  const n = raw != null ? Number(raw) : NaN;
  // Invalid/absent roundId → fall back to the active round (undefined).
  const roundId = Number.isInteger(n) && n > 0 ? n : undefined;
  const board = await getBetsBoard(roundId);
  c.header("cache-control", "no-store");
  return c.json(board);
});

// Season-long betting record — per-person net across every settled bet this season.
app.get("/bets/history", async (c) => {
  const history = await getSeasonBetHistory();
  c.header("cache-control", "no-store");
  return c.json(history);
});

export default app;
