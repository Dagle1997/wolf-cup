/**
 * Centralized router factory. Both `main.tsx` (production bootstrap) and
 * `main.test.tsx` (AC #6 wiring test) import this function so that the
 * test exercises the same `defaultNotFoundComponent` wiring used in
 * production. If anyone removes/changes the `NotFound` wiring here, the
 * test fails — that is the wiring guarantee codex impl-codex round-1
 * Med #1 asked for.
 *
 * Return type is intentionally INFERRED from `createRouter` (no
 * `: AnyRouter` annotation) so the precise `Router<typeof routeTree, ...>`
 * type flows through to `Register['router']` in main.tsx, preserving
 * route-tree-aware navigation type safety on `<Link>` / `useParams` /
 * etc. (codex impl-codex round-2 Med #1).
 */
import { createRouter, type RouterHistory } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { NotFound } from './components/not-found';

export function createAppRouter(history?: RouterHistory) {
  if (history) {
    return createRouter({
      routeTree,
      defaultNotFoundComponent: NotFound,
      history,
    });
  }
  return createRouter({
    routeTree,
    defaultNotFoundComponent: NotFound,
  });
}
