---
title: 'Historical Season Import & Sandbagger Detection'
slug: 'historical-import-sandbagger'
created: '2026-03-17'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: [typescript, vitest, hono, drizzle, react, tanstack-query, tailwindcss]
files_to_modify:
  - packages/engine/src/sandbagger.ts
  - packages/engine/src/sandbagger.test.ts
  - packages/engine/src/types.ts
  - packages/engine/src/index.ts
  - packages/engine/scripts/extract-2021-fixtures.py
  - packages/engine/scripts/extract-2023-fixtures.py
  - packages/engine/src/fixtures/season-2021/
  - packages/engine/src/fixtures/season-2023/
  - packages/engine/src/fixtures/fixture-types.ts (update if needed)
  - packages/engine/src/season-2021.test.ts
  - packages/engine/src/season-2023.test.ts
  - apps/api/src/routes/stats.ts
  - apps/api/src/routes/stats.test.ts (new — no existing file)
  - apps/web/src/routes/stats.tsx
code_patterns:
  - Engine functions are pure, zero deps, tested with Vitest
  - API uses Hono + Drizzle ORM, queries finalized official rounds only
  - Stats endpoint aggregates in-memory from multiple queries
  - Frontend uses TanStack Query with apiFetch helper
test_patterns:
  - Engine tests use Vitest with import.meta.glob for fixtures
  - API tests use in-memory SQLite with mocked db module
  - Fixtures are JSON files matching typed interfaces from fixture-types.ts
---

# Tech-Spec: Historical Season Import & Sandbagger Detection

**Created:** 2026-03-17

## Overview

### Problem Statement

The Wolf Cup app has no historical season data and no fun engagement hooks. Players testing Friday will see limited data. Additionally, the group has a running joke about sandbagging that could be turned into a surprise in-app feature for the 2026 season.

### Solution

1. Extract 2021 + 2023 season fixture data from Excel files (same approach as Story 1.8 for 2025)
2. Build a sandbagger detection engine that computes how frequently a player beats their handicap
3. Display a growing sandbagger badge on the stats page — hidden until a player crosses the threshold after 3-4+ current-season rounds

### Scope

**In Scope:**
- 2021 season extraction (18 round slots, no playoffs, from "Wolf Cup 2022 Final.xlsm")
- 2023 season extraction (18 round slots + playoffs, from "Wolf Cup 2024 Final.xlsm")
- Sandbagger detection logic in the engine (frequency-based)
- Growing sandbagger badge on stats page with explainer text and tooltip
- Threshold-based reveal: hidden until qualified in current season

**Out of Scope:**
- GHIN API history/score endpoint integration
- 2022 season (file missing — Preston won)
- 2024 season (file missing — Ronnie won)
- Historical stats scouting sheet import (2015-2021 data)
- Side games data
- Retroactive sandbagger badges on historical seasons
- Importing historical data into the live database (fixtures are for engine validation only)

## Context for Development

### Codebase Patterns

**Engine (`packages/engine/src/`):**
- Pure TypeScript functions, zero external dependencies
- Functions take typed inputs and return typed outputs
- All exports collected in `index.ts`
- `Tee` type is exported from `course.ts` (NOT `types.ts`): `export type Tee = 'black' | 'blue' | 'white'`
- Course data via `getCourseHole(holeNumber)` and `TEE_RATINGS[tee]` — provides `courseRating`, `slopeRating` per tee
- Handicap differential formula: `(grossScore - courseRating) * 113 / slopeRating`
- Fixtures live under `packages/engine/src/fixtures/` (NOT `packages/engine/fixtures/`)
- Fixture types defined in `packages/engine/src/fixtures/season-2025/fixture-types.ts`

**API (`apps/api/src/routes/stats.ts`):**
- Single `GET /stats` endpoint (public, no auth)
- Queries only `rounds.type === 'official'` AND `rounds.status === 'finalized'`
- No season filter exists — queries ALL finalized official rounds across all seasons
- 4 separate queries: players, wolfDecisions, holeScores, roundResults — in-memory aggregation via Maps
- Returns `{ players: PlayerStats[], lastUpdated: string }`
- Currently does NOT join with `roundPlayers` — sandbagger needs: `roundPlayers.handicapIndex` + sum of `holeScores.grossScore` per round + tee info
- **No `stats.test.ts` exists yet** — must be created from scratch

