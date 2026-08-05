import { FrozenCoreReleaseManifestArtifact } from "../../../mps-governance/src/release/FrozenCoreReleaseManifestArtifact";
import { ComplianceEvaluation } from "../reports/ComplianceEvaluation";
import { FrozenCoreVerificationContext } from "./FrozenCoreVerificationContext";
import { ComplianceReport } from "./ComplianceReport";
import { ValidationResult } from "./ValidationResult";
import { ValidationContext } from "./ValidationContext";

export interface FrozenCoreVerifier {
  verify(
    release: FrozenCoreReleaseManifestArtifact,
    context: FrozenCoreVerificationContext
  ): ComplianceEvaluation;
}

export class DefaultFrozenCoreVerifier implements FrozenCoreVerifier {
  verify(
    release: FrozenCoreReleaseManifestArtifact,
    context: FrozenCoreVerificationContext
  ): ComplianceEvaluation {
    const reports: ComplianceReport[] = [];
    let isGloballyCompliant = true;

    // Resolve matrix without global state
    const matrix = context.matrixResolver.resolve(release.matrix_id);
    if (!matrix) {
      throw new Error(`Matrix ${release.matrix_id} could not be resolved in the current context.`);
    }

    // Build the execution context for validators
    const validationContext: any = {
      artifacts: [], // Would be populated by artifactResolver if needed for bulk ops
      resolve: (ref) => context.artifactResolver.resolve(ref),
      matrix: matrix,
      release_manifest: release,
      canonicalSerializer: context.canonicalSerializer
    };

    for (const entry of matrix.entries) {
      const profile = entry.profile;
      const results: ValidationResult[] = [];
      let isProfileCompliant = true;

      for (const ruleId of profile.rule_ids) {
        const rule = context.ruleRegistry.rules.find((r) => r.rule_id === ruleId);
        if (!rule) {
          throw new Error(`Rule ${ruleId} not found in registry`);
        }

        const result = rule.validate(validationContext);
        results.push(result);

        if (!result.passed) {
          isProfileCompliant = false;
        }
      }

      reports.push({
        target_id: release.artifact_id,
        isCompliant: isProfileCompliant,
        results: results,
        snapshotVersion: profile.version
      });

      if (!isProfileCompliant) {
        isGloballyCompliant = false;
      }
    }

    return {
      matrix_version: matrix.version,
      reports: reports,
      compliant: isGloballyCompliant
    };
  }
}
