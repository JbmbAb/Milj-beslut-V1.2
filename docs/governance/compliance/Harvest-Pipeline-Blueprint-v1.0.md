# Harvest Pipeline Blueprint v1.0 (Optimized & Final)
Type: OPERATIONAL BLUEPRINT  
Status: ACTIVE  
Authority: Architecture Governance  
Normative Basis: Mimers Brunn v2.0.1, MB-001–MB-006, DatasetApprovalArtifact, ImportGate  
Version Date: 2026-08-07  

## 1. Purpose and Scope
This document describes how the components frozen by Mimers Brunn v2.0.1 and its associated compliance controls are orchestrated end-to-end, from external data acquisition through LU execution readiness.

This document introduces no new rules, invariants, or artifact types. Every identity rule, reference rule, lifecycle rule, and compliance control referenced here is owned elsewhere:

| Concern | Owning document |
| :--- | :--- |
| Data governance policy | Mimers Brunn v2.0.1 |
| Artifact identity | MPS-CORE / ArtifactContract |
| Approval authority | Mimers Brunn v2.0.1 §6–7 |
| Compliance verification | MB-001–MB-006 |
| Import enforcement | ImportGate |

If anything in this blueprint appears to conflict with one of the above, the owning document governs and this blueprint is in error.

## 2. End-to-End Flow
```
External Authority
        |
        v
   Harvest Job
        |
        v
HarvestManifestArtifact  ──────────────►  GEO_Master_Archive
        |
        v
  Verification Step
        |
        v
VerificationEvidenceArtifact
        |
        v
  Governance Review
        |
        v
DatasetApprovalArtifact  (APPROVED | REJECTED)
        |
        v
  MB-001 .. MB-006
  (Compliance Verification)
        |
        v
      ImportGate
        |
        +── BLOCK_IMPORT ──► ImportGateEvidenceArtifact ──► Quarantine / Review / Archive
        |
        +── ALLOW_IMPORT ──► ImportGateEvidenceArtifact ──► PostGIS Import
                                                                    |
                                                                    v
                                                          PostGIS Projection
                                                                    |
                                                                    v
                                                          LU Execution Artifact
```

Every arrow in this diagram is either a content-addressed reference (ContentReference) or a materialization of an immutable artifact into storage. No arrow represents a mutable database row, an in-memory handoff, or an implicit filesystem convention.

## 3. Stage-by-Stage Responsibility

### 3.1 Harvest Job
*   **Owner:** Harvest domain
*   **Produces:** HarvestManifestArtifact, archived source bytes under GEO_Master_Archive

**Responsibilities:**
*   Acquire data under polite-scraping constraints (Mimers Brunn §9.2).
*   Write harvested bytes to a timestamped, collision-safe version directory (§4.3.1).
*   Compute SHA-256 over archived bytes and populate the manifest (§9.3).
*   Set lifecycleState: "HARVESTED".

**Non-responsibilities:**
*   SHALL NOT set VERIFIED, APPROVED, or REJECTED.
*   SHALL NOT perform deterministic chunking.

### 3.2 Verification Step
*   **Owner:** Harvest domain (automated)
*   **Produces:** VerificationEvidenceArtifact  
*   **Effect:** Establishes verification evidence for the HARVESTED manifest and permits lifecycle progression to VERIFIED according to Mimers Brunn §5.1.

**Responsibilities:**
*   Recompute SHA-256 over archived bytes.
*   Perform deterministic chunking (§4.5/§10).
*   Confirm archive integrity.
*   Failed verification → QUARANTINED (terminal).

### 3.3 Governance Review
*   **Owner:** Governance domain (human)
*   **Produces:** DatasetApprovalArtifact  
*   **Effect:** Allows transition VERIFIED → APPROVED or VERIFIED → REJECTED.

**Responsibilities:**
*   Reviewer must hold authorized role.
*   Reviewer must be independent of producer.
*   Approval must reference manifest via ContentReference.
*   This is the only human-gated step.

### 3.4 Compliance Verification (MB-001–MB-006)
*   **Owner:** Compliance domain (automated)
*   **Produces:** ComplianceCheckResult[] (not necessarily canonical artifacts)

| Control | Verifies |
| :--- | :--- |
| MB-001 | Archive lifecycle consistency |
| MB-002 | Hash correctness |
| MB-003 | Version preservation & collision safety |
| MB-004 | Runtime environment validity |
| MB-005 | Deterministic chunking correctness |
| MB-006 | Approval integrity |

A valid REJECTED approval is not a compliance failure.

### 3.5 ImportGate
*   **Owner:** Import domain (automated)
*   **Produces:** ImportGateEvidenceArtifact  
*   **Decision:** ALLOW_IMPORT or BLOCK_IMPORT

**ImportGate performs:**
*   Reject if approval missing.
*   Reject if approval_ref ≠ manifest_ref (full hash match).
*   Reject if any MB control FAILs.
*   Reject if decision ≠ APPROVED.
*   Otherwise allow.

Every outcome produces signed evidence.

**Routing:**
| Reason | Routing |
| :--- | :--- |
| Missing approval | Governance review |
| Reference mismatch | Governance review |
| MB control FAIL | Governance review |
| Valid REJECTED | Archive (not quarantine) |

### 3.6 PostGIS Import
*   **Owner:** Runtime import domain
*   **Consumes:** ALLOW_IMPORT evidence only

*   Vectors imported from immutable archive.
*   Rasters registered via out-of-DB links.
*   Runtime mount path is operational metadata only.
*   PostGIS SHALL consume only immutable archive references.
*   Any mutable storage boundary SHALL perform integrity verification before materialization.
*   ALLOW_IMPORT authorizes import; it does not waive integrity verification duties.

### 3.7 LU Execution
*   **Owner:** Runtime domain (Package 21)
*   **Consumes:** PostGIS projection via ContentReference.

From here, MPS-CORE replay and identity rules govern execution.

## 4. Evidence Chain Summary
Every governance-significant stage produces immutable evidence or artifacts. Canonical artifact production is defined by the owning specification.

**Chain:**
```
HarvestManifestArtifact
        ▼
VerificationEvidenceArtifact
        ▼
DatasetApprovalArtifact
        ▼
ComplianceCheckResult[]
        ▼
ImportGateEvidenceArtifact
        ▼
PostGIS Projection / LU Execution Artifact
```
An auditor can walk backward from ImportGateEvidenceArtifact to the original source.

## 5. Failure Handling Summary
| Failure | Result | Recoverable |
| :--- | :--- | :--- |
| Verification hash mismatch | QUARANTINED | No |
| Version collision | Write rejected | Yes |
| Unauthorized approval | Approval creation refused | Yes |
| MB control FAIL | BLOCK_IMPORT → review | Depends |
| Valid REJECTED | BLOCK_IMPORT → archive | No |

## 6. Replay Considerations
Verification and compliance checks are re-runnable deterministic computations — re-running them against the same archived bytes SHALL produce the same PASS/FAIL results. Governance decisions and enforcement decisions (DatasetApprovalArtifact, ImportGateEvidenceArtifact) are replayed from stored artifacts, not re-executed.

This matches Replay Constitution.

## 7. Non-Goals
No new artifacts, controls, retry logic, or UI.

## 8. Summary
The blueprint maps an already-closed governance system.
No new authority is created; all decisions are governed by previously frozen specifications.
