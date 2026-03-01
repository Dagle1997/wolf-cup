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

# Copy migrations next to compiled migrate.js (join(__dirname, './migrations'))
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
