---
title: 'Group Scouting Report (per-foursome stat cards on the leaderboard)'
slug: 'group-scouting-report'
created: '2026-05-30'
status: 'draft'
stepsCompleted: [1]
tech_stack: ['Hono API', 'Drizzle ORM + libsql/SQLite', 'React 19 + TanStack Router/Query', 'Vitest', 'shadcn/ui + Tailwind v4']
files_to_modify:
  - 'apps/api/src/routes/stats.ts (reuse per-hole / per-tee / wolf aggregations; add scouting endpoint)'
  - 'apps/api/src/routes/leaderboard.ts OR a new /scouting/:roundId endpoint'
  - 'apps/web/src/routes/index.tsx (leaderboard — add "Scouting Report" view next to Harvey/Stableford/Money)'
  - 'packages/engine (any new pure derived-stat helpers, tested)'
code_patterns:
  - 'leaderboard already has sort views (Harvey/Stableford/Money) — add a peer view'
  - 'P2.4 stats infra: per-hole (P2.4.7), per-tee (P2.4.5), head-to-head (P2.4.3), narrative gates w/ min sample (P2.4.4)'
  - 'season-scoped via max-year pattern; historical import 2022-2025 (per-round, NOT per-hole)'
test_patterns:
  - 'pure derived-stat functions unit-tested in engine; API integration tests for the endpoint'
---

# Tech-Spec: Group Scouting Report

**Created:** 2026-05-30

## Origin / Motivation

Jeff Madden hand-computed scouting stats for his foursome before a round (e.g. "Josh plays
holes 10 & 17 best"). Idea (Josh): once the week's round + groups exist, auto-generate a
**scouting-report card per group** on the **leaderboard page**, as a fun, trash-talk-friendly
"know your foursome" view. "We should have enough data to make it fun."

## Solution

A **"Scouting Report" view** on the leaderboard, peer to the existing Harvey / Stableford /
Money sorts ("room to the right of that"). Selecting it shows a card per group (**Group 1,
Group 2, Group 3…**) for the current/active round; each card lists each player's scouting
stats. Read-only, public (like the leaderboard).

### Scope: CURRENT SEASON (2026) ONLY — "how they're playing this year"

Decision (Josh, 2026-05-30): the scouting report is a **current-form** view — **2026 data only**,
not multi-year. This simplifies it (no historical import, no per-stat history-depth fallback) and
makes every stat "right now" relevant. Small sample early-season is fine — it's literally current form.

### Per-player scouting stats (menu — all 2026)

| Stat | Source (all 2026) |
|------|-------------------|
| **Handicap trend** ("HI trending ↑/↓ last 3 weeks") | `round_players.handicap_index` snapshot per round — **already stored** (schema:219); diff across the last 3 rounds |
| **Best / worst holes** (vs par) | `hole_scores` + course par |
| **Hole birdie frequency** ("birdied 10 in 3 of 6 rounds") | `hole_scores` vs par per hole, count birdies |
| **Best tee this year** | per-tee stableford differential, 2026 rounds |
| **Boom-or-bust** ("really good or really bad") | 2026 round-score variance / stableford std-dev |
| **Wolf aggression when down** ("goes lone wolf when behind") | `wolf_decisions` lone/blind rate when behind in money that round |
| **Lone-wolf win rate / wolf record** | `wolf_decisions` + `outcome`, 2026 |
| **Hot/cold streak** | last N 2026 rounds Harvey trend |
| **Money swing** (biggest win/loss) | 2026 round money history |

### Foursome-personal callouts (relationships WITHIN the group — Josh, 2026-05-30)

Make each card personal to *that* foursome by surfacing stats *between* its 4 players, not just
per-player stats. Reuses existing infra:
- **Rivalry flag** — an intra-group pair with notable head-to-head this year ("Josh leads Matt
  3–1 in money H2H"). Reuses the head-to-head / **Nemesis** stat (P2.4.3; see
  [[project_stats_consistency_pass]] for the Vs-Win / Vs-$ shape). Pick the spiciest pair in the group.
- **Lucky charm** — an intra-group pair that plays *well together* ("Matt + Josh: 4–0–1 when
  partnered"). Reuses chemistry / best-2v2 partnership (see [[feedback_pushes_dont_penalize]] for
  the win-rate convention). Surfaces the duo whose partnership/chemistry is strongest among the 4.
- Both are framed as a fun banner on the group card (🤝 lucky charm, ⚔️ rivalry); gate on a min
  sample so a 1-round fluke doesn't get flagged.

### Card layout (per group) — match existing systems (Josh)

- **Visual: match the other systems** — same design tokens / shadcn components as the leaderboard,
  no bespoke styling.
- **Pattern: mirror the scorecard breakout** — the leaderboard's per-player drill-down (story 7-5,
  `player-scorecard-leaderboard-drilldown`): a compact group card with **expandable per-player rows**;
  tap a player to expand their 2–3 headline scouting stats (chosen by an "interestingness" ranker —
  most extreme stat clearing its sample gate, mirroring the P2.4.4 narrative pattern). Examples:
  - "🎯 Best holes: 10, 17 (−1.4 avg)"  ·  "🔵 Blue-tee killer: +3.1 vs avg"
  - "🐺 Lone wolf when behind (7 of 9 down-money rounds)"  ·  "🎢 Boom-or-bust"  ·  "📈 HI trending down 3 wks"
