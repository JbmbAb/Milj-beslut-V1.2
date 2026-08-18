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
- **Canonical:** [Mimers Brunn v3.0.0 — National Environmental Knowledge Corpus](docs/architecture/mimers-brunn-v3.0.0.md) (ACTIVE, 2026-08-09).
- **Download-First / Archive-First:** All miljödata skördas, versioneras och arkiveras oförändrat fysiskt i Master-arkivet med checksums (SHA-256). PostGIS är en projektion, inte sanningskälla. Import kräver DatasetApprovalArtifact (inga self-approvals).

---

## 3. Namngivningspolicy för AI-Agenter (Fornnordisk taxonomi)

För att bevara plattformens identitet och förankra våra autonoma system i ett sammanhängande och robust tema ska alla AI-agenter som skapas, underhålls eller definieras i projektet bära namn hämtade från **Fornnordisk mytologi och religion**, matchat mot deras specifika operativa domän:

| Agentnamn | Roll | Fornnordisk anknytning | Funktion i systemet |
| :--- | :--- | :--- | :--- |
| **Mimer** | Detekterings- & Replay-motor | Vishetens jätte vid Mimers Brunn | Garanterar plattformens matematiska och kryptografiska sanning. |
| **Mimer Bibliotekarie** | Datakoordinator | Ansvarig för Mimers Brunn | Granskar, planerar och optimerar geodataflöden (Mimers Brunn-policyn). |
| **Heimdall** | Moln- & AI-Arkitekt | Väktaren som ser och hör allt | Övervakar arkitekturen (GCP, Vertex AI), säkerhet, och systemgränser. |
| **Tor** | Kodimplementör (Copilot Agent) | Den starke beskyddaren | Implementerar pipeline och index. Får inte ändra källscope implicit, radera Raw Archive eller göra relevansbedömning till destruktiv operation. |
| **Loke** | Datainsamlare & Tvätt-agent | Den listige formskiftaren | Får hämta från Source Registry, måste följa source-specific limits, måste bevara provenance, får inte permanent filtrera/radera. |
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
| Kunskapspipeline (ADR) | `docs/architecture/ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md` |

**Plattformskod** delas via **Git**. **Geodata** delas via **Drive** (`GEO_Master_Archive`). **PostGIS** delas via schema/SQL i repot — inte Docker-volymen på Drive.

---

## 5. Arkitekturpolicy: Mimers Brunn (National Environmental Knowledge Corpus)

**Normativ policy:** [Mimers Brunn v3.0.0 — National Knowledge Corpus](docs/architecture/mimers-brunn-v3.0.0.md) (ACTIVE). Nedan är agent-orienterad sammanfattning för hur den nationella miljökorpusen samlas in.

### Bakgrund och Syfte (Fryst Princip)
Offentlig miljödata är flyktig. API:er, tjänster och länkar försvinner. Vi bygger inte ett juridiskt arkiv, vi bygger en **Nationell Miljökunskapskorpus**.
Därför gäller en tvingande insamlingsprincip: **Hämta först. Bevara originalet. Klassificera senare. Filtrera endast genom explicit, versionerad och reversibel policy.**
Ingen informationsförlust får ske genom tidig relevansfiltrering. Ingen källa får permanent förloras på grund av en agents relevansbedömning. Loke hämtar, Tor implementerar.

### Den 5-skiktade Kunskapsarkitekturen (The 5-Tier Knowledge Architecture)
För att förhindra att Mimer drunknar i data separerar vi insamling från indexering i fem frysta skikt:

1. **Tier 1: Source Registry:** Den enda auktoritativa auktorisationspunkten för extern harvesting. Ostrukturerad webbcrawling är förbjuden.
2. **Tier 2: Raw Archive (Allt inom registret):** Allt hämtas ner. Originalbyte bevaras. Inget raderas på grund av AI-bedömd irrelevans.
3. **Tier 3: Inventory (Allt klassificerat):** Allt beskrivs (Vad, Vem, Domän, Datum) och tilldelas metadata-relevans.
4. **Tier 4: Knowledge Corpus (Selekterat):** Ett reproducerbart, versionshanterat urval från Inventory, skapat genom explicit policy. Alla exkluderingar måste vara spårbara.
5. **Tier 5: RAG / Domain Indexes (Domänspecifik Representation):** Vi tvingar inte in allt i samma RAG. Rätt representation för rätt data (Legal, Spatial, Temporal, Vector).

