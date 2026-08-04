import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";
import {
  ASTSnapshotArtifact,
  DependencyAnalysisArtifact,
  DependencyArtifact,
} from "../contracts/DependencyArtifacts.js";

export interface CanonicalAstSnapshot extends ASTSnapshotArtifact {}

export interface DependencyAnalysisProfileArtifact extends CanonicalArtifact {
  readonly artifact_type: "DEPENDENCY_ANALYSIS_PROFILE_ARTIFACT";

  readonly profile_key: string;
  readonly profile_payload?: unknown;
}

export interface DependencyAnalysisResult {
  readonly analysis: DependencyAnalysisArtifact;
  readonly dependencies: readonly DependencyArtifact[];
}

export interface DependencyAnalyzer {
  analyze(
    astSnapshot: CanonicalAstSnapshot,
    analysisProfileRef?: ContentReference,
    constraintProfileRef?: ContentReference
  ): Promise<DependencyAnalysisResult>;
}
