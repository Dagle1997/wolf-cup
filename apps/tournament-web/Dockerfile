# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Workspace manifests first for layer-cache. packages/engine/package.json is
# the workspace-graph manifest only; engine source is NOT copied because
# @tournament/web has no engine imports at T1.4.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/engine/package.json ./packages/engine/
COPY apps/tournament-web/package.json ./apps/tournament-web/

RUN pnpm install --frozen-lockfile

# Copy source. No packages/engine/ source — vite build doesn't reference it.
COPY tsconfig.base.json ./
COPY apps/tournament-web/ ./apps/tournament-web/

# Build tournament-web only
RUN pnpm --filter @tournament/web build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=builder /app/apps/tournament-web/dist/ /usr/share/nginx/html/
COPY apps/tournament-web/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
