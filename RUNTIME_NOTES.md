# Runtime-noteringar — komma igång lokalt

Den här guiden visar hur du får Miljöbeslut-stacken att rendera kartlager från
PostGIS i UI:t. Den är skriven för PowerShell på Windows men kommandona fungerar
lika bra i Bash om du byter ut envinjektionen (`$env:` → `export`).

---

## 1. Förutsättningar

| Komponent                | Min. version | Kommentar                           |
| ------------------------ | ------------ | ----------------------------------- |
| Node.js                  | 20+          | `node --version`                    |
| npm                      | 10+          | följer Node 20                      |
| PostgreSQL + PostGIS     | 16 + 3.4     | nativt eller via Docker             |
| `npx tsx` / `dotenv-cli` | senaste      | installeras automatiskt via devDeps |

Om du redan kör en Postgres på `localhost:5432` med PostGIS aktiverat
(t.ex. `Program Files\PostgreSQL\16`) kan du hoppa över Docker-steget.

---

## 2. Databasen

### 2a. Använd lokal Postgres (rekommenderat om den finns)

```powershell
# Verifiera att tjänsten lyssnar
pg_isready -h localhost -p 5432
```

Anslutningssträngen i `.env` ska peka mot rätt host/port:

```env
DATABASE_URL=postgresql://miljobeslut:<password>@localhost:5432/miljobeslut?sslmode=disable
```

### 2b. Eller starta i Docker

```powershell
docker run -d --name miljobeslut-postgis -p 5432:5432 `
  -e POSTGRES_PASSWORD=miljobeslut -e POSTGRES_USER=miljobeslut `
  -e POSTGRES_DB=miljobeslut postgis/postgis:16-3.4

# Vänta ~5s, verifiera
docker exec miljobeslut-postgis pg_isready -U miljobeslut -d miljobeslut
```

### 2c. Schema och spatial-bootstrap

```powershell
# Prisma-migrations
npx dotenv -e .env -e .env.local -- npx prisma migrate deploy

# PostGIS-extensions, schemas och idempotenta SQL-migrations
npx dotenv -e .env -e .env.local -- npx tsx scripts/db/spatial-bootstrap.ts

# Verifiera anslutning + extensions + GIST-index + en testquery mot env.protected_area
npx dotenv -e .env -e .env.local -- npx tsx scripts/smoke/postgis.ts
```

`postgis.ts` ska skriva ut `[OK]` på alla 5 rader. `[WARN]` är acceptabelt om en
tabell inte hunnit fyllas, `[FAIL]` betyder att något måste åtgärdas innan
backenden kan svara på lager-endpoints.

> Datasetet i `Database/`-katalogen (eller en monterad bind-mount) är redan
> populerat med riktig spatial data — det är därför ingen seed behövs i normalt
> bruk. Vill du ha demo-data i en tom databas finns
> `scripts/db/import_all_datasets.py` (kräver GDAL/`ogr2ogr`).

---

## 3. Miljövariabler

`.env.example` är referensfilen för alla server-variabler. För lokal
utveckling används två filer:

| Fil          | Syfte                                                | Spårad i git |
| ------------ | ---------------------------------------------------- | ------------ |
| `.env`       | Server-defaults (DB, JWT, importvägar).              | nej          |
| `.env.local` | Personliga overrides (dev-API-nycklar, BankID-mock). | nej          |

Båda är ignorerade via `.gitignore` (`.env` och `.env.local`-mönster). Skapa
dem från `.env.example` om de saknas:

```powershell
Copy-Item .env.example .env
# och valfritt
Copy-Item .env.example .env.local
```

### Frontend-relaterade variabler

| Variabel                                                    | Effekt                                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `LANTMATERIET_OPEN_SUBSCRIPTION_KEY`                        | Öppnar Lantmäteriet Topo10/Ortofoto. **Saknas** → kartan faller tillbaka på OSM och visar en notis i UI. |
| `VITE_LOCAL_BASEMAP_XYZ_URL` / `VITE_LOCAL_BASEMAP_WMS_URL` | Egen lokal grundkarta (XYZ eller WMS).                                                                   |
| `VITE_LANTMATERIET_OPEN_SUBSCRIPTION_KEY`                   | Override när webbläsaren ska få _annat_ värde än servern (oftast onödigt).                               |

Lantmäteriet-nyckel är **inte** ett blocker — OSM räcker för att kartan ska
visas. Ange den först när du vill ha de svenska topo/ortofoto-lagren.

---

## 4. Backend och frontend

```powershell
# Terminal 1 — backend (Express + WebSocket på :8787)
npm run dev:server

# Terminal 2 — frontend (Vite på :3000, proxar /api → :8787)
npm run dev
```

Öppna http://localhost:3000. Vite-dev-servern proxar alla `/api/*`-anrop till
`http://localhost:8787` (se `vite.config.ts`).

Snabb verifiering från en tredje terminal:

```powershell
curl http://localhost:8787/api/reference/map-layers
curl 'http://localhost:8787/api/layers/nvr?bbox=14.5,60.9,14.8,61.3'
curl 'http://localhost:8787/api/layers/water-protection?bbox=14.5,60.9,14.8,61.3'
curl 'http://localhost:8787/api/layers/property?bbox=14.5,60.9,14.8,61.3'
```

Ett friskt PostGIS-svar har `type: "FeatureCollection"` med en icke-tom
`features[]`. Saknas extern leverantör (NMD-marktäcke, VISS-vatten) levereras
en tom `features[]` med ett `meta.warning`-fält som UI:t visar som gul prick.

---

## 5. Vanliga fallgropar

1. **Kartlagren visas inte trots gröna tester** — kontrollera först att backend
   verkligen lyssnar på `:8787`. `Get-NetTCPConnection -LocalPort 8787 -State Listen`.
   En backend som startade _före_ en kodändring plockar inte upp den.
2. **`401 Missing bearer token`** — du träffar legacy-routen i `secureApi.express.ts`
   istället för `gisRouter`. `gisRouter` måste monteras före `secureApiRouter` i
   `server/createApp.ts`.
3. **`500 An error occurred processing your request`** för ett enskilt lager —
   ofta ett kolumnnamn som inte matchar datalagret (ogr2ogr lämnar t.ex. kvar
   `_ogr_geometry_` istället för `geom`). Verifiera med
   `SELECT column_name FROM information_schema.columns WHERE table_schema=… AND table_name=…`.
4. **WMS-lagren (RAA, NV, SGU WMS) är blanka** — dessa går _inte_ via vår
   backend utan direkt mot externa servrar. Kräver internet och i vissa fall
   en Lantmäteriet-prenumerationsnyckel.
5. **Långsam respons från `climate.flood-risk`** — kontrollera att GIST-indexet
   finns: `npx dotenv -e .env -e .env.local -- npx tsx scripts/db/ensure-gist-flood.ts`.

---

## 6. Stoppa servrarna

```powershell
# Stoppa backenden via PID
$pid8787 = (Get-NetTCPConnection -LocalPort 8787 -State Listen).OwningProcess | Select-Object -First 1
Stop-Process -Id $pid8787 -Force

# Stoppa Vite (port 3000) på samma sätt
$pid3000 = (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess | Select-Object -First 1
Stop-Process -Id $pid3000 -Force
```
