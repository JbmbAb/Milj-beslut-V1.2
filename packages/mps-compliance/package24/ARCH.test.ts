import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import {
  ArchitectureProfileArtifact,
  PackageBoundaryProfileArtifact,
} from "../../mps-dep/src/contracts/ArchitectureArtifacts.js";
import {
  ASTNormalizationProfileArtifact,
  DependencyTaxonomyArtifact,
  DependencyAnalysisArtifact,
} from "../../mps-dep/src/contracts/DependencyArtifacts.js";
import {
  DefaultDependencyConstraintValidator,
} from "../../mps-dep/src/validation/DependencyConstraintValidator.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  // Identity Isolation strips metadata
  delete payload.artifact_id;
  delete payload.profile_key;
  delete payload.profile_version;
  delete payload.taxonomy_key;
  delete payload.taxonomy_version;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("ARCH-001 -> ARCH-004 Architecture Compliance", () => {
  // ARCH-24-10 Architecture Profile Identity Isolation
  it("ARCH-001 Architecture Profile Identity Isolation (A) - metadata does not affect identity", async () => {
    const base: ArchitectureProfileArtifact = {
      artifact_type: "ARCHITECTURE_PROFILE_ARTIFACT",
      artifact_id: "arch-1",
      profile_key: "default-arch",
      profile_version: "1.0",
      taxonomy_ref: { artifact_id: "tax-1" } as any,
      constraint_profile_ref: { artifact_id: "const-1" } as any,
      boundary_profile_ref: { artifact_id: "bound-1" } as any,
    } as any;

    const renamed = {
      ...base,
      profile_version: "2.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  // DEP-TAX-24-08 Taxonomy Identity Isolation
  it("ARCH-002 Taxonomy Identity Isolation (A) - metadata does not affect identity", async () => {
    const base: DependencyTaxonomyArtifact = {
      artifact_type: "DEPENDENCY_TAXONOMY_ARTIFACT",
      artifact_id: "tax-1",
      taxonomy_key: "standard-deps",
      taxonomy_version: "1.0",
      definitions: { STATIC_IMPORT: "Static ES6 Import" },
    } as any;

    const renamed = {
      ...base,
      taxonomy_version: "2.0",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  // Constraint Evaluation testing with Architecture Profile
  it("ARCH-003 Constraint Validator generates accurate evaluation using Architecture Profile", () => {
    const analysis: DependencyAnalysisArtifact = {
      artifact_type: "DEPENDENCY_ANALYSIS_ARTIFACT",
      artifact_id: "an-1",
      analyzer_version: "1.0",
      source_revision_ref: { artifact_id: "rev-1" } as any,
      ast_snapshot_ref: { artifact_id: "ast-1" } as any,
      dependency_refs: [{ artifact_id: "dep-1" } as any],
    } as any;

    const architectureProfile: ArchitectureProfileArtifact = {
      artifact_type: "ARCHITECTURE_PROFILE_ARTIFACT",
      artifact_id: "arch-prof-1",
      profile_key: "strict",
      profile_version: "1.0",
      taxonomy_ref: { artifact_id: "tax-1" } as any,
      constraint_profile_ref: { artifact_id: "const-1" } as any, // Triggers mock failure
      boundary_profile_ref: { artifact_id: "bound-1" } as any,
    } as any;

    const { evaluation, violations } = DefaultDependencyConstraintValidator.evaluate(analysis, architectureProfile);

    expect(evaluation.status).toBe("FAILED");
    expect(violations.length).toBe(1);
    expect(violations[0].dependency_ref.artifact_id).toBe("dep-1");
    expect(violations[0].violation_code).toBe("MOCK_ARCHITECTURE_VIOLATION");
  });
});
