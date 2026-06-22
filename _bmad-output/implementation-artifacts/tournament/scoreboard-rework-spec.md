# Tournament Scoreboard Rework — Design Spec (for the director)

**Status:** ready-for-stories · **Author handoff:** 2026-06-22 · **Real-world fixture:** Pete Dye Invitational (member-guest, Jun 26–27 2026)

## Goal

Replace the Tournament app's plain leaderboard/foursome views with the **Wolf Cup–style
scoreboard** the group already loves, split into TWO distinct views:

1. **During-the-round scoreboard** — the live, in-round view: a sortable leaderboard where
   tapping a player unfolds their **hole-by-hole scorecard** (front-9 + back-9) with golf
   notation, handicap-stroke dots, greenie/polie/sandie dots, per-hole net, and per-hole $.
2. **Weekend overall standings** — the cross-round trip aggregate, **sortable** by Total Money,
   Net-to-Par, and Individual (and team).

> The reference implementation ALREADY EXISTS in the Wolf Cup app (`apps/web`). This is a
> **port + adapt**, not a from-scratch design. Do not reinvent the notation or the grid.

### Monorepo guardrail (FD-1/FD-2)
`apps/web` + `apps/api` are **Wolf Cup** — READ-ONLY reference here, never edit them for this
work. All changes land in **`apps/tournament-web`** + **`apps/tournament-api`**. Port the look;
feed it Tournament's data.

---

## Reference implementation (Wolf Cup — read, copy the pattern)

- **`apps/web/src/routes/index.tsx`**
  - `HoleBadge` (L145–208): the compact golf-notation badge. **Copy this near-verbatim** into
    `apps/tournament-web`. Logic, keyed on `d = gross - par`:
    - `d <= -2` eagle+ → filled red circle
    - `d === -1` birdie → red circle outline
    - `d === 0` par → plain number
    - `d === 1` bogey → amber square outline
    - `d >= 2` double+ → blue nested (double) square
    - **bonus dots** (bottom-center): greenie = emerald, polie = amber, sandie = orange
    - **stroke dots** (top-right): `relativeStrokes` → 1 dot, `>=2` → 2 dots
  - `ScorecardPanel` (L214+): fetches `GET /rounds/:roundId/players/:playerId/scorecard`, renders
    front-9 + back-9 grids with rows **Hole / Par / Score / Wolf / Net / Stab / $** and
    Out/In/Tot totals. The circled hole-number markers in the header are at ~L287–291 — replicate
    that condition from the Wolf source.
  - `ScorecardHole` type (L80–91): `par, grossScore, netScore, stablefordPoints, moneyNet,
    wolfRole, hasGreenie, hasPolie, hasSandie, relativeStrokes`.

### Pete Dye adaptations (what to DROP / KEEP vs Wolf)
- **DROP** the `Stab` (Stableford), `Hvy Pts` (Harvey), and `Wolf` rows/columns — Pete Dye
  doesn't use those games.
- **KEEP** rows: **Hole / Par / Score (HoleBadge) / Net / $**, with Out/In/Tot.
- Money model is **F1 Guyan** ($5/point, whole-dollar, 1-to-1 settle — see `games-money.ts`,
  `__fixtures__/guyan-2v2-base-flat.json`). Per-hole `$` is **F1 per-hole money** (see API work).

---

## View 1 — During-round scoreboard

**Route:** rework `apps/tournament-web/src/routes/events.$eventId.leaderboard.tsx` (or a new
in-round variant) to the Wolf board look. Dark-themed, phone-first.

**Leaderboard rows (sortable):** `# | Player (HCP · thru) | To Par | $`. (No Stb / Hvy Pts.)
Tapping a row expands the per-player `ScorecardPanel`.

**ScorecardPanel rows (per player):** Hole / Par / **Score (HoleBadge)** / Net / **$** ·
front-9 (Out) + back-9 (In) + Tot.

**Showcase player for the brochure:** Steven Chatterton (real attendee) — capture his expanded
card, like the Wolf screenshot. Keep the Cuban/Johnny Hotdog easter egg on the Long Drive page
only.

### API — NEW scorecard endpoint
`GET /api/rounds/:roundId/players/:playerId/scorecard` → `{ holes: ScorecardHole[] }` where each
hole carries:
- `par`, `grossScore`, `netScore` — from `holeScores` + pinned CH (net = gross − relativeStrokes).
- `relativeStrokes` — handicap strokes the player receives on that hole, from the **pinned**
  course handicap + hole stroke index (`allocateStrokesFromCourseHandicap` / `getHandicapStrokes`
  in the engine; the pin is `round_pins.perPlayerHandicapsJson`). Show on unplayed cells too.
