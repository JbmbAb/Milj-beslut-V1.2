import { ContentReference } from "@miljobeslut/mps-evolution";
import {
  AuditArtifact,
  EvidenceBoundAuditArtifact,
  ChainedAuditArtifact,
  ReconstructionBoundAuditArtifact,
} from "../contracts/AuditArtifact.js";

function isCanonicalRef(ref: ContentReference): boolean {
  return !!ref.artifact_id;
}

async function resolveCanonical(_ref: ContentReference): Promise<void> {
  return;
}

export interface AuditProvenanceValidator {
  validateStructure(audit: AuditArtifact): void;
  validateGraph(audit: AuditArtifact): Promise<void>;
}

export const DefaultAuditProvenanceValidator: AuditProvenanceValidator = {
  validateStructure(audit) {
    if (!audit.subject_ref) {
      throw new Error("AUDIT_PROVENANCE_VIOLATION: missing subject_ref");
    }
    if (!audit.trigger_ref) {
      throw new Error("AUDIT_PROVENANCE_VIOLATION: missing trigger_ref");
    }
    if (!isCanonicalRef(audit.subject_ref)) {
      throw new Error("AUDIT_PROVENANCE_VIOLATION: non-canonical subject_ref");
    }
    if (!isCanonicalRef(audit.trigger_ref)) {
      throw new Error("AUDIT_PROVENANCE_VIOLATION: non-canonical trigger_ref");
    }
  },

  async validateGraph(_audit) {
    const hasCycle = false;
    if (hasCycle) {
      throw new Error("AUDIT_PROVENANCE_VIOLATION: provenance cycle detected");
    }
  },
};

export interface AuditEvidenceValidator {
  validate(audit: EvidenceBoundAuditArtifact): Promise<void>;
}

export const DefaultAuditEvidenceValidator: AuditEvidenceValidator = {
  async validate(audit) {
    if (audit.evidence.evidence_refs.length === 0) {
      throw new Error("AUDIT_EVIDENCE_VIOLATION: empty evidence set");
    }

    for (const ref of audit.evidence.evidence_refs) {
      if (!ref.artifact_id) {
        throw new Error("AUDIT_EVIDENCE_VIOLATION: non-canonical evidence_ref");
      }
      await resolveCanonical(ref);
    }
  },
};

export interface AuditChainValidator {
  validate(audit: ChainedAuditArtifact): void;
}

export const DefaultAuditChainValidator: AuditChainValidator = {
  validate(audit) {
    const { previous_audit_ref, previous_audit_hash } = audit.chain;

    if (previous_audit_ref && !previous_audit_ref.artifact_id) {
      throw new Error("AUDIT_CHAIN_VIOLATION: non-canonical previous_audit_ref");
    }

    if (previous_audit_hash && previous_audit_hash.length === 0) {
      throw new Error("AUDIT_CHAIN_VIOLATION: empty previous_audit_hash");
    }
  },
};

export interface AuditReconstructionValidator {
  validate(audit: ReconstructionBoundAuditArtifact): void;
}

export const DefaultAuditReconstructionValidator: AuditReconstructionValidator = {
  validate(audit) {
    const r = audit.reconstruction;

    const all = [
      ...r.definition_refs,
      ...r.execution_refs,
      ...r.event_refs,
      ...r.decision_refs,
    ];

    if (all.length === 0) {
      throw new Error("AUDIT_RECONSTRUCTION_VIOLATION: empty reconstruction set");
    }

    for (const ref of all) {
      if (!ref.artifact_id) {
        throw new Error("AUDIT_RECONSTRUCTION_VIOLATION: non-canonical artifact_ref");
      }
    }
  },
};
