import { describe, it, expect } from "vitest";
import { createPfasExecutionManifest } from "../../fixtures/createPfasExecutionManifest";
import { createPfasDagPlan } from "../../fixtures/createPfasDagPlan";
import { DeterministicRuntimeScheduler } from "../../../runtime/DeterministicRuntimeScheduler";
import { DependencyResolver } from "../../../runtime/DependencyResolver";
import { ExecutionContextBuilder } from "../../../runtime/ExecutionContextBuilder";
import { ArtifactProjectionBuilder } from "../../../runtime/ArtifactProjectionBuilder";
import { createCapabilityRegistry } from "../../fixtures/createCapabilityRegistry";
import { createArtifactFactory } from "../../fixtures/createArtifactFactory";
import { CheckpointManager } from "../../../runtime/checkpoint/CheckpointManager";
import { ReplayVerifierProfiles } from "../../../runtime/replay/ReplayVerifierProfiles";
import { ReplayTamper } from "./ReplayTamper";

describe("pfas-execution-v6.e2e — plan/graph mismatch", () => {
  it("fails when execution plan or dependency graph hash differs", async () => {
    const manifest = createPfasExecutionManifest();
    const plan = createPfasDagPlan(manifest);

    const capabilityRegistry = createCapabilityRegistry();
    const dependencyResolver = new DependencyResolver();
    const contextBuilder = new ExecutionContextBuilder();
    const artifactFactory = createArtifactFactory();
    const projectionBuilder = new ArtifactProjectionBuilder(artifactFactory);
    const scheduler = new DeterministicRuntimeScheduler(capabilityRegistry, dependencyResolver, contextBuilder, projectionBuilder);
    const checkpointManager = new CheckpointManager();
    const verifier = ReplayVerifierProfiles.strict();

    const originalRun = await scheduler.execute(manifest, plan);
    const checkpoint = await checkpointManager.createCheckpointFromExecution(originalRun);

    const replayRun = await scheduler.execute(manifest, plan);

    const tamperedReplay =
      ReplayTamper.from(replayRun)
        .withPlanHash("cafebabedeadbeef0011223344556677")
        .build();

    const verification = await verifier.verify(checkpoint, tamperedReplay);

    expect(verification.replay_valid).toBe(false);
    expect(verification.fingerprint_valid).toBe(false);

    const failing = verification.invariant_results.filter(r => !r.passed);
    expect(failing).toHaveLength(1);
    expect(failing[0].id).toBe("EXECUTION_PLAN_HASH");
  });
});
