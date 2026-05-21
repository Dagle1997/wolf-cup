/**
 * T8-4 auth-session hook. Centralizes the auth-status query that
 * T7-6's InstallPromptHost and T8-4's AwardCelebration both read.
 * Same TanStack Query key (`['auth-status']`) so consumers across
 * the tree share ONE network round-trip.
 *
 * Logic extracted verbatim from `routes/__root.tsx` where it lived
 * inline before this story; T7-6 InstallPromptHost is migrated to
 * read from this hook (no behavior change).
 */

import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../lib/query-client';

export type AuthDevice = {
  id: string;
  installPromptShownAt: number | null;
};

export type AuthStatusResponse = {
  player: { id: string; isOrganizer: boolean } | null;
  device: AuthDevice | null;
};

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  try {
    const res = await fetch('/api/auth/status', { credentials: 'same-origin' });
    if (!res.ok) return { player: null, device: null };
    const body = (await res.json()) as unknown;
    const player =
      body !== null &&
      typeof body === 'object' &&
      typeof (body as { player?: unknown }).player === 'object' &&
      (body as { player?: { id?: unknown; isOrganizer?: unknown } }).player !== null &&
      typeof (body as { player: { id: unknown } }).player.id === 'string' &&
      typeof (body as { player: { isOrganizer: unknown } }).player.isOrganizer === 'boolean'
        ? {
            id: (body as { player: { id: string } }).player.id,
            isOrganizer: (body as { player: { isOrganizer: boolean } }).player.isOrganizer,
          }
        : null;
    const deviceRaw =
      body !== null &&
      typeof body === 'object' &&
      typeof (body as { device?: unknown }).device === 'object'
        ? ((body as { device: unknown }).device as
            | { id?: unknown; installPromptShownAt?: unknown }
            | null)
        : null;
    const device =
      deviceRaw !== null &&
      typeof deviceRaw.id === 'string' &&
      (deviceRaw.installPromptShownAt === null ||
        typeof deviceRaw.installPromptShownAt === 'number')
        ? {
            id: deviceRaw.id,
            installPromptShownAt: deviceRaw.installPromptShownAt as number | null,
          }
        : null;
    return { player, device };
  } catch {
    return { player: null, device: null };
  }
}

/**
 * Reads from the shared auth-status query. Multiple consumers in the
 * tree (InstallPromptHost, AwardCelebration, anything else) call this
 * hook without producing extra network calls — TanStack Query dedupes
 * by queryKey.
 *
 * Returns `{ player: null, device: null }` until the query resolves
 * (instead of returning the query state object), so callers can write
 * `const { player } = useAuthSession()` and check `player !== null`
 * to gate per-player UI.
 */
export function useAuthSession(): AuthStatusResponse {
  const query = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    staleTime: 30_000,
    retry: false,
  });
  return query.data ?? { player: null, device: null };
}

// ────────────────────────────────────────────────────────────────────────────
// T11-2 route-loader helpers. Consolidates the auth-status validation +
// fetch + redirect-on-null-player flow that was copy-pasted across 18
// route files pre-T11-2. New routes can now opt into auth-required
// gating with one import + one helper call from beforeLoad.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Schema-shape returned by /api/auth/status's `player` field, used by
 * route loaders that gate access to authenticated views. Subset of the
 * full AuthStatusResponse — many loaders only care about `player`.
 */
export type LoaderAuthStatus = {
  player: null | { id: string; isOrganizer: boolean };
};

/**
 * Validate + extract the `player` field from a raw /api/auth/status
 * response body. Defensive against missing/wrong-shape inputs (returns
 * { player: null } on any failure). Mirrors the per-route validateAuthStatus
 * function pre-T11-2 byte-for-byte.
 */
export function validateLoaderAuthStatus(body: unknown): LoaderAuthStatus {
  if (body === null || typeof body !== 'object') return { player: null };
  const p = (body as { player?: unknown }).player;
  if (p === null) return { player: null };
  if (
    p !== null &&
    typeof p === 'object' &&
    typeof (p as { id?: unknown }).id === 'string' &&
    typeof (p as { isOrganizer?: unknown }).isOrganizer === 'boolean'
  ) {
    return {
      player: {
        id: (p as { id: string }).id,
        isOrganizer: (p as { isOrganizer: boolean }).isOrganizer,
      },
    };
  }
  return { player: null };
}

/**
 * Fetch + validate /api/auth/status; returns { player: null } on any
 * network or parse failure. Mirrors the per-route loadAuthStatus function
 * pre-T11-2 byte-for-byte. NOTE: exposed for parity with the pre-T11-2
 * per-route loader symmetry; `requireAuthOrRedirect` does NOT use this
 * as its queryFn — it uses the existing full-shape `fetchAuthStatus` so
 * the `['auth-status']` cache stays consistent with `useAuthSession`
 * (which reads `{player, device}`).
 */
export async function loadLoaderAuthStatus(): Promise<LoaderAuthStatus> {
  const res = await fetch('/api/auth/status').catch(() => null);
  if (res === null || !res.ok) return { player: null };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body === null) return { player: null };
  return validateLoaderAuthStatus(body);
}

/**
 * TanStack Router `beforeLoad` helper. Reads /api/auth/status via the
 * shared `['auth-status']` query — populated by the existing
 * `fetchAuthStatus` (full `{player, device}` shape) so the cache stays
 * consistent with `useAuthSession`'s reads from InstallPromptHost and
 * AwardCelebration. Narrows the result to `{player}` for caller
 * convenience.
 *
 * If `player` is null, redirects the browser to `/api/auth/google` and
 * throws `'redirecting-to-oauth'` to halt route loading. Otherwise
 * returns `{player}` so the caller can chain
 * `return await requireAuthOrRedirect()` from beforeLoad.
 *
 * `opts.freshness`:
 *   - `'cache'` (default) — `fetchQuery` with `staleTime: 30_000`. Cache
 *     hit returns immediately; stale or cold triggers a blocking refetch.
 *   - `'always'` — `fetchQuery` with `staleTime: 0`. Every navigation
 *     refetches. Used by me.tsx + profile.tsx where a server-deleted
 *     session must surface before the 30s-cached read expires.
 *
 * Both code paths hardcode `retry: false`. Auth failures should surface
 * immediately as `player: null` → redirect, NOT trigger TanStack Query's
 * default 3-retry backoff.
 */
export async function requireAuthOrRedirect(
  opts?: { freshness?: 'cache' | 'always' },
): Promise<{ player: { id: string; isOrganizer: boolean } }> {
  const freshness = opts?.freshness ?? 'cache';
  const staleTime = freshness === 'always' ? 0 : 30_000;
  const status = await queryClient.fetchQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    staleTime,
    retry: false,
  });
  if (status.player === null) {
    window.location.assign('/api/auth/google');
    throw new Error('redirecting-to-oauth');
  }
  return { player: status.player };
}
