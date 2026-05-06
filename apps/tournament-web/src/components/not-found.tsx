/**
 * Default 404 component wired into the TanStack Router via
 * `defaultNotFoundComponent` inside `createAppRouter()` (see
 * `apps/tournament-web/src/router.ts`). Exported as a named symbol so
 * the AC #6 test can import the same component used in production.
 */
export function NotFound() {
  return (
    <div role="main" data-testid="not-found">
      <h1>Page not found</h1>
      <p>The link you followed isn't valid.</p>
    </div>
  );
}
