import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getQueue, removeFromQueue, getQueueCount } from '@/lib/offline-queue';
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
    const count = await getQueueCount(roundId, groupId);
    setPendingCount(count);
  }, [roundId, groupId]);

  const drain = useCallback(async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    setIsDraining(true);
    setDrainError(null);

    try {
      // getQueue() returns entries sorted by holeNumber ASC — drain order is guaranteed
      const entries = await getQueue();

      for (const entry of entries) {
        // 1. POST scores (idempotent — onConflictDoUpdate on round_id, player_id, hole_number)
        await apiFetch(
          `/rounds/${entry.roundId}/groups/${entry.groupId}/holes/${entry.holeNumber}/scores`,
          {
            method: 'POST',
            headers: entry.entryCode ? { 'x-entry-code': entry.entryCode } : {},
            body: JSON.stringify({ scores: entry.scores }),
          },
        );

        // 2. POST wolf decision if bundled (idempotent — onConflictDoUpdate on round_id, group_id, hole_number)
        if (entry.wolfDecision && entry.autoCalculateMoney) {
          const { decision, partnerId, greenies, polies } = entry.wolfDecision;
          const body: Record<string, unknown> = { greenies, polies };
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

        // 3. Remove from queue only after both succeed
        await removeFromQueue(entry.id!);
        setPendingCount((prev) => Math.max(0, prev - 1));
      }

      // Invalidate relevant TanStack Query caches so UI reflects synced data
      await queryClient.invalidateQueries({ queryKey: ['scores', roundId, groupId] });
      await queryClient.invalidateQueries({ queryKey: ['wolf-decisions', roundId, groupId] });
    } catch {
      setDrainError('Sync failed — will retry when connection is restored.');
    } finally {
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
