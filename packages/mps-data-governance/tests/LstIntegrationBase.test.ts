import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DiskQuarantineStorage, LocalPemSigningKeyProvider } from "@miljobeslut/mimers-brunn-core";

import { DownloadTargetResolverRegistry } from "../src/DownloadTargetResolvers";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import { approveSourceRegistryEntry } from "../src/SourceApproval";
import {
  isUrlAllowedForVerifiedSource,
  verifySourceRegistryArtifact,
  type DistributionBinding,
} from "../src/SourceRegistry";
import { HttpDownloadTransport } from "../src/HttpDownloadTransport";
import { unsignedDraftFixture } from "./fixtures/unsignedSourceRegistryDrafts";

/**
 * L-V1-LST-INTEGRATION-BASE-01
 *
 * Distribution authority stays in front of streaming. This fixture is not a
 * Länsstyrelsen source and does not approve one.
 */

const BINDING: DistributionBinding = {
  kind: "upstream-distribution",
  value: "dist-001",
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function verifiedSource() {
  const signing = LocalPemSigningKeyProvider.generate("ed25519:test-governor").provider;
  return verifySourceRegistryArtifact(
    await approveSourceRegistryEntry({
      entry: { ...unsignedDraftFixture("puh"), distribution_binding: BINDING },
      approver_actor_id: "governor:test-owner",
      signing,
    }),
    signing,
  );
}

describe("L-V1-LST-INTEGRATION-BASE-01", () => {
  it("rejects a missing distribution observation before any streamed body request", async () => {
    const source = await verifiedSource();
    const calls: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "loke-int-"));
    roots.push(root);
    const transport = new HttpDownloadTransport({
      isUrlAllowed: (url) => isUrlAllowedForVerifiedSource(source, url),
      fetchImpl: (async (url: string | URL) => {
        calls.push(String(url));
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }) as typeof fetch,
    });
    const executor = new GovernedDownloadExecutor(
      {
        registryPath: "<test>",
        sources: [source],
        getSource: (id) => (id === source.sourceId ? source : null),
        isUrlAllowedForSource: (id, url) =>
          id === source.sourceId ? isUrlAllowedForVerifiedSource(source, url) : false,
      },
      new DownloadTargetResolverRegistry(
        {
          registryPath: "<test>",
          sources: [source],
          getSource: (id) => (id === source.sourceId ? source : null),
          isUrlAllowedForSource: () => true,
        },
        {
          [source.adapter]: {
            async resolve() {
              return {
                kind: "TARGETS" as const,
                targets: [{
                  url: "https://rattspraxis.etjanst.domstol.se/api/v1/object.bin",
                  file_name: "object.bin",
                }],
              };
            },
          },
        },
      ),
      transport,
      new DiskQuarantineStorage(root),
      new InMemoryDownloadManifestStore(),
      { now: () => "2026-10-08T06:00:00.000Z" },
      async () => undefined,
    );

    await expect(executor.execute({
      dataset_ref: {
        id: source.sourceId,
        content_hash: { algorithm: "sha256", digest: "b".repeat(64) },
      },
      execution_id: "exec-integration-reject",
      requested_at: "2026-10-08T05:00:00.000Z",
    })).rejects.toMatchObject({ reason_code: "REJECT_DISTRIBUTION_IDENTITY" });
    expect(calls).toEqual([]);
  });

  it("streams the body only after the signed distribution observation matches", async () => {
    const source = await verifiedSource();
    const calls: string[] = [];
    const root = mkdtempSync(join(tmpdir(), "loke-int-"));
    roots.push(root);
    const url = "https://rattspraxis.etjanst.domstol.se/api/v1/object.bin";
    const transport = new HttpDownloadTransport({
      isUrlAllowed: (candidate) => isUrlAllowedForVerifiedSource(source, candidate),
      fetchImpl: (async (requested: string | URL) => {
        calls.push(String(requested));
        return new Response(new Uint8Array([9, 8, 7, 6]), { status: 200 });
      }) as typeof fetch,
    });
    const quarantine = new DiskQuarantineStorage(root);
    const store = new InMemoryDownloadManifestStore();
    const registry = {
      registryPath: "<test>",
      sources: [source],
      getSource: (id: string) => (id === source.sourceId ? source : null),
      isUrlAllowedForSource: (id: string, candidate: string) =>
        id === source.sourceId ? isUrlAllowedForVerifiedSource(source, candidate) : false,
    };
    const executor = new GovernedDownloadExecutor(
      registry,
      new DownloadTargetResolverRegistry(registry, {
        [source.adapter]: {
          async resolve() {
            return {
              kind: "TARGETS" as const,
              observedDistributionIdentity: BINDING,
              targets: [{ url, file_name: "object.bin" }],
            };
          },
        },
      }),
      transport,
      quarantine,
      store,
      { now: () => "2026-10-08T06:00:00.000Z" },
      async () => undefined,
    );

    const outcome = await executor.execute({
      dataset_ref: {
        id: source.sourceId,
        content_hash: { algorithm: "sha256", digest: "b".repeat(64) },
      },
      execution_id: "exec-integration-stream",
      requested_at: "2026-10-08T05:00:00.000Z",
    });
    expect(outcome.kind).toBe("DOWNLOAD_MANIFEST");
    expect(calls).toEqual([url]);
    const listed = await quarantine.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.source_id).toBe(source.sourceId);
    expect(listed[0] && "source_url" in listed[0] ? listed[0].source_url : "").toBe(url);
    expect(listed[0]?.file_name).toBe("object.bin");
    expect(listed[0]?.custom_metadata?.registry_artifact_id).toBe(source.registryArtifactId);
  });
});
