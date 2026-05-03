# T5-11: Mid-Event Rule Edit with Effective-Hole Boundary [new]

## Status

Done

## Story

As an organizer,
I want `POST /api/events/:eventId/rule-sets/:ruleSetId/revisions` that creates a new `rule_set_revision` with an effective-hole boundary, stamps audit + activity, and (post-T6) triggers money recompute from the boundary forward (FD-13 guardrail 1, FR-H1 mid-event edit),
So that I can fix a sandies-on vs sandies-off misconfiguration in the middle of Talamore without voiding money from the pre-boundary holes.

T5-11 is the FINAL story in epic T5. It sits on top of T3-1 (`rule_set_revisions` schema with effective_from columns), T5-8 (`getRoundState` for the frozen-round check), and the existing T3-5 admin-rule-sets endpoint (which creates revisions with `effective_from = (null, 1)` — i.e., setup-time edits). T5-11 introduces the EVENT-SCOPED edit endpoint with effective-from-this-hole semantics + freeze-window guard.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/routes/event-rule-edits.ts                           [NEW]
apps/tournament-api/src/routes/event-rule-edits.integration.test.ts          [NEW]
apps/tournament-api/src/app.ts                                               [MOD: mount router]
apps/tournament-api/src/lib/audit-log.ts                                     [MOD: add RULE_SET_REVISED audit event type + RULE_SET entity type constants]
apps/tournament-api/src/services/round-state.ts                              [MOD: add isEventOrganizerByEventId helper]
apps/tournament-api/src/services/index.ts                                    [MOD: re-export the new helper]
```

6 files total (2 NEW + 4 MOD). All four MOD edits are additive (new exports / new const entries); no existing call sites change.

### 2. Why this is a NEW route, not an extension of T3-5

T3-5 ships `POST /api/admin/rule-sets/:id/revisions` (in `apps/tournament-api/src/routes/admin-rule-sets.ts:321-444`). That endpoint:
- Mounts on `/api/admin` (admin scope).
- Always writes `effectiveFromRoundId: null, effectiveFromHole: 1` (setup-time semantics — no event scope, no freeze guard).
- Uses global `requireOrganizer` middleware.
- No activity emit.

T5-11 needs a DIFFERENT semantic: event-scoped, effective-hole-aware, with the frozen-round freeze-window guard + activity emission. Mounting on `/api/events/:eventId/...` keeps the URL contract clean, and the per-event auth is handler-internal (T5-7 pattern, NOT global `requireOrganizer`).

The two endpoints are complementary:
- T3-5 admin endpoint → "setup-time tweak before the trip starts" (effective-from-the-beginning).
- T5-11 event endpoint → "mid-event correction" (effective from a specific hole forward).

### 3. Dependencies + forward references

- **T3-1 `rule_set_revisions` schema** — write target. Has `effectiveFromRoundId text references event_rounds.id` and `effectiveFromHole integer CHECK BETWEEN 1 AND 19`. CHECK is the guard for `19` semantics ("next round onward"). No migration needed.
- **T5-8 `getRoundState` + `isEventOrganizer`** — used for the frozen-round check (per-round state read). The event-organizer check pattern is reused, but T5-8's `isEventOrganizer(tx, roundId, ...)` takes a roundId. T5-11 has an eventId in the path, not a roundId. Two implementation options:
  - (A) Add a sibling helper `isEventOrganizerByEventId(tx, eventId, callerId, tenantId)` to `services/round-state.ts`.
  - (B) Inline the check in T5-11's handler: `SELECT organizer_player_id FROM events WHERE id = :eventId AND tenant_id = :tenant`.
  v1 ships **(A)** for reusability — T5-11 is the first event-scoped story; future stories (T6, T7) will likely need the same helper. The new helper is an additive export from services/round-state.ts; no signature break.
- **T6 money recompute dispatch (NOT shipped)** — epic AC step (c) references it. v1 emits a post-commit breadcrumb log similar to T5-9's pattern (`event: 'rule_revision_pending_t6_recompute'`); the actual dispatcher invocation lands when T6 ships. Followup T5-11a tracks.
- **T8 activity feed (NOT shipped)** — epic AC mentions a participant-visible diff banner consuming the activity. v1 calls `emitActivity(tx, { type: 'rule_set.revised', ... })` which is a NO-OP per `lib/activity.ts`. T8 will replace the body. Banner UI is out of scope for THIS story.
- **GET /api/events/:eventId/money?at=<...>** — epic AC scenario references it for the audit-surface use case. **OUT OF SCOPE for v1** — T6 hasn't shipped, no money endpoint exists. Followup T5-11b tracks. v1 ships only the POST endpoint.
- **`AUDIT_EVENT_TYPES.RULE_SET_REVISED`** — does NOT exist yet in `apps/tournament-api/src/lib/audit-log.ts:23-29`. T5-11 adds it as a new const (additive).

### 4. Auth model (per-event organizer)

The handler accepts ONLY the per-event organizer (`events.organizer_player_id == session.userId`). NOT global `players.is_organizer`. NOT scorer-of-any-foursome. This matches the epic AC "Gated `require-organizer`" interpretation through the per-event lens established by T5-7/T5-8.

Auth check happens INSIDE `db.transaction` BEFORE state reads + existence checks (no-existence-leak invariant per T5-8 party-codex precedent). Nonexistent event → 403 (not 404).

### 5. Frozen-round freeze-window guard

The proposed edit's affected window is computed from `(effectiveFromRoundId, effectiveFromHole)`:

- If `effectiveFromHole ∈ [1..18]`: affected window = anchor round + every event_round whose `round_number > anchor.round_number`.
- If `effectiveFromHole = 19` (next-round-onward): affected window = every event_round whose `round_number > anchor.round_number` (anchor itself NOT included; the edit takes effect at the boundary between anchor and anchor+1).

For each event_round in the affected window, look up the corresponding `rounds.id` (1-to-1: each event_round may have at most one runtime `rounds` row in v1) and read `round_states.state` via T5-8's `getRoundState`. If ANY round in the window is `finalized`, return 422 with code `rule_edit_would_recompute_finalized_round` and `frozenRoundIds: <event_rounds.id values>` (NOT `rounds.id` — clients drive their UI off event_rounds, which they already know about from the event-creation wizard; using `rounds.id` would force an extra round-trip to map back). The error code `rule_edit_would_recompute_finalized_round` is used CONSISTENTLY across Section 5, AC-2(iv), and AC-8(c) — the earlier inconsistent `frozen_round_in_window` shorthand has been removed.

**Edge cases:**
- **No `rounds` row exists for an event_round yet** (round not opened): treat as not-finalized (the edit is safe; no scores to recompute on that round).
- **Anchor round_number itself doesn't exist** (e.g., `effectiveFromRoundId` references a deleted event_round): 422 `effective_from_round_not_found`.
- **`effectiveFromRoundId` belongs to a DIFFERENT event** than `:eventId`: 422 `round_not_in_event` (per epic AC scenario d).
- **`effectiveFromHole = 1` AND `effectiveFromRoundId` resolves to the FIRST event_round of the event:** this is technically a setup-time edit (effective from start-of-event). The handler **DOES allow it** — see Section 5b — because the per-event organizer must have a path to make the correction even if they don't have global admin access for T3-5. The spec previously specified rejecting these with `use_setup_endpoint`; that's been REMOVED to avoid blocking organizers who can't use T3-5.

### 5b. Setup-shaped edits (first-round, hole-1) ARE allowed (codex spec-review fix)

An organizer making a "first-round, hole-1" correction via T5-11 produces the same observable behavior as a T3-5 setup-time edit BUT through the per-event organizer auth path AND with activity-emit + breadcrumb-log added. T5-11 explicitly accepts this case rather than rejecting it. The audit row payload includes `priorConfig` + `newConfig` + `effectiveFromHole = 1` so post-hoc analysis can distinguish "this was a start-of-event correction" from "this was a mid-round shift".

The two endpoints (T3-5 admin and T5-11 event) coexist:
- T3-5 is global-admin scoped, no event context, no activity, no freeze guard. Suitable for editing rule-set templates BEFORE they're attached to an event.
- T5-11 is per-event scoped, with auth + activity + freeze guard. Suitable for any edit AFTER an event has been created, including hole-1 setup-shaped corrections.

### 6. T6 recompute stub (post-commit breadcrumb)

Per AC step (c), the v1 implementation logs an info-level breadcrumb AFTER the `db.transaction` resolves successfully:

```
log.info({
  event: 'rule_revision_pending_t6_recompute',
  requestId, eventId, ruleSetId, revisionId,
  effectiveFromRoundId, effectiveFromHole,
});
```

When T6 ships (likely T6-9 or T6-13), the breadcrumb is replaced with a real recompute dispatcher call inside the transaction. v1 audit trail until then.

### 6b. Architectural decision: rule_sets is library-scoped (cross-event spillover acknowledged)

**Codex spec-review-rerun caught this:** because `rule_sets` is a tenant-scoped library (no rule_sets→events FK; multiple events can reuse the same rule_set), a revision created via T5-11 by event A's organizer affects ALL events that consume rule_set X — including in-flight event B. This is a real architectural concern.

**v1 acceptance:** the rule_sets-as-library shape is part of T3-1's data model. Changing it requires a schema migration outside this story's scope. The trip-day reality is that each event currently has its OWN rule_set (created at event-wizard time), so cross-event spillover is essentially zero in practice. The audit row (per AC-3 step d) records `eventId + ruleSetId + actorPlayerId`, so any cross-event accident is forensically traceable.

**Followup T5-11e** will introduce an explicit `event_rule_set_links` table populated at event-creation time (T3-2 wizard), and T5-11's handler will then verify the link exists rather than relying on tenant-only check. Tightens the model to "this organizer can revise this rule-set ONLY in the context of an event that explicitly links to it".

For v1: this trade-off is documented as a Risk Acceptance flag — the user gate at step 4 should explicitly acknowledge it.

### 7. Tenant scoping

Every query in `event-rule-edits.ts` includes `tenant_id = TENANT_ID` on every joined table.

## Acceptance Criteria

(Derived from epics-phase1.md T5.11 lines 1629–1670.)

**AC-1 — Endpoint shape + body validation.**
**Given** `POST /api/events/:eventId/rule-sets/:ruleSetId/revisions` with body `{ configJson: object, effectiveFromRoundId: UUID, effectiveFromHole: integer 1-19, reason?: string }`
**When** invoked
**Then**:
  - `:eventId` and `:ruleSetId` validated as UUIDs (400 `invalid_event_id` / `invalid_rule_set_id`).
  - Body parsed via Zod `eventRuleEditBodySchema = z.object({ configJson: z.object({}).passthrough(), effectiveFromRoundId: z.string().uuid(), effectiveFromHole: z.number().int().min(1).max(19), reason: z.string().max(500).optional() })`. **`effectiveFromRoundId` is REQUIRED (not nullable);** a null value would be the T3-5 setup-time semantic, which T5-11 does NOT support. The Zod schema enforces UUID-shape; null/missing reaches the 400 `invalid_body` path.
  - 400 `invalid_body` on Zod failure with `issues`.
  - Setup-shaped (hole-1, first-round) edits ARE allowed per Section 5b — they fall through to the normal handler path with no special rejection. (The previously-spec'd `use_setup_endpoint` 400 has been REMOVED.)

**AC-2 — In-tx auth FIRST, then state gate, with rule-set-belongs-to-event check.**
**Given** a valid body
**When** the handler runs `db.transaction`
**Then**:
  (i) Auth re-check: caller is per-event organizer (`events.organizer_player_id == session.userId`). 403 `not_authorized_for_rule_edit` on mismatch. **No-existence-leak invariant**: nonexistent eventId → 403 (not 404).
  (ii) **Rule-set scope check (added per codex spec-review High #1):** verify `:ruleSetId` is associated with `:eventId`. **Implementation note:** the tournament data model (per `apps/tournament-api/src/db/schema/rules.ts:43-50`) treats `rule_sets` as a TENANT-SCOPED LIBRARY — there is NO direct rule_sets→events FK column. Two viable scope checks:
    - **(A) Loose check:** verify `:ruleSetId` exists in `rule_sets` AND has `tenant_id == TENANT_ID`. 404 `rule_set_not_found` on miss. Accepts that any organizer can revise any tenant-scoped rule-set in the context of any event they organize. Aligns with the current "library" data model.
    - **(B) Tight check:** require an `event_rule_set_links` table (NOT in schema) that explicitly maps each event to the rule_sets it uses. NOT viable for v1 — would require a schema migration outside this story's scope.
  v1 implements **(A)** — loose tenant-scoped existence check. The audit-log payload (per AC-3 step d) records `eventId + ruleSetId + actorPlayerId`, so cross-event accidents are auditable post-hoc. Followup T5-11e tracks introducing an explicit event_rule_set_links table when T6 adds richer per-event rule-set scoping.
  (iii) Boundary validation:
    - SELECT the `effectiveFromRoundId` event_round. If absent: 422 `effective_from_round_not_found`.
    - Verify it belongs to the URL's `:eventId`: if `event_rounds.event_id != :eventId`, return 422 `round_not_in_event`.
  (iv) Frozen-round guard: compute affected window per Section 5; for each event_round in the window, look up the corresponding `rounds.id` (LEFT JOIN; nullable when round not opened), then if `rounds.id IS NOT NULL` read `round_states.state` and check for `finalized`. If any frozen → 422 `{ error: 'unprocessable', code: 'rule_edit_would_recompute_finalized_round', frozenRoundIds: [<event_rounds.id values>, ...], requestId }`. **The `frozenRoundIds` array contains `event_rounds.id` values** (NOT `rounds.id` — clients already know event_rounds from the event-creation wizard; using `rounds.id` would force an extra round-trip).

**AC-3 — Insert revision + audit + activity.**
**Given** all gates passed
**When** the handler proceeds inside the same tx
**Then**:
  (a) Compute `revisionNumber = MAX(revision_number) + 1` for this `ruleSetId` (uses the existing T3-5 pattern from admin-rule-sets.ts).
  (b) INSERT `rule_set_revisions` row with `id = randomUUID()`, `ruleSetId`, `revisionNumber`, `configJson = JSON.stringify(body.configJson)`, `effectiveFromRoundId = body.effectiveFromRoundId`, `effectiveFromHole = body.effectiveFromHole`, `createdByPlayerId = session.userId`, `reason = body.reason ?? null`, `createdAt = now`, tenant + context (use `'event:' + eventId` for context_id, since this revision is event-scoped).
  (c) Read the prior revision's `configJson` for the audit diff payload (the most-recent revision for this ruleSetId BEFORE the new one).
  (d) `writeAudit(tx, { eventType: AUDIT_EVENT_TYPES.RULE_SET_REVISED, entityType: 'rule_set', entityId: ruleSetId, actorPlayerId: session.userId, payload: { eventId, ruleSetId, revisionId, fromRevisionNumber, toRevisionNumber, effectiveFromRoundId, effectiveFromHole, reason, priorConfig, newConfig } })`. **NEW audit type** (additive in `audit-log.ts`).
  (e) `emitActivity(tx, { type: 'rule_set.revised', actorPlayerId: session.userId, scope: { eventId }, payload: { ruleSetId, revisionId, effectiveFromRoundId, effectiveFromHole, configDiffSummary } })`.

**AC-4 — Audit log MUST add `RULE_SET_REVISED` constant.**
**Given** `apps/tournament-api/src/lib/audit-log.ts`
**When** modified
**Then** `AUDIT_EVENT_TYPES` gains a new entry: `RULE_SET_REVISED: 'rule_set.revised'`. `AUDIT_ENTITY_TYPES` gains: `RULE_SET: 'rule_set'`. Both additive; no existing call sites change.

**AC-5 — T6 recompute stub (post-commit breadcrumb).**
**Given** the rule-edit transaction commits successfully
**When** v1 ships
**Then** the handler emits an info-level log AFTER `await db.transaction(...)` returns and BEFORE `c.json(...)`:
```
log.info({
  event: 'rule_revision_pending_t6_recompute',
  requestId, eventId, ruleSetId, revisionId,
  effectiveFromRoundId, effectiveFromHole,
});
```
**No money recompute call in v1** — T6 services don't exist. Followup T5-11a tracks the actual dispatcher invocation when T6 ships.

**AC-6 — Response shape.**
**Given** the transaction commits
**When** the response renders
**Then** 200 `{ ok: true, revisionId, revisionNumber, effectiveFromRoundId, effectiveFromHole, requestId }`.

**AC-7 — `GET /api/events/:eventId/money?at=...` is OUT OF SCOPE.**
**Given** the epic AC mentions a money breakdown endpoint
**When** v1 ships
**Then** the GET endpoint is NOT implemented. Followup T5-11b tracks; the endpoint requires T6 money services to exist first.

**AC-8 — Test coverage (4 scenarios per epic AC + 4 added).**
**Given** `apps/tournament-api/src/routes/event-rule-edits.integration.test.ts`
**When** run
**Then** at minimum these tests pass:
  (a) **Mid-round happy path:** `effectiveFromHole=12`, no finalized rounds → 200, audit + revision row both written; activity emitted (NO-OP but called).
  (b) **Between-rounds happy path:** `effectiveFromHole=19`, no finalized rounds → 200; revision row uses `effectiveFromHole=19`.
  (c) **Frozen-round freeze-window:** edit window includes a `finalized` round → 422 `rule_edit_would_recompute_finalized_round` with `frozenRoundIds` populated.
  (d) **Cross-event boundary:** `effectiveFromRoundId` belongs to a DIFFERENT event → 422 `round_not_in_event`.
  (e) **403 non-organizer:** caller is a participant but not the event organizer → 403 `not_authorized_for_rule_edit`.
  (f) **403 nonexistent-event no-existence-leak:** outsider on a NONEXISTENT eventId → 403 (NOT 404), preserving the auth-leak invariant.
  (g) **400 invalid_event_id / invalid_rule_set_id:** malformed UUID in path.
  (h) **200 hole-1, first-round IS allowed** (per Section 5b — the previously-spec'd `use_setup_endpoint` rejection has been REMOVED): organizer creating an `effectiveFromHole=1, effectiveFromRoundId=<first event_round>` revision succeeds with 200 + revision row written. This unblocks per-event organizers who lack global-admin access for T3-5.
  (i) **AC-5 breadcrumb:** mid-round happy path also emits the `rule_revision_pending_t6_recompute` log AFTER tx commit. Use vi.spyOn(logger, 'info') to verify.
  (j) **404 rule-set scope check** (per AC-2(ii) loose check): caller submits a UUID for `:ruleSetId` that doesn't exist in tenant scope → 404 `rule_set_not_found`.

**Total test count: 10 cases (a–j).**

## Tasks / Subtasks

- [ ] **Task 1: Add `RULE_SET_REVISED` to `audit-log.ts`.**
  - File: `apps/tournament-api/src/lib/audit-log.ts`.
  - Add `RULE_SET_REVISED: 'rule_set.revised'` to `AUDIT_EVENT_TYPES`.
  - Add `RULE_SET: 'rule_set'` to `AUDIT_ENTITY_TYPES`.
  - Both additive; no existing call sites change.

- [ ] **Task 2: Add `isEventOrganizerByEventId` helper to `services/round-state.ts`.**
  - File: `apps/tournament-api/src/services/round-state.ts`.
  - Add a new exported function: `isEventOrganizerByEventId(tx | db, eventId, callerId, tenantId): Promise<boolean>`.
  - Implementation: simple `SELECT organizer_player_id FROM events WHERE id = :eventId AND tenant_id = :tenantId LIMIT 1`; return true if `organizer_player_id === callerId`.
  - Re-export from `services/index.ts`.
  - Note: T5-8's existing `isEventOrganizer(tx, roundId, ...)` takes roundId; T5-11 has eventId in the path, so the new helper is the natural sibling.

- [ ] **Task 3: Create `routes/event-rule-edits.ts`.**
  - File: `apps/tournament-api/src/routes/event-rule-edits.ts`.
  - Provenance comment: cite T3-5's `admin-rule-sets.ts` as the structural reference for the revision-insert pattern; explicitly note T5-11 is event-scoped + effective-hole-aware, NOT a setup-time edit.
  - Export `eventRuleEditsRouter = new Hono()`.
  - Define `eventRuleEditBodySchema` per AC-1.
  - Implement `POST /:eventId/rule-sets/:ruleSetId/revisions`:
    1. Path UUID validation (400 invalid_event_id / invalid_rule_set_id).
    2. Body parse + Zod (400 invalid_body / malformed_json).
    3. `db.transaction`: auth-FIRST (403 not_authorized_for_rule_edit) → rule-set scope check (404 rule_set_not_found) → boundary validation (422 effective_from_round_not_found / round_not_in_event) → frozen-round guard (422 rule_edit_would_recompute_finalized_round) → revision insert + prior-config read + audit + activity.
    4. Post-commit: emit `rule_revision_pending_t6_recompute` breadcrumb if commit succeeded.
    5. Return 200 `{ ok, revisionId, revisionNumber, effectiveFromRoundId, effectiveFromHole, requestId }`.
  - Inline `const TENANT_ID = 'guyan'`.

- [ ] **Task 4: Wire router into `app.ts`.**
  - Modify `apps/tournament-api/src/app.ts` — import + mount `eventRuleEditsRouter` on `/api/events`.
  - Add block-comment documenting the effective URL.

- [ ] **Task 5: Write `routes/event-rule-edits.integration.test.ts`.**
  - File: `apps/tournament-api/src/routes/event-rule-edits.integration.test.ts`.
  - Pattern after T5-9's score-corrections.integration.test.ts (in-memory libsql + mock require-session).
  - Implement all 10 AC-8 cases (a)–(j) including the breadcrumb spy and the rule_set_not_found scope-check test.
  - Reuse a `seed` helper that supports `{ rounds: [{state, ...}], existingRuleSet, existingRevision }` for flexible scenario setup.

- [ ] **Task 6: Regression test pass.** All existing tournament-api + tournament-web suites stay green; engine + Wolf Cup api unaffected. Typecheck + lint clean.

## Dev Notes

### Project Structure Notes

- **Two rule-set-revision endpoints intentionally coexist:** T3-5's `/api/admin/rule-sets/:id/revisions` for setup-time edits (no event scope), T5-11's `/api/events/:eventId/rule-sets/:ruleSetId/revisions` for mid-event edits (with effective-hole boundary + freeze guard). The two have different auth paths (global vs per-event organizer), different defaults for `effective_from_*`, and different audit event types. They're complementary, not duplicate.
- **Inline `TENANT_ID`** per established pattern.
- **Auth + state gate ordering:** auth FIRST (T5-8 party-codex precedent). Nonexistent event → 403, not 404, preserving the no-existence-leak invariant.
- **Frozen-round window correctness:** the spec's affected-window definition (Section 5) is load-bearing. Implementation MUST use `event_rounds.round_number` (not `rounds.created_at` or anything else) to enumerate "which rounds come after the boundary".
- **`context_id`** for the revision row uses `'event:' + eventId` (event-scoped) rather than T3-5's `'rule_set:' + ruleSetId` (library-scoped) — T5-11 revisions are tied to a specific event's lifecycle.

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1629–1670 (T5.11)
- T3-1 schema: `apps/tournament-api/src/db/schema/rules.ts:52-87` (rule_set_revisions table with effective_from_* columns)
- T3-5 admin endpoint precedent: `apps/tournament-api/src/routes/admin-rule-sets.ts:321-444` (revision-insert pattern, structural reference)
- T5-8 service primitives: `apps/tournament-api/src/services/round-state.ts` (`getRoundState`, `isEventOrganizer`, `BusinessRuleError`)
- T5-9 endpoint pattern (auth-FIRST + breadcrumb + per-event-organizer-only): `apps/tournament-api/src/routes/score-corrections.ts`
- Audit + activity helpers: `apps/tournament-api/src/lib/audit-log.ts:23-29`, `apps/tournament-api/src/lib/activity.ts:26-31`
- FD-13 mid-event-edit guardrail: `_bmad-output/planning-artifacts/tournament/architecture.md` (search "FD-13")

### Risks / Followups

- **Followup T5-11a: T6 money recompute on rule edit.** When T6's recompute dispatcher ships, append the dispatcher invocation INSIDE the rule-edit transaction (after the audit row, before commit) AND remove the post-commit breadcrumb. Same pattern as T5-9a.
- **Followup T5-11b: `GET /api/events/:eventId/money?at=...` audit-surface endpoint.** Out of v1 scope — T6 hasn't shipped, no money endpoint exists. v1.5 addition once T6-5/T6-6 land.
- **Followup T5-11c: Activity diff banner UI.** Epic AC mentions a participant-visible diff banner consuming the rule_set.revised activity. v1 emits the activity (NO-OP per T8); the banner UI is owned by T8 (activity-spine epic). Out of v1 scope.
- **Followup T5-11d: `GET /api/events/:eventId/rule-sets/:ruleSetId/revisions` history endpoint.** v1 ships only POST; reading the revision history requires either reusing T3-5's existing GET (which is library-scoped) or shipping an event-scoped GET. v1.5.
- **Followup T5-11e: Tighten rule-set scope check via `event_rule_set_links` table.** v1 uses a loose tenant-scoped existence check for `:ruleSetId` (per AC-2(ii) option A) because there is no rule-sets-to-events FK column. v1.5: introduce an `event_rule_set_links(event_id, rule_set_id)` table populated when an event is created (T3-2 wizard) and have T5-11 verify the link exists. Tightens audit semantics — would surface "organizer revised a rule-set their event didn't actually use" as a 404 rather than a successfully-but-spuriously-audited revision.
- **Risk: race window between frozen-round check and audit insert.** Same SQLite snapshot residual as T5-7/T5-8/T5-9 — a concurrent /finalize between the read and the commit could let a rule edit slip onto a now-finalized round. Tracked under T5-8b (BEGIN IMMEDIATE work). Acceptable v1 (organizer is a deliberate single-user action; finalize is also single-user; concurrency is essentially zero in practice).

## Files this story will edit

- apps/tournament-api/src/routes/event-rule-edits.ts
- apps/tournament-api/src/routes/event-rule-edits.integration.test.ts
- apps/tournament-api/src/app.ts
- apps/tournament-api/src/lib/audit-log.ts
- apps/tournament-api/src/services/round-state.ts
- apps/tournament-api/src/services/index.ts

Additional files MAY be added during implementation only under `apps/tournament-*/**` and MUST be appended to this list before commit.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director driving dev-story per workflow-tournament.yaml).

### Debug Log References

- impl-codex first pass (medium reasoning): 1 Med + 1 Low; both applied.
  - Med #1: dedupe frozenRoundIds via `Set` → `Array.from`. Defensive against schema drift; round_states.round_id is a PK so duplicates can't happen today.
  - Low #1: tenant-scope MAX(revision_number) + prior-config reads → added `eq(ruleSetRevisions.tenantId, TENANT_ID)`.
- impl-codex rerun (medium): PASS, 0 findings.
- party-codex (medium): 2 Med + 3 Low; the 2 Med + 1 Low spec-traceable applied.
  - Med #1: activity payload missing `configDiffSummary` per AC-3(e). Added as `null` v1 stub (T8 computes).
  - Med #2: party review claimed test (d) covered `effective_from_round_not_found`; added test (d0) so the boundary error code is genuinely covered.
  - Low #1 (test rigor): test (a) didn't assert activity emission. Added `vi.spyOn(activityMod, 'emitActivity')` with full payload-shape assertion.
  - Low #2 (LOC count) + Low #3 (non-verifiable claims): party review patched.

### Completion Notes List

- 12 integration tests pass (10 spec-mandated a–j + 2 defensive: c2 hole=19 anchor-skip, d0 effective_from_round_not_found).
- tournament-api regression: 622 → 634 (+12). Engine 472, wolf-cup api 516 unaffected.
- pnpm -r typecheck + lint clean.
- Path footprint exactly matches spec: 6 files (2 NEW + 4 additive MOD). Zero SHARED, zero FORBIDDEN.
- Spec file count was 6; actual edits 6. The integration test file is one of the 2 NEW files.

### File List

- apps/tournament-api/src/routes/event-rule-edits.ts (NEW)
- apps/tournament-api/src/routes/event-rule-edits.integration.test.ts (NEW)
- apps/tournament-api/src/app.ts (MOD: import + mount eventRuleEditsRouter at /api/events)
- apps/tournament-api/src/lib/audit-log.ts (MOD: AUDIT_EVENT_TYPES.RULE_SET_REVISED + AUDIT_ENTITY_TYPES.RULE_SET)
- apps/tournament-api/src/services/round-state.ts (MOD: isEventOrganizerByEventId helper)
- apps/tournament-api/src/services/index.ts (MOD: re-export isEventOrganizerByEventId)
