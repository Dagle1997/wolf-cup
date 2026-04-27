# T3-2: Event Creation Wizard

## Status

Done

## Story

As an organizer (Josh),
I want a multi-step form that creates an Event with its rounds + initial Group + invite link in a single transactional flow,
So that I can stand up Pinehurst 2026 (or any future event) without manually stitching together sub-resources.

T3-2 is the first user-facing T3 story. It consumes T3-1's schema directly (events + event_rounds + invites + groups) and ships an organizer-only `/admin/events/new` SPA route + `POST /api/admin/events` save endpoint.

## Risk Acceptance

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** Same posture as T2-5:

- **Form state:** React `useState` (NOT `react-hook-form`). The wizard has 3 steps but only ~6 root fields + N rounds rows. Hand-rolled state is fine.
- **Validation:** Zod schemas — but used hand-rolled (`schema.safeParse(state)` on Next/Submit click), NOT via `@hookform/resolvers/zod`. No new deps.
- **Backend:** existing `@libsql/client` + `drizzle-orm` deps + existing middleware (requireSession, requireOrganizer, bodyLimit, request-id, csrf).
- **Tests:** existing `vitest` + `@testing-library/react`. No new test infra.

If during impl the dev agent identifies a true blocker that requires a SHARED edit, it pauses for user approval at that moment. Most likely SHARED candidate: NONE expected.

**No `docker-compose.yml` changes. No `Dockerfile` changes. No env vars. No new CI checks. No DB migrations** (T3-1 just shipped them; T3-2 just consumes the tables).

### 2. Differs from T2-5 on client-side Zod (deliberate)

T2-5 deliberately deviated from its epic AC by NOT running client-side Zod (rationale: server-roundtrip-on-keystroke marginal at 80-field admin form, single source of truth for validation rules). T3-2's epic ACs explicitly call for client-side Zod and the wizard pattern benefits from it (the user must complete step 1 before step 2 makes sense; client-side validation is the gate).

**T3-2 ships client-side Zod schemas** (one per step + one composed for the final submit). The schemas are co-located in the route file (no new shared package); the same shapes are NOT used server-side directly — server has its own `CreateEventRequestSchema` (similar shape, but the server schema is the AUTHORITATIVE one). Both reference the same field-level constraints (e.g., timezone IANA validity), but maintaining two Zod sources of truth is acceptable here because the wizard is short and the schemas are visible adjacent to each other on review.

**Server validates independently** — never trusts client Zod output. Server-side parse is the security boundary.

### 3. Transaction discipline (architecture step-5: transactional create)

Persistence happens in a SINGLE DB transaction across 4 tables:

1. INSERT `events` (name, start_date, end_date, timezone, organizer_player_id, created_at, tenant_id='guyan', context_id='event:' + event.id) — generate UUID for `id` BEFORE the transaction so `context_id` can be stamped at the SAME insert.
2. INSERT `event_rounds` (one row per round in the request payload; round_number is 1-indexed by request order; tenant_id='guyan', context_id inherits parent's).
3. INSERT `invites` (1 row; token = `crypto.randomBytes(32).toString('base64url')`; expires_at = now + 7 days; created_by_player_id = organizer's player_id from session; tenant_id='guyan', context_id inherits).
4. INSERT `groups` (1 row; name = `"{event.name} Crew"` per epic AC; money_visibility_mode defaults to 'open'; tenant_id='guyan', context_id inherits).

If ANY step fails (FK violation, UNIQUE conflict, type error), the transaction rolls back — no partial event written. Drizzle's transaction API auto-rolls-back on thrown errors. The handler maps the error class to the right HTTP status (validation → 400; everything else → 500 + log). **No 409 carveout** — see §6 below; UNIQUEs reachable in this transaction (event_rounds composite + invites.token) are dev-bug or astronomically unlikely. Generic 500 is the right shape for those.

### 4. Invite token entropy (T3-1 followup pin)

Per T3-1 party review's Mary section: invite token MUST use `crypto.randomBytes(32).toString('base64url')` (matches the sessions cookie pattern). This generates a 256-bit random token, base64url-encoded → ~43 chars. T3-2's API handler is the producer; the schema only enforces UNIQUE + NOT NULL.

DO NOT use `randomUUID()` (only ~122 bits of entropy after the version+variant bits). DO NOT use a counter or timestamp.

### 5. context_id stamping discipline (T3-1 followup pin)

Per T3-1 party review's Winston section: every INSERT in the transaction MUST stamp `context_id` correctly. `events.id` generation MUST happen BEFORE the events INSERT so `context_id = 'event:' + events.id` can be set in the same insert. Children inherit (use the same string `'event:' + event.id`). The schema enforces NOT NULL but not the value — application code is the only safeguard.

The handler's logic flow:
```
const eventId = randomUUID();
const contextId = `event:${eventId}`;
await db.transaction(async (tx) => {
  await tx.insert(events).values({ id: eventId, contextId, ... });
  for (const round of body.rounds) {
    await tx.insert(eventRounds).values({ id: randomUUID(), eventId, contextId, ... });
  }
  await tx.insert(invites).values({ id: randomUUID(), eventId, token, contextId, ... });
  await tx.insert(groups).values({ id: randomUUID(), eventId, contextId, ... });
});
```

### 6. UNIQUE conflict handling

The events table has NO UNIQUE constraint on (name, ...) — multiple events with the same name are allowed (a tournament can repeat year-over-year). The only UNIQUE in this transaction is `event_rounds.uniq_event_rounds_event_round_number` (composite of event_id + round_number). The wizard's request shape forces round_number to be 1..N by array position, so this UNIQUE only fires if the dev introduces a logic bug — not a user-reachable error.

`invites.token` is also UNIQUE; the 256-bit random token has effectively zero collision probability. If somehow a collision fires, it bubbles as a generic 500 (the handler doesn't carve out a special 409 for this case).

So the API does NOT need a special `duplicate_event` 409 path. Generic transaction-failure → 500 `create_failed` is sufficient. (Differs from T2-5 which had the duplicate_course UNIQUE.)

### 7. Auth + middleware

- `POST /api/admin/events`: `requireSession → requireOrganizer → bodyLimit({ maxSize: 16 KB }) → handler`. Body shape is small (≤20 rounds × ~5 fields + header + 1 invite ≈ 2 KB; 16 KB cap is generous; matches the schema `.max(20)`).
- `bodyLimit` returns `{ error: 'bad_request', code: 'body_too_large', requestId }` on overrun (matches T2-5 JSON-endpoint shape; distinct from the upload-shape used by parse-pdf).
- Frontend route's `beforeLoad`: same 5-step auth-status loader as T2-5 (`queryClient.ensureQueryData('auth-status', ...)`); anonymous → `window.location.assign('/api/auth/google')`; non-organizer → render inline forbidden message; organizer → render the wizard. **Note epic AC says "redirects to `/auth/sign-in?next=...`" but no such route exists in tournament-web.** T3-2 follows the established T2-3b/T2-5 pattern (redirect to `/api/auth/google` directly). Documented as a deliberate divergence; pin in completion notes.

### 8. UI scope: minimal but functional, NOT a redesign

**Client-side type coercion at the wizard/payload boundary** (codex round-2 Med #3): HTML form controls return strings (e.g., `<input type="date">` → "2026-05-07", `<input type="number">` → "18", `<select>` value → "18"). The wizard's internal state holds these as strings to match controlled-input semantics; the buildPayload helper converts to the request shape:
- `start_date` / `end_date` / each `round_date`: `new Date(stringValue + 'T00:00:00Z').getTime()` → epoch ms (UTC midnight on the picked date; timezone semantics belong to the `timezone` field, not the date storage).
- `holes_to_play`: `Number(value)` returning 9 or 18.
- All other fields: trim() + pass through as strings.
Single coercion point at the submit boundary; same pattern as T2-5's buildPayload helper.

Three-step wizard. Goals:
- **Step 1 — Basics:** name (text), start_date (date input), end_date (date input), timezone (text — defaults to `Intl.DateTimeFormat().resolvedOptions().timeZone`, editable).
- **Step 2 — Rounds:** array of {round_date, course_revision_id, tee_color, holes_to_play}. "Add round" button appends a row. "Remove round" per row (disabled when only 1 row). Course picker = `<select>` populated by `GET /api/courses` (T2-2). Tee color = text input (a future story can populate from the picked course's tees; v1 is text). holes_to_play = `<select>` with options 9 + 18 (default 18).
- **Step 3 — Review:** read-only summary + "Submit" button. "Back" returns to step 2.
- Each step has Next/Back buttons; Next runs that step's Zod schema, blocks transition on error.
- Final Submit POSTs the full payload + handles 201/400/500 per AC #11 (no 409 path — see §6).

NOT in T3-2:
- Multi-event editing (the wizard is create-only).
- Event delete (separate future story).
- Inline player picker (T3-3 group CRUD handles roster).
- "Share invite link" UI (T3-2 displays the URL post-201 in the success state; sharing is manual copy-paste).
- Browser-side `Intl.timezones` autocomplete dropdown (text input with browser-default value is sufficient for v1).

### 9. Test coverage targets (mandatory)

**≥6 backend route tests** (`apps/tournament-api/src/routes/admin-events.test.ts`, NEW file mirroring admin-courses.test.ts pattern):
- Happy path: organizer POSTs valid payload → 201 with `{ eventId, inviteToken }`; verify all 4 tables got rows in the transaction.
- Validation rejection: end_date < start_date → 400 invalid_body.
- Validation rejection: round_date outside [start_date, end_date] → 400 invalid_body.
- Validation rejection: rounds array empty → 400 invalid_body.
- Validation rejection: unknown course_revision_id → 400 `{ code: 'unknown_course_revision', missing: [...] }`. NO rows written; pre-flight fires before the transaction.
- Auth: anonymous POST → 401 (require-session).
- Auth: non-organizer POST → 403 (require-organizer).
- Body-limit: oversized body → 400 body_too_large.
- Transactional rollback: stub `db.transaction` (vi.spyOn, mirror T2-5's non-UNIQUE 500 test) to throw a generic `Error('disk full')` → 500 create_failed; verify 0 events, 0 event_rounds, 0 invites, 0 groups in DB. (Cannot use invalid course_revision_id here — that's caught by the pre-flight check at AC #3, before the transaction opens.)
- context_id stamping: verify `events.context_id = 'event:' + events.id` AND child rows have the same context_id.
- Invite token shape: verify token matches `/^[A-Za-z0-9_-]+$/` (base64url charset, no padding) AND length is exactly 43 (32 random bytes → 43 base64url chars without padding). A weaker assertion like "length ≥ 32" would pass a UUID accidentally.

**≥4 frontend component tests** (`apps/tournament-web/src/routes/admin.events.new.test.tsx`, NEW):
- Idle: step 1 renders; Next button disabled until basics fields filled.
- Step transition: fill step 1 + click Next → step 2 visible; click Back → step 1 visible with values preserved.
- Validation error: fill step 1 with end_date before start_date → click Next → error message shows + stays on step 1.
- Submit success: fill all 3 steps → mock POST 201 → success message + invite-link URL displayed.

### 10. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/admin-events.ts` — NEW: the save endpoint + Zod request schema + transaction
- `apps/tournament-api/src/routes/admin-events.test.ts` — NEW: 8+ tests
- `apps/tournament-api/src/app.ts` — MODIFIED: register the new router under `/api/admin`
- `apps/tournament-web/src/routes/admin.events.new.tsx` — NEW: 3-step wizard
- `apps/tournament-web/src/routes/admin.events.new.test.tsx` — NEW: 4+ component tests
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regen by `tsr generate`
- Story file + codex review files in `_bmad-output/`

Sprint-status flips through ready-for-dev → in-progress → review → done.

NO SHARED edits expected. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/routes/admin-events.ts` (NEW)
   **When** inspected
   **Then** it exports `adminEventsRouter` (Hono instance) mounting `POST /events` (the actual path will be `/api/admin/events` once mounted in app.ts). Middleware chain on this route: `requireSession → requireOrganizer → bodyLimit({ maxSize: 16 * 1024, onError: 400 mapper }) → handler`. **CSRF protection is already applied globally** via `app.use('*', csrf({ origin }))` in `app.ts:25` (T1-6a) — same Origin-header check that protects every other unsafe-method route, including T2-5's POST /api/admin/courses. T3-2 inherits CSRF without adding it to its own chain. Body parsed via `c.req.json()` (NOT multipart). The bodyLimit `onError` returns 400 `{ error: 'bad_request', code: 'body_too_large', requestId }`.

2. **Given** the request body posted to `POST /api/admin/events`
   **When** parsed
   **Then** it MUST conform to `CreateEventRequestSchema` (Zod) defined in the route file:
   ```ts
   const CreateEventRequestSchema = z.object({
     name: z.string().trim().min(1),
     start_date: z.number().int().positive(), // epoch ms
     end_date: z.number().int().positive(),   // epoch ms
     timezone: z.string().trim().min(1).refine((tz) => isValidIanaTimezone(tz)),
     rounds: z.array(z.object({
       round_date: z.number().int().positive(),
       course_revision_id: z.string().min(1),
       tee_color: z.string().trim().min(1),
       holes_to_play: z.union([z.literal(9), z.literal(18)]),
     })).min(1).max(20),
   }).refine(
     (data) => data.end_date >= data.start_date,
     { path: ['end_date'], message: 'end_date must be on or after start_date' },
   ).refine(
     (data) => data.rounds.every((r) => r.round_date >= data.start_date && r.round_date <= data.end_date),
     { path: ['rounds'], message: 'each round_date must be within [start_date, end_date]' },
   );
   ```
   `isValidIanaTimezone` is a small helper:
   ```ts
   function isValidIanaTimezone(tz: string): boolean {
     try {
       // First arg is `locales` (string|string[]), NOT options. Pass an
       // explicit locale + the options object as the second arg, then
       // .format() to actually exercise the timeZone (some engines defer
       // validation until format time).
       new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
       return true;
     } catch {
       return false;
     }
   }
   ```
   This helper is COPIED (not imported) into both the server route file (admin-events.ts) and the client wizard file (admin.events.new.tsx) — DO NOT introduce a shared package or a `packages/tournament-shared` import; that would be a SHARED edit and we have ZERO SHARED gates this story. The two copies are 8 lines each; if a third consumer arrives in a future story, promote then. On Zod parse failure → 400 `{ error: 'bad_request', code: 'invalid_body', requestId, issues }`.

3. **Given** a valid request body that passes the Zod parse
   **When** the handler runs
   **Then** it FIRST runs a pre-flight existence check on every `course_revision_id` in the rounds array — a single `SELECT id FROM course_revisions WHERE id IN (?, ?, ...)` (drizzle: `db.select({ id: courseRevisions.id }).from(courseRevisions).where(inArray(courseRevisions.id, requestedIds))`). If any submitted ID is missing from the result set, the handler returns 400 `{ error: 'bad_request', code: 'unknown_course_revision', requestId, missing: [...] }` with the unknown IDs listed. This converts the otherwise-500 FK violation into a clean validation 400 (matches AC #1's "validation → 400" boundary).

   On success of the pre-flight, it generates `eventId = randomUUID()`, `contextId = 'event:' + eventId`, and `inviteToken = crypto.randomBytes(32).toString('base64url')`. Then opens a SINGLE drizzle transaction that inserts:
   - 1 row in `events` (`id = eventId`, `context_id = contextId`, `organizer_player_id` = the player_id from `c.get('player')`, `tenant_id = 'guyan'`).
   - N rows in `event_rounds` (`id = randomUUID()`, `event_id = eventId`, `round_number = i + 1` by array index, `tenant_id = 'guyan'`, `context_id = contextId`).
   - 1 row in `invites` (`id = randomUUID()`, `event_id = eventId`, `token = inviteToken`, `expires_at = now + 7 * 24 * 60 * 60 * 1000`, `created_by_player_id = organizer's player_id`, `tenant_id = 'guyan'`, `context_id = contextId`).
   - 1 row in `groups` (`id = randomUUID()`, `event_id = eventId`, `name = body.name + ' Crew'`, `money_visibility_mode = 'open'`, `tenant_id = 'guyan'`, `context_id = contextId`).
   On success → 201 `{ eventId, inviteToken, requestId }`.

4. **Given** any DB failure during the transaction
   **When** raised
   **Then** the handler catches generically, logs at error level via T1-7 logger (`event: 'admin_event_create_failed'`, includes eventName + error message + cause), and returns 500 `{ error: 'internal', code: 'create_failed', requestId }`. Transaction rolls back. NO partial event written. NO special 409 carveout — UNIQUE conflicts in this story (only event_rounds composite + invites.token) are dev-bug or astronomically unlikely.

5. **Given** integer-cents discipline elsewhere does NOT apply here
   **When** the handler builds the rows
   **Then** dates are stored as INTEGER epoch ms (matches T3-1 schema). No money columns are written by T3-2.

6. **Given** the `app.ts` registry
   **When** inspected post-T3-2
   **Then** `app.route('/api/admin', adminEventsRouter)` is mounted alongside the existing `adminCoursesRouter`. Both routers under the same `/api/admin` prefix — Hono allows this; each defines its own subroutes (`/courses/...` vs `/events`).

7. **Given** `apps/tournament-web/src/routes/admin.events.new.tsx` (NEW)
   **When** inspected
   **Then** it exports BOTH `Route` (TanStack file-route registration at `/admin/events/new`) AND `NewEventWizard` (named React component for direct test render). The route's `beforeLoad` reuses the T2-3b 5-step auth-status loader pattern (`queryClient.ensureQueryData('auth-status', staleTime: 30_000, retry: false)`); anonymous → `window.location.assign('/api/auth/google')`; non-organizer → render inline forbidden message; organizer → render the wizard.

8. **Given** the wizard component
   **When** rendered (idle / step 1)
   **Then** it displays:
   - Heading "New Event — Basics"
   - Inputs: name (text), start_date (date), end_date (date), timezone (text, default = `Intl.DateTimeFormat().resolvedOptions().timeZone`).
   - "Next" button. Disabled when name/start_date/end_date/timezone are not all filled OR when end_date < start_date.
   - Visible step indicator (e.g., "Step 1 of 3").

9. **Given** the user clicks "Next" on step 1 with valid basics
   **When** transition fires
   **Then** the wizard advances to step 2:
   - Heading "Rounds"
   - 1 default row (the v1 use case is single-round events; multi-round is the Pinehurst case). Each row has: round_date (date), course_revision_id (`<select>` populated by `GET /api/courses` query result), tee_color (text), holes_to_play (`<select>` with 9 + 18, default 18).
   - "Add round" button appends an empty row.
   - "Remove round" button per row (disabled when only 1 row).
   - "Back" button returns to step 1 with values preserved.
   - "Next" disabled until all rows are valid (each round_date in [start, end]; each course_revision_id non-empty; each tee_color non-empty).

10. **Given** the user clicks "Next" on step 2
    **When** transition fires
    **Then** the wizard advances to step 3 (Review):
    - Heading "Review"
    - Read-only summary: name, dates, timezone, list of rounds.
    - "Back" button returns to step 2.
    - "Submit" button triggers `POST /api/admin/events` with the full payload.

11. **Given** the Submit handler
    **When** the response arrives
    **Then** it handles:
    - 201 → success state: render "Event created!" + the invite URL constructed as `${window.location.origin}/invite/${inviteToken}` (uses the browser's current origin so the URL is correct in dev/staging/prod without env coupling). The `/invite/...` SPA route itself lives in T3-6; v1 just displays the URL string for the organizer to copy.
    - 400 invalid_body → render generic "Form data is invalid" + the issues list from the response body (developer-facing).
    - 400 body_too_large → "Form data too large" + log.
    - 500 → "Save failed, please try again" + keep wizard data.

12. **Given** AbortController-on-unmount pattern (mirror T2-5 + T2-3b)
    **When** the user navigates away mid-submit
    **Then** the in-flight fetch is aborted. Submit button is disabled while in-flight.

13. **Given** `apps/tournament-api/src/routes/admin-events.test.ts` (NEW)
    **When** the suite runs post-T3-2
    **Then** at least 8 new tests exist (per Risk Acceptance §9 list above). Each test seeds an organizer + session via the existing T1-6a in-memory DB pattern (mirror admin-courses.test.ts). Real T3-1 schema is migrated; tests insert + assert against actual events / event_rounds / invites / groups tables.

14. **Given** `apps/tournament-web/src/routes/admin.events.new.test.tsx` (NEW)
    **When** the suite runs post-T3-2
    **Then** at least 4 component tests exist (per Risk Acceptance §9 list). `vi.stubGlobal('fetch', vi.fn())` per-test pattern; render `NewEventWizard` directly bypassing TanStack Router; mock fetch responses for `/api/courses` (returns a course list for the picker) and `/api/admin/events` (the save endpoint).

15. **Given** `pnpm -F @tournament/api typecheck` + `pnpm -F @tournament/api lint` + `pnpm -F @tournament/web typecheck` + `pnpm -F @tournament/web lint`
    **When** run post-T3-2
    **Then** all four exit 0. No new `any` types. No new `// eslint-disable` comments.

16. **Given** `pnpm -F @tournament/api test`
    **When** run post-T3-2
    **Then** total tests ≥ baseline + 8 (per AC #13). T3-2 baseline at story start: 266 (post-T3-1). Final count documented in completion notes.

17. **Given** `pnpm -F @tournament/web test`
    **When** run post-T3-2
    **Then** total tests ≥ baseline + 4 (per AC #14). T3-2 baseline at story start: 11 (post-T2-5).

18. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-2
    **Then** both continue to pass with zero net-negative test count change.

19. **Given** `pnpm -F @tournament/api build` + `pnpm -F @tournament/web build`
    **When** run post-T3-2
    **Then** both exit 0. The new SPA route is bundled (PWA precache count grows by 1).

20. **Given** the deployed app at `https://tournament.dagle.cloud/admin/events/new`
    **When** Josh manually exercises the flow (post-deploy, NOT a unit test)
    **Then**:
    - As organizer, the wizard renders step 1.
    - Fill basics ("Pinehurst 2026", May 7-10 2026, America/New_York) → Next → step 2.
    - Add 4 rounds (one per day of Pinehurst trip) with course picks → Next → step 3.
    - Submit → 201 → success message with invite URL.
    - Verify rows landed via `GET /api/admin/events` (future story) OR direct DB query.
    - Anonymous browser at the URL → redirected to `/api/auth/google`.

    Manual smoke results documented in completion notes.

21. **Given** there are no SHARED-file edits in this story
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. Specifically NOT touched: `pnpm-lock.yaml`, root `package.json`, any workspace `package.json` (no new deps), `docker-compose.yml`, `Dockerfile*`, root tsconfig*, `.github`, `.gitignore`, root eslint.

22. **Given** divergence from epic AC re: anonymous redirect target
    **When** the dev agent inspects the epic vs. existing T2-3b/T2-5 pattern
    **Then** the wizard redirects anonymous to `/api/auth/google` (matches the existing OAuth-callback pattern), NOT to `/auth/sign-in?next=...` (which doesn't exist as a route in tournament-web). Documented in completion notes as a deliberate divergence; epic AC predates the T2-3b loader pattern.

## Tasks / Subtasks

- [ ] Task 1: Capture pre-edit baseline test counts. (AC #16, #17)
  - [ ] Subtask 1.1: tournament-api baseline = 266 (post-T3-1)
  - [ ] Subtask 1.2: tournament-web baseline = 11 (post-T2-5)

- [ ] Task 2: Backend — create `admin-events.ts` route. (AC #1-#5)
  - [ ] Subtask 2.1: Define `CreateEventRequestSchema` Zod with refines for date relations + IANA timezone helper.
  - [ ] Subtask 2.2: Mount route with standard middleware chain.
  - [ ] Subtask 2.3: Handler: parse body via Zod (400 invalid_body on miss), open transaction, generate ids + token, insert all 4 tables, 201 success.
  - [ ] Subtask 2.4: Catch all DB errors → 500 `create_failed` + structured log (event: 'admin_event_create_failed'). Match AC #4.

- [ ] Task 3: Backend — register `adminEventsRouter` in `app.ts`. (AC #6)

- [ ] Task 4: Backend — write 8+ route tests. (AC #13)
  - [ ] Subtask 4.1: Reuse seedSession + cookie helpers from admin-courses.test.ts pattern.
  - [ ] Subtask 4.2: Build a `validEventRequest()` helper that returns a known-valid payload (1 round, valid dates, real course_revision_id seeded in beforeEach).
  - [ ] Subtask 4.3: Write the 10 tests per Risk Acceptance §9.

- [ ] Task 5: Frontend — create `admin.events.new.tsx`. (AC #7-#12)
  - [ ] Subtask 5.1: Dual-export (Route + NewEventWizard).
  - [ ] Subtask 5.2: beforeLoad reuses T2-3b's auth-status loader.
  - [ ] Subtask 5.3: Form state: useState<{ step: 1|2|3, basics, rounds }>.
  - [ ] Subtask 5.4: Step 1 + Step 2 + Step 3 render branches with Next/Back transitions.
  - [ ] Subtask 5.5: Step 2 fetches courses via TanStack Query. The `queryFn` MUST be a thunk, not a Promise (passing the Promise directly fires fetch on render and breaks tests). Pattern:
        ```ts
        const { data: courses } = useQuery({
          queryKey: ['courses'],
          queryFn: async () => {
            const res = await fetch('/api/courses');
            if (!res.ok) throw new Error('courses_fetch_failed');
            return res.json() as Promise<{ courses: Array<{ id: string; name: string; clubName: string; latestRevision: { id: string; courseTotal: number } }> }>;
          },
          staleTime: 60_000,
        });
        ```
        Course picker `<select>` populates from `courses?.courses ?? []`.
  - [ ] Subtask 5.6: Submit handler: POST /api/admin/events, handle 201/400/500, AbortController on unmount.

- [ ] Task 6: Frontend — write 4+ component tests. (AC #14)

- [ ] Task 7: Run regressions. (AC #15-#19)

- [ ] Task 8: Manual post-deploy smoke per AC #20. Document in completion notes.

- [ ] Task 9: Document in story completion notes — final test deltas, manual smoke results, deviations from spec.

## Dev Notes

- **Why client-side Zod here but not on T2-5:** the wizard pattern needs gate validation between steps (you can't sensibly enter rounds before knowing the date range). Server-roundtrip-per-Next-click is bad UX. T2-5 is a single-page flat form where one final-submit roundtrip is fine.

- **Why no `duplicate_event` 409:** events have no `(name, ...)` UNIQUE — same-named events are allowed (e.g., "Pinehurst 2026" and "Pinehurst 2027"). The only UNIQUEs reachable here are dev-bugs.

- **Why crypto.randomBytes(32) for invite tokens:** 256-bit entropy. Matches the sessions cookie generation pattern in `apps/tournament-api/src/lib/session.ts`. Per T3-1 party-review Mary section.

- **Why redirect to `/api/auth/google` (not `/auth/sign-in?next=...`) per AC #22:** the latter route doesn't exist in tournament-web. The OAuth flow handles return-to-app via the home redirect post-callback (`PUBLIC_APP_URL + '/'`); for v1, organizer accepts they'll land on home and re-navigate. A future polish story can add the `?next=` parameter through the Set-Cookie + redirect chain.

- **Why no inline player picker in step 2:** rounds are SCHEDULE entities; players are GROUP MEMBERS (T3-3). Conflating them in the wizard would be confusing.

- **Why default 1 round in step 2 (not the epic's "one row per round"):** the epic suggested rendering N rows somehow but doesn't specify the default count. Single-round is the most common case for typical events; the Pinehurst use case adds 3 more rows manually. UX-wise, "Add round" feels lighter than "delete unused rounds you didn't want."

- **Why no `Intl.timezones` autocomplete:** the v1 use case is "Josh creates events for Guyan in America/New_York"; advanced timezone picking is a v1.5 polish story.

- **Wolf Cup isolation (FD-1 / FD-2):** T3-2 writes only to `apps/tournament-api/src/routes/admin-events.{ts,test.ts}` (NEW), `apps/tournament-api/src/app.ts` (MODIFIED), and `apps/tournament-web/src/routes/admin.events.new.{tsx,test.tsx}` (NEW). Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`, or any root file.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same for impl codex.
- **Retro AI-2 applied:** zero SHARED files pre-announced in §1. No gates expected during impl.
- **Retro AI-3 applied:** the `CreateEventRequestSchema` IS the contract. Tests assert exact JSON response shapes for 201/400/500.

### Project Structure Notes

Shape after T3-2:

```
apps/tournament-api/
  src/
    app.ts                            # MODIFIED: +adminEventsRouter mount
    routes/
      admin-events.ts                 # NEW: POST /api/admin/events
      admin-events.test.ts            # NEW: 8+ tests

apps/tournament-web/
  src/
    routes/
      admin.events.new.tsx            # NEW: 3-step wizard
      admin.events.new.test.tsx       # NEW: 4+ component tests
    routeTree.gen.ts                  # MODIFIED: auto-regen
```

**Explicitly NOT in T3-2 (reserved for future T3 stories):**
- Group CRUD UI (T3-3).
- GHIN client port (T3-4).
- Rule-set editor (T3-5).
- Invite-link claim flow (T3-6).
- Post-SSO device rebind (T3-7).
- Permissions middleware (T3-8).
- Sub-game opt-in UI (T3-9).
- Optional GHIN profile enrichment (T3-10).
- Event edit / delete (future).

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.2 (line 866).
- Predecessor stories: T1-6a (auth), T2-2 (GET /api/courses for picker), T2-3b (auth-status loader), T2-5 (form pattern), T3-1 (schema).
- T3-1 followups consumed: invite token entropy (Mary), context_id stamping discipline (Winston).
- T2-3b auth-status loader: `apps/tournament-web/src/routes/admin.courses.upload.tsx:50-78`.
- T2-5 form + AbortController pattern: `apps/tournament-web/src/routes/admin.courses.new.tsx`.
- T2-5 backend route pattern: `apps/tournament-api/src/routes/admin-courses.ts` (parse-pdf + courses save).
- T3-1 schema: `apps/tournament-api/src/db/schema/events.ts`, `groups.ts`.
- Sessions cookie crypto.randomBytes pattern: `apps/tournament-api/src/lib/session.ts`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Tournament Director skill, single-cycle invocation 2026-04-27).

### Debug Log References

- Spec codex: 4 rounds (hit AI-1 cap). R1: 2 Critical (timezone helper API + useQuery thunk) + 1 High (409 internal contradiction) + 2 Med (error code + token shape) + 1 Low (rounds count). R2: 1H (CSRF clarity) + 2M (env-portable invite URL + client coercion) + 1L (helper duplication wording). R3: 1M (pre-flight FK validation). R4 (cap): 1M (rollback test mechanism — fixed in-place via db.transaction spy). All findings folded in across the 4 rounds.
- Impl codex: 2 rounds. R1: 0H + 2M (courses query firing on wizard mount; preflight SELECT errors not caught) — both FIXED. R2: terminal clean, 0H + 0M + 1L (course-list fetch failure UX gap; deferred polish).
- Party-mode: single non-interactive written review. All 5 agents converged on "ship". Zero open questions. 15 non-blocking flags all defer/polish/downstream-spec/production-unreachable.
- Party-codex: zero findings.

### Completion Notes List

**Test deltas:**
- tournament-api: 266 → 277 (+11 new tests; 38% over AC #16 +8 minimum)
- tournament-web: 11 → 16 (+5 new tests; 25% over AC #17 +4 minimum)
- Wolf Cup engine: 472 (unchanged ✓ AC #18)
- Wolf Cup api: 499 (unchanged ✓ AC #18)

**All checks green:** typecheck (api + web), lint (api + web), build (api + web; PWA precache 14 → 15 entries with admin.events.new bundled).

**SHARED-gate footprint:** ZERO. Risk Acceptance §1's prediction held — fifth story in a row to ship without a SHARED stop (AI-2 success).

**Path footprint (all ALLOWED, 5 files + 1 modified + 1 auto-regen):**
- `apps/tournament-api/src/routes/admin-events.ts` (NEW, ~250 lines) — POST /api/admin/events save endpoint with Zod schema, isValidIanaTimezone helper, pre-flight FK check, transactional 4-table create, structured logging, error mapping
- `apps/tournament-api/src/routes/admin-events.test.ts` (NEW, ~340 lines, 11 tests)
- `apps/tournament-api/src/app.ts` (modified — 3 lines: import + mount adminEventsRouter under /api/admin)
- `apps/tournament-web/src/routes/admin.events.new.tsx` (NEW, ~470 lines) — 3-step wizard with form state machine, IANA timezone helper, course picker via gated TanStack Query, AbortController on unmount, submit handler with response shape mapping
- `apps/tournament-web/src/routes/admin.events.new.test.tsx` (NEW, ~270 lines, 5 tests)
- `apps/tournament-web/src/routeTree.gen.ts` (auto-regen)

**Deviations from epic / spec (all approved):**
- AC #22: anonymous redirect goes to `/api/auth/google` (existing OAuth pattern) NOT `/auth/sign-in?next=...` (epic line 888 mentions a route that doesn't exist). Documented in Risk Acceptance §7 + AC #22.
- No 409 carveout: events have no UNIQUE on name; UNIQUEs reachable in this transaction (event_rounds composite + invites.token) are dev-bug or astronomically unlikely. Differs from T2-5 which has duplicate_course 409.
- isValidIanaTimezone helper COPIED to both server + client (NOT a shared package; preserves no-SHARED posture). Same Intl.DateTimeFormat engine-deferred .format() pattern in both copies.
- Two-Zod-schema (client CreateEventRequestSchema + server CreateEventRequestSchema) intentional drift — short schemas + visible-adjacent file structure makes this acceptable for v1.

**Manual post-deploy smoke (AC #20):** PENDING. Required after `./deploy.sh` lands `tournament.dagle.cloud/admin/events/new`. Verify:
- Wizard renders for organizer; ForbiddenMessage for non-organizer; redirect for anonymous.
- Step 1 → Step 2 → Step 3 transitions with values preserved on Back.
- Course picker populates from /api/courses (5 Pinehurst-area courses seeded).
- Submit creates a real event row + invite token; success URL displayed.
- Anonymous browser at the URL → redirected to /api/auth/google.

**Followups for future stories:**
- T3-3 (group CRUD) will be the 3rd `/api/admin` router mount. At ~5 mounts, promote umbrella `adminRouter` per Winston's note.
- T3-6 (invite-claim flow) MUST check `invites.expires_at < Date.now()` → 410 Gone. Token NOT to be logged anywhere downstream.
- ?next= parameter through OAuth flow so anonymous → wizard → sign-in returns to wizard (not home). Future polish.
- Course-list fetch failure UX on step 2 (impl-codex R2 Low). Future polish.
- "Save draft" / localStorage persistence for the wizard. Future polish if organizer feedback shows >2 minutes per event creation.
- Edit/delete event UI. Future T-story; v1 contingency = SSH + sqlite3.
- T7 display code MUST render round_date with the event's tz (round_date is stored as UTC midnight; tz lives on the event row).

### File List

- `apps/tournament-api/src/routes/admin-events.ts` — new
- `apps/tournament-api/src/routes/admin-events.test.ts` — new
- `apps/tournament-api/src/app.ts` — modified
- `apps/tournament-web/src/routes/admin.events.new.tsx` — new
- `apps/tournament-web/src/routes/admin.events.new.test.tsx` — new
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regenerated
