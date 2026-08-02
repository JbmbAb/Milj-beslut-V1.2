import { ExecutionAttempt } from "../domain/types.js";
import { ExecutionAttemptFactory } from "../execution/ExecutionAttemptFactory.js";

export class LeaseCoordinator {
  constructor(
    private readonly attempts: ExecutionAttemptFactory
  ){}

  recover(
    expired: ExecutionAttempt
  ): ExecutionAttempt {
    if (!expired.attempt_id) {
      throw new Error(
        "Invalid expired attempt"
      );
    }

    return this.attempts.createLeaseRecovery(expired);
  }
}
