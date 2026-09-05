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

export interface MultiAgentUnitState {
  readonly unitId: string;
  readonly baseSha: string;
  readonly candidateSha?: string;
  readonly state: MultiAgentState;
  readonly revision: number;
}

export interface AgentHandoff {
  readonly agentRunId: string;
  readonly unitId: string;
  readonly role: MultiAgentRole;
  readonly inputState: MultiAgentState;
  readonly observedBaseSha: string;
  readonly observedCandidateSha?: string;
  readonly result: AgentResult;
  readonly verifierIndependent?: boolean;
  readonly findingClassifications?: readonly (
    | "SEMANTIC"
    | "MECHANICAL"
    | "ENVIRONMENT"
    | "AUTHORITY"
    | "DEPENDENCY"
    | "OTHER"
  )[];
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
