# Story 1.8: Historical Data Validation Gate

Status: review

## Story

As the league commissioner,
I want the engine validated against all 15 played rounds of the 2025 season before the app goes live,
So that I can be certain the Harvey Cup scoring math is correct before the first official 2026 round.

## Acceptance Criteria

1. **Given** the 2025 season Excel at `reference/scorecards/Wolf Cup 2025 Final Sheet Season Ended.xlsm`
   **When** the one-time extraction script is run
   **Then** it produces 15 JSON fixture files in `packages/engine/src/fixtures/season-2025/`
   **And** each fixture contains per-player Stableford scores, money balances, and the Excel-calculated Harvey Cup points for that round
   **And** a `season-standings.json` file captures each player's expected season totals (for drop-score validation)

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

- [ ] Task 1: Map Excel Standings sheet structure and write extraction script (AC: 1)
  - [ ] 1.1 Read `xl/worksheets/sheet2.xml` from the xlsm zip with full cell references (e.g. `F5`, `G6`) to map exact column positions for Score, Harvey, Money, H Rank, M Rank per round
  - [ ] 1.2 Map which rows belong to which player (3 rows per player: stableford score row, harvey points row, cash row)
  - [ ] 1.3 Identify round column offsets (5 columns per round: Score, Harvey, Money, H Rank, M Rank)
  - [ ] 1.4 Write extraction script `packages/engine/scripts/extract-2025-fixtures.ts` using Node.js built-ins (`fs`, `zlib`) + `fast-xml-parser` to parse the ZIP/XML
  - [ ] 1.5 Script outputs `packages/engine/src/fixtures/season-2025/round-01.json` through `round-15.json`
  - [ ] 1.6 Script outputs `packages/engine/src/fixtures/season-2025/season-standings.json`
  - [ ] 1.7 Run extraction script, manually verify 2–3 known values against the open Excel (e.g. Pierson round 1 Stableford=35, Harvey=?)
  - [ ] 1.8 Commit generated fixture JSON files

- [ ] Task 2: Define fixture TypeScript types (AC: 1–5)
  - [ ] 2.1 Create `packages/engine/src/fixtures/season-2025/fixture-types.ts` with:
    - `PlayerRoundFixture`: `{ name: string; stableford: number; money: number; expectedHarveyStableford: number; expectedHarveyMoney: number; }`
    - `RoundFixture`: `{ round: number; date: string; players: readonly PlayerRoundFixture[]; }`
    - `PlayerSeasonStandings`: `{ name: string; roundsPlayed: number; roundsDropped: number; expectedSeasonStableford: number; expectedSeasonMoney: number; }`
    - `SeasonStandings`: `{ players: readonly PlayerSeasonStandings[]; }`

- [ ] Task 3: Write validation test suite (AC: 2–5)
  - [ ] 3.1 Create `packages/engine/src/season-2025.test.ts`
  - [ ] 3.2 Load all 15 round fixtures from JSON; for each round: build `HarveyRoundInput[]` from stableford+money, call `calculateHarveyPoints`, assert `stablefordPoints` and `moneyPoints` match expected (tolerance: ±0.01 for float rounding)
  - [ ] 3.3 Load `season-standings.json`; for each player: collect their `HarveyRoundResult[]` across all rounds they played, call `calculateSeasonTotal`, assert season stableford and money totals match expected
  - [ ] 3.4 On failure, throw with diagnostic: `Round ${round} (${date}): ${playerName} stablefordPoints — engine: ${actual}, expected: ${expected}`
  - [ ] 3.5 Verify sum invariants hold for every round: `sumOf(stablefordPoints) === N*(N+1)/2` and same for money (validates no data corruption in fixtures)

- [ ] Task 4: Add `fast-xml-parser` dev dependency and extraction script runner (AC: 1)
  - [ ] 4.1 `pnpm --filter @wolf-cup/engine add -D fast-xml-parser` (for extraction script only; not used in production engine)
  - [ ] 4.2 Add `"extract-fixtures": "tsx scripts/extract-2025-fixtures.ts"` script to `packages/engine/package.json`
  - [ ] 4.3 Ensure fixtures directory is committed (not gitignored)

- [ ] Task 5: Run full suite and confirm CI gate (AC: 4)
  - [ ] 5.1 `pnpm --filter @wolf-cup/engine exec vitest run` — all tests pass (393 previous + 15+ new fixture tests)
  - [ ] 5.2 `pnpm --filter @wolf-cup/engine typecheck` — zero errors
  - [ ] 5.3 `pnpm -r lint` — zero warnings

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

### Completion Notes List

### File List
