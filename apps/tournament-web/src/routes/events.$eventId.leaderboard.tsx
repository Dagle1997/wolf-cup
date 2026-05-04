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
import { queryClient } from '../lib/query-client';

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

type AuthStatus = { player: null | { id: string; isOrganizer: boolean } };

function validateAuthStatus(body: unknown): AuthStatus {
  if (body === null || typeof body !== 'object') return { player: null };
  const p = (body as { player?: unknown }).player;
  if (p === null) return { player: null };
  if (
    p !== null &&
    typeof p === 'object' &&
    typeof (p as { id?: unknown }).id === 'string' &&
    typeof (p as { isOrganizer?: unknown }).isOrganizer === 'boolean'
  ) {
    return {
      player: {
        id: (p as { id: string }).id,
        isOrganizer: (p as { isOrganizer: boolean }).isOrganizer,
      },
    };
  }
  return { player: null };
}

async function loadAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status').catch(() => null);
  if (res === null || !res.ok) return { player: null };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null) return { player: null };
  return validateAuthStatus(body);
}

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
      <div>
        <h1>Leaderboard</h1>
        <p>Loading…</p>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        <h1>Leaderboard</h1>
        <p role="alert">
          Couldn&apos;t load the leaderboard. {String(query.error)}
        </p>
      </div>
    );
  }

  const outcome = query.data!;

  if (outcome.kind === 'forbidden') {
    return (
      <div>
        <h1>Leaderboard</h1>
        <p role="alert">You aren&apos;t a participant in this event.</p>
      </div>
    );
  }

  if (outcome.kind === 'unknown_event') {
    return (
      <div>
        <h1>Leaderboard</h1>
        <p role="alert">Event not found.</p>
      </div>
    );
  }

  const data = outcome.data;
  const allUnscored = data.rows.every((r) => r.grossThroughHole === null);

  return (
    <div>
      <h1>Leaderboard</h1>
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
        <p>No participants yet.</p>
      ) : allUnscored ? (
        <p>No scores yet.</p>
      ) : (
        <table>
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
        </table>
      )}
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/events/$eventId/leaderboard')({
  beforeLoad: async () => {
    const status = await queryClient.fetchQuery({
      queryKey: ['auth-status'],
      queryFn: loadAuthStatus,
      staleTime: 30_000,
      retry: false,
    });
    if (status.player === null) {
      window.location.assign('/api/auth/google');
      throw new Error('redirecting-to-oauth');
    }
    return { player: status.player };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <LeaderboardPage eventId={eventId} />;
}
