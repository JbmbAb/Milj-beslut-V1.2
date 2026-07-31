import { ExecutionManifest } from "../execution/ExecutionManifest";
import { ExecutionPlanArtifact } from "../execution/ExecutionPlanArtifact";
import { DependencyResolver } from "./DependencyResolver";
import { ExecutionContextBuilder } from "./ExecutionContextBuilder";
import { ArtifactMaterializer } from "./ArtifactMaterializer";
import { RegistryReference } from "../types";

export class DeterministicRuntimeScheduler {
  constructor(
    private capabilityRegistry: any,
    private dependencyResolver: DependencyResolver,
    private contextBuilder: ExecutionContextBuilder,
    private materializer: ArtifactMaterializer
  ) {}

  async execute(manifest: ExecutionManifest, plan: ExecutionPlanArtifact) {
    const started_at = new Date().toISOString();
    
    // Resolve dependency order deterministically
    const dependency_resolution = await this.dependencyResolver.resolve(plan);
    
    const step_results: any[] = [];
    const all_outputs: RegistryReference[] = [];

    // Map step_id to ExecutionStep for quick lookup
    const stepMap = new Map(plan.steps.map(s => [s.step_id, s]));

    for (const step_id of dependency_resolution.order) {
      const step = stepMap.get(step_id)!;
      
      try {
        const adapter = await this.capabilityRegistry.getAdapter(step.capability_ref);
        const context = this.contextBuilder.build(manifest, plan, step);
        
        const capabilityOutput = await adapter.execute(context);
        const produced_outputs = await this.materializer.materialize(capabilityOutput);
        
        all_outputs.push(...produced_outputs);
        
        step_results.push({
          step_id: step.step_id,
          capability_ref: step.capability_ref,
          success: true,
          produced_outputs
        });
      } catch (error) {
        step_results.push({
          step_id: step.step_id,
          capability_ref: step.capability_ref,
          success: false,
          produced_outputs: [],
          details: String(error)
        });
        // Deterministic DAG fails fast on first step failure
        break;
      }
    }

    return {
      execution_manifest_ref: { id: "manifest1", version: "1", content_hash: manifest.identity.identity_hash },
      execution_identity_hash: manifest.identity.identity_hash,
      execution_plan_ref: { id: plan.plan_id, version: "1", content_hash: plan.content_hash },
      execution_plan_hash: plan.content_hash,
      dependency_resolution,
      step_results,
      outputs: all_outputs,
      started_at,
      completed_at: new Date().toISOString(),
      
      // new phase 3.2.4 fields
      deterministic_seed: manifest.identity.deterministic_seed || "default-seed",
      completed_steps: step_results.map(s => s.step_id),
      output_references: all_outputs,
      completed_at_iso: new Date().toISOString()
    };
  }
}
