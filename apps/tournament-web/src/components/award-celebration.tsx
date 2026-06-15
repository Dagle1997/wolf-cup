/**
 * T8-4 AwardCelebration — full-screen overlay (eagle) or corner
 * animation (birdie) for the affected player when an `award.triggered`
 * activity event fires.
 *
 * Subscribes to useActivityStream for live events; ALSO scans the
 * provider's `rows` on auth-resolve to catch events that arrived
 * before auth resolved (codex spec round-1 High #5).
 *
 * Affected-player gate: `event.playerId === session.player.id`. Other
 * players see the activity in toast/feed; only the affected player
 * gets the full-screen moment.
 *
 * Auto-dismiss after 4 seconds. When eagle and birdie are both
 * pending, eagle wins (spec round-1 Med #6) and the most recent
 * eagle is rendered (spec round-2 Med #2).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useActivityFeed, useActivityStream } from '../hooks/use-activity-feed';
import type { ActivityRow } from '../providers/activity-feed-provider';
import { useAuthSession } from '../hooks/use-auth-session';

const ANIMATION_TTL_MS = 4_000;

type AwardType = 'first_birdie_of_event' | 'first_eagle_of_event';

type CelebrationEntry = {
  rowId: string;
  awardType: AwardType;
  arrivedAt: number;
};

export function AwardCelebration() {
  const session = useAuthSession();
  const { rows } = useActivityFeed();
  const myPlayerId = session.player?.id ?? null;
  const [entries, setEntries] = useState<CelebrationEntry[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Auth-resolve catchup. When myPlayerId transitions from null → a
  // real id, scan provider rows for unsurfaced matching awards within
  // the animation TTL. Without this, an award arriving BEFORE auth
  // resolves would be permanently missed (codex spec round-1 High #5).
  useEffect(() => {
    if (myPlayerId === null) return;
    const now = Date.now();
    const fresh: CelebrationEntry[] = [];
    for (const r of rows) {
      if (seenIdsRef.current.has(r.id)) continue;
      if (r.event.type !== 'award.triggered') continue;
      if (r.event['playerId'] !== myPlayerId) continue;
      // Only catch up rows that arrived within the animation TTL.
      // Older rows would be a stale celebration the player has since
      // seen via the feed — not worth re-celebrating.
      if (now - r.createdAt > ANIMATION_TTL_MS) continue;
      const at = r.event['awardType'];
      if (at !== 'first_birdie_of_event' && at !== 'first_eagle_of_event') {
        continue; // Skip unknown award types.
      }
      seenIdsRef.current.add(r.id);
      fresh.push({
        rowId: r.id,
        awardType: at,
        arrivedAt: r.createdAt,
      });
    }
    if (fresh.length === 0) return;
    setEntries((prev) => [...prev, ...fresh]);
  }, [myPlayerId, rows]);

  const handler = useCallback((newRows: ActivityRow[]) => {
    if (myPlayerId === null) return;
    const now = Date.now();
    const mine: CelebrationEntry[] = [];
    for (const r of newRows) {
      if (seenIdsRef.current.has(r.id)) continue;
      if (r.event.type !== 'award.triggered') continue;
      if (r.event['playerId'] !== myPlayerId) continue;
      // TTL gate matches the catchup-effect (codex party-codex round-1
      // Med #1). The stream normally only delivers freshly-emitted
      // rows, but a future backfill replay or burst-drop edge could
      // surface older rows; clamp to ANIMATION_TTL_MS so a stale
      // award doesn't trigger a misleading celebration.
      if (now - r.createdAt > ANIMATION_TTL_MS) continue;
      const at = r.event['awardType'];
      if (at !== 'first_birdie_of_event' && at !== 'first_eagle_of_event') {
        continue;
      }
      seenIdsRef.current.add(r.id);
      mine.push({
        rowId: r.id,
        awardType: at,
        // Use the row's createdAt (server timestamp) for parity with
        // the catchup-effect — keeps the eagle-priority "most recent
        // by arrivedAt" comparison apples-to-apples between the two
        // entry sources.
        arrivedAt: r.createdAt,
      });
    }
    if (mine.length === 0) return;
    setEntries((prev) => [...prev, ...mine]);
  }, [myPlayerId]);

  useActivityStream(handler);

  // Auto-dismiss tick (250ms granularity).
  useEffect(() => {
    if (entries.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setEntries((prev) => prev.filter((e) => now - e.arrivedAt < ANIMATION_TTL_MS));
    }, 250);
    return () => window.clearInterval(id);
  }, [entries.length]);

  if (entries.length === 0) return null;

  // Eagle priority: pick the eagle with the highest arrivedAt timestamp
  // if any, else the entry with the highest arrivedAt overall. Sort by
  // time directly rather than relying on insertion order — the catchup
  // effect can push older rows from the rows[] cache AFTER newer
  // stream events were already in entries[], so insertion order alone
  // is unreliable. (codex impl-codex round-1 Med #1.)
  const eagles = entries.filter((e) => e.awardType === 'first_eagle_of_event');
  const pool = eagles.length > 0 ? eagles : entries;
  const entry = pool.reduce((acc, e) => (e.arrivedAt > acc.arrivedAt ? e : acc));
  const isEagle = entry.awardType === 'first_eagle_of_event';

  return isEagle ? (
    <FullScreenEagleOverlay rowId={entry.rowId} />
  ) : (
    <CornerBirdieAnimation rowId={entry.rowId} />
  );
}

// ---- Visual components -----------------------------------------------------

function FullScreenEagleOverlay({ rowId }: { rowId: string }) {
  return (
    <div
      data-testid="award-celebration-eagle"
      data-row-id={rowId}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1300,
        animation: 'fadeIn 0.2s ease-out',
        color: '#fff',
        textAlign: 'center',
        padding: '0 1rem',
      }}
    >
      <div style={{ fontSize: '4rem', marginBottom: 8 }}>🦅</div>
      <h2 style={{ fontSize: '1.6rem', margin: '0.25rem 0' }}>Eagle!</h2>
      <p style={{ margin: 0, opacity: 0.9 }}>First eagle of the trip — congrats!</p>
    </div>
  );
}

function CornerBirdieAnimation({ rowId }: { rowId: string }) {
  return (
    <div
      data-testid="award-celebration-birdie"
      data-row-id={rowId}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        background: 'var(--color-surface)',
        border: '2px solid var(--color-money-pos)',
        borderRadius: 8,
        padding: '0.6rem 0.9rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: 1300,
        animation: 'slideInLeft 0.2s ease-out',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: '1.6rem' }}>🐦</span>
      <span>
        <strong>Birdie!</strong> First of the trip — congrats!
      </span>
    </div>
  );
}
