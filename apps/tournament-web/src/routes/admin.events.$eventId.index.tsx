/**
 * Organizer admin landing page for a single event. Discovers the IDs
 * needed for every admin sub-page (groupId, ruleSetId, eventRoundIds)
 * via GET /api/admin/events/:eventId/admin-context, then renders direct
 * links so the organizer never has to copy-paste a UUID.
 *
 * Mobile-first list layout — each link is a tappable card.
 */

import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';

type AdminContextResponse = {
  event: { id: string; name: string };
  groups: Array<{ id: string; name: string }>;
  ruleSet: { id: string; name: string } | null;
  eventRounds: Array<{ id: string; roundNumber: number; courseName: string }>;
};

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
  border: '1px solid #ddd',
  borderRadius: 8,
  textDecoration: 'none',
  color: 'inherit',
  background: '#fff',
};

function AdminLandingPage({ eventId }: { eventId: string }) {
  const query = useQuery<AdminContextResponse, Error>({
    queryKey: ['admin-context', eventId],
    queryFn: () => fetchAdminContext(eventId),
    retry: false,
    staleTime: 30_000,
  });

  if (query.isPending) return <div style={{ padding: 24 }}>Loading…</div>;
  if (query.isError) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Admin</h1>
        <p role="alert">Couldn&apos;t load admin context.</p>
        <Link to="/events/$eventId" params={{ eventId }}>
          ← Back to event home
        </Link>
      </div>
    );
  }
  const ctx = query.data!;

  return (
    <div style={{ padding: 16 }}>
      <p style={{ marginBottom: 8 }}>
        <Link to="/events/$eventId" params={{ eventId }}>
          ← Back to event home
        </Link>
      </p>
      <h1>Admin — {ctx.event.name}</h1>

      <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 24px', display: 'grid', gap: 8 }}>
        <li>
          <Link
            to="/admin/events/$eventId/pairings"
            params={{ eventId }}
            style={cardStyle}
            data-testid="admin-link-pairings"
          >
            <strong>Pairings + per-player tees</strong>
            <div style={{ fontSize: '0.85em', color: '#555' }}>
              Set foursomes per round + override individual players&apos; tees.
            </div>
          </Link>
        </li>

        {ctx.groups.length === 0 ? (
          <li
            style={{
              ...cardStyle,
              background: '#fef3c7',
              borderColor: '#fde68a',
            }}
          >
            <strong>Roster</strong>
            <div style={{ fontSize: '0.85em', color: '#92400e' }}>
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
                <div style={{ fontSize: '0.85em', color: '#555' }}>
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
              background: '#fef3c7',
              borderColor: '#fde68a',
            }}
          >
            <strong>Rule set</strong>
            <div style={{ fontSize: '0.85em', color: '#92400e' }}>
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
              <div style={{ fontSize: '0.85em', color: '#555' }}>
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
              <div style={{ fontSize: '0.85em', color: '#555' }}>
                Toggle skins / sandies / greenies / CTP for this round.
              </div>
            </Link>
          </li>
        ))}

        <li>
          <Link to="/admin/courses/new" style={cardStyle} data-testid="admin-link-course-new">
            <strong>+ New course (manual)</strong>
            <div style={{ fontSize: '0.85em', color: '#555' }}>
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
            <div style={{ fontSize: '0.85em', color: '#555' }}>
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
    </div>
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
