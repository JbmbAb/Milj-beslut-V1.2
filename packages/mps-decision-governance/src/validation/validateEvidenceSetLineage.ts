// packages/mps-decision-governance/src/validation/validateEvidenceSetLineage.ts

import type { EvidenceSetArtifact } from "../EvidenceSetArtifact";

export interface EvidenceSetLineageResolver {
  resolve(evidence_set_hash: string): EvidenceSetArtifact | undefined;
}

export class EvidenceSetLineageError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "EvidenceSetLineageError";
  }
}

function sameDocumentScope(
  a: EvidenceSetArtifact,
  b: EvidenceSetArtifact,
): boolean {
  return (
    a.identity.schema_version === b.identity.schema_version
  );
}

export function validateEvidenceSetLineage(
  artifact: EvidenceSetArtifact,
  resolver: EvidenceSetLineageResolver,
): void {
  const previousHash = artifact.identity.previous_evidence_set_hash;

  if (!previousHash) {
    return;
  }

  const previous = resolver.resolve(previousHash);

  if (!previous) {
    throw new EvidenceSetLineageError(
      "PREVIOUS_EVIDENCE_SET_NOT_FOUND",
      "previous_evidence_set_hash does not resolve",
    );
  }

  if (previous.evidence_set_hash === artifact.evidence_set_hash) {
    throw new EvidenceSetLineageError(
      "SELF_REFERENCING_EVIDENCE_SET",
      "EvidenceSet cannot reference itself",
    );
  }

  if (!sameDocumentScope(artifact, previous)) {
    throw new EvidenceSetLineageError(
      "LINEAGE_SCOPE_MISMATCH",
      "EvidenceSet lineage scope changed",
    );
  }

  if (
    previous.identity.lineage_sequence >=
    artifact.identity.lineage_sequence
  ) {
    throw new EvidenceSetLineageError(
      "LINEAGE_SEQUENCE_REGRESSION",
      "lineage_sequence must strictly increase along lineage",
    );
  }
}
