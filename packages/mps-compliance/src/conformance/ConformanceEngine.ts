import { ArtifactContract } from '../artifacts/ArtifactContract';
import { RuleRegistrySnapshot } from './RuleRegistrySnapshot';
import { ComplianceReport } from './ComplianceReport';

/**
 * The kernel execution engine. Applies a RuleRegistrySnapshot to a target Artifact
 * and produces a ComplianceReport without mutating any state.
 */
export interface ConformanceEngine {
  validate(artifact: ArtifactContract, snapshot: RuleRegistrySnapshot): ComplianceReport;
}
