import type {
  ReplayTarget,
  ReplayResult,
} from "./ReplayTypes";

import {
  ReplaySession,
} from "./ReplaySession";

import type {
  ReplayVerifier,
} from "./ReplayVerifier";

import type {
  UniqueIdGenerator,
  DecisionClock,
} from "@miljobeslut/mps-core";

export interface ReplayEngine {
  replay(
    targets: readonly ReplayTarget[]
  ): Promise<ReplayResult>;
}

export class DefaultReplayEngine implements ReplayEngine {

  constructor(
    private readonly verifier: ReplayVerifier,
    private readonly clock: DecisionClock,
    private readonly idGen: UniqueIdGenerator,
    private readonly replay_profile_name: string = "default-replay-profile"
  ) {}

  async replay(
    targets: readonly ReplayTarget[]
  ): Promise<ReplayResult> {

    const session = new ReplaySession(
      this.verifier,
      this.clock,
      this.idGen,
      this.replay_profile_name
    );

    return session.run(targets);
  }
}
