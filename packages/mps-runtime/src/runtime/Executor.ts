import { PlanArtifact, RuntimeResult } from "../domain/types.js";
import { ExecutionContext } from "./ExecutionContextFactory.js";

export class Executor {
  execute(
    plan: PlanArtifact,
    ctx: ExecutionContext
  ): RuntimeResult<PlanArtifact> {
    const start = Date.now();

    // Simulate work
    const duration = Date.now() - start;

    return {
      artifact: plan,
      telemetry: {
        started_at: new Date(
            Date.now() - duration
        ).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: duration
      }
    };
  }
}
