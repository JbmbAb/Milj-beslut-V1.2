import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLuAssessmentViaKernel } from '../src/execution/LuExecutionKernelClient';
import type { SpatialEvidenceArtifact } from '../src/artifacts/SpatialEvidenceArtifact';
import { SPATIAL_STACK_V1 } from '../src/artifacts/SpatialEngineFingerprint';
import { InMemoryArtifactRepository } from '../../mps-runtime/src/repository/InMemoryArtifactRepository';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('LuExecutionKernelClient', () => {
  // RC8-K: bootstrap admission is opt-in only. This file exercises the kernel client directly
  // without a real FrozenCore verification context, so it declares the opt-in explicitly.
  beforeEach(() => {
    process.env.MPS_LU_BOOTSTRAP_ADMIT = '1';
  });
  afterEach(() => {
    delete process.env.MPS_LU_BOOTSTRAP_ADMIT;
  });

  it('admits and returns finding ids via ExecutionKernel', async () => {
    const evidence = [
      {
        artifact_id: 'ev-water-1',
        artifact_type: 'SPATIAL_EVIDENCE',
        payload: {
          result_semantics: {
            kind: 'EXISTENCE_WITHIN_DISTANCE',
            query: {
              subject_ref: { artifact_id: 'prop-client', artifact_type: 'PROPERTY' },
              srid: 3006,
              distance_meters: 100,
            },
            result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
          },
          property_ref: { artifact_id: 'prop-client', artifact_type: 'PROPERTY' },
          source_metadata: {
            provider: 'SGU',
            dataset: 'water',
            dataset_version: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
            retrieved_at: '2026-08-13T08:00:00.000Z',
          },
          geometry: null,
          srid: 3006,
          operation: {
            algorithm: 'spatial.dwithin_existence',
            engine: 'PostGIS',
            engine_fingerprint: SPATIAL_STACK_V1,
          },
          layer_ref: {
            layer_id: 'water',
            version_hash: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
            layer_version: 'v1',
          },
          query_context: {
            query_id: 'q-client',
            query_type: 'SPATIAL_DWITHIN',
            parameters: { search_distance_meters: 100 },
          },
        },
      },
    ] as unknown as SpatialEvidenceArtifact[];

    const result = await runLuAssessmentViaKernel({
      site_id: 'site-a',
      deterministic_seed: 'seed:site-a',
      evidence,
    });

    expect(result.admitted).toBe(true);
    expect(result.attempt_id).toContain('attempt-');
    expect(result.finding_ids.length).toBeGreaterThan(0);
    expect(result.findings.length).toBe(result.finding_ids.length);
    expect(result.manifest_id).toContain('lu-manifest-');
    expect(result.session?.artifact_type).toBe('execution_session');
    expect(result.session?.manifest_ref.artifact_id).toBe(result.manifest_id);
    expect(result.session?.attempt_refs[0]?.artifact_id).toBe(result.attempt_id);
    expect(result.session?.outcome_ref?.artifact_id).toBe(result.outcome_id);
    expect(result.attestation?.artifact_type).toBe('outcome_attestation');
    expect(result.attestation?.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('H2-V1: obligation write failure before CAS persistence rejects and writes no assessment artifact', async () => {
    const repository = new InMemoryArtifactRepository();
    const evidence = [
      {
        artifact_id: 'ev-water-h2-v1',
        artifact_type: 'SPATIAL_EVIDENCE',
        payload: {
          result_semantics: {
            kind: 'EXISTENCE_WITHIN_DISTANCE',
            query: {
              subject_ref: { artifact_id: 'prop-h2-v1', artifact_type: 'PROPERTY' },
              srid: 3006,
              distance_meters: 100,
            },
            result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
          },
          property_ref: { artifact_id: 'prop-h2-v1', artifact_type: 'PROPERTY' },
          source_metadata: {
            provider: 'SGU',
            dataset: 'water',
            dataset_version: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
            retrieved_at: '2026-08-13T08:00:00.000Z',
          },
          geometry: null,
          srid: 3006,
          operation: {
            algorithm: 'spatial.dwithin_existence',
            engine: 'PostGIS',
            engine_fingerprint: SPATIAL_STACK_V1,
          },
          layer_ref: {
            layer_id: 'water',
            version_hash: '2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc',
            layer_version: 'v1',
          },
          query_context: {
            query_id: 'q-h2-v1',
            query_type: 'SPATIAL_DWITHIN',
            parameters: { search_distance_meters: 100 },
          },
        },
      },
    ] as unknown as SpatialEvidenceArtifact[];

    let preparedAssessmentId: string | null = null;
    await expect(
      runLuAssessmentViaKernel({
        site_id: 'site-h2-v1',
        deterministic_seed: 'seed:h2-v1',
        evidence,
        artifact_repository: repository,
        assessment_draft: {
          site_id: 'site-h2-v1',
          project_context_ref: { artifact_id: 'project-context-h2-v1', artifact_type: 'LU_PROJECT_CONTEXT' },
          property_ref: { artifact_id: 'prop-h2-v1', artifact_type: 'PROPERTY' },
          evidence_refs: [{ artifact_id: 'ev-water-h2-v1', artifact_type: 'SPATIAL_EVIDENCE' }],
          system_summary: 'H2-V1 obligation failure proof',
        },
        on_assessment_prepared: async (assessment) => {
          preparedAssessmentId = assessment.artifact_id;
          throw new Error('H2_V1_OBLIGATION_UPSERT_FAILED');
        },
      }),
    ).rejects.toThrow('H2_V1_OBLIGATION_UPSERT_FAILED');

    expect(preparedAssessmentId).toMatch(/^assessment-/);
    await expect(
      repository.resolve({
        artifact_id: preparedAssessmentId!,
        artifact_type: 'LOCALIZATION_ASSESSMENT',
      }),
    ).rejects.toThrow();
  });

  it('cutover: no LU_MPS_MOTOR opt-out and no RuleEngine bypass export', () => {
    const clientSrc = readFileSync(
      path.join(__dirname, '../src/execution/LuExecutionKernelClient.ts'),
      'utf8',
    );
    expect(clientSrc).not.toContain('isLuMpsMotorEnabled');
    expect(clientSrc).not.toContain('LU_MPS_MOTOR');
    expect(clientSrc).toContain('runLuAssessmentViaKernel');
    expect(clientSrc).toContain('createLuRegistryRuntime');
    expect(clientSrc).toContain('implementation_ref');
    expect(clientSrc).toContain('MimersIntegration');
    expect(clientSrc).toContain('CapabilityRuntime');
    expect(clientSrc).toContain('asExecutorPort');
    expect(clientSrc).toContain('SecurityRuntime');
    expect(clientSrc).toContain('asAdmissionPort');
    expect(clientSrc).toContain('asAuthorizedExecutorPort');
    expect(clientSrc).not.toContain('FrozenAdmissionAdapter(null, true)');
    expect(clientSrc).not.toContain('lu-rule-engine:');
    expect(clientSrc).not.toContain('CapabilityExecutorPort = {');
  });
});
