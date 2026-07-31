import { describe, it, expect } from "vitest";
import { IdentityResolver } from "../identity/IdentityResolver";
import { ArtifactFactory } from "../artifact/ArtifactFactory";
import { TrustVerifier } from "../verification/TrustVerifier";
import { SimpleProvenanceBuilder } from "../provenance/SimpleProvenanceBuilder";
import { RegistryEntryBuilder } from "../registry/RegistryEntryBuilder";
import { JsonCanonicalizer } from "../runtime/engines/SimpleCanonicalizer";
import { Sha256HashEngine } from "../runtime/engines/Sha256HashEngine";

const canonicalizer = new JsonCanonicalizer();
const hasher = new Sha256HashEngine();

const logicalId = "execution.manifest.env-run-001";

const basePayload = {
  execution_id: "env-run-001",
  actor: {
    id: "operator",
    version: "1",
    content_hash: {
      algorithm: "sha256-v1",
      digest: "actor-hash",
      encoding: "hex",
      bit_length: 256
    }
  },
  input_snapshot: {
    id: "snapshot-001",
    version: "1",
    content_hash: {
      algorithm: "sha256-v1",
      digest: "snapshot-hash",
      encoding: "hex",
      bit_length: 256
    }
  },
  artifacts: [
    {
      id: "pipeline.environmental.decision",
      version: "1.0.0",
      content_hash: {
        algorithm: "sha256-v1",
        digest: "pipeline-hash",
        encoding: "hex",
        bit_length: 256
      }
    }
  ],
  policy_ref: {
    id: "policy.environmental",
    version: "1.0.0",
    content_hash: {
      algorithm: "sha256-v1",
      digest: "policy-hash",
      encoding: "hex",
      bit_length: 256
    }
  },
  capability_refs: [],
  runtime_constraints: [],
  provenance: {
    root: null,
    chain: [],
    merkle_root: {
      algorithm: "sha256-v1",
      digest: "prov-hash",
      encoding: "hex",
      bit_length: 256
    }
  }
};

const fixedContextV1 = {
  created_at: "2026-07-31T00:00:00.000Z",
  planner_version: "v1",
  registry_version: "1.0.0",
  policy_version: "1.0.0"
};

const fixedContextV2 = {
  created_at: "2026-07-31T00:00:00.000Z",
  planner_version: "v2",
  registry_version: "1.0.0",
  policy_version: "1.0.0"
};

