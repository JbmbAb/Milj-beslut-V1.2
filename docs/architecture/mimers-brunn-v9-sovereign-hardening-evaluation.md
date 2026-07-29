# Mimers Brunn v9 Sovereign Hardening - utvardering och optimeringsplan

Datum: 2026-07-29

## Statusuppdatering (2026-07-29, post kärna + integration)

**Produktionsklassad Mimers v9-kärna finns** under `packages/mimers-brunn-core` och `server/mimers/` (CAS, ManifestBuilder, FileEventLog, recovery L0–L3, fault injection, dual-write evolve, ArtifactStore→CAS-migration, ops-runbook + `npm run mimers:bench`).

Kvarvarande begransningar (medvetna):

- Evolve ar **dual-write**: V3 i FileArtifactStore ar fortfarande index; cutover till CAS-only ar inte gjord.
- Opt-in via `MIMERS_ROOT` (se `.env.example`); utan env forblir V3 FileArtifactStore-only.
- L3 kan **karantanmarkera** korrupta objekt med `auditL3({ quarantine: true })`.
- blake3 ar reserverad, inte implementerad.
- Cross-process idempotency bygger pa CAS/ledger-filer, inte separat distributed lock-tjanst.
- "Produktionstestad" galler endast OS/durability-matris som faktiskt korsts (se [ops-runbook](../ops/mimers-brunn-v9-runbook.md)).

Nedan foljer den ursprungliga gap-analysen (historisk kontext); tabellen speglar **fore** karnextraktionen.

## Sammanfattning

Nuvarande kodbas har tagit ett tydligt steg mot WORM/AES-baserad evolutionsspårning:

- `PromotionArtifactV3` ar content-addressed via `artifactId === artifactHash`.
- `ApprovalRecord` skrivs fore godkand promotion och ar separat fran promotion-artefakten.
- `EvolutionOrchestrator` skapar promotion-artifacts endast efter approval.
- `EventLedger` ar persistent och har hashkedja via `prevEventHash`.
- Batchad shadow evaluation, constraint-filtering fore compile och krockfria kandidatindex finns.

Men Mimers Brunn v9 enligt Sovereign Hardening-specen ar annu inte implementerad som en high-integrity CAS/manifest/recovery-karna. Dagens `FileArtifactStore` ar en JSON-key/value store med atomic temp-rename och fsync-forsok. Den ar anvandbar for Fas 3/4-WORM, men den uppfyller inte CAS durability lock, descriptor-verifiering, idempotent promotion commit, separerade Merkle-roots, recovery levels v2 eller SLSA-liknande attestering.

Rekommendation: behandla nuvarande lage som "produktionsklassad arkitektur under hardening", inte "produktionstestad", tills fault injection och crash/contension-tester finns.

## Nulage i kod

| Omrade | Status | Bedomning |
| --- | --- | --- |
| Canonical hash | Delvis | `server/utils/hashArtifact.ts` canonicaliserar och strippar AES-envelope, men `canonicalize` ar inte RFC 8785-strikt och avvisar inte alla osakra typer. |
| WORM approval/promotion | Stark | `ApprovalRecord` + `PromotionArtifactV3` ar ratt riktning: approval pekar pa candidate, promotion pekar tillbaka via `approvalRecordId`. |
| Artifact storage | Delvis | `FileArtifactStore` gor temp -> fsync(file) -> rename -> fsync(dir), men saknar CommitStrategy-abstraktion och CAS-kontrakt. |
| CAS repository | Saknas | Ingen `FileCASRepository`, `CASDescriptor`, `verifyDescriptor` eller immutable byte-store finns i serverkarnan. |
| Descriptor verification | Saknas | Manifest-/descriptor-nivan kan inte verifiera digest, size och mediaType samlat. |
| Ledger v2 | Delvis | Hashkedja finns, men modellen saknar `promotionHash`, `manifestHash`, `previousEventHash`-namnkontrakt, idempotency och bindningsvalidering. |
| Promotion idempotency | Saknas | Samma promotion kan skapa nya ledger-events vid retry om orchestration anropas igen. |
| Merkle | Saknas | Ingen separerad Ledger Merkle eller CAS Merkle checkpoint. |
| Recovery levels | Saknas | Ingen formell L0-L3 recovery/audit orchestrator. |
| SLSA/attestation | Delvis | Signaturer finns for PromotionArtifactV3, men ingen domain-separated SLSA predicate/attestation for pipelinebeslut. |
| UUIDv7/monoton event-id | Saknas | `EventLedger` anvander `crypto.randomUUID()` i event-id, inte tidsordnad UUIDv7 med processmonotonicitet. |
| OpenTelemetry | Delvis | Repo:t har observability-moduler, men ingen CAS-specifik OTel metrics adapter. |
| Fault injection | Saknas | Inga tester for kill/crash mitt i commit, EEXIST-race, corruption eller multiprocess contention. |

