# Story 1.8: Historical Data Validation Gate

Status: done

## Story

As the league commissioner,
I want the engine validated against all 15 played rounds of the 2025 season before the app goes live,
So that I can be certain the Harvey Cup scoring math is correct before the first official 2026 round.

## Acceptance Criteria

1. **Given** the 2025 season Excel at `reference/scorecards/Wolf Cup 2025 Final Sheet Season Ended.xlsm`
   **When** the one-time extraction script is run
   **Then** it produces 16 JSON fixture files in `packages/engine/src/fixtures/season-2025/` (rounds 1–15 + round 16 makeup)
   **And** each fixture contains per-player Stableford scores, money balances, and the Excel-calculated Harvey Cup points for that round
   **And** a `season-standings.json` file captures each player's expected combined season totals (for drop-score validation)

2. **Given** all 15 fixture files exist
   **When** `pnpm --filter @wolf-cup/engine exec vitest run` runs `season-2025.test.ts`
   **Then** for each round, `calculateHarveyPoints(inputs)` produces output where `stablefordPoints + moneyPoints` matches the player's expected combined Harvey total from the fixture (within ±0.01)
   **And** any discrepancy fails with a message identifying: round number, date, player name, engine combined value vs expected combined value

3. **Given** all 15 round Harvey points match
   **When** the validation test calls `calculateSeasonTotal` for each player (using all their round results)
   **Then** each player's season stableford + money Harvey totals (with best-10 drops) match the Excel season standings
   **And** roundsDropped values are correct (max(0, roundsPlayed − 10))

4. **Given** any single fixture comparison fails
   **When** CI runs
   **Then** the pipeline fails with a clear diagnostic message and Epic 2 work may not begin

5. **Given** the fixture data contains rounds where a player did not participate (missed a round)
   **When** the validation test processes that round
   **Then** that player is simply absent from the `calculateHarveyPoints` call for that round (only active players are passed in)
   **And** their Harvey points for that round are 0 (not in the fixture for that round)

## Tasks / Subtasks

- [x] Task 1: Map Excel Standings sheet structure and write extraction script (AC: 1)
  - [x] 1.1 Read `xl/worksheets/sheet2.xml` from the xlsm zip to map exact column positions for Score, Harvey, Money per round
  - [x] 1.2 Map which rows belong to which player (3 rows per player: stableford row, harvey row, cash row) by E-column value
  - [x] 1.3 Identify round column pairs (ODD=input, EVEN=calc) — CS/CT through DZ (18 slots; round 0 and 17 skipped as empty)
  - [x] 1.4 Write extraction script `packages/engine/scripts/extract-2025-fixtures.py` (Python 3, stdlib only — zipfile + xml.etree.ElementTree; no npm deps)
  - [x] 1.5 Script outputs `round-01.json` through `round-16.json` (16 rounds including makeup DY/DZ)
  - [x] 1.6 Script outputs `packages/engine/src/fixtures/season-2025/season-standings.json`
  - [x] 1.7 Verified multiple rounds manually; confirmed Harvey bonus (+8/+6/+4/+2 per group count) and combined-drops formula
  - [x] 1.8 Committed all 16 generated fixture JSON files

- [x] Task 2: Define fixture TypeScript types (AC: 1–5)
  - [x] 2.1 Create `packages/engine/src/fixtures/season-2025/fixture-types.ts` with:
    - `PlayerRoundFixture`: `{ name: string; stableford: number; money: number; expectedHarveyStableford: number; expectedHarveyMoney: number; }`
    - `RoundFixture`: `{ round: number; date: string; players: readonly PlayerRoundFixture[]; }`
    - `PlayerSeasonStandings`: `{ name: string; roundsPlayed: number; roundsDropped: number; expectedSeasonTotal: number; }` ← combined total (Excel uses combined drops, not per-category)
    - `SeasonStandings`: `{ players: readonly PlayerSeasonStandings[]; }`

- [x] Task 3: Write validation test suite (AC: 2–5)
  - [x] 3.1 Create `packages/engine/src/season-2025.test.ts` (uses `import.meta.glob` — no node:fs)
  - [x] 3.2 Load all 16 round fixtures; for each round: build `HarveyRoundInput[]`, call `calculateHarveyPoints` with bonus, assert `stablefordPoints` and `moneyPoints` match expected exactly (`toBe` — all values are 0.5 multiples)
  - [x] 3.3 Load `season-standings.json`; for each player: collect `HarveyRoundResult[]`, call `calculateSeasonTotal`, assert `stableford + money === expectedSeasonTotal`
  - [x] 3.4 On failure, diagnostic message identifies: round number, date, player name, engine value vs expected
  - [x] 3.5 Sum invariant check per round: `sumOf(stablefordPoints) === N*(N+1)/2 + N*bonus` (exact `toBe`)

