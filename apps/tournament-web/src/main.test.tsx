/**
 * T7-7 AC #6 wiring test. Imports the SAME `createAppRouter` factory
 * that `main.tsx` uses (see `apps/tournament-web/src/router.ts`).
 * If anyone removes or alters the `defaultNotFoundComponent: NotFound`
 * wiring inside `createAppRouter`, this test fails — that is the wiring
 * guarantee codex impl-codex round-1 Med #1 asked for.
 *
 * Why share the factory rather than reconstruct: the prior version of
 * this test built a hermetic router with its own `defaultNotFoundComponent`
 * argument, which only proved the component renders when wired — it
 * could pass even if `main.tsx`/`router.ts` failed to wire it. Sharing
 * the factory ties test coverage to the production config.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { createAppRouter } from './router';

describe('defaultNotFoundComponent wiring (AC #6)', () => {
  it('renders the production-wired NotFound for an unknown URL — no redirect, no throw', async () => {
    // The production route tree includes __root.tsx, which uses
    // useQuery for the InstallPromptHost — wrap in QueryClientProvider
    // so the host doesn't throw "No QueryClient set" before the
    // not-found component renders into the Outlet.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    });
    const router = createAppRouter(
      createMemoryHistory({ initialEntries: ['/this-route-does-not-exist'] }),
    );
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('not-found')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Page not found/i }),
    ).toBeInTheDocument();
  });
});
