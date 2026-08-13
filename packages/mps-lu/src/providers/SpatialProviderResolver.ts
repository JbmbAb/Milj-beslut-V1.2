import type { RegistryRuntime } from "../../../mps-runtime/src/registry/index.js";
import type { ISpatialProvider } from "../services/SpatialQueryContract";

export const LU_SPATIAL_PROVIDER_KEY = "lu.spatial.postgis" as const;
export const LU_SPATIAL_CAPABILITY_KEY = "spatial.dwithin_existence" as const;
export const LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID = "impl-postgis-spatial-v1" as const;

export interface SpatialProviderResolverDeps {
  readonly registry: RegistryRuntime;
  readonly providers: Readonly<Record<typeof LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID, ISpatialProvider>>;
}

/**
 * P4A-LU-01 — resolve spatial runtime through the engine-neutral provider registry.
 *
 * This is intentionally small: it does not create a new spatial architecture. It enforces that
 * LU code asks for `spatial.dwithin_existence`, resolves the single provider binding registered
 * for the LU release, and obtains the concrete implementation from the injected composition
 * root. Direct `new Postgis...` belongs at that composition root, not inside LU runtime flow.
 */
export class SpatialProviderResolver {
  constructor(private readonly deps: SpatialProviderResolverDeps) {}

  resolve(capabilityKey: string): ISpatialProvider {
    if (capabilityKey !== LU_SPATIAL_CAPABILITY_KEY) {
      throw new Error(`REJECT_SPATIAL_CAPABILITY: unsupported capability ${capabilityKey}`);
    }

    const binding = this.deps.registry.resolveProviderByKey(LU_SPATIAL_PROVIDER_KEY);
    if (!binding) {
      throw new Error(`REJECT_SPATIAL_PROVIDER: missing provider binding ${LU_SPATIAL_PROVIDER_KEY}`);
    }
    if (binding.provider_kind !== "spatial") {
      throw new Error(
        `REJECT_SPATIAL_PROVIDER: ${LU_SPATIAL_PROVIDER_KEY} is ${binding.provider_kind}, not spatial`,
      );
    }
    if (binding.implementation_ref.artifact_id !== LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID) {
      throw new Error(
        `REJECT_SPATIAL_PROVIDER: unexpected implementation ${binding.implementation_ref.artifact_id}`,
      );
    }

    const provider = this.deps.providers[LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID];
    if (!provider) {
      throw new Error(
        `REJECT_SPATIAL_PROVIDER: implementation ${LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID} not available`,
      );
    }
    return provider;
  }
}
