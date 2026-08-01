import type {
  ReplayContext,
  ReplayTarget,
  ReplayStepResult,
  ReplayFailure,
  ReplayResult,
} from "./ReplayTypes";

import type {
  ReplayVerifier,
} from "./ReplayVerifier";

import type {
  UniqueIdGenerator,
  DecisionClock,
} from "@miljobeslut/mps-core";

export class ReplaySession {

  private readonly context: ReplayContext;
  private readonly steps: ReplayStepResult<unknown>[] = [];
  private readonly failures: ReplayFailure[] = [];

  constructor(
    private readonly verifier: ReplayVerifier,
    private readonly clock: DecisionClock,
    idGen: UniqueIdGenerator,
    replay_profile_name: string
  ) {
    this.context = {
      session_id: idGen.generate(),
      started_at: this.clock.now().toISOString(),
      replay_profile_name,
    };
  }

  async run(targets: readonly ReplayTarget[]): Promise<ReplayResult> {

    for (const target of targets) {
      try {
        const step =
          await this.verifier.verify<unknown>(
            target.stage,
            target.reference
          );

        this.steps.push(step);

      } catch (err: any) {
        this.failures.push({
          stage: target.stage,
          reference: target.reference,
          reason: err?.message ?? "Replay failed",
          code: err?.code ?? "REPLAY_ERROR",
          violation_class: err?.constructor?.name ?? "UnknownError",
        });
      }
    }

    return {
      context: this.context,
      steps: this.steps,
      failures: this.failures,
      completed: this.failures.length === 0,
    };
  }
}