- `hasGreenie / hasPolie / hasSandie` — fold the **`hole_claim_writes`** append-only log (F1
  Epic 2; `claim-write.ts`, schema `hole-claim-writes.ts`) to current claim state per
  (player, hole, claimType): latest `op` (`set`/`remove`) wins.
- `moneyNet` — the player's **per-hole** F1 money. **This is the Epic-4 dependency** (the F1
  engine currently surfaces a per-foursome settlement total, not a per-hole breakdown — see
  `computeF1FoursomeResults` in `money-detail.ts`, which zeroes per-hole money today). This story
  must add per-hole F1 money OR explicitly defer the `$` row with a flag. **Flag the choice; do
  not silently show $0.**

---

## View 2 — Weekend overall standings (sortable)

**Route:** a unified `events.$eventId.standings` (or rework existing). Today three separate
routes exist — consolidate / cross-link, don't duplicate:
- `events.$eventId.team-standings.tsx` → cumulative 2-man best-ball **net-to-par** (`computeTeamStandings`).
- `events.$eventId.match-play-standings.tsx` → ⚔️ match-play points (`computeMatchPlayStandings`).
- F1 money totals → `games-money.ts` `computeF1PerPlayerNet` / event edges.

**Sortable like Wolf** — a sort control (mirror the Wolf board's sortable `Hvy Pts ▾` column at
`apps/web/src/routes/index.tsx`) toggling the primary sort across:
- **Total Money** — Σ $ across all games (Guyan 2v2 + the $50 pot + any side action).
- **Net-to-Par** — cumulative 2-man best-ball net-to-par (the $50/man winner-take-all pot).
- **Individual** — rank individual players (not 2-man teams) for the weekend.

Default sort: Net-to-Par (the pot). Individual ↔ team is a unit toggle.

---

## Acceptance criteria

1. `HoleBadge` ported to `apps/tournament-web`; renders eagle/birdie/par/bogey/double notation,
   greenie/polie/sandie bonus dots, and 1–2 handicap-stroke dots, matching the Wolf visual.
2. Tapping a leaderboard row expands the per-player scorecard (front-9 + back-9, Out/In/Tot) with
   Hole / Par / Score / Net / $ rows; no Stab / Harvey / Wolf rows.
3. New `GET /rounds/:roundId/players/:playerId/scorecard` returns per-hole par, gross, net,
   relativeStrokes, greenie/polie/sandie flags, and moneyNet (or a documented deferral of $).
4. greenie/polie/sandie reflect the folded `hole_claim_writes` state; stroke dots reflect pinned
   CH × stroke index; both appear on unplayed cells where applicable.
5. Weekend standings page sorts by Total Money / Net-to-Par / Individual, with an individual↔team
   unit toggle; numbers reconcile with `computeTeamStandings`, match-play, and F1 money.
6. Whole-dollar money everywhere (no half-dollar legs) — F1 settlement, not legacy cents.
7. Tests: HoleBadge notation unit tests; scorecard endpoint integration tests (incl. claims fold +
   stroke allocation + unplayed cells); standings sort/reconciliation tests.

## Dependencies / risks
- **Per-hole F1 money (Epic 4)** is the critical path for the `$` row — size it explicitly; if
  deferred, the scorecard ships without `$` behind a flag rather than faking it.
- Claims surfacing reads `hole_claim_writes` (greenie 2.2 / polie 2.3 / sandie 2.4 modifiers exist;
  confirm the consume/claim read path).

## Suggested story split
- **S1** Port `HoleBadge` + scorecard grid shell to tournament-web (static/fixture data).
- **S2** Scorecard API: gross/net/relativeStrokes + claims fold (no $ yet).
- **S3** Per-hole F1 money → wire the `$` row (or formal deferral).
- **S4** During-round leaderboard rework (sortable rows + expand).
- **S5** Weekend standings: sortable Total Money / Net-to-Par / Individual unification.

## Brochure follow-up
Once S1–S4 land, re-capture the Pete Dye brochure shots (Steve as the showcased card) per
`reference/SCREENSHOTS.md`, then `node reference/swap-and-render.mjs`.
