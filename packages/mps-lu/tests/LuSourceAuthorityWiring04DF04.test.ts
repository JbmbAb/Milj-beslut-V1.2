import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ArtifactReference } from '../../mps-compliance/src/artifacts/ArtifactReference.js';
import { runCanonicalLuProductAssessment } from '../src/execution/LuExecutionKernelClient.js';
import { createLuRegistryRuntime } from '../src/registry/createLuRegistryRuntime.js';
import { LU_SITE_ASSESSMENT_CAPABILITY_KEY } from '../src/registry/LuSiteAssessmentRegistry.js';
import type { ExecutionIdentitySubjectV3 } from '../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js';
import { InMemoryArtifactRepository } from '../../mps-runtime/src/repository/InMemoryArtifactRepository.js';
import type { ContentHash } from '../../mps-compliance/src/artifacts/ContentHash.js';
import {
  createGovernedLocalizationAssessment,
  GovernedAssessmentPersistence,
} from '../src/governance/GovernedAssessmentPersistence.js';
import {
  verifyLuSourceAuthorityForAssessment,
  type VerifiedLuSourceAuthority,
} from '../src/governance/LuSourceAuthorityWiring.js';
import type { LuSourceAuthorityEvidenceArtifact } from '../src/governance/LuSourceAuthorityEvidence.js';
import { provisionLuSourceAuthorityFixture } from './fixtures/provisionLuSourceAuthority.js';

class RecordingRepository extends InMemoryArtifactRepository {
  readonly writes: Array<{ artifact_id: string; content_hash: ContentHash; body: unknown }> = [];

  override async put(artifact: {
    artifact_id: string;
    content_hash: ContentHash;
    body: unknown;
  }): Promise<void> {
    this.writes.push(artifact);
    await super.put(artifact);
  }
}

const ENV = [
  'MPS_LU_BOOTSTRAP_ADMIT',
  'LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID',
  'LU_EXECUTION_AUTHORITY_ROOT_PUBLIC_KEY_PEM',
  'LU_EXECUTION_AUTHORITY_ROOT_KEY_ID',
] as const;
const originals = new Map<string, string | undefined>();
const authorityFixtures: Array<{ restore(): void }> = [];

function ref(artifact: { readonly artifact_id: string; readonly artifact_type: string }): ArtifactReference {
  return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type };
}

async function fixture(siteId: string, seed: string) {
  const repository = new RecordingRepository();
  delete process.env.MPS_LU_BOOTSTRAP_ADMIT;

  const registry = createLuRegistryRuntime();
  const capability = registry.resolveCapabilityByKey(LU_SITE_ASSESSMENT_CAPABILITY_KEY)!;
  const subject: ExecutionIdentitySubjectV3 = {
    site_id: siteId,
    project_context_binding_ref: {
      artifact_id: 'binding-' + siteId,
      artifact_type: 'project_context_binding',
    },
    product_release_ref: {
      artifact_id: 'release-' + siteId,
      artifact_type: 'product_release_manifest',
    },
    execution_contract_version: 'lu-execution-identity-v1',
    localization_geometry_ref: {
      artifact_id: 'geometry-' + siteId,
      artifact_type: 'localization_geometry',
    },
  };

  const authorityFixture = await provisionLuSourceAuthorityFixture({
    repository,
    subject,
    deterministic_seed: seed,
    capability_ref: ref(capability),
    release_snapshot_id: registry.getReleaseSnapshot().snapshot_id,
    governed_references: [
      subject.project_context_binding_ref,
      subject.product_release_ref,
      subject.localization_geometry_ref,
    ],
    label: 'f04-' + siteId,
  });
  authorityFixtures.push(authorityFixture);

  return {
    repository,
    registry,
    capability,
    subject,
    seed,
    identity: authorityFixture.identity,
  };
}

async function mintAuthority(f: Awaited<ReturnType<typeof fixture>>): Promise<VerifiedLuSourceAuthority> {
  return verifyLuSourceAuthorityForAssessment({
    repository: f.repository,
    execution_identity: f.identity,
    expected_subject_v3: f.subject,
    expected_capability_ref: ref(f.capability),
    release_snapshot_id: f.registry.getReleaseSnapshot().snapshot_id,
    deterministic_seed: f.seed,
  });
}

