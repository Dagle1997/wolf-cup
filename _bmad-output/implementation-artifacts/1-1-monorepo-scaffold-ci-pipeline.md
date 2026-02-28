# Story 1.1: Monorepo Scaffold & CI Pipeline

Status: done

## Story

As a developer,
I want the project scaffolded as a pnpm workspaces monorepo with `packages/engine`, `apps/api`, and `apps/web` and a CI pipeline running on every push,
So that all development work has a consistent, validated foundation from day one.

## Acceptance Criteria

1. **Given** the repository root after `pnpm install`, **When** `pnpm -r typecheck` is run, **Then** `tsc --noEmit` runs across all three packages with zero errors **And** `pnpm --filter @wolf-cup/engine test` runs Vitest and passes (empty suite acceptable).

2. **Given** a push to any branch, **When** the GitHub Actions CI workflow runs, **Then** it executes engine tests, `tsc --noEmit`, and eslint in sequence **And** any TypeScript error or failing test fails the CI workflow.

3. **Given** a fresh clone of the repository, **When** a developer runs `pnpm install`, **Then** `packages/engine`, `apps/api`, and `apps/web` are all scaffolded with their `package.json` names (`@wolf-cup/engine`, `@wolf-cup/api`, `@wolf-cup/web`) and interdependencies resolve correctly.

## Tasks / Subtasks

- [x] Task 1: Create root monorepo config (AC: 1, 3)
  - [x] 1.1 Create `pnpm-workspace.yaml` declaring `packages/*` and `apps/*`
  - [x] 1.2 Create root `package.json` with workspace scripts (`typecheck`, `test`, `lint`, `build`)
  - [x] 1.3 Create `tsconfig.base.json` with shared strict TypeScript settings
  - [x] 1.4 Create root `.npmrc` with `strict-peer-dependencies=false` and `link-workspace-packages=true`
  - [x] 1.5 Create root `eslint.config.js` (ESLint 9 flat config format)

- [x] Task 2: Scaffold `packages/engine` (AC: 1, 3)
  - [x] 2.1 Create `packages/engine/package.json` with name `@wolf-cup/engine`
  - [x] 2.2 Create `packages/engine/tsconfig.json` extending `../../tsconfig.base.json`
  - [x] 2.3 Create `packages/engine/vitest.config.ts`
  - [x] 2.4 Create stub source files: `src/types.ts`, `src/wolf.ts`, `src/stableford.ts`, `src/money.ts`, `src/harvey.ts`, `src/validation.ts`, `src/course.ts`, `src/index.ts`
  - [x] 2.5 Create `src/fixtures/season-2025/` directory with a `.gitkeep`
  - [x] 2.6 Create one passing smoke test in `src/index.test.ts` (e.g., `import { } from './index'; expect(true).toBe(true)`)

- [x] Task 3: Scaffold `apps/api` (AC: 1, 3)
  - [x] 3.1 Create `apps/api/package.json` with name `@wolf-cup/api`, depending on `@wolf-cup/engine`
  - [x] 3.2 Create `apps/api/tsconfig.json` extending `../../tsconfig.base.json`
  - [x] 3.3 Create minimal `apps/api/src/index.ts` that exports a typed stub (compiles cleanly)

- [x] Task 4: Scaffold `apps/web` (AC: 1, 3)
  - [x] 4.1 Create `apps/web/package.json` with name `@wolf-cup/web`
  - [x] 4.2 Create `apps/web/tsconfig.json` and `apps/web/tsconfig.app.json` extending base config
  - [x] 4.3 Create `apps/web/vite.config.ts` with Vite + React plugin (compiles cleanly)
  - [x] 4.4 Create minimal `apps/web/src/main.tsx` and `apps/web/src/App.tsx` stubs
  - [x] 4.5 Create `apps/web/index.html` Vite entry point

- [x] Task 5: Create GitHub Actions CI workflow (AC: 2)
  - [x] 5.1 Create `.github/workflows/ci.yml` running on push and pull_request to all branches
  - [x] 5.2 CI steps: checkout, pnpm install, typecheck (`pnpm -r typecheck`), engine tests (`pnpm --filter @wolf-cup/engine test`), lint (`pnpm -r lint`)
  - [x] 5.3 Verify CI fails on a deliberate TypeScript error (mental check, not a test)

