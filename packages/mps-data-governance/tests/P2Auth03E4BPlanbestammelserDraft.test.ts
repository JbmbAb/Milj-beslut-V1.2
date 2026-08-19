import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SingleEndpointTargetResolver } from '../src/DownloadTargetResolvers';
import {
  verifySourceRegistryArtifact,
  type SourceRegistryArtifact,
  type VerifiedSourceDefinition,
} from '../src/SourceRegistry';

const REPO_ROOT = resolve(__dirname, '../../..');
const DRAFT_PATH = join(
  REPO_ROOT,
  'source-registry',
  'drafts',
  'boverket-planbestammelser-unsigned.json',
);
const ENDPOINT = 'https://api.boverket.se/planbestammelser/v2/json';

function loadDraft(): SourceRegistryArtifact {
  const parsed = JSON.parse(readFileSync(DRAFT_PATH, 'utf8')) as SourceRegistryArtifact[];
  expect(parsed, 'the draft must contain exactly one independently approvable source').toHaveLength(1);
  return parsed[0];
}

function asVerifiedSource(entry: SourceRegistryArtifact): VerifiedSourceDefinition {
  return {
    sourceId: entry.source_id,
    authority: { name: entry.producer.name, type: 'other' },
    endpointUrl: entry.channel.endpoint_url,
    adapter: entry.adapter,
    frequency: 'weekly',
    allowedDomains: entry.channel.allowed_domains,
    artifactTypes: entry.artifact_types,
    policy: entry.policy,
    registryArtifactId: entry.artifact_id,
    sourceContentHash: 'draft-only-not-authority',
  };
}

describe('P2-AUTH-03E4-B - unsigned Boverket planning provisions source', () => {
  it('contains one exact Boverket reference-dataset source', () => {
    expect(loadDraft()).toMatchObject({
      artifact_id: 'reg-boverket-planbestammelser-001',
      artifact_type: 'SOURCE_REGISTRY_ENTRY',
      source_id: 'boverket-planbestammelser',
      producer: {
        producer_id: 'BOVERKET',
        name: 'Boverket',
        type: 'agency',
      },
      adapter: 'SINGLE_ENDPOINT_V1',
      artifact_types: ['REFERENCE_DATASET'],
      lifecycle_state: 'REGISTERED',
    });
  });

  it('uses REFERENCE_DATASET without claiming legal or guidance authority', () => {
    const types = loadDraft().artifact_types;

    expect(types).toEqual(['REFERENCE_DATASET']);
    expect(types).not.toContain('LAW');
    expect(types).not.toContain('ORDINANCE');
    expect(types).not.toContain('AGENCY_GUIDANCE');
  });

  it('binds only the exact Planbestammelsekatalogen API resource', () => {
    expect(loadDraft().channel).toEqual({
      channel_type: 'API',
      endpoint_url: ENDPOINT,
      allowed_domains: ['api.boverket.se'],
    });
  });

  it('carries the owner-frozen Mimer operational policy exactly', () => {
    const entry = loadDraft();

    expect(entry.collection_frequency).toBe('WEEKLY');
    expect(entry.change_detection).toEqual({ strategy: 'CONTENT_HASH' });
    expect(entry.policy).toEqual({
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      politeness_delay_ms: 1000,
      max_object_size_bytes: 52_428_800,
      retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
    });
  });

  it('is rejected by the production verifier for exactly the missing authority', async () => {
    const entry = loadDraft();
    const verificationMustNotBeReached = {
      keyId: 'unreachable-without-attestation',
      async verify(): Promise<boolean> {
        throw new Error('verification must not run for an unsigned draft');
      },
    };

    await expect(verifySourceRegistryArtifact(entry, verificationMustNotBeReached)).rejects.toThrow(
      `Invalid SourceRegistryArtifact '${entry.source_id}': approval_attestation is required.`,
    );
  });

  it('resolves through SINGLE_ENDPOINT_V1 to exactly the signed-scope candidate', async () => {
    const entry = loadDraft();
    const plan = await new SingleEndpointTargetResolver().resolve(
      asVerifiedSource(entry),
      'p2-auth-03e4b-proof',
    );

    expect(plan.kind).toBe('TARGETS');
    if (plan.kind !== 'TARGETS') throw new Error('single endpoint unexpectedly resolved no targets');
    expect(plan.targets).toEqual([{ url: ENDPOINT, file_name: 'json' }]);
  });

  it('installs only the approved exact source while preserving the converged authorities', () => {
    const production = JSON.parse(
      readFileSync(join(REPO_ROOT, 'source-registry', 'national-registry.json'), 'utf8'),
    ) as SourceRegistryArtifact[];
    const installed = production.filter(
      (entry) => entry.source_id === 'boverket-planbestammelser',
    );
    const puh = production.find(
      (entry) => entry.source_id === 'domstolsverket-puh-mmod',
    );
    const sguWellGuidance = production.find(
      (entry) => entry.source_id === 'sgu-well-drilling-guidance',
    );

    expect(production).toHaveLength(11);
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatchObject({
      artifact_id: 'reg-boverket-planbestammelser-001',
      lifecycle_state: 'APPROVED',
      adapter: 'SINGLE_ENDPOINT_V1',
      artifact_types: ['REFERENCE_DATASET'],
      approval_attestation: {
        subjectDigest: 'sha256:7aa3d35d0d780b926a6eba911b140101947029fc6ab7ae57887717f39cf08978',
        signer: 'ed25519:source-registry-governor-2026-08-14',
      },
    });
    expect(puh?.artifact_id).toBe('reg-dv-puh-mmod-003');
    expect(sguWellGuidance?.artifact_id).toBe('reg-sgu-well-drilling-guidance-001');
  });
});