### Katalogstruktur: National Environmental Archive
Skriv direkt till den kanoniska strukturen i Master-arkivet:
`H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\National_Archive\<Authority>\<Year>\<Municipality>\<Case_ID_or_Dataset>\`

Inom varje arkiv-mapp tillämpas strikta lager:
- `/original/` (Rådata, PDF:er, shapefiler)
- `/extracted/` (Konverterad text/data)
- `/manifest.json` (Paketering och provenance)
- `/hashes/` (Kryptografiska checksummor, SHA-256)

### Utökat Producent- och Klass-scope
Vi inventerar hela miljödatakäll-landskapet, inklusive: SGU, SGI, Naturvårdsverket, SLU, Jordbruksverket, Skogsstyrelsen, SMHI, VISS, HaV, SVA, SCB, SMED, DiVA, Dataportal, Länsstyrelser, Kommuner, Boverket, Trafikverket.

### Tekniska Krav för Harvesting-logik (scripts/import/)
Alla nya skript ska hantera:
1.  **Ingen tidig filtrering:** Ladda ner källan och spara i Raw Archive, oavsett om den vid första anblicken verkar irrelevant.
2.  **Versionering (Myndighetsrättelser):** Skriv aldrig över. Om ny data hämtas, lagra den i en ny tidsstämplad undermapp.
3.  **"Polite Scraping":** Implementera fördröjningar och robust felhantering.
4.  **Bevis på integritet:** SHA-256 hash för varje fil, lagrat i manifestet.

---

## 6. TV-L1 — Freeze Addendum (De tre kontraktsinvarianterna)

TV-L1 är fryst och redo att exekveras. Följande tre kontraktsinvarianter samt pipeline-arkitektur är normativa för hela plattformen:

### 6.1 L1-10 — CAS Canonical Record Semantics (FRYST)
- **CAS är en kanonisk post av Mimer-godkända artefakter (Mimer-approved artifacts).**
- CAS är *inte* epistemisk sanning, extern sanning eller myndighetens sanning.
- CAS bevarar exakt vad som observerades, exakt hur det verifierades, exakt vad som godkändes och exakt under vilken governance-release.
- CAS garanterar: "Det här dokumentet är godkänt som källa i Mimers evidenskedja." (Det säger inte: "Det här dokumentets innehåll är sant.")

### 6.2 L1-07 — Replay Refers to Captured Observation State (FRYST)
- **Replay får aldrig försöka göra internet deterministiskt.** Om externa källor ändras över tid ska replay reproducera det infångade tillståndet (ingestion state) från oföränderliga artefakter och exekverings-provenance (`RawSourceArtifact`, `RetrievalPolicyArtifact`, `SourceAuthorityArtifact`, `ExecutionManifest` och derivationskedjan).
- Replay *skall inte* försöka hämta samma externa URL igen.

### 6.3 L1-11 — Quarantine Storage Semantics (FRYST)
- **Loke får inte skriva till CAS.** Misslyckad verifiering får inte förstöra eller ändra observationen.
- Alla råa observationer *skall* lagras i ett styrt karantänlager (governed quarantine layer) innan de befordras till CAS.
- Karantänlagret är en fysisk lagring utanför CAS med egen identitet, retention-policy, åtkomstregler och governance. Misslyckad proveniens- eller integritetskontroll raderar eller ändrar inte den ursprungliga `RawSourceArtifact`.

### 6.4 Den slutliga TV-L1-kedjan (Governed Observation Architecture)
Den kompletta ingest-kedjan ser ut enligt följande flöde:

```text
SOURCE
  │ authority + policy
  ▼
LOKE (Governed Observer - disciplinerad, ej smart)
  │ observation
  ▼
RAW
  │ verify provenance/integrity
  ▼
QUARANTINE
  │
  ▼
DERIVATION
  │ metadata/document
  ▼
HUMAN GOVERNANCE
  │ approval
  ▼
CAS (Approved Artifacts)
  │
  ▼
