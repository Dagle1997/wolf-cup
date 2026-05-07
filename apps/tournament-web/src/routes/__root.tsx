import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FirstMutationProvider, useFirstMutationFlag } from '../hooks/use-first-mutation';
import { InstallPrompt } from '../components/install-prompt';
import { useIsInstalledPWA } from '../lib/display-mode';
import { ActivityFeedProvider } from '../providers/activity-feed-provider';
import { TournamentToast } from '../components/tournament-toast';
import { TournamentBanner } from '../components/tournament-banner';
import { AwardCelebration } from '../components/award-celebration';
import { useAuthSession } from '../hooks/use-auth-session';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <FirstMutationProvider>
      <ActivityFeedProvider>
        <div>
          <Outlet />
          <InstallPromptHost />
          <TournamentToast />
          <TournamentBanner />
          <AwardCelebration />
        </div>
      </ActivityFeedProvider>
    </FirstMutationProvider>
  );
}

// ---- T7-6 install prompt host -------------------------------------------
// AuthStatusResponse + fetchAuthStatus moved to `hooks/use-auth-session.ts`
// in T8-4 so AwardCelebration can read the same TanStack Query
// subscription via `useAuthSession()`.

function InstallPromptHost() {
  const qc = useQueryClient();
  const flag = useFirstMutationFlag();
  const [beforeInstallEvent, setBeforeInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const isStandalone = useIsInstalledPWA();

  // Codex impl-codex round-1 High #1 — host-level stamp guard. The child
  // `<InstallPrompt>` may unmount/remount under React 18 StrictMode in
  // dev, which would let a child-level useRef guard fire onShown twice.
  // Lifting the guard here keeps the invariant across the child's full
  // mount lifecycle — once stamped, this host instance never POSTs again
  // (and the backend is idempotent anyway).
  const hostStampedRef = useRef(false);

  // T8-4: replaces the inline useQuery with the shared hook.
  // Same queryKey, same network call — TanStack Query dedupes.
  const authStatus = useAuthSession();

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

  if (authStatus.player === null) return null;
  const device = authStatus.device;
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
