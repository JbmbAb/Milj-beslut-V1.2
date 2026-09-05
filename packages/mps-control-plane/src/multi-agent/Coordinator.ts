import { AppendOnlyEventLog } from "./EventLog";
import { HandoffIngestor } from "./HandoffIngestor";
import type { AgentDispatchPort, ControlPlaneObserver, DevGovDispatchPort } from "./Ports";
import { routeAfterHandoff } from "./Router";
import type { AgentHandoff, MultiAgentUnitState } from "./types";

export class CoordinatorStateError extends Error {}

export interface CoordinatorDependencies {
  readonly agentDispatch: AgentDispatchPort;
  readonly devGovDispatch: DevGovDispatchPort;
  readonly observers?: readonly ControlPlaneObserver[];
  readonly eventLog?: AppendOnlyEventLog;
}

export interface CoordinatorResult {
  readonly state: MultiAgentUnitState;
  readonly duplicate: boolean;
  readonly dispatchId?: string;
}

function dispatchKey(state: MultiAgentUnitState, target: string): string {
  return `${state.unitId}:${state.revision}:${target}`;
}

export class MultiAgentCoordinator {
  private readonly eventLog: AppendOnlyEventLog;
  private readonly ingestor: HandoffIngestor;
  private readonly observers: readonly ControlPlaneObserver[];

  constructor(private readonly deps: CoordinatorDependencies) {
    this.eventLog = deps.eventLog ?? new AppendOnlyEventLog();
    this.ingestor = new HandoffIngestor(this.eventLog);
    this.observers = deps.observers ?? [];
  }

  async acceptHandoff(
    current: MultiAgentUnitState,
    handoff: AgentHandoff,
  ): Promise<CoordinatorResult> {
    const route = routeAfterHandoff(handoff);
    if (route.nextState === current.state) {
      throw new CoordinatorStateError(`no automatic state transition for ${handoff.role}/${handoff.result}`);
    }

    const ingested = this.ingestor.ingest(current, handoff, route.nextState);
    if (ingested.duplicate) return { state: current, duplicate: true };

    for (const observer of this.observers) {
      await observer.onHandoffAccepted?.(handoff, ingested.state);
    }

    if (route.targetRole === "IMPLEMENTER" || route.targetRole === "VERIFIER") {
      const key = dispatchKey(ingested.state, route.targetRole);
      const dispatchId = await this.deps.agentDispatch.dispatch({
        dispatchKey: key,
        unit: ingested.state,
        role: route.targetRole,
        verificationMode: route.verificationMode,
        reason: route.reason,
      });
      this.eventLog.append(ingested.state.unitId, "ROUTE_DECIDED", {
        dispatchKey: key,
        targetRole: route.targetRole,
        dispatchId,
        verificationMode: route.verificationMode ?? null,
      });
      for (const observer of this.observers) await observer.onDispatch?.(route.targetRole, dispatchId);
      return { state: ingested.state, duplicate: false, dispatchId };
    }

    if (route.targetRole === "DEV_GOV") {
      const key = dispatchKey(ingested.state, "DEV_GOV");
      const dispatchId = await this.deps.devGovDispatch.dispatch({
        dispatchKey: key,
        unit: ingested.state,
        reason: route.reason,
      });
      this.eventLog.append(ingested.state.unitId, "ROUTE_DECIDED", {
        dispatchKey: key,
        targetRole: "DEV_GOV",
        dispatchId,
      });
      for (const observer of this.observers) await observer.onDispatch?.("DEV_GOV", dispatchId);
      return { state: ingested.state, duplicate: false, dispatchId };
    }

    return { state: ingested.state, duplicate: false };
  }

  events(): readonly ReturnType<AppendOnlyEventLog["all"]>[number][] {
    return this.eventLog.all();
  }
}
