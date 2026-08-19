# F0D — Minsta SourceRegistry-kontrakt (Tier 1-materialisering)

> ```
> Status:            🔒 FROZEN 2026-08-11
> Program parent:    P2 (Governed source → corpus ingestion)
> Program authority: P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> Closes:            P1 contract closure
> Does NOT close:    P1 enforcement proof (A1 red test) — separate gate
> ```
>
> **Konsistensverifiering utförd före frysning** (villkor för frysningen):
>
> | Kontroll | Resultat |
> |---|---|
> | Auktoritetsbegrepp mot `mimers-brunn-v3.0.0` | ✅ Dokumentet anger v3.0.0 §3.1 Tier 1 som auktoritet och uppfinner ingen egen registry-modell. 12 explicita Tier-referenser. |
> | `lifecycle_state` mot v3.0.0 §8 | ✅ Använder `REGISTERED`/`APPROVED`/`REJECTED`/`QUARANTINED` — en **äkta delmängd** av v3.0.0:s åtta states. `HARVESTED`/`VERIFIED`/`CLASSIFIED`/`IMPORTED` är states för *material* i Tier 2–5, inte för en registerpost, och är korrekt uteslutna. |
> | Arkivbegrepp mot F0B | ✅ Ingen egen arkivstruktur definieras. `HarvestProvenanceRecord` placeras i Tier 2 enligt v3.0.0 §3.2. |
> | ADR-27 ("Governance aldrig dupliceras") | ✅ Återanvänder `createArtifactAttestation`/`verifyArtifactAttestation`/`LocalPemSigningKeyProvider` från `mimers-brunn-core`. Inget nytt signeringssystem; egen `key_id` endast för blast-radius-isolering, samma mönster som `legalCorpusSigningKey.ts`. |
> | Ingen agent godkänner egna poster (v3.0.0 §5) | ✅ `approver_role` har exakt ett giltigt värde (`GOVERNANCE_REVIEWER`). |

Status: **FROZEN — normativ text. Ingen kod skriven.**

Ersätter i praktiken den ofrysta `SCHEMA-CONVERGENCE-SPEC 2026-08-11` i
`GAP-REPORT-harvest-governance-2026-08-10.md` genom att (a) förankra den i rätt auktoritet och
(b) skala ned den till det minsta frysbara kontraktet. Den äldre specens fulla V2-omfång
behålls som referens men är **inte** det som fryses här.

**Auktoritet:** `mimers-brunn-v3.0.0.md` (ACTIVE) §3.1 Tier 1 Source Registry.
Detta dokument uppfinner ingen ny registry-modell — det materialiserar v3.0.0:s Tier 1.

---

## 1. Varför minimalt

Task #19 är befordrad till `PRE_PROOF_SPLIT_BLOCKER`. Syftet med F0D är därför **inte** att
specificera hela harvest-arkitekturen, utan att låsa det minsta kontrakt som gör att
`server/modules/harvest/source-registry/registry.ts` kan sluta vara en självständig auktoritet
och bli en **verifierad materialisering** — så att proof-splitten kan frysas.

Allt som inte krävs för den övergången är uttryckligen uppskjutet (§6).

---

## 2. Tre korrigeringar mot den tidigare specen

Reconciliationen mot v3.0.0 hittade tre punkter där `SourceRegistryArtifactV2` (som den skrevs
2026-08-11) inte uppfyller Tier 1:

**C1 — Producent och distributionskanal måste modelleras separat.**
v3.0.0 §4: *"Källproducent och distributionskanal ska modelleras separat. Olika källor har helt
olika semantik och bevisvärde."* Den tidigare specen har `producer` men blandar in kanalen i
`source_type`/`endpoint_url`. Samma dokument (t.ex. en MÖD-dom) kan nås via domstolens egen
webbplats och via en dataportal — med olika bevisvärde. Kontraktet måste kunna uttrycka det.

**C2 — `checksum`/`ETag` saknas.**
v3.0.0 §3.1 räknar uttryckligen upp *"Checksum/ETag?"* bland det Tier 1 ska svara på. Den
tidigare specen utelämnar det helt. Utan det kan en oförändrad källa inte skiljas från en
ändrad utan full omhämtning.

