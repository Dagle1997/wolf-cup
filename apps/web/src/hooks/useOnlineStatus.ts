import { useState, useEffect } from 'react';

/**
 * Returns true when the browser believes it has network connectivity.
 * Wraps navigator.onLine and listens to 'online'/'offline' window events.
 *
 * Note: navigator.onLine === true does NOT guarantee a working connection,
 * but === false definitively means offline. Combined with detecting fetch
 * TypeErrors this gives reliable offline detection.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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
