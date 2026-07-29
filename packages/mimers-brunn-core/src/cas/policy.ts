/**
 * WORM / namespace storage policy (ADR-042).
 * Namespace conventions alone are insufficient — CAS must enforce these.
 */
export interface ArtifactPolicy {
  readonly namespace: string;
  readonly immutable: boolean;
  readonly allowOverwrite: boolean;
  readonly allowDelete?: boolean;
}

export const PROMOTION_ARTIFACT_POLICY: ArtifactPolicy = {
  namespace: 'promotion',
  immutable: true,
  allowOverwrite: false,
  allowDelete: false,
};

export class ArtifactPolicyViolation extends Error {
  constructor(
    readonly policy: ArtifactPolicy,
    readonly operation: 'overwrite' | 'delete' | 'mutate',
    message?: string,
  ) {
    super(message ?? `ArtifactPolicy violation: ${operation} denied for namespace '${policy.namespace}'`);
    this.name = 'ArtifactPolicyViolation';
  }
}

export function assertPutAllowed(policy: ArtifactPolicy, alreadyExists: boolean): void {
  if (alreadyExists && (policy.immutable || !policy.allowOverwrite)) {
    throw new ArtifactPolicyViolation(policy, 'overwrite');
  }
}

export function assertDeleteAllowed(policy: ArtifactPolicy): void {
  if (policy.immutable || policy.allowDelete === false) {
    throw new ArtifactPolicyViolation(policy, 'delete');
  }
}