**DB Schema notes:**
- `rounds.tee` is `text('tee')` — **nullable**, could be any string
- `groups.tee` is also `text('tee')` — **nullable**, per-group override
- For sandbagger: use `groups.tee` (more accurate per-player tee) with fallback to `rounds.tee`
- Must validate tee value is a valid `Tee` ('black'|'blue'|'white') at runtime; skip round if invalid/null

**Web (`apps/web/src/routes/stats.tsx`):**
- `useQuery({ queryKey: ['stats'] })` with `apiFetch<StatsResponse>`
- Player cards: rank + name in header flex row (`flex items-center gap-2.5`)
- Player name: `<span className="font-semibold">{p.name}</span>` — badge goes after this element
- Sort buttons: alpha, money, birdies, wolf
- Mobile-first, no breakpoints, `grid-cols-4` stat cells

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `packages/engine/src/stableford.ts` | `getHandicapStrokes()` — handicap calculation reference |
| `packages/engine/src/course.ts` | `Tee` type, `TEE_RATINGS` — courseRating + slopeRating per tee; `getCourseHole()` |
| `packages/engine/src/types.ts` | `CourseHole`, `HarveyRoundInput`, `RoundType` (NOTE: `Tee` is in `course.ts`) |
| `packages/engine/src/harvey.ts` | `calculateHarveyPoints()`, `calculateSeasonTotal()` |
| `packages/engine/src/season-2025.test.ts` | Fixture loading pattern: `import.meta.glob` + per-round validation |
| `packages/engine/scripts/extract-2025-fixtures.py` | Reference extraction script (zipfile + xml.etree). NOTE: reads `sheet2.xml` — sheet index varies per workbook |
| `packages/engine/src/fixtures/season-2025/round-01.json` | Reference fixture JSON format |
| `packages/engine/src/fixtures/season-2025/fixture-types.ts` | `RoundFixture`, `SeasonStandings` type definitions |
| `apps/api/src/routes/stats.ts` | Stats aggregation — add sandbagger query here |
| `apps/api/src/db/schema.ts` | `roundPlayers.handicapIndex`, `holeScores.grossScore`, `rounds.tee`, `groups.tee` |
| `apps/web/src/routes/stats.tsx` | Stats UI — badge insertion at player name span |

### Technical Decisions

- **Frequency-based detection, not differential-based.** A golfer beats their handicap ~20% of the time (USGA data). Doing it 60%+ over 4+ rounds is a ~5% event. The frequency ratio is intuitive and displayable ("3/5 rounds").
- **"Beats handicap" = differential below HI.** `(gross18 - courseRating) * 113 / slope < handicapIndex`. Standard USGA differential formula. Requires: 18-hole gross total, course rating + slope from tee played, and HI snapshot from `roundPlayers`.
- **Tier system (growing sandbag):**
  - Tier 0: Hidden. ratio < 0.60 OR totalRounds < 4
  - Tier 1: Small sandbag. ≥60% over 4+ rounds (3/5 = 0.02 binomial probability)
  - Tier 2: Medium sandbag. ≥71% over 7+ rounds (5/7 = 0.004 probability)
  - Tier 3: Large sandbag. ≥73% over 11+ rounds (8/11 = 0.0001 probability)
- **Engine function is pure.** No database dependency. Takes typed array, returns result.
- **Tee resolution: prefer `groups.tee`, fall back to `rounds.tee`.** The schema has tee on both tables. A group's tee is more accurate than the round default. Must validate the value is a valid `Tee` literal at runtime — skip round if tee is null or not in `TEE_RATINGS`.
- **Sandbagger uses ALL finalized rounds (no season filter).** The stats endpoint already queries all finalized official rounds with no season boundary. Sandbagger detection follows the same scope. This means the badge reflects lifetime Wolf Cup performance, which is appropriate — a sandbagger doesn't stop being one at season boundaries.
- **Icon grows visually** — same sandbag SVG at increasing sizes (16px → 22px → 30px), not stacked bags. Simpler to implement, clearer visual signal.
- **Extraction scripts are per-season** because each Excel has different column layouts. Reuse the zipfile+xml.etree approach from 2025 script.
- **Sheet XML index discovery:** Each Excel workbook maps named tabs to `sheetN.xml` differently. Scripts must parse `xl/workbook.xml` to find the `<sheet>` element matching the target name (e.g., "Auto -  Printable") and resolve its `r:id` to the correct `xl/worksheets/sheetN.xml` via `xl/_rels/workbook.xml.rels`.
- **Fixture types are shared.** Reuse `fixture-types.ts` from season-2025 for 2021 and 2023. If playoff fixtures need additional fields (e.g., `multiplier`, `roundType`), extend the types rather than creating per-season copies.

