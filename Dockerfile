FROM node:22-alpine AS base

# Uppdatera och installera curl och openssl för Prisma
RUN apk update && apk add --no-cache openssl curl

# Skapa non-root användare (används i production-stadiet)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Steg 1: Byggmiljö
FROM base AS builder
COPY package*.json ./
COPY tsconfig.json ./
# Installera alla beroenden (även dev)
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

# Kopiera källkod
COPY . .

# Bygg frontend (Remix)
RUN npm run build
# Bygg backend (tsc) if needed, if it has a separate build script. Otherwise, omit.

# Steg 2: Produktionsmiljö
FROM base AS production
ENV NODE_ENV=production

COPY package*.json ./
# tsx är en runtime-executor för TypeScript-servern och krävs i produktion.
# npm ci installerar alla beroenden inklusive tsx (se package.json dependencies).
RUN npm ci

# Kopiera Prisma och generera klient
COPY prisma ./prisma
RUN npx prisma generate

# Kopiera det byggda från builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/server ./server

# Sätt non-root ägare och byt användare
RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

CMD ["npm", "start"]
