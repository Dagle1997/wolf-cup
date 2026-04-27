# T3-5: Rule-Set Editor (tenant-scoped, revisioned)

## Status

Done

## Story

As an organizer (Josh),
I want to edit and save named rule sets at tenant scope with revision-aware history (per FD-8),
So that "Pinehurst stakes" is reusable across events and historical rounds stay pinned to the exact config they were played under.

T3-5 ships the editor route + the supporting CRUD endpoints. Existing `rule_set_revisions` rows are NEVER mutated — every save creates a new revision; events that pin a prior `rule_set_revision_id` continue to use it (FD-8 immutability of historical context).

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. SHARED-gate footprint announced up-front (retro AI-2)

**Zero SHARED files expected.** Same posture as T2-5 / T3-2 / T3-3:
- Form state via React `useState` (not `react-hook-form`).
- Validation via hand-rolled `Zod.safeParse` on submit; no `@hookform/resolvers/zod`.
- Backend: existing drizzle + libsql + Hono. No new deps.
- Tests: existing vitest + @testing-library/react.

If during impl the dev agent identifies a true blocker requiring SHARED, pause for user approval. **Likely candidates: NONE.**

**No `docker-compose.yml` changes. No new env vars. No DB migrations** (T3-1 already defined `rule_sets` + `rule_set_revisions`).

### 2. Endpoint scope (3 new endpoints)

The epic only mandates `POST /api/admin/rule-sets/:id/revisions`. Two more are pulled in for T3-5 to be usable end-to-end without a manual SQL seed:

1. **`POST /rule-sets`** — create a new rule_set + initial revision (revision_number=1) with defaults. Avoids "T3-5 ships an editor that's unreachable until manual SQL." Gives Josh a clean Create flow at v1.
2. **`GET /rule-sets/:id`** — fetch rule_set + latest revision. The editor needs this to populate.
3. **`POST /rule-sets/:id/revisions`** — append a new revision with `revision_number = current_max + 1`. The epic-mandated endpoint.

All three mounted on a NEW `adminRuleSetsRouter` (Hono) at `/api/admin` (4th mount alongside courses + events + groups; per Winston's note in T3-3 party review, **this is the natural threshold to start considering an umbrella `adminRouter` — but T3-5 holds the existing pattern; T3-6 or T3-7 will tip the count over and that's the right time to refactor**).

NOT in T3-5:
- List endpoint (`GET /rule-sets`) — v1 single-rule-set ("Pinehurst stakes") doesn't need a list view; future polish if Josh creates >1 rule set.
- DELETE — rule sets shouldn't be deletable while revisions exist (T3-1 schema enforces RESTRICT FK); future story handles cascading delete UX.
- Event-pinning UI (`PATCH /events/:id` to set `events.pinned_rule_set_revision_id`) — out of T3-5 scope; T3-2 wizard doesn't pin a revision yet; future T3-2.x extends.
- Diff view between revisions — future polish.
- Revision rollback — historical revisions stay queryable; "rollback" is just creating a new revision matching an old config_json. UI not provided.

### 3. config_json shape (load-bearing — pinned by AC #2)

The Zod schema for the form / config_json is the contract. Both client + server validate against IDENTICAL shape (copied, not shared, per the no-SHARED rule):

```ts
const RuleSetConfigSchema = z
  .object({
    // 2v2 best-ball options
    sandies: z.boolean(),

    autoPress: z.object({
      enabled: z.boolean(),
      // N-down trigger; epic AC #4 requires int 1-4
      downN: z.number().int().min(1).max(4),
      // Press multiplier; epic AC #4 requires positive number
      multiplier: z.number().positive().finite(),
    }),

    greenies: z.object({
      // FD-12 default off
      carryover: z.boolean(),
      // 'none' allowed always; '2-putt' only meaningful when carryover=true
      validation: z.enum(['none', '2-putt']),
    }),

    individualBet: z.object({
      // Match-play $ per hole — INTEGER CENTS (mirrors integer-cents discipline elsewhere)
      matchPlayPerHoleCents: z.number().int().nonnegative(),
      // Optional N-down auto-press
      autoPressDownN: z.number().int().min(1).max(4).optional(),
    }),

    subGames: z.object({
      // Default buy-in per participant for sub-games (skins/CTP/etc.); INTEGER CENTS.
      defaultBuyInPerParticipantCents: z.number().int().nonnegative(),
    }),
  })
  .refine(
    (data) =>
      // Epic AC #4: greenie_validation must match the enum given carryover state.
      // When carryover=true, validation MUST be '2-putt'. When carryover=false,
      // validation MUST be 'none'.
      (data.greenies.carryover === true && data.greenies.validation === '2-putt') ||
      (data.greenies.carryover === false && data.greenies.validation === 'none'),
    {
      path: ['greenies', 'validation'],
      message: 'greenie_validation must be "2-putt" when carryover=true, else "none"',
    },
  );
```

