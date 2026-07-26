# Systembeskrivning: Miljobeslut.se (Core)

\*Datum: 2026-03---

Detta dokument utgör en komplett arkitektonisk och säkerhetsmässig beskrivning av plattformen Miljobeslut.se, designad för att automatisera, analysera och kvalitetssäkra beslut kring miljöfarlig verksamhet (C-anmälningar m.m.) med hjälp av modern "State of the Art" (SOTA) AI-teknik och deterministiska system.

---

## Framtida Vision: Den Prediktiva Intelligence-Plattformen

Systemet evolverar från ett operativt verktyg till en prediktiv motor för miljöintelligence.

- **Systemarkitektur Blueprint**: Se [system_architecture_blueprint.md](./system_architecture_blueprint.md) för teknisk helhetsyta (AI, GIS, logistik).
- **ESG-integration**: Möjliggör direktkoppling mot banksektorns kreditprocesser för "Grön Finansiering" genom **Compliance Score** och **Risk Rating**.
- **Riskbaserad tillsyn**: Stödjer myndigheter i att allokera resurser där de gör störst miljönytta baserat på analytiska riskmönster.

---

Denna plattform utgör den digitala ryggraden för en effektiv, transparent och hållbar miljöprövningsprocess i Sverige.

---

## 1. Systemarkitektur (High-Level)

För att garantera spårbarhet, säkerhet och transparens (vilket är kritiskt för GovTech, upphandlingar och investerare) är systemet visualiserat i 5 tydliga lager:

```text
                ┌────────────────────────────┐
                │        Frontend            │
                │ React / Remix / Tailwind   │
                │ Figma Integration          │
                └─────────────┬──────────────┘
                              │
                              ▼
                ┌────────────────────────────┐
                │          API Layer         │
                │ Node.js / Express          │
                │ Zod Validation             │
                │ JWT Authentication         │
                └─────────────┬──────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼

┌───────────────┐   ┌──────────────────┐   ┌─────────────────┐
│ Deterministic │   │    AI Engine     │   │ Knowledge Graph │
│ Rule Engine   │   │ Gemini + OpenAI  │   │ PostgreSQL      │
│ TypeScript    │   │ RAG / Embeddings │   │ pgvector        │
└───────────────┘   └──────────────────┘   └─────────────────┘
        │                     │                     │
        └─────────────┬───────┴─────────────┬───────┘
                      ▼                     ▼
            ┌──────────────────────────────────┐
            │       Document Generation        │
            │       C-anmälan / MKB            │
            │       DOCX / PDF export          │
            └──────────────────────────────────┘
```

---

## 2. Neuro-Symbolisk AI (Kärnfilosofi)

Ett extremt viktigt designval är separationen av Symbolisk AI (logik) och Neuronal AI (språk). **AI används aldrig för lagtolkning.**

- **Symbolisk AI (TypeScript Rules):**
  Exempel:
  `IF EWC = 17 05 04 AND volume > 1000 ton THEN C-anmälan`
- **Neuronal AI (LLMs):**
  Används exklusivt för PDF-analys, språkgenerering, identifiera liknande fall och sammanfattningar.

---

## 3. Data Pipeline (Myndighetsdata)

Ingestion-motorn utgör den unika konkurrensfördelen – "PDF → strukturerad lagkunskap":

```text
Outlook
   │
   ▼
VBA Extraction (Raw Desktop Export)
   │
   ▼
Raw Document Storage (.eml, .pdf)
   │
   ▼
Idempotent Pipeline (SHA256 + UPSERT)
   │
   ▼
Document Parsing (OCR / Text Extraction)
   │
   ▼
Embedding Engine (pgvector)
   │
   ▼
Knowledge Graph
```

---

## 4. Kunskapsgrafen (Knowledge Graph)

Databasen mappar myndighetsbeteende, vilket historiskt sett är svårtillgängligt.
Detta gör att AI kan svara: _"Denna kommun kräver ofta oljeavskiljare"_.
Exempel på underliggande datamappning:

- **Kommun: Nacka** `--> kräver -->` **Täckning av avfall** `--> p.g.a risk -->` **Lakvatten**
- **Länsstyrelse** `--> prioriterar -->` **Recipientskydd**

---

## 5. AI Guardrails (Säkerhetsvallar mot hallucination)

Plattformen använder tre tunga lager av säkerhet för att uppfylla kraven inom GovTech:

1.  **Cross-model validation:** Gemini 2.5 Pro genererar analysen -> OpenAI GPT-5.1 verifierar analysen som en "Second Opinion".
2.  **Citationskrav:** AI måste returnera exakta källor `{"citation": "MB 2 kap 3 §", "page": 17, "source": "Naturvårdsverket 2010:1"}`.
3.  **JSON Schema (Zod):** Blockerar hallucinationer genom tvingande datastruktur. Exempel: `riskLevel` får endast vara "low", "medium", eller "high". Annars kraschar anropet innan det når databasen.

---

## 6. Säkerhet & Audit (GovTech Standard)

- **RBAC (Role Based Access):**
  Organisationer är uppdelade i `Admin`, `Consultant`, `Reviewer`, och `Client`.
- **Audit log (Immutable log):**
  Alla beslut loggas. `Timestamp`, `User`, `Action`, `Document`, `Model Version`. Om banker/myndigheter kräver spårbarhet finns ett tydligt beviskedja ("hash chain") över vem och vilken AI som fattade vilket beslut.
- **Data in Rest:** PostgreSQL-databasen har rollbaserad åtkomst och lokala .env-hemligheter isoleras.

---

## 7. Infrastruktur (Produktionsmiljö)

När systemet driftsätts skalas det enligt SOTA Cloud Native principer:

- **Edge:** Cloudflare CDN (Säkerhet och caching).
- **Container:** Docker containers orkestrerade i Kubernetes för Backend/Frontend.
- **Lagring:** Skalbart PostgreSQL cluster (för kunskapsgraf och pgvector).
- **AI Pipeline:** Mångstegsprocess (`User Input -> Rule Engine -> Vector Search -> Relevant Docs -> Gemini Analysis -> Cross Validation -> Structured Output -> Document Generator`).

---

## Bedömning (Investerar- \& VC-perspektiv)

Detta är inte en "AI-app" eller en simpel GPT-wrapper. Det är:
**Data pipeline + Juridisk regelmotor + Knowledge graph + AI analys.**

| Faktor          | Bedömning                                                                                        |
| :-------------- | :----------------------------------------------------------------------------------------------- |
| Teknik          | Mycket stark (Neuro-symbolisk hybrid-AI med cross-model validation)                              |
| Unik data       | Extremt stark (Egen proprietary knowledge graph från 290 kommuner)                               |
| Marknad         | Stor (Alla miljökonsulter, byggbolag och kommuner i Sverige)                                     |
| Differentiering | Hög (Konkurrenter använder generiska chatbot-interface, detta använder tvingande datastrukturer) |
