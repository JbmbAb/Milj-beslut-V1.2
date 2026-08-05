import { createHash } from "node:crypto";
import type { ContentReference } from "@miljobeslut/mps-evolution";
import type { CapabilityDefinition } from "../contracts/CapabilityDefinition.js";
import type { CapabilityExecutionArtifact } from "../artifacts/CapabilityExecutionArtifact.js";
import type { CapabilityExecutor } from "./CapabilityExecutor.js";
import type { ImplementationResolver } from "../resolver/ImplementationResolver.js";

/**
 * CapabilityExecutor that only knows ImplementationResolver + invoke.
 * SHALL NOT import or reference domain RuleEngines.
 */
export class DeterministicCapabilityExecutor implements CapabilityExecutor {
  constructor(private readonly implementationResolver: ImplementationResolver) {}

  async execute(
    capability: CapabilityDefinition,
    inputRefs: readonly ContentReference[],
  ): Promise<CapabilityExecutionArtifact> {
    const impl = await this.implementationResolver.resolve(capability);
    const output_refs = await impl.invoke(inputRefs);

    const payload = {
      capability_id: capability.artifact_id,
      implementation_id: impl.implementation_id,
      input_refs: inputRefs.map((r) => r.artifact_id),
      output_refs: output_refs.map((r) => r.artifact_id),
    };
    const content_hash = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    return {
      artifact_type: "CAPABILITY_EXECUTION",
      artifact_id: `exec-${capability.artifact_id}-${content_hash.slice(0, 12)}`,
      content_hash,
      schema_version: "1.0",
      signature: { algorithm: "SHA256", value: content_hash },
      capability_ref: { artifact_id: capability.artifact_id },
      input_refs: [...inputRefs],
      output_refs: [...output_refs],
    } as CapabilityExecutionArtifact;
  }
}
