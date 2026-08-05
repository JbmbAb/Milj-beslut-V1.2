import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guard: product LU path must not write to legacy .data/mps-cas.
 */
describe("No parallel mps-cas product path", () => {
  it("LuExecutionKernelClient uses createKernelArtifactRepository only", () => {
    const file = path.resolve(
      __dirname,
      "../../../mps-lu/src/execution/LuExecutionKernelClient.ts",
    );
    const src = readFileSync(file, "utf8");
    expect(src).toContain("createKernelArtifactRepository");
    expect(src).not.toContain("FileByteStorageBackend");
    expect(src).not.toContain("LU_MPS_CAS_DIR");
    expect(src).not.toContain(".data/mps-cas");
  });
});
