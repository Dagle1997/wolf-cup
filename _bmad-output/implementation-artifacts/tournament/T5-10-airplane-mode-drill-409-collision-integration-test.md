# T5-10: Airplane-Mode Drill + 409-Collision Integration Test [new]

## Status

Ready for Dev

## Story

As a developer / organizer,
I want (a) a CI-gated 409-collision integration test that proves first-writer-wins on the score-cell UNIQUE constraint, AND (b) a manual airplane-mode drill checklist run pre-trip on each scorer device,
So that NFR-R2 (offline-merge correctness) is automated AND device-level offline behavior is human-validated before the trip.

T5-10 sits on top of T5-6 (score POST + idempotent dedupe + 409 conflict) + T5-3 (offline queue). Both the idempotent-replay test and the 409-collision test ALREADY EXIST in `apps/tournament-api/src/routes/scores.integration.test.ts` as part of T5-6's ship — see lines 299–339 and 341–366. T5-10's automated work narrows to **strengthening the existing 409 test** with two missing epic-AC assertions (first-writer-wins row state + no audit row for 409 path). The manual drill checklist is brand-new (no scripts/ dir exists yet in tournament-web).

T5-10 is the second-to-last story in epic T5: T5-10 → T5-11.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN expected

```
apps/tournament-api/src/routes/scores.integration.test.ts                    [MOD: strengthen existing 409 test with 2 missing assertions]
apps/tournament-web/src/scripts/drill-offline-scorer.md                      [NEW: manual checklist; new directory]
```

Two paths total. The `scripts/` directory is created with the new markdown file.

### 2. Why the test work is small

T5-6 already shipped both halves of the automated work via the existing `200 deduped: same clientEventId replay` (line 299) + `409 hole_already_scored: different clientEventId at same cell` (line 341) tests. Verified during spec-write: the dedupe test already asserts `rows.length === 1` AND audit-count === 1; the 409 test asserts `code === 'hole_already_scored'` AND `conflictingEntry.client_event_id`.

