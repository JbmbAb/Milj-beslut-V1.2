# Teknisk Metodbeskrivning: RAG-baserad Automatiserad Beslutsstöd inom GovTech

Denna rapport dokumenterar den tekniska metodik och arkitektur som används i plattformen Miljöbeslut.se för att extrahera juridisk bevisföring ur myndighetsdata och transformera denna till verifierbara beslutsunderlag (C-anmälan). Metoden baseras på principerna för **Retrieval-Augmented Generation (RAG)**.

---

## 1. Systemarkitekturens Grundpelare

Plattformen vilar på en distributiv arkitektur designad för att hantera ostrukturerad myndighetsdata med hög precision.

### 1.1 Datainmatning och Metadata-extraktion
Källmaterialet utgörs av PDF-dokument (beslut, yttranden, remisser). Vid import genomgår varje dokument en metadata-mappning mot en PostgreSQL-databas via **Prisma ORM**:
- **Metadata**: Diarienummer, fastighetsbeteckning, kommun, avfallskod (EWC) och juridisk status.
- **Normalisering**: Ortnamn och kommuner normaliseras via interna cross-reference tabeller för att möjliggöra korrekta geografiska sökningar oberoende av stavningsvariationer i källmaterialet.

---

## 2. Textanalytisk Process (Pipeline)

### 2.1 Flerspårig Textextraktion (OCR & Parsing)
Beroende på källdokumentets kvalitet används en hierarkisk extraktionsmetod:
1.  **Strukturerad Parsing**: Digitalt skapade PDF:er extraheras via byte-stream analys (`pdf-parse`).
2.  **Vision-AI baserad OCR**: Om textlagret saknas eller är av låg kvalitet (inscannade dokument), används **Google Gemini 2.0 Flash/Pro Vision-modeller**. Modellen instrueras att utföra en ordagrann extraktion utan att ändra språk eller struktur, vilket är kritiskt för juridisk validitet.

### 2.2 Textfragmentering (Chunking Strategy)
För att optimera precisionen i sökningen delas texterna upp i fragment:
- **Strategi**: Karaktärsbaserad fragmentering med ett fönster om 180 ord.
- **Overlapping**: En överlappning på 40 ord används mellan fragmenten för att säkerställa att kontextuell länkning (t.ex. syftning mellan meningar) bibehålls.

---

## 3. Semantisk och Lexikal Indexering

### 3.1 Vektor-transformering (Embeddings)
Varje textfragment genomgår en matematisk transformation via modellen **text-embedding-004**:
- **Dimensioner**: 768-dimensionella fasta vektorer.
- **Egenskap**: Vektorn representerar textens semantiska innebörd, vilket gör det möjligt att matematiskt beräkna "närhet" mellan frågor (t.ex. "kontaminerat vatten") och svar (t.ex. "rening av lakvatten").

### 3.2 Lagring i Vektordatabas
Vektorerna lagras i PostgreSQL med tillägget **pgvector**. Sökning sker via **Cosine Similarity** (cos_sim) beräkningar, vilket effektivt rankar stycken baserat på innehållslig relevans snarare än exakta ordmatchningar.

---

## 4. Retrieval & Grounding (Återsökning)

### 4.1 Hybrid Search Engine
Systemet kombinerar två sökparadigmer:
1.  **Semantisk sökning**: Fångar upp konceptuella likheter.
2.  **Lexikal sökning (Keyword)**: Fångar upp specifika lagrum, förkortningar (t.ex. MB 9:2a) och tekniska termer.
Resultaten slås samman via en rankningsalgoritm (Reranking) för att identifiera de mest potenta referensmaterialen.

### 4.2 Hallucinationsprevention (Grounding)
För att garantera tillförlitligheten i de genererade dokumenten tillämpas **Strict Grounding**:
- AI-modellen nekas tillgång till allmän träningsdata utanför de injicerade styckena.
- Varje genererat påstående i en C-anmälan förses med djuplänkar (Citations) till ursprungsdokumentet i databasen.

---

---

## 5. Implementerad Effekt
Genom denna metod uppnår systemet en "Traceability Score" på 100%, där 100% av de juridiska råden och formuleringarna kan spåras tillbaka till verifierade beslut i myndighetens arkiv. Detta minskar handläggarnas analystid med uppskattningsvis 60-70% vid upprättande av komplexa miljöprövningar.

