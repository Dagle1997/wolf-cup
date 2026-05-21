/**
 * T11-3 test util. Mounts arbitrary JSX under a minimal TanStack Router
 * memory-router so components that render `<Link>` (e.g. the T11-3 BackLink
 * now present in PageShell-wrapped routes) have the required router context.
 *
 * Page-component tests render the Page directly (no route registration);
 * before T11-3 they needed no router. Adding BackLink to those pages means
 * `useRouter()` must resolve — this helper provides that context without
 * each test file building its own router harness.
 *
 * The tests do NOT assert on the BackLink's resolved href, so a permissive
 * root route is sufficient; Link renders an anchor under this context
 * without throwing.
 */
import type { ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';

export function renderInRouter(ui: ReactNode): RenderResult {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(<RouterProvider router={router} />);
}
