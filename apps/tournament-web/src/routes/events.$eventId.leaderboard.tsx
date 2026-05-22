/**
 * T5-5 cross-group stroke-play leaderboard page.
 *
 * Route: /events/:eventId/leaderboard
 *
 * Polls `GET /api/events/:eventId/leaderboard?round=<value>` every 15s via
 * TanStack Query (NFR-P2 30s propagation envelope, halved to land within
 * one poll). Auth guard mirrors /me + /admin/* loader pattern: anonymous
 * → window.location.assign('/api/auth/google'); 403 (non-participant) is
 * caught at fetch level and rendered as inline forbidden.
 *
 * AC-5 round selector: v1 ships a TWO-option toggle (Current round /
 * All rounds (event)) rather than a full per-round dropdown. A
 * per-round dropdown requires an `event-rounds list` endpoint that does
 * not yet exist; building it is explicitly out of scope (followup
 * T5-5d). When that endpoint lands, the toggle becomes a select.
 *
 * Dual-export: `Route` for TanStack file-route registration AND
 * `LeaderboardPage` for direct test rendering.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { ScrollableTable } from '../components/scrollable-table';

// ---- Types ----------------------------------------------------------------

type LeaderboardRow = {
  playerId: string;
  playerName: string;
  handicapIndex: number | null;
  grossThroughHole: number | null;
  netThroughHole: number | null;
  throughHole: number;
  rank: number;
  tiedWith: number;
  /** T6-14: skins pot share across finalized rounds. Null until any finalize. */
  skinsCents: number | null;
};

type RoundSummary = {
  id: string;
  eventRoundId: string | null;
  name: string;
  status: string | null;
};

type LeaderboardResponse = {
  rows: LeaderboardRow[];
  round: RoundSummary | null;
  scope: 'round' | 'event';
  computedAt: string;
};

type FetchOutcome =
  | { kind: 'ok'; data: LeaderboardResponse }
  | { kind: 'forbidden' }
  | { kind: 'unknown_event' };

type ScopeMode = 'current' | 'event';

// ---- Auth-status loader (mirror /me) --------------------------------------


// ---- Leaderboard fetcher --------------------------------------------------

async function fetchLeaderboard(
  eventId: string,
  scope: ScopeMode,
): Promise<FetchOutcome> {
  const url =
    scope === 'event'
      ? `/api/events/${eventId}/leaderboard`
      : `/api/events/${eventId}/leaderboard?round=current`;
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 403) return { kind: 'forbidden' };
  if (res.status === 404) return { kind: 'unknown_event' };
  if (!res.ok) {
    throw new Error(`leaderboard_fetch_failed_${res.status}`);
  }
  const body = (await res.json()) as LeaderboardResponse;
  return { kind: 'ok', data: body };
}

// ---- Helpers --------------------------------------------------------------

function rankCell(row: LeaderboardRow): string {
  if (row.tiedWith > 1) return `T-${row.rank}`;
  return String(row.rank);
}

function formatHandicap(hi: number | null): string {
  if (hi === null) return '—';
  return hi.toFixed(1);
}

function formatScore(value: number | null): string {
  if (value === null) return '—';
  return String(value);
}

/**
 * T6-14: format skinsCents for display. Null → `—` (with tooltip semantics
 * via the parent <td title="…">). Integer cents → formatCents.
 */
function formatSkins(cents: number | null): string {
  if (cents === null) return '—';
  // Use a small inline formatter to avoid cross-package import; mirrors
  // tournament-web/lib/format-cents.ts. Positive only (skins is winnings,
  // not signed money).
  if (!Number.isFinite(cents)) return '—';
  const dollars = Math.floor(cents / 100);
  const remainder = cents % 100;
  return `$${dollars}.${remainder.toString().padStart(2, '0')}`;
}

// ---- Component ------------------------------------------------------------

export type LeaderboardPageProps = { eventId: string };

import { useState } from 'react';

export function LeaderboardPage({ eventId }: LeaderboardPageProps) {
  const [scope, setScope] = useState<ScopeMode>('current');

  const query = useQuery<FetchOutcome>({
    queryKey: ['eventLeaderboard', eventId, scope],
    queryFn: () => fetchLeaderboard(eventId, scope),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  if (query.isPending) {
    return (
      <PageShell title="Leaderboard">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <LoadingCard />
      </PageShell>
    );
  }

  if (query.isError) {
    return (
      <PageShell title="Leaderboard">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Couldn't load the leaderboard."
          error={query.error}
          onRetry={query.refetch}
        />
      </PageShell>
    );
  }

  const outcome = query.data!;

  if (outcome.kind === 'forbidden') {
    return (
      <PageShell title="Leaderboard">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard
          title="Not a participant"
          error="You aren't a participant in this event."
        />
      </PageShell>
    );
  }

  if (outcome.kind === 'unknown_event') {
    return (
      <PageShell title="Leaderboard">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ErrorCard title="Event not found" error="Event not found." />
      </PageShell>
    );
  }

  const data = outcome.data;
  const allUnscored = data.rows.every((r) => r.grossThroughHole === null);

  return (
    <PageShell title="Leaderboard">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      <div>
        <label htmlFor="scope-select">Scope: </label>
        <select
          id="scope-select"
          value={scope}
          onChange={(e) => setScope(e.target.value as ScopeMode)}
        >
          <option value="current">Current round</option>
          <option value="event">All rounds (event)</option>
        </select>
      </div>
      {data.round !== null ? (
        <p>
          {data.round.name}
          {data.round.status !== null ? ` — ${data.round.status}` : ''}
        </p>
      ) : data.scope === 'event' ? (
        <p>All rounds aggregated.</p>
      ) : (
        <p>No rounds yet.</p>
      )}
      {data.rows.length === 0 ? (
        <EmptyState title="No participants yet." />
      ) : allUnscored ? (
        <EmptyState title="No scores yet." />
      ) : (
        <ScrollableTable label="Leaderboard"><table>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Player</th>
              <th scope="col">HCP</th>
              <th scope="col">Thru</th>
              <th scope="col">Gross</th>
              <th scope="col">Net</th>
              <th scope="col" title="Skins compute on round finalize">Skins</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.playerId}>
                <td>{rankCell(row)}</td>
                <td>{row.playerName}</td>
                <td>{formatHandicap(row.handicapIndex)}</td>
                <td>{row.throughHole}</td>
                <td>{formatScore(row.grossThroughHole)}</td>
                <td>{formatScore(row.netThroughHole)}</td>
                <td
                  title={
                    row.skinsCents === null
                      ? 'Skins compute on round finalize'
                      : undefined
                  }
                >
                  {formatSkins(row.skinsCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table></ScrollableTable>
      )}
    </PageShell>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/leaderboard')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <LeaderboardPage eventId={eventId} />;
}
