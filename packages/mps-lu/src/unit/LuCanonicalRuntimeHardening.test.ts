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

/**
 * U30-R5 (owner principle, the K0 model; U30R4-VERIFICATION V2): the same flag gate as re-execution, at the
 * product's assessment-creation gate. MPS_LU_BOOTSTRAP_ADMIT PRESENT (any value) in a process that is not an
 * explicit test process (NODE_ENV exactly "test" AND APP_ENV exactly "test" or "ci") refuses the canonical call
 * before the general engine runs, with the typed BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST. The pre-existing refusal of
 * the flag "1" keeps its own code and comes FIRST (the LU-CANONICAL-RUNTIME-HARDENING-R1 proof pins
 * LU_CANONICAL_BOOTSTRAP_ADMIT_FORBIDDEN for "1" in a process with NODE_ENV unset).
 */
describe("U30-R5 -- the canonical product gate refuses MPS_LU_BOOTSTRAP_ADMIT outside an explicit test process", () => {
  const KEYS = ["MPS_LU_BOOTSTRAP_ADMIT", "NODE_ENV", "APP_ENV"] as const;
  const saved = new Map<string, string | undefined>();
  const setEnv = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  };
  beforeEach(() => { for (const key of KEYS) saved.set(key, process.env[key]); });
  afterEach(() => { for (const key of KEYS) setEnv(key, saved.get(key)); });

  for (const [flag, nodeEnv, appEnv] of [
    ["0", "development", undefined],
    ["0", "production", "production"],
    ["", "production", undefined],
    ["true", undefined, undefined],
    ["0", "test", undefined],
    ["0", "test", "development"],
    ["0", "test", "TEST"],
  ] as const) {
    it(`MPS_LU_BOOTSTRAP_ADMIT=${JSON.stringify(flag)} NODE_ENV=${JSON.stringify(nodeEnv)} APP_ENV=${JSON.stringify(appEnv)} -> BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST before the general engine runs`, async () => {
      setEnv("MPS_LU_BOOTSTRAP_ADMIT", flag);
      setEnv("NODE_ENV", nodeEnv);
      setEnv("APP_ENV", appEnv);
      const touched: string[] = [];

      await expect(
        runCanonicalLuProductAssessment({ ...baseInput(touched), identity_subject_v3: validSubject() }),
      ).rejects.toMatchObject({
        name: "LuBootstrapAdmitFlagOutsideTestError",
        code: "BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST",
        // U30-R6 (U30R5-VERIFICATION finding 2, mutant VM5): the refusal names THIS gate, not verify's.
        gate: "canonical_product_assessment",
        message: expect.stringContaining("The canonical product assessment refuses to run"),
      });
      expect(touched, "the general engine must not have been entered").toEqual([]);
    });
  }

  for (const [nodeEnv, appEnv] of [
    [undefined, undefined],
    ["development", undefined],
    ["test", "test"],
  ] as const) {
    it(`MPS_LU_BOOTSTRAP_ADMIT="1" NODE_ENV=${JSON.stringify(nodeEnv)} APP_ENV=${JSON.stringify(appEnv)} -> still LU_CANONICAL_BOOTSTRAP_ADMIT_FORBIDDEN (checked first, unchanged)`, async () => {
      setEnv("MPS_LU_BOOTSTRAP_ADMIT", "1");
      setEnv("NODE_ENV", nodeEnv);
      setEnv("APP_ENV", appEnv);
      const touched: string[] = [];
      await expect(
        runCanonicalLuProductAssessment({ ...baseInput(touched), identity_subject_v3: validSubject() }),
      ).rejects.toMatchObject({ code: REJECT_BOOTSTRAP });
      expect(touched).toEqual([]);
    });
  }

  for (const [flag, nodeEnv, appEnv] of [
    [undefined, "production", "production"],
    [undefined, "development", undefined],
    ["0", "test", "test"],
    ["0", "test", "ci"],
  ] as const) {
    it(`MPS_LU_BOOTSTRAP_ADMIT=${JSON.stringify(flag)} NODE_ENV=${JSON.stringify(nodeEnv)} APP_ENV=${JSON.stringify(appEnv)} -> the gate does not refuse; the call reaches the engine (denied there: no provisioned identity)`, async () => {
      setEnv("MPS_LU_BOOTSTRAP_ADMIT", flag);
      setEnv("NODE_ENV", nodeEnv);
      setEnv("APP_ENV", appEnv);
      const result = await runCanonicalLuProductAssessment({
        site_id: "site-canonical-hardening",
        deterministic_seed: "seed:canonical-hardening",
        evidence: evidence(),
        artifact_repository: new InMemoryArtifactRepository(),
        identity_subject_v3: validSubject(),
      });
      expect(result.admitted).toBe(false);
    });
  }
});