- [x] Task 4: Extraction dependencies (AC: 1) — Python approach used; no npm deps added
  - [x] 4.1 N/A — Python stdlib used instead of `fast-xml-parser`; no `pnpm add` needed
  - [x] 4.2 N/A — Script run directly via `python3 packages/engine/scripts/extract-2025-fixtures.py`
  - [x] 4.3 Fixtures directory committed (not gitignored)

- [x] Task 5: Run full suite and confirm CI gate (AC: 4)
  - [x] 5.1 All 426 tests pass (33 new season-2025 tests + 393 existing)
  - [x] 5.2 `pnpm --filter @wolf-cup/engine typecheck` — zero errors
  - [x] 5.3 `pnpm -r lint` — zero warnings

## Dev Notes

### Excel File Structure (Reverse-Engineered)

**File:** `reference/scorecards/Wolf Cup 2025 Final Sheet Season Ended.xlsm`
The xlsm is a ZIP file. Extract sheets with: `unzip -p "Wolf Cup 2025 Final Sheet Season Ended.xlsm" xl/worksheets/sheet2.xml`

**Sheet mapping (from `xl/workbook.xml`):**
| Tab Name | sheetId | File |
|---|---|---|
| Auto - Printable | 1 | sheet1.xml |
| **Standings** | 2 | **sheet2.xml** ← primary data source |
| Pairings | 5 | sheet5.xml |
| Tee Sheet | 6 | sheet6.xml |
| Playoffs '25 | 16 | sheet16.xml |
| Money | 8 | sheet8.xml |

**Standings sheet (sheet2.xml) layout — 3 rows per player:**
```
Row A (stableford): playerName | [per-round Stableford scores]
Row B (harvey):     "Harvey Points" | [per-round Harvey Cup points] | [H Rank per round]
Row C (cash):       "cash +/-" | [per-round cash +/-] | [M Rank per round]
```

**Per-round column block (5 columns per round in order):**
```
Score | Harvey | Money | H Rank | M Rank
```
- `Score` column: stableford score for the round (float, e.g. 28.5)
- `Harvey` column: Harvey Cup points earned this round (stableford category)
- `Money` column: cash balance for the round ($, can be negative)
- `H Rank` column: stableford rank (1=best)
- `M Rank` column: money rank (1=best)

**CRITICAL UNKNOWN — Harvey column semantics:** It is unclear from static analysis whether "Harvey" in the Standings sheet represents:
  a) Only the Stableford Harvey Cup points for that round, OR
  b) The combined total (Stableford Harvey + Money Harvey) for that round

**Resolution approach in Task 1.7:** After extracting fixtures, manually verify one round:
1. Take all active players' Stableford scores from a round
2. Run `calculateHarveyPoints` via the REPL or a test
3. Compare individual player Stableford Harvey points to Excel "Harvey" column
4. If match → "Harvey" = Stableford Harvey only (store separately; derive money Harvey from M Rank)
5. If no match but (Stableford Harvey + Money Harvey) matches → "Harvey" = combined total

**Player count:** 12–16 active players per round (varies; subs and no-shows tracked separately).
Players seen in shared strings: Matt Jaquint, Jay Patterson, Matt White, Moses, Scotty Pierson, Josh Stoll, Chris McNeely, Mike Bonner, Ronnie A., Tim Biller, Jeff Madden, Ben McGinnis, Kyle Cox, Jeff Biederman, Chris Keaton, Bobby Marshall, Sean Wilson, Chris Preston.

**Round dates (15 rounds):**
May 2nd, May 9th, May 16th, May 23rd, June 13th, June 20th, June 27th, July 4th, July 11th, July 18th, July 25th, Aug 1st, Aug 8th, Aug 15th, Aug 22nd

**Season standings column (from Standings sheet row 1):**
The first data column appears to contain the season total Harvey points (271 for Jaquint, 266.5 for Patterson, 250 for White, etc.). These are used for season validation in AC 3.

### Extraction Script Approach

