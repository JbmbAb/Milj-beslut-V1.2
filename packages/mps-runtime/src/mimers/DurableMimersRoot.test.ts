import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MIMERS_ROOT_REQUIRED,
  MimersRootRequiredError,
  isMimersTestEnvironment,
  resolveDurableMimersRoot,
} from "./DurableMimersRoot.js";
import { MimersIntegration, resetMimersCasCacheForTests } from "./MimersIntegration.js";

/**
 * U30-A (PRES-19): one durable Mimers CAS root as a named shared contract, no fallback directory.
 *
 * ADV-1 rest / U30 verification F7 (low): the root must also be an ABSOLUTE path to an EXISTING
 * directory. A relative MIMERS_ROOT silently re-introduced the cwd dependency U30-A removed, and a
 * misspelled root was silently initialized as a new, EMPTY CAS (FileCASRepository.initialize creates
 * it recursively) in which every stored artifact read as "Artifact not found". Both now fail closed
 * with MIMERS_ROOT_REQUIRED; the resolver only stats the path and never creates anything. Every root
 * used here is a fresh temp directory -- never a real CAS root.
 *
 * M1a-F1 (3): on Windows the root must also name its volume (drive letter or UNC share). Whether an
 * existing directory is the RIGHT root is not decided by this resolver (owner decision, see the
 * M1a-F1 report: root identity marker).
 */
