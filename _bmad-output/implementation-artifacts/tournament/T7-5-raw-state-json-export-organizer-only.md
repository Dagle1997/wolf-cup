# T7-5: Raw-State JSON Export (Organizer-Only)

## Status

ready-for-dev

## Story

As an organizer, I want `GET /api/events/:eventId/export/raw` that downloads a self-contained JSON file of all writable state for this Event, so that at any point I can archive the Event to disk or hand it to a third party for independent verification of settle-up (NFR-B1, NFR-C1).

## v1 Scope

A single event-scoped JSON dump containing:
1. **Raw tables** — every event-scoped row from every domain table that participates in this event's lifecycle (events, eventRounds, rounds, players, groups, groupMembers, invites, ruleSets, ruleSetRevisions, pairings, pairingMembers, holeScores, scoreCorrections, roundStates, scorerAssignments, individualBets, individualBetRounds, individualBetPresses, teamPressLog, subGames, subGameParticipants, subGameResults, auditLog, galleryPhotos, courses, courseRevisions, courseTees, courseHoles).
2. **Computed sections** — `moneyMatrix` (full output of `services/money.ts:computeMoneyMatrix`) and `settleUp.perPlayerNetCents` (derived from `moneyMatrix.totals`).
3. **Roster** — deduped `players` rows referenced by this event's `groupMembers`.
4. **Excluded** — auth surfaces (sessions, oauth_identities, device_bindings) per NFR-S2; activity (T8 no-op v1; emit empty array); R2 image bytes (gallery_photos carry `r2Key` only).

Returned with `Content-Type: application/json` + `Content-Disposition: attachment; filename="{eventName-slug}-{YYYYMMDD-localized-to-event-tz}.raw.json"`. Single-shot `JSON.stringify` for v1 — Pinehurst-trip scale is bounded (≤4 rounds × ~1000 hole scores × small audit + bets + sub-games ≈ tens of MB worst case; megabytes in practice).

### Auth chain

`requireSession` → `requireOrganizer`. **`requireEventParticipant` is intentionally NOT in the chain** — an organizer running an event they're not playing in should still be able to export it; the participant gate would 403 a non-playing organizer. This matches the existing `admin-events.ts` / `admin-rule-sets.ts` pattern (organizer-only routes don't require participation).

**Auth-vs-existence resolution order:** `requireSession` runs first (401 if anonymous). `requireOrganizer` runs next (403 if not organizer; only checks `player.isOrganizer`, does NOT touch the events table). The route handler runs last, queries `events` by `:eventId`, and returns 404 if the row doesn't exist. So:
- 401 < 403 < 404 (auth gates win over existence). An anonymous caller asking for a fake event id gets 401, not 404. A non-organizer asking for a fake event id gets 403, not 404. Only an authenticated organizer asking for a non-existent id sees 404.
- This is acceptable because organizers are presumed to know which events exist; the 404 is a usability signal, not an information-disclosure leak.

### Route mount

`apps/tournament-api/src/routes/export.ts` exporting `exportRouter`. Mounted in `app.ts` as `app.route('/api/events', exportRouter)`. Effective URL `GET /api/events/:eventId/export/raw`.

### Service layer

The export-shape construction lives in `apps/tournament-api/src/services/export.ts` — pure(ish) function `buildEventExport(db, eventId, tenantId)` that returns the full JSON payload object. The route is a thin wrapper:

```ts
exportRouter.get('/:eventId/export/raw', requireSession, requireOrganizer, async (c) => {
  const eventId = c.req.param('eventId')!;
  const payload = await buildEventExport(db, eventId, TENANT_ID);
  if (payload === null) return c.json({ error: 'event_not_found', requestId }, 404);
  // ... headers + JSON.stringify
});
```

Splitting the service from the route lets the round-trip integration test exercise `buildEventExport` directly without an HTTP roundtrip when feasible.

### Timestamp format

All `*_at` / `*_date` integer-ms columns are emitted as ISO-8601 UTC strings via `new Date(ms).toISOString()`. Boolean columns (e.g., `isOrganizer`, `verified`) round-trip as booleans. Money cents stay as integers. JSON columns (`config_json`, `payload_json`, `yardage_per_tee_json`) emit as parsed objects (not strings — the AC says "all FKs preserved as-is", and parsed JSON makes round-trip and third-party consumption easier; the test helper handles re-stringification on re-insert).

