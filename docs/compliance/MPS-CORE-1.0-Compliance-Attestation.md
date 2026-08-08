// packages/mps-data-governance/src/ReplayEngine.ts

import type { ExecutionManifest } from "./ExecutionManifest";
import type { HarvestExecutionResult } from "./HarvestOrchestratorTypes";

/**

- ReplayEngine
-
- Pure replay of historical execution.
- Consumes ExecutionManifest and reconstructs HarvestExecutionResult.
-
- Replay SHALL:
- - read stored artifacts
- - read stored decisions
- - never execute runtime logic
- - never mutate manifest
- - never generate artifacts
- - never generate timestamps
- - never bypass governance boundary
- - reject inconsistent lineage
-
- Replay is deterministic and side-effect-free.
  */
  export class ReplayEngine {

static replay(manifest: ExecutionManifest): HarvestExecutionResult {
ReplayEngine.assertLineageConsistency(manifest);

    const produced_artifacts = ReplayEngine.collectProducedArtifacts(manifest);
    const evidence_refs = ReplayEngine.collectEvidence(manifest);

    return {
      state: manifest.state,
      produced_artifacts,
      evidence_refs,
    };

}

/**

-    Produced artifacts are those created by pipeline stages:
-    - projection_ref
-    - lu_ref
-
-    Content inputs (manifest_ref, archive_refs) are NOT produced artifacts.
     */
     private static collectProducedArtifacts(
     manifest: ExecutionManifest,
     ): readonly any[] {
     const out: any[] = [];

    if (manifest.projection_ref) {

      out.push(manifest.projection_ref);
    }

    if (manifest.lu_ref) {
      out.push(manifest.lu_ref);
    }

    return out;

}

/**

-    Evidence refs represent decisions:
-    - verification_ref
-    - approval_ref
-    - gate_evidence_ref
-    - projection_ref
-    - lu_ref
-
-    Replay SHALL NOT treat content references as evidence.
     */
     private static collectEvidence(
     manifest: ExecutionManifest,
     ): readonly any[] {
     const out: any[] = [];

    if (manifest.verification_ref) out.push(manifest.verification_ref);

    if (manifest.approval_ref) out.push(manifest.approval_ref);
    if (manifest.gate_evidence_ref) out.push(manifest.gate_evidence_ref);
    if (manifest.projection_ref) out.push(manifest.projection_ref);
    if (manifest.lu_ref) out.push(manifest.lu_ref);

    return out;

}

/**

-    Governance / lineage guard:
-    Replay SHALL reject inconsistent manifests rather than "repair" them.
-
-    This enforces:
-    - governance boundary
-    - lineage monotonicity
-    - terminal state invariants
       */
       private static assertLineageConsistency(
       manifest: ExecutionManifest,
       ): void {

    // 1. Governance boundary: AWAITING_APPROVAL may not have post-governance artifacts

    if (
      manifest.state === "AWAITING_APPROVAL" &&
      (manifest.projection_ref ||
       manifest.lu_ref ||
       manifest.gate_evidence_ref ||
       manifest.approval_ref)
    ) {
      throw new Error(
        "Invalid replay manifest: governance boundary violated for AWAITING_APPROVAL"
      );
    }

    // 2. VERIFIED may not contain approval or later artifacts
    if (
      manifest.state === "VERIFIED" &&
      (manifest.approval_ref ||
       manifest.gate_evidence_ref ||
       manifest.projection_ref ||
       manifest.lu_ref)
    ) {
      throw new Error(
        "Invalid replay manifest: VERIFIED state contains post-governance artifacts"
      );
    }

    // 3. Terminal states must not contain lineage inconsistent with their stage
    const terminalStates = ["BLOCKED", "ARCHIVED", "QUARANTINED"] as const;

    if (terminalStates.includes(manifest.state)) {
      // Approval without verification is illegal
      if (manifest.approval_ref && !manifest.verification_ref) {
        throw new Error(
          "Invalid replay manifest: approval without verification in terminal state"
        );
      }

      // Projection/LU without gate evidence is illegal
      if (
        (manifest.projection_ref || manifest.lu_ref) &&
        !manifest.gate_evidence_ref
      ) {
        throw new Error(
          "Invalid replay manifest: projection/LU without gate evidence in terminal state"
        );
      }
    }

}
