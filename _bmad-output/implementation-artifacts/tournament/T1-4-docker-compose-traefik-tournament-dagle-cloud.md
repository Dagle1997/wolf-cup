# Story T1.4: Docker Compose + Traefik for tournament.dagle.cloud

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want `tournament-api` and `tournament-web` added as separate docker-compose services with Traefik labels for `tournament.dagle.cloud`, each behind its own Dockerfile,
so that tournament deploys to its own subdomain alongside Wolf Cup without disrupting Wolf Cup's routing and without touching Wolf Cup's containers, volumes, or Traefik routers.

## Acceptance Criteria

1. **Given** `apps/tournament-api/Dockerfile`
   **When** inspected
   **Then** it is a multi-stage Node 22 Alpine build that mirrors `apps/api/Dockerfile`'s exact pattern. The shape requirements below are MANDATORY (not "shape guidance"), because pnpm-monorepo Docker builds fail silently if any step is skipped:

   **Builder stage:**
   - Base: `FROM node:22-alpine AS builder`
   - **Enable Corepack + pin pnpm 9.15.9 verbatim:** `RUN corepack enable && corepack prepare pnpm@9.15.9 --activate` (matches `apps/api/Dockerfile:4`; node:22-alpine ships Corepack but pnpm is NOT globally installed — without this step, `pnpm install` fails with `pnpm: not found`).
   - `WORKDIR /app`
   - **Copy workspace manifests first (layer-cache friendly):** `COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./` + `COPY packages/engine/package.json ./packages/engine/` + `COPY apps/tournament-api/package.json ./apps/tournament-api/`. The `packages/engine/package.json` copy is a pnpm-workspace-resolution manifest — it tells pnpm the workspace graph — NOT an engine source-copy. Omitting it would break `pnpm install --frozen-lockfile` because the lockfile references `packages/engine` as a workspace.
   - Install all deps (including devDeps for `tsc`): `RUN pnpm install --frozen-lockfile`
   - Copy source: `COPY tsconfig.base.json ./` + `COPY apps/tournament-api/ ./apps/tournament-api/`. Do NOT copy `packages/engine/` source — tournament-api has no engine imports (AC verified: `apps/tournament-api/package.json` does NOT list `@wolf-cup/engine` in any dependency field — T1-2 AC #2). Engine package.json is already copied in the manifest-COPY step above for pnpm workspace graph resolution; copying the full `packages/engine/` tree would be engine SOURCE duplication that `tsc` doesn't need and that pollutes the layer cache for every engine source change.
   - Build tournament-api only: `RUN pnpm --filter @tournament/api build`. The build script is `tsc` (verified at `apps/tournament-api/package.json:"build":"tsc"` from T1-2 scaffold). `tsconfig.json` extends `tsconfig.base.json` and sets `rootDir: "./src"` + `outDir: "./dist"` (T1-2 scaffold). With `src/index.ts` as the source entrypoint, this emits `dist/index.js`.

   **Runtime stage:**
   - Base: a fresh `FROM node:22-alpine` (no `AS` alias — this is the final image).
   - **Enable Corepack again:** `RUN corepack enable && corepack prepare pnpm@9.15.9 --activate`. The runtime stage is a fresh image and does NOT inherit the builder stage's Corepack activation.
   - `WORKDIR /app`
   - **Copy workspace manifests (required for `pnpm install --prod` to find the workspace graph):** `COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./` + `COPY packages/engine/package.json ./packages/engine/` + `COPY apps/tournament-api/package.json ./apps/tournament-api/`. Same manifest set as the builder stage; without these, `pnpm install --frozen-lockfile --prod` errors out on workspace resolution.
   - Install production deps only: `RUN pnpm install --frozen-lockfile --prod`. `--prod` skips devDeps. `--frozen-lockfile` ensures the runtime-stage install sees exactly the same resolved tree as the builder-stage install. This is the pnpm-recommended monorepo runtime-install pattern and matches Wolf Cup's api Dockerfile:37-38 verbatim.
   - Copy compiled output: `COPY --from=builder /app/apps/tournament-api/dist/ ./apps/tournament-api/dist/`.
   - `WORKDIR /app/apps/tournament-api`
   - `ENV NODE_ENV=production` / `ENV PORT=3000` / `ENV DB_PATH=/app/data/tournament.db`
   - `EXPOSE 3000`
   - `CMD ["node", "dist/index.js"]`

   **Deliberate divergences from `apps/api/Dockerfile`:**
   - No engine build step (`RUN pnpm --filter @wolf-cup/engine build`). Tournament-api does not import from `@wolf-cup/engine` at T1.4 — engine-boundary lint rule (T1-2) blocks all engine imports except `/stableford`, and nothing in the T1-2 scaffold uses it. Skipping the engine build saves ~8-12 seconds per image build.
   - No engine source copy in builder (`COPY packages/engine/ ./packages/engine/`). See builder-stage note above — tournament-api's `tsc` doesn't reference engine source, and `@wolf-cup/engine` is NOT a declared dep of `@tournament/api`.
   - No engine `dist/` copy into runtime (`COPY --from=builder /app/packages/engine/dist/ ./packages/engine/dist/`). Tournament-api doesn't require engine's compiled output at runtime.
   - **Engine `package.json` IS copied in both stages** — for pnpm workspace graph resolution only, NOT for engine source or engine build artifacts. Without this manifest, `pnpm install --frozen-lockfile` fails because the lockfile references `packages/engine` as a workspace member.
   - No migrations copy (`COPY apps/api/src/db/migrations/ ./apps/api/dist/db/migrations/`). Tournament-api has no `src/db/migrations/` directory at T1.4 (T1-2 scaffold shipped no migrations).
   - No migrate+seed CMD chain. CMD is `["node", "dist/index.js"]` alone — NOT `sh -c "node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js"`. T2.1 adds the first migration + schema and MUST update this Dockerfile at that time.

   **Engine-dep guard (MUST verify before the first docker build):**
   - Inspect `apps/tournament-api/package.json`. If `@wolf-cup/engine` appears under `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies` — STOP. This story's engine-skip-optimization is predicated on it being absent; adding the dep shifts the Dockerfile shape significantly (engine source + dist would need to ship into runtime, inflating image size). T1-2 verified it's absent; this guard ensures nothing between T1-2 and this implementation snuck it in. If the dep needs to be added later (T2+ story), updating this Dockerfile is mandatory.

   If any step fails — especially the `dist/index.js` emit or the runtime-stage `pnpm install --prod` — that is a defect in this story's dependency chain (the T1-2 scaffold or Wolf Cup's pnpm config), NOT a fix to work around here. STOP and investigate rather than papering over.
