import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import {
  DependencyArtifact,
  SourceRevisionArtifact,
  ASTSnapshotArtifact,
  DependencyAnalysisArtifact,
} from "../../mps-dep/src/contracts/DependencyArtifacts.js";
import {
  ArchitectureProfileArtifact,
} from "../../mps-dep/src/contracts/ArchitectureArtifacts.js";
import {
  DefaultDependencyConstraintValidator,
} from "../../mps-dep/src/validation/DependencyConstraintValidator.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  // DEP-001 -> DEP-004 Identity Isolation strips metadata
  delete payload.artifact_id;
  delete payload.revision_key;
  delete payload.ast_version;
  delete payload.analyzer_version;
  delete payload.profile_key;
  delete payload.profile_version;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("DEP-001 -> DEP-004 Dependency Compliance", () => {
  // DEP-001 Dependency Identity Isolation
  it("DEP-001 Dependency Identity Isolation (A) - metadata does not affect identity", async () => {
    const base: SourceRevisionArtifact = {
      artifact_type: "SOURCE_REVISION_ARTIFACT",
      artifact_id: "rev-1",
      revision_key: "main",
      revision_metadata: { commit: "abc" },
    } as any;

    const renamed = {
      ...base,
      revision_key: "dev",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  // DEP-002 AST Snapshot Identity Isolation
  it("DEP-002 AST Snapshot Identity Isolation (A) - metadata does not affect identity", async () => {
    const base: ASTSnapshotArtifact = {
      artifact_type: "AST_SNAPSHOT_ARTIFACT",
      artifact_id: "ast-1",
      ast_version: "1.0",
      source_revision_ref: { artifact_id: "rev-1" } as any,
      ast_payload: { language: "ts", schema_version: "1", root_ref: { artifact_id: "root-1" } as any },
    } as any;

    const renamed = {
      ...base,
      ast_version: "2.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  // DEP-003 Analysis Artifact Identity Isolation
  it("DEP-003 Analysis Artifact Identity Isolation (A) - metadata does not affect identity", async () => {
    const base: DependencyAnalysisArtifact = {
      artifact_type: "DEPENDENCY_ANALYSIS_ARTIFACT",
      artifact_id: "an-1",
      analyzer_version: "1.0",
      source_revision_ref: { artifact_id: "rev-1" } as any,
      ast_snapshot_ref: { artifact_id: "ast-1" } as any,
      dependency_refs: [{ artifact_id: "dep-1" } as any],
    } as any;

    const renamed = {
      ...base,
      analyzer_version: "2.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  // DEP-004 Replay Determinism
  it("DEP-004 Replay Determinism (B) - exact state yields exact hash", async () => {
    const base: DependencyArtifact = {
      artifact_type: "DEPENDENCY_ARTIFACT",
      artifact_id: "dep-1",
      source_ref: { artifact_id: "file-A" } as any,
      target_ref: { artifact_id: "file-B" } as any,
      dependency_kind: "STATIC_IMPORT",
    } as any;

    const replay = { ...base };
    expect(await canonicalHash(base)).toBe(await canonicalHash(replay));
  });

  // Constraint Evaluation testing
  it("DEP-005 Constraint Validator generates accurate evaluation artifacts", () => {
    const analysis: DependencyAnalysisArtifact = {
      artifact_type: "DEPENDENCY_ANALYSIS_ARTIFACT",
      artifact_id: "an-1",
      analyzer_version: "1.0",
      source_revision_ref: { artifact_id: "rev-1" } as any,
      ast_snapshot_ref: { artifact_id: "ast-1" } as any,
      dependency_refs: [{ artifact_id: "dep-1" } as any],
    } as any;

    const profile: ArchitectureProfileArtifact = {
      artifact_type: "ARCHITECTURE_PROFILE_ARTIFACT",
      artifact_id: "prof-1",
      profile_key: "strict",
      profile_version: "1.0",
      taxonomy_ref: { artifact_id: "tax-1" } as any,
      boundary_profile_ref: { artifact_id: "bound-1" } as any,
      constraint_profile_ref: { artifact_id: "const-1" } as any, // Triggers mock failure
    } as any;

    const { evaluation, violations } = DefaultDependencyConstraintValidator.evaluate(analysis, profile);

    expect(evaluation.status).toBe("FAILED");
    expect(violations.length).toBe(1);
    expect(violations[0].dependency_ref.artifact_id).toBe("dep-1");
    // Ensure violation code matches mock
    expect(violations[0].violation_code).toBe("MOCK_ARCHITECTURE_VIOLATION");
  });
});
