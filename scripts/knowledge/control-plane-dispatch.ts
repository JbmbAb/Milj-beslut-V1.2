/**
 * KNOWLEDGE-CONTROL-PLANE-INTEGRATION-V1 — composition root.
 *
 * Wires ONE concrete Knowledge unit into the EXISTING, generic Multi-Agent
 * Control Plane V1 machinery purely by dependency injection: a fresh,
 * Knowledge-scoped `DurableMultiAgentCoordinator` backed by its own
 * `FileDurableControlPlaneStore` (default: `.devgov/control-plane/knowledge-store.json`,
 * never the Control Plane's own store file), reusing the unmodified
 * `FileAgentMailbox` for agent dispatch. This file adds zero new decision
 * logic to StateMachine/Router/HandoffIngestor/LeaseRegistry/EventLog/
 * DurableCoordinator — every one of those is imported and used exactly as
 * Control Plane's own tests already exercise it.
 *
 * What this module is authoritative for: NOTHING semantic. It is plumbing.
 * The two pure functions it calls (`seedKnowledgeUnitState`, `toAgentHandoff`)
 * are format-only translations; the actual PASS/FAIL verdict a Knowledge run
 * produced must already be decided by the time `driveKnowledgeHandoff` is
 * called — see packages/mps-knowledge-control-plane-adapter/src/KnowledgeHandoffCodec.ts.
 *
 * Usage as a library (the composition root a real implementer/verifier agent
 * process would call after running its own governed Knowledge vitest suite):
 *
 *   const store = new FileDurableControlPlaneStore(knowledgeControlPlaneStorePath());
 *   const coordinator = buildKnowledgeCoordinator(store, mailboxPath, devGovDispatch);
 *   await seedAndActivateKnowledgeUnit(store, unitDefinition, { now });
 *   await coordinator.acceptHandoff(toAgentHandoff(implementerRunResult));
 *
 * This module intentionally does NOT dispatch to GitHub itself: constructing
 * a real `GitHubDevGovDispatchAdapter` needs live resolver/availability/
 * correlator ports (network + repo credentials) that do not belong in a
 * process-agnostic composition root. Callers inject whatever `DevGovDispatchPort`
 * fits their environment; `main()` below uses a local, file-backed stub so
 * this script is runnable and testable without any GitHub access.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AppendOnlyEventLog,
  DurableMultiAgentCoordinator,
  FileAgentMailbox,
  FileDurableControlPlaneStore,
  applyControllerActivation,
  type AgentDispatchPort,
  type DevGovDispatchPort,
  type DevGovWorkItem,
  type DurableCoordinatorResult,
  type MultiAgentUnitState,
} from '../../packages/mps-control-plane/src/multi-agent';
import {
  seedKnowledgeUnitState,
  toAgentHandoff,
  type KnowledgeRunResult,
  type KnowledgeUnitDefinitionLike,
  type SeedKnowledgeUnitOptions,
} from '../../packages/mps-knowledge-control-plane-adapter/src';

/** Default store path -- distinct from any Control-Plane-owned store file. */
export function defaultKnowledgeControlPlaneStorePath(root: string = process.cwd()): string {
  return path.join(root, '.devgov', 'control-plane', 'knowledge-store.json');
}

export function defaultKnowledgeAgentMailboxPath(root: string = process.cwd()): string {
  return path.join(root, '.devgov', 'control-plane', 'knowledge-mailbox.json');
}

/**
 * Seeds the canonical unit state (PLANNED, revision 0) from a DEV-GOV-V1
 * Knowledge unit definition, then applies the one controller activation
 * every unit needs before its first agent handoff can be accepted
 * (PLANNED -> IMPLEMENTING; `applyVerifiedHandoff` requires `handoff.inputState`
 * to already equal the canonical state). If the unit already exists with the
 * identical seeded identity, this is an idempotent no-op (crash/restart safe:
 * already-PLANNED resumes activation, already-activated returns the current
 * canonical state unchanged); if it exists with a *different* identity, it
 * throws rather than silently reusing another unit's canonical state.
 */
