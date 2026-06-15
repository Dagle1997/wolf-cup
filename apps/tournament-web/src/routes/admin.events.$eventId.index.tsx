/**
 * Organizer admin landing page for a single event. Discovers the IDs
 * needed for every admin sub-page (groupId, ruleSetId, eventRoundIds)
 * via GET /api/admin/events/:eventId/admin-context, then renders direct
 * links so the organizer never has to copy-paste a UUID.
 *
 * Mobile-first list layout — each link is a tappable card.
 */

import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';

type AdminContextResponse = {
  event: { id: string; name: string; cancelledAt: number | null };
  groups: Array<{ id: string; name: string }>;
  ruleSet: { id: string; name: string } | null;
  eventRounds: Array<{ id: string; roundNumber: number; courseName: string }>;
};

async function postEventLifecycle(
  eventId: string,
  action: 'cancel' | 'restore',
): Promise<void> {
  const res = await fetch(
    `/api/events/${encodeURIComponent(eventId)}/${action}`,
    { method: 'POST', credentials: 'same-origin' },
  );
  if (!res.ok) throw new Error(`http_${res.status}`);
}

async function fetchAdminContext(eventId: string): Promise<AdminContextResponse> {
  const res = await fetch(
    `/api/admin/events/${encodeURIComponent(eventId)}/admin-context`,
    { credentials: 'same-origin' },
  );
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as AdminContextResponse;
}

const cardStyle: React.CSSProperties = {
  display: 'block',
  padding: 12,
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  textDecoration: 'none',
  color: 'inherit',
  background: 'var(--color-surface)',
};

