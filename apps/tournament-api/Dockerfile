# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Workspace manifests first for layer-cache. packages/engine/package.json is
# the workspace-graph manifest only (pnpm-lock.yaml references the workspace
# member); engine source is NOT copied because @tournament/api has no engine
# imports at T1.4 (verified: @wolf-cup/engine absent from apps/tournament-api
# dep fields).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/engine/package.json ./packages/engine/
COPY apps/tournament-api/package.json ./apps/tournament-api/

# Install ALL deps (including devDeps for tsc)
RUN pnpm install --frozen-lockfile

# Copy source. No packages/engine/ source — tsc doesn't reference it.
COPY tsconfig.base.json ./
COPY apps/tournament-api/ ./apps/tournament-api/

# Build tournament-api only
RUN pnpm --filter @tournament/api build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Workspace manifests (same set as builder — required for pnpm install --prod
# to resolve the workspace graph). Engine source/dist is NOT copied (no engine
# use at T1.4); if a later story adds @wolf-cup/engine as a dep, update this
# Dockerfile to ship engine dist into runtime.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/engine/package.json ./packages/engine/
COPY apps/tournament-api/package.json ./apps/tournament-api/

# Install production deps only (musl binary for @libsql/client resolves on Alpine)
RUN pnpm install --frozen-lockfile --prod

# Compiled output from builder
COPY --from=builder /app/apps/tournament-api/dist/ ./apps/tournament-api/dist/

# Raw SQL migrations — tsc does NOT copy .sql files through the build so
# they must be COPYed separately from source into the same path the
# compiled dist/db/migrate.js expects (relative `./migrations` via
# `import.meta.url`). Pattern mirrors apps/api/Dockerfile's migrations COPY.
COPY apps/tournament-api/src/db/migrations/ ./apps/tournament-api/dist/db/migrations/

WORKDIR /app/apps/tournament-api

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/tournament.db

EXPOSE 3000

# Run migrate → seed → start. Every container start is idempotent:
# drizzle's __drizzle_migrations journal skips applied migrations; the
# T1-6a placeholder seed is a no-op. T2.2 fills in the real roster seed.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/index.js"]
