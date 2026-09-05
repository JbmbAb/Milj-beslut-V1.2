import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ControlPlaneEvent } from './EventLog';
import type { AgentWorkItem, DevGovWorkItem } from './Ports';
import type { MultiAgentUnitState } from './types';

export type DurableOutboxItem =
  | {
      readonly dispatchKey: string;
      readonly target: 'AGENT';
      readonly payload: AgentWorkItem;
      readonly status: 'PENDING' | 'DISPATCHED';
      readonly dispatchId?: string;
    }
  | {
      readonly dispatchKey: string;
      readonly target: 'DEV_GOV';
      readonly payload: DevGovWorkItem;
      readonly status: 'PENDING' | 'DISPATCHED';
      readonly dispatchId?: string;
    };

export interface DurableControlPlaneSnapshot {
  readonly schemaVersion: 'multi-agent-control-plane-store-v1';
  readonly units: Readonly<Record<string, MultiAgentUnitState>>;
  readonly events: readonly ControlPlaneEvent[];
  readonly acceptedAgentRuns: Readonly<Record<string, string>>;
  readonly outbox: Readonly<Record<string, DurableOutboxItem>>;
}

const EMPTY: DurableControlPlaneSnapshot = {
  schemaVersion: 'multi-agent-control-plane-store-v1',
  units: {},
  events: [],
  acceptedAgentRuns: {},
  outbox: {},
};

export class DurableStoreCorruptionError extends Error {}

export class FileDurableControlPlaneStore {
  constructor(private readonly filePath: string) {}

