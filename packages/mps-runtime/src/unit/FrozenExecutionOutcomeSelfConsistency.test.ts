import { describe, expect, it } from "vitest";
import {
  createFrozenExecutionOutcomeIdentityV2,
  validateFrozenExecutionOutcomeIdentity,
  type FrozenExecutionOutcomeIdentityV1,
} from "../contracts/freeze/FrozenIdentities.js";

const attempt_ref = { artifact_id: "attempt-self-consistency-1", artifact_type: "execution_attempt" } as const;

function outcome(capabilityExecutionId = "capability-execution-a") {
  return createFrozenExecutionOutcomeIdentityV2({
    attempt_ref,
    result: "success",
    capability_execution_ref: { artifact_id: capabilityExecutionId, artifact_type: "CAPABILITY_EXECUTION" },
  });
}

describe("FROZEN-EXECUTION-OUTCOME-SELF-CONSISTENCY-V1", () => {
  it("self-rehashes a V2 outcome from persisted canonical fields alone", () => {
    expect(() => validateFrozenExecutionOutcomeIdentity(outcome())).not.toThrow();
  });
  it("does not alias distinct capability executions", () => {
    expect(outcome("capability-execution-a").content_hash).not.toEqual(outcome("capability-execution-b").content_hash);
  });
  it("fails closed when the persisted V2 capability execution reference is tampered", () => {
    const original = outcome();
    const tampered = { ...original, capability_execution_ref: { artifact_id: "capability-execution-tampered", artifact_type: "CAPABILITY_EXECUTION" as const } };
    expect(() => validateFrozenExecutionOutcomeIdentity(tampered)).toThrow("REJECT_FROZEN_EXECUTION_OUTCOME: canonical payload");
  });
  it("keeps historical V1 outcomes readable under frozen historical semantics", () => {
    const historical: FrozenExecutionOutcomeIdentityV1 = {
      outcome_id: "outcome-attempt-historical-1",
      artifact_type: "execution_outcome",
      attempt_ref: { artifact_id: "attempt-historical-1", artifact_type: "execution_attempt" },
      result: "success",
      content_hash: { algorithm: "sha256", value: "a".repeat(64) },
    };
    expect(() => validateFrozenExecutionOutcomeIdentity(historical)).not.toThrow();
  });
});
