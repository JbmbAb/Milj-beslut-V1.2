# DOCUMENT-EVIDENCE-CANONICAL-ADMISSION-V1 — STOP: property_ref binding gap (read-only record)

```
Document class:    MODEL CHECK (read-only)
Program parent:    DOCUMENT-EVIDENCE-VERTICAL-SLICE-V1, Unit E
Prior checkpoint:  DOCUMENT-FACT-HUMAN-VERIFICATION-APPROVED-V1, commit 7a6f919f
Status:            STOPPED — no admission code written. Owner decision: STOP (2026-08-24).
```

Unit E was ordered to construct one canonical `DocumentEvidenceArtifact` for the already-verified
fact `fact-verified-8386a613c27e89efa9d4bf2e` and admit it through a governance-owned CAS path.
Phase A recon (contract/authority inspection, no code written) surfaced a real, mandatory-field
gap before any admission code was written. Per the unit's own stop condition — "if a semantic
field required for trustworthy identity is missing, STOP and report the gap before persisting a
misleading artifact" — this is reported instead of worked around.

## What recon found (the good part)

- `DocumentEvidenceMaterializer` (`packages/mps-lu/src/ingestion/QuarantinePromoter.ts`) is
  already correctly shaped for this unit: pure, no I/O, real deterministic `content_hash` via
  `sha256ContentHash(payload)` (RFC 8785 canonical JSON). Its own doc comment already anticipates
  Unit E: CAS persistence requires "the governed promotion path", explicitly "a separate,
  not-yet-built work unit."
- `DocumentEvidenceService.ts` is confirmed `KNOWN_BROKEN` / `FORBIDDEN_FOR_CANONICAL_LU`
  (`Math.random()` artifact_id, `content_hash: { value: "uncalculated" }`) and has **zero
  runtime callers anywhere in the repo** — its only consumer, `LUBackendOrchestrator`, is never
  instantiated outside its own file. A governance admission gate that independently recomputes
  `content_hash` and rejects any mismatch rejects `"uncalculated"` by construction; no separate
  patch to that file is required to contain it.
- No generic "admit an already-built canonical artifact to CAS" mechanism exists yet outside
  `QuarantinePromoter` (raw-bytes-specific). `createArtifactAttestation` /
  `verifyArtifactAttestation` (`mimers-brunn-core`) are generic enough (predicateType is any
  string) to reuse for a new `document-evidence-admission` predicate, mirroring the real
  ADR-042 Level 2 discipline. The correct home is `mps-data-governance` — `mps-lu` already
  depends on it (see `mps-lu/tests/fixtures/verifiedDocumentFact.ts` importing
  `DocumentFactArtifact` from there) and it never depends back on `mps-lu`, so building the
  admission gate there preserves ADR-27 without inverting the dependency graph.

## The gap

`DocumentEvidenceArtifact.payload.property_ref: ArtifactReference`
(`packages/mps-lu/src/artifacts/DocumentEvidenceArtifact.ts:50`) is **mandatory**, not optional.

The real mechanism for a governance-known property is `CanonicalPropertyGeometryArtifact`
(`packages/mps-lu/src/artifacts/CanonicalPropertyArtifacts.ts`), built from a real cadastral
lookup (Lantmäteriet fastighetsbeteckning).

The real MMOD document's own text never discloses a fastighetsbeteckning — only "fastigheten i
Bollnäs kommun" and "Fastigheten omfattar 92 ha" (see the approved fact's own source span,
`fact-candidate-219b881f9647de06419af0df`). There is nothing to look up. No real, non-fabricated
`property_ref` is available for this specific document.

## Why this was not worked around

Three options were considered and put to the real owner:

1. **Fabricate a lightweight property_ref anyway** (even one explicitly labeled
   "unresolved" or "as described in document") — rejected before even being offered as the
   default, because it repeats exactly the failure mode the first candidate rejection already
   demonstrated: inventing a binding that isn't actually there, dressed as evidence.
2. **Relax `property_ref` to optional** — would touch the frozen `DocumentEvidenceArtifact`
   contract. Not a call this session may make unilaterally; it is an owner-level decision about
   a frozen contract, not an implementation detail.
3. **Stop and report.** — **chosen.**

## Status

```
DOCUMENT-EVIDENCE-CANONICAL-ADMISSION-V1   STOPPED at Phase A (contract/authority recon)
Admission code                             NOT WRITTEN
CAS write                                  NOT ATTEMPTED
fact-verified-8386a613c27e89efa9d4bf2e     unchanged, still the last real checkpoint
```

## What would unblock this

Either a real cadastral lookup becomes available for this specific property (unlikely from this
document alone — the source text itself doesn't carry it), or the owner makes an explicit,
recorded decision to widen `DocumentEvidenceArtifact.payload.property_ref` to optional for
evidence that is not yet bound to a specific LU project's property (this evidence is not being
wired into LU in Unit E regardless). Either path is a new, separate, not-yet-started decision —
not something to default into here.
