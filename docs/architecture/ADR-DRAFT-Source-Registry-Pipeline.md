# ADR-DRAFT — Source Registry Pipeline (Producer Inventory → Heimdall Approval → Loke)

## Status

**DRAFT / PROPOSED — inte antagen.** Skriven av Claude (agent) 2026-08-10 efter att fyra
harvest-scripts byggdes utan att först kontrollera `source-registry/national-registry.json`
eller ADR-042. Detta dokument formaliserar den korrigerade arbetsordningen som beställdes
i samma session. Kräver Heimdall/GOVERNOR (eller motsvarande mänsklig ägare) för att gå
från DRAFT → Accepted.

## Bakgrund / vad som gick fel

`LOKE_INSTRUKTION_JURIDISK_HARVESTING.md` beskriver fyra harvest-workers (SFS, NFS/HVMFS/BFS,
kommunal ABVA, domstolsavgöranden). De implementerades direkt mot spec-dokumentets pseudokod
utan att kontrollera om källorna fanns i `source-registry/national-registry.json` (de gjorde
inte det — bara SGU, Naturvårdsverket-WFS och SMHI är godkända där) eller om de skulle
använda Mimers Brunn v9:s CAS/manifest/ApprovalRecord-kontrakt (ADR-042) istället för den
äldre `scripts/import/utils/harvesting.ts`-mönstret. Resultatet: fyra script som kompilerar
och är tekniskt rimliga, men som saknar godkänd källa, godkänd hämtstrategi och godkänt
artefakt-kontrakt. De är nu markerade `⛔ QUARANTINED` i sina filhuvuden och ska inte köras.

## Beslut: den låsta arbetsordningen

```
1. Producer Inventory        (bred, namngiven lista — inga URL:er krävs)
        ↓
2. Dataset Inventory          (per producent: Portal → Dataset → Endpoint → Protokoll → Format)
        ↓
3. Endpoint Verification      (faktisk request mot källan, status sätts)
        ↓
4. Policy Definition          (rate limit, concurrency, politeness, access requirements)
        ↓
5. Heimdall Approval          (mänsklig/GOVERNOR-granskning → skriver till national-registry.json)
        ↓
6. Source Registry            (den enda sanningskällan för vad Loke får hämta)
        ↓
7. Loke                       (hämtar ALLT som en godkänd post omfattar — gör INGEN egen
                               relevansbedömning)
        ↓
8. Raw Archive (GEO_Master_Archive, Mimers Brunn v9 CAS)
```

**Inventory ≠ Approval.** Steg 1–4 får vara breda, ofullständiga och "best effort". Steg 5
(Heimdall-godkännande) är den enda punkt där en post blir en riktig Source Registry-post.
Ingen agent (inklusive denna) godkänner sina egna poster.

## Statusmodell (Dataset/Endpoint-nivå)

| Status | Betydelse |
|---|---|
| `DISCOVERED` | Namngiven/känd, men endpoint inte verifierad genom faktisk request |
| `VERIFIED` | Faktisk request genomförd, svar bekräftat matcha förväntat innehåll/format |
| `BLOCKED` | Verifieringsförsök gjordes, källan nekade/blockerade |
| `REQUIRES_AUTH` | Kräver API-nyckel/autentisering som inte finns konfigurerad |
| `DEPRECATED` | Tidigare fungerande källa, nu nedlagd/flyttad |
| `OUT_OF_SCOPE` | Producent/dataset beslutad utanför scope (t.ex. inte miljörelevant) |

`source-registry/national-registry.json` accepterar **endast** poster där status skulle
motsvara `VERIFIED` + `approved_by.role == "GOVERNOR"`. `DISCOVERED`-poster hör hemma i
Dataset Inventory, inte i national-registry.json.

## Producer Inventory-format

Se `source-registry/producer-inventory.json` — flat lista, ett objekt per producent:
`producer_id`, `name`, `category`, `status: "DISCOVERED"`, `notes`. Inga endpoints här.

## Dataset Inventory-format

Se `source-registry/dataset-inventory.md` — tabell: `Producer | Dataset | Endpoint | Protocol
| Format | Frequency | Rate | Status`. Endast rader med faktiskt känt/dokumenterat innehåll
fylls i; okänt lämnas som `needs verification`, gissas aldrig fram.

## Vad detta INTE är

- Det är inte ett godkännande av de fyra karantänsatta scripten.
- Det är inte en Source Registry-uppdatering (den filen rörs inte av denna ADR).
- Det är inte en instruktion att börja koda harvesters igen.

## UPPDATERING 2026-08-10 — "Vem är Heimdall?" är nu besvarad (delvis)

Efter granskning hittades **`packages/mps-data-governance`** — ett redan existerande,
mycket mer sofistikerat ramverk än vad denna ADR ursprungligen antog. Det förändrar
slutsatserna nedan väsentligt.

### Vad som faktiskt finns

- **`packages/mps-core/src/types.ts`** definierar det kanoniska typsystemet:
  - `ActorRole = "EVOLUTION_AGENT" | "HUMAN_OPERATOR" | "SYSTEM_PROCESS" | "GOVERNANCE_REVIEWER"`
    — **"GOVERNOR" finns inte i denna enum.** Närmsta kanoniska roll är `GOVERNANCE_REVIEWER`.
  - `ActorReference = { identity_ref: ContentReference; role: ActorRole }` — identitet ska
    vara en **resolvbar, hashbar referens**, inte en fri sträng. Kommentaren i koden säger
    uttryckligen: *"An opaque name in a signed approval is not attributable evidence."*
  - `CanonicalArtifact` kräver `content_hash: HashDescriptor` och `signature: SignatureDescriptor`
    på alla artefakter.
