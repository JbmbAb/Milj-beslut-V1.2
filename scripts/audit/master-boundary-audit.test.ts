import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "glob";

describe("Master Boundary Audit", () => {
  it("should ensure ArtifactRepositoryPort.put is only called by authorized governance and core components", () => {
    // 1. Find all TypeScript files in the workspace
    const allFiles = globSync("packages/**/*.ts", { ignore: ["**/node_modules/**", "**/dist/**"] });

    // 2. Define the exact files that are AUTHORIZED to mutate the CAS repository.
    // Anything outside of this list is a "legacy/bypass write path" and must fail the build.
    const AUTHORIZED_CAS_WRITERS = [
      // Platform / Core (MimersIntegration handles tests setup, CasBackedArtifactRepository is the actual impl)
      "packages/mps-runtime/src/repository/CasBackedArtifactRepository.ts",
      "packages/mps-runtime/src/kernel/ExecutionKernel.ts",
      "packages/mps-runtime/src/replay/DefaultReplayEngine.ts",
      "packages/mps-runtime/src/mimers/MimersIntegration.test.ts",
      "packages/mps-runtime/src/repository/CasBackedArtifactRepository.test.ts",
      
      // Verification Tests (The platform test suite needs to inject mock objects to test the repository behavior)
      "packages/mps-runtime/src/verification/projection/ProjectionRebuild.test.ts",
      "packages/mps-runtime/src/verification/projection/ProjectionPurity.test.ts",
      "packages/mps-runtime/src/verification/performance/ReleasePerformanceGate.test.ts",
      "packages/mps-runtime/src/verification/integrity/CasCorruption.test.ts",
      "packages/mps-runtime/src/verification/integrity/CasReplay.test.ts",
      "packages/mps-runtime/src/verification/adversarial/AdversarialGate.test.ts",
      "packages/mps-runtime/src/verification/harness/PlatformHarness.ts",
      "packages/mps-runtime/src/unit/MimersCasRepository.test.ts",
      "packages/mps-runtime/src/unit/mps-end-to-end-determinism.test.ts",
      "packages/mps-runtime/src/unit/ExecutionKernel.test.ts",
      "packages/mps-runtime/src/projection/ProjectionRuntime.test.ts",
      "packages/mps-evolution/tests/ADR22Compliance.v2.test.ts",

      // Legacy Pipeline Components (These are approved because they are part of the original pipeline, but we should eventually migrate them)
      "packages/mps-runtime/src/StageHandlers/PromotionStageHandler.ts",
      "packages/mps-runtime/src/StageHandlers/GovernanceStageHandler.ts",
      "packages/mps-runtime/src/StageHandlers/ArchiveStageHandler.ts",
      
      // Core CAS Boundary implementations (ADR-22 era)
      "packages/mps-evolution/src/artifact/CasArtifactRepository.ts",
      "packages/mps-core/src/ContentAddressedArtifactStore.ts",
      "packages/mps-core/src/__tests__/mps.test.ts",
      "packages/mps-core/src/unit/mps.test.ts",
      "packages/mps-cas-boundary/tests/CASContractFreeze.test.ts",

      // LU Domain (Approved)
      "packages/mps-lu/src/execution/LuExecutionKernelClient.ts",
      "packages/mps-lu/src/ingestion/QuarantinePromoter.ts",
      "packages/mps-lu/tests/LuEnforcementReplay.test.ts",
      "packages/mps-lu/tests/QgisIntegration.test.ts",
      "packages/mps-lu/tests/LUEndToEnd.test.ts",
      // GLOBAL-RC8-PROOF-FABRIC-CLEANUP-01: same pattern as the LU test files immediately
      // above -- these inject a test-local repository to exercise repository behavior, not a
      // production CAS bypass. Allowlist maintenance drift (added after the list above), not a
      // real violation -- confirmed by reading each .put() call site.
      "packages/mps-lu/tests/VerticalProof.test.ts",
      "packages/mps-lu/tests/P4ALUViewerS6Reconciliation.test.ts",
      "packages/mps-lu/tests/F9ReplayContract.test.ts",
      "packages/mps-lu/tests/F8ViewerCapabilityAdmission.test.ts",

      // PostGIS Engine (Approved)
      "packages/spatial-provider-postgis/src/SpatialProviderPostGIS.ts",
      // Same drift as the LU test files above -- test-local repository injection.
      "packages/spatial-provider-postgis/tests/SpatialProviderPostGIS.test.ts",
      "packages/spatial-provider-postgis/tests/LUMagicMomentPostGIS.test.ts",
      "packages/spatial-provider-postgis/tests/LUEnforcement.test.ts",
    ];

    const violations: string[] = [];

    for (const file of allFiles) {
      const content = readFileSync(file, "utf8");
      
      // We look for common patterns of CAS repository writes.
      // This is a heuristic, but effective for catching legacy bypassing scripts.
      if (
        content.includes(".put(") &&
        (content.includes("repo.put(") || content.includes("cas.put(") || content.includes("backend.put(") || content.includes("casRepo.put(") || content.includes("this.cas.put(") || content.includes("this.casRepo.put(") || content.includes("artifactRepository.put("))
      ) {
        // Normalize slashes for comparison
        const normalizedFile = file.replace(/\\/g, "/");
        if (!AUTHORIZED_CAS_WRITERS.includes(normalizedFile)) {
          violations.push(normalizedFile);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        "Master Boundary Audit FAILED.\n" +
        "Found unauthorized bypass write paths to CAS in the following files:\n" +
        violations.join("\n") +
        "\n\nOnly the Governed Observation Architecture is allowed to write to CAS."
      );
    }
    
    expect(violations).toHaveLength(0);
  });
});
