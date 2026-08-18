import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import type {
  DownloadManifest,
  DownloadTargetResolver,
  DownloadTransport,
} from "../src/GovernedDownloadContracts";
import {
  FileDownloadManifestStore,
  InMemoryDownloadManifestStore,
  type DownloadManifestStore,
} from "../src/DownloadManifestStore";
import { buildDownloadManifestRef } from "../src/DownloadManifestIdentity";
import { isUrlAllowedForVerifiedSource, type VerifiedSourceDefinition, type VerifiedSourceRegistry } from "../src/SourceRegistry";
import type { QuarantineStorage } from "@miljobeslut/mimers-brunn-core";

/**
 * P2_DOWNLOAD_MANIFEST_PERSISTENCE_V1.
 *
 * A DownloadManifest reference is only replayable when P2 can resolve the exact persisted body
 * and recompute its identity. These tests deliberately keep corpus admission out of scope.
 */
describe("P2 download manifest persistence", () => {
  const bytes = new TextEncoder().encode("SFS 1998:808");
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const source: VerifiedSourceDefinition = {
    sourceId: "regeringskansliet-sfs-1998-808",
    authority: { name: "Regeringskansliet", type: "other" },
    endpointUrl: "https://rkrattsbaser.gov.se/sfst?bet=1998:808",
    adapter: "SINGLE_ENDPOINT_V1",
    frequency: "daily",
    allowedDomains: ["rkrattsbaser.gov.se"],
    artifactTypes: ["LAW"],
    policy: {
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      politeness_delay_ms: 0,
      max_object_size_bytes: 1024,
      retry_policy: { max_attempts: 1, backoff: "FIXED" },
    },
    registryArtifactId: "reg-rk-sfs-1998-808-001",
    sourceContentHash: "a".repeat(64),
  };

  const registry: VerifiedSourceRegistry = {
    registryPath: "<test>",
    sources: [source],
    getSource: (sourceId) => (sourceId === source.sourceId ? source : null),
    isUrlAllowedForSource: (sourceId, url) =>
      sourceId === source.sourceId && isUrlAllowedForVerifiedSource(source, url),
  };

  const resolver: DownloadTargetResolver = {
    async resolve() {
      return {
        kind: "TARGETS",
        targets: [{ url: source.endpointUrl, file_name: "sfs-1998-808.html" }],
      };
    },
  };

  const transport: DownloadTransport = {
    async get() {
      return { status: 200, bytes, headers: {} };
    },
  };

  const quarantine: QuarantineStorage = {
    async put() {
      return {
        quarantine_id: "q-sfs-1998-808",
        file_path: "<test>",
        metadata_path: "<test>",
        is_duplicate: false,
        hash: contentHash,
      };
    },
    async get() { return null; },
    async getMetadata() { return null; },
    async updateStatus() {},
    async list() { return []; },
  };

  const request = {
    dataset_ref: { id: source.sourceId, content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
    execution_id: "manifest-persistence-1",
    requested_at: "2026-08-17T00:00:00.000Z",
  };

  function executor(manifestStore: DownloadManifestStore): GovernedDownloadExecutor {
    return new GovernedDownloadExecutor(
      registry,
      resolver,
      transport,
      quarantine,
      manifestStore,
      { now: () => "2026-08-17T00:00:00.000Z" },
      async () => {},
    );
  }

  it("persists the exact manifest body in the P2-owned disk store and resolves it by reference", async () => {
    const store = new FileDownloadManifestStore(mkdtempSync(join(tmpdir(), "p2-manifest-store-")));

    const reference = await executor(store).execute(request);
    const resolved = await store.resolve(reference);

    expect(resolved).not.toBeNull();
    expect(resolved?.source_id).toBe(source.sourceId);
    expect(resolved?.objects[0]?.content_hash).toBe(contentHash);
    expect(buildDownloadManifestRef(resolved!).content_hash.digest).toBe(reference.content_hash.digest);
  });

  it("P2-M1: rejects a returned manifest reference that cannot be resolved", async () => {
    const unresolved: DownloadManifestStore = {
      async persist(manifest) { return buildDownloadManifestRef(manifest); },
      async resolve() { return null; },
    };

    await expect(executor(unresolved).execute(request)).rejects.toThrow(/REJECT_MANIFEST_PERSISTENCE/);
  });

  it("P2-M2: rejects a persisted body whose recomputed identity differs from its returned reference", async () => {
    let persisted: DownloadManifest | undefined;
    const altered: DownloadManifestStore = {
      async persist(manifest) {
        persisted = manifest;
        return buildDownloadManifestRef(manifest);
      },
      async resolve() {
        return { ...persisted!, source_id: "forged-source" };
      },
    };

    await expect(executor(altered).execute(request)).rejects.toThrow(/REJECT_MANIFEST_PERSISTENCE/);
  });

  it("returns the same reference when the same canonical manifest body is persisted again", async () => {
    const store = new InMemoryDownloadManifestStore();
    const manifest: DownloadManifest = {
      manifest_version: 1,
      execution_id: "same-body",
      source_id: source.sourceId,
      source_content_hash: source.sourceContentHash,
      registry_artifact_id: source.registryArtifactId,
      objects: [],
      generated_at: "2026-08-17T00:00:00.000Z",
    };

    const first = await store.persist(manifest);
    const second = await store.persist({ ...manifest });

    expect(second).toEqual(first);
    expect(await store.resolve(first)).toEqual(manifest);
  });
});
