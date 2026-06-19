/**
 * Public bet board — GET /api/bets.
 *
 * Returns this week's side-action bets (the active round) with live outcomes
 * (auto-settled from scores) + a per-stakeholder settle-up. Read-only, public:
 * everyone can see the action on the board.
 */
import { Hono } from "hono";
import { getBetsBoard } from "../services/bets.js";

const app = new Hono();

app.get("/bets", async (c) => {
  const board = await getBetsBoard();
  c.header("cache-control", "no-store");
  return c.json(board);
});

export default app;
