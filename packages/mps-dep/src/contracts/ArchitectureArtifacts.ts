import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export interface PackageBoundaryProfileArtifact extends CanonicalArtifact {
  readonly artifact_type: "PACKAGE_BOUNDARY_PROFILE_ARTIFACT";
  readonly profile_key: string;
  readonly boundaries: unknown;
}

export interface ArchitectureProfileArtifact extends CanonicalArtifact {
  readonly artifact_type: "ARCHITECTURE_PROFILE_ARTIFACT";
  readonly profile_key: string;
  readonly profile_version: string;

  // ARCH-24-10-I2: Explicit Composition
  readonly taxonomy_ref: ContentReference;
  readonly constraint_profile_ref: ContentReference;
  readonly boundary_profile_ref: ContentReference;
}

// ADR-24-11: Architecture Compliance Artifact
export interface ArchitectureComplianceArtifact extends CanonicalArtifact {
  readonly artifact_type: "ARCHITECTURE_COMPLIANCE_ARTIFACT";

  readonly analysis_ref: ContentReference;
  readonly profile_ref: ContentReference;
  readonly evaluation_ref: ContentReference;

  readonly status: "COMPLIANT" | "WARNING" | "NON_COMPLIANT";

  readonly violation_refs: readonly ContentReference[];

  readonly evaluator_version: string;
}
