import type { ContentReference } from "@miljobeslut/mps-evolution";
import type { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";

/**
 * Resolves a capability's implementation_ref to an invokable function.
 * CapabilityExecutor SHALL NOT know domain RuleEngines — only this resolver + invoke.
 */
export interface InvokableImplementation {
  readonly implementation_id: string;
  invoke(inputs: readonly ContentReference[]): Promise<readonly ContentReference[]>;
}

export interface ImplementationResolver {
  resolve(capability: CapabilityDefinition): Promise<InvokableImplementation>;
}

/**
 * Repository-backed resolver: loads implementation artifact and expects
 * a registered invoke handler map (domain registers handlers at composition root).
 */
export class HandlerMapImplementationResolver implements ImplementationResolver {
  constructor(
    private readonly handlers: ReadonlyMap<
      string,
      (inputs: readonly ContentReference[]) => Promise<readonly ContentReference[]>
    >,
    private readonly resolveImplementationId: (
      capability: CapabilityDefinition,
    ) => Promise<string>,
  ) {}

  async resolve(capability: CapabilityDefinition): Promise<InvokableImplementation> {
    const implementation_id = await this.resolveImplementationId(capability);
    const handler = this.handlers.get(implementation_id);
    if (!handler) {
      throw new Error(`No invoke handler registered for implementation: ${implementation_id}`);
    }
    return {
      implementation_id,
      invoke: handler,
    };
  }
}
