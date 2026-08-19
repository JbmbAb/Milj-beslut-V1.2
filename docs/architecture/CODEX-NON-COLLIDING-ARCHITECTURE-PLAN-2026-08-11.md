# Codex Architecture Guardrail & Proof Execution Plan — 2026-08-11

> ```
> Program status:                    SUBORDINATE EXECUTION PLAN
> Program authority:                 P0–P8  →  PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> Local purpose:                     execution detail only
> May define local steps:            YES
> May redefine program dependencies: NO
> May redefine PROVEN semantics:     NO
> May redefine authority boundaries: NO
> ```
>
> Phase 1–5 behåller sitt innehåll men är inte längre en roadmap-authority. Mappning:
> Phase 1 → P0/P1, Phase 2 → P8, Phase 3 → P1/P8, Phase 4 → P8/P7,
> Phase 5 → P0/P1 cleanup support.

Status: **DRAFT — ADR RECONCILIATION RESOLVED**. Scope: Codex-owned guardrails,
proof baseline, and architecture verification only. This document does not authorize or sequence
platform work independently of P0–P8.

This plan is intentionally separate from `LU-MVP-IMPLEMENTATION-PLAN-2026-08-11.md` and
`LEGACY-CLASSIFICATION-2026-08-11.md`. Opus/Claude may implement LU/MVP flows under frozen
contracts: download pipeline, sorting, archive materialization, chunking, LU replay,
viewer/QGIS flow, and LU domain repair. Opus/Claude does not own or redefine archive, chunking,
promotion, replay, or evidence authority. Codex must not make competing implementation decisions
inside that track.

## Evaluation of the Current Classification

The classification is strong enough to use as a working control document because it is based on
import graph evidence and observed test behavior rather than folder names. P0 owns the final
taxonomy; this plan consumes it and defines no parallel status vocabulary. The key correction is
important: LU is not legacy to retire; LU is the ACTIVE MVP product track, but not an authority
owner.

Module lifecycle and proof are separate axes and must never be collapsed into one label:

- **Module status:** `ACTIVE`, `ACTIVE_MVP`, `LEGACY`, `QUARANTINED`, `RETIRED`.
- **Proof status:** `PROVEN`, `IMPLEMENTED_NOT_PROVEN`, `PARTIAL`, `DESIGN_ONLY`,
  `KNOWN_BROKEN`, `UNEXECUTED_PROOF`.

No capability may be classified above its weakest authority ownership, runtime reachability, or
executed-proof state. For example, `mps-lu` is `ACTIVE_MVP`, is not an authority owner, and has
`PARTIAL`/`KNOWN_BROKEN` proof until the direct CAS bypass is removed and the real runtime path is
proven.

The most valuable architectural distinction is this:

- Mimers Brunn owns authority: promotion, approval, attestation, CAS-write rules, and import gates.
- LU owns product/domain behavior: spatial plus document evidence, replayable assessment, and
  viewer/export flows.
- Quarantined or retired packages must not keep blocking proof of active architecture unless they
  are explicitly being repaired.

The classification still needs freezing before destructive or broad config changes. Until then,
Codex work should be additive, reversible, and focused on evidence.

## ADR Alignment — RESOLVED 2026-08-11

The blocker is lifted. It is recorded here rather than deleted, because this document's original
model of *which* authority governs was partly wrong, and that correction is itself audit-relevant.

```
ADR reconciliation:  RESOLVED
Resolution:          FOLLOW EXISTING CONTRACTS
Resolved by:         F0A-ADR28-RECONCILIATION-2026-08-11.md
                     F0B-INGESTION-ARCHIVE-RECONCILIATION-2026-08-11.md

Authority set (nine, not two):
  - ADR-27-LU-Architecture-Charter.md            (Frozen; "bindande för all utveckling av LU v1.0")
  - ADR-28-LU-Definition-Scope.md                (Frozen)
  - ADR-30-LU-Runtime-v1-Freeze-...md            (Accepted; lu-runtime-v1)
  - ADR-24-23-Audit-Reconstruction-and-Replay.md (Accepted/Frozen)
  - ADR-23B-Operational-Governance-Runtime.md    (ViewerCapabilityArtifact admission)
  - ADR-CHUNKING-Subsystem.md                    (Accepted; explicit non-decision vs UniversalChunker)
  - ADR-SPATIAL-PRESENTATION-EVIDENCE-CONTRACT.md (ACCEPTED / SEQUENCE FROZEN)
  - mimers-brunn-v3.0.0.md                       (ACTIVE)
  - ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md  (ACCEPTED / SEQUENCE FROZEN)

Archive authority:
  mimers-brunn-v3.0.0.md
  (supersedes mimers-brunn-v2.0.1.md → LEGACY → supersedes mimers-brunn-offline-first.md → LEGACY)

Prior assumption:
  ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT as sole archive authority
Status:
  SUPERSEDED / CORRECTED
  (that ADR governs the document inventory manifest — Tier 3 — not the archive model itself)

No fourth parallel LU/MVP or archive model was introduced. The proposed
raw/manifests/normalized/chunks/indexes structure was shown to be a re-expression of
mimers-brunn-v3.0.0's five frozen tiers, not a competing model.
```

