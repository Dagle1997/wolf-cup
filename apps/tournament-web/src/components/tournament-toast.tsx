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

import { useCallback, useEffect, useState } from 'react';
import { useActivityStream } from '../hooks/use-activity-feed';
import type { ActivityRow } from '../providers/activity-feed-provider';

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

function nameForUnderPar(toPar: number): string {
  if (toPar <= -4) return 'condor';
  if (toPar === -3) return 'albatross';
  if (toPar === -2) return 'eagle';
  if (toPar === -1) return 'birdie';
  return 'under par';
}

function buildHeadline(row: ActivityRow): string {
  const ev = row.event;
  switch (ev.type) {
    case 'score.committed': {
      const playerId = String(ev['playerId']);
      const grossStrokes = Number(ev['grossStrokes']);
      const holeNumber = Number(ev['holeNumber']);
      const toPar = Number(ev['toPar']);
      return `🐦 ${playerId} scored ${grossStrokes} on hole ${holeNumber} — ${nameForUnderPar(toPar)}!`;
    }
    case 'press.auto_fired': {
      const triggerHole = Number(ev['triggerHole']);
      const team = String(ev['team'] ?? 'team');
      const multiplier = Number(ev['multiplier']);
      return `⚡ Auto-press fired on hole ${triggerHole}: ${team} (${multiplier}x)`;
    }
    case 'press.manual_fired': {
      const fromHole = Number(ev['fromHole']);
      const team = String(ev['team']);
      const multiplier = Number(ev['multiplier']);
      return `🎯 ${team} pressed from hole ${fromHole} (${multiplier}x)`;
    }
    case 'award.triggered': {
      const awardType = String(ev['awardType']);
      const ctx = ev['context'] as { holeNumber?: number } | undefined;
      const holeNumber = ctx?.holeNumber ?? '?';
      const label = awardType === 'first_eagle_of_event' ? 'eagle' : 'birdie';
      return `🦅 First ${label} of the trip — hole ${holeNumber}!`;
    }
    default:
      return `Activity: ${ev.type}`;
  }
}

export function TournamentToast() {
  const [entries, setEntries] = useState<ToastEntry[]>([]);

  const handler = useCallback((newRows: ActivityRow[]) => {
    const qualifying = newRows
      .filter(isQualifyingType)
      .map((row) => ({
        rowId: row.id,
        headline: buildHeadline(row),
        arrivedAt: Date.now(),
      }));
    if (qualifying.length === 0) return;
    setEntries((prev) => {
      // Dedupe by rowId — defensive against any edge case where the
      // same row arrives twice (cursor refetch race, etc.).
      const seen = new Set(prev.map((e) => e.rowId));
      const fresh = qualifying.filter((e) => !seen.has(e.rowId));
      return [...prev, ...fresh];
    });
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
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: '0.6rem 0.9rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            fontSize: '0.95rem',
            color: '#222',
          }}
        >
          {entry.headline}
        </div>
      ))}
    </div>
  );
}
