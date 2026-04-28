/* PORTED from apps/web/src/hooks/useOfflineQueue.ts @ commit ddf921b29afe9b6b50a1f136021502770b180e65, dated 2026-04-27.
 *
 * Tournament deltas vs Wolf Cup:
 *   - Single-arg signature `useOfflineQueue(roundId)` — no groupId
 *   - Drain is generic: fetch(entry.url, { method: 'POST', credentials: 'include',
 *     headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.body) })
 *   - Per-kind terminal-error registry (consumer registers via registerTerminalErrors)
 *   - Universal failsafe: transient 4xx with retryCount >= MAX_TRANSIENT_RETRIES (5) → purge
 *   - 5xx / network → BREAK + setTimeout(drain, 30s) heartbeat
 *   - 409 → entry retained + CustomEvent('tournament-offline-queue-conflict') fires; drain CONTINUES
 *   - REMOVED Wolf Cup's hardcoded transient/terminal Wolf-Cup-specific error codes
 *   - REMOVED entryCode header (tournament uses session-cookie auth)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getQueue,
  getQueueCount,
  getTerminalErrors,
  isValidKind,
  MAX_TRANSIENT_RETRIES,
  quarantineEntry,
  removeFromQueue,
  updateEntry,
  type MutationEntry,
} from '../lib/offline-queue.js';

const HEARTBEAT_MS = 30_000;

/**
 * Manages the tournament offline mutation queue for a specific round.
 *
 * - Exposes `pendingCount` for the offline badge.
 * - Auto-drains on `window` 'online' events.
 * - On 5xx / network error: BREAKs and schedules a setTimeout heartbeat
 *   to retry, so the queue progresses even when navigator.onLine === true
 *   but the server is down.
 * - On transient 4xx (not in per-kind terminal allowlist): increments
 *   retryCount, CONTINUES to next entry. Universal failsafe at MAX=5.
 * - On 409: emits CustomEvent('tournament-offline-queue-conflict'),
 *   marks conflictPending=true, retains entry, CONTINUES.
 * - On corrupted entry (missing url/kind/clientEventId/body): quarantine.
 */
