import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';

import { GlobalNav, isNavSuppressed } from './global-nav';

// Mock useAuthSession — GlobalNav reads { player } from it.
let mockPlayer: { id: string; isOrganizer: boolean } | null = null;
vi.mock('../hooks/use-auth-session', () => ({
  useAuthSession: () => ({ player: mockPlayer, device: null }),
}));

function renderAtPath(path: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  // Each route renders GlobalNav + a sentinel; tests await the sentinel
  // (router renders async) then assert nav presence/absence — so a
  // suppressed-route "no nav" assertion can't false-pass on not-yet-mounted.
  const mk = (p: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: p,
      component: () => (
        <>
          <GlobalNav />
          <div data-testid="route-ready" />
        </>
      ),
    });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      mk('/'),
      mk('/me'),
      mk('/events/$eventId'),
      mk('/auth/declined'),
      mk('/invite/$token'),
      mk('/rounds/$roundId/score-entry'),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

describe('isNavSuppressed (pure helper)', () => {
  test('suppresses /auth/ prefix', () => {
    expect(isNavSuppressed('/auth/declined')).toBe(true);
    expect(isNavSuppressed('/auth/conflict')).toBe(true);
  });
  test('suppresses /invite/ prefix', () => {
    expect(isNavSuppressed('/invite/abc-token')).toBe(true);
  });
  test('suppresses /rounds/{id}/score-entry exactly (with optional trailing slash)', () => {
    expect(isNavSuppressed('/rounds/abc/score-entry')).toBe(true);
    expect(isNavSuppressed('/rounds/abc/score-entry/')).toBe(true);
  });
  test('does NOT suppress a score-entry path with an extra trailing segment', () => {
    expect(isNavSuppressed('/rounds/abc/score-entry/extra')).toBe(false);
  });
  test('does NOT suppress an /authx/ near-miss (prefix must be /auth/)', () => {
    expect(isNavSuppressed('/authx/foo')).toBe(false);
  });
  test('does NOT suppress event/admin/home paths', () => {
    expect(isNavSuppressed('/')).toBe(false);
    expect(isNavSuppressed('/events/evt-123')).toBe(false);
    expect(isNavSuppressed('/me')).toBe(false);
  });
});

describe('GlobalNav', () => {
  test('authenticated, non-suppressed route → home link + account link', async () => {
    mockPlayer = { id: 'p-1', isOrganizer: false };
    renderAtPath('/events/evt-1234567890abcd');
    await screen.findByTestId('route-ready');
    expect(screen.getByRole('link', { name: /Tournament/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument();
  });

  test('anonymous, non-suppressed route → home link only (no account link)', async () => {
    mockPlayer = null;
    renderAtPath('/');
    await screen.findByTestId('route-ready');
    expect(screen.getByRole('link', { name: /Tournament/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
  });

  test('suppressed on /auth/ path → renders null (no nav)', async () => {
    mockPlayer = { id: 'p-1', isOrganizer: false };
    renderAtPath('/auth/declined');
    await screen.findByTestId('route-ready');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Tournament/ })).not.toBeInTheDocument();
  });

  test('suppressed on /invite/ path → renders null', async () => {
    mockPlayer = { id: 'p-1', isOrganizer: false };
    renderAtPath('/invite/tok-abc');
    await screen.findByTestId('route-ready');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  test('suppressed on score-entry path → renders null', async () => {
    mockPlayer = { id: 'p-1', isOrganizer: false };
    renderAtPath('/rounds/round-1/score-entry');
    await screen.findByTestId('route-ready');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  test('AC-6a: nav bar has sticky position + z-index 1000 + token-driven border', async () => {
    mockPlayer = { id: 'p-1', isOrganizer: false };
    renderAtPath('/me');
    await screen.findByTestId('route-ready');
    const nav = screen.getByRole('navigation');
    expect(nav.style.position).toBe('sticky');
    expect(nav.style.top).toBe('0px');
    expect(nav.style.zIndex).toBe('1000');
    expect(nav.style.borderBottom).toContain('var(--color-border-subtle)');
  });
});
