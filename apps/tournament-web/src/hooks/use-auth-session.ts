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
