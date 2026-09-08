import type { AgentFinding, AgentHandoff, AgentOutputArtifact } from "./types";
import type { AgentWorkItem } from "./Ports";

export class AgentHandoffValidationError extends Error {}

const RESULTS = new Set([
  "PASS",
  "FAIL",
  "BLOCKED_ENVIRONMENT",
  "BLOCKED_DESIGN",
  "BLOCKED_DEPENDENCY",
  "DENIED_GOVERNANCE",
  "CANCELLED",
]);
const FINDING_CLASSES = new Set([
  "SEMANTIC",
  "MECHANICAL",
  "ENVIRONMENT",
  "AUTHORITY",
  "DEPENDENCY",
  "OTHER",
]);

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AgentHandoffValidationError(`${field} is required`);
  }
  return value;
}

function requireHex(value: unknown, field: string, length: number): string {
  const stringValue = requireString(value, field);
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(stringValue)) {
    throw new AgentHandoffValidationError(`${field} must be ${length} lowercase hex characters`);
  }
  return stringValue;
}

function parseFindings(value: unknown): readonly AgentFinding[] {
  if (!Array.isArray(value)) throw new AgentHandoffValidationError("findings must be an array");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AgentHandoffValidationError(`findings[${index}] must be an object`);
    }
    const finding = entry as Record<string, unknown>;
    const severity = requireString(finding.severity, `findings[${index}].severity`);
    const classification = requireString(
      finding.classification,
      `findings[${index}].classification`,
    );
    if (severity !== "BLOCKING" && severity !== "NON_BLOCKING") {
      throw new AgentHandoffValidationError(`findings[${index}].severity is invalid`);
    }
    if (!FINDING_CLASSES.has(classification)) {
      throw new AgentHandoffValidationError(`findings[${index}].classification is invalid`);
    }
    return {
      id: requireString(finding.id, `findings[${index}].id`),
      severity,
      classification: classification as AgentFinding["classification"],
      message: requireString(finding.message, `findings[${index}].message`),
    };
  });
}

function parseArtifacts(value: unknown): readonly AgentOutputArtifact[] {
  if (!Array.isArray(value)) {
    throw new AgentHandoffValidationError("output_artifacts must be an array");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AgentHandoffValidationError(`output_artifacts[${index}] must be an object`);
    }
    const artifact = entry as Record<string, unknown>;
    const sha256 = artifact.sha256;
    if (sha256 !== undefined) requireHex(sha256, `output_artifacts[${index}].sha256`, 64);
    return {
      kind: requireString(artifact.kind, `output_artifacts[${index}].kind`),
      ref: requireString(artifact.ref, `output_artifacts[${index}].ref`),
      sha256: typeof sha256 === "string" ? sha256 : undefined,
    };
  });
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

  const result = requireString(value.result, "result");
  if (!RESULTS.has(result)) throw new AgentHandoffValidationError("result is invalid");
  const startedAt = requireString(value.started_at, "started_at");
  const finishedAt = requireString(value.finished_at, "finished_at");
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    throw new AgentHandoffValidationError("agent handoff timestamps are invalid or reversed");
  }

  const handoff: AgentHandoff = {
    agentRunId: requireString(value.agent_run_id, "agent_run_id"),
    unitId: requireString(value.unit_id, "unit_id"),
    role: requireString(value.role, "role") as AgentHandoff["role"],
    inputState: requireString(value.input_state, "input_state") as AgentHandoff["inputState"],
    observedBaseSha: requireHex(value.observed_base_sha, "observed_base_sha", 40),
    observedCandidateSha:
      value.observed_candidate_sha === undefined
        ? undefined
        : requireHex(value.observed_candidate_sha, "observed_candidate_sha", 40),
    unitDefinitionHash:
      value.unit_definition_hash === undefined
        ? undefined
        : requireHex(value.unit_definition_hash, "unit_definition_hash", 64),
    proofContractHash:
      value.proof_contract_hash === undefined
        ? undefined
        : requireHex(value.proof_contract_hash, "proof_contract_hash", 64),
    result: result as AgentHandoff["result"],
    verifierIndependent:
      typeof value.verifier_independent === "boolean" ? value.verifier_independent : undefined,
    findings: parseFindings(value.findings),
    outputArtifacts: parseArtifacts(value.output_artifacts),
    requestedNextAction:
      typeof value.requested_next_action === "string" ? value.requested_next_action : undefined,
    startedAt,
    finishedAt,
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