function AdminLandingPage({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const query = useQuery<AdminContextResponse, Error>({
    queryKey: ['admin-context', eventId],
    queryFn: () => fetchAdminContext(eventId),
    retry: false,
    staleTime: 30_000,
  });

  const lifecycle = useMutation<void, Error, 'cancel' | 'restore'>({
    mutationFn: (action) => postEventLifecycle(eventId, action),
    onSuccess: async () => {
      setConfirmingCancel(false);
      await queryClient.invalidateQueries({ queryKey: ['admin-context', eventId] });
      await queryClient.invalidateQueries({ queryKey: ['events-list'] });
    },
  });

  if (query.isPending) {
    return (
      <PageShell title="Admin">
        <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Admin">
        <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />
        <ErrorCard error="Couldn't load admin context." />
      </PageShell>
    );
  }
  const ctx = query.data!;

  const isCancelled = ctx.event.cancelledAt != null;

  return (
    <PageShell title={`Admin — ${ctx.event.name}`}>
      <BackLink to="/events/$eventId" params={{ eventId }} label="Event home" />

      {isCancelled ? (
        <div
          style={{
            margin: '16px 0',
            padding: 12,
            border: '1px solid var(--color-danger-border)',
            background: 'var(--color-danger-bg)',
            borderRadius: 8,
          }}
          data-testid="event-cancelled-banner"
        >
          <strong style={{ color: 'var(--color-danger)' }}>This event is cancelled.</strong>
          <div style={{ fontSize: '0.85em', color: 'var(--color-danger)', margin: '4px 0 10px' }}>
            It&apos;s hidden from everyone you invited. Nothing was deleted — restore
            it any time to bring it back exactly as it was.
          </div>
          <button
            type="button"
            onClick={() => lifecycle.mutate('restore')}
            disabled={lifecycle.isPending}
            data-testid="event-restore-btn"
            style={{
              padding: '8px 14px',
              border: '1px solid var(--color-brand-primary)',
              background: 'var(--color-brand-primary)',
              color: '#fff',
              borderRadius: 6,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {lifecycle.isPending ? 'Restoring…' : 'Restore event'}
          </button>
          {lifecycle.isError ? (
            <div style={{ color: 'var(--color-danger)', fontSize: '0.8em', marginTop: 8 }}>
              Couldn&apos;t restore. Try again.
            </div>
          ) : null}
        </div>
      ) : null}

      <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 24px', display: 'grid', gap: 8 }}>
        <li>
          <Link
            to="/admin/events/$eventId/pairings"
            params={{ eventId }}
            style={cardStyle}
            data-testid="admin-link-pairings"
          >
            <strong>Pairings + per-player tees</strong>
            <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>
              Set foursomes per round + override individual players&apos; tees.
            </div>
          </Link>
        </li>

        <li>
          <Link
            to="/admin/events/$eventId/scorer-policy"
            params={{ eventId }}
            style={cardStyle}
            data-testid="admin-link-scorer-policy"
          >
            <strong>Who can score?</strong>
            <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>
              Foursome members, designated scorers (caddie), or open.
            </div>
          </Link>
        </li>

        <li>
          <Link
            to="/admin/events/$eventId/start-round"
            params={{ eventId }}
            style={cardStyle}
            data-testid="admin-link-start-round"
          >
            <strong>Start round</strong>
            <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>
              Begin scoring a round — pick who scores each locked foursome.
            </div>
          </Link>
        </li>

        {ctx.groups.length === 0 ? (
          <li
            style={{
              ...cardStyle,
              background: 'var(--color-warning-bg)',
              borderColor: 'var(--color-warning-text)',
            }}
          >
            <strong>Roster</strong>
            <div style={{ fontSize: '0.85em', color: 'var(--color-warning-text)' }}>
              No group set up yet. Create one via the New Event wizard or
              ask the API team for help — the roster lives under groups.
            </div>
          </li>
        ) : (
          ctx.groups.map((g) => (
            <li key={g.id}>
              <Link
                to="/admin/groups/$groupId/edit"
                params={{ groupId: g.id }}
                style={cardStyle}
                data-testid={`admin-link-group-${g.id}`}
              >
                <strong>Roster — {g.name}</strong>
                <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>
                  Add / remove players, set handicap indices.
                </div>
              </Link>
            </li>
          ))
        )}

        {ctx.ruleSet === null ? (
          <li
            style={{
              ...cardStyle,
              background: 'var(--color-warning-bg)',
              borderColor: 'var(--color-warning-text)',
            }}
          >
            <strong>Rule set</strong>
            <div style={{ fontSize: '0.85em', color: 'var(--color-warning-text)' }}>
              No rule set seeded yet. Defaults apply until one is created.
            </div>
          </li>
        ) : (
          <li>
            <Link
              to="/admin/rule-sets/$id/edit"
              params={{ id: ctx.ruleSet.id }}
              style={cardStyle}
              data-testid="admin-link-ruleset"
            >
              <strong>Rule set — {ctx.ruleSet.name}</strong>
              <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>
                Cents per hole, sandies, greenies, skins mode.
              </div>
            </Link>
          </li>
        )}

        {ctx.eventRounds.map((er) => (
          <li key={er.id}>
            <Link
              to="/admin/event-rounds/$eventRoundId/sub-games"
              params={{ eventRoundId: er.id }}
              style={cardStyle}
              data-testid={`admin-link-subgames-${er.id}`}
            >
              <strong>
                Sub-games — Round {er.roundNumber} ({er.courseName})
              </strong>
              <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>
                Toggle skins / sandies / greenies / CTP for this round.
              </div>
            </Link>
          </li>
        ))}

        <li>
          <Link to="/admin/courses/new" style={cardStyle} data-testid="admin-link-course-new">
            <strong>+ New course (manual)</strong>
            <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>
              Enter holes + tees by hand.
            </div>
          </Link>
        </li>
        <li>
          <Link
            to="/admin/courses/upload"
            style={cardStyle}
            data-testid="admin-link-course-upload"
          >
            <strong>+ New course from PDF</strong>
            <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>
              Upload a scorecard PDF; vision parser fills the holes.
            </div>
          </Link>
        </li>
        <li>
          <Link to="/admin/events/new" style={cardStyle} data-testid="admin-link-event-new">
            <strong>+ Create another event</strong>
          </Link>
        </li>
      </ul>

      {!isCancelled ? (
        <div
          style={{
            marginTop: 8,
            padding: 12,
            border: '1px solid var(--color-danger-border)',
            borderRadius: 8,
            background: 'var(--color-surface)',
          }}
        >
          <strong style={{ color: 'var(--color-danger)' }}>Danger zone</strong>
          {!confirmingCancel ? (
            <>
              <div style={{ fontSize: '0.85em', color: 'var(--color-text-muted)', margin: '4px 0 10px' }}>
                Cancel this event to hide it from everyone you invited. It&apos;s
                reversible — you can restore it later.
              </div>
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                data-testid="event-cancel-btn"
                style={{
                  padding: '8px 14px',
                  border: '1px solid #dc2626',
                  background: 'var(--color-surface)',
                  color: '#dc2626',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel event
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.85em', color: 'var(--color-danger)', margin: '4px 0 10px' }}>
                Cancel <strong>{ctx.event.name}</strong>? Everyone you invited will
                lose access until you restore it.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => lifecycle.mutate('cancel')}
                  disabled={lifecycle.isPending}
                  data-testid="event-cancel-confirm-btn"
                  style={{
                    padding: '8px 14px',
                    border: '1px solid #dc2626',
                    background: '#dc2626',
                    color: '#fff',
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {lifecycle.isPending ? 'Cancelling…' : 'Yes, cancel event'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={lifecycle.isPending}
                  data-testid="event-cancel-abort-btn"
                  style={{
                    padding: '8px 14px',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-secondary)',
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Keep event
                </button>
              </div>
              {lifecycle.isError ? (
                <div style={{ color: 'var(--color-danger)', fontSize: '0.8em', marginTop: 8 }}>
                  Couldn&apos;t cancel. Try again.
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  const { eventId } = useParams({ strict: false });
  if (!player.isOrganizer) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Forbidden</h1>
        <p>You need organizer access to view this page.</p>
      </div>
    );
  }
  if (typeof eventId !== 'string') return <div>Invalid event.</div>;
  return <AdminLandingPage eventId={eventId} />;
}
