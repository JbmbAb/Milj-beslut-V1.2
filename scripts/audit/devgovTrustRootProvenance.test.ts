import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GITHUB_OIDC_ISSUER,
  PINNED_VERIFIER_AUTHORITY,
  trustPolicyAudience,
  verifyVerifierOwnedTrustPolicy,
} from '../devgov/github-oidc.mjs';

const authority = PINNED_VERIFIER_AUTHORITY;

function rsaKeys(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwt(
  privateKey: ReturnType<typeof rsaKeys>['privateKey'],
  kid: string,
  audience: string,
  claims = {},
) {
  const header = encode({ alg: 'RS256', typ: 'JWT', kid });
  const payload = encode({
    iss: GITHUB_OIDC_ISSUER,
    aud: audience,
    repository: authority.repository,
    workflow_ref: authority.workflow_ref,
    ref: authority.ref,
    environment: authority.environment,
    runner_environment: authority.runner_environment,
    run_id: '1234',
    run_attempt: '1',
    jti: 'oidc-token-id',
    iat: 1_000,
    nbf: 1_000,
    exp: 1_600,
    ...claims,
  });
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

function trustPolicy() {
  return JSON.stringify({
    schema_version: 'dev-gov-v0-trust-policy',
    authority,
    trusted_issuers: [
      {
        issuer: 'github-actions:example/repo:devgov-v0-attest',
        key_id: 'devgov-ci-ed25519-v1',
        algorithm: 'ed25519',
        public_key_pem: 'not-used-by-oidc-verification',
        workflow_ref: 'example/repo/.github/workflows/devgov-v0-attest.yml@refs/heads/main',
        runner_identity: 'github-hosted:ubuntu-latest',
      },
    ],
  });
}

function jwksFetch(jwk: ReturnType<typeof rsaKeys>['jwk']) {
  return async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
}

describe('DEV-GOV-V0 verifier-owned trust-root provenance', () => {
  const candidateSha = 'a'.repeat(40);

  it('accepts a protected policy only with a GitHub-signed exact gate identity', async () => {
    const github = rsaKeys('github-key');
    const rawPolicy = trustPolicy();

    const result = await verifyVerifierOwnedTrustPolicy(
      rawPolicy,
      jwt(github.privateKey, 'github-key', trustPolicyAudience(rawPolicy, candidateSha)),
      { fetchImpl: jwksFetch(github.jwk), nowSeconds: 1_100, expectedCandidateSha: candidateSha },
    );

    expect(result.valid).toBe(true);
    expect(result.oidc_claims.workflow_ref).toBe(authority.workflow_ref);
    expect(result.trust_policy_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('denies a candidate-signed token even when all claims look valid', async () => {
    const github = rsaKeys('github-key');
    const candidate = rsaKeys('candidate-key');
    const rawPolicy = trustPolicy();

    const result = await verifyVerifierOwnedTrustPolicy(
      rawPolicy,
      jwt(candidate.privateKey, 'candidate-key', trustPolicyAudience(rawPolicy, candidateSha)),
      { fetchImpl: jwksFetch(github.jwk), nowSeconds: 1_100, expectedCandidateSha: candidateSha },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('OIDC signing key is not published by GitHub');
  });

  it('denies a policy that redirects authority to an actor-controlled repository', async () => {
    const github = rsaKeys('github-key');
    const redirected = JSON.stringify({
      ...JSON.parse(trustPolicy()),
      authority: {
        ...authority,
        repository: 'attacker/repo',
        workflow_ref: 'attacker/repo/.github/workflows/devgov-v0-gate.yml@refs/heads/main',
      },
    });

    const result = await verifyVerifierOwnedTrustPolicy(
      redirected,
      jwt(github.privateKey, 'github-key', trustPolicyAudience(redirected, candidateSha), {
        repository: 'attacker/repo',
        workflow_ref: 'attacker/repo/.github/workflows/devgov-v0-gate.yml@refs/heads/main',
      }),
      { fetchImpl: jwksFetch(github.jwk), nowSeconds: 1_100, expectedCandidateSha: candidateSha },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('trust policy authority.repository is not pinned verifier authority');
  });

  it.each([
    ['repository', 'attacker/repo'],
    ['workflow_ref', 'example/repo/.github/workflows/attacker.yml@refs/heads/main'],
    ['ref', 'refs/heads/feature'],
    ['environment', 'unprotected'],
    ['runner_environment', 'self-hosted'],
    ['aud', 'attacker-audience'],
  ])('denies a GitHub-signed token with the wrong %s claim', async (field, value) => {
    const github = rsaKeys('github-key');
    const rawPolicy = trustPolicy();
    const expectedAudience = trustPolicyAudience(rawPolicy, candidateSha);

    const result = await verifyVerifierOwnedTrustPolicy(
      rawPolicy,
      jwt(github.privateKey, 'github-key', field === 'aud' ? String(value) : expectedAudience, {
        ...(field === 'aud' ? {} : { [field]: value }),
      }),
      { fetchImpl: jwksFetch(github.jwk), nowSeconds: 1_100, expectedCandidateSha: candidateSha },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(field === 'aud' ? 'audience' : field);
  });

  it('fails closed for absent or invalid protected verifier configuration', async () => {
    const missing = await verifyVerifierOwnedTrustPolicy('', 'token');
    const invalid = await verifyVerifierOwnedTrustPolicy('{', 'token');

    expect(missing).toEqual({
      valid: false,
      errors: ['protected verifier trust policy is required'],
    });
    expect(invalid).toEqual({
      valid: false,
      errors: ['protected verifier trust policy is invalid JSON'],
    });
  });

  it('surfaces GitHub JWKS unavailability instead of accepting unverified provenance', async () => {
    const github = rsaKeys('github-key');
    const rawPolicy = trustPolicy();

    await expect(
      verifyVerifierOwnedTrustPolicy(
        rawPolicy,
        jwt(github.privateKey, 'github-key', trustPolicyAudience(rawPolicy, candidateSha)),
        {
          fetchImpl: async () => {
            throw new Error('network unavailable');
          },
          nowSeconds: 1_100,
          expectedCandidateSha: candidateSha,
        },
      ),
    ).rejects.toThrow('network unavailable');
  });

  it('binds the OIDC authority to the exact policy bytes and candidate SHA', async () => {
    const github = rsaKeys('github-key');
    const original = trustPolicy();
    const replacement = JSON.stringify({ ...JSON.parse(original), substituted: true });
    const token = jwt(github.privateKey, 'github-key', trustPolicyAudience(original, candidateSha));

    const policySwap = await verifyVerifierOwnedTrustPolicy(replacement, token, {
      fetchImpl: jwksFetch(github.jwk),
      nowSeconds: 1_100,
      expectedCandidateSha: candidateSha,
    });
    const shaSwap = await verifyVerifierOwnedTrustPolicy(original, token, {
      fetchImpl: jwksFetch(github.jwk),
      nowSeconds: 1_100,
      expectedCandidateSha: 'b'.repeat(40),
    });

    expect(policySwap.valid).toBe(false);
    expect(policySwap.errors).toContain('OIDC audience mismatch');
    expect(shaSwap.valid).toBe(false);
    expect(shaSwap.errors).toContain('OIDC audience mismatch');
  });
});
