import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { assertByggnaderAssetUrl } from "../src/LantmaterietStacByggnaderAssetTransport";
import {
  LANTMATERIET_STAC_BYGGNADER_COLLECTION_URL,
  assertByggnaderCollectionUrl,
} from "../src/LantmaterietStacByggnaderResolver";
import {
  verifySourceRegistryArtifact,
  type SourceRegistryArtifact,
  type VerifiedSourceDefinition,
} from "../src/SourceRegistry";

const REPO_ROOT = resolve(__dirname, "../../..");
const DRAFT_PATH = join(REPO_ROOT, "source-registry", "drafts", "lantmateriet-stac-byggnader-unsigned.json");

function loadDraft(): SourceRegistryArtifact {
  const parsed = JSON.parse(readFileSync(DRAFT_PATH, "utf8")) as SourceRegistryArtifact[];
  expect(parsed, "the draft must contain one independently reviewable source").toHaveLength(1);
  return parsed[0];
}

function asVerifiedSource(entry: SourceRegistryArtifact): VerifiedSourceDefinition {
  return {
    sourceId: entry.source_id,
    authority: { name: entry.producer.name, type: "other" },
    endpointUrl: entry.channel.endpoint_url,
    adapter: entry.adapter,
    frequency: "weekly",
    allowedDomains: entry.channel.allowed_domains,
    artifactTypes: entry.artifact_types,
    policy: entry.policy,
    registryArtifactId: entry.artifact_id,
    sourceContentHash: "draft-only-not-authority",
  };
}

describe("P2-SR-LM-BYGGNADER-01 - unsigned Lantmateriet STAC building source", () => {
  it("contains one exact registered source candidate", () => {
    expect(loadDraft()).toMatchObject({
      artifact_id: "reg-lantmateriet-stac-byggnader-001",
      artifact_type: "SOURCE_REGISTRY_ENTRY",
      source_id: "lantmateriet-stac-byggnader",
      producer: {
        producer_id: "LANTMATERIET",
        name: "Lantmäteriet",
        type: "agency",
      },
      channel: {
        channel_type: "DATASET_PORTAL",
        endpoint_url: LANTMATERIET_STAC_BYGGNADER_COLLECTION_URL,
        allowed_domains: ["api.lantmateriet.se", "dl1.lantmateriet.se"],
      },
      adapter: "LM_STAC_BYGGNADER_V1",
      artifact_types: ["SPATIAL_DATASET"],
      lifecycle_state: "REGISTERED",
    });
  });

  it("binds the owner-review operational policy", () => {
    expect(loadDraft()).toMatchObject({
      collection_frequency: "WEEKLY",
      change_detection: { strategy: "CONTENT_HASH" },
      policy: {
        rate_limit_requests_per_second: 1,
        concurrency_limit: 1,
        politeness_delay_ms: 1000,
        max_object_size_bytes: 52_428_800,
        retry_policy: { max_attempts: 3, backoff: "EXPONENTIAL" },
      },
    });
  });

  it("is compatible with the exact STAC collection resolver", () => {
    const source = asVerifiedSource(loadDraft());
    expect(source.endpointUrl).toBe(LANTMATERIET_STAC_BYGGNADER_COLLECTION_URL);
    expect(() => assertByggnaderCollectionUrl(source.endpointUrl)).not.toThrow();
  });

  it("cannot broaden the adapter or authenticated asset transport scope", () => {
    const source = asVerifiedSource(loadDraft());
    expect(source.allowedDomains).toEqual(["api.lantmateriet.se", "dl1.lantmateriet.se"]);

    expect(() => assertByggnaderCollectionUrl("https://api.lantmateriet.se/stac-vektor/v1/collections/marktacke/items"))
      .toThrow(/REJECT_STAC_COLLECTION_SCOPE/);
    expect(() => assertByggnaderAssetUrl("https://dl1.lantmateriet.se/byggnadsverk/anything-else.zip"))
      .toThrow(/REJECT_AUTH_ASSET_SCOPE/);
  });

  it("leaves STAC item provenance and raw asset hashes to the proven adapter and executor", () => {
    const entry = loadDraft();
    expect(entry).not.toHaveProperty("credentials");
    expect(entry).not.toHaveProperty("raw_asset_hash");
    expect(entry).not.toHaveProperty("approval_attestation");
  });

  it("is refused by the production verifier for exactly the missing approval", async () => {
    const entry = loadDraft();
    const verificationMustNotBeReached = {
      keyId: "unreachable-without-attestation",
      async verify(): Promise<boolean> {
        throw new Error("verification must not run for an unsigned draft");
      },
    };

    await expect(verifySourceRegistryArtifact(entry, verificationMustNotBeReached)).rejects.toThrow(
      `Invalid SourceRegistryArtifact '${entry.source_id}': approval_attestation is required.`,
    );
  });
});
