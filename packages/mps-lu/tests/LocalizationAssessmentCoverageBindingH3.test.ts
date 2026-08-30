import { describe, expect, it } from 'vitest';
import { sha256ContentHash } from '../../mps-runtime/src/kernel/ExecutionKernel';
import {
  createGovernedLocalizationAssessment,
  createLocalizationAssessmentCoverageSnapshot,
  localizationAssessmentCanonicalBody,
  validateLocalizationAssessmentContractVersion,
  type LocalizationAssessmentArtifact,
  type LocalizationAssessmentDraft,
} from '../src/index';
import { SecurityRuntime } from '../../mps-runtime/src/security/SecurityRuntime';

const PROJECT_CONTEXT_REF = {
  artifact_id: 'lu_project_context-h3',
  artifact_type: 'LU_PROJECT_CONTEXT',
} as const;
const PROPERTY_REF = { artifact_id: 'property-h3', artifact_type: 'PROPERTY' } as const;

function buildOutcomeAndAttestation(seedTag: string) {
  const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `h3-${seedTag}` });
  security.bindPrincipal('lu.site_assessment.actor');
  const outcome = {
    outcome_id: `outcome-h3-${seedTag}`,
    artifact_type: 'execution_outcome' as const,
    attempt_ref: { artifact_id: 'attempt-h3', artifact_type: 'execution_attempt' },
    result: 'success' as const,
    content_hash: sha256ContentHash({ result: 'success', tag: seedTag }),
  };
  const attestation = security.attestOutcome(outcome.content_hash);
  return { outcome, attestation };
}

function draft(
  coverageSources: LocalizationAssessmentDraft['coverage_snapshot']['data_sources'],
): LocalizationAssessmentDraft {
  return {
    site_id: 'site-h3',
    project_context_ref: PROJECT_CONTEXT_REF,
    property_ref: PROPERTY_REF,
    evidence_refs: [{ artifact_id: 'evidence-h3', artifact_type: 'SPATIAL_EVIDENCE' }],
    system_summary: 'H3 coverage binding proof',
    coverage_snapshot: createLocalizationAssessmentCoverageSnapshot(coverageSources),
  };
}

describe('H3 COVERAGE-VERDICT binding', () => {
  it('binds provider coverage into the assessment hash domain', () => {
    const { outcome, attestation } = buildOutcomeAndAttestation('coverage-hash');
    const complete = createGovernedLocalizationAssessment({
      draft: draft([{ source: 'NVR API', status: 'ok', detail: '0 träffar' }]),
      findings: [],
      outcome,
      attestation,
    });
    const partial = createGovernedLocalizationAssessment({
      draft: draft([{ source: 'NVR API', status: 'unavailable', detail: 'timeout' }]),
      findings: [],
      outcome,
      attestation,
    });

    expect(complete.payload.coverage_snapshot?.overall_status).toBe('COMPLETE');
    expect(partial.payload.coverage_snapshot?.overall_status).toBe('UNAVAILABLE');
    expect(complete.artifact_id).not.toBe(partial.artifact_id);
    expect(complete.content_hash.value).not.toBe(partial.content_hash.value);
    expect(sha256ContentHash(localizationAssessmentCanonicalBody(partial)).value).toBe(
      partial.content_hash.value,
    );
  });

  it('rejects a new H3/V4-labeled assessment payload with missing coverage_snapshot', () => {
    expect(() =>
      validateLocalizationAssessmentContractVersion({
        project_context_ref: PROJECT_CONTEXT_REF,
        property_ref: PROPERTY_REF,
        execution_outcome_ref: { artifact_id: 'outcome-h3-missing', artifact_type: 'execution_outcome' },
        outcome_attestation_ref: { artifact_id: 'attest-h3-missing', artifact_type: 'attestation' },
        findings: [],
        evidence_refs: [],
        rule_refs: [],
        system_summary: 'tampered',
        assessment_contract_version: 'localization-assessment-v4' as never,
        canonicalizer_id: 'rfc8785-sha256-v1' as never,
      }),
    ).toThrow(/coverage_snapshot/);
  });

  it('rejects a tampered H3/V4 payload whose declared coverage status does not match its sources', () => {
    const { outcome, attestation } = buildOutcomeAndAttestation('tampered-coverage');
    const valid = createGovernedLocalizationAssessment({
      draft: draft([{ source: 'NVR API', status: 'unavailable', detail: 'timeout' }]),
      findings: [],
      outcome,
      attestation,
    });
    const tampered: LocalizationAssessmentArtifact = {
      ...valid,
      payload: {
        ...valid.payload,
        coverage_snapshot: {
          ...valid.payload.coverage_snapshot!,
          overall_status: 'COMPLETE',
        },
      },
    };

    expect(() => validateLocalizationAssessmentContractVersion(tampered.payload)).toThrow(
      /coverage_snapshot/,
    );
  });
});
