# IAM, Secrets & Multi-Tenancy (Fas 1)

Detta dokument beskriver plattformens säkerhetsperimeter i Google Cloud Platform (GCP) samt hur vi säkerställer stenhård data-isolering (multi-tenancy) för olika organisationer/kunder.

## 1. Multi-Tenancy (Data-Isolering)

Varje kund (T.ex. "Miljökonsult AB" eller "Kommunens Miljökontor") är en isolerad Tenant.
All kund-data (`K2` och `K3` enligt Datamatrisen) tillhör en specifik `Organization`.

### Principen för "Hårda queries"
Ingen Prisma-fråga eller SQL-query får någonsin skrivas utan ett `organizationId` i `where`-klausulen (om det inte gäller K1 Öppen Geodata).

**Förbjudet Mänster (Pannkaka):**
\`\`\`typescript
// LÄCKAGE-RISK: Returnerar allas ärenden om vi glömmer filtrera!
const cases = await prisma.case.findMany(); 
\`\`\`

**Gyllene Regeln (Enterprise Pattern):**
\`\`\`typescript
// SÄKERT: Returnerar garanterat bara rätt Tenants data.
const cases = await prisma.case.findMany({
    where: { organizationId: currentSession.orgId }
});
\`\`\`

*Framtida arkitekturbeslut: Vi bör utvärdera RLS (Row Level Security) i PostgreSQL för att driva in Tenancy-filtreringen direkt i databasmotorn.*

## 2. GCP IAM & Miljöer

Vi tillämpar "Least Privilege" och separation of duties.

| Miljö | Syfte | IAM / Service Account (SA) |
| :--- | :--- | :--- |
| **Local (Dev)** | Utveckling på egen maskin | Utvecklarens personliga `gcloud auth application-default login`. |
| **Staging** | CI/CD & QA före produktion | `sa-miljobeslut-staging@project.iam.gserviceaccount.com` (Endast läs/skriv mot Staging-DB, Vertex AI i Staging-region). |
| **Production** | Skarp drift | `sa-miljobeslut-prod@project.iam.gserviceaccount.com` (Endast åtkomst till Prod-resurser). Inga mänskliga "Owner" roller aktiva. |

## 3. Secret Manager (Inga nycklar i koden!)

Inga `.env` filer innehållande riktiga lösenord eller API-nycklar (som t.ex. `GEMINI_API_KEY`) får någonsin pushas till repot.
I produktion laddas allting från **Google Secret Manager**.

Följande hemligheter är under "Strict Rotation":
1. `DATABASE_URL` (Lösenordet roteras årligen).
2. `LANTMATERIET_API_KEY` / `mTLS Certifikat` (Måste spåras noggrant).
3. `GEMINI_API_KEY` / Service Account Json (Endast åtkomst för Vertex SA).

## 4. Region & Data Residency (EU)

Eftersom vi hanterar K3 (GDPR) data, garanteras data residency:
- **Databas (Cloud SQL / PostGIS):** Ligger uteslutande i `europe-west1` (Belgien) eller `europe-north1` (Finland).
- **Vertex AI (Gemini):** Prompt-routing måste ställas in på Europeiska regioner. Vi "optar ur" (Opt-out) all form av träningsdata till Google via Vertex Enterprise avtalet.
- **Loggar (Cloud Logging):** Samma EU-regionskrav som ovan.

---
*Detta dokument är levande och uppdateras vid varje större infrastrukturförändring.*
