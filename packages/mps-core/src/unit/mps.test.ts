import { describe, expect, it } from "vitest";
import {
  ArtifactIdentityBuilder,
  toContentReference,
  assertContentReferenceMatches,
  ContentAddressedArtifactStore,
  GovernanceEngine,
  ArchiveEngine,
  PromotionEngine,
  MpsError,
  GovernancePolicyViolation,
  PromotionPolicyViolation,
  SignatureVerificationViolation,
  HashVerificationViolation,
} from "../index";
import type {
  CanonicalArtifactSerializer,
  CanonicalHashEngine,
  Signer,
  SignatureVerifier,
  ArtifactIdentityStrategy,
  SchemaValidator,
  DecisionClock,
  UniqueIdGenerator,
  HashDescriptor,
  SignatureDescriptor,
  ContentReference,
} from "../types";

// --- Mock Implementations ---

class MockSerializer implements CanonicalArtifactSerializer {
  serialize(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value));
  }
}

class MockHashEngine implements CanonicalHashEngine {
  hash(bytes: Uint8Array): HashDescriptor {
    const text = new TextDecoder().decode(bytes);
    // Simple hash representation
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return {
      algorithm: "mock-sha256",
      digest: `mock-digest-${Math.abs(hash)}`,
    };
  }
}

class MockSigner implements Signer {
  async sign(hash: HashDescriptor): Promise<SignatureDescriptor> {
    return {
      algorithm: "mock-signature",
      signature: `signed-${hash.digest}`,
      key_id: "key-1",
    };
  }
}

class MockSignatureVerifier implements SignatureVerifier {
  async verify(
    hash: HashDescriptor,
    signature: SignatureDescriptor
  ): Promise<boolean> {
    return signature.signature === `signed-${hash.digest}`;
  }
}

class MockIdentityStrategy implements ArtifactIdentityStrategy {
  createArtifactId(contentHash: HashDescriptor): string {
    return `art-${contentHash.digest.replace("mock-digest-", "")}`;
  }
}

class MockSchemaValidator implements SchemaValidator {
  validate<T>(_artifact: T): void {
    // Basic verification
  }
}

class MockDecisionClock implements DecisionClock {
  constructor(private readonly date = new Date("2026-07-31T12:00:00.000Z")) {}
  now(): Date {
    return this.date;
  }
}

class MockUniqueIdGenerator implements UniqueIdGenerator {
  private counter = 0;
  generate(): string {
    this.counter += 1;
    return `id-${this.counter}`;
  }
}

class InMemoryBackend {
  private store = new Map<string, Uint8Array>();

  async get(id: string): Promise<Uint8Array | null> {
    return this.store.get(id) ?? null;
  }

  async put(id: string, bytes: Uint8Array): Promise<void> {
    this.store.set(id, bytes);
  }

  async exists(id: string): Promise<boolean> {
    return this.store.has(id);
  }
}

// --- Tests ---

