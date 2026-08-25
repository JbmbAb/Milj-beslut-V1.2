import { describe, expect, it } from "vitest";

import {
  LocalPemSigningKeyProvider,
  type QuarantineStorage,
} from "@miljobeslut/mimers-brunn-core";

import { GovernedDownloadExecutor } from "../src/GovernedDownloadExecutor";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import type {
  DownloadTargetResolver,
  DownloadTransport,
} from "../src/GovernedDownloadContracts";
import { approveSourceRegistryEntry } from "../src/SourceApproval";
import {
  calculateSourceRegistryContentHash,
  isUrlAllowedForVerifiedSource,
  type SourceRegistryArtifact,
  type VerifiedSourceDefinition,
  type VerifiedSourceRegistry,
} from "../src/SourceRegistry";
import { unsignedDraftFixture } from "./fixtures/unsignedSourceRegistryDrafts";

const KEY_ID = "ed25519:test-archive-import";
const APPROVER = "governor:test-owner";

function archiveDraft(): SourceRegistryArtifact {
  return {
    artifact_id: "reg-test-municipal-archive-001",
    artifact_type: "SOURCE_REGISTRY_ENTRY",
    source_id: "test-municipal-decision-archive",
    producer: {
      producer_id: "TEST_MUNICIPALITY",
      name: "Test Municipality",
      type: "municipality",
    },
    channel: {
      channel_type: "ARCHIVE_IMPORT",
      archive_id: "municipal-decision-archive-v1",
    },
    adapter: "ARCHIVE_IMPORT_V1",
    artifact_types: ["decision"],
    collection_frequency: "ON_DEMAND",
    change_detection: { strategy: "CONTENT_HASH" },
    policy: {
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      retry_policy: { max_attempts: 1, backoff: "FIXED" },
    },
    geographic_scope: "Sweden",
    lifecycle_state: "REGISTERED",
  } as unknown as SourceRegistryArtifact;
}

function registryOf(source: VerifiedSourceDefinition): VerifiedSourceRegistry {
  return {
    registryPath: "/tmp/source-registry.json",
    sources: [source],
    getSource: (sourceId) => (sourceId === source.sourceId ? source : null),
    isUrlAllowedForSource: (sourceId, url) =>
      sourceId === source.sourceId && isUrlAllowedForVerifiedSource(source, url),
  };
}

describe("SOURCE-CHANNEL-ARCHIVE-IMPORT-V1", () => {
  it("identity-binds a stable archive id without fabricating endpoint or network scope", async () => {
    const signing = LocalPemSigningKeyProvider.generate(KEY_ID).provider;
    const approved = await approveSourceRegistryEntry({
      entry: archiveDraft(),
      approver_actor_id: APPROVER,
      signing,
    });

    expect(calculateSourceRegistryContentHash(approved)).toBe(
      calculateSourceRegistryContentHash(structuredClone(approved)),
    );

    const { verifySourceRegistryArtifact } = await import("../src/SourceRegistry");
    const verified = await verifySourceRegistryArtifact(approved, signing);
    expect(verified.channelType).toBe("ARCHIVE_IMPORT");
    expect(verified.archiveId).toBe("municipal-decision-archive-v1");
    expect(verified.endpointUrl).toBeUndefined();
    expect(verified.allowedDomains).toEqual([]);
    expect(isUrlAllowedForVerifiedSource(verified, "https://example.test/file.pdf")).toBe(false);
  });

  it("rejects archive entries that smuggle network endpoint or domain semantics into the signed channel", async () => {
    const signing = LocalPemSigningKeyProvider.generate(KEY_ID).provider;
    const invalid = archiveDraft() as unknown as {
      channel: Record<string, unknown>;
    } & SourceRegistryArtifact;
    invalid.channel = {
      channel_type: "ARCHIVE_IMPORT",
      archive_id: "municipal-decision-archive-v1",
      endpoint_url: "https://fabricated.example.test/archive",
      allowed_domains: ["fabricated.example.test"],
    } as unknown as Record<string, unknown> & SourceRegistryArtifact["channel"];

    await expect(
      approveSourceRegistryEntry({
        entry: invalid,
        approver_actor_id: APPROVER,
        signing,
      }),
    ).rejects.toThrow(/ARCHIVE_IMPORT/);
  });

  it("keeps allowed domains mandatory for network channels", async () => {
    const signing = LocalPemSigningKeyProvider.generate(KEY_ID).provider;
    const invalid = unsignedDraftFixture("puh") as unknown as {
      channel: Record<string, unknown>;
    } & SourceRegistryArtifact;
    invalid.channel = {
      channel_type: "API",
      endpoint_url: "https://rattspraxis.etjanst.domstol.se/api/v1/publiceringar",
      allowed_domains: [],
    };

    await expect(
      approveSourceRegistryEntry({
        entry: invalid,
        approver_actor_id: APPROVER,
        signing,
      }),
    ).rejects.toThrow(/allowed_domains/);
  });

  it("denies an archive source before resolver, transport, quarantine, or CAS-adjacent work", async () => {
    let resolverCalls = 0;
    let transportCalls = 0;
    const archiveSource: VerifiedSourceDefinition = {
      sourceId: "test-municipal-decision-archive",
      authority: { name: "Test Municipality", type: "municipality" },
      channelType: "ARCHIVE_IMPORT",
      archiveId: "municipal-decision-archive-v1",
      adapter: "ARCHIVE_IMPORT_V1",
      frequency: "on_demand",
      allowedDomains: [],
      artifactTypes: ["decision"],
      policy: {
        rate_limit_requests_per_second: 1,
        concurrency_limit: 1,
        retry_policy: { max_attempts: 1, backoff: "FIXED" },
      },
      registryArtifactId: "reg-test-municipal-archive-001",
      sourceContentHash: "a".repeat(64),
    };
    const resolver: DownloadTargetResolver = {
      resolve: async () => {
        resolverCalls += 1;
        return { kind: "TARGETS", targets: [] };
      },
    };
    const transport: DownloadTransport = {
      get: async () => {
        transportCalls += 1;
        return { status: 200, bytes: new Uint8Array(), headers: {} };
      },
    };
    const executor = new GovernedDownloadExecutor(
      registryOf(archiveSource),
      resolver,
      transport,
      {} as QuarantineStorage,
      new InMemoryDownloadManifestStore(),
      { now: () => "2026-08-25T00:00:00.000Z" },
    );

    await expect(
      executor.execute({
        dataset_ref: {
          id: archiveSource.sourceId,
          content_hash: { algorithm: "sha256", digest: "b".repeat(64) },
        },
        execution_id: "exec-archive-import-test",
        requested_at: "2026-08-25T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ reason_code: "REJECT_ARCHIVE_IMPORT_NETWORK_HARVEST" });

    expect(resolverCalls).toBe(0);
    expect(transportCalls).toBe(0);
  });
});
