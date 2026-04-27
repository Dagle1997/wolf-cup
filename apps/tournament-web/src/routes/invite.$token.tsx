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
      <div>
        <h1>Welcome, {claimedPlayer.name}!</h1>
        {event ? (
          <p>
            Event: {event.name}
          </p>
        ) : null}
        <p>Your device is registered. You can now view the event schedule.</p>
        <p>
          {/* Placeholder — T7's schedule view doesn't exist yet. */}
          <a href={`/event/${event?.id ?? ''}`}>Event schedule (coming soon)</a>
        </p>
      </div>
    );
  }

  if (inviteQuery.isLoading) {
    return (
      <div>
        <h1>Loading invite…</h1>
      </div>
    );
  }

  if (inviteQuery.isError) {
    const status = inviteQuery.error?.status ?? 0;
    if (status === 410) {
      return (
        <div>
          <h1>This invite has expired</h1>
          <p role="alert">Ask Josh for a new invite link.</p>
        </div>
      );
    }
    if (status === 404) {
      return (
        <div>
          <h1>Invite not found</h1>
          <p role="alert">Double-check the link, or ask Josh for a new one.</p>
        </div>
      );
    }
    return (
      <div>
        <h1>Couldn't load invite</h1>
        <p role="alert">Try again in a moment.</p>
      </div>
    );
  }

  const data = inviteQuery.data;
  if (!data) {
    return null;
  }

  const claimError = claimMutation.error;

  return (
    <div>
      <h1>You're invited: {data.event.name}</h1>
      <p>Tap your name to register this device.</p>
      {claimError ? (
        <p role="alert">
          {claimError.code === 'player_not_in_event'
            ? "That name isn't on this event's roster — please pick again."
            : claimError.code === 'invite_expired'
              ? 'This invite has expired. Ask Josh for a new one.'
              : claimError.code === 'invite_not_found'
                ? 'Invite not found.'
                : 'Something went wrong. Please try again.'}
        </p>
      ) : null}
      <ul>
        {data.roster.map((entry) => (
          <li key={entry.playerId}>
            <button
              type="button"
              onClick={() => claimMutation.mutate(entry.playerId)}
              disabled={claimMutation.isPending}
            >
              {entry.name}
            </button>
          </li>
        ))}
      </ul>
      {data.roster.length === 0 ? (
        <p>The event roster is empty. Ask Josh to add players first.</p>
      ) : null}
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
