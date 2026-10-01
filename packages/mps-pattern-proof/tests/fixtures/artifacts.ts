/**
 * Shared fixture builders (plan section 1, tests/fixtures). Every builder returns a FRESH plain
 * object that passes its validator AND its JSON-schema-subset schema. Tests derive broken variants
 * by spreading (`{ ...validGraph(), edges: [...] }`); nothing here is frozen so tests can also
 * mutate a copy in place.
 *
 * The shas are synthetic (deterministic hex, not real git objects); tests that need resolvable
 * git objects use RepositoryAuthorityResolver's `gitObjectExists` hook.
 */
import type {
  CandidateArtifact,
  DecisionGateArtifact,
  DependencyGraphArtifact,
  DiscoveryArtifact,
  InputManifest,
  PatternVerificationArtifact,
  ProofPackage,
  RedPlanArtifact,
} from '../../src/artifacts';

export const FIXTURE_BASE_SHA = 'e617c7b7bb4613b95c6934004201eb14bec89ba0';
export const FIXTURE_CANDIDATE_SHA = '0123456789abcdef0123456789abcdef01234567';
export const FIXTURE_TREE_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
export const FIXTURE_LOCK_HASH = `sha256:${'a1'.repeat(32)}`;
export const FIXTURE_VERIFIER_KEY_ID = 'ed25519:ppe-verifier-fixture';

export function validDiscovery(): DiscoveryArtifact {
  return {
    findings: [
      {
        category: 'build-ordering-defect',
        description:
          'production-base runs npm ci while only package*.json is present; the postinstall hook needs scripts/.',
        evidence: [
          { kind: 'file_line', ref: 'Dockerfile:32-37' },
          { kind: 'file_line', ref: 'package.json:44' },
          { kind: 'runtime_result', ref: 'local npm-ci reproduction, 2026-09-30, exit 1, MODULE_NOT_FOUND' },
        ],
      },
      {
        category: 'governed-build-contract',
        description: 'docker-compose.staging.yml declares Dockerfile:web as the staging build contract.',
        evidence: [{ kind: 'file_line', ref: 'docker-compose.staging.yml:6-8', note: 'target: web' }],
      },
    ],
  };
}

export function validGraph(): DependencyGraphArtifact {
  return {
    nodes: [
      {
        id: 'dockerfile:production-base',
        kind: 'docker-stage',
        evidence: [{ kind: 'file_line', ref: 'Dockerfile:32' }],
      },
      { id: 'npm:ci', kind: 'npm-lifecycle', evidence: [{ kind: 'file_line', ref: 'Dockerfile:37' }] },
      {
        id: 'npm:postinstall-hook',
        kind: 'npm-script',
        evidence: [{ kind: 'file_line', ref: 'package.json:44' }],
      },
      {
        id: 'fs:scripts/postinstall-prisma-generate.mjs',
        kind: 'fs-path',
        evidence: [{ kind: 'file_line', ref: 'scripts/postinstall-prisma-generate.mjs:1' }],
      },
    ],
    edges: [
      {
        from: 'dockerfile:production-base',
        to: 'npm:ci',
        relationType: 'invokes',
        evidence: [{ kind: 'file_line', ref: 'Dockerfile:37' }],
      },
      {
        from: 'npm:ci',
        to: 'npm:postinstall-hook',
        relationType: 'invokes',
        evidence: [{ kind: 'file_line', ref: 'package.json:44' }],
      },
      {
        from: 'npm:postinstall-hook',
        to: 'fs:scripts/postinstall-prisma-generate.mjs',
        relationType: 'requires-present',
        evidence: [
          { kind: 'runtime_result', ref: 'local npm-ci reproduction, 2026-09-30: MODULE_NOT_FOUND' },
        ],
      },
    ],
  };
}

export function validGate(): DecisionGateArtifact {
  return {
    items: [
      {
        item: 'Does a fix require inventing a new approach, or does one already exist in this repo?',
        classification: 'MECHANICAL',
        derivation:
          'Dockerfile.gcp already solves this class of problem (--ignore-scripts + explicit prisma generate).',
      },
      {
        item: 'Who selects the concrete implementation mechanism?',
        classification: 'MECHANICAL',
        derivation: 'Writer-lane discretion inside the frozen RED contract and allowed paths.',
      },
    ],
  };
}

