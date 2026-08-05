import { ArtifactReference } from "../artifacts/ArtifactReference";
import { ArtifactContract } from "../artifacts/ArtifactContract";
import { ConformanceMatrixSnapshot } from "../matrix/ConformanceMatrixSnapshot";
import { RuleRegistrySnapshot } from "./RuleRegistrySnapshot";
import { CanonicalSerializer } from "../canonical/CanonicalSerializer";

export interface ArtifactResolver {
  resolve(ref: ArtifactReference): ArtifactContract | undefined;
}

export interface MatrixResolver {
  resolve(matrix_id: string): ConformanceMatrixSnapshot | undefined;
}

/**
 * The strict boundary for validation.
 * Verifiers MUST use this context, not global state.
 */
export interface FrozenCoreVerificationContext {
  readonly artifactResolver: ArtifactResolver;
  readonly matrixResolver: MatrixResolver;
  readonly ruleRegistry: RuleRegistrySnapshot;
  readonly canonicalSerializer: CanonicalSerializer<any>;
}
