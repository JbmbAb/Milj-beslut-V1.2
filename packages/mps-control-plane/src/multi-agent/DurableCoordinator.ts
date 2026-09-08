import { AppendOnlyEventLog } from "./EventLog";
import { HandoffIngestor } from "./HandoffIngestor";
import type { AgentDispatchPort, DevGovDispatchPort } from "./Ports";
import { routeAfterHandoff } from "./Router";
import { applyControllerActivation } from "./StateMachine";
import {
  FileDurableControlPlaneStore,
  type DurableOutboxItem,
} from "./FileDurableControlPlaneStore";
import type { AgentHandoff, MultiAgentUnitState } from "./types";

export interface DurableCoordinatorDependencies {
  readonly store: FileDurableControlPlaneStore;
  readonly agentDispatch: AgentDispatchPort;
  readonly devGovDispatch: DevGovDispatchPort;
  readonly now?: () => Date;
}

export interface DurableCoordinatorResult {
  readonly state: MultiAgentUnitState;
  readonly duplicate: boolean;
  readonly dispatchId?: string;
}

function dispatchKey(state: MultiAgentUnitState, target: string): string {
  return `${state.unitId}:${state.revision}:${target}`;
}

export class DurableMultiAgentCoordinator {
  private readonly now: () => Date;

  constructor(private readonly deps: DurableCoordinatorDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async acceptHandoff(handoff: AgentHandoff): Promise<DurableCoordinatorResult> {
    const snapshot = this.deps.store.read();
    const current = snapshot.units[handoff.unitId];
    if (!current) throw new Error(`canonical unit ${handoff.unitId} does not exist`);

    const route = routeAfterHandoff(handoff);
    if (route.acceptedState === current.state) {
      throw new Error(`no automatic state transition for ${handoff.role}/${handoff.result}`);
    }

    const eventLog = new AppendOnlyEventLog(snapshot.events);
    const beforeCount = eventLog.all().length;
    const ingestor = new HandoffIngestor(eventLog, snapshot.acceptedAgentRuns);

    let ingested;
    try {
      ingested = ingestor.ingest(current, handoff, route.acceptedState);
    } catch (error) {
      this.deps.store.appendAuditEvents(eventLog.all().slice(beforeCount));
      throw error;
    }

    if (ingested.duplicate) {
      const expectedKey = this.expectedDispatchKey(current, route.targetRole);
      const pending = expectedKey
        ? this.deps.store.pendingOutbox().find((item) => item.dispatchKey === expectedKey)
        : undefined;
      const dispatchId = pending ? await this.flushItem(pending) : undefined;
      return { state: current, duplicate: true, dispatchId };
    }

    let finalState = ingested.state;
    if (route.activationState) {
      const activated = applyControllerActivation(
        ingested.state,
        route.activationState,
        this.now().toISOString(),
      );
      eventLog.append(activated.unitId, "UNIT_STATE_TRANSITIONED", {
        actor: "CONTROLLER",
        reason: "activate routed work",
        from: ingested.state.state,
        to: activated.state,
        state: { ...activated },
      });
      finalState = activated;
    }

    const outboxItem = this.toOutboxItem(finalState, route);
    this.deps.store.commitTransition({
      state: finalState,
      events: eventLog.all().slice(beforeCount),
      agentRunId: handoff.agentRunId,
      fingerprint: ingested.fingerprint,
      outboxItem,
    });

    const dispatchId = outboxItem ? await this.flushItem(outboxItem) : undefined;
    return { state: finalState, duplicate: false, dispatchId };
  }

  async flushPending(): Promise<readonly string[]> {
    const dispatched: string[] = [];
    for (const item of this.deps.store.pendingOutbox()) {
      dispatched.push(await this.flushItem(item));
    }
    return dispatched;
  }

  private expectedDispatchKey(
    state: MultiAgentUnitState,
    targetRole: ReturnType<typeof routeAfterHandoff>["targetRole"],
  ): string | undefined {
    if (targetRole === "IMPLEMENTER" || targetRole === "VERIFIER" || targetRole === "DEV_GOV") {
      return dispatchKey(state, targetRole);
    }
    return undefined;
  }

  private toOutboxItem(
    state: MultiAgentUnitState,
    route: ReturnType<typeof routeAfterHandoff>,
  ): DurableOutboxItem | undefined {
    if (route.targetRole === "IMPLEMENTER" || route.targetRole === "VERIFIER") {
      const key = dispatchKey(state, route.targetRole);
      return {
        dispatchKey: key,
        target: "AGENT",
        status: "PENDING",
        payload: {
          dispatchKey: key,
          unit: state,
          role: route.targetRole,
          verificationMode: route.verificationMode,
          reason: route.reason,
        },
      };
    }

    if (route.targetRole === "DEV_GOV") {
      const key = dispatchKey(state, "DEV_GOV");
      return {
        dispatchKey: key,
        target: "DEV_GOV",
        status: "PENDING",
        payload: {
          dispatchKey: key,
          unit: state,
          reason: route.reason,
        },
      };
    }

    return undefined;
  }

  private async flushItem(item: DurableOutboxItem): Promise<string> {
    if (item.status === "DISPATCHED") return item.dispatchId ?? "";
    const dispatchId =
      item.target === "AGENT"
        ? await this.deps.agentDispatch.dispatch(item.payload)
        : await this.deps.devGovDispatch.dispatch(item.payload);
    this.deps.store.markDispatched(item.dispatchKey, dispatchId);
    return dispatchId;
  }
}