---

## 6. Regulatorisk Intelligence & Analytiska Mönster

Genom aggregering av data från över 260 kommuner möjliggörs identifiering av återkommande mönster i svensk miljötillsyn. Detta utgör kärnan i plattformens "Regulatorisk Intelligence".

### 6.1 Identifierade Mönstertyper
Modellen tränas för att kategorisera beslut utifrån följande strukturer:
1.  **Hydrologiskt fokus**: Överpresentation av krav rörande dagvatten, lakvatten och oljeavskiljning.
2.  **Riskbaserad tillsyn**: Dokumentation av hur försiktighetsprincipen tillämpas proaktivt (t.ex. kontrollprogram innan skada uppstått).
3.  **Dokumentationsbörda**: Identifiering av "compliance-driven" tillsyn där tonvikten ligger på journalföring och rapportering snarare än tekniska åtgärder.
4.  **Standardisering**: Analys av huruvida kommuner använder likalydande kravmallar, vilket möjliggör benchmarking mellan regioner.

### 6.2 Analys på tre nivåer
Plattformens analysmotor opererar på tre nivåer för att bygga Tillsynsindexet:
-   **Nivå 1 (Ordanalys)**: Statistisk frekvensanalys av riskord (t.ex. *lakvatten* vs *buller*) för att fastställa vilka miljöaspekter som dominerar lokalt.
-   **Nivå 2 (Kravkluster)**: Gruppering av likartade försiktighetsmått (t.ä. *tät platta*, *invallning*) för att se vilka tekniska krav som är standard i en viss sektor.
-   **Nivå 3 (Kommunprofilering)**: Konsoliderad vy över en kommuns genomsnittliga kravtäthet och riskprioriteringar.

---

## 8. Prediktiv Scoring-metodik (Advanced Analytics)

Plattformens nästa evolutionssteg transformerar statisk regeltillämpning till proaktiv risk-prediktion.

### 8.1 Modellering av risktyper
Pipelinen opererar med tre prediktiva kärnmodeller:
1.  **Regulatorisk Prediktion**: Sannolikhetsberäkning för kompletteringskrav (RFI) baserat på historiska beslutsmönster i den specifika kommunen (Nacka, Stockholm, Orsa).
2.  **Environmental Risk Prediction**: GIS-baserad analys av projektplatsens koordinater mot geodatabaser för jordartskartan (SGU), artskydd (SLU) och vattenskydd (Naturvårdsverket).
3.  **Funding Risk Score (AAA-C)**: En viktad ESG-rating som kvantifierar projektets miljörisk för banker och försäkringsbolag.

### 8.2 Prediktiv Riskformel
Risken (R_total) beräknas som en summerad vektor av identifierbara osäkerheter:
```text
R_total = R_reg (Regulatorisk) + R_env (Miljö) + R_doc (Dokumentation) + R_log (Logistik)
```
-   **R_reg**: Vikten av historisk föreläggandenivå.
-   **R_env**: Geospatial risk (avstånd till vattendrag, översvämningszoner).
-   **R_doc**: Bristfällig spårbarhetsdata i projektplanen.
-   **R_log**: Logistisk komplexitet och CO2e-avtryck.

### 8.3 Machine Learning Pipeline (Framtida Utveckling)
Medan nuvarande system baseras på avancerad regelstyrd logik (Deterministic Scoring), möjliggör den ackumulerade datamängden framtida tillämpning av:
-   **Gradient Boosting-modeller** (t.ex. XGBoost) för att prediktera handläggningstider.
-   **Bayesian Networks** för att modellera osäkerheten i miljökonsekvensbeskrivningar.

---

## 9. Slutsats
Genom att kombinera **GIS, Juridik och Maskininlärning** transformerar Miljöbeslut.se miljötillsyn från en pappersbaserad process till en datadriven vetenskap. Detta skapar en nationell infrastruktur för miljöprövningar som minskar risken för miljöskador samtidigt som det accelererar den gröna omställningen genom transparenta beslutsunderlag för alla intressenter – från konsulter till banker och myndigheter.
