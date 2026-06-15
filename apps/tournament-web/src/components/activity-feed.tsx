/**
 * T8-3 player-home activity feed. Reverse-chronological scrollable
 * list of activity rows from the T8-2 ActivityFeedProvider context.
 *
 * Two-stage Load more:
 *   1. If visibleCount < rows.length → reveal more locally (no fetch).
 *   2. Else if cursorBefore !== null → call provider.loadMore() to
 *      fetch via ?before= and append to provider rows[].
 *   3. Else → button hidden (end of history).
 *
 * Synchronous re-entry guard via loadingMoreRef in addition to the
 * loadingMore state — defends against rapid double-clicks before the
 * setState commits the disabled appearance.
 *
 * Player-name hydration is deferred to v1.5 — `playerId` etc. render
 * as raw IDs.
 */

import { useCallback, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useActivityFeed } from '../hooks/use-activity-feed';
import type { ActivityRow } from '../providers/activity-feed-provider';
import { buildActivityHeadline } from '../lib/activity-headline';

const PAGE_SIZE = 20;

// ---- Icon per type --------------------------------------------------------

const ICON_BY_TYPE: Record<string, string> = {
  'score.committed': '🏌️',
  'score.corrected': '✏️',
  'scorer.transferred': '🔄',
  'round.finalized': '✅',
  'round.cancelled': '✖️',
  'press.auto_fired': '⚡',
  'press.manual_fired': '🎯',
  'press.manual_undone': '↩️',
  'bet.created': '🤝',
  'rule_set.revised': '📋',
  'subgame.computed': '💰',
  'gallery.uploaded': '📷',
  'award.triggered': '🏆',
};

function iconFor(type: string): string {
  return ICON_BY_TYPE[type] ?? '·';
}

// ---- Relative time --------------------------------------------------------

function relativeTime(createdAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - createdAt) / 1000));
  if (seconds <= 30) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---- Tap routing ----------------------------------------------------------

type RouteSpec =
  | { kind: 'event'; to: '/events/$eventId/leaderboard' | '/events/$eventId/money' | '/events/$eventId/bets' | '/events/$eventId/gallery' }
  | { kind: 'round'; to: '/rounds/$roundId/score-entry' }
  | { kind: 'none' };

function routeForType(type: string): RouteSpec {
  switch (type) {
    case 'score.committed':
    case 'score.corrected':
    case 'round.finalized':
    case 'rule_set.revised':
    case 'award.triggered':
      return { kind: 'event', to: '/events/$eventId/leaderboard' };
    case 'press.auto_fired':
    case 'press.manual_fired':
    case 'press.manual_undone':
    case 'subgame.computed':
      return { kind: 'event', to: '/events/$eventId/money' };
    case 'bet.created':
      return { kind: 'event', to: '/events/$eventId/bets' };
    case 'gallery.uploaded':
      return { kind: 'event', to: '/events/$eventId/gallery' };
    case 'scorer.transferred':
      return { kind: 'round', to: '/rounds/$roundId/score-entry' };
    case 'round.cancelled':
    default:
      return { kind: 'none' };
  }
}

// ---- Row sub-component ----------------------------------------------------

function FeedRow({ row, nowMs }: { row: ActivityRow; nowMs: number }) {
  const icon = iconFor(row.event.type);
  const headline = buildActivityHeadline(row, 'feed');
  const time = relativeTime(row.createdAt, nowMs);
  const route = routeForType(row.event.type);

  const inner = (
    <>
      <span data-testid="activity-feed-row-icon" aria-hidden="true">
        {icon}
      </span>
      <span data-testid="activity-feed-row-headline">{headline}</span>
      <span data-testid="activity-feed-row-time" style={{ opacity: 0.7 }}>
        {time}
      </span>
    </>
  );

  if (route.kind === 'event') {
    const eventId = String(row.event.eventId);
    return (
      <Link
        data-testid="activity-feed-row"
        data-row-id={row.id}
        to={route.to}
        params={{ eventId }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0.5rem 0',
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        {inner}
      </Link>
    );
  }
  if (route.kind === 'round') {
    const roundIdRaw = row.event['roundId'];
    // Defense-in-depth: only emit a Link if roundId is a non-empty
    // string. T8-1's Zod schema requires it for scorer.transferred,
    // but a future relaxation or a bypass-the-emitter path could
    // produce a row without one. Falling through to the non-link
    // render keeps the row in the historical record without
    // generating a malformed `/rounds//score-entry` URL. (codex
    // impl-codex round-1 High #1.)
    if (typeof roundIdRaw === 'string' && roundIdRaw.length > 0) {
      return (
        <Link
          data-testid="activity-feed-row"
          data-row-id={row.id}
          to={route.to}
          params={{ roundId: roundIdRaw }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0.5rem 0',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          {inner}
        </Link>
      );
    }
    // Fall through to non-link plain <div>.
  }
  // Non-routable types (round.cancelled) render as a plain div.
  return (
    <div
      data-testid="activity-feed-row"
      data-row-id={row.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0.5rem 0',
      }}
    >
      {inner}
    </div>
  );
}

// ---- ActivityFeed component -----------------------------------------------

export function ActivityFeed() {
  const { rows, cursorBefore, loadMore } = useActivityFeed();
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const loadingMoreRef = useRef<boolean>(false);
  const nowMs = Date.now();

  const onLoadMoreClick = useCallback(async () => {
    if (loadingMoreRef.current) return; // synchronous re-entry guard
    if (visibleCount < rows.length) {
      setVisibleCount((v) => Math.min(v + PAGE_SIZE, rows.length));
      return;
    }
    if (cursorBefore === null) return; // end of history
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      await loadMore();
      setVisibleCount((v) => v + PAGE_SIZE); // sliced via min(v, rows.length) at render
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [visibleCount, rows.length, cursorBefore, loadMore]);

  if (rows.length === 0) {
    return (
      <div
        data-testid="activity-feed-empty"
        role="status"
        style={{ padding: '1rem 0', color: 'var(--color-text-muted)', fontStyle: 'italic' }}
      >
        Activity will show here once scoring starts.
      </div>
    );
  }

  const visibleRows = rows.slice(0, Math.min(visibleCount, rows.length));
  const hasMoreLocally = visibleCount < rows.length;
  const hasMoreRemote = cursorBefore !== null;
  const showLoadMoreButton = hasMoreLocally || hasMoreRemote;

  return (
    <section data-testid="activity-feed" aria-label="What's Happening">
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>What&apos;s Happening</h2>
      <ul
        data-testid="activity-feed-list"
        style={{ listStyle: 'none', padding: 0, margin: 0 }}
      >
        {visibleRows.map((row) => (
          <li key={row.id}>
            <FeedRow row={row} nowMs={nowMs} />
          </li>
        ))}
      </ul>
      {showLoadMoreButton && (
        <button
          type="button"
          data-testid="activity-feed-load-more"
          onClick={onLoadMoreClick}
          disabled={loadingMore}
          style={{
            marginTop: 8,
            padding: '0.4rem 0.8rem',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            background: 'var(--color-surface)',
            cursor: loadingMore ? 'progress' : 'pointer',
          }}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
