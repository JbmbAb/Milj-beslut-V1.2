import { describe, it, expect } from "vitest";
import {
  EXECUTION_MODEL_VERSION,
  EXECUTION_MODEL_CONTRACT_NAMES,
  toReplayIdentity,
} from "./ExecutionContracts.js";
import {
  DEFAULT_ADMISSION_POLICY,
  DEFAULT_EXECUTION_POLICY,
  DEFAULT_RETRY_POLICY,
} from "./ExecutionPolicies.js";
import {
  appendAttemptToSession,
  appendReplayToSession,
  bindOutcomeToSession,
  createExecutionSession,
} from "./ExecutionSessionFactory.js";
import { EXECUTION_CONTRACT_FREEZE_VERSION } from "../freeze/FrozenIdentities.js";
import type { FrozenReplayArtifact } from "../freeze/FrozenIdentities.js";

describe("Execution Contracts & Model (Epoch II §2.2)", () => {
  it("exposes model version aligned with identity freeze major", () => {
    expect(EXECUTION_MODEL_VERSION).toBe("1.0.0");
    expect(EXECUTION_CONTRACT_FREEZE_VERSION).toBe("1.0.0");
  });

  it("locks the nine normative contract names", () => {
    expect([...EXECUTION_MODEL_CONTRACT_NAMES]).toEqual([
      "ExecutionManifest",
      "ExecutionAttempt",
      "ExecutionOutcome",
      "ExecutionSession",
      "ReplayIdentity",
      "TicketIdentity",
      "ExecutionPolicy",
      "AdmissionPolicy",
      "RetryPolicy",
    ]);
  });

  it("default policies forbid admission bypass and require persistence", () => {
    expect(DEFAULT_ADMISSION_POLICY.allow_bypass).toBe(false);
    expect(DEFAULT_EXECUTION_POLICY.require_artifact_persistence).toBe(true);
    expect(DEFAULT_EXECUTION_POLICY.require_capability_resolution).toBe(true);
    expect(DEFAULT_RETRY_POLICY.max_attempts).toBe(3);
    expect(DEFAULT_EXECUTION_POLICY.retry).toEqual(DEFAULT_RETRY_POLICY);
  });

  it("ExecutionSession correlates ticket/attempt/outcome/replay deterministically", () => {
    const manifest_ref = {
      artifact_id: "m-1",
      artifact_type: "execution_manifest",
    };
    let session = createExecutionSession({
      session_id: "sess-1",
      manifest_ref,
      ticket_ref: { artifact_id: "ticket-1", artifact_type: "execution_ticket" },
    });
    expect(session.artifact_type).toBe("execution_session");
    expect(session.content_hash.value).toMatch(/^[a-f0-9]{64}$/);

    const hash1 = session.content_hash.value;
    session = appendAttemptToSession(session, {
      artifact_id: "attempt-1",
      artifact_type: "execution_attempt",
    });
    expect(session.attempt_refs).toHaveLength(1);
    expect(session.content_hash.value).not.toBe(hash1);

    session = bindOutcomeToSession(session, {
      artifact_id: "outcome-1",
      artifact_type: "execution_outcome",
    });
    expect(session.outcome_ref?.artifact_id).toBe("outcome-1");

    session = appendReplayToSession(session, {
      artifact_id: "replay-1",
      artifact_type: "REPLAY",
    });
    // idempotent append
    const again = appendReplayToSession(session, {
      artifact_id: "replay-1",
      artifact_type: "REPLAY",
    });
    expect(again.replay_refs).toHaveLength(1);
    expect(again.content_hash.value).toBe(session.content_hash.value);
  });

  it("toReplayIdentity preserves equivalence proof", () => {
    const replay: FrozenReplayArtifact = {
      artifact_id: "replay-x",
      artifact_type: "REPLAY",
      manifest_ref: { artifact_id: "m", artifact_type: "execution_manifest" },
      replayed_outcome_ref: {
        artifact_id: "o",
        artifact_type: "execution_outcome",
      },
      equivalence_proof: { algorithm: "sha256", value: "a".repeat(64) },
      content_hash: { algorithm: "sha256", value: "b".repeat(64) },
    };
    const id = toReplayIdentity(replay);
    expect(id.equivalence_proof).toEqual(replay.equivalence_proof);
    expect(id.artifact_type).toBe("REPLAY");
  });
});