describe("Phase 3 identity hardening E2E", () => {
  it("produces identical canonical bytes and hashes for identical execution context", async () => {
    const resolver = new IdentityResolver();

    const env1 = await resolver.createEnvelope(logicalId, basePayload, fixedContextV1);
    const id1 = await resolver.deriveArtifactIdentity(env1);

    const env2 = await resolver.createEnvelope(logicalId, basePayload, fixedContextV1);
    const id2 = await resolver.deriveArtifactIdentity(env2);

    const bytes1 = canonicalizer.serialize(env1);
    const bytes2 = canonicalizer.serialize(env2);

    expect(bytes1).toEqual(bytes2);
    expect(id1.input_hash.digest).toBe(id2.input_hash.digest);
    expect(id1.content_hash.digest).toBe(id2.content_hash.digest);
  });

  it("payload mutation changes both input_hash and content_hash", async () => {
    const resolver = new IdentityResolver();

    const env1 = await resolver.createEnvelope(logicalId, basePayload, fixedContextV1);
    const id1 = await resolver.deriveArtifactIdentity(env1);

    const mutatedPayload = {
      ...basePayload,
      artifacts: [
        ...basePayload.artifacts,
        {
          id: "policy.environmental.rules",
          version: "3.2.0",
          content_hash: {
            algorithm: "sha256-v1",
            digest: "rules-hash",
            encoding: "hex",
            bit_length: 256
          }
        }
      ]
    };

    const env2 = await resolver.createEnvelope(logicalId, mutatedPayload, fixedContextV1);
    const id2 = await resolver.deriveArtifactIdentity(env2);

    expect(id1.input_hash.digest).not.toBe(id2.input_hash.digest);
    expect(id1.content_hash.digest).not.toBe(id2.content_hash.digest);
  });

  it("execution context mutation changes input_hash but keeps content_hash", async () => {
    const resolver = new IdentityResolver();

    const env1 = await resolver.createEnvelope(logicalId, basePayload, fixedContextV1);
    const id1 = await resolver.deriveArtifactIdentity(env1);

    const env2 = await resolver.createEnvelope(logicalId, basePayload, fixedContextV2);
    const id2 = await resolver.deriveArtifactIdentity(env2);

    expect(id1.input_hash.digest).not.toBe(id2.input_hash.digest);
    expect(id1.content_hash.digest).toBe(id2.content_hash.digest);
  });

  it("TrustVerifier detects payload corruption (content_hash mismatch)", async () => {
    const factory = new ArtifactFactory();
    const verifier = new TrustVerifier();

    const envelope = await factory.create(logicalId, basePayload, fixedContextV1);
    const ok = await verifier.verify(envelope);
    expect(ok.verified).toBe(true);
    expect(ok.errors).toHaveLength(0);

    const tampered = {
      ...envelope,
      payload: {
        ...envelope.payload,
        artifacts: []
      }
    };

    const bad = await verifier.verify(tampered as any);
    expect(bad.verified).toBe(false);
    expect(bad.errors).toContain("content_hash_mismatch");
  });

  it("TrustVerifier detects identity corruption (input_hash mismatch)", async () => {
    const factory = new ArtifactFactory();
    const verifier = new TrustVerifier();

    const envelope = await factory.create(logicalId, basePayload, fixedContextV1);
    const ok = await verifier.verify(envelope);
    expect(ok.verified).toBe(true);

    const corruptedIdentity = {
      ...envelope,
      identity: {
        ...envelope.identity,
        input_hash: {
          ...envelope.identity.input_hash,
          digest: "deadbeef"
        }
      }
    };

    const bad = await verifier.verify(corruptedIdentity);
    expect(bad.verified).toBe(false);
    expect(bad.errors).toContain("input_hash_mismatch");
  });

  it("Provenance merkle_root matches canonical provenance bytes", async () => {
    const provBuilder = new SimpleProvenanceBuilder();

    provBuilder.addRecord({
      artifact_hash: {
        algorithm: "sha256-v1",
        digest: "pipeline-hash",
        encoding: "hex",
        bit_length: 256
      },
      created_by: basePayload.actor as any,
      created_at: "2026-07-31T00:00:00.000Z",
      operation: "created",
      metadata: { execution_id: basePayload.execution_id }
    });

    provBuilder.addRecord({
      artifact_hash: {
        algorithm: "sha256-v1",
        digest: "snapshot-hash",
        encoding: "hex",
        bit_length: 256
      },
      created_by: basePayload.actor as any,
      created_at: "2026-07-31T00:00:01.000Z",
      operation: "restored",
      metadata: { source_snapshot: "snapshot-001" }
    });

    const provArtifact = await provBuilder.buildArtifact(`provenance.${logicalId}`);
    const recomputed = await hasher.hash(
      canonicalizer.serialize(provArtifact.graph.chain),
      provArtifact.content_hash.algorithm
    );

    expect(recomputed.digest).toBe(provArtifact.graph.merkle_root.digest);
    expect(provArtifact.content_hash.digest).toBe(provArtifact.graph.merkle_root.digest);
  });

  it("RegistryEntry preserves content addressing invariants", async () => {
    const factory = new ArtifactFactory();
    const verifier = new TrustVerifier();
    const entryBuilder = new RegistryEntryBuilder({ registryId: "reg-01" });
    const provBuilder = new SimpleProvenanceBuilder();

    const envelope = await factory.create(logicalId, basePayload, fixedContextV1);
    const trust = await verifier.verify(envelope);
    expect(trust.verified).toBe(true);

    provBuilder.addRecord({
      artifact_hash: envelope.identity.content_hash,
      created_by: basePayload.actor as any,
      created_at: envelope.identity.created_at,
      operation: "created",
      metadata: { execution_id: basePayload.execution_id }
    });

    const provArtifact = await provBuilder.buildArtifact(`provenance.${logicalId}`);

    const registryEntry = entryBuilder.build(
      envelope as any,
      {
        verified: trust.verified,
        errors: trust.errors,
        hash_valid: trust.hash_valid,
        signature_status: trust.signature_status,
        schema_valid: trust.schema_valid,
        policy_valid: trust.policy_valid
      },
      provArtifact.graph as any
    );

    expect(registryEntry.reference.id).toBe(envelope.identity.logical_id);
    expect(registryEntry.reference.content_hash.digest).toBe(envelope.identity.content_hash.digest);
    expect(registryEntry.content).toEqual(envelope.payload);
  });
});
