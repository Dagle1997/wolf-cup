# T5-3: Offline Queue (IndexedDB) with clientEventId Idempotency [port]

## Status

Ready for Dev

## Story

As a scorer,
I want an IndexedDB offline queue ported from Wolf Cup,
So that score entry continues uninterrupted in dead-cell zones at Tobacco Road / Mid Pines / Pinehurst No. 2 (NFR-R1 / NFR-R2 / FR-B3).

T5-3 ports the **library** (the IndexedDB queue + connectivity hook + drain hook) from Wolf Cup. It does NOT wire any UI consumer (T5-2 owns that) and does NOT call any production endpoint that needs to exist (the drain function calls a generic `enqueueMutation` shape; consumers attach kind-specific endpoint logic). Tests cover the queue's correctness primitives without requiring live endpoints.

T5-3 is invoked by Josh's Option-A sequencing call: T5-3 (this) → T5-6 (scorer-gate middleware) → T5-2 (UI port). T5-3's queue is the dependency T5-2's `enqueueMutation()` calls satisfy.

## Risk Acceptance (announce up-front so the user sees the full scope at the spec gate)

### 1. Path footprint — ALLOWED only, ZERO SHARED, ZERO FORBIDDEN

This story touches:

- `apps/tournament-web/src/lib/offline-queue.ts` — NEW (port from Wolf Cup `apps/web/src/lib/offline-queue.ts` @ commit `ddf921b29afe9b6b50a1f136021502770b180e65`, dated 2026-04-27)
- `apps/tournament-web/src/lib/offline-queue.test.ts` — NEW (unit tests against `fake-indexeddb` — already-installed dev dep? if not, see SHARED-gate trigger below)
- `apps/tournament-web/src/hooks/useOfflineQueue.ts` — NEW (port from Wolf Cup `apps/web/src/hooks/useOfflineQueue.ts`)
- `apps/tournament-web/src/hooks/useOfflineQueue.test.tsx` — NEW (component-test using `@testing-library/react` + a fake-indexeddb-backed store + `vi.mock` of `fetch`)
- `apps/tournament-web/src/hooks/useOnlineStatus.ts` — NEW (port from Wolf Cup `apps/web/src/hooks/useOnlineStatus.ts` — small, ~28 lines)
- `apps/tournament-web/src/hooks/useOnlineStatus.test.tsx` — NEW
- `apps/tournament-web/PORTS.md` — NEW (file does not yet exist for tournament-web — first port-tracker entry)

**Zero SHARED files expected.** `idb` (v8.0.3) and `@tanstack/react-query` (v5.90.21) are already in `apps/tournament-web/package.json` (verified). `@testing-library/react` (v16.3.2) is already a dev dep.

**Possible SHARED-gate trigger (single point of uncertainty)**: `fake-indexeddb` (or `idb-mock`) is the standard test-time IndexedDB stub for jsdom. **CHECK** at impl-step-1: if `fake-indexeddb` is NOT in dev deps, this is a SHARED-gate (root pnpm-lock.yaml + tournament-web package.json edit); STOP for Josh's approval at that point. Likely outcome: it IS already pulled in transitively or via Wolf Cup's apps/web, but the dev MUST verify before proceeding past impl-step-1.

**Zero FORBIDDEN edits.** No `apps/api/**`, `apps/web/**`, `packages/engine/**`.

### 2. Wolf Cup port deltas (epic AC line 1336-1340 + extras forced by tournament's domain model)

Per epic AC line 1336-1340, the deltas are:
- (a) IndexedDB DB name: `wolf-cup-offline` → `tournament-offline`
- (b) Entry payload no longer carries `wolfDecision`; carries `clientEventId: string` (UUID v4) on every entry
- (c) Entry payload kinds restricted to v1 scope: `'hole_score'`, `'sub_game_result'`, `'scorer_handoff'`, `'round_finalize'`. No wolf / greenie / polie / sandie / CTP kinds.

