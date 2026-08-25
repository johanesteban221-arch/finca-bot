# syntax=docker/dockerfile:1
# ---- Multi-stage build for a small Next.js (standalone) image ----

# 1) Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2) Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders so `next build` never fails on missing envs.
# Real values are injected at runtime by Easypanel (see Environment).
ENV NEXT_TELEMETRY_DISABLED=1

# Stamp the image with its identity, read back by GET /api/version.
# `.dockerignore` excludes `.git`, so the SHA cannot be discovered here — it has
# to be passed in (`--build-arg GIT_SHA=...`). The timestamp does not depend on
# that: it is generated here, so the endpoint answers "is my deploy live?" even
# when GIT_SHA is never wired up. This runs after `COPY . .` on purpose — any
# source change busts the cache above it, so the stamp is never stale for a real
# code change.
ARG GIT_SHA=desconocido
RUN printf 'export const BUILD_INFO = {\n  sha: "%s",\n  construidoEn: "%s",\n} as const;\n' \
      "$GIT_SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > src/lib/build-info.ts

RUN npm run build

# 3) Runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server + static assets + public folder
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