- [x] Task 6: Create deploy script (AC: 3)
  - [x] 6.1 Create `deploy.sh` — SSH-based deliberate deploy script (not wired to CI, run manually)
  - [x] 6.2 Mark `deploy.sh` as executable (`chmod +x deploy.sh`)

- [x] Task 7: Verification (AC: 1, 2, 3)
  - [x] 7.1 Run `pnpm install` from root and confirm no errors
  - [x] 7.2 Run `pnpm -r typecheck` and confirm zero errors
  - [x] 7.3 Run `pnpm --filter @wolf-cup/engine test` and confirm passes
  - [x] 7.4 Run `pnpm -r lint` and confirm no errors
  - [x] 7.5 Commit and push — confirm GitHub Actions CI passes green

## Dev Notes

### Monorepo Structure to Create

```
wolf-cup/                          ← git root (already exists)
├── pnpm-workspace.yaml
├── package.json                   ← root, scripts only (no dependencies)
├── tsconfig.base.json
├── eslint.config.js
├── .npmrc
├── deploy.sh
├── .github/
│   └── workflows/
│       └── ci.yml
├── packages/
│   └── engine/
│       ├── package.json           ← name: @wolf-cup/engine
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── types.ts
│           ├── wolf.ts
│           ├── stableford.ts
│           ├── money.ts
│           ├── harvey.ts
│           ├── validation.ts
│           ├── course.ts
│           ├── index.ts
│           ├── index.test.ts
│           └── fixtures/
│               └── season-2025/
│                   └── .gitkeep
└── apps/
    ├── api/
    │   ├── package.json           ← name: @wolf-cup/api
    │   ├── tsconfig.json
    │   └── src/
    │       └── index.ts
    └── web/
        ├── package.json           ← name: @wolf-cup/web
        ├── tsconfig.json
        ├── tsconfig.app.json
        ├── vite.config.ts
        ├── index.html
        └── src/
            ├── main.tsx
            └── App.tsx
```

### Root `pnpm-workspace.yaml`

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

### Root `package.json`

```json
{
  "name": "wolf-cup",
  "private": true,
  "version": "0.0.0",
  "engines": { "node": ">=22.0.0", "pnpm": ">=9.0.0" },
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm --filter @wolf-cup/engine test",
    "lint": "pnpm -r lint",
    "build": "pnpm -r build"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**IMPORTANT — `moduleResolution: "NodeNext"` notes:**
- `packages/engine` and `apps/api` are Node.js packages — use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`
- `apps/web` is a browser/Vite project — override with `"module": "ESNext"` and `"moduleResolution": "Bundler"` in its local tsconfig
- `apps/web/src` files should use `tsconfig.app.json` (Vite convention) with `moduleResolution: "Bundler"` and include only `src/**/*`
- All relative imports in engine/api MUST include `.js` extension suffix when using NodeNext (e.g., `import { foo } from './foo.js'` even though the source file is `.ts`)

### `eslint.config.js` (ESLint 9 Flat Config)

```js
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js'],
  }
);
```

**ESLint 9 key notes:**
- Config file is `eslint.config.js` (NOT `.eslintrc.js` — that's ESLint 8 format, deprecated)
- `files` must be an array
- Parser is assigned via `languageOptions.parser`, not `parser` top-level
- Use `typescript-eslint` (unified package) instead of separate `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser`

### `packages/engine/package.json`

```json
{
  "name": "@wolf-cup/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

**Note:** Engine is `"type": "module"` and exports its TypeScript source directly (no build step needed for workspace consumption since api and web packages consume it as a workspace dep).

### `packages/engine/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
});
```

### `packages/engine/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

### Engine Stub Source Files

All 8 engine modules start as minimal typed stubs that compile cleanly:

**`src/types.ts`** — export empty placeholder types:
```ts
// Engine domain types — populated in Story 1.2+
export type Placeholder = never;
```

**`src/index.ts`** — re-export all modules:
```ts
export * from './types.js';
export * from './wolf.js';
export * from './stableford.js';
export * from './money.js';
export * from './harvey.js';
export * from './validation.js';
export * from './course.js';
```

**All other stubs** (`wolf.ts`, `stableford.ts`, `money.ts`, `harvey.ts`, `validation.ts`, `course.ts`) — empty export:
```ts
// Stub — implemented in Story 1.2+
export {};
```

