import type {
  StageInput,
  StageOutput,
  ExecutionReport,
  ExecutionManifest,
} from "./RuntimeTypes";

import type {
  ExecutionContext,
} from "./ExecutionContext";

import {
  StageRegistry,
} from "./StageRegistry";

export class PipelineExecutor {

  constructor(
    private readonly ctx: ExecutionContext
  ) {}

  async execute(
    stages: readonly StageInput[]
  ): Promise<ExecutionReport> {

    const runtime_id = this.ctx.idGen.generate();
    const started_at = this.ctx.clock.now().toISOString();

    const stageRegistry = new StageRegistry();
    const outputs: StageOutput<unknown>[] = [];

    for (const stage of stages) {
      const out = await stageRegistry.execute(stage, this.ctx, runtime_id);
      outputs.push(out);
    }

    const manifest: ExecutionManifest = {
      runtime_id,
      registry_snapshot_id: this.ctx.registry.snapshot_id,
      registry_hash: this.ctx.registry.registry_hash, // Fix 1 — ExecutionManifest carry registry_hash
      stages: stages.map(s => ({
        stage: s.stage,
        reference: s.reference,
      })),
    };

    const replayResult =
      await this.ctx.replay.replay(
        manifest.stages
      );

    const finished_at = this.ctx.clock.now().toISOString();

    return {
      runtime_id,
      started_at,
      finished_at,

      registry_snapshot_id: this.ctx.registry.snapshot_id,
      registry_hash: this.ctx.registry.registry_hash,

      stages: outputs,
      replay: replayResult,

      completed: replayResult.completed,
    };
  }
}