T5-10's automated work narrows to **two missing assertions on the 409 test**:
- (d) After 409: `hole_scores.length === 1 AND grossStrokes === 4` (first-writer-wins; D3-3).
- (e) After 409: `audit_log` has EXACTLY 1 `score.committed` row (the first insert's), NOT 2 — the 409 path MUST NOT emit a second audit row.

These are tightening assertions on existing test behavior, not new functionality.

### 3. The drill checklist is documentation, not code

`apps/tournament-web/src/scripts/drill-offline-scorer.md` is a manual procedure document. It is NOT executed in CI. It IS:
- Read by the organizer / scorer before each target Event.
- Followed step-by-step on each scoring device (one drill per device).
- Archived in `reference/drills/` (or alternative TBD) with the executor's name + date + tournament commit SHA.
- The pre-trip gate for NFR-R2 per T9 validation plan.

### 4. The drill is per-device, not per-event

Per the 2026-04-26 memory note about T9.4 ("manual drill script run per device that might actually be assigned scorer or receive a scorer handoff during Pinehurst"): every device that COULD score must complete the drill. The drill output is one row per device per Event, archived under `reference/drills/<eventId>/<deviceLabel>.md` (or similar — see "Storage location" below).

### 5. Storage location for drill records (decision needed in spec)

Two reasonable options:

(A) **Inside the repo**: `reference/drills/<eventId>/<deviceLabel>.md` checked into git. Pro: version-controlled audit trail. Con: tournament repo accumulates one .md per device per Event over time.

(B) **External**: Josh's Obsidian vault or the wolf-cup-backup R2 bucket. Pro: doesn't bloat the repo. Con: not visible to BMAD workflow checks.

**v1 spec decision: (A) — inside the repo at `reference/drills/`.** Rationale: T9 validation gates need to inspect drill records to clear the Event for scoring; checked-in is the simplest signal. Storage is small (one .md per device, ~2KB each). Repo is git-LFS-free, regular commits. v1.5 reconsidering option B is fine if records grow unwieldy.

`reference/` is at the repo root — NOT under `apps/tournament-*/**`. Per the path allowlist, root-level paths are SHARED unless explicitly listed. The drill TEMPLATE lives under `apps/tournament-web/src/scripts/` (ALLOWED). The drill RECORDS would be in `reference/drills/` (NEW directory at repo root → SHARED).

**v1 deviation noted:** the drill checklist itself ships in v1; the FIRST drill record won't be created until pre-Pinehurst (likely 2026-05-03 or sooner). The `reference/drills/` directory + actual records are out of scope for THIS story. T5-10 ships the procedure; T9 (validation epic) is the gate that consumes records. When the first drill is run, that's when `reference/drills/` gets created — and that's a SHARED-path edit that needs separate approval at the time. Documented as Followup T5-10a.

### 6. Tenant scoping discipline (test code only)

The strengthened 409 test uses the existing `seedRound` helper which already filters on `TENANT_ID`. No new tenant-scoping concerns.

### 7. The drill does NOT exercise T5-7 / T5-8 / T5-9

The drill scenario (12 cells, 3 holes × 4 players, single scorer, single device, airplane on/off) deliberately does NOT exercise scorer handoff, round finalization, or score correction. Those are separately tested:
- T5-7 has its own 11 integration tests.
- T5-8 has 20 route-level integration tests.
- T5-9 has 22 route-level tests.
- T5-10's drill focuses ONLY on the offline-queue → drain → leaderboard-propagation path (T5-3 + T5-6 + T5-5).

This focus keeps the drill ≤10 minutes per device. Scorer handoff drills are separately surfaced by T9.4 (mentioned in the 2026-04-26 memory entry).

## Acceptance Criteria

(Derived from epics-phase1.md T5.10 lines 1590–1627.)

**AC-1 — Strengthen existing 409 test with first-writer-wins assertion.**
**Given** `apps/tournament-api/src/routes/scores.integration.test.ts` `409 hole_already_scored` test (currently lines 341–366)
**When** modified per this AC
**Then** AFTER the 409 response assertion, ADD:
```
const rows = await db
  .select()
  .from(holeScores)
  .where(
    and(
      eq(holeScores.roundId, seed.roundId),
      eq(holeScores.playerId, seed.player1Id),
      eq(holeScores.holeNumber, 7),
    ),
  );
expect(rows.length).toBe(1);
expect(rows[0]!.grossStrokes).toBe(4);  // first-writer-wins per D3-3
expect(rows[0]!.clientEventId).toBe('evt-A');  // proves the surviving row is the ORIGINAL, not a clobbered copy
```
The third assertion is load-bearing: `rows.length === 1 + grossStrokes === 4` together don't fully prove the original row survived (a hypothetical UPDATE that coincidentally set the same value would still pass). Asserting `clientEventId === 'evt-A'` (the first POST's id) proves the row identity matches the first insert.

**AC-2 — Strengthen existing 409 test with no-audit-row-on-409 assertion (round-scoped).**
**Given** the same 409 test
**When** modified per this AC
**Then** ALSO ADD after AC-1's assertions:
```
// Scope the audit-row count to THIS round's entityIds so the assertion
// stays deterministic even if the in-memory libsql client retains rows
// from sibling tests in the same suite. The score.committed audit row
// is keyed by entityId = hole_scores.id; we look up the surviving row's
// id and count audits against just that entity.
const surviving = rows[0]!;
const audits = await db
  .select()
  .from(auditLog)
  .where(
    and(
      eq(auditLog.eventType, 'score.committed'),
      eq(auditLog.entityId, surviving.id),
    ),
  );
expect(audits.length).toBe(1);  // ONLY the first insert wrote an audit row
```
The `entityId` filter scopes the count to the surviving hole_score row's id, preventing flakiness if other tests in the same `describe` block leak rows (the existing `beforeEach` does `await db.delete(auditLog)` so cross-test leakage shouldn't happen, but the entityId filter makes the assertion robust regardless).

**ALSO add a complementary assertion that no audit was emitted for the SECOND insert's would-be-entity** (caught in spec-codex-rerun: scoping ONLY by surviving entity could miss an erroneous audit emitted under a different `entityId` if the rejected insert ever wrote one):

```
// Defensive: count total score.committed audit rows for THIS round.
// beforeEach truncates auditLog so this should be EXACTLY 1 (the
// first insert's audit row). If the 409 path ever erroneously
// writes an audit under any entityId (e.g., a hypothetical
// pre-conflict-check audit), this catches it.
const allRoundAudits = await db
  .select()
  .from(auditLog)
  .where(eq(auditLog.eventType, 'score.committed'));
expect(allRoundAudits.length).toBe(1);
```

