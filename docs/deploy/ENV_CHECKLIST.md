# Miljömiljö-checklista (jämför med `.env.example`)

Använd denna lista när du sätter upp **lokal utveckling**, **staging** eller **produktion**. Alla variabler dokumenteras i detalj i [`.env.example`](../../.env.example).

## Alla miljöer

| Område  | Variabler                                                   | Kommentar                                                                                                           |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| App     | `NODE_ENV`, `PORT`, `LOG_LEVEL`                             | Produktion: `NODE_ENV=production`. Backend lyssnar på `PORT` (t.ex. 8080 i Cloud Run).                              |
| JWT     | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, ev. `JWT_SECRET` | Måste vara starka och unika i skarp drift.                                                                          |
| Databas | `DATABASE_URL`                                              | Postgres med PostGIS för GIS-lager och Prisma. Efter ny databas: `npm run prisma:migrate` och `npm run db:spatial`. |

## AI (Vertex)

| Variabel                                                                                         | Krav                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `VERTEX_PROJECT_ID`                                                                              | GCP-projekt-ID                                |
| `VERTEX_LOCATION`                                                                                | T.ex. `europe-west1`                          |
| `VERTEX_*_MODEL`                                                                                 | Validera modellnamn i GCP                     |
| `GOOGLE_APPLICATION_CREDENTIALS` eller `GOOGLE_APPLICATION_CREDENTIALS_JSON` / workload identity | Auth mot Vertex lokalt respektive i Cloud Run |

## Lantmäteriet

| Variabel                                                                                       | Syfte                                                                        |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `LANTMATERIET_OPEN_SUBSCRIPTION_KEY`                                                           | Avgiftsfria öppna tjänster (OGC, topowebb, m.m.) — registrera i API-portalen |
| `LANTMATERIET_CONSUMER_KEY` + `LANTMATERIET_CONSUMER_SECRET` eller `LANTMATERIET_ACCESS_TOKEN` | Fastighetsuppslag / skyddade API:er                                          |
| `LANTMATERIET_OPEN_MODE`                                                                       | Särskilt kartläge utan full auth — följ dokumentation innan skarp drift      |

## SLU Artdatabanken

| Variabel                                                                                                 | Syfte                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `SLU_API_BASE_URL`                                                                                       | Bas-URL till SLU Artdatabanken API                            |
| `SLU_API_KEY`                                                                                            | Generell fallback-nyckel för SLU                              |
| `SLU_SPECIES_OBS_API_KEY`, `SLU_TAXONOMY_API_KEY`, `SLU_ARTFAKTA_API_KEY`, `SLU_METODKATALOG_API_KEY` | Produktspecifika nycklar när ni vill separera åtkomst per API |
| `SLU_SPECIES_OBS_BASE_PATH`, `SLU_TAXONOMY_BASE_PATH`, `SLU_ARTFAKTA_BASE_PATH`, `SLU_METODKATALOG_BASE_PATH` | Pathsuffix per del-API                                         |

**Placering av SLU-nycklar:**

- **Lokalt:** i `.env` eller `.env.local` som **inte** checkas in.
- **Staging:** i plattformens secret store eller GitHub environment secrets, normalt `STAGING_SLU_API_KEY`.
- **GCP/Cloud Run:** i **Google Secret Manager**, mappade till runtime-env som `SLU_API_KEY` eller motsvarande produktspecifik `SLU_*_API_KEY`.

## BankID och identitet

| Variabel                                                   | Syfte                                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `BANKID_BASE_URL`, certifikat (`BANKID_PFX_PATH` / motsv.) | Riktig BankID                                                                                                    |
| `BANKID_MOCK_MODE`                                         | **Endast utveckling/test** — ska **inte** vara `true` i produktion (server loggar fel vid `NODE_ENV=production`) |

## Myndighetsinlämning

| Variabel                                        | Syfte                                                      |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `AUTHORITY_SUBMIT_ENDPOINT` (+ ev. API-nycklar) | Live inlämning                                             |
| `AUTHORITY_MOCK_MODE`                           | **Endast dev/E2E** — ska **inte** vara `true` i produktion |

## Övriga integrationer (valfritt per produkt)

LIMS, Outlook Graph (`OUTLOOK_*`), Trafikverket och eIDAS QTSP — se tabellen i [`README.md`](../../README.md) och `.env.example`.

## Frontend-bygge (Vite)

Bygget läser `VITE_*`. Exempel:

| Variabel               | Syfte                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`    | Var Vite proxar `/api` mot backend i dev; i produktion betjänas ofta samma origin  |
| `VITE_LOCAL_BASEMAP_*` | Valfri lokal WMS/XYZ-grundkarta (t.ex. egen Topo10-tileserver) — se `.env.example` |

## Verifiering

- `curl`/`GET` mot `/health` efter deploy
- `npm run smoke` mot målmiljö när `BASE_URL` och `DATABASE_URL` är satta
- [production readiness checklist](../qa/production-readiness-checklist.md)