export function useOfflineQueue(roundId: string) {
  const [pendingCount, setPendingCount] = useState(0);
  const [isDraining, setIsDraining] = useState(false);
  const [drainError, setDrainError] = useState<string | null>(null);

  const isDrainingRef = useRef(false);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshCount = useCallback(async () => {
    try {
      const count = await getQueueCount(roundId);
      setPendingCount(count);
    } catch {
      // IDB read failure — leave existing count in place.
    }
  }, [roundId]);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current !== null) {
      clearTimeout(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const drain = useCallback(async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    setIsDraining(true);
    setDrainError(null);

    let needsHeartbeat = false;

    try {
      const entries = await getQueue(roundId);
      for (const entry of entries) {
        // Skip held-for-conflict entries.
        if (entry.conflictPending) continue;

        // Defensive: every IDB row should carry an auto-incremented id.
        // If one is missing, the row was inserted via a non-standard
        // path; we can't quarantine without an id, but we can at least
        // skip the entry so it doesn't block N+1.
        if (entry.id === undefined) {
          // eslint-disable-next-line no-console
          console.warn(
            'useOfflineQueue: queue entry missing id; cannot quarantine. Skipping.',
          );
          continue;
        }

        // Pre-fetch validation: corrupted-entry quarantine. Type-tight
        // checks defend against IDB rows with non-string url/clientEventId
        // or non-serializable body that would otherwise throw inside fetch
        // and trigger the BREAK-on-network-error path, blocking N+1.
        let serializedBody: string | null = null;
        try {
          // JSON.stringify returns `undefined` (without throwing) for
          // top-level functions / symbols / undefined — coerce that to
          // `null` so the malformed check below quarantines instead of
          // sending an empty-body POST with Content-Type: application/json.
          const stringified = JSON.stringify(entry.body);
          serializedBody = stringified === undefined ? null : stringified;
        } catch {
          // Circular reference / non-serializable. Quarantine.
          serializedBody = null;
        }
        const isMalformed =
          typeof entry.url !== 'string' ||
          entry.url.length === 0 ||
          !isValidKind(entry.kind) ||
          typeof entry.clientEventId !== 'string' ||
          entry.clientEventId.length === 0 ||
          entry.body === undefined ||
          serializedBody === null;
        if (isMalformed) {
          await quarantineEntry(entry.id);
          setPendingCount((prev) => Math.max(0, prev - 1));
          continue;
        }

        let response: Response;
        try {
          response = await fetch(entry.url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: serializedBody,
          });
        } catch {
          // Network error / fetch TypeError: server unreachable.
          // BREAK + schedule heartbeat. Do NOT increment retryCount.
          needsHeartbeat = true;
          break;
        }

        // Conditional JSON parse: only when 204 + content-type=json + body is non-empty.
        let body: { code?: string; error?: string; [k: string]: unknown } = {};
        if (response.status !== 204) {
          const ct = response.headers.get('content-type') ?? '';
          if (ct.includes('application/json')) {
            try {
              body = (await response.json()) as typeof body;
            } catch {
              body = {};
            }
          }
        }

        if (response.ok) {
          await removeFromQueue(entry.id!);
          setPendingCount((prev) => Math.max(0, prev - 1));
          continue;
        }

        if (response.status === 409) {
          await updateEntry(entry.id!, {
            conflictPending: true,
            lastError: { status: 409, body },
          });
          window.dispatchEvent(
            new CustomEvent('tournament-offline-queue-conflict', {
              detail: {
                entryId: entry.id,
                clientEventId: entry.clientEventId,
                kind: entry.kind,
                response: { status: 409, body },
              },
            }),
          );
          continue;
        }

        if (response.status >= 400 && response.status < 500) {
          // 4xx classifier
          const code = typeof body.code === 'string' ? body.code : null;
          const terminalCodes = getTerminalErrors(entry.kind);
          if (code !== null && terminalCodes.includes(code)) {
            await removeFromQueue(entry.id!);
            setPendingCount((prev) => Math.max(0, prev - 1));
            continue;
          }
          // Transient 4xx: increment retryCount, then check failsafe.
          const newRetryCount = entry.retryCount + 1;
          if (newRetryCount >= MAX_TRANSIENT_RETRIES) {
            await removeFromQueue(entry.id!);
            setPendingCount((prev) => Math.max(0, prev - 1));
            window.dispatchEvent(
              new CustomEvent('tournament-offline-queue-failsafe-purged', {
                detail: {
                  entryId: entry.id,
                  clientEventId: entry.clientEventId,
                  kind: entry.kind,
                  retryCount: newRetryCount,
                  lastError: { status: response.status, body },
                },
              }),
            );
            continue;
          }
          await updateEntry(entry.id!, {
            retryCount: newRetryCount,
            lastError: { status: response.status, body },
          });
          continue;
        }

        // 5xx: BREAK + schedule heartbeat. Do NOT increment retryCount.
        needsHeartbeat = true;
        break;
      }
    } catch {
      setDrainError('Sync failed — will retry when connection is restored.');
      needsHeartbeat = true;
    } finally {
      isDrainingRef.current = false;
      setIsDraining(false);
    }

    // Heartbeat scheduling outside the lock so a successful drain clears
    // any stale timer and a failure schedules a fresh one. clearHeartbeat
    // before setting a new timer so back-to-back failures NEVER stack.
    clearHeartbeat();
    if (needsHeartbeat) {
      heartbeatTimerRef.current = setTimeout(() => {
        heartbeatTimerRef.current = null;
        void drain();
      }, HEARTBEAT_MS);
    }

    await refreshCount();
  }, [roundId, refreshCount, clearHeartbeat]);

  // Initial count load.
  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  // Auto-drain on connectivity restore + cleanup on unmount.
  useEffect(() => {
    const handleOnline = () => {
      void drain();
    };
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      if (heartbeatTimerRef.current !== null) {
        clearTimeout(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [drain]);

  return { pendingCount, isDraining, drainError, drain, refreshCount };
}

export type UseOfflineQueueReturn = ReturnType<typeof useOfflineQueue>;
export type { MutationEntry };
