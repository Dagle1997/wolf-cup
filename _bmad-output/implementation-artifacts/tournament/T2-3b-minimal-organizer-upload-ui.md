# T2-3b: Minimal Organizer Upload UI (covers T2-3 + T2-3a)

## Status

Ready for Dev

## Story

As a tournament organizer (Josh),
I want a simple SPA route at `/admin/courses/upload` where I can pick a PDF or take a phone photo and see the parsed JSON,
So that the phone-photo and PDF-upload paths are usable end-to-end without needing curl or an API client.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**One SHARED file edit required at impl time:** `pnpm-lock.yaml` — consequence of adding 4 new test-tooling devDeps to `apps/tournament-web/package.json` (which is ALLOWED — workspace package.json under `apps/tournament-web/**`). The lockfile MUST be included in the commit per the tournament-director's required-inclusion rule (workspace dep changes mandate lockfile inclusion); pnpm-lock.yaml is SHARED so impl pauses for user approval at the moment of edit.

**Devdeps to add (T2-3b establishes the React-component-testing pattern for the entire tournament-web roadmap — T2-5 admin UI, T3.x player UI, all future UI work consumes these same tools):**

- `@testing-library/react` — industry-standard React component testing API (render, screen, fireEvent, etc.). Same library Wolf Cup's `apps/web` uses (FORBIDDEN to inspect for path-allowlist reasons; documented in T1-3 architecture choice).
- `@testing-library/jest-dom` — extra matchers (`toBeInTheDocument`, `toHaveTextContent`, etc.) that work with Vitest's expect. Tiny, ergonomic-only.
- `@testing-library/user-event` — higher-level user interaction helpers (`userEvent.click`, `userEvent.upload`, etc.) — closer to real user behavior than fireEvent.
- `jsdom` — DOM environment for Vitest. Enables `document.querySelector`, `window.fetch` mocks, etc. Alternative `happy-dom` is faster but less complete; T2-3b uses the more compatible jsdom to maximize "Wolf Cup web testing patterns transfer cleanly" if/when we ever consolidate testing tooling across the monorepo.

`apps/tournament-web/vitest.config.ts` changes from `environment: 'node'` to `environment: 'jsdom'`. This is ALLOWED (one-line edit to a tournament-web file). Existing test (`src/lib/query-client.test.ts`) is environment-agnostic — pure object inspection — and continues to pass under jsdom.

No SHARED gate at the workspace package.json level — `apps/tournament-web/package.json` is ALLOWED. The lockfile is the only SHARED file in this story.

**No Dockerfile changes. No docker-compose env-var additions. No CI changes. No tournament-api Dockerfile changes.** Wolf Cup is untouched (FD-1 / FD-2 held).

### 2. Backend extension to `/api/auth/status` is required

T1-6a shipped a stub at `GET /api/auth/status` that returns `{ auth: 'infrastructure-ready', oauth: 'pending-t1-6b' }`. T1-6b shipped Google OAuth + sessions but did NOT update this endpoint, so it's still a stub today (verified 2026-04-26 against `apps/tournament-api/src/routes/auth.ts:50-52`).

T2-3b needs `/api/auth/status` to return current authentication state so the SPA's route loader can decide: redirect to sign-in, redirect to forbidden, or render the upload page. Spec extends the endpoint to return:

```ts
// Anonymous (no session cookie OR invalid session):
{ player: null }

// Authenticated:
{ player: { id: string, isOrganizer: boolean } }
```

This is a tournament-api change in `apps/tournament-api/src/routes/auth.ts` — ALLOWED. Tests in `apps/tournament-api/src/routes/auth.test.ts` extend to cover both branches. The change is opt-in: `/api/auth/status` previously had NO consumers, so widening the response shape from a stub-flag to a richer object is a pure addition. The old `auth: 'infrastructure-ready'` and `oauth: 'pending-t1-6b'` fields are REMOVED — they were stub debugging strings and are no longer accurate post-T1-6b.

### 3. Auth-guard pattern + redirect targets