### auditLog filtering

`audit_log` is polymorphic; rows are scoped to this event by enumerating the EXACT (entity_type, entity_id) pairs owned by the event. The set of `audit_log` entity_types is the closed enum at `apps/tournament-api/src/lib/audit-log.ts:37-44` (AUDIT_ENTITY_TYPES). Mapping each value to its event-scoped id source:

| AUDIT_ENTITY_TYPES key | entity_type string | id source for this event |
|---|---|---|
| HOLE_SCORE | `hole_score` | `holeScores.id WHERE round_id IN (event's rounds.id)` |
| ROUND | `round` | event's `rounds.id` |
| RULE_SET | `rule_set` | `ruleSetRevisions.id` referenced by THIS event — i.e., revisions whose `effective_from_round_id` is in the event's `eventRounds.id` set, UNION revisions referenced by `individualBets.rule_set_revision_id` (if present) for this event's bets. Strictly event-scoped; tenant-wide rule_set audits from unrelated events do NOT appear (codex spec round-2 Med #2). |
| BET | `bet` | event's `individualBets.id` |
| SUBGAME | `sub_game` | event's `subGames.id` (joined via event_round_id) |
| GALLERY_PHOTO | `gallery_photo` | event's `galleryPhotos.id WHERE event_id = :eventId` |
| SESSION | `session` | **EXCLUDED v1** (auth-adjacent per NFR-S2; deferred to followup T7-5a) |

**Drizzle filter posture (correctness-preserving):** to avoid the cross-type id-collision footgun (`inArray(entityType, ...)` AND `inArray(entityId, ...)` is the WRONG composition — it matches every row where entity_type is in the set OR entity_id is in the set, regardless of pairing), build per-type predicates and OR them together:

```ts
import { or, and, eq, inArray } from 'drizzle-orm';

// Per-type predicates. SKIP types whose id list is empty — Drizzle's
// inArray([]) emits an always-false `WHERE 1=0` (correct) on libsql, but
// composing many always-false predicates wastes cycles AND `or(...[])`
// (zero predicates) is undefined behavior. Build the list with empty
// filtering first, then handle the all-empty case.
const candidatePairs: Array<[string, string[]]> = [
  ['hole_score',     holeScoreIds],
  ['round',          roundIds],
  ['rule_set',       ruleSetRevisionIds],
  ['bet',            betIds],
  ['sub_game',       subGameIds],
  ['gallery_photo',  galleryPhotoIds],
];
const predicates = candidatePairs
  .filter(([, ids]) => ids.length > 0)
  .map(([type, ids]) =>
    and(eq(auditLog.entityType, type), inArray(auditLog.entityId, ids)),
  );
const auditRows = predicates.length === 0
  ? []
  : await db.select().from(auditLog).where(or(...predicates));
```

This guarantees:
- Correct (entity_type, entity_id) pairing (no cross-type id-collision footgun) — codex spec round-1 Low #3.
- Empty-event safety (no rounds → no hole_scores → all id lists empty → `auditRows = []` short-circuit, no malformed SQL emitted) — codex spec round-2 Med #1.

**Future-entity-type fragility.** When a new story adds an `AUDIT_ENTITY_TYPES.X = 'x'`, the export's enum mapping above MUST be extended or the audit row will silently drop from the export. The integration test seeds at least one row per known entity_type and asserts each appears in the export — adding a new type without updating the export will fail that test in CI loudly.

### courses + courseRevisions inclusion

The export includes course data referenced by this event's `event_rounds.course_revision_id`. Specifically:
- `courseRevisions` WHERE `id IN (event's eventRounds.courseRevisionId set)`
- `courses` WHERE `id IN (the parent course ids of those revisions)`
- `courseTees` WHERE `course_revision_id IN (set above)`
- `courseHoles` WHERE `course_revision_id IN (set above)`

This makes the export self-contained for round-trip — a fresh DB can re-insert these and the event's event_rounds will have their FK targets present.

### moneyMatrix + settleUp

```ts
const viewerPlayerId = await pickExportViewerPlayerId(db, eventId, event.organizerPlayerId);
const matrix = await computeMoneyMatrix(db, eventId, viewerPlayerId, TENANT_ID);
const settleUp = {
  perPlayerNetCents: matrix.totals,    // already integer cents per player
  computedAt: matrix.computedAt,
};
```

**`pickExportViewerPlayerId` resolution** (because `computeMoneyMatrix` may apply visibility filtering based on the viewer):

1. If `event.organizerPlayerId` is in `groupMembers WHERE eventId = :eventId` → use it. The organizer is a participant; the matrix returned matches what they'd see in the UI.
2. Else (organizer is not a participant) → use the FIRST `groupMembers.playerId` for this event, ordered by `(group_id ASC, player_id ASC)` for determinism.
3. Else (the event has zero group members — empty event, AC-7) → use `event.organizerPlayerId` anyway. `computeMoneyMatrix` will return an empty matrix (`players: [], matrix: {}, totals: {}`) so the viewer choice is moot.

**Why this works for v1:** `groups.moneyVisibilityMode` defaults to `'open'` (verified at `apps/tournament-api/src/db/schema/groups.ts`); under `'open'` the matrix is identical regardless of viewer. For `'participant'` mode, every group member sees the full matrix — branch (1) and (2) both produce that. For `'self_only'` (rare in v1; not enabled in any seeded event yet), branch (1)/(2)'s viewer would see only their own row, which would NOT be a complete matrix — but that visibility mode is incompatible with the "self-contained external-verification" purpose of this export. **Documented assumption:** v1 export is only meaningful for events where every group's `moneyVisibilityMode` is `'open'` or `'participant'`; an event with a `'self_only'` group will surface a Risks-section warning in the response body's top-level `warnings: string[]` field (added below).

**`warnings` top-level field.** The export body includes a `warnings: string[]` field (empty array in normal happy-path). Populated when:
- Any group in the event has `moneyVisibilityMode === 'self_only'` → `'self_only_visibility_may_truncate_money_matrix'`.
- The chosen viewer is the organizer-not-as-participant fallback → `'viewer_chosen_first_group_member'`.

Auditable, machine-readable, doesn't break the round-trip recompute test (which uses the test helper to recompute against ALL hole_scores, not via `computeMoneyMatrix`'s viewer-filtered path).