**Defaults for newly-created rule_sets** (when client POSTs `/rule-sets` with just `name`):
```ts
{
  sandies: true,
  autoPress: { enabled: true, downN: 2, multiplier: 2 },
  greenies: { carryover: false, validation: 'none' },
  individualBet: { matchPlayPerHoleCents: 100 }, // $1/hole default
  subGames: { defaultBuyInPerParticipantCents: 0 },
}
```

These defaults match the epic's stated v1 baseline (auto-press N=2, multiplier 2x, carryover off per FD-12).

### 3a. Tenant-scoping posture (v1 single-tenant; matches codebase)

The story title says "tenant-scoped" but T3-5's queries do NOT add `WHERE tenant_id = ?` filters. **This matches the codebase's v1 single-tenant ('guyan') posture** (same gap acknowledged in T3-1 spec line 43-46 + courses.ts:39-43): `tenantId` is stamped at insert via `ecosystemColumns()`; queries assume a single-tenant world. Multi-tenant deployment would require:
- Adding `WHERE tenant_id = currentTenant` filter to every SELECT in T3-5's handlers.
- Resolving `currentTenant` from session/event context (no tenant resolver exists v1).

For v1: **acknowledged gap, not fixed in T3-5.** Future "multi-tenant hardening" sweep will add the filters across all admin routers (T2-5 / T3-2 / T3-3 / T3-5) in a single coordinated story. Documented in PORTS.md style (Known Limitation row) is overkill for an internal route; instead, dev notes flag the absence.

### 3b. Revision immutability discipline (FD-8)

**Existing `rule_set_revisions` rows are NEVER updated.** Every save creates a new row with `revision_number = current_max + 1`. The handler:

```ts
// Inside POST /rule-sets/:id/revisions
const maxRevQuery = await db
  .select({ max: max(ruleSetRevisions.revisionNumber) })
  .from(ruleSetRevisions)
  .where(eq(ruleSetRevisions.ruleSetId, ruleSetId));
const nextRevisionNumber = (maxRevQuery[0]?.max ?? 0) + 1;
await db.insert(ruleSetRevisions).values({
  id: randomUUID(),
  ruleSetId,
  revisionNumber: nextRevisionNumber,
  configJson: JSON.stringify(parsedConfig),
  // effective_from_round_id stays NULL (baseline behavior); future
  // mid-event rule edits (T5.11) will set this to a specific event_round_id.
  effectiveFromRoundId: null,
  effectiveFromHole: 1,
  createdByPlayerId: c.get('player').id,
  // Reason field — optional in T3-5 v1 (UI doesn't ask for it; future polish).
  reason: null,
  createdAt: now,
  tenantId: 'guyan',
  contextId: 'library:guyan',
});
```

The composite UNIQUE on `(rule_set_id, revision_number)` (T3-1 schema) prevents duplicate revision numbers from race conditions. If two organizers save concurrently (rare; v1 single-organizer), the second hits UNIQUE → caller can retry. **For v1 single-organizer, race is essentially unreachable — but the UNIQUE is the safety net.** Concurrent retry: handle UNIQUE → 409 `revision_number_conflict` and let the client retry (which will get the new max+1).

### 4. Event-pin immutability (FD-8 historical context)