**C3 — Lifecycle-state måste bindas till v3.0.0 §8.**
Tillåtna states är redan frysta: `REGISTERED` → `HARVESTED` → `VERIFIED` → `CLASSIFIED` →
`APPROVED` → `IMPORTED`, plus `REJECTED` och `QUARANTINED`. Registret får inte införa egna
statusnamn (samma felmönster som `doc.status = 'INDEXED'` i den gamla PHASE 1-6-skissen).

---

## 3. Det frysbara minimikontraktet

```
SourceRegistryArtifact (Tier 1-post, materialiseras till runtime)

  source_id: string                       // stabil nyckel

  producer: {                             // VEM publicerar (C1)
    producer_id: string
    name: string
    type: "court" | "county_board" | "municipality" | "agency" | "other"
  }

  channel: {                              // HUR den distribueras (C1) — separat från producent
    channel_type: "WMS"|"WFS"|"API"|"WEBSITE"|"FTP"|"DATASET_PORTAL"
    endpoint_url?: string                 // saknas för adaptrar som crawlar en domän (MMD)
    allowed_domains: string[]             // den faktiska säkerhetsgrinden
  }

  adapter: string                         // execution dispatch — INTE UI-metadata
  artifact_types: string[]
  collection_frequency: "HOURLY"|"DAILY"|"WEEKLY"|"MONTHLY"|"YEARLY"|"ON_DEMAND"

  change_detection: {                      // C2 — v3.0.0 §3.1 "Checksum/ETag?"
    strategy: "ETAG" | "LAST_MODIFIED" | "CONTENT_HASH" | "NONE"
    // NONE är tillåtet men måste vara ett medvetet val, inte ett utelämnande
  }

  policy: {                                // v3.0.0 §3.1, per producent
    rate_limit_requests_per_second: number
    concurrency_limit: number
    politeness_delay_ms?: number
    max_object_size_bytes?: number
    retry_policy: { max_attempts: number; backoff: "EXPONENTIAL"|"FIXED" }
  }

  geographic_scope?: string
  lifecycle_state: "REGISTERED"|"APPROVED"|"REJECTED"|"QUARANTINED"   // C3, delmängd av v3.0.0 §8
  approval_attestation: ArtifactAttestation
}
```

**Signering:** återanvänder `createArtifactAttestation`/`verifyArtifactAttestation`/
`LocalPemSigningKeyProvider` från `mimers-brunn-core`. Inget nytt signeringssystem.
`predicateType: "mimers-brunn/source-registry-approval/v1"`. Egen `key_id`/env-block, skild
från promotion- och legal-corpus-nycklarna (blast radius-isolering — samma mönster som
`legalCorpusSigningKey.ts`).

```
SourceApprovalAttestationPredicate {
  action: "source.approve"
  source_id: string
  source_content_hash: string      // hash över producer, channel, adapter, artifact_types,
                                   // collection_frequency, change_detection, policy,
                                   // geographic_scope — ordnad, kanoniskt serialiserad
  approver_actor_id: string
  approver_role: "GOVERNANCE_REVIEWER"
  attestation_schema_version: number
  signer_key_id: string
}
```

`subjectDigest = sha256:<source_content_hash>`.

**Ingen agent godkänner sina egna poster** (v3.0.0 §5; ADR-DRAFT-Source-Registry-Pipeline steg
5). `approver_role` har exakt ett giltigt värde.

---

## 4. G1-resten: hämtningens responsfält hör INTE hemma här

