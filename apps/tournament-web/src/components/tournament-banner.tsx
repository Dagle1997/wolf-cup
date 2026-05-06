/**
 * T8-2 TournamentBanner — persist-until-ack activity-feed banner.
 *
 * Subscribes to useActivityStream. Filters to money-affecting types:
 *   - press.auto_fired
 *   - press.manual_fired
 *   - rule_set.revised
 *   - round.finalized
 *
 * Persists until tapped Dismiss. Dismissed activity IDs persist to
 * localStorage under `tournament:banner-dismissed:<eventId>` so a
 * page refresh does not resurrect them.
 *
 * Storm collapse: ≥3 banner-eligible events arriving within a 5-second
 * window (anchored on the first event) collapse into a single summary
 * banner. Tapping expands a modal listing all N events; dismissing the
 * summary marks all N as dismissed atomically.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActivityStream } from '../hooks/use-activity-feed';
import type { ActivityRow } from '../providers/activity-feed-provider';

const STORM_WINDOW_MS = 5_000;
const STORM_THRESHOLD = 3;

const ELIGIBLE_TYPES = new Set([
  'press.auto_fired',
  'press.manual_fired',
  'rule_set.revised',
  'round.finalized',
]);

type BannerEntry = {
  rowId: string;
  type: string;
  headline: string;
  arrivedAt: number;
};

function buildBannerHeadline(row: ActivityRow): string {
  const ev = row.event;
  switch (ev.type) {
    case 'press.auto_fired':
      return `Auto-press fired (hole ${ev['triggerHole']}, ${String(ev['team'])} ${ev['multiplier']}x)`;
    case 'press.manual_fired':
      return `${String(ev['team'])} pressed from hole ${ev['fromHole']} (${ev['multiplier']}x)`;
    case 'rule_set.revised':
      return 'Rule set revised';
    case 'round.finalized':
      return 'Round finalized';
    default:
      return `Activity: ${ev.type}`;
  }
}

function dismissedKey(eventId: string): string {
  return `tournament:banner-dismissed:${eventId}`;
}

function loadDismissedSet(eventId: string | null): Set<string> {
  if (eventId === null) return new Set();
  try {
    const raw = localStorage.getItem(dismissedKey(eventId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { ids?: string[] };
    return new Set(parsed.ids ?? []);
  } catch {
    return new Set();
  }
}

function persistDismissedSet(eventId: string | null, set: Set<string>): void {
  if (eventId === null) return;
  try {
    localStorage.setItem(
      dismissedKey(eventId),
      JSON.stringify({ ids: Array.from(set) }),
    );
  } catch {
    // localStorage unavailable (private mode); dismissal is session-only.
  }
}

function readEventIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(
    /\/events\/([A-Za-z0-9_-]{16,128})(?=\/|$)/,
  );
  return m?.[1] ?? null;
}

export function TournamentBanner() {
  const [eventId] = useState<string | null>(() => readEventIdFromUrl());
  // pendingBatch is read inside callbacks via the functional setState
  // form; we don't need to destructure the current value here.
  const [, setPendingBatch] = useState<BannerEntry[]>([]);
  const [stormFired, setStormFired] = useState<BannerEntry[] | null>(null);
  const [individualBanners, setIndividualBanners] = useState<BannerEntry[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    loadDismissedSet(eventId),
  );
  const [stormModalOpen, setStormModalOpen] = useState(false);
  const stormTimerRef = useRef<number | null>(null);

  const flushStorm = useCallback(() => {
    setPendingBatch((batch) => {
      if (batch.length >= STORM_THRESHOLD) {
        setStormFired(batch);
      } else {
        // Below threshold — flush as individual banners.
        setIndividualBanners((prev) => [...prev, ...batch]);
      }
      stormTimerRef.current = null;
      return [];
    });
  }, []);

  const handler = useCallback(
    (newRows: ActivityRow[]) => {
      const eligible = newRows
        .filter((r) => ELIGIBLE_TYPES.has(r.event.type))
        .map((r) => ({
          rowId: r.id,
          type: r.event.type,
          headline: buildBannerHeadline(r),
          arrivedAt: Date.now(),
        }))
        .filter((e) => !dismissed.has(e.rowId));
      if (eligible.length === 0) return;
      setPendingBatch((prev) => [...prev, ...eligible]);
      // Anchor a 5s window on the FIRST event in the batch — start
      // timer if none running.
      if (stormTimerRef.current === null) {
        stormTimerRef.current = window.setTimeout(flushStorm, STORM_WINDOW_MS);
      }
    },
    [dismissed, flushStorm],
  );

  useActivityStream(handler);

  // Cleanup the storm timer on unmount.
  useEffect(() => {
    return () => {
      if (stormTimerRef.current !== null) {
        window.clearTimeout(stormTimerRef.current);
        stormTimerRef.current = null;
      }
    };
  }, []);

  const handleDismissIndividual = useCallback(
    (rowId: string) => {
      setIndividualBanners((prev) => prev.filter((e) => e.rowId !== rowId));
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(rowId);
        persistDismissedSet(eventId, next);
        return next;
      });
    },
    [eventId],
  );

  const handleDismissStorm = useCallback(() => {
    if (stormFired === null) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const e of stormFired) next.add(e.rowId);
      persistDismissedSet(eventId, next);
      return next;
    });
    setStormFired(null);
    setStormModalOpen(false);
  }, [stormFired, eventId]);

  const visibleIndividuals = useMemo(
    () => individualBanners.filter((e) => !dismissed.has(e.rowId)),
    [individualBanners, dismissed],
  );

  if (visibleIndividuals.length === 0 && stormFired === null) return null;

  return (
    <div
      data-testid="tournament-banner-stack"
      role="region"
      aria-label="Activity banners"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1050,
      }}
    >
      {stormFired !== null && (
        <div
          data-testid="tournament-banner-storm"
          style={{
            background: '#fff',
            border: '1px solid #c80',
            borderRadius: 8,
            padding: '0.6rem 0.9rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}
        >
          <span data-testid="tournament-banner-storm-summary">
            {stormFired.length} updates ({summarizeTypes(stormFired)}) — tap to review
          </span>
          <button
            type="button"
            data-testid="tournament-banner-storm-expand"
            onClick={() => setStormModalOpen((v) => !v)}
            style={{ marginLeft: 8 }}
          >
            {stormModalOpen ? 'Hide' : 'Review'}
          </button>
          <button
            type="button"
            data-testid="tournament-banner-storm-dismiss"
            onClick={handleDismissStorm}
            style={{ marginLeft: 8 }}
          >
            Dismiss all
          </button>
          {stormModalOpen && (
            <ul data-testid="tournament-banner-storm-modal" style={{ marginTop: 8 }}>
              {stormFired.map((e) => (
                <li key={e.rowId} data-testid="tournament-banner-storm-modal-entry">
                  {e.headline}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {visibleIndividuals.map((entry) => (
        <div
          key={entry.rowId}
          data-testid="tournament-banner-entry"
          style={{
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: '0.6rem 0.9rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{entry.headline}</span>
          <button
            type="button"
            data-testid={`tournament-banner-dismiss-${entry.rowId}`}
            onClick={() => handleDismissIndividual(entry.rowId)}
            style={{ marginLeft: 8 }}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

function summarizeTypes(entries: BannerEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const labels: Record<string, string> = {
    'press.auto_fired': 'press',
    'press.manual_fired': 'press',
    'rule_set.revised': 'rule-edit',
    'round.finalized': 'round-finalized',
  };
  // Group by label (presses collapse together).
  const labelCounts = new Map<string, number>();
  for (const [type, count] of counts) {
    const label = labels[type] ?? type;
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + count);
  }
  return Array.from(labelCounts.entries())
    .map(([label, count]) => `${label} ×${count}`)
    .join(', ');
}
