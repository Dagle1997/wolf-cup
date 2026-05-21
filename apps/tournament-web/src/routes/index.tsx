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
import { useEffect } from 'react';
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

  const eventsQuery = useQuery<EventListResponse, Error>({
    queryKey: ['events-list'],
    queryFn: fetchEventsList,
    enabled: session.player !== null,
    staleTime: 10_000,
    retry: false,
  });

  // Auto-redirect when there's exactly one event so the user lands on
  // their event home without an extra tap. Multi-event case stays on
  // the list (the user picks). The redirect runs in an effect (not at
  // render time) so React-Router's location state stays clean.
  const events = eventsQuery.data?.events ?? [];
  useEffect(() => {
    if (session.player !== null && events.length === 1) {
      const only = events[0]!;
      void navigate({ to: '/events/$eventId', params: { eventId: only.id } });
    }
  }, [session.player, events, navigate]);

  // Anonymous: render the SSO CTA directly so the user controls when
  // they navigate away from the home page (avoids surprising them with
  // a full-page redirect on page load).
  if (session.player === null) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <h1>Tournament</h1>
        <p style={{ color: '#555', margin: '12px 0 24px' }}>
          Sign in with your Google account to view your event.
        </p>
        <a
          href="/api/auth/google"
          style={{
            display: 'inline-block',
            padding: '10px 18px',
            background: '#1d4ed8',
            color: '#fff',
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
                  background: '#1d4ed8',
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

  // 1 event: the auto-redirect effect will fire — render a quick
  // "Loading…" so we don't flash the list briefly before redirecting.
  if (events.length === 1) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Tournament</h1>
        <LoadingCard message="Loading your event…" />
      </div>
    );
  }

  // Multi-event: pick list.
  return (
    <div style={{ padding: 16 }}>
      <h1>Your events</h1>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {events.map((ev) => (
          <li key={ev.id}>
            <Link
              to="/events/$eventId"
              params={{ eventId: ev.id }}
              style={{
                display: 'block',
                padding: 12,
                border: '1px solid #ddd',
                borderRadius: 8,
                textDecoration: 'none',
                color: 'inherit',
                background: '#fff',
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
                    background: '#f1f5f9',
                    color: '#475569',
                    borderRadius: 8,
                  }}
                >
                  organizer
                </span>
              ) : null}
              <div style={{ fontSize: '0.85em', color: '#555', marginTop: 4 }}>
                {formatDateRange(ev.startDate, ev.endDate, ev.timezone)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
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
