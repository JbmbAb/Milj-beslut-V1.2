# Projektinstruktioner: Mimer Platform Recovery

Den här filen innehåller arkitektoniska beslut, bevisade plattformsförmågor och konventioner som är specifika för detta projekt.

## 1. Officiellt namn: Mimer Engine

Plattformens kärna och dess exekverings- och verifieringsmotor heter officiellt **Mimer** (eller **Mimer Replay & Execution Engine**). All design, kodkommentarer och framtida dokumentation ska referera till motorn med detta namn.

---

## 2. Plattformsförmågor (Proven Capabilities)

Mimer-plattformen har framgångsrikt bevisat följande tekniska och kryptografiska förmågor i strikta testmiljöer:

### 2.1 Deterministisk exekvering & Replay-verifiering (Replay Engine)
- **Kryptografiskt verifierbar replay:** Möjlighet att köra godtyckliga DAG-baserade pipelines (t.ex. PFAS-analyser) och bevisa att körningar är identiska genom att matcha exekveringsidentitet, exekveringsplan, beroendegraf, indata-hashar och det deterministiska fröet (`deterministic_seed`).
- **Detektering av manipulering (Tamper Detection):** Strikt profilre-verifiering upptäcker omedelbart avvikelser i ordning, miljö, indata, prompter eller utdata med 100 % noggrannhet.

### 2.2 Oförvanskbar datalagring (EvolutionLedger & CAS)
- **CAS (Content-Addressable Storage):** Garanterar oförvanskbarhet genom adressering av filer med unika SHA-256 hashar efter kanonisk serialisering (RFC8785).
- **Säker loggkedja (EvolutionLedger):** Alla befordringar (promotions) registreras i en append-only kedja med kryptografiskt länkade hash-kedjor och UUIDv7-tidsstämplar.

### 2.3 Suveränitet och Katastrofåterställning (Disaster Recovery & Sovereign DoD)
- **Kallstartsåterställning (Cold-Start Replay):** Fullständig återuppbyggnad av systemet (rekonstituering av korrekta hashar) från enbart det fysiska CAS-arkivet och händelseloggen.
- **Tredjepartsrevisioner (Independent Audit):** Inbyggt stöd för att paketera revisions-bundles (`npm run mimers:audit-bundle`) och verifiera dem fristående.
- **Failover utan Single Point of Failure:** Verifierad synk och robust failover på distribuerade filsystem (NFSv4) som bevisat i hermetiska labs.

### 2.4 Robust datainhämtning (Mimers Brunn Policy)
- **Download-First:** Alla geodataset skördas, versioneras och arkiveras fysiskt i Master-arkivet med checksums (SHA-256) innan import sker till PostGIS för att skydda mot extern dataförlust eller radering.

---

## 3. Namngivningspolicy för AI-Agenter (Fornnordisk taxonomi)

För att bevara plattformens identitet och förankra våra autonoma system i ett sammanhängande och robust tema ska alla AI-agenter som skapas, underhålls eller definieras i projektet bära namn hämtade från **Fornnordisk mytologi och religion**, matchat mot deras specifika operativa domän:

| Agentnamn | Roll | Fornnordisk anknytning | Funktion i systemet |
| :--- | :--- | :--- | :--- |
| **Mimer** | Detekterings- & Replay-motor | Vishetens jätte vid Mimers Brunn | Garanterar plattformens matematiska och kryptografiska sanning. |
| **Mimer Bibliotekarie** | Datakoordinator | Ansvarig för Mimers Brunn | Granskar, planerar och optimerar geodataflöden (Mimers Brunn-policyn). |
| **Heimdall** | Moln- & AI-Arkitekt | Väktaren som ser och hör allt | Övervakar arkitekturen (GCP, Vertex AI), säkerhet, och systemgränser. |
| **Tor** | Kodimplementör (Copilot Agent) | Den starke beskyddaren | Den primära agenten som skriver, testar, validerar och commitar kod. |
| **Loke** | Prototypings- & Tvätt-agent | Den listige formskiftaren | Genererar experimentella prompter, prototyper och utför datatvätt. |
| **Freja** | Gränssnitts- & Styling-agent | Skönhetens och estetikens gudinna | Hanterar frontend-design, layout, tokens och visuella finslipningar. |
| **Odin** | Forsknings- & Diagnos-agent | Allfader, sökare av djup kunskap | Genomför djupgående kodanalyser, felsökning och systemundersökningar. |
| **Sleipner** | Migrations- & Failover-agent | Den åttafotade snabbe springaren | Hanterar backup, restore, och failover-procedurer över systemgränser. |

