import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function verifiedSources(): VerifiedSourceDefinition[] {
  return FOUNDATION_METADATA_PROJECTIONS.map((projection) => ({
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
}

function registry(sources = verifiedSources()): VerifiedSourceRegistry {
  return {
    registryPath: 'fixture:verified-foundation-registry',
    sources,
    getSource: (sourceId) => sources.find((source) => source.sourceId === sourceId) ?? null,
    isUrlAllowedForSource: (sourceId, url) => {
      const source = sources.find((candidate) => candidate.sourceId === sourceId);
      return Boolean(source?.endpointUrl === url);
    },
  };
}

describe('P2-AUTH-03D2 - foundation metadata sync convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(upsertLegalSourceWithMatrix).mockImplementation(async (input) => ({
      record: { id: `legal-${input.externalId}`, title: input.title } as never,
      matrixRow: null,
    }));
  });

  it('projects all foundation metadata from verified sources and binds registry identity', async () => {
    const result = await syncFoundationLegalSources(registry());

    expect(result.processed).toBe(5);
    expect(upsertLegalSourceWithMatrix).toHaveBeenCalledTimes(5);
    for (const [index, projection] of FOUNDATION_METADATA_PROJECTIONS.entries()) {
      expect(vi.mocked(upsertLegalSourceWithMatrix).mock.calls[index]?.[0]).toMatchObject({
        sourceUrl: expect.stringContaining('rkrattsbaser.gov.se'),
        authorityName: 'Regeringskansliet',
        payload: {
          projection: 'FOUNDATION_METADATA_V1',
          source_id: projection.sourceId,
          registry_artifact_id: projection.registryArtifactId,
          source_content_hash: projection.sourceContentHash,
          artifact_type: projection.artifactType,
          corpus_admitted: false,
        },
      });
    }
  });

  it('fails closed with zero writes when any required source-id is missing', async () => {
    const sources = verifiedSources().slice(0, -1);

    await expect(syncFoundationLegalSources(registry(sources))).rejects.toThrow(
      /FOUNDATION_SOURCE_REJECTED.*regeringskansliet-sfs-2011-338.*missing/,
    );
    expect(upsertLegalSourceWithMatrix).not.toHaveBeenCalled();
  });

  it('fails closed with zero writes on the wrong artifact type', async () => {
    const sources = verifiedSources();
    sources[0] = { ...sources[0], artifactTypes: ['ORDINANCE'] };

    await expect(syncFoundationLegalSources(registry(sources))).rejects.toThrow(/artifact_type/);
    expect(upsertLegalSourceWithMatrix).not.toHaveBeenCalled();
  });

  it('fails closed when a changed producer produces a different approved-source identity', async () => {
    const sources = verifiedSources();
    sources[0] = {
      ...sources[0],
      authority: { name: 'Self-declared authority', type: 'other' },
      sourceContentHash: 'f'.repeat(64),
    };

    await expect(syncFoundationLegalSources(registry(sources))).rejects.toThrow(/source_content_hash/);
    expect(upsertLegalSourceWithMatrix).not.toHaveBeenCalled();
  });

  it('fails closed when the registry artifact binding is substituted', async () => {
    const sources = verifiedSources();
    sources[0] = { ...sources[0], registryArtifactId: 'reg-attacker-substitute' };

    await expect(syncFoundationLegalSources(registry(sources))).rejects.toThrow(/registry_artifact_id/);
    expect(upsertLegalSourceWithMatrix).not.toHaveBeenCalled();
  });

  it('contains no signing, download or permanent corpus-admission capability', () => {
    const source = readFileSync(
      resolve('server/modules/legal/services/foundationLegalSourceSyncService.ts'),
      'utf8',
    );

    expect(source).toContain('loadVerifiedSourceRegistry');
    expect(source).not.toMatch(/getSourceRegistrySigningKey|approveSourceRegistryEntry|\.sign\(/);
    expect(source).not.toMatch(/\bfetch\s*\(|DownloadTargetResolver|legacy.*download/i);
    expect(source).not.toMatch(/LegalCorpusRecord|JudgmentRecord|CorpusImportGate|importBatch/);
  });

  it('does not import the legacy foundation authority catalogue', () => {
    const source = readFileSync(
      resolve('server/modules/legal/services/foundationLegalSourceSyncService.ts'),
      'utf8',
    );

    expect(source).not.toContain('catalogs/foundationLegalSources');
    expect(source).not.toContain('FOUNDATION_LEGAL_SOURCES');
  });
});