  read(): DurableControlPlaneSnapshot {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!existsSync(this.filePath)) return EMPTY;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      throw new DurableStoreCorruptionError(
        `control-plane store is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new DurableStoreCorruptionError('control-plane store root must be an object');
    }
    const value = parsed as Partial<DurableControlPlaneSnapshot>;
    if (value.schemaVersion !== 'multi-agent-control-plane-store-v1') {
      throw new DurableStoreCorruptionError('unsupported control-plane store schema');
    }
    if (!value.units || !Array.isArray(value.events) || !value.acceptedAgentRuns || !value.outbox) {
      throw new DurableStoreCorruptionError('control-plane store is missing required sections');
    }
    return value as DurableControlPlaneSnapshot;
  }

  write(next: DurableControlPlaneSnapshot): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.filePath);
  }

  initializeUnit(state: MultiAgentUnitState): void {
    const current = this.read();
    const existing = current.units[state.unitId];
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(state)) {
        throw new DurableStoreCorruptionError(
          `canonical unit ${state.unitId} already exists with different identity/state`,
        );
      }
      return;
    }
    this.write({ ...current, units: { ...current.units, [state.unitId]: state } });
  }

  pendingOutbox(): readonly DurableOutboxItem[] {
    return Object.values(this.read().outbox).filter((item) => item.status === 'PENDING');
  }

  appendAuditEvents(events: readonly ControlPlaneEvent[]): void {
    if (events.length === 0) return;
    const current = this.read();
    this.assertEventContinuation(current.events, events);
    this.write({ ...current, events: [...current.events, ...events] });
  }

  commitTransition(input: {
    readonly state: MultiAgentUnitState;
    readonly events: readonly ControlPlaneEvent[];
    readonly agentRunId: string;
    readonly fingerprint: string;
    readonly outboxItem?: DurableOutboxItem;
  }): void {
    const current = this.read();
    const existingFingerprint = current.acceptedAgentRuns[input.agentRunId];
    if (existingFingerprint && existingFingerprint !== input.fingerprint) {
      throw new DurableStoreCorruptionError(
        `agent run ${input.agentRunId} already has a different durable fingerprint`,
      );
    }

    const existingState = current.units[input.state.unitId];
    if (!existingState) {
      throw new DurableStoreCorruptionError(`canonical unit ${input.state.unitId} does not exist`);
    }
    const transitionEvents = input.events.filter((event) => event.kind === 'UNIT_STATE_TRANSITIONED');
    if (transitionEvents.length < 1) {
      throw new DurableStoreCorruptionError('durable state change requires transition audit event');
    }
    if (input.state.revision !== existingState.revision + transitionEvents.length) {
      throw new DurableStoreCorruptionError(
        `canonical unit revision delta must equal audited transitions: ${existingState.revision} -> ${input.state.revision}`,
      );
    }
    const lastTransitionState = transitionEvents.at(-1)?.payload.state as
      Partial<MultiAgentUnitState> | undefined;
    if (
      lastTransitionState?.state !== input.state.state ||
      lastTransitionState?.revision !== input.state.revision
    ) {
      throw new DurableStoreCorruptionError('final transition event does not bind final canonical state');
    }
    if (input.state.baseSha !== existingState.baseSha) {
      throw new DurableStoreCorruptionError('base SHA substitution denied during durable transition');
    }
    if (
      existingState.candidateSha &&
      input.state.candidateSha &&
      input.state.candidateSha !== existingState.candidateSha
    ) {
      throw new DurableStoreCorruptionError('candidate SHA substitution denied during durable transition');
    }
    if (input.state.unitDefinitionHash !== existingState.unitDefinitionHash) {
      throw new DurableStoreCorruptionError('unit definition identity substitution denied');
    }
    if (
      existingState.proofContractHash &&
      input.state.proofContractHash &&
      input.state.proofContractHash !== existingState.proofContractHash
    ) {
      throw new DurableStoreCorruptionError('proof contract identity substitution denied');
    }

    this.assertEventContinuation(current.events, input.events);

    const outbox = { ...current.outbox };
    if (input.outboxItem) {
      const existing = outbox[input.outboxItem.dispatchKey];
      if (existing && JSON.stringify(existing.payload) !== JSON.stringify(input.outboxItem.payload)) {
        throw new DurableStoreCorruptionError(
          `dispatch key ${input.outboxItem.dispatchKey} already has different payload`,
        );
      }
      outbox[input.outboxItem.dispatchKey] = existing ?? input.outboxItem;
    }

    this.write({
      ...current,
      units: { ...current.units, [input.state.unitId]: input.state },
      events: [...current.events, ...input.events],
      acceptedAgentRuns: { ...current.acceptedAgentRuns, [input.agentRunId]: input.fingerprint },
      outbox,
    });
  }

  /**
   * Controller-driven transition with no incoming agent handoff (e.g. an
   * external-dependency probe finding the DEV-GOV orchestration workflow
   * absent). Reuses the same revision-continuity, identity-immutability and
   * transition-audit-binding invariants as commitTransition, but has no
   * agentRunId to dedup against. Idempotency instead comes from the
   * revision check itself: if this exact transition was already durably
   * committed, `existingState` already equals the target and the call is a
   * silent no-op rather than a duplicate-apply error.
   */
  commitControllerTransition(input: {
    readonly state: MultiAgentUnitState;
    readonly events: readonly ControlPlaneEvent[];
  }): void {
    const current = this.read();
    const existingState = current.units[input.state.unitId];
    if (!existingState) {
      throw new DurableStoreCorruptionError(`canonical unit ${input.state.unitId} does not exist`);
    }
    if (existingState.state === input.state.state && existingState.revision === input.state.revision) {
      return;
    }

    const transitionEvents = input.events.filter((event) => event.kind === 'UNIT_STATE_TRANSITIONED');
    if (transitionEvents.length < 1) {
      throw new DurableStoreCorruptionError('durable state change requires transition audit event');
    }
    if (input.state.revision !== existingState.revision + transitionEvents.length) {
      throw new DurableStoreCorruptionError(
        `canonical unit revision delta must equal audited transitions: ${existingState.revision} -> ${input.state.revision}`,
      );
    }
    const lastTransitionState = transitionEvents.at(-1)?.payload.state as
      Partial<MultiAgentUnitState> | undefined;
    if (
      lastTransitionState?.state !== input.state.state ||
      lastTransitionState?.revision !== input.state.revision
    ) {
      throw new DurableStoreCorruptionError('final transition event does not bind final canonical state');
    }
    if (input.state.baseSha !== existingState.baseSha) {
      throw new DurableStoreCorruptionError('base SHA substitution denied during durable transition');
    }
    if (
      existingState.candidateSha &&
      input.state.candidateSha &&
      input.state.candidateSha !== existingState.candidateSha
    ) {
      throw new DurableStoreCorruptionError('candidate SHA substitution denied during durable transition');
    }
    if (input.state.unitDefinitionHash !== existingState.unitDefinitionHash) {
      throw new DurableStoreCorruptionError('unit definition identity substitution denied');
    }

    this.assertEventContinuation(current.events, input.events);

    this.write({
      ...current,
      units: { ...current.units, [input.state.unitId]: input.state },
      events: [...current.events, ...input.events],
    });
  }

  markDispatched(dispatchKey: string, dispatchId: string): void {
    const current = this.read();
    const item = current.outbox[dispatchKey];
    if (!item) throw new DurableStoreCorruptionError(`unknown dispatch key ${dispatchKey}`);
    if (item.status === 'DISPATCHED') {
      if (item.dispatchId !== dispatchId) {
        throw new DurableStoreCorruptionError(
          `dispatch key ${dispatchKey} already completed with another dispatch id`,
        );
      }
      return;
    }
    this.write({
      ...current,
      outbox: {
        ...current.outbox,
        [dispatchKey]: { ...item, status: 'DISPATCHED', dispatchId },
      },
    });
  }

  private assertEventContinuation(
    current: readonly ControlPlaneEvent[],
    next: readonly ControlPlaneEvent[],
  ): void {
    if (next.length === 0) return;
    const last = current.at(-1);
    if (last && next[0].previousEventHash !== last.eventHash) {
      throw new DurableStoreCorruptionError('event append does not continue durable hash chain');
    }
    if (!last && next[0].previousEventHash !== null) {
      throw new DurableStoreCorruptionError('first durable event must start a new hash chain');
    }
  }
}
