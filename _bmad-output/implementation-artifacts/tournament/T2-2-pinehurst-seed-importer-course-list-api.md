# Story T2.2: Pinehurst Seed Importer + Course List API

Status: ready-for-dev

## Story

As a developer,
I want a seed script that loads a JSON file defining 5 Pinehurst-area courses into the `courses` / `course_revisions` / `course_tees` / `course_holes` tables AND a `GET /api/courses` route that returns the loaded course library,
So that all 5 courses are present after `pnpm -F @tournament/api seed`, downstream consumers (T2.5 admin UI course picker, T3.2 event-creation course picker) have a canonical route to query, and the re-import pattern from T2-1 is exercised end-to-end.

**Scope context:** second story of Epic T2. Schema is already in place (T2-1 migration 0001). This story adds the data-loading + query-API layer. No new tables, no new migrations, no dep additions, no SHARED gates anticipated.

## Explicit Risk Acceptance (spec-gate decisions)

### 1. Seed data file already exists at `reference/pinehurst-may-2026-courses.json`

**Updated after initial spec draft missed this** — the file IS present and tracked in git. Contents: 5 courses with real scorecard data (Pine Needles, Mid Pines, Talamore, Tobacco Road from official PDFs; Pinehurst No. 2 from BlueGolf with a documented par-sum discrepancy). Matches the epic text's referenced path.

**Keep the JSON at `reference/pinehurst-may-2026-courses.json` — do NOT move it.** Already tracked; already at the epic-prescribed path; no SHARED gate needed for the path itself (file already exists). The seed script reads from this location.

Production deployment still requires COPY'ing the JSON into the container (Dockerfile update per AC #17) because the prod runtime doesn't mount the workspace root. Local dev uses `tsx` which resolves paths relative to the source tree, reading directly from `reference/`.

### 2. Seed script path: reuse existing `apps/tournament-api/src/db/seed.ts`

