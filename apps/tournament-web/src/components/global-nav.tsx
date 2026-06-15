/**
 * T11-3 GlobalNav — persistent home/account anchor.
 *
 * Rendered in __root.tsx above <Outlet/>. The universal escape hatch that
 * fixes the audit's two HIGHs together (admin pages are dead-ends on iOS
 * standalone PWA + no global nav): every non-suppressed route gets a "home"
 * link regardless of how the user arrived (deep-link, notification, etc.),
 * so there is never a stranded dead-end page.
 *
 * Render rule:
 *   - On any NON-suppressed route: ALWAYS render the home link, regardless
 *     of auth state.
 *   - Account link (→ /me) renders ONLY when authenticated (player != null).
 *   - Suppressed routes (pre-auth / standalone / full-screen scorer) render
 *     nothing (the helper isNavSuppressed gates this).
 *
 * Pathname source: TanStack Router's useLocation() (NOT window.location) —
 * reactive to SPA navigation + driven by memory-history in tests. GlobalNav
 * is inside the router context (rendered in __root), so the hook is available.
 */
import { Link, useLocation } from '@tanstack/react-router';
import { useAuthSession } from '../hooks/use-auth-session';
import { ThemeToggle } from './theme-toggle';

/**
 * Pure suppression predicate. Returns true when the nav should render
 * nothing on the given pathname. Exact-match semantics:
 *   - `/auth/...`  (auth.conflict, auth.declined) — prefix
 *   - `/invite/...` (invite.$token) — prefix
 *   - `/rounds/{id}/score-entry` — regex (suffix after a dynamic id; a plain
 *     prefix match won't work, and a trailing `/extra` segment must NOT match)
 */
export function isNavSuppressed(pathname: string): boolean {
  if (pathname.startsWith('/auth/')) return true;
  if (pathname.startsWith('/invite/')) return true;
  if (/^\/rounds\/[^/]+\/score-entry\/?$/.test(pathname)) return true;
  return false;
}

export function GlobalNav() {
  const { pathname } = useLocation();
  const { player } = useAuthSession();

  if (isNavSuppressed(pathname)) return null;

  return (
    <nav
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `8px var(--page-padding)`,
        background: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border-subtle)',
        fontSize: 'var(--font-sm)',
      }}
    >
      <Link
        to="/"
        style={{
          color: 'var(--color-text-primary)',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        🏌️ Tournament
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <ThemeToggle />
        {player !== null ? (
          <Link
            to="/me"
            style={{
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
            }}
          >
            Account
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
