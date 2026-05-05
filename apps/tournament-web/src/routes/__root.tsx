import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FirstMutationProvider, useFirstMutationFlag } from '../hooks/use-first-mutation';
import { InstallPrompt } from '../components/install-prompt';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <FirstMutationProvider>
      <div>
        <Outlet />
        <InstallPromptHost />
      </div>
    </FirstMutationProvider>
  );
}

// ---- T7-6 install prompt host -------------------------------------------

type AuthDevice = {
  id: string;
  installPromptShownAt: number | null;
};

type AuthStatusResponse = {
  player: { id: string; isOrganizer: boolean } | null;
  device: AuthDevice | null;
};

async function fetchAuthStatus(): Promise<AuthStatusResponse> {
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

function InstallPromptHost() {
  const qc = useQueryClient();
  const flag = useFirstMutationFlag();
  const [beforeInstallEvent, setBeforeInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  // Codex impl-codex round-1 High #1 — host-level stamp guard. The child
  // `<InstallPrompt>` may unmount/remount under React 18 StrictMode in
  // dev, which would let a child-level useRef guard fire onShown twice.
  // Lifting the guard here keeps the invariant across the child's full
  // mount lifecycle — once stamped, this host instance never POSTs again
  // (and the backend is idempotent anyway).
  const hostStampedRef = useRef(false);

  const authQuery = useQuery({
    queryKey: ['auth-status'],
    queryFn: fetchAuthStatus,
    staleTime: 30_000,
    retry: false,
  });

  // Capture beforeinstallprompt at mount; the global slot is set by
  // main.tsx before React hydrates, so we read it here AND register a
  // fallback listener in case the event fires after hydration.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.__deferredInstallPrompt) {
      setBeforeInstallEvent(window.__deferredInstallPrompt);
    }
    const handler = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      window.__deferredInstallPrompt = e;
      setBeforeInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(display-mode: standalone)');
    setIsStandalone(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsStandalone(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => {
      mql.removeEventListener?.('change', onChange);
    };
  }, []);

  if (!authQuery.data?.player) return null;
  const device = authQuery.data.device;
  // No device row → we cannot stamp; render nothing. (Either the cookie
  // is missing, malformed, or the row doesn't match this player.)
  if (device === null) return null;

  // Codex impl-codex round-3 High #1 + Med #2: only render when a real
  // eventId is in the URL. The mutation sites that flip `flag` (score
  // entry, gallery upload) are both event-scoped; if we somehow ended up
  // on a non-event route with `flag === true`, suppress the prompt
  // rather than POST under a dummy eventId (which would persist a
  // meaningless audit-log payload AND, with the previous "treat 404 as
  // success" rule, lock the host without actually stamping).
  const eventIdFromLocation = extractEventIdFromLocation();
  if (eventIdFromLocation === null) return null;

  const onShown = useCallback(async () => {
    // Concurrency lock: hostStampedRef serves as an in-flight guard so a
    // parallel onShown call (e.g. dismiss + unmount-cleanup racing)
    // doesn't POST twice. On retry-eligible failure we RESET the ref so
    // the next mutation cycle can retry — the backend is idempotent.
    if (hostStampedRef.current) return;
    hostStampedRef.current = true;

    // Resolve eventId from the URL fresh (the host may have been mounted
    // since the user navigated). Bail without POSTing if the URL no
    // longer matches an event route — we still invalidate the query so
    // the auth-status reflects the latest state, and reset the ref so
    // a future mount on an event route can stamp.
    const eventId = extractEventIdFromLocation();
    if (eventId === null) {
      hostStampedRef.current = false;
      await qc.invalidateQueries({ queryKey: ['auth-status'] });
      return;
    }

    let succeeded = false;
    try {
      const res = await fetch(
        `/api/events/${eventId}/devices/me/install-prompt-shown`,
        { method: 'POST', credentials: 'same-origin' },
      );
      // 204: newly stamped (or already stamped — idempotent) → done.
      // 4xx: client error (invalid_event_id, device_binding_not_found).
      //   Retrying produces the same result; lock stays.
      // 5xx / network: transient → retry-eligible; reset lock.
      if (res.ok || (res.status >= 400 && res.status < 500)) succeeded = true;
    } catch {
      // network failure — swallow; ref will reset below.
    }
    if (!succeeded) {
      hostStampedRef.current = false;
    }
    await qc.invalidateQueries({ queryKey: ['auth-status'] });
  }, [qc]);

  return (
    <InstallPrompt
      installPromptShownAt={device.installPromptShownAt}
      hasMutatedThisSession={flag}
      isStandalone={isStandalone}
      beforeInstallEvent={beforeInstallEvent}
      userAgent={typeof navigator !== 'undefined' ? navigator.userAgent : ''}
      onShown={onShown}
    />
  );
}

function extractEventIdFromLocation(): string | null {
  // Match the backend's eventId shape guard exactly (apps/tournament-api/
  // src/routes/install-prompt.ts:42-44): 16-128 chars of [A-Za-z0-9_-].
  // A shorter / out-of-charset segment is NOT treated as an eventId — we
  // suppress the prompt entirely rather than POST and 400 the request,
  // which would otherwise lock the host's stamp guard for the SPA session
  // (codex impl-codex round-4 High #1, round-5 High #1: regex must be
  // boundary-anchored so the 16-128 length cap applies to the FULL
  // segment between `/events/` and the next path boundary, not a
  // prefix of it).
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(
    /\/events\/([A-Za-z0-9_-]{16,128})(?=\/|$)/,
  );
  if (!m) return null;
  return m[1] ?? null;
}
