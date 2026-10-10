import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";
import {
  MIMERS_INTEGRATION_VERSION,
  MimersIntegration,
  resetMimersCasCacheForTests,
} from "./MimersIntegration.js";
import { CasArtifactResolver } from "./ArtifactResolver.js";
import { MemoryByteStorageBackend } from "../repository/CasBackedArtifactRepository.js";

describe("Mimers Integration (Epoch II §2.4)", () => {
  let root: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    root = mkdtempSync(path.join(tmpdir(), "mimers-int-"));
  });

  afterEach(() => {
    resetMimersCasCacheForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("exposes integration version", () => {
    expect(MIMERS_INTEGRATION_VERSION).toBe("1.0.0");
  });

  it("memory path: repository put then resolver read", async () => {
    const integration = await MimersIntegration.create({
      backend: new MemoryByteStorageBackend(),
    });
    expect(integration.isMimersBacked).toBe(false);
    expect(integration.resolver).toBeInstanceOf(CasArtifactResolver);

    const body = { v: 1 };
    const content_hash = sha256ContentHash(body);
    await integration.artifactRepository.put({
      artifact_id: "a-1",
      content_hash,
      body,
    });
    const resolved = await integration.resolver.resolve<typeof body>({
      artifact_id: "a-1",
      artifact_type: "execution_manifest",
    });
    expect(resolved).toEqual(body);
    expect(await integration.rebuildIndex()).toEqual({ rebuilt: 0, skipped: 0 });
    expect(await integration.resolveContentAddress("a-1")).toBeNull();
  });

  it("Mimers path: content-address + index rebuild", async () => {
    const casRoot = path.join(root, "cas");
    mkdirSync(casRoot);
    const env = {
      CAS_ROOT: casRoot,
      MIMERS_DURABILITY_MODE: "none",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv;

    const integration = await MimersIntegration.create({
      env,
      forceMimers: true,
    });
    expect(integration.isMimersBacked).toBe(true);

    const body = { site: "X" };
    const content_hash = sha256ContentHash(body);
    await integration.artifactRepository.put({
      artifact_id: "art-x",
      content_hash,
      body,
    });

    const digest = await integration.resolveContentAddress("art-x");
    expect(digest).toMatch(/^(sha256:)?[a-f0-9]{64}$/);

    const viaResolver = await integration.resolver.resolveEnvelope<typeof body>({
      artifact_id: "art-x",
      artifact_type: "execution_outcome",
    });
    expect(viaResolver.body).toEqual(body);
    expect(viaResolver.content_hash.value).toBe(content_hash.value);

    const rebuilt = await integration.rebuildIndex();
    expect(rebuilt.rebuilt).toBeGreaterThanOrEqual(1);
  });

  it("assertReady fail-closed when MIMERS_REQUIRED without CAS_ROOT", async () => {
    await expect(
      MimersIntegration.assertReady({
        MIMERS_REQUIRED: "1",
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/CAS_ROOT/);
  });
});

/**
 * U30-A: no silent CAS fallbacks outside an explicit test environment.
 *
 * `process.cwd` is redirected to a scratch directory so that the pre-fix behaviour (a silent
 * `path.resolve(".data/mimers")` CAS in the working directory) is observable without ever
 * writing into the repository checkout.
 */
describe("Mimers Integration fail-closed CAS root (U30-A)", () => {
  let root: string;
  let fakeCwd: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    root = mkdtempSync(path.join(tmpdir(), "mimers-u30a-root-"));
    fakeCwd = mkdtempSync(path.join(tmpdir(), "mimers-u30a-cwd-"));
    vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetMimersCasCacheForTests();
    rmSync(root, { recursive: true, force: true });
    rmSync(fakeCwd, { recursive: true, force: true });
  });

  it("outside test, a missing CAS_ROOT fails closed with CAS_ROOT_REQUIRED (no .data/mimers in cwd)", async () => {
    await expect(
      MimersIntegration.create({ env: { NODE_ENV: "development" } as NodeJS.ProcessEnv }),
    ).rejects.toThrow(/^CAS_ROOT_REQUIRED: /);
    expect(existsSync(path.join(fakeCwd, ".data"))).toBe(false);
  });

  it("outside test, MIMERS_REQUIRED without CAS_ROOT keeps its fail-closed message", async () => {
    await expect(
      MimersIntegration.create({
        env: { NODE_ENV: "production", MIMERS_REQUIRED: "true" } as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow(/CAS_ROOT_REQUIRED: MIMERS_REQUIRED set but CAS_ROOT missing/);
    expect(existsSync(path.join(fakeCwd, ".data"))).toBe(false);
  });

  it("LU_MPS_CAS=memory outside test is rejected, not honoured as a silent memory CAS", async () => {
    const casRoot = path.join(root, "cas");
    mkdirSync(casRoot);
    await expect(
      MimersIntegration.create({
        env: { NODE_ENV: "production", LU_MPS_CAS: "memory", CAS_ROOT: casRoot } as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow(/^LU_MPS_CAS_MEMORY_OUTSIDE_TEST: /);
  });

  it("LU_MPS_CAS=memory outside test is rejected even when MIMERS_REQUIRED/forceMimers would pick Mimers", async () => {
    const casRoot = path.join(root, "cas");
    mkdirSync(casRoot);
    await expect(
      MimersIntegration.create({
        env: { NODE_ENV: "development", LU_MPS_CAS: "memory", CAS_ROOT: casRoot, MIMERS_REQUIRED: "1" } as NodeJS.ProcessEnv,
        forceMimers: true,
      }),
    ).rejects.toThrow(/^LU_MPS_CAS_MEMORY_OUTSIDE_TEST: /);
  });

  it.each([
    ["NODE_ENV=test", { NODE_ENV: "test" }],
    ["VITEST", { VITEST: "true" }],
    ["NODE_ENV=test with LU_MPS_CAS=memory", { NODE_ENV: "test", LU_MPS_CAS: "memory" }],
  ])("explicit test environment (%s) still gets the in-memory CAS", async (_label, env) => {
    const integration = await MimersIntegration.create({ env: env as NodeJS.ProcessEnv });
    expect(integration.isMimersBacked).toBe(false);
    expect(existsSync(path.join(fakeCwd, ".data"))).toBe(false);
  });

  it("an explicit CAS_ROOT outside test opens the durable Mimers CAS under that root", async () => {
    const casRoot = path.join(root, "cas");
    mkdirSync(casRoot);
    const integration = await MimersIntegration.create({
      env: { NODE_ENV: "development", CAS_ROOT: casRoot, MIMERS_DURABILITY_MODE: "none" } as NodeJS.ProcessEnv,
    });
    expect(integration.isMimersBacked).toBe(true);
    expect(existsSync(path.join(casRoot, "objects"))).toBe(true);
    expect(existsSync(path.join(fakeCwd, ".data"))).toBe(false);
  });

  it("assertReady outside test fails closed without MIMERS_REQUIRED when CAS_ROOT is missing", async () => {
    await expect(
      MimersIntegration.assertReady({ NODE_ENV: "development" } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/^CAS_ROOT_REQUIRED: /);
    expect(existsSync(path.join(fakeCwd, ".data"))).toBe(false);
  });

  it("assertReady outside test rejects LU_MPS_CAS=memory", async () => {
    const casRoot = path.join(root, "cas");
    mkdirSync(casRoot);
    await expect(
      MimersIntegration.assertReady({
        NODE_ENV: "production",
        LU_MPS_CAS: "memory",
        CAS_ROOT: casRoot,
      } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/^LU_MPS_CAS_MEMORY_OUTSIDE_TEST: /);
  });

  it("assertReady outside test initializes the durable CAS when CAS_ROOT is set", async () => {
    const casRoot = path.join(root, "cas");
    mkdirSync(casRoot);
    await expect(
      MimersIntegration.assertReady({
        NODE_ENV: "development",
        CAS_ROOT: casRoot,
        MIMERS_DURABILITY_MODE: "none",
      } as NodeJS.ProcessEnv),
    ).resolves.toBeUndefined();
    expect(existsSync(path.join(casRoot, "objects"))).toBe(true);
  });

  it("assertReady in an explicit test environment without MIMERS_REQUIRED stays a no-op", async () => {
    await expect(
      MimersIntegration.assertReady({ NODE_ENV: "test" } as NodeJS.ProcessEnv),
    ).resolves.toBeUndefined();
    expect(existsSync(path.join(fakeCwd, ".data"))).toBe(false);
  });
});
