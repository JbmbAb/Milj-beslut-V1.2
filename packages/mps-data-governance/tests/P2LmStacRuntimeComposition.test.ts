import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  type QuarantinePutResult,
  type QuarantineStorage,
  type RawSourceArtifact,
} from "@miljobeslut/mimers-brunn-core";
import { describe, expect, it } from "vitest";

import { approveSourceRegistryEntry } from "../src/SourceApproval";
import { InMemoryDownloadManifestStore } from "../src/DownloadManifestStore";
import { composeHarvestRuntime } from "../src/HarvestRuntimeCompositionRoot";
import type { LantmaterietStacByggnaderCredentialProvider } from "../src/LantmaterietStacByggnaderAssetTransport";
import type { HarvestExecutionRequest } from "../src/HarvestOrchestratorTypes";
import type { SourceRegistryArtifact } from "../src/SourceRegistry";

const KEY_ID = "ed25519:test-lm-composition";
const COLLECTION = "https://api.lantmateriet.se/stac-vektor/v1/collections/byggnader/items";
const ASSET = "https://dl1.lantmateriet.se/byggnadsverk/byggnad_kn2482.zip";

class MemoryQuarantine implements QuarantineStorage {
  readonly writes: { readonly sourceId: string; readonly url: string; readonly bytes: Uint8Array }[] = [];

  async put(sourceId: string, url: string, _fileName: string, bytes: Uint8Array): Promise<QuarantinePutResult> {
    this.writes.push({ sourceId, url, bytes });
    return {
      quarantine_id: `q-${this.writes.length}`,
      file_path: `/memory/${this.writes.length}`,
      metadata_path: `/memory/${this.writes.length}.json`,
      is_duplicate: false,
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  async get(): Promise<Uint8Array | null> { return null; }
  async getMetadata(): Promise<RawSourceArtifact | null> { return null; }
  async updateStatus(): Promise<void> {}
  async list(): Promise<readonly RawSourceArtifact[]> { return []; }
}

async function signedRegistryFile(): Promise<{ readonly path: string; readonly signing: LocalPemVerificationKeyProvider }> {
  const generated = LocalPemSigningKeyProvider.generate(KEY_ID);
  const draft: Omit<SourceRegistryArtifact, "approval_attestation"> = {
    artifact_id: "reg-lantmateriet-stac-byggnader-test-001",
    artifact_type: "SOURCE_REGISTRY_ENTRY",
    source_id: "lantmateriet-stac-byggnader",
    producer: { producer_id: "LANTMATERIET", name: "Lantmäteriet", type: "agency" },
    channel: {
      channel_type: "DATASET_PORTAL",
      endpoint_url: COLLECTION,
      allowed_domains: ["api.lantmateriet.se", "dl1.lantmateriet.se"],
    },
    adapter: "LM_STAC_BYGGNADER_V1",
    artifact_types: ["SPATIAL_DATASET"],
    collection_frequency: "WEEKLY",
    change_detection: { strategy: "CONTENT_HASH" },
    policy: {
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      politeness_delay_ms: 1000,
      max_object_size_bytes: 52_428_800,
      retry_policy: { max_attempts: 3, backoff: "EXPONENTIAL" },
    },
    lifecycle_state: "REGISTERED",
  };
  const approved = await approveSourceRegistryEntry({
    entry: draft,
    approver_actor_id: "owner:test",
    signing: generated.provider,
  });
  const path = join(mkdtempSync(join(tmpdir(), "p2-lm-composition-")), "registry.json");
  writeFileSync(path, `${JSON.stringify([approved], null, 2)}\n`, "utf8");
  return { path, signing: new LocalPemVerificationKeyProvider(KEY_ID, generated.publicKey) };
}

function request(): HarvestExecutionRequest {
  return {
    dataset_ref: { id: "lantmateriet-stac-byggnader", content_hash: { algorithm: "sha256", digest: "0".repeat(64) } },
    execution_id: "lm-stac-composition-proof",
    requested_at: "2026-08-20T00:00:00.000Z",
  };
}

function listingBody(assetHref = ASSET): string {
  return JSON.stringify({
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      id: "2482",
      collection: "byggnader",
      properties: { updated: "2026-08-15T00:00:00Z" },
      assets: { data: { href: assetHref, type: "application/zip" } },
    }],
    links: [],
  });
}

describe("P2-LM-STAC-RUNTIME-COMPOSITION-01", () => {
  it("uses unauthenticated public discovery and a separately scoped bearer asset port", async () => {
    const { path, signing } = await signedRegistryFile();
    const calls: { readonly url: string; readonly authorization: string | null }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get("authorization") });
      if (url.startsWith(COLLECTION)) return new Response(listingBody(), { status: 200 });
      if (url === ASSET) return new Response(new Uint8Array([0x50, 0x4b]), { status: 200 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const credentialProvider: LantmaterietStacByggnaderCredentialProvider = {
      async getBearerToken() { return "owner-provisioned-test-token"; },
    };
    const quarantine = new MemoryQuarantine();

    const { executor } = await composeHarvestRuntime({
      registryPath: path,
      signing,
      quarantine,
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      fetchImpl,
      lantmaterietStacByggnaderCredentialProvider: credentialProvider,
      clock: { now: () => "2026-08-20T00:00:00.000Z" },
    });
    await executor.execute(request());

    expect(calls).toEqual([
      { url: `${COLLECTION}?limit=100`, authorization: null },
      { url: ASSET, authorization: "Bearer owner-provisioned-test-token" },
    ]);
    expect(quarantine.writes).toEqual([{ sourceId: "lantmateriet-stac-byggnader", url: ASSET, bytes: new Uint8Array([0x50, 0x4b]) }]);
  });

  it("fails closed before asset network contact when the runtime token is absent", async () => {
    const { path, signing } = await signedRegistryFile();
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(listingBody(), { status: 200 });
    }) as typeof fetch;
    const credentialProvider: LantmaterietStacByggnaderCredentialProvider = {
      async getBearerToken() { throw new Error("not provisioned"); },
    };

    const { executor } = await composeHarvestRuntime({
      registryPath: path,
      signing,
      quarantine: new MemoryQuarantine(),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      fetchImpl,
      lantmaterietStacByggnaderCredentialProvider: credentialProvider,
    });

    await expect(executor.execute(request())).rejects.toThrow("REJECT_CREDENTIAL_UNAVAILABLE");
    expect(calls).toEqual([`${COLLECTION}?limit=100`]);
  });

  it("denies an out-of-scope asset before consulting the credential provider", async () => {
    const { path, signing } = await signedRegistryFile();
    let credentialCalls = 0;
    const credentialProvider: LantmaterietStacByggnaderCredentialProvider = {
      async getBearerToken() { credentialCalls++; return "must-not-be-read"; },
    };
    const fetchImpl = (async () => new Response(listingBody("https://dl1.lantmateriet.se/other.zip"), { status: 200 })) as typeof fetch;
    const { executor } = await composeHarvestRuntime({
      registryPath: path,
      signing,
      quarantine: new MemoryQuarantine(),
      downloadManifestStore: new InMemoryDownloadManifestStore(),
      fetchImpl,
      lantmaterietStacByggnaderCredentialProvider: credentialProvider,
    });

    await expect(executor.execute(request())).rejects.toThrow("REJECT_AUTH_ASSET_SCOPE");
    expect(credentialCalls).toBe(0);
  });
});
