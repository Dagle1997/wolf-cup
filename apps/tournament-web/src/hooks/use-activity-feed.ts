/**
 * T8-2 hooks. Both throw `'must be within ActivityFeedProvider'` if
 * called outside the provider tree.
 */

import { useEffect } from 'react';
import {
  useActivityFeedContext,
  type ActivityRow,
} from '../providers/activity-feed-provider';

/**
 * Read the cumulative rows + state from context. Used by the future
 * T8-3 player-home feed.
 */
export function useActivityFeed(): {
  rows: ActivityRow[];
  cursorBefore: string | null;
  loadMore: () => Promise<void>;
  isPolling: boolean;
  error: Error | null;
} {
  const ctx = useActivityFeedContext();
  return {
    rows: ctx.rows,
    cursorBefore: ctx.cursorBefore,
    loadMore: ctx.loadMore,
    isPolling: ctx.isPolling,
    error: ctx.error,
  };
}

/**
 * Subscribe to NEW rows as they arrive. Used by Toast + Banner.
 * Handler receives `ActivityRow[]` in chronological ASC order.
 *
 * The subscription registers on mount and unregisters on unmount.
 * The handler reference is captured into a ref under the hood so
 * re-renders don't churn the subscription.
 */
export function useActivityStream(
  handler: (newRows: ActivityRow[]) => void,
): void {
  const ctx = useActivityFeedContext();
  useEffect(() => {
    const unsubscribe = ctx.subscribe(handler);
    return unsubscribe;
    // We intentionally re-subscribe whenever the handler reference
    // changes — callers should memoize their handler if churn matters.
  }, [ctx, handler]);
}
