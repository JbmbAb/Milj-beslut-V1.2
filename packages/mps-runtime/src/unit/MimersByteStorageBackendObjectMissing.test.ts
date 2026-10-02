import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileCASRepository } from "@miljobeslut/mimers-brunn-core";
import {
  MIMERS_ARTIFACT_INDEX_READ_FAILED,
  MIMERS_ARTIFACT_OBJECT_MISSING,
  MimersArtifactObjectMissingError,
  MimersByteStorageBackend,
} from "../repository/MimersByteStorageBackend.js";
import { CasBackedArtifactRepository } from "../repository/CasBackedArtifactRepository.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";

/**
 * ADV-1 rest / OD-R2 (U30 verification F2): an id->hash index entry that EXISTS but names a CAS
 * object that is no longer in the CAS used to read as "not stored": FileCASRepository.getBytes gives
 * null on ENOENT, MimersByteStorageBackend.get passed that null on, and the resolver threw
 * "Artifact not found: <id>" -- the verdict the localization-geometry chain treats as a determined
 * MISSING artifact. put() over such an entry returned silently (the artifact stayed unreadable, a
 * WORM gap) and exists() said false.
 *
 * The artifact WAS stored (its index entry is written only after its object), so its bytes being gone
 * is a storage integrity fault: get/exists/put now throw MimersArtifactObjectMissingError. A genuinely
 * absent artifact (no index entry) is still null / false / "Artifact not found". Real files in a temp
 * directory (never a real CAS root); every read goes through a FRESH FileCASRepository so no
 * in-process cache can hide the missing object.
 */
describe("MimersByteStorageBackend: index entry present, CAS object missing", () => {
  let root: string;
  let casDir: string;
  let indexDir: string;
  let objectPath: string;
  let hash: string;
  const body = { adv1: "object-missing" };

  function coldBackend(): MimersByteStorageBackend {
    return new MimersByteStorageBackend(new FileCASRepository(casDir, { durabilityMode: "none" }), indexDir);
  }

  function indexFile(id: string): string {
    return path.join(indexDir, `${createHash("sha256").update(id).digest("hex")}.idx`);
  }

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), "mimers-object-missing-"));
    casDir = path.join(root, "cas");
    indexDir = path.join(casDir, "artifact-id-index");
    const cas = new FileCASRepository(casDir, { durabilityMode: "none" });
    await cas.initialize();
    const repo = new CasBackedArtifactRepository(new MimersByteStorageBackend(cas, indexDir));
    await repo.put({ artifact_id: "stored-then-lost", content_hash: sha256ContentHash(body), body });
    hash = JSON.parse(readFileSync(indexFile("stored-then-lost"), "utf8")).hash;
    objectPath = cas.getFilePath(hash);
    rmSync(objectPath); // the object is gone; its index entry stays
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("control: before the object was removed the artifact round-trips (and the index holds only complete entries)", async () => {
    const fresh = mkdtempSync(path.join(tmpdir(), "mimers-object-missing-control-"));
    try {
      const cas = new FileCASRepository(path.join(fresh, "cas"), { durabilityMode: "none" });
      await cas.initialize();
      const freshIndex = path.join(fresh, "cas", "artifact-id-index");
      const repo = new CasBackedArtifactRepository(new MimersByteStorageBackend(cas, freshIndex));
      await repo.put({ artifact_id: "kept", content_hash: sha256ContentHash(body), body });
      expect(await repo.resolve({ artifact_id: "kept", artifact_type: "t" })).toEqual(body);
      expect(readdirSync(freshIndex).every((name) => name.endsWith(".idx"))).toBe(true);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("get() throws the typed integrity fault, never null", async () => {
    const error = await coldBackend().get("stored-then-lost").then(
      (value) => ({ returned: value }),
      (e: unknown) => e,
    );
    expect(error).not.toEqual({ returned: null }); // the old "not stored" answer
    expect(error).toBeInstanceOf(MimersArtifactObjectMissingError);
    const typed = error as MimersArtifactObjectMissingError;
    expect(typed.code).toBe(MIMERS_ARTIFACT_OBJECT_MISSING);
    expect(typed.artifactId).toBe("stored-then-lost");
    expect(typed.hash).toBe(hash);
    expect(typed.message).toMatch(/^MIMERS_ARTIFACT_OBJECT_MISSING: /);
    expect(typed.message).not.toContain(MIMERS_ARTIFACT_INDEX_READ_FAILED);
  });

  it("through CasBackedArtifactRepository / CasArtifactResolver it never surfaces as 'Artifact not found'", async () => {
    const repo = new CasBackedArtifactRepository(coldBackend());
    const error = await repo.resolve({ artifact_id: "stored-then-lost", artifact_type: "t" }).catch((e: unknown) => e);
    expect((error as Error).message).not.toBe("Artifact not found: stored-then-lost");
    expect(error).toBeInstanceOf(MimersArtifactObjectMissingError);
  });

  it("exists() throws the typed integrity fault instead of answering false", async () => {
    const outcome = await coldBackend().exists("stored-then-lost").then(
      (value) => ({ returned: value }),
      (e: unknown) => e,
    );
    expect(outcome).not.toEqual({ returned: false }); // the old "not stored" answer
    expect(outcome).toBeInstanceOf(MimersArtifactObjectMissingError);
  });

  it("put() over such an entry fails closed (no silent return) and changes nothing", async () => {
    const entryBefore = readFileSync(indexFile("stored-then-lost"), "utf8");
    const repo = new CasBackedArtifactRepository(coldBackend());
    const error = await repo
      .put({ artifact_id: "stored-then-lost", content_hash: sha256ContentHash(body), body })
      .then(() => "returned silently", (e: unknown) => e);
    expect(error).not.toBe("returned silently");
    expect(error).toBeInstanceOf(MimersArtifactObjectMissingError);
    expect(readFileSync(indexFile("stored-then-lost"), "utf8")).toBe(entryBefore);
    expect(existsSync(objectPath)).toBe(false); // no silent repair either
  });

  it("a genuinely absent artifact (no index entry) is still 'not found' (null / false / 'Artifact not found')", async () => {
    const backend = coldBackend();
    expect(await backend.get("never-stored")).toBeNull();
    expect(await backend.exists("never-stored")).toBe(false);
    await expect(new CasBackedArtifactRepository(backend).resolve({ artifact_id: "never-stored", artifact_type: "t" })).rejects.toThrow(
      "Artifact not found: never-stored",
    );
  });
});