- **Group header** carries the foursome-personal banner(s) (rivalry / lucky charm) so the "personal"
  hook is visible before expanding anyone.
- **UI review** before/with build (Josh): run the layout past him (or a UX pass) — it's a new
  surface, so confirm the breakout interaction + density on mobile before finalizing.

## Data Availability — all present for 2026

- **Handicap trend:** `round_players.handicap_index` snapshots HI per round per player
  (`schema.ts:219`, `notNull`) — so the weekly index IS stored; the 3-week trend is just a diff
  across the player's last 3 rounds. **No new storage needed** (Josh asked — confirmed already there).
- **Per-hole stats** (best/worst holes, birdie frequency): from `hole_scores` + course par, 2026.
- **Wolf tendencies:** `wolf_decisions` (+ `outcome`), 2026.
- **Sample is small early-season** (~5-6 rounds) by design — it's *current form*, so a small N is
  the point, not a defect. Show "Based on N rounds" for honesty; optionally hide a stat under ~2-3
  rounds to avoid noise, but no historical fallback is needed (single-season scope).

## Implementation Plan (Tasks)

- [ ] **Task 1 — Scouting stat helpers (engine, pure + tested).** Per-player derived stats from
  pre-aggregated inputs: best/worst holes, per-tee differential, score variance, wolf-when-behind
  rate, streaks. Each returns value + sample size; each has a min-sample gate.
- [ ] **Task 2 — Scouting endpoint.** `GET /scouting/:roundId` (or fold into leaderboard):
  resolve the round's groups + players, run the helpers over season-scoped history (respect the
  max-year / season-picker pattern), return per-group → per-player → ranked headline stats.
- [ ] **Task 3 — Leaderboard "Scouting Report" view.** Add the view toggle next to
  Harvey/Stableford/Money; render group cards; mobile-first, screenshot-friendly (NFR31-style).
- [ ] **Task 4 — Interestingness ranker.** Pure fn picks each player's top 2-3 stats by extremity
  among those clearing their sample gate (mirror P2.4.4). Tested.
- [ ] **Task 5 — Tests + a "thin data" pass.** Verify gates hide unsupported stats early-season
  and the card still renders something fun from deep-history stats.

## Acceptance Criteria

- **AC1** Given a round with groups assigned, when a user opens the Scouting Report view, then a
  card per group shows each player's top scouting stats.
- **AC2** Given a player with <gate rounds of per-hole/wolf data, when the card renders, then
  unsupported stats are hidden and deeper-history stats are shown instead (no "0 holes" noise).
- **AC3** Given the season picker / round-type context, when stats compute, then they respect it
  (mirrors existing stats filters).
- **AC4** Given mobile, when the card renders, then it's screenshot-friendly and readable in one
  viewport per group.

## Open Questions
- **Reuse vs new endpoints:** much of this exists piecemeal in stats.ts (per-tee, per-hole,
  head-to-head). Decide: a dedicated `/scouting` aggregator vs. composing existing endpoints
  client-side. Recommend a server aggregator for one round-trip + mobile perf.
- **How much to show before it's "enough data to be fun":** tune the per-stat min-sample gates
  with Josh once it's wired (start conservative; loosen as 2026 fills in).
- **Privacy/tone:** it's a closed league and meant to be fun/trash-talk — confirm no stat feels
  mean-spirited (e.g. "worst holes" framing). Keep it playful.

## Notes
- Heavy reuse of Phase-2 Epic P2.4 stats work (per-hole P2.4.7, per-tee P2.4.5, head-to-head
  P2.4.3, narrative gates P2.4.4) — this is largely a **new presentation** (per-group cards on
  the leaderboard) over existing/near-existing aggregations, plus the wolf-when-behind stat.
