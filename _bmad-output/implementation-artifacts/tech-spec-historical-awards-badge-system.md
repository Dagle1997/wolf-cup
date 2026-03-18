---
title: 'Historical Awards & Badge System'
slug: 'historical-awards-badge-system'
created: '2026-03-18'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['React 19', 'TanStack Router', 'TanStack Query', 'Hono', 'Drizzle ORM', 'SQLite', 'Tailwind CSS v4', 'shadcn/ui']
files_to_modify: ['apps/api/src/db/history-data.ts', 'apps/api/src/lib/badges.ts (NEW)', 'apps/api/src/lib/badges.test.ts (NEW)', 'apps/api/src/routes/history.ts', 'apps/api/src/routes/stats.ts', 'apps/web/src/routes/stats.tsx', 'apps/web/src/routes/standings_.history.tsx']
code_patterns: ['conditional badge render: {condition && <span className="text-xs font-bold text-color">emoji text</span>}', 'API badge computation: Map<playerId, value> from grouped query, spread into response', 'horizontal scroll gallery: overflow-x-auto -mx-4 px-4 with flex gap-3', 'card pattern: rounded-xl border bg-card shadow-sm overflow-hidden']
test_patterns: ['Vitest for unit tests', 'API integration tests use supertest pattern with in-memory SQLite']
---

# Tech-Spec: Historical Awards & Badge System

**Created:** 2026-03-18

## Overview

### Problem Statement

The Wolf Cup app has 11 years of historical data (2015–2025) but only displays championship trophy count badges. Rich data — top-4 finishes, full season rosters, cash +/- totals — sits unused. The group wants fun, personality-driven awards that fuel trash talk and get pulled up during rounds on mobile.

### Solution

Two-layer badge system across two pages:

1. **Stats page (current season)** — inline badges for active players: repeated `🏆` per win (no multiplier), gold left border for defending champion, badge pills for career awards.
2. **History page — Awards Wall (all-time)** — dedicated section below Champions Gallery. All players (active or not) with all earned badges. Preston gets a special Dynasty card with overlapping trophies + label. Split into "Hall of Fame" and "Superlatives" rows.

Badges computed at API response time from historical standings data in `history-data.ts` plus cash +/- data extracted from Jason Moses' Excel files. Also backfill full roster standings for all historical years.

### Scope

**In Scope:**

*Stats Page (current season, active players):*
1. Repeated `🏆` per championship win with 2-digit year labels underneath each emoji — replaces current `N×🏆` format. Examples: Preston (4 wins) → `🏆🏆🏆🏆` with `17 18 20 22`; Jaquint (2 wins) → `🏆🏆` with `15 25`
2. Gold left border (`border-l-amber-400`) on defending champion's card (Jaquint for 2026)
3. ALL badge emojis with year labels for active players — OG, Every Season, Ironman, Money Man, Philanthropist, Rickie Fowler, pH Balance. Emojis + years only, no subtitle text.
4. Badge area uses `flex-wrap` so badges flow to second line on narrow screens
5. Tapping any badge navigates to the Awards Wall explanation for that badge (anchor link)
6. Navigation link/banner to Awards Wall on history page

*History Page — Awards Wall (all-time, all players):*
7. **Hall of Fame row** (horizontal scroll cards):
   - `🏆 Dynasty` — label for players with 4+ championship wins (currently Preston only: `🏆🏆🏆🏆` with years `17 18 20 22`). Back-to-back is visible from adjacent year labels — no special overlapping treatment needed. Year labels tell the story.
   - `🎖️ Every Season` — played all 11 seasons (5 players)
   - `🍺 OG — Est. 2015` — played in inaugural 2015 season AND still active on 2025 roster (6 players: Moses, Matt Jaquint, Chris McNeely, Chris Keaton, Josh Stoll, Matt White). Players who left the league (Goff, Thacker, Brian White, etc.) do NOT get the badge.
   - `💪 Ironman` — zero missed regular season rounds in a given year. Confirmed: Jay Patterson 2020 (18/18). Josh will verify additional recipients from Excel files.
8. **Superlatives row** (horizontal scroll cards):
   - `🥈 Rickie Fowler` — player with the MOST 2nd-place finishes who has never won a title. Ties = both get it. Currently: Jay Patterson (2x runner-up: 2019, 2025; 0 titles).
   - `⚖️ pH Balance` — multiple 3rd-place finishes (2+)
   - `💰 Money Man` — biggest cash +/- earner per season. Repeated emoji per year won (e.g., `💰💰` = 2x Money Man). Currently: Matt Jaquint 2023, 2024; Jay Patterson 2025.
   - `💸 Philanthropist` — worst cash +/- per season. Repeated emoji per year won (e.g., `💸💸💸` = 3x Philanthropist). Currently: Chris Keaton 2023, 2024, 2025 (three-peat).
