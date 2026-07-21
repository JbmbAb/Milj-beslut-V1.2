# Dataklassning & Modulägarskap (Fas 0)

Detta dokument utgör plattan i vår Enterprise Governance. Det slår fast vem som äger vad, hur data är klassificerad, och hur den får hanteras i systemet – särskilt i relation till AI (Vertex).

## 1. Klassificeringsnivåer (K-Nivåer)

All data i Miljöbeslut.se delas in i tre nivåer av känslighet. Dessa styr retention (gallring), cachning och LLM-promptning.

| Nivå | Namn | Beskrivning | LLM-Access (Vertex) | Caching/Storage | Exempel |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **K1** | Öppen Geodata / Offentlig Info | Publikt tillgänglig data, lagstiftning, öppna API-svar. | **TILLÅTET** (Direkt) | Obegränsad, CDN-bar | SGU Jordarter, Topo 10, HaV Föreskrifter, Bolagsverket basinfo. |
| **K2** | Affärssekretess / Handläggningsdata | Användargenererad data, riskbedömningar som ej är publika, systemlogik. | **TILLÅTET** (Men med RAG-filtrering) | Databas + Säkra S3-hinkar. TTL appliceras. | Dossier-drafts, kundprojekt, internt bolags-API. |
| **K3** | PII & Känslig Info | Personuppgifter, Fastighetsägar-ID, Signaturer, IP-adresser. | **FÖRBJUDET** (Måste hashas/maskeras) | Krypterat i vila, strikt TTL (ex 30 dagar efter stängt ärende). | Personnummer, fastighetsbeteckning (utanför kartvy), BankID-sessioner. |

## 2. Modulägarskap & Datamatris (Single Source of Truth)

För att undvika dubbla sanningar (Source of Truth) och säkerställa att Rättighetskontroll (RBAC/IAM) fungerar, äger specifika moduler specifika databasscheman. **Ingen annan modul får läsa direkt mot dessa scheman utan att gå via modulens API.**

| Domän/Modul | Katalog | PostGIS Schema / Prisma Models | Klassning | Rättighetsägare | Restriktion |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Geodata Pipeline** | `services/geodata/` | `env.*`, `core.lm_*` | K1 | Data Engineer | Endast read-only för andra moduler via Builder. Inga app-skrivningar tillåtna. |
| **Dossier & AI** | `services/dossier/`, `services/orchestrator/` | `public.CaseSnapshot`, AI Prompts | K2 | AI Architect | Får aldrig logga K3 data. Alla anrop till Vertex styrs här. |
| **Identity & IAM** | `services/auth/` | `public.User`, `public.BankIdSession`, `public.Organisation` | K3 | Security Lead | Hård isolering. Tenants kan aldrig korsläsa från varandra. |
| **Core Business** | `components/`, `services/` | `public.Project`, `public.RequirementCase` | K2 | Product Manager | Äger affärslogiken. Måste verifiera Tenant-ID på varje query. |

## 3. Principer för Systemet

1.  **Strict PII Washing (Vertex AI):** All geografisk och kontextuell data som skickas till `VertexDirigentService` ska gå via ett mellanlager (ex. `DossierBuilderService`) som raderar `propertyDesignation` och andra K3-attribut och ersätter dem med anonyma referenser (ex. "Property_1").
2.  **Minsta Privilegium (IAM):** Det GCP Service Account som används för driften av plattformen ska ha exakt de API-rättigheter som krävs för tjänsten och inget mer (ej `Project Owner`).
3.  **Migration-Driven:** Spatiala SQL-förändringar eller Prisma schema-förändringar måste versionshanteras. Ingen direkt-patching i produktionsdatabasen.