export function seedAndActivateKnowledgeUnit(
  store: FileDurableControlPlaneStore,
  unitDefinition: KnowledgeUnitDefinitionLike,
  options: SeedKnowledgeUnitOptions & { readonly now?: () => Date } = {},
): MultiAgentUnitState {
  const now = options.now ?? (() => new Date());
  const seeded = seedKnowledgeUnitState(unitDefinition, options);

  const snapshot = store.read();
  const existing = snapshot.units[seeded.unitId];
  if (existing) {
    // A unit with this id already has canonical state -- possibly from a prior, already-activated
    // run of this exact seed (crash/restart safety), possibly a genuinely different unit reusing
    // the same id. Compare identity, never state/revision (those legitimately move forward), so a
    // real collision is refused rather than silently overwritten, and a true resume is a no-op.
    const sameIdentity =
      existing.unitDefinitionHash === seeded.unitDefinitionHash &&
      existing.baseSha === seeded.baseSha &&
      existing.branch === seeded.branch &&
      existing.proofContractHash === seeded.proofContractHash &&
      JSON.stringify(existing.scope) === JSON.stringify(seeded.scope);
    if (!sameIdentity) {
      throw new Error(
        `canonical unit ${seeded.unitId} already exists with a different identity than this unit definition would produce`,
      );
    }
    if (existing.state !== 'PLANNED') return existing; // already activated: idempotent no-op
  } else {
    store.initializeUnit(seeded);
  }

  const base = store.read().units[seeded.unitId];
  const activated = applyControllerActivation(base, 'IMPLEMENTING', now().toISOString());
  const liveSnapshot = store.read();
  const eventLog = new AppendOnlyEventLog(liveSnapshot.events);
  const beforeCount = eventLog.all().length;
  eventLog.append(
    activated.unitId,
    'UNIT_STATE_TRANSITIONED',
    {
      actor: 'CONTROLLER',
      reason: 'seed activation: unit definition admitted, implementation may begin',
      from: base.state,
      to: activated.state,
      state: { ...activated },
    },
    now().toISOString(),
  );
  store.commitControllerTransition({ state: activated, events: eventLog.all().slice(beforeCount) });
  return store.read().units[activated.unitId];
}

export function buildKnowledgeCoordinator(
  store: FileDurableControlPlaneStore,
  agentDispatch: AgentDispatchPort,
  devGovDispatch: DevGovDispatchPort,
  now?: () => Date,
): DurableMultiAgentCoordinator {
  return new DurableMultiAgentCoordinator({ store, agentDispatch, devGovDispatch, now });
}

/**
 * Translates an already-decided Knowledge run outcome and drives it through
 * the Knowledge-scoped coordinator. This is the one call site an implementer
 * or verifier agent process makes after its own governed Knowledge vitest
 * run has already produced a verdict -- `toAgentHandoff` copies that verdict,
 * it does not decide one.
 */
export async function driveKnowledgeHandoff(
  coordinator: DurableMultiAgentCoordinator,
  run: KnowledgeRunResult,
): Promise<DurableCoordinatorResult> {
  return coordinator.acceptHandoff(toAgentHandoff(run));
}

/**
 * Local, file-backed DEV-GOV dispatch stub. Records the dispatch payload for
 * inspection instead of calling GitHub -- appropriate for local diagnostics
 * and for this script's own tests; a real deployment injects
 * `GitHubDevGovDispatchAdapter` (reused unmodified from Control Plane V1)
 * instead of this stub.
 */
export class LocalDevGovDispatchStub implements DevGovDispatchPort {
  readonly dispatched: DevGovWorkItem[] = [];
  async dispatch(item: DevGovWorkItem): Promise<string> {
    this.dispatched.push(item);
    return `local-devgov-stub:${item.dispatchKey}`;
  }
}

async function main(): Promise<void> {
  const definitionPath = process.argv[2];
  if (!definitionPath) {
    // eslint-disable-next-line no-console
    console.error('usage: control-plane-dispatch.ts <path-to-dev-gov-v1-unit-definition.json>');
    process.exitCode = 1;
    return;
  }
  const fs = await import('node:fs');
  const unitDefinition = JSON.parse(fs.readFileSync(definitionPath, 'utf8')) as KnowledgeUnitDefinitionLike;

  const store = new FileDurableControlPlaneStore(defaultKnowledgeControlPlaneStorePath());
  const mailbox = new FileAgentMailbox(defaultKnowledgeAgentMailboxPath());
  const devGov = new LocalDevGovDispatchStub();
  const coordinator = buildKnowledgeCoordinator(store, mailbox, devGov);

  const activated = seedAndActivateKnowledgeUnit(store, unitDefinition);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { seeded: activated, note: 'unit seeded and activated; drive handoffs via driveKnowledgeHandoff()' },
      null,
      2,
    ),
  );
  void coordinator;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
