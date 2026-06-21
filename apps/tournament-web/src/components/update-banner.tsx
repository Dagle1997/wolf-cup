/**
 * "New version — tap to refresh" banner (ported from Wolf Cup).
 *
 * Polls GET /api/version every 60s. `version` is the API process startup time;
 * a redeploy restarts the process → the value changes vs. the first one seen →
 * we surface a full-width refresh bar so users on a stale SPA pick up the new
 * build instead of hitting mismatched assets/endpoints.
 */
import { useEffect, useRef, useState } from 'react';

export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const initialVersionRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch('/api/version', { credentials: 'same-origin' });
        if (!res.ok) return;
        const body = (await res.json()) as { version: number };
        if (cancelled) return;
        if (initialVersionRef.current === null) {
          initialVersionRef.current = body.version;
        } else if (body.version !== initialVersionRef.current) {
          setUpdateAvailable(true);
        }
      } catch {
        // Network blip — try again next tick.
      }
    }
    void check();
    const id = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <button
      type="button"
      data-skip-base-style
      data-testid="update-banner"
      onClick={() => window.location.reload()}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        display: 'block',
        width: '100%',
        border: 'none',
        borderRadius: 0,
        background: 'var(--color-brand-primary)',
        color: '#fff',
        padding: 'var(--space-2) var(--space-4)',
        fontWeight: 600,
        fontSize: 'var(--font-sm)',
        cursor: 'pointer',
        minHeight: 'var(--control-height)',
      }}
    >
      ↻ New version available — tap to refresh
    </button>
  );
}
