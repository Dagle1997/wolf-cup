# Story 6.2: Docker Compose Production Deployment

Status: done

## Story

As the Wolf Cup admin (Jason / Josh),
I want the app deployed to `wolf.dagle.cloud` via a two-container Docker Compose setup behind the existing Traefik VPS,
so that scorers and spectators can reach the live leaderboard and score-entry app from their iPhones on Friday round day.

## Acceptance Criteria

### Docker Build

1. `docker compose build` from the repo root completes without errors on a clean checkout (no pre-built `dist/` anywhere).

2. The API image uses a multi-stage Node.js 22 Alpine build: builder stage compiles TypeScript (`pnpm --filter @wolf-cup/engine build && pnpm --filter @wolf-cup/api build`); runtime stage installs only production deps and runs the compiled `dist/index.js`.

3. The web image uses a multi-stage build: Node 22 Alpine builder runs `pnpm --filter @wolf-cup/web build`; nginx:alpine runtime serves the static output from `/usr/share/nginx/html`.

### Runtime Behaviour

4. `docker compose up -d` starts two healthy containers (`wolf-cup-api` and `wolf-cup-web`).

5. `curl http://localhost/api/health` returns `{"status":"ok","timestamp":"..."}` — nginx proxy to api container works.

6. On first start, Drizzle migrations run automatically before the Hono server begins accepting requests (no manual migration step).

7. On first start, admin seed runs automatically — `jason` and `josh` accounts exist in the DB with passwords read from env vars `ADMIN_JASON_PASSWORD` / `ADMIN_JOSH_PASSWORD`.

8. The SQLite database is stored in a named Docker volume (`sqlite_data`) mounted at `/app/data` in the API container — data survives `docker compose restart`.

### nginx

9. `nginx.conf` proxies all `/api/*` requests to `api:3000`; passes `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` headers.

10. `nginx.conf` serves all other paths from `/usr/share/nginx/html` with SPA fallback (`try_files $uri $uri/ /index.html`).

11. `nginx.conf` sets `Cache-Control: no-store` for `/sw.js` and `/manifest.webmanifest` so browsers always re-check the service worker and manifest for updates.

