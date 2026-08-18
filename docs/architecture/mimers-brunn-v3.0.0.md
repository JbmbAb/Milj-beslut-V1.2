# Mimers Brunn v3.0.0 — National Environmental Knowledge Corpus

| Field | Value |
| --- | --- |
| **Type** | DATA_GOVERNANCE_POLICY |
| **Status** | ACTIVE |
| **Authority** | Architecture Governance |
| **Revision** | 3.0.0 National Knowledge Corpus |
| **Version Date** | 2026-08-09 |

Supersedes: Mimers Brunn v2.0.1 (`mimers-brunn-v2.0.1.md` → LEGACY).

---

## 1. Authority

Mimers Brunn v3.0.0 uppgraderar plattformens datastrategi från ett juridiskt arkiv till en fullständig, nationell miljökunskapskorpus. Den definierar operativa data governance-regler för:

- maximal insamling (harvesting) baserad på ett nationellt källregister, utan tidig relevansfiltrering
- 5-skiktsarkitekturen (Source Registry → Raw Archive → Inventory → Knowledge Corpus → Domain Indexes)
- arkivering och versionering
- integritetsverifiering
- importdisciplin
- deterministisk datahantering
- domänspecifik indexering (spatial, temporal, legal etc.)

---

## 2. Purpose

Offentlig miljödata är flyktig. API:er, WMS/WFS-tjänster och PDF-länkar ändras eller försvinner. För att Mimer (AI:n) ska uppnå sann Miljöintelligens, måste all data ägas och lagras lokalt i ett oförvanskbart råarkiv först.

Mimers Brunn v3.0.0 är plattformens offline-first och determinism-policy med en tvingande insamlingsprincip (Fryst Invariant): 
**Hämta först. Bevara originalet. Klassificera senare. Filtrera endast genom explicit, versionerad och reversibel policy. Ingen källa får permanent förloras på grund av en agents relevansbedömning.**

---

## 3. The 5-Tier Knowledge Architecture

För att hantera datamängderna och separera insamling från indexering definieras följande fem frysta skikt (Tiers):

### 3.1 Tier 1: Source Registry
- Ett formellt register över alla godkända källor. Svarar på: Vem publicerar? Vilken portal/API? Vilken URL? Vilken typ av källa? Hur hämtas den? Hur ofta uppdateras den? Rate limit? Checksum/ETag? Geografiskt scope?
- **Fryst Invariant:** Source Registry är den enda auktoritativa auktorisationspunkten för extern harvesting. Om en agent hittar en ny intressant källa måste den föreslås till registret och godkännas innan harvesting sker. Ingen ostrukturerad webbcrawling är tillåten.
- Här definieras `rate_limit`, `concurrency_limit`, `max_object_size` och `retry_policy` per producent (t.ex. en myndighet får concurrency 1, en annan 10). Inga godtyckliga lagringskvoter tillämpas innan volyminventering gjorts.

### 3.2 Tier 2: Raw Archive (Allt inom Source Registry)
- Allt material från inventeringen hämtas ner och sparas oförändrat.
- Originalbyte bevaras.
- SHA-256 + källa + datum + provenance.
- Inget raderas på grund av AI-bedömd irrelevans (t.ex. en Skolplan behålls).

### 3.3 Tier 3: Inventory (Allt klassificerat)
- Allt material i råarkivet klassificeras, beskrivs och inventeras.
- Data inkluderar metadata och relevans (`unknown`, `possible`, `relevant`, `irrelevant`).

### 3.4 Tier 4: Knowledge Corpus (Selekterat)
- Endast material som faktiskt lämpar sig för sökning/analys går vidare hit.
- **Ett reproducerbart, versionshanterat urval från Inventory, skapat genom explicit policy.** Alla exkluderingar ska vara spårbara och återförbara till Raw Archive.
- Varje exkludering (dvs. data som ej befordras) ska registrera följande metadata: `source_id`, `inventory_id`, `policy_version`, `classification`, `decision`, `reason_code`, `decided_at`, `decided_by`, och `raw_reference`.

### 3.5 Tier 5: RAG / Domain Indexes (Domänspecifik Representation)
- Vi tvingar inte in alla datatyper i samma RAG. Rätt representation för rätt data:
  - MÖD-dom → Legal Corpus → legal chunking → legal retrieval
  - SGU jordart → Geodata → PostGIS → spatial retrieval
  - SMHI nederbördsserie → Time series → temporal retrieval
  - Forskningsrapport → Document → semantic chunking → vector retrieval
  - VISS vattenförekomst → Structured environmental data → spatial + attribute retrieval

