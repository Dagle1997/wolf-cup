/**
 * T3-6 invite-link first-arrival page at /invite/$token.
 *
 * **PUBLIC route — no `beforeLoad` auth check.** First tournament-web route
 * that doesn't gate on /api/auth/status. Anonymous users see this page;
 * the token IS the auth.
 *
 * Backend endpoints consumed:
 *   - GET /api/invites/:token — fetch event + roster
 *   - POST /api/invites/:token/claim — claim a player_id on this device
 *
 * Dual-export: Route + InvitePage.
 */

import { createFileRoute, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { LoadingCard } from '../components/loading-card';
import { ErrorCard } from '../components/error-card';
import { EmptyState } from '../components/empty-state';

// ---- Types ----------------------------------------------------------------

type EventSummary = {
  id: string;
  name: string;
  startDate: number;
  endDate: number;
  timezone: string;
};

type RosterEntry = { playerId: string; name: string };

type InviteResponse = {
  event: EventSummary;
  roster: RosterEntry[];
};

type ClaimResponse = {
  player: { id: string; name: string };
  event: { id: string; name: string };
  deviceBindingId: string;
};

type ClaimError = { code?: string };

// ---- Component ------------------------------------------------------------

export function InvitePage({ token }: { token: string }) {
  const [claimedPlayer, setClaimedPlayer] = useState<{ id: string; name: string } | null>(null);

  const inFlightControllers = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const set = inFlightControllers.current;
    return () => {
      for (const ac of set) ac.abort();
      set.clear();
    };
  }, []);
  function trackController(): AbortController {
    const ac = new AbortController();
    inFlightControllers.current.add(ac);
    return ac;
  }
  function releaseController(ac: AbortController): void {
    inFlightControllers.current.delete(ac);
  }

  // ---- Fetch invite ----------------------------------------------------

  const inviteQuery = useQuery<InviteResponse, Error & { status?: number }>({
    queryKey: ['invite', token],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}`, { signal });
      if (!res.ok) {
        const err = new Error(`http_${res.status}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as InviteResponse;
    },
    retry: false,
    staleTime: 30_000,
  });

  // ---- Claim mutation -------------------------------------------------

  const claimMutation = useMutation<ClaimResponse, Error & { code?: string }, string>({
    mutationFn: async (playerId: string) => {
      const ac = trackController();
      try {
        const res = await fetch(`/api/invites/${encodeURIComponent(token)}/claim`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId }),
          credentials: 'same-origin',
          signal: ac.signal,
        });
        const body = (await res.json().catch(() => null)) as
          | (ClaimResponse & ClaimError)
          | null;
        if (!res.ok) {
          const code = body?.code;
          const err = new Error(code ?? `http_${res.status}`) as Error & {
            code?: string;
          };
          if (code !== undefined) err.code = code;
          throw err;
        }
        return body as ClaimResponse;
      } finally {
        releaseController(ac);
      }
    },
    onSuccess: (data) => {
      setClaimedPlayer({ id: data.player.id, name: data.player.name });
    },
  });

  // ---- Render ---------------------------------------------------------

  if (claimedPlayer) {
    const event = inviteQuery.data?.event;
    return (
      <div style={{ maxWidth: 'var(--page-max-width)', margin: '0 auto', padding: 'var(--space-4)' }}>
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-4)' }}>
          <div aria-hidden="true" style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--color-brand-tint)', color: 'var(--color-brand-primary)', fontSize: 'var(--font-2xl)', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--space-3)' }}>
            ✓
          </div>
          <h1 style={{ fontSize: 'var(--font-xl)', margin: 0 }}>Welcome, {claimedPlayer.name}!</h1>
          {event ? <p style={{ color: 'var(--color-text-secondary)', margin: 'var(--space-2) 0 0' }}>{event.name}</p> : null}
          <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-3)' }}>
            Your device is registered — you&apos;re all set.
          </p>
        </div>
      </div>
    );
  }

  if (inviteQuery.isLoading) {
    return (
      <div>
        <LoadingCard message="Loading invite…" />
      </div>
    );
  }

  if (inviteQuery.isError) {
    const status = inviteQuery.error?.status ?? 0;
    if (status === 410) {
      return (
        <div>
          <ErrorCard
            title="This invite has expired"
            error="Ask Josh for a new invite link."
          />
        </div>
      );
    }
    if (status === 404) {
      return (
        <div>
          <ErrorCard
            title="Invite not found"
            error="Double-check the link, or ask Josh for a new one."
          />
        </div>
      );
    }
    return (
      <div>
        <ErrorCard
          title="Couldn't load invite"
          error="Try again in a moment."
        />
      </div>
    );
  }

  const data = inviteQuery.data;
  if (!data) {
    return null;
  }

  const claimError = claimMutation.error;

  return (
    <div style={{ maxWidth: 'var(--page-max-width)', margin: '0 auto', paddingBottom: 'var(--space-6)' }}>
      <header
        style={{
          background: 'var(--color-brand-primary)', color: '#fff',
          padding: 'var(--space-6) var(--space-4)', borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <h1 style={{ fontSize: 'var(--font-sm)', fontWeight: 600, opacity: 0.85, margin: 0, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          You&apos;re invited
        </h1>
        <div style={{ fontSize: 'var(--font-xl)', fontWeight: 700, marginTop: 4 }}>{data.event.name}</div>
        <p style={{ margin: 'var(--space-2) 0 0', opacity: 0.9 }}>Tap your name to join.</p>
      </header>

      <div style={{ padding: '0 var(--space-4)' }}>
        {claimError ? (
          <p role="alert" style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
            {claimError.code === 'player_not_in_event'
              ? "That name isn't on this event's roster — please pick again."
              : claimError.code === 'invite_expired'
                ? 'This invite has expired. Ask Josh for a new one.'
                : claimError.code === 'invite_not_found'
                  ? 'Invite not found.'
                  : 'Something went wrong. Please try again.'}
          </p>
        ) : null}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {data.roster.map((entry) => (
            <li key={entry.playerId}>
              <button
                type="button"
                data-skip-base-style
                onClick={() => claimMutation.mutate(entry.playerId)}
                disabled={claimMutation.isPending}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  minHeight: 'var(--control-height-lg)', padding: '0 var(--space-4)',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', cursor: 'pointer',
                  textAlign: 'left', font: 'inherit', color: 'var(--color-text-primary)',
                }}
              >
                <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-brand-tint)', color: 'var(--color-brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flex: '0 0 auto' }}>
                  {(entry.name ?? '?').trim().charAt(0).toUpperCase()}
                </span>
                <span style={{ flex: 1, fontSize: 'var(--font-md)', fontWeight: 600 }}>{entry.name}</span>
                <span aria-hidden="true" style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-lg)' }}>›</span>
              </button>
            </li>
          ))}
        </ul>
        {data.roster.length === 0 ? (
          <EmptyState title="The event roster is empty." body="Ask Josh to add players first." />
        ) : null}
      </div>
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/invite/$token')({
  // NO beforeLoad — anonymous-friendly per FR-E1.
  component: RouteComponent,
});

function RouteComponent() {
  const { token } = useParams({ from: '/invite/$token' });
  return <InvitePage token={token} />;
}
