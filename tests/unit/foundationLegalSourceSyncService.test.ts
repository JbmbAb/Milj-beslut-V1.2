import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/repositories/legalSourceRepository', () => ({
  upsertLegalSourceWithMatrix: vi.fn(),
}));

import { upsertLegalSourceWithMatrix } from '../../server/repositories/legalSourceRepository';
import {
  FOUNDATION_METADATA_PROJECTIONS,
  syncFoundationLegalSources,
} from '../../server/modules/legal/services/foundationLegalSourceSyncService';
import type {
  VerifiedSourceDefinition,
  VerifiedSourceRegistry,
} from '../../packages/mps-data-governance/src/SourceRegistry';

function registry(): VerifiedSourceRegistry {
  const sources = FOUNDATION_METADATA_PROJECTIONS.map<VerifiedSourceDefinition>((projection) => ({
    sourceId: projection.sourceId,
    authority: { name: 'Regeringskansliet', type: 'other' },
    endpointUrl: `https://rkrattsbaser.gov.se/sfst?bet=${projection.externalId.slice(4)}`,
    adapter: 'SINGLE_ENDPOINT_V1',
    frequency: 'daily',
    allowedDomains: ['rkrattsbaser.gov.se'],
    artifactTypes: [projection.artifactType],
    policy: {
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      politeness_delay_ms: 1000,
      max_object_size_bytes: 10_485_760,
      retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
    },
    registryArtifactId: projection.registryArtifactId,
    sourceContentHash: projection.sourceContentHash,
  }));
  return {
    registryPath: 'fixture:verified-foundation-registry',
    sources,
    getSource: (sourceId) => sources.find((source) => source.sourceId === sourceId) ?? null,
    isUrlAllowedForSource: () => true,
  };
}

describe('foundationLegalSourceSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs every curated foundation legal source into LegalSourceRecord', async () => {
    vi.mocked(upsertLegalSourceWithMatrix).mockImplementation(async (input: any) => ({
      record: {
        id: `legal-${input.externalId}`,
        title: input.title,
      },
      matrixRow: null,
    }));

    const result = await syncFoundationLegalSources(registry());

    expect(result.processed).toBe(FOUNDATION_METADATA_PROJECTIONS.length);
    expect(result.records).toHaveLength(FOUNDATION_METADATA_PROJECTIONS.length);
    expect(upsertLegalSourceWithMatrix).toHaveBeenCalledTimes(FOUNDATION_METADATA_PROJECTIONS.length);
    expect(vi.mocked(upsertLegalSourceWithMatrix).mock.calls[0]?.[0]).toMatchObject({
      sourceSystem: 'SFS',
      externalId: 'SFS:1998:808',
      sourceType: 'FOUNDATION_LAW',
      legalArea: 'Miljö',
      sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=1998:808',
      authorityName: 'Regeringskansliet',
    });
  });
});
