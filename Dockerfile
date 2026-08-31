# Dockerfile — canonical production build (PNRC-0.1 / I2).
# Multi-target: web, worker-all, and optional dedicated worker images.
# LEGACY_GCP: use Dockerfile.gcp only for historical Cloud Run pilot reference.

FROM node:22-alpine AS base

RUN apk update && apk add --no-cache openssl curl chromium tini

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# ─── Build stage ─────────────────────────────────────────────────────────────
FROM base AS builder

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma.config.ts ./
RUN npm ci --legacy-peer-deps --ignore-scripts

COPY prisma ./prisma
RUN mkdir -p /app/docs/architecture && DATABASE_URL=postgresql://localhost npx prisma generate

COPY . .
RUN node scripts/postinstall-prisma-generate.mjs && node scripts/copy-cesium-assets.cjs
RUN npm run build

# ─── Production base (shared runtime layer) ───────────────────────────────────
FROM base AS production-base

ENV NODE_ENV=production

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma.config.ts ./

ENV DATABASE_URL=postgresql://localhost:5432/docker_build_dummy

RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts \
  && test -f node_modules/.bin/tsx \
  && npm cache clean --force

COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/services ./services
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/src ./src
COPY --from=builder /app/app ./app
COPY --from=builder /app/config ./config
COPY --from=builder /app/types ./types
COPY --from=builder /app/stubs ./stubs
COPY --from=builder /app/db.server.ts ./db.server.ts
COPY --from=builder /app/constants.ts ./constants.ts
COPY --from=builder /app/types.ts ./types.ts
COPY --from=builder /app/*.ts ./

RUN chown -R appuser:appgroup /app
USER appuser

ENTRYPOINT ["/sbin/tini", "--"]

# ─── Web API (default production target) ─────────────────────────────────────
FROM production-base AS web

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]

# ─── LU + maintenance workers (signer-isolated from web) ───────────────────────
FROM production-base AS worker-all

CMD ["npm", "run", "worker:all"]

# ─── Optional dedicated worker targets ───────────────────────────────────────
FROM production-base AS gdpr-worker

CMD ["npx", "tsx", "server/workers/gdpr-maintenance-worker.ts"]

FROM production-base AS search-indexer-worker

CMD ["npx", "tsx", "server/workers/search-indexer-worker.ts"]

FROM production-base AS domstol-rss-worker

CMD ["npx", "tsx", "server/workers/domstol-rss-worker.ts"]