/**
 * U30-R6 (owner decision 2026-10-02/03, A-R5-2 and A-R5-5): the flag gate is a package-root export, so the server and
 * the LU workers can refuse to START with MPS_LU_BOOTSTRAP_ADMIT outside an explicit test process -- the same rule,
 * never a duplicate. Only the gate is exported. "Set" means present: an empty value counts as set.
 */
describe("U30-R6 -- the bootstrap-flag gate is exported from the package root; an empty flag counts as set", () => {
  type Gate = "reexecution" | "canonical_product_assessment" | "process_startup";
  const GATE_TEXT: Readonly<Record<Gate, string>> = {
    reexecution: "The re-execution (verify) refuses to run",
    canonical_product_assessment: "The canonical product assessment refuses to run",
    process_startup: "The process start-up refuses to run",
  };
  const rootGate = () =>
    (luPackageRoot as Record<string, unknown>).assertBootstrapAdmitFlagOnlyInExplicitTestProcess as
      | ((env: Readonly<Record<string, string | undefined>>, gate: Gate) => void)
      | undefined;

  it("exactly the gate is exported: assertBootstrapAdmitFlagOnlyInExplicitTestProcess is a root export; the allowance, the test-process predicate and the error class are not", () => {
    expect(typeof rootGate()).toBe("function");
    const exported = Object.keys(luPackageRoot);
    expect(exported).not.toContain("isBootstrapExecutionReplayAllowed");
    expect(exported).not.toContain("isExplicitLuTestProcess");
    expect(exported).not.toContain("LuBootstrapAdmitFlagOutsideTestError");
    expect(exported).not.toContain("LU_REEXECUTION_CONSISTENCY_KNOWN_LIMITATION");
  });

  for (const [label, env] of [
    ["the flag present but EMPTY, nothing else set", { MPS_LU_BOOTSTRAP_ADMIT: "" }],
    ["the flag present but EMPTY in a production process", { MPS_LU_BOOTSTRAP_ADMIT: "", NODE_ENV: "production", APP_ENV: "production" }],
    ["the flag empty with NODE_ENV=test but APP_ENV unset", { MPS_LU_BOOTSTRAP_ADMIT: "", NODE_ENV: "test" }],
    ["the flag \"1\" in the integrated runtime's configuration", { MPS_LU_BOOTSTRAP_ADMIT: "1", NODE_ENV: "development" }],
    ["the flag \"0\" with APP_ENV=development", { MPS_LU_BOOTSTRAP_ADMIT: "0", NODE_ENV: "test", APP_ENV: "development" }],
  ] as const) {
    for (const gate of ["reexecution", "canonical_product_assessment", "process_startup"] as const) {
      it(`root export, ${label}, gate ${gate} -> throws BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST naming that gate, never an environment value`, () => {
        const assertGate = rootGate();
        expect(typeof assertGate).toBe("function");
        let thrown: unknown = null;
        try {
          assertGate!(env, gate);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toMatchObject({ name: "LuBootstrapAdmitFlagOutsideTestError", code: "BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST", gate });
        const message = String((thrown as Error).message);
        expect(message.startsWith("BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST:")).toBe(true);
        expect(message).toContain(GATE_TEXT[gate]);
        for (const other of Object.keys(GATE_TEXT) as Gate[]) {
          if (other !== gate) expect(message).not.toContain(GATE_TEXT[other]);
        }
        expect(message).not.toMatch(/production|development/);
      });
    }
  }

  for (const [label, env] of [
    ["the flag absent in a production process", { NODE_ENV: "production", APP_ENV: "production" }],
    ["the flag absent, nothing set", {}],
    ["the flag EMPTY in an explicit test process (APP_ENV test)", { MPS_LU_BOOTSTRAP_ADMIT: "", NODE_ENV: "test", APP_ENV: "test" }],
    ["the flag \"1\" in an explicit test process (APP_ENV ci)", { MPS_LU_BOOTSTRAP_ADMIT: "1", NODE_ENV: "test", APP_ENV: "ci" }],
  ] as const) {
    it(`root export, ${label} -> does not throw for any gate`, () => {
      const assertGate = rootGate();
      expect(typeof assertGate).toBe("function");
      for (const gate of ["reexecution", "canonical_product_assessment", "process_startup"] as const) {
        expect(() => assertGate!(env, gate)).not.toThrow();
      }
    });
  }
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
