# Codex Review

- Generated: 2026-04-28T14:42:52.583Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/lib/offline-queue.ts, apps/tournament-web/src/lib/offline-queue.test.ts, apps/tournament-web/src/hooks/useOfflineQueue.ts, apps/tournament-web/src/hooks/useOfflineQueue.test.tsx, apps/tournament-web/src/hooks/useOnlineStatus.ts, apps/tournament-web/src/hooks/useOnlineStatus.test.tsx, apps/tournament-web/PORTS.md, _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md

## Summary

Implementation largely matches the provided spec: IDB-backed FIFO queue keyed by auto-increment id; enforced caller-supplied clientEventId at enqueue; generic drain with 200→purge, 409→retain+CustomEvent+continue, transient 4xx→retryCount++ + continue with failsafe purge at 5th, 5xx/network→break+heartbeat; quarantine store and terminal-error registry are present. Main correctness gaps are (1) resolveConflict('overwrite') can write an invalid body (undefined) which then gets quarantined/blocked later, and (2) the “test-only” runtime guards rely on `process.env` which may be undefined in a browser bundle, undermining the intended guard behavior. Test suite is strong but leaves several AC behaviors unpinned (online auto-drain, heartbeat scheduling/clearing, corrupted-entry quarantine path, enqueue url/body validation).

Overall risk: medium

## Findings

1. [medium] resolveConflict('overwrite') allows overwriteBody=undefined, creating an invalid queue entry (body undefined)
   - File: apps/tournament-web/src/lib/offline-queue.ts:247-262
   - Confidence: high
   - Why it matters: Spec/AC require `body` to be defined (enqueue rejects undefined). But `resolveConflict` currently accepts `overwriteBody?: unknown` and unconditionally writes it to `body` (line 256-261). If a caller accidentally passes `undefined`, the entry becomes malformed. In drain, `entry.body === undefined` triggers quarantine (apps/tournament-web/src/hooks/useOfflineQueue.ts:82-93), which is a surprising outcome for a user-driven conflict resolution action and can cause data loss (mutation moved to errored store) rather than a clear error back to the UI.
   - Suggested fix: In `resolveConflict`, enforce `overwriteBody !== undefined` when `action==='overwrite'` (throw a clear Error). Optionally also validate JSON-serializable if that’s a desired invariant. Add a unit test asserting `resolveConflict(id,'overwrite', undefined as any)` rejects and leaves the entry unchanged.

2. [medium] Test-only guard uses `process.env` without checking `process` existence; calling in browser can throw ReferenceError before guard
   - File: apps/tournament-web/src/lib/offline-queue.ts:89-135
   - Confidence: high
   - Why it matters: Both `_resetDbForTests` and `_resetTerminalErrorsForTests` read `process.env[...]` (lines 90-93, 128-131). In many Vite/browser runtimes, `process` is not defined at all. If either function is accidentally invoked in production (the scenario the guard is meant to protect), it may crash with `ReferenceError: process is not defined` rather than throwing the intended explicit “test-only” Error. This undermines the safety story of the guard and can create hard-to-debug runtime failures.
   - Suggested fix: Use a safe check like:
```ts
const isTest = (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
               (typeof process !== 'undefined' && process.env?.VITEST === 'true') ||
               (import.meta as any).env?.MODE === 'test';
```
(or whichever env mechanism tournament-web uses). Then throw your explicit error when not test. Add a small unit test that calling these in a non-test-like env throws the explicit error (can be done by temporarily deleting globalThis.process in a test).