Epic text (line 626) says `apps/tournament-api/src/scripts/seed-live.ts` (matching Wolf Cup's `src/scripts/` location). Problem: `src/scripts/` doesn't exist in tournament-api. T1-6a shipped `src/db/seed.ts` as a placeholder seed that the Dockerfile CMD already references (`node dist/db/seed.js`). Adding `src/scripts/seed-live.ts` would require:

- A new directory.
- Updating the Dockerfile CMD (SHARED gate).
- Updating the T1-7 ESLint `no-console` file-override block (ALLOWED but more churn).

**Spec picks: rewrite the existing `src/db/seed.ts` placeholder with the real seed logic.** Dockerfile CMD stays as-is (already `node dist/db/seed.js`), T1-7's ESLint exemption for `src/db/seed.ts` stays as-is, no SHARED gate needed.

### 3. Real scorecard data present; `verified` honors source quality per-course

**Updated after initial spec draft missed the existing JSON file.** All 5 courses have real scorecard data. Four (Pine Needles, Mid Pines, Talamore, Tobacco Road) were vision-parsed from official scorecard PDFs with the source JSON's `_meta.validation` clause explicitly confirming: "pars in {3,4,5}, stroke indexes 1-18 unique per card, front/back par totals match printed Out/In."

**Pinehurst No. 2 is flagged `tentative: true` + `verified: false` in the source** with a `data_quality_note` explaining the BlueGolf scrape produced per-hole pars summing to 73 against the course's claimed par 72 (likely a mix of U.S. Open championship setup, where hole 4 is reduced to par 4, with member-tee data). The data is imported honestly: the seed computes `courseTotal` from the actual hole par sums (73, not 72) and stores `verified: false`. Operator-facing action: re-photograph the official scorecard on-site or pull from pinehurst.com PDF before the round-3 swap, then re-import via T2-3 PDF parser or T2-5 admin UI (creates a new revision with corrected data + `verified: true`).

**Verified flags at seed time:**
- Pine Needles Lodge & Golf Club → `verified: true`
- Mid Pines Inn & Golf Club → `verified: true`
- Talamore Golf Resort → `verified: true`
- Tobacco Road Golf Club → `verified: true`
- Pinehurst No. 2 → `verified: false` (honors source's `verified: false` + `tentative: true` flags)

### 3a. Ladies-specific tee fields skipped for v1

Source JSON has some tees with `gender: "F"` (e.g., Pine Needles "Forward" tee, Talamore "Red" tee) or `ladies_rating`/`ladies_slope` alongside the men's values (Tobacco Road's "Plow"/"Points"/"Cultivator"). The T2-1 schema does NOT model gender on tees (intentional v1 simplification — `course_tees` has `rating` + `slope` only).

**Spec picks: seed ingests only the primary (men's) rating + slope per tee; ladies-specific fields are skipped.** When a future story adds gender-aware tee tracking, the re-import contract lets operators upload a new revision with both sets of ratings.

Tees with `gender: "F"` explicitly (i.e. ladies-only tees) are still ingested using their `rating` + `slope` — the `gender` field is simply dropped. This matches the v1 "both sexes play the same yardage; handicap computation uses slope/rating as-is" posture.

### 4. Organizer-flag flow: optional `ORGANIZER_GOOGLE_SUB` env var

Epic text (lines 642-644) says "Josh's player record... `is_organizer = true` is set for Josh." Problem: no Josh player record exists at seed time. T1-6b created players via OAuth at sign-in, not via seed.

Three options:

A. Seed creates a placeholder `players` row for Josh with a made-up id. When Josh signs in via OAuth, the callback doesn't find his `sub` in `oauth_identities` → creates a NEW player. The placeholder is orphaned. ❌
B. Seed looks up `oauth_identities` by a known `provider_sub`; if found, sets the bound player's `is_organizer=true`. If not found, optionally pre-seeds both rows so the OAuth callback's outer SELECT finds the existing `oauth_identities` row → reuses the bound player. ✅
C. Defer the organizer-flag to a separate admin CLI invoked after Josh signs in. ❌ (violates epic AC wording)

**Spec picks option B with `ORGANIZER_GOOGLE_SUB` env var (optional):**

- If set (production deploy with Josh's Google `sub` known): the seed ensures there's an `oauth_identities` row for that sub bound to a `players` row with `is_organizer=true`. When Josh signs in, T1-6b's callback matches on the pre-seeded row and reuses the player.
- If unset (dev/test): the seed skips the organizer step and logs a notice. The organizer flag can be set manually later via `UPDATE players SET is_organizer = 1 WHERE id = ...` or a future admin tool.

The env var name `ORGANIZER_GOOGLE_SUB` is lower-risk than an email-based approach because the `sub` is stable across Google OAuth flows and doesn't expose PII through an env var name.

---

## Acceptance Criteria

1. **Given** `reference/pinehurst-may-2026-courses.json` (EXISTING file — already tracked in git; DO NOT overwrite, move, or mutate)
   **When** inspected post-T2-2
   **Then** the file is byte-unchanged by this story. The seed READS it. Observed shape (condensed; see the actual file for full detail):

   ```json
   {
     "_meta": {
       "trip": "Pinehurst May 2026",
       "extracted": "2026-04-13",
       "source_note": "Pine Needles + Mid Pines from official club scorecard PDFs (vision parse). ...",
       "validation": "All courses: pars in {3,4,5}, stroke indexes 1-18 unique per card, front/back par totals match printed Out/In."
     },
     "courses": [
       {
         "name": "Pine Needles Lodge & Golf Club",
         "location": "Southern Pines, NC",
         "designer": "Donald Ross",
         "par": 71,
         "source": "https://www.pineneedleslodge.com/.../PN-Scorecard-1.pdf",
         "tees": [
           { "name": "Medal", "rating": 74.7, "slope": 141, "yardage": 7025 },
           { "name": "Forward", "rating": 69.2, "slope": 125, "yardage": 4940 }
         ],
         "holes": [
           { "hole": 1, "par": 5, "si": 11, "yardages": { "Medal": 505, "Forward": 420 } }
         ]
       }
     ]
   }
   ```

   Observed shape differences from a naïve DB-mirror (these drive the Zod schema in AC #3 and the transforms in AC #4):

   - **Top-level:** `_meta` + `courses` array. No `generatedAt` / `provenance` / `clubName` / `outTotal`/`inTotal`/`courseTotal` at top levels — totals are COMPUTED at seed time (from hole pars); clubName is DERIVED from `name` by splitting on " Lodge " / " Inn " / " Golf " / " Resort " / " Club " — see AC #4 for the exact split rule.
   - **Per course:** `name` (natural-language, e.g. "Pine Needles Lodge & Golf Club"), `location`, optional `designer`, `par` (claimed course par — not always equal to `sum(holes[].par)`; Pinehurst No. 2 is the known case where claimed=72 but hole-sum=73), `source` (URL string), `tees` array, `holes` array, optional `verified`/`tentative`/`trip_role`/`data_quality_note` (present only on Pinehurst No. 2).
   - **Tees:** `name` (e.g. "Medal", "Ross", "Blue", "Gold", "Ripper"), NOT `color`. `rating` is a FLOAT (e.g. `74.7`). `slope` integer. Optional `yardage` (ignored at seed — T2-1 schema doesn't store it). Optional `gender`/`ladies_rating`/`ladies_slope` — **SKIPPED for v1** per risk-acceptance §3a.
   - **Holes:** `hole` (not `holeNumber`). `par`, `si`, `yardages` keyed by tee NAME. Optional `_note` field (e.g. Pinehurst No. 2 hole 4's championship-vs-member note) — IGNORED at seed (not persisted; diagnostic metadata only).
   - **Extraction date:** `_meta.extracted` (YYYY-MM-DD string like `"2026-04-13"`). Seed converts to ms via `Date.parse(_meta.extracted + 'T00:00:00.000Z')` at import time for stable, timezone-independent idempotency. Derived value: `1776038400000` for the current file.
   - **Verified flag:** default `true` for each course UNLESS the course has `"verified": false` in the source. Only Pinehurst No. 2 has explicit `verified: false` + `tentative: true` today.

2. **Given** `apps/tournament-api/src/db/seed.ts` (existing file, T1-6a placeholder)
   **When** inspected post-T2-2
   **Then** the placeholder content (single `console.log` line) is REPLACED with real seed logic:
   - Imports: `fs`, `path`, `url` (node built-ins); `z` from `zod`; `db` + schemas from the existing tournament-api paths; `logger` from T1-7 (`./lib/log.js` — relative path: `../lib/log.js` from `src/db/`).
   - Exports a `runSeed(data: SeedData): Promise<SeedReport>` function that takes the parsed JSON object and returns a report object `{ coursesInserted: number, coursesSkipped: number, revisionsInserted: number, revisionsSkipped: number, teesInserted: number, holesInserted: number }`.
   - Exports a `promoteOrganizer(sub: string): Promise<OrganizerResult>` where `OrganizerResult = { action: 'promoted' | 'preseeded' | 'already_set'; playerId: string }` — structured return so the CLI wrapper can log + report consistently.
   - The module's bottom executes as a CLI entrypoint ONLY when invoked directly (not when imported by tests). The ESM-idiomatic guard uses `fileURLToPath` + `resolve` to normalize both sides of the comparison to absolute paths, which handles Windows (`D:\...`) and POSIX (`/...`) uniformly:
     ```ts
     import { fileURLToPath } from 'node:url';
     import { resolve } from 'node:path';

     const isCli =
       process.argv[1] !== undefined &&
       resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
     if (isCli) {
       // CLI: read JSON, validate via Zod, invoke runSeed(data), optionally
       // invoke promoteOrganizer, log the report, call process.exit(0).
     }
     ```
     This avoids the `file://` URL vs. bare-path mismatch that bit the earlier draft (Windows `process.argv[1]` is a bare path like `D:\wolf-cup\...`; `import.meta.url` is `file:///D:/wolf-cup/...`; interpolating backticks as `file://${path}` would produce a 2-slash URL that never matches the 3-slash `import.meta.url`).

     **Without this guard, importing `runSeed` or `promoteOrganizer` from `seed.test.ts` would trigger a full CLI execution on test load.**
   - The existing ESLint `no-console` file-override for `src/db/seed.ts` (T1-7) is preserved. The seed uses `logger.info({...})` for structured output; `console.*` is allowed by the override if the dev prefers for the boot-time "done" line.

3. **Given** a Zod schema for the seed JSON shape (matching the observed file)
   **When** inspected
   **Then** `seed.ts` defines `SeedTeeSchema`, `SeedHoleSchema`, `SeedCourseSchema`, `SeedDataSchema` that enforce:

   ```ts
   const SeedTeeSchema = z.object({
     name: z.string().min(1),
     rating: z.number().positive(),              // FLOAT in source (e.g. 74.7); transformed × 10 at insert
     slope: z.number().int().positive(),
     yardage: z.number().int().nonnegative().optional(),  // ignored at insert; present in source
     gender: z.string().optional(),              // v1 skip: see risk-acceptance §3a
     ladies_rating: z.number().positive().optional(),     // v1 skip
     ladies_slope: z.number().int().positive().optional(),// v1 skip
   });

   const SeedHoleSchema = z.object({
     hole: z.number().int().min(1).max(18),
     par: z.number().int().min(3).max(5),
     si: z.number().int().min(1).max(18),
     yardages: z.record(z.string(), z.number().int().nonnegative()),
     _note: z.string().optional(),               // diagnostic; not persisted
   });

   const SeedCourseSchema = z.object({
     name: z.string().min(1),
     location: z.string().min(1),
     designer: z.string().optional(),
     par: z.number().int().positive(),           // claimed par — may differ from hole-par-sum (Pinehurst No. 2)
     source: z.string().url(),                   // always present in current file; required
     tees: z.array(SeedTeeSchema).min(1),
     holes: z.array(SeedHoleSchema).length(18),
     verified: z.boolean().optional(),           // default true if absent
     tentative: z.boolean().optional(),          // diagnostic; not persisted
     trip_role: z.string().optional(),           // diagnostic; not persisted
     data_quality_note: z.string().optional(),   // diagnostic; not persisted
   });

   const SeedDataSchema = z.object({
     _meta: z.object({
       trip: z.string().min(1),
       extracted: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
       source_note: z.string().optional(),
       validation: z.string().optional(),
     }),
     courses: z.array(SeedCourseSchema).min(1),
   });
   ```

   Zod parse failure → `logger.error({event: 'seed_schema_invalid', path, message})` + `process.exit(1)`.

   **Additional invariant checks BEFORE insert (catch bad data the schema alone can't):**

   - `sum(holes.map(h => h.par))` equals the expected course total. For courses WITHOUT `_note` on hole 4 or similar mismatch markers, `sum == course.par`. For Pinehurst No. 2 specifically (flagged `tentative: true`), the sum may diverge from the claimed `par`; the seed stores the ACTUAL hole-par sum as `courseTotal` and logs a warning if the claimed `par` differs. This is the honest-data decision from risk-acceptance §3.
   - `sum(holes[0..8].par) === outTotal` AND `sum(holes[9..17].par) === inTotal` AND `outTotal + inTotal === courseTotal` (all three computed from hole data, not from source top-level fields which don't exist).
   - `holes.map(h => h.si).sort((a,b) => a-b)` deep-equals `[1, 2, ..., 18]` (no duplicates, no gaps).
   - Per tee: every hole's `yardages` object contains a number for THIS tee's `name`. A missing yardage for a tee that's declared in the course's tees array is a hard error (operator got out-of-sync data).

   Bad invariant → `logger.error({event: 'seed_invariant_failed', course, invariant, expected, actual})` + `process.exit(1)`.

4. **Given** `runSeed(data)` execution against a fresh DB (all course tables empty)
   **When** run
   **Then** for EACH course in `data.courses`, the seed performs the following transforms + inserts inside a per-course `db.transaction(async (tx) => {...})`:

   **Transforms (JSON → DB shape):**
   - `clubName` DERIVATION: split `course.name` at the first occurrence of " Golf " / " Lodge " / " Inn " / " Resort " / " Club " (matching left-to-right) into `clubName = everything including + before the match` and `courseName = trimmed remainder`. If no match, `clubName = course.name` and `courseName = course.name` (fallback). Examples:
     - "Pine Needles Lodge & Golf Club" → clubName "Pine Needles Lodge & Golf Club", courseName "Pine Needles Lodge & Golf Club" (split at " Lodge " gives awkward remainder "& Golf Club"; pragmatic choice — **see note below on simpler alternative**).
     - **Simpler alternative (spec picks this):** `clubName = course.name` as a whole; `courseName = course.name` too. The `courses` table doesn't need a distinct courseName-vs-clubName since there's effectively one course per club in the seed set. Store `course.name` in BOTH `name` and `clubName` columns, satisfy the UNIQUE constraint, keep the complexity low.
   - `extractionDate` = `Date.parse(data._meta.extracted + 'T00:00:00.000Z')` — UTC midnight of the extracted date. For the current file (`"2026-04-13"`), this evaluates to `1776038400000` ms.
   - `verified` = `course.verified ?? true` (default true if absent; Pinehurst No. 2 is the only one with explicit `false`).
   - `outTotal` = sum of `holes[0..8].par`. `inTotal` = sum of `holes[9..17].par`. `courseTotal` = `outTotal + inTotal`. These are COMPUTED; the source's `course.par` is a sanity-check, not stored directly (when `course.par !== courseTotal`, log a warning with both values; store the computed value; DO NOT fail — this is the Pinehurst No. 2 case).
   - `rating` (per tee) = `Math.round(tee.rating * 10)` — integer-cents transform. Rounds to nearest integer to avoid floating-point drift (e.g. `74.7 * 10 === 747.0000...01` in some runtimes).

   **Inserts (per course transaction):**
   - `courses` row: `id = randomUUID()`, `name = course.name`, `clubName = course.name` (per the simpler-alternative above), `createdAt = Date.now()`, `tenantId = 'guyan'`, `contextId = 'library:guyan'`.
   - `course_revisions` row: `id = randomUUID()`, `courseId = <just-inserted>`, `revisionNumber = 1`, `sourceUrl = course.source` (always present in this dataset), `extractionDate = <computed above>`, `verified = <computed above>`, `outTotal`/`inTotal`/`courseTotal = <computed>`, `createdAt = Date.now()`, ecosystem cols.
   - One `course_tees` row per tee in `course.tees`: `id = randomUUID()`, `courseRevisionId`, `teeColor = tee.name` (the schema column is `tee_color` but the value is the tee's name verbatim — "Medal", "Blue", "Gold", etc.), `rating = Math.round(tee.rating * 10)`, `slope = tee.slope`, ecosystem cols. Skip `gender` / `ladies_rating` / `ladies_slope` per §3a.
   - 18 `course_holes` rows: each with `id = randomUUID()`, `courseRevisionId`, `holeNumber = hole.hole`, `par = hole.par`, `si = hole.si`, `yardagePerTeeJson = JSON.stringify(hole.yardages)`, ecosystem cols. `_note` field (diagnostic) is NOT persisted.

   Per-course transactional atomicity means a partial failure on course 4 doesn't roll back courses 1-3. Failure within a course (rare given pre-insert invariant checks) rolls back that course's partial state; operator fixes the JSON and re-runs (idempotent per AC #5).

5. **Given** re-running `runSeed(data)` on a DB that already has all 5 courses + revisions
   **When** re-invoked
   **Then** the script is IDEMPOTENT:
   - For each course in the JSON: if a `courses` row already exists for `(tenantId, clubName, name)` (read via a SELECT), reuse its `id`; do NOT insert a duplicate (the UNIQUE would reject anyway; the read-first path prevents the UNIQUE from firing in the hot path).
   - For each course: look up existing `course_revisions` for that course. Match via `WHERE course_id = ? AND source_url = ? AND extraction_date = ?`. The Zod schema in AC #3 requires `source` as a non-null URL string (all 5 courses in the current file have a real `source` URL), so the null-handling branch is not exercised in v1 — but the implementation MAY still include the `IS NULL`-or-eq pattern defensively for future revisions that might lack a source URL (e.g. manually-entered courses via T2-5 before the PDF parser is available). If a match exists → skip (no new revision); if no match → insert a new revision with `revisionNumber = max(existing revision_number) + 1`, plus its tees and holes.
   - **Concurrent-seed race defense (codex round-1 MED):** if the insert hits a UNIQUE violation on `(course_id, revision_number)` — theoretically possible if two containers seed in parallel, though SQLite's write-serialization makes this rare — catch the error (using the drizzle-`.cause`-unwrap pattern from T1-6b), re-SELECT the existing revisions, and skip. This matches the race-retry posture established in T1-6b's `lookupOrBindOAuthIdentity`.
   - Post-reinvocation count from the CURRENT `reference/pinehurst-may-2026-courses.json`: 5 courses, 5 revisions, **23 tees** (Pine Needles 5 + Mid Pines 5 + Talamore 3 + Pinehurst No. 2 2 + Tobacco Road 5 × Wait, 2+5+5+3+5 = 20; let me recount — Pine Needles 5, Mid Pines 5, Talamore 3, Pinehurst No. 2 2, Tobacco Road 5 → 5+5+3+2+5 = **20 tees**), 90 holes (18 × 5) — identical to first-run totals.
   - Report object reflects `coursesSkipped: 5, revisionsSkipped: 5, coursesInserted: 0, revisionsInserted: 0`.

6. **Given** `apps/tournament-api/src/routes/courses.ts` (new file) mounted at `/api/courses` in `app.ts`
   **When** `GET /api/courses` is queried after seed
   **Then** the response is HTTP 200 with body:

   Example response after seeding from the current `reference/pinehurst-may-2026-courses.json` (extraction date `2026-04-13`):

   ```json
   {
     "courses": [
       {
         "id": "<uuid>",
         "name": "Mid Pines Inn & Golf Club",
         "clubName": "Mid Pines Inn & Golf Club",
         "latestRevision": {
           "id": "<uuid>",
           "revisionNumber": 1,
           "verified": true,
           "sourceUrl": "https://www.midpinesinn.com/wp-content/uploads/2025/08/MP-Scorecard-1.pdf",
           "extractionDate": 1776038400000,
           "outTotal": 36,
           "inTotal": 36,
           "courseTotal": 72,
           "tees": [
             { "color": "Executive", "rating": 678, "slope": 129 },
             { "color": "Forward", "rating": 647, "slope": 118 },
             { "color": "Medal", "rating": 735, "slope": 142 },
             { "color": "Regular", "rating": 704, "slope": 136 },
             { "color": "Ross", "rating": 723, "slope": 138 }
           ]
         }
       },
       {
         "id": "<uuid>",
         "name": "Pinehurst No. 2",
         "clubName": "Pinehurst No. 2",
         "latestRevision": {
           "id": "<uuid>",
           "revisionNumber": 1,
           "verified": false,
           "sourceUrl": "https://course.bluegolf.com/bluegolf/course/course/pinehurst2/detailedscorecard.htm",
           "extractionDate": 1776038400000,
           "outTotal": 35,
           "inTotal": 38,
           "courseTotal": 73,
           "tees": [
             { "color": "Blue", "rating": 754, "slope": 143 },
             { "color": "U.S. Open", "rating": 779, "slope": 149 }
           ]
         }
       }
     ]
   }
   ```

   Note how the actual response reflects: (a) `courses.name === clubName` per the simplified clubName derivation in AC #4; (b) `Mid Pines` has `verified: true` with full 5-tee list ordered by tee name ASC; (c) `Pinehurst No. 2` has `verified: false` AND `courseTotal: 73` (computed from actual hole pars) rather than the source's claimed `par: 72`; (d) `rating` values are integers × 10 (74.7 → 747 via `Math.round(74.7 * 10)`; 73.5 → 735). The remaining three courses in the actual response would be Pine Needles (par 71), Talamore (par 71), Tobacco Road (par 71) — all `verified: true`.

   Response fields `sourceUrl`, `extractionDate`, `outTotal`, `inTotal`, `courseTotal` were added after codex round-1 LOW feedback — downstream consumers (T2-5 admin UI for printed-totals display; T3-2 event-creation for verified-status check) would otherwise need a second route call to get them. Including them in the primary response avoids future breaking changes.

   **`extractionDate` in the response is milliseconds since epoch (integer)** — same unit as the Zod input schema and the DB column. Clients that need human-readable dates apply `new Date(extractionDate).toISOString()` at render time.

   **Key response-shape contracts:**
   - Keys are `camelCase` in the JSON output (standard API posture; the spec table names use `snake_case` but the route layer transforms). `clubName` not `club_name`, `latestRevision` not `latest_revision`, `revisionNumber` not `revision_number`.
   - `tees` array is ordered deterministically by `teeColor` ASC for stable client rendering.
   - `courses` array is ordered by `name` ASC.
   - If a course has MULTIPLE revisions (re-import case), `latestRevision` is the one with the highest `revisionNumber`. Older revisions are NOT included in the response — clients that need history will get a separate route in a future story.
   - `rating` is emitted as the raw integer value (e.g., 715 for 71.5). Client-side display transforms divide by 10. This matches the integer-cents posture from T2-1 AC #13.

7. **Given** `GET /api/courses` with no courses seeded
   **When** queried
   **Then** the response is HTTP 200 with `{ "courses": [] }`. No 404. Empty library is a valid state.

8. **Given** the organizer-flag flow (per risk-acceptance section 4)
   **When** the seed CLI runs with `ORGANIZER_GOOGLE_SUB=<sub>` in env
   **Then**:
   - **Validate sub shape before any DB operation (codex round-1 MED + round-2 MED fix):** `ORGANIZER_GOOGLE_SUB` must match `/^\d{1,64}$/` — Google OAuth subs are documented as "unique identifier" numeric strings without a formal min-length guarantee. The 1..64 cap catches obvious typos (`"abc123"`, `"josh@gmail.com"`, empty string, absurdly long strings) without excluding legitimate short-digit subs. If the value doesn't match the regex, log `{ level: 'error', event: 'seed_organizer_invalid_sub', subLength: <number>, rawValue: '<redacted>' }` and `process.exit(1)`. Fail-fast prevents silently pre-seeding the wrong identity. Do NOT log the raw sub value on the failure path — redact it; the length alone is sufficient for operator diagnosis.
   - **Log loudly on every pre-seed or promote action (foot-gun mitigation):** every organizer-flag operation logs at `level: 'warn'` with the sub and playerId. Operator reviewing container logs after deploy can spot typos before a real OAuth sign-in binds the pre-seeded identity.
   - If an `oauth_identities` row exists with `(tenantId = 'guyan', provider = 'google', providerSub = <sub>)` → set the bound `players.is_organizer = true` via UPDATE. Log `{ level: 'warn', event: 'seed_organizer_promoted', playerId, sub }`.
   - If NO such `oauth_identities` row exists → pre-seed one: create a `players` row with `id = randomUUID()`, `isOrganizer = true`, `createdAt = Date.now()`, ecosystem cols; create an `oauth_identities` row binding that player to `(guyan, google, <sub>)`. Log `{ level: 'warn', event: 'seed_organizer_preseeded', playerId, sub }`. When Josh later signs in, T1-6b's callback matches the pre-seeded `oauth_identities` and reuses the player.
   - Operation is idempotent: re-running with the same env var on a DB that already has the pre-seeded rows is a no-op (read-first; skip if already `isOrganizer=true`). Log `{ level: 'info', event: 'seed_organizer_already_set', playerId, sub }` on the no-op path.
   - `ORGANIZER_GOOGLE_SUB` unset → log `{ level: 'info', event: 'seed_organizer_skipped', reason: 'env_unset' }` and skip.

9. **Given** `apps/tournament-api/package.json`
   **When** inspected post-T2-2
   **Then** the `scripts` block gains one new entry: `"seed": "tsx src/db/seed.ts"`.
   - **Why `tsx` (not `node dist/db/seed.js`) for the local script:** `tsc` doesn't copy `.json` files into `dist/` during build, and the actual seed JSON lives at the REPO ROOT (`reference/pinehurst-may-2026-courses.json`), not inside `apps/tournament-api/src/`. Running via `tsx` lets the script resolve the JSON path relative to the workspace root. The resolution logic: from `src/db/seed.ts`, walk up four levels (`../../../../reference/pinehurst-may-2026-courses.json`) or use `fileURLToPath(import.meta.url)` + `path.resolve(__dirname, '../../../../reference/pinehurst-may-2026-courses.json')` — verify exact depth at impl time; the dev agent tests both local dev and prod paths.
   - **Why prod still uses `node dist/db/seed.js`:** the Dockerfile's CMD chain runs the compiled output. AC #17 covers the Dockerfile COPY that puts the JSON into a path reachable from `dist/db/seed.js`. The exact COPY target is documented in AC #17.

   Existing scripts (`typecheck`, `lint`, `dev`, `build`, `db:generate`, `db:migrate`, `test`) are byte-unchanged. Existing `dependencies` + `devDependencies` blocks are byte-unchanged — no new deps. **Zero SHARED gate** on pnpm-lock.yaml because no deps change.

10. **Given** `apps/tournament-api/src/app.ts`
    **When** inspected post-T2-2
    **Then** `coursesRouter` is mounted: `app.route('/api/courses', coursesRouter)`. Placement: AFTER the existing `app.route('/api/auth', authRouter)` mount. No other changes.

11. **Given** `apps/tournament-api/src/db/seed.test.ts` (new file)
    **When** `pnpm -F @tournament/api test` runs
    **Then** the following tests exist (≥8 total) and pass, using the mock-db + migrate pattern established in T1-6a + T2-1:

    - `runSeed` on a fresh DB inserts exactly 5 courses + 5 revisions + N tees + 90 holes; report matches.
    - `runSeed` re-invoked on a fully-seeded DB: report shows 5 courses skipped + 5 revisions skipped; counts in DB unchanged.
    - Zod validation rejects an invalid JSON shape (e.g., `holes.length === 17`) with a clear error message.
    - New-revision-on-re-import: invoke `runSeed` first with extractionDate=A; then mutate the data to have extractionDate=B; invoke `runSeed` again. Expected: 0 new courses, 1 new revision per course (5 new revisions total), new tees+holes for each new revision.
    - `promoteOrganizer` with NO existing oauth_identities row: pre-seeds both rows; `players.is_organizer === true`; oauth_identities has the expected sub.
    - `promoteOrganizer` with an EXISTING oauth_identities row: looks up + flips the bound player's is_organizer; no new rows inserted.
    - `promoteOrganizer` idempotency: invoke twice with same sub on same state → no duplicate rows, no errors.
    - `promoteOrganizer` with an existing oauth_identities bound to a player whose is_organizer is ALREADY true → no-op; report correctly flags this.

12. **Given** `apps/tournament-api/src/routes/courses.test.ts` (new file)
    **When** tests run
    **Then** ≥5 tests covering:

    - `GET /api/courses` with empty DB → 200 `{ courses: [] }`.
    - `GET /api/courses` after seeding 5 courses → 200 with 5 entries, ordered by `name` ASC.
    - Each course has exactly one `latestRevision` matching the most recent `revisionNumber`.
    - Response shape is camelCase (clubName, latestRevision, revisionNumber); no snake_case leaks.
    - Multi-revision course: seed a course, insert a manual 2nd revision with higher `revisionNumber`, assert `latestRevision.revisionNumber === 2` (not 1).

13. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint`
    **When** run
    **Then** both exit 0 under existing strictness flags. The `no-console` rule (T1-7) continues to cover the seed via the existing file-override; no new exemptions.

14. **Given** `pnpm -F @tournament/api test`
    **When** run
    **Then** total tests ≥ 98 (85 at start of T2-2 + ≥13 new from AC #11 + #12). Existing tests continue to pass with no count loss.

15. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T2-2
    **Then** both continue to pass with zero net-negative test count change.

16. **Given** `pnpm -F @tournament/api build`
    **When** run
    **Then** exits 0 and emits `dist/db/seed.js` (the runtime entry that Dockerfile CMD already invokes) plus `dist/routes/courses.js`. The raw JSON file is NOT emitted by `tsc` — AC #17 covers how it's shipped.

17. **Given** the Dockerfile
    **When** inspected post-T2-2
    **Then** a single-line addition copies the existing `reference/pinehurst-may-2026-courses.json` into the runtime stage at a path reachable from the compiled `dist/db/seed.js`:
    ```dockerfile
    # Seed data lives at repo-root `reference/`. tsc doesn't copy .json
    # through the build, so copy it separately from source into a
    # location the compiled seed script can find via a stable relative
    # path from dist/db/seed.js.
    COPY reference/pinehurst-may-2026-courses.json ./apps/tournament-api/dist/reference/pinehurst-may-2026-courses.json
    ```

    **Build context assumption:** this COPY requires the Docker build context to be the repo root (so `reference/` is reachable). The existing `docker-compose.yml` defines `tournament-api.build.context: .` (repo root) AND the existing Dockerfile already COPYs repo-root files (e.g. `pnpm-lock.yaml`, `packages/engine/package.json`) — so this assumption is already validated in the current build infrastructure. No compose changes needed.

    If a future deploy path uses a different build context (e.g., building from `apps/tournament-api/` alone), this COPY fails at build time and the operator must update the build context back to repo root. Documented here so a future CI/CD change surfaces the dependency.
    **Path resolution uses `fileURLToPath(import.meta.url)` (not `URL.pathname`)** because `.pathname` on Windows produces URL-encoded paths like `/D:/wolf-cup/...` that fs APIs reject. The idiomatic pattern:

    ```ts
    import { fileURLToPath } from 'node:url';
    import { dirname, resolve } from 'node:path';

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // From src/db/seed.ts (dev via tsx):  ../../../../reference/...
    // From dist/db/seed.js (prod):         ../reference/...
    // Both land at the right absolute path because the compiled and
    // source trees have different depths relative to where the JSON
    // sits post-COPY.
    const seedPathDev  = resolve(__dirname, '../../../../reference/pinehurst-may-2026-courses.json');
    const seedPathProd = resolve(__dirname, '../reference/pinehurst-may-2026-courses.json');

    // Try dev path first; fallback to prod path. Whichever exists wins.
    const seedPath = existsSync(seedPathDev) ? seedPathDev : seedPathProd;
    ```

    **The dev agent MUST verify both path resolutions work before declaring AC #11 green.** The test file exercises the resolver against a fixture path; the Dockerfile COPY path correctness is verified at deploy-time smoke.

    **This is a SHARED edit on `apps/tournament-api/Dockerfile`** — requires user approval at the impl gate (NOT at spec gate). Same pattern as T1-6a's migrations COPY (Dockerfile lines 49-52).

    The COPY is placed next to the existing migrations COPY in the runtime stage, preserving the layer-cache ordering.

## Tasks / Subtasks

- [ ] Task 1: Verify existing seed JSON (AC #1) — NO file creation needed.
  - [ ] Subtask 1.1: Confirm `reference/pinehurst-may-2026-courses.json` exists and is tracked.
  - [ ] Subtask 1.2: Run the AC #3 invariant checks manually against each of the 5 courses; confirm 4 pass (Pine Needles, Mid Pines, Talamore, Tobacco Road) and 1 has the expected par-sum divergence (Pinehurst No. 2 claims par 72 but hole-pars sum to 73).
  - [ ] Subtask 1.3: File is NOT modified by this story.

- [ ] Task 2: Zod schemas in seed.ts (AC #3).
  - [ ] Subtask 2.1: Define `SeedHoleSchema`, `SeedTeeSchema`, `SeedCourseSchema`, `SeedDataSchema`.
  - [ ] Subtask 2.2: Export `SeedData` type inferred from the schema.

- [ ] Task 3: `runSeed` function (AC #2, #4, #5).
  - [ ] Subtask 3.1: Read-first pattern for courses (match by tenantId+clubName+name).
  - [ ] Subtask 3.2: Read-first pattern for revisions (match by sourceUrl+extractionDate).
  - [ ] Subtask 3.3: Per-course transaction wrapper.
  - [ ] Subtask 3.4: Return `SeedReport` with accurate counts.

- [ ] Task 4: `promoteOrganizer` function (AC #8).
  - [ ] Subtask 4.1: Lookup oauth_identities by (tenant, provider=google, sub).
  - [ ] Subtask 4.2: If found: update players.is_organizer. If missing: pre-seed both rows.
  - [ ] Subtask 4.3: Idempotency: no-op if already isOrganizer=true.

- [ ] Task 5: CLI entrypoint at bottom of seed.ts (AC #2).
  - [ ] Subtask 5.1: Resolve JSON path via the `fileURLToPath(import.meta.url)` + `dirname` + `resolve` + `existsSync`-fallback pattern from AC #17. The same physical code picks the dev path (4 levels up to repo-root `reference/`) or the prod path (1 level up to `dist/reference/`) based on which one exists at runtime.
  - [ ] Subtask 5.2: Parse + validate via Zod; fail-fast on error.
  - [ ] Subtask 5.3: Invoke runSeed + optional promoteOrganizer; log report.

- [ ] Task 6: `GET /api/courses` route (AC #6, #7, #10).
  - [ ] Subtask 6.1: Create `src/routes/courses.ts` exporting `coursesRouter`.
  - [ ] Subtask 6.2: Query: join courses + their latest revision + its tees. Order by courses.name ASC; tees within a revision by teeColor ASC.
  - [ ] Subtask 6.3: Transform to camelCase response shape.
  - [ ] Subtask 6.4: Mount at `/api/courses` in app.ts.

- [ ] Task 7: Add `"seed"` script to package.json (AC #9).

- [ ] Task 8: Write seed tests (AC #11).
  - [ ] Subtask 8.1: Use the mock-db + migrate pattern.
  - [ ] Subtask 8.2: Cover all 8 test cases.

- [ ] Task 9: Write route tests (AC #12).
  - [ ] Subtask 9.1: Wrap coursesRouter under a test app that mounts requestIdMiddleware (per T1-7 pattern).
  - [ ] Subtask 9.2: Cover all 5 test cases.

- [ ] Task 10: SHARED gate: Dockerfile COPY line (AC #17).
  - [ ] Subtask 10.1: Announce intent BEFORE editing. Wait for user approval.
  - [ ] Subtask 10.2: Add the single COPY line next to the migrations COPY.

- [ ] Task 11: Run regressions (AC #13, #14, #15, #16).
  - [ ] Subtask 11.1: typecheck + lint + test + build + Wolf Cup engine + Wolf Cup api.

## Dev Notes

- **Why real scorecard data matters for the re-import contract:** 4 of 5 courses ship with `verified: true` from official scorecards. Pinehurst No. 2 ships with `verified: false` + the documented par-sum divergence. When Josh photographs the official Pinehurst No. 2 scorecard on-site (or pulls the authoritative PDF from pinehurst.com), T2-3 or T2-5 creates a NEW revision via the re-import contract — old revision stays intact; new revision carries `verified: true`. The `GET /api/courses` route returns `latestRevision`, so the API silently upgrades to the corrected data without schema or route change.

- **Why read-first idempotency (rather than `onConflictDoNothing`):** SQLite + drizzle supports `onConflictDoNothing`, but the UNIQUE index on `(tenantId, clubName, name)` would swallow a real bug (e.g., two different courses with the same name at the same club). Read-first makes the match explicit and the skip visible in logs.

- **Why per-course transactions (not one big seed transaction):** a corrupt hole row on course 4 shouldn't roll back courses 1-3. Per-course atomicity gives operator-actionable failure granularity. If the seed fails mid-course, the per-course transaction rolls back that course's partial state; the operator can fix the data and re-run (idempotent).

- **Why `camelCase` response shape vs `snake_case` DB columns:** Wolf Cup's existing `/api/...` routes use camelCase. Tournament-api is a sibling app that should match that convention for consistency. Drizzle types expose the TS-camelCase names already (`clubName`, `revisionNumber`); the transform is natural at the route layer.

- **Why `rating` emitted as integer (not divided by 10):** client-side transform keeps the response purely-integer-typed. If we divided to emit `71.5`, the Zod/TS typing at the consumer becomes fragile around float equality. The T2-5 admin UI will handle display formatting.

- **Why `ORGANIZER_GOOGLE_SUB` is optional:** the seed runs on every container boot per the Dockerfile CMD. Most boots (dev + re-deploys) don't need to re-promote the organizer. Making it optional keeps the seed idempotent without requiring Josh's `sub` to be configured at every boot.

- **Wolf Cup isolation (FD-1/FD-2):** T2-2 writes only to `apps/tournament-api/src/**`, `apps/tournament-api/package.json`, and (SHARED) `apps/tournament-api/Dockerfile`. Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`, or root-level files.

- **Seed JSON as shipped-artifact:** the JSON file is checked into git (source of truth) and COPY'd into the Docker runtime by AC #17's Dockerfile line. Future edits to the JSON (via PR) trigger a container rebuild; on boot, the seed is idempotent so no double-inserts occur.

### Project Structure Notes

Shape after T2-2:
```
reference/
  pinehurst-may-2026-courses.json  # EXISTING — byte-unchanged; READ by seed
apps/tournament-api/
  package.json                 # MODIFIED: +1 "seed" script
  Dockerfile                   # MODIFIED (SHARED): +1 COPY line for reference/pinehurst-may-2026-courses.json
  src/
    app.ts                     # MODIFIED: +1 coursesRouter mount
    db/
      seed.ts                  # MODIFIED: placeholder → real seed logic (reads repo-root reference/)
      seed.test.ts             # NEW — ≥8 tests
      schema/
        # T2-1 tables, unchanged
    routes/
      courses.ts               # NEW — GET /api/courses
      courses.test.ts          # NEW — ≥5 tests
```

**Explicitly NOT in T2-2 (reserved for future):**
- PDF vision parser — T2-3.
- Course validator (pure function rejecting malformed data) — T2-4.
- Admin UI for manual + PDF-upload review — T2-5.
- Pinehurst No. 2 re-verification — pending on-site re-photograph or authoritative PDF; resolves via T2-3 (PDF parser) or T2-5 (admin UI re-upload) creating a new revision.
- Course deletion route — not in Epic T2 at all.

### References

- T2-1 schema: `apps/tournament-api/src/db/schema/courses.ts`.
- T1-6a seed placeholder: `apps/tournament-api/src/db/seed.ts` (being rewritten).
- T1-7 structured logger: `apps/tournament-api/src/lib/log.ts` (used for seed progress reports).
- Dockerfile seed chain: `apps/tournament-api/Dockerfile` CMD line.
- ESLint no-console file-override for seed.ts: `apps/tournament-api/eslint.config.js` (T1-7).
- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 618-644.
- T1 retro action items AI-1 (spec codex 4-round cap), AI-6 (reuse ecosystem factory) applied.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
