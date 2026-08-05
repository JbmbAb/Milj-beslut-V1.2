import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
    const env = {
      MIMERS_ROOT: root,
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

  it("assertReady fail-closed when MIMERS_REQUIRED without root", async () => {
    await expect(
      MimersIntegration.assertReady({
        MIMERS_REQUIRED: "1",
      } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/MIMERS_REQUIRED/);
  });
});
