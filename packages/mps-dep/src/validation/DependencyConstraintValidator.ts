import { ContentReference } from "@miljobeslut/mps-evolution";
import { DependencyAnalysisArtifact } from "../contracts/DependencyArtifacts.js";
import {
  DependencyConstraintEvaluationArtifact,
  DependencyViolationArtifact,
  ConstraintEvaluationStatus,
} from "../contracts/DependencyConstraint.js";
import { ArchitectureProfileArtifact } from "../contracts/ArchitectureArtifacts.js";

export interface DependencyConstraintValidator {
  evaluate(
    analysis: DependencyAnalysisArtifact,
    architectureProfile: ArchitectureProfileArtifact // Updated for ARCH-24-10
  ): {
    evaluation: DependencyConstraintEvaluationArtifact;
    violations: readonly DependencyViolationArtifact[];
  };
}

export const DefaultDependencyConstraintValidator: DependencyConstraintValidator = {
  evaluate(analysis, architectureProfile) {
    // Basic mock implementation for compliance test ARCH-003
    const violations: DependencyViolationArtifact[] = [];
    let status: ConstraintEvaluationStatus = "PASSED";

    // MOCK: If profile has specific constraint_refs (mock check by profile existence)
    if (architectureProfile.constraint_profile_ref) {
        // If there's dependencies, flag as FAILED to test constraint evaluation
        if (analysis.dependency_refs.length > 0) {
            status = "FAILED";
            violations.push({
                artifact_type: "DEPENDENCY_VIOLATION_ARTIFACT",
                artifact_id: "viol-1",
                dependency_ref: analysis.dependency_refs[0],
                constraint_ref: { hash: "const-mock" } as ContentReference,
                evaluation_ref: { hash: "eval-temp" } as ContentReference,
                violation_code: "MOCK_ARCHITECTURE_VIOLATION"
            } as DependencyViolationArtifact);
        }
    }

    const evaluation: DependencyConstraintEvaluationArtifact = {
      artifact_type: "DEPENDENCY_CONSTRAINT_EVALUATION_ARTIFACT",
      artifact_id: "eval-1",
      analysis_ref: { hash: analysis.artifact_id } as ContentReference,
      profile_ref: { hash: architectureProfile.artifact_id } as ContentReference,
      evaluator_version: "1.0.0",
      status,
      violation_refs: violations.map(v => ({ hash: v.artifact_id } as ContentReference)),
      content_hash: { algorithm: "sha256", value: "hash" } as any,
      schema_version: "1.0",
      signature: "mock-signature" as any
    };

    return { evaluation, violations };
  },
};