## Kritiska invariants for v9

1. CAS object immutability:
   Ett digest pekar alltid pa exakt samma byte-sekvens. Om destination redan finns ska commit verifiera att den ar samma digest eller rapportera collision/corruption.

2. CommitStrategy ager atomicitet:
   `FileCASRepository.put()` ska inte hantera `EEXIST`, `fsync`, `rename`, link-race eller parent directory sync. Den ska bara skriva temp, anropa `commit(temp, destination)` och tolka resultatet.

3. Descriptor-verifiering ar forsta klassens kontrakt:
   Manifestkontroll ska verifiera existens, digest, size, mediaType och schema for varje descriptor.

4. Ledger-event ar immutable och hashkedjat:
   Varje event hash inkluderar `sequence`, `eventId`, `previousEventHash`, `type`, `promotionHash`, `manifestHash` och `timestamp`.

5. Promotion commit ar idempotent:
   Retry med samma idempotency key ska returnera befintligt event utan att skapa ny promotion eller ledger-rad.

6. Merkle-roots separeras:
   Ledger Merkle skyddar historik. CAS Merkle skyddar lagrade objekt. De ska inte blandas.

7. Recovery har nivaer:
   Startup fast path far inte gora full scan. Cryptographic audit far vara dyr och explicit.

8. Signaturer ar domain-separated och verifieras fail-closed:
   Promotion-signaturer och SLSA-attesteringar ska binda `domain`, `mediaType`, `canonicalization`, digest och key-id. En signatur over en artefakttyp far inte kunna ateranvandas for en annan.

9. Ledger-id ar tidsordnade utan att vara forutsagbara:
   `eventId` ska vara UUIDv7-kompatibel, kryptografiskt sakrad och processmonoton vid flera event samma millisekund.

10. Storage scrub ar strommande:
   L3 ska inte bygga en stor fillista i RAM. Den ska ga via async generator + worker pool, med minnesprofil O(concurrency).

## P0 - CAS Durability Lock

Mal: skapa en riktig CAS-karna under `server/artifact/cas/` eller `server/modules/mimers-brunn/core/`.

Foreslagen struktur:

```text
server/artifact/cas/
  CASDescriptor.ts
  CASRepository.ts
  CommitStrategy.ts
  DefaultCommitStrategy.ts
  FileCASRepository.ts
  CASVerification.ts
  WeightedLRUCache.ts
  metrics.ts
```

Kontrakt:

```ts
export interface CommitStrategy {
  commit(
    tempPath: string,
    destinationPath: string,
  ): Promise<{
    readonly committed: boolean;
    readonly existed: boolean;
  }>;
}
```

Implementation:

- Skriv canonical bytes till temp.
- `fsync(temp)`.
- `commitStrategy.commit(temp, destination)`.
- CommitStrategy gor atomic hardlink/rename enligt OS-stod.
- `fsync(parent shard dir)` efter lyckad commit.
- Vid `EEXIST`: returnera `{ committed: false, existed: true }`.
- Vid strict durability failure: kasta `DurabilityError`.

Viktig Windows-not:

- Hard links fungerar pa NTFS men har praktiska begransningar.
- Directory fsync kan ge `EPERM`/`EINVAL` i vissa miljoer.
- Darfor bor `DurabilityMode` vara explicit:
  - `strict`: kasta vid fsync-fel.
  - `best-effort`: mata och fortsatta.
  - `none`: endast test/dev.

DoD:

- `FileCASRepository.put()` innehaller ingen `EEXIST`/race/fsync-logik.
- Race-test med 10-100 parallella puts skapar exakt ett objekt.
- Collision-test upptacker felaktigt innehall pa existerande digest.
- Samma temp/destination-filesystem verifieras vid init.