**`src/index.test.ts`** — minimal smoke test:
```ts
import { describe, it, expect } from 'vitest';

describe('engine', () => {
  it('module loads without error', () => {
    expect(true).toBe(true);
  });
});
```

### `apps/api/package.json`

```json
{
  "name": "@wolf-cup/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "dev": "node --watch src/index.js",
    "build": "tsc"
  },
  "dependencies": {
    "@wolf-cup/engine": "workspace:*",
    "hono": "^4.0.0",
    "@hono/node-server": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

**`apps/api/tsconfig.json`:**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

**`apps/api/src/index.ts`** — minimal stub:
```ts
// API entry point — implemented in Epic 2+
export const app = 'wolf-cup-api';
```

### `apps/web/package.json`

```json
{
  "name": "@wolf-cup/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.app.json",
    "lint": "eslint src",
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0"
  }
}
```

**`apps/web/tsconfig.json`** (root — references tsconfig.app.json):
```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.app.json" }]
}
```

**`apps/web/tsconfig.app.json`** (actual source config — overrides base for browser):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": ["src"]
}
```

**`apps/web/vite.config.ts`:**
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

**`apps/web/index.html`:**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Wolf Cup</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**`apps/web/src/main.tsx`:**
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

**`apps/web/src/App.tsx`:**
```tsx
export default function App() {
  return <div>Wolf Cup</div>;
}
```

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: ['**']

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm -r typecheck

      - name: Test (engine)
        run: pnpm --filter @wolf-cup/engine test

      - name: Lint
        run: pnpm -r lint
```

### `deploy.sh`

```bash
#!/usr/bin/env bash
# Wolf Cup — deliberate production deploy script
# Run manually: ./deploy.sh
# NOT wired to CI — deployment is always a conscious human action

set -euo pipefail

REMOTE_HOST="${DEPLOY_HOST:-wolf.dagle.cloud}"
REMOTE_USER="${DEPLOY_USER:-deploy}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/wolf-cup}"

echo "🐺 Wolf Cup Deploy — target: ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
echo "Press Ctrl+C within 5 seconds to abort..."
sleep 5

echo "📦 Building..."
pnpm -r build

echo "🚀 Deploying to ${REMOTE_HOST}..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" "
  cd ${REMOTE_DIR} &&
  git pull &&
  pnpm install --frozen-lockfile &&
  pnpm -r build &&
  docker compose up -d --build
"

