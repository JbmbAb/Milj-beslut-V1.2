# Dataklassificering och Sekretess: Vertex AI & GCP

_Dokument för Data Privacy Framework, SCC och AI-kompatibilitet inom Miljöbeslut.se_

Detta dokument kartlägger hur olika datakällor och API:er hanteras inom plattformen, med särskilt fokus på **personuppgifter (PII)** och hur de interagerar med Google Vertex AI ("Dirigenten"), SCC (Standard Contractual Clauses) och DPA (Data Processing Agreements).

---

## 1. Kartläggning av Datakällor & API:er

Nedanstående matris utgör basen för vår **DPIA (Data Protection Impact Assessment)** gällande Vertex AI och visar exakt vilka data som tillåts i prompter.

| Datakälla / API                      | Innehåll                                                                | Innehåller PII?   | Tillåts i Vertex-prompt?                           | Var/hur lagras datan?           | Kräver Cloud NAT / IP Whitelist? | Nycklar i Secret Manager? |
| :----------------------------------- | :---------------------------------------------------------------------- | :---------------- | :------------------------------------------------- | :------------------------------ | :------------------------------- | :------------------------ |
| **SGU Geodata (PostGIS)**            | Jordarter, Berggrund, Grundvatten, Brunnar (geometri, raster, vektorer) | **Nej**           | **Ja** (för kontext och analys)                    | `Cloud SQL (PostGIS)` / `GCS`   | Nej (Intern GCP)                 | Ja (DB-creds)             |
| **Lantmäteriet (Topografi/WMS)**     | Kartbilder, höjddata, allmänna gränser (utan ägar-metadata)             | **Nej**           | **Ja** (visuell analys / metadata)                 | Intern Cache (`GCS`)            | Ja (för utgående API-anrop)      | Ja (API-nycklar)          |
| **NMD / Marktäcke (LULC)**           | Marktäckesklasser (Skog, Vatten, Bebyggelse etc.)                       | **Nej**           | **Ja**                                             | `Cloud SQL (PostGIS)`           | Nej (Intern pipeline)            | Ja (DB-creds)             |
| **Lantmäteriet: Fastighetsregister** | Ägarinformation, Lagfarter, Personnummer, Privata Adresser              | **JA (Kritiskt)** | **NEJ** (Enbart Pseudonym / Fastighets-ID tillåts) | `Cloud SQL` (Krypterad) / Minne | Ja (mTLS / Vitlistad IP via NAT) | Ja (mTLS cert / PFX)      |
| **VISS / SMHI (Hydrografi)**         | Vattenförekomster, Flöden, Miljökvalitetsnormer                         | **Nej**           | **Ja**                                             | `Cloud SQL` / Cache             | Ja (API-anrop)                   | Ja (API-nycklar)          |
| **Boverket API**                     | Digitala författningar (PBL, BBR), byggregler                           | **Nej**           | **Ja** (För juridisk kontext)                      | Extern / API-Cache              | Ja (API-anrop)                   | Ja (API-nycklar)          |
| **Naturvårdsverket/Länsstyrelsen**   | Skyddad natur, Natura 2000, riksintressen, förorenade områden (EBH)     | **Nej**           | **Ja**                                             | `Cloud SQL` / Extern WFS        | Ja (API-anrop)                   | Ja (API-nycklar)          |

---

## 2. PII och "Dirigenten" (Vertex AI)

För att undvika att personuppgifter "promptas in" av misstag i Vertex AI används en strukturerad och restriktiv arkitektur för vår "Dirigent":

1. **End-to-End Klassificering:** Tjänster som returnerar data (t.ex. en geodata-tool) måste alltid tagga sin respons (ex. `data_class: "open_geometry"` vs `data_class: "contains_pii"`).
2. **Filtrering innan Prompt:** Dirigenten tar emot ren JSON där alla fält som inte är strikt nödvändiga för uppgiften (ex. namn, personnummer, exakta okrypterade fastighetsbeteckningar om de kan kopplas till individ) tvättas bort eller pseudonymiseras till ett internt ID (`yt-ID`).
3. **Ingen ägarspårning i LLM:** Vertex AI får endast analysera den _fysiska platsen_ (koordinater, marktäcke, jordart), inte _vem_ som äger den. Sammanfogning av LLM-analys och personuppgifter sker först i presentationen (Frontend/PDF-generering), utanför AI-modellen.

---

## 3. Legala Aspekter och Regelefterlevnad

- **DPF / SCC & Dataplacering:** Vertex AI (och tillhörande loggar) körs uteslutande i de EU-regioner som konfigurerats (ex. `europe-west1`). Detta är nödvändigt för att uppfylla kraven vid offentlig upphandling (kommuner).
- **DPIA (Data Protection Impact Assessment):** En formell DPIA måste uppdateras innan Fastighetsregistret ansluts live. Detta dokumenterar ändamålet, den rättsliga grunden, proportionaliteten och maskningsåtgärderna.
- **Loggning:** All loggning av Vertex AI-prompter och svar (via Cloud Logging) måste vara PII-fri. Om vi bygger egna debug-loggar tillämpas strikt maskning och kort TTL (Time-To-Live).
- **Underbiträden & eSam:** För att leva upp till eSams riktlinjer och myndighetskrav räcker det inte med att Google har DPA på plats; vår arkitektur måste visa att kunden alltid behåller suveränitet över sin data.
- **Assured Workloads:** För särskilt känsliga kunder (kommuner/myndigheter) kan GCP Assured Workloads aktiveras för att tvinga fram dataresidens i EU och krypteringsnycklar hanterade lokalt (CMEK), men det ersätter inte behovet av grundläggande maskning i koden.
- **Licenser för Geodata:** Geodata från SGU, Lantmäteriet och Naturvårdsverket cachas och lagras enligt respektive myndighets licensavtal (ofta CC0 eller Open Data). Derivat och AI-sammanfattningar får visas i slutkundens rapport.

---

_Detta dokument validerar att miljöbeslut-plattformen konceptuellt separerar öppna geodata från känsliga personuppgifter före integrering med Vertex AI._
