/**
 * Single source of truth for PWA-install detection. Consumed by T7-6's
 * install-prompt host (see `__root.tsx`) and T7-7's scorer-gated
 * install-required state on the score-entry route.
 *
 * `isInstalledPWA()` is a synchronous getter — testable without React.
 * `useIsInstalledPWA()` is a React hook that listens for runtime
 * display-mode changes (the page being added to home screen
 * mid-session, etc.).
 */

import { useEffect, useState } from 'react';

export function isInstalledPWA(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  }
  // iOS Safari fallback: navigator.standalone is iOS-specific and was
  // never standardized.
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as unknown as { standalone?: boolean })
      : null;
  if (nav !== null && nav.standalone === true) return true;
  return false;
}

export function useIsInstalledPWA(): boolean {
  const [installed, setInstalled] = useState<boolean>(() => isInstalledPWA());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(display-mode: standalone)');
    // Optional-chaining mirrors __root.tsx:116-125 — pre-14 Safari
    // exposes only the deprecated addListener API; we don't bridge to
    // it, so older Safari users render with the initial read only.
    const onChange = () => setInstalled(isInstalledPWA());
    mql.addEventListener?.('change', onChange);
    return () => {
      mql.removeEventListener?.('change', onChange);
    };
  }, []);

  return installed;
}