## P0 - Strict Canonical Core

Nuvarande `canonicalize` ar for enkel for v9. Den sorterar nycklar, men accepterar typer som v9 bor avvisa.

Atgard:

- Ersatt eller komplettera med `canonicalizeStrict`.
- Avvisa `undefined`, `function`, `symbol`, `bigint`, `Date`, `Map`, `Set`, `RegExp`, `URL`, `Buffer`, `Uint8Array`, `ArrayBuffer`.
- Avvisa `NaN`, `Infinity`, `-Infinity`.
- Normalisera `-0` till `0` enligt RFC 8785/JCS.
- Avvisa fristaende UTF-16-surrogat.
- Avvisa cirkulara referenser.
- Behall AES-envelope stripping separat fran canonicalization.

DoD:

- Hash for samma JSON-varde ar orderoberoende.
- Ogiltiga typer kastar `TypeError`.
- AES-hash exkluderar endast definierade envelope-falt.
- Test finns for circular refs, lone surrogates, `-0`, Date/Map/Set/Buffer.

## P1 - CAS Verification Contract

Infort kontrakt:

```ts
export interface CASVerificationResult {
  readonly digestValid: boolean;
  readonly sizeValid: boolean;
  readonly mediaTypeValid: boolean;
}
```

Rekommenderad descriptor:

```ts
export interface CASDescriptor {
  readonly mediaType: string;
  readonly digest: string;
  readonly size: number;
}
```

API:

```ts
verifyDescriptor(descriptor: CASDescriptor): Promise<CASVerificationResult>;
```

Verifiering:

- `existsAuthoritative(descriptor.digest)`.
- Read/stream object bytes.
- Digest == descriptor.digest.
- Byte-length == descriptor.size.
- mediaType matchar tillaten registry eller expected descriptor family.

DoD:

- Manifest audit anvander `verifyDescriptor`, inte interne file paths.
- `FileCASRepository` exponerar inte `getFilePath()` till hogre lager som normal kontrollvag.
- Fel rapporteras strukturerat per descriptor.

## P1 - Manifest DAG v1

Nuvarande promotion v3 refererar `pipelineDefinitionRef`, `runtimeFingerprint`, `policySnapshotRef`, men det finns ingen samlad Mimers manifest.

Atgard:

- Inforsom content-addressed objekt:
  - pipeline definition
  - policy snapshot
  - runtime fingerprint
  - metrics
  - compiled manifest/execution hashes
- Bygg `MimersBrunnManifest` med OCI-liknande descriptors.
- PromotionArtifactV3 ska helst referera `manifestHash`, inte spridda refs.

Foreslaget tillagg till framtida promotion v4:

```ts
readonly manifestHash: string;
readonly parentPromotionIds: readonly string[];
```

Migration:

- Behall v3 lasstod.
- Skapa v3 -> v4 migrator som bygger manifest om alla refs finns.
- Saknas refs: markera `migrationNote` och kräv structural audit innan aktivering.

## P1 - Immutable Ledger v2

Nuvarande `EventLedger` ar bra for enkel sekventiell persistens men behover nytt kontrakt.

Ny modell:

```ts
export interface LedgerEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
  readonly type: LedgerEventType;
  readonly promotionHash: string;
  readonly manifestHash: string;
  readonly timestamp: number;
}
```

Atgard:

- Byt `seq` -> `sequence`, `id` -> `eventId`, `prevEventHash` -> `previousEventHash`.
- Byt `crypto.randomUUID()` till UUIDv7-generator med processmonoton sekvens inom samma millisekund.
- Event hash ska vara hash av canonical payload utan `eventHash`.
- Ledger ska verifiera head vid load, inte bara lasa max sequence.
- Append ska vara append-only och upptacka gap eller dubbel sequence.

DoD:

- Test for tampered previous event.
- Test for missing sequence gap.
- Test for event whose `manifestHash` inte matchar promotionens manifest.
- Test for UUIDv7-format och sorteringsbarhet.

## P1 - Promotion Idempotency

Infors:

```ts
commitPromotion(input, { idempotencyKey })
```

Rekommenderad key:

```ts
`PROMOTION_COMMITTED:${promotionHash}`
```

Persistensmodell:

```text
idempotency/PROMOTION_COMMITTED/<promotionHash>.json
```

Return:

