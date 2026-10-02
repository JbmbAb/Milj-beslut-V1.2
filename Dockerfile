# Basimagen är pinnad på sitt multi-arch-index (node:22-alpine, Alpine 3.24,
# publicerad 2026-09-23). Två byggen av samma commit får då samma bas.
# Byt medvetet: docker buildx imagetools inspect node:22-alpine
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS base

# Uppdatera och installera curl och openssl för Prisma, plus chromium för ERD-generatorn
RUN apk update && apk add --no-cache openssl curl chromium

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
# package.json beror på 21 file:packages/*-paket och låsfilen länkar 29;
# npm ci kan bara länka dem om packages/ redan finns i bygget.
COPY packages ./packages
# Installera alla beroenden. --ignore-scripts: rotens postinstall behöver
# scripts/ och prisma/, som inte finns i bygget ännu. Den körs nedan.
RUN npm ci --legacy-peer-deps --ignore-scripts

# Kopiera källkod
COPY . .

# Rotens postinstall (prisma generate + Cesium-assets), nu när källorna finns.
# Samma skript som package.json pekar ut, ingen egen variant.
RUN npm run postinstall

# Bygg frontend (Vite)
RUN npm run build

# Ta bort devDependencies på plats. Runtime-steget kopierar exakt detta
# node_modules, inklusive file:-länkarna till packages/, i stället för att
# köra en andra npm ci utan packages/.
RUN npm prune --omit=dev --legacy-peer-deps --ignore-scripts

# Steg 2: Produktionsbas (gemensam för alla slutliga images)
FROM base AS production-base
ENV NODE_ENV=production

# Runtime får byggstegets egna bytes. node_modules/@miljobeslut/* är länkar
# till ../../packages/*, så packages/ måste följa med, och tsconfig.json bär
# de tsconfig-paths som tsx löser @miljobeslut-importer med. server/ importerar
# också services/, scripts/ och rotens *.ts (db.server.ts, constants.ts, types.ts).
# --chown i stället för chown -R: en rekursiv chown kopierar hela node_modules
# till ett nytt lager.
RUN chown appuser:appgroup /app
COPY --from=builder --chown=appuser:appgroup /app/package.json /app/package-lock.json /app/tsconfig.json ./
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/packages ./packages
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/server ./server
COPY --from=builder --chown=appuser:appgroup /app/src ./src
COPY --from=builder --chown=appuser:appgroup /app/services ./services
COPY --from=builder --chown=appuser:appgroup /app/scripts ./scripts
COPY --from=builder --chown=appuser:appgroup /app/app ./app
COPY --from=builder --chown=appuser:appgroup /app/config ./config
COPY --from=builder --chown=appuser:appgroup /app/types ./types
COPY --from=builder --chown=appuser:appgroup /app/stubs ./stubs
COPY --from=builder --chown=appuser:appgroup /app/*.ts ./

USER appuser

# --- Slutsteg: Webbserver (default) ---
# Cloud Run sätter PORT=8080; lokalt dev använder PORT=8787 via .env
FROM production-base AS web
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]

# --- Slutsteg: GDPR Worker ---
FROM production-base AS gdpr-worker
CMD ["npx", "tsx", "server/workers/gdpr-maintenance-worker.ts"]

# --- Slutsteg: Search Indexer Worker ---
FROM production-base AS search-indexer-worker
CMD ["npx", "tsx", "server/workers/search-indexer-worker.ts"]

# --- Slutsteg: Domstol RSS Worker ---
FROM production-base AS domstol-rss-worker
CMD ["npx", "tsx", "server/workers/domstol-rss-worker.ts"]