describe("MPS-CORE Complete Replay, Governance and Archive suite", () => {
  const serializer = new MockSerializer();
  const hashEngine = new MockHashEngine();
  const signer = new MockSigner();
  const signatureVerifier = new MockSignatureVerifier();
  const identityStrategy = new MockIdentityStrategy();
  const schemaValidator = new MockSchemaValidator();
  const clock = new MockDecisionClock();
  const idGenerator = new MockUniqueIdGenerator();

  const identityBuilder = new ArtifactIdentityBuilder(
    serializer,
    hashEngine,
    signer,
    identityStrategy
  );

  describe("ArtifactIdentityBuilder & references", () => {
    it("should build flat identity correctly", async () => {
      const envelope = { value: "test-data" };
      const result = await identityBuilder.build(envelope);

      expect(result.value).toBe("test-data");
      expect(result.content_hash).toBeDefined();
      expect(result.signature).toBeDefined();
      expect(result.artifact_id).toBeDefined();
    });

    it("should assert content reference match successfully", () => {
      const ref1: ContentReference = {
        id: "art-1",
        content_hash: { algorithm: "sha256", digest: "abc" },
        schema_ref: { schema_id: "s1", schema_version: "1.0.0" },
      };

      const ref2: ContentReference = {
        id: "art-1",
        content_hash: { algorithm: "sha256", digest: "abc" },
        schema_ref: { schema_id: "s1", schema_version: "1.0.0" },
      };

      expect(() => assertContentReferenceMatches(ref1, ref2, "CODE", "Message")).not.toThrow();
    });

    it("should throw violation on reference mismatch", () => {
      const ref1: ContentReference = {
        id: "art-1",
        content_hash: { algorithm: "sha256", digest: "abc" },
      };

      const ref2: ContentReference = {
        id: "art-2",
        content_hash: { algorithm: "sha256", digest: "abc" },
      };

      expect(() => assertContentReferenceMatches(ref1, ref2, "MISMATCH", "Mismatch")).toThrow();
    });

    it("should throw violation on schema mismatch when expected is defined but actual is not", () => {
      const ref1: ContentReference = {
        id: "art-1",
        content_hash: { algorithm: "sha256", digest: "abc" },
      };

      const ref2: ContentReference = {
        id: "art-1",
        content_hash: { algorithm: "sha256", digest: "abc" },
        schema_ref: { schema_id: "s1", schema_version: "1.0.0" },
      };

      expect(() => assertContentReferenceMatches(ref1, ref2, "SCHEMA_MISMATCH", "Schema mismatch")).toThrow();
    });
  });

  describe("ContentAddressedArtifactStore", () => {
    it("should put and get artifact successfully with integrity checks", async () => {
      const backend = new InMemoryBackend();
      const store = new ContentAddressedArtifactStore(
        serializer,
        hashEngine,
        identityBuilder,
        schemaValidator,
        signatureVerifier,
        backend
      );

      const envelope = {
        schema_ref: { schema_id: "test-schema", schema_version: "1.0" },
        message: "hello world",
      };

      const ref = await store.put(envelope);
      expect(ref.id).toBeDefined();

      const retrieved = await store.get<any>(ref);
      expect(retrieved.message).toBe("hello world");
      expect(retrieved.signature).toBeDefined();
    });

    it("should throw error when hash verification fails on retrieved bytes", async () => {
      const backend = new InMemoryBackend();
      const store = new ContentAddressedArtifactStore(
        serializer,
        hashEngine,
        identityBuilder,
        schemaValidator,
        signatureVerifier,
        backend
      );

      const ref = await store.put({ message: "data" });

      // Tamper with storage backend directly
      await backend.put(ref.id, new TextEncoder().encode(JSON.stringify({ message: "tampered" })));

      await expect(store.get(ref)).rejects.toThrow(HashVerificationViolation);
    });

    it("should throw error when signature verification fails", async () => {
      const backend = new InMemoryBackend();
      const badVerifier: SignatureVerifier = {
        verify: async () => false,
      };
      const store = new ContentAddressedArtifactStore(
        serializer,
        hashEngine,
        identityBuilder,
        schemaValidator,
        badVerifier,
        backend
      );

      const ref = await store.put({ message: "data" });

      await expect(store.get(ref)).rejects.toThrow(SignatureVerificationViolation);
    });
  });

  describe("Governance, Archive, and Promotion Engines", () => {
    it("should process full stage pipeline sequentially", async () => {
      const govEngine = new GovernanceEngine(identityBuilder, clock, "1.0.0");
      const archEngine = new ArchiveEngine(identityBuilder, idGenerator, clock, "1.0.0");
      const promoEngine = new PromotionEngine(identityBuilder, clock, "1.0.0");

      const provenanceRef: ContentReference = {
        id: "art-provenance",
        content_hash: { algorithm: "sha256", digest: "provenance-digest" },
      };

      // 1. Governance Evaluation
      const rules = [
        { rule_id: "rule-1", severity: "MEDIUM" as const, description: "Check limits" },
      ];
      const govResult = await govEngine.evaluate(
        provenanceRef,
        { data: "payload-only" },
        rules,
        { governance_version: "1.0.0", decision_profile: "default" }
      );

      expect(govResult.artifact.decision).toBe("ALLOW");
      expect(govResult.observability.decision_timestamp).toBe("2026-07-31T12:00:00.000Z");

      // 2. Archive manifest generation
      const archResult = await archEngine.archive(
        provenanceRef,
        { archive_version: "1.0.0", storage_class: "glacier" }
      );

      expect(archResult.artifact.archive_id).toBe("id-1");
      expect(archResult.observability.archived_at).toBe("2026-07-31T12:00:00.000Z");

      // 3. Promotion
      const govDecisionRef = toContentReference(govResult.artifact);
      const promoResult = await promoEngine.promote(
        provenanceRef,
        govResult.artifact,
        govDecisionRef,
        { promotion_version: "1.0.0", target_environment: "production" }
      );

      expect(promoResult.artifact.governance_ref).toEqual(govDecisionRef);
      expect(promoResult.observability.promoted_at).toBe("2026-07-31T12:00:00.000Z");
    });

    it("should refuse promotion and throw violation when governance decision is not ALLOW", async () => {
      const govEngine = new GovernanceEngine(identityBuilder, clock, "1.0.0");
      const promoEngine = new PromotionEngine(identityBuilder, clock, "1.0.0");

      const provenanceRef: ContentReference = {
        id: "art-provenance",
        content_hash: { algorithm: "sha256", digest: "provenance-digest" },
      };

      const rules = [
        { rule_id: "rule-critical", severity: "CRITICAL" as const, description: "Failed security check" },
      ];
      const govResult = await govEngine.evaluate(
        provenanceRef,
        { data: "payload-only" },
        rules,
        { governance_version: "1.0.0", decision_profile: "default" }
      );

      expect(govResult.artifact.decision).toBe("DENY");

      const govDecisionRef = toContentReference(govResult.artifact);

      await expect(
        promoEngine.promote(
          provenanceRef,
          govResult.artifact,
          govDecisionRef,
          { promotion_version: "1.0.0", target_environment: "production" }
        )
      ).rejects.toThrow(PromotionPolicyViolation);
    });
  });
});