function expectRootRequired(run: () => unknown, consumer: string, detail: RegExp): MimersRootRequiredError {
  let caught: unknown;
  try {
    run();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(MimersRootRequiredError);
  const error = caught as MimersRootRequiredError;
  expect(error.code).toBe(MIMERS_ROOT_REQUIRED);
  expect(error.consumer).toBe(consumer);
  expect(error.message).toMatch(/^MIMERS_ROOT_REQUIRED: /);
  expect(error.message).toMatch(detail);
  expect(error.message).not.toContain(".data/mimers fallback");
  return error;
}

describe("resolveDurableMimersRoot (PRES-19 shared durable root contract)", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(path.join(tmpdir(), "mimers-durable-root-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("returns the absolute MIMERS_ROOT of an existing directory", () => {
    expect(resolveDurableMimersRoot({ MIMERS_ROOT: scratch } as NodeJS.ProcessEnv)).toBe(path.resolve(scratch));
  });

  it("accepts the demo root's shape: an absolute, forward-slash path with a trailing separator", () => {
    const forwardSlashes = `${scratch.split(path.sep).join("/")}/`;
    expect(resolveDurableMimersRoot({ MIMERS_ROOT: forwardSlashes } as NodeJS.ProcessEnv)).toBe(path.resolve(scratch));
  });

  it("trims surrounding whitespace before resolving", () => {
    expect(resolveDurableMimersRoot({ MIMERS_ROOT: `  ${scratch}\r` } as NodeJS.ProcessEnv)).toBe(path.resolve(scratch));
  });

  it.each([
    ["unset", {}],
    ["empty", { MIMERS_ROOT: "" }],
    ["whitespace only", { MIMERS_ROOT: "   " }],
  ])("fails closed with MIMERS_ROOT_REQUIRED when MIMERS_ROOT is %s (no .data/mimers fallback)", (_label, env) => {
    const error = expectRootRequired(() => resolveDurableMimersRoot(env as NodeJS.ProcessEnv, "governance routes"), "governance routes", /governance routes/);
    expect(error.message).not.toContain(".data");
  });

  it.each([".data/mimers", "mimers-root", "./cas", "..\\cas"])(
    "a RELATIVE MIMERS_ROOT (%s) fails closed instead of resolving against the working directory",
    (relative) => {
      expectRootRequired(
        () => resolveDurableMimersRoot({ MIMERS_ROOT: relative } as NodeJS.ProcessEnv, "ExecutionKernel CAS"),
        "ExecutionKernel CAS",
        /not an absolute path/,
      );
    },
  );

  // M1a-F1 (3): on Windows a ROOTED path without a volume ("\x", "/x") passes path.isAbsolute but
  // resolves against the drive of the process's working directory.
  it("a root that names no volume fails closed on Windows ('/srv/mimers', platform win32, deterministic on any OS)", () => {
    expectRootRequired(
      () => resolveDurableMimersRoot({ MIMERS_ROOT: "/srv/mimers" } as NodeJS.ProcessEnv, "ExecutionKernel CAS", "win32"),
      "ExecutionKernel CAS",
      /names no drive letter or UNC share/,
    );
  });

  it.runIf(process.platform === "win32").each([
    ["backslashes", (p: string) => p.slice(2)],
    ["forward slashes", (p: string) => p.slice(2).split("\\").join("/")],
  ])(
    "Windows: an EXISTING directory named without its drive letter (%s) fails closed instead of resolving against the cwd's drive",
    (_label, dropDrive) => {
      expect(scratch).toMatch(/^[A-Za-z]:\\/);
      const driveless = dropDrive(scratch);
      // the old resolver accepted it, because it exists on the working directory's drive
      expect(path.isAbsolute(driveless)).toBe(true);
      expectRootRequired(
        () => resolveDurableMimersRoot({ MIMERS_ROOT: driveless } as NodeJS.ProcessEnv, "lu workers"),
        "lu workers",
        /names no drive letter or UNC share/,
      );
    },
  );

  it.runIf(process.platform === "win32")("Windows: the \\\\?\\ long-path form with a drive letter is accepted (UNC-shaped, names its volume)", () => {
    expect(resolveDurableMimersRoot({ MIMERS_ROOT: `\\\\?\\${scratch}` } as NodeJS.ProcessEnv)).toBe(path.resolve(`\\\\?\\${scratch}`));
  });

  it("a MISSPELLED (non-existent) absolute root fails closed and is not created", () => {
    const typo = path.join(scratch, "mimer-dmeo", "cas");
    expectRootRequired(
      () => resolveDurableMimersRoot({ MIMERS_ROOT: typo } as NodeJS.ProcessEnv, "ExecutionKernel CAS"),
      "ExecutionKernel CAS",
      /does not exist/,
    );
    expect(existsSync(path.join(scratch, "mimer-dmeo"))).toBe(false);
  });

  it("a root that is a FILE fails closed", () => {
    const file = path.join(scratch, "not-a-directory");
    writeFileSync(file, "block");
    expectRootRequired(
      () => resolveDurableMimersRoot({ MIMERS_ROOT: file } as NodeJS.ProcessEnv, "lu workers"),
      "lu workers",
      /is not a directory/,
    );
  });

  it("only NODE_ENV=test or VITEST is an explicit test environment", () => {
    expect(isMimersTestEnvironment({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMimersTestEnvironment({ VITEST: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isMimersTestEnvironment({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isMimersTestEnvironment({ NODE_ENV: "production", LU_MPS_CAS: "memory" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("MimersIntegration never initializes a new, empty CAS under a misspelled or relative root", () => {
  let scratch: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    scratch = mkdtempSync(path.join(tmpdir(), "mimers-durable-root-int-"));
  });

  afterEach(() => {
    resetMimersCasCacheForTests();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("misspelled root: create() fails closed with MIMERS_ROOT_REQUIRED and leaves no directory behind", async () => {
    const typo = path.join(scratch, "mimer-dmeo", "cas");
    await expect(
      MimersIntegration.create({ env: { NODE_ENV: "development", MIMERS_ROOT: typo, MIMERS_DURABILITY_MODE: "none" } as NodeJS.ProcessEnv }),
    ).rejects.toThrow(/^MIMERS_ROOT_REQUIRED: .*does not exist/);
    expect(existsSync(path.join(scratch, "mimer-dmeo"))).toBe(false);
  });

  it("relative root: assertReady() fails closed with MIMERS_ROOT_REQUIRED", async () => {
    await expect(
      MimersIntegration.assertReady({ NODE_ENV: "development", MIMERS_ROOT: ".data/mimers", MIMERS_DURABILITY_MODE: "none" } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/^MIMERS_ROOT_REQUIRED: .*not an absolute path/);
  });

  it("control: an existing absolute root opens the durable CAS under it", async () => {
    const root = path.join(scratch, "durable");
    mkdirSync(root);
    const mimers = await MimersIntegration.create({
      env: { NODE_ENV: "development", MIMERS_ROOT: root, MIMERS_DURABILITY_MODE: "none" } as NodeJS.ProcessEnv,
    });
    expect(mimers.isMimersBacked).toBe(true);
    expect(existsSync(path.join(root, "cas", "objects"))).toBe(true);
  });
});
