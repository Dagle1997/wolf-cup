# T4-3: PDF Schedule + Pairings Export [port-with-greenfield-fallback]

## Status

Ready for Dev

## Story

As any Event participant,
I want a "Export PDF" action that generates a printable Event schedule + pairings + roster + handicaps,
So that the trip has a paper fallback if the app fails day-of (FR-F1, FR-F2, FR-H4).

T4-3 ships a `GET /api/events/:eventId/pdf/schedule/:token` route gated by the T3-8 `requireInviteToken` middleware (any participant can generate; FR-H4 explicitly says "any participant"). The PDF includes the event header, per-round sections (round number, date, course/tees, foursomes with player names + handicaps), and a full roster table.

**Why GET instead of POST?** Browser file-download UX uses a plain `<a href={url}>` link or `window.location.assign(url)` — both issue GET. The route is read-only (no state mutation; just renders a PDF from existing rows), so GET is semantically correct. The epic AC says "POST" but that's stale wording for a fetch-and-download endpoint; round-1 codex caught this.

T4-3 is the last story in Epic T4.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint — REQUIRES USER APPROVAL

**This story adds ONE new package dep, triggering a SHARED-file gate on `pnpm-lock.yaml`.** The dep adds touch `apps/tournament-api/package.json` (ALLOWED) AND require a corresponding `pnpm-lock.yaml` update (SHARED — second hard-stop gate after the spec gate).

Proposed dep: **`pdfkit`** (a mature, well-maintained Node-only PDF library; no Chrome/headless-browser dependency). Alternatives considered + rejected:
- **`puppeteer`**: heavyweight (~280 MB Chromium download), runtime browser not available in production container.
- **`@react-pdf/renderer`**: React-tied; T4-3 is server-only, no React component reuse value.
- **Shell out to headless Chrome**: matches Wolf Cup's pattern (`reference_pdf_generation.md`) but production container doesn't have Chrome installed; would need Dockerfile changes (also SHARED).
- **HTML response + client-side print**: breaks AC's "Content-Type: application/pdf" + "downloadable via standard browser share/download mechanisms."

`pdfkit` produces deterministic byte-for-byte output (modulo a creation-date stamp, which T4-3 freezes via `info.CreationDate = new Date(0)` for snapshot tests).

**Approval workflow (TWO gates):**
1. Spec gate (this gate): Josh approves the spec content.
2. SHARED-approval gate (separate, after spec approval): Josh approves the `pdfkit` dep + the `pnpm-lock.yaml` update.

The dev agent will STOP at the SHARED-approval gate before running `pnpm add pdfkit` if the user hasn't already approved the dep at spec-gate time.

### 2. Wolf Cup port provenance — NO source exists; greenfield with audit trail

The epic AC (line 1196-1200) demands a `/* PORTED from {wolf cup path}.ts @ commit {sha}` provenance header citing the actual Wolf Cup source. **There is NO `apps/api/src/lib/pdf-gen.ts` or equivalent in Wolf Cup.** Wolf Cup's PDF artifacts (`reference/wolf-cup-marketing.html`, `reference/wolf-cup-admin-guide.html`, etc.) are generated **offline via shell-out to headless Chrome** — see `reference_pdf_generation.md`. There is no programmatic / runtime PDF endpoint to port.

**T4-3 documents this honestly** rather than fabricating a port:
- The provenance header reads: `/* GREENFIELD (NOT a Wolf Cup port). Wolf Cup's PDF artifacts are generated offline via shell-out to headless Chrome (see reference_pdf_generation.md, which is NOT runtime code). T4-3 ships a runtime PDF endpoint built fresh on pdfkit. Decision dated 2026-04-28; pdfkit selected over puppeteer/chrome-shell-out for container-friendliness. */`
- `apps/tournament-api/PORTS.md` (NEW) is created with the same disclosure; future T-stories that DO port Wolf Cup code can append.

This satisfies the SPIRIT of the epic AC (auditable port decisions) without fabricating a port that doesn't exist.

### 3. Auth: `requireInviteToken` middleware

Per epic AC line 1202: gated by **`requireInviteToken` from T3-8** — any participant can generate; FR-H4 says explicitly "any participant." The T3-8 middleware reads `:token` from the URL path. **The route MUST be parameterized with `:token` and `:eventId` together**, or the token-validating middleware can't find the token.