Together these two assertions give defense in depth: the surviving-entity scope catches "wrote a duplicate audit under the same entityId"; the total-count catches "wrote an audit under any entityId at all on the 409 path". Both must be 1 for the contract to hold.

**AC-3 — Verify the existing dedupe test already covers epic AC for idempotent replay.**
**Given** `apps/tournament-api/src/routes/scores.integration.test.ts` `200 deduped` test (currently lines 299–339)
**When** inspected
**Then** confirm it already asserts: 200 status + `deduped: true` + `clientEventId` echo + `rows.length === 1` + `grossStrokes === 4 (first wins)` + audit-row count === 1. **No new assertions required for this test** — T5-6 shipped it complete. T5-10 just verifies + documents.

**AC-4 — Manual drill checklist file exists.**
**Given** `apps/tournament-web/src/scripts/drill-offline-scorer.md`
**When** inspected
**Then** the file exists and contains the 7 numbered steps from epic AC + the "who/when/commit-sha" record block + a "Pass / Partial-Pass / Fail" recording slot per step. Format: human-readable Markdown; no executable code; intended to be opened on a laptop while drilling on the phone.

**AC-5 — Drill checklist content (the 7 steps).**
**Given** the drill markdown
**When** read top-to-bottom by a scorer about to drill on their device
**Then** they can complete the drill end-to-end with no other documentation. The drill markdown MUST include a **"Setup" section before step 1** specifying:
  - **Environment:** production `tournament.dagle.cloud` (the same environment that will be used during the trip — drilling against staging would not catch prod-specific config drift).
  - **Test round provisioning:** a "drill round" must be pre-created by the organizer using T3-2's event wizard, with the executing device's player as a foursome member AND the assigned scorer of that foursome. Drill rounds use `name: "Drill {date} {device}"`. After the drill completes, the organizer cancels the round via T5-8's `/cancel` endpoint so it doesn't pollute leaderboards.
  - **Platform support:** v1 explicitly supports iOS Safari only. **Android NOT validated for v1**; Pinehurst-trip devices are all iOS per the operator's roster (see Followup T5-10e for Android v1.5). Other browsers on iOS (Chrome, Firefox) are fall-through — the PWA install path is iOS-Safari-specific.
  - **Single-developer optional:** the organizer should be present (but does not need to be a developer) for steps 1, 6 (second-device check), 7 (audit verify SQL).
  - **Time budget:** ≤10 minutes per device.

The 7 steps:

  1. **PWA install verify** — open `tournament.dagle.cloud` in iOS Safari → Share menu → "Add to Home Screen" → tap the new tournament icon → verify the app launches in standalone mode (no Safari chrome). If install fails, the device is BLOCKED.
  2. **Online open + cache verify** — sign in (Google OAuth), open the drill round's score-entry page, navigate one hole forward to confirm the scorecard shell renders. Expected behavior per T5-4: cell layout + course par/SI visible.
  3. **Airplane mode** — enable airplane mode in iOS Settings (NOT just toggling cellular — the iOS airplane button is the load-bearing gate; cellular-off keeps wifi alive on some configurations). **Verify offline state by:** observing the in-app offline indicator (chip / badge) AND attempting a hard-refresh of the page; if the page reloads from cache (round-cache hit), the offline state is verified. If the page won't load at all, wifi is still active — return to airplane settings.
  4. **Offline scoring** — score 3 consecutive holes for 4 players (12 cells total). Verify the on-screen "queued" indicator increments to 12. Cells must be persistent (i.e., reloading the page from the home screen still shows 12 queued).
  5. **Disable airplane mode** — turn airplane off; wait for cellular signal to re-acquire (≤30s typical at Pinehurst).
  6. **Verify drain (≤30s, NFR-P2 envelope) — TWO PATHS:**
     - **Preferred path (with second device):** open the drill round's leaderboard on a SECOND online device (organizer's laptop / phone / etc.). Within 30s of step 5, verify all 12 cells appear in the leaderboard (4 players × 3 holes new gross totals).
     - **Fallback path (no second device):** the drilling device's "queued" indicator drops to 0 / "all synced" within 30s. Then **on the SAME device**, open the leaderboard tab; the 12 cells are visible. The same-device path is weaker (doesn't prove cross-device propagation) but is acceptable when no second device is available; the executor MUST note "single-device drill — no cross-device propagation verified" in the drill record's "Issue notes".
  7. **Audit verify (organizer / developer task):** the drilling scorer typically does NOT have audit-log access; this step is performed by the organizer or a developer with VPS/SSH access to Hostinger after step 6 succeeds. Run on the VPS:
     ```
     docker exec wolf-cup-api sqlite3 /data/tournament.db \
       "SELECT count(*) FROM audit_log WHERE event_type='score.committed' AND entity_id IN (SELECT id FROM hole_scores WHERE round_id='<DRILL_ROUND_ID>');"
     ```
     Expect exactly 12. Then:
     ```
     docker exec wolf-cup-api sqlite3 /data/tournament.db \
       "SELECT count(*) FROM score_corrections WHERE round_id='<DRILL_ROUND_ID>';"
     ```
     Expect 0 (no corrections needed during a clean drill). If audit count ≠ 12, the drill FAILS the device for that Event. **For non-developer scorers:** the drill record's step-7 row gets "Pending — awaiting organizer verification" until the organizer runs the SQL and updates the row. Followup T5-10b tracks shipping a `GET /api/admin/audit-log/round/:roundId` endpoint that the scorer's organizer can hit from a phone, eliminating SSH access from the drill loop.

