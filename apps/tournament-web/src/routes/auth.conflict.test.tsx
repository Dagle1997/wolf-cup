/**
 * T3-7 component test for the public /auth/conflict landing page.
 *
 * Uses RouterProvider so `<Link to="/">` resolves cleanly. Awaited
 * findByRole because TanStack Router's RouterProvider mounts the
 * matched route asynchronously.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';

import { ConflictPage } from './auth.conflict';

describe('ConflictPage', () => {
  it('renders the friendly error message + back-to-home link', async () => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> });
    const conflictRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/conflict',
      component: ConflictPage,
    });
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <div>home</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([conflictRoute, indexRoute]),
      history: createMemoryHistory({ initialEntries: ['/auth/conflict'] }),
    });
    render(<RouterProvider router={router} />);

    // findByRole awaits; RouterProvider mounts the matched route async.
    expect(
      await screen.findByRole('heading', { name: /that sign-in didn't match this device/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/this device was previously claimed by a different sign-in/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/ask josh to merge identities/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to home/i })).toBeInTheDocument();
  });
});
