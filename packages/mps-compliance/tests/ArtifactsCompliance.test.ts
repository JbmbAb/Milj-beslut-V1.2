import { describe, expect, it } from 'vitest';
import { EvidenceArtifact } from '../src/artifacts/EvidenceArtifact';
import { ComplianceAttestationArtifact } from '../src/artifacts/ComplianceAttestationArtifact';
import { DatasetApprovalArtifact } from '../src/artifacts/DatasetApprovalArtifact';

describe('🜃 Ingest & Compliance Artifacts (C-01)', () => {
  it('instantiates and validates a first-class EvidenceArtifact', () => {
    const reportRef = {
      artifact_id: 'report-art-001',
      artifact_type: 'REPORT_ARTIFACT' as any
    };

    const evidence: EvidenceArtifact = {
      artifact_id: 'evidence-art-001',
      artifact_type: 'EVIDENCE_ARTIFACT',
      content_hash: '8ee4dd889fea6f...',
      references: [reportRef],
      payload: {
        control_id: 'ART-001',
        result: 'PASS',
        commit_hash: 'abc123commit',
        build_id: 'build-4521',
        execution_id: 'run-9999',
        timestamp: new Date().toISOString(),
        artifact_ref: reportRef
      }
    };

    expect(evidence.artifact_id).toBe('evidence-art-001');
    expect(evidence.artifact_type).toBe('EVIDENCE_ARTIFACT');
    expect(evidence.payload.control_id).toBe('ART-001');
    expect(evidence.payload.result).toBe('PASS');
    expect(evidence.payload.commit_hash).toBe('abc123commit');
    expect(evidence.payload.artifact_ref.artifact_id).toBe('report-art-001');
  });

  it('instantiates and validates a first-class ComplianceAttestationArtifact', () => {
    const evidenceRef = {
      artifact_id: 'evidence-art-001',
      artifact_type: 'EVIDENCE_ARTIFACT' as any
    };

    const attestation: ComplianceAttestationArtifact = {
      artifact_id: 'attestation-art-001',
      artifact_type: 'COMPLIANCE_ATTESTATION_ARTIFACT',
      content_hash: '9ffbeeb747dd...',
      references: [evidenceRef],
      payload: {
        attestation_id: 'mps-core-1.0-attestation',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        baseline_version: 'MPS-CORE-1.0',
        status: 'COMPLIANT',
        evidence_refs: [evidenceRef]
      }
    };

    expect(attestation.artifact_id).toBe('attestation-art-001');
    expect(attestation.artifact_type).toBe('COMPLIANCE_ATTESTATION_ARTIFACT');
    expect(attestation.payload.baseline_version).toBe('MPS-CORE-1.0');
    expect(attestation.payload.status).toBe('COMPLIANT');
    expect(attestation.payload.evidence_refs[0]!.artifact_id).toBe('evidence-art-001');
  });

  it('instantiates and validates a first-class DatasetApprovalArtifact under Mimers Brunn v2.0.1', () => {
    const manifestRef = {
      artifact_id: 'harvest-manifest-sgu-2026',
      artifact_type: 'HARVEST_MANIFEST' as any
    };

    const approval: DatasetApprovalArtifact = {
      artifact_id: 'approval-sgu-2026',
      artifact_type: 'DATASET_APPROVAL',
      content_hash: '3bc7fe997faee...',
      references: [manifestRef],
      payload: {
        approved_ref: manifestRef,
        decision: 'APPROVED',
        actor_ref: {
          actor_id: 'revisor-kristina',
          role: 'GOVERNANCE_REVIEWER'
        },
        decision_at: new Date().toISOString(),
        reason: 'SGU geodataset verifierat mot fryst master-arkiv och godkänt för PostGIS-import.'
      }
    };

    expect(approval.artifact_id).toBe('approval-sgu-2026');
    expect(approval.artifact_type).toBe('DATASET_APPROVAL');
    expect(approval.payload.decision).toBe('APPROVED');
    expect(approval.payload.actor_ref.role).toBe('GOVERNANCE_REVIEWER');
    expect(approval.payload.approved_ref.artifact_id).toBe('harvest-manifest-sgu-2026');
  });
});
