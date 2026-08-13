import { describe, expect, it, vi } from "vitest";

import { createRegistryRuntime } from "../../mps-runtime/src/registry/index.js";
import type { ISpatialProvider } from "../src/services/SpatialQueryContract";
import {
  LU_SPATIAL_CAPABILITY_KEY,
  LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID,
  LU_SPATIAL_PROVIDER_KEY,
  SpatialProviderResolver,
} from "../src/providers/SpatialProviderResolver";

function provider(label: string): ISpatialProvider {
  return {
    query: vi.fn(async () => []),
    label,
  } as unknown as ISpatialProvider;
}

function registryWithProvider(overrides: {
  readonly provider_kind?: string;
  readonly provider_key?: string;
  readonly implementation_id?: string;
} = {}) {
  return createRegistryRuntime({
    snapshot_id: "p4a-lu-01-registry",
    release_id: "p4a-lu-01-release",
    capabilities: [
      {
        artifact_id: "cap-p4a-lu-01",
        artifact_type: "CAPABILITY_DEFINITION",
        capability_key: "lu.site_assessment",
        capability_version: "1.0.0",
        implementation_ref: { artifact_id: "impl-lu-rule-engine-v1" },
        input_types: ["SPATIAL_EVIDENCE"],
        output_types: ["localization_assessment"],
      },
    ],
    workflows: [
      {
        artifact_id: "wf-p4a-lu-01",
        artifact_type: "WORKFLOW_DEFINITION",
        workflow_key: "lu.site_assessment.workflow",
        workflow_version: "1.0.0",
        steps: [],
      },
    ],
    providers: [
      {
        artifact_id: "provider-p4a-lu-01",
        artifact_type: "PROVIDER_BINDING",
        provider_key: overrides.provider_key ?? LU_SPATIAL_PROVIDER_KEY,
        provider_kind: overrides.provider_kind ?? "spatial",
        implementation_ref: {
          artifact_id:
            overrides.implementation_id ?? LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID,
        },
      },
    ],
  });
}

/**
 * ✅ P4A-LU-01 — CAPABILITY-RESOLVED RUNTIME PROVIDER GREEN PROOF.
 *
 *   Invariant under test:
 *     LU spatial runtime SHALL resolve `spatial.dwithin_existence` through the registry binding
 *     to exactly one production ISpatialProvider. A direct vendor construction or a second
 *     provider implementation must not become the active LU runtime path.
 *
 *   Scope: provider resolution only. P4A-LU-03 static no-bypass and P4A-LU-05 executed runtime
 *   entrypoint proof remain separate.
 */
describe("P4A-LU-01 — capability-resolved single spatial provider", () => {
  it("resolves spatial.dwithin_existence to the single registered production provider", () => {
    const productionProvider = provider("production");
    const resolver = new SpatialProviderResolver({
      registry: registryWithProvider(),
      providers: {
        [LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID]: productionProvider,
      },
    });

    expect(resolver.resolve(LU_SPATIAL_CAPABILITY_KEY)).toBe(productionProvider);
  });

  it("rejects unsupported spatial capability names", () => {
    const resolver = new SpatialProviderResolver({
      registry: registryWithProvider(),
      providers: {
        [LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID]: provider("production"),
      },
    });

    expect(() => resolver.resolve("spatial.buffer")).toThrow(/REJECT_SPATIAL_CAPABILITY/);
  });

  it("fails closed when the registry has no LU spatial provider binding", () => {
    const resolver = new SpatialProviderResolver({
      registry: registryWithProvider({ provider_key: "other.spatial" }),
      providers: {
        [LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID]: provider("production"),
      },
    });

    expect(() => resolver.resolve(LU_SPATIAL_CAPABILITY_KEY)).toThrow(
      /missing provider binding/,
    );
  });

  it("fails closed when the binding is not spatial", () => {
    const resolver = new SpatialProviderResolver({
      registry: registryWithProvider({ provider_kind: "document" }),
      providers: {
        [LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID]: provider("production"),
      },
    });

    expect(() => resolver.resolve(LU_SPATIAL_CAPABILITY_KEY)).toThrow(/not spatial/);
  });

  it("fails closed when the registry points to an unexpected implementation", () => {
    const resolver = new SpatialProviderResolver({
      registry: registryWithProvider({ implementation_id: "impl-legacy-lu-postgis" }),
      providers: {
        [LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID]: provider("production"),
      },
    });

    expect(() => resolver.resolve(LU_SPATIAL_CAPABILITY_KEY)).toThrow(
      /unexpected implementation/,
    );
  });

  it("fails closed when the registered implementation is unavailable", () => {
    const resolver = new SpatialProviderResolver({
      registry: registryWithProvider(),
      providers: {} as Record<typeof LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID, ISpatialProvider>,
    });

    expect(() => resolver.resolve(LU_SPATIAL_CAPABILITY_KEY)).toThrow(
      /implementation impl-postgis-spatial-v1 not available/,
    );
  });

  it("does not choose between competing provider instances at runtime", () => {
    const productionProvider = provider("production");
    const legacyProvider = provider("legacy");
    const resolver = new SpatialProviderResolver({
      registry: registryWithProvider(),
      providers: {
        [LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID]: productionProvider,
        "impl-legacy-lu-postgis": legacyProvider,
      } as unknown as Record<typeof LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID, ISpatialProvider>,
    });

    expect(
      resolver.resolve(LU_SPATIAL_CAPABILITY_KEY),
      "P4A-LU-01: the registry selects the single active implementation. Extra objects in the " +
        "composition root are inert unless the release binding names them.",
    ).toBe(productionProvider);
    expect(resolver.resolve(LU_SPATIAL_CAPABILITY_KEY)).not.toBe(legacyProvider);
  });
});