**AC-6 — "Who / when / commit-sha" record block.**
**Given** the drill markdown
**When** read at the bottom
**Then** there's a "Drill record" block to be filled by the executor:
```
## Drill record

- Executor: ____________
- Device: ____________ (e.g., "iPhone 14 Pro, iOS 18.4, Safari 18.4")
- Drill date: ____________
- Tournament commit SHA: ____________ (output of `git -C wolf-cup rev-parse HEAD`)
- Target Event id: ____________
- Step results:
  1. PWA install: [Pass / Fail / N/A]
  2. Online open + cache: [Pass / Fail]
  3. Airplane mode: [Pass / Fail]
  4. Offline scoring: [Pass / Fail]  (queued count after step 4: ___ cells)
  5. Disable airplane mode: [Pass / Fail]
  6. Verify drain: [Pass / Fail]  (drain elapsed: ___s)
  7. Audit verify: [Pass / Fail]  (audit row count: ___; score_corrections row count: ___)
- Overall: [Pass / Partial-Pass / Fail]
- Issue notes: ____________
- Filed at: reference/drills/<eventId>/<deviceLabel>.md (per Followup T5-10a)
```

**AC-7 — Pre-trip gate documentation.**
**Given** the drill markdown
**When** read at the top
**Then** there's a clear "When to run this" preamble: "Run this drill once per scoring device per Event, BEFORE the Event starts. A successful drill clears the NFR-R2 gate for that device. Devices failing steps 4–7 are BLOCKED from scoring at that Event; either fix the issue OR transfer the scorer assignment to a verified device via T5-7's `/scorer-assignments/transfer` endpoint."

**AC-8 — Test coverage (just the strengthened 409 test).**
**Given** `pnpm --filter @tournament/api test` after AC-1 + AC-2 changes
**When** run
**Then** the existing `409 hole_already_scored: different clientEventId at same cell` test passes WITH the new first-writer-wins + no-extra-audit assertions. All other existing tests in the file (the 537+ T5-6 tests + 20 T5-8 tests + 22 T5-9 tests) continue to pass unchanged.

## Tasks / Subtasks

- [ ] **Task 1: Strengthen the existing 409 test.**
  - File: `apps/tournament-api/src/routes/scores.integration.test.ts` (existing).
  - Modify the `409 hole_already_scored: different clientEventId at same cell` test (currently lines 341–366) by appending the AC-1 + AC-2 assertions after the existing `body.conflictingEntry!.client_event_id` assertion.

- [ ] **Task 2: Create the drill checklist markdown.**
  - File: `apps/tournament-web/src/scripts/drill-offline-scorer.md` (NEW; creates the `scripts/` directory).
  - Write per AC-4 + AC-5 + AC-6 + AC-7 — a single self-contained Markdown document with: preamble, 7 numbered steps, drill-record block at the bottom.
  - No code blocks except for shell snippets (e.g., `git rev-parse HEAD`).
  - Plain English at every step; the audience is a scorer reading on a laptop while drilling on a phone.

