/**
 * Foursomes — /events/:eventId/foursomes (Standings hub, "Foursome" tab).
 *
 * Resolves the latest STARTED round and shows its per-foursome 2v2 money
 * (the off-the-low Guyan game), reusing FoursomeResultsPage with the
 * standings tab strip embedded. If no round has started, shows a tabbed
 * empty state.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { ViewTabs } from '../components/view-tabs';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';
import { FoursomeResultsPage } from './events.$eventId.event-rounds.$eventRoundId.foursome-results';

type ScheduleRound = { id: string; runtimeRoundId: string | null; roundNumber: number };
type ScheduleResponse = { rounds: ScheduleRound[] };

async function fetchSchedule(eventId: string): Promise<ScheduleResponse> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/schedule`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`schedule_fetch_failed_${res.status}`);
  return (await res.json()) as ScheduleResponse;
}

export function FoursomesPage({ eventId }: { eventId: string }) {
  const query = useQuery<ScheduleResponse>({
    queryKey: ['schedule-for-foursomes', eventId],
    queryFn: () => fetchSchedule(eventId),
    staleTime: 30_000,
  });

  if (query.isPending) {
    return (
      <PageShell title="Foursome">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ViewTabs set="standings" active="foursome" eventId={eventId} />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Foursome">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ViewTabs set="standings" active="foursome" eventId={eventId} />
        <ErrorCard title="Couldn't load foursomes." error={query.error} onRetry={query.refetch} />
      </PageShell>
    );
  }

  // Latest started round wins (highest round_number with a runtime round).
  const started = query.data!.rounds
    .filter((r) => r.runtimeRoundId !== null)
    .sort((a, b) => b.roundNumber - a.roundNumber);
  const latest = started[0];

  if (!latest) {
    return (
      <PageShell title="Foursome">
        <BackLink to="/events/$eventId" params={{ eventId }} />
        <ViewTabs set="standings" active="foursome" eventId={eventId} />
        <EmptyState icon="⛳" title="No round started yet" body="The foursome money shows here once a round is underway." />
      </PageShell>
    );
  }

  return <FoursomeResultsPage eventId={eventId} eventRoundId={latest.id} embedTabs />;
}

export const Route = createFileRoute('/events/$eventId/foursomes')({
  beforeLoad: async () => requireAuthOrRedirect(),
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <FoursomesPage eventId={eventId} />;
}