## Implementation Plan

### Tasks

#### Part A: Historical Season Extraction

- [ ] Task 1: Create 2023 season extraction script
  - File: `packages/engine/scripts/extract-2023-fixtures.py`
  - Action: Adapt `extract-2025-fixtures.py` for the "Wolf Cup 2024 Final.xlsm" layout. Must parse `xl/workbook.xml` + `xl/_rels/workbook.xml.rels` to resolve "Auto -  Printable" tab to correct `sheetN.xml` (do NOT hardcode sheet index). Regular season: 2-col-per-round (D/E through AL/AM), 3-row player pattern (name/harvey/cash). Playoffs from "Playoffs" tab. Output to `packages/engine/src/fixtures/season-2023/`.
  - Notes: Column mapping: D/E=round 1, F/G=round 2, ..., AL/AM=round 18. AN=TOTAL, AO=AVG. Player rows start at row 6, 3-row stride. Playoffs: D/E and F/G for R8 (×3 multiplier), M/N and O/P for R4 (×8). 19 players regular season, 8 in R8, 4 in R4. Round 2 may be "Rain Out" (F5="Rain Out") — detect tee row value and skip if rain out. This means 18 round slots may yield 17 actual rounds.

- [ ] Task 2: Create 2021 season extraction script
  - File: `packages/engine/scripts/extract-2021-fixtures.py`
  - Action: Adapt for "Wolf Cup 2022 Final.xlsm" layout. Same sheet discovery approach (parse workbook.xml for "Auto -  Printable"). Same 2-col-per-round pattern, but dates are text strings ("Apr 29th", "May 6th" etc.) not serial dates. No playoffs sheet. Output to `packages/engine/src/fixtures/season-2021/`.
  - Notes: Text date parsing: map month abbreviations to numbers, strip ordinal suffixes. Year is 2021 (confirmed: Madden won). Round 2 has "Rain Out" (F5="Rain Out") — skip it. 18 round slots with 1 rainout = 17 actual rounds of data. Column layout matches 2023 file.

- [ ] Task 3: Run extraction scripts and generate fixture files
  - Files: `packages/engine/src/fixtures/season-2021/round-{NN}.json`, `season-standings.json`; `packages/engine/src/fixtures/season-2023/round-{NN}.json`, `playoff-r8-{1-2}.json`, `playoff-r4-{1-2}.json`, `season-standings.json`
  - Action: Execute scripts against reference Excel files. Validate output JSON matches the `RoundFixture` / `SeasonStandings` types from `fixture-types.ts`. Round numbering: if round 2 is rained out, round-02.json is not emitted; round-03.json corresponds to the 3rd slot (not renumbered).
  - Notes: Verify player count per round matches Excel. Verify fixture-types.ts is compatible; if playoff fixtures need `roundType` or `multiplier` fields, update the shared type file.

- [ ] Task 4: Create 2021 season validation tests
  - File: `packages/engine/src/season-2021.test.ts`
  - Action: Follow `season-2025.test.ts` pattern. Load fixtures via `import.meta.glob('./fixtures/season-2021/round-*.json', { eager: true })`. For each round: call `calculateHarveyPoints()` with correct bonus, compare against Excel expected values. Validate season totals with `calculateSeasonTotal()`.
  - Notes: 2021 had no playoffs. Verify sum invariant per round. Use `toBeCloseTo(, 1)` for season totals. Jeff Madden should be #1 in final standings. Rain-out round has no fixture file — glob naturally skips it.

- [ ] Task 5: Create 2023 season validation tests
  - File: `packages/engine/src/season-2023.test.ts`
  - Action: Same pattern as Task 4 but also validate playoff rounds. R8 multiplier = 3, R4 multiplier = 8. Copley should be champion (431 final pts). Validate all 8 R8 players and 4 R4 players.
  - Notes: 2023 had 19 regular players, 18 round slots (likely 17 actual after rain out). Verify playoff standings match: Copley 431, Ronnie 429.5, Preston 422, Stoll 401.5.

#### Part B: Sandbagger Detection Engine

