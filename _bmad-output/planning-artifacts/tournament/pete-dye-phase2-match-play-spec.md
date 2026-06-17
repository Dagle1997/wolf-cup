# Pete Dye Phase 2 — Match-play points standings (tech spec)

Status: drafted 2026-06-17 (this session). Format locked with Josh same day.
Phase 1 (event team standings, best-ball-vs-par) shipped `c5e3072`; this is the
separate parallel board promised in `team-standings.ts` line 18.

## Locked format (Josh, 2026-06-17)

- **Opponents:** FOURSOME-INTERNAL, fixed. The two 2-man teams in a foursome
  (slots 1&2 vs 3&4 via `resolveFoursomeTeams`) play only each other — one
  matchup per foursome per round. No cross-foursome / round-robin.
- **Match unit:** 9-hole vs 18-hole toggle. This ALREADY EXISTS as
  `event_rounds.holes_to_play CHECK IN (9,18)` (settable in the create-event
  wizard). The match is scored over whatever holes the round plays. **No new
  schema, no new toggle UI.**
- **Standings:** a SEPARATE parallel board. Match-play points get their own
  standings; the $50/man winner-take-all pot stays on the Phase 1
  best-ball-vs-par board. Two independent boards, both shown.

## Scoring rules (v1 defaults)

- Per-hole winner already computed by `computeFoursomeResults` →
  `perHole[].winner: 'teamA'|'teamB'|'tie'|null` (lower team best NET wins the
  hole; net is full slope-aware course handicap off the locked index).
- **Match result per round** = the team that won MORE holes over the round's
  played holes wins that round's match; equal holes won = halved. (All holes are
  scored in this app, so total-holes-won == final match standing for a completed
  round — no early closeout modelling needed.)
- **Points:** win = 1, halve = 0.5, loss = 0. Fixed for v1 (Josh deferred exact
  values; 1/0.5/0 is the universal match-play convention). Configurable point
  values = a noted follow-up.
- A foursome contributes to a team's match record only once EVERY hole in play
  is scored (`completedHoles === perHole.length`). A round still in progress or
  abandoned partway awards NO points — so a provisional tally can never flip the
  standings — and an unscored event returns an empty board (the empty-state
  shows). For a fully-played round, "won more holes" IS the match-play result.
  (Hardened per codex-review gpt-5.2 high, 2026-06-17, finding #1; Pete Dye plays
  out all 18 since the vs-par pot requires it, so completed matches always reach
  the full hole count. Early-closeout-without-scoring is out of scope.)

## Aggregation

Keyed by the stable 2-man team (sorted player ids joined — same key as
`team-standings.ts`). Across every event round:
- `matchesPlayed`, `won`, `halved`, `lost`
- `points` (Σ 1/0.5/0)
- `holesWon`, `holesLost`, `holesHalved`, `holesDiff = holesWon − holesLost`

Sort: `points` desc → `holesDiff` desc → `teamKey` (stable tiebreak).

Teams that appear in a foursome but have no completed holes still list (with
zeros), mirroring Phase 1's behavior.

## Surfaces (mirror Phase 1 exactly)

- `services/match-play-standings.ts` → `computeMatchPlayStandings(dbOrTx, eventId, tenantId)`
- `GET /api/events/:eventId/match-play-standings` in `routes/money.ts`
  (requireSession + requireEventParticipant, cache-control no-store, 500 guard).
- `events.$eventId.match-play-standings.tsx` (PageShell + BackLink + Loading/
  Error/Empty primitives + ScrollableTable), columns: # / Team / W-H-L / Points
  / Holes (±diff).
- Event-home entry card: ⚔️ "Match Play" → "Foursome match points".

## Risk

LOW — additive read-only board, reuses the audited 2v2 engine via
`computeFoursomeResults`. Touches NO money/pot path. No migration.

## Out of scope (noted follow-ups)

- Configurable point values / Nassau front-back-overall split.
- Round-robin / cross-foursome schedule (explicitly rejected: foursome-internal).
- Per-round match detail drill-down (board is event-cumulative for v1).