2. **Given** `apps/tournament-web/Dockerfile`
   **When** inspected
   **Then** it is a multi-stage build mirroring `apps/web/Dockerfile`'s exact pattern:

   **Builder stage:**
   - Base: `FROM node:22-alpine AS builder`
   - Corepack + pnpm 9.15.9: `RUN corepack enable && corepack prepare pnpm@9.15.9 --activate` (SAME reason as AC #1's builder stage — `pnpm: not found` otherwise).
   - `WORKDIR /app`
   - Workspace manifests: `COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./` + `COPY packages/engine/package.json ./packages/engine/` + `COPY apps/tournament-web/package.json ./apps/tournament-web/`. (Engine package.json is again a workspace-graph manifest, NOT a source copy.)
   - Install: `RUN pnpm install --frozen-lockfile`
   - Copy source: `COPY tsconfig.base.json ./` + `COPY apps/tournament-web/ ./apps/tournament-web/`. Do NOT copy `packages/engine/` source — tournament-web has no engine imports (AC verified: `apps/tournament-web/package.json` does NOT list `@wolf-cup/engine` in any dependency field — T1-3 AC #2). Engine package.json is already copied in the manifest-COPY step above.
   - Build: `RUN pnpm --filter @tournament/web build`. The build script is `vite build` (verified at `apps/tournament-web/package.json:"build":"vite build"` from T1-3 scaffold) and emits `apps/tournament-web/dist/` with `index.html`, `manifest.webmanifest`, `sw.js`, asset bundles, and the placeholder icons (verified in T1-3's File List).

   **Runtime stage:**
   - Base: `FROM nginx:1.27-alpine` (NOT node — the runtime serves static files via nginx only; no Node.js process).
   - Copy built assets: `COPY --from=builder /app/apps/tournament-web/dist/ /usr/share/nginx/html/`
   - Copy nginx config: `COPY apps/tournament-web/nginx.conf /etc/nginx/nginx.conf` (THIS IS THE APP-LOCAL PATH — `apps/tournament-web/nginx.conf` — NOT the root-level `nginx.conf` which Wolf Cup uses).
   - `EXPOSE 80`
   - No CMD override — nginx:1.27-alpine's default CMD starts the server.

   **Deliberate divergences from `apps/web/Dockerfile`:**
   - No engine build (`RUN pnpm --filter @wolf-cup/engine build`). Tournament-web has zero engine imports at T1.4.
   - No engine source copy (`COPY packages/engine/ ./packages/engine/`). Tournament-web doesn't reference engine source.
   - Engine `package.json` IS copied in the builder stage — again, workspace-graph manifest only, not engine source or engine build artifacts. Without it, `pnpm install --frozen-lockfile` fails on workspace resolution.
   - `COPY nginx.conf /etc/nginx/nginx.conf` → `COPY apps/tournament-web/nginx.conf /etc/nginx/nginx.conf` (Wolf Cup uses the root-level config; tournament uses its app-local one).
   - Copy destination `dist/` path differs: Wolf Cup uses `apps/web/dist/`; tournament uses `apps/tournament-web/dist/`.

   **Engine-dep guard** (same rationale as AC #1's guard): if `apps/tournament-web/package.json` lists `@wolf-cup/engine` under any dependency field, STOP — the no-engine-copy shape above is predicated on its absence. T1-3 verified absent.
3. **Given** `apps/tournament-web/nginx.conf`
   **When** inspected
   **Then** it is a semantic match for the root-level Wolf Cup `nginx.conf` — NOT a byte-identical copy. The following directives are REQUIRED (and each MUST be present). Comments, whitespace, and trivial formatting may differ:
   - Top-level: `events { worker_connections 1024; }`
   - `http { ... }` with: `include /etc/nginx/mime.types`, `default_type application/octet-stream`, `sendfile on`, `gzip on`, `gzip_types text/plain text/css application/javascript application/json image/svg+xml`.
   - `server { ... }` with `listen 80;` + `root /usr/share/nginx/html;`.
   - **`/api/` proxy block** (the ONE meaningful divergence from Wolf Cup):
     - `proxy_pass http://tournament-api:3000;` — docker service name is `tournament-api`, NOT `api`. Resolved via docker's internal DNS on the `internal` network.
     - `proxy_http_version 1.1;` + `proxy_set_header Connection "";` (keep-alive across proxy).
     - Standard forwarded-for headers: `Host $host`, `X-Real-IP $remote_addr`, `X-Forwarded-For $proxy_add_x_forwarded_for`, `X-Forwarded-Proto $scheme`.
     - `proxy_read_timeout 30s;` + `client_max_body_size 12m;` (mirrors Wolf Cup's generous body limit for future photo uploads, not strictly needed at T1.4 but cheap to include).
   - **SW + manifest no-cache regex** (prevent stale service workers breaking the app):
     - Pattern: `^/(sw\.js|manifest\.webmanifest)$`
     - `add_header Cache-Control "no-store, no-cache, must-revalidate";` + `expires -1;` + `try_files $uri =404;`
   - **Immutable asset cache regex** (Vite ships fingerprinted filenames → safe to cache forever):
     - Pattern: `\.(js|css|png|ico|svg|woff|woff2)$`
     - `add_header Cache-Control "public, max-age=31536000, immutable";` + `try_files $uri =404;`
   - **PDF cache regex** (harmless carry-forward from Wolf Cup; tournament has no PDFs yet):
     - Pattern: `\.pdf$`
     - `add_header Cache-Control "public, max-age=3600";` + `try_files $uri =404;`
   - **SPA fallback** (last `location` block): `location / { try_files $uri $uri/ /index.html; }`
   Wolf Cup's `nginx.conf` today is 53 lines. Tournament's copy will be of similar size. Exact line count is NOT an AC — if the file ends up 51 or 55 lines due to formatting, that's fine; if it has zero of the directives above, that's a bug.
4. **Given** `docker-compose.yml` at repo root (SHARED path — explicit user approval required before editing)
   **When** inspected post-edit
   **Then** two new top-level services exist under `services:`, each with explicit `container_name`:
   - `tournament-api`:
     - `build: { context: ., dockerfile: apps/tournament-api/Dockerfile }`
     - `container_name: tournament-api` (no `wolf-cup-` prefix — tournament is a separate project)
     - `restart: unless-stopped`
     - `environment`: exactly `NODE_ENV=production`, `DB_PATH=/app/data/tournament.db`, `PORT=3000`, `TZ=America/New_York`. NO `ADMIN_*`, no `GHIN_*`, no `R2_*`, no `EMAIL_*` — tournament hasn't shipped auth/GHIN/gallery/email yet (those envs land in T1.6 / T3.4 / T7.4 respectively, each story adding only the envs it needs). Keeping the initial env set minimal avoids committing to unfinalized shapes.
     - `volumes: - tournament_sqlite_data:/app/data` (separate named volume — NOT overlapping Wolf Cup's `sqlite_data`)
     - `networks: - internal` (ONLY — no `n8n_default`, matches Wolf Cup's `api` service which is also `internal` only)
     - `healthcheck`: `test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]`, `interval: 30s`, `timeout: 5s`, `retries: 3`, `start_period: 15s` (mirrors Wolf Cup's `api` healthcheck verbatim)
     - NO Traefik labels (only tournament-web is Traefik-routed; tournament-api is internal-only)
   - `tournament-web`:
     - `build: { context: ., dockerfile: apps/tournament-web/Dockerfile }`
     - `container_name: tournament-web`
     - `restart: unless-stopped`
     - `depends_on: { tournament-api: { condition: service_started } }` (mirror Wolf Cup's `web` → `api` dep shape; `service_started` NOT `service_healthy` because Wolf Cup uses `service_started` too)
     - `networks: - internal, - n8n_default` (BOTH — internal for nginx→tournament-api proxy; n8n_default for Traefik routing)
     - `labels`: at minimum the following **seven required labels**, matching the shape of Wolf Cup's block at `docker-compose.yml:54-61` (as of 2026-04-20) verbatim except substituting `wolf-cup` → `tournament` and `wolf.dagle.cloud` → `tournament.dagle.cloud`. Additional labels (e.g., middleware, compression, redirects) MAY be included but are not required; if Wolf Cup's block has grown beyond seven by implementation time, match Wolf Cup's current label set with the tournament substitutions applied. The seven-label required set:
       ```
       - "traefik.enable=true"
       - "traefik.docker.network=n8n_default"
       - "traefik.http.routers.tournament.rule=Host(`tournament.dagle.cloud`)"
       - "traefik.http.routers.tournament.entrypoints=websecure"
       - "traefik.http.routers.tournament.tls=true"
       - "traefik.http.routers.tournament.tls.certresolver=mytlschallenge"
       - "traefik.http.services.tournament.loadbalancer.server.port=80"
       ```
       Router/service name is `tournament` to avoid collision with Wolf Cup's `wolf-cup` router. A comment line `# HTTP → HTTPS handled globally by Traefik entrypoint config` matching Wolf Cup's line 62 MAY be included for parity but is not required (not a label; cosmetic).
5. **Given** the `volumes:` section of `docker-compose.yml`
   **When** inspected post-edit
   **Then** a new named volume `tournament_sqlite_data:` is declared alongside (NOT replacing) the existing `sqlite_data:`. Declaration is a single line `tournament_sqlite_data:` under `volumes:` with no explicit driver — defaults to local, matching `sqlite_data`. Data on this volume is tournament-scoped and NEVER shared with Wolf Cup (FD-1, FD-2 isolation).
6. **Given** the `networks:` section of `docker-compose.yml`
   **When** inspected post-edit
   **Then** the existing network declarations are UNCHANGED:
   ```yaml
   networks:
     internal:
       driver: bridge
     n8n_default:
       external: true
   ```
   Tournament services use these same networks; no tournament-only network is declared. (Deliberate design per architecture review: isolation is at the volume, DB, and subdomain layers, not the docker-network layer. Separate tournament-internal would be over-engineered at v1.)
7. **Given** the existing `api` and `web` services in `docker-compose.yml`
   **When** inspected post-edit
   **Then** their definitions are **byte-unchanged**. All environment variables, volumes, networks, labels, and healthchecks on the Wolf Cup services remain exactly as they were pre-T1.4. This is the FR-G1 regression guard at the compose layer.
8. **Given** a local Docker installation
   **When** `docker compose -f docker-compose.yml config` runs at the repo root
   **Then** it exits `0` and the resolved config includes both new services + the new volume + unchanged Wolf Cup services. This validates compose-file syntactic correctness without requiring a build. This is the scaffold-local verification; a full end-to-end build+curl verification (AC #10) happens post-deploy on the VPS.
9. **Given** a local Docker installation
   **When** `docker compose build tournament-api tournament-web` runs at the repo root
   **Then** both images build to completion (exit 0) with no errors. The builder stage correctly resolves `@tournament/api` / `@tournament/web` via pnpm; the runtime stage of each Dockerfile assembles without install-time failure. (AC asserts **image build success only** — not container boot, which happens at `docker compose up` time. A full container-boot smoke is handled by AC #10's post-deploy curl.) If Docker isn't available locally, this AC is deferred to the VPS deploy (but SHOULD be attempted locally — the story loses a cheap verification otherwise). Document the outcome in the Debug Log either way.
10. **Given** a successful VPS deploy via `DEPLOY_USER=root ./deploy.sh` (per Josh's memory: deploy convention) **AFTER** this story's commit lands on master and is pushed
    **When** `curl -sS https://tournament.dagle.cloud/api/health` runs against prod
    **Then** it returns HTTP 200 with a JSON response object of shape `{"status": "ok", "startupTime": <positive integer, milliseconds>}` — proves the full request path: Traefik (TLS term, cert resolver `mytlschallenge`, host match `tournament.dagle.cloud`) → `tournament-web` container's nginx → `/api/` proxy block → `tournament-api:3000/api/health` → Hono app response. This is a post-deploy verification, not a local gate. Blocking precondition: the `*.dagle.cloud` wildcard DNS entry + the Traefik certresolver config must already route wildcards (per architecture D5-9).
11. **Given** a successful deploy
    **When** Wolf Cup's `wolf-cup-api` and `wolf-cup-web` containers are inspected (`docker ps`, `docker logs`)
    **Then** they continue to run without restart-loop and `curl -sS https://wolf.dagle.cloud/api/health` returns HTTP 200 as before. FR-G1 zero-disruption guarantee.
12. **Given** `docker-compose.yml`
    **When** diffed against its pre-T1.4 state
    **Then** the diff is an ADDITIVE set of lines only — zero deletions, zero modifications of Wolf Cup service definitions. Verifiable with `git diff --stat docker-compose.yml` showing `+N -0`.
13. **Given** Wolf Cup workspaces
    **When** `pnpm -F @wolf-cup/api test` and `pnpm -F @wolf-cup/engine test` run after the Dockerfile + compose additions
    **Then** both continue to pass with zero new failures and zero net-negative test count change. (Same regression guard as T1-2 AC #9 / T1-3 AC #17 — no code changes in Wolf Cup paths, so this should be trivially green, but verify.)

## Tasks / Subtasks

- [ ] Task 1: Create `apps/tournament-api/Dockerfile` (AC: #1)
  - [ ] Subtask 1.1: Write the builder + runtime stages per AC #1. Use Wolf Cup's `apps/api/Dockerfile` as the shape reference; substitute service names and drop the engine build + migrate/seed CMD steps (tournament has no engine dep or schema yet).
  - [ ] Subtask 1.2: CMD must be exactly `CMD ["node", "dist/index.js"]` (single process; T2.1 will add a migrate step).
- [ ] Task 2: Create `apps/tournament-web/Dockerfile` (AC: #2)
  - [ ] Subtask 2.1: Mirror `apps/web/Dockerfile` shape with name substitutions. Critically: `COPY apps/tournament-web/nginx.conf /etc/nginx/nginx.conf` (NOT the root-level `nginx.conf`).
  - [ ] Subtask 2.2: Do NOT run `pnpm --filter @wolf-cup/engine build` (Wolf Cup's web Dockerfile does this; tournament-web has no engine dep so the step is unnecessary and would force an engine build on every tournament-web rebuild).
- [ ] Task 3: Create `apps/tournament-web/nginx.conf` (AC: #3)
  - [ ] Subtask 3.1: Copy the shape of the root `nginx.conf` exactly. Substitute `proxy_pass http://api:3000;` → `proxy_pass http://tournament-api:3000;`. Do NOT edit the root `nginx.conf` — Wolf Cup's config stays untouched (FORBIDDEN boundary).
- [ ] Task 4: Update `docker-compose.yml` (AC: #4, #5, #6, #7) — **SHARED PATH, HARD STOP FOR USER APPROVAL**
  - [ ] Subtask 4.1: Announce the intended edit to the user with a precise diff preview (exact lines added). Wait for explicit approval. Do NOT edit until approved.
  - [ ] Subtask 4.2: Insert `tournament-api` service block between the existing `api` block and the existing `web` block. Use consistent YAML indentation (2 spaces).
  - [ ] Subtask 4.3: Insert `tournament-web` service block after `web` block.
  - [ ] Subtask 4.4: Add `tournament_sqlite_data:` under `volumes:`.
  - [ ] Subtask 4.5: Verify `api` + `web` + existing volumes + networks are byte-unchanged (AC #7, #12). Run `git diff docker-compose.yml` — every hunk MUST be a `+` line, zero `-` lines in the `api:` / `web:` / `volumes:` / `networks:` ranges.
- [ ] Task 5: Local verification (AC: #8, #9)
  - [ ] Subtask 5.1: Run `docker compose -f docker-compose.yml config > /dev/null` (stream to null to avoid dumping the full config in the Debug Log; exit code is the signal).
  - [ ] Subtask 5.2: Attempt `docker compose build tournament-api tournament-web`. If Docker isn't available locally, skip and document in Debug Log with a note that VPS deploy is the authoritative build verification.
- [ ] Task 6: Wolf Cup regression (AC: #13)
  - [ ] Subtask 6.1: Run `pnpm -F @wolf-cup/engine test` — must pass with same count.
  - [ ] Subtask 6.2: Run `pnpm -F @wolf-cup/api test` — must pass with same count.
  - [ ] Subtask 6.3: Do NOT deploy from this story. Deployment is a separate user action (Josh runs `deploy.sh` after reviewing the commit).
- [ ] Task 7: Post-deploy validation placeholder (AC: #10, #11)
  - [ ] Subtask 7.1: Document in the story's Completion Notes that `curl https://tournament.dagle.cloud/api/health` is the post-deploy verification and is OUT OF SCOPE for the director's auto-commit cycle. Josh deploys via `deploy.sh` manually; he runs this curl and confirms. Without Josh's manual deploy + verification, AC #10 is "pending post-deploy."
  - [ ] Subtask 7.2: Document that `*.dagle.cloud` wildcard DNS + Traefik cert resolver MUST already be configured on the VPS (architecture D5-9 precondition). If either is not in place, AC #10 fails deterministically; that's an infra blocker, not a code defect. Story is shippable as "ready-for-deploy" regardless; post-deploy verification confirms.

## Dev Notes

- **No deploy.sh changes.** `deploy.sh` already runs `docker compose up -d --build` which picks up new services automatically. Zero edits to `deploy.sh` (SHARED path — skipped deliberately).
- **No root `.env.example` changes at T1.4.** The file is currently empty (0 lines verified). Tournament doesn't require any env vars at T1.4 (ports + DB path are defaults). T1.6 auth story will add `GOOGLE_OAUTH_CLIENT_ID` + `RESEND_API_KEY` and at that point may add a populated `.env.example`. T1.4 avoids the SHARED edit.
- **No CI edits at T1.4.** `.github/workflows/ci.yml` updates land in T1.5 (dedicated CI story). Creating tournament docker services without a CI build step is acceptable because CI doesn't build Docker images in this project today; that's a deploy-time concern.
- **Separate `tournament_sqlite_data` volume (FD-1/FD-2 isolation).** Wolf Cup's DB at `/var/lib/docker/volumes/wolf-cup_sqlite_data/_data/wolf-cup.db` is untouched. Tournament writes to `/var/lib/docker/volumes/wolf-cup_tournament_sqlite_data/_data/tournament.db`. The `wolf-cup_` prefix on both volume names comes from the docker-compose project name (the root directory name); not a Wolf Cup ownership claim on tournament's data. Tournament's DB never opens Wolf Cup's DB, and vice versa.
- **Why tournament-api on `internal` only (no `n8n_default`):** Wolf Cup's `api` has the same posture. The backend doesn't need Traefik-routed public exposure — it's reached via the web container's nginx `/api/` proxy. Exposing tournament-api directly to `n8n_default` would let external traffic hit it bypassing nginx, risking future auth-surface surprises.
- **Traefik router name `tournament` (not `tournament-web` or `tournament-cup`):** shorter is better for dashboard readability; Wolf Cup uses `wolf-cup` as the router name, not `wolf-cup-web`. Match the pattern.
- **No Traefik HTTP-to-HTTPS redirect label on tournament-web:** Wolf Cup doesn't have one either — the HTTP→HTTPS redirect is configured globally at the Traefik entrypoint level (per comment in docker-compose.yml line 62). Tournament inherits this behavior automatically.
- **Dockerfile CMD divergence from Wolf Cup's api:** Wolf Cup's api CMD runs `node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js`. Tournament-api's CMD is just `node dist/index.js` because T1.4 ships no schema or seed scripts. T2.1 (`courses` + `revisions` schema) will add migrations and MUST update this Dockerfile at that time. Until then, attempting to run migrations would crash on a missing `dist/db/migrate.js`. Document the follow-up responsibility in T2.1's eventual spec.
- **Healthcheck uses `wget` which node:22-alpine ships by default.** Alpine's `wget` is BusyBox-based; Wolf Cup's `api` healthcheck uses the exact same `["CMD", "wget", "-qO-", "http://localhost:3000/api/health"]` invocation and has been running in production continuously since the Wolf Cup 2026 season launched (2026-04-17), so BusyBox-wget flag compatibility is empirically proven under this base image. Mirror verbatim; do NOT refactor to separated flags (`wget -q -O - ...`) — matching Wolf Cup's literal form ensures any future wget regression affects BOTH apps symmetrically and gets fixed once.
- **`depends_on: condition: service_started` is a deliberate Wolf Cup parity choice, not an oversight.** Wolf Cup's `web` also uses `service_started` (not `service_healthy`) to gate on `api` startup. On the first `docker compose up -d --build` after deploy, there IS a brief cold-start window (typically 1-15 seconds) where tournament-web nginx can proxy to a not-yet-listening tournament-api, producing transient `502 Bad Gateway` responses. This is acceptable because (a) Wolf Cup has the same behavior and it has not caused user-visible problems, (b) Traefik + nginx both retry quickly, and (c) the first curl check is typically done by Josh a minute+ after deploy completes, well past the cold-start window. Upgrading to `service_healthy` would also diverge from Wolf Cup parity and wait for the healthcheck (≥15s `start_period`), making deploys consistently slower. Not worth it at v1. If cold-start 502s become a real problem, revisit then.
- **Explicit `container_name` is Wolf Cup parity.** Wolf Cup forces `container_name: wolf-cup-api` and `wolf-cup-web`; tournament forces `tournament-api` and `tournament-web`. Docker Compose's default scoped naming (`{project}_{service}_1`) is noisier for `docker ps` + `docker logs` ergonomics, which Josh uses daily. Risk: if the VPS ever runs another project that claims `tournament-api` / `tournament-web` as container names, deploys would fail with a name-collision error. That's a known operational trade-off — the VPS currently hosts only Wolf Cup + tournament + n8n (per `networks: n8n_default: external: true`). No collision today. If the risk materializes, rename to `wolf-cup-tournament-api` or similar.
- **`docker compose -f docker-compose.yml config` is the local syntactic gate.** Running the full `docker compose up` locally would spin up both Wolf Cup and tournament containers, which is noisy and unnecessary for story acceptance. The `config` command validates YAML + schema + volume/network references without doing any image work.
- **Wolf Cup isolation (FD-1/FD-2):** this story modifies exactly ONE SHARED file (`docker-compose.yml` — additive lines) and creates three new ALLOWED files (`apps/tournament-api/Dockerfile`, `apps/tournament-web/Dockerfile`, `apps/tournament-web/nginx.conf`). Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`, the root `nginx.conf`, `deploy.sh`, `.github/**`, root `package.json`, or `pnpm-lock.yaml`. The commit diff on Wolf Cup paths MUST be empty.
- **Per-epic Codex review suggestion:** not applicable at story level — this is a within-story codex review pass per director protocol.

### Project Structure Notes

- Target directory changes:
  - `apps/tournament-api/Dockerfile` (new, ALLOWED)
  - `apps/tournament-web/Dockerfile` (new, ALLOWED)
  - `apps/tournament-web/nginx.conf` (new, ALLOWED)
  - `docker-compose.yml` (modified, SHARED — approval-gated)
- Shape after this story:
  ```
  apps/tournament-api/
    Dockerfile              # NEW: multi-stage node:22-alpine
    ...                     # (T1.2 contents unchanged)
  apps/tournament-web/
    Dockerfile              # NEW: multi-stage builder + nginx:1.27-alpine runtime
    nginx.conf              # NEW: tournament-scoped nginx (proxy_pass → tournament-api)
    ...                     # (T1.3 contents unchanged)
  docker-compose.yml        # MODIFIED: +tournament-api +tournament-web +tournament_sqlite_data volume
  ```
- **NOT in scope at T1.4** (called out to prevent dev-agent overreach):
  - `deploy.sh` edits — deploy already invokes `docker compose up -d --build` which picks up new services.
  - `.github/workflows/*.yml` edits — T1.5.
  - Root `.env.example` edits — T1.6 auth or later.
  - Migrations / seed scripts in tournament-api — T2.1 schema story.
  - `apps/tournament-api/src/**` edits — scaffold from T1.2 is sufficient for deploy.
  - `apps/tournament-web/src/**` edits — scaffold from T1.3 is sufficient.

### References

- Epic source: `_bmad-output/planning-artifacts/tournament/epics-phase1.md` heading `#### Story T1.4: Docker Compose + Traefik for tournament.dagle.cloud` (lines 422-456).
- Architecture D5-9 (DNS + Traefik): `_bmad-output/planning-artifacts/tournament/architecture.md` — wildcard `*.dagle.cloud` precondition.
- Architecture §Starter Template Evaluation (mentions `docker-compose.yml` update as step 4 of T1 sequence): `_bmad-output/planning-artifacts/tournament/architecture.md` lines 183-189.
- FR-G1 (zero Wolf Cup regression), FR-G2 (separate subdomain), NFR-C3 (Wolf Cup tests stay green): `_bmad-output/planning-artifacts/tournament/prd.md`.
- Wolf Cup references (READ only — DO NOT edit):
  - `docker-compose.yml` (root) — the file being modified. Current services: `api`, `web`. Current volumes: `sqlite_data`. Current networks: `internal` (local bridge), `n8n_default` (external, Traefik).
  - `apps/api/Dockerfile` — shape reference for `apps/tournament-api/Dockerfile` (AC #1).
  - `apps/web/Dockerfile` — shape reference for `apps/tournament-web/Dockerfile` (AC #2).
  - `nginx.conf` (root) — shape reference for `apps/tournament-web/nginx.conf` (AC #3).
  - `deploy.sh` — NOT edited; already runs `docker compose up -d --build`.
- T1-2 scaffold (tournament-api) file list: see `_bmad-output/implementation-artifacts/tournament/T1-2-scaffold-tournament-api.md` § File List — confirms no migrate/seed scripts exist at T1.4.
- T1-3 scaffold (tournament-web) file list: see `_bmad-output/implementation-artifacts/tournament/T1-3-scaffold-tournament-web.md` § File List — confirms `dist/index.html`, `manifest.webmanifest`, `sw.js` emit at build time.
- Memory context: Josh's `Deploy convention` note in memory (`DEPLOY_USER=root ./deploy.sh`) is the Josh-runs-deploy procedure. Post-deploy AC #10 verification is on Josh.

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Claude Opus 4.7, 1M context), running as the Tournament Director orchestrator.

### Debug Log References

Spec-review rounds (2026-04-20):
- Round 1: 2 High + 2 Medium + 1 Low — all mechanically fixed (`_bmad-output/reviews/T1-4-docker-compose-traefik-tournament-dagle-cloud-spec-codex.md`).
- Round 2: 1 High + 2 Medium + 1 Low — all mechanically fixed (`_bmad-output/reviews/T1-4-docker-compose-traefik-tournament-dagle-cloud-spec-codex-round2.md`).
- Round 3: 1 High + 2 Medium + 1 Low — all mechanically fixed (`_bmad-output/reviews/T1-4-docker-compose-traefik-tournament-dagle-cloud-spec-codex-round3.md`).
- Round 4: PASS (no findings) — `_bmad-output/reviews/T1-4-docker-compose-traefik-tournament-dagle-cloud-spec-codex-round4.md`.

Implementation verification (2026-04-20):

```
# Engine-dep guard (AC #1 + #2 MUST-check before Docker build)
apps/tournament-api/package.json: @wolf-cup/engine declared? False  ✓
apps/tournament-web/package.json: @wolf-cup/engine declared? False  ✓
Result: engine-skip shape is safe.

# Compose additive-only verification (AC #7, #12)
git diff --stat docker-compose.yml → +46 -0
Deletions in Wolf Cup api/web/sqlite_data/networks blocks: zero (inspected)

# AC #8 local verification — Docker CLI unavailable in this environment
`which docker` → no docker
Per spec AC #8+#9: "If Docker isn't available locally, this AC is deferred to the VPS deploy."
Substitute used: Python PyYAML structural check on docker-compose.yml
  services parsed: [api, tournament-api, web, tournament-web]
  volumes parsed:  [sqlite_data, tournament_sqlite_data]
  networks parsed: [internal, n8n_default]
  Assertions:
    tournament-api.networks == ['internal']          PASS
    tournament-web.networks contains internal+n8n_default  PASS
    tournament-web.labels includes Host(tournament.dagle.cloud)  PASS
    tournament-web.labels includes certresolver=mytlschallenge   PASS
    tournament-web.labels includes loadbalancer.server.port=80   PASS
  YAML parse + structural checks: PASS

# AC #9 local image build — deferred to VPS deploy per spec.

# AC #13 + T1-3 regression parity (zero delta)
pnpm -F @wolf-cup/engine test  → 11 files, 468 tests passed (Δ = 0)
pnpm -F @wolf-cup/api    test  → 21 files, 429 tests passed (Δ = 0)
pnpm -F @tournament/api  test  → 2 files, 19 tests passed (Δ = 0)
pnpm -F @tournament/web  test  → 1 file, 1 test passed (Δ = 0)
pnpm -r lint                   → all 5 workspaces green

# pnpm -r typecheck NOT run (T1-4 touches zero TS source).
# Pre-existing Wolf Cup web typecheck failure (apps/web/src/routes/standings.tsx:480) documented in T1-3 followups persists — unchanged by T1-4.
```

### Completion Notes List

- **Scope discipline held.** T1-4 added 3 ALLOWED files (`apps/tournament-api/Dockerfile`, `apps/tournament-web/Dockerfile`, `apps/tournament-web/nginx.conf`) and modified 1 SHARED file (`docker-compose.yml`, user-approved mid-story). Zero writes to `apps/api/**`, `apps/web/**`, `packages/engine/**`, root `nginx.conf`, `deploy.sh`, `.github/**`, or root `package.json`.
- **AC compliance:** 13 ACs covered. AC #8/#9 (local docker compose config + build) deferred to VPS per explicit spec allowance — substituted with a PyYAML structural check. AC #10 (post-deploy curl to `https://tournament.dagle.cloud/api/health`) is post-deploy by design; Josh runs it after `deploy.sh`. AC #11 (Wolf Cup `wolf-cup-api`/`wolf-cup-web` continue to run) is also post-deploy.
- **docker-compose.yml is additive-only** (+46 -0). Wolf Cup `api`, `web`, `sqlite_data` volume, and `networks:` block byte-unchanged — verified via `git diff --stat`.
- **Tournament services match Wolf Cup parity where required and diverge deliberately where tournament differs:**
  - tournament-api: internal-only network, same healthcheck shape (`wget -qO- http://localhost:3000/api/health`), separate `tournament_sqlite_data` volume, ONLY 4 env vars (NODE_ENV, DB_PATH, PORT, TZ) — auth/GHIN/R2/email all deferred to later stories.
  - tournament-web: internal + n8n_default, 7 Traefik labels matching Wolf Cup's shape byte-for-byte with `wolf-cup`→`tournament` and `wolf.dagle.cloud`→`tournament.dagle.cloud` substitutions.
  - Traefik router/service name is `tournament` (not `tournament-web`) — matches Wolf Cup's `wolf-cup` (not `wolf-cup-web`) naming convention.
- **Dockerfile engine-skip pattern verified valid** by the engine-dep guard check above. Tournament-api's and tournament-web's `package.json` declare zero engine deps at T1.4, so `packages/engine/package.json` is copied in both stages (workspace-graph manifest resolution) but `packages/engine/` source and `packages/engine/dist/` are NOT copied. Saves ~8-12s per image build vs Wolf Cup's engine-building Dockerfiles.
- **.npmrc contents verified benign:** `strict-peer-dependencies=false` + `link-workspace-packages=true` only. No auth tokens, no registry credentials. Codex impl-review #1 flagged the theoretical secret-leak vector; inspection confirms no leak risk. Wolf Cup's Dockerfiles also COPY `.npmrc` and have been deployed continuously since 2026-04-17 season launch without incident. Pattern is safe.

### Followups

- **[Post-deploy verification — Josh runs `DEPLOY_USER=root ./deploy.sh` manually]** After this commit lands on master and is pushed, Josh runs deploy on the VPS. Post-deploy verification steps Josh should run (these are AC #10, #11 but not local gates):
  1. `curl -sS https://tournament.dagle.cloud/api/health` → expect HTTP 200 with `{"status":"ok","startupTime":<int>}`.
  2. `curl -sS https://wolf.dagle.cloud/api/health` → expect HTTP 200 (confirms Wolf Cup still serves).
  3. `docker ps` on VPS → expect 4 containers: `wolf-cup-api`, `wolf-cup-web`, `tournament-api`, `tournament-web`, all up.
  4. `docker logs tournament-api` → look for `Tournament API listening on port 3000`.
  If step 1 returns 502 within the first 30-60s, that's the documented cold-start window (Wolf Cup-parity `depends_on: service_started`). Retry after waiting for the healthcheck `start_period` (15s) + a few check intervals.
  Pre-deploy sanity that SHOULD run before `./deploy.sh`:
  - `docker network ls | grep n8n_default` — confirms the external Traefik network exists on the VPS. Since Wolf Cup already depends on this network, if `wolf-cup-web` is running on the VPS, the network exists. If not (first-ever deploy to a fresh VPS), `docker compose up` will fail with `network n8n_default declared as external, but could not be found`; create the network with `docker network create n8n_default` (or whatever command the n8n stack uses).
  - `docker compose -f docker-compose.yml config > /dev/null && echo OK` — cheap syntactic gate that wasn't locally runnable during impl (docker CLI unavailable in the dev sandbox); surfaces any Compose-spec-syntax issues PyYAML wouldn't have caught.
- **[Prerequisite — should already be in place] `*.dagle.cloud` wildcard DNS + Traefik cert resolver `mytlschallenge` must be configured on the VPS.** Per architecture D5-9 this was set up when Wolf Cup launched; tournament inherits it. If `dig tournament.dagle.cloud` doesn't resolve on Josh's machine or the cert resolver fails to issue for `tournament.dagle.cloud`, that's an infra blocker to investigate separately — not a code defect in this story.
- **[T2.1 carry-forward]** When T2.1 adds the first tournament-api schema + migration, `apps/tournament-api/Dockerfile` CMD MUST be updated from `["node", "dist/index.js"]` to `["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]` (or include seed if seeds land). Migrations directory COPY MUST also be added to the runtime stage. T1-4's Dockerfile intentionally omits these; T2.1's story MUST include the carry-forward as an AC.
- **[Impl-codex #1 Medium, noted not actioned]** `.npmrc` COPY'd into image layers. Currently benign (verified file contents). If `.npmrc` ever gets a real auth token, switch to BuildKit secret-mount (`RUN --mount=type=secret,id=npmrc ...`) rather than COPY. Same fix should apply to Wolf Cup's Dockerfiles simultaneously.
- **[Impl-codex #2 Low, acknowledged]** Story Status header was `ready-for-dev` during impl while sprint-status.yaml was `in-progress` — convention matches T1-3 (header reflects the committed-state status, sprint-status tracks the in-flight phase). Header will be updated to `done` at commit time in sync with sprint-status.

### File List

- `apps/tournament-api/Dockerfile` (new)
- `apps/tournament-web/Dockerfile` (new)
- `apps/tournament-web/nginx.conf` (new)
- `docker-compose.yml` (modified — SHARED path, user-approved; +46 -0 additive diff adding tournament-api service, tournament-web service with Traefik labels, tournament_sqlite_data volume)
- `_bmad-output/implementation-artifacts/tournament/sprint-status.yaml` (modified — T1-4 status transitions across the cycle)
