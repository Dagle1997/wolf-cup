/**
 * Fix tees — /admin/events/$eventId/fix-tees (organizer).
 *
 * Change a player's tee AFTER the round has started. PATCHes
 * /api/admin/event-rounds/:eventRoundId/players/:playerId/tee, which updates the
 * pairing tee AND re-pins just that player's course handicap (money recomputes
 * on read). One row per player, per round; a dropdown of the round's tees.
 */
import { createFileRoute, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';

type Member = { playerId: string; name: string; slotNumber: number; teeColor: string | null };
type Pairing = { id: string; foursomeNumber: number; members: Member[] };
type RoundOut = {
  eventRoundId: string;
  roundNumber: number;
  defaultTeeColor: string;
  availableTees: string[];
  pairings: Pairing[];
};
type PairingsResponse = { rounds: RoundOut[] };

async function fetchPairings(eventId: string): Promise<PairingsResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/pairings`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as PairingsResponse;
}

function FixTeesPage({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const queryKey = ['event-pairings', eventId] as const;
  const query = useQuery<PairingsResponse, Error>({
    queryKey,
    queryFn: () => fetchPairings(eventId),
    retry: false,
  });

  // playerId → transient status (saved CH or error) keyed for inline feedback.
  const [status, setStatus] = useState<Record<string, string>>({});

  const change = useMutation<
    { courseHandicap: number | null; repinned: boolean },
    Error & { code?: string },
    { eventRoundId: string; playerId: string; teeColor: string }
  >({
    mutationFn: async ({ eventRoundId, playerId, teeColor }) => {
      const res = await fetch(
        `/api/admin/event-rounds/${encodeURIComponent(eventRoundId)}/players/${encodeURIComponent(playerId)}/tee`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ teeColor }) },
      );
      const body = (await res.json().catch(() => null)) as { courseHandicap: number | null; repinned: boolean; code?: string } | null;
      if (!res.ok) { const e = new Error(body?.code ?? `http_${res.status}`) as Error & { code?: string }; if (body?.code) e.code = body.code; throw e; }
      return body as { courseHandicap: number | null; repinned: boolean };
    },
    onSuccess: (data, vars) => {
      setStatus((s) => ({
        ...s,
        [vars.playerId]: data.repinned
          ? `✓ saved — new CH ${data.courseHandicap ?? '—'}`
          : '✓ saved (round not started — applies at start)',
      }));
      void qc.invalidateQueries({ queryKey });
    },
    onError: (err, vars) => {
      setStatus((s) => ({ ...s, [vars.playerId]: `✕ ${err.code ?? 'failed'}` }));
    },
  });

  if (query.isLoading) return <PageShell title="Fix tees"><LoadingCard /></PageShell>;
  if (query.isError) return <PageShell title="Fix tees"><ErrorCard error="Couldn't load pairings." onRetry={query.refetch} /></PageShell>;
  const rounds = query.data!.rounds;

  return (
    <PageShell title="Fix tees">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />
      <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)', margin: '8px 0 16px' }}>
        Change a player&apos;s tee after the round started — it re-figures just their course handicap, and net/money
        recompute automatically. Best done before scores go in.
      </p>
      {rounds.length === 0 ? (
        <EmptyState title="No rounds yet." body="Set up rounds + pairings first." />
      ) : (
        rounds.map((r) => {
          const players = r.pairings
            .flatMap((p) => p.members)
            .sort((a, b) => a.name.localeCompare(b.name));
          return (
            <section key={r.eventRoundId} style={{ marginBottom: 'var(--space-5)' }}>
              <h2 style={{ fontSize: 'var(--font-md)', margin: '0 0 var(--space-2)' }}>
                Round {r.roundNumber} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: 'var(--font-sm)' }}>· default {r.defaultTeeColor}</span>
              </h2>
              {players.length === 0 ? (
                <p style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>No players paired in this round.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
                  {players.map((m) => (
                    <li key={m.playerId} className="card" style={{ padding: 'var(--space-2) var(--space-3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 0, flex: '1 1 120px', wordBreak: 'break-word', fontWeight: 600 }}>{m.name}</span>
                      <select
                        data-testid={`tee-select-${m.playerId}`}
                        value={m.teeColor ?? ''}
                        disabled={change.isPending}
                        onChange={(e) => {
                          const val = e.target.value === '' ? r.defaultTeeColor : e.target.value;
                          change.mutate({ eventRoundId: r.eventRoundId, playerId: m.playerId, teeColor: val });
                        }}
                        style={{ minHeight: 44, flex: '0 0 auto' }}
                      >
                        <option value="">{`tee: ${r.defaultTeeColor} (default)`}</option>
                        {r.availableTees.filter((t) => t !== r.defaultTeeColor).map((t) => (
                          <option key={t} value={t}>tee: {t}</option>
                        ))}
                      </select>
                      {status[m.playerId] ? (
                        <span data-testid={`tee-status-${m.playerId}`} style={{ flex: '1 1 100%', fontSize: 'var(--font-xs)', color: 'var(--color-text-secondary)' }}>{status[m.playerId]}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/fix-tees')({
  beforeLoad: async () => requireAuthOrRedirect(),
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  const { eventId } = useParams({ strict: false });
  if (!player.isOrganizer) return <div style={{ padding: 24 }}><h1>Forbidden</h1></div>;
  if (typeof eventId !== 'string') return <div>Invalid event.</div>;
  return <FixTeesPage eventId={eventId} />;
}
