import { describe, it, expect } from "vitest";
import { RuleRegistrySnapshot } from "../src/conformance/RuleRegistrySnapshot";
import { createPackage24Mcs001Matrix } from "../src/matrix/Package24McsMatrix";

describe("Phase 2 - MCS-001 Conformance Matrix", () => {
  it("matrix contains all ADR-24 governance domains", () => {
    const registry = new RuleRegistrySnapshot([]);
    
    const matrix = createPackage24Mcs001Matrix(registry);
    expect(matrix.entries.length).toBe(6);
  });

  it("matrix snapshot cannot mutate", () => {
    const registry = new RuleRegistrySnapshot([]);
    
    const matrix = createPackage24Mcs001Matrix(registry);
    expect(() => {
      // @ts-ignore - intentional mutation for test
      matrix.entries.push({});
    }).toThrow();
  });
});
