/**
 * B0 — organizer view of per-player join codes to hand out. Players enter
 * their code at /join (no Google needed). Codes are generated on first load.
 */
import { createFileRoute, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';
import { PageShell } from '../components/page-shell';
import { BackLink } from '../components/back-link';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';

type CodesResponse = {
  eventId: string;
  players: Array<{ playerId: string; name: string; code: string | null }>;
};

async function fetchCodes(eventId: string): Promise<CodesResponse> {
  const res = await fetch(`/api/admin/events/${encodeURIComponent(eventId)}/join-codes`, {
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as CodesResponse;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={{
        minHeight: 'var(--control-height)',
        padding: '0 10px',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function JoinCodesPage({ eventId }: { eventId: string }) {
  const joinUrl = `${window.location.origin}/join`;
  const query = useQuery<CodesResponse, Error>({
    queryKey: ['join-codes', eventId],
    queryFn: () => fetchCodes(eventId),
    retry: false,
    staleTime: 30_000,
  });

  if (query.isPending) {
    return (
      <PageShell title="Join codes">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />
        <LoadingCard />
      </PageShell>
    );
  }
  if (query.isError) {
    return (
      <PageShell title="Join codes">
        <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />
        <ErrorCard error="Couldn't load join codes." onRetry={query.refetch} />
      </PageShell>
    );
  }

  const players = query.data!.players;

  return (
    <PageShell title="Join codes">
      <BackLink to="/admin/events/$eventId" params={{ eventId }} label="Event admin" />
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-sm)', margin: '12px 0' }}>
        Send each player their code. They go to <strong>{joinUrl}</strong> and enter it — no Google
        account needed.
      </p>

      {players.length === 0 ? (
        <EmptyState title="No players on the roster yet." body="Add players to the group first." />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--space-2)' }}>
          {players.map((p) => (
            <li
              key={p.playerId}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 'var(--space-2)',
                padding: 'var(--space-3)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface)',
              }}
            >
              <span style={{ minWidth: 0, flex: '1 1 120px', wordBreak: 'break-word' }}>
                <strong>{p.name}</strong>
                <span
                  data-testid={`join-code-${p.playerId}`}
                  style={{
                    display: 'block',
                    fontSize: 'var(--font-lg)',
                    fontFamily: 'monospace',
                    letterSpacing: '0.12em',
                    color: 'var(--color-brand-primary)',
                  }}
                >
                  {p.code ?? '—'}
                </span>
              </span>
              {p.code ? <CopyButton text={`Your join code: ${p.code} — go to ${joinUrl} to join.`} /> : null}
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

export const Route = createFileRoute('/admin/events/$eventId/join-codes')({
  beforeLoad: async () => requireAuthOrRedirect(),
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  const { eventId } = useParams({ strict: false });
  if (!player.isOrganizer) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Forbidden</h1>
        <p>You need organizer access to view join codes.</p>
      </div>
    );
  }
  if (typeof eventId !== 'string') return <div>Invalid event.</div>;
  return <JoinCodesPage eventId={eventId} />;
}