**T3-5 does NOT touch `events.pinned_rule_set_revision_id`** (which doesn't exist as a column yet — future T3-2.x adds it). Currently events have NO column linking to a specific revision; T3-6/T6 will introduce this.

T3-5's only contract: "creating a new revision does NOT modify any existing rows in events OR in prior `rule_set_revisions` rows." This is trivially satisfied because T3-5 only INSERTs into `rule_set_revisions`. No JOIN, no UPDATE, no DELETE on any other table.

**Test shape** (revised — original spec referenced a non-existent `pinned_rule_set_revision_id` column): seed 1 event row + 1 rule_set with 2 revisions. SELECT all event rows pre-call (snapshot the array). Call POST /:id/revisions to create revision 3. SELECT all event rows post-call. Assert byte-identical (same count, same column values, same updatedAt etc). **No pinning column required for the test** — the assertion is "events table is untouched by T3-5's writes."

A second assertion in the same test: SELECT prior `rule_set_revisions` rows where revision_number IN (1, 2). Assert byte-identical pre-and-post. Pins the FD-8 immutability of historical revisions.

### 5. Auth + middleware

- `POST /rule-sets`: requireSession → requireOrganizer → bodyLimit(8 KB) → handler.
- `GET /rule-sets/:id`: requireSession → requireOrganizer → handler. NO bodyLimit (no body).
- `POST /rule-sets/:id/revisions`: requireSession → requireOrganizer → bodyLimit(8 KB) → handler.
- bodyLimit `onError`: 400 `body_too_large` (matches existing pattern). 8 KB is generous for the small JSON config (~500 bytes typical).
- Frontend route `beforeLoad`: same 5-step auth-status loader as T2-3b/T2-5/T3-2/T3-3. Anonymous → `/api/auth/google`; non-organizer → ForbiddenMessage; organizer → render editor.

### 6. UI scope: minimal but functional

Single page at `/admin/rule-sets/:id/edit`. Goals:

- **Name display** (read-only header — name editing is out of T3-5 scope; rename is a future polish).
- **2v2 best-ball section:**
  - Sandies toggle (checkbox).
  - Auto-press fieldset: enabled toggle + N-down number input (1-4) + multiplier number input (positive float). When enabled=false, the inner fields are disabled but their values are preserved.
- **Greenies section:**
  - Carryover toggle. When toggled ON, validation auto-switches to '2-putt' (UI-side); toggled OFF, auto-switches to 'none'. The form prevents invalid combinations at the UI layer; Zod refine catches anything that gets through (e.g., direct API call).
  - Validation selector (radio: 'none' | '2-putt'). Disabled when carryover doesn't match.
- **Individual-bet section:**
  - Match-play $/hole input (dollars; converted to cents at submit; integer-cents discipline at storage).
  - Optional auto-press N-down (1-4 number input + clear button).
- **Sub-games section:**
  - Default buy-in per participant ($) input (dollars → cents conversion).
- **Save button:** disabled until all required fields valid (per Zod). On click → POST /:id/revisions → on 201 → success toast + reload latest revision (to refresh the displayed `revision_number`).
- **Revision number badge** in the header (e.g., "Revision 3"). Reflects the latest revision visible to the organizer.

NOT in T3-5:
- Diff between revisions — future polish.
- Revert / restore prior revision — future (manual: organizer copies values from an older revision into the editor + saves).
- Effective-from-hole / mid-event rule edit — out of T3-5 scope; T5.11 covers.
- Reason text input on save — schema column exists but T3-5 v1 doesn't surface it; future polish.

### 7. Test coverage targets (mandatory)

**Response-shape note:** all success + error responses include a `requestId` field (matches T2-5 / T3-2 / T3-3 pattern). Test bullets below list LOAD-BEARING fields only; tests don't typically assert on `requestId` presence (it's universal). When an AC says `{ ruleSetId, revisionId, revisionNumber: 1, requestId }`, the corresponding test bullet may abbreviate to `{ ruleSetId, revisionId, revisionNumber: 1 }` — both refer to the same response.

**≥10 backend tests** (`apps/tournament-api/src/routes/admin-rule-sets.test.ts`, NEW):

- POST /rule-sets happy: organizer creates → 201 with `{ ruleSetId, revisionId, revisionNumber: 1 }`; verify rule_sets + rule_set_revisions rows.
- POST /rule-sets Zod: missing/empty name → 400 invalid_body.
- POST /rule-sets auth: anonymous → 401; non-organizer → 403.
- GET /rule-sets/:id happy: returns `{ id, name, latestRevision: { id, revisionNumber, configJson, ... } }` deserialized.
- GET /rule-sets/:id 404: unknown id → 404 rule_set_not_found.
- POST /rule-sets/:id/revisions happy: append → 201 with `{ revisionId, revisionNumber: max+1 }`; verify NEW row inserted, OLD rows untouched.
- POST /rule-sets/:id/revisions Zod: invalid greenie carryover/validation combo → 400 invalid_body.
- POST /rule-sets/:id/revisions Zod: autoPress.downN out-of-range (5) → 400.
- POST /rule-sets/:id/revisions UNIQUE conflict (race): duplicate revision_number → 409 revision_number_conflict.
- POST /rule-sets/:id/revisions 404 rule_set_not_found if rule_set doesn't exist (FK pre-flight).
- Body too large (POST 8 KB cap; T3-5 has no PATCH endpoints) → 400 body_too_large with `{ error: 'bad_request', code: 'body_too_large', requestId }` shape.

**≥4 frontend component tests** (`apps/tournament-web/src/routes/admin.rule-sets.$id.edit.test.tsx`, NEW):

- Idle render: form fields populate from query data (mocked GET).
- Validation: carryover toggle ON without changing validation → submit blocked; UI fixes via auto-switch.
- Save success: 201 → success toast + revision_number increments.
- Save error: 400 invalid_body → error displayed; form preserved.

### 8. Path footprint summary

ALLOWED edits expected:
- `apps/tournament-api/src/routes/admin-rule-sets.ts` — NEW
- `apps/tournament-api/src/routes/admin-rule-sets.test.ts` — NEW
- `apps/tournament-api/src/app.ts` — MODIFIED (mount adminRuleSetsRouter)
- `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx` — NEW
- `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.test.tsx` — NEW
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regen
- Story file + codex review files in `_bmad-output/`

NO SHARED edits. NO FORBIDDEN edits.

## Acceptance Criteria