- **`packages/mps-data-governance/src/SourceRegistry.ts`** definierar `SourceRegistryArtifact`
  (Tier 1) — exakt samma schema som `source-registry/national-registry.json` använder,
  inklusive kommentaren: *"Fryst Invariant: Source Registry är den enda auktoritativa
  auktorisationspunkten för extern harvesting."*
- **`packages/mps-data-governance/src/RawSourceArtifact.ts`** (Tier 2) — kommentaren säger
  uttryckligen: **"Loke är den agent som skapar dessa."** Loke är alltså redan formellt
  definierad i kodbasen — som den som producerar `RawSourceArtifact` från en godkänd
  `SourceRegistryArtifact`, ingenting annat.
- **`packages/mps-data-governance/scripts/loke-harvest.ts`** — en redan existerande,
  **fungerande, kontraktsenlig Loke-implementation** (90 rader). Läser
  `source-registry/national-registry.json` direkt, itererar över *alla* godkända poster,
  respekterar varje endpoints `politeness_delay_ms`, hämtar, SHA-256-hashar, skriver
  `RawSourceArtifact`-manifest till `National_Archive/<producer_id>/<year>/...`. Gör
  **exakt** det du beskrev: "Jag behöver inte veta om detta är relevant — jag hämtar allt
  kontraktet omfattar." De fyra karantänsatta scripten är alltså inte bara oauktoriserade —
  de är en sämre, kontraktsbrytande dubblett av något som redan fanns och redan är rätt
  byggt. De bör troligen tas bort snarare än bara karantänsättas, men jag har inte gjort det
  utan att fråga.
- **`packages/mps-data-governance/src/HarvestOrchestratorContracts.ts`** visar en mer
  avancerad, ännu inte (så vitt jag sett) fullt kopplad lager: `GovernanceReviewAwaiter`
  med `pollApproval(manifest_ref): Promise<ArtifactReference | null>` — en icke-blockerande
  polling-mekanism för mänskligt godkännande. Detta ser ut som den tilltänkta platsen där
  ett verkligt "Heimdall" skulle implementeras, men jag har inte hittat en konkret
  implementation av det interfacet, bara kontraktet. Kräver djupare granskning
  (`HarvestOrchestrator.ts`, `HarvestExecutionStateMachine.ts`, tillhörande tester) innan
  slutsats dras om den delen redan är klar eller inte.
- **`packages/mps-data-governance/scripts/validateRegistry.ts`** — den faktiska
  runtime-validatorn för `national-registry.json`. Den kontrollerar **endast**
  `artifact_type`, `endpoint.url` och `endpoint.policy.rate_limit_requests_per_second`.
  Den kontrollerar **inte** `approved_by`, `signature`, `content_hash` eller om `role` är
  en giltig `ActorRole`. Alltså: inget kör-tidskontrakt validerar Heimdall-fältet idag.

### Svaret på "vem/vad är Heimdall konkret?"

**Ingenstans formellt definierad.** `"Heimdall"`/`"GOVERNOR"` i de tre befintliga
`national-registry.json`-posterna är fri text som inte matchar det kanoniska
`ActorReference`/`ActorRole`-kontraktet som redan finns i `mps-core`. Konkret:

- `role: "GOVERNOR"` är inte ett giltigt `ActorRole`-värde.
- `actor_id: "Heimdall"` är en fri sträng, inte en `identity_ref: ContentReference`.
- Ingen av de tre posterna har `content_hash` eller `signature`, vilket `CanonicalArtifact`
  kräver av alla artefakter i detta lager.
- Ingen kod (`validateRegistry.ts` eller annat jag hittat) verifierar något av detta.

Med andra ord: **de tre "godkända" posterna som redan finns är själva inte kontraktsenliga
enligt kodbasens egna frysta typer.** Detta är inte bara en lucka för framtida poster — det
är en existerande avvikelse i det som redan kallas godkänt.

### Vad detta INTE är

Detta är fortfarande **inte** ett förslag på en ny mekanism. Det är en redovisning av vad
som redan finns kodat men inte är ihopkopplat, plus en identifierad avvikelse mellan
`national-registry.json`:s faktiska innehåll och `mps-core`:s typsystem.

## Nästa steg (kräver mänskligt beslut)

1. Granska Producer Inventory (bred, ej verifierad — säkerhetsrisk låg, det är bara namn).
2. Prioritera vilka producenter som ska gå till Dataset Inventory + Endpoint Verification
   först (troligen kärnlistan: SGU, HaV, SLU, Jordbruksverket, Skogsstyrelsen, SMHI, SVA,
   VISS, SMED, Riksdagen/SFS, Lantmäteriet, Boverket, Kemikalieinspektionen).
3. Definiera vem/vad som faktiskt är "Heimdall" i denna kodbas (roll, process, verktyg) —
   detta dokument antar att det är en mänsklig granskningsfunktion, inte en agent.
