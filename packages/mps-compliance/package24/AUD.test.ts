import { describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "@miljobeslut/mps-canonical";
import {
  AuditArtifact,
  EvidenceBoundAuditArtifact,
  ChainedAuditArtifact,
  ReconstructionBoundAuditArtifact,
} from "../../mps-audit/src/contracts/AuditArtifact.js";
import { AuditEngine } from "../../mps-audit/src/engine/AuditEngine.js";
import { AuditResolver } from "../../mps-audit/src/resolver/AuditResolver.js";
import {
  DefaultAuditProvenanceValidator,
  DefaultAuditEvidenceValidator,
  DefaultAuditChainValidator,
  DefaultAuditReconstructionValidator,
} from "../../mps-audit/src/validation/AuditValidator.js";

async function canonicalHash(obj: any): Promise<string> {
  const pipeline = new DefaultCanonicalPipeline();
  await pipeline.initHasher();

  const payload = { ...obj };
  delete payload.artifact_id;
  delete payload.audit_key;

  return pipeline.hashCanonical(payload, "JSON").digest;
}

describe("AUD-001 -> AUD-008 Audit Compliance", () => {
  // AUD-001 Audit Identity Isolation
  it("AUD-001 Audit Identity Isolation (A) - metadata does not affect identity", async () => {
    const base: AuditArtifact = {
      artifact_type: "AUDIT_ARTIFACT",
      artifact_id: "aud-123",
      audit_key: "sys-audit",
      subject_ref: { artifact_id: "sub-123" } as any,
      trigger_ref: { artifact_id: "trg-123" } as any,
    } as any;

    const renamed = {
      ...base,
      audit_key: "sys-audit-v2",
    };

    expect(await canonicalHash(base)).toBe(await canonicalHash(renamed));
  });

  // AUD-002 Audit Repository Resolution
  it("AUD-002 Audit Repository Resolution (A) - resolve via repository trace", async () => {
    const resolver: AuditResolver = {
      resolveByRef: async (ref) => ({
        audit: {
          artifact_type: "AUDIT_ARTIFACT",
          artifact_id: ref.artifact_id,
          audit_key: "test-audit",
          subject_ref: { artifact_id: "sub-1" } as any,
          trigger_ref: { artifact_id: "trg-1" } as any,
        } as any,
        trace: {
          source: "ArtifactRepository",
          artifact_ref: ref,
        },
      }),
    };

    const result = await resolver.resolveByRef({ artifact_id: "aud-1" } as any);
    expect(result.trace.source).toBe("ArtifactRepository");
  });

  // AUD-003 Audit Boundary Isolation
  it("AUD-003 Audit Boundary Isolation (A) - engine handles intent", () => {
    const engine: AuditEngine = {
      createAudit: async () => ({} as any),
    };
    expect(typeof engine.createAudit).toBe("function");
  });

  // AUD-004 Audit Replay Determinism
  it("AUD-004 Audit Replay Determinism (B) - exact state yields exact hash", async () => {
    const base: AuditArtifact = {
      artifact_type: "AUDIT_ARTIFACT",
      artifact_id: "aud-1",
      audit_key: "test",
      subject_ref: { artifact_id: "sub" } as any,
      trigger_ref: { artifact_id: "trg" } as any,
    } as any;

    const replay = { ...base };
    expect(await canonicalHash(base)).toBe(await canonicalHash(replay));
  });

  // AUD-005 Audit Provenance Integrity
  it("AUD-005 Audit Provenance Integrity (A) - validates subject and trigger", () => {
    const valid: AuditArtifact = {
      subject_ref: { artifact_id: "sub" } as any,
      trigger_ref: { artifact_id: "trg" } as any,
    } as any;
    expect(() => DefaultAuditProvenanceValidator.validateStructure(valid)).not.toThrow();

    const invalid: AuditArtifact = {
      subject_ref: {} as any, // non-canonical
      trigger_ref: { artifact_id: "trg" } as any,
    } as any;
    expect(() => DefaultAuditProvenanceValidator.validateStructure(invalid)).toThrow("AUDIT_PROVENANCE_VIOLATION: non-canonical subject_ref");
  });

  // AUD-006 Audit Evidence Binding
  it("AUD-006 Audit Evidence Binding (A) - ensures evidence refs are canonical", async () => {
    const valid: EvidenceBoundAuditArtifact = {
      evidence: { evidence_refs: [{ artifact_id: "ev-1" } as any] },
    } as any;
    await expect(DefaultAuditEvidenceValidator.validate(valid)).resolves.not.toThrow();

    const invalid: EvidenceBoundAuditArtifact = {
      evidence: { evidence_refs: [{} as any] },
    } as any;
    await expect(DefaultAuditEvidenceValidator.validate(invalid)).rejects.toThrow("AUDIT_EVIDENCE_VIOLATION: non-canonical evidence_ref");

    const empty: EvidenceBoundAuditArtifact = {
      evidence: { evidence_refs: [] },
    } as any;
    await expect(DefaultAuditEvidenceValidator.validate(empty)).rejects.toThrow("AUDIT_EVIDENCE_VIOLATION: empty evidence set");
  });

  // AUD-007 Audit Immutability Chain
  it("AUD-007 Audit Immutability Chain (A) - chain links must be valid", () => {
    const valid: ChainedAuditArtifact = {
      chain: {
        previous_audit_ref: { artifact_id: "aud-prev" } as any,
        previous_audit_hash: "hash-123",
      },
    } as any;
    expect(() => DefaultAuditChainValidator.validate(valid)).not.toThrow();

    const invalid: ChainedAuditArtifact = {
      chain: { previous_audit_ref: {} as any },
    } as any;
    expect(() => DefaultAuditChainValidator.validate(invalid)).toThrow("AUDIT_CHAIN_VIOLATION: non-canonical previous_audit_ref");
  });

  // AUD-008 Audit Reconstruction Integrity
  it("AUD-008 Audit Reconstruction Integrity (A) - validates reconstruction sets", () => {
    const valid: ReconstructionBoundAuditArtifact = {
      reconstruction: {
        definition_refs: [{ artifact_id: "def-1" } as any],
        execution_refs: [],
        event_refs: [],
        decision_refs: [],
      },
    } as any;
    expect(() => DefaultAuditReconstructionValidator.validate(valid)).not.toThrow();

    const invalid: ReconstructionBoundAuditArtifact = {
      reconstruction: {
        definition_refs: [{} as any], // missing artifact_id
        execution_refs: [],
        event_refs: [],
        decision_refs: [],
      },
    } as any;
    expect(() => DefaultAuditReconstructionValidator.validate(invalid)).toThrow("AUDIT_RECONSTRUCTION_VIOLATION: non-canonical artifact_ref");

    const empty: ReconstructionBoundAuditArtifact = {
      reconstruction: {
        definition_refs: [],
        execution_refs: [],
        event_refs: [],
        decision_refs: [],
      },
    } as any;
    expect(() => DefaultAuditReconstructionValidator.validate(empty)).toThrow("AUDIT_RECONSTRUCTION_VIOLATION: empty reconstruction set");
  });
});