`settleUp` does NOT include the transfer-suggestion graph in v1 (the web view computes that client-side from totals). The AC asks only for `perPlayerNetCents` and verification parity with a third-party recompute — we deliver exactly that. Followup T7-5b can add the transfer graph if needed.

### Filename slug

```ts
const slug = event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now()).replace(/-/g, '');
const filename = `${slug || 'event'}-${ymd}.raw.json`;
```

Empty/non-ASCII event names fall back to `event-${ymd}.raw.json`. The 60-char slug cap prevents filesystem-name overflow on hostile inputs.

### Schema version

Top-level `schemaVersion: 1`. A future story can bump to `2` if columns are added/renamed; the round-trip test asserts schemaVersion is present.

## Path footprint

### ALLOWED — Tournament-scoped (write freely)

```
apps/tournament-api/src/routes/export.ts                                     [NEW]
apps/tournament-api/src/routes/export.integration.test.ts                    [NEW]
apps/tournament-api/src/services/export.ts                                   [NEW]
apps/tournament-api/src/services/export.test.ts                              [NEW — round-trip helper unit test]
apps/tournament-api/src/app.ts                                               [MODIFIED — mount exportRouter]
_bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md  [THIS FILE]
```

5 NEW + 1 MODIFIED. All under `apps/tournament-*/`. Zero SHARED, zero FORBIDDEN.

### Files this story will edit

```
apps/tournament-api/src/routes/export.ts
apps/tournament-api/src/routes/export.integration.test.ts
apps/tournament-api/src/services/export.ts
apps/tournament-api/src/services/export.test.ts
apps/tournament-api/src/app.ts
_bmad-output/implementation-artifacts/tournament/T7-5-raw-state-json-export-organizer-only.md
```

## Acceptance Criteria

**AC-1 — Endpoint shape.**

