import type {
  PipelineStage,
  StageInput,
  StageOutput,
} from "./RuntimeTypes";

import type {
  ExecutionContext,
} from "./ExecutionContext";

import type {
  StageHandler,
} from "./StageHandler";

import {
  GovernanceStageHandler,
} from "./StageHandlers/GovernanceStageHandler";

import {
  ArchiveStageHandler,
} from "./StageHandlers/ArchiveStageHandler";

import {
  PromotionStageHandler,
} from "./StageHandlers/PromotionStageHandler";

import {
  RuntimeViolation,
} from "@miljobeslut/mps-core";

export class StageRegistry {

  private readonly handlers: Map<PipelineStage, StageHandler>;

  constructor() {
    this.handlers = new Map<PipelineStage, StageHandler>([
      ["GOVERNANCE", new GovernanceStageHandler()],
      ["ARCHIVE", new ArchiveStageHandler()],
      ["PROMOTION", new PromotionStageHandler()],
    ]);
  }

  async execute<T>(
    input: StageInput,
    ctx: ExecutionContext,
    runtime_id: string
  ): Promise<StageOutput<T>> {

    const handler = this.handlers.get(input.stage);

    if (!handler) {
      throw new RuntimeViolation(
        "UNKNOWN_PIPELINE_STAGE",
        `No handler registered for stage ${input.stage}`,
        input.reference
      );
    }

    return handler.execute(input, ctx, runtime_id) as Promise<StageOutput<T>>;
  }
}
