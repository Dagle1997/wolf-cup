# Codex Review

- Generated: 2026-04-28T14:46:03.232Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/src/lib/offline-queue.ts, apps/tournament-web/src/lib/offline-queue.test.ts, apps/tournament-web/src/hooks/useOfflineQueue.ts, apps/tournament-web/src/hooks/useOfflineQueue.test.tsx

## Summary

Round-1 items called out in your notes look genuinely resolved (not just papered over): overwrite now throws on undefined body; the process/env guards now avoid touching process in browser contexts; drain now validates kind against a 4-value runtime set; terminal-error registry now snapshots instead of storing caller’s reference; and the new tests do pin the intended behaviors.

The main new risk introduced in this round is correctness drift from duplicating the “valid kinds” runtime set in two places (lib + hook). There’s also a small but real edge case in the malformed-entry quarantine path: if an entry ever lacks an id, it will be skipped rather than removed/quarantined, leaving a potentially undrainable row in the main queue.

Overall risk: medium

## Findings

1. [medium] VALID_KINDS runtime list is duplicated (lib vs hook) → drift can quarantine valid entries or accept invalid ones
   - File: apps/tournament-web/src/hooks/useOfflineQueue.ts:28-33
   - Confidence: high
   - Why it matters: `enqueueMutation` validates kinds using a private `VALID_KINDS` set in offline-queue.ts (lines 29–34), while `useOfflineQueue` validates using its own `VALID_KINDS_RUNTIME` (lines 28–33). If a new kind is added/removed in one location but not the other, you can end up with:
- enqueue accepting a kind that drain later treats as malformed and quarantines, or
- drain accepting a kind that enqueue would reject (less likely but still a mismatch).

This is a correctness issue, not just DRY: it changes runtime behavior and could cause unexpected quarantines/purges after a future kind expansion.
   - Suggested fix: Export a single runtime set from `offline-queue.ts` (e.g., `export const VALID_KINDS_RUNTIME = new Set<MutationKind>(...)` or an exported `isValidKind(x): x is MutationKind`), and import it in `useOfflineQueue.ts` instead of redefining it.

2. [medium] Malformed-entry handling can leave an undrainable row if entry.id is missing (no quarantine/remove possible)
   - File: apps/tournament-web/src/hooks/useOfflineQueue.ts:89-103
   - Confidence: medium
   - Why it matters: The malformed guard marks entries malformed when `entry.id === undefined` (line 96), but the remediation only quarantines if `entry.id !== undefined` (lines 98–101). If an entry is ever retrieved without an `id` (corrupt data, store mismatch, or a future schema issue), drain will `continue` without removing/quarantining it. That can leave a permanent “stuck” row in the main store that:
- contributes to `pendingCount` via `getQueueCount`,
- is repeatedly encountered every drain,
- cannot be acted on.

While keyPath/autoIncrement normally ensures an id, this code path explicitly targets corruption scenarios, so handling the “missing id” case robustly is important.
   - Suggested fix: Consider a fallback removal strategy when `id` is missing, e.g. quarantine/remove by cursor iteration (delete the current cursor record), or treat “missing id” as a reason to purge the entire store entry found via cursor rather than via `entry.id`.

3. [low] registerTerminalErrors freezing may break consumers that (incorrectly) relied on mutating the returned array to update registry state; no test pins snapshot behavior
   - File: apps/tournament-web/src/lib/offline-queue.ts:114-127
   - Confidence: high
   - Why it matters: The change to `Object.freeze([...codes])` (line 122) is a sound fix for reference-sharing. However, any consumer that previously did something like:
- `const arr = ['X']; registerTerminalErrors(kind, arr); arr.push('Y');`
expecting the registry to update, will no longer work.

That’s arguably fixing a bug/footgun, but it is a behavioral change. There’s also no unit test proving the snapshot/immutability property that motivated the change, so a future refactor could accidentally reintroduce reference sharing.
   - Suggested fix: Add a small test: register with a mutable array, mutate the original, and assert `getTerminalErrors` didn’t change. Optionally also assert the returned array is frozen (or at least non-writable) if you want that guarantee.

## Strengths

- Round-1 undefined overwriteBody issue is now enforced at runtime (offline-queue.ts:267–271) and is pinned by a test (offline-queue.test.ts:84–91).
- The browser-context `process` guard is now ordered safely (check `typeof process === 'undefined'` before `process.env` access) in both test-only helpers (offline-queue.ts:89–108, 132–143).
- Drain now validates `kind` against an allowlist before fetch, preventing malformed entries from being POSTed (useOfflineQueue.ts:89–103), and the raw-IDB corruption test exercises this path end-to-end (useOfflineQueue.test.tsx:226–297).
- The raw-IDB seeding approach is reasonable here because it specifically targets “cannot be created through enqueue” corruption scenarios; the test also explicitly creates both stores in `onupgradeneeded`, reducing brittleness if the DB doesn’t exist yet.

## Warnings

None.
