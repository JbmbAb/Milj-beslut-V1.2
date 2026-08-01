import type { PipelineStage } from "@miljobeslut/mps-runtime";
import type { ObservationContext } from "./TelemetryTypes";

export class ObservationContextBuilder {
  constructor(
    private readonly base: {
      runtime_id: string;
      registry_snapshot_id: string;
      registry_hash: string;
      pipeline_version: string;
    }
  ) {}

  forStage(stage: PipelineStage, artifact_id?: string): ObservationContext {
    return {
      runtime_id: this.base.runtime_id,
      registry_snapshot_id: this.base.registry_snapshot_id,
      registry_hash: this.base.registry_hash,
      pipeline_version: this.base.pipeline_version,
      stage,
      artifact_id,
    };
  }

  baseContext(): ObservationContext {
    return {
      runtime_id: this.base.runtime_id,
      registry_snapshot_id: this.base.registry_snapshot_id,
      registry_hash: this.base.registry_hash,
      pipeline_version: this.base.pipeline_version,
    };
  }
}