**Dependencies:** `fast-xml-parser` (dev only), Node.js `fs`, `path`, built-in `zlib` for ZIP extraction.
Actually: since `unzip` is available in the shell, the simpler approach is:
```typescript
// scripts/extract-2025-fixtures.ts
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// 1. Unzip sheet2.xml to temp file
// 2. Parse XML with fast-xml-parser
// 3. Build shared strings map (sharedStrings.xml)
// 4. Walk rows, group 3 rows per player
// 5. For each group of 5 columns (per round), extract values
// 6. Output fixture JSON
```

**Alternative (simpler):** Write a Python extraction script `scripts/extract-2025-fixtures.py` (Python3 is confirmed available in the dev environment). Use `zipfile` + `xml.etree.ElementTree` (stdlib, no extra deps). Run with `python3 scripts/extract-2025-fixtures.py`. This avoids adding `fast-xml-parser` entirely.

**Recommended: Python approach** — already proven working during story creation (the XML analysis was done in Python3). No new npm deps needed.

Script output format per round:
```json
{
  "round": 1,
  "date": "2025-05-02",
  "players": [
    {
      "name": "Scotty Pierson",
      "stableford": 35,
      "money": 23,
      "expectedHarveyStableford": 12,
      "expectedHarveyMoney": 11
    }
  ]
}
```

### Fixture TypeScript Types

The types in `packages/engine/src/fixtures/season-2025/fixture-types.ts` are plain data — no engine imports. The test file imports both the types and engine functions.

**`noUncheckedIndexedAccess`** applies: use `for...of` over fixtures arrays, not index access.

### Validation Test Design

```typescript
// season-2025.test.ts
import { describe, it, expect } from 'vitest';
import { calculateHarveyPoints, calculateSeasonTotal } from './harvey.js';
import type { RoundFixture, SeasonStandings } from './fixtures/season-2025/fixture-types.js';

// Dynamic test generation from fixture files
const fixtureDir = new URL('./fixtures/season-2025/', import.meta.url).pathname;
const roundFiles = fs.readdirSync(fixtureDir).filter(f => f.startsWith('round-'));

describe('2025 season Harvey Cup validation', () => {
  for (const file of roundFiles) {
    const fixture: RoundFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf-8'));
    it(`Round ${fixture.round} (${fixture.date}): Harvey Cup points match Excel`, () => {
      const inputs = fixture.players.map(p => ({ stableford: p.stableford, money: p.money }));
      const results = calculateHarveyPoints(inputs);
      for (let i = 0; i < fixture.players.length; i++) {
        const player = fixture.players[i]!;
        const result = results[i]!;
        expect(result.stablefordPoints, `${player.name} stableford`).toBeCloseTo(player.expectedHarveyStableford, 1);
        expect(result.moneyPoints, `${player.name} money`).toBeCloseTo(player.expectedHarveyMoney, 1);
      }
    });
  }
});
```

**Note:** Use `toBeCloseTo(val, 1)` (1 decimal place tolerance) to handle any floating-point rounding in Excel formulas vs JavaScript. Exact equality is preferred; `toBeCloseTo` is a fallback if exact equality fails on some tie-split values.

**Vitest dynamic tests**: `for` loops to generate `it()` calls inside `describe()` blocks work correctly with Vitest. No `test.each` needed.

**File reading in Vitest**: Vitest runs in Node.js — `fs.readFileSync` and `new URL('./...', import.meta.url)` work correctly. The `import.meta.url` gives the test file's URL from which relative paths can be resolved.

### Season Standings Validation

Season totals in Excel use best-10-of-15 drops (15 rounds played, drop 5 lowest per category). Call:
```typescript
calculateSeasonTotal(playerRoundResults) // 15 HarveyRoundResults per player
// Returns: { stableford, money, roundsPlayed: 15, roundsDropped: 5 }
```
Players who missed some rounds: `roundsPlayed < 15`, `roundsDropped = max(0, roundsPlayed - 10)`.

### Project Structure Notes

**Files to create:**
- `packages/engine/scripts/extract-2025-fixtures.py` — one-time extraction script (Python3)
- `packages/engine/src/fixtures/season-2025/` — directory for fixture JSON + types
- `packages/engine/src/fixtures/season-2025/fixture-types.ts` — TypeScript types (no engine deps)
- `packages/engine/src/fixtures/season-2025/round-01.json` through `round-15.json` — generated fixtures
- `packages/engine/src/fixtures/season-2025/season-standings.json` — season totals
- `packages/engine/src/season-2025.test.ts` — validation test suite

