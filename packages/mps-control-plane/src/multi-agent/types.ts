export type MultiAgentRole =
  | "IMPLEMENTER"
  | "VERIFIER"
  | "CONTROLLER"
  | "SIGNER"
  | "GATE"
  | "PROMOTER";

export type MultiAgentState =
  | "PLANNED"
  | "IMPLEMENTING"
  | "IMPLEMENTATION_READY"
  | "VERIFYING"
  | "VERIFY_FAILED"
  | "READY_FOR_DEV_GOV"
  | "PROVING_RED"
  | "PROVING_GREEN"
  | "GATING"
  | "GATE_FAILED"
  | "GATE_PASSED"
  | "PROMOTING"
  | "PROMOTION_FAILED"
  | "PROMOTED"
  | "CLOSED"
  | "BLOCKED_ENVIRONMENT"
  | "BLOCKED_DESIGN"
  | "BLOCKED_DEPENDENCY"
  | "CANCELLED"
  | "SUPERSEDED";

export type AgentResult =
  | "PASS"
  | "FAIL"
  | "BLOCKED_ENVIRONMENT"
  | "BLOCKED_DESIGN"
  | "BLOCKED_DEPENDENCY"
  | "DENIED_GOVERNANCE"
  | "CANCELLED";

export type FindingClassification =
  | "SEMANTIC"
  | "MECHANICAL"
  | "ENVIRONMENT"
  | "AUTHORITY"
  | "DEPENDENCY"
  | "OTHER";

export interface MultiAgentUnitState {
  readonly unitId: string;
  readonly unitDefinitionHash: string;
  readonly baseSha: string;
  readonly candidateSha?: string;
  readonly branch: string;
  readonly scope: readonly string[];
  readonly proofContractHash?: string;
  readonly controllerContractVersion: "multi-agent-control-plane-v1";
  readonly state: MultiAgentState;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface AgentFinding {
  readonly id: string;
  readonly severity: "BLOCKING" | "NON_BLOCKING";
  readonly classification: FindingClassification;
  readonly message: string;
}

export interface AgentOutputArtifact {
  readonly kind: string;
  readonly ref: string;
  readonly sha256?: string;
}

export interface AgentHandoff {
  readonly agentRunId: string;
  readonly unitId: string;
  readonly role: MultiAgentRole;
  readonly inputState: MultiAgentState;
  readonly observedBaseSha: string;
  readonly observedCandidateSha?: string;
  readonly unitDefinitionHash?: string;
  readonly proofContractHash?: string;
  readonly result: AgentResult;
  readonly verifierIndependent?: boolean;
  readonly findings: readonly AgentFinding[];
  readonly outputArtifacts: readonly AgentOutputArtifact[];
  readonly requestedNextAction?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface AgentLease {
  readonly leaseId: string;
  readonly unitId: string;
  readonly role: "IMPLEMENTER" | "VERIFIER";
  readonly holder: string;
  readonly scope: readonly string[];
  readonly candidateSha?: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly status: "ACTIVE" | "RELEASED" | "EXPIRED" | "REVOKED";
}
