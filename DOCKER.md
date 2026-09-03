# 🐳 Docker & Supabase – Startguide

## Alternativ 1: Lokal PostgreSQL med Docker

### Förutsättningar

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installerat och igång

### Steg 1 – Starta databasen

```bash
docker-compose up db -d
```

PostgreSQL startar på `localhost:5432` med:

- **DB:** `miljobeslut`
- **Användare:** `miljobeslut`
  0- **Lösenord:** `miljobeslut`

> Extensions `postgis`, `vector`, `pg_trgm` och `unaccent` installeras automatiskt via `docker/postgres-init/02-extensions-and-schemas.sql`.

### Steg 2 – Kör Prisma-migrationer

```bash
npx prisma migrate deploy
```

Eller vid ny migration:

```bash
npx prisma migrate dev --name <beskrivning>
```

### Steg 3 – Starta applikationen

```bash
npm run dev          # Frontend (Vite, port 5173)
npm run dev:server   # Backend (Express, port 8787)
```

Alternativt – kör hela stacken i Docker:

```bash
docker-compose up --build
```

---

## Alternativ 2: Supabase Cloud

### Förutsättningar

- Konto på [supabase.com](https://supabase.com)
- Projekt skapat i Supabase Dashboard

### Steg 1 – Aktivera Extensions i Supabase

Gå till: **Database → Extensions** och aktivera:

- ✅ `postgis`
- ✅ `vector` (pgvector)
- ✅ `pg_trgm`
- ✅ `unaccent`

### Steg 2 – Hämta Connection String

**Dashboard → Project Settings → Database → Connection string → URI**

Kopiera **Transaction Pooler** (port 6543) för applikationen.
Kopiera **Session Mode** (port 5432) för Prisma-migrationer.

### Steg 3 – Konfigurera .env

```bash
# Lägg in Supabase-credentials i .env
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-eu-north-1.pooler.supabase.com:6543/postgres
```

> Se `.env.supabase` för komplett mall.

### Steg 4 – Kör migrationer mot Supabase

```bash
# Sätt direktanslutning (Session Mode) för migrationer
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@...supabase.com:5432/postgres \
  npx prisma migrate deploy
```

### Steg 5 – Kör SGU-spatialmigrationer

```bash
node run_migration.js
```

Eller:

```sql
-- Kör manuellt i Supabase SQL Editor:
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
| `docker-compose down`       | Stäng ner containrar                   |
| `docker-compose down -v`    | Stäng ner och **radera volumes**       |
| `npx prisma studio`         | Öppna Prisma Studio (DB-visualisering) |
| `npx prisma migrate dev`    | Kör/skapa migrationer lokalt           |

---

## Arkitektur

```
.env            → Lokal Docker-konfiguration
.env.supabase   → Supabase Cloud (mall)
.env.test       → Testmiljö (Vitest)
.env.example    → Komplett dokument för alla variabler
```
