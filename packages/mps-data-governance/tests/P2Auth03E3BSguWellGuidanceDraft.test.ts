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
const DRAFT_PATH = join(REPO_ROOT, 'source-registry', 'drafts', 'sgu-well-drilling-guidance-unsigned.json');
const ENDPOINT =
  'https://www.sgu.se/grundvatten/brunnar-och-dricksvatten/anlaggning-av-brunn/vagledning-for-att-borra-brunn/';

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

describe('P2-AUTH-03E3-B - unsigned SGU well-drilling guidance source', () => {
  it('contains one exact SGU source with canonical artifact vocabulary', () => {
    const entry = loadDraft();

    expect(entry).toMatchObject({
      artifact_id: 'reg-sgu-well-drilling-guidance-001',
      artifact_type: 'SOURCE_REGISTRY_ENTRY',
      source_id: 'sgu-well-drilling-guidance',
      producer: {
        producer_id: 'SGU',
        name: 'Sveriges geologiska undersökning',
        type: 'agency',
      },
      adapter: 'SINGLE_ENDPOINT_V1',
      artifact_types: ['AGENCY_GUIDANCE'],
      lifecycle_state: 'REGISTERED',
    });
  });

  it('binds only the verified exact endpoint and its distribution host', () => {
    const entry = loadDraft();

    expect(entry.channel).toEqual({
      channel_type: 'WEBSITE',
      endpoint_url: ENDPOINT,
      allowed_domains: ['www.sgu.se'],
    });
    expect(entry.channel.endpoint_url).not.toBe('https://www.sgu.se/anvandarstod-for-geologiska-fragor/');
  });

  it('matches the exact legacy reference without inheriting the broad crawler scope', () => {
    const legacy = readFileSync(join(REPO_ROOT, 'scripts', 'fetch_sgu_anvandarstod_knowledge.ts'), 'utf8');

    expect(legacy).toContain("const BASE_URL = 'https://www.sgu.se'");
    expect(legacy).toContain(
      '/grundvatten/brunnar-och-dricksvatten/anlaggning-av-brunn/vagledning-for-att-borra-brunn/',
    );
    expect(legacy).toContain("SGU_ANVANDARSTOD_LEGACY_CLASSIFICATION = 'LEGACY_NON_AUTHORITATIVE'");
  });

  it('carries the owner-frozen Mimer operational policy exactly', () => {
    const entry = loadDraft();

    expect(entry.collection_frequency).toBe('WEEKLY');
    expect(entry.change_detection).toEqual({ strategy: 'CONTENT_HASH' });
    expect(entry.policy).toEqual({
      rate_limit_requests_per_second: 1,
      concurrency_limit: 1,
      politeness_delay_ms: 1000,
      max_object_size_bytes: 20_971_520,
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

  it('resolves through SINGLE_ENDPOINT_V1 to exactly the approved object', async () => {
    const entry = loadDraft();
    const plan = await new SingleEndpointTargetResolver().resolve(
      asVerifiedSource(entry),
      'p2-auth-03e3b-proof',
    );

    expect(plan.kind).toBe('TARGETS');
    if (plan.kind !== 'TARGETS') throw new Error('single endpoint unexpectedly resolved no targets');
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0]?.url).toBe(ENDPOINT);
  });

  it('installs the approved source without altering the existing SGU source', () => {
    const production = JSON.parse(
      readFileSync(join(REPO_ROOT, 'source-registry', 'national-registry.json'), 'utf8'),
    ) as SourceRegistryArtifact[];
    const installed = production.find((entry) => entry.source_id === loadDraft().source_id);
    const existing = production.find(
      (entry) => entry.source_id === 'sgu-groundwater-influence-analytical-models',
    );

    expect(production).toHaveLength(12);
    expect(production).not.toContainEqual(loadDraft());
    expect(installed).toMatchObject({
      artifact_id: 'reg-sgu-well-drilling-guidance-001',
      lifecycle_state: 'APPROVED',
      approval_attestation: {
        subjectDigest: 'sha256:b6472a38d46916fa03fa205c0e88684cf04ba561ad9c20ac22847aeb814fe17d',
        signer: 'ed25519:source-registry-governor-2026-08-14',
      },
    });
    expect(existing).toMatchObject({
      lifecycle_state: 'APPROVED',
      adapter: 'SINGLE_ENDPOINT_V1',
      channel: {
        endpoint_url:
          'https://www.sgu.se/anvandarstod-for-geologiska-fragor/bedomning-av-influensomrade-avseende-grundvatten/berakningsmodeller/analytiska-modeller/',
      },
    });
    expect(production).toContainEqual(
      expect.objectContaining({
        artifact_id: 'reg-boverket-planbestammelser-001',
        source_id: 'boverket-planbestammelser',
        lifecycle_state: 'APPROVED',
      }),
    );
  });
});
