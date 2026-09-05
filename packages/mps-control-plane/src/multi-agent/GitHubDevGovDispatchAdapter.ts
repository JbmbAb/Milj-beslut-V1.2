import type { DevGovDispatchPort, DevGovWorkItem } from "./Ports";
import type { WorkflowDispatchCorrelator } from "./GitHubRunCorrelation";

export interface DevGovUnitBinding {
  readonly unitId: string;
  readonly unitDefinitionPath: string;
  readonly unitDefinitionHash: string;
  readonly proofContractHash?: string;
}

export interface DevGovBindingResolver {
  resolve(unitId: string): Promise<DevGovUnitBinding | undefined> | DevGovUnitBinding | undefined;
}

export interface DevGovWorkflowAvailabilityPort {
  /** Whether `workflow` exists in the repository at `ref` right now. */
  workflowExists(workflow: string, ref: string): Promise<boolean>;
}

export interface GitHubDevGovDispatchAdapterOptions {
  readonly workflow?: string;
  readonly protectedRef?: string;
}

export class DevGovBindingError extends Error {}

/**
 * The workflow this adapter targets (`devgov-v0-orchestrate.yml` by default)
 * does not exist on `main` yet — it is PR #115's deliverable. Dispatch does
 * not attempt to invent its own gate/orchestration semantics; if the
 * workflow is absent it reports DEV_GOV_WORKFLOW_UNAVAILABLE so the caller
 * classifies the unit BLOCKED_DEPENDENCY instead of routing a doomed
 * dispatch that GitHub would 404 on.
 */
export class DevGovWorkflowUnavailableError extends Error {}

/**
 * GitHub's workflow_dispatch endpoint returns 204 No Content: no run id is
 * ever handed back synchronously. This adapter submits the dispatch through
 * a WorkflowDispatchCorrelator (dispatch -> observe -> correlate) and
 * returns an opaque, locally-idempotent dispatch handle — never a
 * fabricated GitHub run id. Resolving the actual run (or discovering
 * AMBIGUOUS_CORRELATION / CORRELATION_TIMEOUT) is a separate, explicit
 * reconciliation step (see DevGovReconciler), not part of this call.
 */
export class GitHubDevGovDispatchAdapter implements DevGovDispatchPort {
  private readonly workflow: string;
  private readonly protectedRef: string;

  constructor(
    private readonly resolver: DevGovBindingResolver,
    private readonly availability: DevGovWorkflowAvailabilityPort,
    private readonly correlator: WorkflowDispatchCorrelator,
    options: GitHubDevGovDispatchAdapterOptions = {},
  ) {
    this.workflow = options.workflow ?? "devgov-v0-orchestrate.yml";
    this.protectedRef = options.protectedRef ?? "main";
  }

  async dispatch(item: DevGovWorkItem): Promise<string> {
    const unit = item.unit;
    if (unit.state !== "PROVING_RED") {
      throw new DevGovBindingError(`DEV-GOV dispatch requires PROVING_RED, got ${unit.state}`);
    }
    if (!unit.candidateSha) throw new DevGovBindingError("DEV-GOV dispatch requires candidate SHA");
    if (!unit.proofContractHash) {
      throw new DevGovBindingError("DEV-GOV dispatch requires canonical proof contract hash");
    }

    const binding = await this.resolver.resolve(unit.unitId);
    if (!binding) throw new DevGovBindingError(`no DEV-GOV binding exists for unit ${unit.unitId}`);
    if (binding.unitId !== unit.unitId) throw new DevGovBindingError("DEV-GOV binding unit mismatch");
    if (binding.unitDefinitionHash !== unit.unitDefinitionHash) {
      throw new DevGovBindingError("DEV-GOV binding unit-definition hash mismatch");
    }
    if (!binding.proofContractHash || binding.proofContractHash !== unit.proofContractHash) {
      throw new DevGovBindingError("DEV-GOV binding proof-contract hash mismatch");
    }
    if (
      !binding.unitDefinitionPath.startsWith("governance/devgov/units/") ||
      binding.unitDefinitionPath.includes("..") ||
      !binding.unitDefinitionPath.endsWith(".json")
    ) {
      throw new DevGovBindingError("DEV-GOV binding has invalid unit-definition path");
    }

    const available = await this.availability.workflowExists(this.workflow, this.protectedRef);
    if (!available) {
      throw new DevGovWorkflowUnavailableError(
        `DEV-GOV workflow ${this.workflow} does not exist on ${this.protectedRef}`,
      );
    }

    const correlation = await this.correlator.dispatch({
      dispatchKey: item.dispatchKey,
      workflow: this.workflow,
      ref: this.protectedRef,
      inputs: {
        candidate_sha: unit.candidateSha,
        unit_definition_path: binding.unitDefinitionPath,
      },
    });
    return `github-actions:pending:${correlation.dispatchKey}`;
  }
}