3. [low] Drain malformed-entry detection does not validate `kind` against the 4 allowed values; corrupted `kind` won’t be quarantined
   - File: apps/tournament-web/src/hooks/useOfflineQueue.ts:81-95
   - Confidence: medium
   - Why it matters: The drain’s `isMalformed` check only verifies truthiness of `entry.kind` (line 82-87). If IndexedDB contains a corrupted/older value (e.g. `'wolf_decision'`), it will be treated as “well-formed” and then processed through transient/terminal logic. That can lead to repeated transient 4xx retries/failsafe purges instead of the intended quarantine-for-corruption behavior.
   - Suggested fix: Consider importing the VALID_KINDS check (or exposing an `isValidKind()` helper from the queue module) and treating invalid kinds as malformed for quarantine. Add a test that manually injects an invalid kind row into IDB and asserts it gets quarantined on drain.

4. [medium] Several spec/AC behaviors are not pinned by tests (risk of regression)
   - File: apps/tournament-web/src/hooks/useOfflineQueue.test.tsx:53-225
   - Confidence: high
   - Why it matters: Current tests strongly cover the core HTTP status semantics (200/409/4xx/5xx) and failsafe threshold, but some AC-stated behaviors are not directly asserted:
- Auto-drain on window 'online' event (hook registers listener, but tests only call `drain()` directly).
- Heartbeat scheduling/clearing rules (setTimeout called with 30s, clear-before-set, cleanup-on-unmount); BREAK semantics are tested but not the timer behavior.
- Corrupted-entry quarantine path inside `drain()` (only `quarantineEntry()` is unit-tested, not the hook’s quarantine-on-malformed behavior).
- enqueueMutation validation for missing/empty `url` and `body === undefined` (AC requires; unit tests only cover clientEventId and kind).
Unpinned behaviors tend to regress during later refactors (especially timer and event wiring).
   - Suggested fix: Add targeted tests:
- Dispatch `window.dispatchEvent(new Event('online'))` and assert fetch called.
- Instead of fake-timer firing (which you noted hangs), assert heartbeat scheduling by spying on `globalThis.setTimeout` and verifying it’s called with ~30000ms when a 5xx/network occurs, and that repeated failures don’t stack (setTimeout called once per drain attempt, and clearTimeout called).
- Create a malformed queued row by enqueuing then `updateEntry(id,{ body: undefined as any })` (or direct IDB put) and assert it moves to errored store and pendingCount decrements.
- Add two enqueueMutation tests for url/body validation.

5. [low] registerTerminalErrors stores the array reference; caller mutation can change registry unexpectedly
   - File: apps/tournament-web/src/lib/offline-queue.ts:111-123
   - Confidence: medium
   - Why it matters: `registerTerminalErrors` saves `codes` directly into the Map (line 113-118). If a consumer later mutates the array in-place, registry behavior changes at runtime in a non-obvious way. This is a subtle correctness/maintenance hazard, especially since the API suggests “register once at init.”
   - Suggested fix: Store a defensive copy: `terminalErrorRegistry.set(kind, [...codes]);` (or `Object.freeze([...codes])`). Add a small unit test if you want to lock this down.

## Strengths

- Queue schema + API surface align with the spec’s AC #1 (MutationKind union, clientEventId required, retryCount/conflictPending/lastError fields, quarantine store, terminal-error registry, resolveConflict overloads).
- Drain semantics are implemented in the intended shape: FIFO by id, generic fetch(url+body), 200→purge, 409→retain+event+continue, transient 4xx→retry+continue with failsafe purge at 5th attempt, 5xx/network→break+heartbeat without retryCount increment.
- Single-flight drain lock is correctly released in a finally block; heartbeat is cleared before setting a new timer (no stacking) and cleared on unmount.
- Conditional JSON parsing avoids unconditional `response.json()` and is wrapped in try/catch to prevent drain crashes on invalid/empty JSON.
- Tests provide good coverage for the most load-bearing HTTP classification paths, including the exact failsafe threshold behavior (purge on the 5th transient-4xx attempt).
- Quarantine move uses a single readwrite transaction over both stores, which is the right atomicity pattern for IDB.

## Warnings

- Truncated file content for review: _bmad-output/implementation-artifacts/tournament/T5-3-offline-queue-indexeddb-client-event-id-idempotency.md