**Additional deltas T5-3 must apply** (not in epic AC line 1336-1340 but forced by tournament's domain shape):

- (d) **Drop `groupId`** from queue entries: tournament uses `pairings → pairing_members` for foursome context (T4-2), not a `groups` table tied to scoring. The queue keys on `roundId` only.
- (e) **Drop `entryCode` header**: tournament uses session-cookie auth (T1-6a `requireSession` middleware) — no per-round entry code. Queue entries carry NO auth metadata; the drain just `fetch()`s and the browser sends the session cookie automatically.
- (f) **Drop the entire CTP-queue store** (`ctp-queue` object store + all `enqueueCtpEntry` / `getCtpQueue` / `removeCtpFromQueue` / `getCtpQueueCount` functions): CTP is a Wolf Cup-only sub-game, NOT in v1 tournament scope. The DB schema becomes single-store: one `mutation-queue` object store.
- (g) **Object store rename**: `score-queue` → `mutation-queue` (since v1 carries 4 kinds, not just scores).
- (h) **Discriminated-union `kind` field** on every entry: `kind: 'hole_score' | 'sub_game_result' | 'scorer_handoff' | 'round_finalize'`. Other kinds rejected at the type layer (TypeScript discriminated union) AND at the runtime `enqueueMutation()` entry guard (defensive; the type system is the primary enforcer).
- (i) **Endpoint URL + body shape live INSIDE the entry**, not derived from the kind by the drain function: each entry carries a complete `{ url: string; body: unknown; kind: ... }` triple. The drain function is generic — it `fetch(entry.url, { method: 'POST', body: JSON.stringify(entry.body), credentials: 'include' })` and that's it. Reasoning: avoids coupling the queue library to a switch-on-kind that needs updating every time T5-7/T5-8/T5-9 ships a new endpoint; consumers (T5-2 for hole_score; T5-7 for scorer_handoff; T5-8 for round_finalize; T6 for sub_game_result) own the URL+body shape they enqueue.
- (j) **Drain on response 409 retains the entry + emits a CustomEvent** `new CustomEvent('tournament-offline-queue-conflict', { detail: { entryId, clientEventId, kind, response: { status, body } } })` on `window`. The UI (T5-2 / T5.10) listens via `window.addEventListener('tournament-offline-queue-conflict', (e: Event) => { const detail = (e as CustomEvent).detail; ... })` and shows the D3-3 overwrite prompt. T5-3 does NOT ship the prompt UI — just the event signal.
- (k) **Terminal-error classification list is parameterized by kind**: each kind has its own terminal-error allowlist that the drain consults. Default = empty allowlist (no per-kind classification). T5-2 / T5-7 / T5-8 / T5-9 will register their kind's terminal errors at consumer-init time via `registerTerminalErrors(kind, codes: string[])`. T5-3 ships the registry mechanism + an empty default. **The drain reads the response body's `code` field** (parsed as JSON; the response is expected to be `application/json` from the tournament-api `errorResponse()` helper which always emits `{ error, code, requestId }`). On a 4xx response: if `body.code` is in `getTerminalErrors(entry.kind)` → purge entry; otherwise apply the universal-failsafe rule (see (l) below).
- (l) **Universal failsafe to prevent infinite-retry queue lockup**: the drain tracks per-entry `retryCount` (persisted on the entry row, incremented ONLY on transient 4xx — i.e., a 4xx response that did NOT match the per-kind terminal allowlist). On every transient 4xx: `retryCount += 1`, then check `if (retryCount >= MAX_TRANSIENT_RETRIES)` (default `5`, exported as a module constant `MAX_TRANSIENT_RETRIES`). If TRUE, the entry is purged on THIS cycle (no need for one more attempt): `removeFromQueue(entry.id)`, decrement `pendingCount`, fire `new CustomEvent('tournament-offline-queue-failsafe-purged', { detail: { entryId, clientEventId, kind, retryCount, lastError } })` on `window`. Concretely: with `MAX_TRANSIENT_RETRIES=5`, a deterministic transient 4xx is purged on its **5th** drain attempt (counts: 0→1, 1→2, 2→3, 3→4, 4→5 → `5 >= 5` → purge). **5xx, network failures, and 409 do NOT increment `retryCount`** (5xx/network are genuinely transient and retry indefinitely; 409 is a user-decision hold). Rationale: a deterministic 4xx that the consumer forgot to register would otherwise pile up entries forever (codex round-1 risk). The threshold is conservative — bounded retry budget for client-misconfigured 4xx without flapping on legit transient outages.

### 3. Drain semantics + foreground-sync timing

Per Wolf Cup's pattern + epic AC line 1342-1344:
- Drain triggers on `window` `'online'` event AND on explicit `drain()` calls from `useOfflineQueue`'s consumer.
- FIFO order by entry `id` (auto-increment IDB key) — NOT by holeNumber (Wolf Cup ordered by hole; tournament keeps insertion order since the queue carries 4 kinds, not just scores; drain order matters less than dedupe).
- Per-entry try/catch: terminal error → purge entry; transient error → break loop, retry on next drain.
- Single in-flight drain via `isDrainingRef` lock (prevents double-fire on rapid `'online'` flaps).

### 4. Idempotency contract

Every entry carries a `clientEventId: string` (UUID v4). **The CALLER generates the UUID** (e.g., T5-2's UI calls `crypto.randomUUID()` at user-tap time and includes it in BOTH the enqueue entry AND the body field that maps to T5-1's `hole_scores.client_event_id` schema column). T5-3's `enqueueMutation` REQUIRES `clientEventId` as a non-optional parameter; passing an empty string or undefined throws `Error('enqueueMutation: clientEventId is required (caller-supplied UUID v4)')`.

T5-3's responsibility: validate that `clientEventId` is non-empty at enqueue time, persist it on the entry row, and ensure it's NOT regenerated across retries (the entry row's clientEventId is byte-stable from enqueue through every drain attempt). The caller-generated invariant means a SINGLE user tap → SINGLE clientEventId regardless of how many drain retries occur.

The server (T5.6 for hole_score) handles dedupe via T5-1's UNIQUE index on `(round_id, player_id, hole_number, client_event_id)`.

### 5. 409 retention

When the drain receives a 409 response (T5.6 will emit this for `hole_scores` cell collisions per T5-1's dual-UNIQUE), the entry is RETAINED in the queue (not purged), `entry.conflictPending = true` is set on the row, and the `tournament-offline-queue-conflict` CustomEvent (per (j) above) fires on `window`. The UI (T5-2 / T5.10) handles the prompt. Until the UI tells the queue what to do via `resolveConflict()`, the entry stays in the queue and the drain SKIPS it on subsequent passes (the `conflictPending` flag is the skip predicate).

**`resolveConflict(id: number, action: 'discard'): Promise<void>`** — purges the entry. Pure cleanup; no body mutation.

**`resolveConflict(id: number, action: 'overwrite', overwriteBody: unknown): Promise<void>`** — REPLACES the entry's `body` with the caller-supplied `overwriteBody` verbatim (whatever the consumer's UI built; T5.10's API contract specifies the wire shape for the overwrite endpoint), clears `conflictPending`, resets `retryCount = 0`, and the next drain pass re-attempts. **The CALLER (T5.10's UI) constructs the overwrite body**; T5-3 does NOT mutate the body itself (no field-name coupling between the queue lib and any consumer). This dodges the codex round-1 [HIGH] body-mutation contract concern: T5-3's `resolveConflict('overwrite', ...)` is a pure body-replacement primitive; whatever wire-shape T5.10 picks is the caller's responsibility.

TypeScript form: `resolveConflict` is overloaded:
```ts
function resolveConflict(id: number, action: 'discard'): Promise<void>;
function resolveConflict(id: number, action: 'overwrite', overwriteBody: unknown): Promise<void>;
```

T5-3 ships the conflict-retention path + `resolveConflict()` API + the event emission. T5.10 (airplane-mode drill) tests the full enqueue → 409 → resolveConflict('overwrite', body) → re-drain → 200 flow end-to-end.

### 6. Corrupted-entry quarantine

If an entry in IDB has a malformed shape (e.g., missing `url`, missing `kind`, missing `clientEventId`), the drain MOVES it to a separate `mutation-queue-errored` store rather than retrying or purging. This is the "we don't know what to do with this" bucket; v1 has no UI for inspecting it (a future story can add an admin page).

### 7. Connectivity hook

`useOnlineStatus()` is a thin wrapper over `navigator.onLine` + `window.addEventListener('online'|'offline', ...)`. Wolf Cup version is 28 lines; T5-3's port is identical save for the same name + module location.

### 8. ZERO consumers wired in T5-3

T5-3 is a LIBRARY port. NO route, NO middleware, NO mounted UI. The queue's only callers post-T5-3 are:
- T5-2 (scorer entry UI) — calls `enqueueMutation({ kind: 'hole_score', url, body, clientEventId })` on Save.
- T5-7 (scorer handoff endpoint) — owns its own `'scorer_handoff'` enqueues from the handoff UI (a future micro-story).
- T5-8 (round lifecycle state machine) — owns `'round_finalize'` enqueues.
- T6 (rules engine) — owns `'sub_game_result'` enqueues.

T5-3 ships the lib + tests. The "is anyone calling this?" answer is "not yet, by design."

### 9. Wolf Cup REGRESSIONS clean

The port copies LOGIC from Wolf Cup but does NOT modify any Wolf Cup file. `apps/web/src/lib/offline-queue.ts` and the hooks remain untouched.

## Acceptance Criteria

**AC #1 — `offline-queue.ts` exports the v1 surface**

Given `apps/tournament-web/src/lib/offline-queue.ts`
When inspected
Then it exports:

- `MutationKind = 'hole_score' | 'sub_game_result' | 'scorer_handoff' | 'round_finalize'` (TypeScript-only union; not enum).
- `MutationEntry` interface with fields: `id?: number`, `kind: MutationKind`, `url: string`, `body: unknown`, `clientEventId: string` (NON-EMPTY at enqueue time; CALLER-supplied UUID v4), `roundId: string`, `timestamp: number`, `retryCount: number` (initialized to 0; incremented only on transient-4xx; reset to 0 on resolveConflict('overwrite')), `conflictPending?: boolean`, `lastError?: { status: number; body: unknown } | null`.
- `MAX_TRANSIENT_RETRIES = 5` exported module constant (universal failsafe threshold per Risk Acceptance §2 (l)).
- `enqueueMutation(entry: Omit<MutationEntry, 'id' | 'timestamp' | 'retryCount' | 'conflictPending' | 'lastError'>): Promise<void>` — validates the entry shape (REJECTS with `Error('enqueueMutation: clientEventId is required (caller-supplied UUID v4)')` if `clientEventId` is empty/undefined; REJECTS if `kind` not in the 4-value union; REJECTS if `url` is empty/undefined; REJECTS if `body` is undefined). On valid input, generates timestamp, sets `retryCount = 0`, writes to IDB.
- `getQueue(roundId?: string): Promise<MutationEntry[]>` — returns entries (FIFO by id ASC) optionally scoped by roundId.
- `removeFromQueue(id: number): Promise<void>`.
- `getQueueCount(roundId: string): Promise<number>`.
- `quarantineEntry(id: number): Promise<void>` — moves entry from `mutation-queue` to `mutation-queue-errored`.
- `resolveConflict(id: number, action: 'discard'): Promise<void>` AND `resolveConflict(id: number, action: 'overwrite', overwriteBody: unknown): Promise<void>` (TypeScript overloads): for 'discard', purges the entry; for 'overwrite', REPLACES `entry.body` with the caller-supplied `overwriteBody` (T5.10's UI constructs the exact wire shape — T5-3 does NOT mutate fields itself), clears `conflictPending`, resets `retryCount = 0`, persists to IDB. Next drain pass re-attempts with the new body.
- `purgeOrphanedEntries(activeRoundId: string): Promise<number>` — deletes every entry whose `roundId !== activeRoundId`. Returns count removed.
- `registerTerminalErrors(kind: MutationKind, codes: ReadonlyArray<string>): void` — registers a kind-specific terminal-error allowlist. T5-3 stores in a module-local `Map<MutationKind, ReadonlyArray<string>>`; consumers call once at init. **Re-registering a kind REPLACES the prior allowlist** (consumer is the source of truth).
- `getTerminalErrors(kind: MutationKind): ReadonlyArray<string>` — read accessor for the drain function. Returns `[]` if the kind hasn't been registered yet.
- `_resetTerminalErrorsForTests(): void` — test-only reset to clear the module-global registry between test files (prefixed with `_` to mark as internal; consumers MUST NOT call). Tests in `offline-queue.test.ts` and `useOfflineQueue.test.tsx` call this in their `beforeEach` to avoid cross-test pollution. **Runtime guard**: function body wraps the reset in `if (process.env['NODE_ENV'] !== 'test' && process.env['VITEST'] !== 'true') throw new Error('_resetTerminalErrorsForTests is test-only')` so accidental production use throws loudly. (The leading `_` is the API-style discouragement; the runtime guard is the actual enforcement.)

**Provenance header** (file top):
```
/* PORTED from apps/web/src/lib/offline-queue.ts @ commit ddf921b29afe9b6b50a1f136021502770b180e65, dated 2026-04-27.
 *
 * Tournament deltas vs Wolf Cup:
 *   - DB name: wolf-cup-offline → tournament-offline
 *   - Object store: score-queue → mutation-queue (v1 carries 4 kinds)
 *   - REMOVED ctp-queue store + 4 functions (CTP is Wolf Cup-only; v1 tournament has no CTP)
 *   - REMOVED groupId / wolfDecision / autoCalculateMoney / entryCode fields
 *   - ADDED kind discriminator (4 v1 values)
 *   - ADDED clientEventId (FD-3 / FD-5 idempotency)
 *   - ADDED url + body fields (kind-agnostic dispatch)
 *   - ADDED conflictPending + lastError fields (409 retention path)
 *   - ADDED mutation-queue-errored store (corrupted-entry quarantine)
 *   - ADDED registerTerminalErrors / getTerminalErrors (consumer-supplied per-kind classifications)
 */
```

**AC #2 — `useOfflineQueue.ts` hook exports `useOfflineQueue(roundId: string)`**

Given `apps/tournament-web/src/hooks/useOfflineQueue.ts`
When inspected
Then it exports a default-named function `useOfflineQueue(roundId: string)` returning `{ pendingCount, isDraining, drainError, drain, refreshCount }`. Same shape as Wolf Cup's hook minus `groupId` (single-arg). Mounts a `'online'` window listener that triggers `drain()`. Single-flight drain via a ref. Provenance header citing the Wolf Cup source path + commit SHA.

**AC #3 — `useOnlineStatus.ts` hook is a thin port**

Given `apps/tournament-web/src/hooks/useOnlineStatus.ts`
When inspected
Then it exports `useOnlineStatus(): boolean` — `navigator.onLine` + `'online'`/`'offline'` event listeners. ~30 lines including header. Provenance header citing the Wolf Cup source path + commit SHA.

**AC #4 — Drain function FIFO + idempotent + transient-vs-terminal classification**

Given the drain triggered on `'online'` event with N queued entries
When the drain runs
Then:

- Entries are read in `id` ASC order (FIFO insertion order, NOT holeNumber). Entries with `conflictPending === true` are SKIPPED in the iteration (they're held until `resolveConflict()` clears the flag).
- Each entry is POSTed via `fetch(entry.url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.body) })`.
- The response body is parsed conditionally: **only call `response.json()` if status != 204 AND `response.headers.get('content-type')?.includes('application/json')` is truthy AND content-length is non-zero (or unset, since some servers omit it for chunked responses; in that case attempt `await response.json()` inside a try/catch — on parse error treat body as `{}`)**. For 204 / empty / non-JSON responses, `body = {}` (no `code` field). Drain logic uses `body.code` for terminal-error matching; a missing `code` falls through to the universal failsafe path on 4xx, or the genuine-network-fail BREAK path on 5xx. **Never `await response.json()` unconditionally** — that throws on 204 No Content (no body to parse) and on text/plain error pages, which would make the drain code itself crash and prevent the queue from ever progressing past such an entry.
- **On response 200/2xx** → `removeFromQueue(entry.id)` + decrement `pendingCount`. **T5-3 does NOT invalidate any TanStack Query keys** — TanStack invalidation is the consumer's responsibility. The contract: T5-2 (the first consumer) runs `useEffect` that watches `pendingCount` returned by `useOfflineQueue`; on decrement, it calls `queryClient.invalidateQueries({ queryKey: [...] })` for its kind's read paths. T5-2's spec will own the invalidation AC and pin it via component test. T5-3 stays decoupled from any specific query-key namespace; T5-3's tests verify `pendingCount` transitions without claiming responsibility for downstream cache effects. Drain CONTINUES to next entry.
- **On response 409** → entry's `conflictPending = true` + `lastError = { status: 409, body }` is persisted to IDB; `tournament-offline-queue-conflict` CustomEvent fires on window with `detail: { entryId, clientEventId, kind, response: { status: 409, body } }`; entry RETAINED. Drain CONTINUES to the next entry (a 409 on entry N does NOT block N+1 — they're independent rows). The drain does NOT increment `retryCount` for 409 (it's a user-decision hold, not a retry).
- **On response 4xx (NOT 409) where parsed JSON `body.code` is in `getTerminalErrors(entry.kind)`** → entry purged via `removeFromQueue`; decrement `pendingCount`. Drain CONTINUES to next entry.
- **On response 4xx (NOT 409) where code is NOT in the per-kind terminal allowlist** → increment `entry.retryCount`; persist updated row; **then** if `retryCount >= MAX_TRANSIENT_RETRIES (5)` → universal failsafe per (l) fires on THIS cycle (purge entry, decrement pendingCount, emit `tournament-offline-queue-failsafe-purged` CustomEvent). Else: leave the row in queue with the new `retryCount`. **Drain CONTINUES to next entry in either case** (NOT break). Rationale: the server IS reachable (we got a 4xx, not a network failure); entry N+1 may be an unrelated kind/url that succeeds. A deterministic 4xx hits the failsafe on the 5th attempt for that entry; concurrent entries are unaffected.
- **On response 5xx OR fetch network/TypeError (genuinely-broken path)** → do NOT increment retryCount (5xx/network is genuinely transient; should retry indefinitely without hitting the failsafe). **BREAK the drain loop** (entry N+1 will fail the same way against an unreachable server). The `useOfflineQueue` hook then schedules a `setTimeout(drain, 30_000)` re-invocation as a heartbeat (in addition to the `'online'` event listener) so the queue progresses even when `navigator.onLine` is `true` but the server is down. **Lifecycle rules** for the setTimeout: (i) hook stores the timer id in a `useRef<ReturnType<typeof setTimeout> | null>`; (ii) **BEFORE setting a new setTimeout**, the drain calls `clearTimeout(timerRef.current)` and clears the ref — so back-to-back drain failures never stack timeouts (a fresh 30s window starts each time the BREAK path fires); (iii) every successful drain that empties the queue clears the timer ref via `clearTimeout`; (iv) the hook's `useEffect` cleanup function on unmount calls `clearTimeout` to prevent stale-closure leaks; (v) the hook re-creates the closure on every `roundId` change so a re-mount with a different round can't fire a stale-roundId drain (the `useEffect` cleanup runs first because `roundId` is in the dependency list, then the new effect installs fresh listeners + ref). The single-flight lock prevents re-entry if `'online'` fires while a setTimeout-triggered drain is already running.
- **On malformed entry detected at the start of the per-entry iteration** (missing `url` / `kind` / `clientEventId` / `body`) → `quarantineEntry(entry.id)` is called BEFORE any fetch attempt; decrement `pendingCount`; drain CONTINUES (quarantine is independent of network state — corrupted rows are NOT transient).

**Drain DOES NOT mutate `entry.body`.** Whatever the consumer enqueued is sent verbatim. Idempotency relies on `clientEventId` already being present in the body (the consumer's responsibility per Risk Acceptance §4).

**The single-flight lock** (`isDrainingRef.current`) MUST be released in a `finally` block so an escaping exception doesn't permanently freeze the queue.

**AC #5 — Idempotency: identical clientEventId is preserved across retries**

Given an entry enqueued with `clientEventId='evt-XYZ'` and `body={...}`
When the first drain attempt fails with a transient error (network drop)
Then the SAME entry is retried on the next drain (NOT a fresh enqueue with a new clientEventId); the `clientEventId='evt-XYZ'` is byte-identical. The server (T5.6) dedupes via T5-1's UNIQUE on `(round_id, player_id, hole_number, client_event_id)`.

**AC #6 — Corrupted-entry quarantine**

Given an entry in IDB whose row data is missing required fields (`url`, `kind`, `clientEventId`, or `body`) due to a corrupted IDB write or schema-drift edge case
When the drain encounters it
Then BEFORE any fetch attempt, `quarantineEntry(id)` MOVES the entry from `mutation-queue` to `mutation-queue-errored` (via a single readwrite IDB transaction over BOTH stores so the move is atomic); decrement `pendingCount`; the drain CONTINUES to the next entry. **Quarantine is NOT a transient error** — even when the network is down, malformed entries are quarantined immediately rather than blocking the drain. Quarantine semantics are independent of fetch semantics by design.

**AC #7 — Tests**

Given `apps/tournament-web/src/lib/offline-queue.test.ts` + `apps/tournament-web/src/hooks/useOfflineQueue.test.tsx` + `apps/tournament-web/src/hooks/useOnlineStatus.test.tsx`
When `pnpm -F @tournament/web test` runs
Then a **net +14 or more new passing tests** vs the start-of-story baseline (55 → ≥69). No previously-passing test goes red. typecheck + lint clean.

Test attribution (15 tests total; AC floor is +14):

- `offline-queue.test.ts` (9 tests):
  1. enqueue → getQueue returns the entry; FIFO order proof: 3 enqueues → getQueue returns in id ASC.
  2. enqueueMutation rejects with explicit Error when `clientEventId` is empty/undefined.
  3. enqueueMutation rejects when `kind` is outside the 4-value union (e.g., `'wolf_decision'`).
  4. getQueueCount scoped by roundId returns count.
  5. purgeOrphanedEntries removes entries for other rounds (returns count removed).
  6. quarantineEntry moves the row from `mutation-queue` to `mutation-queue-errored` atomically (post-condition: 0 in source, 1 in errored).
  7. resolveConflict('discard') purges the entry.
  8. resolveConflict('overwrite', body) replaces entry.body, clears conflictPending, resets retryCount to 0.
  9. registerTerminalErrors / getTerminalErrors round-trip per-kind.

- `useOfflineQueue.test.tsx` (5 tests):
  1. on `'online'` event, drain is called; for a 200 response on entry 1 of 1, entry is purged and pendingCount decrements to 0.
  2. for a 409 response on entry 1 of 2, entry 1 is retained with `conflictPending=true`, `tournament-offline-queue-conflict` CustomEvent fires with detail payload `{ entryId, clientEventId, kind, response: { status: 409, body } }`, drain CONTINUES to entry 2 (which 200s and is purged).
  3. for a transient 4xx (e.g., 400 not in terminal allowlist) on entry 1 of 3, drain CONTINUES; entries 2 and 3 are POSTed; entry 1's retryCount increments by 1; entry 1 stays in queue with new retryCount; entries 2-3 are purged on 200.
  4. for a 5xx response on entry 1 of 3, drain BREAKs; entries 2-3 are NOT POSTed; a `setTimeout(drain, 30_000)` is scheduled (verified via `vi.useFakeTimers()` + `vi.runAllTimers()` triggering the second drain attempt).
  5. universal failsafe: same entry hits transient 4xx across 5 drain passes → on the 5th pass after `retryCount` becomes 5, entry is purged AND `tournament-offline-queue-failsafe-purged` CustomEvent fires with detail `{ entryId, clientEventId, kind, retryCount: 5, lastError }`.

- `useOnlineStatus.test.tsx` (1 test):
  1. emits `true` initially (mock `navigator.onLine = true`); flips to `false` on dispatched `'offline'` event; flips back on `'online'` event.

Total: 15 tests (≥ +14 floor; margin +1).

**AC #8 — `apps/tournament-web/PORTS.md` created with 3 entries**

Given the file does not yet exist
When T5-3's commit lands
Then `apps/tournament-web/PORTS.md` exists with the standard table header (Target file | Source file | Source commit | Ported-on date | Deltas | Last-checked) AND three rows for `lib/offline-queue.ts`, `hooks/useOfflineQueue.ts`, `hooks/useOnlineStatus.ts`.

**AC #9 — Wolf Cup regression clean**

Given `pnpm --filter @wolf-cup/engine test`, `pnpm --filter @wolf-cup/api test`, `pnpm --filter @wolf-cup/web test`, `pnpm -r typecheck`, `pnpm -r lint`
When run after T5-3's commits
Then all suites green at baseline (engine 472, api 507, web unchanged); typecheck + lint clean.

**AC #10 — ZERO route / mount / consumer changes in tournament-web**

Given `git diff --name-only` after T5-3's commits
When the path list is enumerated
Then NO file under `apps/tournament-web/src/routes/` is modified, `__root.tsx` is NOT modified, `main.tsx` is NOT modified. (T5-3 is a library + hook port; consumers in T5-2 will mount.)

## Tasks

1. Capture start-of-story baseline test counts: `pnpm -F @tournament/web test 2>&1 | tail -10` → record passing count for AC #7.
2. **CHECK fake-indexeddb availability**: `cd apps/tournament-web && pnpm ls fake-indexeddb 2>&1 || true`. If not present, STOP and request SHARED-gate approval to add it. (Likely present transitively or the tournament-web vitest already mocks IDB some other way; verify before proceeding.)
3. Read Wolf Cup source files one more time for byte-faithful porting:
   - `apps/web/src/lib/offline-queue.ts` (lines 1-194)
   - `apps/web/src/hooks/useOfflineQueue.ts` (lines 1-237)
   - `apps/web/src/hooks/useOnlineStatus.ts` (lines 1-28)
4. Write `apps/tournament-web/src/lib/offline-queue.ts` per AC #1, applying deltas (a)-(k) from Risk Acceptance §2.
5. Write `apps/tournament-web/src/hooks/useOfflineQueue.ts` per AC #2.
6. Write `apps/tournament-web/src/hooks/useOnlineStatus.ts` per AC #3.
7. Write `apps/tournament-web/src/lib/offline-queue.test.ts` per AC #7 (8 tests).
8. Write `apps/tournament-web/src/hooks/useOfflineQueue.test.tsx` per AC #7 (3 tests).
9. Write `apps/tournament-web/src/hooks/useOnlineStatus.test.tsx` per AC #7 (1 test).
10. Create `apps/tournament-web/PORTS.md` per AC #8 (3 rows).
11. Run `pnpm -F @tournament/web test` — confirm net +14 or more passing per AC #7 (9 lib + 5 hook + 1 status = 15 tests target; floor +14). Run `pnpm -r typecheck` + `pnpm -r lint` — confirm clean.
12. Run `pnpm --filter @wolf-cup/engine test` + `pnpm --filter @wolf-cup/api test` + `pnpm --filter @wolf-cup/web test` — confirm baseline (Wolf Cup regression check per AC #9).

## Test strategy

- **Library correctness** — `offline-queue.test.ts` opens an IDB-backed test fixture (via `fake-indexeddb` if available, else a thin module mock) and asserts enqueue/dequeue/quarantine/conflict-resolution invariants.
- **Hook integration** — `useOfflineQueue.test.tsx` uses `renderHook` from `@testing-library/react` + `vi.mock` of `fetch` to simulate 200/409/503 responses; asserts queue state transitions + window-event firing.
- **Connectivity** — `useOnlineStatus.test.tsx` uses `vi.spyOn(navigator, 'onLine', 'get')` + `window.dispatchEvent(new Event('online'|'offline'))` to drive the hook's state.

## Followups

- T5-2 (scorer entry UI) calls `enqueueMutation({ kind: 'hole_score', url: '/api/rounds/{roundId}/hole-scores', body: {...includes clientEventId at top level...}, clientEventId, roundId })` on Save. Registers terminal errors for `'hole_score'` (e.g., `['ROUND_FINALIZED', 'INVALID_SCORES']`).
- T5-7 (scorer handoff) registers `'scorer_handoff'` terminal errors.
- T5-8 (round lifecycle) registers `'round_finalize'` terminal errors.
- T6 (rules engine) registers `'sub_game_result'` terminal errors.
- T5-10 (airplane-mode drill) is the integration test that exercises the full enqueue → offline → reconnect → drain → 409 → resolveConflict → re-drain flow against a real backend with two browser tabs.
- The `mutation-queue-errored` store has no UI in v1; future story can add an admin "view quarantined entries" page if quarantine becomes common (not expected — most corruption sources would have been caught at enqueue's runtime guard).

## Risks

- **`fake-indexeddb` SHARED-gate**: only known SHARED risk; verify at task step 2 before any code is written.
- **PORT FAITHFULNESS**: Wolf Cup's drain function has a complex transient/terminal classifier with hardcoded error code names tied to Wolf Cup's API contract. Tournament's classifier is GENERIC (registered per-kind by consumers). **Risk: a downstream consumer (T5-2/T5-7/T5-8/T6) forgets to register terminal errors → ALL their kind's errors are treated as transient → entries pile up forever.** Mitigation: T5-2's spec MUST include the `registerTerminalErrors('hole_score', [...])` call as an AC.
- **Order of drain across kinds**: Wolf Cup drains scores first, then CTPs (because CTP requires score-completion server-side). Tournament drains kinds INTERLEAVED in FIFO insertion order — there's no inter-kind dependency in v1 because no v1 endpoint requires another kind to land first. **Risk: a future cross-kind dependency emerges (e.g., round_finalize requires all hole_scores landed first).** Mitigation: not v1 concern; T5-8's spec will address if needed (could add a kind-priority registry; deferred).
- **iOS Safari `'online'` event reliability**: Wolf Cup's pattern uses foreground sync on the `'online'` event because iOS Safari kills background sync. T5-3 inherits this; T5-2's UI MAY want to add a manual "Sync now" button as defense-in-depth, but T5-3 doesn't ship that.
- **clientEventId UUID v4 entropy**: `crypto.randomUUID()` is widely available (caniuse 96%+); fallback is NOT shipped. If a target browser doesn't support `crypto.randomUUID()`, enqueue throws. Document expectation: tournament targets iOS 17+ (PWA install) and modern desktop Chrome — all support `crypto.randomUUID()`.
- **Conflict resolution 'overwrite' body construction**: T5-3's `resolveConflict('overwrite', body)` REPLACES `entry.body` with the caller-supplied `body` verbatim — T5-3 does NOT mutate fields. **T5.10 (airplane-mode drill / overwrite-prompt UI) owns the wire-shape decision** (e.g., whether to set an `overwriteFlag: true` field, regenerate `clientEventId`, or hit a different URL). T5-3 ships the body-replacement primitive; T5.10 spec will define the exact body shape. Zero field-name coupling between the queue lib and consumers.