```ts
{
  readonly created: boolean;
  readonly eventSequence: number;
  readonly eventHash: string;
}
```

DoD:

- Samma idempotency key returnerar samma event.
- Retry efter ledger append men fore response hittar befintligt event.
- Retry efter promotion object commit men fore ledger append reparerar till exakt ett event.

## P1 - SLSA-liknande attestering och fail-closed signaturer

v9-specen lagger till signaturattestering enligt SLSA-principer. Nuvarande kod har Ed25519-signering pa `PromotionArtifactV3`, men saknar ett separat, domain-separated attestation-predicate.

Foreslaget kontrakt:

```ts
export interface ArtifactAttestation {
  readonly mediaType: 'application/vnd.mimers.attestation.v1+json';
  readonly subjectDigest: string;
  readonly predicateType: 'https://slsa.dev/provenance/v1';
  readonly predicate: {
    readonly builderId: string;
    readonly buildType: string;
    readonly invocationId: string;
    readonly materials: readonly CASDescriptor[];
    readonly metadata: Readonly<Record<string, unknown>>;
  };
  readonly signatureEnvelope: SignatureEnvelope;
}
```

Atgard:

- Signera aldrig "hela objektet" implicit. Signera en canonical, domain-separated payload.
- Lagga till `PromotionSignaturePayload` med `domain`, `mediaType`, `canonicalization`, `promotionCoreDigest`.
- Lagga till `ArtifactAttestation` for pipeline/runtime/policy/materials.
- Recovery L2 ska vara fail-closed nar signature policy sager `required: true`.

DoD:

- Forged signature over annan payload nekas.
- Saknad verifierare + required signatures ger audit-fel.
- Otillaten algoritm ger audit-fel.
- Attestationens materials matchar manifest descriptors.

## P2 - Merkle v2

Separera tva trad:

1. Ledger Merkle:
   - input: canonical LedgerEvent hashes
   - syfte: audit/history checkpoint

2. CAS Merkle:
   - input: sorted CAS object digests
   - syfte: storage checkpoint/bitrot-scope

Checkpoint-artefakter:

```text
checkpoint/ledger/<sequence>.json
checkpoint/cas/<timestamp-or-generation>.json
```

DoD:

- Ledger checkpoint kan verifieras utan att lasa hela CAS.
- CAS checkpoint kan verifieras utan ledger-kontext.
- Bada innehaller algorithm, createdAt, itemCount och rootHash.

## P2 - Recovery Levels v2

Formalisera:

| Level | Namn | SLA | Kontroller |
| --- | --- | --- | --- |
| L0 | Startup Fast Path | <1 s | ledger head finns, senaste checkpoint finns, CAS root finns |
| L1 | Structural Audit | minuter | refs, descriptor sizes, schema, lineage |
| L2 | Cryptographic Audit | timmar | alla hashes, signaturer, Merkle proof |
| L3 | Storage Scrub | bakgrund | streamad hash av hela object store, bitrot/quarantine |

DoD:

- `RecoveryOrchestrator.startupCheck()` gor aldrig full object walk.
- `structuralAudit()` laser manifest/descriptor-grafen men streamar inte alla objekt.
- `cryptographicAudit()` verifierar hashes/signaturer explicit.
- `storageScrub()` ar batchad, avbrytbar och checkpointad.
- `storageScrub()` anvander async generator + pool och haller minnesanvandning O(concurrency).

## P2 - Observability och drift

Matvarden:

- `cas_puts_total{result,algorithm}`
- `cas_gets_total{result,algorithm}`
- `cas_commit_total{result}`
- `cas_fsync_failures_total`
- `cas_verify_descriptor_total{digestValid,sizeValid,mediaTypeValid}`
- `ledger_append_total{result}`
- `ledger_idempotency_total{result}`
- `recovery_audit_duration_ms{level,status}`

Adapter:

- Infors `MetricsCollector` for CAS/recovery och en CAS-specifik `OpenTelemetryMetricsAdapter`.
- OTel-adaptern ska anvanda befintlig meter nar den finns, men vara no-op nar den saknas.
- In-memory metrics far bara lagra aggregerade histogram, inte obegransade timing-arrayer.

Kardinalitet:

- Inga raw hashes som metric labels.
- Hashar far ligga i structured logs med sampling och request/trace-id.

## P3 - Fault injection och produktionsbevis