async function run(f: Awaited<ReturnType<typeof fixture>>) {
  return runCanonicalLuProductAssessment({
    site_id: f.subject.site_id,
    deterministic_seed: f.seed,
    evidence: [],
    artifact_repository: f.repository,
    registry: f.registry,
    identity_subject_v3: {
      project_context_binding_ref: f.subject.project_context_binding_ref,
      product_release_ref: f.subject.product_release_ref,
      execution_contract_version: f.subject.execution_contract_version,
      localization_geometry_ref: f.subject.localization_geometry_ref,
    },
    assessment_draft: {
      site_id: f.subject.site_id,
      project_context_ref: {
        artifact_id: `project-${f.subject.site_id}`,
        artifact_type: 'LU_PROJECT_CONTEXT',
      },
      property_ref: {
        artifact_id: f.subject.site_id,
        artifact_type: 'LU_PROPERTY_CONTEXT',
      },
      evidence_refs: [],
      system_summary: '04D-R1 F04 cold-audit proof',
      localization_geometry_ref: f.subject.localization_geometry_ref,
    },
  });
}

describe('04D-R1-F04 cold audit — evidence integrity and execution replay binding', () => {
  beforeEach(() => {
    authorityFixtures.length = 0;
    for (const name of ENV) originals.set(name, process.env[name]);
  });

  afterEach(() => {
    for (const fixture of [...authorityFixtures].reverse()) fixture.restore();
    authorityFixtures.length = 0;
    for (const name of ENV) {
      const value = originals.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('F04-A rejects a legitimate verified decision paired with a mutated evidence body and stale hash', async () => {
    const f = await fixture('property-f04-a', 'seed-f04-a');
    const result = await run(f);
    const authority = await mintAuthority(f);
    const outcome = await f.repository.resolve<any>({
      artifact_id: result.outcome_id!,
      artifact_type: 'execution_outcome',
    });
    const mutatedEvidence: LuSourceAuthorityEvidenceArtifact = {
      ...authority.evidence,
      trust_domain_hash: {
        ...authority.evidence.trust_domain_hash,
        value: 'f'.repeat(64),
      },
    };
    const writesBefore = f.repository.writes.length;

    await expect(
      new GovernedAssessmentPersistence(f.repository, () => true, { requireAuthorityEvidence: true }).persist(
        {
          artifact: result.assessment!,
          outcome,
          attestation: result.attestation!,
          authority: {
            ...authority,
            evidence: mutatedEvidence,
          },
        },
      ),
    ).rejects.toThrow('authority_evidence_body_hash');

    expect(f.repository.writes.length).toBe(writesBefore);
  });

  it('F04-B rejects replay of legitimate authority A onto an assessment/outcome produced by execution B', async () => {
    const a = await fixture('property-f04-replay-a', 'seed-f04-replay-a');
    const authorityA = await mintAuthority(a);

    const b = await fixture('property-f04-replay-b', 'seed-f04-replay-b');
    const resultB = await run(b);
    const outcomeB = await b.repository.resolve<any>({
      artifact_id: resultB.outcome_id!,
      artifact_type: 'execution_outcome',
    });
    const replayAssessment = createGovernedLocalizationAssessment({
      draft: {
        site_id: b.subject.site_id,
        project_context_ref: {
          artifact_id: `project-${b.subject.site_id}`,
          artifact_type: 'LU_PROJECT_CONTEXT',
        },
        property_ref: {
          artifact_id: b.subject.site_id,
          artifact_type: 'LU_PROPERTY_CONTEXT',
        },
        evidence_refs: [],
        system_summary: '04D-R1 F04 cross-execution replay probe',
        localization_geometry_ref: b.subject.localization_geometry_ref,
      },
      findings: resultB.findings,
      outcome: outcomeB,
      attestation: resultB.attestation!,
      authority_evidence: authorityA.evidence,
    });
    const writesBefore = b.repository.writes.length;

    await expect(
      new GovernedAssessmentPersistence(b.repository, () => true, { requireAuthorityEvidence: true }).persist(
        {
          artifact: replayAssessment,
          outcome: outcomeB,
          attestation: resultB.attestation!,
          authority: authorityA,
        },
      ),
    ).rejects.toThrow('authority_attempt_binding');

    expect(b.repository.writes.length).toBe(writesBefore);
  });
});