**Given** session player is an organizer AND `:eventId` references an existing event
**When** invoking `GET /api/events/:eventId/export/raw`
**Then** the response status is 200, `Content-Type` is `application/json`, and `Content-Disposition` is `attachment; filename="{slug}-{YYYYMMDD}.raw.json"` where `{slug}` is the lowercased-hyphenated event name (≤60 chars, fallback `event` for empty slugs) and `{YYYYMMDD}` is today's date in the event's timezone.

**AC-2 — Body shape (top-level keys).**

**Given** the export response body
**When** parsed as JSON
**Then** the body has at minimum these top-level keys, each present (even when empty):

```
schemaVersion: 1
exportedAt: ISO-8601 UTC string
event: { id, name, startDate (ISO), endDate (ISO), timezone, organizerPlayerId, createdAt (ISO), tenantId, contextId }
roster: Array<Player>             // group_members of this event, deduped by player_id
players: Array<Player>            // SUPERSET of roster — every distinct player_id referenced by ANY in-export FK column (organizerPlayerId on events; createdByPlayerId on invites/ruleSetRevisions; enteredByPlayerId on roundStates; openedByPlayerId on rounds; scorerPlayerId on hole_scores + scorer_assignments; uploadedByPlayerId on gallery_photos; createdByPlayerId on sub_game_results; actorPlayerId on audit_log; and the groupMembers superset). The roster is the strict subset of players who are group members; the broader `players` list ensures FK referential closure for round-trip replay.
warnings: string[]                // empty in normal happy-path; populated for non-fatal anomalies (e.g., 'self_only_visibility_may_truncate_money_matrix')
events: Array<Event>              // single-element with the target event for table-style consistency
eventRounds: Array<EventRound>
rounds: Array<Round>
groups: Array<Group>
groupMembers: Array<GroupMember>
invites: Array<Invite>
ruleSets: Array<RuleSet>
ruleSetRevisions: Array<RuleSetRevision>
courses: Array<Course>
courseRevisions: Array<CourseRevision>
courseTees: Array<CourseTee>
courseHoles: Array<CourseHole>
pairings: Array<Pairing>
pairingMembers: Array<PairingMember>
holeScores: Array<HoleScore>
scoreCorrections: Array<ScoreCorrection>
roundStates: Array<RoundState>
scorerAssignments: Array<ScorerAssignment>
individualBets: Array<IndividualBet>
individualBetRounds: Array<IndividualBetRound>
individualBetPresses: Array<IndividualBetPress>
teamPressLog: Array<TeamPressLog>
subGames: Array<SubGame>
subGameParticipants: Array<SubGameParticipant>
subGameResults: Array<SubGameResult>
galleryPhotos: Array<GalleryPhoto>      // T7-4; r2Key only, no image bytes
auditLog: Array<AuditLog>
activity: []                            // T8 no-op v1
moneyMatrix: { players, matrix, totals, computedAt, visibilityMode }
settleUp: { perPlayerNetCents: Record<playerId, integerCents>, computedAt }
```

**AC-3 — Type discipline.**

