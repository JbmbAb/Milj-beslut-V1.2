import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { verifySourceRegistryArtifact, type SourceRegistryArtifact } from '../src/SourceRegistry';

const REPO_ROOT = resolve(__dirname, '../../..');
const DRAFT_DIRECTORY = join(REPO_ROOT, 'source-registry', 'drafts');

const EXPECTED = [
  [
    'sfs-1998-808-unsigned.json',
    'regeringskansliet-sfs-1998-808',
    'Regeringskansliet',
    'LAW',
    'DAILY',
    10_485_760,
  ],
  [
    'sfs-2013-251-unsigned.json',
    'regeringskansliet-sfs-2013-251',
    'Regeringskansliet',
    'ORDINANCE',
    'DAILY',
    10_485_760,
  ],
  [
    'sfs-2020-614-unsigned.json',
    'regeringskansliet-sfs-2020-614',
    'Regeringskansliet',
    'ORDINANCE',
    'DAILY',
    10_485_760,
  ],
  [
    'sfs-2010-900-unsigned.json',
    'regeringskansliet-sfs-2010-900',
    'Regeringskansliet',
    'LAW',
    'DAILY',
    10_485_760,
  ],
  [
    'sfs-2011-338-unsigned.json',
    'regeringskansliet-sfs-2011-338',
    'Regeringskansliet',
    'ORDINANCE',
    'DAILY',
    10_485_760,
  ],
  [
    'sfs-1998-899-unsigned.json',
    'regeringskansliet-sfs-1998-899',
    'Regeringskansliet',
    'ORDINANCE',
    'DAILY',
    10_485_760,
  ],
  [
    'hvmfs-2016-17-unsigned.json',
    'hav-hvmfs-2016-17',
    'Havs- och vattenmyndigheten',
    'AGENCY_GENERAL_ADVICE',
    'DAILY',
    20_971_520,
  ],
  [
    'sgu-groundwater-models-unsigned.json',
    'sgu-groundwater-influence-analytical-models',
    'Sveriges geologiska undersökning',
    'AGENCY_GUIDANCE',
    'WEEKLY',
    52_428_800,
  ],
] as const;

function loadDraft(fileName: string): SourceRegistryArtifact {
  const parsed = JSON.parse(
    readFileSync(join(DRAFT_DIRECTORY, fileName), 'utf8'),
  ) as SourceRegistryArtifact[];
  expect(parsed, `${fileName} must contain exactly one independently approvable entry`).toHaveLength(1);
  return parsed[0];
}

describe('P2-AUTH-03D1 - unsigned single-object legal source drafts', () => {
  it('contains exactly the eight owner-frozen source dispositions', () => {
    const entries = EXPECTED.map(([fileName]) => loadDraft(fileName));

    expect(new Set(entries.map((entry) => entry.source_id)).size).toBe(8);
    expect(new Set(entries.map((entry) => entry.artifact_id)).size).toBe(8);
    expect(entries.every((entry) => entry.adapter === 'SINGLE_ENDPOINT_V1')).toBe(true);
  });

  it.each(EXPECTED)(
    '%s binds the frozen producer, artifact vocabulary and policy',
    (fileName, sourceId, producerName, artifactType, frequency, maxBytes) => {
      const entry = loadDraft(fileName);

      expect(entry.source_id).toBe(sourceId);
      expect(entry.producer).toMatchObject({ name: producerName, type: 'agency' });
      expect(entry.artifact_types).toEqual([artifactType]);
      expect(entry.collection_frequency).toBe(frequency);
      expect(entry.change_detection.strategy).toBe('CONTENT_HASH');
      expect(entry.policy).toEqual({
        rate_limit_requests_per_second: 1,
        concurrency_limit: 1,
        politeness_delay_ms: 1000,
        max_object_size_bytes: maxBytes,
        retry_policy: { max_attempts: 3, backoff: 'EXPONENTIAL' },
      });
    },
  );

  it('binds every endpoint to its exact distribution host', () => {
    for (const [fileName] of EXPECTED) {
      const entry = loadDraft(fileName);
      const endpointHost = new URL(entry.channel.endpoint_url!).hostname;

      expect(entry.channel.channel_type).toBe('WEBSITE');
      expect(entry.channel.allowed_domains).toEqual([endpointHost]);
    }
  });

  it('uses the canonical artifact vocabulary without legacy approximation', () => {
    const artifactTypes = new Set(EXPECTED.flatMap(([fileName]) => loadDraft(fileName).artifact_types));

    expect(artifactTypes).toEqual(new Set(['LAW', 'ORDINANCE', 'AGENCY_GENERAL_ADVICE', 'AGENCY_GUIDANCE']));
    expect(artifactTypes).not.toContain('FOUNDATION_LAW');
    expect(artifactTypes).not.toContain('GUIDANCE');
    expect(artifactTypes).not.toContain('AGENCY_REGULATION');
  });

  it('is rejected by the production verifier for exactly the missing authority', async () => {
    const verificationMustNotBeReached = {
      keyId: 'unreachable-without-attestation',
      async verify(): Promise<boolean> {
        throw new Error('verification provider must not be reached for an unsigned draft');
      },
    };

    for (const [fileName] of EXPECTED) {
      const entry = loadDraft(fileName);
      await expect(
        verifySourceRegistryArtifact(entry, verificationMustNotBeReached),
        `${fileName} must fail only because GOVERNOR authority is absent`,
      ).rejects.toThrow(
        `Invalid SourceRegistryArtifact '${entry.source_id}': approval_attestation is required.`,
      );
    }
  });

  it('does not install any unsigned draft as production authority', () => {
    const production = JSON.parse(
      readFileSync(join(REPO_ROOT, 'source-registry', 'national-registry.json'), 'utf8'),
    ) as SourceRegistryArtifact[];
    const draftIds = new Set(EXPECTED.map(([fileName]) => loadDraft(fileName).source_id));

    for (const entry of production) {
      if (draftIds.has(entry.source_id)) {
        expect(entry.lifecycle_state).toBe('APPROVED');
        expect(entry.approval_attestation).toBeDefined();
      }
    }
    for (const [fileName] of EXPECTED) {
      expect(production).not.toContainEqual(loadDraft(fileName));
    }
  });
});
