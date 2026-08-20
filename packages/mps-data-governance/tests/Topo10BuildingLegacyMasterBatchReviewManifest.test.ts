import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  EXPECTED_LEGACY_MASTER_BATCH_COUNT,
  LegacyMasterBatchReviewManifestError,
  buildLegacyMasterBatchReviewManifest,
} from '../src/LegacyMasterBatchReviewManifest';
import type { VerifiedSourceDefinition } from '../src/SourceRegistry';

const SHA = 'a'.repeat(64);
const CHECKPOINT_SHA = 'b'.repeat(64);

function source(): VerifiedSourceDefinition {
  return {
    sourceId: 'lantmateriet-stac-byggnader', authority: { name: 'Lantmäteriet', type: 'other' },
    adapter: 'LM_STAC_BYGGNADER_V1', frequency: 'weekly', allowedDomains: ['api.lantmateriet.se'], artifactTypes: ['SPATIAL_DATASET'],
    policy: { rate_limit_requests_per_second: 1, concurrency_limit: 1, retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' } },
    registryArtifactId: 'reg-lantmateriet-stac-byggnader-001', sourceContentHash: SHA,
  };
}

function input() {
  const municipalities = Array.from({ length: EXPECTED_LEGACY_MASTER_BATCH_COUNT }, (_, index) => String(index + 1).padStart(4, '0'));
  const entries = municipalities.map((municipality_id) => ({
    municipality_id, status: 'PROVEN' as const, sha256: createHash('sha256').update(municipality_id).digest('hex'), size_bytes: 100,
    schema_check: { layer: 'byggnad' as const, geometry: 'MULTIPOLYGON' as const, crs: 'EPSG:3006' as const, required_fields: ['objektidentitet', 'geometri'] as const },
  }));
  return {
    checkpoint_sha256: CHECKPOINT_SHA, master_root: 'H:\\Master', source: source(), entries,
    current_objects: new Map(entries.map((entry) => [entry.municipality_id, {
      path: `H:\\Master\\${entry.municipality_id}.zip`, size_bytes: entry.size_bytes,
      sha256: entry.sha256,
    }])),
  };
}

describe('TOPO10-BUILDING-LEGACY-MASTER-BATCH-REVIEW-MANIFEST-01', () => {
  it('builds 289 byte-bound unsigned review entries deterministically and excludes 1762', () => {
    const first = buildLegacyMasterBatchReviewManifest(input());
    const second = buildLegacyMasterBatchReviewManifest(input());
    expect(first).toEqual(second);
    expect(first.item_count).toBe(289);
    expect(first.entries).toHaveLength(289);
    expect(first.entries.some((entry) => entry.municipality_id === '1762')).toBe(false);
    expect(first.entries[0].draft_admission.historical_acquisition).toEqual({
      status: 'UNKNOWN', source_url: null, item_updated: null, retrieved_at: null, manifest_ref: null, quarantine_ref: null,
    });
    expect(first.entries[0].draft_admission.admitted_at).toBeNull();
  });

  it('fails closed for incomplete, failed, changed, or historically fabricated review input', () => {
    const incomplete = input();
    incomplete.entries.pop();
    expect(() => buildLegacyMasterBatchReviewManifest(incomplete)).toThrow(LegacyMasterBatchReviewManifestError);

    const failed = input();
    failed.entries[0] = { ...failed.entries[0], status: 'FAILED_CLOSED' };
    expect(() => buildLegacyMasterBatchReviewManifest(failed)).toThrow('REJECT_PRECHECK_STATUS');

    const changed = input();
    changed.current_objects.set('0001', { ...changed.current_objects.get('0001')!, sha256: SHA });
    expect(() => buildLegacyMasterBatchReviewManifest(changed)).toThrow('REJECT_CHECKPOINT_BINDING');

    const includes1762 = input();
    includes1762.entries[0] = { ...includes1762.entries[0], municipality_id: '1762' };
    expect(() => buildLegacyMasterBatchReviewManifest(includes1762)).toThrow('REJECT_MUNICIPALITY_BINDING');
  });
});
