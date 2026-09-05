import type { DevGovDispatchPort, DevGovWorkItem } from "./Ports";

export interface DevGovUnitBinding {
  readonly unitId: string;
  readonly unitDefinitionPath: string;
  readonly unitDefinitionHash: string;
  readonly proofContractHash?: string;
}

export interface DevGovBindingResolver {
  resolve(unitId: string): Promise<DevGovUnitBinding | undefined> | DevGovUnitBinding | undefined;
}

export interface GitHubWorkflowDispatchClient {
  dispatchWorkflow(input: {
    readonly workflow: string;
    readonly ref: string;
    readonly inputs: Readonly<Record<string, string>>;
    readonly idempotencyKey: string;
  }): Promise<{ readonly runId: string }>;
}

export interface GitHubDevGovDispatchAdapterOptions {
  readonly workflow?: string;
  readonly protectedRef?: string;
}

export class DevGovBindingError extends Error {}

export class GitHubDevGovDispatchAdapter implements DevGovDispatchPort {
  private readonly workflow: string;
  private readonly protectedRef: string;

  constructor(
    private readonly resolver: DevGovBindingResolver,
    private readonly client: GitHubWorkflowDispatchClient,
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

    const dispatched = await this.client.dispatchWorkflow({
      workflow: this.workflow,
      ref: this.protectedRef,
      idempotencyKey: item.dispatchKey,
      inputs: {
        candidate_sha: unit.candidateSha,
        unit_definition_path: binding.unitDefinitionPath,
      },
    });
    if (!dispatched.runId) throw new DevGovBindingError("DEV-GOV dispatch returned no run id");
    return `github-actions:${dispatched.runId}`;
  }
}