**Viktigt:** Implementera inte RAG v3 förrän Source Registry + fullständig arkivinventering + provenance är verifierade.

---

## 4. Source Classes and Producers

Scope för inventering är hela Sverige och hela miljödatakäll-landskapet (allt inom Source Registry).

| Klass | Exempelkällor | Exempel på innehåll |
| --- | --- | --- |
| **Geologi/mark** | SGU, SGI | jordarter, berggrund, grundvatten, skred, ras, erosion |
| **Natur/miljö** | Naturvårdsverket, SLU | arter, habitat, naturtyper, miljöövervakning |
| **Jordbruk** | Jordbruksverket | jordbruksmark, vatten, näringsläckage, djurhållning |
| **Skog** | Skogsstyrelsen, SLU | skog, avverkning, naturvärden, skogsskador |
| **Vatten** | VISS, SGU, SMHI, HaV | vattenförekomster, status, miljökvalitetsnormer, hydrologi |
| **Meteorologi/klimat** | SMHI | nederbörd, temperatur, klimat, hydrologi, prognoser |
| **Veterinär/biologisk** | SVA | zoonoser, vilt, smittor, biologiska risker |
| **Miljöekonomi/statistik** | SCB, SMED | utsläpp, avfall, miljöräkenskaper, statistik |
| **Forskningsdata** | DiVA, SND, Swecris | forskningsartiklar, rapporter, dataset |
| **Forskningspublikationer** | DiVA, universitet, institut | avhandlingar, rapporter, vetenskapliga publikationer |
| **Nationella dataportaler** | Dataportal.se, m.fl. | metadata och dataset från många producenter |
| **Övriga myndigheter** | Länsstyrelser, kommuner | lokala och regionala miljödata, planeringsunderlag |
| **Trafik & Infrastruktur** | Trafikverket, Boverket | exploatering, infrastruktur |

**Viktig distinktion:** Källproducent och distributionskanal ska modelleras separat. Olika källor har helt olika semantik och bevisvärde.

---

## 5. Agent Responsibilities

**Inventering → klassificering → granskning → godkännande → ingest.**

- **Loke** = Harvest / Provenance. Loke följer producentens regler i Source Registry.
- **Tor** = Implementation. Tor implementerar mekanismen.
- **INGEN** av agenterna får på eget bevåg besluta: *"Det här verkar oviktigt, så jag hämtar inte"*. Ingen informationsförlust får ske genom tidig relevansfiltrering.

---

## 6. Canonical Data Flow

```text
SOURCE REGISTRY
         ↓
RAW ARCHIVE (Loke hämtar. Original sparas. Provenance säkras.)
         ↓
INVENTORY
         ↓
KNOWLEDGE CORPUS
         ↓
RAG / DOMAIN INDEXES (Legal, Spatial, Temporal, Vector)
```

`GEO_Master_Archive` är det persistent källagret och hanterar Tier 2 och Tier 3.

---

## 7. Version Preservation & Collisions

`GEO_Master_Archive` bevarar versioner genom immutable version directories:
- no-overwrite policy
- manifest history tracking
- collision detection

Filsystemssökvägar är inte identitet. Content identity för harvested source data etableras genom SHA-256 integritetsverifiering.

---

## 8. Lifecycle State Model

Tillåtna states:
- `REGISTERED` (I Source Registry)
- `HARVESTED` (I Raw Archive)
- `VERIFIED`
- `CLASSIFIED` (I Inventory)
- `APPROVED` (I Knowledge Corpus)
- `REJECTED`
- `IMPORTED` (I Domain Indexes)
- `QUARANTINED`

---

## 9. DatasetApprovalArtifact (CanonicalArtifact)

```ts
interface DatasetApprovalArtifact extends CanonicalArtifact {
  artifact_type: "DATASET_APPROVAL";
  approved_ref: ContentReference;
  decision: "APPROVED" | "REJECTED";
  actor_ref: ActorReference;
  decision_at: Timestamp;
  reason: string;
}
```

Import till Domain Indexes kräver godkännande via `DatasetApprovalArtifact` av en auktoriserad roll.

---

## 10. Legacy Status

Mimers Brunn v2.0.1 → **LEGACY**.
Mimers Brunn v1.0 → **LEGACY**.
