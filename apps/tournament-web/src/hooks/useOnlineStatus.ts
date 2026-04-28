/* PORTED from apps/web/src/hooks/useOnlineStatus.ts @ commit ddf921b29afe9b6b50a1f136021502770b180e65, dated 2026-04-27.
 * Tournament deltas: identical to Wolf Cup; module location shift only.
 */

import { useEffect, useState } from 'react';

/**
 * Returns true when the browser believes it has network connectivity.
 * Wraps navigator.onLine and listens to 'online'/'offline' window events.
 *
 * Note: navigator.onLine === true does NOT guarantee a working connection,
 * but === false definitively means offline. Combined with detecting fetch
 * TypeErrors this gives reliable offline detection.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
