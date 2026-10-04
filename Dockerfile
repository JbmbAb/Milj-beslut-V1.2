# Basimage-lagren är pinnade på node:22-alpines multi-arch-index (Alpine 3.24,
# publicerad 2026-09-23). apk-steget nedan är inte versionspinnat, så base-steget
# är ändå rörligt mellan två byggen av samma commit.
# Byt digest medvetet: docker buildx imagetools inspect node:22-alpine
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
# tsconfig.json följer med för tsconfig-paths: fem @miljobeslut-specifierare
# (mps-application, mps-capability, mps-knowledge-corpus, mps-knowledge-index,
# mps-legal-corpus) finns inte som node_modules-länkar. Ingen av de fem processerna
# (web och de fyra LU-arbetarna) når dem; två (mps-knowledge-corpus,
# mps-legal-corpus) nås bara av ops-skript (scripts/db/legal-corpus-*.ts,
# scripts/knowledge/run-corpus-expansion.ts) via server/modules/legal/*. tsx letar
# annars upp tsconfig.json uppåt från arbetskatalogen och hittar /app/tsconfig.json
# från varje cwd under /app; variabeln pekar bara ut filen uttryckligen.
ENV NODE_ENV=production \
    TSX_TSCONFIG_PATH=/app/tsconfig.json

# Runtime får byggstegets egna bytes. node_modules/@miljobeslut/* är länkar
# till ../../packages/*, så packages/ måste följa med, och tsconfig.json bär
# de tsconfig-paths som tsx löser @miljobeslut-importer med. server/ importerar
# också services/, scripts/ och rotens *.ts (db.server.ts, constants.ts, types.ts).
# Allt levereras root:root (ingen --chown) och /app chownas inte (W-U42C IN-5,
# ägarbeslut Ä1): processanvändaren appuser kan läsa den levererade runtimen men
# inte ändra, skapa, döpa om eller ta bort något i den efter startmätningen.
# package-lock.json tas från byggkontexten (git archive <SHA>: commitens bytes),
# inte från byggsteget: npm prune --omit=dev skriver om låsfilen (omit-beroenden
# skrivs tillbaka med andra flaggor), och release-identiteten
# (ProductReleaseAuthority v3: package.json, package-lock.json, server/index.ts
# och source_digest) mäts över filerna i imagen vid varje processstart.
# package.json och tsconfig.json rörs inte av bygget.
COPY package-lock.json ./
COPY --from=builder /app/package.json /app/tsconfig.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/services ./services
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/app ./app
COPY --from=builder /app/config ./config
COPY --from=builder /app/types ./types
COPY --from=builder /app/stubs ./stubs
COPY --from=builder /app/*.ts ./

# Den enda skrivbara katalogen (W-U42C IN-5): webbprocessen skriver uppladdningar,
# utkast, temp- och ingest-filer under storage/ i sin arbetskatalog
# (documentUploadService, documentGenerator, sewage.routes, gis.routes,
# importPathService). Den skapas tom och ägs av appuser; den är data, inte kod,
# mäts därför inte (DELIVERED_ROOT_EXCLUSIONS i scripts/release/buildIdentityDigest.mjs)
# och ingen COPY levererar dit.
RUN mkdir /app/storage && chown appuser:appgroup /app/storage

# Releaseidentiteten (product-release-v3) MÄTS här, efter sista COPY, över
# exakt den /app imagen levererar (server/, src/, packages/, prisma/, dist/ och
# de tre V1/V2-filerna, med package-lock.json ur kontexten) och skrivs till
# release-identity.json, som själv inte ingår i digesten. Samma algoritm som
# varje process använder vid start (scripts/release/buildIdentityDigest.mjs);
# en avvikelse vid start är REJECT_PRODUCT_RELEASE_BUILD_MISMATCH. Inte i
# builder: dess träd har components/ och den låsfil npm prune skrev om, och
# ingen av dem levereras (W-U42B, R-U402-14). Dockerfile/.dockerignore/
# deploy/ och .git kopieras inte hit, så commit, träd och kompositionshash
# lämnas in av deploy/onprem/build-image.sh som byggargument. Argumenten har
# ingen default: ett bygge utan dem misslyckas i stället för att gissa en
# identitet. Inget steg efter detta får leverera eller ändra filer i /app.
ARG SOURCE_COMMIT_SHA
ARG SOURCE_TREE_SHA
ARG COMPOSITION_MANIFEST_SHA256
RUN node scripts/release/write-build-identity.mjs --source-commit "$SOURCE_COMMIT_SHA" --source-tree "$SOURCE_TREE_SHA" --composition-manifest-sha256 "$COMPOSITION_MANIFEST_SHA256"

USER appuser

# --- Slutsteg: Webbserver (default) ---
# Cloud Run sätter PORT=8080; lokalt dev använder PORT=8787 via .env
# LU-arbetarna körs från samma image med ett annat kommando, så att alla
# processer i en kandidat har en och samma app-digest:
#   node --import tsx server/workers/lu-project-context-bootstrap-worker.ts
#   node --import tsx server/workers/lu-execution-identity-v3-worker.ts
#   node --import tsx server/workers/lu-viewer-capability-worker.ts
#   node --import tsx server/workers/lu-geometry-supersession-worker.ts
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
