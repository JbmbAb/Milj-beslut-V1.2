import { RuntimeExecutionResult } from "../../../runtime/execution/RuntimeExecutionResult";

export class ReplayTamper {
  private constructor(private readonly base: RuntimeExecutionResult) {}

  static from(result: RuntimeExecutionResult): ReplayTamper {
    return new ReplayTamper(result);
  }

  withSeed(seed: string): ReplayTamper {
    return new ReplayTamper({
      ...this.base,
      deterministic_seed: seed,
    });
  }

  withOutputHash(index: number, digest: string): ReplayTamper {
    return new ReplayTamper({
      ...this.base,
      output_references: this.base.output_references.map((ref, i) =>
        i === index
          ? {
              ...ref,
              content_hash: {
                ...ref.content_hash,
                digest,
              },
            }
          : ref
      ),
    });
  }

  withPlanHash(digest: string): ReplayTamper {
    return new ReplayTamper({
      ...this.base,
      execution_plan_hash: {
        ...this.base.execution_plan_hash,
        digest,
      },
    });
  }

  withGraphHash(digest: string): ReplayTamper {
    return new ReplayTamper({
      ...this.base,
      dependency_resolution: {
        ...this.base.dependency_resolution,
        graph_hash: {
          ...this.base.dependency_resolution.graph_hash,
          digest,
        },
      },
    });
  }

  withCompletedSteps(steps: readonly string[]): ReplayTamper {
    return new ReplayTamper({
      ...this.base,
      completed_steps: steps,
    });
  }

  build(): RuntimeExecutionResult {
    return this.base;
  }
}
