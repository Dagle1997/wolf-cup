# T2-4: Course Validator

## Status

Ready for Dev

## Story

As a developer (consumed by T2-3 parser output and T2-5 admin form submission),
I want a pure validator function that rejects malformed course data — including printed-vs-computed totals mismatches that catch OCR errors,
So that bad data never reaches the courses tables and the smoke-test data-quality issues observed in T2-3 / T2-3a (Pinehurst No. 2 par-sum mismatch, Talamore CC yardage-key mismatch, Tobacco Road `name="Player"`) are caught by automation rather than by post-deploy human discovery.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files in this story.** Pure-logic backend addition. Every edit lands inside `apps/tournament-api/src/engine/**` (NEW directory, ALLOWED) + tests in same directory + a story-file. Specifically:

- No `package.json` dep additions — Zod is already a tournament-api dep (used by T2-3's parser); validator uses native TypeScript / discriminated-union patterns; no new packages.
- No `docker-compose.yml` changes (no env vars, no new services).
- No `pnpm-lock.yaml` changes (consequence of zero new deps).
- No `Dockerfile` changes.
- No CI changes.
- No DB migrations.
- No route changes — T2-4 ships only the validator. T2-3 parser ALREADY emits the data shape `validateCourse` consumes; T2-5 (next story) is the consumer that wires the validator into the admin save endpoint. T2-4 ships standalone — its tests are the only consumer until T2-5.
- Wolf Cup is untouched (FD-1 / FD-2 held). Note: the engine directory naming (`apps/tournament-api/src/engine/`) is intentional — mirrors the Wolf Cup convention without crossing into Wolf Cup paths (Wolf Cup's engine is at `packages/engine/`, FORBIDDEN).

### 2. Scope: pure-function validator only

`validateCourse` is a pure synchronous function. NO async, NO DB queries, NO I/O, NO global state, NO logging side-effects. Given the same input it ALWAYS returns the same output — testable by simple `expect(validateCourse(input)).toEqual(expected)` assertions, no mocking required.

The function consumes the EXACT `ParsedCourse` shape exported by `apps/tournament-api/src/lib/course-parser.ts`:

```ts
type ParsedCourse = {
  name: string;
  club_name: string;
  tees: Array<{ color: string; rating: number; slope: number }>;
  holes: Array<{ number: number; par: number; si: number; yardages: Record<string, number> }>;
  totals: { out_total: number; in_total: number; course_total: number };
};
```

T2-3's `ParsedCourseSchema` (Zod) validates basic shape (types, ranges already in scope for the Anthropic strict-mode-bypass-via-Zod-reparse). T2-4's validator goes BEYOND shape validation to check **cross-field invariants** that Zod cannot natively express:

- Printed totals (out/in/course) match computed sums (catches OCR errors)
- SI sequence is exactly the set {1, 2, ..., 18}, no duplicates, no gaps, no extras
- Hole `number` sequence is exactly the set {1, 2, ..., 18}, no duplicates, no gaps, no extras
- Yardage keys per hole exactly match the declared `tees[].color` set (no missing tee yardages, no extra orphan keys)

These are the data-quality checks T2-3's Anthropic Vision parser CANNOT enforce in the system prompt or tool-schema (Anthropic's strict-mode subset only validates type/enum/required/additionalProperties — see T2-3 Risk Acceptance §8). They MUST live in pure code.

### 3. Output shape: `{ valid: boolean, errors: string[] }`

Per the epic AC:

```ts
type ValidationResult = { valid: true; errors: [] } | { valid: false; errors: [string, ...string[]] };
```

The discriminated union ties `valid: true` to `errors: []` and `valid: false` to a non-empty error array — TypeScript checks at compile time that no caller treats a `valid: false` result as having no errors.

Each error is a human-readable string suitable for surfacing to the organizer (T2-5's admin UI will display these). Exact templates pinned in §6 below; representative examples: `"Hole 4 par is 6; must be 3, 4, or 5"`, `"Stroke indexes do not form 1..18: missing [], duplicate [4], extra []"`, `"Printed out_total 36 != computed sum of front-9 par 37"`.

The validator collects ALL errors across all rules — does NOT short-circuit on first failure. An organizer running the validator on a parsed scorecard with 3 distinct issues sees all 3 in one pass, not one-fix-then-redo for 3 cycles.

### 4. Validation rules (each rule = one rejection mode = one or more tests)

The validator runs the following checks in order. Order is structural-first (cheap) → cross-field-second (expensive):

**A. Required-field presence + type-shape sanity** — these are mostly Zod's job, but the validator double-checks defensively:
1. `name` is a non-empty string after trim. (Zod enforces this on parser output; validator catches admin-form-submit cases where Zod isn't applied yet.)
2. `club_name` is a non-empty string after trim.
3. `tees` is an array with ≥1 entry.
4. Every `tees[]` entry has `color` (non-empty), `rating` (positive number), `slope` (integer, 55..155).
5. `holes` is an array with EXACTLY 18 entries.
6. `totals` has `out_total`, `in_total`, `course_total` (all positive integers).

**B. Hole-index cross-field invariants:**
7. Every `holes[].number` is a unique integer in {1..18}; the set must be EXACTLY {1, 2, 3, …, 18} (no duplicates, no gaps, no values outside the range).
8. Every `holes[].par` ∈ {3, 4, 5}.
9. Every `holes[].si` is a unique integer in {1..18}; the set must be EXACTLY {1, 2, 3, …, 18} (same constraint as `number` but on stroke index).

**C. Tee + yardage cross-field invariants:**
10. Tee colors are unique within `tees[]` (no two tees with the same `color` string).
11. For every hole, `Object.keys(holes[].yardages)` set EQUALS the set of `tees[].color`. No missing keys (e.g., tee declared but yardage absent for that hole). No extra keys (e.g., yardage present for an undeclared tee).
12. Every yardage value is a non-negative integer.

**D. Printed-vs-computed totals invariants** (the OCR-error catch). **PREREQUISITE: rules 5 (holes length = 18) AND 7 (hole-number bijection) MUST pass before rules 13-17 run. If either prerequisite fails, rules 13-17 are SKIPPED (produce no errors) — this avoids meaningless or implementation-throwing computations when the holes structure is malformed. The "no short-circuit" rule still applies WITHIN sets of independent rules; this is an explicit cross-rule prerequisite, not short-circuit.**
13. After sorting holes by `number`, compute `computed_out = sum(par)` for holes with number 1-9, `computed_in` for 10-18, `computed_course = computed_out + computed_in`. (No error emitted; this rule provides the computed values consumed by 14-17.)
14. Reject if `printed.out_total !== computed_out`. Single error; format pinned in §6.
15. Reject if `printed.in_total !== computed_in`. Single error.
16. Reject if `printed.course_total !== computed_course`. Single error.

**E. Printed-internal-consistency** (catches printed-totals-self-contradicting cases):
17. Reject if `printed.out_total + printed.in_total !== printed.course_total`. Distinct from 14/15/16: catches the rare case where printed totals are internally inconsistent (e.g., model OCR'd front=36, back=36, course=70 — even if the per-half values match the per-hole sums, the course total is internally wrong). Non-redundant because rule 17 fires regardless of whether 14/15/16 detected a mismatch.

**Error-cardinality policy (resolves spec ambiguity):**

| Rule | Cardinality | Rationale |
|---|---|---|
| 1, 2, 3, 5, 6, 7, 9, 10, 14, 15, 16, 17 | **AT MOST ONE error per call** | Set-mismatch and aggregate rules describe the whole-input violation in one message |
| 4 (tee field invalidity) | **ONE error per offending field on each offending tee** | A tee with both bad slope AND bad rating produces 2 errors (one per offending field). A course with 2 bad tees having 1 bad field each produces 2 errors. Fields checked per tee: `color` (non-empty), `rating` (positive), `slope` (integer 55..155). |
| 8 (par ∉ {3,4,5}) | **ONE error per offending hole** | A course with 3 bad pars produces 3 errors; surface all fixable rows to T2-5 UI |
| 11 (yardage keys mismatch) | **AT MOST ONE error per call** — uses the FIRST detected mismatching hole as the locator | In practice, key-mismatch is structural (same mismatch on every hole, e.g., parser emitted 9 tees but yardages only for 5). Per-hole would produce 18 duplicate messages. Single error names the first hole + lists the missing/extra keys |
| 12 (negative or non-integer yardage) | **ONE error per offending (hole, tee) pair** | A scorecard with a misread yardage cell produces one per cell |

Total: up to ~14 single errors + per-violation errors from rules 4, 8, 12 = up to ~50 error strings on a maximally-broken input. In practice, real organizer inputs produce 0 (valid) or 1-2 errors.

### 5. Sort-by-hole-number normalization

The `holes` array MAY arrive out-of-order (e.g., the parser emits holes in the visual layout order on a card that displays back-9 above front-9, or T2-5's admin form lets the organizer enter rows in any order before save). The validator MUST sort internally by `holes[].number` before computing totals. Otherwise rule #13 would falsely reject correctly-printed totals when the array is shuffled.

The sort is local to the validator — input array is NOT mutated. (`[...holes].sort((a, b) => a.number - b.number)` pattern.) Sorting happens AFTER the hole-numbers-are-1-to-18-bijection check, so the sort key is guaranteed to be unique.

### 6. Error message stability (test pinning)

Test assertions match the exact error strings. For each rule, the spec pins the error format so test changes are visible in code review.

**Deterministic ordering inside bracketed lists** (so tests can match exact strings):
- Numeric values (hole numbers, SIs): **ascending numeric order**.
- String values (tee colors, yardage keys): **lexicographic ascending** (default JavaScript `Array.prototype.sort()` order — matches `["Blue", "Gold", "Red"]` not `["Red", "Blue", "Gold"]`).

**Set-mismatch error template — 3-slot variant** (rules 7, 9 only — both check arrays where duplicates are possible). All three slots ALWAYS appear, empty as `[]`:
```
"<set-name> do not form <expected>: missing [<asc-numeric>], duplicate [<asc-numeric>], extra [<asc-numeric>]"
```

Concrete examples (3-slot):
- Rule 7 (hole-numbers, dup+missing): `"Hole numbers do not form 1..18: missing [7], duplicate [4], extra []"` — 18 entries `{1,2,3,4,4,5,6,8..18}`: hole 4 appears twice, hole 7 absent.
- Rule 7 (out-of-range): `"Hole numbers do not form 1..18: missing [18], duplicate [], extra [19]"` — 18 entries `{1..17, 19}`: hole 18 absent, value 19 outside range.
- Rule 9 (SIs, dup): `"Stroke indexes do not form 1..18: missing [4], duplicate [11], extra []"` — 18 entries with SI 11 twice and SI 4 absent.

**Set-mismatch error template — 2-slot variant** (rule 11 ONLY). JS objects cannot have duplicate keys, so the `duplicate` slot is structurally impossible and dropped. Both `missing` and `extra` slots ALWAYS appear, empty as `[]`. Sort is **lexicographic ascending** (string keys):
```
"Hole <N> yardage keys [<lex-asc>] don't match declared tee colors [<lex-asc>]: missing [<lex-asc>], extra [<lex-asc>]"
```

Concrete example (2-slot): `"Hole 4 yardage keys [Blue, Gold, Red] don't match declared tee colors [Blue, Gold]: missing [], extra [Red]"` — hole 4 has an extra "Red" key not declared in tees.

**Single-hole error template** (rules 8, 12) — include hole number for locator value:
- Rule 8: `"Hole 4 par is 6; must be 3, 4, or 5"`
- Rule 12: `"Hole 4 yardage for tee Blue is -50; must be a non-negative integer"`

**Totals mismatch templates** (rules 14, 15, 16) — quote both printed and computed values:
- Rule 14: `"Printed out_total 36 != computed sum of front-9 par 37"`
- Rule 15: `"Printed in_total 35 != computed sum of back-9 par 36"`
- Rule 16: `"Printed course_total 71 != computed sum of all 18 par 73"`

**Printed-internal-consistency template** (rule 17):
- `"Printed totals inconsistent: out_total 36 + in_total 35 = 71, but course_total 72"`

**Other single-error templates** (rules 1-6, 10):
- Rule 1: `"name must be a non-empty string"`
- Rule 2: `"club_name must be a non-empty string"`
- Rule 3: `"tees must be a non-empty array"`
- Rule 4 (ONE error per offending field on each offending tee per the cardinality policy):
  - `"tees[2] color must be a non-empty string"`
  - `"tees[2] rating -5 must be a positive number"`
  - `"tees[2] slope 200 is outside the valid range 55-155"`
  A tee with both bad slope AND bad rating produces 2 separate error entries.
- Rule 5: `"holes must have exactly 18 entries (got 17)"`
- Rule 6: `"totals must include positive-integer out_total, in_total, course_total"`
- Rule 10: `"Duplicate tee color: Blue"` (single error per call, lists first detected duplicate; if multiple duplicate-pairs exist, document choice in completion notes)

This is **error-message engineering**: the messages MUST be useful enough that an organizer reading them in T2-5's admin UI knows which row to fix without consulting documentation.

### 7. Test coverage (mandatory)

- **≥17 unit tests at minimum** (one per rule), more for set-mismatch rules where edge cases (duplicate AND missing simultaneously, all duplicates, etc.) deserve their own assertions.
- **5 happy-path tests** — ONE per seeded Pinehurst course (Pine Needles, Mid Pines, Pinehurst No. 2, Talamore Golf Resort, Tobacco Road Golf Club). The validator must return `{ valid: true, errors: [] }` for each course constructed from the seed data. **Note:** Pinehurst No. 2's par-sum divergence (claimedPar=72, actualHolePars=73) is handled by `seed.ts` storing the COMPUTED value (73). When the test reads from the seed JSON, the totals are already self-consistent — the validator passes because what's stored matches what's computed. The seed-divergence behavior is preserved as-is; T2-4 does NOT alter seed.ts.
- **2-3 multi-error tests** — feed the validator inputs with multiple distinct issues, assert that ALL are returned in the errors array (validates the no-short-circuit contract).
- **No real-API smoke** — pure logic, fully covered by unit tests.

### 8. File location: `apps/tournament-api/src/engine/validators/course.ts`

The `engine/` directory under tournament-api is NEW — created by this story. Naming mirrors the Wolf Cup convention (`packages/engine/`) where pure validation/calculation logic lives. The tournament-app intentionally puts its engine modules under `apps/tournament-api/src/engine/` rather than a new top-level package because:

- Shared-package extraction is premature (no consumers outside tournament-api yet).
- Path classification is simpler — everything stays inside `apps/tournament-api/**` (ALLOWED).
- Future stories may extract `tournament-api/src/engine/**` into `packages/tournament-engine/` if/when the tournament-web SPA needs to call validation client-side.

Test file co-located: `apps/tournament-api/src/engine/validators/course.test.ts`.

### 9. Why this story is "tight"

T2-4 has unusually low spec risk:

- Pure function, no I/O, no dependencies on schema migrations
- Input shape (`ParsedCourse`) is already stable from T2-3 + T2-3a
- All test inputs are JSON literals — no fixtures, no mocks
- No external API calls, no live-API smoke required
- Zero SHARED-gate edits, zero new dependencies
- Establishes `engine/` directory pattern; future tournament-app pure-logic stories use the same path

The cycle should converge fast. Spec codex will likely PASS round-1 or PASS-with-Lows; impl codex same.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/engine/validators/course.ts` (NEW file)
   **When** inspected post-T2-4
   **Then** it exports a single named function:
   ```ts
   export function validateCourse(course: ParsedCourse): ValidationResult;
   export type ValidationResult =
     | { valid: true; errors: [] }
     | { valid: false; errors: [string, ...string[]] };
   ```
   The function imports `ParsedCourse` from `'../../lib/course-parser.js'` (the existing T2-3 export). Pure synchronous: no `async`, no Promise return type, no DB queries, no `console.log`, no `Math.random`, no `Date.now`, no env reads. Same input → same output, every call.

2. **Given** the validator running on a fully-valid `ParsedCourse`
   **When** invoked
   **Then** it returns `{ valid: true, errors: [] }` — the empty-array variant of the discriminated union.

3. **Given** the validator running on an INVALID input (any rule from §4 fails)
   **When** invoked
   **Then** it returns `{ valid: false, errors: [<≥1 error string>] }`. The validator does NOT short-circuit on the first failure — it runs all rules and accumulates errors, EXCEPT for the cross-rule prerequisite where rules 13-17 (totals comparisons) skip if rules 5 (holes length=18) or 7 (hole-number bijection) failed. Test coverage includes a multi-error case AND a "malformed-holes prerequisite" case asserting that totals errors are NOT emitted when rule 5 or 7 fails.

4. **Given** rules 1-6 (required-field presence + type-shape sanity)
   **When** any field is missing, empty, wrong-typed, or out-of-range
   **Then** a descriptive error string is added to `errors`. Examples:
   - `"name must be a non-empty string"`
   - `"tees must be a non-empty array"`
   - `"tees[2] slope 200 is outside the valid range 55-155"`
   - `"holes must have exactly 18 entries (got 17)"`

5. **Given** rule 7 (hole `number` set is exactly {1..18})
   **When** the holes array contains a duplicate, gap, or out-of-range hole number
   **Then** an error like `"Hole numbers do not form 1..18: missing [7], duplicate [4], extra []"` is added per the §6 3-slot template. All three slots ALWAYS appear (empty arrays render as `[]`); brackets list specific offenders in numeric ascending order so tests can match exact strings.

6. **Given** rule 8 (par ∈ {3, 4, 5})
   **When** any hole has par outside that set
   **Then** an error like `"Hole 4 par is 6; must be 3, 4, or 5"` is added. ONE error per offending hole — multiple bad pars produce multiple error entries.

7. **Given** rule 9 (SI set is exactly {1..18})
   **When** the SIs have duplicates, gaps, or out-of-range values
   **Then** an error like `"Stroke indexes do not form 1..18: missing [7], duplicate [4], extra []"` is added per the §6 3-slot template. Same format as rule 7's hole-number check (consistent error-message family).

8. **Given** rule 10 (tee colors unique)
   **When** two tees declare the same `color` (e.g., both "Blue")
   **Then** an error like `"Duplicate tee color: Blue"` is added. Uniqueness is case-sensitive (matches Zod's behavior on string keys).

9. **Given** rule 11 (yardage keys match tee colors)
   **When** a hole's `yardages` object has keys that don't match the declared tee-color set (extra keys, missing keys, or both)
   **Then** an error like `"Hole 4 yardage keys [Blue, Gold, Red] don't match declared tee colors [Blue, Gold]: missing [], extra [Red]"` is added per the §6 2-slot template (rule 11's exception — JS objects cannot have duplicate keys, so the duplicate slot doesn't apply; missing/extra suffices). String values are sorted lexicographic-ascending. Locator hole number is the FIRST detected mismatching hole per the cardinality policy in §4.

10. **Given** rule 12 (yardages are non-negative integers)
    **When** any yardage value is negative or non-integer
    **Then** an error like `"Hole 4 yardage for tee Blue is -50; must be a non-negative integer"` is added.

11. **Given** rules 13-16 (printed-vs-computed totals — see §4D)
    **When** any printed total disagrees with the computed sum of relevant pars
    **Then** up to 3 errors are added (one per mismatch: out_total, in_total, course_total) using the templates pinned in §6. The validator sorts the holes array by `holes[].number` internally before computing — handles the case where the parser emits holes out of order. **Prerequisite contract:** rules 13-17 SKIP entirely (produce no errors) if rule 5 (holes length=18) OR rule 7 (hole-number bijection) failed — running totals computation on a malformed holes array would produce meaningless errors or throw. This is an explicit cross-rule prerequisite, NOT a violation of the no-short-circuit rule (which applies WITHIN sets of independent rules).

12. **Given** rule 17 (printed totals internally consistent)
    **When** `printed.out_total + printed.in_total !== printed.course_total`
    **Then** an error like `"Printed totals inconsistent: out_total 36 + in_total 35 = 71, but course_total 72"` is added.

13. **Given** `apps/tournament-api/src/engine/validators/course.test.ts` (NEW file)
    **When** the suite runs post-T2-4
    **Then** at least 17 unit tests exist (one per rule from §4), plus 5 happy-path tests (one per seeded Pinehurst course constructed from `reference/pinehurst-may-2026-courses.json` data — built as JSON literals in the test file, NOT loaded from disk; tests stay pure). Plus 2-3 multi-error tests asserting the no-short-circuit contract. Total ≥25 new tests.

14. **Given** the 5 seeded Pinehurst courses
    **When** validated as ParsedCourse-shape inputs constructed in the test file as JSON literals
    **Then** all 5 return `{ valid: true, errors: [] }`.

    **Test construction guidance** (resolves the seed-correction ambiguity): the test file builds 5 ParsedCourse JSON literals matching the seed JSON's holes + tees data, BUT the literal's `totals` field is set to the COMPUTED sums of the literal's own holes (not the seed JSON's `claimedPar`). This makes the literal self-consistent without requiring re-implementation of `seed.ts`'s correction logic. A test helper like `buildCourse({ name, club_name, tees, holes }) → ParsedCourse` that auto-computes totals from the holes array keeps the literals concise. T2-4 does NOT re-import or re-implement seed.ts.

    Pinehurst No. 2's seed-divergence (claimedPar=72 vs holes-sum=73) is irrelevant to T2-4's tests because the test literal uses the holes-sum (73), making the test self-consistent. T2-4 does NOT alter `seed.ts`.

15. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint`
    **When** run post-T2-4
    **Then** both exit 0. No new `any` types. No new `// eslint-disable` comments. The discriminated `ValidationResult` union is correctly narrowed at every consumer (the test file's assertions).

16. **Given** `pnpm -F @tournament/api test`
    **When** run post-T2-4
    **Then** total tests ≥ baseline + 25 (per AC #13). Existing tests continue to pass with zero count loss. T2-4 baseline at story start is captured here for delta arithmetic: ____ (filled in by dev agent before any code edits).

17. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T2-4
    **Then** both continue to pass with zero net-negative test count change. T2-4 does not touch `apps/api/**`, `apps/web/**`, or `packages/engine/**`. The naming "engine" in the new `apps/tournament-api/src/engine/` directory does NOT conflict with `packages/engine/` (Wolf Cup) because they're in distinct workspaces.

18. **Given** `pnpm -F @tournament/api build`
    **When** run post-T2-4
    **Then** exits 0 and emits `dist/engine/validators/course.js`. The build output layout is unchanged otherwise.

19. **Given** `apps/tournament-api/src/routes/admin-courses.ts` (the T2-3 + T2-3a route handler)
    **When** inspected post-T2-4
    **Then** **byte-identical to its T2-3a state.** T2-4 does NOT wire the validator into the parse-pdf route — the route still returns parser output as-is. T2-5 (admin save) is the consumer that calls validateCourse before persistence. Wiring T2-4 → T2-3a would couple the parser endpoint to validation logic and force a route-shape change (does parse-pdf return validation errors? Should it 200 with `errors: []` or 400 with errors?). That decision is T2-5's scope.

## Tasks / Subtasks

- [ ] Task 1: Capture pre-edit baseline test count. (AC #16)
  - [ ] Subtask 1.1: Run `pnpm -F @tournament/api test`; record total. (Currently 175 post-T2-3b.)

- [ ] Task 2: Create `apps/tournament-api/src/engine/` directory + `validators/` subdirectory. (AC #1)

- [ ] Task 3: Implement `validateCourse` function in `course.ts`. (AC #1, #2, #3)
  - [ ] Subtask 3.1: Define `ValidationResult` discriminated union type.
  - [ ] Subtask 3.2: Implement rules 1-6 (required-field presence + type-shape sanity).
  - [ ] Subtask 3.3: Implement rules 7-9 (hole-index + SI invariants).
  - [ ] Subtask 3.4: Implement rules 10-12 (tee + yardage invariants).
  - [ ] Subtask 3.5: Sort-by-hole-number normalization (per Risk Acceptance §5).
  - [ ] Subtask 3.6: Implement rules 13-17 (printed-vs-computed totals + internal consistency).
  - [ ] Subtask 3.7: Accumulate errors (no short-circuit) — verify via unit test.
  - [ ] Subtask 3.8: Return discriminated-union shape with TypeScript narrowing.

- [ ] Task 4: Write `course.test.ts` rejection-mode tests. (AC #4-#12, #13)
  - [ ] Subtask 4.1: ≥17 unit tests, one per rule. Each constructs a minimal-valid `ParsedCourse`, mutates one field to violate one rule, asserts the specific error message.
  - [ ] Subtask 4.2: 2-3 multi-error tests confirming no-short-circuit (input violates 3 rules → returned errors array contains 3 entries).

- [ ] Task 5: Write happy-path tests for the 5 seeded Pinehurst courses. (AC #14)
  - [ ] Subtask 5.1: Build 5 JSON literals matching the seed JSON's data (for the 5 courses' tees + holes + totals). Test file stays pure — does NOT read the seed file at test time, just constructs the equivalent object literals.
  - [ ] Subtask 5.2: Each test asserts `validateCourse(course).valid === true` AND `errors === []`.

- [ ] Task 6: Run regressions. (AC #15, #16, #17, #18)
  - [ ] Subtask 6.1: `pnpm -F @tournament/api typecheck` clean.
  - [ ] Subtask 6.2: `pnpm -F @tournament/api lint` clean.
  - [ ] Subtask 6.3: `pnpm -F @tournament/api test` — total = baseline + ≥25.
  - [ ] Subtask 6.4: `pnpm -F @tournament/api build` clean.
  - [ ] Subtask 6.5: `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` — both unchanged.

- [ ] Task 7: Document in story completion notes.
  - [ ] Subtask 7.1: Final test count delta.
  - [ ] Subtask 7.2: Capture the rejection-modes-tested list as a checklist for T2-5 to consume (T2-5 will surface these errors in the admin UI; the spec → test → error-message chain documents what UI strings T2-5 needs to handle).

## Dev Notes

- **Why a separate validator function (vs. just using ParsedCourseSchema's Zod):** Zod validates structural shape and type ranges, but cross-field invariants (printed totals match computed; SI set is exactly 1..18; yardage keys match tee colors) require Zod's `.refine()` or `.superRefine()` — which are awkward to test independently and don't compose well. A pure validator function is easier to reason about, easier to test, and easier to reuse from both T2-3's parser path AND T2-5's admin-form path without coupling to a specific schema instance.

- **Why `errors: string[]` not `errors: ValidationError[]` (typed errors):** for v1, string error messages are sufficient. T2-5's UI just renders them as-is. A typed error class hierarchy would add complexity (Builder pattern, error-class registry, JSON serialization concerns) for marginal benefit. If a future story wants to localize errors or programmatically classify them, a typed-error-class refactor is a future story (not v1).

- **Why no short-circuit:** an organizer running validation on a parsed scorecard wants to see ALL issues at once, not "fix one error, re-run, see next error, repeat." The cost of running all 17 rules even when rule #1 already failed is microseconds — irrelevant compared to the UX benefit.

- **Why the tee-color set comparison ignores order:** course tees can be declared in any order (Medal first, Ross first, alphabetical, etc.). The validator uses `Set` semantics — the SET of tee-color strings must match the SET of yardage keys per hole. Order is irrelevant.

- **Why local sort instead of asserting input is sorted:** the parser may emit holes in visual-layout order (some scorecards display holes 10-18 in the top row, 1-9 below). T2-5's admin form may let users enter rows in any order. Validator-internal sort handles both cases without forcing the producers to be sorted-correct.

- **Why no validator wiring to T2-3a's parse-pdf endpoint (AC #19):** the route currently returns `200 { ...parsedCourse }`. Wiring the validator would force a decision: does the route 200 with `{ ...parsedCourse, valid, errors }` (changes the response shape — breaks T2-3 / T2-3a contract), or 400 with `{ errors }` (changes error-handling semantics from "model couldn't parse" to "model parsed but data is bad", which conflates two distinct failure modes). T2-5 is the right place to wire validation — its admin save endpoint is the boundary where data enters the DB, and its UI naturally separates "parse succeeded; here's a review form with validation hints" from "parse failed; try again or enter manually."

- **Why this is a "tight" story:** see Risk Acceptance §9. Pure logic + stable input shape + no dependencies = predictable cycle. Spec codex likely PASS round-1; impl codex same.

- **Wolf Cup isolation (FD-1/FD-2):** T2-4 writes only to `apps/tournament-api/src/engine/validators/course.{ts,test.ts}` (NEW directory under ALLOWED). Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`, `apps/tournament-web/**`, or any root file. The `engine/` directory naming is intentional — mirrors the Wolf Cup `packages/engine/` convention without crossing into Wolf Cup paths.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same for impl codex.
- **Retro AI-2 applied:** zero SHARED files this story. No gates expected.
- **Retro AI-3 applied:** the discriminated-union `ValidationResult` shape IS the contract. Tests are written first to pin error messages before refactoring the validator implementation.

### Project Structure Notes

Shape after T2-4:

```
apps/tournament-api/
  src/
    engine/                              # NEW directory
      validators/                        # NEW subdirectory
        course.ts                        # NEW: validateCourse + ValidationResult export
        course.test.ts                   # NEW: ≥25 unit tests (rejection modes + happy paths + multi-error)
```

**No new files outside that path.** No edits to `routes/`, `lib/`, `middleware/`, or any other existing module.

**Explicitly NOT in T2-4 (reserved for T2-5 or future):**
- Wiring validator into the `/api/admin/courses/parse-pdf` route — T2-5 admin save flow is the boundary.
- Wiring validator into a hypothetical `POST /api/admin/courses` save endpoint — also T2-5.
- Localized / i18n error messages — future story when localization is in scope.
- Typed-error-class hierarchy — future story if validator consumers need programmatic error handling.
- Server-side full schema persistence consistency check (e.g., "this club_name already exists") — different concern, future story.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T2.4 (line 744).
- Predecessor stories: T2-3 (`cd587a0`), T2-3a (`119b39d`), T2-3b (`1edec19`). T2-3's `ParsedCourse` shape is the validator's input contract.
- Seed data reference: `reference/pinehurst-may-2026-courses.json` — the 5 courses' canonical data.
- Seed-corrected-totals behavior: `apps/tournament-api/src/db/seed.ts` event `seed_course_par_sum_divergence` action `storing_computed_value` — Pinehurst No. 2 specifically.
- Wolf Cup engine convention (FD-1; not edited, referenced for naming pattern): `packages/engine/`.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
