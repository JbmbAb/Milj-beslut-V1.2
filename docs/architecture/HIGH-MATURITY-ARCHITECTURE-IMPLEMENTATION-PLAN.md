# High-Maturity Architecture Implementation Plan

> ```
> Program status:                    SUBSUMED  (2026-08-11)
> Program authority:                 P0–P8  →  PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> Local purpose:                     execution detail only
> May define local steps:            YES
> May redefine program dependencies: NO
> May redefine PROVEN semantics:     NO
> May redefine authority boundaries: NO
> ```
>
> Workstreams A–E behåller sitt innehåll men är **inte längre en roadmap-authority**. Mappning:
> A → P1, B → P1, C → P2, D → P7, E → P4B/HC-S1. Beroenden mellan program­noder definieras
> uteslutande i P0–P8-dokumentet.

Status: SUBSUMED (tidigare "ACTIVE TRACK, started 2026-08-11").

Purpose: move the whole platform from "strong core, split product architecture" to a high-maturity architecture where every authority boundary is canonical, testable, and connected to the live path.

This plan does not authorize full reindexing, broad data harvesting, production rollout, or deletion of legacy code. Each implementation step must be small, reviewed, and proven with focused tests before the next layer is built on top.

## Maturity Target

Target state:

- One canonical promotion authority for quarantine-to-CAS writes.
- One canonical source-registry authority for approved harvesting.
- One canonical approval/attestation mechanism reused across governance flows.
- Live runtime paths consume verified artifacts or verified materializations, not parallel hand-written models.
- Legacy implementations are either adapted, blocked from live use, or explicitly archived.
- Every PROVEN claim names the exact test, command, or external evidence that proves it.

## Current Baseline

PROVEN:

- Level 1 containment: live governance promote/reject routes require authenticated ADMIN access and derive the actor server-side.
- Level 2 crypto promotion authority: `mimers-brunn-core` `QuarantinePromoter.promote()` requires a signed `ArtifactAttestation` and verifies all operation bindings before any CAS write.
- `mps-data-governance` ImportGate role enforcement and `FileCheckpointStore.loadApproval()` hash/signature verification are Windows-proven, but this package is not the live governance route.
- Mimers Brunn integrity core has broad proof coverage: CAS integrity, ledger/replay, backup/restore, fault detection, WORM behavior, durability matrix, and offline verification.

Open:

- Architecture convergence across parallel approval/promotion/governance implementations.
- Source registry convergence: live `SOURCE_REGISTRY` is hard-coded runtime data, while artifact-shaped registry code is separate and not the live authority.
- Individual actor authority: `mps-governance` has `ActorArtifact`/`TrustAnchor` concepts but is not yet audited as a live trust root.
- Route surface classification: non-mutating governance read routes remain outside the containment fix and need separate exposure review.
- External signoff remains UNPROVEN.

## Workstreams

### A. Authority Map and Guardrails

Goal: make authority ownership explicit before deeper refactors.

Tasks:

- Maintain `docs/architecture/architecture-authority-map.jsonc` as the current machine-readable authority register.
- Add tests that verify canonical authority files exist and known legacy implementations are not wired into live server routes.
- Add new authority entries only through reviewed architecture changes.

Exit gate:

- Authority map test is green.
- Each authority entry has one of: `canonical`, `legacy`, `candidate`, `deprecated`.

### B. Promotion Authority Convergence

Goal: prevent any quarantine-to-CAS write from bypassing Level 2 attestation binding.

Tasks:

- Keep `packages/mimers-brunn-core/src/governance/DatasetApproval.ts` as canonical for live quarantine promotion.
- Audit `packages/mps-lu/src/ingestion/QuarantinePromoter.ts` and decide: adapt to canonical attestation, rename as LU-local evidence materializer, or mark deprecated. Decision started 2026-08-11: primary export is now `DocumentEvidenceMaterializer`; `QuarantinePromoter` remains only as deprecated compatibility alias.
- Audit `packages/mps-data-governance` approval/import concepts and decide whether they become adapters into the canonical authority or remain isolated.
- Audit `packages/mps-governance` actor/trust-anchor model before using it for Level 3 individual authority.