**Given** the export body
**When** every cell is inspected
**Then**:
- All money values (every cell of `moneyMatrix.matrix`, `moneyMatrix.totals`, `settleUp.perPlayerNetCents`, `individualBets.stakePerHoleCents`, `subGameResults.totalPotCents`) are `Number.isInteger(value) === true`.
- Every `*_at` / `*_date` / `effectiveFromHole`-adjacent timestamp column is an ISO-8601 UTC string (matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$`).
- Boolean columns (`players.isOrganizer`, `courseRevisions.verified`) are JSON booleans.
- JSON-blob columns (`rule_set_revisions.config_json`, `audit_log.payload_json`, `course_holes.yardage_per_tee_json`, `sub_games.config_json`, `sub_game_results.config_snapshot_json`, `sub_game_results.results_json`, `individual_bets.config_json`) are parsed objects, not strings.
- All other columns retain their schema-native type (text → string, integer → number, etc.).

**AC-4 — FK referential integrity (closure invariant).**

**Given** the export body
**When** every non-null FK column is inspected
**Then** every FK target id appears within this export's row set for the referenced table. The export must be FK-closed: if any row has `playerId = X`, then `X` is in `players[]`; if any row has `courseRevisionId = Y`, then `Y` is in `courseRevisions[]`. Round-trip replay (test helper inserting all rows into a fresh `PRAGMA foreign_keys = ON` libsql instance) succeeds without FK constraint violations on any table.

**Out-of-scope FK targets** (intentionally excluded from the export):
- `tenant_id` is a stamped column, not a FK to any table — no closure obligation.
- `context_id` is a stamped string, not a FK — no closure obligation.
- Auth-adjacent FKs (`sessions.player_id`, `oauth_identities.player_id`, `device_bindings.player_id`) — auth tables are not exported per NFR-S2; the test helper's fresh DB does not load them.

**AC-5 — moneyMatrix verification parity.**

**Given** the export body's `moneyMatrix.matrix` and `moneyMatrix.totals`
**When** an independent reconstruction recomputes the matrix from the exported `holeScores` + `ruleSetRevisions` + `individualBets` (using the test helper's "fresh DB → re-insert → recompute via `computeMoneyMatrix`" pipeline)
**Then** the recomputed `matrix` and `totals` match the exported values byte-for-byte (deep-equal, not reference-equal). NFR-C1 external-verification path.

**AC-6 — Auth chain.**

**Given** anonymous caller
**When** invoking the route
**Then** 401 from `requireSession`.

**Given** authenticated non-organizer
**When** invoking the route
**Then** 403 `{ error: 'forbidden', code: 'not_organizer', requestId }` from `requireOrganizer`.

**Given** authenticated organizer AND `:eventId` does not exist (any non-existent uuid)
**When** invoking the route
**Then** 404 `{ error: 'event_not_found', requestId }`. **Note on existence-leak posture:** unlike T7-1/2/3 which uniformly 403 to avoid letting a participant enumerate other events, this is an organizer-only endpoint and the organizer is presumed to know which events exist; surfacing a clean 404 is more useful than masking unknown-event as 403. Aligns with existing organizer admin endpoints (T3-2, T3-5).

**AC-7 — Empty-event happy path.**

**Given** an event with no rounds, no scores, no bets, no gallery photos, no audit rows
**When** the export is fetched
**Then** the response is still 200 with a valid JSON body; every collection is `[]`; `moneyMatrix.matrix` is `{}` (or `{ playerId: {} }` for each roster member with all-zero internals — implementation-defined but `Number.isInteger` invariant must hold for any cell present); `settleUp.perPlayerNetCents` is `{}` or all-zeros for the roster.

**AC-8 — Filename slug edge cases.**

**Given** event names `"Pinehurst 2026"`, `"  "`, `"!@#$%^"`, and `"Long Name " + "x".repeat(200)`
**When** the export filename is built
**Then** filenames are `pinehurst-2026-{ymd}.raw.json`, `event-{ymd}.raw.json`, `event-{ymd}.raw.json`, `long-name-xxxxxxxxx...-{ymd}.raw.json` (slug truncated at 60 chars, no trailing hyphen). The `{ymd}` is computed in the event's `timezone`, not the server's local time.

**AC-9 — Test coverage.**

`apps/tournament-api/src/routes/export.integration.test.ts` covers:
- (a) Happy path — populated fixture (organizer, 2 rounds, ~10 hole scores per player, 1 bet, 1 gallery photo) — all top-level keys present, all type invariants from AC-3 hold, filename header parses cleanly.
- (b) Empty event — no rounds, no scores — 200 with empty arrays.
- (c) Non-organizer participant → 403; anonymous → 401; non-existent event → 404.
- (d) Round-trip invariant — call buildEventExport → spawn a fresh in-memory DB → re-insert all rows from the export (via test helper that handles the JSON-string ↔ object inversion + ISO ↔ ms timestamp inversion + parsed-blob ↔ stringified-blob inversion) → call `computeMoneyMatrix` against the fresh DB → assert `result.matrix` deep-equals exported `moneyMatrix.matrix`.
- (e) Filename slug edge cases (4 inputs from AC-8).
- (f) `auditLog` filtering — seed audit rows for THIS event AND for an unrelated event; the export's `auditLog` array contains only THIS event's rows.

`apps/tournament-api/src/services/export.test.ts` covers:
- The `buildEventExport(db, eventId, tenantId)` pure-ish helper at the unit level: returns null for unknown event; returns the documented shape for a small synthetic fixture; correctly invokes the timestamp/JSON-blob serializers.

**AC-10 — Route mount + Wolf Cup unmodified.**

`apps/tournament-api/src/app.ts` adds a single `app.route('/api/events', exportRouter)` line + import. **No** Wolf Cup (`apps/api/**` / `apps/web/**` / `packages/engine/**`) edits.

## Risks

- **Memory at scale.** Single-shot `JSON.stringify` allocates the entire payload. v1 trip-scale (~10 players × 4 rounds × 18 holes ≈ 720 hole_scores + ~100 audit rows + small bet/sub_game tables) is comfortably under 5 MB. If a future season-long event grows to thousands of rounds, switch to streaming (`hono/streaming`) — Followup T7-5c.
- **Round-trip helper drift.** The test helper that re-inserts a parsed export into a fresh DB must mirror every schema column. New columns added in future stories will silently break round-trip until the helper is updated. Mitigation: the helper is self-validating — it iterates `Object.keys` from the export and re-inserts; any unknown column triggers a Drizzle SQL error in CI, surfacing the drift loudly.
- **moneyMatrix viewer-id assumption.** `computeMoneyMatrix` requires a `viewerPlayerId`; we pass `event.organizerPlayerId` when the organizer is a participant, else fall back to the first group_member id (deterministic by group_id then player_id). For `open` / `participant` visibility modes the matrix is identical regardless of viewer — verified by spec assumption. For `self_only` mode, the matrix would be truncated to one row and the export emits a top-level `warnings` entry. The integration test fixture must use `'open'` visibility (matches the v1 default at `groups.moneyVisibilityMode`) so the AC-5 parity test stays viewer-agnostic — codex spec round-2 Low #4.
- **Round-trip helper non-table-key tolerance.** The test helper that re-inserts an export into a fresh DB iterates the documented table list (the keys in the AC-2 body shape) — it MUST explicitly ignore the top-level non-table keys (`schemaVersion`, `exportedAt`, `event` (singular vs plural), `roster`, `warnings`, `moneyMatrix`, `settleUp`, `activity`). Treating them as tables would error on the missing schema. Codex spec round-2 Low #3.
- **auditLog filtering completeness.** The entity-id IN-list approach won't catch audit rows whose `entityType` falls outside the enumerated allowlist (e.g., a future `entityType='settlement'` without an export update). Mitigation: the integration test seeds audit rows with each known entity_type and asserts they all appear. New entity_types added by future stories will FAIL the test until the export's enum is extended.
- **Settle-up transfer graph deferred.** The AC's "settleUp" section is just `perPlayerNetCents` (= money totals); the transfer-suggestion graph is computed client-side today and deferred to Followup T7-5b if needed.
- **Session/auth audit rows excluded.** v1 export skips `entityType='session'` audit rows. If forensic investigation needs them, Followup T7-5d can add a separate `GET /api/events/:eventId/export/auth-audit` endpoint with an even tighter auth chain (organizer + 2FA / OAuth re-prompt).

## Followups (out of scope, capture only)

- **T7-5a** — Auth-adjacent audit (session) export, separate endpoint with stricter auth.
- **T7-5b** — Settle-up transfer graph (X owes Y $Z) computed server-side.
- **T7-5c** — Streaming JSON output for season-scale exports.
- **T7-5d** — Per-table `GET /api/events/:eventId/export/{tableName}.csv` for spreadsheet workflows (Jason's posture mirror — Wolf Cup ships an Excel export, tournament's CSV variant lands when a player asks for it).
- **T7-5e** — Signed-URL upload of the export to R2 for sharing without re-fetch (organizer→stakeholder hand-off).

## Definition of done

- All AC pass (AC-1 through AC-10).
- `pnpm --filter @tournament/api test` green; new export integration test + service unit test included.
- `pnpm -r typecheck` clean.
- `pnpm -r lint` clean.
- Wolf Cup test counts unchanged (engine 472, api 516).
- Spec + impl + party codex reviews each PASS or FIXED-N (no STOP-on-High user decisions outstanding).
- The route is mounted in `app.ts` and serves the documented payload against the populated fixture used by the integration test.
