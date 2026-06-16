/**
 * H1 lock-handicaps admin page — organizer freezes every roster player's
 * handicap index as of a cutoff date so a hot (or cold) streak right before /
 * during the trip can't move strokes mid-event.
 *
 * Route: /admin/events/:eventId/lock-handicaps
 *
 * Pick an "as of" date → POST /lock snapshots each player's index effective
 * on/before that date (pulled from GHIN's dated revision history; non-GHIN
 * players use their stored manual index). The snapshot carries into EVERY
 * round of the event. Unlock reverts scoring to today's live/manual index.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

type HandicapPlayer = {
  playerId: string;
  name: string | null;
  ghin: string | null;
  hasGhin: boolean;
  currentHandicapIndex: number | null;
  lockedHandicapIndex: number | null;
  lockedSource: 'ghin' | 'manual' | null;
  lockedAsOf: string | null;
};
type HandicapsResponse = {
  eventId: string;
  lockDate: number | null;
  ghinConfigured: boolean;
  players: HandicapPlayer[];
};

async function fetchHandicaps(eventId: string): Promise<HandicapsResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/handicaps`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as HandicapsResponse;
}

/** unix-ms → YYYY-MM-DD (UTC, matching the date the cutoff was stored as). */
function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtHi(hi: number | null): string {
  if (hi == null) return '—';
  return hi.toFixed(1);
}

const cellStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--color-border)',
  textAlign: 'left',
  verticalAlign: 'top',
};

export function LockHandicapsPage({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const query = useQuery<HandicapsResponse, Error>({
    queryKey: ['event-handicaps', eventId],
    queryFn: () => fetchHandicaps(eventId),
    retry: false,
  });

  const [lockDate, setLockDate] = useState<string>('');

  // Default the picker to the event's existing lock date (if any), else leave
  // blank so the organizer must consciously choose a cutoff.
  useEffect(() => {
    if (query.data?.lockDate != null) {
      setLockDate(msToIso(query.data.lockDate));
    }
  }, [query.data?.lockDate]);

  const lock = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/handicaps/lock`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lockDate }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? `http_${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['event-handicaps', eventId] }),
  });

  const unlock = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/handicaps/unlock`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(body.code ?? `http_${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['event-handicaps', eventId] }),
  });

  if (query.isPending) {
    return (
      <PageShell title="Lock handicaps">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Lock handicaps">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <ErrorCard error="Couldn't load handicaps." onRetry={query.refetch} />
      </PageShell>
    );
  }

  const data = query.data!;
  const isLocked = data.lockDate != null;
  const busy = lock.isPending || unlock.isPending;

  return (
    <PageShell title="Lock handicaps">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>
        Freeze every player&apos;s handicap index as of a date. The locked index carries
        into every round of this event, so a streak right before or during the trip
        can&apos;t change anyone&apos;s strokes. Unlock to go back to today&apos;s live index.
      </p>

      {!data.ghinConfigured ? (
        <p
          role="status"
          data-testid="ghin-not-configured"
          style={{ fontSize: 'var(--font-sm)', color: 'var(--color-warning-text)' }}
        >
          GHIN isn&apos;t configured on this server — players without a stored manual index
          will lock to no index.
        </p>
      ) : null}

      {isLocked ? (
        <div
          data-testid="lock-status-banner"
          style={{
            margin: '12px 0',
            padding: 12,
            border: '1px solid var(--color-brand-primary)',
            borderRadius: 8,
            background: 'var(--color-surface)',
          }}
        >
          <strong>Handicaps are locked as of {msToIso(data.lockDate!)}.</strong>
          <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', marginTop: 4 }}>
            Re-locking with a different date overwrites the snapshot.
          </div>
        </div>
      ) : (
        <p data-testid="lock-status-unlocked" style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>
          Not locked — scoring uses each player&apos;s current index.
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', margin: '12px 0' }}>
        <label style={{ fontSize: 'var(--font-sm)' }}>
          <div style={{ marginBottom: 4 }}>As of date</div>
          <input
            type="date"
            data-testid="lock-date-input"
            value={lockDate}
            onChange={(e) => setLockDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          data-testid="lock-btn"
          disabled={busy || lockDate === ''}
          onClick={() => lock.mutate()}
        >
          {lock.isPending ? 'Locking…' : isLocked ? 'Re-lock to this date' : 'Lock handicaps'}
        </button>
        {isLocked ? (
          <button
            type="button"
            data-testid="unlock-btn"
            disabled={busy}
            onClick={() => unlock.mutate()}
          >
            {unlock.isPending ? 'Unlocking…' : 'Unlock'}
          </button>
        ) : null}
      </div>

      {lock.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {lock.error.message === 'invalid_lock_date'
            ? 'Pick a valid date.'
            : lock.error.message === 'empty_roster'
              ? 'Add players to the roster before locking.'
              : `Couldn't lock (${lock.error.message}).`}
        </p>
      ) : null}
      {unlock.isError ? (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          Couldn&apos;t unlock ({unlock.error.message}).
        </p>
      ) : null}

      {data.players.length === 0 ? (
        <p data-testid="empty-roster">No players on the roster yet.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 'var(--font-sm)' }}>
          <thead>
            <tr>
              <th style={cellStyle}>Player</th>
              <th style={cellStyle}>Today&apos;s HI</th>
              <th style={cellStyle}>Locked HI</th>
            </tr>
          </thead>
          <tbody>
            {data.players.map((p) => (
              <tr key={p.playerId} data-testid={`handicap-row-${p.playerId}`}>
                <td style={cellStyle}>
                  {p.name ?? '—'}
                  {!p.hasGhin ? (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85em' }}>manual index</div>
                  ) : null}
                </td>
                <td style={cellStyle} data-testid={`current-hi-${p.playerId}`}>
                  {fmtHi(p.currentHandicapIndex)}
                </td>
                <td style={cellStyle} data-testid={`locked-hi-${p.playerId}`}>
                  {p.lockedHandicapIndex == null && p.lockedSource == null ? (
                    '—'
                  ) : (
                    <>
                      {fmtHi(p.lockedHandicapIndex)}
                      {p.lockedSource != null ? (
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85em' }}>
                          {p.lockedSource === 'ghin' && p.lockedAsOf
                            ? `GHIN · ${p.lockedAsOf}`
                            : p.lockedSource}
                        </div>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/lock-handicaps')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <LockHandicapsPage eventId={eventId} />;
}
