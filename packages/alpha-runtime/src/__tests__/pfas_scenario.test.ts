import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HashDescriptor,
  RegistryReference,
  ProvenanceGraph,
  ArtifactEnvelope,
  VerificationResult
} from "../types";
import { InMemoryRegistryStore } from "../registry/RegistryStore";
import { RegistryResolver } from "../registry/RegistryResolver";
import { TrustPolicy } from "../registry/TrustPolicy";
import { LineageVerifier } from "../registry/LineageVerifier";
import { DefaultSnapshotHasher } from "../world/snapshot/SnapshotHasher";
import { InMemorySnapshotChain } from "../world/snapshot/SnapshotChain";
import { SnapshotVerifier } from "../world/snapshot/SnapshotVerifier";
import { InMemoryWorldStateManager } from "../world/WorldStateManager";
import { DefaultDisasterRecoveryEngine } from "../recovery/DefaultDisasterRecoveryEngine";
import { DefaultProvenanceBuilderFactory } from "../provenance/DefaultProvenanceBuilder";
import { MerkleChain } from "../provenance/MerkleChain";
import { RecoveryManifestPublisher } from "../recovery/RecoveryManifestPublisher";
import { RecoveryManifestBuilder } from "../recovery/RecoveryManifestBuilder";
import { RegistryEntryBuilder } from "../registry/RegistryEntryBuilder";
import { ArtifactFactory } from "../artifact/ArtifactFactory";
import { VerificationExecutor } from "../verification/VerificationExecutor";

// Basic Stub for HashEngine
const mockHashEngine = {
  hash: async (bytes: Uint8Array, algorithm: string): Promise<HashDescriptor> => {
    return {
      algorithm,
      digest: `mock-hash-${Buffer.from(bytes).toString("base64").substring(0, 10)}`,
      bit_length: 256
    };
  }
};

// Basic Stub for Canonicalizer
const mockCanonicalizer = {
  serialize: (payload: unknown, profile: any) => new Uint8Array(),
};

// Basic Stub for MerkleChain
const mockMerkleChain: MerkleChain = {
  build: async (records) => {
    return {
      algorithm: "sha256-v1",
      digest: "mock-merkle-root",
      bit_length: 256
    };
  },
  verify: async (records: any[], expectedRoot: HashDescriptor) => {
    return true;
  }
};

// Mock Lineage Verifier
const mockLineageVerifier: any = {
  verify: async (graph: any) => {
    return { valid: true, errors: [] };
  }
};

// Mock ArtifactFactory
const mockArtifactFactory = {
  create: async (params: any) => {
    return {
      identity: {
        logical_id: params.logicalId,
        input_hash: { algorithm: "sha256-v1", digest: `input-hash-${params.logicalId}`, bit_length: 256 },
        content_hash: { algorithm: "sha256-v1", digest: `hash-${params.logicalId}`, bit_length: 256 },
        schema_ref: params.schemaRef,
        created_at: new Date().toISOString()
      },
      payload: params.artifact || params.payload,
      schema_ref: params.schemaRef
    } as ArtifactEnvelope<any>;
  }
} as ArtifactFactory;

// Mock VerificationExecutor
const mockVerificationExecutor = {
  verify: async (envelope: any) => {
    return {
      verified: true,
      hash_valid: true,
      signature_status: "valid",
      schema_valid: true,
      policy_valid: true,
      errors: []
    } as VerificationResult;
  }
} as VerificationExecutor;