LU residual note, 2026-08-11: the focused LU ingestion/materializer proof is green, but broader LU E2E tests are not a valid exit gate for this rename yet. `packages/mps-lu/tests/LUEndToEnd.test.ts` and `packages/mps-lu/tests/VerticalProof.test.ts` currently fail on existing LU behavior/provenance expectations (`findings` count and missing `viewer_identity_ref`), not on governance-route wiring. Treat those as a separate LU-hardening track before claiming LU vertical maturity.

Exit gate:

- No live server route imports a non-canonical `QuarantinePromoter`.
- Legacy promoter tests either prove local-only scope or are rewritten against the canonical authority.
- Gap report updated with canonical/legacy decisions.

### C. Source Registry and Harvest Plan Convergence

Goal: harvesting must start from a verified source approval, then a verified plan, before any network I/O.

Tasks:

- Implement `SourceRegistryArtifactV2` or equivalent canonical source-entry artifact.
- Materialize verified source artifacts into runtime `SourceDefinition` objects.
- Replace direct `SOURCE_REGISTRY` execution with verified materialization.
- Make `HarvestPlan` the sole executable description of a harvest run.
- Remove hard-coded HMAC pseudo-signatures from harvest planning.
- Add two required architecture tests: snapshot immutability and tamper-before-network.

Exit gate:

- No `discover()` or `fetch()` can run before source approval and plan attestation verification.
- `allowed_domains`, adapter dispatch, policy/rate limits, and source snapshot come from the verified materialization.

### D. Product/API Boundary Cleanup

Goal: product architecture becomes readable and maintainable, not just functionally broad.

Tasks:

- Version governance routes and classify each endpoint: mutating, sensitive read, public read, internal-only. Started 2026-08-11 with `docs/architecture/governance-route-exposure-matrix.jsonc` and `tests/unit/governanceRouteExposureMatrix.test.ts`.
- Move route collaborators behind explicit factories or dependency injection where tests currently mock package boundaries.
- Split mixed API/UI/server responsibilities where active product flows depend on them.

Exit gate:

- Governance route exposure matrix exists and is tested against the actual `governance.routes.ts` route declarations.
- Mutating routes have explicit auth, authorization, rate limit, and audit policy.
- Sensitive reads are either authenticated or documented as intentionally public.

### E. Data Coverage and Operational Proof

Goal: keep data coverage factual and avoid destructive rework.

Tasks:

- Treat `docs/architecture/data-coverage-gaps.md` as advisory until confirmed by DB `COUNT(*)`.
- Do not run full reindexing or broad harvesting without explicit approval.
- Keep manifests, hashes, source evidence, quarantine records, and approval artifacts linked.

Exit gate:

- Any new ingestion path has provenance, manifest, negative tests, and a human approval gate.
- Coverage claims name the verifying query or manifest.

## Sonnet/Tor Implementation Commitments

Sonnet/Tor may implement pipeline work, but every pipeline task must include:

- Download/retry/idempotency behavior.
- Raw archive write before transformation.
- Stable manifest with source URL, timestamp, hash, pipeline version, and source registry reference.
- Deterministic chunking with stable chunk IDs and source position/page references.
- Sorting/classification without silent source filtering.
- Quarantine for uncertain or malformed data.
- Approval gate before canonical corpus import.
- Negative tests for hash mismatch, schema mismatch, missing source, duplicate input, tampered manifest, and wrong approval.
- Windows verification before any claim is marked PROVEN.

Sonnet/Tor must not:

- Introduce a new authority model when `ArtifactAttestation` is applicable.
- Treat self-declared role fields as authority.
- Write to CAS from quarantine without the canonical promotion authority.
- Start full reindexing or broad harvesting without explicit approval.

## Immediate Next Steps

1. Land the authority map and guard test.
2. Audit `mps-lu` `QuarantinePromoter` and choose adapt/rename/deprecate.
3. Draft the source-registry V2 implementation PR from the existing schema-convergence spec.
4. Add the route exposure matrix for governance reads.
5. Only then resume lower-priority registry-shape validation work.
