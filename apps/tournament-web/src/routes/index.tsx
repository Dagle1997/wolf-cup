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
  //
  // EXCEPTION: if the user arrived here on purpose via "← All events" (the event
  // screen links to `/?list=1`), DO NOT bounce them straight back into the only
  // event — that made the back link a no-op flash-reload (Josh 2026-06-25). The
  // flag is read once from the URL so a normal app launch still auto-enters.
  const explicitList =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('list');
  const autoRedirectId =
    !explicitList && events.length === 1 && !isArchived(events[0]!) ? events[0]!.id : null;
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
      <div
        style={{
          minHeight: 'calc(100dvh - 52px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '40px 24px',
          background: 'linear-gradient(165deg, #0a0f0a 0%, #0d1f0d 45%, #0f5c2e 100%)',
          color: '#fff',
        }}
      >
        <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 6 }} aria-hidden>⛳</div>
        <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: '-0.6px', lineHeight: 1.08, margin: 0 }}>
          The whole weekend.<br />
          <span style={{ color: 'var(--color-brand-primary)' }}>Live on your phone.</span>
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: 15, lineHeight: 1.5, margin: '14px 0 26px', maxWidth: 320 }}>
          Live scoring, standings, and head-to-head money — right from the cart.
        </p>

        {/* Has a code → join. */}
        <Link
          to="/join"
          style={{
            display: 'block',
            width: '100%',
            maxWidth: 320,
            padding: '14px 20px',
            background: 'var(--color-brand-primary)',
            color: '#fff',
            borderRadius: 12,
            textDecoration: 'none',
            fontWeight: 800,
            fontSize: 16,
          }}
          data-testid="home-join-cta"
        >
          Enter your join code
        </Link>

        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 12 }}>
          No code yet? Your organizer will send you one.
        </p>

        <a
          href="/api/auth/google"
          style={{
            display: 'inline-block',
            marginTop: 26,
            color: 'rgba(255,255,255,0.6)',
            textDecoration: 'underline',
            fontWeight: 600,
            fontSize: 14,
          }}
          data-testid="home-sso-cta"
        >
          Organizer? Sign in with Google
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
            body="Your organizer will send you a join code when the event is set up."
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
