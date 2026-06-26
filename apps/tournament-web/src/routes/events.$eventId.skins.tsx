/**
 * Live Skins board — /events/:eventId/skins (Standings hub, "Skins" tab).
 *
 * Shows every skins pot (Net / Gross / Canadian) on the event's started rounds:
 * each participant's live net P&L (won − buy-in) and the per-hole skin winners
 * (with carries). Powered by GET /api/events/:eventId/skins, which reuses the
 * SAME engine the finalized pot uses, so the live board matches the payout.
 * LIVE — moves as scores come in; settles at finalize.
 *
 * Dual-export: Route + SkinsPage.
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
import { formatCents } from '../lib/format-cents';

type HoleWinner = {
  hole: number;
  winnerId: string | null;
  winnerName: string | null;
  carriedFromHoles: number[];
  skinValueCents: number;
};
type Share = { playerId: string; name: string | null; wonCents: number; netCents: number };
type Pot = {
  eventRoundId: string;
  roundNumber: number;
  mode: string;
  modeLabel: string;
  buyInPerParticipantCents: number;
  totalPotCents: number;
  participants: Array<{ playerId: string; name: string | null }>;
  holeWinners: HoleWinner[];
  shares: Share[];
};
type SkinsResponse = { eventId: string; pots: Pot[] };

async function fetchSkins(eventId: string): Promise<SkinsResponse> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/skins`, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`skins_fetch_failed_${res.status}`);
  return (await res.json()) as SkinsResponse;
}

function moneyColor(cents: number): string | undefined {
  if (cents > 0) return 'var(--color-money-pos)';
  if (cents < 0) return 'var(--color-money-neg)';
  return undefined;
}

function PotCard({ pot }: { pot: Pot }) {
  const skinsWon = pot.holeWinners.filter((h) => h.winnerId !== null);
  const shares = [...pot.shares].sort((a, b) => b.netCents - a.netCents);
  return (
    <section data-testid={`skins-pot-${pot.eventRoundId}-${pot.mode}`} style={{ marginBottom: 'var(--space-5)' }}>
      <div className="card" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-2)' }}>
          <strong style={{ fontSize: 'var(--font-md)' }}>
            Round {pot.roundNumber} · {pot.modeLabel}
          </strong>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatCents(pot.totalPotCents)} pot</span>
        </div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-xs)', marginTop: 'var(--space-1)' }}>
          {pot.participants.length} in · {formatCents(pot.buyInPerParticipantCents)} each · live
        </div>

        {/* Per-player net P&L (won − buy-in). */}
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-sm)', marginTop: 'var(--space-3)' }}>
          <thead>
            <tr style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
              <th style={{ padding: '2px 0' }}>Player</th>
              <th style={{ padding: '2px 0', textAlign: 'right' }}>Skins</th>
              <th style={{ padding: '2px 0', textAlign: 'right' }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {shares.map((s) => {
              const won = pot.holeWinners.filter((h) => h.winnerId === s.playerId).length;
              return (
                <tr key={s.playerId} style={{ borderTop: '1px solid var(--color-border-subtle, var(--color-border))' }}>
                  <td style={{ padding: '4px 0', wordBreak: 'break-word' }}>{s.name ?? '—'}</td>
                  <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)' }}>{won}</td>
                  <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: moneyColor(s.netCents), whiteSpace: 'nowrap' }}>
                    {formatCents(s.netCents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Per-hole skins won (carries noted). */}
        <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 'var(--font-xs)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>
            Skins won
          </div>
          {skinsWon.length === 0 ? (
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-muted)' }}>None yet — all holes tied/carrying or unscored.</div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {skinsWon.map((h) => (
                <li key={h.hole} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', fontSize: 'var(--font-sm)', padding: '2px 0' }}>
                  <span style={{ wordBreak: 'break-word' }}>
                    <span style={{ color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>Hole {h.hole}</span> · {h.winnerName ?? '—'}
                    {h.carriedFromHoles.length > 0 ? (
                      <span style={{ color: 'var(--color-text-muted)' }}> (carry {h.carriedFromHoles.join(', ')})</span>
                    ) : null}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--color-money-pos)' }}>{formatCents(h.skinValueCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export function SkinsPage({ eventId }: { eventId: string }) {
  const query = useQuery<SkinsResponse>({
    queryKey: ['skins', eventId],
    queryFn: () => fetchSkins(eventId),
    refetchInterval: 15_000,
  });

  return (
    <PageShell title="Skins">
      <BackLink to="/events/$eventId" params={{ eventId }} />
      <ViewTabs set="standings" active="skins" eventId={eventId} />
      {query.isPending ? (
        <LoadingCard />
      ) : query.isError ? (
        <ErrorCard title="Couldn't load skins." error={query.error} onRetry={query.refetch} />
      ) : query.data!.pots.length === 0 ? (
        <EmptyState icon="⛳" title="No skins yet" body="Skins pots show here once a putting/skins game is set and the round has started." />
      ) : (
        <div>
          {query.data!.pots.map((pot) => (
            <PotCard key={`${pot.eventRoundId}-${pot.mode}`} pot={pot} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

export const Route = createFileRoute('/events/$eventId/skins')({
  beforeLoad: async () => requireAuthOrRedirect(),
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <SkinsPage eventId={eventId} />;
}
