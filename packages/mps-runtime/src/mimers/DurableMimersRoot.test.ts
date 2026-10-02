import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  MIMERS_ROOT_REQUIRED,
  MimersRootRequiredError,
  isMimersTestEnvironment,
  resolveDurableMimersRoot,
} from "./DurableMimersRoot.js";

/**
 * U30-A (PRES-19): one durable Mimers CAS root as a named shared contract.
 * Pure env -> path resolution; no filesystem access, no fallback directory.
 */
describe("resolveDurableMimersRoot (PRES-19 shared durable root contract)", () => {
  it("returns the absolute MIMERS_ROOT", () => {
    const root = path.join(path.parse(process.cwd()).root, "mimer-demo", "cas");
    expect(resolveDurableMimersRoot({ MIMERS_ROOT: root } as NodeJS.ProcessEnv)).toBe(path.resolve(root));
  });

  it("trims surrounding whitespace before resolving", () => {
    const root = path.join(path.parse(process.cwd()).root, "mimers-root");
    expect(resolveDurableMimersRoot({ MIMERS_ROOT: `  ${root}\r` } as NodeJS.ProcessEnv)).toBe(path.resolve(root));
  });

  it.each([
    ["unset", {}],
    ["empty", { MIMERS_ROOT: "" }],
    ["whitespace only", { MIMERS_ROOT: "   " }],
  ])("fails closed with MIMERS_ROOT_REQUIRED when MIMERS_ROOT is %s (no .data/mimers fallback)", (_label, env) => {
    let caught: unknown;
    try {
      resolveDurableMimersRoot(env as NodeJS.ProcessEnv, "governance routes");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MimersRootRequiredError);
    const error = caught as MimersRootRequiredError;
    expect(error.code).toBe(MIMERS_ROOT_REQUIRED);
    expect(error.consumer).toBe("governance routes");
    expect(error.message).toMatch(/^MIMERS_ROOT_REQUIRED: /);
    expect(error.message).toContain("governance routes");
    expect(error.message).not.toContain(".data");
  });

  it("only NODE_ENV=test or VITEST is an explicit test environment", () => {
    expect(isMimersTestEnvironment({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMimersTestEnvironment({ VITEST: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMimersTestEnvironment({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isMimersTestEnvironment({ NODE_ENV: "production", LU_MPS_CAS: "memory" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
