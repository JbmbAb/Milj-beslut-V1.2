import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runCanonicalLuProductAssessment,
  runLuAssessmentViaKernel,
} from "../execution/LuExecutionKernelClient";
import * as luPackageRoot from "../index";
import { InMemoryArtifactRepository } from "../../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { createLuRegistryRuntime } from "../registry/createLuRegistryRuntime";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../artifacts/SpatialEngineFingerprint";

/**
 * LU-CANONICAL-RUNTIME-HARDENING-R1.
 *
 * `runCanonicalLuProductAssessment` is the public product entrypoint. Its safety properties must
 * hold at RUNTIME, not just in its TypeScript signature:
 *   1. it can never obtain bootstrap admission from MPS_LU_BOOTSTRAP_ADMIT;
 *   2. a JavaScript/`any` caller cannot omit or break identity_subject_v3;
 *   3. the rule engine is not part of the package's public surface.
 *
 * Rejections must happen BEFORE the general engine is entered. That is proven by handing the
 * wrapper a repository and registry that record every property access: after a rejection neither
 * may have been touched (the engine's first two actions are a registry lookup and a repository
 * read/write).
 */

const REJECT_BOOTSTRAP = "LU_CANONICAL_BOOTSTRAP_ADMIT_FORBIDDEN";
const REJECT_SUBJECT = "LU_CANONICAL_IDENTITY_SUBJECT_V3_INVALID";

const BINDING = { artifact_id: "project-context-binding-hardening", artifact_type: "project_context_binding" } as const;
const RELEASE = { artifact_id: "product-release-hardening", artifact_type: "product_release_manifest" } as const;
const GEOMETRY = { artifact_id: "localization-geometry-hardening", artifact_type: "localization_geometry" } as const;

function validSubject() {
  return {
    project_context_binding_ref: { ...BINDING },
    product_release_ref: { ...RELEASE },
    execution_contract_version: "lu-execution-identity-v1",
    localization_geometry_ref: { ...GEOMETRY },
  };
}

function evidence(): SpatialEvidenceArtifact[] {
  return [
    {
      artifact_id: "ev-water-canonical-hardening",
      artifact_type: "SPATIAL_EVIDENCE",
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-canonical-hardening", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
        },
        property_ref: { artifact_id: "prop-canonical-hardening", artifact_type: "PROPERTY" },
        source_metadata: {
          provider: "SGU",
          dataset: "water",
          dataset_version: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          retrieved_at: "2026-08-13T08:00:00.000Z",
        },
        geometry: null,
        srid: 3006,
        operation: {
          algorithm: "spatial.dwithin_existence",
          engine: "PostGIS",
          engine_fingerprint: SPATIAL_STACK_V1,
        },
        layer_ref: { layer_id: "water", version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc", layer_version: "v1" },
        query_context: { query_id: "q-canonical-hardening", query_type: "SPATIAL_DWITHIN", parameters: { search_distance_meters: 100 } },
      },
    },
  ] as unknown as SpatialEvidenceArtifact[];
}

/** Wraps a target so every property read is recorded; nothing is blocked. */
function recording<T extends object>(target: T, touched: string[], label: string): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string") touched.push(`${label}.${prop}`);
      const value = Reflect.get(obj, prop, receiver);
      return typeof value === "function" ? value.bind(obj) : value;
    },
  });
}

function baseInput(touched: string[]) {
  return {
    site_id: "site-canonical-hardening",
    deterministic_seed: "seed:canonical-hardening",
    evidence: evidence(),
    artifact_repository: recording(new InMemoryArtifactRepository(), touched, "repository"),
    registry: recording(createLuRegistryRuntime(), touched, "registry"),
  };
}

/** The JS/`any` boundary: what an untyped caller can actually hand the wrapper. */
const callCanonicalUntyped = (input: unknown) =>
  (runCanonicalLuProductAssessment as unknown as (i: unknown) => Promise<unknown>)(input);

describe("LU-CANONICAL-RUNTIME-HARDENING-R1 -- bootstrap admission", () => {
  beforeEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });
  afterEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  it("with MPS_LU_BOOTSTRAP_ADMIT=1 the canonical product call is rejected before the general engine runs", async () => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
    const touched: string[] = [];

    await expect(
      runCanonicalLuProductAssessment({ ...baseInput(touched), identity_subject_v3: validSubject() }),
    ).rejects.toMatchObject({ code: REJECT_BOOTSTRAP });

    expect(touched, "the general engine must not have been entered").toEqual([]);
  });

  it("the same flag still works for an explicit general-engine call (bootstrap capability is not removed)", async () => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
    const result = await runLuAssessmentViaKernel({
      site_id: "site-canonical-hardening",
      deterministic_seed: "seed:canonical-hardening",
      evidence: evidence(),
      artifact_repository: new InMemoryArtifactRepository(),
      identity_subject_v3: validSubject(),
    });
    expect(result.admitted).toBe(true);
  });

  it("the canonical wrapper does not mutate the ambient flag while rejecting", async () => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = "1";
    await expect(
      runCanonicalLuProductAssessment({ ...baseInput([]), identity_subject_v3: validSubject() }),
    ).rejects.toMatchObject({ code: REJECT_BOOTSTRAP });
    expect(process.env.MPS_LU_BOOTSTRAP_ADMIT).toBe("1");
  });
});

