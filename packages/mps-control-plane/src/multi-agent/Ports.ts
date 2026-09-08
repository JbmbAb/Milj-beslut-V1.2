import type { AgentHandoff, MultiAgentRole, MultiAgentUnitState } from "./types";

export interface AgentWorkItem {
  readonly dispatchKey: string;
  readonly unit: MultiAgentUnitState;
  readonly role: "IMPLEMENTER" | "VERIFIER";
  readonly verificationMode?: "FULL_REVERIFY" | "DELTA_REVERIFY";
  readonly reason: string;
}

export interface DevGovWorkItem {
  readonly dispatchKey: string;
  readonly unit: MultiAgentUnitState;
  readonly reason: string;
}

export interface AgentDispatchPort {
  /** Must be idempotent for the same dispatchKey. */
  dispatch(item: AgentWorkItem): Promise<string>;
}

export interface DevGovDispatchPort {
  /** Must be idempotent for the same dispatchKey. */
  dispatch(item: DevGovWorkItem): Promise<string>;
}

export interface ControlPlaneObserver {
  onHandoffAccepted?(handoff: AgentHandoff, state: MultiAgentUnitState): Promise<void> | void;
  onDispatch?(role: MultiAgentRole | "DEV_GOV", dispatchId: string): Promise<void> | void;
}