1. **Given** `apps/tournament-api/src/routes/admin-rule-sets.ts` (NEW)
   **When** inspected
   **Then** it exports `adminRuleSetsRouter` (Hono instance) with 3 routes (paths prefixed `/rule-sets` so they resolve to `/api/admin/rule-sets/...` once mounted under `/api/admin` — matching the existing adminCoursesRouter / adminEventsRouter / adminGroupsRouter pattern):
   - `POST /rule-sets` — middleware: requireSession → requireOrganizer → bodyLimit(8 KB) → handler.
   - `GET /rule-sets/:id` — middleware: requireSession → requireOrganizer → handler. NO bodyLimit.
   - `POST /rule-sets/:id/revisions` — middleware: requireSession → requireOrganizer → bodyLimit(8 KB) → handler.
   bodyLimit `onError` returns 400 `{ error: 'bad_request', code: 'body_too_large', requestId }` (matches T2-5 / T3-2 / T3-3 JSON-endpoint shape).

2. **Given** `RuleSetConfigSchema` (Zod) defined in `admin-rule-sets.ts` AND copied into `admin.rule-sets.$id.edit.tsx`
   **When** inspected
   **Then** both copies match the shape in Risk Acceptance §3 verbatim (sandies / autoPress / greenies / individualBet / subGames + the `.refine` for carryover↔validation matching). Two copies acknowledged per the no-SHARED posture; promote when 3rd consumer arrives.

3. **Given** `POST /api/admin/rule-sets` with body `{ name: string }`
   **When** invoked by an organizer
   **Then**:
   - Body Zod-parsed: `{ name: z.string().trim().min(1) }`. Empty/whitespace → 400 invalid_body.
   - Generate `ruleSetId = randomUUID()`, `revisionId = randomUUID()`, defaults for config_json (per Risk Acceptance §3).
   - Single drizzle transaction: INSERT rule_sets + INSERT rule_set_revisions (revision_number=1).
   - Both rows stamped: `tenantId='guyan'`, `contextId='library:guyan'`.
   - Response: 201 `{ ruleSetId, revisionId, revisionNumber: 1, requestId }`.
   - On UNIQUE conflict (rare; rule_sets has no UNIQUE constraint on name in v1) → 409 not expected; bubble as 500 if it somehow fires.

