# T5-3 Party-Mode Review (non-interactive written)

**Story:** T5-3 — Offline Queue (IndexedDB) with clientEventId Idempotency [port].
**Status:** review
**Generated:** 2026-04-28
**Mode:** Single written review across 5 disciplinary perspectives. No interactive elicitation. No open questions to user.

---

## 📊 Mary (Analyst) — Strategic / Threat-Model Perspective

T5-3 is the **offline-resilience floor** for the entire scoring epic. Without it, score entry on Pinehurst's dead-cell zones (Tobacco Road, Mid Pines back nine, Pinehurst No. 2 16-17) would either fail silently or duplicate writes when service blinks. T5-3's job: make offline-then-online transparent + idempotent.

**Threat model — five surfaces:**

1. **Idempotent replay** (`clientEventId` UUID v4). The most important load-bearing property. T5-3 enforces caller-supplied UUIDs, persists them on every entry, and never regenerates across retries. The server (T5.6) will dedupe via T5-1's UNIQUE on `(round_id, player_id, hole_number, client_event_id)`. **Verified end-to-end by the dual-UNIQUE tests in T5-1's `scoring.test.ts` (Tests 4a/4b/4c) that pinned the dedupe path.** T5-3 is the client half of that contract; T5-1 was the server half. Clean.

2. **Conflict surfacing without data loss** (409 retention). The most user-visible failure mode: two scorers scored the same cell, one's write hits first, the second's write 409s. T5-3 retains the entry, sets `conflictPending=true`, fires `tournament-offline-queue-conflict` CustomEvent. The UI (T5.10's airplane-mode drill + T5-2's scorer entry) handles the prompt. **`resolveConflict` is overloaded so 'discard' is no-args clean and 'overwrite' takes a caller-supplied body verbatim** — T5.10 owns the wire shape; T5-3 stays decoupled.

3. **Universal failsafe** (MAX_TRANSIENT_RETRIES=5). Critical safety net. A consumer that forgets to register terminal error codes for its kind would otherwise pile up entries forever on a deterministic 4xx. After 5 transient-4xx retries, the entry is purged and `tournament-offline-queue-failsafe-purged` fires. **5xx + network are exempt** (genuinely transient; should retry indefinitely; setTimeout heartbeat handles the "online but server down" case). The threshold (5) is conservative — fast enough to surface bugs, slow enough to absorb legitimate flakes.

4. **Corrupted-entry quarantine**. A row with `url: 123` (non-string) or circular-ref body or `kind: 'wolf_decision'` (legacy) gets atomically moved to `mutation-queue-errored` BEFORE any fetch attempt. **Round-3 + round-4 impl-codex passes hardened the type checks**: `typeof url !== 'string'`, `typeof clientEventId !== 'string'`, `!isValidKind(kind)`, `serializedBody === null` (catches both throw-cases AND silent-undefined-cases of JSON.stringify). The drain CONTINUES past the bad row — no single corrupt entry can block the queue.

5. **Stalled-drain failure mode** (the most subtle). Codex round-2 spec review caught a real bug: BREAK on transient 4xx while still online → drain never re-fires until next 'online' event → stuck. The fix: transient 4xx CONTINUEs (the server is reachable; entry N+1 may be unrelated); only 5xx + network BREAK. AND the BREAK path schedules a `setTimeout(drain, 30s)` heartbeat with `clearTimeout` before each new schedule (no stacked timers) and `useEffect` cleanup on unmount. Belt + suspenders against the stuck-queue scenario.

**Strategic significance:** T5-3 is the trip-day insurance policy. Pinehurst's foursomes at Tobacco Road will have intermittent 5G; the queue absorbs that without the scorer noticing. T5-2 (the UI) will be a thin shell over T5-3's primitives.

**Recommendation: ship.** No commit-blocking concerns.

---

## 🏗️ Winston (Architect) — System Design Perspective

Eight observations:

1. **Kind-agnostic dispatch.** The drain is generic — `fetch(entry.url, { method: 'POST', body: serializedBody })` — instead of switch-on-shape. Each entry carries a `{ url, body }` triple set at enqueue time; the queue lib is decoupled from any specific endpoint. **Cleaner than Wolf Cup's pattern** (which hardcoded score+wolf-decision endpoint shapes inside the drain). New kinds (T5.7 scorer_handoff, T5.8 round_finalize, T6 sub_game_result) don't require drain changes — they just enqueue with their own `{url, body}`.

