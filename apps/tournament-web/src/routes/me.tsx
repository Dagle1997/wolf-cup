/**
 * T3-7 /me page — signed-in identity view + "That's not me" escape hatch.
 *
 * **Authenticated route, NOT organizer-gated.** Any signed-in player may
 * view. The 5-step auth-status loader (T2-3b pattern) redirects anonymous
 * users to /api/auth/google.
 *
 * Provides the only v1 entry point for the `POST /api/auth/that-is-not-me`
 * endpoint, which deletes the current session row + the device_binding row
 * referenced by the device cookie. On success, the page redirects to `/`
 * — subsequent navigation will see no session and re-trigger auth as
 * needed.
 *
 * Dual-export: `Route` for TanStack file-route registration AND `MePage`
 * for direct test rendering.
 */

import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { requireAuthOrRedirect } from '../hooks/use-auth-session';

// ---- Component ------------------------------------------------------------

export type MePageProps = { player: { id: string; isOrganizer: boolean } };

export function MePage({ player }: MePageProps) {
  const [errorText, setErrorText] = useState<string | null>(null);

  const inFlightControllers = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const set = inFlightControllers.current;
    return () => {
      for (const ac of set) ac.abort();
      set.clear();
    };
  }, []);

  const mutation = useMutation<void, Error>({
    mutationFn: async () => {
      const ac = new AbortController();
      inFlightControllers.current.add(ac);
      try {
        const res = await fetch('/api/auth/that-is-not-me', {
          method: 'POST',
          credentials: 'same-origin',
          signal: ac.signal,
        });
        if (!res.ok) {
          throw new Error(`http_${res.status}`);
        }
      } finally {
        inFlightControllers.current.delete(ac);
      }
    },
    onSuccess: () => {
      // Hard navigation to home so the now-cleared cookies are picked up
      // on the next request. SPA-internal navigation would still hold
      // stale TanStack Query cache; the full reload re-runs the loader.
      window.location.assign('/');
    },
    onError: (err) => {
      // AbortError fires when the user navigates away mid-request — silent
      // is fine (the page is unmounting). Any other error gets surfaced.
      if (err.name !== 'AbortError') {
        setErrorText("Couldn't sign out — please try again.");
      }
    },
  });

  return (
    <div>
      <h1>Your account</h1>
      <p>
        Signed in as <code>{player.id}</code>
        {player.isOrganizer ? ' (organizer)' : ''}.
      </p>
      <p>
        If this isn&apos;t you — for example, the device was previously claimed
        by another player on the invite link — tap below to sign out and clear
        the device binding.
      </p>
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        {mutation.isPending ? 'Signing out…' : "That's not me"}
      </button>
      {errorText !== null ? (
        <p role="alert">{errorText}</p>
      ) : null}
    </div>
  );
}

// ---- Route registration ---------------------------------------------------

export const Route = createFileRoute('/me')({
  beforeLoad: async () => {
    // freshness: 'always' (staleTime 0) — /me is the "is this still me?"
    // surface; reading a 30s-cached auth-status can let a server-deleted
    // session keep the page visible until the cache expires. Force a fresh
    // check. Other routes use the default 'cache' (30s) freshness.
    return requireAuthOrRedirect({ freshness: 'always' });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { player } = Route.useRouteContext();
  return <MePage player={player} />;
}
