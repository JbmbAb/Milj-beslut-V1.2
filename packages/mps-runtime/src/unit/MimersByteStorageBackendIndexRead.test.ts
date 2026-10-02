import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileCASRepository } from "@miljobeslut/mimers-brunn-core";
import {
  MIMERS_ARTIFACT_INDEX_READ_FAILED,
  MimersArtifactIndexReadError,
  MimersByteStorageBackend,
} from "../repository/MimersByteStorageBackend.js";
import { CasBackedArtifactRepository } from "../repository/CasBackedArtifactRepository.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";

/**
 * U30-A (coordinator addition, reported by the M1a repair): MimersByteStorageBackend.readHash()
 * mapped EVERY failure to read an id->hash index entry (I/O error, unreadable entry, malformed
 * JSON, entry without a hash) to `null` -- "artifact not indexed". Callers then saw
 * "Artifact not found: <id>", which the geometry chain classifies as a genuine NOT_FOUND (the
 * one case where D9 permits deriving a centroid), and put() treated the id as free and
 * overwrote the unreadable index entry (a WORM bypass).
 *
 * Only a genuinely absent index entry (ENOENT) means "not found". Anything else is a typed
 * storage fault. Real files in a temp directory; no database, no network.
 */
describe("MimersByteStorageBackend: missing index entry vs unreadable index entry", () => {
  let root: string;
  let indexDir: string;
  let backend: MimersByteStorageBackend;

  function indexFile(id: string): string {
    return path.join(indexDir, `${createHash("sha256").update(id).digest("hex")}.idx`);
  }

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), "mimers-index-read-"));
    indexDir = path.join(root, "cas", "artifact-id-index");
    const cas = new FileCASRepository(path.join(root, "cas"), { durabilityMode: "none" });
    await cas.initialize();
    backend = new MimersByteStorageBackend(cas, indexDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a genuinely missing artifact is still 'not found' (null / false), unchanged", async () => {
    expect(await backend.get("never-stored")).toBeNull();
    expect(await backend.exists("never-stored")).toBe(false);
    expect(await backend.resolveContentAddress("never-stored")).toBeNull();
    const repo = new CasBackedArtifactRepository(backend);
    await expect(repo.resolve({ artifact_id: "never-stored", artifact_type: "t" })).rejects.toThrow(
      "Artifact not found: never-stored",
    );
  });

  it("a missing index directory is still 'not found'", async () => {
    const fresh = new MimersByteStorageBackend(
      new FileCASRepository(path.join(root, "cas"), { durabilityMode: "none" }),
      path.join(root, "no-such-index-dir"),
    );
    expect(await fresh.get("anything")).toBeNull();
  });

  it("an unreadable index entry (I/O error) is a typed storage fault, not 'not found'", async () => {
    mkdirSync(indexFile("unreadable"), { recursive: true }); // reading a directory fails with EISDIR
    const error = await backend.get("unreadable").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MimersArtifactIndexReadError);
    expect((error as MimersArtifactIndexReadError).code).toBe(MIMERS_ARTIFACT_INDEX_READ_FAILED);
    expect((error as MimersArtifactIndexReadError).reason).toBe("IO");
    expect((error as MimersArtifactIndexReadError).artifactId).toBe("unreadable");
    await expect(backend.exists("unreadable")).rejects.toBeInstanceOf(MimersArtifactIndexReadError);
    await expect(backend.resolveContentAddress("unreadable")).rejects.toBeInstanceOf(MimersArtifactIndexReadError);
  });

  it("through the resolver, an unreadable entry never surfaces as 'Artifact not found'", async () => {
    mkdirSync(indexFile("unreadable"), { recursive: true });
    const repo = new CasBackedArtifactRepository(backend);
    const error = await repo.resolve({ artifact_id: "unreadable", artifact_type: "t" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MimersArtifactIndexReadError);
    expect((error as Error).message).not.toBe("Artifact not found: unreadable");
  });

  it.each([
    ["not JSON", "{ truncated"],
    ["empty file (torn write)", ""],
    ["JSON without a hash", JSON.stringify({ artifact_id: "malformed" })],
    ["JSON with an empty hash", JSON.stringify({ artifact_id: "malformed", hash: "" })],
    ["JSON null", "null"],
  ])("a malformed index entry (%s) is a typed MALFORMED fault, not 'not found'", async (_label, content) => {
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(indexFile("malformed"), content, "utf8");
    const error = await backend.get("malformed").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MimersArtifactIndexReadError);
    expect((error as MimersArtifactIndexReadError).reason).toBe("MALFORMED");
  });

  it("put() does not overwrite an unreadable index entry (no WORM bypass)", async () => {
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(indexFile("guarded"), "{ truncated", "utf8");
    await expect(backend.put("guarded", Buffer.from("new bytes"))).rejects.toBeInstanceOf(
      MimersArtifactIndexReadError,
    );
    expect(readFileSync(indexFile("guarded"), "utf8")).toBe("{ truncated");
  });

  it("a stored artifact round-trips and the index holds only complete .idx entries", async () => {
    const repo = new CasBackedArtifactRepository(backend);
    const body = { u30: "a6" };
    await repo.put({ artifact_id: "stored", content_hash: sha256ContentHash(body), body });
    expect(await repo.resolve({ artifact_id: "stored", artifact_type: "t" })).toEqual(body);
    expect(await backend.exists("stored")).toBe(true);
    expect(readdirSync(indexDir).every((name) => name.endsWith(".idx"))).toBe(true);
    expect(JSON.parse(readFileSync(indexFile("stored"), "utf8"))).toMatchObject({ artifact_id: "stored" });
  });
});
