# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

# Copy workspace manifest files for layer-cache
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/engine/package.json ./packages/engine/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/engine/ ./packages/engine/
COPY apps/web/ ./apps/web/

# Build engine first so its dist/ is available to the web bundler
RUN pnpm --filter @wolf-cup/engine build
RUN pnpm --filter @wolf-cup/web build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

COPY --from=builder /app/apps/web/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