EVIDENCE
  │
  ▼
ASSESSMENT
  │
  ▼
REVIEW
  │
  ▼
DECISION
```

Denna styrda observationsarkitektur säkerställer att Loke agerar som en disciplinerad observatör (inte en smart crawler). Loke behöver endast kunna bekräfta: *"Det här observerade jag från denna auktoriserade källa, under denna policy, vid denna tidpunkt, med detta innehåll."* All efterföljande verifiering och sanning styrs av Mimer.

---

## 7. Arkitekturpolicy för spatial visualisering och Cesium-integration (Unified Evidence Engine)

För att garantera systemets integritet, undvika motstridiga källor och förhindra allvarliga spatiala prestandaproblem, tillämpas följande frysta principer för all kartintegration och visualisering (t.ex. i CesiumJS och Leaflet):

### 7.1 En enda spatial sanning (Unified Engine)
- **Cesium är en ren visualisering av bevis, inte en egen GIS-motor.** Kartgränssnittet får inte göra egna förenklade beräkningar eller ha en separat pipeline för dataintag.
- All spatial sökning och analys styrs av kärnmotorn via det gemensamma gränssnittet **`SpatialQueryContract`**.
- När en användare klickar på en fastighet eller en punkt i kartvyn anropas samma `SpatialQueryContract` som används av lokaliseringsmotorn (LU). Kontraktet returnerar standardiserade **`SpatialEvidenceArtifact[]`**-tokens. Kartklicket mappar därmed direkt till den verifierade evidensen, bevisrekommendationen och lagrummen.

### 7.2 Optimal spatial indexering (GiST-skydd)
- **Förbjudet att transformera kolumner dynamiskt i WHERE-villkor.** Att transformera databaskolumnen (t.ex. `WHERE ST_Transform(geom, 4326) && ...`) ogiltigförklarar GiST-indexet på originalgeometrin (som ligger i EPSG:3006).
- **Korrekt metod:** Sökfönstret (BBox/Envelope) från kartklienten transformeras *till lagrets infödda CRS (3006)* en gång, sökningen körs mot det befintliga GiST-indexet, och därefter transformeras enbart de returnerade resultaten till WGS84 (EPSG:4326).
  ```sql
  WHERE geom && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006)
  ```

### 7.3 Skalbar presentationslayout
För att förhindra prestandakollaps i webbläsaren vid hantering av miljontals fastigheter och byggnader mappar vi presentationsformat till dataenheter baserat på skala:
- **Fastighetsytor / gränser / byggnader i nationell skala:** Strömmas som **3D Tiles** (ej rå GeoJSON).
- **Terräng och höjddata:** Strömmas som **Terrain/Elevation Tiles**.
- **Aktivt LU-resultat / interaktiva buffertzoner:** Renderas dynamiskt som lightweight **GeoJSON / CZML / Entities**.
- **Evidens, regelverk och findings:** Hämtas och presenteras via **Evidence API**.

### 7.4 Decoupling av Identitet och Geometri
- Plattformen skiljer strikt på **Property Identity** (`core.property_unit` — metadata, länskoder, identitet) och **Property Geometry** (`env.registerenhetsomradesytor` — tunga polygoner). Detta garanterar att identitets- och replaysökningar förblir blixtsnabba även när de spatiala skikten innehåller tiotals miljoner komplexa ytor.
- **Millbygård** fungerar som en direkt testklient till samma spatiala PostGIS-databas, vilket ger ett gemensamt testbed för fastighetsgränser, 3D-byggnadsutskjutning och höjdmodellsklippning utan redundanta pipelines.

### 7.5 Tvingande Invarianter (Hard Enforcement Rules)
- **SPATIAL-01 — Single Evidence Identity:** A spatial object rendered by any presentation client SHALL reference the canonical SpatialEvidenceArtifact identity produced by the Unified Spatial Engine. Presentation layers SHALL NOT reconstruct, reinterpret, or independently derive evidentiary facts from raw spatial data.
- **SPATIAL-02 — Presentation Non-Authority:** Cesium, GeoJSON, CZML, 3D Tiles and other presentation formats SHALL NOT constitute sources of truth. They are projections of canonical spatial state and evidence.


