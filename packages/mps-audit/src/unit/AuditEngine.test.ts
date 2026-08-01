import { describe, expect, it } from "vitest";
import {
  AuditEngine,
  AuditPreValidator,
  CoreCanonicalAuditSerializer,
  AuditArtifact,
  AuditReference,
  AuditChainIndex,
  AuditStore,
} from "../index";
import type { ExecutionReport } from "@miljobeslut/mps-runtime";
import { RuntimeViolation } from "@miljobeslut/mps-core";

class MockAuditStore implements AuditStore {
  readonly store = new Map<string, AuditArtifact>();
  counter = 0;

  async append(artifact: AuditArtifact): Promise<AuditReference> {
    this.counter += 1;
    const audit_id = `audit-${this.counter.toString().padStart(8, "0")}`;
    const updatedRecord = { ...artifact.record, audit_id, sequence: this.counter };
    this.store.set(audit_id, { record: updatedRecord, hash: artifact.hash });
    return { audit_id, audit_hash: artifact.hash };
  }

  async get(audit_id: string): Promise<AuditArtifact | null> {
    return this.store.get(audit_id) ?? null;
  }

  async getChainIndex(): Promise<AuditChainIndex> {
    const list = Array.from(this.store.keys()).sort();
    const latest = list[list.length - 1] ?? null;
    return {
      latest_audit_id: latest,
      latest_audit_hash: latest ? this.store.get(latest)!.hash : null,
      length: list.length,
    };
  }
}

describe("AuditEngine Suite", () => {
  it("should record execution successfully after prevalidation", async () => {
    const store = new MockAuditStore();
    const serializer = new CoreCanonicalAuditSerializer();
    const hashEngine = { hash: () => "mock-audit-hash" };
    const preValidator = new AuditPreValidator();
    const engine = new AuditEngine(store, serializer, hashEngine, preValidator);

    const report: ExecutionReport = {
      runtime_id: "run-123",
      registry_snapshot_id: "snap-456",
      registry_hash: "hash-789",
      started_at: "2026-07-31T12:00:00Z",
      finished_at: "2026-07-31T12:01:00Z",
      stages: [
        {
          stage: "GOVERNANCE",
          reference: { id: "ref-1", content_hash: { algorithm: "sha256", digest: "d1" } },
          artifact_id: "art-1",
          artifact: {},
          runtime_id: "run-123",
          registry_snapshot_id: "snap-456",
          verified: { integrity: true, signature_valid: true, trusted: true },
        },
      ],
      replay: {
        context: { session_id: "sess-1", started_at: "2026-07-31", replay_profile_name: "test" },
        steps: [],
        failures: [],
        completed: true,
      },
      completed: true,
    };

    const ref = await engine.recordExecution(report);
    expect(ref.audit_id).toBe("audit-00000001");
    expect(ref.audit_hash).toBe("mock-audit-hash");

    const retrieved = await store.get(ref.audit_id);
    expect(retrieved!.record.sequence).toBe(1);
    expect(retrieved!.record.runtime_id).toBe("run-123");
  });

  it("should throw violation when validating invalid reports", () => {
    const preValidator = new AuditPreValidator();
    const badReport: any = { runtime_id: "" };

    expect(() => preValidator.validate(badReport)).toThrow(RuntimeViolation);
  });
});
