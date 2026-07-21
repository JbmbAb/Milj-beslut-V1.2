# Migration readiness (kodifierad)

Den här sidan finns för att ni ska kunna säga “✅” med länkar till _exakt_ kod.

## ✅ Domän

- **Case Spine definierad**
  - `server/domain/caseSpine.ts`
- **Requirement-modell klar**
  - `prisma/schema.prisma` (Requirement\* modeller)
  - `server/domain/requirementsModel.ts` (runtime-schema)
  - `server/services/checkListRagService.ts` (validerad parsing)
- **Audit-struktur klar**
  - `prisma/schema.prisma` (AuditTrail)
  - `server/security/auditTrail.ts` (hash-chain append + export + verify)
  - `server/services/auditVerificationScheduler.ts` (periodisk verifiering)

## ✅ Arkitektur

- **Systemgränser definierade**
  - GIS: `server/routes/gis.routes.ts`, `server/datasources/mapLayerCatalog.ts`, `components/MapView.tsx`
  - AI: `server/services/vertexAiService.ts`, `server/services/coreAiGatewayService.ts`, `server/services/ragSearchService.ts`
- **GIS separerad**
  - Modulgräns: `server/modules/gis/index.ts` + router + katalog + klientkomponent.
- **AI separerad**
  - Modul/policy: `server/modules/ai/policy.ts` + gateway via Vertex (`vertexAiService.ts`) + RAG-service (`ragSearchService.ts`).

## ✅ Data

- **Vad som migreras är bestämt**
  - `server/migration/scope.ts` + Prisma-managed domänmodeller (allt utom `env.*`) + SQL-managed PostGIS-tabeller enligt header i `prisma/schema.prisma`.
- **Datamodell stabil**
  - Prisma schema + råa PostGIS-migrationer i `prisma/spatial/*` (se även `SpatialMigration`).

## ✅ Integrationer

- **Alla externa beroenden kartlagda**
  - `server/datasources/integrationRegistry.ts`
- **fallback-strategier finns**
  - Fastighet: PostGIS → open-ogc → OAuth (`server/services/lantmaterietService.ts`, `server/routes/property.routes.ts`)
  - Basemap: OSM default + subscription-key i klient (`components/MapView.tsx`)

## ✅ AI

- **RAG-strategi definierad**
  - `server/services/ragSearchService.ts` (embed → chunks → graph → answer + sources)
- **rollfördelning AI vs system klar**
  - Policy: `server/modules/ai/policy.ts`
  - Systemet validerar/normaliserar AI-utdata där den används (ex. `coreAiGatewayService.ts`, `requirementsModel.ts`).

## Statusendpoint

- `GET /api/admin/migration/readiness` (Admin) returnerar en maskinläsbar rapport.