F0A/F0B lämnade en rest: HTTP-status, MIME, storlek per hämtning. **Dessa tillhör inte
`SourceRegistryArtifact`** — registret beskriver en godkänd källa, inte en enskild hämtning.
De hör hemma i harvest-/provenance-posten (Tier 2 Raw Archive, v3.0.0 §3.2 "SHA-256 + källa +
datum + provenance").

Minimikrav på varje hämtningspost, fastställt här för att resten ska vara stängd:

```
HarvestProvenanceRecord (Tier 2)
  source_id, registry_artifact_id      // vilken godkänd källa och vilken version av den
  requested_url, http_status, mime_type, content_length_bytes
  content_hash                          // SHA-256 på ORIGINALBYTES, före all bearbetning
  fetched_at, attempt_number
  outcome: "STORED" | "QUARANTINED"
  quarantine_reason?                    // obligatorisk iff QUARANTINED
```

Detta är en konsekvens av v3.0.0 §3.2, inte ett nytt krav.

---

## 5. Enforcement-invariant (oförändrad från tidigare spec — fortfarande rätt)

```
Ingen verifierad SourceRegistryArtifact (giltig approval_attestation)
        │  fail-closed vid materialisering
        ▼
Ingen VerifiedSourceDefinition
        │  createHarvestPlan() kan typmässigt inte anropas utan denna
        ▼
Inget HarvestPlan (eller ett vars egen attestation inte verifierar)
        │  executeLokeHarvestForSource() vägrar köra — före adapter-instansiering
        ▼
Ingen adapter-dispatch
        ▼
Ingen nätverks-I/O
        ▼
Ingen quarantine-write
```

`policy`-blocket flödar genom hela kedjan: governance-artefakt → materialiserad
`SourceDefinition.policy` → planens budgets → faktiskt tillämpad `politeness_delay_ms` mellan
`fetch()`-anrop.

**Två arkitekturtester krävs innan implementationen anses klar** (oförändrade):

1. **Snapshot-immutabilitet** — ändra registerposten efter planskapande; kör planet; resultatet
   ska följa den bundna snapshoten, inte den nya posten.
2. **Tamper-before-network** — mutera `adapter` eller `allowed_domains` post-signering; anropa
   `executeLokeHarvestForSource(tamperedPlan)`; assertion: `fetch` anropas **noll gånger**,
   mätt direkt på spionen.

Tillkommer från v3.0.0:

3. **No-AI-filtering** — en källa klassad "irrelevant" måste ändå hämtas och arkiveras; endast
   Tier 4-befordran får utebli, och då med fullständig exkluderingsmetadata (`source_id`,
   `inventory_id`, `policy_version`, `classification`, `decision`, `reason_code`, `decided_at`,
   `decided_by`, `raw_reference`). Testar v3.0.0 §2/§3.4/§5.

---

## 6. Uttryckligen UTANFÖR detta minimikontrakt

Uppskjutet för att hålla kontraktet frysbart nu:

- **Fake-HMAC-borttagningen** i `harvestPlan.ts` (`'mimer-secret-harvest-key'`) och
  `harvestLedger.ts:36`s falska "laddat och verifierat"-logg. Kvarstår som kända defekter —
  åtgärdas i implementationen, kräver ingen egen kontraktstext.
- **`national-registry.json`s öde** (deprecation vs migrering) — kräver separat beslut.
- **Per-reviewer-nycklar / non-repudiation**, nyckelrotation, `mps-governance`s
  `ActorArtifact`/`TrustAnchor` — samma scope-disciplin som Level 2.
- **Tier 3-5-detaljer** (Inventory-schema, Knowledge Corpus-urvalspolicy, domänindex).
  `mps-legal-corpus` är redan Tier 5-implementationen för legal och är PROVEN v1.

---

## 7. Vad frysning av detta låser upp

1. `source-registry-runtime` kan gå från `UNPROVEN / RUNTIME_PROJECTION_UNVERIFIED` till att ha
   ett definierat kontrakt att materialiseras mot → `blocker_class: PRE_PROOF_SPLIT_BLOCKER`
   kan lyftas.
2. Codex F3B (proof-lanes) blir möjlig att frysa.
3. FAS 4 (masterarkiv/pipeline) får ett fryst Tier 1 att bygga mot, tillsammans med F0B:s
   slutsats att v3.0.0 redan är arkivkontraktet.

**Kvar efter detta innan FAS 1:** endast F0C (spårning av F4/F8/F9), som är Codex-lane.
