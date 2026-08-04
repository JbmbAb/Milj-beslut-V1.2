import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";

export type DependencyKind = string;

// ADR-24-07: AST Normalization Profile
export interface ASTNormalizationProfileArtifact extends CanonicalArtifact {
  readonly artifact_type: "AST_NORMALIZATION_PROFILE_ARTIFACT";
  readonly profile_key: string;
  readonly normalization_rules: unknown;
}

// ADR-24-08: Dependency Taxonomy Artifact
export interface DependencyTaxonomyArtifact extends CanonicalArtifact {
  readonly artifact_type: "DEPENDENCY_TAXONOMY_ARTIFACT";
  readonly taxonomy_key: string;
  readonly taxonomy_version: string;
  readonly definitions: unknown;
}

export interface DependencyArtifact extends CanonicalArtifact {
  readonly artifact_type: "DEPENDENCY_ARTIFACT";

  readonly source_ref: ContentReference;
  readonly target_ref: ContentReference;

  readonly dependency_kind: DependencyKind;
}

export interface SourceRevisionArtifact extends CanonicalArtifact {
  readonly artifact_type: "SOURCE_REVISION_ARTIFACT";

  readonly revision_key: string;
  readonly revision_metadata?: unknown;
}

export interface CanonicalAstPayload {
  readonly language: string;
  readonly schema_version: string;
  readonly root_ref: ContentReference;
}

export interface ASTSnapshotArtifact extends CanonicalArtifact {
  readonly artifact_type: "AST_SNAPSHOT_ARTIFACT";

  readonly source_revision_ref: ContentReference;
  // AST-24-07-I8: Profile Provenance
  readonly normalization_profile_ref: ContentReference;
  
  readonly ast_payload: CanonicalAstPayload;
  readonly ast_version: string;
}

export interface DependencyAnalysisArtifact extends CanonicalArtifact {
  readonly artifact_type: "DEPENDENCY_ANALYSIS_ARTIFACT";

  readonly source_revision_ref: ContentReference;
  readonly ast_snapshot_ref: ContentReference;

  readonly analyzer_version: string;

  readonly analysis_config?: unknown;
  readonly analysis_profile_ref?: ContentReference;
  readonly constraint_profile_ref?: ContentReference;

  readonly dependency_refs: readonly ContentReference[];
}
