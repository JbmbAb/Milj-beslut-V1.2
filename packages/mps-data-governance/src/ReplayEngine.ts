// packages/mps-data-governance/src/ReplayEngine.ts

import type { ExecutionManifest } from "./ExecutionManifest";
import type { HarvestExecutionResult } from "./HarvestOrchestratorTypes";
import type { ContentReference, ArtifactReference } from "../../mps-core/src/types";

export class ReplayEngine {
  /**
   * Replays and reproduces the execution results purely from the ExecutionManifest.
   * Replay reproduces history. Replay does not create history.
   */
  static replay(manifest: ExecutionManifest): HarvestExecutionResult {
    const produced: ContentReference[] = [];
    const evidence: ArtifactReference[] = [];

    // Extract verification evidence
    if (manifest.verification_ref) {
      evidence.push(manifest.verification_ref);
    }
    // Extract approval evidence
    if (manifest.approval_ref) {
      evidence.push(manifest.approval_ref);
    }
    // Extract import gate evidence
    if (manifest.gate_evidence_ref) {
      evidence.push(manifest.gate_evidence_ref);
    }

    // Projections and LU initializations are both produced artifacts and evidence
    if (manifest.projection_ref) {
      produced.push(manifest.projection_ref);
      evidence.push(manifest.projection_ref);
    }
    if (manifest.lu_ref) {
      produced.push(manifest.lu_ref);
      evidence.push(manifest.lu_ref);
    }

    return {
      state: manifest.state,
      produced_artifacts: produced,
      evidence_refs: evidence
    };
  }
}
