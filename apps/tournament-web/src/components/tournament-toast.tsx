/**
 * T8-2 TournamentToast — transient activity-feed toast surface.
 *
 * Subscribes to useActivityStream. Filters to qualifying types:
 *   - score.committed where isBirdieOrBetter === true
 *   - press.auto_fired
 *   - press.manual_fired
 *   - award.triggered
 *
 * Each qualifying event spawns a card that auto-dismisses 6s after
 * arrival. Multiple cards stack vertically; oldest at the bottom.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useActivityStream } from '../hooks/use-activity-feed';
import type { ActivityRow } from '../providers/activity-feed-provider';
import { buildActivityHeadline } from '../lib/activity-headline';

const TOAST_TTL_MS = 6_000;

type ToastEntry = {
  rowId: string;
  headline: string;
  arrivedAt: number;
};

function isQualifyingType(row: ActivityRow): boolean {
  const t = row.event.type;
  if (t === 'press.auto_fired') return true;
  if (t === 'press.manual_fired') return true;
  if (t === 'award.triggered') return true;
  if (t === 'score.committed') {
    return row.event['isBirdieOrBetter'] === true;
  }
  return false;
}

// T8-3: headline string-building consolidated into the shared helper at
// `lib/activity-headline.ts` (Toast/Banner/Feed all consume it).

export function TournamentToast() {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  // When this surface mounted. We only toast events that happened AFTER this —
  // the provider replays the activity backlog on page open / refresh, and toasting
  // a pile of old birdies (that then never clear) is the "stuck feed" bug.
  const mountedAtRef = useRef(Date.now());
  // Every rowId we've ever processed — a toast NEVER re-fires for the same event,
  // even if a poll re-delivers it after it auto-dismissed.
  const seenRef = useRef<Set<string>>(new Set());

  const handler = useCallback((newRows: ActivityRow[]) => {
    const toAdd: ToastEntry[] = [];
    for (const row of newRows) {
      if (seenRef.current.has(row.id)) continue;
      seenRef.current.add(row.id);
      // Skip the backlog: only LIVE events (created after mount) toast.
      if (row.createdAt < mountedAtRef.current) continue;
      if (!isQualifyingType(row)) continue;
      toAdd.push({
        rowId: row.id,
        headline: buildActivityHeadline(row, 'toast'),
        arrivedAt: Date.now(),
      });
    }
    if (toAdd.length === 0) return;
    setEntries((prev) => [...prev, ...toAdd]);
  }, []);

  useActivityStream(handler);

  // Auto-dismiss tick — checks once per 500ms and removes expired entries.
  // Cheaper than setTimeout-per-entry which would fire-and-forget timers
  // through unmount races.
  useEffect(() => {
    if (entries.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setEntries((prev) => prev.filter((e) => now - e.arrivedAt < TOAST_TTL_MS));
    }, 500);
    return () => window.clearInterval(id);
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div
      data-testid="tournament-toast-stack"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1100,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      {entries.map((entry) => (
        <div
          key={entry.rowId}
          data-testid="tournament-toast-entry"
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '0.6rem 0.9rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            fontSize: '0.95rem',
            color: 'var(--color-text-primary)',
          }}
        >
          {entry.headline}
        </div>
      ))}
    </div>
  );
}