The route loader (TanStack Router's `beforeLoad` or `loader` hook) calls `GET /api/auth/status` once at navigation. Four branches:

- `{ player: null }` (unauthenticated) → redirect to **`/api/auth/google`** (RELATIVE same-origin URL — works in production at `tournament.dagle.cloud` AND in local dev where Vite's `server.proxy['/api']` forwards to `http://localhost:3000`). Use `window.location.assign('/api/auth/google')` rather than TanStack `redirect()` because the destination is a non-SPA URL that must round-trip Set-Cookie + 302 through the API. Same-origin relative URL avoids the bug where a hard-coded `https://tournament.dagle.cloud/...` would break local dev or any future staging deployment.
- `{ player: { isOrganizer: false } }` (authenticated but not organizer) → render an inline forbidden message with a "Sign in as a different account" link that hits `/api/auth/google` (which sets a fresh OAuth flow — re-prompts Google for account picker). NO new SPA route file (`auth.forbidden.tsx`) for T2-3b; the message is rendered inline in the upload route component when `isOrganizer === false`. Future T3.x story may extract a proper "forbidden" page.
- `{ player: { isOrganizer: true } }` → render the upload form.
- **Fetch failure (5xx, 4xx, network error, non-JSON body, malformed JSON, unexpected shape):** treat as `{ player: null }` (anonymous) — redirect to `/api/auth/google`. Rationale: a 5xx on `/api/auth/status` likely means tournament-api is in trouble; redirecting to OAuth flow is the safest UX (the API will either recover and the OAuth round-trip will succeed, OR the user will see Google sign-in fail and know something's broken — better than rendering a blank "stuck loading" page or an infinite retry loop).

  **Loader implementation contract** (every check below MUST be present; `fetch` does NOT throw on 4xx/5xx, so a try/catch ALONE is insufficient):
  1. `const res = await fetch('/api/auth/status').catch(() => null);` — coerce network errors to `null`.
  2. `if (res === null || !res.ok) → return { player: null }` — covers network failure AND any 4xx/5xx response.
  3. `const body = await res.json().catch(() => null);` — coerce JSON-parse failures to `null`.
  4. `if (body === null) → return { player: null }`.
  5. **Shape validation** — body must be EITHER `{ player: null }` OR `{ player: { id: string, isOrganizer: boolean } }`. Anything else (extra fields are OK; missing or wrong-typed fields are not) → return `{ player: null }`. Spec implementer writes a tiny validator (4-5 lines) — does NOT add Zod as a dep just for this one shape (workspace already has Zod, but pulling Zod into tournament-web for one validator is overkill — see Dev Notes for the rationale).

Loader uses TanStack Query (already in deps) to cache the auth-status response per-tab; staleTime: 30s so a freshly-promoted organizer sees the change within 30s without manual refresh. On fetch error, `retry: 0` so we don't pile up failed requests.

### 4. File-input MIME affordances

The single `<input type="file" name="pdf">`:

- `accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"` — the union of T2-3 + T2-3a route accept-list (minus `image/gif`, which the backend rejects with `unsupported_mime_gif` — exposing it in `accept` would let users pick a GIF that the backend will reject, bad UX).
- `capture="environment"` — on iOS/Android Safari/Chrome, this attribute makes the file picker offer "Take Photo" using the rear-facing camera in addition to "Photo Library" / "Choose File". On desktop browsers it's ignored (standard fallback). Critical for the "be at the course on tournament day" use case.
- Browser-side MIME enforcement is informative-only; the backend's magic-byte check (T2-3a) is authoritative.

The form field name MUST be `pdf` — that's what T2-3's route handler reads (`body['pdf']`). Inaccurate name (now also accepts images) is preserved per T2-3a's "endpoint name preserved despite scope drift" rationale.

### 5. Loading state with cancel

T2-3 + T2-3a parse latency is 10-18s observed. The UI shows "Reading scorecard... this may take ~15 seconds" with a cancel button while the request is in flight. Cancel uses `AbortController.abort()` — the route handler's body-limit middleware + parser timeout already handle the server side.

### 6. Error-message lookup table (no raw codes shown to user)

The route handler returns 4xx/503 with a `code` field. The UI maps codes to user-facing messages:

| Code | User message |
|---|---|
| `missing_file` | "Please pick a file before submitting." |
| `file_too_large` | "File is too large (10 MB max). Please use a smaller image or PDF." |
| `wrong_mime` | "We can't open that kind of file. Please use a PDF or a JPEG / PNG / WebP image." |
| `wrong_magic` | "That file looks corrupted or isn't actually a PDF/image. Try a different file." |
| `unsupported_mime_heic` | "iPhone photos are HEIC by default. Please convert to JPEG and try again." (T2-3b followup: client-side HEIC→JPEG conversion is a future enhancement; for now, the user does the conversion.) |
| `unsupported_mime_gif` | "GIFs aren't supported. Please use a static image (JPEG / PNG / WebP) or a PDF." |
| `vision_api_failed` | "Parser is unavailable. Please try again in a minute, or enter the course manually from the admin home." |
| (any other code or no code) | "Something went wrong. Please try again." (generic fallback) |

Lookup table lives in a single constant inside the route component, not in a separate file (no consumer beyond this route until T2-5 lands). T2-5 may extract this into a shared `lib/upload-errors.ts` if/when its admin UI also handles the same error codes.

### 7. Success-state UX (NOT a save / edit form — explicitly minimal)

The success state shows a READ-ONLY summary — NOT an edit form. Fields rendered:

- Course name (h2)
- Club name (subtitle)
- Tee count + tee table (color | rating | slope)
- Printed totals (out_total, in_total, course_total)
- Hole 1's per-tee yardages as an example of the structure (NOT all 18 holes — that's overwhelming; the JSON is the source of truth for downstream tooling)
- A "Try another" button that resets the route to the idle state

NO "Save" button. NO "Edit" button. NO persistence. T2-3b explicitly does NOT close the loop with the database — that's T2-5's job (admin UI with edit form + persistence endpoint at `POST /api/admin/courses`).

### 8. Component testing pattern establishes tournament-web baseline

T2-3b is the FIRST tournament-web component-test story. Patterns established here become the template for T2-5 and beyond. Spec specifies:

- **Test file co-located with route file:** `apps/tournament-web/src/routes/admin.courses.upload.test.tsx` next to `admin.courses.upload.tsx`. Same convention Wolf Cup's `apps/web` uses (verified by directory listing — NOT by reading Wolf Cup files; FD-1 boundary held).
- **Vitest environment** changed from `node` to `jsdom` in `apps/tournament-web/vitest.config.ts` (one-line edit, ALLOWED).
- **`@testing-library/react` + `@testing-library/user-event`** for component rendering + interaction.
- **`@testing-library/jest-dom`** for ergonomic matchers; imported once in `src/test-setup.ts` (NEW file, ALLOWED).
- **MSW (Mock Service Worker)** is NOT added — too heavy for this scope. Mock `fetch` directly via `vi.spyOn(global, 'fetch')` for the `/api/auth/status` and `/api/admin/courses/parse-pdf` calls. T2-5 may revisit if the per-test `fetch` mocking becomes painful.

### 9. The PWA service-worker concern

Tournament-web has a service worker (T2-3 hotfix removed runtime API caching; static-asset caching remains). T2-3b's upload form posts a multipart body to `/api/admin/courses/parse-pdf`. Verify (manually post-deploy, NOT in unit tests) that the SW does not intercept POST requests with multipart bodies — if it does, file uploads would mysteriously fail in the production-installed PWA. Add a brief manual smoke step to AC #15.

## Acceptance Criteria

1. **Given** `apps/tournament-web/package.json`
   **When** inspected post-T2-3b
   **Then** `devDependencies` gains exactly 4 entries (versions resolved at `pnpm add` time):
   - `@testing-library/react`
   - `@testing-library/jest-dom`
   - `@testing-library/user-event`
   - `jsdom`
   No other dep changes. `pnpm-lock.yaml` updates accordingly (SHARED — pre-announced in §1, requires user gate at the `pnpm add` moment).

2. **Given** `apps/tournament-web/vitest.config.ts`
   **When** inspected post-T2-3b
   **Then** `test.environment` is `'jsdom'` (was `'node'`). `setupFiles` adds `'./src/test-setup.ts'`. No other config changes.

3. **Given** `apps/tournament-web/src/test-setup.ts` (NEW file)
   **When** inspected post-T2-3b
   **Then** it imports `'@testing-library/jest-dom/vitest'` (or `/vitest-globals` per the testing-library docs at install time; impl-pin the exact import path against the installed version). No other content beyond a 2-line module header doc-comment explaining its purpose.

4. **Given** `apps/tournament-api/src/routes/auth.ts`
   **When** inspected post-T2-3b
   **Then** the `GET /api/auth/status` route is REWRITTEN (not added — replaces the existing stub at lines 50-52) to return:
   - `{ player: null }` (HTTP 200) when there's no session cookie OR the session is invalid (expired / unknown session_id).
   - `{ player: { id: string, isOrganizer: boolean } }` (HTTP 200) when the session is valid.

   The handler reads the `tournament_session` cookie via the existing T1-6a session helpers (DO NOT re-implement cookie parsing). On valid session, looks up `players` by the session's `playerId` and returns `id` + `isOrganizer`. The endpoint does NOT use the `requireSession` middleware — it must succeed on anonymous requests too (returning `{ player: null }`).

   The old fields `auth: 'infrastructure-ready'` and `oauth: 'pending-t1-6b'` are REMOVED — they were T1-6a debugging strings and are no longer accurate.

5. **Given** `apps/tournament-api/src/routes/auth.test.ts`
   **When** inspected post-T2-3b
   **Then** the existing T1-6b test for `GET /status` is rewritten and 3 new tests are added:
   - **Anonymous (no cookie):** assert response is 200 with body `{ player: null }`.
   - **Invalid session_id (cookie sent but no matching row in `sessions`):** assert response is 200 with body `{ player: null }`. This is a defense-in-depth scenario — a stale cookie from a deleted session should be treated as anonymous, not 5xx or 401.
   - **Authenticated organizer:** seed an organizer player + session; cookie sent; assert 200 with body `{ player: { id: <uuid>, isOrganizer: true } }`.
   - **Authenticated non-organizer:** seed a non-organizer player + session; cookie sent; assert 200 with body `{ player: { id: <uuid>, isOrganizer: false } }`.
   Existing T1-6b tests for `/auth/google` and `/auth/google/callback` continue to pass byte-unchanged.

6. **Given** `apps/tournament-web/src/routes/admin.courses.upload.tsx` (NEW file)
   **When** inspected post-T2-3b
   **Then** it exports BOTH:
   - `export const Route = createFileRoute('/admin/courses/upload')({...})` — TanStack file-route registration (consumed by `routeTree.gen.ts`).
   - `export function UploadCoursePage(...) { ... }` — the React component, exported as a NAMED EXPORT so the test file can import it directly. Required because `createFileRoute({ component: UploadCoursePage })` typically encloses the component in the Route config; without an explicit named export the test file can't render the component in isolation. The component is also referenced from inside `Route` via `component: UploadCoursePage` — both routes lead to the same function instance.

   The Route configuration includes:
   - A `loader` (or `beforeLoad`) hook that fetches `GET /api/auth/status` and:
     - calls `window.location.assign('/api/auth/google')` (RELATIVE same-origin URL per Risk Acceptance §3) when `player === null` OR when the fetch itself fails (5xx, network error, non-JSON body — all treated as anonymous per the spec's fetch-failure branch).
     - returns `{ player }` to the component when `player.isOrganizer === true`.
     - returns `{ player }` to the component when `player.isOrganizer === false` (the component renders the inline "not organizer" message).
   - The fetch is wrapped per Risk Acceptance §3's "Loader implementation contract" — five explicit checks (network failure → null, !res.ok, JSON parse failure, body null, shape validation). A try/catch alone is insufficient because `fetch` does NOT throw on 4xx/5xx (returns a non-ok Response). The shape validator is a small inline function, not a Zod dep addition. Each of the 5 failure paths converts to `{ player: null }` → triggers the anonymous-redirect branch. NO retry — a single attempt is enough; if `/api/auth/status` is itself broken the OAuth round-trip will surface the issue to the user clearly.
   - A `component` that renders one of FOUR states based on local React state:
     - `idle` (initial OR after "Try another"): file input + Submit button (Submit disabled until file chosen)
     - `uploading`: progress message ("Reading scorecard... this may take ~15 seconds") + Cancel button
     - `success`: read-only summary per Risk Acceptance §7 + "Try another" button
     - `error`: code-keyed user message per Risk Acceptance §6 + "Try another file" button
   - `<input type="file">` carries `accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"` and `capture="environment"`.
   - `<form>` `onSubmit` handler builds a `FormData` with the file as the `pdf` field, calls `fetch('/api/admin/courses/parse-pdf', { method: 'POST', body: formData, signal: abortController.signal })`, awaits the JSON response, transitions to `success` (200) or `error` (4xx/503).

7. **Given** the `<form>` submit handler in `admin.courses.upload.tsx`
   **When** the user clicks "Cancel" while in the `uploading` state
   **Then** the component invokes `abortController.abort()` and transitions to `idle` state. NO error is shown for user-initiated cancellation. The unmounted/aborted `fetch` does not cause uncaught rejection (per AbortController spec).

8. **Given** the SPA renders the inline "not organizer" message (when authenticated but `isOrganizer === false`)
   **When** inspected
   **Then** the message reads (semantically equivalent — exact wording is impl call): "You're signed in as <player_id-shortened-for-privacy or omit> but don't have organizer permissions. Contact Josh to grant organizer access, or [sign in as a different account]." The "sign in as a different account" link is an `<a href="/api/auth/google">` (relative URL — same-origin, browser handles correctly).

9. **Given** `apps/tournament-web/src/routes/admin.courses.upload.test.tsx` (NEW file)
   **When** the suite runs post-T2-3b
   **Then** at least 4 tests exist covering the 4 states. Tests use the following EXPLICIT pattern (no dev-agent judgment required):

   **Test harness setup (shared across all 4 tests, defined as a `renderUploadRoute()` helper at the top of the test file):**
   - Use `vi.stubGlobal('fetch', vi.fn())` per-test (`beforeEach`) to provide a clean fetch mock; ensures jsdom's `fetch` (Node 18+ provides one) is overridden cleanly. `vi.unstubAllGlobals()` in `afterEach`.
   - Import the component via the NAMED EXPORT (`import { UploadCoursePage } from './admin.courses.upload'`) — required because `createFileRoute` is a side-effecting registration. The route file MUST export `UploadCoursePage` as a named export per AC #6 for this to work. Render via `render(<UploadCoursePage />)` — bypass TanStack Router entirely for these tests. The 4 component-level tests verify VIEW behavior (idle/uploading/success/error rendering); the loader / auth-guard logic is tested separately via the tournament-api tests in AC #5 (auth-status returns the right shape) + the SPA's loader is exercised at AC #15's manual smoke. Bypassing the router test harness is the standard React-component-test pattern.
   - Mock `window.location.assign` via `vi.spyOn(window.location, 'assign').mockImplementation(() => {})` so loader-driven redirects don't throw in jsdom. (Only relevant if a test exercises the loader directly; the 4 component tests skip the loader.)

   **The 4 tests:**
   - **Idle state:** render `<UploadCoursePage />` directly. Assert: file input present (queryable via `screen.getByRole('button', { name: /submit/i })` or by the input's accessible name), Submit button disabled, no "Reading scorecard" text visible, no error visible.
   - **Uploading state:** render, `userEvent.upload(fileInput, fixtureFile)`, click Submit. Mock `fetch` returns a controllable promise via `let resolveParse: (v: Response) => void; mockFetch.mockImplementationOnce(() => new Promise<Response>((r) => { resolveParse = r; }))`. While the promise is pending, assert: "Reading scorecard..." visible, Cancel button present, Submit hidden or disabled.
   - **Success state:** as uploading, then call `resolveParse(new Response(JSON.stringify(canonicalParsed), { status: 200 }))`. Wait for state transition with `await waitFor(() => expect(screen.getByText(/try another/i)).toBeInTheDocument())`. Assert: course name rendered, tee count rendered, "Try another" button present.
   - **Error state:** as uploading, but `resolveParse(new Response(JSON.stringify({ error: 'bad_upload', code: 'wrong_mime' }), { status: 400 }))`. Assert: user-friendly message ("we can't open that kind of file...") visible (NOT the raw `wrong_mime` code), "Try another file" button present.

10. **Given** `pnpm -F @tournament/web typecheck` + `pnpm -F @tournament/web lint`
    **When** run
    **Then** both exit 0 under existing strictness flags. No new `any` types. The TanStack Router type-augmentation in `main.tsx` correctly registers the new route (auto-generated by `tsr generate`).

11. **Given** `pnpm -F @tournament/web test`
    **When** run post-T2-3b
    **Then** total tests ≥ baseline + 4 (the 4 new component tests). Existing tests (`src/lib/query-client.test.ts`) continue to pass under the new jsdom environment.

12. **Given** `pnpm -F @tournament/api test`
    **When** run post-T2-3b
    **Then** total tests ≥ baseline + 3 (the 3 new auth-status tests per AC #5: invalid-session, authenticated-organizer, authenticated-non-organizer; the existing anonymous-no-cookie test is REWRITTEN — its assertion changes from the old stub-flag check to `{ player: null }` — but its count stays the same). T2-3 + T2-3a tests continue to pass.

13. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T2-3b
    **Then** both continue to pass with zero net-negative test count change. Tournament T2-3b does not touch `apps/api/**`, `apps/web/**`, or `packages/engine/**`.

14. **Given** `pnpm -F @tournament/web build`
    **When** run post-T2-3b
    **Then** exits 0 and emits the new route bundle. `tsr generate` runs cleanly (no missing route imports). Service-worker bundle includes the new route's static assets (no runtime API caching introduced — preserves T2-3.1 hotfix).

15. **Given** the deployed app at `https://tournament.dagle.cloud/admin/courses/upload`
    **When** Josh manually exercises the flow (post-deploy, NOT a unit test)
    **Then**:
    - Navigating while signed-out redirects to Google OAuth
    - Navigating while signed-in as organizer renders the upload form
    - Picking a JPG and submitting returns parsed course data within ~15s
    - On iPhone Safari, tapping the file input offers a "Take Photo" option (camera-capture)
    - The PWA service worker does NOT intercept the POST upload (verify via DevTools Network tab — request reaches the server, isn't served from cache)

    Manual smoke results documented in completion notes.

16. **Given** the SHARED-file edit (`pnpm-lock.yaml`)
    **When** the dev agent reaches the `pnpm add` step
    **Then** it pauses, announces the exact 4 packages being added + the lockfile diff that will result, and waits for explicit user approval before running `pnpm add`. Per tournament-director protocol, this is the only SHARED gate in T2-3b.

## Tasks / Subtasks

- [ ] Task 1: Capture pre-edit baseline test counts. (AC #11, #12)
  - [ ] Subtask 1.1: Run `pnpm -F @tournament/web test`; record total. (Currently 1 test in `src/lib/query-client.test.ts`.)
  - [ ] Subtask 1.2: Run `pnpm -F @tournament/api test`; record total. (Currently 172 post-T2-3a.)

- [ ] Task 2: Rewrite `GET /api/auth/status` to return `{ player: null }` or `{ player: { id, isOrganizer } }`. (AC #4)
  - [ ] Subtask 2.1: Read the cookie + look up session via existing T1-6a helpers.
  - [ ] Subtask 2.2: Look up player by session's playerId; project `id` + `isOrganizer`.
  - [ ] Subtask 2.3: Remove the old stub fields.

- [ ] Task 3: Update `auth.test.ts` for the new status shape. (AC #5, #12)
  - [ ] Subtask 3.1: Rewrite the existing T1-6b status test — anonymous case (assertion changes from `{ auth, oauth }` to `{ player: null }`; net test count unchanged).
  - [ ] Subtask 3.2: Add **3 net-new tests**: (a) invalid session_id (cookie sent but no matching `sessions` row → `{ player: null }`), (b) authenticated organizer (→ `{ player: { id, isOrganizer: true } }`), (c) authenticated non-organizer (→ `{ player: { id, isOrganizer: false } }`). Per AC #12, tournament-api total grows by exactly +3.

- [ ] Task 4: Announce SHARED-file gate (pnpm-lock.yaml + the 4 devDeps to add to apps/tournament-web/package.json). Wait for user approval. (AC #1, #16)

- [ ] Task 5: Run `pnpm --filter @tournament/web add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom`. (AC #1)

- [ ] Task 6: Update `apps/tournament-web/vitest.config.ts` to use `jsdom` environment + setupFiles. (AC #2)

- [ ] Task 7: Create `apps/tournament-web/src/test-setup.ts`. (AC #3)

- [ ] Task 8: Create `apps/tournament-web/src/routes/admin.courses.upload.tsx`. (AC #6, #7, #8)
  - [ ] Subtask 8.1: TanStack file-route + loader hook.
  - [ ] Subtask 8.2: 4-state component (idle / uploading / success / error).
  - [ ] Subtask 8.3: File input with accept + capture.
  - [ ] Subtask 8.4: Form submit + AbortController + fetch call.
  - [ ] Subtask 8.5: Error-code lookup table.
  - [ ] Subtask 8.6: Success-summary read-only view.

- [ ] Task 9: Create `apps/tournament-web/src/routes/admin.courses.upload.test.tsx`. (AC #9)
  - [ ] Subtask 9.1: Mock fetch (`/api/auth/status` + `/api/admin/courses/parse-pdf`).
  - [ ] Subtask 9.2: 4 state tests.

- [ ] Task 10: Run regressions. (AC #10, #11, #12, #13, #14)
  - [ ] Subtask 10.1: `pnpm -F @tournament/web typecheck` clean (incl. tsr generate).
  - [ ] Subtask 10.2: `pnpm -F @tournament/web lint` clean.
  - [ ] Subtask 10.3: `pnpm -F @tournament/web test` — baseline + ≥4.
  - [ ] Subtask 10.4: `pnpm -F @tournament/web build` clean.
  - [ ] Subtask 10.5: `pnpm -F @tournament/api test` — baseline + ≥2.
  - [ ] Subtask 10.6: `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` — both unchanged.

- [ ] Task 11: Manual post-deploy smoke. (AC #15)
  - [ ] Subtask 11.1: After commit + push + deploy, Josh navigates to `https://tournament.dagle.cloud/admin/courses/upload` in browser. Documents: signed-out redirect to Google works, signed-in renders form, JPG upload returns parsed data, iPhone camera-capture works, SW does not intercept POST.

- [ ] Task 12: Document in story completion notes.

## Dev Notes

- **Why TanStack Router file-based routing:** the rest of `apps/tournament-web/src/routes/` already uses file-based routing (`__root.tsx`, `auth.declined.tsx`, `index.tsx`). Maintaining the convention means `tsr generate` picks up the new route automatically. The `.` in the filename (`admin.courses.upload.tsx`) maps to `/admin/courses/upload` per TanStack's convention (each segment becomes a path part). Alternative: nested directories (`admin/courses/upload.tsx`) would also work but breaks the established flat-file convention.

- **Why no `auth.forbidden.tsx` page:** the inline "not organizer" message is enough for T2-3b's scope. A dedicated forbidden route adds a route file + a route entry + a loader for that route — overhead with little benefit until we have multiple admin routes that all need the same "you're authenticated but not authorized" UX. T2-5 (admin UI suite) is the natural extraction trigger.

- **Why TanStack Query for auth-status caching (vs direct fetch):** TanStack Query is already in deps. Caching the auth status with a 30s staleTime means navigating between admin routes (when more land in T2-5) doesn't re-fetch on every navigation. The cost of using it for one route now is ~5 lines; the benefit compounds as more routes adopt the same pattern.

- **Why `window.location.assign(...)` for OAuth redirect (not TanStack Router redirect):** TanStack Router's `redirect()` is for SPA-internal navigation. The OAuth flow needs to leave the SPA entirely (the API endpoint sets cookies + 302s to Google + Google 302s back). `window.location.assign()` is the correct primitive.

- **Why `accept` attribute is informative-only:** browsers show the accept hint in the file picker UI, but they do NOT enforce it server-side and will let users override it via "All Files" or by drag-and-drop in some implementations. The backend's MIME pre-filter + magic-byte check (T2-3 + T2-3a) is authoritative; the `accept` attribute is purely for UX (default-show-relevant-files in the picker dialog).

- **Why `capture="environment"` and not `capture="user"`:** rear-facing camera (`environment`) is what you point at the printed scorecard sitting on the bag-drop counter. Front-facing (`user`) is selfie cam — wrong tool. Some browsers ignore `capture` entirely on desktop; the file input still works as a regular file picker there.

- **Why no progress percentage during upload:** modern fetch doesn't expose upload progress without using XHR or the experimental Streams API. The 10-18s wait is dominated by the Anthropic Vision call (server-side), not the upload itself (which is <1s for a 1 MB file on broadband). A "Reading scorecard..." status message is sufficient UX without engineering a progress bar. T2-5 may revisit if user feedback warrants.

- **Why `apps/tournament-web/package.json` is ALLOWED but `pnpm-lock.yaml` is SHARED:** workspace package.json files inherit the workspace's allowlist (`apps/tournament-web/**`). The root lockfile is the only real SHARED concern because lockfile changes affect every workspace's resolved versions. The director protocol's required-inclusion rule mandates including the lockfile when any package.json dep changes.

- **Why `jsdom` over `happy-dom`:** happy-dom is faster but has incomplete API coverage; jsdom is the established standard with broader compatibility. For T2-3b's small surface (component render + user-event clicks/uploads), the speed difference is irrelevant. Choosing jsdom maximizes the chance that future tests work without per-test workarounds.

- **Why `@testing-library/user-event` over `fireEvent`:** user-event simulates real user interaction (focus, hover, click sequence, keyboard events) whereas fireEvent dispatches raw DOM events. user-event catches more real-world bugs (e.g., a button that's clickable but not focusable). Same library Wolf Cup uses (per spec note above; FD-1 boundary held — this is published-library knowledge, not a Wolf Cup-codebase peek).

- **Why mock `fetch` with `vi.spyOn` over MSW:** MSW (Mock Service Worker) is the gold standard for HTTP mocking in component tests but adds dependency weight. For T2-3b's 4 tests touching 2 endpoints (auth/status + parse-pdf), `vi.spyOn(global, 'fetch')` is sufficient. T2-5 may upgrade to MSW if its admin UI has many more endpoint interactions.

- **Why no E2E tests (Playwright/Cypress):** out of scope per epic note ("NO E2E browser tests required — those land in a future testing story"). Component tests + AC #15 manual smoke fill the verification gap for T2-3b.

- **Wolf Cup isolation (FD-1/FD-2):** T2-3b writes only to `apps/tournament-web/**` (ALLOWED), `apps/tournament-api/src/routes/auth.{ts,test.ts}` (ALLOWED — minor extension), `pnpm-lock.yaml` (SHARED, approved per AC #16). Zero writes to `apps/api/**`, `apps/web/**`, or `packages/engine/**`. The Wolf Cup web app's testing patterns are referenced in spec rationale (jsdom choice, testing-library usage) as published-library knowledge — NOT by reading Wolf Cup files.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same for impl codex.
- **Retro AI-2 applied:** SHARED gate (pnpm-lock.yaml) pre-announced in §1. Dev agent re-announces at Task 4 + 5 before running `pnpm add`.
- **Retro AI-3 applied:** the auth-status response shape is the contract. Tests are written first (Task 3) before route rewrite is wired through to the SPA loader.

### Project Structure Notes

Shape after T2-3b:

```
apps/tournament-web/
  package.json                                        # MODIFIED: +4 devDeps
  vitest.config.ts                                    # MODIFIED: environment node→jsdom + setupFiles
  src/
    test-setup.ts                                     # NEW: imports @testing-library/jest-dom/vitest
    routes/
      admin.courses.upload.tsx                        # NEW: upload UI route
      admin.courses.upload.test.tsx                   # NEW: 4 component tests

apps/tournament-api/
  src/
    routes/
      auth.ts                                         # MODIFIED: rewrite GET /status
      auth.test.ts                                    # MODIFIED: rewrite anonymous + add 3 net-new (invalid-session, organizer, non-organizer)

pnpm-lock.yaml                                        # MODIFIED (SHARED — pre-announced)
```

**Explicitly NOT in T2-3b (reserved for future):**
- HEIC client-side conversion — followup story (the spec captures it in the error-message lookup; T2-3b user manually converts).
- MSW for HTTP mocking — defer to T2-5 if needed.
- Playwright / Cypress E2E — out of epic scope.
- Save / persistence — T2-5.
- Edit form for the parsed JSON — T2-5.
- Forbidden-route extraction (`auth.forbidden.tsx`) — defer until T2-5 has multiple admin routes.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T2.3b (added 2026-04-26).
- Predecessor stories: T2-3 (`cd587a0`), T2-3a (`119b39d`). Risk Acceptance §8 in T2-3 documents the Anthropic strict-mode subset; T2-3a's MagicByteResult discriminator + magic-wins policy.
- Existing tournament-web routes: `apps/tournament-web/src/routes/{__root,auth.declined,index}.tsx` — reference for file-based routing convention.
- TanStack Router file-route docs: https://tanstack.com/router/latest/docs/framework/react/guide/file-based-routing (impl-time reference).
- Testing Library + Vitest setup: https://testing-library.com/docs/react-testing-library/setup (impl-time reference).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
