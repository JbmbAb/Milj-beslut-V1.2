import { AppendOnlyEventLog, type ControlPlaneEvent } from "./EventLog";
import { HandoffIngestor } from "./HandoffIngestor";
import type { AgentDispatchPort, ControlPlaneObserver, DevGovDispatchPort } from "./Ports";
import { routeAfterHandoff } from "./Router";
import { applyControllerActivation } from "./StateMachine";
import type { AgentHandoff, MultiAgentUnitState } from "./types";

export class CoordinatorStateError extends Error {}

export interface CoordinatorDependencies {
  readonly agentDispatch: AgentDispatchPort;
  readonly devGovDispatch: DevGovDispatchPort;
  readonly observers?: readonly ControlPlaneObserver[];
  readonly eventLog?: AppendOnlyEventLog;
  readonly now?: () => Date;
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
  private readonly now: () => Date;

  constructor(private readonly deps: CoordinatorDependencies) {
    this.eventLog = deps.eventLog ?? new AppendOnlyEventLog();
    this.ingestor = new HandoffIngestor(this.eventLog);
    this.observers = deps.observers ?? [];
    this.now = deps.now ?? (() => new Date());
  }

  async acceptHandoff(
    current: MultiAgentUnitState,
    handoff: AgentHandoff,
  ): Promise<CoordinatorResult> {
    const route = routeAfterHandoff(handoff);
    if (route.acceptedState === current.state) {
      throw new CoordinatorStateError(`no automatic state transition for ${handoff.role}/${handoff.result}`);
    }

    const ingested = this.ingestor.ingest(current, handoff, route.acceptedState);
    if (ingested.duplicate) return { state: current, duplicate: true };

    for (const observer of this.observers) {
      await observer.onHandoffAccepted?.(handoff, ingested.state);
    }

    let dispatchState = ingested.state;
    if (route.activationState) {
      const activated = applyControllerActivation(
        ingested.state,
        route.activationState,
        this.now().toISOString(),
      );
      this.eventLog.append(activated.unitId, "UNIT_STATE_TRANSITIONED", {
        actor: "CONTROLLER",
        reason: "activate routed work",
        from: ingested.state.state,
        to: activated.state,
        state: { ...activated },
      });
      dispatchState = activated;
    }

    if (route.targetRole === "IMPLEMENTER" || route.targetRole === "VERIFIER") {
      const key = dispatchKey(dispatchState, route.targetRole);
      const dispatchId = await this.deps.agentDispatch.dispatch({
        dispatchKey: key,
        unit: dispatchState,
        role: route.targetRole,
        verificationMode: route.verificationMode,
        reason: route.reason,
      });
      this.eventLog.append(dispatchState.unitId, "ROUTE_DECIDED", {
        dispatchKey: key,
        targetRole: route.targetRole,
        dispatchId,
        verificationMode: route.verificationMode ?? null,
      });
      for (const observer of this.observers) await observer.onDispatch?.(route.targetRole, dispatchId);
      return { state: dispatchState, duplicate: false, dispatchId };
    }

    if (route.targetRole === "DEV_GOV") {
      const key = dispatchKey(dispatchState, "DEV_GOV");
      const dispatchId = await this.deps.devGovDispatch.dispatch({
        dispatchKey: key,
        unit: dispatchState,
        reason: route.reason,
      });
      this.eventLog.append(dispatchState.unitId, "ROUTE_DECIDED", {
        dispatchKey: key,
        targetRole: "DEV_GOV",
        dispatchId,
      });
      for (const observer of this.observers) await observer.onDispatch?.("DEV_GOV", dispatchId);
      return { state: dispatchState, duplicate: false, dispatchId };
    }

    return { state: dispatchState, duplicate: false };
  }

  events(): readonly ControlPlaneEvent[] {
    return this.eventLog.all();
  }
}
