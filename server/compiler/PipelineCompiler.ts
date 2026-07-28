import type { PipelineDefinition, CompilationResult } from './types';
import { DagPlanner } from './dag-planner';
import { CapabilityResolutionPass } from './capability-resolution-pass';
import { PolicyResolutionPass } from './policy-resolution-pass';
import { ResourceBindingPass } from './resource-binding-pass';
import { CanonicalizationPass } from './canonicalization-pass';
import { HashPass } from './hash-pass';
import { ExecutableBuilder } from './executable-builder';

export class PipelineCompiler {
  private readonly dagPlanner = new DagPlanner();
  private readonly resourceBindingPass = new ResourceBindingPass();
  private readonly canonicalizationPass = new CanonicalizationPass();
  private readonly hashPass = new HashPass();
  private readonly executableBuilder = new ExecutableBuilder();

  constructor(
    private readonly capabilityPass: CapabilityResolutionPass,
    private readonly policyPass: PolicyResolutionPass,
  ) {}

  async compile(definition: PipelineDefinition): Promise<CompilationResult> {
    const start = performance.now();
    const warnings: string[] = [];

    this.dagPlanner.validate(definition);

    const capabilities = this.capabilityPass.run(definition);
    const policies = this.policyPass.run(definition);

    const { definition: boundDefinition, bindings } =
      this.resourceBindingPass.run(definition);

    const manifest = this.canonicalizationPass.run(
      boundDefinition,
      capabilities,
      policies,
      bindings,
    );

    const hashes = this.hashPass.compute(manifest);

    const executionOrder = this.dagPlanner.computeExecutionOrder(boundDefinition);

    const pipeline = this.executableBuilder.build(manifest, hashes, executionOrder);

    const durationMs = performance.now() - start;

    return {
      pipeline,
      manifest,
      hashes,
      warnings,
      durationMs,
    };
  }
}