12. All other static assets (`*.js`, `*.css`, `*.png`, etc.) get `Cache-Control: public, max-age=31536000, immutable` for aggressive caching (Vite's content-hash filenames make this safe).

### Traefik / VPS Integration

13. `docker-compose.yml` includes Traefik labels on the `web` service for `wolf.dagle.cloud` with TLS via Let's Encrypt (`certresolver=le`).

14. `docker-compose.yml` declares the Traefik external network (`traefik`) and attaches the `web` service to it. The `api` service is on the internal network only.

### Configuration

15. `.env.example` is committed with every required variable documented: `ADMIN_SESSION_SECRET`, `DB_PATH`, `PORT`, `ADMIN_JASON_PASSWORD`, `ADMIN_JOSH_PASSWORD`.

16. `.env` (real values) is **never committed** — `.gitignore` already excludes it.

### Engine Build

17. `packages/engine` has a `build` script (`tsc -p tsconfig.build.json`) and a `tsconfig.build.json` that compiles `src/` → `dist/` excluding test files.

18. `packages/engine/package.json` exports use conditional exports: `"types"` → `./src/index.ts` (TypeScript compile-time), `"default"` → `./dist/index.js` (Node.js runtime). This allows the API to type-check against TS source while running compiled JS in Docker.

### deploy.sh

19. `deploy.sh` is updated — removes the redundant local `pnpm -r build` step and the remote `pnpm install + pnpm -r build` steps (Docker handles building); SSH command is now just `git pull && docker compose up -d --build`.

### CI Update

20. `.github/workflows/ci.yml` adds a `docker compose build` step after lint to verify the Docker build doesn't break on CI.

### Code Quality

21. `pnpm typecheck` and `pnpm lint` pass with no errors after all new TypeScript files are added (primarily `apps/api/src/db/migrate.ts`).

## Tasks / Subtasks

- [x] Task 1: Add engine build step (AC: #1, #2, #17, #18)
  - [x] Create `packages/engine/tsconfig.build.json` (extends base, rootDir: src, outDir: dist, exclude test/script files)
  - [x] Add `"build": "tsc -p tsconfig.build.json"` to `packages/engine/package.json` scripts
  - [x] Update `packages/engine/package.json` exports to conditional: `"types": "./src/index.ts"`, `"default": "./dist/index.js"`
  - [x] Verify `pnpm -r build` now builds engine + api + web without errors

- [x] Task 2: Add programmatic migration script (AC: #6)
  - [x] Create `apps/api/src/db/migrate.ts` using `drizzle-orm/libsql/migrator` (see Dev Notes for exact code)
  - [x] Verify `pnpm --filter @wolf-cup/api typecheck` still passes

- [x] Task 3: Create API Dockerfile (AC: #1, #2, #6, #7, #8)
  - [x] Create `apps/api/Dockerfile` (multi-stage: builder + runtime, see Dev Notes for complete file)
  - [x] Builder: corepack pnpm, full workspace install, build engine + api
  - [x] Runtime: corepack pnpm, prod-only deps, copy built artifacts + migrations, CMD runs migrate → seed → server

- [x] Task 4: Create web Dockerfile (AC: #1, #3)
  - [x] Create `apps/web/Dockerfile` (multi-stage: Node 22 Alpine builder + nginx:alpine runtime)
  - [x] Builder: corepack pnpm, workspace install (web only), `pnpm --filter @wolf-cup/web build`
  - [x] Runtime: copy `apps/web/dist/` → `/usr/share/nginx/html/`, copy nginx.conf

- [x] Task 5: Create nginx.conf (AC: #9, #10, #11, #12)
  - [x] Create `nginx.conf` at repo root
  - [x] Proxy `/api/` to `http://api:3000`
  - [x] SPA fallback for all other paths
  - [x] `no-store` cache headers for `sw.js` and `manifest.webmanifest`
  - [x] `immutable` cache headers for versioned static assets

- [x] Task 6: Create docker-compose.yml (AC: #4, #5, #8, #13, #14)
  - [x] Create `docker-compose.yml` at repo root
  - [x] `api` service: build context `.`, dockerfile `apps/api/Dockerfile`, env vars, `sqlite_data:/app/data` volume, healthcheck on `/api/health`
  - [x] `web` service: build context `.`, dockerfile `apps/web/Dockerfile`, depends_on api healthy, Traefik labels, on `traefik` external network + internal network
  - [x] Named volume `sqlite_data`

- [x] Task 7: Create .env.example (AC: #15, #16)
  - [x] Create `.env.example` at repo root with all required variables documented

- [x] Task 8: Update deploy.sh (AC: #19)
  - [x] Remove local `pnpm -r build` step
  - [x] Replace SSH body with `git pull && docker compose up -d --build`

- [x] Task 9: Update CI (AC: #20)
  - [x] Add `docker compose build` step to `.github/workflows/ci.yml` after the lint step

- [x] Task 10: Typecheck + lint (AC: #21)
  - [x] `pnpm --filter @wolf-cup/api typecheck`
  - [x] `pnpm --filter @wolf-cup/web typecheck`
  - [x] `pnpm lint`
  - [x] `docker compose build` — Docker not installed on local Windows dev machine; validated via YAML structure check + file correctness; will be confirmed by CI (ubuntu-latest has Docker)

## Dev Notes

### Critical Discovery: Engine Has No Build Step

`packages/engine/package.json` currently has:
```json
{
  "exports": { ".": "./src/index.ts" },
  "main": "./src/index.ts"
}
```

The engine has **no build script** — its TypeScript source IS the package entry. This works in development (vitest uses Vite's transform pipeline; TypeScript type-checks against the TS source). But in a production Docker container running compiled JavaScript, Node.js would resolve `@wolf-cup/engine` to `./src/index.ts` and fail to load it (Node.js cannot execute TypeScript syntax without experimental flags, and the `.js` extension imports inside the engine source cannot be remapped automatically).

**Fix (Task 1):** Add a build step to the engine and use conditional exports so:
- TypeScript compiler uses `"types": "./src/index.ts"` → type-checking unchanged
- Node.js runtime uses `"default": "./dist/index.js"` → runs compiled JavaScript

### Task 1: Engine tsconfig.build.json

Create `packages/engine/tsconfig.build.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "declarationMap": true
  },
  "include": ["src/**/*"],
  "exclude": [
    "src/**/*.test.ts",
    "scripts/",
    "fixtures/"
  ]
}
```

Update `packages/engine/package.json`:
```json
{
  "name": "@wolf-cup/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src"
  },
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./dist/index.js"
    }
  }
}
```

**Note:** The existing `"main"` and `"type"` fields — keep `"type"` if it exists; remove the old `"main"` flat field (superseded by `"exports"`). Check the file before editing — the current `packages/engine/package.json` shown above may already have a `"type"` field; verify before writing.

**Note:** The engine has `"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.node.json"` — `tsconfig.node.json` for the engine may exist or not; do not remove that typecheck reference.

### Task 2: Programmatic Migration Script

Create `apps/api/src/db/migrate.ts`:
```typescript
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db } from './index.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Migrations folder is copied to dist/db/migrations/ in the Dockerfile
const migrationsFolder = join(__dirname, './migrations');

await migrate(db, { migrationsFolder });
console.log('Wolf Cup: migrations applied.');
process.exit(0);
```

The Dockerfile copies migrations into `dist/db/migrations/` (co-located with `dist/db/migrate.js`) so the path resolution is straightforward.

### Task 3: API Dockerfile

Create `apps/api/Dockerfile`:
```dockerfile
# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy workspace manifest files first for layer-cache
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/engine/package.json ./packages/engine/
COPY apps/api/package.json ./apps/api/

# Install ALL deps (including devDeps for tsc)
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/engine/ ./packages/engine/
COPY apps/api/ ./apps/api/

# Build engine first, then API
RUN pnpm --filter @wolf-cup/engine build
RUN pnpm --filter @wolf-cup/api build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy workspace manifest files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/engine/package.json ./packages/engine/
COPY apps/api/package.json ./apps/api/

# Install production deps only (resolves @libsql/client musl binary for Alpine)
RUN pnpm install --frozen-lockfile --prod

# Copy compiled outputs from builder
COPY --from=builder /app/packages/engine/dist/ ./packages/engine/dist/
COPY --from=builder /app/apps/api/dist/ ./apps/api/dist/

# Copy migrations next to compiled migrate.js (referenced as ./migrations)
COPY apps/api/src/db/migrations/ ./apps/api/dist/db/migrations/

WORKDIR /app/apps/api

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/wolf-cup.db

EXPOSE 3000

# 1. Run migrations (idempotent — drizzle tracks applied migrations)
# 2. Seed admin users (idempotent — upsertAdmin skips existing users)
# 3. Start Hono server
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js"]
```

**Key notes:**
- `pnpm install --prod` in the runtime stage installs `@libsql/client` which auto-selects `linux-x64-musl` binaries for Alpine — no manual platform setup needed.
- The engine's `dist/` is copied from builder → runtime. At runtime, Node.js resolves `@wolf-cup/engine` → `packages/engine/dist/index.js` (the compiled JS) via the conditional `"default"` export.
- Migrations are copied to `./apps/api/dist/db/migrations/` (adjacent to `dist/db/migrate.js`). The `migrate.ts` script uses `join(__dirname, './migrations')` which resolves correctly.
- `node dist/db/seed.js` references `dist/db/seed.js` which imports `@wolf-cup/engine`... wait — actually `seed.ts` does NOT import from `@wolf-cup/engine`. It only imports bcrypt, drizzle, and `./schema.js`. So `node dist/db/seed.js` works with no special flags. Same for `node dist/db/migrate.js`.
- The main server `node dist/index.js` imports from routes which import `@wolf-cup/engine`. Since the engine is now compiled JS (via Task 1), this resolves to `packages/engine/dist/index.js` — plain JavaScript, no flags needed.

### Task 4: Web Dockerfile

Create `apps/web/Dockerfile`:
```dockerfile
# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy workspace manifest files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
# Engine is NOT imported by web (architecture boundary: engine → api only)
# Still need engine package.json for workspace resolution
COPY packages/engine/package.json ./packages/engine/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY apps/web/ ./apps/web/

RUN pnpm --filter @wolf-cup/web build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:alpine

COPY --from=builder /app/apps/web/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
```

**Note:** The web app does NOT import `@wolf-cup/engine` (architecture boundary). The engine package.json must be copied to satisfy pnpm workspace resolution during install, but the engine source and dist are not needed.

### Task 5: nginx.conf

Create `nginx.conf` at repo root:
```nginx
events {
  worker_connections 1024;
}

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  sendfile on;
  gzip on;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;

  server {
    listen 80;
    root /usr/share/nginx/html;

    # ── API reverse proxy ─────────────────────────────────────────────────────
    location /api/ {
      proxy_pass http://api:3000;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 30s;
    }

    # ── Service worker and manifest — never cache ─────────────────────────────
    location ~* ^/(sw\.js|manifest\.webmanifest)$ {
      add_header Cache-Control "no-store, no-cache, must-revalidate";
      expires -1;
      try_files $uri =404;
    }

    # ── Versioned static assets — immutable cache ─────────────────────────────
    location ~* \.(js|css|png|ico|svg|woff|woff2)$ {
      add_header Cache-Control "public, max-age=31536000, immutable";
      try_files $uri =404;
    }

    # ── SPA fallback ──────────────────────────────────────────────────────────
    location / {
      try_files $uri $uri/ /index.html;
    }
  }
}
```

### Task 6: docker-compose.yml

Create `docker-compose.yml` at repo root:
```yaml
services:

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    container_name: wolf-cup-api
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DB_PATH=/app/data/wolf-cup.db
      - PORT=3000
      - ADMIN_SESSION_SECRET=${ADMIN_SESSION_SECRET}
      - ADMIN_JASON_PASSWORD=${ADMIN_JASON_PASSWORD:-changeme-jason}
      - ADMIN_JOSH_PASSWORD=${ADMIN_JOSH_PASSWORD:-changeme-josh}
    volumes:
      - sqlite_data:/app/data
    networks:
      - internal
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    container_name: wolf-cup-web
    restart: unless-stopped
    depends_on:
      api:
        condition: service_healthy
    networks:
      - internal
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.wolf-cup.rule=Host(`wolf.dagle.cloud`)"
      - "traefik.http.routers.wolf-cup.entrypoints=websecure"
      - "traefik.http.routers.wolf-cup.tls=true"
      - "traefik.http.routers.wolf-cup.tls.certresolver=le"
      - "traefik.http.services.wolf-cup.loadbalancer.server.port=80"

volumes:
  sqlite_data:

networks:
  internal:
    driver: bridge
  traefik:
    external: true
```

**Important — Traefik network name:** The `traefik` external network must match the actual network name used by the Traefik instance on the VPS. To check: `docker network ls` on the VPS. If it's named differently (e.g., `proxy`), update the `networks.traefik.name` field accordingly:
```yaml
networks:
  traefik:
    external: true
    name: proxy   # or whatever the VPS traefik network is named
```

**ADMIN_SESSION_SECRET** is required (no fallback) — `docker compose up` will fail if this env var is not set in `.env`. This is intentional — never run production without a real session secret.

### Task 7: .env.example

Create `.env.example` at repo root:
```bash
# Wolf Cup — Production Environment Variables
# ============================================
# Copy this file to .env and fill in real values before first deployment.
# The .env file is gitignored — NEVER commit it.

# ── Required ──────────────────────────────────────────────────────────────────

# Session secret for admin cookie signing — generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ADMIN_SESSION_SECRET=change-me-to-a-strong-random-string

# Admin passwords (set before first deploy; seed.ts is idempotent)
ADMIN_JASON_PASSWORD=change-me-jason
ADMIN_JOSH_PASSWORD=change-me-josh

# ── Optional (defaults shown) ─────────────────────────────────────────────────

# SQLite database path inside the api container
DB_PATH=/app/data/wolf-cup.db

# API listen port (inside the container — nginx proxies to this)
PORT=3000
```

### Task 8: Updated deploy.sh

Replace the body of `deploy.sh` — keep the safety header and preamble, simplify the SSH command:
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
echo "⚠️  Only deploy when no active round is in progress."
echo "Press Ctrl+C within 5 seconds to abort..."
sleep 5

echo "🚀 Deploying to ${REMOTE_HOST}..."
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "cd '${REMOTE_DIR}' && git pull && docker compose up -d --build"

echo "✅ Deploy complete — migrations + seed ran automatically on container start."
```

**Why removed `pnpm -r build` locally:** Docker builds everything inside the container (multi-stage). Building locally before SSH was redundant and could cause dist/ stale artifacts to be pushed to git accidentally.

**Why removed `pnpm install` + `pnpm -r build` on remote SSH:** Docker handles all dependency installation and building inside containers. The VPS only needs `git pull && docker compose up -d --build`.

### Task 9: CI Update

Add a `docker-compose-build` job to `.github/workflows/ci.yml` after the existing `ci` job — or add a step within the existing job:
```yaml
      - name: Docker build smoke test
        run: docker compose build
```

Add this as the LAST step in the existing `ci` job (after lint). The CI environment (ubuntu-latest) has Docker and Docker Compose available by default on GitHub Actions runners.

**Note:** The CI `docker compose build` step does NOT run `docker compose up` — it only verifies the build succeeds. Runtime tests (migrations, health) require a real `.env` with `ADMIN_SESSION_SECRET`, which is handled at deploy time.

### First-Time VPS Setup (Operations Runbook)

These steps are manual — not part of the story code, but documented for deployment day:

```bash
# On the VPS, as the deploy user:
cd /opt/wolf-cup

# 1. Create .env with real values
cp .env.example .env
nano .env   # fill in ADMIN_SESSION_SECRET, passwords

# 2. Check Traefik network name (update docker-compose.yml if different from 'traefik')
docker network ls | grep traefik

# 3. First deploy
docker compose up -d --build

# 4. Verify
docker compose ps         # both containers should show healthy
curl http://localhost/api/health  # should return {"status":"ok",...}
docker compose logs api   # check migration output
```

After first deploy, subsequent deploys are just `./deploy.sh`.

### Architecture Compliance

- **Two-container Docker compose** — `api` (Hono+Node.js) + `web` (nginx+Vite build) [Source: architecture.md — Infrastructure & Deployment]
- **SQLite volume** — `./data/wolf-cup.db:/app/data/wolf-cup.db` → named volume `sqlite_data:/app/data` [Source: architecture.md — Database section]
- **Traefik TLS** — Traefik handles Let's Encrypt at VPS level, container only needs to expose port 80 [Source: architecture.md — Infrastructure]
- **No auto-deploy** — deliberate SSH deploy only [Source: architecture.md — CI/CD section]
- **Structured JSON logging** — `console.log` to Docker stdout, viewable with `docker compose logs api` [Source: architecture.md — Logging]
- **NFR26** — Standalone Docker compose behind Traefik, no dependency on other services [Source: epics.md — NFR26]
- **NFR27** — `docker compose up -d --build` performs rolling replace; API is down briefly but web static files remain served by nginx during API restart [Source: epics.md — NFR27]
- **Engine boundary** — `@wolf-cup/engine` imported ONLY by `apps/api` — the web Dockerfile does NOT install or build the engine [Source: architecture.md — Package Boundary]

### Node.js Version

Root `package.json` requires `"engines": { "node": ">=22.0.0" }`. Both Dockerfiles use `node:22-alpine` which currently resolves to Node.js 22.14.x LTS.

### pnpm in Docker

Install via `corepack` (included in Node.js 16+) — matches the `"packageManager": "pnpm@9.15.9"` field in root `package.json`:
```dockerfile
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
```

### @libsql/client Native Binary

`@libsql/client` requires a native Rust prebuilt binary. When running `pnpm install --prod` inside an Alpine Linux container (musl libc), pnpm automatically selects the `linux-x64-musl` optional dependency package. No manual configuration needed.

### No Automated Tests for Docker Story

This story has no Vitest unit tests — all verification is build/integration level:
- `docker compose build` — Docker build succeeds
- `docker compose up -d` + `curl /api/health` — runtime verification
- Manual iPhone Safari install test (after production deploy — per Story 6.1 manual test checklist)

The 217 existing API tests remain unchanged and continue to pass (no API code changes in this story, except `migrate.ts` addition).

### Project Structure Notes

**New files:**
- `packages/engine/tsconfig.build.json`
- `apps/api/src/db/migrate.ts`
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `docker-compose.yml`
- `nginx.conf`
- `.env.example`

**Modified files:**
- `packages/engine/package.json` — add build script + conditional exports
- `deploy.sh` — simplified SSH deploy
- `.github/workflows/ci.yml` — add Docker build step

**No changes to:**
- Any API route files
- Any web component files
- Database schema or migrations
- `apps/api/src/db/seed.ts` (used as-is by the Docker CMD)

### References

- Architecture: two-container Docker compose, nginx reverse proxy, Traefik TLS [Source: _bmad-output/planning-artifacts/architecture.md — Infrastructure & Deployment section]
- NFR26: Standalone Docker container behind Traefik [Source: _bmad-output/planning-artifacts/epics.md — NFR26]
- NFR27: No downtime during non-round hours [Source: _bmad-output/planning-artifacts/epics.md — NFR27]
- FR60: iPhone home screen install (PWA, already done in Story 6.1) [Source: _bmad-output/planning-artifacts/epics.md — FR60]
- `DB_PATH` env var: `apps/api/src/db/index.ts` line 7 — `process.env['DB_PATH'] ?? './data/wolf-cup.db'`
- `ADMIN_SESSION_SECRET`: bcrypt/session auth [Source: apps/api/src/routes/admin/auth.ts]
- Seed env vars: `ADMIN_JASON_PASSWORD`, `ADMIN_JOSH_PASSWORD` [Source: apps/api/src/db/seed.ts lines 41–43]
- Engine exports limitation: `packages/engine/package.json` — `"exports": { ".": "./src/index.ts" }` — no build step, TS source only. This fails in Docker; Task 1 fixes it.
- `drizzle-orm/libsql/migrator` for programmatic migrations [Source: drizzle-orm docs]
- pnpm in Docker via corepack: matches `"packageManager": "pnpm@9.15.9"` in root package.json
- Traefik labels: `traefik.enable=true`, `tls.certresolver=le`, entrypoints=websecure [Source: Traefik v2 docs]
- `deploy.sh` at repo root: current version has redundant local+remote build steps; simplified in this story

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

Docker not installed on local Windows dev machine — `docker compose build` validated via file structure checks and YAML validity instead. CI (`ubuntu-latest`) will perform the full build smoke test. All other validations (typecheck, lint, pnpm build) pass locally.

### Completion Notes List

- Task 1: Added `packages/engine/tsconfig.build.json` (compiles src/ → dist/, excludes tests/fixtures). Updated `packages/engine/package.json` — added `"build": "tsc -p tsconfig.build.json"` script; replaced flat `"exports": "./src/index.ts"` with conditional exports `"types": "./src/index.ts"` (TypeScript compile-time) / `"default": "./dist/index.js"` (Node.js runtime). Removed stale `"main"` field. Engine build verified: all 12 source files compile to `dist/` with `.js` + `.d.ts` + `.d.ts.map`. API 217/217 tests still pass.
- Task 2: Created `apps/api/src/db/migrate.ts` — uses `drizzle-orm/libsql/migrator`, resolves migrations folder relative to `__dirname` (`dist/db/migrations/`), exits after apply. Typecheck passes.
- Task 3: Created `apps/api/Dockerfile` — multi-stage Node 22 Alpine; builder installs all deps, builds engine then API; runtime installs prod deps only (auto-selects `@libsql/client` musl binary), copies compiled dist + migrations, CMD: `node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js`.
- Task 4: Created `apps/web/Dockerfile` — multi-stage Node 22 Alpine builder (Vite build) + nginx:alpine runtime.
- Task 5: Created `nginx.conf` — `/api/` proxy to `api:3000`, SPA fallback, `sw.js`/`manifest.webmanifest` no-cache, versioned assets immutable.
- Task 6: Created `docker-compose.yml` — api + web services, `sqlite_data` named volume, Traefik labels for `wolf.dagle.cloud` TLS, external `traefik` network on web, internal-only network for api.
- Task 7: Created `.env.example` documenting all 5 env vars with generation hints.
- Task 8: Updated `deploy.sh` — removed redundant local build and remote pnpm install/build; SSH now just `git pull && docker compose up -d --build`.
- Task 9: Added `docker compose build` step to `.github/workflows/ci.yml` after lint.
- Task 10: `pnpm typecheck` ✅, `pnpm lint` ✅, docker-compose.yml YAML valid ✅, Dockerfiles well-formed ✅.

### File List

- New: `packages/engine/tsconfig.build.json`
- Modified: `packages/engine/package.json`
- New: `apps/api/src/db/migrate.ts`
- New: `apps/api/Dockerfile`
- New: `apps/web/Dockerfile`
- New: `docker-compose.yml`
- New: `nginx.conf`
- New: `.env.example`
- Modified: `deploy.sh`
- Modified: `.github/workflows/ci.yml`
