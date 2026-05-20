import { describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { BackLink } from './back-link';

function renderWithRouter(testElement: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{testElement}</>,
  });
  const eventsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events',
    component: () => <div>events</div>,
  });
  const eventDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/admin/events/$eventId',
    component: () => <div>event detail</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, eventsRoute, eventDetailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

describe('BackLink', () => {
  test('renders default "← Back" label when no label prop', async () => {
    renderWithRouter(<BackLink to="/admin/events" />);
    // Router resolves Link href asynchronously; await both findByRole AND
    // the href assertion via waitFor to avoid version-dependent flakiness.
    const link = await screen.findByRole('link');
    expect(link).toHaveTextContent('← Back');
    await waitFor(() => {
      expect(link.getAttribute('href')).toBe('/admin/events');
    });
  });

  test('renders custom label prefixed with ←', async () => {
    renderWithRouter(<BackLink to="/admin/events" label="To events" />);
    const link = await screen.findByRole('link');
    expect(link).toHaveTextContent('← To events');
  });

  test('passes params to the underlying Link (typed route segment resolved)', async () => {
    renderWithRouter(
      <BackLink to="/admin/events/$eventId" params={{ eventId: 'abc-123' }} label="Back to event" />,
    );
    const link = await screen.findByRole('link');
    await waitFor(() => {
      expect(link.getAttribute('href')).toBe('/admin/events/abc-123');
    });
    expect(link).toHaveTextContent('← Back to event');
  });
});
