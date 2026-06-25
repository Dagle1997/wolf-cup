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
  /**
   * Integer percent of full course handicap that strokes are computed at
   * (e.g. 80, 85, 90, 100). 100 = no reduction. Owned/persisted by the API
   * (field name `handicapAllowancePct`); the web side reads + writes it.
   * Null/undefined when the API hasn't set it yet → treat as the 100 default
   * for display (omit the "at N%" clause).
   */
  handicapAllowancePct?: number | null;
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

/** Sensible client guard for the typed allowance box: integer, clamped 50–150. */
const ALLOWANCE_MIN = 50;
const ALLOWANCE_MAX = 150;
const ALLOWANCE_DEFAULT = 100;
function clampAllowance(n: number): number {
  if (!Number.isFinite(n)) return ALLOWANCE_DEFAULT;
  return Math.min(ALLOWANCE_MAX, Math.max(ALLOWANCE_MIN, Math.round(n)));
}

/**
 * Participant-facing lock string. "Handicaps locked as of {date} at {pct}%".
 * When pct is null/undefined (API hasn't set it), the "at N%" clause is omitted
 * — never renders "at undefined%". The 100 default still reads as a clean
 * "at 100%" only when the API explicitly returns 100.
 */
function lockedAsOfString(lockDateIso: string, pct: number | null | undefined): string {
  const base = `Handicaps locked as of ${lockDateIso}`;
  return pct == null ? `${base}.` : `${base} at ${pct}%.`;
}

export function LockHandicapsPage({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const query = useQuery<HandicapsResponse, Error>({
    queryKey: ['event-handicaps', eventId],
    queryFn: () => fetchHandicaps(eventId),
    retry: false,
  });

  const [lockDate, setLockDate] = useState<string>('');
  // Typed (not preset) allowance box. Held as a STRING so the field can be
  // momentarily empty / mid-edit; clamped to an integer on blur + on submit.
  const [allowance, setAllowance] = useState<string>(String(ALLOWANCE_DEFAULT));

  // Default the picker to the event's existing lock date (if any), else leave
  // blank so the organizer must consciously choose a cutoff.
  useEffect(() => {
    if (query.data?.lockDate != null) {
      setLockDate(msToIso(query.data.lockDate));
    }
  }, [query.data?.lockDate]);

  // Seed the allowance box from the event's stored value once it loads; fall
  // back to the 100 default when the API hasn't set it yet.
  useEffect(() => {
    if (query.data?.handicapAllowancePct != null) {
      setAllowance(String(query.data.handicapAllowancePct));
    }
  }, [query.data?.handicapAllowancePct]);

  const lock = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/handicaps/lock`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        // Send the clamped integer allowance alongside the cutoff date. The API
        // (someone else's work) persists it as `handicapAllowancePct` on the
        // event; if it ignores the field today this is a no-op until wired.
        // TODO(backend): accept + persist handicapAllowancePct on /handicaps/lock.
        body: JSON.stringify({ lockDate, handicapAllowancePct: clampAllowance(Number(allowance)) }),
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
        The handicap allowance % scales everyone&apos;s strokes (100 = full handicap;
        e.g. 80 means 80% of each player&apos;s course handicap).
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
          <strong data-testid="lock-status-text">
            {lockedAsOfString(msToIso(data.lockDate!), data.handicapAllowancePct ?? null)}
          </strong>
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
        <label style={{ fontSize: 'var(--font-sm)' }}>
          <div style={{ marginBottom: 4 }}>Handicap allowance %</div>
          <input
            type="number"
            inputMode="numeric"
            min={ALLOWANCE_MIN}
            max={ALLOWANCE_MAX}
            step={1}
            data-testid="allowance-input"
            value={allowance}
            placeholder={String(ALLOWANCE_DEFAULT)}
            onChange={(e) => setAllowance(e.target.value)}
            onBlur={() =>
              setAllowance(
                allowance.trim() === '' ? String(ALLOWANCE_DEFAULT) : String(clampAllowance(Number(allowance))),
              )
            }
            style={{ width: 90, minHeight: 'var(--control-height)' }}
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
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
          {data.players.map((p) => (
            <li
              key={p.playerId}
              data-testid={`handicap-row-${p.playerId}`}
              style={{
                padding: 'var(--space-3)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface)',
                fontSize: 'var(--font-sm)',
              }}
            >
              <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>
                {p.name ?? '—'}
                {!p.hasGhin ? (
                  <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: 'var(--font-xs)' }}>
                    {' '}· manual index
                  </span>
                ) : null}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', marginTop: 'var(--space-1)' }}>
                <div data-testid={`current-hi-${p.playerId}`}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Today&apos;s HI: </span>
                  {fmtHi(p.currentHandicapIndex)}
                </div>
                <div data-testid={`locked-hi-${p.playerId}`}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Locked HI: </span>
                  {p.lockedHandicapIndex == null && p.lockedSource == null ? (
                    '—'
                  ) : (
                    <>
                      {fmtHi(p.lockedHandicapIndex)}
                      {p.lockedSource != null ? (
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)' }}>
                          {' '}
                          ({p.lockedSource === 'ghin' && p.lockedAsOf
                            ? `GHIN · ${p.lockedAsOf}`
                            : p.lockedSource})
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
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
