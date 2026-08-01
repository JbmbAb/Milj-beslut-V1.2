import type {
  StageInput,
  StageOutput,
} from "../RuntimeTypes";

import type {
  ExecutionContext,
} from "../ExecutionContext";

import type {
  StageHandler,
} from "../StageHandler";

import {
  RuntimeViolation,
} from "@miljobeslut/mps-core";

export class PromotionStageHandler
  implements StageHandler {

  async execute(
    input: StageInput,
    ctx: ExecutionContext,
    runtime_id: string
  ): Promise<StageOutput<unknown>> {

    const artifact =
      await ctx.promotion.promote(input.reference);

    const verification =
      await ctx.artifactVerifier.verify(artifact);

    if (!verification.signature_valid || !verification.trusted) {
      throw new RuntimeViolation(
        "ARTIFACT_VERIFICATION_FAILED",
        "Promotion artifact failed verification",
        input.reference
      );
    }

    const stored =
      await ctx.store.put(artifact);

    return {
      stage: input.stage,
      reference: input.reference,
      artifact_id: stored.reference.id,
      artifact,
      runtime_id,
      registry_snapshot_id: ctx.registry.snapshot_id,
      verified: verification,
    };
  }
}