4. **Given** `GET /api/admin/rule-sets/:id`
   **When** invoked by an organizer
   **Then**:
   - SELECT rule_sets WHERE id = :id. If 0 rows → 404 `{ error: 'not_found', code: 'rule_set_not_found', requestId }`.
   - SELECT MAX revision_number's row from rule_set_revisions WHERE rule_set_id = :id (ORDER BY revision_number DESC LIMIT 1).
   - **Zero-revisions case** (rule_set exists but no revisions — pathological since POST /rule-sets atomically creates revision 1; only reachable via direct DB tampering OR a future flow that creates rule_sets standalone): respond 200 `{ id, name, createdAt, latestRevision: null }` and emit a structured WARN log (`event: 'rule_set_zero_revisions'`). UI handles `latestRevision: null` by showing an empty form populated with defaults + a banner "no revisions yet — first save will create revision 1."
   - **Happy path:** Response 200 `{ id, name, createdAt, latestRevision: { id, revisionNumber, configJson, effectiveFromRoundId, effectiveFromHole, createdByPlayerId, createdAt } }`. The `configJson` field is DESERIALIZED (parsed from the DB's TEXT column into a plain object before serializing the response).
   - **Two-stage parse with shape validation:** (1) `JSON.parse(configJson)` — on throw → 500 `corrupt_config_json` with structured log. (2) `RuleSetConfigSchema.safeParse(parsed)` — on fail → 500 `corrupt_config_shape` with structured log including the issues list. The shape-validation step catches stored JSON that drifted vs the current schema (e.g., a future schema field was added but old rows lack it). Without this, a UI consumer would crash on missing fields. Defense-in-depth.

5. **Given** `POST /api/admin/rule-sets/:id/revisions` with body matching `RuleSetConfigSchema`
   **When** invoked by an organizer
   **Then**:
   - Pre-flight: SELECT rule_sets WHERE id = :id → 404 `rule_set_not_found` if missing.
   - Body Zod-parsed against `RuleSetConfigSchema`. Failures → 400 `{ error: 'bad_request', code: 'invalid_body', requestId, issues }`.
   - **Wrap MAX-SELECT + INSERT in a single `db.transaction(async (tx) => { ... })`** for atomicity. Inside the tx:
     1. `SELECT MAX(revision_number) FROM rule_set_revisions WHERE rule_set_id = :id` → nextRevisionNumber = max + 1 (or 1 if no rows).
     2. INSERT new rule_set_revisions row: `id = randomUUID()`, `ruleSetId = :id`, `revisionNumber = nextRevisionNumber`, `configJson = JSON.stringify(parsed)`, `effectiveFromRoundId = null`, `effectiveFromHole = 1`, `createdByPlayerId = c.get('player').id`, `reason = null`, `createdAt = now`, `tenantId = 'guyan'`, `contextId = 'library:guyan'`.
     SQLite's deferred isolation means concurrent transactions can both compute the SAME nextRevisionNumber (the SELECT MAX doesn't lock); the second INSERT then hits the composite UNIQUE on `(rule_set_id, revision_number)` — that's the safety net.
   - Catch UNIQUE on `(rule_set_id, revision_number)` → 409 `{ error: 'conflict', code: 'revision_number_conflict', requestId }`. Client does NOT auto-retry (the conflicting save may have different data than the user's intent); UI shows "reload to see latest revision before saving again."
   - Other errors → 500 `save_failed` + structured log.
   - Response: 201 `{ revisionId, revisionNumber, requestId }`.
   - **Existing rule_set_revisions rows are NOT modified.** Test asserts a SELECT of all prior revisions returns byte-identical rows post-INSERT.

6. **Given** the Zod refine on `RuleSetConfigSchema.greenies` (per Risk Acceptance §3)
   **When** a request body has `greenies: { carryover: true, validation: 'none' }` OR `greenies: { carryover: false, validation: '2-putt' }`
   **Then** Zod parse fails → 400 invalid_body with the refine's `message` in `issues`. The frontend's identical refine prevents the user from submitting these combos in the UI; the backend refine is defense-in-depth.

7. **Given** an event row + prior rule_set_revisions rows that currently exist
   **When** any number of POST /:id/revisions calls fire on the same rule_set
   **Then** BOTH:
   - The events table is BYTE-IDENTICAL post-call (no rows added, removed, or modified). Test asserts via `SELECT * FROM events ORDER BY id` snapshot pre-and-post + deep-equal.
   - Prior rule_set_revisions rows (revisions 1..N before the call) are BYTE-IDENTICAL post-call. Test asserts via the same pattern. Pins the FD-8 immutability of historical revisions — T3-5 only INSERTs new revisions, never UPDATEs prior ones.
   T3-5's contract: "rule_set edits don't touch events table OR prior revisions." Future T3-2.x will pin revisions on events; that's a SEPARATE column add NOT in T3-5 scope.

8. **Given** `apps/tournament-api/src/app.ts` (modified)
   **When** inspected
   **Then** `app.route('/api/admin', adminRuleSetsRouter)` is added alongside the existing 3 mounts. (4th `/api/admin` mount; per T3-3 party review's Winston note, this is the threshold to consider an umbrella `adminRouter` — but T3-5 holds the existing pattern; T3-6 or T3-7 will tip the count and trigger the refactor.)

9. **Given** `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx` (NEW)
   **When** inspected
   **Then** it exports BOTH `Route` (TanStack file-route registration at `/admin/rule-sets/$id/edit`) AND `EditRuleSetPage` (named React component for direct test render). The route's `beforeLoad` reuses the T2-3b 5-step auth-status loader; anonymous → `/api/auth/google`; non-organizer → ForbiddenMessage; organizer → render the editor.

10. **Given** the editor rendered (idle state)
    **When** the page loads
    **Then**:
    - Heading shows the rule_set name + "Revision N" badge (where N is the latest `revisionNumber`).
    - Form fields populate from `latestRevision.configJson` (deserialized in the GET response).
    - Sections: 2v2 best-ball (sandies + autoPress), Greenies, Individual-bet, Sub-games (per Risk Acceptance §6).
    - Save button disabled until form is valid (Zod parse passes); also disabled while save mutation is in-flight.

11. **Given** the user toggles `greenies.carryover` ON
    **When** the form re-renders
    **Then** `greenies.validation` auto-switches to `'2-putt'` (UI-side state mutation in the toggle handler). Toggling OFF auto-switches to `'none'`. The Zod refine on the same shape (client-side) is the safety net for anything that bypasses the toggle handler.

12. **Given** the user clicks Save with valid form data
    **When** POST /api/admin/rule-sets/:id/revisions fires
    **Then** handle:
    - 201 → success toast "Saved revision N" + invalidate the `rule-set` query to refetch (badge updates to N+1; form fields stay populated with the just-saved values which now match the new latest revision).
    - 400 invalid_body → render generic error + log issues to console (UI shouldn't allow this; defensive).
    - 409 revision_number_conflict → render "Another save just landed; reload to see the latest revision before saving again." Do NOT auto-retry (the user's edits may differ from the conflicting revision).
    - 500 → render "Save failed; please try again" + keep form populated.

13. **Given** AbortController-on-unmount pattern (mirror T3-3 inFlightControllers ref + useEffect cleanup)
    **When** the user navigates away mid-save
    **Then** in-flight fetches abort. Both queries (GET) and the save mutation pass `signal` through fetch.

14. **Given** `apps/tournament-api/src/routes/admin-rule-sets.test.ts` (NEW)
    **When** the suite runs post-T3-5
    **Then** at least 10 backend tests exist (per Risk Acceptance §7). Tests use the existing T1-6a in-memory DB pattern; seed organizer + session, then exercise each endpoint.

15. **Given** `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.test.tsx` (NEW)
    **When** the suite runs post-T3-5
    **Then** at least 4 component tests exist (per Risk Acceptance §7). `vi.stubGlobal('fetch', vi.fn())` per-test pattern; render `EditRuleSetPage` directly bypassing TanStack Router; mock `/api/admin/rule-sets/:id` (GET) and `/api/admin/rule-sets/:id/revisions` (POST).

16. **Given** `pnpm -F @tournament/api typecheck` + `lint` + `pnpm -F @tournament/web typecheck` + `lint`
    **When** run post-T3-5
    **Then** all four exit 0. No new `any`. No new `// eslint-disable`.

17. **Given** `pnpm -F @tournament/api test` + `pnpm -F @tournament/web test`
    **When** run post-T3-5
    **Then** tournament-api ≥ baseline + 10. tournament-web ≥ baseline + 4. Baselines at story start: 308 (post-T3-3) + 21 (post-T3-3).

18. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/engine test` + `pnpm -F @wolf-cup/api test` run post-T3-5
    **Then** both continue to pass with zero net-negative test count change.

19. **Given** the deployed app at `https://tournament.dagle.cloud/admin/rule-sets/<id>/edit`
    **When** Josh manually exercises the flow (post-deploy)
    **Then**:
    - Path: create a rule_set via `POST /api/admin/rule-sets` (curl OR a future list/create UI; v1 manual curl); navigate to `/edit` URL.
    - Page renders with default config + "Revision 1" badge.
    - Edit some fields, click Save → toast appears, badge → "Revision 2".
    - Reload page → "Revision 2" persists.
    - Try invalid combo (carryover=true with validation=none via direct API curl) → 400 invalid_body.
    Manual smoke results documented in completion notes.

20. **Given** there are no SHARED-file edits
    **When** the dev agent classifies its planned edits at impl time
    **Then** every touched path falls under ALLOWED. NOT touched: `pnpm-lock.yaml`, root `package.json`, any workspace `package.json`, `docker-compose.yml`, `Dockerfile*`, root tsconfig*, `.github`, `.gitignore`, root eslint.

## Tasks / Subtasks

- [ ] Task 1: Capture baselines. (AC #17)
  - [ ] Subtask 1.1: tournament-api baseline = 308 (post-T3-3).
  - [ ] Subtask 1.2: tournament-web baseline = 21 (post-T3-3).

- [ ] Task 2: Backend — create `admin-rule-sets.ts`. (AC #1-#7)
  - [ ] Subtask 2.1: Define `RuleSetConfigSchema` Zod (per Risk Acceptance §3, including .refine).
  - [ ] Subtask 2.2: Define `CreateRuleSetRequestSchema` (just `name`).
  - [ ] Subtask 2.3: POST /rule-sets handler — Zod parse, transaction across rule_sets + rule_set_revisions, 201 response.
  - [ ] Subtask 2.4: GET /rule-sets/:id handler — fetch + JSON.parse configJson, 404 / 500 (corrupt) branches.
  - [ ] Subtask 2.5: POST /rule-sets/:id/revisions handler — pre-flight rule_set existence, MAX revision_number SELECT, INSERT, 409 on UNIQUE.
  - [ ] Subtask 2.6: Catch generic DB errors → 500 save_failed + structured log.

- [ ] Task 3: Register `adminRuleSetsRouter` in `app.ts`. (AC #8)

- [ ] Task 4: Backend — write 10+ route tests. (AC #14)

- [ ] Task 5: Frontend — create `admin.rule-sets.$id.edit.tsx`. (AC #9-#13)
  - [ ] Subtask 5.1: Dual-export Route + EditRuleSetPage.
  - [ ] Subtask 5.2: beforeLoad reuses auth-status loader.
  - [ ] Subtask 5.3: useQuery for `GET /rule-sets/:id` (signal-threaded fetch).
  - [ ] Subtask 5.4: Form state via useState; copy of RuleSetConfigSchema for client-side parse on Save.
  - [ ] Subtask 5.5: useMutation for POST /:id/revisions; AbortController via inFlightControllers ref + useEffect cleanup (mirror T3-3 pattern).
  - [ ] Subtask 5.6: Greenies carryover toggle handler auto-switches validation.
  - [ ] Subtask 5.7: Save button disabled when invalid OR mutation pending.

- [ ] Task 6: Frontend — write 4+ component tests. (AC #15)

- [ ] Task 7: Run regressions. (AC #16, #17, #18)

- [ ] Task 8: Manual post-deploy smoke per AC #19. Document in completion notes.

## Dev Notes

- **Why ship POST /rule-sets in T3-5 (beyond the epic AC):** the editor is unreachable without an existing rule_set. The epic ACs assume one exists. Pulling create-flow into T3-5 saves Josh from manual SQL seeding before he can test the editor. v1 acceptable; future polish: list view + named rename UI.

- **Why config_json stored as TEXT (JSON.stringify/JSON.parse boundary):** T3-1 schema declared it as TEXT NOT NULL. SQLite + libsql don't have a native JSON column type. JSON.parse at the GET boundary handles deserialization; corrupt data (manual SQL injection, etc.) → 500 with structured log.

- **Why RuleSetConfigSchema duplicated client + server:** same posture as T3-2's CreateEventRequestSchema. Two short Zod schemas adjacent to each other are easier to maintain than a shared package introducing a SHARED edit. Promote when 3rd consumer arrives.

- **Why integer-cents on `matchPlayPerHoleCents` and `defaultBuyInPerParticipantCents`:** mirrors Wolf Cup engine's integer-cents discipline + tournament-api's planned T6 money matrix. Form layer collects dollars, multiplies by 100 + rounds to integer at submit boundary.

- **Why no `reason` field UI in v1:** the schema column allows it, but the v1 use case (single organizer iterating on Pinehurst stakes) doesn't need audit-reason tracking. Future polish if multi-organizer collaboration starts.

- **Why no diff/rollback UI:** historical revisions stay queryable via SQL; "rollback" is functionally creating a new revision matching an old config_json. v1 organizer can read prior config_json from `GET /rule-sets/:id?revision=N` (future endpoint) or direct SQL.

- **Why no DELETE endpoint:** rule_sets shouldn't be deletable while revisions exist (T3-1 schema enforces RESTRICT FK). DELETE FROM rule_set_revisions cascades to NOTHING (revisions are leaf data); but deleting rule_sets while revisions exist throws. v1 ships without delete; future story handles cascading delete UX.

- **Why concurrent revision_number_conflict → 409 not auto-retry:** the user's edits may diverge from the conflicting revision (someone else saved different values). Retrying without showing the user the new state would silently overwrite their intent. Forcing a reload + decision is correct UX.

- **Wolf Cup isolation (FD-1 / FD-2):** T3-5 writes only to `apps/tournament-api/src/routes/admin-rule-sets.{ts,test.ts}` (NEW), `apps/tournament-api/src/app.ts` (MODIFIED), `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.{tsx,test.tsx}` (NEW). Zero edits to `apps/api/**`, `apps/web/**`, `packages/engine/**`.

- **Retro AI-1 applied:** spec codex caps at 4 rounds OR zero-High-zero-Med, whichever first. Same for impl codex.
- **Retro AI-2 applied:** zero SHARED files pre-announced in §1.
- **Retro AI-3 applied:** the request schemas (CreateRuleSetRequestSchema + RuleSetConfigSchema) ARE the contract. Tests assert exact JSON response shapes.

### Project Structure Notes

Shape after T3-5:

```
apps/tournament-api/
  src/
    app.ts                                              # MODIFIED: +adminRuleSetsRouter mount
    routes/
      admin-rule-sets.ts                                # NEW: 3 endpoints
      admin-rule-sets.test.ts                           # NEW: 10+ tests

apps/tournament-web/
  src/
    routes/
      admin.rule-sets.$id.edit.tsx                      # NEW: editor page
      admin.rule-sets.$id.edit.test.tsx                 # NEW: 4+ tests
    routeTree.gen.ts                                    # MODIFIED: auto-regen
```

**Explicitly NOT in T3-5 (reserved for future):**
- List view / Create-with-rename UI.
- Diff / rollback UI.
- Reason field on save.
- DELETE endpoint.
- Mid-event rule edit (T5.11 covers — `effective_from_round_id` set to a specific event_round).
- Event-pinning UI (T3-2.x extends events.ts schema + wizard).

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` Story T3.5 (line 942-964).
- Predecessor stories: T1-6a (auth), T3-1 (rule_sets + rule_set_revisions schema), T2-3b (auth-status loader), T3-3 (TanStack Query useMutation pattern + AbortController inFlightControllers ref).
- T3-1 schema: `apps/tournament-api/src/db/schema/rules.ts` (rule_sets + rule_set_revisions; UNIQUE on `(rule_set_id, revision_number)`; CHECK on `effective_from_hole BETWEEN 1 AND 19`).
- FD-8 (revisioning) + FD-12 (greenie carryover off): `_bmad-output/planning-artifacts/tournament/prd.md`.
- Existing route patterns: `apps/tournament-api/src/routes/admin-courses.ts` (POST + transaction), `apps/tournament-api/src/routes/admin-groups.ts` (TanStack Query useMutation pattern reference for frontend).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (Tournament Director skill, single-cycle invocation 2026-04-27).

### Debug Log References

- Spec codex: 3 rounds. R1 1H + 2M + 1L (tenant scoping not enforced; AC #7 referenced non-existent column; GET 0-revisions undefined; SELECT MAX + INSERT not transactional — all addressed). R2 0H + 2M + 1L (configJson lacks shape validation on read; requestId inconsistency; PATCH wording — all fixed). R3 0H + 0M + 2L (terminal clean per AI-1).
- Mid-impl: UNIQUE conflict test initially used a broken pre-insert path (NOT NULL violation on createdByPlayerId). Cleaned up to use vi.spyOn(db.transaction) to mock the libsql-shape error directly.
- Impl codex: 2 rounds. R1 1H (false positive — codex misread my prompt's stated AC #1 route count) + 2M (GET 200 omits requestId; corrupt_config_json untested) — both Med fixed. R2 0H + 0M + 1L (requestId not asserted in tests; trivial) — terminal clean.
- Party-mode: single non-interactive written review. All 5 agents converged on "ship". Zero open questions. 17 non-blocking flags all defer/polish/v1-acceptable.
- Party-codex: 0H + 2M (review-text wording inconsistencies only; not implementation issues).

### Completion Notes List

**Test deltas:**
- tournament-api: 308 → 324 (+16 tests; 60% over AC #14 ≥10 minimum)
- tournament-web: 21 → 25 (+4 tests; meets AC #15 ≥4 minimum)
- Wolf Cup engine: 472 (unchanged ✓ AC #18)
- Wolf Cup api: 507 (unchanged ✓ AC #18)

**All checks green:** typecheck (api + web), lint (api + web), build (api + web; PWA precache 17 → 19 entries with admin.rule-sets.$id.edit + auto-regen).

**SHARED-gate footprint:** ZERO. Risk Acceptance §1 prediction held — eighth of nine T3 stories so far without a SHARED stop (only T3-4 had one, pre-approved).

**Path footprint (5 files, all ALLOWED):**
- `apps/tournament-api/src/routes/admin-rule-sets.ts` (NEW, ~440 lines — 3 endpoints + RuleSetConfigSchema + isUniqueOrPkConstraintError + defaultConfig)
- `apps/tournament-api/src/routes/admin-rule-sets.test.ts` (NEW, 16 tests)
- `apps/tournament-api/src/app.ts` (modified — 4th /api/admin mount)
- `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx` (NEW, ~480 lines — TanStack Query useMutation editor + AbortController + 5-section form)
- `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.test.tsx` (NEW, 4 component tests)
- `apps/tournament-web/src/routeTree.gen.ts` (auto-regen)

**Deviations from spec / epic (all approved at spec gate):**
- POST /rule-sets pulled into T3-5 scope (epic only mandates POST /:id/revisions). Editor unreachable without an existing rule_set; v1 simplification.
- Two-stage parse on GET (JSON.parse + RuleSetConfigSchema.safeParse) with distinct 500 codes — defense against stored-config-json drift.
- v1 single-tenant tenant-scoping posture: queries don't add WHERE tenant_id filters (acknowledged gap matching T3-1/courses.ts:39-43).
- 409 revision_number_conflict NEVER auto-retries (different organizer's edits may differ).
- AbortController via inFlightControllers ref + useEffect cleanup (mirror T3-3 pattern).

**Manual post-deploy smoke (AC #19):** PENDING.
- Required after deploy. Path: `curl -X POST -b cookie.txt .../api/admin/rule-sets -d '{"name": "Pinehurst stakes"}'` to seed the rule_set; capture ruleSetId; navigate to `/admin/rule-sets/<id>/edit` in browser.
- Verify: form populates with default config; edit fields → Save → toast appears + badge increments to "Revision 2"; reload → state persists. Try invalid combo via curl (e.g., carryover=true with validation='none') → 400 invalid_body.

**Followups for future stories:**
- T3-6 (invite-claim) will be 5th `/api/admin` mount → consider promoting umbrella adminRouter.
- 5th-consumer threshold for libsql-errors lib — currently 4 copies of isUniqueConstraintError-shape logic.
- Future polish: list view at `/admin/rule-sets`; "Reset to Defaults" button; revisions-history view; auto-merge UX for 409 instead of reload-and-retry.
- T3-2.x will add `events.pinned_rule_set_revision_id`; the AC #7 byte-identity test will need updating to seed an event with a pinned revision.
- T6 money-compute reads config_json — inherits the same drift risk; T3-5's two-stage parse pattern is the precedent.
- T5.11 mid-event rule edit will introduce non-null `effective_from_round_id`; T3-5 always inserts NULL.
- requestId presence not asserted in tests — trivial regression risk; future polish.

### File List

- `apps/tournament-api/src/routes/admin-rule-sets.ts` — new
- `apps/tournament-api/src/routes/admin-rule-sets.test.ts` — new
- `apps/tournament-api/src/app.ts` — modified
- `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.tsx` — new
- `apps/tournament-web/src/routes/admin.rule-sets.$id.edit.test.tsx` — new
- `apps/tournament-web/src/routeTree.gen.ts` — auto-regenerated