- [ ] **Task 3: Run regression test pass.** All existing suites stay green; tournament-api test count unchanged (the 409 test gets stronger assertions but no new test cases). Typecheck + lint clean.

## Dev Notes

### Project Structure Notes

- **`apps/tournament-web/src/scripts/`** is a new directory. v1 has only this one file in it. Future drill / one-off scripts can live here.
- **`reference/drills/`** is OUT OF SCOPE for this story. It will be created the first time someone runs a drill and tries to file the record. That commit will need SHARED-path approval (root-level new directory).
- **The 409 test strengthening is additive** — no existing assertions are removed or weakened.

### References

- Epic spec: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` lines 1590–1627 (T5.10)
- T5-6 score POST + 409 + dedupe behavior: `apps/tournament-api/src/routes/scores.ts` (POST handler with `onConflictDoNothing` + 409 path)
- T5-6 existing tests being strengthened: `apps/tournament-api/src/routes/scores.integration.test.ts:299-339` (dedupe; no changes needed) and `:341-366` (409; AC-1 + AC-2 add assertions here)
- T5-3 offline queue (drained by drill step 6): `apps/tournament-web/src/lib/offline-queue.ts`
- T5-4 scorecard shell cache (verified by drill step 2): `apps/tournament-web/src/lib/round-cache.ts`
- T5-5 leaderboard (verified by drill step 6 second-device check): `apps/tournament-api/src/services/leaderboard.ts`
- NFR-R2 (offline-merge correctness gate) + NFR-P2 (30s propagation envelope): `_bmad-output/planning-artifacts/tournament/prd.md`
- T9.4 per-device drill cross-reference: 2026-04-26 memory entry mentions this gate.

### Risks / Followups

- **Followup T5-10a: `reference/drills/` directory creation.** First drill run will create `reference/drills/<eventId>/<deviceLabel>.md`. That's a root-level path → SHARED → needs explicit per-commit approval at the time. Tracked here so the first drill executor knows to surface the gate.
- **Followup T5-10b: Audit verify endpoint for drill step 7.** Step 7 currently says "query audit_log manually via Hostinger Browser Terminal OR via a temporary admin endpoint". v1.5 enhancement: ship a small admin-gated `GET /api/admin/audit-log?roundId=<id>&eventType=score.committed` endpoint that returns the count, so drillers don't need SSH/SQLite access. Out of v1 scope.
- **Followup T5-10c: Drill record auto-archiver.** v1.5: a small CLI in `apps/tournament-web/src/scripts/` that takes the executor's filled-in markdown via stdin and creates `reference/drills/<eventId>/<deviceLabel>.md` with proper formatting. Removes the "did you remember to commit the drill record" footgun.
- **Followup T5-10d: Cellular-vs-wifi gotcha note.** AC-5 step 3 mentions "iOS airplane button vs cellular-off" because turning ONLY cellular off keeps wifi alive on some configurations, defeating the offline test. v1 documents this in the step. v1.5 could add a screenshot.
- **Followup T5-10e: Android drill validation.** v1 explicitly only validates iOS Safari (Pinehurst-trip device roster is all iOS). When the Thursday-night league rolls in (post-Pinehurst), an Android-equivalent drill needs to be added. The 7 steps are mostly transferable; PWA install path differs (Chrome's "Install app" prompt vs. iOS Safari "Add to Home Screen").
- **Risk: drill is per-device AND pre-trip; getting all scorer devices through this is a coordination cost.** Mitigated by T7-1 (event home page) eventually surfacing per-device drill status. v1 ships the procedure; coordination is on the organizer.

## Files this story will edit

- apps/tournament-api/src/routes/scores.integration.test.ts
- apps/tournament-web/src/scripts/drill-offline-scorer.md

Additional files MAY be added during implementation only under `apps/tournament-*/**` and MUST be appended to this list before commit. Any path outside this set or outside `apps/tournament-*/**` requires re-running the spec gate.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (acting as tournament-director driving dev-story per workflow-tournament.yaml).

### Debug Log References

(to be populated during implementation)

### Completion Notes List

(to be populated during implementation)

### File List

(to be populated during implementation)
