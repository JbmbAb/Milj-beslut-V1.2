FROM node:22-alpine AS base

# Provider-neutral production base: curl for probes, openssl for Prisma, chromium for
# PDF/ERD jobs, and tini as PID 1 for clean signal handling in web and workers.
RUN apk update && apk add --no-cache openssl curl chromium tini

# Konfigurera Puppeteer för att använda den Alpine-installerade Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Skapa non-root användare
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Steg 1: Byggmiljö
FROM base AS builder
COPY package*.json ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY packages ./packages
COPY scripts ./scripts

RUN npm ci --legacy-peer-deps --ignore-scripts
RUN mkdir -p /app/docs/architecture && DATABASE_URL=postgresql://localhost:5432/docker_build_dummy npx prisma generate

# Kopiera källkod
COPY . .

# Bygg frontend (Vite)
RUN npm run build

# Steg 2: Produktionsbas (gemensam för alla slutliga images)
FROM base AS production-base
ENV NODE_ENV=production
ARG BUILD_SHA=unknown
ENV BUILD_SHA=${BUILD_SHA}

COPY package*.json ./
COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY packages ./packages
COPY scripts ./scripts

ENV DATABASE_URL=postgresql://localhost:5432/docker_build_dummy

# Local file: dependencies under packages/ must exist before npm ci.
RUN npm ci --include=dev --legacy-peer-deps --ignore-scripts \
    && DATABASE_URL=postgresql://localhost:5432/docker_build_dummy npx --no-install prisma generate \
    && npm prune --omit=dev --legacy-peer-deps \
    && npm cache clean --force

# Kopiera byggartefakter och källkod som behövs i produktion
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/server ./server
COPY --from=builder /app/services ./services
COPY --from=builder /app/src ./src
COPY --from=builder /app/app ./app
COPY --from=builder /app/config ./config
COPY --from=builder /app/types ./types
COPY --from=builder /app/stubs ./stubs
COPY --from=builder /app/*.ts ./
COPY --from=builder /app/scripts ./scripts
COPY scripts/ci/verify-runtime-imports.mjs ./scripts/ci/verify-runtime-imports.mjs

RUN node scripts/ci/verify-runtime-imports.mjs --root /app

# Sätt non-root ägare och byt användare
RUN mkdir -p /app/storage/uploads /app/storage/backups /data/mimers /data/geo_master \
    && chown -R appuser:appgroup /app/storage /data/mimers /data/geo_master
USER appuser

# --- Slutsteg: Webbserver (default) ---
FROM production-base AS web
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]

# --- Slutsteg: Alla separata bakgrundsjobb, inklusive LU signer-isolerade workers ---
FROM production-base AS worker-all
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "worker:all"]

# --- Slutsteg: GDPR Worker ---
FROM production-base AS gdpr-worker
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "server/workers/gdpr-maintenance-worker.ts"]

# --- Slutsteg: Search Indexer Worker ---
FROM production-base AS search-indexer-worker
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "server/workers/search-indexer-worker.ts"]

# --- Slutsteg: Domstol RSS Worker ---
FROM production-base AS domstol-rss-worker
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "server/workers/domstol-rss-worker.ts"]
