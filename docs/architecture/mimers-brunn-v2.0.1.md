# Mimers Brunn v2.0.1 — Final Frozen Edition

| Field | Value |
| --- | --- |
| **Type** | DATA_GOVERNANCE_POLICY |
| **Status** | ACTIVE |
| **Authority** | Architecture Governance |
| **Revision** | 2.0.1 Integrity Clarification |
| **Version Date** | 2026-08-07 |

Supersedes: Mimers Brunn v1.0 (`mimers-brunn-offline-first.md` → LEGACY).

---

## 1. Authority

Mimers Brunn v2.0.1 definierar operativa data governance-regler för:

- harvesting
- arkivering
- versionering
- integritetsverifiering
- importdisciplin
- deterministisk datahantering

Dokumentet definierar **inte**:

- artifact identity
- execution semantics
- domain decisions
- systemets normativa sanning

Dessa styrs av:

- MPS Constitution
- LU Architecture Charter v1.1
- ArtifactContract
- Replay Invariant Checklist

---

## 2. Purpose

Offentlig miljödata är flyktig. API:er, WMS/WFS-tjänster och PDF-länkar ändras eller försvinner.

Beslut ska därför baseras på lokalt ägd, versionerad och verifierad data.

Mimers Brunn v2.0.1 är plattformens offline-first och determinism-policy:

- rådata ägs lokalt
- versioner bevaras
- integritet bevisas
- import är deterministisk
- PostGIS är en projektion, inte en sanningskälla
- LU-kedjan reproducerar beslut som uppfyller samma normativa invariants

---

## 3. Canonical Data Flow

```text
External Authority
        ↓
HarvestManifestArtifact
        ↓
VerificationEvidenceArtifact
        ↓
DatasetApprovalArtifact
        ↓
PostGIS Projection
        ↓
LU Execution Artifact
```

`GEO_Master_Archive` är det första persistenta källagret för externa dataunderlag.

---

## 4. Core Principles

### 4.1 Download-first

Live-API:er får användas för discovery och visualisering.

De får inte vara permanent source of truth.

### 4.2 Archive-first

Data ska arkiveras innan den används i PostGIS eller LU.

### 4.3 Version Preservation Model

`GEO_Master_Archive` bevarar versioner genom immutable version directories:

- no-overwrite policy
- manifest history tracking
- collision detection

Filsystemssökvägar är inte identitet.

Content identity för harvested source data etableras genom SHA-256 integritetsverifiering.

Artifact identity styrs alltid av plattformens ContentReference-modell.

#### 4.3.1 Version Collision Handling

Version creation SHALL be collision-safe:

- target version identifier kontrolleras
- befintliga versioner skrivs aldrig över
- kollisionsförsök avvisas
- misslyckade försök loggas som evidence

Collision handling är preventiv, inte retrospektiv.

### 4.4 Content Verification

SHA-256 representerar content integrity för harvested source data.

`archivePath` och `runtimePath` är operativ metadata och är explicit exkluderade från canonical identity-beräkningar.

Innan import:

- hash beräknas om
- hash måste matcha manifest
- mismatch → `QUARANTINED`

### 4.5 Deterministic Chunking

Chunkning ska vara deterministisk och byte-offset-baserad.

### 4.6 Provenance

Varje import ska kunna spåras till:

- provider
- dataset
- version
- hash
- manifest
- lifecycle state

### 4.7 Reference Integration

Harvested data som konsumeras av LU ska refereras via ContentReference.

Paths är operativ metadata och deltar inte i identity, replay eller execution semantics.

---

## 5. Lifecycle State Model

Tillåtna states:

- `HARVESTED`
- `VERIFIED`
- `APPROVED`
- `REJECTED`
- `IMPORTED`
- `QUARANTINED`

### 5.1 Lifecycle Transition Authority

**Automated**

`HARVESTED` → `VERIFIED` när:

- manifest finns
- SHA-256 verifiering lyckas
- arkivintegritet passerar

**Governed**

`VERIFIED` → `APPROVED` / `REJECTED` kräver:

- `ActorReference`
- `decision_at`
- `decision`
- `reason`
- `approved_ref`

Harvest får inte skapa `APPROVED`/`REJECTED`.

**Failure**

Any → `QUARANTINED` vid integritetsfel.

---

## 6. ApprovalAuthorizedRoles

```text
ApprovalAuthorizedRoles = { HUMAN_OPERATOR, GOVERNANCE_REVIEWER }
```

`SYSTEM_PROCESS` och `EVOLUTION_AGENT` är inte godkända roller.

---

## 7. DatasetApprovalArtifact (CanonicalArtifact)

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

### Invariants

- `approved_ref` → HarvestManifestArtifact
- `actor_ref.role` ∈ ApprovalAuthorizedRoles
- `actor_ref` ≠ manifest producer
- `decision` ∈ { APPROVED, REJECTED }
- `APPROVED` → import allowed
- `REJECTED` → import blocked

---

## 8. GEO_Master_Archive Structure

```text
GEO_Master_Archive
  \Rasters\<Provider>\<Dataset>\
  \Vectors\<Provider>\<Dataset>\
  \Documents\Sources\<Provider>\<Dataset>\
  \Data\<Provider>\<Dataset>\
  \_review\
  \_manifests
  \_logs
  \_quarantine
  \_temp
```

Legacy paths är migrationskällor.

---

## 9. Harvesting Contract

### 9.1 Versioning

Varje hämtning lagras under tidsstämplad katalog.

### 9.2 Polite Scraping

- User-Agent
- concurrency-begränsning
- jitter/delay
- bounded retries
- checkpoints

### 9.3 Integrity Evidence

Manifest paths är identity-excluded operational metadata.

---

## 10. Deterministic Chunking

### 10.1 Rules

Chunkning ska vara:

- deterministisk
- byte-offset-baserad
- stabil i ordering
- SHA-256 per chunk

### 10.2 Parameters

```text
max_chunk_size_mb: 256
stable_ordering: true
hash_per_chunk: sha256
```

---

## 11. PostGIS Import Rules

Import tillåts endast om:

- DatasetApprovalArtifact finns
- `decision == APPROVED`
- `approved_ref` resolves
- hash matchar manifest
- `actor_ref.role` ∈ ApprovalAuthorizedRoles
- `actor_ref` ≠ harvest producer
- MB-001–MB-006 passerar

Runtime path:

```text
/mnt/geo_master_archive
```

---

## 12. Compliance Domain

| Control | Verifies | Evidence | Owner |
| --- | --- | --- | --- |
| MB-001 | Archive lifecycle | archive-manifest.json | Harvest |
| MB-002 | Hash verification | hash-verification.json | Harvest |
| MB-003 | Version preservation | version-history.json | Harvest |
| MB-004 | Runtime validation | mount-validation.json | Infra |
| MB-005 | Chunk determinism | chunk-verification.json | Harvest |
| MB-006 | Approval integrity | dataset-approval.json | Governance |

---

## 13. Legacy Status

Mimers Brunn v1.0 → **LEGACY**.

---

## 14. Summary

Mimers Brunn v2.0.1:

- gör Harvest deterministisk
- gör PostGIS reproducerbar
- gör LU certifierbar
- gör replay verifierbar
- gör provenance komplett
- gör externa datakällor revisionsbara
- integreras korrekt med MPS/LU identity
- förhindrar self-approval
- möjliggör CI-verifiering av hela kedjan

Det är den saknade länken mellan externa datakällor och den deterministiska artefaktvärlden.
