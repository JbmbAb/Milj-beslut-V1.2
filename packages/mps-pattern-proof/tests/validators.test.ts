import { describe, expect, it } from 'vitest';
import { isPatternProofError, PatternProofError, type PatternProofErrorCode } from '../src/errors';
import { digestOf, PATTERN_PROOF_ARTIFACT_KINDS } from '../src/identity';
import {
  allowedPathCoversProofPolicy,
  allowedPathEntryMatches,
  locatorPath,
  secretMaterialReason,
  validateArtifact,
  validateCandidateArtifact,
  validateDecisionGateArtifact,
  validateDependencyGraphArtifact,
  validateDiscoveryArtifact,
  validateInputManifest,
  validatePatternVerificationArtifact,
  validateProofPackage,
  validateRedPlanArtifact,
} from '../src/validators';
import {
  FIXTURE_BUILDERS,
  validCandidate,
  validDiscovery,
  validGate,
  validGraph,
  validManifest,
  validProofPackage,
  validRedPlan,
  validVerification,
} from './fixtures/artifacts';

function expectCode(fn: () => unknown, code: PatternProofErrorCode): PatternProofError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${code}`).toBeInstanceOf(PatternProofError);
  expect(
    isPatternProofError(caught, code),
    `expected ${code}, got ${(caught as PatternProofError).code}`,
  ).toBe(true);
  return caught as PatternProofError;
}

function assertDeepFrozen(value: unknown, path = 'root'): void {
  if (typeof value !== 'object' || value === null) return;
  expect(Object.isFrozen(value), `${path} must be frozen`).toBe(true);
  for (const key of Object.keys(value))
    assertDeepFrozen((value as Record<string, unknown>)[key], `${path}.${key}`);
}

describe('validators: every fixture validates to a deep-frozen structural copy', () => {
  for (const kind of PATTERN_PROOF_ARTIFACT_KINDS) {
    it(`${kind}: fixture passes, output is frozen, equal to input, digestable`, () => {
      const input = FIXTURE_BUILDERS[kind]();
      const output = validateArtifact(kind, input);
      expect(output).toEqual(input);
      expect(output).not.toBe(input);
      assertDeepFrozen(output);
      expect(digestOf(output)).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(digestOf(output)).toBe(digestOf(input));
    });

    it(`${kind}: unknown top-level key is rejected (closed field set)`, () => {
      expectCode(
        () => validateArtifact(kind, { ...FIXTURE_BUILDERS[kind](), writerTranscript: 'x' }),
        'PPE_UNKNOWN_FIELD',
      );
    });

    it(`${kind}: non-object input is rejected`, () => {
      expectCode(() => validateArtifact(kind, null), 'PPE_SCHEMA_INVALID');
      expectCode(() => validateArtifact(kind, []), 'PPE_SCHEMA_INVALID');
      expectCode(() => validateArtifact(kind, new Date()), 'PPE_SCHEMA_INVALID');
    });
  }

  it('validateArtifact rejects an unknown kind', () => {
    expectCode(() => validateArtifact('workflow' as never, {}), 'PPE_SCHEMA_INVALID');
  });
});

describe('DiscoveryArtifact', () => {
  it('requires at least one finding and non-empty evidence per finding', () => {
    expectCode(() => validateDiscoveryArtifact({ findings: [] }), 'PPE_SCHEMA_INVALID');
    const broken = validDiscovery();
    expectCode(
      () => validateDiscoveryArtifact({ findings: [{ ...broken.findings[0], evidence: [] }] }),
      'PPE_EVIDENCE_REQUIRED',
    );
  });

  it('rejects an unknown locator kind and an empty ref', () => {
    const base = validDiscovery().findings[0];
    expectCode(
      () => validateDiscoveryArtifact({ findings: [{ ...base, evidence: [{ kind: 'prose', ref: 'x' }] }] }),
      'PPE_EVIDENCE_KIND_INVALID',
    );
    expectCode(
      () =>
        validateDiscoveryArtifact({ findings: [{ ...base, evidence: [{ kind: 'file_line', ref: '  ' }] }] }),
      'PPE_SCHEMA_INVALID',
    );
  });

  it('drops an explicit undefined note instead of copying it (T2)', () => {
    const base = validDiscovery().findings[0];
    const out = validateDiscoveryArtifact({
      findings: [{ ...base, evidence: [{ kind: 'file_line', ref: 'Dockerfile:1', note: undefined }] }],
    });
    expect(Object.keys(out.findings[0].evidence[0])).toEqual(['kind', 'ref']);
    expect(() => digestOf(out)).not.toThrow();
  });
});

describe('DependencyGraphArtifact', () => {
  it('rejects an edge whose endpoint is not a declared node', () => {
    const graph = validGraph();
    const error = expectCode(
      () =>
        validateDependencyGraphArtifact({
          ...graph,
          edges: [{ ...graph.edges[0], to: 'fs:scripts/copy-cesium-assets.cjs' }],
        }),
      'PPE_GRAPH_DANGLING_EDGE',
    );
    expect(error.path).toBe('dependency-graph.edges[0].to');
  });

  it('rejects duplicate node ids', () => {
    const graph = validGraph();
    expectCode(
      () => validateDependencyGraphArtifact({ ...graph, nodes: [...graph.nodes, { ...graph.nodes[0] }] }),
      'PPE_GRAPH_DUPLICATE_NODE',
    );
  });

  it('rejects relation types outside the frozen enum', () => {
    const graph = validGraph();
    expectCode(
      () =>
        validateDependencyGraphArtifact({
          ...graph,
          edges: [{ ...graph.edges[0], relationType: 'depends-on' }],
        }),
      'PPE_SCHEMA_INVALID',
    );
  });

  it('accepts a graph with nodes but no edges', () => {
    expect(validateDependencyGraphArtifact({ ...validGraph(), edges: [] }).edges).toEqual([]);
  });
});

describe('DecisionGateArtifact (D9)', () => {
  it('MECHANICAL requires a non-empty derivation', () => {
    expectCode(
      () => validateDecisionGateArtifact({ items: [{ item: 'x', classification: 'MECHANICAL' }] }),
      'PPE_DECISION_ITEM_INCOMPLETE',
    );
    expectCode(
      () =>
        validateDecisionGateArtifact({
          items: [{ item: 'x', classification: 'MECHANICAL', derivation: '  ' }],
        }),
      'PPE_DECISION_ITEM_INCOMPLETE',
    );
  });

  it('non-MECHANICAL classifications require a non-empty blockingReason', () => {
    for (const classification of ['HUMAN_DECISION_REQUIRED', 'MISSING_AUTHORITY', 'SCOPE_VIOLATION']) {
      expectCode(
        () => validateDecisionGateArtifact({ items: [{ item: 'x', classification, derivation: 'd' }] }),
        'PPE_DECISION_ITEM_INCOMPLETE',
      );
      expect(
        validateDecisionGateArtifact({ items: [{ item: 'x', classification, blockingReason: 'owner call' }] })
          .items[0].blockingReason,
      ).toBe('owner call');
    }
  });

  it('presence of the other field is NOT rejected', () => {
    const out = validateDecisionGateArtifact({
      items: [
        { item: 'a', classification: 'MECHANICAL', derivation: 'd', blockingReason: 'informational' },
        {
          item: 'b',
          classification: 'HUMAN_DECISION_REQUIRED',
          blockingReason: 'owner',
          derivation: 'partial',
        },
      ],
    });
    expect(out.items[0].blockingReason).toBe('informational');
    expect(out.items[1].derivation).toBe('partial');
  });

  it('{ derivation: undefined } validates to an object WITHOUT the key and digests (T2)', () => {
    const out = validateDecisionGateArtifact({
      items: [
        {
          item: 'x',
          classification: 'HUMAN_DECISION_REQUIRED',
          blockingReason: 'owner',
          derivation: undefined,
        },
      ],
    });
    expect(Object.keys(out.items[0])).toEqual(['item', 'classification', 'blockingReason']);
    expect('derivation' in out.items[0]).toBe(false);
    expect(digestOf(out)).toMatch(/^sha256:/);
    expect(() => digestOf({ derivation: undefined })).toThrow(/PPE_DIGEST_INPUT_INVALID/);
  });

  it('rejects an unknown classification and an empty item list', () => {
    expectCode(() => validateDecisionGateArtifact({ items: [] }), 'PPE_SCHEMA_INVALID');
    expectCode(
      () =>
        validateDecisionGateArtifact({
          items: [{ item: 'x', classification: 'DEFERRED', blockingReason: 'r' }],
        }),
      'PPE_SCHEMA_INVALID',
    );
    expect(validateDecisionGateArtifact(validGate())).toEqual(validGate());
  });
});

describe('RedPlanArtifact', () => {
  it('requires authorityEvidence on every probe (frozen design section 8)', () => {
    const plan = validRedPlan();
    const { authorityEvidence: _dropped, ...probeWithoutAuthority } = plan.probes[0];
    expectCode(
      () => validateRedPlanArtifact({ probes: [probeWithoutAuthority] }),
      'PPE_PROBE_AUTHORITY_REQUIRED',
    );
    expectCode(
      () =>
        validateRedPlanArtifact({
          probes: [{ ...plan.probes[0], authorityEvidence: { kind: 'prose', ref: 'x' } }],
        }),
      'PPE_EVIDENCE_KIND_INVALID',
    );
  });

  it('rejects duplicate probe ids and an empty plan', () => {
    const plan = validRedPlan();
    expectCode(
      () =>
        validateRedPlanArtifact({ probes: [plan.probes[0], { ...plan.probes[1], id: plan.probes[0].id }] }),
      'PPE_PROBE_ID_DUPLICATE',
    );
    expectCode(() => validateRedPlanArtifact({ probes: [] }), 'PPE_SCHEMA_INVALID');
  });
});

describe('CandidateArtifact', () => {
  it('requires 40-hex lowercase shas', () => {
    expectCode(
      () => validateCandidateArtifact({ ...validCandidate(), candidateSha: 'HEAD' }),
      'PPE_CANDIDATE_SHA_INVALID',
    );
    expectCode(
      () =>
        validateCandidateArtifact({ ...validCandidate(), baseSha: validCandidate().baseSha.toUpperCase() }),
      'PPE_CANDIDATE_SHA_INVALID',
    );
  });

  it('PASS is inconsistent when evidence names a path outside allowedPaths (static check)', () => {
    const candidate = validCandidate();
    const error = expectCode(
      () =>
        validateCandidateArtifact({
          ...candidate,
          allowedPathsCompliance: {
            ...candidate.allowedPathsCompliance,
            evidence: [
              { kind: 'file_line', ref: 'Dockerfile:37' },
              { kind: 'file_line', ref: 'package.json:44' },
            ],
          },
        }),
      'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT',
    );
    expect(error.path).toBe('candidate.allowedPathsCompliance.evidence[1]');
  });

  it('FAIL may cite paths outside allowedPaths (that is what it reports)', () => {
    const candidate = validCandidate();
    const out = validateCandidateArtifact({
      ...candidate,
      allowedPathsCompliance: {
        result: 'FAIL',
        allowedPaths: ['Dockerfile'],
        evidence: [{ kind: 'file_line', ref: 'package.json:44' }],
      },
    });
    expect(out.allowedPathsCompliance.result).toBe('FAIL');
  });

  it('git_object refs of the form <sha>:<path> are subject to the static check; bare shas are not', () => {
    const candidate = validCandidate();
    const sha = candidate.candidateSha;
    expect(locatorPath({ kind: 'git_object', ref: sha })).toBeUndefined();
    expect(locatorPath({ kind: 'git_object', ref: `${sha}:package.json` })).toBe('package.json');
    expect(locatorPath({ kind: 'file_line', ref: 'Dockerfile.gcp:26,28,51,53' })).toBe('Dockerfile.gcp');
    expect(locatorPath({ kind: 'runtime_result', ref: 'run-1' })).toBeUndefined();
    expectCode(
      () =>
        validateCandidateArtifact({
          ...candidate,
          allowedPathsCompliance: {
            ...candidate.allowedPathsCompliance,
            evidence: [{ kind: 'git_object', ref: `${sha}:package.json` }],
          },
        }),
      'PPE_CANDIDATE_COMPLIANCE_INCONSISTENT',
    );
  });

  it('allow-list glob semantics', () => {
    expect(allowedPathEntryMatches('Dockerfile', 'Dockerfile')).toBe(true);
    expect(allowedPathEntryMatches('Dockerfile', 'Dockerfile.gcp')).toBe(false);
    expect(allowedPathEntryMatches('src', 'src/a/b.ts')).toBe(true);
    expect(allowedPathEntryMatches('src/*.ts', 'src/a/b.ts')).toBe(false);
    expect(allowedPathEntryMatches('src/**/*.ts', 'src/a/b.ts')).toBe(true);
    expect(allowedPathEntryMatches('src/**', 'src/a/b.ts')).toBe(true);
    expect(allowedPathEntryMatches('./Dockerfile', 'Dockerfile')).toBe(true);
    expect(allowedPathEntryMatches('Docker?ile', 'Dockerfile')).toBe(true);
  });

  it('PPE_ALLOWLIST_COVERS_PROOF_POLICY: allowedPaths may never reach proof-policy surfaces (D10)', () => {
    const offending = [
      'packages/mps-pattern-proof',
      'packages/mps-pattern-proof/src/validators.ts',
      'packages/**',
      'governance/devgov/units/x.json',
      'governance/**',
      'scripts/audit',
      'scripts/**/*.ts',
      'docs/architecture/PATTERN-PROOF-ENGINE-01-DESIGN-V1-FROZEN.md',
      'docs/architecture/*.md',
      'docs/**',
      '.claude',
      '.claude/settings.json',
      '**',
    ];
    for (const entry of offending) {
      expect(allowedPathCoversProofPolicy(entry), entry).toBe(true);
      const candidate = validCandidate();
      const error = expectCode(
        () =>
          validateCandidateArtifact({
            ...candidate,
            allowedPathsCompliance: {
              ...candidate.allowedPathsCompliance,
              allowedPaths: ['Dockerfile', entry],
            },
          }),
        'PPE_ALLOWLIST_COVERS_PROOF_POLICY',
      );
      expect(error.path).toBe('candidate.allowedPathsCompliance.allowedPaths[1]');
    }
    for (const entry of [
      'Dockerfile',
      'Dockerfile.gcp',
      'src/**',
      'docs/architecture/ADR-24-23.md',
      'scripts/db/*.ts',
      '.claudex',
      // a bare `*` admits top-level files only; every proof-policy surface is nested
      '*',
    ]) {
      expect(allowedPathCoversProofPolicy(entry), entry).toBe(false);
    }
  });

  it('requires non-empty compliance evidence and validates diffRef', () => {
    const candidate = validCandidate();
    expectCode(
      () =>
        validateCandidateArtifact({
          ...candidate,
          allowedPathsCompliance: { ...candidate.allowedPathsCompliance, evidence: [] },
        }),
      'PPE_EVIDENCE_REQUIRED',
    );
    expectCode(
      () => validateCandidateArtifact({ ...candidate, diffRef: { kind: 'diff', ref: 'x' } }),
      'PPE_EVIDENCE_KIND_INVALID',
    );
    expectCode(
      () =>
        validateCandidateArtifact({
          ...candidate,
          allowedPathsCompliance: { ...candidate.allowedPathsCompliance, result: 'OK' },
        }),
      'PPE_SCHEMA_INVALID',
    );
  });
});

describe('PatternVerificationArtifact', () => {
  it('enum values are exactly the frozen ones (WRITER_TEST_REGRESSION, not _ONLY)', () => {
    const verification = validVerification();
    expectCode(
      () =>
        validatePatternVerificationArtifact({
          ...verification,
          claims: [
            { claim: 'c', evidenceGrounds: ['WRITER_TEST_REGRESSION_ONLY'], materialInvariant: false },
          ],
        }),
      'PPE_SCHEMA_INVALID',
    );
    expect(
      validatePatternVerificationArtifact({
        ...verification,
        claims: [{ claim: 'c', evidenceGrounds: ['WRITER_TEST_REGRESSION'], materialInvariant: false }],
      }).claims[0].evidenceGrounds,
    ).toEqual(['WRITER_TEST_REGRESSION']);
  });

  it('a material invariant cannot rest on writer-test regression alone (frozen design section 5)', () => {
    const verification = validVerification();
    expectCode(
      () =>
        validatePatternVerificationArtifact({
          ...verification,
          claims: [{ claim: 'c', evidenceGrounds: ['WRITER_TEST_REGRESSION'], materialInvariant: true }],
        }),
      'PPE_MATERIAL_CLAIM_WEAK_GROUND',
    );
    expect(
      validatePatternVerificationArtifact({
        ...verification,
        claims: [
          {
            claim: 'c',
            evidenceGrounds: ['WRITER_TEST_REGRESSION', 'INDEPENDENT_CODE_DERIVATION'],
            materialInvariant: true,
          },
        ],
      }).verdict,
    ).toBe('ACCEPT');
  });

  it('NOT_PROVEN requires a reasonCode; empty isolationEvidence is allowed only then', () => {
    const verification = validVerification();
    expectCode(
      () => validatePatternVerificationArtifact({ ...verification, verdict: 'NOT_PROVEN' }),
      'PPE_REASON_CODE_REQUIRED',
    );
    const blocked = validatePatternVerificationArtifact({
      ...verification,
      verdict: 'NOT_PROVEN',
      reasonCode: 'VERIFICATION_BLOCKED',
      isolationEvidence: [],
    });
    expect(blocked.reasonCode).toBe('VERIFICATION_BLOCKED');
    expect(blocked.isolationEvidence).toEqual([]);
  });

  it('ACCEPT and FALSIFIED require non-empty isolationEvidence (BOOTSTRAP section 4)', () => {
    const verification = validVerification();
    for (const verdict of ['ACCEPT', 'FALSIFIED']) {
      expectCode(
        () => validatePatternVerificationArtifact({ ...verification, verdict, isolationEvidence: [] }),
        'PPE_ISOLATION_EVIDENCE_REQUIRED',
      );
    }
    expectCode(
      () => validatePatternVerificationArtifact({ ...verification, verdict: 'PROVEN' }),
      'PPE_SCHEMA_INVALID',
    );
    expectCode(
      () => validatePatternVerificationArtifact({ ...verification, claims: [] }),
      'PPE_SCHEMA_INVALID',
    );
  });

  it('reasonCode: undefined is dropped, a present reasonCode on ACCEPT is kept', () => {
    const verification = validVerification();
    const out = validatePatternVerificationArtifact({ ...verification, reasonCode: undefined });
    expect('reasonCode' in out).toBe(false);
    expect(validatePatternVerificationArtifact({ ...verification, reasonCode: 'NOTE' }).reasonCode).toBe(
      'NOTE',
    );
  });
});

describe('InputManifest', () => {
  it('validates identity fields', () => {
    expectCode(
      () => validateInputManifest({ ...validManifest(), dependencyLockHash: 'sha1:abc' }),
      'PPE_MANIFEST_INVALID',
    );
    expectCode(() => validateInputManifest({ ...validManifest(), baseSha: 'main' }), 'PPE_MANIFEST_INVALID');
    expectCode(
      () => validateInputManifest({ ...validManifest(), fixtureContentHashes: { a: 1 } }),
      'PPE_SCHEMA_INVALID',
    );
    expectCode(
      () => validateInputManifest({ ...validManifest(), environmentConfig: [] }),
      'PPE_SCHEMA_INVALID',
    );
  });

  it('secret-looking keys are rejected unless the value is a fingerprint or an ed25519 key id', () => {
    const manifest = validManifest();
    for (const key of ['API_TOKEN', 'db_password', 'PRIVATE_THING', 'clientSecret', 'SSH_KEY']) {
      expectCode(
        () => validateInputManifest({ ...manifest, environmentConfig: { [key]: 'plain-value' } }),
        'PPE_MANIFEST_SECRET_MATERIAL',
      );
    }
    const ok = validateInputManifest({
      ...manifest,
      environmentConfig: {
        API_TOKEN_FINGERPRINT: `sha256:${'ab'.repeat(32)}`,
        VERIFIER_KEY: 'ed25519:ppe-verifier-fixture',
      },
    });
    expect(Object.keys(ok.environmentConfig)).toHaveLength(2);
  });

  it('D12 secret scan by VALUE: positives', () => {
    const manifest = validManifest();
    const positives: Record<string, string> = {
      pem: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
      pemPublic: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----',
      url: 'postgres://mimer:hunter2@db.internal:5432/miljobeslut',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      base64: 'AKIAIOSFODNN7EXAMPLEwJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      hex64: 'c0ffee'.repeat(11),
      hex40: '0123456789abcdef0123456789abcdef01234567',
      signature: 'ed25519:GlYmq7Xk3pQ9zR1tB4vN8cW2yF6hJ0dL5sAmNoEpQrStUvWxYz0123456789AbCdEfGh==',
    };
    for (const [name, value] of Object.entries(positives)) {
      expect(secretMaterialReason(value), name).toBeDefined();
      expectCode(
        () => validateInputManifest({ ...manifest, environmentConfig: { HARMLESS_NAME: value } }),
        'PPE_MANIFEST_SECRET_MATERIAL',
      );
    }
  });

  it('D12 secret scan by VALUE: negatives', () => {
    const negatives = [
      `sha256:${'ab'.repeat(32)}`,
      'ed25519:ppe-verifier-fixture',
      'ed25519:local',
      'node v22.22.2 (linux x64), npm 10.9.7, docker 29.3.1',
      'unix:///run/ppe/docker.sock',
      'https://registry.npmjs.org/',
      'packages/mps-pattern-proof/src/persistence.ts',
      'production',
      `fingerprint=sha256:${'ab'.repeat(32)} signer=ed25519:ppe-verifier-fixture`,
      '1.2.3',
    ];
    for (const value of negatives) {
      expect(secretMaterialReason(value), value).toBeUndefined();
      expect(
        validateInputManifest({ ...validManifest(), environmentConfig: { HARMLESS_NAME: value } })
          .environmentConfig.HARMLESS_NAME,
      ).toBe(value);
    }
  });

  it('secretBackedAuthority entries never carry PEM/base64 material', () => {
    const manifest = validManifest();
    expectCode(
      () =>
        validateInputManifest({
          ...manifest,
          secretBackedAuthority: [{ keyId: 'ed25519:x', providerRef: '-----BEGIN PRIVATE KEY-----' }],
        }),
      'PPE_MANIFEST_SECRET_MATERIAL',
    );
    expectCode(
      () =>
        validateInputManifest({
          ...manifest,
          secretBackedAuthority: [{ keyId: 'ed25519:x', providerRef: 'kms', publicKeyPem: 'x' }],
        }),
      'PPE_UNKNOWN_FIELD',
    );
    const { secretBackedAuthority: _omitted, ...withoutAuthority } = manifest;
    const out = validateInputManifest(withoutAuthority);
    expect('secretBackedAuthority' in out).toBe(false);
    expect(validateInputManifest({ ...manifest, secretBackedAuthority: [] }).secretBackedAuthority).toEqual(
      [],
    );
  });
});

describe('ProofPackage', () => {
  it('validates tree/shas, non-empty provenInvariants and the nested manifest', () => {
    expectCode(
      () => validateProofPackage({ ...validProofPackage(), tree: 'abc' }),
      'PPE_CANDIDATE_SHA_INVALID',
    );
    expectCode(
      () => validateProofPackage({ ...validProofPackage(), provenInvariants: [] }),
      'PPE_SCHEMA_INVALID',
    );
    expectCode(
      () => validateProofPackage({ ...validProofPackage(), inputManifest: { ...validManifest(), extra: 1 } }),
      'PPE_UNKNOWN_FIELD',
    );
    expectCode(
      () =>
        validateProofPackage({
          ...validProofPackage(),
          inputManifest: { ...validManifest(), environmentConfig: { TOKEN: 'abc' } },
        }),
      'PPE_MANIFEST_SECRET_MATERIAL',
    );
    expect(validateProofPackage({ ...validProofPackage(), probeIdentities: [] }).probeIdentities).toEqual([]);
  });
});
