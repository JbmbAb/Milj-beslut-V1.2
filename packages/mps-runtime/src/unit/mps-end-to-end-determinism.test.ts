import { describe, expect, it } from "vitest";
import { CanonicalSerializer } from "@miljobeslut/mps-canonical";
import {
  ArtifactIdentityBuilder,
  toContentReference,
  assertContentReferenceMatches,
  ContentAddressedArtifactStore,
  GovernanceEngine,
  ArchiveEngine,
  PromotionEngine,
} from "@miljobeslut/mps-core";
import type {
  CanonicalHashEngine,
  Signer,
  SignatureVerifier,
  ArtifactIdentityStrategy,
  SchemaValidator,
  DecisionClock,
  UniqueIdGenerator,
} from "@miljobeslut/mps-core";
import {
  RegistrySnapshotBuilder,
} from "@miljobeslut/mps-registry";
import {
  DefaultReplayVerifier,
  ReplaySession,
  DefaultReplayEngine,
} from "@miljobeslut/mps-replay";
import {
  PipelineRuntime,
  ExecutionContext as RuntimeExecutionContext,
} from "../index"; // Sibling relative import
import {
  AuditEngine,
  AuditPreValidator,
  CoreCanonicalAuditSerializer,
} from "@miljobeslut/mps-audit";
import {
  DefaultPolicyDecisionEngine,
  PolicyEnforcementMiddleware,
} from "@miljobeslut/mps-policy";
import type {
  PolicyRegistry,
  PolicyApprovalStore,
} from "@miljobeslut/mps-policy";

// --- Integration Mocks & Stores ---

class CryptoHashEngine implements CanonicalHashEngine {
  constructor(private readonly serializer: CanonicalSerializer) {}
  hash(bytes: Uint8Array): any {
    const text = new TextDecoder().decode(bytes);
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = (h << 5) - h + text.charCodeAt(i);
      h |= 0;
    }
    return {
      algorithm: "mock-sha256",
      digest: `hash-${Math.abs(h)}`,
    };
  }
}

class CryptoSigner implements Signer {
  async sign(hash: any): Promise<any> {
    return {
      algorithm: "mock-sig",
      signature: `sig-${hash.digest}`,
    };
  }
}

class CryptoVerifier implements SignatureVerifier {
  async verify(hash: any, sig: any): Promise<boolean> {
    return sig.signature === `sig-${hash.digest}`;
  }
}

class CustomIdentityStrategy implements ArtifactIdentityStrategy {
  createArtifactId(contentHash: any): string {
    return `id-${contentHash.digest.replace("hash-", "")}`;
  }
}

class DummySchemaValidator implements SchemaValidator {
  validate<T>(_artifact: T): void {}
}

class FixedClock implements DecisionClock {
  now() {
    return new Date("2026-07-31T12:00:00.000Z");
  }
}

class IncrementingIdGenerator implements UniqueIdGenerator {
  private counter = 0;
  generate() {
    this.counter += 1;
    return `gen-id-${this.counter}`;
  }
}

class MockStorageBackend {
  readonly map = new Map<string, Uint8Array>();
  async get(id: string) { return this.map.get(id) ?? null; }
  async put(id: string, bytes: Uint8Array) { this.map.set(id, bytes); }
  async exists(id: string) { return this.map.has(id); }
}

class InMemoryAuditStore {
  readonly records: any[] = [];
  async append(artifact: any) {
    const seq = this.records.length + 1;
    const parent = this.records[this.records.length - 1];
    const audit_id = `audit-${seq.toString().padStart(8, "0")}`;
    const updatedRecord = {
      ...artifact.record,
      audit_id,
      sequence: seq,
      parent: parent ? { audit_id: parent.record.audit_id, audit_hash: parent.hash } : undefined,
    };
    const finalArtifact = { record: updatedRecord, hash: artifact.hash };
    this.records.push(finalArtifact);
    return { audit_id: updatedRecord.audit_id, audit_hash: artifact.hash };
  }
  async get(audit_id: string) {
    return this.records.find(r => r.record.audit_id === audit_id) ?? null;
  }
  async getChainIndex() {
    const latest = this.records[this.records.length - 1];
    return {
      latest_audit_id: latest ? latest.record.audit_id : null,
      latest_audit_hash: latest ? latest.hash : null,
      length: this.records.length,
    };
  }
}

// --- End-to-End Test ---