- [ ] Task 6: Add sandbagger types to engine
  - File: `packages/engine/src/types.ts`
  - Action: Add types:
    ```typescript
    export interface SandbaggerRoundInput {
      readonly gross18: number;       // Sum of 18 hole gross scores
      readonly courseRating: number;   // From TEE_RATINGS[tee].courseRating
      readonly slopeRating: number;   // From TEE_RATINGS[tee].slopeRating
      readonly handicapIndex: number; // Snapshot from roundPlayers
    }

    export interface SandbaggerResult {
      readonly beatsCount: number;    // Rounds where differential < HI
      readonly totalRounds: number;
      readonly ratio: number;         // beatsCount / totalRounds (0 if no rounds)
      readonly tier: 0 | 1 | 2 | 3;
    }
    ```
  - Notes: `Tee` type lives in `course.ts`, not here. These types are for the sandbagger engine only.

- [ ] Task 7: Implement sandbagger detection function
  - File: `packages/engine/src/sandbagger.ts`
  - Action: Implement `calculateSandbaggerStatus(rounds: SandbaggerRoundInput[]): SandbaggerResult`. For each round, compute USGA differential = `(gross18 - courseRating) * 113 / slopeRating`. If differential < handicapIndex, increment beatsCount. Compute ratio (0 if no rounds). Apply tier logic — check highest tier first:
    - Tier 3: totalRounds >= 11 AND ratio >= 0.73
    - Tier 2: totalRounds >= 7 AND ratio >= 0.71
    - Tier 1: totalRounds >= 4 AND ratio >= 0.60
    - Tier 0: everything else
  - Notes: Export constants `MIN_ROUNDS_TIER1 = 4`, `MIN_ROUNDS_TIER2 = 7`, `MIN_ROUNDS_TIER3 = 11`, `RATIO_TIER1 = 0.60`, `RATIO_TIER2 = 0.71`, `RATIO_TIER3 = 0.73`.

- [ ] Task 8: Write sandbagger unit tests
  - File: `packages/engine/src/sandbagger.test.ts`
  - Action: Test cases:
    - 0 rounds → tier 0, ratio 0, beatsCount 0
    - 3 rounds, all beats → tier 0 (ratio 1.0 but totalRounds 3 < MIN_ROUNDS_TIER1)
    - 4 rounds, 3 beats → tier 1 (ratio 0.75 ≥ 0.60, rounds 4 ≥ 4)
    - 5 rounds, 2 beats → tier 0 (ratio 0.40 < 0.60)
    - 5 rounds, 3 beats → tier 1 (ratio 0.60 ≥ 0.60)
    - 7 rounds, 5 beats → tier 2 (ratio 0.714 ≥ 0.71, rounds 7 ≥ 7)
    - 7 rounds, 4 beats → tier 0 (ratio 0.571 < 0.60 — does NOT qualify for any tier)
    - 11 rounds, 8 beats → tier 3 (ratio 0.727 ≥ 0.73, rounds 11 ≥ 11)
    - 11 rounds, 7 beats → tier 1 (ratio 0.636 — below 0.71 for tier 2, above 0.60 for tier 1, rounds 11 ≥ 4)
    - 10 rounds, 8 beats → tier 2 (ratio 0.80 ≥ 0.71, rounds 10 ≥ 7 but < 11 for tier 3)
    - Verify differential math: gross 85, CR 69.7, slope 121 → diff = (85-69.7)*113/121 = 14.28. If HI=16, beats. If HI=14, doesn't beat.
    - All rounds same score — verify deterministic result

- [ ] Task 9: Export from engine index
  - File: `packages/engine/src/index.ts`
  - Action: Add `export { calculateSandbaggerStatus } from './sandbagger.js';` and re-export `SandbaggerRoundInput`, `SandbaggerResult` types from `types.ts`.

#### Part C: API Integration

- [ ] Task 10: Add sandbagger data to stats endpoint
  - File: `apps/api/src/routes/stats.ts`
  - Action: Add a 5th query to build sandbagger inputs. For each player in each finalized official round:
    1. Sum `holeScores.grossScore` grouped by `(roundId, playerId)` — only include where count = 18 (complete rounds)
    2. Join `roundPlayers` to get `handicapIndex`
    3. Join `groups` to get `groups.tee`, fall back to `rounds.tee`
    4. **Runtime tee validation:** check that resolved tee is `'black' | 'blue' | 'white'` — skip round if null or invalid
    5. Look up `courseRating` and `slopeRating` from `TEE_RATINGS[validatedTee]` (import `TEE_RATINGS` and `Tee` from `@wolf-cup/engine`)
    6. Build `SandbaggerRoundInput[]` per player, call `calculateSandbaggerStatus()`
    7. Add optional `sandbagging` field to response — only when `tier >= 1`:
    ```typescript
    sandbagging?: {
      beatsCount: number;
      totalRounds: number;
      tier: 1 | 2 | 3;
    }
    ```
  - Notes: The tee validation guard is critical — `rounds.tee` is nullable `text` in the schema, and `TEE_RATINGS[invalidValue]` returns `undefined` which would produce `NaN` differentials. Import `calculateSandbaggerStatus`, `TEE_RATINGS`, and type `Tee` from `@wolf-cup/engine`.

