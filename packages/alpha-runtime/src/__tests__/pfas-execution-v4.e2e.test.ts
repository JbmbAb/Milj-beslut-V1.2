import { expect, describe, it } from "vitest";
import { DeterministicRuntimeScheduler } from "../runtime/DeterministicRuntimeScheduler";
import { DependencyResolver } from "../runtime/DependencyResolver";
import { ExecutionContextBuilder } from "../runtime/ExecutionContextBuilder";
import { ArtifactMaterializer } from "../runtime/ArtifactMaterializer";
import { createPfasExecutionManifest } from "./fixtures/createPfasExecutionManifest";
import { createPfasDagPlan } from "./fixtures/createPfasDagPlan";
import { createCapabilityRegistry } from "./fixtures/createCapabilityRegistry";
import { createArtifactFactory } from "./fixtures/createArtifactFactory";

describe("PFAS Phase-3.2.3 deterministic DAG execution", () => {
  it("executes, binds lineage and replays deterministically", async () => {
    const manifest = createPfasExecutionManifest();
    const plan = createPfasDagPlan(manifest);

    const capabilityRegistry = createCapabilityRegistry();
    const dependencyResolver = new DependencyResolver();
    const contextBuilder = new ExecutionContextBuilder();
    const artifactFactory = createArtifactFactory();
    const materializer = new ArtifactMaterializer(artifactFactory);

    const scheduler = new DeterministicRuntimeScheduler(
      capabilityRegistry,
      dependencyResolver,
      contextBuilder,
      materializer
    );

    const run1 = await scheduler.execute(manifest, plan);
    const run2 = await scheduler.execute(manifest, plan);

    //
    // Identity binding
    //
    expect(run1.execution_identity_hash.digest).toBe(
      manifest.identity.identity_hash.digest
    );

    //
    // Plan binding
    //
    expect(run1.execution_plan_hash.digest).toBe(plan.content_hash.digest);

    //
    // Dependency graph binding
    //
    expect(run1.dependency_resolution.plan_id).toBe(plan.plan_id);

    expect(run1.dependency_resolution.graph_hash.digest).toBeDefined();

    expect(run1.dependency_resolution.order).toEqual([
      "pfas-import-step",
      "pfas-normalize-step",
      "pfas-analyzer-step"
    ]);

    //
    // Capability lineage
    //
    expect(run1.step_results.map(step => step.capability_ref.id)).toEqual([
      "capability.pfas.import",
      "capability.pfas.normalize",
      "capability.pfas.analyzer"
    ]);

    //
    // Output content addressing
    //
    expect(run1.outputs.length).toBeGreaterThan(0);

    expect(
      run1.outputs.every(output => output.content_hash.digest.length > 0)
    ).toBe(true);

    //
    // Deterministic replay – outputs
    //
    expect(
      run1.outputs.map(output => output.content_hash.digest)
    ).toEqual(
      run2.outputs.map(output => output.content_hash.digest)
    );

    //
    // Deterministic replay – step results
    //
    expect(run1.step_results).toEqual(run2.step_results);

    //
    // Execution timestamps present
    //
    expect(run1.started_at).toBeDefined();
    expect(run1.completed_at).toBeDefined();
  });

  it("rejects cyclic dependency graph", async () => {
    const manifest = createPfasExecutionManifest();
    const plan = createPfasDagPlan(manifest);
    plan.dependencies.push({ from: "pfas-analyzer-step", to: "pfas-import-step", type: "data" });

    const resolver = new DependencyResolver();
    await expect(resolver.resolve(plan)).rejects.toThrow("cyclic_dependency");
  });

  it("rejects missing dependency target", async () => {
    const manifest = createPfasExecutionManifest();
    const plan = createPfasDagPlan(manifest);
    plan.dependencies.push({ from: "pfas-analyzer-step", to: "missing-step", type: "data" });

    const resolver = new DependencyResolver();
    await expect(resolver.resolve(plan)).rejects.toThrow("missing_dependency_target");
  });
});
