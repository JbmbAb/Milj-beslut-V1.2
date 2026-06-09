FROM node:22-alpine AS base

# Uppdatera och installera curl och openssl för Prisma
RUN apk update && apk add --no-cache openssl curl

# Skapa non-root användare
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Steg 1: Byggmiljö
FROM base AS builder
COPY package*.json ./
COPY tsconfig.json ./
# Installera alla beroenden
RUN npm ci --legacy-peer-deps

COPY prisma ./prisma
RUN mkdir -p /app/docs/architecture && DATABASE_URL=postgresql://localhost npx prisma generate

# Kopiera källkod
COPY . .

# Bygg frontend (Vite)
RUN npm run build

# Steg 2: Produktionsbas (gemensam för alla slutliga images)
FROM base AS production-base
ENV NODE_ENV=production

COPY package*.json ./
# Installera endast produktionsberoenden
RUN npm ci --omit=dev --legacy-peer-deps

# Kopiera byggartefakter och källkod som behövs i produktion
COPY prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/app ./app
COPY --from=builder /app/config ./config
COPY --from=builder /app/types ./types
COPY --from=builder /app/stubs ./stubs
COPY --from=builder /app/*.ts ./

# Sätt non-root ägare och byt användare
RUN chown -R appuser:appgroup /app
USER appuser

# --- Slutsteg: Webbserver (default) ---
FROM production-base AS web
EXPOSE 8787
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
