import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileCASRepository } from "@miljobeslut/mimers-brunn-core";
import {
  createKernelArtifactRepository,
  getCachedMimersBackendForTests,
  resetMimersCasCacheForTests,
  assertMimersCasReady,
} from "../repository/createKernelArtifactRepository.js";
import { CasBackedArtifactRepository } from "../repository/CasBackedArtifactRepository.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";

describe("Mimers CAS artifact repository", () => {
  let root: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    root = mkdtempSync(path.join(tmpdir(), "mimers-cas-"));
  });

  afterEach(() => {
    resetMimersCasCacheForTests();
    rmSync(root, { recursive: true, force: true });
  });

  function mimersEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
      MIMERS_ROOT: root,
      MIMERS_DURABILITY_MODE: "none",
      NODE_ENV: "development",
      ...extra,
    } as NodeJS.ProcessEnv;
  }

  it("same artifact_id + content_hash via Mimers and direct CAS bytes", async () => {
    const body = { site: "A", seed: "s1" };
    const content_hash = sha256ContentHash(body);
    const artifact_id = `art-${content_hash.value.slice(0, 16)}`;

    const repo = (await createKernelArtifactRepository({
      env: mimersEnv(),
      forceMimers: true,
    })) as CasBackedArtifactRepository;

    await repo.put({ artifact_id, content_hash, body });

    const envelope = await repo.resolveEnvelope<typeof body>({
      artifact_id,
      artifact_type: "execution_manifest",
    });
    expect(envelope.artifact_id).toBe(artifact_id);
    expect(envelope.content_hash).toEqual(content_hash);
    expect(envelope.body).toEqual(body);

    const backend = getCachedMimersBackendForTests();
    expect(backend).not.toBeNull();
    const casHash = await backend!.resolveContentAddress(artifact_id);
    expect(casHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const cas = new FileCASRepository(path.join(root, "cas"), {
      durabilityMode: "none",
    });
    await cas.initialize();
    const direct = await cas.getBytes(casHash!);
    expect(direct).not.toBeNull();
    const directEnvelope = JSON.parse(Buffer.from(direct!).toString("utf8"));
    expect(directEnvelope.artifact_id).toBe(artifact_id);
    expect(directEnvelope.content_hash).toEqual(content_hash);

    const viaIndex = await backend!.get(artifact_id);
    expect(Buffer.compare(Buffer.from(viaIndex!), Buffer.from(direct!))).toBe(0);
  });

  it("rebuilds id→hash index from CAS after index loss", async () => {
    const content_hash = sha256ContentHash({ n: 1 });
    const artifact_id = "rebuild-me";
    const repo = (await createKernelArtifactRepository({
      env: mimersEnv(),
      forceMimers: true,
    })) as CasBackedArtifactRepository;

    await repo.put({
      artifact_id,
      content_hash,
      body: { n: 1 },
    });

    const indexDir = path.join(root, "cas", "artifact-id-index");
    await fs.rm(indexDir, { recursive: true, force: true });

    const backend = getCachedMimersBackendForTests()!;
    expect(await backend.get(artifact_id)).toBeNull();

    const result = await backend.rebuildIndexFromCas();
    expect(result.rebuilt).toBeGreaterThanOrEqual(1);

    const restored = await repo.resolveEnvelope({
      artifact_id,
      artifact_type: "execution_manifest",
    });
    expect(restored.content_hash).toEqual(content_hash);
    expect(restored.body).toEqual({ n: 1 });
  });

  it("MIMERS_REQUIRED=1 is fail-closed when MIMERS_ROOT missing", async () => {
    await expect(
      createKernelArtifactRepository({
        env: {
          MIMERS_REQUIRED: "1",
          NODE_ENV: "development",
        } as NodeJS.ProcessEnv,
        forceMimers: true,
      }),
    ).rejects.toThrow(/MIMERS_REQUIRED.*MIMERS_ROOT/);

    await expect(
      assertMimersCasReady({
        MIMERS_REQUIRED: "1",
      } as NodeJS.ProcessEnv),
    ).rejects.toThrow(/MIMERS_REQUIRED/);
  });

  it("MIMERS_REQUIRED=1 fails closed when CAS cannot initialize", async () => {
    // Point MIMERS_ROOT at a file so mkdir/init for cas/ fails closed.
    const blocker = path.join(root, "not-a-dir");
    await fs.writeFile(blocker, "block");

    await expect(
      createKernelArtifactRepository({
        env: mimersEnv({
          MIMERS_REQUIRED: "1",
          MIMERS_ROOT: blocker,
        }),
        forceMimers: true,
      }),
    ).rejects.toThrow(/MIMERS_REQUIRED.*failed to initialize/);
  });

  it("content-addressed put is deterministic for identical envelopes", async () => {
    const content_hash = sha256ContentHash({ x: 1 });
    const artifact_id = "det-1";
    const env = mimersEnv();

    const repo1 = await createKernelArtifactRepository({ env, forceMimers: true });
    await repo1.put({ artifact_id, content_hash, body: { x: 1 } });
    const hash1 = await getCachedMimersBackendForTests()!.resolveContentAddress(artifact_id);

    resetMimersCasCacheForTests();
    const repo2 = await createKernelArtifactRepository({ env, forceMimers: true });
    await repo2.put({ artifact_id, content_hash, body: { x: 1 } });
    const hash2 = await getCachedMimersBackendForTests()!.resolveContentAddress(artifact_id);

    expect(hash1).toBe(hash2);
    expect(hash1).toBe(
      `sha256:${createHash("sha256")
        .update(
          Buffer.from(
            JSON.stringify({ artifact_id, content_hash, body: { x: 1 } }),
            "utf8",
          ),
        )
        .digest("hex")}`,
    );
  });
});
