import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getQueue,
  removeFromQueue,
  getQueueCount,
  getCtpQueue,
  removeCtpFromQueue,
  getCtpQueueCount,
} from '@/lib/offline-queue';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages the IndexedDB offline score queue for a specific round/group.
 *
 * - Exposes `pendingCount` for the offline badge.
 * - Auto-drains on `window.online` events (foreground sync — iOS Safari primary path).
 * - Drain is ALWAYS sequential by holeNumber; never parallel (NFR19 / architecture mandate).
 */
export function useOfflineQueue(roundId: number, groupId: number) {
  const queryClient = useQueryClient();
  const [pendingCount, setPendingCount] = useState(0);
  const [isDraining, setIsDraining] = useState(false);
  const [drainError, setDrainError] = useState<string | null>(null);

  // Ref prevents double-drain if 'online' fires twice in quick succession
  const isDrainingRef = useRef(false);

  const refreshCount = useCallback(async () => {
    // Promise.allSettled so one store's IDB read failure doesn't block the
    // other's contribution to pendingCount.
    const results = await Promise.allSettled([
      getQueueCount(roundId, groupId),
      getCtpQueueCount(roundId, groupId),
    ]);
    const scoreCount = results[0].status === 'fulfilled' ? results[0].value : null;
    const ctpCount = results[1].status === 'fulfilled' ? results[1].value : null;
    // If both failed, leave the existing count in place rather than zeroing.
    if (scoreCount === null && ctpCount === null) return;
    setPendingCount((scoreCount ?? 0) + (ctpCount ?? 0));
  }, [roundId, groupId]);

  const drain = useCallback(async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    setIsDraining(true);
    setDrainError(null);

    let anyFailure = false;
    try {

    // --- Score queue: per-entry try/catch, break on transient --------------
    // Scores are ordered by hole ASC. Per-entry try/catch so that a
    // terminal error on entry N doesn't permanently block entries N+1...
    //
    // Transient error (network, 500, HOLE_NOT_COMPLETE, etc.): break out of
    // the loop — if the server is unreachable for hole 6, hole 7 will fail
    // the same way. Better to retry on the next drain than fire
    // guaranteed-failing requests now.
    //
    // Terminal error (ROUND_FINALIZED, ROUND_NOT_ACTIVE, INVALID_ENTRY_CODE,
    // INVALID_SCORES): purge from queue and continue. The entry will never
    // succeed; retrying forever just keeps the pendingCount stuck.
    try {
      const entries = await getQueue(roundId, groupId);
      for (const entry of entries) {
        try {
          await apiFetch(
            `/rounds/${entry.roundId}/groups/${entry.groupId}/holes/${entry.holeNumber}/scores`,
            {
              method: 'POST',
              headers: entry.entryCode ? { 'x-entry-code': entry.entryCode } : {},
              body: JSON.stringify({ scores: entry.scores }),
            },
          );

          if (entry.wolfDecision && entry.autoCalculateMoney) {
            const { decision, partnerId, greenies, polies, sandies } = entry.wolfDecision;
            const body: Record<string, unknown> = { greenies, polies, sandies: sandies ?? [] };
            if (decision !== null) {
              body['decision'] = decision;
              if (decision === 'partner' && partnerId !== null) {
                body['partnerPlayerId'] = partnerId;
              }
            }
            await apiFetch(
              `/rounds/${entry.roundId}/groups/${entry.groupId}/holes/${entry.holeNumber}/wolf-decision`,
              {
                method: 'POST',
                headers: entry.entryCode ? { 'x-entry-code': entry.entryCode } : {},
                body: JSON.stringify(body),
              },
            );
          }

          await removeFromQueue(entry.id!);
          setPendingCount((prev) => Math.max(0, prev - 1));
        } catch (err) {
          const msg = (err as Error).message;
          // Terminal errors will NEVER succeed on retry. Purge the entry so
          // it doesn't block the queue forever. Anything unrecognized is
          // treated as transient — safer to retry than silently discard.
          //   ROUND_FINALIZED / ROUND_NOT_ACTIVE — round is done, writes closed
          //   INVALID_ENTRY_CODE                  — entry code rotated
          //   INVALID_SCORES / VALIDATION_ERROR   — body rejected by validator
          //   INVALID_HOLE / INVALID_ID / NOT_FOUND — impossible-to-fix input
          //   INVALID_DECISION                    — wolf body rejected
          const terminal =
            msg === 'ROUND_FINALIZED' ||
            msg === 'ROUND_NOT_ACTIVE' ||
            msg === 'INVALID_ENTRY_CODE' ||
            msg === 'INVALID_SCORES' ||
            msg === 'VALIDATION_ERROR' ||
            msg === 'INVALID_HOLE' ||
            msg === 'INVALID_ID' ||
            msg === 'NOT_FOUND' ||
            msg === 'INVALID_DECISION';
          if (terminal) {
            await removeFromQueue(entry.id!);
            setPendingCount((prev) => Math.max(0, prev - 1));
            anyFailure = true;
            continue;
          }
          // Transient (network, 500, unknown) — stop this drain and retry.
          // A transient server issue on hole 6 will almost certainly repeat
          // on hole 7; don't fire guaranteed-fail requests.
          anyFailure = true;
          break;
        }
      }
    } catch {
      anyFailure = true;
    }

    // --- CTP queue: per-entry try/catch -----------------------------------
    // CTP entries are independent of each other (different groups and/or
    // different par-3 holes). A score-loop failure above shouldn't block
    // CTP entries that don't depend on queued scores (e.g., scored online,
    // answered offline). Per-entry try/catch with terminal-error
    // classification so stuck entries don't linger forever.
    try {
      const ctpEntries = await getCtpQueue(roundId, groupId);
      for (const ctp of ctpEntries) {
        try {
          await apiFetch(`/rounds/${ctp.roundId}/ctp-entries`, {
            method: 'POST',
            headers: ctp.entryCode ? { 'x-entry-code': ctp.entryCode } : {},
            body: JSON.stringify({
              groupId: ctp.groupId,
              holeNumber: ctp.holeNumber,
              winnerPlayerId: ctp.winnerPlayerId,
            }),
          });
          if (ctp.id !== undefined) await removeCtpFromQueue(ctp.id);
          setPendingCount((prev) => Math.max(0, prev - 1));
        } catch (err) {
          const msg = (err as Error).message;
          // Terminal errors: the entry will NEVER succeed. Purge so it
          // doesn't permanently occupy the queue.
          //   ROUND_FINALIZED / ROUND_NOT_ACTIVE  — round locked server-side
          //   PLAYER_NOT_ON_ROUND                 — roster changed
          //   INVALID_ENTRY_CODE                  — entry code rotated
          //   CTP_NOT_ACTIVE                      — rotation changed
          //   VALIDATION_ERROR / INVALID_HOLE     — body rejected by validator
          //   GROUP_NOT_FOUND / NOT_FOUND / INVALID_ID — impossible to recover
          // HOLE_NOT_COMPLETE stays transient — it resolves as soon as the
          // outstanding score entry for that hole drains.
          const terminal =
            msg === 'ROUND_FINALIZED' ||
            msg === 'ROUND_NOT_ACTIVE' ||
            msg === 'PLAYER_NOT_ON_ROUND' ||
            msg === 'INVALID_ENTRY_CODE' ||
            msg === 'CTP_NOT_ACTIVE' ||
            msg === 'VALIDATION_ERROR' ||
            msg === 'INVALID_HOLE' ||
            msg === 'GROUP_NOT_FOUND' ||
            msg === 'NOT_FOUND' ||
            msg === 'INVALID_ID';
          if (terminal && ctp.id !== undefined) {
            await removeCtpFromQueue(ctp.id);
            setPendingCount((prev) => Math.max(0, prev - 1));
          }
          anyFailure = true;
          // Continue with remaining CTP entries — one stuck entry shouldn't
          // block others. (Unlike the score drain, CTP entries are
          // genuinely independent — no cross-entry invariants to preserve.)
        }
      }
    } catch {
      // getCtpQueue failed — IDB read error. Try again next drain.
      anyFailure = true;
    }

      if (anyFailure) {
        setDrainError('Sync failed — will retry when connection is restored.');
      }

      // Invalidate relevant TanStack Query caches so UI reflects synced data,
      // even on partial-success paths.
      try {
        await queryClient.invalidateQueries({ queryKey: ['scores', roundId, groupId] });
        await queryClient.invalidateQueries({ queryKey: ['wolf-decisions', roundId, groupId] });
        await queryClient.invalidateQueries({ queryKey: ['ctp-entries', roundId] });
      } catch {
        // Query invalidation is best-effort.
      }
    } finally {
      // Always release the drain lock — even if an escaping exception slipped
      // past both per-queue try/catch blocks. Without this, isDrainingRef
      // would stick to `true` and every subsequent drain() call would return
      // early, leaving the queue frozen until page reload.
      isDrainingRef.current = false;
      setIsDraining(false);
      await refreshCount();
    }
  }, [roundId, groupId, queryClient, refreshCount]);

  // Load initial count on mount
  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  // Auto-drain when connectivity is restored (foreground sync — primary iOS path)
  useEffect(() => {
    const handleOnline = () => {
      void drain();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [drain]);

  return { pendingCount, isDraining, drainError, drain, refreshCount };
}