**Files NOT to modify:**
- All existing engine source files (no engine changes needed for validation)
- `packages/engine/src/index.ts` — no new exports needed
- `packages/engine/package.json` — no new deps needed if using Python extraction

**No sprint-status.yaml** — story tracking via story files only.

**TypeScript strictness reminders:**
- `noUncheckedIndexedAccess: true` — use `fixture.players[i]!` after bounds check, or use `for...of`
- `.js` extension on all local imports
- `fixture-types.ts` exports plain types only; no engine imports to avoid circular concerns

### Previous Story Learnings (1.1–1.7)

- Test helpers `sp()`, `mp()`, `sumOf()`, `inputs()`, `rounds()` are in `harvey.test.ts` module scope — do NOT import them; write equivalent inline in `season-2025.test.ts`
- `calculateHarveyPoints` with N players: validates internally via `validateHarveyTotal` — if player count or data is wrong, it throws; test will surface this cleanly
- `calculateSeasonTotal` takes `regularRounds` and optional `playoffRounds` (default `[]`); for regular season validation, only pass `regularRounds`
- Vitest `globals: false` — always `import { describe, it, expect } from 'vitest'`
- `import.meta.url` is available in Vitest (ESM) — use for resolving fixture file paths

### References

- FR7: Best-10-of-N validation [Source: epics.md]
- NFR9: Engine output must be validated against 2025 season Excel data for all 17 rounds before launch [Source: epics.md]
- Architecture: `harvey.ts` covers FR4–FR8; `calculateHarveyPoints` and `calculateSeasonTotal` are the functions under test [Source: architecture.md]
- Excel file: `reference/scorecards/Wolf Cup 2025 Final Sheet Season Ended.xlsm` (xlsm = ZIP with XML sheets)
- Standings sheet: sheet2.xml (largest sheet, ~1MB, contains all 15 rounds)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Python extraction script used instead of TypeScript — no npm deps added; stdout logged WARN for empty slots
- Harvey bonus discovered: VLOOKUP(N/4, {1:8,2:6,3:4,4:2,5:0}) — only exact multiples of 4 players
- Season total formula: Excel `LARGE($G6:$CN6, 1..10)` = top-10 COMBINED (stab+money) Harvey per round, NOT independent per-category
- Makeup round (DY/DZ) discovered during Jaquint season total debugging — 12 players played, included as round 16
- `calculateSeasonTotal` changed to combined-drops; 2 harvey.test.ts tests updated accordingly
- `validateHarveyTotal` extended with `bonusPerPlayer` parameter; backward-compatible default=0
- `vitest-globals.d.ts` created to provide `import.meta.glob` types without `@types/node` or `vite/client`
- Windows path: used `import.meta.glob` instead of `node:fs`+`fileURLToPath` to avoid drive-letter doubling issue

### Completion Notes List

- 16 round fixtures generated (rounds 1–15 + round 16 makeup at DY/DZ columns), not 15 as originally scoped
- All player counts are exact multiples of 4 (4, 8, 12, or 16) — bonus system applies cleanly to all rounds
- `PlayerSeasonStandings.expectedSeasonTotal` is a single combined field (not separate stableford/money) — mirrors how Excel stores and validates the season total (combined top-10 drops)
- Harvey point assertions changed from `toBeCloseTo` to `toBe` — all valid Harvey values are 0.5 multiples; exact comparison is correct and more rigorous
- Sum invariant assertions also use `toBe` — engine's `validateHarveyTotal` already guarantees exact equality before assertions run

### File List

- `packages/engine/scripts/extract-2025-fixtures.py` — new (one-time Python extraction script)
- `packages/engine/src/fixtures/season-2025/fixture-types.ts` — new
- `packages/engine/src/fixtures/season-2025/round-01.json` through `round-16.json` — new (16 files)
- `packages/engine/src/fixtures/season-2025/season-standings.json` — new
- `packages/engine/src/season-2025.test.ts` — new
- `packages/engine/src/vitest-globals.d.ts` — new
- `packages/engine/src/harvey.ts` — modified (bonusPerPlayer param on calculateHarveyPoints; combined-drops in calculateSeasonTotal)
- `packages/engine/src/validation.ts` — modified (bonusPerPlayer param on validateHarveyTotal)
- `packages/engine/src/harvey.test.ts` — modified (2 tests updated for combined-drops behavior)