export function validRedPlan(): RedPlanArtifact {
  return {
    probes: [
      {
        id: 'red-production-base-npm-ci-postinstall',
        assertedBehavior:
          'The production-base stage must execute its declared npm install step without failing on absent lifecycle-script dependencies.',
        authorityEvidence: {
          kind: 'file_line',
          ref: 'docker-compose.staging.yml:6-8',
          note: 'declared staging build',
        },
        command: 'derive the production-base stage prefix and run an isolated npm-install probe',
      },
      {
        id: 'red-builder-npm-ci-postinstall',
        assertedBehavior:
          'The builder stage must execute its declared npm install step without failing on absent lifecycle-script dependencies.',
        authorityEvidence: { kind: 'file_line', ref: 'docker-compose.staging.yml:6-8' },
        command: 'derive the builder stage prefix and run an isolated npm-install probe',
      },
    ],
  };
}

export function validCandidate(): CandidateArtifact {
  return {
    candidateSha: FIXTURE_CANDIDATE_SHA,
    baseSha: FIXTURE_BASE_SHA,
    // BOOTSTRAP section 2: diffRef resolves to the exact baseSha..candidateSha diff (R1 F4)
    diffRef: {
      kind: 'git_object',
      ref: `${FIXTURE_BASE_SHA}..${FIXTURE_CANDIDATE_SHA}`,
      note: 'baseSha..candidateSha',
    },
    allowedPathsCompliance: {
      result: 'PASS',
      allowedPaths: ['Dockerfile'],
      evidence: [{ kind: 'file_line', ref: 'Dockerfile:37', note: 'only changed path' }],
    },
  };
}

export function validVerification(): PatternVerificationArtifact {
  return {
    claims: [
      {
        claim: 'the production-base install step no longer fails on absent lifecycle scripts',
        evidenceGrounds: ['VERIFIER_OWNED_PROBE'],
        materialInvariant: true,
      },
      {
        claim: 'the diff touches exactly one file',
        evidenceGrounds: ['INDEPENDENT_CODE_DERIVATION', 'WRITER_TEST_REGRESSION'],
        materialInvariant: false,
      },
    ],
    verdict: 'ACCEPT',
    isolationEvidence: [
      { kind: 'signed_attestation', ref: `sha256:${'b2'.repeat(32)}`, note: 'verifier-input-bundle' },
      { kind: 'runtime_result', ref: `verifier-context:sha256:${'c3'.repeat(32)}` },
    ],
  };
}

export function validManifest(): InputManifest {
  return {
    baseSha: FIXTURE_BASE_SHA,
    // R2 F6: the run binds the manifest to the exact baseSha..candidateSha range, never a bare sha
    candidateShaOrDiff: `${FIXTURE_BASE_SHA}..${FIXTURE_CANDIDATE_SHA}`,
    dependencyLockHash: FIXTURE_LOCK_HASH,
    fixtureContentHashes: {
      Dockerfile: `sha256:${'d4'.repeat(32)}`,
      'docker-compose.staging.yml': `sha256:${'e5'.repeat(32)}`,
    },
    toolchainIdentity: 'node v22.22.2; npm 10.9.7; linux x64',
    environmentConfig: {
      NODE_ENV: 'test',
      DOCKER_HOST: 'unix:///run/ppe/docker.sock',
      VERIFIER_KEY_FINGERPRINT: `sha256:${'f6'.repeat(32)}`,
    },
    secretBackedAuthority: [{ keyId: FIXTURE_VERIFIER_KEY_ID, providerRef: 'local-pem:verify-only' }],
  };
}

export function validProofPackage(): ProofPackage {
  return {
    candidateSha: FIXTURE_CANDIDATE_SHA,
    baseSha: FIXTURE_BASE_SHA,
    tree: FIXTURE_TREE_SHA,
    probeIdentities: ['red-production-base-npm-ci-postinstall', 'red-builder-npm-ci-postinstall'],
    verifierAuthority: FIXTURE_VERIFIER_KEY_ID,
    provenInvariants: ['declared staging web build install step does not fail on absent lifecycle scripts'],
    inputManifest: validManifest(),
  };
}

export type FixtureBuilders = {
  readonly discovery: () => DiscoveryArtifact;
  readonly 'dependency-graph': () => DependencyGraphArtifact;
  readonly 'decision-gate': () => DecisionGateArtifact;
  readonly 'red-plan': () => RedPlanArtifact;
  readonly candidate: () => CandidateArtifact;
  readonly 'pattern-verification': () => PatternVerificationArtifact;
  readonly 'input-manifest': () => InputManifest;
  readonly 'proof-package': () => ProofPackage;
};

/** One builder per PatternProofArtifactKind, for table-driven tests. */
export const FIXTURE_BUILDERS: FixtureBuilders = {
  discovery: validDiscovery,
  'dependency-graph': validGraph,
  'decision-gate': validGate,
  'red-plan': validRedPlan,
  candidate: validCandidate,
  'pattern-verification': validVerification,
  'input-manifest': validManifest,
  'proof-package': validProofPackage,
};