Byt dokumentationssprak till "produktionsklassad arkitektur" tills dessa tester finns:

- kill/restart mellan temp write och commit
- kill/restart mellan commit och ledger append
- parallella workers med samma promotionHash
- simulerat `EEXIST`
- simulerat `EXDEV`
- simulerat directory fsync failure
- bitrot: andrat objektinnehall
- truncated object
- missing descriptor target
- tampered ledger previous hash
- forged signature
- forged SLSA attestation
- UUIDv7-kollision inom samma millisekund

Efter detta kan "produktionstestad" anvandas for den specifika backend/OS-matris som faktiskt testats.

## Rekommenderad leveransordning

1. P0A - `canonicalizeStrict` + hash-provider-kontrakt inklusive `-0`-normalisering.
2. P0B - `CommitStrategy` + `FileCASRepository` med strict/best-effort durability.
3. P1A - `CASDescriptor` + `verifyDescriptor`.
4. P1B - `MimersBrunnManifest` + manifest builder fran evolution output.
5. P1C - `LedgerEvent v2` + UUIDv7 + append-only verification.
6. P1D - `commitPromotion(idempotencyKey)` och retry-matris.
7. P1E - SLSA-liknande `ArtifactAttestation` + fail-closed signature audit.
8. P2A - Ledger Merkle checkpoint.
9. P2B - CAS Merkle checkpoint.
10. P2C - RecoveryOrchestrator L0-L3 med strommande storage scrub.
11. P2D - CAS OpenTelemetry adapter och metrics contract.
12. P3 - Fault injection suite och drift-runbooks.

## Acceptanskriterier for Fas 4

Fas 4 kan anses klar nar:

- Alla nya promotioner gar via CAS-backed manifest.
- Promotion commit ar idempotent.
- Ledger v2 kan verifiera hashkedjan fran genesis till head.
- Ledger-event anvander UUIDv7 och processmonoton event-id-generering.
- Manifest audit kontrollerar alla descriptors via `verifyDescriptor`.
- SLSA-liknande attestationer finns for nya promotioner och verifieras i L2.
- L0 startup check finns och gor ingen full scan.
- L1 structural audit hittar saknade refs och schemafel.
- L2 cryptographic audit verifierar hash/signaturer.
- L3 storage scrub kan hitta och karantanmarkera korrupta objekt.
- Dokumentation anvander "produktionsklassad" tills fault injection passerar.

## Risker att hantera tidigt

1. Windows vs Linux durability:
   Directory fsync och hardlink-semantik skiljer sig. Definiera supportmatris och gor strict-mode till explicit krav i produktion.

2. Migration fran `FileArtifactStore`:
   Befintliga JSON artifacts maste antingen adopteras som legacy eller importeras till CAS med manifest. Gor inte tyst migration utan auditrapport.

3. Hash-kontraktsbyte:
   Strikt canonicalization kan andra hashes for objekt som tidigare accepterade osakra typer. Krav: versionera hash/canonicalization i schema.

4. Idempotency race:
   Idempotency store maste sjalv vara atomic. Annars flyttas bara racet fran ledger till idempotency key.

5. Signaturdoman:
   Signaturpayload ska ha domain/mediaType/canonicalization/payloadDigest sa signaturer inte kan ateranvandas mellan artefakttyper.

6. OTel-gauge-semantik:
   En UpDownCounter ar inte en perfekt gauge-ersattare. Om OpenTelemetry SDK i aktuell runtime erbjuder ObservableGauge bor den anvandas for faktiska gauges.

7. SLSA-sprak:
   Kalla det "SLSA-inspirerat" tills provenance format, verifiering och builder identity faktiskt matchar vald SLSA-niva.

## Slutbedomning

Nuvarande Fas 3/4-kod ar en bra evolution-ledger/WORM-prototyp med flera ratt val: post-approval promotion creation, content-addressed V3 artifacts, approval separation, batch evaluation och persistent event chain.

For Mimers Brunn v9 Sovereign Hardening aterstar dock karnspranget: att flytta fran JSON artifact store till verifierbar CAS + manifest DAG + ledger v2 + recovery levels + SLSA-liknande attestering. Den viktigaste forsta optimeringen ar fortfarande att isolera CAS-durability i en egen CommitStrategy och lata alla senare invariants bygga pa den.