9. Awards with zero qualifiers are not rendered (skip empty cards)
10. Each award card includes a `description` explaining what the badge means and how to earn it
11. Badge anchors: each award card has an `id` anchor so stats page badge taps can deep-link directly (e.g., `/standings/history#badge-money-man`)

*Deferred (future):*
- Full roster standings backfill for all historical years — not needed for badges but wanted eventually for richer history page
- Live computation of Money Man/Philanthropist from `roundResults` table (2026+ seasons)
- Live computation of Ironman from round participation vs roster (requires cross-referencing roster membership against `roundResults` to detect "was on roster but didn't play" — needs roster-per-round tracking that doesn't exist yet)

**Out of Scope:**
- Sandbagger detection (separate feature)
- Side game winners / weekly challenge data
- Cross-era statistical averages (point scales too different pre-2022 vs post-2022)
- Tooltip/mouseover interactions (mobile-first app; pills are self-explanatory)
- Champion photos (already handled separately)

## Context for Development

### Codebase Patterns

- **Badge rendering** (stats.tsx ~line 188): `{p.championshipWins && (<span className="text-xs font-bold text-amber-600">{p.championshipWins}×🏆</span>)}` — conditional on field presence, emoji + text in styled span
- **Badge computation** (stats.ts ~line 75): SQL query → `Map<playerId, value>` → spread into response object: `...(champMap.has(p.id) ? { championshipWins: champMap.get(p.id)! } : {})`
- **Horizontal scroll gallery** (standings_.history.tsx ~line 144): `overflow-x-auto -mx-4 px-4` container with `flex gap-3` for champion cards
- **Champion card** (standings_.history.tsx ~line 171): `ChampionCard({ name, wins, years })` — photo/initials fallback, win count in amber-600, years list
- **Card pattern**: `rounded-xl border bg-card shadow-sm overflow-hidden`
- **Section heading**: `text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3`
- **Gold border precedent** (standings.tsx): `border-l-2 border-l-amber-400` for rank 1
- **Player card layout** (stats.tsx ~line 185): `flex items-center gap-2.5` — badges render horizontally inline with name
- **Stats page types**: `PlayerStats` type defined in both stats.tsx (line 12) and stats.ts (line 13) — must stay in sync
- **History response**: `c.json({ seasons, championshipCounts })` — extend with `awards` field
- **Data seeding** (seed.ts ~line 81): `ensurePlayer(name, isActive)` helper, upsert pattern for standings

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `apps/api/src/db/history-data.ts` | Historical champions + standings seed data |
| `apps/api/src/db/schema.ts` | Database tables (seasons, seasonStandings, players) |
| `apps/api/src/routes/history.ts` | GET /history public endpoint |
| `apps/api/src/routes/stats.ts` | GET /stats public endpoint |
| `apps/api/src/routes/admin/history.ts` | Admin history management endpoints |
| `apps/web/src/routes/standings_.history.tsx` | Champions & History page (279 lines) |
| `apps/web/src/routes/stats.tsx` | Player Statistics page |
| `apps/web/src/routes/standings.tsx` | Current Season Standings (rank badges, medal system) |
| `reference/Wolf Cup Top 4 2015-2025.xlsx` | Jason's top-4 playoff data (all years) |
| `reference/*.xlsx` / `reference/*.xlsm` | Full season sheets per year (rosters, cash, rounds) |

### Technical Decisions

- **Badge format**: Emoji pill/chip labels with built-in text (no tooltips needed on mobile)
- **Two-layer display**: Stats page shows badges for current season active players only. History page Awards Wall shows all-time badges for ALL players (active or not). This ensures Preston's legacy is visible even if he doesn't play.
- **Championship rendering change**: Replace `N×🏆` with repeated trophy emojis, each with a 2-digit year label underneath (e.g., `🏆` over `15`, `🏆` over `25` for Jaquint). Consistent pattern across all badge types.
- **Defending champion**: Gold left border on stats page card for the player who won the most recent completed season. Currently Jaquint (2025 champion).
- **Dynasty badge**: "Dynasty" label on Awards Wall for any player with 4+ championship wins. Currently only Preston qualifies (4 wins: 2017, 2018, 2020, 2022). NO special overlapping trophy treatment — the year labels underneath already show back-to-back (17, 18 adjacent). Same rendering as all other badges. If a future player reaches 4+ wins, they automatically get Dynasty too.
- **Money Man / Philanthropist are per-season awards**: One winner per year, repeated emoji per year won (like championship trophies). Jaquint gets `💰💰` (2023, 2024). Keaton gets `💸💸💸` (2023, 2024, 2025 — three-peat). Patterson gets `💰` (2025). Awards only tracked from 2023+ (point scales too different in earlier eras).
- **Ironman = per-season badge**: Never missed a regular season round in a given season. Not career-spanning.
- **Every Season = career badge**: Must have appeared in roster for all 11 seasons (2015–2025). Currently 5 players qualify: Chris Keaton, Chris McNeely, Josh Stoll, Matt White, Moses.
- **OG badge**: Must be on BOTH the 2015 roster AND the 2025 roster (still active in the league). 6 players qualify: Moses, Matt Jaquint, Chris McNeely, Chris Keaton, Josh Stoll, Matt White. Players who left the league don't get the badge even if they return.
- **Awards Wall structure**: Two rows — "Hall of Fame" (Dynasty, Every Season, OG, Ironman) and "Superlatives" (Rickie Fowler, pH Balance, Money Man, Philanthropist). Horizontal scroll cards like Champions Gallery.
- **No new database tables**: No schema migrations needed.
- **Hybrid data architecture**: Historical badge data (≤2025) hardcoded in `history-data.ts` arrays, read DIRECTLY by API (no seeding to DB). Championship data for new seasons (2026+) automatically picks up from existing DB (`seasons.championPlayerId`). For v1, Money Man/Philanthropist/Ironman only use hardcoded historical data. Live computation for these from `roundResults`/round participation is a future enhancement — the `computeAllAwards` function should accept an optional `liveSeasonData` param but v1 passes nothing, relying solely on hardcoded arrays. When live computation is added later, define: `type LiveSeasonData = { year: number; cashTotals: { playerId: number; name: string; cash: number }[]; roundsPlayed: { playerId: number; name: string; rounds: number }[]; maxRounds: number }[]`.
- **Roster data as simple sets**: `HISTORICAL_ROSTERS: Record<number, string[]>` — just player names per year, not full standings. Only needed for OG/Every Season detection. Hardcoded, not seeded.
- **Cash data per season**: `HISTORICAL_CASH` stores winners only (not all players). Type and data defined in Task 1. Hardcoded, not seeded. Note: type uses single winner per role per year. If a future year has a tie, change `moneyMan`/`philanthropist` to arrays. No ties exist in 2023-2025 data.
- **Ironman data**: `HISTORICAL_IRONMAN: { year: number; maxRounds: number; perfectAttendance: string[] }[]` — Hardcoded, not seeded. Confirmed: `{ year: 2020, maxRounds: 18, perfectAttendance: ['Jay Patterson'] }`. Josh may add more entries after verifying Excel files. The `maxRounds` value per year can be determined from the Excel Printable sheet headers (WEEK column shows round numbers). Ships with limited data — Ironman card only shows confirmed recipients. If zero recipients for a given year, that year is simply not listed.
- **Rickie Fowler selection**: Player with the MOST rank-2 finishes who has NEVER won a championship. Ties = all get the badge. Currently Jay Patterson (2x runner-up: 2019, 2025; 0 titles). Note: Patterson was rank 4 in 2020, NOT rank 2. Sean Wilson was 2nd in 2020..
- **Dynasty = 4+ championship wins**: Simple threshold, not consecutive-detection. Currently only Preston qualifies. Year labels under trophies already make back-to-back visible (17, 18 are adjacent). No overlapping trophy CSS needed. If Jaquint or anyone else reaches 4+ wins, they automatically get the Dynasty label.
- **Awards Wall layout**: Two horizontal scroll rows of 4 cards each — "Hall of Fame" row and "Superlatives" row. Same scroll pattern as Champions Gallery.
- **Stats page badges confirmed**: ALL badges shown for active players — emojis with 2-digit year labels, no subtitle text. `flex-wrap` on badge container for narrow screens. Tapping a badge navigates to that badge's explanation on the Awards Wall.
- **Awards Wall explanations**: Each award card includes a brief description of what the badge means and how to earn it. Cards have `id` anchors for deep-linking from stats page.
- **Year labels on all emojis**: Every badge emoji (🏆, 💰, 💸, 💪, etc.) gets a tiny 2-digit year underneath. Implemented as `inline-flex flex-col items-center` with `text-[8px]` year. Consistent pattern across all badge types on both pages.
- **Keaton 2024 cash data**: -$143 is correct. The $0 row in the Excel is a duplicate to ignore.

## Implementation Plan

### Tasks

#### Task 1: Extract and hardcode historical badge data
- File: `apps/api/src/db/history-data.ts`
- Action: Add three new exported arrays:
  1. `HISTORICAL_ROSTERS: Record<number, string[]>` — player names per year (2015–2025). Complete data:
     ```typescript
     export const HISTORICAL_ROSTERS: Record<number, string[]> = {
       2015: ['Moses', 'Brian White', 'Matt Jaquint', 'Chris Preston', 'Matt White', 'Chris McNeely', 'Nick Goff', 'Chris Keaton', 'Josh Stoll', 'Allan Thacker', 'A. Dawson', 'David Sheils', 'Jack Taylor', 'Chris Michael', 'Sid Torlone'],
       2016: ['Moses', 'Matt Jaquint', 'Brian White', 'Matt White', 'Sid Torlone', 'Chris Preston', 'Jeff Madden', 'Chris McNeely', 'John Short', 'Scott Crouch', 'Tim Eves', 'Chris Keaton', 'Jay Patterson', 'Josh Stoll', 'A. Dawson'],
       2017: ['Sid Torlone', 'Jeff Madden', 'Matt White', 'Matt Jaquint', 'A. Dawson', 'Jay Patterson', 'Moses', 'Chris Preston', 'Josh Stoll', 'Chris Keaton', 'Tim Eves', 'Ronnie A.', 'Chris McNeely', 'John Short'],
       2018: ['Josh Stoll', 'Jeff Madden', 'Matt Jaquint', 'Chris Preston', 'Jay Patterson', 'Ronnie A.', 'Moses', 'Chris Keaton', 'Sean Wilson', 'Chris McNeely', 'Matt White', 'A. Dawson', 'Tim Eves'],
       2019: ['Chris McNeely', 'Moses', 'Josh Stoll', 'Jeff Madden', 'Chris Preston', 'Jay Patterson', 'Sean Wilson', 'Tim Eves', 'Chris Keaton', 'Matt White', 'A. Dawson', 'Ronnie A.'],
       2020: ['Ronnie A.', 'A. Dawson', 'Chris Preston', 'Jeff Madden', 'Josh Stoll', 'Jay Patterson', 'Sean Wilson', 'Kyle Cox', 'Moses', 'Chris McNeely', 'Chris Keaton', 'Matt White'],
       2021: ['Moses', 'Jeff Madden', 'Chris Preston', 'Chris McNeely', 'Jay Patterson', 'Ronnie A.', 'Sean Wilson', 'Kyle Cox', 'Mike Bonner', 'Josh Stoll', 'A. Dawson', 'Nathan Copley', 'Jeff Biederman', 'Alan Beasley', 'Matt White', 'Chris Keaton'],
       2022: ['Jeff Madden', 'Ben McGinnis', 'Chris McNeely', 'Kyle Cox', 'Nathan Copley', 'Chris Preston', 'Scotty Pierson', 'Matt White', 'A. Dawson', 'Jeff Biederman', 'Jay Patterson', 'Mike Bonner', 'Josh Stoll', 'Ronnie A.', 'Sean Wilson', 'Chris Keaton', 'Moses', 'Matt Jaquint', 'Alan Beasley'],
       2023: ['Ronnie A.', 'Nathan Copley', 'Chris Preston', 'Chris McNeely', 'Matt Jaquint', 'Josh Stoll', 'Moses', 'Scotty Pierson', 'Ben McGinnis', 'Jeff Biederman', 'Mike Bonner', 'Jeff Madden', 'A. Dawson', 'Kyle Cox', 'Matt White', 'Sean Wilson', 'Chris Keaton', 'Jay Patterson', 'Alan Beasley'],
       2024: ['Ronnie A.', 'Tim Biller', 'Matt Jaquint', 'Scotty Pierson', 'Ben McGinnis', 'Jay Patterson', 'Moses', 'Mike Bonner', 'Jeff Madden', 'Chris McNeely', 'Josh Stoll', 'A. Dawson', 'Jeff Biederman', 'Kyle Cox', 'Sean Wilson', 'Matt White', 'Chris Preston', 'Chris Keaton'],
       2025: ['Matt Jaquint', 'Jay Patterson', 'Matt White', 'Moses', 'Scotty Pierson', 'Josh Stoll', 'Chris McNeely', 'Mike Bonner', 'Ronnie A.', 'Tim Biller', 'Jeff Madden', 'Ben McGinnis', 'Kyle Cox', 'Jeff Biederman', 'Chris Keaton', 'Bobby Marshall', 'Sean Wilson'],
     };
     // OG badge requires: in 2015 roster AND in 2025 roster (still active).
     // Qualifiers (6 players): Moses, Matt Jaquint, Chris McNeely, Chris Keaton, Josh Stoll, Matt White
     // Excluded: Chris Preston (not on 2025 roster), Nick Goff, Allan Thacker, Brian White, David Sheils, Jack Taylor, Chris Michael, Sid Torlone, A. Dawson (all left the league)
     // Every Season (all 11 years): Chris Keaton, Chris McNeely, Josh Stoll, Matt White, Moses
     ```
  2. `HISTORICAL_CASH` — per-season Money Man and Philanthropist winners (already extracted and verified from Excel):
     ```typescript
     export const HISTORICAL_CASH: { year: number; moneyMan: { name: string; cash: number }; philanthropist: { name: string; cash: number } }[] = [
       { year: 2023, moneyMan: { name: 'Matt Jaquint', cash: 124 }, philanthropist: { name: 'Chris Keaton', cash: -228 } },
       { year: 2024, moneyMan: { name: 'Matt Jaquint', cash: 108 }, philanthropist: { name: 'Chris Keaton', cash: -143 } },
       { year: 2025, moneyMan: { name: 'Jay Patterson', cash: 159 }, philanthropist: { name: 'Chris Keaton', cash: -127 } },
     ];
     ```
  3. `HISTORICAL_IRONMAN: { year: number; maxRounds: number; perfectAttendance: string[] }[]` — years where players played every round. Confirmed: `{ year: 2020, maxRounds: 18, perfectAttendance: ['Jay Patterson'] }`. Josh to verify others.
- Notes: Extract cash data from `reference/Wolf Cup 2023.xlsm` (Auto - Printable), `reference/Wolf Cup 2024(1).xlsm` (Auto - Printable), `reference/Wolf Cup 2025 Final Season Ended.xlsm` (Standings). Use openpyxl script or manual extraction.

#### Task 2: Create badge computation module
- File: `apps/api/src/lib/badges.ts` (NEW)
- Action: Create pure functions that compute all badges from data:
  ```
  computeDynasty(champions[]) → { playerName, years[] }[]           // players with 4+ wins
  computeRickieFowler(standings[], champions[]) → { playerName, runnerUpCount, years[] }[]
  computePhBalance(standings[]) → { playerName, thirdPlaceCount, years[] }[]
  computeMoneyMan(cashData[]) → { playerName, count, years[] }[]    // per-season winners, grouped
  computePhilanthropist(cashData[]) → { playerName, count, years[] }[]
  computeOG(rosters) → string[]                                     // 2015 ∩ 2025 roster
  computeEverySeason(rosters) → string[]                            // in ALL year rosters
  computeIronman(ironmanData[]) → { playerName, year, rounds }[]
  computeAllAwards(historicalData) → Award[]                        // returns Award[] (type from Task 3)
  ```
- Notes: Each function takes the hardcoded arrays as input. Dynasty = simple threshold (4+ championship wins), not consecutive detection. OG = intersection of 2015 and 2025 rosters (must still be active). Rickie Fowler: find max rank-2 count among players with zero championships; ties = all qualify. `computeAllAwards` returns the full `Award[]` array ready for the API response. Live season data (2026+) is a future enhancement — v1 uses only hardcoded historical arrays.

#### Task 3: Add awards to GET /history response
- File: `apps/api/src/routes/history.ts`
- Action:
  1. Import badge computation functions and historical data arrays
  2. After existing championship count computation, call `computeAllAwards()`
  3. Structure awards into two categories: `hallOfFame` and `superlatives`
  4. Add `awards` field to response: `c.json({ seasons, championshipCounts, awards })`
- Notes: Award response shape:
  ```typescript
  type AwardRecipient = {
    playerName: string;
    years: number[];      // [2023, 2024] for per-season awards, [2015] for OG, [2020] for Ironman
    detail: string;       // "2× Runner-Up, 0 Titles" or "+$124, +$108"
  };

  type Award = {
    id: string;           // 'dynasty', 'rickie_fowler', 'ph_balance', etc.
    emoji: string;        // '🏆', '🥈', '⚖️', etc.
    name: string;         // 'Dynasty', 'Rickie Fowler', etc.
    category: 'hall_of_fame' | 'superlatives';
    description: string;  // "Awarded to the biggest money winner each season"
    recipients: AwardRecipient[];
  }
  ```
  Awards with empty `recipients` array are omitted from response. The `years` array on each recipient drives the rendering: frontend repeats the emoji once per year with a 2-digit year label underneath. The `description` field provides the "how to earn it" explanation text shown on the Awards Wall card.

#### Task 4: Add badge fields to GET /stats response
- File: `apps/api/src/routes/stats.ts`
- Action:
  1. Import historical data arrays and badge functions
  2. After existing championship computation (~line 84), compute per-player badges:
     - `isDefendingChampion: boolean` — player who won the most recent completed season
     - `championshipYears: number[]` — years of championship wins (for year labels under trophies)
     - `badges: PlayerBadge[]` — structured badge list with years
  3. Extend `PlayerStats` type with new fields
  4. Spread badge fields into response objects
- Notes: Must update type in BOTH `stats.ts` (API) and `stats.tsx` (frontend) to stay in sync. Badge type:
  ```typescript
  type PlayerBadge = {
    id: string;       // 'og', 'every_season', 'ironman', 'money_man', 'philanthropist', 'rickie_fowler', 'ph_balance'
    emoji: string;    // '🍺', '🎖️', '💪', '💰', '💸', '🥈', '⚖️'
    name: string;     // 'OG', 'Every Season', etc.
    years: number[];  // [2015] for OG, [2023,2024] for Money Man, etc.
  };
  ```
  Championship wins are NOT in `badges[]` — they use the existing `championshipWins` field plus new `championshipYears` for year labels. This keeps backward compatibility.

#### Task 5: Update stats page — championship rendering + defending champ
- File: `apps/web/src/routes/stats.tsx`
- Action:
  1. Update `PlayerStats` type to include `isDefendingChampion?: boolean`, `championshipYears?: number[]`, `badges?: PlayerBadge[]` (see Task 4 for `PlayerBadge` type)
  2. Change championship badge rendering from `{p.championshipWins}×🏆` to `{'🏆'.repeat(p.championshipWins)}` — repeated trophies, no multiplier
  3. Add gold left border to defending champion's card: `border-l-2 border-l-amber-400` conditionally when `p.isDefendingChampion`
  4. Add ALL badge emojis with year labels after championship trophies. Each badge is an `inline-flex flex-col items-center` with emoji on top and `text-[8px] text-muted-foreground` year underneath. Badges include: OG (`🍺`), Every Season (`🎖️`), Ironman (`💪`), Money Man (`💰`), Philanthropist (`💸`), Rickie Fowler (`🥈`), pH Balance (`⚖️`).
  5. Add `flex-wrap` to the badge container (`flex items-center gap-2.5`) so badges flow to a second line on narrow screens
  6. Make each badge a `Link` to `/standings/history#badge-{id}` so tapping navigates to that badge's explanation on the Awards Wall
- Notes: Championship trophies also get year labels (e.g., `🏆` over `15`). Year labels use 2-digit format. Stats page shows emojis + years only, no subtitle/explanation text.

#### Task 6: Add Awards Wall to history page
- File: `apps/web/src/routes/standings_.history.tsx`
- Action:
  1. Extend `HistoryResponse` type to include `awards: Award[]`
  2. Add "Awards" section between Champions Gallery and Season History
  3. Create `AwardCard` component — renders emoji (large), award name, recipient(s) with detail text
  4. Dynasty card: rendered same as other cards — repeated `🏆` emojis with year labels. No special overlapping treatment. "Dynasty" label is the award name.
  5. Two labeled subsections: "Hall of Fame" and "Superlatives" each with horizontal scroll (`overflow-x-auto -mx-4 px-4` + `flex gap-3`)
  6. Filter awards by category for each row
  7. Only render rows that have awards (skip empty categories)
  8. Each award card gets an `id` attribute for anchor linking (e.g., `id="badge-money-man"`)
  9. Each award card includes a brief explanation line: what the badge means and how to earn it (e.g., "Awarded to the biggest money winner each season" or "Played in every Wolf Cup season since 2015")
  10. Add `useEffect` to handle hash fragment navigation: on mount, if `window.location.hash` matches a badge anchor, call `document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' })`. TanStack Router does NOT auto-scroll to hash fragments.
- Notes: AwardCard design:
  - Width: `w-40 flex-shrink-0` (consistent card width in scroll)
  - Emoji: `text-3xl` centered at top
  - Name: `text-sm font-semibold` below emoji
  - Subtitle: `text-[10px] text-muted-foreground` (e.g., "'23-'25")
  - Recipients: `text-xs` list, each with detail in muted text
  - Border: `rounded-xl border bg-card shadow-sm`

#### Task 7a: Update Champions Gallery trophy rendering
- File: `apps/web/src/routes/standings_.history.tsx`
- Action: Update the `ChampionCard` component to use repeated trophy emojis with year labels instead of `×{wins} 🏆`. Same `inline-flex flex-col items-center` pattern as stats page badges. This ensures consistency between the Champions Gallery and the rest of the badge system.
- Notes: The ChampionCard already has `years` data available. Map each year to a trophy+year column.

#### Task 7b: Add navigation link from stats page to Awards Wall
- File: `apps/web/src/routes/stats.tsx`
- Action: Add a banner/link above or below the stats header that links to `/standings/history#awards`. Style similar to the "🏆 Champions & History" link on the standings page — warm amber background, centered text.
- Notes: Use TanStack Router `Link` component. Anchor `#awards` requires an `id="awards"` on the Awards Wall section in standings_.history.tsx.

#### ~~Task 8: REMOVED~~ — Cash data already extracted and included in Task 1.

### Acceptance Criteria

- [ ] AC1: Given the stats page, when viewing a player with 4 championship wins (e.g., Preston), then 4 individual trophy emojis `🏆🏆🏆🏆` are displayed (not `4×🏆`)
- [ ] AC2: Given the stats page, when viewing the defending champion (Jaquint for 2026), then their card has a gold left border (`border-l-amber-400`)
- [ ] AC3: Given the stats page, when viewing a player who played in 2015 (OG), then a `🍺 OG` pill badge is shown next to their name
- [ ] AC4: Given the stats page, when viewing a player who played all 11 seasons, then a `🎖️ Every Season` pill badge is shown next to their name
- [ ] AC5: Given the history page, when scrolling below the Champions Gallery, then an "Awards" section is visible with "Hall of Fame" and "Superlatives" horizontal scroll rows
- [ ] AC6: Given the Awards Wall, when viewing the Dynasty card, then Preston is shown with 4 repeated `🏆` emojis each with year labels (`17 18 20 22`) and a "Dynasty" label. No special overlapping — year labels naturally show back-to-back.
- [ ] AC7: Given the Awards Wall, when viewing the Rickie Fowler card, then Jay Patterson is shown as the recipient with "2× Runner-Up, 0 Titles" detail text (runner-up in 2019, 2025)
- [ ] AC8: Given the Awards Wall, when viewing the pH Balance card, then Matt White and Ben McGinnis are both listed as recipients
- [ ] AC9: Given the Awards Wall, when a badge category has zero qualifiers, then that award card is not rendered
- [ ] AC10: Given the stats page, when tapping the Awards banner link, then the user navigates to the history page Awards Wall section
- [ ] AC11: Given the Awards Wall, when viewing the Money Man card, then Jaquint shows `💰💰` with "2023, 2024" and Patterson shows `💰` with "2025"
- [ ] AC12: Given the Awards Wall, when viewing the Philanthropist card, then Keaton shows `💸💸💸` with "2023, 2024, 2025" (three-peat)
- [ ] AC13: Given the Awards Wall, when viewing the Every Season card, then exactly 5 players are listed: Chris Keaton, Chris McNeely, Josh Stoll, Matt White, Moses
- [ ] AC14: Given the Awards Wall, when viewing the OG card, then exactly 6 players are listed (those on both 2015 AND 2025 rosters): Moses, Matt Jaquint, Chris McNeely, Chris Keaton, Josh Stoll, Matt White
- [ ] AC15: Given the dynasty detection logic, when any player reaches 4+ championship wins, then they receive the Dynasty badge with repeated trophies and year labels
- [ ] AC16: Given the Ironman card, when Jay Patterson's 2020 season is checked, then he is shown with "18/18 rounds — 2020" detail
- [ ] AC17: Given the stats page, when viewing Jaquint's card (2 championship wins: 2015, 2025), then 2 trophies are shown each with a year label underneath (`🏆` over `15`, `🏆` over `25`)
- [ ] AC18: Given the stats page, when viewing Keaton's card, then all badges are shown: `🎖️` Every Season + `🍺` OG + `💸💸💸` Philanthropist with years `23 24 25` underneath each 💸
- [ ] AC19: Given the stats page, when tapping any badge emoji, then the user navigates to the Awards Wall section for that badge's explanation (via anchor link with `scrollIntoView`)
- [ ] AC20: Given the Awards Wall, when viewing any award card, then a brief explanation of what the badge means and how to earn it is displayed
- [ ] AC21: Given the Champions Gallery on the history page, when viewing champion cards, then the trophy rendering also uses repeated emojis with year labels (consistent with stats page), replacing the old `×{wins} 🏆` format

## Additional Context

### Dependencies

- **No external library dependencies** — all badges computed with existing stack
- **Data dependency**: Cash +/- data already extracted and hardcoded in Task 1. No further extraction needed.
- **User input dependency**: Josh needs to verify Ironman recipients beyond Jay Patterson 2020 by checking Excel files
- **Existing code dependency**: `GET /history` and `GET /stats` endpoints must continue returning all existing fields — badges are additive only

### Testing Strategy

**Unit tests** (new file: `apps/api/src/lib/badges.test.ts`):
- Test each `compute*` function with known data from the Notes section
- Dynasty: verify Preston gets it (4 wins ≥ threshold); verify a player with 3 wins does NOT get it
- Rickie Fowler: verify Patterson wins with 2 runner-ups (2019, 2025); verify Moses excluded (has title); verify Wilson (1x runner-up, no title) loses to Patterson's higher count
- pH Balance: verify White (2015, 2016) and McGinnis (2022, 2024) qualify
- OG: verify exactly 6 players qualify (intersection of 2015 and 2025 rosters); verify Preston excluded (not on 2025 roster)
- Every Season: verify exactly 5 players qualify
- Edge case: empty data → no awards
- Edge case: tie for most runner-ups → both get Rickie Fowler

**Integration tests** (extend `apps/api/src/routes/history.test.ts`):
- `GET /history` returns `awards` field with correct structure
- Awards are split into `hall_of_fame` and `superlatives` categories
- Empty award categories are omitted

**Manual testing**:
- Verify stats page renders repeated trophies correctly on mobile
- Verify gold border on defending champion's card
- Verify Awards Wall horizontal scroll works on mobile
- Verify Dynasty card renders year labels cleanly
- Cross-validate cash totals with Josh

### Notes

**Known badge qualifiers (from data analysis):**

| Badge | Qualifiers |
|-------|-----------|
| 🏆 4x Champion | Chris Preston (2017, 2018, 2020, 2022) |
| 🥈 Rickie Fowler | Jay Patterson (2x runner-up: 2019, 2025; 0 titles). Note: Patterson was rank 4 in 2020, NOT rank 2. Sean Wilson was 2nd in 2020. |
| ⚖️ pH Balance | Matt White (2015, 2016, 2025), Ben McGinnis (2022, 2024) |
| 💰💰 Money Man | Matt Jaquint (2023: +$124, 2024: +$108), Jay Patterson (2025: +$159) |
| 💸💸💸 Philanthropist | Chris Keaton (2023: -$228, 2024: -$143, 2025: -$127) — THREE-PEAT |
| 🍺 OG | 6 players on both 2015 AND 2025 rosters: Moses, Matt Jaquint, Chris McNeely, Chris Keaton, Josh Stoll, Matt White |
| 🎖️ Every Season | Chris Keaton, Chris McNeely, Josh Stoll, Matt White, Moses |
| 💪 Ironman | Jay Patterson 2020 (18/18 rounds), others TBD |

**Preston Back-to-Back note:** Preston won 2017 and 2018 consecutively. He also won 2020 and 2022 but NOT 2021 (Madden won), so that's not back-to-back. Only 2017-2018 qualifies.

**Cash data extracted (verified from Excel):**

| Year | 💰 Money Man | Amount | 💸 Philanthropist | Amount |
|------|-------------|--------|------------------|--------|
| 2023 | Matt Jaquint | +$124 | Chris Keaton | -$228 |
| 2024 | Matt Jaquint | +$108 | Chris Keaton | -$143 |
| 2025 | Jay Patterson | +$159 | Chris Keaton | -$127 |

Jaquint: back-to-back Money Man (`💰💰`). Keaton: THREE-PEAT Philanthropist (`💸💸💸`).
