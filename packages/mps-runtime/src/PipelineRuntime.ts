import type {
  StageInput,
  ExecutionReport,
} from "./RuntimeTypes";

import type {
  ExecutionContext,
} from "./ExecutionContext";

import {
  PipelineExecutor,
} from "./PipelineExecutor";

export class PipelineRuntime {

  constructor(
    private readonly ctx: ExecutionContext
  ) {}

  async run(
    stages: readonly StageInput[]
  ): Promise<ExecutionReport> {

    const executor = new PipelineExecutor(this.ctx);
    return executor.execute(stages);
  }
}
