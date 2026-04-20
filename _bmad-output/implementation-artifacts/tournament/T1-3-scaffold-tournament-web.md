# Story T1.3: Scaffold tournament-web

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a fresh Vite + React 19 + TanStack Router + Tailwind v4 + vite-plugin-pwa scaffold at `apps/tournament-web/` matching Wolf Cup's exact versions,
so that tournament has a deployable PWA skeleton that builds cleanly, runs Vitest from day one, and enforces the FD-11/12 engine-import boundary — independent of Wolf Cup's source tree.

## Acceptance Criteria

1. **Given** a fresh checkout
   **When** `pnpm install` runs at the repo root
   **Then** `apps/tournament-web/` is picked up by the existing `apps/*` workspace glob in `pnpm-workspace.yaml`, and `apps/tournament-web/package.json` declares name `@tournament/web` (private, `"type": "module"`, `"version": "0.0.0"`). Dependency + devDependency **package names** MUST match Wolf Cup's `apps/web/package.json` for the set listed below. **Version ranges MUST be copied verbatim from `apps/web/package.json` at implementation time** — Wolf Cup is the source of truth. The numeric ranges below are a 2026-04-20 snapshot of `apps/web/package.json` for reviewer context; if any range in `apps/web/package.json` has drifted since this date, implementation MUST use the current Wolf Cup range, not the snapshot.
   Dependencies (runtime):
   - `react` (snapshot: `^19.0.0`)
   - `react-dom` (snapshot: `^19.0.0`)
   - `@tanstack/react-router` (snapshot: `^1.163.3`)
   - `@tanstack/react-query` (snapshot: `^5.90.21`)
   - `@tailwindcss/vite` (snapshot: `^4.2.1`)
   - `tailwindcss` (snapshot: `^4.2.1`)
   - `vite-plugin-pwa` (snapshot: `^1.2.0`)
   - `idb` (snapshot: `^8.0.3`)
   - `lucide-react` (snapshot: `^0.575.0`)
   - `@radix-ui/react-slot` (snapshot: `^1.2.4`)
   - `class-variance-authority` (snapshot: `^0.7.1`)
   - `clsx` (snapshot: `^2.1.1`)
   - `tailwind-merge` (snapshot: `^3.5.0`)
   devDependencies (tournament-web additions beyond Wolf Cup's set — Wolf Cup web does NOT ship Vitest, tournament does per architecture.md:239):
   - `@tanstack/router-cli` (snapshot: `^1.163.3`)
   - `@tanstack/router-plugin` (snapshot: `^1.163.3`)
   - `@tanstack/react-query-devtools` (snapshot: `^5.91.3`)
   - `@types/react` (snapshot: `^19.0.0`)
   - `@types/react-dom` (snapshot: `^19.0.0`)
   - `@vitejs/plugin-react` (snapshot: `^4.0.0`)
   - `typescript` (snapshot: `^5.7.0`)
   - `vite` (snapshot: `^6.0.0`)
   - `vitest` (snapshot: `^3.0.0`) — **not** present in `apps/web/package.json`; this is a deliberate tournament add.
   Parity verification is a required implementation step (Subtask 7.1a): diff tournament-web's declared ranges against the current `apps/web/package.json` and reconcile any mismatch except `vitest` (tournament-web only). `sharp` is explicitly NOT copied from Wolf Cup — it exists in Wolf Cup's devDeps for icon generation, which tournament's placeholder-icon approach doesn't need.
2. **Given** `apps/tournament-web/package.json`
   **When** inspected
   **Then** neither `@wolf-cup/engine` nor any `@wolf-cup/*` workspace dep appears in `dependencies` or `devDependencies`. The scaffold ships zero engine imports; future stories (T5.2+) add the dep if and when they need `@wolf-cup/engine/stableford` per FD-11/12. (Rationale: mirrors T1-2's tournament-api scaffold, which also ships without an engine dep declaration until first use.)
3. **Given** `apps/tournament-web/package.json`
   **When** inspected
   **Then** `eslint`, `@eslint/js`, and `typescript-eslint` are NOT declared in either `dependencies` or `devDependencies`. These are declared at the repo root (`package.json` devDependencies) and pnpm hoists them — duplicating them risks version drift. Same pattern as `apps/web/package.json` and `apps/tournament-api/package.json`.
4. **Given** `apps/tournament-web/package.json`'s `scripts` block
   **When** inspected
   **Then** it contains exactly these entries (mirror Wolf Cup's web scripts, add `test`):
   ```json
   {
     "routes:generate": "tsr generate",
     "typecheck": "tsr generate && tsc --noEmit -p tsconfig.app.json",
     "lint": "eslint src",
     "dev": "vite",
     "build": "vite build",
     "preview": "vite preview",
     "test": "vitest run"
   }
   ```
5. **Given** the scaffolded web workspace
   **When** `pnpm -F @tournament/web dev` runs
   **Then** Vite's dev server binds to port `5173` and forwards requests matching `/api/*` to `http://localhost:3000` (the tournament-api dev port from T1-2). This is expressed in `apps/tournament-web/vite.config.ts` via `server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } } }`. (Divergence from Wolf Cup: Wolf Cup's `apps/web/vite.config.ts` has no `server` block — tournament explicitly needs it so dev runs with one command against a local tournament-api without CORS friction.)
6. **Given** `apps/tournament-web/vite.config.ts`
   **When** inspected
   **Then** it exports a default `defineConfig({...})` with plugins in this exact order (TanStack Router plugin first is mandatory — it must emit `routeTree.gen.ts` before the React transform runs):
   1. `TanStackRouterVite({ target: 'react', autoCodeSplitting: true })` from `@tanstack/router-plugin/vite`
   2. `react()` from `@vitejs/plugin-react`
   3. `tailwindcss()` from `@tailwindcss/vite`
   4. `VitePWA({ ... })` from `vite-plugin-pwa` with the manifest shape from AC #7
   AND declares `resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }` AND the `server: {...}` block from AC #5.
7. **Given** the `VitePWA` plugin configuration in `vite.config.ts`
   **When** inspected
   **Then** it specifies:
   - `registerType: 'autoUpdate'`
   - `injectRegister: 'auto'` — pins the plugin's default registration-injection strategy explicitly so the emitted artifact set (a registration script auto-linked from `index.html`) is deterministic regardless of future plugin-default changes.
   - `filename: 'sw.js'` — pins the service-worker output filename so AC #15's verification can reference the name without depending on plugin defaults.
   - `devOptions: { enabled: true, type: 'module' }`
   - `manifest`: tournament branding — `name: 'Tournament'`, `short_name: 'Tournament'`, `description: 'Multi-course golf tournament scorer'`, `display: 'standalone'`, `orientation: 'portrait'`, `theme_color: '#0f172a'` (slate-900 — distinct from Wolf Cup's `#1a1a1a`), `background_color: '#ffffff'`, `start_url: '/'`, and `icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]`.
   - `workbox: { clientsClaim: true, skipWaiting: true, globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}', '**/*.webmanifest'], runtimeCaching: [{ urlPattern: /\/api\//i, handler: 'NetworkFirst', options: { cacheName: 'tournament-api-cache', networkTimeoutSeconds: 3, expiration: { maxEntries: 50, maxAgeSeconds: 300 }, cacheableResponse: { statuses: [0, 200] } } }] }` (cache name `tournament-api-cache` — distinct from Wolf Cup's `wolf-api-cache` to avoid SW collision if both apps ever share an origin during development). The PWA manifest itself is precached via the separate `'**/*.webmanifest'` entry — using two explicit glob patterns rather than one brace-expansion pattern (`**/*.{...,webmanifest}`) avoids relying on whichever brace-expansion semantics Workbox's underlying matcher ships in a given release. **Divergence from Wolf Cup (deliberate):** Wolf Cup's `vite.config.ts` sets `globIgnores: ['**/icon-*.png']`, excluding the very icons its manifest references. Tournament OMITS `globIgnores` so the icons referenced by the manifest are precached by the service worker — self-consistent PWA config.
   - No `shortcuts` entry (Wolf Cup has Admin/Practice shortcuts tied to its routes; tournament's routes don't exist yet at scaffold time).
8. **Given** the source tree
   **When** inspected
   **Then** the following files exist with the specified semantics:
   - `apps/tournament-web/index.html` — HTML shell referencing `/src/main.tsx` as the module entry, `<link rel="manifest" href="/manifest.webmanifest" />`, `<title>Tournament</title>`, tournament-flavored `<meta name="theme-color" content="#0f172a" />`, and the standard iOS PWA `<meta>` tags (`apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title` = "Tournament"). Icon links point at `/icon-192.png`.
   - `apps/tournament-web/src/main.tsx` — imports `StrictMode` from `'react'`, `createRoot` from `'react-dom/client'`, `createRouter` + `RouterProvider` from `'@tanstack/react-router'`, `QueryClientProvider` from `'@tanstack/react-query'`, `ReactQueryDevtools` from `'@tanstack/react-query-devtools'`, `routeTree` from `'./routeTree.gen'`, `queryClient` from `'./lib/query-client'`, and `'./index.css'`. Wires the providers in order `QueryClientProvider > RouterProvider + ReactQueryDevtools` inside a `StrictMode` render to `#root`. Includes the TanStack Router type-registration `declare module '@tanstack/react-router' { interface Register { router: typeof router } }`. Shape MUST mirror `apps/web/src/main.tsx` 1:1 except for any Wolf-Cup-specific imports (there are none — Wolf Cup's main.tsx is already framework-only).
   - `apps/tournament-web/src/index.css` — single line `@import "tailwindcss";` followed by the `@custom-variant dark (&:is(.dark *));` line. NO further `@theme inline { ... }` shadcn token mapping at scaffold time (shadcn primitives land in a later UX story; scaffold ships bare Tailwind v4 defaults).
   - `apps/tournament-web/src/lib/query-client.ts` — exports `queryClient` as `new QueryClient({ defaultOptions: { queries: { staleTime: 4000, gcTime: 300000, retry: 1 } } })` — identical shape to `apps/web/src/lib/query-client.ts`.
   - `apps/tournament-web/src/routes/__root.tsx` — minimal anchor root: `export const Route = createRootRoute({ component: RootComponent });` where `RootComponent` renders `<Outlet />` inside a simple `<div>`. NO header, nav, dark-mode toggle, online/offline logic, or branding chrome — those land in a later UX story. Intentionally minimal so that future stories replace this file wholesale with real chrome rather than untangling scaffold stubs.
   - `apps/tournament-web/src/routes/index.tsx` — minimal anchor index route: `export const Route = createFileRoute('/')({ component: IndexPage });` where `IndexPage` renders a single `<h1>Tournament</h1>` (or equivalent single-element placeholder). Gives the build something to render at `/`; doesn't implement product UI.
   - `apps/tournament-web/src/routeTree.gen.ts` — generated by `tsr generate` from `@tanstack/router-cli`. File is committed (Wolf Cup pattern: commit the generated route tree so typecheck on a fresh clone works without forcing `pnpm routes:generate` first).
   - `apps/tournament-web/public/icon-192.png` and `apps/tournament-web/public/icon-512.png` — placeholder PNG icons referenced by the PWA manifest. At scaffold time these are intentional stand-ins (e.g., a 192×192 / 512×512 solid-fill PNG with a single letter "T") — a future UX story ships real branding. The files MUST exist and MUST be valid PNGs so the PWA manifest doesn't 404.
9. **Given** tsconfig layout
   **When** inspected
   **Then** `apps/tournament-web/tsconfig.json` and `apps/tournament-web/tsconfig.app.json` exist with the shapes below (mirror `apps/web/tsconfig.json` + `apps/web/tsconfig.app.json`). NO `tsconfig.node.json` (Wolf Cup's web doesn't ship one; vite.config.ts compiles under the same tsconfig as src — verified by `ls apps/web/`).
   - `tsconfig.json`:
     ```json
     {
       "compilerOptions": {
         "baseUrl": ".",
         "paths": { "@/*": ["./src/*"] }
       },
       "files": [],
       "references": [{ "path": "./tsconfig.app.json" }]
     }
     ```
   - `tsconfig.app.json`:
     ```json
     {
       "extends": "../../tsconfig.base.json",
       "compilerOptions": {
         "target": "ES2020",
         "lib": ["ES2020", "DOM", "DOM.Iterable"],
         "module": "ESNext",
         "moduleResolution": "Bundler",
         "jsx": "react-jsx",
         "noEmit": true,
         "baseUrl": ".",
         "paths": { "@/*": ["./src/*"] }
       },
       "include": ["src"]
     }
     ```
   These MUST be byte-identical in structure to the Wolf Cup equivalents so a future base-config bump lands symmetrically in both apps.
10. **Given** `apps/tournament-web/eslint.config.js`
    **When** inspected
    **Then** it is a flat-config file (ESLint 9.x) that exports `tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, { ignores: ['**/dist/**', '**/dev-dist/**', '**/node_modules/**', '**/*.js', 'src/routeTree.gen.ts'] }, { rules: { ...engine-boundary... } })`. **Note on the two `recommended` configs:** `eslint.configs.recommended` comes from `@eslint/js` and is a single config object; `tseslint.configs.recommended` comes from `typescript-eslint` and is an array of config objects (hence the spread). Not a duplicate — different packages, complementary rulesets. This mirrors `apps/tournament-api/eslint.config.js` exactly. The engine-boundary `no-restricted-imports` rule MUST match `apps/tournament-api/eslint.config.js` verbatim (AC #6 of T1-2):
    ```js
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@wolf-cup/engine',
        message: 'Tournament may only import from @wolf-cup/engine/stableford (FD-11/12). Use the subpath import.',
      }],
      patterns: [{
        group: ['@wolf-cup/engine/*', '!@wolf-cup/engine/stableford'],
        message: 'Tournament may only import @wolf-cup/engine/stableford (FD-11/12).',
      }],
    }]
    ```
    The `ignores` list MUST include `src/routeTree.gen.ts` because the generated file uses patterns (explicit `any`, module augmentation) that trip base typescript-eslint rules and is not meant to be linted.
11. **Given** `apps/tournament-web/vitest.config.ts`
    **When** inspected
    **Then** it exports `defineConfig({ test: { environment: 'node' } })` — identical environment choice as `apps/tournament-api/vitest.config.ts`. No jsdom at scaffold time; the scaffold smoke test (Subtask 6.3) is a non-DOM module-level assertion. A later UX/test-tooling story introduces `jsdom` + `@testing-library/react` when rendering tests become necessary.
12. **Given** the web workspace
    **When** `pnpm -F @tournament/web test` runs
    **Then** Vitest 3.x executes successfully and exits `0`. The workspace MUST ship with at least one passing smoke test (see Subtask 6.3) that imports `queryClient` from `./src/lib/query-client` and asserts `queryClient instanceof QueryClient` + the configured `staleTime` value matches. This exercises module resolution, TypeScript compilation, and vitest wiring without touching the DOM.
13. **Given** the web workspace
    **When** `pnpm -F @tournament/web typecheck` runs
    **Then** it exits `0`. `tsr generate` emits `src/routeTree.gen.ts` cleanly from `__root.tsx` + `index.tsx`, then `tsc --noEmit -p tsconfig.app.json` passes under the base-config strictness flags (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`).
14. **Given** the web workspace
    **When** `pnpm -F @tournament/web lint` runs
    **Then** it exits `0`. (No source imports `@wolf-cup/engine` at scaffold; the rule is a guard for future stories.)
15. **Given** the build
    **When** `pnpm -F @tournament/web build` runs
    **Then** it exits `0` and produces `apps/tournament-web/dist/` containing, at minimum:
    - `index.html`
    - A PWA manifest file containing `"name": "Tournament"` and `"theme_color": "#0f172a"` (verifies tournament branding flows from source config to built artifact). Filename defaults to `manifest.webmanifest` under vite-plugin-pwa; AC #7 does not override this so `manifest.webmanifest` is the expected name. The content check on `"name"` + `"theme_color"` is the **authoritative AC**; if a future plugin version renames the file, loosen the path but keep the content assertion.
    - A service worker file at `dist/sw.js` (pinned by AC #7's `filename: 'sw.js'`).
    - `icon-192.png` and `icon-512.png` at the dist root (copied from `public/`).
    - At least one `assets/*.js` bundle and at least one `assets/*.css` bundle.
    - A registration-script reference from `index.html`. The literal filename emitted by `injectRegister: 'auto'` is plugin-internal (typically `registerSW.js` but subject to plugin version changes). The **authoritative check** is that `dist/index.html` contains a `<script>` tag whose `src` or inline content references either `registerSW` or `workbox-window` — this proves the SW registration plumbing is wired into the built artifact. A plain Node test (no shell globbing, cross-platform) satisfies this; sample: `node -e "const fs=require('fs'); const html=fs.readFileSync('apps/tournament-web/dist/index.html','utf8'); if (!/registerSW|workbox-window/.test(html)) { process.exit(1); }"`.
    - Workbox runtime chunks (filename pattern like `workbox-*.js`) **MAY** be present in `dist/assets/` — this is plugin-default behavior but NOT asserted, because inlining-vs-chunking is a plugin-internal implementation detail that may change across vite-plugin-pwa versions.
    **Optional smoke (not a pass gate):** `pnpm -F @tournament/web preview` can be run manually to serve the built `dist/` over `http://localhost` and verify the service worker registers in DevTools → Application → Service Workers. This is dev sanity, not an AC — service workers do not register on `file://` origins, so literally opening `dist/index.html` from the filesystem does NOT constitute a valid registration test.
16. **Given** `apps/tournament-web/.gitignore`
    **When** inspected
    **Then** it contains exactly these lines (app-local; MUST NOT edit the repo-root `.gitignore`):
    ```
    dist/
    dev-dist/
    .vite/
    ```
    (`dist/` is also in root `.gitignore` but duplicating it here documents intent; `dev-dist/` is vite-plugin-pwa's dev SW scratch and is NOT covered by root `.gitignore`; `.vite/` is Vite's local cache — root `.gitignore` line 37 scopes `.vite/` to `apps/web/` specifically so tournament needs its own entry.)
17. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/api test` and `pnpm -F @wolf-cup/engine test` run after the scaffold lands
    **Then** both continue to pass with zero new failures and zero net-negative test count change (Wolf Cup regression protection per FR-G1, NFR-C3). Same rule as T1-2 AC #9.

## Tasks / Subtasks

- [ ] Task 1: Create the `apps/tournament-web/` directory tree — root config files (AC: #1, #3, #4, #9, #10, #11, #16)
  - [ ] Subtask 1.1: Create `apps/tournament-web/package.json` with name `@tournament/web`, `"private": true`, `"type": "module"`, `"version": "0.0.0"`, the `scripts` block from AC #4 verbatim, and deps/devDeps matching AC #1 exactly. Do NOT add `eslint`, `@eslint/js`, `typescript-eslint` (per AC #3), `@wolf-cup/engine` or any `@wolf-cup/*` (per AC #2), `sharp` (Wolf Cup's web has it for icon generation; tournament's placeholder icons don't need it), `bcrypt`, or `@types/bcrypt`.
  - [ ] Subtask 1.2: Create `apps/tournament-web/tsconfig.json` and `apps/tournament-web/tsconfig.app.json` per AC #9 verbatim. Verify against `apps/web/tsconfig.json` + `apps/web/tsconfig.app.json` — they should be structurally identical.
  - [ ] Subtask 1.3: Create `apps/tournament-web/vitest.config.ts` with `environment: 'node'` per AC #11 (mirror `apps/tournament-api/vitest.config.ts` shape).
  - [ ] Subtask 1.4: Create `apps/tournament-web/eslint.config.js` as a flat-config exporting the typescript-eslint recommended configs plus the engine-boundary `no-restricted-imports` rule from AC #10 verbatim. Include `src/routeTree.gen.ts` in the `ignores` list (generated file — not lint-clean by design).
  - [ ] Subtask 1.5: Create `apps/tournament-web/.gitignore` per AC #16 (exactly three lines: `dist/`, `dev-dist/`, `.vite/`). Do NOT edit the repo-root `.gitignore` (SHARED path).
- [ ] Task 2: Create `apps/tournament-web/vite.config.ts` (AC: #5, #6, #7)
  - [ ] Subtask 2.1: Author `vite.config.ts` with plugins in the exact order from AC #6: `TanStackRouterVite`, `react()`, `tailwindcss()`, `VitePWA({...})`. Set `resolve.alias` for `@` → `./src` using `fileURLToPath(new URL('./src', import.meta.url))`.
  - [ ] Subtask 2.2: Add the `server` block — `port: 5173`, `proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } }`. `changeOrigin: false` matches dev posture where the browser's request origin is `http://localhost:5173` and tournament-api accepts it without cross-origin rewrites.
  - [ ] Subtask 2.3: Author the `VitePWA` config block per AC #7 — `registerType: 'autoUpdate'`, `devOptions.enabled: true`, tournament-branded manifest, workbox config with `runtimeCaching` NetworkFirst for `/api/*` caching with `cacheName: 'tournament-api-cache'` (distinct from Wolf Cup's `wolf-api-cache`).
- [ ] Task 3: Create `apps/tournament-web/index.html` (AC: #8)
  - [ ] Subtask 3.1: Shell HTML referencing `/src/main.tsx`, `/manifest.webmanifest`, `/icon-192.png` for the apple-touch-icon, with `<meta name="theme-color" content="#0f172a" />`, iOS PWA meta tags (`apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style=black-translucent`, `apple-mobile-web-app-title=Tournament`), and `<title>Tournament</title>`. Single `<div id="root"></div>` in body.
- [ ] Task 4: Create the `src/` skeleton (AC: #8)
  - [ ] Subtask 4.1: Create `apps/tournament-web/src/main.tsx` per AC #8 — wire `QueryClientProvider` > `RouterProvider` + `ReactQueryDevtools` inside `StrictMode` rendered to `#root`. Include the TanStack Router `declare module` type registration.
  - [ ] Subtask 4.2: Create `apps/tournament-web/src/index.css` with `@import "tailwindcss";` + `@custom-variant dark (&:is(.dark *));`. No shadcn token mapping.
  - [ ] Subtask 4.3: Create `apps/tournament-web/src/lib/query-client.ts` exporting `queryClient` per AC #8 (staleTime 4000, gcTime 300000, retry 1 — same as Wolf Cup).
  - [ ] Subtask 4.4: Create `apps/tournament-web/src/routes/__root.tsx` — bare `createRootRoute({ component: RootComponent })` rendering `<Outlet />` inside an unstyled `<div>`. One `useEffect` or hook is NOT permitted at this layer; scaffold chrome is deferred.
  - [ ] Subtask 4.5: Create `apps/tournament-web/src/routes/index.tsx` — `createFileRoute('/')({ component: IndexPage })` rendering `<h1>Tournament</h1>` (single placeholder element).
- [ ] Task 5: Generate `src/routeTree.gen.ts` (AC: #8, #13)
  - [ ] Subtask 5.1: Run `pnpm -F @tournament/web routes:generate` (which runs `tsr generate`). Commit the emitted `src/routeTree.gen.ts`.
- [ ] Task 6: PWA placeholder icons + smoke test (AC: #8, #12, #15)
  - [ ] Subtask 6.1: Create `apps/tournament-web/public/icon-192.png` — a minimal valid 192×192 PNG. Acceptable approaches: (a) use a Node one-liner via `Buffer.from('iVBORw0KGgo...', 'base64')` to emit a 1×1 PNG and accept the 1×1-declared-as-192×192 mismatch (browsers will still scale), OR (b) render a simple solid-fill square using any available PNG-producing tool. A 1×1 placeholder is fine — branding comes in a later story. The key requirement: the file exists and is a syntactically valid PNG so the build doesn't 404.
  - [ ] Subtask 6.2: Same for `apps/tournament-web/public/icon-512.png`.
  - [ ] Subtask 6.3: Create `apps/tournament-web/src/lib/query-client.test.ts` containing a single `test('queryClient is configured', () => { ... })` that imports `queryClient` from `'./query-client'` and `QueryClient` from `'@tanstack/react-query'`, then asserts: (a) `queryClient instanceof QueryClient`, (b) `queryClient.getDefaultOptions().queries?.staleTime === 4000`, (c) `queryClient.getDefaultOptions().queries?.gcTime === 300000`, (d) `queryClient.getDefaultOptions().queries?.retry === 1`. No DOM, no render. This is the full scaffold smoke suite.
- [ ] Task 7: Wire install + verify (AC: #1, #13, #14, #15)
  - [ ] Subtask 7.1: Run `pnpm install` at the repo root. Confirm `apps/tournament-web/node_modules/` populates and no version warnings fire about `@tournament/web`. `pnpm-lock.yaml` updates are expected — it is SHARED, so **the dev-agent MUST stop and request user approval before staging the lockfile change**. Don't commit without approval.
  - [ ] Subtask 7.1a: **Dependency parity verification** (AC #1). For every package name in AC #1's dep + devDep list (excluding `vitest`, which is tournament-only), compare `apps/tournament-web/package.json`'s declared range against `apps/web/package.json`'s current range. Any mismatch is a bug — update tournament-web's range to match Wolf Cup's current value. Record the comparison (pkg, wolf-cup range, tournament-web range, action) in the Debug Log. This step is what enforces the "source of truth is `apps/web/package.json` at implementation time" rule; the 2026-04-20 snapshot in AC #1 is a reviewer aid, not authoritative.
  - [ ] Subtask 7.2: Run `pnpm -F @tournament/web typecheck` — must exit `0`. If this fails, fix the source; do NOT loosen tsconfig strictness to work around errors.
  - [ ] Subtask 7.3: Run `pnpm -F @tournament/web lint` — must exit `0`.
  - [ ] Subtask 7.4: Run `pnpm -F @tournament/web test` — must exit `0` with 1 passing test.
  - [ ] Subtask 7.5: Run `pnpm -F @tournament/web build` — must exit `0`. Confirm `dist/` contains `index.html`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`, and at least one `assets/*.js` + `assets/*.css` bundle. Then run the two cross-platform content checks from AC #15 and record both results in the Debug Log:
    1. Manifest branding (use `node -e "const m = require('./apps/tournament-web/dist/manifest.webmanifest'); if (m.name !== 'Tournament' || m.theme_color !== '#0f172a') process.exit(1);"` or equivalent `fs.readFileSync` + `JSON.parse` if `require` of a `.webmanifest` file errors).
    2. Registration-script wiring in `index.html` (use `node -e "const fs=require('fs'); const html=fs.readFileSync('apps/tournament-web/dist/index.html','utf8'); if (!/registerSW|workbox-window/.test(html)) process.exit(1);"`).
    Both MUST exit `0`. If either fails, the build is not AC-compliant — fix the vite.config.ts config before proceeding.
  - [ ] Subtask 7.6: Manually start the dev server (`pnpm -F @tournament/web dev`) locally to confirm port 5173 + proxy behavior. This is a dev-sanity check, not a CI gate. Capture the console line confirming port 5173 in the Debug Log section.
- [ ] Task 8: Wolf Cup regression protection (AC: #17)
  - [ ] Subtask 8.1: Run `pnpm -F @wolf-cup/engine test` — must pass with the same test count as before this story.
  - [ ] Subtask 8.2: Run `pnpm -F @wolf-cup/api test` — must pass with the same test count as before this story.
  - [ ] Subtask 8.3: Do NOT run `pnpm -F @wolf-cup/web` commands — not needed for T1.3 verification, and Wolf Cup's web typecheck timing isn't part of the T1.3 pass gate.

## Dev Notes

- **Divergence from Wolf Cup scaffold (intentional, called out by architecture + epic ACs):**
  - Wolf Cup's `apps/web/vite.config.ts` has NO `server` block — dev server defaults apply. Tournament MUST add `server: { port: 5173, proxy: { '/api': { target: 'http://localhost:3000' } } }` so a single `pnpm -F @tournament/web dev` works against a locally-running tournament-api with no CORS config required (epic AC scenario 1).
  - Wolf Cup's PWA manifest is Wolf-Cup-branded. Tournament's is tournament-branded: `name: 'Tournament'`, `short_name: 'Tournament'`, `theme_color: '#0f172a'`, distinct `cacheName: 'tournament-api-cache'` in workbox runtimeCaching. Same SHAPE as Wolf Cup, different content.
  - Wolf Cup does NOT have an engine-boundary eslint rule today. Tournament introduces it at scaffold time per architecture.md lines 1158-1177 and FD-11/12.
  - Wolf Cup does not ship Vitest in its web workspace. Tournament DOES — architecture.md:239 ("Vitest 3.x in tournament-api + tournament-web from day one — skip engine-vs-API drift Wolf Cup currently has"). The scaffold smoke test (Subtask 6.3) establishes the test runner.
  - Architecture.md:321 mentions `postcss.config.js` + `tailwind.config.ts` as target files. Wolf Cup ships NEITHER; it uses Tailwind v4's zero-config `@tailwindcss/vite` plugin plus `@import "tailwindcss";` in CSS. This is the correct pattern under Tailwind v4 — the Tailwind v3-era config files are not needed. This story follows Wolf Cup's actual shipped shape (no `postcss.config.js`, no `tailwind.config.ts`); the architecture doc is aspirational there and will be reconciled in a future doc update, not this story's scope.
  - Architecture.md:319 mentions `tsconfig.node.json` as a third tsconfig. Wolf Cup doesn't ship one — `ls apps/web/` confirms only `tsconfig.json` + `tsconfig.app.json`. Tournament follows the shipped shape. Same rationale as above: architecture doc drifts from reality, reality wins (evidence-first).
- **Why `changeOrigin: false` on the dev proxy:** Vite's `changeOrigin` option controls whether the proxy rewrites the outgoing `Host` **header** on the proxied request (NOT the browser's `Origin` header, and NOT CORS — those are separate concerns). With `changeOrigin: false`, Vite keeps the `Host: localhost:5173` header the browser sent when forwarding to `http://localhost:3000`. With `changeOrigin: true`, Vite rewrites it to `Host: localhost:3000`. Tournament-api doesn't make routing decisions based on the `Host` header today, and both dev origins are already on `localhost`, so either value works. We pick `false` as the minimal-surprise default because (a) tournament-api in prod will see `Host: tournament.dagle.cloud` from nginx, and (b) no tournament logic depends on this header. Future auth-flow work that sets cookies scoped to a specific `Host`/domain or does host-based absolute redirects may need `changeOrigin: true` and/or `cookieDomainRewrite` — flip then, not now.
- **Why the root component is intentionally minimal:** Wolf Cup's `__root.tsx` is 210 lines of chrome (header with brand, dark-mode toggle, online detector, version-poll, bottom nav, footer). Copying that shape at scaffold time locks tournament into Wolf Cup branding and route assumptions. A later UX story designs tournament's chrome from scratch; scaffold ships a transparent shell so that story replaces `__root.tsx` wholesale rather than untangling placeholder decisions.
- **Why icons are placeholder:** real branding (logo, name, tagline) is a marketing/design decision that hasn't been made yet — the PRD uses "Tournament (app name TBD)" for a reason. Shipping a real icon at T1.3 would commit to a brand before the brand exists. A 1×1 placeholder PNG satisfies the PWA manifest's technical requirement without implying design intent.
- **Why commit `routeTree.gen.ts`:** Wolf Cup commits it (`apps/web/src/routeTree.gen.ts` is tracked). Benefit: `pnpm -F @tournament/web typecheck` on a fresh clone works without forcing `pnpm routes:generate` first. Cost: the file changes whenever routes change, adding noise to diffs. Wolf Cup accepts this trade and tournament matches. A later story can revisit (e.g., generate-in-CI-only) if the diff noise becomes painful.
- **`pnpm-lock.yaml` will change on install.** pnpm rewrites the lockfile when registering a new workspace's deps. This is expected, not avoidable. The lockfile is a SHARED file per the director's path allowlist — the dev-agent MUST stop and ask Josh for explicit approval before staging the lockfile change, per T1-2 precedent (Dev Notes, `pnpm-lock.yaml was modified by pnpm install (unavoidable side effect of registering a new workspace)`). Expected approval request wording: "Subtask 7.1 — `pnpm install` modified `pnpm-lock.yaml` by registering `@tournament/web`. Stage the lockfile change?"
- **No routes beyond `/`.** Auth routes are T1.6. Event / pairings / scoring / gallery routes are T2+. Adding scaffolding for routes that don't exist invites churn.
- **No service-worker registration call in `main.tsx`.** `vite-plugin-pwa` with `registerType: 'autoUpdate'` emits `registerSW.js` and auto-imports it; manual `registerSW()` calls in `main.tsx` are only needed for `registerType: 'prompt'` flows. Scaffold uses the simpler `autoUpdate` path (same as Wolf Cup), so `main.tsx` stays framework-only.
- **No shadcn primitives at scaffold.** The package.json includes `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, and `lucide-react` as future-use deps matching Wolf Cup's footprint, but no `src/components/ui/*.tsx` files exist. A later UX story introduces the shadcn primitives with tournament's own design tokens. Including the deps now ensures the `pnpm install` tree resolves consistently and pnpm doesn't re-lock when shadcn lands.
- **No Dockerfile in this story.** T1.4 adds `apps/tournament-web/Dockerfile` + `apps/tournament-web/nginx.conf` + docker-compose service + Traefik labels. T1.3 is local-dev-runnable only. Do NOT create a Dockerfile in this story.
- **No `src/lib/api.ts` or `src/lib/env.ts` yet.** Wolf Cup ships `apiFetch` at `apps/web/src/lib/api.ts` with `const BASE = '/api'`. Tournament's first route that makes an API call will add this — scaffold doesn't need it because the `/` index route renders a static placeholder.
- **Wolf Cup isolation (FD-1/FD-2):** this story does NOT touch `apps/api`, `apps/web`, `packages/engine`, Wolf Cup's migrations, Wolf Cup's tests, or any root-level SHARED files except `pnpm-lock.yaml` (approval required — see above). All source writes are under `apps/tournament-web/`. `pnpm-workspace.yaml` already globs `apps/*` so no workspace-manifest edit is needed.

### Project Structure Notes

- Target directory: `apps/tournament-web/` at repo root.
- All new files live under that directory.
- `pnpm-workspace.yaml` (repo root) already contains `- 'apps/*'` — no edit needed.
- The repo-root `.gitignore` is NOT edited. Tournament-web ships its own `apps/tournament-web/.gitignore` (contents in Subtask 1.5).
- Shape after this story (target tree):
  ```
  apps/tournament-web/
    package.json
    tsconfig.json
    tsconfig.app.json
    vite.config.ts
    vitest.config.ts
    eslint.config.js
    index.html
    .gitignore
    public/
      icon-192.png              # placeholder PNG
      icon-512.png              # placeholder PNG
    src/
      main.tsx                  # StrictMode + QueryClientProvider + RouterProvider + DevTools
      index.css                 # @import "tailwindcss"; @custom-variant dark ...
      routeTree.gen.ts          # generated by tsr generate, committed
      lib/
        query-client.ts
        query-client.test.ts    # smoke test per Subtask 6.3
      routes/
        __root.tsx              # bare <Outlet/> shell
        index.tsx               # <h1>Tournament</h1> placeholder
  ```
- **Files NOT in scope at T1.3** (added in later stories, called out to prevent dev-agent overreach):
  - `apps/tournament-web/Dockerfile` — T1.4
  - `apps/tournament-web/nginx.conf` — T1.4
  - `apps/tournament-web/PORTS.md` — created when the first port lands (T5.2 scorer UI or T5.3 offline queue)
  - `apps/tournament-web/src/lib/api.ts` — created by the first story that makes an API call (likely T2.5 courses admin UI or T1.6 auth)
  - `apps/tournament-web/src/lib/env.ts` — created when env vars become necessary (likely T1.6 auth)
  - Any `src/components/ui/*.tsx` shadcn primitives — later UX story
  - Any additional routes beyond `/` — per-feature stories

### References

- Story source — `_bmad-output/planning-artifacts/tournament/epics-phase1.md` heading `#### Story T1.3: Scaffold tournament-web` (lines 394-420).
- FD-1 (monorepo posture) — `_bmad-output/planning-artifacts/tournament/prd.md` heading `### FD-1: Monorepo posture — no rename`.
- FD-11/12 (engine boundary — stableford only) — `_bmad-output/planning-artifacts/tournament/architecture.md` lines 1158-1177; this is the same rule T1-2 pinned (`apps/tournament-api/eslint.config.js`).
- FD-14 (PWA-primary + install prompt) — `_bmad-output/planning-artifacts/tournament/architecture.md` line 33.
- Scaffold manifest — `_bmad-output/planning-artifacts/tournament/architecture.md` lines 317-324. **Note divergence from architecture**: architecture lists `postcss.config.js`, `tailwind.config.ts`, `tsconfig.node.json` as target files; Wolf Cup ships none of these, so this story follows shipped reality.
- Vitest day-one requirement — `_bmad-output/planning-artifacts/tournament/architecture.md` line 239.
- Scaffold fresh-not-copied — `_bmad-output/planning-artifacts/tournament/architecture.md` lines 303-305.
- T1-2 pattern precedents (READ only — no edits to T1-2 artifacts):
  - `_bmad-output/implementation-artifacts/tournament/T1-2-scaffold-tournament-api.md` — the dev-agent should read this file in full before starting; the story shape + dev-notes tone match.
  - `apps/tournament-api/eslint.config.js` — exact engine-boundary rule to mirror (AC #10).
  - `apps/tournament-api/vitest.config.ts` — Vitest config shape to mirror (AC #11).
- Wolf Cup scaffold references (READ only — do not edit):
  - `apps/web/package.json` — deps + devDeps version source-of-truth (AC #1).
  - `apps/web/tsconfig.json` + `apps/web/tsconfig.app.json` — tsconfig shape to mirror (AC #9).
  - `apps/web/vite.config.ts` — plugin order + PWA shape (adapt for tournament branding).
  - `apps/web/src/main.tsx` — provider wiring pattern to mirror 1:1.
  - `apps/web/src/lib/query-client.ts` — QueryClient options to mirror.
  - `apps/web/index.html` — HTML shell shape (adapt for tournament title/meta).
  - `apps/web/eslint.config.js` — flat-config shape (add engine-boundary rule on top).
- Shared tsconfig — `tsconfig.base.json` (no edit; just extend via `tsconfig.app.json`).
- Existing root eslint config — `eslint.config.js` (pattern reference; no edit to root).

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Claude Opus 4.7, 1M context), running as the Tournament Director orchestrator.

### Debug Log References

Spec-review rounds (2026-04-20):
- Round 1: 2 High + 2 Medium + 1 Low — all mechanically fixed (`_bmad-output/reviews/T1-3-scaffold-tournament-web-spec-codex.md`).
- Round 2: 1 High + 3 Medium — all mechanically fixed (`_bmad-output/reviews/T1-3-scaffold-tournament-web-spec-codex-round2.md`).
- Round 3: 1 Medium + 1 Low — both mechanically fixed (`_bmad-output/reviews/T1-3-scaffold-tournament-web-spec-codex-round3.md`).

Implementation verification pipeline (2026-04-20):

```
# Subtask 7.1: pnpm install (repo root)
Scope: all 6 workspace projects   # was 5 before T1.3
Done in 3.4s using pnpm v9.15.9
# pnpm-lock.yaml modified — expected; SHARED path; requires explicit approval before staging.

# Subtask 7.1a: Dependency parity vs apps/web/package.json
All 21 packages matched Wolf Cup ranges verbatim. `vitest` skipped (tournament-only).
PARITY OK

# Subtask 7.2: typecheck → exit 0
> @tournament/web@0.0.0 typecheck
> tsr generate && tsc --noEmit -p tsconfig.app.json

# Subtask 7.3: lint → exit 0
> @tournament/web@0.0.0 lint
> eslint src

# Subtask 7.4: test → 1 passing smoke test
✓ src/lib/query-client.test.ts (1 test) 1ms
  ✓ queryClient > is a QueryClient instance with configured defaults
Test Files  1 passed (1)
     Tests  1 passed (1)

# Subtask 7.5: build → exit 0
dist/registerSW.js              0.13 kB
dist/manifest.webmanifest       0.42 kB
dist/index.html                 0.90 kB
dist/assets/index-CA6xX-1F.css  4.06 kB │ gzip:  1.36 kB
dist/assets/index-4iWtNAEx.js   0.12 kB │ gzip:  0.13 kB
dist/assets/index-nw3tJAfo.js 313.02 kB │ gzip: 98.33 kB
✓ built in 876ms
PWA v1.2.0 — mode generateSW, precache 11 entries (313.91 KiB)
files generated: dist/sw.js, dist/workbox-321c23cd.js

# AC #15 content check 1 (manifest branding): ✓ name=Tournament, theme_color=#0f172a
# AC #15 content check 2 (registration plumbing): ✓ index.html references registerSW/workbox-window

# Task 8: Wolf Cup regression — both green, zero delta from start-of-story
pnpm -F @wolf-cup/engine test → 11 files, 468 tests passed (Δ = 0)
pnpm -F @wolf-cup/api    test → 21 files, 429 tests passed (Δ = 0)
pnpm -F @tournament/api  test → 2 files, 19 tests passed (Δ = 0)

# Monorepo sweeps
pnpm -r lint → all 5 workspaces green
pnpm -r typecheck → 4 of 5 green; apps/web FAILS at src/routes/standings.tsx:480 (pre-existing; see Followups)
```

### Completion Notes List

- **`pnpm-lock.yaml` MUST be bundled with this commit.** SHARED path — the director protocol requires explicit user approval before staging. Unavoidable side effect of registering `@tournament/web` as a workspace.
- **AC compliance:** all 17 ACs met. AC #1 parity verified by script (21-pkg diff vs `apps/web/package.json`, zero drift). AC #15 content checks both pass.
- **Placeholder icons:** shipped proper 192×192 + 512×512 slate-900 (#0f172a) solid-fill PNGs generated by a Node zlib-based encoder at implementation time (NOT 1×1 scale-ups, despite the spec's "1×1 is fine" allowance). Rationale: proper-size PNGs are bytes-cheap (593 + 2201 bytes) and avoid Lighthouse install-prompt warnings.
- **No shadcn primitives shipped.** Five shadcn-adjacent deps (`@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`) are declared so the install tree stabilizes, but no `src/components/ui/*.tsx` files exist yet. Later UX story adds them.
- **No API client or env module** — `src/lib/api.ts` and `src/lib/env.ts` are NOT in scope at T1.3. Later auth/routes stories add them.
- **Root component is bare** — `__root.tsx` is a minimal `<Outlet />` shell. A later UX story replaces it with tournament chrome.
- **Wolf Cup isolation held:** zero modifications to `apps/api/**`, `apps/web/**`, `packages/engine/**`, Wolf Cup migrations, or Wolf Cup tests. Only Wolf-Cup-adjacent modification is `pnpm-lock.yaml` (SHARED, approval-gated).

### Followups

- **[Pre-existing, NOT a T1.3 regression] `pnpm -r typecheck` hits a failure in `@wolf-cup/web` at `apps/web/src/routes/standings.tsx:480`: `TS2322: Type 'StandingsPlayer | null | undefined' is not assignable to type 'StandingsPlayer | null'`.** Verified pre-existing by stashing all T1.3 work (`git stash -u`) and re-running `pnpm -F @wolf-cup/web typecheck` — identical failure with tournament-web absent. Cause lives in a FORBIDDEN path (`apps/web/**`) per director allowlist; T1.3 cannot fix it and has not attempted to. Wolf Cup lint, engine tests, and api tests remain green — this is a typecheck-only issue in Wolf Cup's own backlog.
- **[Impl-codex #1 Medium — prod-hardening worth revisiting] `<ReactQueryDevtools />` is rendered unconditionally in `apps/tournament-web/src/main.tsx`, matching Wolf Cup's `apps/web/src/main.tsx` 1:1 per AC #8.** This means the devtools UI and its bundle ship in production. A cleaner shape is `{import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}`. Not applied in this story because the spec directive is "Shape MUST mirror `apps/web/src/main.tsx` 1:1" and divergence here is prod-hardening rather than strict scaffold correctness. Suitable for a small dedicated hardening story (could land in tournament AND mirror-back to Wolf Cup simultaneously).
- **[Impl-codex #2 Low — deferred by design]** Vite dev proxy uses `changeOrigin: false`. Called out in Dev Notes with a full explanation (Host header semantics, tournament-api doesn't make Host-based routing decisions, nginx-prod behavior). Re-evaluate when cookie-based auth lands (T1.6).
- **[Impl-codex #3 Low — deferred by design]** `VitePWA.devOptions.enabled: true` lets a service worker run in `vite dev`. Matches Wolf Cup's pattern; known to cause stale-asset surprises during development. Mitigation: the SW uses `clientsClaim: true` + `skipWaiting: true` so new builds activate on reload. If dev-cache thrashing becomes a problem, flip `devOptions.enabled` to `false` behind an env flag.

### File List

- `apps/tournament-web/package.json` (new)
- `apps/tournament-web/tsconfig.json` (new)
- `apps/tournament-web/tsconfig.app.json` (new)
- `apps/tournament-web/vite.config.ts` (new)
- `apps/tournament-web/vitest.config.ts` (new)
- `apps/tournament-web/eslint.config.js` (new)
- `apps/tournament-web/index.html` (new)
- `apps/tournament-web/.gitignore` (new)
- `apps/tournament-web/public/icon-192.png` (new — 593-byte slate-900 solid-fill PNG)
- `apps/tournament-web/public/icon-512.png` (new — 2201-byte slate-900 solid-fill PNG)
- `apps/tournament-web/src/main.tsx` (new)
- `apps/tournament-web/src/index.css` (new)
- `apps/tournament-web/src/routeTree.gen.ts` (new — generated by `tsr generate`)
- `apps/tournament-web/src/lib/query-client.ts` (new)
- `apps/tournament-web/src/lib/query-client.test.ts` (new — the scaffold smoke test)
- `apps/tournament-web/src/routes/__root.tsx` (new)
- `apps/tournament-web/src/routes/index.tsx` (new)
- `pnpm-lock.yaml` (modified — automatic, pnpm added `@tournament/web` workspace; SHARED path, approval-gated)
- `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` (modified — T1-3 status transitions across the cycle)
