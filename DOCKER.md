# ðŸ³ Docker & Supabase â€“ Startguide

## Alternativ 1: Lokal PostgreSQL med Docker

### FÃ¶rutsÃ¤ttningar

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installerat och igÃ¥ng

### Steg 1 â€“ Starta databasen

```bash
docker-compose up db -d
```

PostgreSQL startar pÃ¥ `localhost:5432` med:

- **DB:** `miljobeslut`
- **AnvÃ¤ndare:** `miljobeslut`
  0- **Lösenord:** `miljobeslut`

> Extensions `postgis`, `vector`, `pg_trgm` och `unaccent` installeras automatiskt via `docker/postgres-init/02-extensions-and-schemas.sql`.

### Steg 2 â€“ KÃ¶r Prisma-migrationer

```bash
npx prisma migrate deploy
```

Eller vid ny migration:

```bash
npx prisma migrate dev --name <beskrivning>
```

### Steg 3 â€“ Starta applikationen

```bash
npm run dev          # Frontend (Vite, port 5173)
npm run dev:server   # Backend (Express, port 8787)
```

Alternativt â€“ kÃ¶r hela stacken i Docker:

```bash
docker-compose up --build
```

---

## Alternativ 2: Supabase Cloud

### FÃ¶rutsÃ¤ttningar

- Konto pÃ¥ [supabase.com](https://supabase.com)
- Projekt skapat i Supabase Dashboard

### Steg 1 â€“ Aktivera Extensions i Supabase

GÃ¥ till: **Database â†’ Extensions** och aktivera:

- âœ… `postgis`
- âœ… `vector` (pgvector)
- âœ… `pg_trgm`
- âœ… `unaccent`

### Steg 2 â€“ HÃ¤mta Connection String

**Dashboard â†’ Project Settings â†’ Database â†’ Connection string â†’ URI**

Kopiera **Transaction Pooler** (port 6543) fÃ¶r applikationen.
Kopiera **Session Mode** (port 5432) fÃ¶r Prisma-migrationer.

### Steg 3 â€“ Konfigurera .env

```bash
# LÃ¤gg in Supabase-credentials i .env
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-eu-north-1.pooler.supabase.com:6543/postgres
```

> Se `.env.supabase` fÃ¶r komplett mall.

### Steg 4 â€“ KÃ¶r migrationer mot Supabase

```bash
# SÃ¤tt direktanslutning (Session Mode) fÃ¶r migrationer
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@...supabase.com:5432/postgres \
  npx prisma migrate deploy
```

### Steg 5 â€“ KÃ¶r SGU-spatialmigrationer

```bash
node run_migration.js
```

Eller:

```sql
-- KÃ¶r manuellt i Supabase SQL Editor:
-- prisma/spatial/001_env_spatial_tables.sql
```

---

## Alternativ 3: Supabase Lokal (CLI)

```bash
# Installera Supabase CLI
npm install -g supabase

# Logga in
supabase login

# Starta lokal Supabase (PostgreSQL + Studio + Auth + Storage)
supabase start

# Database URL visas i terminalen:
# postgresql://postgres:postgres@localhost:54322/postgres
```

---

## Vanliga kommandon

| Kommando                    | Beskrivning                             |
| --------------------------- | --------------------------------------- |
| `docker-compose up db -d`   | Starta bara databasen                   |
| `docker-compose up --build` | Bygg och starta hela stacken            |
| `docker-compose down`       | StÃ¤ng ner containrar                   |
| `docker-compose down -v`    | StÃ¤ng ner och **radera volumes**       |
| `npx prisma studio`         | Ã–ppna Prisma Studio (DB-visualisering) |
| `npx prisma migrate dev`    | KÃ¶r/skapa migrationer lokalt           |

---

## Arkitektur

```
.env            â†’ Lokal Docker-konfiguration
.env.supabase   â†’ Supabase Cloud (mall)
.env.test       â†’ TestmiljÃ¶ (Vitest)
.env.example    â†’ Komplett dokument fÃ¶r alla variabler
```