Denna namngivningspolicy är normativ. Inga agenter får namnges med generiska eller moderna namn.

---

## 4. Dokumentation och Gemini Enterprise

| Ämne | Sökväg |
|------|--------|
| Knowledge base (indexera först) | `knowledge-base/README.md` |
| Geodata-gap | `docs/architecture/data-coverage-gaps.md` |
| Framtida optimeringar | `docs/architecture/future-optimizations-backlog.md` |
| Dela kod + PostGIS-kontext | `docs/ops/gemini-enterprise-access.md` |

**Plattformskod** delas via **Git**. **Geodata** delas via **Drive** (`GEO_Master_Archive`). **PostGIS** delas via schema/SQL i repot — inte Docker-volymen på Drive.

---

## 5. Arkitekturpolicy: Mimers Brunn (Offline-First)

### Bakgrund och Syfte
Offentlig miljödata är flyktig. Erfarenhet visar att livsviktig historik (t.ex. grundvattenutredningar från VISS) raderas eller döljs av myndigheter över tid. Ett externt Live-API garanterar inte datans överlevnad.

Därför styrs plattformen av policyn "Mimers Brunn". För att Mimer (AI:n) ska uppnå sann Miljöintelligens, måste all data ägas och lagras lokalt.

### Grundläggande Regler
- **Ladda ner framför API (Download-First):** Live-API:er (WMS/WFS/REST) får endast användas som tillfälliga visuella hjälpmedel i frontenden. Den slutgiltiga lösningen för varje dataset MÅSTE vara ett skript som laddar ner rådatan fysiskt.
- **Direkt till Master-arkivet:** Skriv direkt till den kanoniska strukturen: `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\<Provider>\<Dataset>\`. Gamla mappar som `D:\GEodata` eller `C:\GEO PDF` är förbjudna.
- **In-DB eller Out-of-DB:** När datan är säkrad i Master-arkivet:
    - Importera direkt i PostGIS-tabeller (Vektordata: shp, gpkg).
    - Registrera i PostGIS via Out-of-DB-länkar (`raster2pgsql -R`) (Rasterdata: tif, asc).
- **Källhänvisningar och Dokument (PDF):** Rapporter och domar ska laddas ner till `H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Documents\Sources\<Provider>\`. Appens frontend ska servera filen från detta lokala arkiv.

### Tekniska Krav för Harvesting-logik (scripts/import/)
För att säkra datans integritet och tillgänglighet måste alla nya skript hantera:

1.  **Versionering (Myndighetsrättelser):**
    - Skriv aldrig över existerande data. Om ny data hämtas för samma dataset, lagra den i en ny tidsstämplad undermapp (t.ex. `.../YYYY-MM-DD/`).
    - Databasposter ska inkludera ett fält för `download_date` eller `valid_from` så databasen kan skilja på historisk och aktuell data.

2.  **"Polite Scraping" (Rate-Limiting & Retries):**
    - Implementera alltid fördröjningar (sleep/delay) mellan anrop för att undvika IP-blockering.
    - Använd robust felhantering med retries (Exponential Backoff rekommenderas) för nätverksfel.

3.  **Bevis på integritet (Checksums):**
    - Beräkna SHA-256 hash för varje nedladdad fil.
    - Lagra hashen i en metadatafil (t.ex. `checksums.txt` eller `metadata.json`) i samma mapp som datan. Detta bevisar datan är oförvanskad.

### Instruktion för Agenter
Vid utveckling av nya datainhämtningsmoduler (under `scripts/import/`), följ strikt denna policy. Fokusera på att bygga robusta nedladdnings-pipelines ("Harvesting") som säkrar datan på H-disken. Målet är att fylla Mimers Brunn.