Remaining consequence for this plan: Phase 2 (proof baseline split) and Phase 3 (guardrails) may
now proceed **as P8/P1 execution detail**, but remain gated on P1's two closures — correction and
freeze of the F0D minimum contract, and the A1 authority-bypass red test — per the P0–P8 authority
document.

## Codex Lane

Codex will work on:

- proof-baseline definition and test partitioning;
- machine-readable authority and exposure guardrails;
- executable CI/proof topology;
- non-invasive audits that prevent new bypasses;
- module-lifecycle tracking, separate from P0-owned proof status.

Codex will not work on:

- LU download, parsing, sorting, archive layout, chunking, or replay implementation;
- master archive restructuring;
- full reindexing or broad harvesting;
- deleting retired packages before the classification is frozen;
- changing `ViewerKernel.ts` unless Opus/Claude asks for a narrow reviewed fix.

## Phase 1 — Freeze Inputs Without Moving Product Code

Goal: make P0's current-state taxonomy executable without altering LU/MVP.

Tasks:

- Apply P0's approved taxonomy without inventing local status definitions.
- Record module status, authority ownership, and proof status as distinct fields.
- Record that `mps-lu` is `ACTIVE_MVP` and not an authority owner.
- Record that `mps-promotion` and standalone `mps-governance` are retired candidates, not deleted.
- Record that `mps-cas-boundary`, `mps-decision-governance`, and `mps-retrieval-governance` are quarantined candidates.
- Keep the `mps-legal-corpus` gate's isolated proof distinct from the active legal-corpus write path.

Exit gate:

- No code changes.
- Classification document names every open decision explicitly and never conflates module lifecycle
  with proof status.

## Phase 2 — Proof Baseline Split

Goal: implement P8's proof topology so dead or quarantined experiments cannot mask whether active
architecture is green.

Tasks:

- Define four proof classes in documentation first:
  - `proof:architecture`: static authority, import-graph, exposure, and boundary tests.
  - `proof:active`: ACTIVE authority packages plus ACTIVE MVP smoke/contract tests.
  - `proof:integration`: DB, PostGIS, runtime, and E2E proofs with reproducible environments.
  - `proof:quarantined`: quarantined and retired-candidate diagnostics that may be red without
    blocking active proof.
- Do not alter `vitest.config.ts` until the lane names and included packages are approved.
- Preserve the current broad `compliance` run as a diagnostic lane until CI ownership is decided.
- Document that `npx vitest run` is currently blocked locally by `riskguard` DB authentication.
- Require every `required_proof` to be reachability-verified from at least one defined CI lane.
  A file such as `ADR23Compliance.test.ts` that exists but is not collected is
  `UNEXECUTED_PROOF`, not proof.

Exit gate:

- A CI/proof matrix document exists with commands, expected blockers, environment, ownership, and
  reachability for every required proof.
- No test is silently removed; every excluded test has a classification reason.

## Phase 3 — Authority Guardrails

Goal: prevent future regressions while Opus/Claude repairs LU.

Tasks:

- Extend `architecture-authority-map.jsonc` only with frozen classifications.
- Keep tests that prove live governance routes import only canonical promotion authority.
- Add or tighten both name/import guardrails and capability/boundary guardrails:
  - LU/domain packages must not receive production permanent-CAS write capability without canonical
    governed admission.
  - LU may consume a governed-admission port; that is not a bypass.
  - Non-canonical packages must not be imported by `server/routes/governance.routes.ts`.
  - The A1 red test must prove the forbidden behavior directly, not merely reject a class name.
