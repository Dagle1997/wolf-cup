/**
 * T13-2 Start Round — organizer instantiates scoring for an event_round.
 *
 * Reads the persisted pairings (GET /api/admin/events/:eventId/pairings),
 * shows each round whose pairings are ALL locked, lets the organizer pick a
 * scorer per foursome (the foursome's members + the organizer themself), and
 * POSTs /api/admin/event-rounds/:eventRoundId/start. On success it links to
 * score-entry for the new round.
 *
 * Read-only against the pairings editor (no shared edit state) — deliberately
 * a separate route so it can't disturb the pairings-save flow.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { useAuthSession } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';

type PairingsResponse = {
  rounds: Array<{
    eventRoundId: string;
    roundNumber: number;
    pairings: Array<{
      foursomeNumber: number;
      locked: boolean;
      members: Array<{ playerId: string; name: string }>;
    }>;
  }>;
};

async function fetchPairings(eventId: string): Promise<PairingsResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/pairings`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as PairingsResponse;
}

const ORGANIZER = '__organizer__';

export function StartRoundPage({ eventId, organizerId }: { eventId: string; organizerId: string }) {
  const navigate = useNavigate();
  const query = useQuery<PairingsResponse, Error>({
    queryKey: ['start-round-pairings', eventId],
    queryFn: () => fetchPairings(eventId),
    retry: false,
  });

  // Per (eventRoundId, foursomeNumber) → selected scorerPlayerId (or ORGANIZER sentinel).
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  if (query.isPending) {
    return (
      <PageShell title="Start round">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Start round">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />
        <ErrorCard error="Couldn't load pairings." onRetry={query.refetch} />
      </PageShell>
    );
  }

  const startableRounds = query.data.rounds.filter(
    (r) => r.pairings.length > 0 && r.pairings.every((p) => p.locked),
  );

  async function start(eventRoundId: string, foursomes: PairingsResponse['rounds'][number]['pairings']) {
    setErrorText(null);
    setBusy(eventRoundId);
    try {
      const scorers = foursomes.map((p) => {
        const key = `${eventRoundId}:${p.foursomeNumber}`;
        const pick = picks[key] ?? ORGANIZER;
        return {
          foursomeNumber: p.foursomeNumber,
          scorerPlayerId: pick === ORGANIZER ? organizerId : pick,
        };
      });
      const res = await fetch(
        `/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/start`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scorers }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setErrorText(
          body.code === 'pairings_not_ready'
            ? 'Lock every foursome before starting the round.'
            : `Couldn't start the round (${body.code ?? res.status}).`,
        );
        return;
      }
      const { roundId } = (await res.json()) as { roundId: string };
      void navigate({ to: '/rounds/$roundId/score-entry', params: { roundId } });
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell title="Start round">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Admin" />

      {errorText !== null ? <p role="alert" style={{ color: 'var(--color-danger)' }}>{errorText}</p> : null}

      {startableRounds.length === 0 ? (
        <EmptyState
          title="No round is ready to start."
          body="Set foursomes and lock every one of them on the Pairings page first."
          action={
            <Link to="/admin/events/$eventId/pairings" params={{ eventId }}>
              Go to Pairings
            </Link>
          }
        />
      ) : (
        startableRounds.map((r) => (
          <section key={r.eventRoundId} style={{ marginBottom: 24 }} data-testid={`start-round-${r.eventRoundId}`}>
            <h2 style={{ fontSize: 'var(--font-lg)' }}>Round {r.roundNumber}</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)' }}>
              Pick who scores each foursome (they must be able to sign in). Defaults to you.
            </p>
            {r.pairings
              .slice()
              .sort((a, b) => a.foursomeNumber - b.foursomeNumber)
              .map((p) => {
                const key = `${r.eventRoundId}:${p.foursomeNumber}`;
                return (
                  <div key={key} style={{ margin: '8px 0' }}>
                    <label style={{ marginRight: 8 }}>Foursome {p.foursomeNumber} scorer:</label>
                    <select
                      data-testid={`scorer-${key}`}
                      value={picks[key] ?? ORGANIZER}
                      onChange={(e) => setPicks((prev) => ({ ...prev, [key]: e.target.value }))}
                    >
                      <option value={ORGANIZER}>You (organizer)</option>
                      {p.members.map((m) => (
                        <option key={m.playerId} value={m.playerId}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            <button
              type="button"
              data-testid={`start-btn-${r.eventRoundId}`}
              disabled={busy === r.eventRoundId}
              onClick={() => start(r.eventRoundId, r.pairings)}
            >
              {busy === r.eventRoundId ? 'Starting…' : 'Start round'}
            </button>
          </section>
        ))
      )}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/start-round')({
  beforeLoad: async () => {
    return requireAuthOrRedirect();
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  const { player } = useAuthSession();
  return <StartRoundPage eventId={eventId} organizerId={player?.id ?? ''} />;
}