- [ ] Task 11: Create stats API test file with sandbagger tests
  - File: `apps/api/src/routes/stats.test.ts` **(NEW FILE — does not exist yet)**
  - Action: Create test file from scratch. Set up:
    - In-memory SQLite via `libsql` (same pattern as other API test files if any exist, otherwise reference the Drizzle + libsql test setup pattern)
    - Mock `../db/index.js` to use in-memory database
    - Seed with players, rounds (with tee set), groups, roundPlayers (with handicapIndex), holeScores (18 per round)
    - Test cases:
      - Player with < 4 finalized rounds → no `sandbagging` field
      - Player with 5 rounds, 3 below HI → `sandbagging: { beatsCount: 3, totalRounds: 5, tier: 1 }`
      - Player with 5 rounds, 1 below HI → no `sandbagging` field
      - Player with incomplete round (< 18 holes) → round excluded from sandbagger calculation
      - Player with null tee on round → round excluded
      - Existing stats (wolf record, birdies, money) still work correctly

#### Part D: Frontend Display

- [ ] Task 12: Add sandbagger badge to stats page
  - File: `apps/web/src/routes/stats.tsx`
  - Action: Update `PlayerStats` type to include optional `sandbagging` field. In `PlayerCard` header, after the player name span, conditionally render sandbagger badge when `p.sandbagging` exists:
    - Inline SVG sandbag icon (burlap sack style, tan/brown fill)
    - Size based on tier: tier 1 = 16px, tier 2 = 22px, tier 3 = 30px
    - Below name row: muted text `"Shot below handicap {beatsCount}/{totalRounds} rounds"` in `text-[10px] text-muted-foreground`
    - Tooltip on hover/tap with cheeky text:
      - Tier 1: "Hmm... suspiciously good lately"
      - Tier 2: "Nice putt, Ronnie"
      - Tier 3: "Someone call the levee board"
  - Notes: SVG can be a simple inline component. Use `title` attribute on a wrapper for basic tooltip (no dependency needed). The explainer text goes in a new row below the existing header flex, only when sandbagging is present.

### Acceptance Criteria

#### Historical Extraction
- [ ] AC 1: Given the "Wolf Cup 2022 Final.xlsm" file, when the 2021 extraction script runs, then it produces round JSON files and 1 `season-standings.json` in `packages/engine/src/fixtures/season-2021/`, skipping any rain-out rounds.
- [ ] AC 2: Given the 2021 fixtures, when `calculateHarveyPoints()` runs for each round, then results match Excel expected values and sum invariant holds.
- [ ] AC 3: Given the 2021 fixtures, when `calculateSeasonTotal()` runs, then Jeff Madden is #1 and all season totals match Excel within 1 decimal place.
- [ ] AC 4: Given the "Wolf Cup 2024 Final.xlsm" file, when the 2023 extraction script runs, then it produces regular round fixtures, playoff fixtures, and `season-standings.json` in `packages/engine/src/fixtures/season-2023/`.
- [ ] AC 5: Given the 2023 fixtures, when Harvey engine runs for regular + playoff rounds, then Copley finishes at 431 pts and all standings match Excel.
- [ ] AC 6: Given a round slot with tee value "Rain Out" in either Excel file, when extraction runs, then that round slot is skipped (no fixture generated).

