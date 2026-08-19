# Architecture Cleanup Decision Packets — 2026-08-11

> ```
> Document class:                    DECISION UNDERLAG  (ej roadmap-authority)
> Program parent:                    P1 (Authority & governance convergence)
> Program authority:                 P0–P8 → PROGRAM-P0-P8-AUTHORITY-2026-08-11.md
> May define local steps:            YES
> May redefine program dependencies: NO
> May redefine PROVEN semantics:     NO
> May redefine authority boundaries: NO
> ```

Status: DRAFT / NOT FROZEN. No deletion, quarantine move, or test exclusion is authorized by this
document.

Purpose: prepare explicit user decisions for packages that currently either duplicate active
authority or burden proof lanes without being wired into production paths.

## Decision Rules

- Delete only after explicit approval.
- Quarantine means reversible test/proof isolation, not code deletion.
- A package may return to ACTIVE only by naming its live consumer, canonical authority role, and
  proof command.
- LU is not in this cleanup list; LU is ACTIVE MVP and owned by the LU/MVP implementation track.

## Retired Candidate: `packages/mps-promotion`

Current classification: RETIRED candidate.

Evidence:

- No known live server import.
- No known import from `mimers-brunn-core` or `mps-data-governance`.
- No test files identified in the classification pass.
- Duplicates the already PROVEN promotion authority in `mimers-brunn-core`.

Canonical replacement:

- `packages/mimers-brunn-core/src/governance/DatasetApproval.ts`
- `ArtifactAttestation` / `verifyArtifactAttestation`

Recommended action:

- Archive or delete after a final import-graph confirmation.

Rollback path:

- Keep one branch/tag or archive copy before deletion.
- Reintroduce only as an adapter to the canonical promotion authority, not as a parallel authority.

Decision: PENDING USER APPROVAL.

## Retired Candidate: `packages/mps-governance`

Current classification: RETIRED candidate.

Evidence:

- No known live consumer.
- Existing `ADR23Compliance.test.ts` is not included by current Vitest project globs.
- Appears to contain an ambitious actor/trust-anchor model that is not the live trust root.

Canonical replacement or future owner:

- Current live runtime: `packages/mps-governance-runtime`.
- Current live promotion/signing: `packages/mimers-brunn-core`.
- Possible future Level 3 actor authority only after separate audit.

Recommended action:

- Archive as reference material or delete after a final import-graph and ADR review.

Rollback path:

- Preserve ADR references and package snapshot before deletion.
- If revived, require an explicit Level 3 trust-root spec and proof suite first.

Decision: PENDING USER APPROVAL.

## Quarantined Candidate: `packages/mps-cas-boundary`

Current classification: QUARANTINED candidate.

Evidence:

- No known package dependency or server reference.
- Parallel CAS-boundary implementation beside active `mimers-brunn-core/src/cas`.
- Its tests currently contribute proof noise in the broad compliance lane.

Canonical replacement:

- Active CAS/WORM path in `mimers-brunn-core/src/cas`.
- Active artifact-store path remains separately ACTIVE where consumed by runtime/data-governance.

Recommended action:

- Move tests to `proof:quarantined` once proof lanes are approved.
- Do not delete until a final decision decides whether this package is future CAS boundary or historical prototype.

Rollback path:

- Keep tests runnable in `proof:quarantined`.
- Reclassify to ACTIVE only with a migration plan from current CAS users.

Decision: PENDING USER APPROVAL.

## Quarantined Candidate: `packages/mps-decision-governance`

Current classification: QUARANTINED candidate.

Evidence:

- No known live consumer in server/scripts/other packages from the classification pass.
- Tests are included in the broad compliance lane and can block active proof despite no live path.

Canonical replacement:

- Not yet assigned. Must not be treated as live decision authority without a consumer and proof command.

Recommended action:

- Keep code, move tests to `proof:quarantined` after approval.
- Require consumer/proof evidence before returning to ACTIVE.

Rollback path:

- Restore to active proof lane by adding a documented live consumer and passing focused tests.

Decision: PENDING USER APPROVAL.

## Quarantined Candidate: `packages/mps-retrieval-governance`

Current classification: QUARANTINED candidate.

Evidence:

- No known live consumer from the classification pass.
- Included in the broad compliance lane, which makes it proof-costly without live architecture authority.

Canonical replacement:

- Not yet assigned. Retrieval governance should remain separate from authority-bearing promotion/CAS writes unless explicitly specified.

Recommended action:

- Keep as quarantined diagnostic package after approval.
- Re-enter ACTIVE only with a named retrieval contract and proof lane.

Rollback path:

- Move tests back into `proof:active` only after a live consumer exists.

Decision: PENDING USER APPROVAL.

## Governed-Write Exception: `scripts/import/generate-embeddings.ts`

Current classification: LEGACY / audit focus.

Evidence:

- Direct database write through `prisma.$executeRawUnsafe('UPDATE "DocumentChunk" SET "embedding" = ...')`.
- No documented governed-port or trusted-operator exception in the current proof baseline.

Decision required:

- Rewrite through a governed port, or
- classify as a trusted operator tool with explicit lower guarantees and exclusion from authority-bearing proof.

Recommended action:

- Do not patch opportunistically during LU/MVP work.
- Treat as a separate governed-write decision because embeddings are outside the current LU/MVP proof scope.

Decision: PENDING USER APPROVAL.
