# Lantmäteriet — skörd → PostGIS (inte UI-runtime)

Miljöbeslut följer **Mimers Brunn (offline-first)**. Lantmäteriets API används för
**harvest/import** till Master Archive och PostGIS — **inte** som driftberoende för
hubbens karta, fastighetssök eller logistik-kartflöde.

UI-runtime pratar endast med:

- `POST /api/property/lookup` → lokal PostGIS (`core.property_unit`)
- `/api/layers/property`, `/api/tiles/...` → lokala lager/tiles
- OSM eller `VITE_LOCAL_BASEMAP_*` som basemap

Attribution i UI: *data ursprungligen från Lantmäteriet* (CC-BY) där det är relevant.

## UI = PostGIS only

| Inställning | Betydelse |
| ----------- | --------- |
| `PROPERTY_LOOKUP_MODE=postgis` (default) | Endast lokal DB |
| `PROPERTY_LOOKUP_MODE=hybrid` | Alias för postgis |
| `PROPERTY_LOOKUP_MODE=live` / `api` | **Avvisas** (503) — live LM disabled |

Hubben behöver **ingen** `LANTMATERIET_OPEN_SUBSCRIPTION_KEY` och ingen OAuth-nyckel
för normal drift. Vite injicerar **inte** LM-nycklar till webbläsaren.

## Harvest / import (server only)

Prenumerationsnyckel och OAuth behövs när ni **skördar** öppna produkter eller
betalda API:er till arkivet (`scripts/import/*`). En nyckel räcker oftast för
avgiftsfria OGC + WMTS/WMS-produkter.

```bash
# Endast för import/harvest — inte för UI
LANTMATERIET_OPEN_SUBSCRIPTION_KEY=din-prenumerationsnyckel
# (valfria endpoint-overrides — se .env.example)
```

| Produkt                     | Format           | Nyckel? | Typisk användning      |
| --------------------------- | ---------------- | ------- | ---------------------- |
| Fastighetsindelning (öppen) | OGC API Features | Ja      | Skörd → PostGIS        |
| Belägenhetsadress           | OGC API Features | Ja      | Skörd                  |
| Ortnamn / admin. indelning  | OGC API Features | Ja      | Skörd                  |
| Topowebb / Ortofoto         | WMTS / WMS       | Ja      | Skörd / lokal basemap  |
| Höjdmodell + laserdata      | Atom / FTP       | Nej     | Bulk till arkiv        |

Admin-endpoints för katalog/ping (`/api/datasources/lantmateriet/open/*`) och
`POST /api/admin/lantmateriet/test` är kvar för **import-/ops-diagnostik**, inte
som krav för hub-UI. Systemanalysen i admin pingar PostGIS i stället.

## Smoketest (lokal UI)

```bash
# PostGIS + API
npm run dev:server
npm run dev
# Hub → Logistik / Fastighetsanalys → sök beteckning
# DevTools: ingen trafik till *.lantmateriet.se
```

Direkt LM-curl är endast relevant vid harvest-felsökning, inte för UI DoD.

## Licens

Öppna data från Lantmäteriet är CC-BY — ange attribution "© Lantmäteriet" /
"data ursprungligen från Lantmäteriet" vid visning av härledd lokal data.
