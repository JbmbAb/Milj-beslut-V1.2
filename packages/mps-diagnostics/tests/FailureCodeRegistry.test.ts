/**
 * Package 22.3 — FailureCodeRegistry conformance (F22-6)
 */
import { describe, expect, it } from "vitest";
import {
  createFailureArtifact,
  createFailureCodeRegistry,
  defaultFailureCodeRegistry,
  FAILURE_CODE_DEFINITIONS_V1,
  FAILURE_CODE_REGISTRY_VERSION,
  FailureCodeRegistryError,
  type FailureCodeDefinition,
} from "../src/index.js";

describe("F22-6 Failure Code Stability", () => {
  it("F22-6.1 Unknown code is blocked on resolve()", () => {
    expect(() => defaultFailureCodeRegistry.resolve("UNKNOWN-CODE")).toThrow(
      FailureCodeRegistryError,
    );
    expect(() => defaultFailureCodeRegistry.resolve("UNKNOWN-CODE")).toThrow(
      /Unknown failure_code/,
    );
    expect(defaultFailureCodeRegistry.exists("UNKNOWN-CODE")).toBe(false);
  });

  it("F22-6.2 Code meaning is stable (MPS-HARVEST-001 = IMPORT_GATE)", () => {
    const def = defaultFailureCodeRegistry.resolve("MPS-HARVEST-001");
    expect(def.category).toBe("IMPORT_GATE");
    expect(def.severity).toBe("ERROR");
    expect(def.retry_policy).toBe("NONE");
    expect(def.ownership).toBe("GOVERNANCE");
    expect(def.remediation).toBe("Fix invalid spatial geometry");
    expect(def.introduced_version).toBe("22.3");
    expect(defaultFailureCodeRegistry.exists("MPS-HARVEST-001")).toBe(true);
  });

  it("F22-6.3 Two definitions with the same code are forbidden", () => {
    const duplicate: FailureCodeDefinition[] = [
      {
        code: "MPS-HARVEST-001",
        category: "IMPORT_GATE",
        severity: "ERROR",
        retry_policy: "NONE",
        ownership: "GOVERNANCE",
        remediation: "Fix invalid spatial geometry",
        introduced_version: "22.3",
      },
      {
        code: "MPS-HARVEST-001",
        category: "IMPORT_GATE",
        severity: "WARNING",
        retry_policy: "AUTOMATIC",
        ownership: "INGESTION",
        remediation: "Different meaning — forbidden",
        introduced_version: "22.3",
      },
    ];
    expect(() => createFailureCodeRegistry(duplicate)).toThrow(FailureCodeRegistryError);
    expect(() => createFailureCodeRegistry(duplicate)).toThrow(/Duplicate failure_code/);
  });

  it("F22-6.4 Registry versioning is exposed", () => {
    expect(FAILURE_CODE_REGISTRY_VERSION).toBe("1");
    expect(defaultFailureCodeRegistry.registry_version).toBe("1");
    const custom = createFailureCodeRegistry(FAILURE_CODE_DEFINITIONS_V1, "1");
    expect(custom.registry_version).toBe("1");
  });

  it("F22-6 registry does not create FailureArtifacts; severity stays outside artifact identity", () => {
    const artifact = createFailureArtifact({
      failure_code: "MPS-HARVEST-001",
      stage: "IMPORT_GATE",
      execution_id: "exec-reg-1",
      input_refs: [],
      evidence_refs: [],
      failed_controls: ["IMPORT_GATE_SPATIAL_INVALID"],
      diagnostics: { reason: "invalid_geometry" },
      created_at: "2026-08-07T12:00:00.000Z",
    });

    // Identity holds only the code string — governed meaning is looked up separately.
    expect(artifact.failure_code).toBe("MPS-HARVEST-001");
    expect("severity" in artifact).toBe(false);
    expect("retry_policy" in artifact).toBe(false);
    expect("ownership" in artifact).toBe(false);

    const meaning = defaultFailureCodeRegistry.resolve(artifact.failure_code);
    expect(meaning.severity).toBe("ERROR");
    expect(meaning.retry_policy).toBe("NONE");
    expect(meaning.ownership).toBe("GOVERNANCE");
  });

  it("new semantics use a new code (MPS-HARVEST-002), not redefinition of 001", () => {
    const geom = defaultFailureCodeRegistry.resolve("MPS-HARVEST-001");
    const crs = defaultFailureCodeRegistry.resolve("MPS-HARVEST-002");
    expect(geom.summary).toMatch(/geometry/i);
    expect(crs.summary).toMatch(/CRS/i);
    expect(geom.code).not.toBe(crs.code);
  });
});
