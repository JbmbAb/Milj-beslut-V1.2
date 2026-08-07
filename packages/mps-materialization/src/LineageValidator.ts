/**
 * LineageValidator — C-03 hard gate.
 * Order invariant: build → assertClosed → only then commit.
 */

import type { EvidenceSetArtifact } from "../../mps-decision-governance/src/index.js";
import {
  EvidenceSetLineageError,
  hashEvidenceSetIdentity,
  InMemoryEvidenceSetLineageStore,
  validateEvidenceSetLineage,
  type EvidenceSetLineageResolver,
} from "../../mps-decision-governance/src/index.js";
import { MaterializationContractError } from "./MaterializationContract.js";

export type LineageCommitStore = EvidenceSetLineageResolver & {
  append(artifact: EvidenceSetArtifact): void;
};

/**
 * Build lineage graph view, assert closed, then allow commit.
 * EvidenceSet MUST NOT become authoritative before this succeeds.
 */
export class LineageValidator {
  constructor(
    private readonly store: LineageCommitStore = new InMemoryEvidenceSetLineageStore(),
  ) {}

  /**
   * Integrity: claimed evidence_set_hash MUST match recomputed identity hash.
   * Tampered Evidence A under stolen hash X → LINEAGE_VERIFICATION_FAILED.
   */
  assertIntegrity(artifact: EvidenceSetArtifact): void {
    const recomputed = hashEvidenceSetIdentity(artifact.identity);
    if (recomputed !== artifact.evidence_set_hash) {
      throw new MaterializationContractError(
        "LINEAGE_VERIFICATION_FAILED",
        `EvidenceSet hash mismatch: claimed ${artifact.evidence_set_hash}, recomputed ${recomputed}`,
      );
    }
  }

  /**
   * Verify closure without committing. Throws if lineage invalid.
   */
  assertClosed(artifact: EvidenceSetArtifact): void {
    this.assertIntegrity(artifact);
    try {
      validateEvidenceSetLineage(artifact, this.store);
    } catch (err) {
      if (err instanceof EvidenceSetLineageError) {
        throw new MaterializationContractError(
          "LINEAGE_NOT_CLOSED",
          `Lineage closure failed: ${err.code} — ${err.message}`,
        );
      }
      throw err;
    }
  }

  /**
   * Constitutional order: assertClosed → append (authoritative only after success).
   */
  commitAfterClosure(artifact: EvidenceSetArtifact): void {
    try {
      this.assertClosed(artifact);
      this.store.append(artifact);
    } catch (err) {
      if (err instanceof MaterializationContractError) throw err;
      if (err instanceof EvidenceSetLineageError) {
        throw new MaterializationContractError(
          "LINEAGE_NOT_CLOSED",
          `Lineage closure failed: ${err.code} — ${err.message}`,
        );
      }
      throw err;
    }
  }

  getStore(): LineageCommitStore {
    return this.store;
  }
}

export { EvidenceSetLineageError };
