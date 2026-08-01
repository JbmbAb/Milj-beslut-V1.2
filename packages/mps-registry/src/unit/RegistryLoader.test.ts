import { describe, expect, it } from "vitest";
import {
  RegistryLoader,
  RegistryValidator,
  RegistryResolver,
  RegistrySnapshotBuilder,
  RegistryCompletenessValidator,
} from "../index";
import type { RegistrySource } from "../RegistrySource";
import type {
  ContentReference,
  VerificationResult,
  ArtifactVerifier,
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  ArtifactIdentityStrategy,
} from "@miljobeslut/mps-core";

class MockSource implements RegistrySource {
  constructor(private readonly listData: any[], private readonly loadData: Map<string, any>) {}

  async list(): Promise<readonly ContentReference[]> {
    return this.listData;
  }

  async load(reference: ContentReference): Promise<unknown> {
    return this.loadData.get(reference.id);
  }
}

class MockVerifier implements ArtifactVerifier {
  async verify(_artifact: unknown): Promise<VerificationResult> {
    return {
      integrity: true,
      signature_valid: true,
      trusted: true,
    };
  }
}

class MockSerializer implements CanonicalArtifactSerializer {
  serialize(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value));
  }
}

class MockHashEngine implements CanonicalHashEngine {
  hash(_bytes: Uint8Array): any {
    return { algorithm: "mock-sha256", digest: "registry-hash-123" };
  }
}

class MockIdentityStrategy implements ArtifactIdentityStrategy {
  createArtifactId(_contentHash: any): string {
    return "snapshot-id-xyz";
  }
}

describe("RegistryLoader Suite", () => {
  it("should load, validate and build registry snapshot sequentially", async () => {
    const listData = [
      { id: "g1", content_hash: { algorithm: "sha256", digest: "d1" }, schema_ref: { schema_id: "governance-profile", schema_version: "1.0.0" } },
      { id: "p1", content_hash: { algorithm: "sha256", digest: "d2" }, schema_ref: { schema_id: "policy-set", schema_version: "1.0.0" } },
      { id: "r1", content_hash: { algorithm: "sha256", digest: "d3" }, schema_ref: { schema_id: "replay-profile", schema_version: "1.0.0" } },
      { id: "a1", content_hash: { algorithm: "sha256", digest: "d4" }, schema_ref: { schema_id: "archive-profile", schema_version: "1.0.0" } },
      { id: "pr1", content_hash: { algorithm: "sha256", digest: "d5" }, schema_ref: { schema_id: "promotion-profile", schema_version: "1.0.0" } },
    ];

    const loadData = new Map<string, any>([
      ["g1", { value: "gov" }],
      ["p1", { value: "pol" }],
      ["r1", { value: "rep" }],
      ["a1", { value: "arc" }],
      ["pr1", { value: "pro" }],
    ]);

    const source = new MockSource(listData, loadData);
    const verifier = new MockVerifier();
    const validator = new RegistryValidator(verifier);
    const resolver = new RegistryResolver();
    const builder = new RegistrySnapshotBuilder(
      new MockSerializer(),
      new MockHashEngine(),
      new MockIdentityStrategy(),
      { now: () => new Date("2026-07-31T12:00:00.000Z") }
    );
    const completeness = new RegistryCompletenessValidator();

    const loader = new RegistryLoader(source, validator, resolver, builder, completeness);
    const snapshot = await loader.load();

    expect(snapshot.snapshot_id).toBe("snapshot-id-xyz");
    expect(snapshot.registry_hash).toBe("registry-hash-123");
    expect(snapshot.governance_profiles).toHaveLength(1);
    expect(snapshot.policy_sets).toHaveLength(1);
    expect(snapshot.replay_profiles).toHaveLength(1);
    expect(snapshot.archive_profiles).toHaveLength(1);
    expect(snapshot.promotion_profiles).toHaveLength(1);
  });
});