- Track `scripts/import/generate-embeddings.ts` as `TEMPORARY_GOVERNANCE_EXCEPTION`,
  `NOT_PRODUCTION_AUTHORITY`, and `OWNER_DECISION_REQUIRED`, with explicit owner, expiry/decision
  gate, exact write scope, and rationale until P5 decides trusted-operator versus governed-port
  rewrite.

Exit gate:

- Guardrail tests can fail with actionable file names and forbidden behavior, not vague
  architecture prose or class-name matching alone.
- Any failure in LU implementation files is reported to the LU/MVP owner rather than patched opportunistically.

## Phase 4 — CI and Environment Proof

Goal: define and enforce P8's proof topology so PROVEN means the same thing locally and in CI.

Tasks:

- Define CI commands and environments for architecture, active, integration, and quarantined proof.
- Require typechecking for `server/` and relevant `packages/`; current root exclusions cannot
  certify platform implementation.
- Make DB/PostGIS integration reproducible, including required credentials and seed/migration steps.
- Require Linux durability proof to execute in CI; Windows durability limitations must remain
  explicitly scoped rather than interpreted as full durability proof.
- Keep full integration proof separate until DB authentication is fixed, while preserving a
  non-DB active proof lane.

Exit gate:

- Every PROVEN label names an executed command, CI lane, environment, and artifact/run evidence.
- DB-auth failure is a known environment blocker, not confused with product regression.

## Phase 5 — Decision Packet for Deletion or Quarantine

Goal: prepare cleanup without doing premature deletion or turning historical removal into an HM-1
blocker.

Tasks:

- For each retired candidate, produce a one-page removal packet:
  - import graph evidence;
  - test coverage status;
  - replacement/canonical owner;
  - rollback path;
  - user approval checkbox.
- For each quarantined package, produce a quarantine packet:
  - why it is not active;
  - whether tests should move to `proof:quarantined`;
  - what would be required to return it to ACTIVE.

Exit gate:

- No package is deleted by Codex without explicit approval.
- Deletion is not required for HM-1 unless the package remains runtime reachable or proof-blocking.
- Quarantine is a reversible classification, not a hidden failure.

## Coordination Contract With Opus/Claude

Opus/Claude owns implementation responsibility for:

- LU/MVP implementation;
- download pipeline;
- source sorting;
- archive materialization under frozen archive contracts;
- chunking and manifest integration;
- LU replay/viewer fixes;
- replacing LU direct CAS writes with the chosen governed path.

Codex owns:

- proof lanes;
- authority map tests;
- route exposure matrix;
- classification consistency checks;
- CI/env documentation;
- collateral-risk verification.

Shared handoff rule:

- If Codex finds an LU/MVP implementation defect, it records it as a blocker with file and test evidence.
- If Opus/Claude changes authority or CI boundaries, Codex updates the guardrails after review.

Overarching hierarchy rule:

```
Frozen ADRs / normative contracts own architecture.
P0–P8 owns program sequencing.
Execution plans assign implementation responsibility.
Proof lanes verify compliance.
No agent or execution plan acquires program-architecture authority through implementation.
```

## Immediate Next Actions

1. Reclassify this document as a subordinate Codex execution/proof plan under P0–P8.
2. Retain the ADR reconciliation result: `FOLLOW EXISTING CONTRACTS`.
3. Keep the complete reconciled authority set, including `mimers-brunn-v3.0.0.md`, visible here.
4. Bind Phase 1–5 to P0/P1/P7/P8 rather than treating them as an independent sequence.
5. Freeze P0's proof taxonomy and module-status taxonomy before changing lanes or labels.
6. Resolve the identified F0D contract corrections, then freeze F0D as the governed-ingestion
   minimum contract.
7. After P1 input is frozen, implement A1 as an executable authority-bypass proof.
8. Reconcile P4A read-only before freezing P4A → P3 dependencies.
9. Convert `PROOF-BASELINE-MATRIX-2026-08-11.md` into P8's executable proof topology,
   including reachability for `ADR23Compliance.test.ts`.
10. Keep cleanup packets non-blocking unless a package remains runtime reachable or proof-blocking.