echo "✅ Deploy complete"
```

### `.npmrc`

```
strict-peer-dependencies=false
link-workspace-packages=true
```

### Critical Implementation Constraints

1. **DO NOT add `vite-plugin-pwa`, `@tanstack/react-router`, `@tanstack/react-query`, `shadcn/ui`, `tailwindcss`, `drizzle-orm`, `better-sqlite3`, or `zod` yet.** Those are installed in later stories. Story 1.1 is scaffold-only — add only what is needed for the monorepo to typecheck and for the CI to pass.

2. **Engine `"type": "module"` means `.js` extension imports are required** in all relative imports within `packages/engine` and `apps/api` (NodeNext module resolution). E.g., `import { foo } from './foo.js'` not `'./foo'`.

3. **The `apps/web` package does NOT use `"type": "module"`** in package.json — Vite handles ESM for the browser. The `tsconfig.app.json` handles module resolution via `"moduleResolution": "Bundler"`.

4. **Vitest version must be 2.x, NOT 3.x or 4.x** — as of the architecture decision, we're using a stable tested version. `"vitest": "^2.0.0"` in engine's package.json.

5. **`deploy.sh` must be committed executable** — run `git add --chmod=+x deploy.sh` before committing, or `chmod +x deploy.sh && git update-index --chmod=+x deploy.sh`.

6. **TypeScript `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true` are enabled** in the base config. This is intentional for the engine's correctness guarantees. Do not disable these.

7. **ESLint `eslint.config.js` MUST be in root** — ESLint 9 looks for this file in the directory where lint is run. Each package's `lint` script runs `eslint src` which will traverse up to find `eslint.config.js` at root.

8. **`@wolf-cup/engine` workspace reference** from `apps/api` uses `"@wolf-cup/engine": "workspace:*"`. pnpm resolves this to the local package automatically after `pnpm install`.

### Project Structure Notes

- The existing repo root already has: `reference/` (Excel scorecards, images) and `_bmad-output/planning-artifacts/` — DO NOT touch these.
- The existing git repo is at `D:/wolf-cup` (Windows path) / `/d/wolf-cup` (MSYS bash path).
- No existing `package.json` at root — this story creates it fresh.
- `_bmad-output/` should be kept outside of pnpm workspaces (it's documentation, not code). The `pnpm-workspace.yaml` should NOT include it.

### References

- Monorepo scaffold requirements: [Source: _bmad-output/planning-artifacts/epics.md — "From Architecture — Infrastructure & Setup"]
- Engine module list: [Source: _bmad-output/planning-artifacts/epics.md — "From Architecture — Engine"]
- CI pipeline requirement: [Source: _bmad-output/planning-artifacts/epics.md — Story 1.1 Acceptance Criteria]
- Deploy script requirement: [Source: _bmad-output/planning-artifacts/epics.md — "From Architecture — Infrastructure & Setup"]
- Deployment target: wolf.dagle.cloud on VPS with Traefik+Docker: [Source: _bmad-output/planning-artifacts/epics.md — "From Architecture — Deployment"]
- Engine purity constraint (zero framework deps): [Source: _bmad-output/planning-artifacts/epics.md — "From Architecture — Engine"]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- pnpm not pre-installed on dev machine; installed globally via `npm install -g pnpm@9` before running workspace install.
- Root package.json `"type": "module"` added (not in story spec) to support ESM `import` syntax in `eslint.config.js`. Without this, Node.js would treat the `.js` config file as CommonJS and reject `import` statements.
- ESLint config uses `typescript-eslint` (unified package) per story notes; root devDependencies updated accordingly (replaced `@typescript-eslint/eslint-plugin` + `@typescript-eslint/parser` with `typescript-eslint` + `@eslint/js`).

### Completion Notes List

**Code review fixes applied (2026-02-28):**
- Added `.gitignore` (node_modules, dist, SQLite data, OS/editor files)
- Added `.gitattributes` (LF line endings, binary file declarations)
- Fixed `apps/web` build script: removed broken `tsc -b &&` prefix (Vite handles TS transpilation)
- Added `packages/engine/tsconfig.node.json` to typecheck `vitest.config.ts` separately (avoids rootDir conflict)
- Updated engine `typecheck` script to run both tsconfigs
- Added `"packageManager": "pnpm@9.15.9"` to root package.json for Corepack compatibility
- Fixed smoke test to actually import and assert on the engine module
- Fixed `deploy.sh` SSH command to quote `${REMOTE_DIR}` variable
- Added `pnpm-lock.yaml` to commit and File List

- All 3 workspace packages scaffold with correct names and interdependencies.
- `pnpm install` resolves 204 packages cleanly (vitest 2.1.9 installed).
- `pnpm -r typecheck`: engine, api, and web all pass `tsc --noEmit` with zero errors.
- `pnpm --filter @wolf-cup/engine test`: Vitest runs 1 smoke test — passes.
- `pnpm -r lint`: ESLint 9 flat config lints all 3 packages — zero warnings or errors.
- `deploy.sh` committed as executable via `git update-index --chmod=+x`.
- All 8 engine stub modules export correctly with `.js` extension imports (NodeNext module resolution).
- Task 7.5 (push + verify CI green) is pending user push to GitHub.

### File List

- `pnpm-workspace.yaml`
- `package.json`
- `tsconfig.base.json`
- `.npmrc`
- `eslint.config.js`
- `deploy.sh`
- `.github/workflows/ci.yml`
- `packages/engine/package.json`
- `packages/engine/tsconfig.json`
- `packages/engine/vitest.config.ts`
- `packages/engine/src/types.ts`
- `packages/engine/src/wolf.ts`
- `packages/engine/src/stableford.ts`
- `packages/engine/src/money.ts`
- `packages/engine/src/harvey.ts`
- `packages/engine/src/validation.ts`
- `packages/engine/src/course.ts`
- `packages/engine/src/index.ts`
- `packages/engine/src/index.test.ts`
- `packages/engine/src/fixtures/season-2025/.gitkeep`
- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/src/index.ts`
- `apps/web/package.json`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.app.json`
- `apps/web/vite.config.ts`
- `apps/web/index.html`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `.gitignore`
- `.gitattributes`
- `packages/engine/tsconfig.node.json`
- `pnpm-lock.yaml`
