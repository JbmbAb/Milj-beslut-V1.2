import { describe, it, expect } from "vitest";
import { createPfasExecutionManifest } from "../../fixtures/createPfasExecutionManifest";
import { createPfasDagPlan } from "../../fixtures/createPfasDagPlan";
import { DeterministicRuntimeScheduler } from "../../../runtime/DeterministicRuntimeScheduler";
import { DependencyResolver } from "../../../runtime/DependencyResolver";
import { ExecutionContextBuilder } from "../../../runtime/ExecutionContextBuilder";
import { ArtifactMaterializer } from "../../../runtime/ArtifactMaterializer";
import { createCapabilityRegistry } from "../../fixtures/createCapabilityRegistry";
import { createArtifactFactory } from "../../fixtures/createArtifactFactory";
import { CheckpointManager } from "../../../runtime/checkpoint/CheckpointManager";
import { ReplayVerifierProfiles } from "../../../runtime/replay/ReplayVerifierProfiles";
import { ReplayTamper } from "./ReplayTamper";

describe("pfas-execution-v6.e2e — seed mismatch", () => {
  it("fails when deterministic seed differs", async () => {
    const manifest = createPfasExecutionManifest();
    const plan = createPfasDagPlan(manifest);

    const capabilityRegistry = createCapabilityRegistry();
    const dependencyResolver = new DependencyResolver();
    const contextBuilder = new ExecutionContextBuilder();
    const artifactFactory = createArtifactFactory();
    const materializer = new ArtifactMaterializer(artifactFactory);
    const scheduler = new DeterministicRuntimeScheduler(capabilityRegistry, dependencyResolver, contextBuilder, materializer);
    const checkpointManager = new CheckpointManager();
    const verifier = ReplayVerifierProfiles.strict();

    const originalRun = await scheduler.execute(manifest, plan);
    const checkpoint = await checkpointManager.createCheckpointFromExecution(originalRun);

    const replayRun = await scheduler.execute(manifest, plan);

    const tamperedReplay =
      ReplayTamper.from(replayRun)
        .withSeed("tampered-seed-123")
        .build();

    const verification = await verifier.verify(checkpoint, tamperedReplay);

    expect(verification.replay_valid).toBe(false);
    expect(verification.fingerprint_valid).toBe(false);

    const failing = verification.invariant_results.filter(r => !r.passed);
    expect(failing).toHaveLength(1);
    expect(failing[0].id).toBe("DETERMINISTIC_SEED");
  });
});
