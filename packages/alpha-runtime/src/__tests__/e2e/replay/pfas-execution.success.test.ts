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

describe("pfas-execution-v6.e2e — deterministic replay", () => {
  it("strict replay succeeds when execution is deterministic", async () => {
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
    const verification = await verifier.verify(checkpoint, replayRun);

    expect(verification.replay_valid).toBe(true);
    expect(verification.fingerprint_valid).toBe(true);
    expect(verification.mismatches).toHaveLength(0);

    verification.invariant_results.forEach(r => expect(r.passed).toBe(true));
  });
});
