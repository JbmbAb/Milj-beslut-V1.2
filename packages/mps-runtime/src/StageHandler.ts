import type {
  StageInput,
  StageOutput,
} from "./RuntimeTypes";

import type {
  ExecutionContext,
} from "./ExecutionContext";

export interface StageHandler<TArtifact = unknown> {
  execute(
    input: StageInput,
    ctx: ExecutionContext,
    runtime_id: string
  ): Promise<StageOutput<TArtifact>>;
}
