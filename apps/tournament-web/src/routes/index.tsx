/**
 * Smart home page (T10 navigation fix). Replaces the T1-3 scaffold's
 * empty `<h1>Tournament</h1>` placeholder with auth-aware routing so
 * users on phones don't have to type UUID-laden URLs to reach their
 * event.
 *
 * Routing matrix (resolved client-side after the auth-status query):
 *   - Anonymous → "Sign in with Google" CTA → /api/auth/google
 *   - Logged-in + 0 events + organizer → "Create your first event" → /admin/events/new
 *   - Logged-in + 0 events + non-organizer → "Waiting for organizer" message
 *   - Logged-in + 1 event → automatic redirect to /events/<id>
 *   - Logged-in + N events → list of event cards (sorted by start_date desc)
 */

import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuthSession } from '../hooks/use-auth-session';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';

type EventListItem = {
  id: string;
  name: string;
  startDate: number;
  endDate: number;
  timezone: string;
  isOrganizer: boolean;
  cancelledAt: number | null;
};

type EventListResponse = { events: EventListItem[] };

async function fetchEventsList(): Promise<EventListResponse> {
  const res = await fetch('/api/events', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as EventListResponse;
}

function formatDateRange(startMs: number, endMs: number, timeZone: string): string {
  const sameYear =
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(startMs) ===
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(endMs);
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { timeZone, month: 'short', day: 'numeric' }
    : { timeZone, month: 'short', day: 'numeric', year: 'numeric' };
  const fmt = new Intl.DateTimeFormat('en-US', opts);
  return `${fmt.format(startMs)} – ${fmt.format(endMs)}`;
}

function IndexPage() {
  const session = useAuthSession();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);

  const eventsQuery = useQuery<EventListResponse, Error>({
    queryKey: ['events-list'],
    queryFn: fetchEventsList,
    enabled: session.player !== null,
    staleTime: 10_000,
    retry: false,
  });

  const events = eventsQuery.data?.events ?? [];
  // The landing shows CURRENT events only. An event is "archived" when it's
  // cancelled or already over — hidden by default behind a toggle so the list
  // stays clean; the organizer still reaches them to review stats / restore.
  const now = Date.now();
  const isArchived = (e: EventListItem) => e.cancelledAt != null || e.endDate < now;
  const activeEvents = events.filter((e) => !isArchived(e));
  const archivedEvents = events.filter(isArchived);
  const visibleEvents = showArchived ? events : activeEvents;

  // Auto-redirect only when the user's single event is active (no extra tap).
  // A lone cancelled/past event must NOT silently redirect — show the list so
  // the toggle (and the Cancelled badge → admin → restore) stays reachable.
  const autoRedirectId =
    events.length === 1 && !isArchived(events[0]!) ? events[0]!.id : null;
  useEffect(() => {
    if (session.player !== null && autoRedirectId !== null) {
      void navigate({ to: '/events/$eventId', params: { eventId: autoRedirectId } });
    }
  }, [session.player, autoRedirectId, navigate]);

  // Anonymous: render the SSO CTA directly so the user controls when
  // they navigate away from the home page (avoids surprising them with
  // a full-page redirect on page load).
  if (session.player === null) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h1>Tournament</h1>
        <p style={{ color: 'var(--color-text-muted)', margin: '12px 0 16px' }}>
          Got a join code from your organizer? Enter it — no account needed.
        </p>
        <Link
          to="/join"
          style={{
            display: 'inline-block',
            padding: '12px 20px',
            background: 'var(--color-brand-primary)',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 700,
          }}
          data-testid="home-join-cta"
        >
          Join with a code
        </Link>
        <p style={{ color: 'var(--color-text-muted)', margin: '24px 0 8px', fontSize: '0.9em' }}>
          Organizer?
        </p>
        <a
          href="/api/auth/google"
          style={{
            display: 'inline-block',
            padding: '10px 18px',
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
          }}
          data-testid="home-sso-cta"
        >
          Sign in with Google
        </a>
      </div>
    );
  }

  if (eventsQuery.isPending) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Tournament</h1>
        <LoadingCard />
      </div>
    );
  }

  if (eventsQuery.isError) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Tournament</h1>
        <ErrorCard
          error="Couldn't load your events. Refresh to retry."
          onRetry={eventsQuery.refetch}
        />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Tournament</h1>
        {session.player.isOrganizer ? (
          <EmptyState
            title="No events yet. Create one to start."
            action={
              <Link
                to="/admin/events/new"
                style={{
                  display: 'inline-block',
                  padding: '10px 18px',
                  background: 'var(--color-brand-primary)',
                  color: '#fff',
                  borderRadius: 6,
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
                data-testid="home-create-event"
              >
                + Create your first event
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="You aren't in any events yet."
            body="Your organizer will share an invite link when the event is set up."
          />
        )}
      </div>
    );
  }

  // 1 active event: the auto-redirect effect will fire — render a quick
  // "Loading…" so we don't flash the list briefly before redirecting.
  if (autoRedirectId !== null) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Tournament</h1>
        <LoadingCard message="Loading your event…" />
      </div>
    );
  }

  // Multi-event: pick list (current events by default; archived behind a toggle).
  return (
    <div style={{ padding: 16 }}>
      <h1>Your events</h1>
      {visibleEvents.length === 0 ? (
        <p data-testid="no-current-events" style={{ color: 'var(--color-text-muted)' }}>
          No current events.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {visibleEvents.map((ev) => (
          <li key={ev.id}>
            <Link
              to="/events/$eventId"
              params={{ eventId: ev.id }}
              style={{
                display: 'block',
                padding: 12,
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                textDecoration: 'none',
                color: 'inherit',
                background: 'var(--color-surface)',
              }}
              data-testid={`home-event-link-${ev.id}`}
            >
              <strong>{ev.name}</strong>
              {ev.isOrganizer ? (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: '0.75em',
                    padding: '1px 6px',
                    background: 'var(--color-surface-sunken)',
                    color: 'var(--color-text-secondary)',
                    borderRadius: 8,
                  }}
                >
                  organizer
                </span>
              ) : null}
              {ev.cancelledAt != null ? (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: '0.75em',
                    padding: '1px 6px',
                    background: 'var(--color-danger-bg)',
                    color: 'var(--color-danger)',
                    borderRadius: 8,
                  }}
                  data-testid={`home-event-cancelled-${ev.id}`}
                >
                  Cancelled
                </span>
              ) : null}
              <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {formatDateRange(ev.startDate, ev.endDate, ev.timezone)}
              </div>
            </Link>
          </li>
          ))}
        </ul>
      )}
      {archivedEvents.length > 0 ? (
        <p style={{ marginTop: 12 }}>
          <button
            type="button"
            data-skip-base-style
            data-testid="toggle-archived"
            onClick={() => setShowArchived((v) => !v)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'none',
              border: 'none',
              // 44px min tap target (was a text-height-only box); horizontal
              // padding keeps the hit area comfortable without an oversized look.
              minHeight: 44,
              padding: '0 4px',
              color: 'var(--color-brand-primary)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {showArchived
              ? 'Hide past & cancelled'
              : `Show past & cancelled (${archivedEvents.length})`}
          </button>
        </p>
      ) : null}
      {session.player.isOrganizer ? (
        <p style={{ marginTop: 16 }}>
          <Link to="/admin/events/new" data-testid="home-create-event">
            + Create another event
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export const Route = createFileRoute('/')({
  component: IndexPage,
});
