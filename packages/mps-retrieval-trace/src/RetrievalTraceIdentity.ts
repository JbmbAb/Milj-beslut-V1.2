import { createHash } from 'crypto';
import { ArtifactReference } from '../../mps-retrieval-governance/src/ArtifactReader';

export function calculateRetrievalTraceIdentity(
  query_hash: string,
  policy_version: string,
  artifact_snapshot_ref: string,
  selected_artifact_refs: ArtifactReference[]
): string {
  
  // TRACE-I02: Must only contain ArtifactReference[]
  // Sorting refs to ensure deterministic hashing
  const sortedRefs = [...selected_artifact_refs].sort((a, b) => a.id.localeCompare(b.id));

  const payload = {
    query_hash,
    policy_version,
    artifact_snapshot_ref,
    selected_artifact_refs: sortedRefs
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
