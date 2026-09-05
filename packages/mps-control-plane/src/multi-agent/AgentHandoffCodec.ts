import type { AgentHandoff } from "./types";
import type { AgentWorkItem } from "./Ports";

export class AgentHandoffValidationError extends Error {}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AgentHandoffValidationError(`${field} is required`);
  }
  return value;
}

export function parseAgentHandoff(raw: string, work: AgentWorkItem): AgentHandoff {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new AgentHandoffValidationError("agent output must be exactly one JSON handoff object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentHandoffValidationError("agent handoff must be an object");
  }
  const value = parsed as Record<string, unknown>;
  if (value.schema_version !== "multi-agent-handoff-v1") {
    throw new AgentHandoffValidationError("unsupported agent handoff schema");
  }

  const findings = Array.isArray(value.findings) ? value.findings : undefined;
  const outputArtifacts = Array.isArray(value.output_artifacts) ? value.output_artifacts : undefined;
  if (!findings || !outputArtifacts) {
    throw new AgentHandoffValidationError("findings and output_artifacts must be arrays");
  }

  const handoff: AgentHandoff = {
    agentRunId: requireString(value.agent_run_id, "agent_run_id"),
    unitId: requireString(value.unit_id, "unit_id"),
    role: requireString(value.role, "role") as AgentHandoff["role"],
    inputState: requireString(value.input_state, "input_state") as AgentHandoff["inputState"],
    observedBaseSha: requireString(value.observed_base_sha, "observed_base_sha"),
    observedCandidateSha:
      typeof value.observed_candidate_sha === "string" ? value.observed_candidate_sha : undefined,
    unitDefinitionHash:
      typeof value.unit_definition_hash === "string" ? value.unit_definition_hash : undefined,
    proofContractHash:
      typeof value.proof_contract_hash === "string" ? value.proof_contract_hash : undefined,
    result: requireString(value.result, "result") as AgentHandoff["result"],
    verifierIndependent:
      typeof value.verifier_independent === "boolean" ? value.verifier_independent : undefined,
    findings: findings as AgentHandoff["findings"],
    outputArtifacts: outputArtifacts as AgentHandoff["outputArtifacts"],
    requestedNextAction:
      typeof value.requested_next_action === "string" ? value.requested_next_action : undefined,
    startedAt: requireString(value.started_at, "started_at"),
    finishedAt: requireString(value.finished_at, "finished_at"),
  };

  const expected = work.unit;
  if (handoff.unitId !== expected.unitId) throw new AgentHandoffValidationError("handoff unit mismatch");
  if (handoff.role !== work.role) throw new AgentHandoffValidationError("handoff role mismatch");
  if (handoff.inputState !== expected.state) throw new AgentHandoffValidationError("handoff input-state mismatch");
  if (handoff.observedBaseSha !== expected.baseSha) throw new AgentHandoffValidationError("handoff base SHA mismatch");
  if (expected.candidateSha && handoff.observedCandidateSha !== expected.candidateSha) {
    throw new AgentHandoffValidationError("handoff candidate SHA mismatch");
  }
  if (handoff.unitDefinitionHash !== expected.unitDefinitionHash) {
    throw new AgentHandoffValidationError("handoff unit-definition hash mismatch");
  }
  if (expected.proofContractHash && handoff.proofContractHash !== expected.proofContractHash) {
    throw new AgentHandoffValidationError("handoff proof-contract hash mismatch");
  }
  if (work.role === "VERIFIER" && handoff.result === "PASS" && handoff.verifierIndependent !== true) {
    throw new AgentHandoffValidationError("verifier PASS must assert independent verifier identity");
  }

  return handoff;
}