Route shape: `GET /api/events/:eventId/pdf/schedule/:token` — `:token` at the end so the T3-8 middleware finds it via `c.req.param('token')`. Two layout options were considered:
- **Option A (token-prefixed):** `GET /api/spectator/:token/events/:eventId/pdf/schedule` — token first. Matches T3-8's example mount.
- **Option B (token-suffixed):** `GET /api/events/:eventId/pdf/schedule/:token` — token at the leaf, keeps event-scoped URL structure.

**T4-3 picks Option B.** The route stays event-scoped + Hono picks up `:token` for the middleware. Both patterns satisfy T3-8's middleware contract since T3-8 reads the param by name, not by position.

### 4. PDF content per epic AC

The PDF renders:
- **Header:** Event title, date range (formatted as "May 7 – May 10, 2026"), timezone label
- **Per-round section** (one block per `event_rounds` row, in `round_number` ASC):
  - "Round N — May 7" subheader
  - Course name + tee color from `course_revisions` + `course_tees` joins
  - Two foursomes (or N, depending on `pairings.foursome_number` count for that round): each as a 4-row table with Name + Handicap Index columns. Order by `pairing_members.slot_number`.
- **Roster table** at the end: full event roster with handicap index. Sorted ASC by name.

Pages break naturally; no row splits across pages (pdfkit's `lineGap` + `text` flow handles this when the layout fits letter paper).

### 5. Handicap source

Players have BOTH `players.ghin` (linked GHIN number) AND `players.manual_handicap_index` (override). The PDF shows:
- If `manual_handicap_index` is non-null → show that.
- Else if `ghin` is non-null → show "GHIN linked" placeholder + ghin number (the real-time handicap fetch via T3-4 happens at scoring time, NOT PDF-export time — fetching live for every PDF export adds latency + GHIN unavailability is a 503 risk for the print-fallback flow).
- Else → show "—" (em-dash placeholder).

This is a deliberate v1 simplification: T4-3 PDF reflects whatever's stored on `players` rows, not a live GHIN fetch. T7+ stories may add a live-fetch button on the export.

### 6. 422 if pairings missing

Per epic AC line 1213-1215: `GET /pdf/schedule/:token` for an Event with no pairings → `422 { error: 'pairings_missing', code: 'event_pairings_not_saved', requestId }`. "Missing pairings" = no `pairings` rows under any of the event's `event_rounds`. (Per-round empty pairings is OK; the 422 only fires on full absence.)

### 7. 403 reconciliation: only one path → event_token_mismatch

Per T3-8: a valid invite-token holder IS a participant by virtue of holding the token. Anyone without a valid token gets 401 (token-failure modes per T3-8). The epic AC line 1217-1219's "non-participant → 403 via require-event-participant" wording is stale; T4-3 picked `requireInviteToken` (any participant has the invite token), NOT `requireEventParticipant`.

**The ONLY 403 path on this route is `event_token_mismatch`** — fires when the URL `:eventId` doesn't match `c.get('invite').eventId`. This is a defense-in-depth guard against a token-for-event-A being smuggled into event-B's URL (e.g., a stale URL bookmark from a prior event). It is NOT a "non-participant" check. Only one 403 code; no other 403 paths on this route.

### 8. Pre-existing tournament-web invite cookie / token storage

The PDF download is a server-rendered binary. The frontend just navigates to the URL with the token in the path; the browser's standard download mechanism handles the rest. No frontend mutation, no AbortController, no useMutation. The "Export PDF" link in the eventual frontend (T4-3 does NOT ship a frontend page; T7-1 will add the player-facing Export button) is a simple `<a href={...}>` that navigates to `/api/events/<id>/pdf/schedule/<token>`.

### 9. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/pdf-schedule.ts` — NEW
- `apps/tournament-api/src/routes/pdf-schedule.test.ts` — NEW
- `apps/tournament-api/src/lib/pdf-gen.ts` — NEW (pdfkit-based generator, pure render function over data)
- `apps/tournament-api/src/lib/pdf-gen.test.ts` — NEW (unit tests for the renderer)
- `apps/tournament-api/src/app.ts` — MODIFIED (mount the new router)
- `apps/tournament-api/PORTS.md` — NEW (port-decision audit log)

SHARED (REQUIRES USER APPROVAL THIS STORY):
- `apps/tournament-api/package.json` — MODIFIED (add `pdfkit` + `@types/pdfkit` deps)
- `pnpm-lock.yaml` — MODIFIED (lockfile update from `pnpm add pdfkit @types/pdfkit`)

NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/lib/pdf-gen.ts` (NEW)
   **When** inspected
   **Then** it begins with the provenance header per Risk §2 (greenfield, NOT a port). Exports `renderEventPdf(input: EventPdfInput): Promise<Buffer>` as a pure function over input data (no DB, no fetch). Input shape:
   ```ts
   {
     event: { name: string; startDate: number; endDate: number; timezone: string },
     rounds: Array<{
       roundNumber: number;
       roundDate: number;
       courseName: string;
       teeColor: string;
       foursomes: Array<{
         foursomeNumber: number;
         members: Array<{
           name: string;
           handicapIndex: number | null;  // null means "—" placeholder
           ghinLabel: string | null;        // "GHIN linked: 1234567" or null
         }>;
       }>;
     }>,
     roster: Array<{ name: string; handicapIndex: number | null; ghinLabel: string | null }>;
   }
   ```
   Output: Buffer of a valid PDF with `Content-Type` byte signature `%PDF-` at offset 0.

2. **Given** `GET /api/events/:eventId/pdf/schedule/:token` (NEW route)
   **When** invoked
   **Then**:
   - Route is parameterized with BOTH `:eventId` and `:token`. Without `:token` in the URL, the route doesn't match (404 from Hono's router) — there is no "anonymous + no token" reach-the-handler path.
   - Gated by `requireInviteToken` middleware (T3-8). Token validation happens upstream; `c.get('invite')` is populated with `{ eventId, inviteId }` when reaching the handler. Failure modes from T3-8:
     - 401 `invite_token_invalid` — token shape (charset/length) fails the cheap pre-DB guard.
     - 401 `invite_not_found` — well-shaped token but no matching invites row in this tenant.
     - 401 `invite_expired` — matching row but `expires_at <= now`.
   - **Defense-in-depth check on `:eventId`** (round-1 codex catch — clarifies the 403 path): the handler verifies `:eventId` param matches `c.get('invite').eventId`. The token's invite.eventId is the source of truth; the URL's `:eventId` is a routing convenience. Mismatch → 403 `event_token_mismatch` (NOT a participant-check failure; it's a guard against a token-for-event-A being smuggled in for event-B's URL). This is the ONLY 403 path on this route.
   - Fetches event + event_rounds + course_revisions + course_tees + pairings + pairing_members + players (joined). Tenant-scoped on every query.
   - If no `pairings` rows exist for ANY of the event's event_rounds → return `422 { error: 'pairings_missing', code: 'event_pairings_not_saved', requestId }`.
   - Calls `renderEventPdf(...)`. Returns `Response` with:
     - Status 200
     - `Content-Type: application/pdf`
     - `Content-Disposition: attachment; filename="<event-slug>-schedule.pdf"` (slug = lowercased event name with non-alphanumeric → `-`)
     - Body: the PDF Buffer
   - 404 `event_not_found` if the token's event no longer exists (tenant-scoped check). This is rare — the invite row's event_id FK CASCADE per T3-1 schema means the invite row would be deleted with the event; reaching this branch implies a partial cleanup state.

3. **Given** `apps/tournament-api/src/lib/pdf-gen.test.ts` (NEW)
   **When** `pnpm -F @tournament/api test` runs
   **Then** at least 4 tests cover:
   - Buffer starts with `%PDF-` signature.
   - Empty rounds array → still produces a valid PDF (header + roster only; no per-round sections).
   - Multi-round input (4 rounds × 2 foursomes × 4 members) produces a Buffer > 1 KB and < 100 KB (sanity bounds).
   - Deterministic output: 2 calls with identical input + frozen creation date → byte-for-byte identical buffers.

4. **Given** `apps/tournament-api/src/routes/pdf-schedule.test.ts` (NEW)
   **When** `pnpm -F @tournament/api test` runs
   **Then** at least 6 tests cover:
   - Happy path: valid token + event with pairings → 200 + Content-Type pdf + Content-Disposition attachment.
   - **404 from Hono router: GET request without `:token` in URL** (e.g., `/api/events/<id>/pdf/schedule` without trailing token) → 404 since the route doesn't match. Asserts the no-anonymous-reach property.
   - 401 invite_token_invalid: malformed token (e.g., 'not-a-token').
   - 401 invite_expired: well-shaped token in DB with expires_at <= now.
   - 422 pairings_missing: event with NO pairings rows under any event_round.
   - 403 event_token_mismatch: URL eventId differs from token's eventId (token for event A, URL says event B).
   - Cross-tenant: foreign-tenant invite row → 401 invite_not_found (per T3-8 tenant-scoped SELECT).

5. **Given** `apps/tournament-api/src/app.ts`
   **When** inspected post-T4-3
   **Then** the new pdfScheduleRouter is mounted: `app.route('/api/events', pdfScheduleRouter)`. (NEW prefix `/api/events`; first non-admin event route. The 5th `/api/admin` mount threshold is unrelated since this is `/api/events`, not `/api/admin`.)

6. **Given** `apps/tournament-api/PORTS.md` (NEW)
   **When** inspected
   **Then** it contains an entry for `pdf-gen.ts` with: greenfield disclosure, decision date (2026-04-28), pdfkit selection rationale, alternatives considered (puppeteer / @react-pdf/renderer / Chrome shell-out), and the SHARED-gate trace (which dep adds, which lockfile change). Future port stories append entries.

7. **Given** `pnpm -F @tournament/api test`
   **When** run post-T4-3
   **Then** total tests ≥ baseline + 10. Baseline at story start: 444 (post-T4-2). The +10 covers AC #3 (4 minimum) + AC #4 (6 minimum); some scenarios may collapse together.

8. **Given** Wolf Cup workspaces
   **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T4-3
   **Then** both continue to pass with zero net-negative test count change.

9. **Given** typecheck + lint + build for tournament-api
   **When** run post-T4-3
   **Then** all exit 0. No new `any`. No new `// eslint-disable`.

10. **Given** the deployed app post-T4-3
    **When** Josh manually exercises the flow
    **Then**:
    - Get an invite token for an event with persisted pairings (T4-2 saved 2 foursomes × 4 members per round).
    - Visit `https://tournament.dagle.cloud/api/events/<eventId>/pdf/schedule/<token>` directly in the browser.
    - Verify the browser downloads `<event-slug>-schedule.pdf`.
    - Open the PDF in iOS Safari AND desktop Chrome PDF viewers — verify it renders without errors, no missing fonts, page breaks naturally, text is selectable.
    - Verify the per-round sections show course name, tees, foursomes with player names + handicaps; roster table at end has all participants.

11. **Given** the dep-add pre-condition
    **When** `pnpm add pdfkit @types/pdfkit` runs from `apps/tournament-api/`
    **Then** `apps/tournament-api/package.json` and root `pnpm-lock.yaml` both update. The lockfile update is the SHARED gate that requires Josh's approval BEFORE the dev agent runs the install.

12. **Given** Risk Acceptance §1 (SHARED-approval gate)
    **When** the dev agent reaches the implementation phase
    **Then** the agent STOPS and asks Josh to explicitly approve the `pdfkit + @types/pdfkit` dep + the resulting `pnpm-lock.yaml` change. Approval is per-story (no batch). Without approval, the implementation does NOT proceed past the dep-add step.

13. **Given** there are no FORBIDDEN edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED or approved-SHARED.

## Tasks / Subtasks

- [ ] Task 1: Capture baseline (444).

- [ ] Task 2: SHARED-approval gate. Spec-gate-passed → STOP and request Josh's approval to add `pdfkit + @types/pdfkit` deps + lockfile update.

- [ ] Task 3: Add deps via `pnpm -F @tournament/api add pdfkit && pnpm -F @tournament/api add -D @types/pdfkit`. Stage `apps/tournament-api/package.json` AND root `pnpm-lock.yaml`.

- [ ] Task 4: Backend — create `lib/pdf-gen.ts` with renderEventPdf pure function. (AC #1)

- [ ] Task 5: Backend — create `lib/pdf-gen.test.ts` with 4+ tests. (AC #3)

- [ ] Task 6: Backend — create `routes/pdf-schedule.ts` with the GET endpoint. (AC #2)

- [ ] Task 7: Backend — create `routes/pdf-schedule.test.ts` with 6+ tests. (AC #4)

- [ ] Task 8: Backend — wire mount in `app.ts`. (AC #5)

- [ ] Task 9: Documentation — create `PORTS.md` with provenance/decision audit log. (AC #6)

- [ ] Task 10: Run regressions (typecheck, lint, all 4 test suites).

- [ ] Task 11: Manual post-deploy smoke per AC #10.

## Dev Notes

- **Why the SHARED-gate split into two approvals?** The spec-content gate (does the design make sense?) is independent of the dep-choice gate (do we want pdfkit specifically?). Josh might approve the spec but want a different dep, or vice versa. Splitting prevents one gate from rubber-stamping the other.

- **Why `requireInviteToken` over `requireEventParticipant` for T4-3?** The epic AC's wording ("any participant") is best implemented via the invite token flow because the token IS THE proof of participation per FR-E1's invite-claim flow. Requiring a SSO session for PDF export would block participants who haven't completed SSO yet — defeats the "trip-day paper fallback" promise.

- **Why a route in `/api/events/:eventId/pdf/schedule/:token` (token at the leaf)?** Two reasons: (1) keeps the URL structure event-scoped + parseable; (2) T3-8's middleware reads param by name, so position doesn't matter. Sub-routes hosted under `/api/events/:eventId/...` make grep/log-aggregation easier. The middleware is mounted on the router, so the route declaration is `pdfScheduleRouter.post('/:eventId/pdf/schedule/:token', requireInviteToken, handler)`.

- **Why pdfkit-based pure-function generator over an HTML-to-PDF approach?** pdfkit is server-only, no Chrome dep; output is byte-deterministic for snapshot tests; no XSS concerns from HTML interpolation; no font-loading edge cases. Tradeoff: pixel-perfect layout is less trivial than CSS, but the spec content is simple (tables + headings).

- **Filename slugging.** `event.name` may contain spaces, special chars. Slug rule: lowercase + replace `/[^a-z0-9]+/g` with `-` + trim leading/trailing `-`. Empty result → fallback to `event`. Filename: `${slug}-schedule.pdf`.

- **Tenant scoping** on every SELECT/UPDATE/DELETE per the post-T3-9 hardening pattern.

- **Wolf Cup isolation:** T4-3 writes only to `apps/tournament-api/**` (allowed) + `apps/tournament-api/package.json` + root `pnpm-lock.yaml` (SHARED with approval).

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-H-zero-M.
- **Retro AI-2 applied:** SHARED files explicitly enumerated in Risk §1.

### Project Structure Notes

Shape after T4-3:

```
apps/tournament-api/
  package.json                              # MODIFIED (SHARED): +pdfkit + @types/pdfkit
  PORTS.md                                  # NEW: port-decision audit log
  src/
    lib/
      pdf-gen.ts                            # NEW: pdfkit pure renderer
      pdf-gen.test.ts                       # NEW
    routes/
      pdf-schedule.ts                       # NEW: GET /api/events/:eventId/pdf/schedule/:token
      pdf-schedule.test.ts                  # NEW
    app.ts                                  # MODIFIED: mount pdfScheduleRouter
pnpm-lock.yaml                              # MODIFIED (SHARED): pdfkit + transitive deps
```

**Explicitly NOT in T4-3 (reserved for future):**
- Frontend "Export PDF" button on the event detail page (T7-1 ships the player-home page; T4-3 is backend-only).
- Live GHIN handicap fetch at PDF-export time (v1 reads stored `players` data only).
- Per-pairing tee-time annotations (`event_rounds.tee_time` doesn't exist in v1 schema; future story may add).
- Cumulative leaderboard / standings appended to the PDF (T5/T6 territory).
- Custom branding / logo upload (out of scope).

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T4.3 (line 1186-1219).
- Predecessor stories: T3-8 (requireInviteToken middleware); T4-2 (pairings + pairing_members schema).
- Reference: `reference_pdf_generation.md` (Wolf Cup's offline shell-out PDF pattern; NOT a runtime port source).
- Pattern reference: T3-3 admin-groups.ts for the request-id + structured-log + 4xx-or-Buffer-response shape (T4-3 returns Buffer instead of JSON for the happy path).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