describe("MPS Complete End-to-End Determinism Proof", () => {
  it("should run complete pipeline and replay it to verify bit-for-bit determinism", async () => {
    // 1. Initialiseringsfas
    const serializer = new CanonicalSerializer();
    const hashEngine = new CryptoHashEngine(serializer);
    const signer = new CryptoSigner();
    const sigVerifier = new CryptoVerifier();
    const identityStrategy = new CustomIdentityStrategy();
    const schemaValidator = new DummySchemaValidator();
    const clock = new FixedClock();
    const idGenerator = new IncrementingIdGenerator();

    const identityBuilder = new ArtifactIdentityBuilder(
      serializer,
      hashEngine,
      signer,
      identityStrategy
    );

    const backend = new MockStorageBackend();
    const artifactStore = new ContentAddressedArtifactStore(
      serializer,
      hashEngine,
      identityBuilder,
      schemaValidator,
      sigVerifier,
      backend
    );

    // 2. Bygg Register-Snapshot
    const snapshotBuilder = new RegistrySnapshotBuilder(
      serializer,
      hashEngine,
      identityStrategy,
      clock
    );
    const registrySnapshot = snapshotBuilder.build([], [], [], [], []);

    // 3. Skapa policybeslutslager
    const policyRegistry: PolicyRegistry = {
      policy_set: {
        schema_version: "policy.v1",
        policy_set_id: "policy-set-1",
        policy_set_hash: "hash-ps-1",
        policies: [
          {
            policy_id: "pol-1",
            policy_version: "1.0",
            policy_hash: "hash-pol-1",
            content: new Uint8Array([5, 6]),
          },
        ],
      },
      getPolicyContent: () => new Uint8Array([5, 6]),
    };

    const policyEngine = new DefaultPolicyDecisionEngine(
      serializer,
      hashEngine,
      policyRegistry,
      idGenerator,
      clock
    );

    const approvalStore: PolicyApprovalStore = {
      getByDecisionId: async () => null,
    };

    const enforcement = new PolicyEnforcementMiddleware(policyEngine, approvalStore);

    // 4. Skapa Runtime & Replay-motorer
    const mpsVerifier = {
      verify: async () => ({
        integrity: true,
        signature_valid: true,
        trusted: true,
      }),
    };

    const replayVerifier = new DefaultReplayVerifier(artifactStore, mpsVerifier);
    const replayEngine = new DefaultReplayEngine(replayVerifier, clock, idGenerator);

    const runtimeContext: RuntimeExecutionContext = {
      registry: registrySnapshot,
      store: artifactStore,
      governance: { evaluate: async () => ({ value: "gov-eval-ok" }) },
      archive: { archive: async () => ({ value: "archived-ok" }) },
      promotion: { promote: async () => ({ value: "promoted-ok" }) },
      replay: replayEngine,
      artifactVerifier: mpsVerifier,
      clock,
      idGen: idGenerator,
    };

    const runtime = new PipelineRuntime(runtimeContext);

    // 4.5 Seeda prov-ref-1 och prov-ref-2 i lagret så att ReplayEngine kan verifiera dem
    const envelope1 = { value: "provenance-data-1" };
    const hash1 = hashEngine.hash(serializer.serialize(envelope1));
    const mockProvenance1 = {
      artifact_id: "prov-ref-1",
      content_hash: hash1,
      ...envelope1,
    };
    await backend.put("prov-ref-1", serializer.serialize(mockProvenance1));

    const envelope2 = { value: "provenance-data-2" };
    const hash2 = hashEngine.hash(serializer.serialize(envelope2));
    const mockProvenance2 = {
      artifact_id: "prov-ref-2",
      content_hash: hash2,
      ...envelope2,
    };
    await backend.put("prov-ref-2", serializer.serialize(mockProvenance2));

    // 5. Exekvera första körningen (Execution 1)
    const stages = [
      { stage: "GOVERNANCE" as const, reference: { id: "prov-ref-1", content_hash: hash1 } },
      { stage: "ARCHIVE" as const, reference: { id: "prov-ref-2", content_hash: hash2 } },
    ];

    const report1 = await runtime.run(stages);
    console.log("REPLAY FAILURES:", JSON.stringify(report1.replay.failures, null, 2));

    // 6. Spara i Revisionskedjan (Audit Record 1)
    const auditStore = new InMemoryAuditStore();
    const auditEngine = new AuditEngine(
      auditStore,
      new CoreCanonicalAuditSerializer(),
      { hash: (bytes) => hashEngine.hash(bytes).digest },
      new AuditPreValidator()
    );

    const auditRef1 = await auditEngine.recordExecution(report1);

    // --- REPLAY AND VERIFY BIT-FOR-FOR DETERMINISM ---

    // Vi återställer ID-generatorn och klockan till exakt samma ursprungstillstånd
    const idGenerator2 = new IncrementingIdGenerator();
    const replayEngine2 = new DefaultReplayEngine(replayVerifier, clock, idGenerator2);
    const runtimeContext2: RuntimeExecutionContext = {
      ...runtimeContext,
      idGen: idGenerator2,
      replay: replayEngine2,
    };
    const runtime2 = new PipelineRuntime(runtimeContext2);

    // Kör exakt samma pipelinescenario en gång till (Execution 2)
    const report2 = await runtime2.run(stages);

    // Verifiera att ExecutionReports är identiska bit-för-bit!
    const serializedReport1 = serializer.serialize(report1);
    const serializedReport2 = serializer.serialize(report2);
    expect(serializedReport1).toEqual(serializedReport2);

    // Verifiera att de producerade hasharna och revisionsrekorden i revisionskedjan är helt identiska!
    const auditEngine2 = new AuditEngine(
      auditStore,
      new CoreCanonicalAuditSerializer(),
      { hash: (bytes) => hashEngine.hash(bytes).digest },
      new AuditPreValidator()
    );

    const auditRef2 = await auditEngine2.recordExecution(report2);

    expect(auditRef1.audit_hash).toBe(auditRef2.audit_hash);
    expect(auditRef1.audit_id).toBe("audit-00000001"); // Bestäms atomiskt i store vid append

    const record1 = await auditStore.get("audit-00000001");
    const record2 = await auditStore.get("audit-00000002");

    expect(record1!.hash).toBe(record2!.hash);
    expect(record2!.record.sequence).toBe(2);
    expect(record2!.record.parent!.audit_id).toBe("audit-00000001");
  });
});