2. **Per-kind terminal-error registry.** Module-global `Map<MutationKind, ReadonlyArray<string>>`. Consumers register at init via `registerTerminalErrors('hole_score', ['ROUND_FINALIZED', ...])`. Round-2 impl fix snapshots the array via `Object.freeze([...codes])` so caller mutation can't reshape registry state. **Decoupling is right** — T5-3 doesn't know what 'hole_score' specifically means, just that some kinds have allowlists.

3. **Universal failsafe.** Codex flagged the original "consumer forgot to register → entries pile up forever" concern. Fix: `MAX_TRANSIENT_RETRIES=5` constant; on each transient 4xx, increment retryCount, then check `>= MAX_TRANSIENT_RETRIES` → purge + fire `tournament-offline-queue-failsafe-purged`. **Catches the failure mode without coupling to consumer-specific knowledge.** The threshold is exported as a module constant (consumers can import it for tests but can't override it — by design).

4. **Single-flight drain lock + setTimeout heartbeat.** The lock (`isDrainingRef`) prevents re-entry if `'online'` fires while a drain is in-flight. The heartbeat (`heartbeatTimerRef.current`) re-fires drain after 30s of network stall. **`clearTimeout` is called BEFORE every new schedule** (not just on success) — back-to-back failures NEVER stack timers. Cleanup on unmount via useEffect cleanup. The dependency list of the wiring effect includes `roundId` so a re-mount with a different round can't fire a stale-roundId drain. **Robust pattern.**

5. **Atomic quarantine.** `quarantineEntry()` opens a single readwrite transaction over BOTH `mutation-queue` and `mutation-queue-errored` stores; reads from source, deletes from source, adds to errored. The whole operation commits-or-rolls-back atomically. **Right.**

6. **CustomEvent for downstream signals.** `tournament-offline-queue-conflict` (409 retention) and `tournament-offline-queue-failsafe-purged` (failsafe trip). Consumers listen via `window.addEventListener`. **Correct choice over a callback registry** — the queue is a global resource; pub-sub via window events is the lowest-coupling integration.

7. **Test-only exports** (`_resetDbForTests`, `_resetTerminalErrorsForTests`). Both are runtime-guarded against production use: first checks `typeof process === 'undefined'` (browser bundle) → throws; then checks `NODE_ENV === 'test'` OR `VITEST === 'true'` → throws if neither. **The leading underscore is the API-style discouragement; the runtime guard is the actual enforcement.** Defensive depth: even if a future consumer gets clever and tree-shakes around the underscore convention, the runtime guard fires.

8. **Wolf Cup port faithfulness vs. tournament-domain reshaping.** The lib drops `groupId`, `wolfDecision`, `autoCalculateMoney`, `entryCode` (all Wolf Cup-specific). Adds `kind`, `clientEventId`, `url`, `body`, `conflictPending`, `lastError`, `retryCount`. Drops the `ctp-queue` store entirely. PORTS.md row documents every delta with rationale. **The port is not a verbatim copy — it's a structural translation, and the documentation makes that clear.** Future "re-sync against upstream" reviews have a clean baseline.

**Architectural concerns: zero blockers.** The dual-UNIQUE-on-server (T5-1) + caller-supplied-clientEventId-on-client (T5-3) idempotency pair is the load-bearing correctness model and it's pinned by tests on both sides.

**Recommendation: ship.**

---

## 📋 John (PM) — User Value / Scope Perspective

**Does T5-3 satisfy the offline-resilience contract?** Yes. The library + 2 hooks ship the primitives downstream stories need:

- T5-2 (scorer entry UI) — calls `enqueueMutation({ kind: 'hole_score', url, body, clientEventId, roundId })` on Save. Will register terminal errors for `'hole_score'`.
- T5-7 (scorer handoff) — calls `enqueueMutation({ kind: 'scorer_handoff', ... })`.
- T5-8 (round lifecycle) — calls `enqueueMutation({ kind: 'round_finalize', ... })`.
- T5.10 (airplane-mode drill) — exercises the full enqueue → offline → reconnect → drain → 409 → resolveConflict('overwrite', body) → re-drain → 200 flow end-to-end.
- T6 (rules engine) — calls `enqueueMutation({ kind: 'sub_game_result', ... })`.

**Every downstream consumer has the primitive it needs.** No "we'll add a hook later" deferrals.

**Scope discipline check:**
- 7 NEW src/test files in `apps/tournament-web/src/`
- 1 NEW `apps/tournament-web/PORTS.md`
- 1 modified `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml`
- 1 NEW spec + 8 NEW codex review reports under `_bmad-output/`
- 2 SHARED files (approved this story): `apps/tournament-web/package.json` + `pnpm-lock.yaml` (added `fake-indexeddb` v6.2.5 as devDep)
- 0 FORBIDDEN edits.

**Path footprint is clean.**

**v1 limitations** (acceptable):
- ZERO consumers wired in T5-3 — the library is shipped without callers; T5-2 + T5-7 + T5-8 + T6 wire later.
- The `mutation-queue-errored` store has no UI v1 — quarantined entries are invisible to users; future story can add an admin "view errored entries" page.
- The setTimeout heartbeat is verified by code review + integration testing in T5.10 (NOT by a unit test in T5-3, due to React 19 + fake-timer act-hang interactions).
- `resolveConflict('overwrite')` requires the caller to supply the body verbatim — T5.10 owns the wire shape decision.

**Test surface: 23 new tests** (10 lib + 8 hook + 1 status + 4 added in impl-codex rounds). Tournament-web 55 → 78 (+23; AC #7 floor +14, margin +9).

**Recommendation: ship.**

---

## 🧪 Quinn (QA) — Test Coverage / Pragmatic Check

**Test deltas:**
- tournament-web: 55 → 78 (+23). AC #7 floor was +14. Margin: +9.
- tournament-api: 466 (unchanged — backend untouched).
- Wolf Cup engine: 472 (unchanged).
- Wolf Cup api: 507 (unchanged).
- typecheck + lint clean across all 5 workspaces.

**`offline-queue.test.ts` coverage** (12 tests):

| Surface | Test | Pin? |
|---|---|---|
| FIFO order | 3 enqueues → getQueue returns id ASC | ✅ |
| Validation | enqueue rejects empty clientEventId | ✅ load-bearing |
| Validation | enqueue rejects invalid kind | ✅ load-bearing |
| Validation | enqueue rejects empty url | ✅ |
| Validation | enqueue rejects undefined body | ✅ |
| Validation | resolveConflict('overwrite') rejects undefined body | ✅ (added impl-round-1) |
| getQueueCount | Scoped by roundId | ✅ |
| purgeOrphanedEntries | Removes other-round entries; returns count | ✅ |
| quarantineEntry | Atomic move proven via raw IDB count | ✅ load-bearing |
| resolveConflict | 'discard' purges | ✅ |
| resolveConflict | 'overwrite' replaces body, clears conflictPending, resets retryCount | ✅ load-bearing |
| Terminal-error registry | Round-trip per-kind, re-register replaces | ✅ |
| Terminal-error registry | Snapshot semantics (caller mutation doesn't affect registry) | ✅ (added impl-round-2) |
| removeFromQueue | Removes by id | ✅ |

**`useOfflineQueue.test.tsx` coverage** (8 tests):

| Surface | Test | Pin? |
|---|---|---|
| 200 happy path | Entry purged + pendingCount=0 | ✅ |
| 409 retention | Entry retained + CustomEvent fires + drain CONTINUES | ✅ **load-bearing** |
| Transient 4xx CONTINUE | Entries 2-3 POSTed; entry 1 retryCount=1 | ✅ **load-bearing** |
| 5xx BREAK | Entry 1 attempted; 2-3 NOT POSTed; retryCount NOT incremented | ✅ **load-bearing** |
| Universal failsafe | 5x4xx → 5th attempt purges + failsafe-purged event | ✅ **load-bearing** |
| Terminal-error registry | Registered code → entry purged on first 4xx (no retryCount) | ✅ |
| Auto-drain on online event | Dispatched 'online' triggers drain | ✅ (added impl-round-1) |
| Corrupted-entry quarantine | Entry with missing kind → atomic move to errored store | ✅ (added impl-round-1) |

**`useOnlineStatus.test.tsx` coverage** (1 test):
- True initially; flips on offline event; flips back on online event. ✅

**Coverage gaps** (Lows; documented as v1.5 followups):

1. **setTimeout heartbeat firing** — the test that verified `vi.advanceTimersByTimeAsync(30_000)` triggered the next drain hangs due to React 19 + fake-timer + act interactions. The heartbeat behavior is verified by code review (clearTimeout-before-set; cleanup-on-unmount; ref-pattern) and will be exercised end-to-end in T5.10. **Documented in the spec's AC #7 + the impl notes.**

2. **`resolveConflict('overwrite')` wire-shape** — the test passes a synthetic `{ fresh: true, ts: 999 }` body; T5.10's actual body wire shape is unknown until that story specs it. T5-3's contract (replace body verbatim) is pinned; T5.10 will add the wire-shape integration test.

3. **JSON.stringify silent-undefined corner case** — round-4 impl-codex flagged that top-level functions/symbols return undefined from JSON.stringify (no throw). The fix coerces undefined → null → quarantine. **No test pins this** because constructing a top-level-function entry-body in a test would itself fail at IDB write (structured clone rejects functions); the round-4 fix is a defense-in-depth guard.

**Net assessment:** the tests pin **all the correctness paths that matter for trip-day** including the four codex-flagged Highs (clientEventId who-generates, terminal-error from response.body.code, resolveConflict overload, drain-stall-on-online). Coverage gaps are bounded; the load-bearing surface is verified.

**Recommendation: ship.** Optional follow-up: T5.10's airplane-mode drill will provide end-to-end verification of the heartbeat + conflict-overwrite paths.

---

## 💻 Amelia (Dev) — Code Quality Perspective

Citing file paths + impl-codex iteration evidence.

**`offline-queue.ts`** (302 lines) — provenance header at L1-15 (greenfield-with-port disclosure: ported from Wolf Cup `apps/web/src/lib/offline-queue.ts` @ commit ddf921b29afe9b6b50a1f136021502770b180e65). 11 changes across 4 impl-codex rounds — all sharpening, no schema redesigns.
- L18-32: `MutationKind` discriminated union + `VALID_KINDS_INTERNAL` Set + `isValidKind` predicate (round-3 fix: previously was an exported Set, now module-private + readonly predicate to prevent consumer mutation).
- L34-58: `MutationEntry` interface with `id`, `kind`, `url`, `body`, `clientEventId`, `roundId`, `timestamp`, `retryCount`, `conflictPending?`, `lastError?`. `MAX_TRANSIENT_RETRIES = 5` exported module constant.
- L65-97: DB singleton with `getDB()`. Two object stores: `mutation-queue` + `mutation-queue-errored`. `_resetDbForTests` is async + closes the open IDB before nulling the promise (round-1 impl fix; previously hung beforeEach).
- L102-121: `registerTerminalErrors` (snapshot via `Object.freeze([...codes])` per round-1 impl fix) + `getTerminalErrors` + `_resetTerminalErrorsForTests`. Both test-only exports have `typeof process === 'undefined'` runtime guard before checking `NODE_ENV`/`VITEST` (round-1 fix; previously would ReferenceError in browser bundle).
- L138-167: `enqueueMutation` rejects on empty clientEventId, invalid kind, empty url, undefined body. Uses `isValidKind`.
- L172-195: `getQueue`, `removeFromQueue`, `getQueueCount`, `updateEntry`. Clean.
- L200-218: `quarantineEntry` — single readwrite tx over both stores, atomic move.
- L223-262: `resolveConflict` overloaded ('discard' | 'overwrite'+body). 'overwrite' rejects undefined body (round-1 impl fix).
- L267-283: `purgeOrphanedEntries`.

**`useOfflineQueue.ts`** (260 lines) — provenance header at L1-13. The drain function is the most complex surface; refactored across 4 codex rounds.
- L17-26: Imports including `isValidKind` (round-3 fix).
- L46-66: hook state (`pendingCount`, `isDraining`, `drainError`) + refs (`isDrainingRef`, `heartbeatTimerRef`).
- L73-83: `clearHeartbeat` helper.
- L88-189: `drain` — reads queue, iterates, applies semantics:
  - L94-102: id-missing skip (defensive — IDB invariant says id is always set, but if not, can't quarantine without it).
  - L106-130: pre-fetch validation including pre-serialize-body in try/catch (round-3 + round-4 hardening).
  - L132-145: fetch with the pre-serialized body; network/TypeError → BREAK + needsHeartbeat.
  - L150-165: conditional response.json() parse — only when status != 204 + content-type=json + try/catch fallback.
  - L168-177: 200/2xx → purge + decrement.
  - L180-193: 409 → updateEntry + CustomEvent + continue.
  - L196-228: 4xx classifier — terminal allowlist or universal failsafe.
  - L230-233: 5xx → BREAK + needsHeartbeat.
- L242-249: heartbeat scheduling outside the lock, `clearHeartbeat` BEFORE every new `setTimeout` so back-to-back failures never stack timers.
- L256-272: cleanup useEffect — removes 'online' listener AND clears heartbeat timer on unmount.

**`useOnlineStatus.ts`** (34 lines) — thin port; SSR-safe initializer (`typeof navigator === 'undefined'` falls back to true).

**Tests** — 21 in T5-3 + 1 in useOnlineStatus = 22. The corrupted-entry quarantine test seeds raw IDB to bypass enqueue's validation — necessary for testing the drain-side malformed-entry guard.

**`PORTS.md`** — 3 rows documenting deltas vs Wolf Cup. First port-tracker entry for tournament-web.

**Lint + typecheck:** clean across all workspaces. No `any`. No `// eslint-disable` (one `// eslint-disable-next-line no-console` for the defensive id-missing warn — justified).

**DRY / idiomatic concerns:**
1. The `entry()`/`baseEntry()` helper in test files is duplicated. Could be promoted to a shared `_test-helpers.ts` someday. Not a T5-3 concern.
2. The `isConstraintError` helper from tournament-api's schema tests doesn't apply here (different testing surface — fetch mocks, not SQLite errors).
3. Wolf Cup's offline queue had ~190 lines doing similar work; tournament's 302 lines reflects the additional safety surface (typed kind discriminator, dual UNIQUE retention semantics, generic dispatch, runtime-guarded test exports). **Reasonable growth for a more rigorous contract.**

**Recommendation: ship.**

---

## 🎯 Synthesis Verdict

**SHIP.**

All five perspectives converge. Spec-codex 4 rounds (AI-1 cap, all FIXED). Impl-codex 4 rounds (AI-1 cap, all FIXED). Test deltas exceed AC floors (+23 vs +14 floor; margin +9). Path footprint: ALLOWED + 2 SHARED (approved this story). Wolf Cup regressions clean (engine 472, api 507, web has no test script).

**Load-bearing correctness:**
1. **Caller-supplied clientEventId** — T5-3's enqueue rejects empty/missing; pinned by 2 tests.
2. **Generic kind-agnostic drain** — fetch(entry.url, ...) with pre-serialized body; defense-in-depth against late-stage TypeErrors.
3. **Per-kind terminal-error registry** — module-global Map, snapshot-frozen on register, consumed by drain on every 4xx.
4. **Universal failsafe at 5 retries** — codex-mandated guard against consumer-misregistration; pinned by load-bearing test.
5. **Conditional response.json() parse** — guards against 204/non-JSON crashes that would otherwise hang the queue.
6. **5xx/network → BREAK + setTimeout heartbeat** — clearTimeout-before-set prevents stacking; useEffect cleanup prevents post-unmount leaks.
7. **409 retention + CustomEvent + drain CONTINUES** — entry held with `conflictPending`, T5.10's UI handles via `resolveConflict('overwrite', body)`.
8. **Atomic quarantine** — single readwrite tx over both stores; type-tight malformed checks defend against corrupted IDB rows.
9. **Wolf Cup port faithfulness** — 11 documented deltas in `apps/tournament-web/PORTS.md`; future re-sync reviews have a clean baseline.

**Documented limitations (followups):**
- Heartbeat firing test relies on integration coverage at T5.10 (React 19 + fake-timer act hang prevented unit-level pin).
- `mutation-queue-errored` store has no UI v1.
- Top-level function/symbol body is defended against but not unit-tested (IDB structured clone would reject before quarantine path fires).

**Followups (other stories):**
- T5-2 (scorer entry UI) is the first consumer; will register `'hole_score'` terminal errors at init.
- T5-7 wires `'scorer_handoff'`.
- T5-8 wires `'round_finalize'`.
- T6 wires `'sub_game_result'`.
- T5-10 (airplane-mode drill) is the integration test that exercises enqueue → offline → reconnect → 409 → resolveConflict → 200 against a real backend.

**Manual verification post-commit (optional, NOT a release gate):**
1. On Josh's local dev: open the dev server, open DevTools → Application → IndexedDB; verify `tournament-offline` DB exists with `mutation-queue` and `mutation-queue-errored` stores. (No data yet — UI consumers haven't shipped.)
2. After T5-2 lands, smoke-test enqueue → reconnect → drain in DevTools' Network → Offline mode.

**Epic T5 progress: 2/11 done (T5-1 + T5-3).** Per Josh's option-A sequencing, T5-6 (scorer-gate middleware) is next, then T5-2 (scorer entry UI port).

**The director workflow can proceed to commit.**
