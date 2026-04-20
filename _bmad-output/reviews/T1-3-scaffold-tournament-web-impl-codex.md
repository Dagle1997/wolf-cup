# Codex Review

- Generated: 2026-04-20T16:39:42.550Z
- Model: gpt-5.2
- Reasoning effort: medium
- Workspace root: D:\wolf-cup
- Reviewed files: apps/tournament-web/package.json, apps/tournament-web/tsconfig.json, apps/tournament-web/tsconfig.app.json, apps/tournament-web/vite.config.ts, apps/tournament-web/vitest.config.ts, apps/tournament-web/eslint.config.js, apps/tournament-web/index.html, apps/tournament-web/.gitignore, apps/tournament-web/src/main.tsx, apps/tournament-web/src/index.css, apps/tournament-web/src/routeTree.gen.ts, apps/tournament-web/src/lib/query-client.ts

## Summary

The scaffold is broadly consistent with the described shipped behavior (Vite+React+TanStack Router+Tailwind+PWA, proxy, query client defaults, committed routeTree). The main concrete concern visible in the provided files is that React Query Devtools is always rendered (including production builds), which is an avoidable prod-footgun. A couple of configuration choices (proxy changeOrigin=false, PWA devOptions enabled) are not clearly wrong but could cause dev/prod surprises depending on the spec’s exact expectations.

Overall risk: medium

## Findings

1. [medium] React Query Devtools rendered unconditionally (likely ships in production bundle/UI)
   - File: apps/tournament-web/src/main.tsx:5-28
   - Confidence: high
   - Why it matters: Rendering <ReactQueryDevtools /> unconditionally means it will be included in production builds and exposed to end users. That increases bundle size and can expose internal query keys, endpoints, and cached payloads via an in-app debug UI. Even if not a classic vulnerability, this is a common production hardening expectation for web scaffolds.
   - Suggested fix: Gate Devtools behind a dev-only condition, e.g. `import.meta.env.DEV && <ReactQueryDevtools ... />`, or conditionally import it in development to avoid bundling it in production.

2. [low] Vite dev proxy uses changeOrigin: false (can break APIs that validate Host header / origin assumptions)
   - File: apps/tournament-web/vite.config.ts:65-73
   - Confidence: medium
   - Why it matters: With `changeOrigin: false`, proxied requests preserve the original Host header (likely `localhost:5173`). Some backends/middleware (CSRF protections, allowed-host checks, absolute URL generation) expect Host to match the target (`localhost:3000`). This can cause subtle dev-only failures or misbehavior.
   - Suggested fix: If parity/spec expects it, consider `changeOrigin: true` (common default) or document why it must remain false for this backend.

3. [low] PWA service worker enabled in dev mode may cause confusing caching during development
   - File: apps/tournament-web/vite.config.ts:18-22
   - Confidence: medium
   - Why it matters: `devOptions.enabled: true` allows a service worker to run in development. This commonly causes stale assets/API responses and can make debugging harder (especially with runtimeCaching rules that include `/api/`). Not necessarily incorrect, but it’s a frequent source of developer confusion.
   - Suggested fix: If the spec doesn’t require dev SW, consider disabling by default (or enabling only with an env flag). If it is required for parity, ensure the spec explicitly calls this out and that developers have a documented reset path (unregister SW / clear site data).

## Strengths

- Plugin ordering in Vite matches the stated requirement (TanStack Router first, then React, Tailwind, then PWA).
- PWA manifest/theme-color wiring is consistent between `index.html` and VitePWA manifest configuration.
- Workbox `globPatterns` explicitly includes `**/*.webmanifest` rather than relying on brace expansion; runtime caching is scoped to `/api/` and uses a distinct cacheName.
- Engine boundary restriction is present via `no-restricted-imports` and `src/routeTree.gen.ts` is ignored as intended for generated output.
- QueryClient defaults are centralized and simple; tsconfig path alias matches Vite alias.

## Warnings

None.
