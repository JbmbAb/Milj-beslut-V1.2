import { describe, it, expect } from "vitest";
import { createPfasExecutionManifest } from "../../fixtures/createPfasExecutionManifest";
import { createPfasDagPlan } from "../../fixtures/createPfasDagPlan";
import { DeterministicRuntimeScheduler } from "../../../runtime/DeterministicRuntimeScheduler";
import { createArtifactFactory } from "../../fixtures/createArtifactFactory";
import { CheckpointManager } from "../../../runtime/checkpoint/CheckpointManager";
import { ReplayVerifierProfiles } from "../../../runtime/replay/ReplayVerifierProfiles";
import { DependencyResolver } from "../../../runtime/DependencyResolver";
import { ExecutionContextBuilder } from "../../../runtime/ExecutionContextBuilder";
import { ArtifactProjectionBuilder } from "../../../runtime/ArtifactProjectionBuilder";
import { createCapabilityRegistry } from "../../fixtures/createCapabilityRegistry";

describe("pfas-execution-v6.e2e — persisted replay", () => {
  it("strict replay succeeds when checkpoint is serialized and reloaded", async () => {
    const manifest = createPfasExecutionManifest();
    const plan = createPfasDagPlan(manifest);

    const capabilityRegistry = createCapabilityRegistry();
    const dependencyResolver = new DependencyResolver();
    const contextBuilder = new ExecutionContextBuilder();
    const artifactFactoryA = createArtifactFactory();
    const projectionBuilderA = new ArtifactProjectionBuilder(artifactFactoryA);
    const schedulerA = new DeterministicRuntimeScheduler(capabilityRegistry, dependencyResolver, contextBuilder, projectionBuilderA);

    const checkpointManagerA = new CheckpointManager();

    const originalRun = await schedulerA.execute(manifest, plan);
    const checkpoint = await checkpointManagerA.createCheckpointFromExecution(originalRun);

    const serialized = JSON.stringify(checkpoint);

    const artifactFactoryB = createArtifactFactory();
    const projectionBuilderB = new ArtifactProjectionBuilder(artifactFactoryB);
    const schedulerB = new DeterministicRuntimeScheduler(capabilityRegistry, dependencyResolver, contextBuilder, projectionBuilderB);

    const checkpointReloaded = JSON.parse(serialized);

    const replayRun = await schedulerB.execute(manifest, plan);

    const verifier = ReplayVerifierProfiles.strict();
    const verification = await verifier.verify(checkpointReloaded, replayRun);

    expect(verification.replay_valid).toBe(true);
    expect(verification.fingerprint_valid).toBe(true);
    expect(verification.mismatches).toHaveLength(0);
  });
});
