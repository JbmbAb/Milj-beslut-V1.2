import { RuntimeSnapshot } from "./RuntimeSnapshot.js";

export interface ExecutionContext {
  readonly snapshot: RuntimeSnapshot;
}

export class ExecutionContextFactory {
  create(
    snapshot: RuntimeSnapshot
  ): ExecutionContext {
    this.verifySnapshot(snapshot);

    return Object.freeze({
      snapshot
    });
  }

  private verifySnapshot(
    snapshot: RuntimeSnapshot
  ) {
    if (!snapshot.plan_ref)
      throw new Error(
        "Snapshot missing plan_ref"
      );

    if (!snapshot.attempt)
      throw new Error(
        "Snapshot missing attempt"
      );
  }
}