describe("LU-CANONICAL-RUNTIME-HARDENING-R1 -- runtime V3 execution subject", () => {
  beforeEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  const cases: ReadonlyArray<readonly [string, (s: ReturnType<typeof validSubject>) => unknown]> = [
    ["identity_subject_v3 omitted", () => undefined],
    ["identity_subject_v3 null", () => null],
    ["identity_subject_v3 a string", () => "lu-identity-v3"],
    ["identity_subject_v3 an array", () => []],
    ["identity_subject_v3 an empty object", () => ({})],
    ["project_context_binding_ref missing", (s) => ({ ...s, project_context_binding_ref: undefined })],
    ["product_release_ref missing", (s) => ({ ...s, product_release_ref: undefined })],
    ["localization_geometry_ref missing", (s) => ({ ...s, localization_geometry_ref: undefined })],
    ["execution_contract_version missing", (s) => ({ ...s, execution_contract_version: undefined })],
    ["project_context_binding_ref is a bare string", (s) => ({ ...s, project_context_binding_ref: "binding-id" })],
    ["product_release_ref is null", (s) => ({ ...s, product_release_ref: null })],
    ["localization_geometry_ref has empty artifact_id", (s) => ({ ...s, localization_geometry_ref: { ...GEOMETRY, artifact_id: "" } })],
    ["localization_geometry_ref has whitespace artifact_id", (s) => ({ ...s, localization_geometry_ref: { ...GEOMETRY, artifact_id: "   " } })],
    ["product_release_ref has missing artifact_type", (s) => ({ ...s, product_release_ref: { artifact_id: RELEASE.artifact_id } })],
    ["project_context_binding_ref has non-string artifact_type", (s) => ({ ...s, project_context_binding_ref: { ...BINDING, artifact_type: 7 } })],
    ["execution_contract_version empty", (s) => ({ ...s, execution_contract_version: "" })],
    ["execution_contract_version not a string", (s) => ({ ...s, execution_contract_version: 1 })],
  ];

  it.each(cases)("rejects before the general engine when %s", async (_name, mutate) => {
    const touched: string[] = [];
    const input = { ...baseInput(touched), identity_subject_v3: mutate(validSubject()) };

    await expect(callCanonicalUntyped(input)).rejects.toMatchObject({ code: REJECT_SUBJECT });

    expect(touched, "the general engine must not have been entered").toEqual([]);
  });

  it("rejects a call whose whole input is missing", async () => {
    await expect(callCanonicalUntyped(undefined)).rejects.toMatchObject({ code: REJECT_SUBJECT });
  });

  it("a legacy identity_subject_v2 alone never substitutes for V3", async () => {
    const touched: string[] = [];
    const { identity_subject_v3: _omit, ...v2Only } = {
      ...baseInput(touched),
      identity_subject_v3: validSubject(),
    };
    await expect(
      callCanonicalUntyped({
        ...v2Only,
        identity_subject_v2: {
          project_context_binding_ref: BINDING,
          product_release_ref: RELEASE,
          execution_contract_version: "lu-execution-identity-v1",
        },
      }),
    ).rejects.toMatchObject({ code: REJECT_SUBJECT });
    expect(touched).toEqual([]);
  });

  it("a valid V3 subject still reaches the existing engine, with behaviour identical to the general engine", async () => {
    const viaGeneral = await runLuAssessmentViaKernel({
      site_id: "site-canonical-hardening",
      deterministic_seed: "seed:canonical-hardening",
      evidence: evidence(),
      artifact_repository: new InMemoryArtifactRepository(),
      identity_subject_v3: validSubject(),
    });
    const viaCanonical = await runCanonicalLuProductAssessment({
      site_id: "site-canonical-hardening",
      deterministic_seed: "seed:canonical-hardening",
      evidence: evidence(),
      artifact_repository: new InMemoryArtifactRepository(),
      identity_subject_v3: validSubject(),
    });

    // With no bootstrap and no provisioned execution identity both runs deny -- the point is that
    // the canonical wrapper delegates unchanged, not that it admits.
    expect(viaCanonical.admitted).toBe(false);
    expect(viaCanonical.admitted).toBe(viaGeneral.admitted);
    expect(viaCanonical.reason_codes).toEqual(viaGeneral.reason_codes);
    expect(viaCanonical.manifest_id).toBe(viaGeneral.manifest_id);
    expect(viaCanonical.finding_ids).toEqual(viaGeneral.finding_ids);
  });
});

describe("LU-CANONICAL-RUNTIME-HARDENING-R1 -- package export surface", () => {
  const exported = Object.keys(luPackageRoot).sort();

  it("LURuleEngine is not exported from the package root", () => {
    expect(exported).not.toContain("LURuleEngine");
  });

  it("the general engine and its helpers are not exported from the package root", () => {
    expect(exported).not.toContain("runLuAssessmentViaKernel");
    expect(exported).not.toContain("evaluateLuRuleSet");
    expect(exported).not.toContain("createLuRuleEngineInvokeHandler");
  });

  it("the canonical execution API remains present and callable", () => {
    expect(typeof luPackageRoot.runCanonicalLuProductAssessment).toBe("function");
    expect(typeof luPackageRoot.LU_EXECUTION_PRINCIPAL_ID).toBe("string");
  });

  it("the package's engine/execution-entry surface is exactly the reviewed set", () => {
    // Any new run*/evaluate*/rule-engine/re-execution export forces a conscious update here.
    const entrySurface = exported.filter((name) =>
      /^(run[A-Z]|evaluate|LURule|createLuRule|reExecute)/.test(name),
    );
    expect(entrySurface).toEqual(["reExecuteLocalizationAssessment", "runCanonicalLuProductAssessment"]);
  });
});