#### Sandbagger Detection
- [ ] AC 7: Given a player with fewer than 4 finalized rounds, when sandbagger status is calculated, then tier is 0 and no badge is displayed.
- [ ] AC 8: Given a player who beats their handicap 3 out of 5 rounds, when sandbagger status is calculated, then tier is 1 (ratio 0.60 ≥ 0.60, rounds 5 ≥ 4).
- [ ] AC 9: Given a player who beats their handicap 5 out of 7 rounds, when sandbagger status is calculated, then tier is 2 (ratio 0.714 ≥ 0.71, rounds 7 ≥ 7).
- [ ] AC 10: Given a player who beats their handicap 8 out of 11 rounds, when sandbagger status is calculated, then tier is 3 (ratio 0.727 ≥ 0.73, rounds 11 ≥ 11).
- [ ] AC 11: Given gross score 85, course rating 69.7, slope 121, HI 16, when differential is computed, then differential = 14.28 which is < 16, so round counts as "beats handicap".
- [ ] AC 12: Given a round with fewer than 18 hole scores recorded, when sandbagger data is computed, then that round is excluded from the calculation.
- [ ] AC 13: Given a round with null or invalid tee value, when sandbagger data is computed, then that round is excluded from the calculation.

#### UI Display
- [ ] AC 14: Given a player with tier 0 sandbagger status, when stats page loads, then no sandbag icon or text is visible for that player.
- [ ] AC 15: Given a player with tier 1+ sandbagger status, when stats page loads, then a sandbag icon appears next to their name with explainer text "Shot below handicap X/Y rounds" below.
- [ ] AC 16: Given a tier 2 player, when stats page loads, then the sandbag icon is visually larger than tier 1.
- [ ] AC 17: Given a tier 1+ sandbag icon, when user hovers or taps the icon, then a tooltip displays the tier-appropriate cheeky message.

## Additional Context

### Dependencies

- `@wolf-cup/engine` — existing package, will add `sandbagger.ts` + types
- `packages/engine/src/course.ts` — `Tee` type + `TEE_RATINGS` for courseRating/slopeRating lookup
- `packages/engine/src/fixtures/season-2025/fixture-types.ts` — reuse/extend for new seasons
- Reference Excel files in `reference/` directory — input for extraction scripts
- Python 3 — required for running extraction scripts (same as Story 1.8)
- No new npm packages required

### Testing Strategy

- **Engine unit tests** (`sandbagger.test.ts`): Pure function tests covering all tier boundaries, edge cases (0 rounds, all beats, no beats), and differential math verification
- **Fixture validation tests** (`season-2021.test.ts`, `season-2023.test.ts`): Load extracted JSON, run through Harvey engine, compare against Excel expected values — same proven pattern from Story 1.8
- **API integration tests** (`stats.test.ts` — NEW FILE): Create from scratch with in-memory SQLite. Seed players, rounds, groups, roundPlayers, holeScores. Verify `sandbagging` field appears/absent based on qualification. Verify incomplete rounds and null-tee rounds excluded. Verify existing stats unaffected.
- **Manual testing**: Load stats page, verify badge rendering at each tier size, verify tooltip on hover/tap, verify no badge when tier 0
- **Run all existing tests** after changes to ensure no regressions

### Notes

- **Rain Out handling:** Both 2022 Final (2021 season) and 2024 Final (2023 season) have "Rain Out" as a tee value on round 2 (F5). Scripts should detect tee value of "Rain Out" and skip that round slot. 18 round slots with 1 rainout = 17 actual round fixtures.
- **Sheet XML discovery:** Do NOT hardcode `sheetN.xml` — parse `xl/workbook.xml` to find the `<sheet>` element by name, resolve via `xl/_rels/workbook.xml.rels` to get the correct worksheet file.
- **Confirmed champions:** 2025 Jaquint, 2024 Ronnie, 2023 Copley, 2022 Preston, 2021 Madden, 2020 Preston, 2019 McNeely
- **USGA statistical basis:** Beating handicap ~1 in 5 rounds (20%). Tier 1 threshold (60% over 5 rounds) has ~2% binomial probability. Tier 3 (73% over 11) is ~0.01%.
- **Future consideration:** If GHIN API access becomes available, could enhance detection by comparing Wolf Cup performance vs. non-Wolf performance (the "3 putt when it doesn't matter" pattern Josh described)
- **Icon design:** Simple inline SVG burlap sack — tan fill, darker stroke, tied at top. No external image dependency.
- **DB tee column is untyped text:** `rounds.tee` and `groups.tee` are both `text('tee')` with no constraint. API must validate at runtime that the value is one of `'black' | 'blue' | 'white'` before passing to `TEE_RATINGS`. Invalid/null = skip that round for sandbagger calculation.
- **Historical data is test-only:** The extracted fixture JSON files validate the Harvey engine against real season data. They are NOT imported into the live database. The spec title "Import" refers to extracting from Excel into engine fixtures, not database seeding.
