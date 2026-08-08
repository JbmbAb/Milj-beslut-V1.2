import type { ArtifactReference } from "../../../../mps-compliance/src/artifacts/ArtifactReference.js";
import { sha256ContentHash } from "../../../../mps-compliance/src/canonical/sha256Canonical.js";
import type { ExecutionSession } from "./ExecutionContracts.js";
import { DEFAULT_EXECUTION_POLICY } from "./ExecutionPolicies.js";

export type CreateExecutionSessionInput = {
  readonly session_id: string;
  readonly manifest_ref: ArtifactReference;
  readonly ticket_ref?: ArtifactReference | null;
  readonly attempt_refs?: readonly ArtifactReference[];
  readonly outcome_ref?: ArtifactReference | null;
  readonly replay_refs?: readonly ArtifactReference[];
  readonly policy_id?: string;
};

/**
 * Pure factory — correlates identities without I/O or domain imports.
 */
export function createExecutionSession(
  input: CreateExecutionSessionInput,
): ExecutionSession {
  const body = {
    session_id: input.session_id,
    artifact_type: "execution_session" as const,
    manifest_ref: input.manifest_ref,
    ticket_ref: input.ticket_ref ?? null,
    attempt_refs: Object.freeze([...(input.attempt_refs ?? [])]),
    outcome_ref: input.outcome_ref ?? null,
    replay_refs: Object.freeze([...(input.replay_refs ?? [])]),
    policy_id: input.policy_id ?? DEFAULT_EXECUTION_POLICY.policy_id,
  };

  return Object.freeze({
    ...body,
    content_hash: sha256ContentHash(body),
  });
}

export function appendAttemptToSession(
  session: ExecutionSession,
  attempt_ref: ArtifactReference,
): ExecutionSession {
  if (session.attempt_refs.some((r) => r.artifact_id === attempt_ref.artifact_id)) {
    return session;
  }
  return createExecutionSession({
    session_id: session.session_id,
    manifest_ref: session.manifest_ref,
    ticket_ref: session.ticket_ref,
    attempt_refs: [...session.attempt_refs, attempt_ref],
    outcome_ref: session.outcome_ref,
    replay_refs: session.replay_refs,
    policy_id: session.policy_id,
  });
}

export function bindOutcomeToSession(
  session: ExecutionSession,
  outcome_ref: ArtifactReference,
): ExecutionSession {
  return createExecutionSession({
    session_id: session.session_id,
    manifest_ref: session.manifest_ref,
    ticket_ref: session.ticket_ref,
    attempt_refs: session.attempt_refs,
    outcome_ref,
    replay_refs: session.replay_refs,
    policy_id: session.policy_id,
  });
}

export function appendReplayToSession(
  session: ExecutionSession,
  replay_ref: ArtifactReference,
): ExecutionSession {
  if (session.replay_refs.some((r) => r.artifact_id === replay_ref.artifact_id)) {
    return session;
  }
  return createExecutionSession({
    session_id: session.session_id,
    manifest_ref: session.manifest_ref,
    ticket_ref: session.ticket_ref,
    attempt_refs: session.attempt_refs,
    outcome_ref: session.outcome_ref,
    replay_refs: [...session.replay_refs, replay_ref],
    policy_id: session.policy_id,
  });
}
