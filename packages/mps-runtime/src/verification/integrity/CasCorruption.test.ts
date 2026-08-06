import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileCASRepository } from "@miljobeslut/mimers-brunn-core";
import {
  MimersIntegration,
  resetMimersCasCacheForTests,
  getCachedMimersBackendForTests,
} from "../../mimers/MimersIntegration.js";
import { sha256ContentHash } from "../../kernel/ExecutionKernel.js";
import { CasBackedArtifactRepository } from "../../repository/CasBackedArtifactRepository.js";

describe("Integrity — CasCorruption", () => {
  let root: string;

  beforeEach(() => {
    resetMimersCasCacheForTests();
    root = mkdtempSync(path.join(tmpdir(), "cas-corrupt-"));
  });

  afterEach(() => {
    resetMimersCasCacheForTests();
    rmSync(root, { recursive: true, force: true });
  });

  it("flipping one byte → HashVerifier / verifyStoredObject fails", async () => {
    const env = {
      MIMERS_ROOT: root,
      MIMERS_DURABILITY_MODE: "none",
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv;

    const mimers = await MimersIntegration.create({ env, forceMimers: true });
    const repo = mimers.artifactRepository as CasBackedArtifactRepository;
    const body = { integrity: "good", n: 1 };
    const content_hash = sha256ContentHash(body);
    const artifact_id = "art-corrupt-target";

    await repo.put({ artifact_id, content_hash, body });

    const backend = getCachedMimersBackendForTests();
    expect(backend).not.toBeNull();
    const digest = await backend!.resolveContentAddress(artifact_id);
    expect(digest).toBeTruthy();

    const cas = new FileCASRepository(path.join(root, "cas"), {
      durabilityMode: "none",
    });
    await cas.initialize();
    const filePath = cas.getFilePath(digest!);
    const original = await fs.readFile(filePath);
    expect(original.byteLength).toBeGreaterThan(0);

    // Flip one byte
    const corrupted = Buffer.from(original);
    corrupted[0] = corrupted[0]! ^ 0xff;
    await fs.writeFile(filePath, corrupted);

    const verified = await cas.verifyStoredObject(digest!);
    expect(verified.ok).toBe(false);
    expect(verified.error).toMatch(/bitrot|hash/i);

    await expect(cas.getBytes(digest!, { verifyHash: true })).rejects.toThrow(
      /Corruption|hash/i,
    );
  });
});