describe("PFAS End-to-End Scenario", () => {
  let store: InMemoryRegistryStore;
  let resolver: RegistryResolver<any>;
  let hasher: DefaultSnapshotHasher;
  let chain: InMemorySnapshotChain;
  let verifier: SnapshotVerifier;
  let world: InMemoryWorldStateManager;
  let recoveryEngine: DefaultDisasterRecoveryEngine;
  let provenanceFactory: DefaultProvenanceBuilderFactory;

  const actorNaturvardsverket: RegistryReference = {
    id: "org-naturvardsverket",
    version: "1.0.0",
    content_hash: { algorithm: "sha256-v1", digest: "hash-nvv", bit_length: 256 }
  };

  const schemaPfasReport: RegistryReference = {
    id: "schema-pfas-report",
    version: "1.2.0",
    content_hash: { algorithm: "sha256-v1", digest: "hash-schema-pfas", bit_length: 256 }
  };

  const schemaEnvDecision: RegistryReference = {
    id: "schema-env-decision",
    version: "1.0.0",
    content_hash: { algorithm: "sha256-v1", digest: "hash-schema-dec", bit_length: 256 }
  };

  beforeEach(() => {
    store = new InMemoryRegistryStore();
    const policy: TrustPolicy = {
      requireSignature: false,
      requireSchemaValidation: false,
      requireProvenance: true,
      allowedOperations: ["created", "mutated", "promoted", "restored"]
    };
    resolver = new RegistryResolver(store, mockLineageVerifier, { policy });
    
    hasher = new DefaultSnapshotHasher(mockHashEngine, mockCanonicalizer as any, {} as any);
    chain = new InMemorySnapshotChain();
    
    const mockProvVerifier = { verify: async () => ({ valid: true, errors: [] }) };
    verifier = new SnapshotVerifier(hasher, resolver, mockProvVerifier as any, mockLineageVerifier);
    
    world = new InMemoryWorldStateManager();
    provenanceFactory = new DefaultProvenanceBuilderFactory(mockMerkleChain);
    
    recoveryEngine = new DefaultDisasterRecoveryEngine(chain, verifier, world, resolver, provenanceFactory);
  });

  it("should complete full lifecycle from artifact creation to disaster recovery", async () => {
    // 1. Artifact Skapande (PfasReport)
    const pfasReportRef: RegistryReference = {
      id: "report-pfas-2026-001",
      version: "1.0.0",
      content_hash: { algorithm: "sha256-v1", digest: "hash-report-1", bit_length: 256 },
      schema_ref: schemaPfasReport
    };

    const pfasProvGraph = {
      root: {
        artifact_hash: pfasReportRef.content_hash,
        created_by: actorNaturvardsverket,
        created_at: new Date().toISOString(),
        operation: "created"
      },
      chain: [],
      merkle_root: { algorithm: "sha256-v1", digest: "merkle-1", bit_length: 256 }
    };

    await store.put({
      reference: pfasReportRef,
      content: { doc: "PFAS ground water concentration levels", level: "high" },
      provenance: pfasProvGraph as any,
      lifecycle: { state: "admitted", approved_by: [] } as any
    });

    // Resolve Trust
    const trustReport = await resolver.resolve(pfasReportRef);
    expect(trustReport.trust.provenance).toBe(true);
    expect(trustReport.trust.policy).toBe(true);
    expect(trustReport.trust.hash).toBe(true);

    // 2. World State Apply (PfasReport)
    const reportArtifact = {
      reference: pfasReportRef,
      payload: trustReport.payload,
      verification: {
        verified: true,
        hash: true,
        signature: "valid",
        provenance: true,
        lineage: true
      }
    };

    await world.apply({
      entity_id: pfasReportRef.id,
      artifact_ref: pfasReportRef,
      state: "active",
      version: pfasReportRef.version,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, reportArtifact as any);

    // 3. Genesis Snapshot
    const snap1Hash = await hasher.calculate({
      identity: {
        snapshot_id: "snap-1",
        snapshot_hash: { algorithm: "sha256-v1", digest: "", bit_length: 256 },
        state_root: await world.calculateRoot(),
        created_at: new Date().toISOString()
      },
      entries: [pfasReportRef]
    });

    const snap1 = {
      identity: {
        snapshot_id: "snap-1",
        snapshot_hash: snap1Hash,
        state_root: await world.calculateRoot(),
        created_at: new Date().toISOString()
      },
      entries: [pfasReportRef]
    };
    await chain.append(snap1);

    // 4. World State Mutation (EnvironmentalDecision)
    const decisionRef: RegistryReference = {
      id: "decision-pfas-2026-001",
      version: "1.0.0",
      content_hash: { algorithm: "sha256-v1", digest: "hash-decision-1", bit_length: 256 },
      schema_ref: schemaEnvDecision
    };

    const decisionProvGraph: ProvenanceGraph = {
      root: {
        artifact_hash: decisionRef.content_hash,
        created_by: actorNaturvardsverket,
        created_at: new Date().toISOString(),
        parent: pfasReportRef,
        operation: "created"
      },
      chain: [],
      merkle_root: { algorithm: "sha256-v1", digest: "merkle-2", bit_length: 256 }
    };

    await store.put({
      reference: decisionRef,
      content: { action: "ban_chemical", chemical: "PFOS", reference_report: pfasReportRef.id },
      provenance: decisionProvGraph as any,
      lifecycle: { state: "admitted", approved_by: [] } as any
    });

    const trustDecision = await resolver.resolve(decisionRef);

    const decisionArtifact = {
      reference: decisionRef,
      payload: trustDecision.payload,
      verification: {
        verified: true,
        hash: true,
        signature: "valid",
        provenance: true,
        lineage: true
      }
    };

    await world.apply({
      entity_id: decisionRef.id,
      artifact_ref: decisionRef,
      state: "active",
      version: decisionRef.version,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, decisionArtifact as any);

    // Snapshot 2
    const snap2Hash = await hasher.calculate({
      identity: {
        snapshot_id: "snap-2",
        snapshot_hash: { algorithm: "sha256-v1", digest: "", bit_length: 256 },
        parent_snapshot: { id: "snap-1", version: "1.0.0", content_hash: snap1Hash },
        state_root: await world.calculateRoot(),
        created_at: new Date().toISOString()
      },
      entries: [pfasReportRef, decisionRef]
    });

    const snap2 = {
      identity: {
        snapshot_id: "snap-2",
        snapshot_hash: snap2Hash,
        parent_snapshot: { id: "snap-1", version: "1.0.0", content_hash: snap1Hash },
        state_root: await world.calculateRoot(),
        created_at: new Date().toISOString()
      },
      entries: [pfasReportRef, decisionRef]
    };
    await chain.append(snap2);

    expect(await chain.verifyChain()).toBe(true);

    // 5. Disaster Recovery Sim
    // Vi skapar en ny tom WorldStateManager för att simulera att vi måste starta om
    const freshWorld = new InMemoryWorldStateManager();
    const freshRecoveryEngine = new DefaultDisasterRecoveryEngine(chain, verifier, freshWorld, resolver, provenanceFactory);

    const recoveryContext = {
      recovery_id: "recovery-run-999",
      actor: actorNaturvardsverket,
      requested_at: new Date().toISOString()
    };

    const previousWorldRoot = await freshWorld.calculateRoot();

    const result = await freshRecoveryEngine.restore(recoveryContext);
    
    expect(result.restored).toBe(true);
    expect(result.snapshot?.snapshot_id).toBe("snap-2");
    expect(result.restored_entries).toBe(2);
    expect(result.provenance?.root?.operation).toBe("restored");

    const restoredWorldRoot = await freshWorld.calculateRoot();

    // 6. Manifest Publish
    const manifestSchemaRef = { id: "schema-recovery-manifest", version: "1.0.0", content_hash: { algorithm: "sha256-v1", digest: "hash-schem", bit_length: 256 } };
    
    const entryBuilder = new RegistryEntryBuilder({ registryId: "mock-registry-v1" });
    const publisher = new RecoveryManifestPublisher(
      mockArtifactFactory,
      mockVerificationExecutor,
      entryBuilder,
      store,
      actorNaturvardsverket,
      manifestSchemaRef,
      "dummy-key",
      provenanceFactory
    );

    const builder = new RecoveryManifestBuilder();
    const manifest = builder.build(recoveryContext, result.snapshot!, result, previousWorldRoot, restoredWorldRoot);
    
    await publisher.publish(manifest);

    // Verify manifest is in store
    const manifestRef = {
      id: `recovery-manifest-${recoveryContext.recovery_id}`,
      version: "1.0.0",
      content_hash: { algorithm: "sha256-v1", digest: `hash-recovery-manifest-${recoveryContext.recovery_id}`, bit_length: 256 }
    };

    const storedManifest = await store.get(manifestRef);
    expect(storedManifest).toBeDefined();
    expect(storedManifest?.reference.id).toBe(`recovery-manifest-${recoveryContext.recovery_id}`);
    expect(storedManifest?.provenance?.root?.operation).toBe("created");
    expect(storedManifest?.provenance?.root?.metadata?.recovery_id).toBe("recovery-run-999");
  });
});
