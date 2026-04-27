# T2-5: Course Admin UI — Manual + PDF Upload Review

## Status

Done

## Story

As an organizer (Josh),
I want a course-creation UI that supports both manual cell-by-cell entry AND a "review parsed scorecard" flow that pre-populates the form from T2-3/T2-3a's parser output,
So that I can load any course regardless of whether the vision parser handles it cleanly — and the loaded data is validated against T2-4's rules before persistence.

T2-5 is the LAST story in Epic T2. It closes the course-onboarding loop end-to-end: organizer navigates to a UI form, optionally pre-populates from a PDF/photo upload, edits any inaccuracies, and saves to the database in a transactional all-or-nothing write.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected in this story.** Implementation strategy avoids new deps:

- **Form state:** React `useState` (not `react-hook-form`). The form is a single-purpose admin tool; introducing a form-state library for one consumer is overkill. State management is `useState<ParsedCourse>(initialState)` + per-field setters; complexity stays at "tedious but linear" rather than "abstracted via library."
- **Validation:** T2-4's `validateCourse` is reused on the BACKEND (sole authority). On the FRONTEND, errors come back from the save endpoint and display inline. NO client-side Zod mirror — would create two sources of truth for validation rules. (Deviates from epic AC line 783's "client-side Zod" wording; rationale documented in §6 below.)
- **DB writes:** existing `@libsql/client` + `drizzle-orm` deps. No transaction lib needed; libsql's native transaction support via `db.transaction((tx) => ...)`.
- **Tests:** existing `vitest` + `@testing-library/react` (added in T2-3b). No new test infra.

If during impl the dev agent identifies a true blocker that requires a SHARED edit (e.g., a missing peer dep that breaks types), it pauses for user approval at that moment.

**No `docker-compose.yml` changes. No `Dockerfile` changes. No env vars. No new CI checks. No DB migrations** (schema from T2-1 is already in place; T2-5 just writes to it).

### 2. T2-4 validator integration is the safety boundary

T2-5 is the FIRST consumer of T2-4's `validateCourse`. The save endpoint MUST call it BEFORE persistence — if `result.valid === false`, return 400 with the error array; do NOT write any rows. This is the load-bearing connection between the two stories: T2-4 ships a function but means nothing until T2-5 wires it.

Validation runs ONCE at the save boundary. The frontend does not run T2-4 client-side (would couple frontend to engine code; would create duplicate validation if a future T2-4 update changes a rule and only one side updates).

### 3. Rating × 10 transform discipline

`course_tees.rating` stores INTEGER × 10 per the existing T2-1 schema (e.g., 72.3 → 723). T2-5's data flow:

- **Inbound (form → save endpoint):** form sends `rating: 72.3` (float, matching ParsedCourse shape). Save endpoint multiplies by 10 + rounds to integer for storage. The Zod request schema accepts the float; the transform happens at the boundary.
- **Outbound (read → form pre-populate):** if the parse-pdf endpoint provides ParsedCourse (already float), no transform needed for pre-populate. T2-5 does NOT read existing courses for editing in v1 — pure create-only flow. Future course-edit story handles the integer→float display transform.
- **Server-side validation:** `validateCourse` runs on the form-shape (float rating) BEFORE the integer transform. If `validateCourse` rejects, the integer-transform never runs.

### 4. Transaction discipline (architecture step-5: transactional create)

Persistence happens in a SINGLE DB transaction across 4 tables:

1. INSERT `courses` (name, club_name, tenant_id, context_id) — generate UUID for `id`.
2. INSERT `course_revisions` (course_id from #1, revision_number = 1, totals, verified = true, source_url, extraction_date) — generate UUID for `id`.
3. INSERT `course_tees` (one row per tee in form data; rating × 10).
4. INSERT `course_holes` (18 rows, yardages stored as JSON string).

If ANY step fails (FK violation, UNIQUE conflict, type error), the transaction rolls back — no partial course written. The API responds with the appropriate error code: 409 on UNIQUE conflict (duplicate course name within tenant), 400 on validation failure, 500 on unexpected DB error.

Implementation uses libsql's transaction API:

```ts
await db.transaction(async (tx) => {
  await tx.insert(courses).values(...);
  await tx.insert(courseRevisions).values(...);
  // ...
});
```

Drizzle's transaction API automatically rolls back on thrown errors. The handler wraps the transaction in a try/catch and maps the error class to the right HTTP status.

### 5. UNIQUE conflict handling

`uniq_courses_tenant_club_name` index on `(tenant_id, club_name, name)` enforces no-duplicates per tenant. If an organizer submits a course whose `(club_name, name)` matches an existing row, the INSERT throws a SQLITE_CONSTRAINT_UNIQUE error.

The handler catches this specific error class (libsql's `LibsqlError` with `rawCode: 2067` per the existing T1-6b auth.ts pattern) and returns:

```
HTTP 409 Conflict
{ error: 'conflict', code: 'duplicate_course', requestId, ... }
```

The frontend displays a user-friendly message ("A course with that club + name already exists") and keeps the form populated so the organizer can edit + retry.

### 6. Why no client-side Zod validation (deviates from epic AC line 783)

The epic AC says "client-side Zod validation runs (mirroring server-side T2.4 validator including totals comparison)." T2-5's spec deviates: client-side validation is REMOVED, server-side validation via T2-4 is the sole authority.

**Rationale:**
- **Single source of truth.** Two Zod schemas (client + server) drift. T2-4's pure-function validator is already shippable as the canonical rule set; mirroring it client-side would mean every T2-4 rule update requires syncing two files.
- **The form is short.** 18 holes + 5 tees + course header = ~80 fields. Server roundtrip latency is acceptable UX (form post → ~50ms → response). Client-side validation's main benefit (sub-second feedback) is marginal at this scale.
- **No deep-form-library coupling.** Without client-side Zod, the form layer doesn't need `@hookform/resolvers/zod` or similar — keeps the no-new-deps story.
- **Field-level errors STILL render** — but they come from the server's response. The save handler returns `{ errors: [...] }` from `validateCourse`; the frontend renders the error array as a single top-level list above the form. Per-row inline mapping is DEFERRED to a future polish story (see AC #11).

This is a deliberate scope choice. The epic spec wording is overridden in this story by the spec gate (your approval). Future story may revisit if organizer feedback shows server-roundtrip-on-every-keystroke is painful.

### 7. Auth + middleware

Same chain as T2-3's parse-pdf endpoint: `requireSession → requireOrganizer → bodyLimit({ maxSize: 64 KiB })` (the JSON request body is small — 18 holes × ~5 fields + 5 tees × ~3 fields + course header ≈ 4 KiB; 64 KiB cap is generous). NO CSRF concern beyond the existing Origin check that fires on all admin POSTs.

Frontend route's `beforeLoad` reuses the T2-3b 5-step auth-status loader contract (`queryClient.ensureQueryData('auth-status', ...)`); same redirect-to-`/api/auth/google` semantics. ZERO new auth code.

### 8. UI scope: minimal but functional, NOT a redesign

The UI is intentionally MINIMAL. Goals:
- Course header (name, club_name) — 2 text inputs.
- Tee table — N rows of (color, rating, slope) + "Add tee" button + per-row remove. Default to 1 empty row.
- 18-hole table — fixed 18 rows with (par dropdown {3,4,5}, SI input, yardage-per-tee inputs). Yardages columns dynamically match the declared tees.
- Totals — 3 text inputs (out_total, in_total, course_total). Helper: a "Compute totals from holes" button that auto-fills from the par values.
- "Upload Scorecard" button — invokes T2-3a's parse-pdf endpoint, pre-populates the form on success, shows a toast on failure.
- Submit button — POSTs to `/api/admin/courses`, displays validation errors inline, shows success message + clears form OR redirects to the course list.
- "Verify match" affordance: a DEFERRED feature flag — NOT in T2-5. Shows the user that the form is pre-populated; no "verified" badge UI in v1.

NOT in T2-5:
- Course edit / update flow (read existing course → modify → save new revision). Future story.
- Course delete. Future story (low priority — deletion is rare).
- Bulk upload (multiple PDFs at once). Future story.
- Image preview before submit. Could be added as polish; deferred to a followup.
- Drag-and-drop file input. The existing T2-3b file input pattern works.
- HEIC client-side conversion. Same defer as T2-3a's spec.
- Field-level character limits beyond Zod's defaults.
- Real-time computed-totals warning ("you typed out_total=36 but holes 1-9 sum to 37"). Server returns the validation error on save; frontend displays it. Real-time would mean client-side T2-4 mirror (rejected per §6).

### 9. Test coverage targets (mandatory)

- **≥8 backend route tests** (`apps/tournament-api/src/routes/admin-courses.test.ts` extends with new tests for the save endpoint):
  - Happy path: organizer POSTs valid form → 201 with course id; verify all 4 tables got rows in the transaction.
  - Validation rejection: POST with par=6 on hole 4 → 400 + error array contains the par error; NO rows written.
  - Validation rejection: POST with printed-totals mismatch → 400 + error array contains totals error.
  - Validation rejection: POST with duplicate SI → 400 + bijection error.
  - UNIQUE conflict: POST a course whose (club, name) already exists → 409 `duplicate_course`.
  - Auth: anonymous POST → 401 (require-session).
  - Auth: non-organizer POST → 403 (require-organizer).
  - Body-limit: 1 MB body → 400 `{ error: 'bad_request', code: 'body_too_large', requestId }` (per AC #1's onError mapping).
  - Rating × 10 transform: POST rating=72.3 → DB stores 723.

- **≥4 frontend component tests** (`apps/tournament-web/src/routes/admin.courses.new.test.tsx`):
  - Idle: form renders with 1 empty tee + 18 hole rows + totals fields. Submit disabled (no fields filled).
  - Manual entry: fill all fields, click Submit, mock POST → 201 → success message displays.
  - Validation error: mock POST → 400 with error array → errors render as a top-level list above the form (NOT mapped to specific rows in v1; per AC #11).
  - Pre-populate from upload: click "Upload Scorecard", upload fixture file, mock parse-pdf returns canonical ParsedCourse → form fields populate.

- **NO real-API smoke** for T2-5 (the parser smoke is T2-3/T2-3a's; T2-5's logic is pure form/save plumbing). Manual smoke at AC #N (post-deploy) confirms end-to-end works.

### 10. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/admin-courses.ts` — extend with save endpoint + Zod request schema + transaction code.
- `apps/tournament-api/src/routes/admin-courses.test.ts` — extend with 8 new route tests.
- `apps/tournament-web/src/routes/admin.courses.new.tsx` — NEW file; the form + submit + upload-pre-populate logic.
- `apps/tournament-web/src/routes/admin.courses.new.test.tsx` — NEW file; 4 component tests.
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regenerated by `tsr generate` after the new route file is added.
- Story file + 4-5 codex review files in `_bmad-output/`.

Sprint-status flips through ready-for-dev → in-progress → review → done.

NO SHARED edits expected. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/routes/admin-courses.ts`
   **When** inspected post-T2-5
   **Then** the existing `parse-pdf` route is byte-unchanged. A SECOND route is mounted: `POST /api/admin/courses` (root path of the router). The middleware chain for the new route is `requireSession → requireOrganizer → bodyLimit({ maxSize: 64 * 1024, onError }) → handler`. Body parsed via `c.req.json()` (NOT multipart — JSON request). The `onError` callback for THIS endpoint returns 400 `{ error: 'bad_request', code: 'body_too_large', requestId }` (DELIBERATELY distinct from T2-3's `bad_upload`/`file_too_large` shape — that wording is upload-specific; this is a JSON POST, so the `bad_request`/`body_too_large` shape is more accurate).

2. **Given** the request body posted to `POST /api/admin/courses`
   **When** parsed
   **Then** it MUST conform to a new `SaveCourseRequestSchema` (Zod) defined in the route file:
   ```ts
   const SaveCourseRequestSchema = z.object({
     name: z.string().min(1),
     club_name: z.string().min(1),
     tees: z.array(z.object({
       color: z.string().min(1),
       rating: z.number().positive().finite(),
       slope: z.number().int().min(55).max(155),
     })).min(1),
     holes: z.array(z.object({
       number: z.number().int().min(1).max(18),
       par: z.number().int().min(3).max(5),
       si: z.number().int().min(1).max(18),
       yardages: z.record(z.string(), z.number().int().nonnegative()),
     })).length(18),
     totals: z.object({
       out_total: z.number().int().positive(),
       in_total: z.number().int().positive(),
       course_total: z.number().int().positive(),
     }),
     source_url: z
       .string()
       .url()
       .refine((u) => /^https?:\/\//i.test(u), {
         message: 'source_url must use http or https scheme',
       })
       .optional(),
   });
   ```
   The `.refine` rejects non-web schemes (e.g., `javascript:`, `data:`, `file:`) that Zod's `.url()` allows by default. `source_url` is persisted to `course_revisions.source_url` and may be rendered as a clickable link in a future UI; restricting to http(s) at the API boundary closes the stored-XSS path before it can reach a renderer.
   This schema MIRRORS T2-3's `ParsedCourseSchema` defined at `apps/tournament-api/src/lib/course-parser.ts:191-199` — verified to use snake_case (`club_name`, `out_total`, `in_total`, `course_total`) so parse-pdf output is directly POSTable here. T2-5 adds `source_url` as optional (parse-pdf output omits it; manual entry may supply it). On parse failure → 400 `{ error: 'bad_request', code: 'invalid_body', requestId, issues }`.

3. **Given** a valid request body that passes the Zod parse
   **When** the handler runs
   **Then** it calls `validateCourse(body)` (T2-4's exported function at `apps/tournament-api/src/engine/validators/course.ts:49`). T2-4 is a pure synchronous function that reads only the `ParsedCourse` fields it cares about (name, club_name, tees, holes, totals); extra fields like `source_url` are silently ignored — confirmed by inspection of `course.ts:49` (no Zod parse, no strict-shape rejection). If `result.valid === false` → 400 `{ error: 'bad_request', code: 'validation_failed', requestId, errors: result.errors }`. NO rows written. Validation runs BEFORE the DB transaction starts.

4. **Given** a valid request that passes both Zod parse + T2-4 validator
   **When** the handler runs
   **Then** it executes a SINGLE DB transaction (`db.transaction(async (tx) => {...})`) that inserts. EVERY row below MUST set `tenantId='guyan'` (defaulted by `ecosystemColumns()` but spec'd explicitly to avoid drift) and `contextId='library:guyan'` (NOT NULL with NO default per `courses.ts:24-32` — silently omitting crashes the insert):
   - 1 row in `courses` (id=randomUUID, name, clubName, createdAt=now, tenantId='guyan', contextId='library:guyan').
   - 1 row in `course_revisions` (id=randomUUID, courseId, revisionNumber=1, sourceUrl, extractionDate=now, verified=true, outTotal, inTotal, courseTotal, createdAt=now, tenantId='guyan', contextId='library:guyan').
   - N rows in `course_tees` (one per tee in payload; rating MULTIPLIED by 10 for integer storage; tenantId='guyan', contextId='library:guyan').
   - 18 rows in `course_holes` (yardagePerTeeJson = `JSON.stringify(yardages)`; tenantId='guyan', contextId='library:guyan').
   On success → 201 `{ id: <courseId>, requestId }` with the new course's UUID.

5. **Given** a UNIQUE conflict on `(tenant_id, club_name, name)` during the courses INSERT
   **When** raised
   **Then** the handler catches the libsql error class (`LibsqlError` with `rawCode: 2067` per existing T1-6b pattern) and returns 409 `{ error: 'conflict', code: 'duplicate_course', requestId }`. The transaction rolls back. NO partial course written.

6. **Given** any other DB failure during the transaction
   **When** raised
   **Then** the handler catches generically, logs at error level via T1-7 logger (`event: 'admin_course_save_failed'`, includes courseName + error message + cause), and returns 500 `{ error: 'internal', code: 'save_failed', requestId }`. Transaction rolls back.

7. **Given** integer-cents discipline for `course_tees.rating`
   **When** the handler builds the tees-table INSERT values
   **Then** for each tee, it computes `Math.round(tee.rating * 10)` (rounds to nearest integer; e.g., 72.3 → 723, 74.7 → 747, 76.85 → 769). The stored value is integer. The frontend never sees the integer form (read-only-create flow in v1).

8. **Given** `apps/tournament-web/src/routes/admin.courses.new.tsx` (NEW file)
   **When** inspected post-T2-5
   **Then** it exports BOTH `Route` (TanStack file-route registration at `/admin/courses/new`) AND `NewCoursePage` (named React component for direct test render). The route's `beforeLoad` hook reuses the T2-3b 5-step auth-status loader (via `queryClient.ensureQueryData('auth-status', ...)`); anonymous → redirect to `/api/auth/google`; non-organizer → render inline forbidden message; organizer → render the form.

9. **Given** the form
   **When** rendered (idle state)
   **Then** it displays:
   - Course-level header: 2 text inputs for `name` and `club_name`, plus 1 OPTIONAL `source_url` text input (labelled "Source URL (optional)" with `type="url"` for browser-side scheme/format hints). The `source_url` input is empty by default; if filled, the value is sent in the submit payload and persisted to `course_revisions.source_url`. If a parse-pdf upload succeeded, the upload's `source_url` (if any) pre-populates this field; manual organizer entry may also supply it (e.g., "https://example.com/scorecard.pdf").
   - Tees table: 1 default empty row with (color text, rating number, slope number) inputs. "Add tee" button below to append a row. Each row has a "Remove" button (disabled when only 1 row exists).
   - 18-hole table: fixed 18 rows. Each row has hole-number label (read-only, 1-18), par dropdown ({3,4,5}), SI number input, and one yardage input PER tee declared above. Yardage columns are dynamic: adding a tee adds a column; removing a tee removes its column.
   - Totals: 3 number inputs (out_total, in_total, course_total). A "Compute totals from holes" button populates them from the par values entered.
   - "Upload Scorecard" file input: same MIME accept-list as T2-3b's upload route (`application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif`).
   - Submit button: disabled until `name`, `club_name`, ≥1 tee with all 3 fields, all 18 holes with par+si+yardages, and all 3 totals are filled (client-side completeness check, NOT validation). `source_url` is OPTIONAL and does NOT gate Submit.

10. **Given** the user clicks "Upload Scorecard" + selects a file
    **When** the form processes the upload
    **Then** it `POSTs` to `/api/admin/courses/parse-pdf` (T2-3a's route, multipart `pdf` field) with the file. On 200 → parses the JSON response (ParsedCourse shape) and pre-populates ALL form fields (name, club_name, tees, holes, totals, source_url=undefined since the file came from local disk). The form is now in "review-edit" state — organizer can manually correct any inaccuracy before clicking Submit. On 4xx/5xx from parse-pdf → display a toast/inline error using the same code-mapping table from T2-3b (`wrong_mime`, `unsupported_mime_heic`, etc.); form remains in idle state.

11. **Given** the user clicks Submit
    **When** the form posts to `POST /api/admin/courses` with a JSON body conforming to AC #2's shape
    **Then** it handles the response:
    - 201 → display "Course saved!" success message + reset form to idle (or, alternative: redirect to a future course-detail page; v1 just shows success + reset).
    - 400 with `code: 'validation_failed'` → display the `errors` array inline in the form. Each error string is rendered above the form (a single error list); future polish could map errors to specific rows but v1 displays them as a list.
    - 400 with `code: 'invalid_body'` → display "Form data is invalid" generic message + log the Zod issues to console (developer-facing).
    - 409 `code: 'duplicate_course'` → display "A course with that club + name already exists" + keep form populated.
    - 500 → display "Save failed, please try again" + keep form populated.

12. **Given** the form's AbortController pattern from T2-3b
    **When** the save submit is in flight
    **Then** the Submit button is disabled, a "Saving..." indicator shows. AbortController-on-unmount applies (same pattern as T2-3b). Cancel button NOT shown for save (the operation is fast — ~100ms typical — vs. the 12-15s parse).

13. **Given** `apps/tournament-api/src/routes/admin-courses.test.ts`
    **When** the suite runs post-T2-5
    **Then** at least 8 new tests exist (per Risk Acceptance §9 list). Each test seeds an organizer + session via the existing T1-6a in-memory DB pattern. Mock `validateCourse` is NOT used — tests run the REAL T2-4 validator (it's a pure function, fast, no I/O).

14. **Given** `apps/tournament-web/src/routes/admin.courses.new.test.tsx` (NEW file)
    **When** the suite runs post-T2-5
    **Then** at least 4 component tests exist (per Risk Acceptance §9 list). `vi.stubGlobal('fetch', vi.fn())` per-test pattern; render `NewCoursePage` directly (bypass TanStack Router); mock fetch responses for `/api/auth/status`, `/api/admin/courses/parse-pdf`, and `/api/admin/courses`.

15. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint` + `pnpm -F @tournament/web typecheck` + `pnpm -F @tournament/web lint`
    **When** run post-T2-5
    **Then** all four exit 0. No new `any` types. No new `// eslint-disable` comments.

16. **Given** `pnpm -F @tournament/api test`
    **When** run post-T2-5
    **Then** total tests ≥ baseline + 8 (per AC #13). T2-5 baseline at story start: ____ (filled in by dev agent).

17. **Given** `pnpm -F @tournament/web test`
    **When** run post-T2-5
    **Then** total tests ≥ baseline + 4 (per AC #14). T2-5 baseline at story start: ____ (filled in by dev agent).

18. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T2-5
    **Then** both continue to pass with zero net-negative test count change.

19. **Given** `pnpm -F @tournament/api build` + `pnpm -F @tournament/web build`
    **When** run post-T2-5
    **Then** both exit 0. The new SPA route is bundled (PWA precache count grows by 1).

20. **Given** the deployed app at `https://tournament.dagle.cloud/admin/courses/new`
    **When** Josh manually exercises the flow (post-deploy, NOT a unit test)
    **Then**:
    - As organizer, the page renders with the empty form.
    - Manual entry of a fictional small course → Submit → 201 → success.
    - Upload one of the 5 Pinehurst PDFs → form pre-populates with parsed data → Submit → 201 → success. The new course appears in `GET /api/courses`.
    - Attempting to submit a course with the same `(club, name)` as an existing seeded course → 409 → friendly "duplicate" message.
    - Attempting to submit with par=6 → 400 → validation error displays inline.

    Manual smoke results documented in completion notes.

21. **Given** there are no SHARED-file edits in this story
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. Specifically NOT touched: `pnpm-lock.yaml`, root `package.json`, any workspace `package.json` (no new deps), `docker-compose.yml`, `Dockerfile*`, root tsconfig*, .github, .gitignore, root eslint.

22. **Given** Epic T2 status post-T2-5
    **When** the director's step 11 flips T2-5 to `done`
    **Then** sprint-status.yaml shows ALL T2 stories `done` (T2-1, T2-2, T2-3, T2-3a, T2-3b, T2-4, T2-5). Epic T2 is complete. Director's step 12 emits the epic-complete signal; next director invocation triggers the epic-completion gate (announce "Epic T2 complete. Proceed to epic T3? Run retrospective?").

## Tasks / Subtasks

- [x] Task 1: Capture pre-edit baseline test counts. (AC #16, #17)
  - [x] Subtask 1.1: tournament-api baseline 208 (post-T2-4).
  - [x] Subtask 1.2: tournament-web baseline 5 (post-T2-3b).

- [x] Task 2: Backend — extend `admin-courses.ts` with `POST /api/admin/courses` route.
- [x] Task 3: Backend — 14 new route tests in `admin-courses.test.ts` (exceeds AC #13's 8+ minimum).
- [x] Task 4: Frontend — `admin.courses.new.tsx` created.
- [x] Task 5: Frontend — 6 new component tests in `admin.courses.new.test.tsx` (exceeds AC #14's 4+ minimum).
- [x] Task 6: Regressions — all green (tournament-api 222 ✓, tournament-web 11 ✓, Wolf Cup 472/499 unchanged ✓, all typecheck/lint/build clean).
- [ ] Task 7: Manual post-deploy smoke per AC #20 — pending deploy.
- [x] Task 8: Completion notes documented below.

## Dev Notes

- **Why a single transaction across 4 tables:** the FK chain is courses ← course_revisions ← course_tees + course_holes. Without a transaction, a partial insert (e.g., courses + course_revisions succeed, then a tees insert fails on a unique constraint) leaves an orphaned course_revisions row pointing at courses. While onDelete: 'restrict' would prevent the parent from being deleted, the partial state is still confusing. Atomic all-or-nothing keeps the DB clean.

- **Why no client-side Zod (deviates from epic AC):** see Risk Acceptance §6. Single source of truth + server roundtrip latency is acceptable for an 80-field admin form + avoids new deps.

- **Why useState over react-hook-form:** see Risk Acceptance §1. One-off form, no value in adding a library dependency for a single consumer. The form has ~80 fields; useState with a single ParsedCourse-shape state object + per-field setters is verbose but linear.

- **Why dual-export Route + NewCoursePage:** matches the T2-3b pattern. Tests render the component directly bypassing TanStack Router.

- **Why the rating × 10 transform happens at the save endpoint, not at the form:** keeps the form's data-shape identical to ParsedCourse (which the upload-scorecard pre-populate flow uses directly without transformation). One conversion point at the persistence boundary; client never sees the integer form.

- **Why no client-side T2-4 mirror:** would create two sources of truth for validation rules. Server-side validation via T2-4 is canonical. Server roundtrip latency is acceptable for an admin-only form.

- **Why the "Compute totals from holes" button:** the printed totals are an OCR-error-detection feature (T2-4's rules 14-16). The organizer needs to enter them as printed on the scorecard. But during MANUAL entry (no parser), the organizer might type pars first, realize they need totals next, and hit "Compute" to fill them — same value the parser would have populated. This is a convenience affordance for manual flows.

- **Why no real-time validation feedback:** see Risk Acceptance §6. Server roundtrip on submit is sufficient. Real-time would mean client-side T2-4 mirror.

- **Why no edit-existing-course flow:** out of scope. Future story handles read existing course → modify → save new revision (the FD-8 revisioning system is in place but unused in v1).

- **Why no course-list or course-detail page in T2-5:** the existing `GET /api/courses` (T2-2) returns the list as JSON. Future T2-x story adds a course-list UI. T2-5's success-redirect just clears the form.

- **Wolf Cup isolation (FD-1 / FD-2):** T2-5 writes only to `apps/tournament-api/src/routes/admin-courses.{ts,test.ts}` (existing files, ALLOWED) and `apps/tournament-web/src/routes/admin.courses.new.{tsx,test.tsx}` (new files, ALLOWED). Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`, or any root file.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same for impl codex.
- **Retro AI-2 applied:** zero SHARED files pre-announced in §1. No gates expected during impl.
- **Retro AI-3 applied:** the SaveCourseRequestSchema (Zod) IS the contract. Tests assert exact JSON response shapes for 201/400/409/500.

### Project Structure Notes

Shape after T2-5:

```
apps/tournament-api/
  src/
    routes/
      admin-courses.ts              # MODIFIED: +POST /api/admin/courses route
      admin-courses.test.ts         # MODIFIED: +8 new tests

apps/tournament-web/
  src/
    routes/
      admin.courses.new.tsx         # NEW: course-creation form route
      admin.courses.new.test.tsx    # NEW: 4 component tests
    routeTree.gen.ts                # MODIFIED: auto-regen by tsr generate
```

**Explicitly NOT in T2-5 (reserved for future):**
- Course edit / update flow.
- Course delete.
- Bulk PDF upload.
- Course-list UI (the list endpoint exists at /api/courses).
- Course-detail page (read existing course).
- Per-row inline error mapping (errors render as a top-level list in v1).
- HEIC client-side conversion.
- Real-time client-side validation.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T2.5 (line 768).
- Predecessor stories: T2-1 (schema), T2-2 (course list API), T2-3 (parser endpoint), T2-3a (image input), T2-3b (upload UI), T2-4 (validator).
- T2-3b's 5-step auth-status loader: `apps/tournament-web/src/routes/admin.courses.upload.tsx` lines 50-78.
- T2-4 validator entry point: `apps/tournament-api/src/engine/validators/course.ts` `validateCourse` export.
- Existing courses schema: `apps/tournament-api/src/db/schema/courses.ts` (4 tables; rating × 10 discipline).
- libsql error class for UNIQUE: `LibsqlError` with `rawCode: 2067` per T1-6b auth.ts pattern (line 48).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Tournament Director skill, single-cycle invocation 2026-04-27).

### Debug Log References

- Spec codex: 3 rounds. R1: 1H + 3M (all fixed). R2: 1M + 1L (Med fixed; Low confirmed benign by inspection). R3: 0H + 0M + 2L (terminal per AI-1; both Lows folded in per user direction).
- Impl codex: 3 rounds. R1: 1H + 2M + 1L (all addressed; auth-guard test deferred per AC #14 + #20 spec design). R2: 0H + 0M + 1L (whitespace UNIQUE-bypass — fixed). R3: 0H + 0M + 1L (tee-color UI collision — deferred; T2-4 rule 10 backstop catches it).
- Party-mode: single non-interactive written review at `_bmad-output/reviews/T2-5-course-admin-ui-manual-pdf-upload-review-party-review.md`. All 5 agents (Mary/Winston/John/Quinn/Amelia) converged on "ship". Zero open questions. Zero new code-change recommendations.
- Party-codex: 0H + 0M + 3L (all minor wording overconfidence in the review TEXT, not implementation).

### Completion Notes List

**Test deltas:**
- tournament-api: 208 → 222 (+14, exceeds AC #16 minimum +8)
- tournament-web: 5 → 11 (+6, exceeds AC #17 minimum +4)
- Wolf Cup engine: 472 (unchanged ✓ AC #18)
- Wolf Cup api: 499 (unchanged ✓ AC #18)

**All checks green:** typecheck (api + web), lint (api + web), build (api + web; PWA precache 13 → 14 entries with admin.courses.new bundled).

**SHARED-gate footprint:** ZERO. Risk Acceptance §1's prediction held — third story in a row to ship without a SHARED stop (AI-2 success).

**Path footprint (all ALLOWED):**
- `apps/tournament-api/src/routes/admin-courses.ts` (extended +260 lines)
- `apps/tournament-api/src/routes/admin-courses.test.ts` (extended +330 lines, 14 new tests)
- `apps/tournament-web/src/routes/admin.courses.new.tsx` (NEW, 670 lines)
- `apps/tournament-web/src/routes/admin.courses.new.test.tsx` (NEW, 290 lines)
- `apps/tournament-web/src/routeTree.gen.ts` (auto-regen by tsr generate)
- `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` (status flips backlog → in-progress → review → done)
- `_bmad-output/implementation-artifacts/tournament/T2-5-course-admin-ui-manual-pdf-upload-review.md` (story spec)
- 5 codex review files in `_bmad-output/reviews/T2-5-*.md`

**Deviations from spec (all approved):**
- AC #14 explicitly scopes auth-guard route loader out of automated tests (covered by AC #20 manual smoke). Codex impl R1 Med #3 flagged this; honored spec scope.
- Round-3 spec Lows folded in per user direction: source_url UI form field added; rating Zod schema gained `.finite()`.
- Round-2 impl Low folded in: `.trim().min(1)` on name/club_name/tee.color + 2 regression tests.
- Round-3 impl Low (tee-color UI collision) deferred — T2-4 rule 10 backstop catches duplicate tee colors at the API layer; failure is recoverable via re-edit.

**Manual post-deploy smoke (AC #20):** PENDING. Required after `./deploy.sh` lands `tournament.dagle.cloud/admin/courses/new`.

**Followups for future stories:**
- Course-list / course-detail UI (a future T-story; out of T2-5 scope).
- Course-edit / new-revision flow (out of T2-5 scope; FD-8 schema is in place).
- Promote `isUniqueConstraintError` to a shared lib when a 3rd consumer arrives (currently duplicated in `auth.ts` + `admin-courses.ts`).
- Promote `SaveCourseRequestSchema` ↔ `ParsedCourseSchema` consolidation when a 3rd ParsedCourse consumer arrives.
- Tee-color collision UI guard (party R3 Low; T2-4 backstops it for now).
- Reset / clear-form button for organizers who pre-populate from a wrong PDF.
- Per-row inline error rendering (currently top-level list per AC #11 v1 contract).

### File List

- `apps/tournament-api/src/routes/admin-courses.ts` — modified
- `apps/tournament-api/src/routes/admin-courses.test.ts` — modified
- `apps/tournament-web/src/routes/admin.courses.new.tsx` — new
- `apps/tournament-web/src/routes/admin.courses.new.test.tsx` — new
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regenerated
